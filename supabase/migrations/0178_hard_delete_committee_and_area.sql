-- 0178_hard_delete_committee_and_area.sql
--
-- Permanent delete for committees + roles, alongside the existing ARCHIVE
-- (0112). Archive is the safe, reversible default ("delete" in the UI so far);
-- this adds a real "Delete forever" for tidying up committees/roles that were
-- archived and are genuinely dead (e.g. an empty "Beautification"). Admin-only,
-- and destructive: it purges chat history and cannot be undone.

-- ── Hard-delete a whole committee ────────────────────────────────────────────
-- Every FK child of committees(id) is ON DELETE CASCADE (committee_messages +
-- media/reactions/mentions, chat_polls + options/votes, meetings + slots/
-- availability, committee_members, committee_join_requests, committee_area_reads,
-- committee_reads), so deleting the committees row clears all of them. Only the
-- two SLUG-keyed tables (committee_roster, committee_areas) have no FK, so they
-- are removed explicitly first. committee_roster's sync triggers fire only on
-- INSERT/UPDATE, never DELETE, so this won't ripple into family_roster.
create or replace function public.delete_committee(cid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  select slug into v_slug from public.committees where id = cid;
  if v_slug is null then raise exception 'Committee not found'; end if;

  delete from public.committee_roster where committee_slug = v_slug;
  delete from public.committee_areas  where committee_slug = v_slug;
  delete from public.committees where id = cid;  -- cascades to all FK children
end;
$$;
revoke all on function public.delete_committee(uuid) from public, anon;
grant execute on function public.delete_committee(uuid) to authenticated;

-- ── Hard-delete a single role / subcommittee ─────────────────────────────────
-- The inverse of add/rename_committee_area's cascade: a role name is denormalized
-- text in several places, so a permanent delete has to purge them all —
-- otherwise history/memberships keep pointing at a role that no longer exists.
--   • committee_areas          — the allow-list row
--   • committee_roster.roles[] — 'X' AND 'X · Lead'
--   • committee_members.areas[]— 'X' AND 'X · Lead'
--   • committee_messages       — that channel's chat history (area = 'X')
--   • committee_area_reads     — unread/mute state for that channel
create or replace function public.delete_committee_area(cid uuid, p_area text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_area text := btrim(p_area);
  v_lead text := btrim(p_area) || ' · Lead';
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if v_area = '' then raise exception 'Invalid role name'; end if;
  select slug into v_slug from public.committees where id = cid;
  if v_slug is null then raise exception 'Committee not found'; end if;

  delete from public.committee_areas
    where committee_slug = v_slug and area = v_area;

  update public.committee_roster
     set roles = array_remove(array_remove(roles, v_area), v_lead),
         updated_at = now()
   where committee_slug = v_slug
     and (v_area = any(roles) or v_lead = any(roles));

  update public.committee_members m
     set areas = array_remove(array_remove(m.areas, v_area), v_lead)
    from public.committees c
   where c.id = cid and m.committee_id = c.id
     and (v_area = any(m.areas) or v_lead = any(m.areas));

  delete from public.committee_messages where committee_id = cid and area = v_area;
  delete from public.committee_area_reads where committee_id = cid and area = v_area;
end;
$$;
revoke all on function public.delete_committee_area(uuid, text) from public, anon;
grant execute on function public.delete_committee_area(uuid, text) to authenticated;
