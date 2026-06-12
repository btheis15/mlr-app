-- 0040_content_moderation.sql
-- Content safeguards for the social feed (Posts + comments): keep
-- sensitive/inappropriate/illegal content from sitting in front of the family.
--
-- Design (see docs/content-moderation.md for the whole picture, incl. the
-- on-device Apple "Tier 2" image/video/text checks that run on the Mac mini):
--
--   • Posts/comments stay POST-moderated — they still go live instantly (the
--     family "just post it" feel). What changes is that flagged content is
--     HELD FOR ADMIN REVIEW: a `status` of 'visible' | 'pending' | 'hidden'.
--     RLS hides anything not 'visible' from everyone except its author and
--     admins, so a held item drops out of the public feed but isn't destroyed.
--   • Two automatic ways an item gets held ('pending'):
--       1. a BEFORE INSERT/UPDATE trigger matches the text against an
--          admin-managed BLOCKLIST (the always-on, mini-independent "language"
--          floor — runs entirely in Postgres);
--       2. it collects REPORTS from ≥ REPORT_HIDE_THRESHOLD distinct members.
--   • Members can REPORT a post/comment (report_content); admins work a review
--     queue (moderation_queue) and approve/hide (set_content_status). Every
--     automated + manual action is written to an audit table.
--   • Length is a hard cap, enforced server-side in the same trigger.
--
-- Members can never change an item's moderation status themselves (a BEFORE
-- UPDATE guard pins it), so editing can't be used to un-hide a held post.
--
-- Apply in the Supabase SQL editor after the posts migrations (0002–0004).

-- ── Moderation status on the social tables ───────────────────────────────────
-- 'visible'  — shows in the public feed (the default; nothing changes for the
--              vast majority of posts).
-- 'pending'  — auto-held, awaiting an admin decision (hidden from the feed).
-- 'hidden'   — an admin removed it (kept for the record, reversible).
alter table public.posts
  add column if not exists status text not null default 'visible'
  check (status in ('visible', 'pending', 'hidden'));
alter table public.post_comments
  add column if not exists status text not null default 'visible'
  check (status in ('visible', 'pending', 'hidden'));

create index if not exists posts_pending_idx on public.posts (created_at desc) where status <> 'visible';
create index if not exists post_comments_pending_idx on public.post_comments (created_at desc) where status <> 'visible';

-- ── Read policies become status-aware ────────────────────────────────────────
-- Everyone reads 'visible' rows; an author still sees their own held item (so
-- they aren't confused when it vanishes — the app shows a "pending review"
-- note); admins see everything (they work the queue). Insert/delete policies
-- from 0002/0003 are unchanged.
drop policy if exists "posts: public read" on public.posts;
create policy "posts: public read" on public.posts for select using (
  status = 'visible'
  or author_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
);

drop policy if exists "comments: public read" on public.post_comments;
create policy "comments: public read" on public.post_comments for select using (
  status = 'visible'
  or author_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
);

