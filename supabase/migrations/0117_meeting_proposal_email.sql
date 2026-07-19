-- 0117_meeting_proposal_email.sql
-- Optional EMAIL for a new meeting proposal (migration 0116). On top of the
-- in-app Activity notification + phone push, the organizer can tick "Also email
-- everyone" so room members get an email ("a meeting is being planned") with a
-- link that opens the app straight into the voting UI. Mirrors the admin-alert
-- email path exactly: a per-row notify_email flag + a claimed *_email_sent_at
-- timestamp (so the mac-mini alert-mailer sends once), and it respects each
-- member's existing profiles.email_alerts opt-in (the "Email alerts" toggle in
-- Profile) — nobody who turned email off gets one.
--
-- Apply in the Supabase SQL editor after 0116.

-- ── 1. Columns on meetings (mirror announcements.notify_email/email_sent_at) ──
alter table public.meetings
  add column if not exists notify_email boolean not null default false;
alter table public.meetings
  add column if not exists proposal_email_sent_at timestamptz;

-- ── 2. create_meeting gains p_email (drop the 0116 8-arg version first so there
--       is only ONE overload — avoids the dual-overload trap from cabins 0092/0108) ──
drop function if exists public.create_meeting(text, uuid, text, uuid, text, text, jsonb, date);

create or replace function public.create_meeting(
  p_scope        text,
  p_committee_id uuid,
  p_area         text,
  p_house_id     uuid,
  p_title        text,
  p_description  text,
  p_slots        jsonb,
  p_respond_by   date default null,
  p_email        boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_slug    text;
  v_title   text;
  v_count   int;
  v_actor   text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_scope not in ('committee', 'house') then raise exception 'Invalid scope'; end if;
  if not public.can_organize_meeting(p_scope, p_committee_id, p_area, p_house_id) then
    raise exception 'Not authorized';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then raise exception 'A title is required'; end if;
  if length(v_title) > 200 then raise exception 'Keep the title under 200 characters'; end if;

  v_count := coalesce(jsonb_array_length(p_slots), 0);
  if v_count < 1 then raise exception 'Add at least one time option'; end if;
  if v_count > 10 then raise exception 'A meeting can have at most 10 time options'; end if;

  if p_scope = 'committee' then
    select slug into v_slug from public.committees where id = p_committee_id;
    if v_slug is null then raise exception 'Committee not found'; end if;
  end if;

  insert into public.meetings
    (scope_type, committee_id, committee_slug, area, house_id, title, description, created_by, respond_by, notify_email)
  values
    (p_scope, p_committee_id, v_slug, p_area, p_house_id, v_title,
     nullif(btrim(coalesce(p_description, '')), ''), auth.uid(), p_respond_by, coalesce(p_email, false))
  returning id into v_id;

  insert into public.meeting_slots (meeting_id, starts_at, duration_min, position)
  select
    v_id,
    (elem->>'starts_at')::timestamptz,
    coalesce((elem->>'duration_min')::int, 60),
    (ord - 1)::int
  from jsonb_array_elements(p_slots) with ordinality as t(elem, ord);

  select coalesce(display_name, 'Someone') into v_actor from public.profiles where id = auth.uid();
  perform public._notify_meeting_room(
    v_id, 'meeting_proposed', auth.uid(),
    v_actor || ' wants to schedule: ' || v_title,
    'Tap to mark when you''re free',
    (select public._meeting_url(m) from public.meetings m where m.id = v_id)
  );

  return v_id;
end;
$$;
revoke all on function public.create_meeting(text, uuid, text, uuid, text, text, jsonb, date, boolean) from public, anon;
grant execute on function public.create_meeting(text, uuid, text, uuid, text, text, jsonb, date, boolean) to authenticated;

-- ── 3. Service-role recipient list for the mac-mini mailer ────────────────────
-- Returns the meeting's title, its in-app deep-link, and the emails of room
-- members who (a) can see the room and (b) have email_alerts on — minus the
-- organizer. service_role only (the mailer), like alert_recipients (0015/0017).
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
    );
end;
$$;
revoke all on function public.meeting_proposal_email(uuid) from public, anon, authenticated;
grant execute on function public.meeting_proposal_email(uuid) to service_role;
