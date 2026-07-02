-- 0063_committee_area_chats.sql
-- Split committee chat from ONE room per committee into per-ROLE channels.
--
-- committee_messages gains a nullable `area` column:
--   • area IS NULL  → the committee-wide "General" channel (every member).
--                     Role-less committees only ever use this. Existing messages
--                     (all NULL today) become each committee's General history.
--   • area = 'Meals' → a role channel, visible only to members who hold that
--                     area in their roster roles ('Meals' or 'Meals · Lead').
--
-- Access is enforced in the DB (RLS), not just the UI: you can only read/post in
-- the General channel (as a member) or in a role channel you're actually in.
-- The media / reactions / mentions child tables follow the parent message's area
-- so nothing leaks out of a channel you're not in.
--
-- Apply in the Supabase SQL editor after 0062.

-- ── 1. The area column ───────────────────────────────────────────────────────
alter table public.committee_messages
  add column if not exists area text;

create index if not exists committee_messages_area_idx
  on public.committee_messages (committee_id, area, created_at);

-- ── 2. Access helper: can the caller see/post in (committee, area)? ───────────
-- Admin, or a roster-linked member of the committee AND (General, or holds the
-- area). Roster roles read like 'Meals' or 'Meals · Lead'.
create or replace function public.can_access_committee_area(cid uuid, p_area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    or (
      exists (
        select 1
        from public.committee_roster r
        join public.committees c on c.slug = r.committee_slug
        where c.id = cid and r.linked_user_id = auth.uid()
      )
      and (
        p_area is null
        or exists (
          select 1
          from public.committee_roster r
          join public.committees c on c.slug = r.committee_slug
          where c.id = cid
            and r.linked_user_id = auth.uid()
            and (p_area = any(r.roles) or (p_area || ' · Lead') = any(r.roles))
        )
      )
    );
$$;

-- ── 3. Re-gate committee_messages on the area ────────────────────────────────
drop policy if exists "cmsg: member read" on public.committee_messages;
create policy "cmsg: member read" on public.committee_messages for select
  using (public.can_access_committee_area(committee_id, area));

drop policy if exists "cmsg: member insert own" on public.committee_messages;
create policy "cmsg: member insert own" on public.committee_messages for insert
  with check (author_id = auth.uid() and public.can_access_committee_area(committee_id, area));
-- (author update + author/admin delete policies unchanged from 0013.)

-- ── 4. Child tables follow the parent message's area ─────────────────────────
drop policy if exists "cmedia: member read" on public.committee_message_media;
create policy "cmedia: member read" on public.committee_message_media for select
  using (exists (
    select 1 from public.committee_messages m
    where m.id = message_id and public.can_access_committee_area(m.committee_id, m.area)
  ));

drop policy if exists "creact: member read" on public.committee_message_reactions;
create policy "creact: member read" on public.committee_message_reactions for select
  using (exists (
    select 1 from public.committee_messages m
    where m.id = message_id and public.can_access_committee_area(m.committee_id, m.area)
  ));
drop policy if exists "creact: insert own" on public.committee_message_reactions;
create policy "creact: insert own" on public.committee_message_reactions for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.committee_messages m
    where m.id = message_id and public.can_access_committee_area(m.committee_id, m.area)
  ));

drop policy if exists "cmention: member read" on public.committee_message_mentions;
create policy "cmention: member read" on public.committee_message_mentions for select
  using (exists (
    select 1 from public.committee_messages m
    where m.id = message_id and public.can_access_committee_area(m.committee_id, m.area)
  ));
-- media/mention INSERT stay "on own message" (author already had area access to
-- create the message); reaction/mention/media DELETE policies unchanged.

-- ── 5. Per-channel read state (unread badges) ────────────────────────────────
-- area '' stands in for the General channel (NULL) so it fits the PK.
create table if not exists public.committee_area_reads (
  committee_id uuid not null references public.committees (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  area         text not null default '',
  last_read_at timestamptz not null default now(),
  muted        boolean not null default false,   -- per-channel mute (iMessage-style)
  primary key (committee_id, user_id, area)
);
alter table public.committee_area_reads enable row level security;

drop policy if exists "careads: own read" on public.committee_area_reads;
create policy "careads: own read" on public.committee_area_reads for select
  using (user_id = auth.uid());
drop policy if exists "careads: own upsert" on public.committee_area_reads;
create policy "careads: own upsert" on public.committee_area_reads for insert
  with check (user_id = auth.uid());
drop policy if exists "careads: own update" on public.committee_area_reads;
create policy "careads: own update" on public.committee_area_reads for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Mark a channel read (upsert my last_read_at). p_area null → General ('').
create or replace function public.mark_area_read(cid uuid, p_area text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.committee_area_reads (committee_id, user_id, area, last_read_at)
  values (cid, auth.uid(), coalesce(p_area, ''), now())
  on conflict (committee_id, user_id, area)
  do update set last_read_at = now();
$$;
revoke all on function public.mark_area_read(uuid, text) from public, anon;
grant execute on function public.mark_area_read(uuid, text) to authenticated;

-- Mute / unmute a channel (upsert my row's muted flag). p_area null → General.
create or replace function public.set_area_mute(cid uuid, p_area text, p_muted boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.committee_area_reads (committee_id, user_id, area, muted)
  values (cid, auth.uid(), coalesce(p_area, ''), p_muted)
  on conflict (committee_id, user_id, area)
  do update set muted = excluded.muted;
$$;
revoke all on function public.set_area_mute(uuid, text, boolean) from public, anon;
grant execute on function public.set_area_mute(uuid, text, boolean) to authenticated;

-- ── 6. Mention notifications route to the right channel ──────────────────────
create or replace function public.notif_on_chat_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg_author uuid;
  v_committee  uuid;
  v_area       text;
  v_slug       text;
  v_cname      text;
  v_actor_name text;
  v_snippet    text;
  v_label      text;
begin
  select cm.author_id, cm.committee_id, cm.area, left(coalesce(cm.text, ''), 140)
    into v_msg_author, v_committee, v_area, v_snippet
    from public.committee_messages cm where cm.id = NEW.message_id;
  select c.slug, c.name into v_slug, v_cname from public.committees c where c.id = v_committee;
  select coalesce(display_name, 'Someone') into v_actor_name
    from public.profiles where id = v_msg_author;
  v_label := coalesce(v_cname, 'committee') || case when v_area is not null then ' — ' || v_area else '' end;
  perform public._notify(
    NEW.mentioned_user_id, 'chat_mention', v_msg_author,
    v_actor_name || ' mentioned you in ' || v_label || ' chat', v_snippet,
    '/posts?c=' || coalesce(v_slug, '') || '&m=' || NEW.message_id
      || case when v_area is not null then '&area=' || v_area else '' end,
    'committee_message', NEW.message_id, null);
  return NEW;
end;
$$;
-- trigger trg_notif_chat_mention (0030) already points at this function.
