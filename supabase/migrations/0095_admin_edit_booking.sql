-- 0095_admin_edit_booking.sql
-- Admins asked to adjust a request's details before approving it — e.g. a
-- member asked for 2 beds but only needs 1, or the dates shifted a day.
-- set_booking_rooms (0092) already lets an admin reassign rooms at any time;
-- this adds the other editable fields (dates, guest count, notes) via a new
-- admin-only RPC, so the whole request can be corrected in one place before
-- (or after) a decision. Capacity is still enforced where it always was — at
-- review_cabin_stay() time — so editing a pending request's dates/guests here
-- doesn't bypass any check, it just changes what gets checked at approval.

create or replace function public.admin_update_cabin_booking(
  p_booking   uuid,
  p_check_in  date,
  p_check_out date,
  p_guests    int,
  p_notes     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.cabin_bookings where id = p_booking) then
    raise exception 'Request not found';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'Check-out must be after check-in';
  end if;
  if coalesce(p_guests, 1) < 1 then
    raise exception 'At least one guest is required';
  end if;

  update public.cabin_bookings
    set check_in  = p_check_in,
        check_out = p_check_out,
        guests    = p_guests,
        notes     = nullif(btrim(coalesce(p_notes, '')), '')
    where id = p_booking;
end;
$$;
revoke all on function public.admin_update_cabin_booking(uuid, date, date, int, text) from public, anon;
grant execute on function public.admin_update_cabin_booking(uuid, date, date, int, text) to authenticated;
