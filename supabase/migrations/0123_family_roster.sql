-- 0123_family_roster.sql
-- "Family roster" — the master list of family who AREN'T on the app yet, so the
-- resort can keep everyone's email on file, reach them with the same messages
-- members get, and have them slot cleanly into their account the moment they sign
-- up. Direct sibling of committee_roster (0056/0060): each person carries a name +
-- email + phone, and the EMAIL is the join key. When someone verifies with a
-- matching email, their roster slot AUTO-LINKS to the new account — and everything
-- pre-set for that email takes effect at once:
--   • their pre-assigned HOUSE (family_roster.house_id → profiles.house_id), and
--   • their pre-set COMMITTEE slots (committee_roster, which already links by
--     email via 0056 — unchanged; both fire on the same signup).
--
-- The roster `name` is a TEMPORARY display name the admin fills in (handy when a
-- person's email doesn't look like their name). On signup it seeds the new
-- account's display name only if they didn't pick one themselves — they can
-- rename anytime after.
--
-- Scope of "linking": it stamps linked_user_id (display + up-to-date email) and
-- honors the admin's pre-set house/committee. House membership still can't be
-- self-assigned by a client — the only writers are admins (this roster) and the
-- set_member_house RPC (0064). So auto-applying the house on signup is just the
-- admin's earlier, explicit assignment taking effect, not an escalation.
--
-- Where the roster's emails flow (all additive; account-less people only):
--   • house_member_recipients(hid)         — "Email the house" (House Hub).
--   • all_member_recipients / directory_*  — resort-wide "Email members" blasts.
--   • meeting_proposal_email / _confirmed  — the meeting/event proposal + confirm
--                                            emails (they get the heads-up; they
--                                            still must sign up to vote/RSVP).
--
-- Reads: signed-in members (it carries emails = PII). Writes: app admins only.
-- Apply in the Supabase SQL editor after 0122.

-- ── Table ─────────────────────────────────────────────────────────────────────
create table if not exists public.family_roster (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,                 -- temporary display name (admin-set)
  email          text,                          -- claim key: matched to profiles.contact_email
  phone          text,
  house_id       uuid references public.houses (id) on delete set null,
  position       int not null default 0,
  linked_user_id uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id) on delete set null
);
-- One roster slot per email (case-insensitive); nameless-email slots are allowed
-- (email null) but two rows can't claim the same address.
create unique index if not exists family_roster_email_uidx
  on public.family_roster (lower(email)) where email is not null;
create index if not exists family_roster_house_idx on public.family_roster (house_id, position);

alter table public.family_roster enable row level security;

-- Read: any signed-in member (mirrors the member directory being member-visible).
drop policy if exists "family_roster read" on public.family_roster;
create policy "family_roster read" on public.family_roster for select
  using (auth.uid() is not null);

-- Write: app admins only (mirror committee_roster + admin-only house assignment).
drop policy if exists "family_roster write" on public.family_roster;
create policy "family_roster write" on public.family_roster for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ── Auto-link (profiles side): the instant a rostered person verifies ─────────
-- Stamp linked_user_id, carry their pre-set house, and seed their temp name.
create or replace function public.link_family_roster()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
  v_name  text;
begin
  if new.contact_email is null or length(trim(new.contact_email)) = 0 then
    return new;
  end if;

  -- 1. Link matching roster slots to this account (display + up-to-date email).
  update public.family_roster r
     set linked_user_id = new.id, updated_at = now()
   where r.email is not null
     and lower(r.email) = lower(new.contact_email)
     and r.linked_user_id is distinct from new.id;

  -- 2. Honor an admin's pre-assigned house (only when they have none yet — never
  --    overrides an explicit later assignment).
  if new.house_id is null then
    select r.house_id into v_house
      from public.family_roster r
     where r.email is not null
       and lower(r.email) = lower(new.contact_email)
       and r.house_id is not null
     limit 1;
    if v_house is not null then
      update public.profiles set house_id = v_house where id = new.id and house_id is null;
    end if;
  end if;

  -- 3. Seed the admin's temporary name if the member didn't set their own (blank
  --    or the raw email prefix default). Prefer the family roster, then any
  --    committee roster slot. They can rename anytime after.
  select r.name into v_name
    from public.family_roster r
   where r.email is not null and lower(r.email) = lower(new.contact_email)
     and nullif(btrim(r.name), '') is not null
   limit 1;
  if v_name is null then
    select r.name into v_name
      from public.committee_roster r
     where r.email is not null and lower(r.email) = lower(new.contact_email)
       and nullif(btrim(r.name), '') is not null
     limit 1;
  end if;
  if v_name is not null then
    update public.profiles
       set display_name = v_name
     where id = new.id
       and (display_name is null
            or btrim(display_name) = ''
            or lower(btrim(display_name)) = lower(split_part(new.contact_email, '@', 1)));
  end if;

  return new;
