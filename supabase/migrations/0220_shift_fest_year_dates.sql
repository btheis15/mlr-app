-- 0220_shift_fest_year_dates.sql
--
-- Make the fest WINDOW carry its planned WEEK with it, in one transaction.
--
-- `fest_config.start_date`/`end_date` is the single source of truth for when a
-- fest happens — the countdown, every phase of the season model, the day
-- pickers and RSVP all derive from it (lib/festSeason.ts, lib/festYears.ts).
-- But the week's own rows carry ABSOLUTE dates: `fest_dinners.day`,
-- `fest_schedule_items.day`, and the nullable ISO `day` on the two sign-up slot
-- tables. `saveConfig()` only ever upserted the config row, so moving the window
-- left all of that behind on the dates it was entered with.
--
-- That is not a hypothetical: the family picks the week by POLL, so moving it is
-- the NORMAL case, not an edge one. When 2027 moved from Aug 1–7 to Jul 25–31,
-- all seven dinners stayed on the old week — the Dinners tab listed
-- "Sunday Dinner · Sunday, August 1" under a fest that now started July 25 —
-- and one member's day-by-day RSVP kept keys (`2027-08-01`…) that no longer
-- matched any day in the window. That last one is the quiet part: FestRsvp
-- filters your going-days against the CURRENT window, so a non-empty map of
-- out-of-window keys reads as "going, present zero days", which is worse than
-- never having picked at all.
--
-- ⚠️ THE CONFIG WRITE AND THE SHIFT ARE THE SAME TRANSACTION, on purpose. Doing
-- them as two client calls has no safe ordering: config-then-shift can leave the
-- window moved and the week stranded, and a retry then computes a delta of ZERO
-- and never repairs it — the failure becomes permanent and looks exactly like
-- the bug this migration exists to kill. Shift-then-config fails the other way,
-- moving the week under an unchanged window. So the delta is derived from the
-- OLD row inside the same statement that overwrites it, and either both land or
-- neither does.
--
-- ⚠️ THIS IS A RIGID TRANSLATION — every row moves by the same delta and
-- NOTHING IS CLAMPED to the new window. Rows belong to the `fest_year` column
-- they carry, not to the posted window: 2026 has real events on July 23–25,
-- three days BEFORE its posted start (setup days). A uniform shift preserves
-- that offset; clamping into `[start, end]` would collapse the setup days onto
-- the first day of the fest and silently destroy the shape of the week.
--
-- ⚠️ The delta comes from the START dates only. Lengthening or shortening the
-- week (moving only `end_date`) yields a shift of 0 and moves nothing — the
-- right answer, since the days already planned haven't gone anywhere.

