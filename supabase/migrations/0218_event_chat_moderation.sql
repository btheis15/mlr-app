-- 0218_event_chat_moderation.sql
-- Bring EVENT CHAT (0216/0217) into the moderation model, closing the gap 0216
-- shipped with: the `status` column and the admin-can-read-held RLS existed, but
-- no trigger ever set that status and no admin surface could act on it — so a
-- blocklisted word or a flagged photo in an event chat was never held at all.
--
-- ⚠️⚠️ EVERY FUNCTION HERE IS RECREATED FROM ITS **CURRENT PRODUCTION BODY**,
-- with the event-chat branch as the ONLY change. That is the 0160 rule, and it
-- exists because a "recreate" from an older migration's copy silently dropped an
-- unrelated fix once already (0128 reverted 0044's whole-word blocklist matching
-- and nothing could detect it). Sources verified against the migration history:
--   moderate_content_text            → 0160  (whole-word matching + mod_bypass)
--   hold_chat_message_on_flagged_media → 0128
--   hold_content_on_media_verdict    → 0162  (has the post_comment_media block)
--   moderation_queue                 → 0128
--   set_content_status               → 0128
--
-- ⚠️ Doing the HOLDS without the QUEUE would be worse than doing nothing: a held
-- message drops out of the room and, with no queue entry and no admin read path,
-- could never be approved or removed again. All five change together.
--
-- ── How this coexists with an admin-blind room ──────────────────────────────
-- Event chats have no app-admin override (0216) — an admin who isn't going can't
-- read the room. Moderation still works because the RLS select policy admits an
-- admin to a message ONLY while `status <> 'visible'`, and `moderation_queue()`
-- is SECURITY DEFINER so it reads the held text regardless. The net effect is
-- exactly the intent: an admin sees the item they must rule on and never the
-- conversation around it.
--
-- ── Entity type ─────────────────────────────────────────────────────────────
-- `'event_chat_message'`. ⚠️ Without a branch in moderate_content_text, its
-- `else` fallback would have filed these under `'comment'` — pointing
-- content_moderation_events and the queue at post_comments rows that don't
-- exist, i.e. silently corrupting the audit trail rather than failing loudly.

-- ── 1. Text: length cap + blocklist floor ───────────────────────────────────
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
  elsif TG_TABLE_NAME = 'event_chat_messages' then
    v_etype := 'event_chat_message'; v_noun := 'message'; v_max := 2000;
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

    -- Whole-word match for single-word terms; substring for multi-word phrases
    -- (restored from 0044 — 0128 had regressed this back to plain substring).
    select b.pattern into v_pattern
      from public.moderation_blocklist b
      where
        ( position(' ' in b.pattern) > 0
          and lower(NEW.text) like '%' || lower(b.pattern) || '%' )
        or
        ( position(' ' in b.pattern) = 0
          and lower(b.pattern) = any(
            string_to_array(regexp_replace(lower(NEW.text), '[^a-z0-9]+', ' ', 'g'), ' ')
          ) )
      order by char_length(b.pattern) desc
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

drop trigger if exists trg_moderate_event_chat_messages on public.event_chat_messages;
create trigger trg_moderate_event_chat_messages before insert or update on public.event_chat_messages
  for each row execute function public.moderate_content_text();

-- ── 2. Media, at attach time (the backstop) ─────────────────────────────────
-- Recreated from 0128 with a third TG_TABLE_NAME branch.
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
    elsif TG_TABLE_NAME = 'event_chat_message_media' then
      update public.event_chat_messages set status = 'pending'
        where id = NEW.message_id and status = 'visible';
      if FOUND then
        insert into public.content_moderation_events
          (entity_type, entity_id, action, reason, severity, actor_id)
        values ('event_chat_message', NEW.message_id, 'flagged', v_reason, 'auto', null);
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_hold_ecmsg_on_flagged_media on public.event_chat_message_media;
create trigger trg_hold_ecmsg_on_flagged_media after insert on public.event_chat_message_media
  for each row execute function public.hold_chat_message_on_flagged_media();

-- ── 3. Media, retroactively (the main path) ─────────────────────────────────
-- Chat uploads are moderated ASYNCHRONOUSLY (the mini doesn't block /upload), so
-- the verdict usually lands AFTER the media row exists — this is the trigger that
-- actually holds an event-chat photo. Recreated from 0162.
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

  with held as (
    update public.event_chat_messages m set status = 'pending'
    where m.status = 'visible'
      and exists (select 1 from public.event_chat_message_media em
                  where em.message_id = m.id and em.storage_path = NEW.storage_path)
    returning m.id
  )
  insert into public.content_moderation_events (entity_type, entity_id, action, reason, severity, actor_id)
  select 'event_chat_message', id, 'flagged', v_reason, 'auto', null from held;

  return NEW;
end;
$$;

-- ── 4. The admin review queue ───────────────────────────────────────────────
-- Recreated from 0128 with a fifth UNION arm. Return type unchanged, so no DROP.
-- ⚠️ Chat arms filter on `status = 'pending'` only (never a report count) —
-- report_content still accepts posts/comments only, so a chat message has no
-- reports to join. That's pre-existing for committee/house chat too; widening
-- reporting to chat is its own change.
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
  union all
  -- Event chat. Labelled with the event's title so an admin knows which room it
  -- came from without being able to open that room.
  select 'event_chat_message'::text, m.id, null::uuid, m.author_id,
         coalesce(pr.display_name, 'Member'),
         left('[' || coalesce(e.title, 'Event') || '] '
              || coalesce(nullif(m.text, ''), '📎 attachment'), 280),
         m.status, 0, '{}'::text[], m.created_at
    from public.event_chat_messages m
    left join public.profiles pr on pr.id = m.author_id
    left join public.events e on e.id::text = m.event_id
    where m.status = 'pending'
  order by created_at desc;
end;
$$;
revoke all on function public.moderation_queue() from public, anon;
grant execute on function public.moderation_queue() to authenticated;

-- ── 5. Approve / remove ─────────────────────────────────────────────────────
-- Recreated from 0128 with a fifth branch. Without it, an admin acting on a held
-- event-chat message would hit "Unknown content type" — the stranded-message
-- failure this migration exists to prevent.
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
  elsif p_entity_type = 'event_chat_message' then
    update public.event_chat_messages set status = p_status where id = p_entity_id;
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
