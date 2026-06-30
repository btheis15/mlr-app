-- Link an Ask-for-Help request to a Work Checklist task, and schedule a follow-up
-- "did this get done?" nudge for the requester. The Mac-mini cron sends the push
-- at followup_at — but ONLY if the linked work item is still open (checking it
-- off beforehand cancels the nudge). Answering "Mark done" checks the task off.
--
-- Extends the current request_help() (migration 0046, which has p_items) with two
-- optional trailing params; everything else is unchanged.

alter table public.help_requests
  add column if not exists work_item_id  uuid references public.work_items (id) on delete set null,
  add column if not exists followup_at   timestamptz,
  add column if not exists followup_sent boolean not null default false;

create index if not exists help_requests_followup_idx
  on public.help_requests (followup_at)
  where work_item_id is not null and followup_sent = false;

create or replace function public.request_help(
  p_description  text,
  p_category     text default null,
  p_where_text   text default null,
  p_lat          double precision default null,
  p_lng          double precision default null,
  p_needed_at    timestamptz default null,
  p_needed_count int default 1,
  p_audience     text default 'present',
  p_eligible     text[] default '{}',
  p_strict       text[] default '{}',
  p_today        text default null,
  p_expires_at   timestamptz default null,
  p_items        text[] default '{}',
  p_work_item_id uuid default null,
  p_followup_at  timestamptz default null
)
returns table (id uuid, notified int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   text := nullif(btrim(coalesce(p_today, '')), '');
  v_needed  timestamptz := coalesce(p_needed_at, now());
  v_cat     text := nullif(btrim(coalesce(p_category, '')), '');
  v_expires timestamptz;
  v_present boolean;
  v_id      uuid;
  v_count   int;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if not public.is_beta_tester() then raise exception 'Ask for Help is in beta'; end if;
  if coalesce(btrim(p_description), '') = '' then
    raise exception 'Please describe what you need help with';
  end if;
  if v_today is null then raise exception 'Your device''s date is missing — please refresh and try again.'; end if;
  if p_audience not in ('present', 'all_willing') then raise exception 'Unknown audience'; end if;

  if (select count(*) from public.help_requests where user_id = v_uid and status = 'open') >= 10 then
    raise exception 'You have several open requests already — resolve or cancel some first.';
  end if;

  v_present :=
    exists (
      select 1 from public.event_attendance ea
      where ea.user_id = v_uid
        and ea.event_id = any(coalesce(p_eligible, '{}'))
        and case
              when ea.event_id = any(coalesce(p_strict, '{}'))
                then ((ea.days is null or ea.days = '{}'::jsonb) and ea.status = 'going')
                     or (v_today is not null and (ea.days ->> v_today) = 'going')
              else ea.status = 'going'
                   or exists (select 1 from jsonb_each_text(coalesce(ea.days, '{}'::jsonb)) d where d.value = 'going')
            end
    )
    or exists (
      select 1 from public.cabin_bookings b
      where b.user_id = v_uid and b.status = 'approved'
        and b.check_in <= v_today::date and b.check_out > v_today::date
    );
  if not v_present
     and not exists (select 1 from public.profiles p where p.id = v_uid and p.is_admin) then
    raise exception 'You can ask for help once you''re at the resort — RSVP "going" to a current event first.';
  end if;

  v_expires := coalesce(p_expires_at, greatest(now(), v_needed) + interval '6 hours');

  insert into public.help_requests (
    user_id, description, category, where_text, lat, lng, needed_at, needed_count,
    audience, eligible_event_ids, strict_event_ids, today_key, expires_at,
    work_item_id, followup_at
  ) values (
    v_uid,
    btrim(p_description),
    v_cat,
    nullif(btrim(coalesce(p_where_text, '')), ''),
    p_lat, p_lng, v_needed, greatest(1, coalesce(p_needed_count, 1)),
    p_audience, coalesce(p_eligible, '{}'), coalesce(p_strict, '{}'), v_today, v_expires,
    p_work_item_id, p_followup_at
  )
  returning help_requests.id into v_id;

  insert into public.help_request_items (request_id, label, position)
  select v_id, btrim(t.label), (t.ord - 1)::int
  from unnest(coalesce(p_items, '{}')) with ordinality as t(label, ord)
  where btrim(coalesce(t.label, '')) <> '';

  if v_cat = 'urgent' then
    select count(*) into v_count
    from public.profiles p
    where p.id <> v_uid and 'help_urgent' = any(p.notif_types);
  else
    select count(*) into v_count
    from public._help_recipients(coalesce(p_eligible, '{}'), coalesce(p_strict, '{}'), v_today, p_audience, v_uid);
  end if;

  update public.help_requests set notified_count = v_count where help_requests.id = v_id;

  return query select v_id, v_count;
end;
$$;

grant execute on function public.request_help(text, text, text, double precision, double precision, timestamptz, int, text, text[], text[], text, timestamptz, text[], uuid, timestamptz) to authenticated;
