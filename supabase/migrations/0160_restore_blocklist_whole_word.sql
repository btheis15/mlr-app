-- 0160_restore_blocklist_whole_word.sql
-- Fixes a real production incident: a normal, non-inappropriate post got
-- auto-held for "inappropriate content," and every post since kept getting
-- silently held the same way (author sees it, nobody else does — the RPC
-- reports success either way, so it just looked like posting had stopped
-- working).
--
-- Root cause: 0044_blocklist_whole_word.sql fixed moderate_content_text() to
-- match blocklist terms as WHOLE WORDS (so a public profanity list, seeded by
-- media-server/seed-blocklist.js, doesn't over-flag ordinary words that
-- happen to CONTAIN a blocked fragment — critical at a fishing/lake resort:
-- "bass"/"class"/"glass"/"assist" all contain "ass", "hello"/"shell" contain
-- "hell", etc.). 0128_chat_moderation.sql then recreated the SAME function
-- (to extend it to committee/house chat) directly off the ORIGINAL 0040
-- version, not 0044 — silently reintroducing plain substring matching
-- (`NEW.text ilike '%' || pattern || '%'`). With the seeded blocklist in
-- place, that meant any post/comment/chat message containing a common word
-- with a blocked fragment inside it got auto-held, for everyone, ever since
-- 0128 was applied.
--
-- This migration re-recreates moderate_content_text() with 0128's full
-- structure (posts/comments/committee/house branches, the mlr.mod_bypass GUC
-- so automated media/report holds aren't reverted by the member-edit pin)
-- but restores 0044's tokenized whole-word matching for single-word terms
-- (multi-word phrases still match by substring, since a phrase can't
-- false-match a single innocent word). Everything else is unchanged.
--
-- SAFETY: as in 0044, single-word terms are matched by tokenizing the text
-- with a FIXED constant regex ('[^a-z0-9]+') and comparing tokens for
-- equality — no regex is ever built from a blocklist entry, so a weird list
-- term can never raise a regex error that would block a post from being
-- created.
--
-- Idempotent. Apply after 0128.

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
revoke all on function public.moderate_content_text() from public, anon, authenticated;
