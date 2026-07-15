-- 0104_cabin_review_email_toggle.sql
-- Admin can choose whether approving/denying a cabin stay also emails the
-- requester a confirmation. review_cabin_stay() grows an optional p_notify
-- (default true — unchanged behavior). When false, it pre-stamps
-- decision_email_sent_at itself, which "claims" the row the same way the
-- mini's alert-mailer does — so the mailer's atomic
-- `update ... where decision_email_sent_at is null` finds nothing to claim
-- and silently skips it. No new column, no mailer change needed.

create or replace function public.review_cabin_stay(
  p_booking uuid,
  p_approve boolean,
  p_note text default null,
  p_notify boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cabin_bookings;
  v_room_count int;
  v_name text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  select * into r from public.cabin_bookings where id = p_booking;
  if not found then raise exception 'Request not found'; end if;
  if r.status = 'cancelled' then raise exception 'That request was cancelled'; end if;

  if p_approve then
    select c.room_count, c.name into v_room_count, v_name
      from public.cabins c where c.id = r.cabin_id;
    if exists (
      select 1
      from generate_series(0, (r.check_out - r.check_in) - 1) as g(n)
      where (
        select count(b.id)
        from public.cabin_bookings b
        where b.cabin_id = r.cabin_id
          and b.status = 'approved'
          and b.id <> r.id
          and b.check_in <= r.check_in + g.n
          and b.check_out > r.check_in + g.n
      ) >= v_room_count
    ) then
      raise exception 'No rooms left in % for one or more of those nights', v_name;
    end if;
  end if;

  update public.cabin_bookings
    set status = case when p_approve then 'approved' else 'denied' end,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = nullif(btrim(coalesce(p_note, '')), ''),
        decision_email_sent_at = case when p_notify then decision_email_sent_at else now() end
    where id = p_booking;
end;
$$;
revoke all on function public.review_cabin_stay(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.review_cabin_stay(uuid, boolean, text, boolean) to authenticated;

-- Drop the old 3-arg signature so PostgREST's schema cache doesn't keep
-- resolving calls to the superseded overload.
drop function if exists public.review_cabin_stay(uuid, boolean, text);
