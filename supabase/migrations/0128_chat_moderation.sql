-- 0128_chat_moderation.sql
-- Extend the content-moderation model (0040 text/reports, 0043 media) to CHAT —
-- committee + house messages — so flagged photos/videos and blocked text are
-- HELD FOR ADMIN REVIEW exactly like Posts, instead of appearing live in a room.
--
-- Mirrors the Posts design:
--   • status 'visible' | 'pending' | 'hidden' on committee_messages +
--     house_messages; RLS hides non-'visible' rows from everyone except the
--     author and admins (a held message drops out of the room but is kept and
--     is restorable), on top of the existing room-access gate.
--   • CHAT is OPTIMISTIC (per product decision): a message posts immediately —
--     no send-time moderation latency, assume good intent. The mini moderates
--     the uploaded photo/video ASYNCHRONOUSLY (media-server/server.js does not
--     block the /upload response for category=chat) and, if it's flagged, writes
--     a verdict to public.media_moderation a few seconds later. A trigger on
--     media_moderation then RETROACTIVELY holds any message (or post) whose media
--     matches that URL, and RLS immediately hides the held chat message from the
--     room. Media-row-insert triggers also hold at attach time, as a backstop for
--     the rare race where the verdict lands before the media row is inserted.
--     The MAIN FEED is unchanged — Posts still moderate at post time.
--   • The admin-managed blocklist text floor (moderate_content_text, 0040) now
--     also covers chat text.
--   • The admin review queue (moderation_queue) + approve/remove
--     (set_content_status) now include held chat messages.
--
-- ALSO fixes a latent bug in the EXISTING Posts path. moderate_content_text()'s
-- "members can't self-change status by editing" pin reverted the status='pending'
-- UPDATE issued by the automated hold triggers (hold_post_on_flagged_media,
-- apply_content_report) too, because those triggers run as the member
-- (auth.uid() = author, not an admin). It has never surfaced only because no
-- media had ever been flagged (media-server/moderation.js was failing open, and
-- report counts never hit the threshold). A transaction-local GUC
-- (mlr.mod_bypass) now lets the automated writers set 'pending' through the pin,
-- while a genuine member edit still can't un-hide a held item.
--
-- Idempotent. Apply in the Supabase SQL editor after 0040/0043/0063/0065.

begin;

-- ── 1. status column on the chat message tables ──────────────────────────────
alter table public.committee_messages
  add column if not exists status text not null default 'visible'
  check (status in ('visible', 'pending', 'hidden'));
alter table public.house_messages
  add column if not exists status text not null default 'visible'
  check (status in ('visible', 'pending', 'hidden'));

create index if not exists committee_messages_pending_idx
  on public.committee_messages (created_at desc) where status <> 'visible';
create index if not exists house_messages_pending_idx
  on public.house_messages (created_at desc) where status <> 'visible';

-- ── 2. Read policies become status-aware (existing access gate preserved) ─────
-- committee: keep can_access_committee_area(committee_id, area) (0063).
-- house:     keep is_house_member(house_id) (0065).
-- A held ('pending'/'hidden') message stays visible to its author + admins only,
-- so it vanishes from the room for everyone else but isn't lost.
drop policy if exists "cmsg: member read" on public.committee_messages;
create policy "cmsg: member read" on public.committee_messages for select
  using (
    public.can_access_committee_area(committee_id, area)
    and (
      status = 'visible'
      or author_id = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    )
  );

drop policy if exists "hmsg: member read" on public.house_messages;
create policy "hmsg: member read" on public.house_messages for select
  using (
    public.is_house_member(house_id)
    and (
      status = 'visible'
      or author_id = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    )
  );

