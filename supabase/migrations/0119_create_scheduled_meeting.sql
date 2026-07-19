-- 0119_create_scheduled_meeting.sql
-- A second way to make a meeting (migration 0116): skip the propose-times/voting
-- step and just SET a meeting at a single known time. Same feature, same tables —
-- this RPC inserts the meeting with one slot and immediately finalizes it to that
-- time (reusing finalize_meeting), so it lands as 'scheduled' with exactly the
-- same downstream behavior as picking a winning slot after a vote: it posts the
-- "📅 Meeting set" message into the room, fans out the meeting_scheduled
-- notification/push, and (if a Meet link is given) triggers the confirmation
-- email via the mailer's UPDATE→scheduled watch (0118). No meeting_proposed /
-- voting ever happens. Organizer gate is the same (can_organize_meeting).
--
-- Apply in the Supabase SQL editor after 0118.

create or replace function public.create_scheduled_meeting(
  p_scope        text,
  p_committee_id uuid,
  p_area         text,
  p_house_id     uuid,
  p_title        text,
  p_description  text,
  p_starts_at    timestamptz,
  p_duration_min int default 60,
  p_meet_url     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_slot  uuid;
  v_slug  text;
  v_title text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_scope not in ('committee', 'house') then raise exception 'Invalid scope'; end if;
  if not public.can_organize_meeting(p_scope, p_committee_id, p_area, p_house_id) then
    raise exception 'Not authorized';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then raise exception 'A title is required'; end if;
  if length(v_title) > 200 then raise exception 'Keep the title under 200 characters'; end if;
  if p_starts_at is null then raise exception 'A date & time is required'; end if;

  if p_scope = 'committee' then
    select slug into v_slug from public.committees where id = p_committee_id;
    if v_slug is null then raise exception 'Committee not found'; end if;
  end if;

  insert into public.meetings
    (scope_type, committee_id, committee_slug, area, house_id, title, description, created_by)
  values
    (p_scope, p_committee_id, v_slug, p_area, p_house_id, v_title,
     nullif(btrim(coalesce(p_description, '')), ''), auth.uid())
  returning id into v_id;

  insert into public.meeting_slots (meeting_id, starts_at, duration_min, position)
  values (v_id, p_starts_at, coalesce(p_duration_min, 60), 0)
  returning id into v_slot;

  -- Reuse the exact "a time was chosen" path: marks it scheduled, posts the
  -- room message, fans out meeting_scheduled, and (with a link) the confirmation
  -- email fires off the resulting status→scheduled UPDATE.
  perform public.finalize_meeting(v_id, v_slot, p_meet_url);

  return v_id;
end;
$$;
revoke all on function public.create_scheduled_meeting(text, uuid, text, uuid, text, text, timestamptz, int, text) from public, anon;
grant execute on function public.create_scheduled_meeting(text, uuid, text, uuid, text, text, timestamptz, int, text) to authenticated;