end;
$$;

drop trigger if exists link_family_roster_trg on public.profiles;
create trigger link_family_roster_trg
  after insert or update of contact_email on public.profiles
  for each row execute function public.link_family_roster();

-- ── Auto-link (roster side): admin adds/edits an email that already has an
--    account → stamp the link right away (mirror committee 0060). ─────────────
create or replace function public.link_family_roster_from_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.linked_user_id := null;
  if new.email is not null and length(trim(new.email)) > 0 then
    select p.id into new.linked_user_id
      from public.profiles p
     where p.contact_email is not null
       and lower(p.contact_email) = lower(trim(new.email))
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists link_family_roster_from_row_trg on public.family_roster;
create trigger link_family_roster_from_row_trg
  before insert or update of email on public.family_roster
  for each row execute function public.link_family_roster_from_row();

-- ── Recipient list for "Email the house" (House Hub) ─────────────────────────
-- Everyone in the house with a usable, current email:
--   A) account members (profiles.house_id = hid)          → their live best email
--   B) roster people assigned to this house, not yet a member → linked account's
--      live email if signed up, else the roster address.
-- The A∪B split means nobody is dropped between "not on the app", "signed up but
-- not yet assigned", and "full member". Gated to house members / admins.
create or replace function public.house_member_recipients(hid uuid)
returns table (id uuid, name text, email text)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
    coalesce(nullif(btrim(p.contact_email), ''), u.email) as email
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_house_member(hid)
    and p.house_id = hid
    and coalesce(nullif(btrim(p.contact_email), ''), u.email) is not null
  union
  select
    r.id,
    coalesce(
      nullif(btrim(lp.display_name), ''),
      nullif(btrim(r.name), ''),
      split_part(coalesce(nullif(btrim(lp.contact_email), ''), lu.email, r.email), '@', 1)
    ) as name,
    coalesce(nullif(btrim(lp.contact_email), ''), lu.email, nullif(btrim(r.email), '')) as email
  from public.family_roster r
  left join public.profiles lp on lp.id = r.linked_user_id
  left join auth.users   lu on lu.id = r.linked_user_id
  where public.is_house_member(hid)
    and r.house_id = hid
    and (r.linked_user_id is null or lp.house_id is distinct from hid)
    and coalesce(nullif(btrim(lp.contact_email), ''), lu.email, nullif(btrim(r.email), '')) is not null
  order by name;
$$;
revoke all on function public.house_member_recipients(uuid) from public, anon;
grant execute on function public.house_member_recipients(uuid) to authenticated;

-- ── Widen the resort-wide "Email members" pools to include account-less family ─
-- Any signed-in member can hand-pick from the whole directory + the roster.
create or replace function public.directory_recipients()
returns table (id uuid, name text, email text)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
    coalesce(nullif(btrim(p.contact_email), ''), u.email) as email
  from public.profiles p
  join auth.users u on u.id = p.id
  where auth.uid() is not null
    and coalesce(nullif(btrim(p.contact_email), ''), u.email) is not null
  union
  select
    r.id,
    coalesce(nullif(btrim(r.name), ''), split_part(r.email, '@', 1)) as name,
    btrim(r.email) as email
  from public.family_roster r
  where auth.uid() is not null
    and r.linked_user_id is null
    and nullif(btrim(r.email), '') is not null
  order by name;
$$;
revoke all on function public.directory_recipients() from public, anon;
grant execute on function public.directory_recipients() to authenticated;

-- "Everyone" — app admin OR anyone in any committee (unchanged gate), now also
-- reaching account-less family so important blasts don't skip them.
create or replace function public.all_member_recipients()
returns table (id uuid, name text, email text)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
    coalesce(nullif(btrim(p.contact_email), ''), u.email) as email
  from public.profiles p
  join auth.users u on u.id = p.id
  where (
      exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
      or exists (select 1 from public.committee_members cm where cm.user_id = auth.uid())
    )
    and coalesce(nullif(btrim(p.contact_email), ''), u.email) is not null
  union
  select
    r.id,
    coalesce(nullif(btrim(r.name), ''), split_part(r.email, '@', 1)) as name,
    btrim(r.email) as email
  from public.family_roster r
  where (
      exists (select 1 from public.profiles me where me.id = auth.uid() and me.is_admin)
      or exists (select 1 from public.committee_members cm where cm.user_id = auth.uid())
    )
    and r.linked_user_id is null
    and nullif(btrim(r.email), '') is not null
  order by name;
