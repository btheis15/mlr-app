-- 0043_media_moderation.sql
-- AI image/video moderation (Tier 2, media): hold posts whose media the
-- media-server flagged as sensitive/inappropriate, for admin review.
--
-- The Mac-mini media-server runs each uploaded photo/video through Apple's
-- models (PCC-preferred via the local `fm serve`, on-device fallback) at upload
-- time. When something looks sensitive/inappropriate it writes a verdict here
-- (service role) keyed by the media's PUBLIC URL — the exact value the app
-- stores in post_media.storage_path. The trigger below then holds the parent
-- post the moment that media is attached. Server-authoritative: the client
-- can't skip it. FAIL-OPEN: if the model is down the media-server simply writes
-- no row, so the post stays visible (the Flag-as-inappropriate reports + the
-- admin queue are the backstop).

create table if not exists public.media_moderation (
  storage_path text primary key,          -- == post_media.storage_path (full mini URL)
  flagged      boolean not null default true,
  category     text,
  reason       text,
  model        text,
  created_at   timestamptz not null default now()
);
alter table public.media_moderation enable row level security;
-- No policies → only the service role (the media-server) can read/write. The
-- trigger function is SECURITY DEFINER so it can still read regardless of RLS.

create or replace function public.hold_post_on_flagged_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v public.media_moderation%rowtype;
begin
  select * into v from public.media_moderation where storage_path = NEW.storage_path;
  if found and v.flagged then
    update public.posts set status = 'pending'
      where id = NEW.post_id and status = 'visible';
    insert into public.content_moderation_events
      (entity_type, entity_id, action, reason, severity, actor_id)
    values
      ('post', NEW.post_id, 'flagged',
       'Auto-held: AI media check — ' || coalesce(v.category, 'flagged') ||
         case when coalesce(v.reason, '') <> '' then ' (' || v.reason || ')' else '' end,
       'auto', null);
  end if;
  return NEW;
end $$;

drop trigger if exists trg_hold_post_on_flagged_media on public.post_media;
create trigger trg_hold_post_on_flagged_media
  after insert on public.post_media
  for each row execute function public.hold_post_on_flagged_media();
