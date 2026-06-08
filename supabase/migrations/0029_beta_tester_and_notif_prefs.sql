-- 0029_beta_tester_and_notif_prefs.sql
-- Two additions that back the new Notifications tab (0030):
--   • profiles.beta_tester — a new app role, set ONLY by admins (same guardrail
--     as is_admin: never in the client UPDATE allowlist). Lets an admin send test
--     notifications to a small opt-in group instead of the whole resort.
--   • profiles.notif_types — which in-app notification kinds a member wants, as a
--     multi-select array (same shape/pattern as push_types in 0020). Default is
--     everything ON; members manage it themselves (column-level grant).
--   plus is_beta_tester() / set_beta_tester() helpers, and admin_members() gains
--   a beta_tester column so the admin Members list can show + toggle it.
-- Apply in the Supabase SQL editor after 0028, before 0030.

-- ── Beta Tester role ─────────────────────────────────────────────────────────
-- NOT granted to authenticated (privilege-escalation block, exactly like
-- is_admin in 0001) — the only write path is set_beta_tester() below.
alter table public.profiles
  add column if not exists beta_tester boolean not null default false;

-- ── In-app notification preferences ──────────────────────────────────────────
-- Any subset of these kinds. Default = all on (chat tags included, per product
-- decision). 'broadcast' is intentionally absent — admin broadcasts always
-- deliver regardless of this list (audience is the gate, not the member's prefs).
alter table public.profiles
  add column if not exists notif_types text[] not null
  default '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join}';

-- Members may set their own notification prefs (column-level grant, same
-- guardrail pattern as push_types in 0020 — still can't touch is_admin etc.).
grant update (notif_types) on public.profiles to authenticated;

-- ── Role helper ──────────────────────────────────────────────────────────────
-- SECURITY DEFINER so RLS/RPCs can call it without recursing through profiles'
-- own policies. Mirrors how is_admin is checked inline elsewhere.
create or replace function public.is_beta_tester()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.beta_tester
  );
$$;
revoke all on function public.is_beta_tester() from public, anon;
grant execute on function public.is_beta_tester() to authenticated;

-- ── Grant/revoke another member's beta-tester flag — admins only ─────────────
-- Clone of set_admin (0008). Clients can't write beta_tester directly, so this
-- is the only way to assign it from inside the app.
create or replace function public.set_beta_tester(target uuid, value boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  update public.profiles set beta_tester = value where id = target;
end;
$$;
revoke all on function public.set_beta_tester(uuid, boolean) from public, anon;
grant execute on function public.set_beta_tester(uuid, boolean) to authenticated;

-- ── admin_members(): add beta_tester to the directory ────────────────────────
-- Return-type change, so drop + recreate (create-or-replace can't widen the
-- TABLE signature). Same body as 0008, plus p.beta_tester.
drop function if exists public.admin_members();
create function public.admin_members()
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  household text,
  email text,
  is_admin boolean,
  beta_tester boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  return query
    select p.id, p.display_name, p.avatar_url, p.household,
           u.email::text, p.is_admin, p.beta_tester, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.is_admin desc, lower(coalesce(p.display_name, u.email::text));
end;
$$;

revoke all on function public.admin_members() from public, anon;
grant execute on function public.admin_members() to authenticated;
