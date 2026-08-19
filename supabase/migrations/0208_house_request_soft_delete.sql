-- 0208_house_request_soft_delete.sql
--
-- Removing a request leaves a TOMBSTONE for 7 days instead of vanishing.
--
-- Two problems with the hard delete from 0201–0203:
--   • a member couldn't remove their own request at all (House Admins only), and
--     couldn't even clear one they'd withdrawn;
--   • anything removed disappeared without trace, so a House Admin looking for a
--     request they half-remember has no way to tell "it was never submitted" from
--     "somebody took it back" — which is exactly the confusion worth avoiding.
--
-- So: anyone can remove their OWN request, House Admins can remove any in their
-- house, and either way the row stays visible on the board marked as removed —
-- with who removed it and when — for 7 days. After that it drops out of every
-- read on its own.
--
-- ⚠️ THE 7-DAY WINDOW IS ENFORCED IN THE READ POLICY, not by a scheduled job.
-- `deleted_at > now() - interval '7 days'` means the row simply stops being
-- visible to everybody (its author included) once it ages out — no pg_cron tick to
-- fail, nothing to monitor, and no window where a purge job's absence leaves
-- tombstones piling up forever. The row itself is left in place as a quiet record,
-- the same way already-fired scheduled_broadcasts rows are never purged (0097).
--
-- A TEST row (0200) still HARD deletes: it's visible only to its author, so its
-- disappearance can't confuse anybody, and clearing test junk cleanly is the
-- entire reason that path exists.
--
-- Apply after 0207.

-- ── 1. The tombstone ─────────────────────────────────────────────────────────
alter table public.house_requests
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id) on delete set null;

create index if not exists house_requests_deleted_idx
  on public.house_requests (deleted_at) where deleted_at is not null;

comment on column public.house_requests.deleted_at is
  'Soft delete. The row stays visible on the board as "removed" for 7 days (enforced in the read policy), then drops out of every read. Set via delete_house_request().';

-- ── 2. Reads: own house, and only inside the 7-day window ────────────────────
-- Recreated from 0202 §2 with the tombstone window added. Everything else is
-- unchanged, including the deliberate direct house_id comparison (is_house_member
-- would hand app admins a blanket pass — see 0202).
drop policy if exists "house_requests: house read" on public.house_requests;
create policy "house_requests: house read" on public.house_requests for select
  using (
    public.is_approved_member()
    and (deleted_at is null or deleted_at > now() - interval '7 days')
    and (
      created_by = auth.uid()
      or (
        not test_only
        and (
          house_id is null
          or house_id = (select p.house_id from public.profiles p where p.id = auth.uid())
        )
      )
    )
  );

-- Attachments follow the parent, tombstone window included.
drop policy if exists "house_request_media: scoped read" on public.house_request_media;
create policy "house_request_media: scoped read" on public.house_request_media for select
  using (
    exists (
      select 1 from public.house_requests r
      where r.id = request_id
        and public.is_approved_member()
        and (r.deleted_at is null or r.deleted_at > now() - interval '7 days')
        and (
          r.created_by = auth.uid()
          or (
            not r.test_only
            and (
              r.house_id is null
              or r.house_id = (select p.house_id from public.profiles p where p.id = auth.uid())
            )
          )
        )
    )
    and (status = 'visible' or uploaded_by = auth.uid())
  );

-- ── 3. Delete = soft, and open to the author ─────────────────────────────────
-- Recreated from 0203's body. Two changes: the CREATOR may remove their own
-- request (at any status), and removal stamps the tombstone rather than deleting.
--
-- The old status guards are gone on purpose. They existed because a hard delete
-- made someone's ask evaporate with no explanation — a tombstone that names who
-- removed it answers that directly, so blocking a pending or approved row no
-- longer buys anything. (A House Admin should still normally DENY rather than
-- remove, since a denial carries a note; that's guidance, not a lock.)
create or replace function public.delete_house_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.house_requests;
  v_uid uuid := auth.uid();
  v_mine boolean;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into r from public.house_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if r.deleted_at is not null then return; end if;  -- idempotent

  v_mine := r.created_by = v_uid;
  if not v_mine and not public.can_review_house_request(r.house_id) then
    raise exception 'Only a House Admin, or whoever asked for it, can remove this';
  end if;

  -- A test row is private to its author, so nothing is gained by leaving a
  -- tombstone only they can see — clear it properly.
  if r.test_only and v_mine then
    delete from public.house_requests where id = p_id;
    return;
  end if;

  update public.house_requests
     set deleted_at = now(),
         deleted_by = v_uid
   where id = p_id;
end;
$$;
revoke all on function public.delete_house_request(uuid) from public, anon;
grant execute on function public.delete_house_request(uuid) to authenticated;

-- ── 4. Undo, while the tombstone is still up ─────────────────────────────────
-- Removing something is now reversible for as long as it's visible, which is the
-- natural consequence of not destroying the row — and cheap to offer.
create or replace function public.restore_house_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.house_requests;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into r from public.house_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if r.deleted_at is null then return; end if;
  if r.created_by is distinct from v_uid and not public.can_review_house_request(r.house_id) then
    raise exception 'Not authorized';
  end if;
  if r.deleted_at <= now() - interval '7 days' then
    raise exception 'That was removed more than 7 days ago';
  end if;
  update public.house_requests set deleted_at = null, deleted_by = null where id = p_id;
end;
$$;
revoke all on function public.restore_house_request(uuid) from public, anon;
grant execute on function public.restore_house_request(uuid) to authenticated;

-- ── 5. State of the board ────────────────────────────────────────────────────
select r.title, r.status, r.test_only,
       r.deleted_at is not null as removed,
       case
         when r.deleted_at is null then '—'
         when r.deleted_at > now() - interval '7 days'
           then 'visible for ' || (7 - extract(day from now() - r.deleted_at))::int || ' more day(s)'
         else 'aged out — hidden'
       end as tombstone
  from public.house_requests r
 order by r.created_at desc;
