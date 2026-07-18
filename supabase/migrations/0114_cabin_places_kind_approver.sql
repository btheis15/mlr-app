-- 0114_cabin_places_kind_approver.sql
-- "Places to stay" grows from the resort's two shared cabins into a general
-- roster admins can add to at will: someone's private house with spare
-- bedrooms is now just another bookable place, distinguished by `kind`
-- ('cabin' | 'house') and — crucially — able to name its OWN approver
-- instead of defaulting to every app admin. A private house's owner is often
-- not an app admin at all, so `cabins.approver_user_id` (null = "All Admins",
-- the unchanged default) lets that one specific person review requests for
-- their own place, without granting them anything else admin-shaped.
--
-- Bedrooms + beds-per-bedroom were already modeled (cabin_rooms, 0092); "extra
-- beds outside bedrooms" reuses the existing informational cabins.bed_count
-- (0089) rather than a new column — AdminCabinDetails just relabels it once a
-- place has named bedrooms.
--
-- Everything else — booking, capacity math, confirmations, cancellation — is
-- untouched; a designated approver just gets the same review powers an app
-- admin already had, scoped to their own place(s).

-- ── 0. kind + approver columns ────────────────────────────────────────────────
alter table public.cabins
  add column if not exists kind text not null default 'cabin' check (kind in ('cabin', 'house')),
  add column if not exists approver_user_id uuid references public.profiles (id) on delete set null;