create or replace function public.save_fest_config(
  p_year    int,
  p_name    text,
  p_tagline text,
  p_theme   text,
  p_start   date,
  p_end     date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_start     date;
  v_days           int := 0;
  v_dinners        int := 0;
  v_events         int := 0;
  v_event_slots    int := 0;
  v_activity_slots int := 0;
  v_rsvps          int := 0;
  v_actor          uuid := auth.uid();
begin
  -- Same gate as every other fest-content write (migration 0053). SECURITY
  -- DEFINER bypasses RLS, so the check has to be explicit and first.
  if not public.can_edit_fest() then
    raise exception 'Not allowed to edit Family Fest content.' using errcode = '42501';
  end if;
  if p_end < p_start then
    raise exception 'End date must be on or after the start.' using errcode = '22007';
  end if;

  -- Read the outgoing window BEFORE overwriting it — that difference is the
  -- whole input to the shift.
  select start_date into v_prev_start from public.fest_config where fest_year = p_year;

  insert into public.fest_config
    (fest_year, name, tagline, theme, start_date, end_date, updated_at, updated_by)
  values
    (p_year, p_name, p_tagline, p_theme, p_start, p_end, now(), v_actor)
  on conflict (fest_year) do update
    set name       = excluded.name,
        tagline    = excluded.tagline,
        theme      = excluded.theme,
        start_date = excluded.start_date,
        end_date   = excluded.end_date,
        updated_at = now(),
        updated_by = v_actor;

  v_days := coalesce(p_start - v_prev_start, 0);
  if v_days = 0 then
    return jsonb_build_object('shift_days', 0, 'dinners', 0, 'events', 0,
                              'event_slots', 0, 'activity_slots', 0, 'rsvps', 0);
  end if;

  update public.fest_dinners
     set day = day + v_days, updated_at = now(), updated_by = v_actor
   where fest_year = p_year;
  get diagnostics v_dinners = row_count;

  -- Anytime events (0139) carry a placeholder day the client ignores. Shifting
  -- it with the rest is harmless and keeps the column meaningful if one is ever
  -- switched back to a fixed day.
  update public.fest_schedule_items
     set day = day + v_days, updated_at = now(), updated_by = v_actor
   where fest_year = p_year;
  get diagnostics v_events = row_count;

  -- Custom sign-up slots (0136 / 0138) store `day` as nullable ISO TEXT, where
  -- null means "the event's own day" and needs no shift. The regex guard keeps a
  -- single hand-edited or malformed value from aborting the whole move — the
  -- cast would raise and take the legitimate rows down with it.
  update public.fest_schedule_slots s
     set day = ((s.day)::date + v_days)::text
   where s.day ~ '^\d{4}-\d{2}-\d{2}$'
     and exists (
       select 1 from public.fest_schedule_items i
        where i.id = s.schedule_item_id and i.fest_year = p_year);
  get diagnostics v_event_slots = row_count;

  update public.fest_activity_slots s
     set day = ((s.day)::date + v_days)::text
   where s.day ~ '^\d{4}-\d{2}-\d{2}$'
     and exists (
       select 1 from public.fest_activities a
        where a.id = s.activity_id and a.fest_year = p_year);
  get diagnostics v_activity_slots = row_count;

  -- Day-by-day RSVP. The fest is not an `events` row — it's synthesized per year
  -- from fest_config by festResortEvent() — so its attendance hangs off the
  -- well-known id `family-fest-<year>`, and `days` is a jsonb map keyed BY DATE.
  -- Keys that don't look like a date are passed through untouched rather than
  -- dropped: this is someone's RSVP, and losing a key is losing their answer.
  update public.event_attendance a
     set days = (
           select jsonb_object_agg(
                    case when e.k ~ '^\d{4}-\d{2}-\d{2}$'
                         then ((e.k)::date + v_days)::text
                         else e.k end,
                    e.v)
             from jsonb_each(a.days) as e(k, v)),
         updated_at = now()
   where a.event_id = 'family-fest-' || p_year::text
     and a.days is not null
     and jsonb_typeof(a.days) = 'object'
     and a.days <> '{}'::jsonb;
  get diagnostics v_rsvps = row_count;

  return jsonb_build_object(
    'shift_days',     v_days,
    'dinners',        v_dinners,
    'events',         v_events,
    'event_slots',    v_event_slots,
    'activity_slots', v_activity_slots,
    'rsvps',          v_rsvps);
end;
$$;

revoke all on function public.save_fest_config(int, text, text, text, date, date) from public, anon;
grant execute on function public.save_fest_config(int, text, text, text, date, date) to authenticated;

-- ── The manual repair path ────────────────────────────────────────────────────
--
-- `save_fest_config` only shifts when the START DATE CHANGES, which prevents
-- future drift but cannot repair a year that is ALREADY stranded — and a year
-- can be, because every fest planned before this migration existed had its
-- window moved without its week.
--
-- ⚠️ That state is not merely inconvenient, it is UNREACHABLE from the Planner:
-- ScheduleEditor and DinnerEditor render `days.map(...)` over the CONFIG WINDOW
-- and drop any row whose day falls outside it, so stranded rows aren't listed
-- and can't be opened. The day-RSVP maps have no admin UI at any time. Without
-- this entry point the only fix is hand-written SQL, which is not a fix an
-- organizer can perform.
--
-- Same rigid, unclamped translation as above, just with the delta supplied
-- instead of derived — deliberately NOT "snap everything into the window",
-- which would destroy the setup-day offsets described above.
create or replace function public.shift_fest_year_dates(p_year int, p_days int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dinners        int := 0;
  v_events         int := 0;
  v_event_slots    int := 0;
  v_activity_slots int := 0;
  v_rsvps          int := 0;
  v_actor          uuid := auth.uid();
begin
  if not public.can_edit_fest() then
    raise exception 'Not allowed to edit Family Fest content.' using errcode = '42501';
  end if;
  if p_days = 0 then
    return jsonb_build_object('shift_days', 0, 'dinners', 0, 'events', 0,
                              'event_slots', 0, 'activity_slots', 0, 'rsvps', 0);
  end if;

  update public.fest_dinners
     set day = day + p_days, updated_at = now(), updated_by = v_actor
   where fest_year = p_year;
  get diagnostics v_dinners = row_count;

  update public.fest_schedule_items
     set day = day + p_days, updated_at = now(), updated_by = v_actor
   where fest_year = p_year;
  get diagnostics v_events = row_count;

  update public.fest_schedule_slots s
     set day = ((s.day)::date + p_days)::text
   where s.day ~ '^\d{4}-\d{2}-\d{2}$'
     and exists (
       select 1 from public.fest_schedule_items i
        where i.id = s.schedule_item_id and i.fest_year = p_year);
  get diagnostics v_event_slots = row_count;

  update public.fest_activity_slots s
     set day = ((s.day)::date + p_days)::text
   where s.day ~ '^\d{4}-\d{2}-\d{2}$'
     and exists (
       select 1 from public.fest_activities a
        where a.id = s.activity_id and a.fest_year = p_year);
  get diagnostics v_activity_slots = row_count;

  update public.event_attendance a
     set days = (
           select jsonb_object_agg(
                    case when e.k ~ '^\d{4}-\d{2}-\d{2}$'
                         then ((e.k)::date + p_days)::text
                         else e.k end,
                    e.v)
             from jsonb_each(a.days) as e(k, v)),
         updated_at = now()
   where a.event_id = 'family-fest-' || p_year::text
     and a.days is not null
     and jsonb_typeof(a.days) = 'object'
     and a.days <> '{}'::jsonb;
  get diagnostics v_rsvps = row_count;

  return jsonb_build_object(
    'shift_days',     p_days,
    'dinners',        v_dinners,
    'events',         v_events,
    'event_slots',    v_event_slots,
    'activity_slots', v_activity_slots,
    'rsvps',          v_rsvps);
end;
$$;

revoke all on function public.shift_fest_year_dates(int, int) from public, anon;
grant execute on function public.shift_fest_year_dates(int, int) to authenticated;
