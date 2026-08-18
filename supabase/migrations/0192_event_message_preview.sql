-- 0192_event_message_preview.sql
-- See the exact email before sending it.
--
-- WHY A DB FUNCTION AND NOT CLIENT-SIDE ASSEMBLY. The sender needs to review
-- what will actually go out, and "what goes out" is decided by SQL: which items
-- are open, how they're ranked, and — the part no client can reproduce — how
-- people are bucketed into the per-house versions (0190). A house-scoped item is
-- RLS-invisible to a non-member, so a client building its own preview would show
-- a DIFFERENT email than the one that sends, which is worse than no preview.
-- This is a dry run of the same query the mailer's event_message_email() runs.
--
-- Deliberately returns NO email addresses — only per-bucket recipient COUNTS.
-- The preview answers "what does it say and who broadly gets it", not "here is
-- everyone's address", so this stays safe to expose to a member caller (the
-- mailer's own function remains service_role-only).
--
-- Takes the composer's un-saved inputs rather than a message id, since at
-- preview time no event_messages row exists yet. Gated on can_manage_event()
-- (0190) — the same admin-or-creator rule as sending.
--
-- The web app renders these rows through the SAME buildEventEmail() the mailer
-- calls (media-server/event-email-template.js, imported via allowJs + the @/*
-- alias), so the preview cannot drift from the send. Don't fork a second layout.

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
  event_emoji        text,
  event_location     text,
  event_description  text,
  mlr_items          jsonb,
  -- Same shape as event_message_email()'s house_groups, minus `emails`; each
  -- carries `recipients` (a count) instead.
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
    union all
    select btrim(cr.email), null::uuid
    from public.committee_roster cr
    where coalesce(p_include_roster, true)
      and cr.linked_user_id is null
      and nullif(btrim(cr.email), '') is not null
  ),
  bucketed as (
    select r.email, (array_agg(r.bucket) filter (where r.bucket is not null))[1] as bucket
    from recips r
    group by r.email
  )
  select
    (select coalesce(nullif(btrim(pr.display_name), ''), 'A member')
       from public.profiles pr where pr.id = auth.uid()),
    -- The caller's OWN address, so the preview's byline + reply line match the
    -- real send. Not a disclosure: it's their own email.
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