-- ── 3. Text gate: extend moderate_content_text() to chat + add the GUC bypass ─
-- Recreated from 0040 with two additions: committee_messages/house_messages
-- branches, and honoring the transaction-local mlr.mod_bypass flag so the
-- automated hold triggers (section 4/5) aren't reverted by the member-edit pin.
create or replace function public.moderate_content_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etype    text;
  v_noun     text;
  v_max      int;
  v_pattern  text;
  v_is_admin boolean;
  v_bypass   boolean;
begin
  if TG_TABLE_NAME = 'posts' then
    v_etype := 'post'; v_noun := 'post'; v_max := 5000;
  elsif TG_TABLE_NAME = 'post_comments' then
    v_etype := 'comment'; v_noun := 'comment'; v_max := 2000;
  elsif TG_TABLE_NAME = 'committee_messages' then
    v_etype := 'committee_message'; v_noun := 'message'; v_max := 2000;
  elsif TG_TABLE_NAME = 'house_messages' then
    v_etype := 'house_message'; v_noun := 'message'; v_max := 2000;
  else
    v_etype := 'comment'; v_noun := 'message'; v_max := 2000;
  end if;

  v_is_admin := exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin);
  -- Automated hold triggers set this transaction-local flag before their status
  -- UPDATE, so the member-edit pin below doesn't revert an automated hold (those
  -- triggers run as the member, so v_is_admin is false for them).
  v_bypass := coalesce(current_setting('mlr.mod_bypass', true), '') = '1';

  -- Members can't move an item's moderation status by editing it — pin it to the
  -- old value. Admins (set_content_status) and the automated holds (bypass) are
  -- the only sanctioned status writers.
  if TG_OP = 'UPDATE' and not v_is_admin and not v_bypass
     and NEW.status is distinct from OLD.status then
    NEW.status := OLD.status;
  end if;

  if NEW.text is not null then
    if char_length(NEW.text) > v_max then
      raise exception 'That % is too long (max % characters).', v_noun, v_max
        using errcode = 'check_violation';
    end if;

    select pattern into v_pattern
      from public.moderation_blocklist
      where NEW.text ilike '%' || pattern || '%'
      order by char_length(pattern) desc
      limit 1;

    -- Auto-hold a fresh item or a genuinely-edited one whose new text trips the
    -- blocklist — never on an admin's action, and never re-flag unchanged text.
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

drop trigger if exists trg_moderate_committee_messages on public.committee_messages;
create trigger trg_moderate_committee_messages before insert or update on public.committee_messages
  for each row execute function public.moderate_content_text();
drop trigger if exists trg_moderate_house_messages on public.house_messages;
create trigger trg_moderate_house_messages before insert or update on public.house_messages
  for each row execute function public.moderate_content_text();

-- ── 4. Media hold: a flagged chat photo/video holds its parent message ────────
-- Mirrors 0043's hold_post_on_flagged_media, keyed by TG_TABLE_NAME so one
-- function covers both chat media tables. Sets the bypass GUC before the UPDATE
-- so the status change isn't reverted by the section-3 pin.
create or replace function public.hold_chat_message_on_flagged_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.media_moderation%rowtype;
  v_reason text;
begin
  select * into v from public.media_moderation where storage_path = NEW.storage_path;
  if found and v.flagged then
    v_reason := 'Auto-held: AI media check — ' || coalesce(v.category, 'flagged') ||
                case when coalesce(v.reason, '') <> '' then ' (' || v.reason || ')' else '' end;
    perform set_config('mlr.mod_bypass', '1', true);
    if TG_TABLE_NAME = 'committee_message_media' then
      update public.committee_messages set status = 'pending'
        where id = NEW.message_id and status = 'visible';
      if FOUND then
        insert into public.content_moderation_events
          (entity_type, entity_id, action, reason, severity, actor_id)
        values ('committee_message', NEW.message_id, 'flagged', v_reason, 'auto', null);
      end if;
    elsif TG_TABLE_NAME = 'house_message_media' then
      update public.house_messages set status = 'pending'
        where id = NEW.message_id and status = 'visible';
      if FOUND then
        insert into public.content_moderation_events
          (entity_type, entity_id, action, reason, severity, actor_id)
        values ('house_message', NEW.message_id, 'flagged', v_reason, 'auto', null);
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_hold_cmsg_on_flagged_media on public.committee_message_media;
create trigger trg_hold_cmsg_on_flagged_media after insert on public.committee_message_media
  for each row execute function public.hold_chat_message_on_flagged_media();