-- ── 1. Admins can now CREATE places, not just edit them ──────────────────────
drop policy if exists "cabins: admin insert" on public.cabins;
create policy "cabins: admin insert" on public.cabins for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- create_cabin(): admin-only, auto-slugs (reusing slugify() from 0112) so the
-- client never has to guess a unique slug itself, mirroring create_committee.
create or replace function public.create_cabin(
  p_name             text,
  p_kind             text default 'cabin',
  p_room_count       int  default 1,
  p_bed_count        int  default null,
  p_notes            text default null,
  p_approver_user_id uuid default null
)
returns public.cabins
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_slug text;
  v_n    int := 0;
  v_row  public.cabins;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Name required'; end if;
  if coalesce(p_kind, 'cabin') not in ('cabin', 'house') then raise exception 'Invalid kind'; end if;
  if coalesce(p_room_count, 1) < 1 then raise exception 'At least one room is required'; end if;
  if p_approver_user_id is not null
     and not exists (select 1 from public.profiles p where p.id = p_approver_user_id) then
    raise exception 'That member could not be found';
  end if;

  v_base := coalesce(nullif(public.slugify(p_name), ''), 'place');
  v_slug := v_base;
  while exists (select 1 from public.cabins where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.cabins (slug, name, kind, room_count, bed_count, notes, approver_user_id, sort_order)
  values (
    v_slug, btrim(p_name), coalesce(p_kind, 'cabin'), p_room_count, p_bed_count,
    nullif(btrim(coalesce(p_notes, '')), ''), p_approver_user_id,
    coalesce((select max(sort_order) + 1 from public.cabins), 0)
  )
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.create_cabin(text, text, int, int, text, uuid) from public, anon;
grant execute on function public.create_cabin(text, text, int, int, text, uuid) to authenticated;

-- ── 2. is_cabin_approver(): admin OR that cabin's specific designated approver
create or replace function public.is_cabin_approver(p_cabin_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    or exists (select 1 from public.cabins c where c.id = p_cabin_id and c.approver_user_id = auth.uid());
$$;
revoke all on function public.is_cabin_approver(uuid) from public, anon;
grant execute on function public.is_cabin_approver(uuid) to authenticated;

-- ── 3. cabin_bookings / cabin_booking_rooms: a place's designated approver
--       can now read (and, below, act on) its own requests, not just admins ──
drop policy if exists "cabin_bookings: own or admin read" on public.cabin_bookings;
create policy "cabin_bookings: own or admin read" on public.cabin_bookings for select
  using (
    user_id = auth.uid()
    or public.is_cabin_approver(cabin_id)
  );

drop policy if exists "cabin_booking_rooms: own or admin read" on public.cabin_booking_rooms;
create policy "cabin_booking_rooms: own or admin read" on public.cabin_booking_rooms for select
  using (
    exists (
      select 1 from public.cabin_bookings b
      where b.id = booking_id
        and (b.user_id = auth.uid() or public.is_cabin_approver(b.cabin_id))
    )
  );

-- ── 4. review_cabin_stay: admin OR that cabin's designated approver ──────────
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
  select * into r from public.cabin_bookings where id = p_booking;
  if not found then raise exception 'Request not found'; end if;
  if not public.is_cabin_approver(r.cabin_id) then
    raise exception 'Not authorized';
  end if;
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

-- ── 5. cancel_cabin_stay: requester, OR that cabin's designated approver ─────
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
  if r.user_id <> auth.uid() and not public.is_cabin_approver(r.cabin_id) then
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

-- ── 6. admin_update_cabin_booking: same widened gate ─────────────────────────
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
declare
  r public.cabin_bookings;
begin
  select * into r from public.cabin_bookings where id = p_booking;
  if not found then raise exception 'Request not found'; end if;
  if not public.is_cabin_approver(r.cabin_id) then
    raise exception 'Not authorized';
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

-- ── 7. set_booking_rooms: same widened gate ──────────────────────────────────
create or replace function public.set_booking_rooms(p_booking uuid, p_room_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cabin_bookings;
  v_bad_room text;
begin
  select * into r from public.cabin_bookings where id = p_booking;
  if not found then raise exception 'Request not found'; end if;
  if r.user_id <> auth.uid() and not public.is_cabin_approver(r.cabin_id) then
    raise exception 'Not authorized';
  end if;

  if p_room_ids is not null and array_length(p_room_ids, 1) > 0 then
    if exists (
      select 1 from unnest(p_room_ids) rid
      where not exists (select 1 from public.cabin_rooms cr where cr.id = rid and cr.cabin_id = r.cabin_id)
    ) then
      raise exception 'One of those rooms isn''t part of this cabin';
    end if;

    select rm.name into v_bad_room
    from public.cabin_rooms rm
    where rm.id = any(p_room_ids)
      and exists (
        select 1
        from public.cabin_booking_rooms cbr
        join public.cabin_bookings b on b.id = cbr.booking_id
        where cbr.room_id = rm.id
          and b.id <> r.id
          and b.status = 'approved'
          and b.check_in < r.check_out
          and b.check_out > r.check_in
      )
    limit 1;
    if v_bad_room is not null then
      raise exception '% is already booked for one or more of those nights', v_bad_room;
    end if;
  end if;

  delete from public.cabin_booking_rooms where booking_id = p_booking;
  if p_room_ids is not null and array_length(p_room_ids, 1) > 0 then
    insert into public.cabin_booking_rooms (booking_id, room_id)
    select p_booking, rid from unnest(p_room_ids) rid;
  end if;
end;
$$;
revoke all on function public.set_booking_rooms(uuid, uuid[]) from public, anon;
grant execute on function public.set_booking_rooms(uuid, uuid[]) to authenticated;

-- ── 8. notif_on_cabin_request: also tell the place's designated approver ────
-- (unchanged for a place with no approver_user_id set — admins only, as before)
create or replace function public.notif_on_cabin_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cabin    text;
  v_approver uuid;
  v_name     text;
begin
  if not NEW.request_notify then
    return NEW;
  end if;
  select name, approver_user_id into v_cabin, v_approver from public.cabins where id = NEW.cabin_id;
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_name
    from public.profiles where id = NEW.user_id;

  perform public._notify(
    p.id, 'cabin_request', NEW.user_id,
    v_name || ' requested a cabin stay',
    coalesce(v_cabin, 'A cabin') || ' · ' || to_char(NEW.check_in, 'Mon FMDD') || '–' || to_char(NEW.check_out, 'Mon FMDD'),
    '/profile', 'cabin_booking', NEW.id, null)
  from public.profiles p
  where p.is_admin;

  if v_approver is not null and not exists (select 1 from public.profiles pa where pa.id = v_approver and pa.is_admin) then
    perform public._notify(
      v_approver, 'cabin_request', NEW.user_id,
      v_name || ' requested a cabin stay',
      coalesce(v_cabin, 'A cabin') || ' · ' || to_char(NEW.check_in, 'Mon FMDD') || '–' || to_char(NEW.check_out, 'Mon FMDD'),
      '/request-stay', 'cabin_booking', NEW.id, null);
  end if;
  return NEW;
end;
$$;
