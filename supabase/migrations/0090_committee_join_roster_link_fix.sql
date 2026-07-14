-- 0090_committee_join_roster_link_fix.sql
-- Two related bugs reported together: a brand-new member who was already
-- pre-registered in a committee's roster still gets prompted to "request to
-- join" its chat, and approving such a request can create a SECOND
-- committee_roster row for the same person instead of linking their existing
-- pre-registered slot — visibly duplicating them in the roster (e.g. "Rob"
-- showing up twice: once as the old unlinked placeholder, once as the newly
-- linked row created by the approval).
--
-- Root causes:
--  1. request_to_join()'s "already a member, no-op" guard (0076) only checked
--     committee_members — not a committee_roster row already linked to the
--     caller. The roster has been the REAL access gate since 0057, so a
--     roster-linked member could still submit (and need approval for) a join
--     request they never needed.
--  2. review_join_request()'s roster upsert (0075) matched an existing roster
--     row with `on conflict (committee_slug, name)` — an EXACT string match.
--     Any difference between the pre-registered roster name and the member's
--     chosen display_name (case, whitespace, a nickname) misses that row
--     entirely and INSERTs a new one instead of linking the existing slot.
--     This fix matches an existing UNLINKED row first by email, then by a
--     forgiving case/whitespace-insensitive name compare, and only creates a
--     new row when nothing matches — so linking an existing pre-registered
--     slot no longer depends on an exact name string.

-- ── request_to_join — no-op if already roster-linked, not just committee_members
create or replace function public.request_to_join(
  cid             uuid,
  msg             text    default null,
  requested_areas text[]  default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if public.mentions_removed_admin_role(requested_areas) then
    raise exception 'Committee Admin is no longer a role — please update to the latest version of the app, then pick a role to join.';
  end if;
  if not public.valid_committee_areas(cid, requested_areas) then
    raise exception 'Not a valid area for this committee';
  end if;
  if exists (
    select 1 from public.committee_members m
    where m.committee_id = cid and m.user_id = auth.uid()
  ) then return; end if;

  select slug into v_slug from public.committees where id = cid;
  if v_slug is not null and exists (
    select 1 from public.committee_roster r
    where r.committee_slug = v_slug and r.linked_user_id = auth.uid()
  ) then
    -- Already has real access via a linked roster slot — nothing to request.
    -- (Backfills the committee_members row too, so the "members" panel and
    -- fetchJoinState agree without needing a round-trip through approval.)
    insert into public.committee_members (committee_id, user_id)
    values (cid, auth.uid())
    on conflict (committee_id, user_id) do nothing;
    return;
  end if;

  insert into public.committee_join_requests
    (committee_id, user_id, message, requested_area, requested_areas, status)
  values (
    cid, auth.uid(), msg,
    (request_to_join.requested_areas)[1],
    coalesce(request_to_join.requested_areas, '{}'),
    'pending'
  )
  on conflict (committee_id, user_id) do update
    set status          = 'pending',
        message         = excluded.message,
        requested_area  = excluded.requested_area,
        requested_areas = excluded.requested_areas,
        created_at      = now(),
        reviewed_by     = null,
        reviewed_at     = null;
end;
$$;
revoke all on function public.request_to_join(uuid, text, text[]) from public, anon;
grant execute on function public.request_to_join(uuid, text, text[]) to authenticated;

-- ── review_join_request — link an existing unlinked roster slot instead of
--    blindly upserting on an exact name match ─────────────────────────────────
create or replace function public.review_join_request(req_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          public.committee_join_requests;
  v_areas    text[];
  v_slug     text;
  v_name     text;
  v_email    text;
  v_roster_id uuid;
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
    if v_areas is not null and array_length(v_areas, 1) is not null then
      select coalesce(array_agg(a), '{}') into v_areas
      from unnest(v_areas) a
      where lower(btrim(a)) <> 'general' and btrim(a) <> ''
        and public.valid_committee_areas(r.committee_id, array[a]);
    end if;

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

    -- Prefer linking an EXISTING unlinked slot (email match first, then a
    -- forgiving case/whitespace-insensitive name match) over creating a new
    -- row — this is what an exact-name on-conflict upsert used to miss.
    select id into v_roster_id
    from public.committee_roster
    where committee_slug = v_slug and linked_user_id is null
      and (
        (v_email is not null and lower(btrim(email)) = lower(v_email))
        or lower(btrim(name)) = lower(btrim(v_name))
      )
    order by (v_email is not null and lower(btrim(email)) = lower(v_email)) desc
    limit 1;

    if v_roster_id is not null then
      update public.committee_roster
        set roles          = case when array_length(v_areas, 1) is null then roles else v_areas end,
            email          = coalesce(email, v_email),
            linked_user_id = r.user_id,
            updated_at     = now(),
            updated_by     = auth.uid()
        where id = v_roster_id;
    else
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
