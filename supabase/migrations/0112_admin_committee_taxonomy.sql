-- 0112_admin_committee_taxonomy.sql
-- App-admin management of the committee *taxonomy*: create / rename / archive
-- committees, and add / rename / archive the ROLES (a.k.a "areas", migration
-- 0063) inside each one — with each role still being its own chat channel.
--
-- What already existed (unchanged, still the membership path):
--   • committees                — the groups (0012). admins could already write
--                                 the table via RLS; these RPCs are the atomic,
--                                 UI-facing front doors for it.
--   • committee_areas           — the per-committee role allow-list (0073).
--   • committee_roster.roles[]  — who holds which role (the membership + the
--                                 chat-area access gate, 0057/0063).
--   • set_committee_member / set_committee_areas / set_my_committee_areas
--                               — add/remove people + assign roles (0073). These
--                                 are untouched; adding/removing PEOPLE already
--                                 works. This migration only adds managing the
--                                 committees + roles THEMSELVES.
--
-- The design decision that shapes this file: DELETE == ARCHIVE, never destroy.
--   • Rename (committee or role) is a pure in-place rename — the chat + its full
--     history stay LIVE. A role name is denormalized as text in SIX places, so a
--     rename has to cascade through all six in one transaction; that's what
--     rename_committee_area() is for (a plain table edit would strip chat
--     history + memberships off the old name).
--   • "Deleting" a committee or role sets archived_at instead. The roster stays
--     intact, so nothing is lost and a restore is trivial. An archived
--     committee/role drops out of the live lists and its chat goes READ-ONLY
--     (enforced in RLS, not just the UI); the history still reads for the people
--     who were in it + admins, surfaced under a hidden "Archived chats" section.
--     restore_* flips archived_at back to null and it's live again, roster + all.
--
-- All the write RPCs here are APP-ADMIN only (profiles.is_admin) — the audience
-- the requester named. Apply in the Supabase SQL editor after 0111.

-- ── 0. archive flags ──────────────────────────────────────────────────────────
alter table public.committees
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles (id) on delete set null;

alter table public.committee_areas
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles (id) on delete set null;

-- ── 1. slug helper ────────────────────────────────────────────────────────────
-- Committee slugs are the text key that committee_roster / committee_areas hang
-- off of (they have no FK to committees.id), so a slug must NEVER change once
-- minted — update_committee() below edits display fields only, never the slug.
create or replace function public.slugify(txt text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           regexp_replace(lower(coalesce(txt, '')), '[^a-z0-9]+', '-', 'g'),
           '(^-+|-+$)', '', 'g'
         );
$$;

