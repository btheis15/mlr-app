-- 0171_drop_boxes.sql
-- Drop boxes — a shared "just dump the photos/videos here and everyone sees
-- them" folder, the app's account-free alternative to a Google Drive shared
-- folder. Any signed-in member can open a box, add as many photos/videos as
-- they want, and browse everything anyone else dropped in. The media itself
-- lives on the Mac-mini media server (no cloud-storage cap — see
-- media-server/server.js, category "dropbox"); these tables just hold the box +
-- an ordered list of what's in it.
--
-- Access model (chosen with the owner): members-only, like every other private
-- surface since 0081 — "have the app = you're in". No public/link-token access;
-- the shareable link is an in-app deep link (/drop/<id>) that opens for any
-- signed-in member and prompts sign-in for a guest. So every upload is
-- attributed and runs through the same Tier-2 AI moderation as a Feed post.
--
-- Same doctrine as polls (0084) / private activities (0150): members-only
-- reads, all writes through SECURITY DEFINER RPCs, realtime-enabled.

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists public.drop_boxes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  emoji       text,
  created_by  uuid not null references public.profiles(id) default auth.uid(),
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.drop_box_media (
  id           uuid primary key default gen_random_uuid(),
  box_id       uuid not null references public.drop_boxes(id) on delete cascade,
  storage_path text not null,                 -- full mini URL (== the /f/… link)
  media_type   text not null check (media_type in ('image', 'video')),
  -- Moderation status, mirroring posts (0040): a flagged upload is held for
  -- admin review — visible only to its uploader + admins until approved.
  status       text not null default 'visible' check (status in ('visible', 'pending', 'hidden')),
  uploaded_by  uuid not null references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create index if not exists drop_box_media_box_idx
  on public.drop_box_media (box_id, created_at desc);

alter table public.drop_boxes enable row level security;
alter table public.drop_box_media enable row level security;

-- ── Read policies (members-only; status-aware for media) ─────────────────────

-- Any signed-in member can see the boxes.
drop policy if exists drop_boxes_read on public.drop_boxes;
create policy drop_boxes_read on public.drop_boxes
  for select using (auth.uid() is not null);

-- Media: everyone (signed-in) sees `visible`; a held item is visible only to
-- whoever uploaded it and to admins, so a flagged upload drops out of the box
-- for the family without being destroyed (same shape as posts' RLS).
drop policy if exists drop_box_media_read on public.drop_box_media;
create policy drop_box_media_read on public.drop_box_media
  for select using (
    auth.uid() is not null
    and (
      status = 'visible'
      or uploaded_by = auth.uid()
      or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin)
    )
  );

-- No write policies at all — every write goes through the SECURITY DEFINER RPCs
-- below (which run as the owner and bypass RLS), so direct table writes stay
-- denied for anon and authenticated alike.

-- ── Moderation hold (mirrors 0043's hold_post_on_flagged_media) ──────────────
-- The media server records a verdict in media_moderation (keyed by the public
-- URL) at upload time, BEFORE it responds — so by the time the client calls
-- add_drop_box_media the verdict already exists. A BEFORE INSERT trigger reads
-- it and holds the new row itself (it IS the content, so there's no parent to
-- hold). Server-authoritative: the client can't skip it. FAIL-OPEN: no verdict
-- row ⇒ stays visible.
create or replace function public.hold_drop_box_media_on_flagged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v public.media_moderation%rowtype;
begin
  select * into v from public.media_moderation where storage_path = NEW.storage_path;
  if found and v.flagged then
    NEW.status := 'pending';
    insert into public.content_moderation_events
      (entity_type, entity_id, action, reason, severity, actor_id)
      values ('drop_box_media', NEW.id, 'flagged', coalesce(v.reason, 'flagged media'), 'high', null);
  end if;
  return NEW;
end;
$$;

drop trigger if exists drop_box_media_hold on public.drop_box_media;
create trigger drop_box_media_hold
  before insert on public.drop_box_media
  for each row execute function public.hold_drop_box_media_on_flagged();

-- ── Write RPCs ───────────────────────────────────────────────────────────────

-- Create a box — any signed-in member (the polls/work-items doctrine).
create or replace function public.create_drop_box(p_title text, p_emoji text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'A name is required.'; end if;
  insert into public.drop_boxes (title, emoji, created_by)
    values (btrim(p_title), nullif(btrim(coalesce(p_emoji, '')), ''), auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

-- Rename / re-emoji a box — creator or admin.
create or replace function public.update_drop_box(p_box uuid, p_title text default null, p_emoji text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.drop_boxes b
    where b.id = p_box
      and (b.created_by = auth.uid()
           or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin))
  ) then raise exception 'Not allowed.'; end if;
  update public.drop_boxes set
    title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
    emoji = case when p_emoji is null then emoji else nullif(btrim(p_emoji), '') end
  where id = p_box;
end;
$$;

-- Archive / unarchive — creator or admin. Tucks a finished box out of the list
-- without destroying its media (same "delete is an archive" idiom as committees).
create or replace function public.set_drop_box_archived(p_box uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.drop_boxes b
    where b.id = p_box
      and (b.created_by = auth.uid()
           or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin))
  ) then raise exception 'Not allowed.'; end if;
  update public.drop_boxes set archived_at = case when p_archived then now() else null end
  where id = p_box;
end;
$$;

-- Delete a box outright (cascades its media rows) — creator or admin. The files
-- on the mini's disk are left as harmless orphans (no cloud bill to reclaim).
create or replace function public.delete_drop_box(p_box uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.drop_boxes b
    where b.id = p_box
      and (b.created_by = auth.uid()
           or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin))
  ) then raise exception 'Not allowed.'; end if;
  delete from public.drop_boxes where id = p_box;
end;
$$;

-- Add one uploaded file to a box — any signed-in member. The URL must already
-- have been uploaded to the mini (category=dropbox). The BEFORE INSERT trigger
-- holds it if the mini flagged it.
create or replace function public.add_drop_box_media(p_box uuid, p_url text, p_type text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  if p_type not in ('image', 'video') then raise exception 'Unsupported media type.'; end if;
  if not exists (select 1 from public.drop_boxes b where b.id = p_box and b.archived_at is null) then
    raise exception 'That folder is not available.';
  end if;
  insert into public.drop_box_media (box_id, storage_path, media_type, uploaded_by)
    values (p_box, p_url, p_type, auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

-- Remove one item — its uploader, the box's creator, or an admin.
create or replace function public.remove_drop_box_media(p_media uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.drop_box_media m join public.drop_boxes b on b.id = m.box_id
    where m.id = p_media
      and (m.uploaded_by = auth.uid()
           or b.created_by = auth.uid()
           or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin))
  ) then raise exception 'Not allowed.'; end if;
  delete from public.drop_box_media where id = p_media;
end;
$$;

-- Approve (un-hold) or hide a held item — admin only. Lets an admin release a
-- false-positive from the review state, or hide something a member reported,
-- right from the box (drop_box_media isn't wired into the /admin Content review
-- queue).
create or replace function public.set_drop_box_media_status(p_media uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'Admins only.';
  end if;
  if p_status not in ('visible', 'pending', 'hidden') then raise exception 'Bad status.'; end if;
  update public.drop_box_media set status = p_status where id = p_media;
end;
$$;

grant execute on function public.create_drop_box(text, text) to authenticated;
grant execute on function public.update_drop_box(uuid, text, text) to authenticated;
grant execute on function public.set_drop_box_archived(uuid, boolean) to authenticated;
grant execute on function public.delete_drop_box(uuid) to authenticated;
grant execute on function public.add_drop_box_media(uuid, text, text) to authenticated;
grant execute on function public.remove_drop_box_media(uuid) to authenticated;
grant execute on function public.set_drop_box_media_status(uuid, text) to authenticated;

-- Realtime so a photo someone else drops appears live in the open box.
alter publication supabase_realtime add table public.drop_boxes;
alter publication supabase_realtime add table public.drop_box_media;