-- ── Blocklist: the admin-managed "language" floor ────────────────────────────
-- Ships EMPTY on purpose — no slur lists baked into the repo. Admins add terms
-- in Profile → Admin → Content moderation; a match holds the post/comment for
-- review. `pattern` is matched case-insensitively as a substring (ILIKE
-- '%pattern%'). For smarter, context-aware text screening, the Foundation
-- Models layer on the mini is the upgrade (docs/content-moderation.md).
create table if not exists public.moderation_blocklist (
  id         uuid primary key default gen_random_uuid(),
  pattern    text not null unique,
  note       text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.moderation_blocklist enable row level security;
-- Admins only — the list itself is sensitive and members never need to read it.
drop policy if exists "blocklist: admin read" on public.moderation_blocklist;
create policy "blocklist: admin read" on public.moderation_blocklist for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
drop policy if exists "blocklist: admin insert" on public.moderation_blocklist;
create policy "blocklist: admin insert" on public.moderation_blocklist for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
drop policy if exists "blocklist: admin delete" on public.moderation_blocklist;
create policy "blocklist: admin delete" on public.moderation_blocklist for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ── Reports: a member flags a post/comment ───────────────────────────────────
-- One report per member per item (re-reporting just updates the reason). Only
-- admins read them; members write only via report_content() below.
create table if not exists public.content_reports (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('post', 'comment')),
  entity_id   uuid not null,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (entity_type, entity_id, reporter_id)
);
create index if not exists content_reports_entity_idx on public.content_reports (entity_type, entity_id);
alter table public.content_reports enable row level security;
drop policy if exists "reports: admin read" on public.content_reports;
create policy "reports: admin read" on public.content_reports for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ── Audit trail ──────────────────────────────────────────────────────────────
-- Polymorphic (entity_id has no FK so one table covers posts + comments, and a
-- row survives the source being deleted). Written only by the triggers/RPCs
-- below; admins read it.
create table if not exists public.content_moderation_events (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null check (action in ('flagged', 'approved', 'removed')),
  reason      text,
  severity    text,                 -- 'auto' (trigger) | 'manual' (admin)
  actor_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists content_moderation_events_entity_idx
  on public.content_moderation_events (entity_type, entity_id, created_at desc);
alter table public.content_moderation_events enable row level security;
drop policy if exists "modevents: admin read" on public.content_moderation_events;
create policy "modevents: admin read" on public.content_moderation_events for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ── The text gate: length cap + blocklist hold + status-change guard ─────────
-- Fires BEFORE INSERT OR UPDATE on posts and post_comments. One function, keyed
-- off TG_TABLE_NAME so a post (≤5000 chars) and a comment (≤2000) share it.
create or replace function public.moderate_content_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etype    text;
  v_max      int;
  v_pattern  text;
  v_is_admin boolean;
begin
  if TG_TABLE_NAME = 'posts' then
    v_etype := 'post'; v_max := 5000;
  else
    v_etype := 'comment'; v_max := 2000;
  end if;

  v_is_admin := exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin);

  -- Members can't move an item's moderation status by editing it — pin it to
  -- the old value. (Admins go through set_content_status, the only sanctioned
  -- status writer; their edits here keep whatever they set — which is also why
  -- approving a post never gets undone by the blocklist re-check below.)
  if TG_OP = 'UPDATE' and not v_is_admin and NEW.status is distinct from OLD.status then
    NEW.status := OLD.status;
  end if;

  if NEW.text is not null then
    if char_length(NEW.text) > v_max then
      raise exception 'That % is too long (max % characters).', v_etype, v_max
        using errcode = 'check_violation';
    end if;

    select pattern into v_pattern
      from public.moderation_blocklist
      where NEW.text ilike '%' || pattern || '%'
      order by char_length(pattern) desc
      limit 1;

    -- Auto-hold a fresh post or a genuinely-edited one whose new text trips the
    -- blocklist — but never on an admin's action, and never re-flag text that
    -- didn't change (so an admin's Approve sticks).
    if v_pattern is not null and NEW.status = 'visible' and not v_is_admin
       and (TG_OP = 'INSERT' or NEW.text is distinct from OLD.text) then
      NEW.status := 'pending';
      insert into public.content_moderation_events
        (entity_type, entity_id, action, reason, severity, actor_id)
      values
        (v_etype, NEW.id, 'flagged', 'Auto-held: matched a blocked term', 'auto', null);
    end if;
  end if;

  return NEW;
end;
$$;
revoke all on function public.moderate_content_text() from public, anon, authenticated;

drop trigger if exists trg_moderate_posts on public.posts;
create trigger trg_moderate_posts before insert or update on public.posts
  for each row execute function public.moderate_content_text();
drop trigger if exists trg_moderate_comments on public.post_comments;
create trigger trg_moderate_comments before insert or update on public.post_comments
  for each row execute function public.moderate_content_text();

-- ── Reports → auto-hide once enough members flag it ──────────────────────────
-- AFTER INSERT on content_reports: count distinct reporters; at the threshold,
-- hold the item (only if still visible) and log it. Conservative default of 2
-- so a single grudge can't hide content, but two independent flags do.
create or replace function public.apply_content_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_hit   boolean := false;
begin
  select count(distinct reporter_id) into v_count
    from public.content_reports
    where entity_type = NEW.entity_type and entity_id = NEW.entity_id;

  if v_count >= 2 then
    if NEW.entity_type = 'post' then
      update public.posts set status = 'pending'
        where id = NEW.entity_id and status = 'visible';
      v_hit := FOUND;
    elsif NEW.entity_type = 'comment' then
      update public.post_comments set status = 'pending'
        where id = NEW.entity_id and status = 'visible';
      v_hit := FOUND;
    end if;
    if v_hit then
      insert into public.content_moderation_events
        (entity_type, entity_id, action, reason, severity, actor_id)
      values
        (NEW.entity_type, NEW.entity_id, 'flagged',
         'Auto-held: ' || v_count || ' member reports', 'auto', null);
    end if;
  end if;

  return NEW;
