-- 0015_roles_and_alerts.sql
-- Role tiers + broadcast alerts. Apply after 0014.
--
-- Tiers:
--   • App Admin (profiles.is_admin) — can do everything, everywhere.
--   • Committee Lead (committee_members.role = 'Lead') — manages members of the
--     committee they lead (add/approve/remove); is NOT necessarily an app admin.
--   • Member — in committee_members, no role.
--
-- Plus: Family Fest leads (and app admins) can post app-wide ALERTS — a real
-- broadcast announcement everyone sees in the banner (and the mini's mailer can
-- email opted-in members; see media-server/alert-mailer.js). Until now alerts
-- were device-local only.

-- ── Role helpers ─────────────────────────────────────────────────────────────
-- Lead of this committee (or an app admin). SECURITY DEFINER so RLS/RPCs can
-- call it without recursing through committee_members' own policies.
create or replace function public.is_committee_lead(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.committee_members m
    where m.committee_id = cid and m.user_id = auth.uid() and m.role = 'Lead'
  ) or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
  );
$$;
revoke all on function public.is_committee_lead(uuid) from public, anon;
grant execute on function public.is_committee_lead(uuid) to authenticated;

-- Who may post app-wide alerts: app admins + Family Fest committee leads.
create or replace function public.can_post_alerts()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    or exists (
      select 1 from public.committee_members m
      join public.committees c on c.id = m.committee_id
      where m.user_id = auth.uid() and m.role = 'Lead' and c.slug = 'family-fest'
    );
$$;
revoke all on function public.can_post_alerts() from public, anon;
grant execute on function public.can_post_alerts() to authenticated;

-- ── Membership RPCs now lead-aware (were app-admin-only in 0012) ─────────────
-- Approve/reject a join request: app admin OR the lead of that committee.
create or replace function public.review_join_request(req_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.committee_join_requests;
begin
  select * into r from public.committee_join_requests where id = req_id;
  if not found then raise exception 'Request not found'; end if;
  if not public.is_committee_lead(r.committee_id) then
    raise exception 'Not authorized';
  end if;
  if approve then
    insert into public.committee_members (committee_id, user_id)
    values (r.committee_id, r.user_id)
    on conflict (committee_id, user_id) do nothing;
  end if;
  update public.committee_join_requests
    set status = case when approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now()
    where id = req_id;
end;
$$;
revoke all on function public.review_join_request(uuid, boolean) from public, anon;
grant execute on function public.review_join_request(uuid, boolean) to authenticated;

-- Add/remove a member directly: app admin OR the committee's lead. A lead can't
-- remove another LEAD (only an app admin can) — keeps leads from demoting peers.
create or replace function public.set_committee_member(cid uuid, target uuid, is_member boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare am_admin boolean;
begin
  if not public.is_committee_lead(cid) then
    raise exception 'Not authorized';
  end if;
  am_admin := exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin);
  if is_member then
    insert into public.committee_members (committee_id, user_id)
    values (cid, target) on conflict (committee_id, user_id) do nothing;
    update public.committee_join_requests
      set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
      where committee_id = cid and user_id = target and status = 'pending';
  else
    if not am_admin and exists (
      select 1 from public.committee_members m
      where m.committee_id = cid and m.user_id = target and m.role = 'Lead'
    ) then
      raise exception 'Only an app admin can remove a committee lead';
    end if;
    delete from public.committee_members where committee_id = cid and user_id = target;
  end if;
end;
$$;
revoke all on function public.set_committee_member(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_committee_member(uuid, uuid, boolean) to authenticated;

-- Promote/demote a Committee Lead — APP ADMINS ONLY. Promoting also ensures the
-- person is a member of that committee.
create or replace function public.set_committee_lead(cid uuid, target uuid, is_lead boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an app admin can set committee leads';
  end if;
  if is_lead then
    insert into public.committee_members (committee_id, user_id, role)
    values (cid, target, 'Lead')
    on conflict (committee_id, user_id) do update set role = 'Lead';
  else
    update public.committee_members set role = null where committee_id = cid and user_id = target;
  end if;
end;
$$;
revoke all on function public.set_committee_lead(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_committee_lead(uuid, uuid, boolean) to authenticated;

-- Leads can read their committee's join-request queue (was self/admin only).
drop policy if exists "join_requests: self or admin read" on public.committee_join_requests;
create policy "join_requests: self or lead read" on public.committee_join_requests for select
  using (user_id = auth.uid() or public.is_committee_lead(committee_id));
drop policy if exists "join_requests: self or admin delete" on public.committee_join_requests;
create policy "join_requests: self or lead delete" on public.committee_join_requests for delete
  using (user_id = auth.uid() or public.is_committee_lead(committee_id));

-- ── Broadcast alerts (banner notices, optionally emailed) ────────────────────
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles (id) on delete set null,
  title text not null,
  body text,
  severity text not null default 'alert' check (severity in ('info','alert')),
  notify_email boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  -- Stamped by the mini's mailer once it has emailed opted-in members, so the
  -- same alert is never emailed twice (e.g. on a Realtime reconnect/replay).
  email_sent_at timestamptz
);
create index if not exists announcements_created_idx on public.announcements (created_at desc);
alter table public.announcements enable row level security;

-- Public read (the banner shows to guests too); poster filters by expiry/dismiss.
drop policy if exists "announcements: public read" on public.announcements;
create policy "announcements: public read" on public.announcements for select using (true);
-- Only app admins + Family Fest leads can post.
drop policy if exists "announcements: posters insert" on public.announcements;
create policy "announcements: posters insert" on public.announcements for insert
  with check (author_id = auth.uid() and public.can_post_alerts());
-- Author or app admin can edit/expire/delete.
drop policy if exists "announcements: author or admin update" on public.announcements;
create policy "announcements: author or admin update" on public.announcements for update
  using (author_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
drop policy if exists "announcements: author or admin delete" on public.announcements;
create policy "announcements: author or admin delete" on public.announcements for delete
  using (author_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

do $$ begin alter publication supabase_realtime add table public.announcements; exception when duplicate_object then null; end $$;

-- Recipient emails for the mailer — opted-in members only. SECURITY DEFINER so
-- it can read auth.users; granted ONLY to service_role (the mini's mailer key),
-- never to clients.
create or replace function public.alert_recipients()
returns table (email text)
language sql
security definer
set search_path = ''
as $$
  select u.email::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.email_alerts = true and u.email is not null;
$$;
revoke all on function public.alert_recipients() from public, anon, authenticated;
grant execute on function public.alert_recipients() to service_role;
