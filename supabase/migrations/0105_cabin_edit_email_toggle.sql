-- 0105_cabin_edit_email_toggle.sql
-- Admins editing a booking's dates/guests/notes (admin_update_cabin_booking,
-- 0095) can now optionally email the requester about the change — e.g. "we
-- moved your dates" or "trimmed it to 1 bed" — separate from the approve/deny
-- confirmation email (0104). Off by default: most edits are small corrections
-- that don't need a notice, and this is a NEW email a requester has never
-- gotten before, unlike the decision email they already expect.
--
-- Mirrors the decision-email claim pattern rather than reusing
-- decision_email_sent_at, since an edit isn't a status change and can happen
-- any number of times (each edit should be able to send its own notice):
--   edit_notify_requested_at — stamped to now() by admin_update_cabin_booking
--     when the admin opts in; null otherwise (no email wanted).
--   edit_email_sent_at        — the mini's alert-mailer claims a request
--     atomically by advancing this to match edit_notify_requested_at, so a
--     request is never emailed twice and an untouched booking is never
--     emailed at all.

alter table public.cabin_bookings
  add column if not exists edit_notify_requested_at timestamptz,
  add column if not exists edit_email_sent_at timestamptz;

create or replace function public.admin_update_cabin_booking(
  p_booking   uuid,
  p_check_in  date,
  p_check_out date,
  p_guests    int,
  p_notes     text default null,
  p_notify    boolean default false
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
        notes     = nullif(btrim(coalesce(p_notes, '')), ''),
        edit_notify_requested_at = case when p_notify then now() else edit_notify_requested_at end
    where id = p_booking;
end;
$$;
revoke all on function public.admin_update_cabin_booking(uuid, date, date, int, text, boolean) from public, anon;
grant execute on function public.admin_update_cabin_booking(uuid, date, date, int, text, boolean) to authenticated;

drop function if exists public.admin_update_cabin_booking(uuid, date, date, int, text);
