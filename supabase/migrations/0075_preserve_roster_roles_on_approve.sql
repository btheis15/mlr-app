-- Don't let approving a join request wipe an existing roster member's roles.
--
-- Bug: Meher already had a curated committee_roster row (Entertainment &
-- Games, Art & Decorating — set by an admin, but not yet linked to her
-- account). She then used the CHAT's own "Request to join" prompt
-- (CommitteeChat.tsx, for a non-member viewing a locked channel) — that path
-- never shows an area picker, so it always submits requested_areas = '{}'.
-- When the request was approved, review_join_request's upsert matched her
-- EXISTING roster row by (committee_slug, name) and overwrote her two real
-- roles with the empty set from the request, because it always did
-- `set roles = excluded.roles` unconditionally.
--
-- Fix: on approve, an EMPTY requested-areas array means "didn't ask for a
-- specific area" — not "clear whatever's there." Only overwrite roles/areas
-- when the request actually specified something; otherwise keep whatever the
-- roster/member row already had. Linking the account (linked_user_id) still
-- always happens — that part was correct.

create or replace function public.review_join_request(req_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       public.committee_join_requests;
  v_areas text[];
  v_slug  text;
  v_name  text;
  v_email text;
begin
  select * into r from public.committee_join_requests where id = req_id;
  if not found then raise exception 'Request not found'; end if;
  if not public.is_committee_lead(r.committee_id) then
    raise exception 'Not authorized';
  end if;

  if approve then
    v_areas := case
      when coalesce(array_length(r.requested_areas, 1), 0) > 0 then r.requested_areas
      when r.requested_area is not null then array[r.requested_area]
      else '{}'::text[]
    end;
    -- Strip anything that isn't a real area for this committee (e.g. "general").
    if v_areas is not null and array_length(v_areas, 1) is not null then
      select coalesce(array_agg(a), '{}') into v_areas
      from unnest(v_areas) a
      where lower(btrim(a)) <> 'general' and btrim(a) <> ''
        and public.valid_committee_areas(r.committee_id, array[a]);
    end if;

    -- An empty request never clears existing areas — only a non-empty one can
    -- change them. This protects a curated roster placeholder (or someone
    -- re-requesting) from being wiped by a join path that didn't ask for
    -- anything specific.
    insert into public.committee_members (committee_id, user_id, areas)
    values (r.committee_id, r.user_id, v_areas)
    on conflict (committee_id, user_id) do update
      set areas = case
        when array_length(excluded.areas, 1) is null then public.committee_members.areas
        else excluded.areas
      end;

    select slug into v_slug from public.committees where id = r.committee_id;
    select coalesce(nullif(btrim(display_name), ''), 'Member'),
           nullif(btrim(contact_email), '')
      into v_name, v_email
      from public.profiles where id = r.user_id;

    insert into public.committee_roster
      (committee_slug, name, email, roles, linked_user_id, updated_at, updated_by)
    values (v_slug, v_name, v_email, v_areas, r.user_id, now(), auth.uid())
    on conflict (committee_slug, name) do update
      set roles          = case
            when array_length(excluded.roles, 1) is null then public.committee_roster.roles
            else excluded.roles
          end,
          email          = coalesce(public.committee_roster.email, excluded.email),
          linked_user_id = r.user_id,
          updated_at     = now(),
          updated_by     = auth.uid();
  end if;

  update public.committee_join_requests
    set status      = case when approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = req_id;
end;
$$;
revoke all on function public.review_join_request(uuid, boolean) from public, anon;
grant execute on function public.review_join_request(uuid, boolean) to authenticated;

-- ── Data repair: restore Meher's roles, wiped by this bug just now ────────────
update public.committee_roster
   set roles = array['Entertainment & Games', 'Art & Decorating'], updated_at = now()
 where committee_slug = 'family-fest' and name = 'Meher';

update public.committee_members
   set areas = array['Entertainment & Games', 'Art & Decorating']
 where user_id = (select linked_user_id from public.committee_roster where committee_slug = 'family-fest' and name = 'Meher')
   and committee_id = (select id from public.committees where slug = 'family-fest');
