-- 0222 — Wording is judged IN CONTEXT by Apple Intelligence, not by a word list.
--
-- Until now there were two text screens:
--   1. moderate_content_text() (0040/0044/0128/0160) auto-held any post, comment
--      or chat message containing one of ~400 blocklist terms — a keyword match
--      with no idea what the sentence meant;
--   2. the mini's Apple-Intelligence check (/moderate/text) — but ONLY for new
--      Feed posts. Comments and chat had nothing but the word list.
-- Brian asked for context over keywords. So:
--
--   • moderate_content_text() no longer holds anything on a blocklist match. It
--     keeps its other two jobs unchanged: the length cap, and pinning a member's
--     status so editing can't un-hide a held item. Body recreated from the CURRENT
--     production definition (0218's), with only the blocklist block removed — the
--     0160 rule.
--   • The moderation_blocklist table and its rows are LEFT IN PLACE (nothing reads
--     them now). Dropping them is unrecoverable and buys nothing; restoring the
--     old behaviour is one function recreate if it's ever wanted.
--   • ai_hold_content() is how the mini's new text watcher (media-server/
--     text-moderation-watcher.js) holds a comment / chat message / edited post
--     after Apple Intelligence flags it — recording WHY in content_moderation_events
--     (and records the reason for a new post the composer already held).
--   • moderation_queue() now shows that reason, so Content review says what the
--     AI objected to instead of a bare "Held". Recreated from 0218's body; the
--     only change is the `flg` CTE and the reasons coalesce on each arm.

-- ── 1. No more keyword holds ───────────────────────────────────────────────────
create or replace function public.moderate_content_text()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_noun     text;
  v_max      int;
  v_is_admin boolean;
  v_bypass   boolean;
begin
  if TG_TABLE_NAME = 'posts' then
    v_noun := 'post'; v_max := 5000;
  elsif TG_TABLE_NAME = 'post_comments' then
    v_noun := 'comment'; v_max := 2000;
  else
    v_noun := 'message'; v_max := 2000;
  end if;

  v_is_admin := exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin);
  -- Automated hold paths (media verdict triggers, ai_hold_content) set this
  -- transaction-local flag before their status UPDATE, so the member-edit pin
  -- below doesn't revert an automated hold.
  v_bypass := coalesce(current_setting('mlr.mod_bypass', true), '') = '1';

  -- Members can't move an item's moderation status by editing it — pin it to the
  -- old value. Admins (set_content_status) and the automated holds (bypass) are
  -- the only sanctioned status writers.
  if TG_OP = 'UPDATE' and not v_is_admin and not v_bypass
     and NEW.status is distinct from OLD.status then
    NEW.status := OLD.status;
  end if;

  if NEW.text is not null and char_length(NEW.text) > v_max then
    raise exception 'That % is too long (max % characters).', v_noun, v_max
      using errcode = 'check_violation';
  end if;

  -- No keyword hold (0222). Wording is judged in context by Apple Intelligence
  -- on the mini, which calls ai_hold_content() when something is inappropriate.
  return NEW;
end;
$function$;

-- ── 2. The AI hold, for the mini's watcher ─────────────────────────────────────
-- Service-role only. Holds the item only if it's still visible (an admin's
-- decision or an earlier hold is never overwritten) and logs the AI's reason.
create or replace function public.ai_hold_content(
  p_entity_type text,
  p_entity_id   uuid,
  p_reason      text default null,
  p_category    text default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rows int;
begin
  perform set_config('mlr.mod_bypass', '1', true);

  if p_entity_type = 'post' then
    update public.posts set status = 'pending' where id = p_entity_id and status = 'visible';
  elsif p_entity_type = 'comment' then
    update public.post_comments set status = 'pending' where id = p_entity_id and status = 'visible';
  elsif p_entity_type = 'committee_message' then
    update public.committee_messages set status = 'pending' where id = p_entity_id and status = 'visible';
  elsif p_entity_type = 'house_message' then
    update public.house_messages set status = 'pending' where id = p_entity_id and status = 'visible';
  elsif p_entity_type = 'event_chat_message' then
    update public.event_chat_messages set status = 'pending' where id = p_entity_id and status = 'visible';
  else
    raise exception 'Unknown content type.';
  end if;
  get diagnostics v_rows = row_count;

  perform set_config('mlr.mod_bypass', '', true);

  -- A new Feed post is screened BEFORE it's created (the composer calls
  -- /moderate/text and passes create_post(p_held => true)), so it arrives already
  -- pending with no reason on record. The watcher then calls this purely to log
  -- WHY — allowed once, while it's still held and nothing was logged yet.
  if v_rows = 0 and p_entity_type = 'post'
     and exists (select 1 from public.posts where id = p_entity_id and status = 'pending')
     and not exists (select 1 from public.content_moderation_events e
                     where e.entity_type = 'post' and e.entity_id = p_entity_id) then
    v_rows := 1;
  end if;

  if v_rows > 0 then
    insert into public.content_moderation_events
      (entity_type, entity_id, action, reason, severity, actor_id)
    values
      (p_entity_type, p_entity_id, 'flagged',
       left('Apple Intelligence'
            || coalesce(' (' || nullif(btrim(p_category), '') || ')', '')
            || coalesce(': ' || nullif(btrim(p_reason), ''), ''), 300),
       'ai', null);
  end if;
  return v_rows > 0;