$$;
revoke all on function public.all_member_recipients() from public, anon;
grant execute on function public.all_member_recipients() to authenticated;

-- ── Meeting/event emails also reach account-less rostered people ──────────────
-- Proposal email (opt-in per meeting): members with email_alerts on, minus the
-- organizer, PLUS account-less roster people in the room (committee roster for a
-- committee meeting, family roster for a house meeting). They get the heads-up;
-- they still have to sign up to actually vote.
create or replace function public.meeting_proposal_email(p_meeting uuid)
returns table(title text, url text, emails text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.meetings%rowtype;
begin
  select * into m from public.meetings where id = p_meeting;
  if not found then return; end if;

  return query
  select
    m.title,
    public._meeting_url(m),
    array(
      select u.email::text
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.email_alerts = true
        and u.email is not null
        and p.id <> coalesce(m.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
        and (
          case
            when m.scope_type = 'committee' then exists (
              select 1 from public.committee_roster r
              where r.committee_slug = m.committee_slug
                and r.linked_user_id = p.id
                and (m.area is null or m.area = any(r.roles) or (m.area || ' · Lead') = any(r.roles))
            )
            when m.scope_type = 'house' then p.house_id = m.house_id
            else false
          end
        )
      union
      -- Account-less committee roster (committee meetings), matching area.
      select btrim(r.email)
      from public.committee_roster r
      where m.scope_type = 'committee'
        and r.committee_slug = m.committee_slug
        and r.linked_user_id is null
        and nullif(btrim(r.email), '') is not null
        and (m.area is null or m.area = any(r.roles) or (m.area || ' · Lead') = any(r.roles))
      union
      -- Account-less family roster (house meetings), assigned to the house.
      select btrim(fr.email)
      from public.family_roster fr
      where m.scope_type = 'house'
        and fr.house_id = m.house_id
        and fr.linked_user_id is null
        and nullif(btrim(fr.email), '') is not null
    );
end;
$$;
revoke all on function public.meeting_proposal_email(uuid) from public, anon, authenticated;
grant execute on function public.meeting_proposal_email(uuid) to service_role;

-- Confirmation email (always on finalize): every room member with email_alerts
-- (incl. organizer), PLUS account-less roster people in the room.
create or replace function public.meeting_confirmed_email(p_meeting uuid)
returns table(title text, description text, meet_url text, when_label text, url text, emails text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  m    public.meetings%rowtype;
  slot public.meeting_slots%rowtype;
begin
  select * into m from public.meetings where id = p_meeting;
  if not found or m.chosen_slot_id is null then return; end if;
  select * into slot from public.meeting_slots where id = m.chosen_slot_id;
  if not found then return; end if;

  return query
  select
    m.title,
    m.description,
    m.meet_url,
    to_char(slot.starts_at at time zone 'America/Chicago', 'FMDay, FMMonth FMDD')
      || ' at ' || to_char(slot.starts_at at time zone 'America/Chicago', 'FMHH12:MI AM'),
    public._meeting_url(m),
    array(
      select u.email::text
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.email_alerts = true
        and u.email is not null
        and (
          case
            when m.scope_type = 'committee' then exists (
              select 1 from public.committee_roster r
              where r.committee_slug = m.committee_slug
                and r.linked_user_id = p.id
                and (m.area is null or m.area = any(r.roles) or (m.area || ' · Lead') = any(r.roles))
            )
            when m.scope_type = 'house' then p.house_id = m.house_id
            else false
          end
        )
      union
      select btrim(r.email)
      from public.committee_roster r
      where m.scope_type = 'committee'
        and r.committee_slug = m.committee_slug
        and r.linked_user_id is null
        and nullif(btrim(r.email), '') is not null
        and (m.area is null or m.area = any(r.roles) or (m.area || ' · Lead') = any(r.roles))
      union
      select btrim(fr.email)
      from public.family_roster fr
      where m.scope_type = 'house'
        and fr.house_id = m.house_id
        and fr.linked_user_id is null
        and nullif(btrim(fr.email), '') is not null
    );
end;
$$;
revoke all on function public.meeting_confirmed_email(uuid) from public, anon, authenticated;
grant execute on function public.meeting_confirmed_email(uuid) to service_role;

-- ── One-time backfill: link any slots whose email already has an account ──────
update public.family_roster r
   set linked_user_id = p.id, updated_at = now()
  from public.profiles p
 where r.email is not null
   and lower(p.contact_email) = lower(r.email)
   and r.linked_user_id is distinct from p.id;