end;
$$;
drop trigger if exists trg_apply_content_report on public.content_reports;
create trigger trg_apply_content_report after insert on public.content_reports
  for each row execute function public.apply_content_report();

-- ── RPC: a member reports content ────────────────────────────────────────────
create or replace function public.report_content(
  p_entity_type text,
  p_entity_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to report content.';
  end if;
  if p_entity_type not in ('post', 'comment') then
    raise exception 'Unknown content type.';
  end if;
  insert into public.content_reports (entity_type, entity_id, reporter_id, reason)
  values (p_entity_type, p_entity_id, auth.uid(), nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (entity_type, entity_id, reporter_id)
    do update set reason = excluded.reason, created_at = now();
end;
$$;
revoke all on function public.report_content(text, uuid, text) from public, anon;
grant execute on function public.report_content(text, uuid, text) to authenticated;

-- ── RPC: an admin sets a status (approve → visible, remove → hidden) ──────────
create or replace function public.set_content_status(
  p_entity_type text,
  p_entity_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  if p_status not in ('visible', 'hidden') then
    raise exception 'Status must be visible or hidden.';
  end if;
  if p_entity_type = 'post' then
    update public.posts set status = p_status where id = p_entity_id;
  elsif p_entity_type = 'comment' then
    update public.post_comments set status = p_status where id = p_entity_id;
  else
    raise exception 'Unknown content type.';
  end if;
  insert into public.content_moderation_events
    (entity_type, entity_id, action, reason, severity, actor_id)
  values
    (p_entity_type, p_entity_id,
     case when p_status = 'visible' then 'approved' else 'removed' end,
     'Admin review', 'manual', auth.uid());
end;
$$;
revoke all on function public.set_content_status(text, uuid, text) from public, anon;
grant execute on function public.set_content_status(text, uuid, text) to authenticated;

-- ── RPC: the admin review queue ──────────────────────────────────────────────
-- Everything that needs eyes: anything held ('pending') OR with ≥1 report
-- (even if still visible), newest first, posts + comments unified.
create or replace function public.moderation_queue()
returns table (
  entity_type   text,
  entity_id     uuid,
  post_id       uuid,
  author_id     uuid,
  author_name   text,
  body          text,
  status        text,
  report_count  int,
  reasons       text[],
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  return query
  with rep as (
    select cr.entity_type as et, cr.entity_id as eid,
           count(*)::int as cnt,
           array_remove(array_agg(distinct cr.reason), null) as reasons
    from public.content_reports cr
    group by cr.entity_type, cr.entity_id
  )
  select 'post'::text, p.id, p.id, p.author_id,
         coalesce(pr.display_name, 'Member'),
         left(coalesce(p.text, ''), 280), p.status,
         coalesce(r.cnt, 0), coalesce(r.reasons, '{}'::text[]), p.created_at
    from public.posts p
    left join public.profiles pr on pr.id = p.author_id
    left join rep r on r.et = 'post' and r.eid = p.id
    where p.status = 'pending' or r.cnt is not null
  union all
  select 'comment'::text, c.id, c.post_id, c.author_id,
         coalesce(pr.display_name, 'Member'),
         left(coalesce(c.text, ''), 280), c.status,
         coalesce(r.cnt, 0), coalesce(r.reasons, '{}'::text[]), c.created_at
    from public.post_comments c
    left join public.profiles pr on pr.id = c.author_id
    left join rep r on r.et = 'comment' and r.eid = c.id
    where c.status = 'pending' or r.cnt is not null
  order by created_at desc;
end;
$$;
revoke all on function public.moderation_queue() from public, anon;
grant execute on function public.moderation_queue() to authenticated;
