-- Timed chat mutes: "Mute for 1 day / 3 days / 7 days / until I turn it back
-- on" for BOTH committee/area chats and house chat (house chat had no mute at
-- all before this). A row is effectively muted when `muted` is true (the
-- existing permanent toggle) OR `muted_until` is set and still in the future
-- — a timer just auto-clears itself by going stale, no cron needed.

alter table public.committee_area_reads
  add column if not exists muted_until timestamptz;

alter table public.house_reads
  add column if not exists muted boolean not null default false,
  add column if not exists muted_until timestamptz;

-- Mute / unmute a committee/area channel, optionally until a given time
-- (null = permanent, matching the old behavior; p_muted=false always clears
-- muted_until too, so "unmute" fully resets the row).
create or replace function public.set_area_mute(cid uuid, p_area text, p_muted boolean, p_muted_until timestamptz default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.committee_area_reads (committee_id, user_id, area, muted, muted_until)
  values (cid, auth.uid(), coalesce(p_area, ''), p_muted, case when p_muted then p_muted_until else null end)
  on conflict (committee_id, user_id, area)
  do update set muted = excluded.muted, muted_until = excluded.muted_until;
$$;
revoke all on function public.set_area_mute(uuid, text, boolean, timestamptz) from public, anon;
grant execute on function public.set_area_mute(uuid, text, boolean, timestamptz) to authenticated;

-- Mute / unmute a house chat (mirrors set_area_mute; house_reads has no
-- unique-key upsert path yet since mark_house_read never needed one beyond
-- its own primary key on (house_id, user_id)).
create or replace function public.set_house_mute(hid uuid, p_muted boolean, p_muted_until timestamptz default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.house_reads (house_id, user_id, muted, muted_until)
  values (hid, auth.uid(), p_muted, case when p_muted then p_muted_until else null end)
  on conflict (house_id, user_id)
  do update set muted = excluded.muted, muted_until = excluded.muted_until;
$$;
revoke all on function public.set_house_mute(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.set_house_mute(uuid, boolean, timestamptz) to authenticated;
