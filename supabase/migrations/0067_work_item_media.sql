-- 0067_work_item_media.sql
-- Photo/video attachments for work items, so people can see what a task is about
-- ("here's the roof that needs sweeping"). Mirrors post_media (0004): storage_path
-- holds the full Mac-mini media URL, media_type is image|video, position orders
-- them. The mini's /upload already sniffs magic bytes + transcodes video, so this
-- is just the row layer.
--
-- Reads follow the parent work item's visibility (MLR items public; house items
-- members-only — 0066). Writes go through SECURITY DEFINER RPCs (consistent with
-- every other work-item write, unlike post_media's direct client insert), gated to
-- the item's creator or an admin. Apply after 0066.

create table if not exists public.work_item_media (
  id           uuid        primary key default gen_random_uuid(),
  work_item_id uuid        not null references public.work_items (id) on delete cascade,
  storage_path text        not null,   -- full URL to the Mac-mini media server
  media_type   text        not null default 'image' check (media_type in ('image','video')),
  position     int         not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists work_item_media_idx on public.work_item_media (work_item_id, position);
alter table public.work_item_media enable row level security;

-- Read follows the parent item: visible whenever the work item itself is visible.
drop policy if exists "wimedia: scoped read" on public.work_item_media;
create policy "wimedia: scoped read" on public.work_item_media for select
  using (exists (
    select 1 from public.work_items w
    where w.id = work_item_id
      and (w.house_id is null or public.is_house_member(w.house_id))
  ));
-- No client insert/update/delete policy — writes go through the RPCs below.

-- ── RPC: add_work_item_media — item creator or admin ─────────────────────────
create or replace function public.add_work_item_media(
  p_work_item_id uuid,
  p_url          text,
  p_media_type   text default 'image',
  p_position     int  default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if coalesce(btrim(p_url), '') = '' then raise exception 'URL is required'; end if;
  if p_media_type not in ('image', 'video') then raise exception 'Invalid media type'; end if;

  select created_by into v_creator from public.work_items where id = p_work_item_id;
  if not found then raise exception 'Item not found'; end if;
  if v_creator is distinct from v_uid
     and not exists (select 1 from public.profiles where id = v_uid and is_admin)
    then raise exception 'Not authorized'; end if;

  insert into public.work_item_media (work_item_id, storage_path, media_type, position)
  values (p_work_item_id, btrim(p_url), p_media_type, coalesce(p_position, 0))
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.add_work_item_media(uuid, text, text, int) from public, anon;
grant execute on function public.add_work_item_media(uuid, text, text, int) to authenticated;

-- ── RPC: remove_work_item_media — item creator or admin ──────────────────────
create or replace function public.remove_work_item_media(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_creator uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select w.created_by into v_creator
    from public.work_item_media m
    join public.work_items w on w.id = m.work_item_id
   where m.id = p_id;
  if not found then raise exception 'Media not found'; end if;
  if v_creator is distinct from v_uid
     and not exists (select 1 from public.profiles where id = v_uid and is_admin)
    then raise exception 'Not authorized'; end if;

  delete from public.work_item_media where id = p_id;
end;
$$;
revoke all on function public.remove_work_item_media(uuid) from public, anon;
grant execute on function public.remove_work_item_media(uuid) to authenticated;

-- ── Realtime ─────────────────────────────────────────────────────────────────
alter table public.work_item_media replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.work_item_media;
exception when duplicate_object then null; end $$;
