-- 0109_cabin_cancel_notify.sql
-- Email the requester when their cabin stay is cancelled (previously silent).
-- Mirrors the review/edit email-toggle pattern (0104/0105): cancel_cabin_stay
-- grows p_notify (default true) and claims via a new cancel_email_sent_at
-- column, so the mini's alert-mailer (a new handleCabinCancel, added
-- alongside handleCabinDecision/handleCabinEdit) can pick it up the same way.
--
-- No email when the requester cancels their OWN booking (nothing to tell
-- them) — only when someone else (an admin) cancels it on their behalf.
-- cancelled_by is stamped for the same "who did this" reason reviewed_by is.

alter table public.cabin_bookings
  add column if not exists cancelled_by uuid references public.profiles (id) on delete set null,
  add column if not exists cancel_email_sent_at timestamptz;

create or replace function public.cancel_cabin_stay(p_booking uuid, p_notify boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cabin_bookings;
begin
  select * into r from public.cabin_bookings where id = p_booking;
  if not found then raise exception 'Request not found'; end if;
  if r.user_id <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  update public.cabin_bookings
    set status = 'cancelled',
        cancelled_by = auth.uid(),
        cancel_email_sent_at = case
          when p_notify and auth.uid() <> r.user_id then null
          else now()
        end
    where id = p_booking;
end;
$$;
revoke all on function public.cancel_cabin_stay(uuid, boolean) from public, anon;
grant execute on function public.cancel_cabin_stay(uuid, boolean) to authenticated;

-- Drop the old 1-arg signature so PostgREST's schema cache doesn't keep
-- resolving calls to the superseded overload.
drop function if exists public.cancel_cabin_stay(uuid);
