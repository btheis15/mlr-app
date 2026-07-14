-- 0087_cabin_booking_for_member.sql
-- Lets an app admin book a cabin stay ON BEHALF of another member — for the
-- family members who don't use the app themselves. request_cabin_stay() gets
-- an optional p_for_user: admins may pass another member's id (the booking is
-- then theirs, same as if they'd submitted it, and they see/cancel it the
-- normal way), non-admins may only omit it or pass their own id. booked_by
-- records which admin placed it (null for a normal self-service request) so
-- the admin queue can show "booked by" instead of implying the member did it
-- themselves.

alter table public.cabin_bookings
  add column if not exists booked_by uuid references public.profiles (id) on delete set null;

drop function if exists public.request_cabin_stay(uuid, date, date, int, text);

create or replace function public.request_cabin_stay(
  p_cabin uuid,
  p_check_in date,
  p_check_out date,
  p_guests int default 1,
  p_notes text default null,
  p_for_user uuid default null
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

  insert into public.cabin_bookings (cabin_id, user_id, check_in, check_out, guests, notes, booked_by)
  values (p_cabin, v_target, p_check_in, p_check_out, coalesce(p_guests, 1),
          nullif(btrim(coalesce(p_notes, '')), ''),
          case when v_target <> auth.uid() then auth.uid() else null end)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.request_cabin_stay(uuid, date, date, int, text, uuid) from public, anon;
grant execute on function public.request_cabin_stay(uuid, date, date, int, text, uuid) to authenticated;
