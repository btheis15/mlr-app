-- 0162_post_comment_media.sql
-- Photos + videos on Main Feed COMMENTS. Comments have carried text + @mentions
-- (0022) since day one but no attachments, so answering "which cabin?" with a
-- picture meant starting a whole new post. This adds the missing child table,
-- shaped exactly like post_media (0004) — one row per attachment, ordered by
-- `position`, storage_path holding the full mini URL — plus the same moderation
-- wiring post media already has.
--
-- Read RLS is MEMBERS-ONLY (auth.uid() is not null), matching what 0081's
-- lockdown did to post_media/post_comments, NOT 0004's original public-read
-- policy that 0081 superseded. Writes stay narrow: only the comment's own author
-- may attach media; the author or an admin may remove it.
--
-- Moderation (Tiers 0/2, same as a post's media):
--   • hold_comment_on_flagged_media() fires when a media row is attached and a
--     verdict for that URL already exists — the /upload path for category=posts
--     grades INLINE, so by the time the client inserts here the verdict is
--     usually already in media_moderation. It holds the parent post_comments row
--     (status 'visible' → 'pending'), which RLS then hides from everyone except
--     the author + admins, and logs to content_moderation_events with
--     entity_type='comment' — an entity type moderation_queue()/
--     set_content_status() (0128) ALREADY route to post_comments, so no change
--     is needed there.
--   • hold_content_on_media_verdict() (0128 §5b) gains a FOURTH block for
--     comments, covering the reverse race where the verdict lands after the media
--     row. Recreated from its CURRENT definition (0128) verbatim + that block —
--     see 0160's header for what happens when a trigger function is rebuilt from
--     a stale copy instead.
--   • Both set the transaction-local mlr.mod_bypass GUC before the UPDATE, so
--     moderate_content_text()'s "members can't move status by editing" pin
--     doesn't revert the automated hold (the 0128 header's latent-bug fix — these
--     triggers run as the member, not an admin).
--
-- Idempotent. Apply in the Supabase SQL editor after 0128/0160.

begin;

-- ── 1. The attachments table (mirrors post_media, 0004) ──────────────────────
create table if not exists public.post_comment_media (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.post_comments (id) on delete cascade,
  storage_path text not null,
  media_type text not null default 'image' check (media_type in ('image','video')),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists post_comment_media_comment_idx
  on public.post_comment_media (comment_id, position);
alter table public.post_comment_media enable row level security;

drop policy if exists "comment media: member read" on public.post_comment_media;
create policy "comment media: member read" on public.post_comment_media for select
  using (auth.uid() is not null);

drop policy if exists "comment media: insert on own comment" on public.post_comment_media;
create policy "comment media: insert on own comment" on public.post_comment_media for insert
  with check (exists (
    select 1 from public.post_comments c
    where c.id = comment_id and c.author_id = auth.uid()
  ));

drop policy if exists "comment media: delete own or admin" on public.post_comment_media;
create policy "comment media: delete own or admin" on public.post_comment_media for delete
  using (exists (
    select 1 from public.post_comments c
    where c.id = comment_id
      and (c.author_id = auth.uid()
           or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  ));

-- ── 2. Attach-time hold (mirrors hold_post_on_flagged_media, 0128 §5) ────────
create or replace function public.hold_comment_on_flagged_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v public.media_moderation%rowtype;
begin
  select * into v from public.media_moderation where storage_path = NEW.storage_path;
  if found and v.flagged then
    perform set_config('mlr.mod_bypass', '1', true);
    update public.post_comments set status = 'pending'
      where id = NEW.comment_id and status = 'visible';
    if FOUND then
      insert into public.content_moderation_events
        (entity_type, entity_id, action, reason, severity, actor_id)
      values
        ('comment', NEW.comment_id, 'flagged',
         'Auto-held: AI media check — ' || coalesce(v.category, 'flagged') ||
           case when coalesce(v.reason, '') <> '' then ' (' || v.reason || ')' else '' end,
         'auto', null);
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_hold_comment_on_flagged_media on public.post_comment_media;
create trigger trg_hold_comment_on_flagged_media
  after insert on public.post_comment_media
  for each row execute function public.hold_comment_on_flagged_media();

-- ── 3. Retroactive hold: add the comment branch to 0128 §5b ──────────────────
-- Recreated from the CURRENT (0128) definition verbatim, with a fourth `with
-- held as (...)` block for post_comments/post_comment_media in the same shape as
-- the posts / committee_messages / house_messages blocks.
create or replace function public.hold_content_on_media_verdict()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
begin
  if not NEW.flagged then
    return NEW;
  end if;
  v_reason := 'Auto-held: AI media check — ' || coalesce(NEW.category, 'flagged') ||
              case when coalesce(NEW.reason, '') <> '' then ' (' || NEW.reason || ')' else '' end;
  perform set_config('mlr.mod_bypass', '1', true);

  with held as (
    update public.posts p set status = 'pending'
    where p.status = 'visible'
      and exists (select 1 from public.post_media pm
                  where pm.post_id = p.id and pm.storage_path = NEW.storage_path)
    returning p.id
  )
  insert into public.content_moderation_events (entity_type, entity_id, action, reason, severity, actor_id)
  select 'post', id, 'flagged', v_reason, 'auto', null from held;

  with held as (
    update public.post_comments c set status = 'pending'
    where c.status = 'visible'
      and exists (select 1 from public.post_comment_media pcm
                  where pcm.comment_id = c.id and pcm.storage_path = NEW.storage_path)
    returning c.id
  )
  insert into public.content_moderation_events (entity_type, entity_id, action, reason, severity, actor_id)
  select 'comment', id, 'flagged', v_reason, 'auto', null from held;

  with held as (
    update public.committee_messages m set status = 'pending'
    where m.status = 'visible'
      and exists (select 1 from public.committee_message_media cm
                  where cm.message_id = m.id and cm.storage_path = NEW.storage_path)
    returning m.id
  )
  insert into public.content_moderation_events (entity_type, entity_id, action, reason, severity, actor_id)
  select 'committee_message', id, 'flagged', v_reason, 'auto', null from held;

  with held as (
    update public.house_messages m set status = 'pending'
    where m.status = 'visible'
      and exists (select 1 from public.house_message_media hm
                  where hm.message_id = m.id and hm.storage_path = NEW.storage_path)
    returning m.id
  )
  insert into public.content_moderation_events (entity_type, entity_id, action, reason, severity, actor_id)
  select 'house_message', id, 'flagged', v_reason, 'auto', null from held;

  return NEW;
end;
$$;

drop trigger if exists trg_hold_on_media_verdict on public.media_moderation;
create trigger trg_hold_on_media_verdict
  after insert or update on public.media_moderation
  for each row execute function public.hold_content_on_media_verdict();

-- Live updates
do $$ begin alter publication supabase_realtime add table public.post_comment_media; exception when duplicate_object then null; end $$;

commit;
