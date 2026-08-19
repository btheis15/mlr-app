-- 0204_event_message_exclude_appreview.sql
-- Never email appreview@muskellungelakeresort.com — it's an Apple App Store
-- reviewer sign-in account (profiles row `display_name = 'App Review'`), not
-- a real inbox anyone reads. Its `email_alerts` was also flipped to false
-- directly (a one-off data fix, no migration needed for that half), which
-- already stops it from every path that gates on that flag — this migration
-- adds a HARDCODED exclusion in the two event-email functions on top, so it
-- stays excluded permanently regardless of that flag ever getting toggled
-- back (by a future admin action, a bug, or Apple re-provisioning the
-- account with alerts on).
--
-- Return types are UNCHANGED (only the recips CTE gains a filter), so both
-- are CREATE OR REPLACE — recreated from 0197's current production bodies,
-- per the 0160 lesson (recreate from what's actually live, never an older copy).

create or replace function public.event_message_email(p_message uuid)
returns table(
  subject           text,
  body              text,
  sender_name       text,
  sender_email      text,
  event_id          text,
  event_title       text,
  event_when        text,
  event_start_date  date,
  event_end_date    date,
  event_emoji       text,
  event_location    text,
  event_description text,
  mlr_items         jsonb,
  house_groups      jsonb,
  general_emails    text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       public.event_messages%rowtype;
  v_event uuid;
begin
  select * into m from public.event_messages where id = p_message;
  if not found then return; end if;

  begin
    v_event := m.event_id::uuid;
  exception when invalid_text_representation then
    v_event := null; -- seed/synthesized event: no events row to enrich from
  end;

  return query
  with items as (
    select
      wi.house_id,
      wi.created_at,
      case wi.urgency
        when 'asap'         then 0
        when 'this_year'    then 10
        when 'custom'       then 15
        when 'next_year'    then 20
        when 'nice_to_have' then 30
        else 40
      end as rank,
      jsonb_build_object(
        'title',        wi.title,
        'notes',        wi.notes,
        'urgency',      wi.urgency,
        'customLabel',  wi.custom_label,
        'customColor',  wi.custom_color,
        'peopleNeeded', wi.people_needed
      ) as item
    from public.event_work_items ewi
    join public.work_items wi on wi.id = ewi.work_item_id
    where ewi.event_id = m.event_id
      and wi.status <> 'done'
      and m.include_work_items
  ),
  item_houses as (
    select distinct i.house_id as hid from items i where i.house_id is not null
  ),
  recips as (
    select
      u.email::text as email,
      case when p.house_id in (select ih.hid from item_houses ih) then p.house_id end as bucket
    from public.profiles p
    join auth.users u on u.id = p.id
    where u.email is not null
      and lower(u.email) <> 'appreview@muskellungelakeresort.com'
      and (p.approved is true or p.is_admin is true)
      and p.email_alerts = true
      and not (
        m.exclude_not_attending
        and exists (
          select 1 from public.event_attendance ea
          where ea.event_id = m.event_id and ea.user_id = p.id and ea.status = 'not_going'
        )
      )
    union all
    select
      btrim(fr.email),
      case when fr.house_id in (select ih.hid from item_houses ih) then fr.house_id end
    from public.family_roster fr
    where m.include_roster
      and fr.linked_user_id is null
      and nullif(btrim(fr.email), '') is not null
      and lower(btrim(fr.email)) <> 'appreview@muskellungelakeresort.com'
    union all
    select btrim(cr.email), null::uuid
    from public.committee_roster cr
    where m.include_roster
      and cr.linked_user_id is null
      and nullif(btrim(cr.email), '') is not null
      and lower(btrim(cr.email)) <> 'appreview@muskellungelakeresort.com'
    union all
    select btrim(ea.guest_email), null::uuid
    from public.event_attendance ea
    where ea.event_id = m.event_id
      and nullif(btrim(ea.guest_email), '') is not null
      and lower(btrim(ea.guest_email)) <> 'appreview@muskellungelakeresort.com'
      and not (m.exclude_not_attending and ea.status = 'not_going')
  ),
  bucketed as (
    select r.email, (array_agg(r.bucket) filter (where r.bucket is not null))[1] as bucket
    from recips r
    group by r.email
  )
  select
    m.subject,
    m.body,
    (select coalesce(nullif(btrim(pr.display_name), ''), 'A member')
       from public.profiles pr where pr.id = m.sender_id),
    (select u.email::text from auth.users u where u.id = m.sender_id),
    m.event_id,
    m.event_title,
    coalesce(
      m.event_when,
      (select case
                when e.end_date is not null and e.end_date <> e.start_date
                  then to_char(e.start_date, 'FMMon FMDD') || ' – ' || to_char(e.end_date, 'FMMon FMDD, YYYY')
                else to_char(e.start_date, 'FMDay, FMMon FMDD, YYYY')
              end
         from public.events e where e.id = v_event)
    ),
    (select e.start_date from public.events e where e.id = v_event),
    (select e.end_date from public.events e where e.id = v_event),
    (select e.emoji from public.events e where e.id = v_event),
    (select e.location from public.events e where e.id = v_event),
    (select e.description from public.events e where e.id = v_event),
    (select jsonb_agg(i.item order by i.rank, i.created_at desc)
       from items i where i.house_id is null),
    (select jsonb_agg(
              jsonb_build_object(
                'houseId', h.id,
                'name',    h.name,
                'emoji',   h.emoji,
                'items',   (select jsonb_agg(i.item order by i.rank, i.created_at desc)
                              from items i where i.house_id = h.id),
                'emails',  (select coalesce(array_agg(b.email), '{}'::text[])
                              from bucketed b where b.bucket = h.id)
              ) order by h.position, h.name
            )
       from public.houses h
      where exists (select 1 from items i where i.house_id = h.id)),
    (select coalesce(array_agg(b.email), '{}'::text[])
       from bucketed b where b.bucket is null);
end;
$$;
revoke all on function public.event_message_email(uuid) from public, anon, authenticated;
grant execute on function public.event_message_email(uuid) to service_role;

create or replace function public.event_message_preview(
  p_event_id              text,
  p_event_title           text    default null,
  p_event_when            text    default null,
  p_include_work_items    boolean default true,
  p_exclude_not_attending boolean default true,
  p_include_roster        boolean default true
)
returns table(
  sender_name        text,
  sender_email       text,
  event_id           text,
  event_title        text,
  event_when         text,
  event_start_date   date,
  event_end_date     date,
  event_emoji        text,
  event_location     text,
  event_description  text,
  mlr_items          jsonb,
  house_groups       jsonb,
  general_recipients integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_title text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_event_id), '') = '' then raise exception 'Event ID required'; end if;
  if not public.can_manage_event(p_event_id) then
    raise exception 'Only the event''s creator or an admin can email about it';
  end if;

  begin
    v_event := p_event_id::uuid;
  exception when invalid_text_representation then
    v_event := null; -- seed/synthesized event: no events row to enrich from
  end;

  select e.title into v_title from public.events e where e.id = v_event;
  v_title := coalesce(v_title, nullif(btrim(coalesce(p_event_title, '')), ''));
  if v_title is null then raise exception 'Event not found'; end if;

  return query
  -- Everything below mirrors event_message_email() exactly, reading the
  -- composer's parameters where that one reads the saved row's columns.
  with items as (
    select
      wi.house_id,
      wi.created_at,
      case wi.urgency
        when 'asap'         then 0
        when 'this_year'    then 10
        when 'custom'       then 15
        when 'next_year'    then 20
        when 'nice_to_have' then 30
        else 40
      end as rank,
      jsonb_build_object(
        'title',        wi.title,
        'notes',        wi.notes,
        'urgency',      wi.urgency,
        'customLabel',  wi.custom_label,
        'customColor',  wi.custom_color,
        'peopleNeeded', wi.people_needed
      ) as item
    from public.event_work_items ewi
    join public.work_items wi on wi.id = ewi.work_item_id
    where ewi.event_id = btrim(p_event_id)
      and wi.status <> 'done'
      and coalesce(p_include_work_items, true)
  ),
  item_houses as (
    select distinct i.house_id as hid from items i where i.house_id is not null
  ),
  recips as (
    select
      u.email::text as email,
      case when p.house_id in (select ih.hid from item_houses ih) then p.house_id end as bucket
    from public.profiles p
    join auth.users u on u.id = p.id
    where u.email is not null
      and lower(u.email) <> 'appreview@muskellungelakeresort.com'
      and (p.approved is true or p.is_admin is true)
      and p.email_alerts = true
      and not (
        coalesce(p_exclude_not_attending, true)
        and exists (
          select 1 from public.event_attendance ea
          where ea.event_id = btrim(p_event_id) and ea.user_id = p.id and ea.status = 'not_going'
        )
      )
    union all
    select
      btrim(fr.email),
      case when fr.house_id in (select ih.hid from item_houses ih) then fr.house_id end
    from public.family_roster fr
    where coalesce(p_include_roster, true)
      and fr.linked_user_id is null
      and nullif(btrim(fr.email), '') is not null
      and lower(btrim(fr.email)) <> 'appreview@muskellungelakeresort.com'
    union all
    select btrim(cr.email), null::uuid
    from public.committee_roster cr
    where coalesce(p_include_roster, true)
      and cr.linked_user_id is null
      and nullif(btrim(cr.email), '') is not null
      and lower(btrim(cr.email)) <> 'appreview@muskellungelakeresort.com'
    union all
    select btrim(ea.guest_email), null::uuid
    from public.event_attendance ea
    where ea.event_id = btrim(p_event_id)
      and nullif(btrim(ea.guest_email), '') is not null
      and lower(btrim(ea.guest_email)) <> 'appreview@muskellungelakeresort.com'
      and not (coalesce(p_exclude_not_attending, true) and ea.status = 'not_going')
  ),
  bucketed as (
    select r.email, (array_agg(r.bucket) filter (where r.bucket is not null))[1] as bucket
    from recips r
    group by r.email
  )
  select
    (select coalesce(nullif(btrim(pr.display_name), ''), 'A member')
       from public.profiles pr where pr.id = auth.uid()),
    (select u.email::text from auth.users u where u.id = auth.uid()),
    btrim(p_event_id),
    v_title,
    coalesce(
      nullif(btrim(coalesce(p_event_when, '')), ''),
      (select case
                when e.end_date is not null and e.end_date <> e.start_date
                  then to_char(e.start_date, 'FMMon FMDD') || ' – ' || to_char(e.end_date, 'FMMon FMDD, YYYY')
                else to_char(e.start_date, 'FMDay, FMMon FMDD, YYYY')
              end
         from public.events e where e.id = v_event)
    ),
    (select e.start_date from public.events e where e.id = v_event),
    (select e.end_date from public.events e where e.id = v_event),
    (select e.emoji from public.events e where e.id = v_event),
    (select e.location from public.events e where e.id = v_event),
    (select e.description from public.events e where e.id = v_event),
    (select jsonb_agg(i.item order by i.rank, i.created_at desc)
       from items i where i.house_id is null),
    (select jsonb_agg(
              jsonb_build_object(
                'houseId',    h.id,
                'name',       h.name,
                'emoji',      h.emoji,
                'items',      (select jsonb_agg(i.item order by i.rank, i.created_at desc)
                                 from items i where i.house_id = h.id),
                'recipients', (select count(*) from bucketed b where b.bucket = h.id)
              ) order by h.position, h.name
            )
       from public.houses h
      where exists (select 1 from items i where i.house_id = h.id)),
    (select count(*)::int from bucketed b where b.bucket is null);
end;
$$;
revoke all on function public.event_message_preview(text, text, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.event_message_preview(text, text, text, boolean, boolean, boolean) to authenticated;
