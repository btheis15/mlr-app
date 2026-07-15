-- 0100_remove_beta_tester.sql
-- Removes the "Beta Tester" concept entirely (profiles.beta_tester, 0029). Ask
-- for Help (0037+) was the one feature actually gated by it — it's now open to
-- every signed-in member, same as everything else. Notification broadcasts lose
-- the 'beta' audience option (just 'everyone' / 'admins' remain).

-- ── request_help(): drop the beta gate, present-only requesters ─────────────
-- Same body as 0058 minus the `is_beta_tester()` check.
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

-- ── respond_to_help(): drop the beta gate (urgent-only waiver no longer needed) ─
create or replace function public.respond_to_help(
  p_request uuid,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.help_requests r where r.id = p_request and r.status = 'open') then
    raise exception 'That request is no longer open';
  end if;

  insert into public.help_responses (request_id, user_id, note)
  values (p_request, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (request_id, user_id) do nothing;
end;
$$;
revoke all on function public.respond_to_help(uuid, text) from public, anon;
grant execute on function public.respond_to_help(uuid, text) to authenticated;

-- ── claim_help_item(): drop the beta gate ────────────────────────────────────
create or replace function public.claim_help_item(p_item uuid, p_claim boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_item public.help_request_items;
  v_req  public.help_requests;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select * into v_item from public.help_request_items where id = p_item;
  if not found then raise exception 'That item is no longer on the list'; end if;
  select * into v_req from public.help_requests where id = v_item.request_id;
  if v_req.id is null then raise exception 'Request not found'; end if;
  if v_req.status <> 'open' then raise exception 'That request is no longer open'; end if;

  if p_claim then
    update public.help_request_items
      set claimed_by = v_uid, claimed_at = now()
      where id = p_item and (claimed_by is null or claimed_by = v_uid);
    if not found then
      raise exception 'Someone else is already bringing that';
    end if;
    insert into public.help_responses (request_id, user_id)
    values (v_item.request_id, v_uid)
    on conflict (request_id, user_id) do nothing;
  else
    update public.help_request_items
      set claimed_by = null, claimed_at = null
      where id = p_item and claimed_by = v_uid;
  end if;
end;
$$;
revoke all on function public.claim_help_item(uuid, boolean) from public, anon;
grant execute on function public.claim_help_item(uuid, boolean) to authenticated;

-- ── _help_recipients(): willing + present, no more beta filter ──────────────
create or replace function public._help_recipients(
  p_eligible text[],
  p_strict   text[],
  p_today    text,
  p_audience text,
  p_exclude  uuid
)
returns table (id uuid)
language sql
security definer
stable
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.willing_to_help
    and p.id <> p_exclude
    and 'help_request' = any(p.notif_types)
    and (
      p_audience = 'all_willing'
      or exists (
        select 1
        from public.event_attendance ea
        where ea.user_id = p.id
          and ea.event_id = any(p_eligible)
          and case
                when ea.event_id = any(p_strict)
                  then ((ea.days is null or ea.days = '{}'::jsonb) and ea.status = 'going')
                       or (p_today is not null and (ea.days ->> p_today) = 'going')
                  else ea.status = 'going'
                       or exists (
                         select 1 from jsonb_each_text(coalesce(ea.days, '{}'::jsonb)) d
                         where d.value = 'going'
                       )
              end
      )
      or exists (
        select 1
        from public.cabin_bookings b
        where b.user_id = p.id
          and b.status = 'approved'
          and b.check_in <= nullif(p_today, '')::date
          and b.check_out > nullif(p_today, '')::date
      )
    );
$$;
revoke all on function public._help_recipients(text[], text[], text, text, uuid) from public, anon, authenticated;

-- ── notif_on_help_request(): drop the "self-ping if beta tester" affordance ──
create or replace function public.notif_on_help_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name      text;
  v_emoji     text;
  v_title     text;
  v_body      text;
  v_scheduled boolean := NEW.needed_at > NEW.created_at + interval '20 minutes';
  v_when      text := to_char(NEW.needed_at at time zone 'America/Chicago', 'FMHH12:MI AM');
  v_urgent    boolean := NEW.category = 'urgent';
begin
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_name
    from public.profiles where id = NEW.user_id;
  v_emoji := case NEW.category
    when 'urgent'   then '🚨'
    when 'move'     then '🪵'
    when 'setup'    then '🔧'
    when 'ride'     then '🚗'
    when 'supplies' then '🛒'
    else '🙌' end;
  v_title := case when v_urgent
                  then '🚨 ' || v_name || ' needs help now'
                  else v_name || ' needs a hand ' || v_emoji end
             || case when NEW.where_text is not null then '  ·  📍 ' || NEW.where_text else '' end;
  v_body := left(NEW.description, 140)
            || case when v_scheduled then '  ·  ⏰ by ' || v_when else '' end;

  if v_urgent then
    perform public._notify(
      p.id, 'help_urgent', NEW.user_id,
      v_title, v_body, '/help-requests', 'help_request', NEW.id, NEW.expires_at)
    from public.profiles p
    where p.id <> NEW.user_id;
  else
    perform public._notify(
      r.id, 'help_request', NEW.user_id,
      v_title, v_body, '/help-requests', 'help_request', NEW.id, NEW.expires_at)
    from public._help_recipients(
      NEW.eligible_event_ids, NEW.strict_event_ids, NEW.today_key, NEW.audience, NEW.user_id
    ) r;
  end if;

  return NEW;
end;
$$;

-- ── send_broadcast_notification() / run_scheduled_broadcasts(): drop 'beta' ──
create or replace function public.send_broadcast_notification(
  p_title text,
  p_body text default null,
  p_url text default null,
  p_audience text default 'everyone',
  p_expires_at timestamptz default null,
  p_event_id text default null,
  p_exclude_not_attending boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'A title is required';
  end if;
  if p_audience not in ('everyone', 'admins') then
    raise exception 'Unknown audience';
  end if;

  insert into public.notifications
    (recipient_id, type, actor_id, title, body, url, entity_type, expires_at)
  select p.id, 'broadcast', auth.uid(), p_title, nullif(p_body, ''), nullif(p_url, ''),
         'broadcast', p_expires_at
  from public.profiles p
  where case p_audience
          when 'everyone' then true
          when 'admins'   then p.is_admin
        end
    and not (
      p_exclude_not_attending
      and p_event_id is not null
      and exists (
        select 1 from public.event_attendance ea
        where ea.event_id = p_event_id
          and ea.user_id = p.id
          and ea.status = 'not_going'
      )
    );

  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.send_broadcast_notification(text, text, text, text, timestamptz, text, boolean) from public, anon;
grant execute on function public.send_broadcast_notification(text, text, text, text, timestamptz, text, boolean) to authenticated;

create or replace function public.run_scheduled_broadcasts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.scheduled_broadcasts;
  v_expires_at timestamptz;
  v_event_id text;
  v_exclude boolean;
begin
  for r in
    select * from public.scheduled_broadcasts
    where sent_at is null and cancelled_at is null and scheduled_at <= now()
    order by scheduled_at
  loop
    begin
      v_expires_at := case
        when (r.payload->>'expiryHours') is not null
          then now() + make_interval(hours => (r.payload->>'expiryHours')::int)
        else null
      end;
      v_event_id := r.payload->>'eventId';
      v_exclude := coalesce((r.payload->>'excludeNotAttending')::boolean, false);

      if r.kind = 'announcement' then
        insert into public.announcements
          (author_id, title, body, severity, notify_email, email_audience, expires_at, event_id, exclude_not_attending)
        values (
          r.created_by,
          r.payload->>'title',
          nullif(r.payload->>'body', ''),
          'alert',
          coalesce((r.payload->>'notifyEmail')::boolean, false),
          coalesce(r.payload->>'emailAudience', 'all'),
          coalesce(v_expires_at, now() + interval '6 hours'),
          v_event_id,
          v_exclude
        );

      elsif r.kind = 'notification' then
        insert into public.notifications
          (recipient_id, type, actor_id, title, body, url, entity_type, expires_at)
        select p.id, 'broadcast', r.created_by, r.payload->>'title', nullif(r.payload->>'body', ''),
               nullif(r.payload->>'url', ''), 'broadcast', v_expires_at
        from public.profiles p
        where case coalesce(r.payload->>'audience', 'everyone')
                when 'everyone' then true
                when 'admins'   then p.is_admin
                else false
              end
          and not (
            v_exclude and v_event_id is not null
            and exists (
              select 1 from public.event_attendance ea
              where ea.event_id = v_event_id and ea.user_id = p.id and ea.status = 'not_going'
            )
          );

        if coalesce((r.payload->>'alsoBanner')::boolean, false)
           and coalesce(r.payload->>'audience', 'everyone') = 'everyone' then
          insert into public.announcements
            (author_id, title, body, severity, notify_email, expires_at, event_id, exclude_not_attending)
          values (
            r.created_by, r.payload->>'title', nullif(r.payload->>'body', ''), 'alert', false,
            coalesce(v_expires_at, now() + interval '6 hours'), v_event_id, v_exclude
          );
        end if;
      end if;

      update public.scheduled_broadcasts set sent_at = now(), error = null where id = r.id;
    exception when others then
      update public.scheduled_broadcasts set error = sqlerrm where id = r.id;
    end;
  end loop;
end;
$$;
revoke all on function public.run_scheduled_broadcasts() from public, anon, authenticated;

-- ── admin_members(): drop beta_tester from the result set ────────────────────
drop function if exists public.admin_members();
create function public.admin_members()
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  household text,
  email text,
  is_admin boolean,
  house_id uuid,
  house_name text,
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
           u.email::text, p.is_admin, p.house_id, h.name, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.houses h on h.id = p.house_id
    order by p.is_admin desc, lower(coalesce(p.display_name, u.email::text));
end;
$$;
revoke all on function public.admin_members() from public, anon;
grant execute on function public.admin_members() to authenticated;

-- ── Drop the beta-only RPC + helper + column ─────────────────────────────────
drop function if exists public.set_beta_tester(uuid, boolean);
drop function if exists public.is_beta_tester();

alter table public.profiles drop column if exists beta_tester;
