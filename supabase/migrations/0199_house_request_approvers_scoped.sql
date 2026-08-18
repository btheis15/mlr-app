-- 0199_house_request_approvers_scoped.sql
--
-- FIX: a house request emailed and pushed EVERY app admin.
--
-- 0195's _house_request_approvers was "House Admins of this house OR any app
-- admin", modeled on cabin_request (0032/0114), which really does notify every
-- admin. Wrong analogy: a cabin is a shared resort asset, whereas a house's own
-- spending is exactly what the House Admins tier (0194) exists to keep INSIDE the
-- house. Live effect: one MJT House request for a vacuum emailed + pushed all 7
-- app admins, 6 of whom have nothing to do with MJT House.
--
-- ⚠️ THE RULE, per Brian, 2026-08-18: for a house-scoped request the House Admins
-- of that house are the ONLY people notified. Not app admins. There is
-- deliberately NO app-admin fallback — re-admitting "any app admin" under any
-- condition is precisely the bug being fixed here, and a fallback would quietly
-- reintroduce it the moment a house had no admin named.
--
-- Consequence, stated plainly rather than papered over: a house with NO House
-- Admin notifies nobody. The request still lands on the board and is visible to
-- the whole house (the RLS read is unchanged) — it just doesn't page anyone. Name
-- a House Admin in Admin → Houses and that stops being true. Notifying every
-- admin instead would be worse than a quiet board.
--
-- App admins keep full ACCESS regardless — can_review_house_request() (0194) is
-- untouched, so any app admin can still open, approve and manage any request.
-- This function governs who gets CONTACTED, not who is allowed to act.
--
-- Only this one function changes. create_house_request's in-app fan-out,
-- _notify_house_request_coadmins (0198), house_request_approver_emails and
-- house_request_coadmin_emails all read through it, so in-app, push and email
-- narrow together and cannot drift.
--
-- No app or media-server change — SQL only. Apply after 0198.

create or replace function public._house_request_approvers(p_request uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with req as (
    select house_id from public.house_requests where id = p_request
  )
  -- House-scoped: that house's House Admins, and nobody else.
  select p.id
    from public.profiles p
    cross join req
   where req.house_id is not null
     and p.house_admin
     and p.house_id = req.house_id
  union
  -- Resort-wide scope (house_id is null) has no tier of its own yet, so it still
  -- reaches app admins. Nothing in the app creates one — the composer has no
  -- scope picker — and the LEDO Trust will take this over (see 0194's
  -- can_review_house_request seam).
  select p.id
    from public.profiles p
    cross join req
   where req.house_id is null
     and p.is_admin;
$$;
revoke all on function public._house_request_approvers(uuid) from public, anon;

-- ── Who gets contacted now, per house ────────────────────────────────────────
-- Expect exactly the House Admins of each house — and a warning row for any
-- house that would page nobody.
select h.name as house,
       count(p.id) as house_admins_notified,
       coalesce(string_agg(coalesce(nullif(btrim(p.display_name), ''), '?'), ', '
                           order by p.display_name), '⚠️ nobody — name a House Admin') as notified
  from public.houses h
  left join public.profiles p on p.house_id = h.id and p.house_admin
 group by h.name
 order by h.name;
