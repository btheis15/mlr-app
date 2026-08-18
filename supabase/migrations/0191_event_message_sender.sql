-- 0191_event_message_sender.sql
-- Name the sender inside the event email, and route replies to them.
--
-- WHY. Every email the mac mini sends goes out as ALERT_FROM — the resort's own
-- shared mailbox ("Muskellunge Lake Resort <…>") — never the clicker's personal
-- address. That's right for deliverability and privacy, but it left two gaps on
-- the 0190 event email specifically, because ANY member (not just an admin) can
-- send one:
--   1. With no note written, the email was completely unattributed. A cousin who
--      organized the work weekend was invisible, so nobody knew who to ask — and
--      since the From reads as the resort, recipients would reasonably assume it
--      came from whoever normally runs the place.
--   2. Replies went to the resort mailbox, not to that organizer, so "can't make
--      Saturday, I'll come Sunday" landed where nobody was necessarily watching.
--
-- The fix is ONE always-on attribution line ("Sent by {name}"), not a special
-- case for "someone other than the usual person sent this." Naming the sender
-- every single time IS the disclaimer, and it can't drift: there is no notion of
-- a canonical/owner sender to compare against here (lib/owner.ts's OWNER_EMAIL
-- gates the media-server restart, and wiring email copy to it would silently
-- break the day that address changes), and a line that only appears sometimes is
-- the one people learn to skip.
--
-- WHAT CHANGES: event_message_email() gains `sender_email`, so the mailer can
-- set Reply-To. The return TYPE changes, so this is a DROP + CREATE rather than
-- a create-or-replace. The body below is 0190's verbatim, plus the one new
-- column — recreated from the CURRENT production definition, per the 0160
-- blocklist lesson (a "recreate" off an older copy is exactly how an unrelated
-- prior fix gets silently dropped).
--
-- The address comes from auth.users (the verified login email), matching how
-- every other recipient address in this function is resolved. It is exposed ONLY
-- to service_role — the grant is unchanged — so it reaches the mailer and never
-- a client.
--
-- ⚠️ Needs a mac-mini `git pull` + restart (Admin → Media server) for
-- alert-mailer.js + event-email-template.js to pick it up.

drop function if exists public.event_message_email(uuid);

create function public.event_message_email(p_message uuid)
returns table(
  subject           text,
  body              text,
  sender_name       text,
  sender_email      text,
  event_id          text,
  event_title       text,
  event_when        text,
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
    union all
    select btrim(cr.email), null::uuid
    from public.committee_roster cr
    where m.include_roster
      and cr.linked_user_id is null
      and nullif(btrim(cr.email), '') is not null
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
    -- NEW: the sender's verified login address, for Reply-To. Null when the
    -- sender's account is gone (sender_id is on delete set null) — the mailer
    -- just omits the header in that case.
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
