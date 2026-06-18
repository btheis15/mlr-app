-- 0044_blocklist_whole_word.sql
-- Make the text blocklist match WHOLE WORDS, not substrings, so a public
-- profanity list (see media-server/seed-blocklist.js) can be loaded without
-- over-flagging innocent words — critical at a fishing/lake resort where "bass"
-- contains "ass", "hello" contains "hell", etc.
--
-- Only the matching SELECT inside moderate_content_text() changes; everything
-- else (length cap, status-change guard, admin exemption, auto-hold + event)
-- is preserved verbatim from 0040.
--
-- SAFETY: single-word terms are matched by tokenizing the text with a FIXED
-- constant regex ('[^a-z0-9]+') and comparing tokens for equality — no regex is
-- ever built from a blocklist entry, so a weird list term can never raise a
-- regex error that would block a post from being created. Multi-word phrases
-- keep substring matching (a phrase can't false-match a single word).

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

  -- Members can't move an item's moderation status by editing it.
  if TG_OP = 'UPDATE' and not v_is_admin and NEW.status is distinct from OLD.status then
    NEW.status := OLD.status;
  end if;

  if NEW.text is not null then
    if char_length(NEW.text) > v_max then
      raise exception 'That % is too long (max % characters).', v_etype, v_max
        using errcode = 'check_violation';
    end if;

    -- Whole-word match for single-word terms; substring for multi-word phrases.
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