-- ── 2. create_committee ───────────────────────────────────────────────────────
create or replace function public.create_committee(
  p_name        text,
  p_emoji       text default '🌲',
  p_description text default ''
)
returns public.committees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_slug text;
  v_n    int := 0;
  v_row  public.committees;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Name required'; end if;

  v_base := coalesce(nullif(public.slugify(p_name), ''), 'committee');
  v_slug := v_base;
  while exists (select 1 from public.committees where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.committees (slug, name, emoji, description, position)
  values (
    v_slug,
    btrim(p_name),
    coalesce(nullif(btrim(p_emoji), ''), '🌲'),
    coalesce(p_description, ''),
    coalesce((select max(position) + 1 from public.committees), 0)
  )
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.create_committee(text, text, text) from public, anon;
grant execute on function public.create_committee(text, text, text) to authenticated;

-- ── 3. update_committee (display fields only; slug is immutable) ───────────────
create or replace function public.update_committee(
  cid           uuid,
  p_name        text,
  p_emoji       text,
  p_description text,
  p_position    int default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  update public.committees set
    name        = coalesce(nullif(btrim(p_name), ''), name),
    emoji       = coalesce(nullif(btrim(p_emoji), ''), emoji),
    description = coalesce(p_description, description),
    position    = coalesce(p_position, position)
  where id = cid;
end;
$$;
revoke all on function public.update_committee(uuid, text, text, text, int) from public, anon;
grant execute on function public.update_committee(uuid, text, text, text, int) to authenticated;

-- ── 4. archive / restore a whole committee ────────────────────────────────────
create or replace function public.archive_committee(cid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  update public.committees
    set archived_at = now(), archived_by = auth.uid()
    where id = cid and archived_at is null;
end;
$$;
revoke all on function public.archive_committee(uuid) from public, anon;
grant execute on function public.archive_committee(uuid) to authenticated;

create or replace function public.restore_committee(cid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  update public.committees
    set archived_at = null, archived_by = null
    where id = cid;
end;
$$;
revoke all on function public.restore_committee(uuid) from public, anon;
grant execute on function public.restore_committee(uuid) to authenticated;

-- ── 5. add_committee_area (create a role / subcommittee → new chat channel) ────
-- Re-adding a name that was previously archived just un-archives it (so its old
-- history comes right back live), rather than erroring on the PK.
create or replace function public.add_committee_area(cid uuid, p_area text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_area text := btrim(p_area);
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if v_area = '' or lower(v_area) = 'general' or v_area like '% · Lead' then
    raise exception 'Invalid role name';
  end if;
  select slug into v_slug from public.committees where id = cid;
  if v_slug is null then raise exception 'Committee not found'; end if;

  insert into public.committee_areas (committee_slug, area)
  values (v_slug, v_area)
  on conflict (committee_slug, area) do update
    set archived_at = null, archived_by = null;
end;
$$;
revoke all on function public.add_committee_area(uuid, text) from public, anon;
grant execute on function public.add_committee_area(uuid, text) to authenticated;

-- ── 6. rename_committee_area — the six-way cascade (keeps the chat + history) ──
-- A role name lives as denormalized text in six places. Renaming has to touch
-- them all atomically or history/memberships fall off the old name:
--   1. committee_areas          (the allow-list)
--   2. committee_roster.roles[] ('X' AND 'X · Lead')  ← membership + chat access
--   3. committee_members.areas[]('X' AND 'X · Lead')  ← chat-access mirror
--   4. committee_messages.area  (base name only)      ← the CHAT HISTORY
--   5. committee_area_reads.area(base name only)      ← unread state
--   6. committee_join_requests.requested_areas[]/requested_area
create or replace function public.rename_committee_area(cid uuid, p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_old  text := btrim(p_old);
  v_new  text := btrim(p_new);
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if v_new = '' or lower(v_new) = 'general' or v_new like '% · Lead' then
    raise exception 'Invalid role name';
  end if;
  select slug into v_slug from public.committees where id = cid;
  if v_slug is null then raise exception 'Committee not found'; end if;
  if v_old = v_new then return; end if;
  if exists (select 1 from public.committee_areas where committee_slug = v_slug and area = v_new) then
    raise exception 'A role named "%" already exists here', v_new;
  end if;

  -- 1. allow-list
  update public.committee_areas
    set area = v_new
    where committee_slug = v_slug and area = v_old;

  -- 2. roster roles[]  (preserve a trailing " · Lead")
  update public.committee_roster
    set roles = (
          select array_agg(
            case
              when r = v_old              then v_new
              when r = v_old || ' · Lead' then v_new || ' · Lead'
              else r
            end)
          from unnest(roles) r),
        updated_at = now()
    where committee_slug = v_slug
      and (v_old = any(roles) or (v_old || ' · Lead') = any(roles));

  -- 3. committee_members.areas[]
  update public.committee_members
    set areas = (
          select array_agg(
            case
              when a = v_old              then v_new
              when a = v_old || ' · Lead' then v_new || ' · Lead'
              else a
            end)
          from unnest(areas) a)
    where committee_id = cid
      and (v_old = any(areas) or (v_old || ' · Lead') = any(areas));

  -- 4. chat history (area stores the base name, no Lead suffix — migration 0063)
  update public.committee_messages
    set area = v_new
    where committee_id = cid and area = v_old;

  -- 5. per-channel read state (guard against a pre-existing v_new row)
  delete from public.committee_area_reads r
    where r.committee_id = cid and r.area = v_old
      and exists (
        select 1 from public.committee_area_reads r2
        where r2.committee_id = cid and r2.user_id = r.user_id and r2.area = v_new);
  update public.committee_area_reads
    set area = v_new
    where committee_id = cid and area = v_old;

  -- 6. join requests
  update public.committee_join_requests
    set requested_areas = (select array_agg(case when a = v_old then v_new else a end) from unnest(requested_areas) a)
    where committee_id = cid and v_old = any(requested_areas);
  update public.committee_join_requests
    set requested_area = v_new
    where committee_id = cid and requested_area = v_old;
end;
$$;
revoke all on function public.rename_committee_area(uuid, text, text) from public, anon;
grant execute on function public.rename_committee_area(uuid, text, text) to authenticated;

-- ── 7. archive / restore a single role (chat → read-only, then back) ──────────
-- Archiving deliberately does NOT strip the role from anyone's roles[]: keeping
-- it is what preserves "they were in it" (so the archived chat still shows in
-- their history) AND makes restore a no-op flip. The read-only-ness + list
-- hiding come from the archived_at flag alone (see RLS + is_committee_area_archived).
create or replace function public.archive_committee_area(cid uuid, p_area text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_slug text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  select slug into v_slug from public.committees where id = cid;
  update public.committee_areas
    set archived_at = now(), archived_by = auth.uid()
    where committee_slug = v_slug and area = btrim(p_area) and archived_at is null;
end;
$$;
revoke all on function public.archive_committee_area(uuid, text) from public, anon;
grant execute on function public.archive_committee_area(uuid, text) to authenticated;

create or replace function public.restore_committee_area(cid uuid, p_area text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_slug text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  select slug into v_slug from public.committees where id = cid;
  update public.committee_areas
    set archived_at = null, archived_by = null
    where committee_slug = v_slug and area = btrim(p_area);
end;
$$;
revoke all on function public.restore_committee_area(uuid, text) from public, anon;
grant execute on function public.restore_committee_area(uuid, text) to authenticated;

-- ── 8. make archived chats READ-ONLY (reads still work; posting is blocked) ────
-- can_access_committee_area (0063) stays the READ gate — holders + admins can
-- still read an archived channel's history. We only add an INSERT guard so no
-- new messages land in an archived committee or an archived role channel.
create or replace function public.is_committee_area_archived(cid uuid, p_area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.committees c where c.id = cid and c.archived_at is not null
    )
    or (
      p_area is not null and exists (
        select 1
        from public.committee_areas ca
        join public.committees c on c.slug = ca.committee_slug
        where c.id = cid and ca.area = p_area and ca.archived_at is not null
      )
    );
$$;
revoke all on function public.is_committee_area_archived(uuid, text) from public, anon;
grant execute on function public.is_committee_area_archived(uuid, text) to authenticated;

drop policy if exists "cmsg: member insert own" on public.committee_messages;
create policy "cmsg: member insert own" on public.committee_messages for insert
  with check (
    author_id = auth.uid()
    and public.can_access_committee_area(committee_id, area)
    and not public.is_committee_area_archived(committee_id, area)
  );
