-- 0202_house_requests_house_admins_only.sql
--
-- App admins can VIEW their own house's requests. They cannot decide them, and
-- they cannot see any other house's board at all.
--
-- 0199 fixed who gets NOTIFIED but left authority and visibility wide open, and
-- the header even called that deliberate. It wasn't right: with Beth and leetheis
-- as MJT House's House Admins, all SEVEN app admins could still approve, deny,
-- modify and delete MJT House requests — four of them not even in the house — and
-- every app admin could read every house's board.
--
-- THE RULE (per Brian, 2026-08-18):
--   • see    — the request's own author, and the members of its house. Nobody else.
--              No app-admin override: an app admin sees their OWN house, like
--              everybody else, and that's it.
--   • decide — the House Admins of that house. ONLY. Being an app admin grants
--              nothing here.
--   • your own ask — modify while pending, or withdraw. Keyed on authorship, so
--              this is unaffected either way.
--
-- Being an app admin still means something: only an app admin who is IN a house
-- can appoint its House Admins (set_house_admin, 0194 — untouched). So authority
-- is delegated, not lost, and a house can never be permanently stuck: an app
-- admin in it names a House Admin and that person decides.
--
-- Resort-wide scope (house_id is null) still resolves to app admins, since no
-- other tier exists yet. Nothing in the app creates one; the LEDO Trust takes it
-- over via this same function.
--
-- Apply after 0201.

-- ── 1. Deciding is House Admins only ─────────────────────────────────────────
-- Recreated from 0194 §3. The app-admin arm is now confined to the null-scope
-- (resort-wide) branch instead of applying to every house.
--
-- This one function gates review_house_request, set_house_request_progress,
-- update_house_request's reviewer branch, add/remove_house_request_media and
-- delete_house_request — so all of them narrow together and can't disagree.
create or replace function public.can_review_house_request(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when hid is null then
      -- Resort-wide: app admins, until the LEDO Trust exists.
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    else
      public.is_house_admin(hid)
  end;
$$;
revoke all on function public.can_review_house_request(uuid) from public, anon;
grant execute on function public.can_review_house_request(uuid) to authenticated;

-- ── 2. Reading is your own house only ────────────────────────────────────────
-- Replaces 0200 §2's policy. Two changes: the blanket app-admin clause is gone,
-- and a test row (0200) is visible to its author alone — it was already hidden
-- from the house, and no admin elsewhere needs to see somebody's test.
--
-- ⚠️ It compares house_id DIRECTLY rather than calling is_house_member(), because
-- is_house_member grants app admins a blanket pass (0064) — using it here would
-- quietly re-open cross-house reads through the back door, i.e. the exact thing
-- this migration exists to close.
drop policy if exists "house_requests: house or admin read" on public.house_requests;
drop policy if exists "house_requests: house read" on public.house_requests;
create policy "house_requests: house read" on public.house_requests for select
  using (
    public.is_approved_member()
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

-- Attachments follow the parent exactly (recreated from 0195 §2 with the same
-- own-house rule), so a photo can't be read where its request can't.
drop policy if exists "house_request_media: scoped read" on public.house_request_media;
create policy "house_request_media: scoped read" on public.house_request_media for select
  using (
    exists (
      select 1 from public.house_requests r
      where r.id = request_id
        and public.is_approved_member()
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

-- ── 3. Let someone bin their OWN test row ────────────────────────────────────
-- Recreated from 0201 with one added branch. Deleting is otherwise a House Admin
-- action, but a test request is private to its author by construction — and
-- without this, anyone who made a test and then wasn't (or stopped being) a House
-- Admin could never clear it, which is exactly the state this migration creates.
create or replace function public.delete_house_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.house_requests;
  v_uid uuid := auth.uid();
begin
  select * into r from public.house_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;

  -- Your own test row: always yours to remove.
  if r.test_only and r.created_by = v_uid then
    delete from public.house_requests where id = p_id;
    return;
  end if;

  if not public.can_review_house_request(r.house_id) then
    raise exception 'Only a House Admin can remove this';
  end if;

  if not r.test_only and r.status not in ('received', 'denied', 'withdrawn') then
    if r.status = 'approved' or r.status = 'ordered' then
      raise exception 'This is still in progress — mark it done first, or turn it down';
    else
      raise exception 'Turn it down instead of deleting it, so they know what happened';
    end if;
  end if;

  delete from public.house_requests where id = p_id;
end;
$$;
revoke all on function public.delete_house_request(uuid) from public, anon;
grant execute on function public.delete_house_request(uuid) to authenticated;

-- ── 4. Who can decide what, now ──────────────────────────────────────────────
select coalesce(h.name, 'Resort-wide') as scope,
       coalesce(string_agg(p.display_name, ', ' order by p.display_name),
                '⚠️ nobody — an app admin IN this house must name a House Admin') as can_decide
  from public.houses h
  left join public.profiles p on p.house_id = h.id and p.house_admin
 group by h.name
 order by h.name;
