-- 0108_cabin_request_notify_toggle.sql
-- Lets a booking be created without notifying admins — for testing the
-- request flow (e.g. sending yourself a real booking-confirmation email)
-- without spamming every other admin's Activity feed + phone. Mirrors
-- 0104's review_cabin_stay p_notify (default true — unchanged behavior).
--
-- Unlike 0104's decision-email flag, admin notification here isn't a
-- claim-a-row-later thing — notif_on_cabin_request fires synchronously in
-- the same INSERT — so this needs a real column the trigger (and the mini's
-- push-sender) can check at fire time, not a pre-stamp trick.

alter table public.cabin_bookings
  add column if not exists request_notify boolean not null default true;

create or replace function public.request_cabin_stay(
  p_cabin uuid,
  p_check_in date,
  p_check_out date,
  p_guests int default 1,
  p_notes text default null,
  p_for_user uuid default null,
  p_notify boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_target uuid;
  v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select p.is_admin into v_is_admin from public.profiles p where p.id = auth.uid();

  v_target := coalesce(p_for_user, auth.uid());
  if v_target <> auth.uid() and not coalesce(v_is_admin, false) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_target) then
    raise exception 'That member could not be found';
  end if;

  if not exists (select 1 from public.cabins c where c.id = p_cabin and c.active) then
    raise exception 'That cabin is not available';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'Check-out must be after check-in';
  end if;
  if coalesce(p_guests, 1) < 1 then
    raise exception 'At least one guest is required';
  end if;

  insert into public.cabin_bookings (cabin_id, user_id, check_in, check_out, guests, notes, booked_by, request_notify)
  values (p_cabin, v_target, p_check_in, p_check_out, coalesce(p_guests, 1),
          nullif(btrim(coalesce(p_notes, '')), ''),
          case when v_target <> auth.uid() then auth.uid() else null end,
          coalesce(p_notify, true))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.request_cabin_stay(uuid, date, date, int, text, uuid, boolean) from public, anon;
grant execute on function public.request_cabin_stay(uuid, date, date, int, text, uuid, boolean) to authenticated;

-- Drop the old 6-arg signature so PostgREST's schema cache doesn't keep
-- resolving calls to the superseded overload.
drop function if exists public.request_cabin_stay(uuid, date, date, int, text, uuid);

-- Admin-request notify trigger: skip entirely when the booking was created
-- with request_notify = false.
create or replace function public.notif_on_cabin_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cabin text;
  v_name  text;
begin
  if not NEW.request_notify then
    return NEW;
  end if;
  select name into v_cabin from public.cabins where id = NEW.cabin_id;
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_name
    from public.profiles where id = NEW.user_id;
  perform public._notify(
    p.id, 'cabin_request', NEW.user_id,
    v_name || ' requested a cabin stay',
    coalesce(v_cabin, 'A cabin') || ' · ' || to_char(NEW.check_in, 'Mon FMDD') || '–' || to_char(NEW.check_out, 'Mon FMDD'),
    '/profile', 'cabin_booking', NEW.id, null)
  from public.profiles p
  where p.is_admin;
  return NEW;
end;
$$;