drop trigger if exists trg_hold_hmsg_on_flagged_media on public.house_message_media;
create trigger trg_hold_hmsg_on_flagged_media after insert on public.house_message_media
  for each row execute function public.hold_chat_message_on_flagged_media();

-- ── 5. Fix the Posts automated holds to set the bypass GUC (see header) ───────
-- Recreated from 0043/0040 verbatim EXCEPT for the added set_config() call, so
-- flagged post media + report-threshold holds actually stick now.
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
    perform set_config('mlr.mod_bypass', '1', true);
    update public.posts set status = 'pending'
      where id = NEW.post_id and status = 'visible';
    if FOUND then
      insert into public.content_moderation_events
        (entity_type, entity_id, action, reason, severity, actor_id)
      values
        ('post', NEW.post_id, 'flagged',
         'Auto-held: AI media check — ' || coalesce(v.category, 'flagged') ||
           case when coalesce(v.reason, '') <> '' then ' (' || v.reason || ')' else '' end,
         'auto', null);
    end if;
  end if;
  return NEW;
end $$;

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
    perform set_config('mlr.mod_bypass', '1', true);
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

-- ── 5b. Retroactive hold when an ASYNC verdict lands (chat's main path) ───────
-- Chat media is moderated after the message has already posted (optimistic), so
-- the verdict arrives in media_moderation AFTER the media row exists. This
-- trigger fires on that write and holds any still-visible post / committee /
-- house message whose media matches the flagged URL — RLS then hides a held chat
-- message from the room within a refetch. Fires on INSERT OR UPDATE because the
-- mini upserts (merge-duplicates). Each UPDATE is guarded on status='visible', so
-- it never double-holds or double-logs alongside the media-row-insert triggers.
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

-- ── 6. Admin queue + status setter learn the chat entity types ────────────────
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
  elsif p_entity_type = 'committee_message' then
    update public.committee_messages set status = p_status where id = p_entity_id;
  elsif p_entity_type = 'house_message' then
    update public.house_messages set status = p_status where id = p_entity_id;
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

-- Queue: add held chat messages (status='pending'). Same return signature as
-- 0040, so the client needs no shape change; the room is folded into `body` so
-- an admin sees where it came from. Chat messages carry no reports in this
-- model, so report_count=0 and they only surface via 'pending'.
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
  union all
  select 'committee_message'::text, m.id, null::uuid, m.author_id,
         coalesce(pr.display_name, 'Member'),
         left('[' || coalesce(co.name, 'Committee') || coalesce(' · ' || m.area, '') || '] '
              || coalesce(nullif(m.text, ''), '📎 attachment'), 280),
         m.status, 0, '{}'::text[], m.created_at
    from public.committee_messages m
    left join public.profiles pr on pr.id = m.author_id
    left join public.committees co on co.id = m.committee_id
    where m.status = 'pending'
  union all
  select 'house_message'::text, m.id, null::uuid, m.author_id,
         coalesce(pr.display_name, 'Member'),
         left('[' || coalesce(h.name, 'House') || '] '
              || coalesce(nullif(m.text, ''), '📎 attachment'), 280),
         m.status, 0, '{}'::text[], m.created_at
    from public.house_messages m
    left join public.profiles pr on pr.id = m.author_id
    left join public.houses h on h.id = m.house_id
    where m.status = 'pending'
  order by created_at desc;
end;
$$;
revoke all on function public.moderation_queue() from public, anon;
grant execute on function public.moderation_queue() to authenticated;

commit;