end;
$function$;

revoke all on function public.ai_hold_content(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.ai_hold_content(text, uuid, text, text) to service_role;

-- ── 3. Content review shows WHY ────────────────────────────────────────────────
create or replace function public.moderation_queue()
returns table(entity_type text, entity_id uuid, post_id uuid, author_id uuid, author_name text, body text, status text, report_count integer, reasons text[], created_at timestamp with time zone)
language plpgsql
security definer
set search_path to ''
as $function$
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
  ),
  -- The most recent automated hold reason per item (Apple Intelligence, 0222).
  flg as (
    select distinct on (e.entity_type, e.entity_id)
           e.entity_type as et, e.entity_id as eid, e.reason
    from public.content_moderation_events e
    where e.action = 'flagged' and e.reason is not null
    order by e.entity_type, e.entity_id, e.created_at desc
  )
  select 'post'::text, p.id, p.id, p.author_id,
         coalesce(pr.display_name, 'Member'),
         left(coalesce(p.text, ''), 280), p.status,
         coalesce(r.cnt, 0),
         coalesce(r.reasons, '{}'::text[]) || coalesce(array[f.reason], '{}'::text[]),
         p.created_at
    from public.posts p
    left join public.profiles pr on pr.id = p.author_id
    left join rep r on r.et = 'post' and r.eid = p.id
    left join flg f on f.et = 'post' and f.eid = p.id
    where p.status = 'pending' or r.cnt is not null
  union all
  select 'comment'::text, c.id, c.post_id, c.author_id,
         coalesce(pr.display_name, 'Member'),
         left(coalesce(c.text, ''), 280), c.status,
         coalesce(r.cnt, 0),
         coalesce(r.reasons, '{}'::text[]) || coalesce(array[f.reason], '{}'::text[]),
         c.created_at
    from public.post_comments c
    left join public.profiles pr on pr.id = c.author_id
    left join rep r on r.et = 'comment' and r.eid = c.id
    left join flg f on f.et = 'comment' and f.eid = c.id
    where c.status = 'pending' or r.cnt is not null
  union all
  select 'committee_message'::text, m.id, null::uuid, m.author_id,
         coalesce(pr.display_name, 'Member'),
         left('[' || coalesce(co.name, 'Committee') || coalesce(' · ' || m.area, '') || '] '
              || coalesce(nullif(m.text, ''), '📎 attachment'), 280),
         m.status, 0, coalesce(array[f.reason], '{}'::text[]), m.created_at
    from public.committee_messages m
    left join public.profiles pr on pr.id = m.author_id
    left join public.committees co on co.id = m.committee_id
    left join flg f on f.et = 'committee_message' and f.eid = m.id
    where m.status = 'pending'
  union all
  select 'house_message'::text, m.id, null::uuid, m.author_id,
         coalesce(pr.display_name, 'Member'),
         left('[' || coalesce(h.name, 'House') || '] '
              || coalesce(nullif(m.text, ''), '📎 attachment'), 280),
         m.status, 0, coalesce(array[f.reason], '{}'::text[]), m.created_at
    from public.house_messages m
    left join public.profiles pr on pr.id = m.author_id
    left join public.houses h on h.id = m.house_id
    left join flg f on f.et = 'house_message' and f.eid = m.id
    where m.status = 'pending'
  union all
  -- Event chat. Labelled with the event's title so an admin knows which room it
  -- came from without being able to open that room.
  select 'event_chat_message'::text, m.id, null::uuid, m.author_id,
         coalesce(pr.display_name, 'Member'),
         left('[' || coalesce(e.title, 'Event') || '] '
              || coalesce(nullif(m.text, ''), '📎 attachment'), 280),
         m.status, 0, coalesce(array[f.reason], '{}'::text[]), m.created_at
    from public.event_chat_messages m
    left join public.profiles pr on pr.id = m.author_id
    left join public.events e on e.id::text = m.event_id
    left join flg f on f.et = 'event_chat_message' and f.eid = m.id
    where m.status = 'pending'
  order by created_at desc;
end;
$function$;

-- ── 4. What the watcher has already checked ────────────────────────────────────
-- One row per item, keyed to a hash of the text it judged. Lets the watcher
-- (a) skip an item whose text hasn't changed — crucially, an item an admin
-- APPROVED is never re-held just because the approval fired an UPDATE; and
-- (b) find anything it hasn't checked yet (the mini was off, realtime dropped,
-- or Apple Intelligence was unreachable) on its periodic sweep.
-- Service-role only: RLS on with no policies.
create table if not exists public.ai_text_checks (
  entity_type text        not null,
  entity_id   uuid        not null,
  text_hash   text        not null,
  flagged     boolean     not null default false,
  checked_at  timestamptz not null default now(),
  primary key (entity_type, entity_id)
);
alter table public.ai_text_checks enable row level security;
revoke all on public.ai_text_checks from anon, authenticated;
