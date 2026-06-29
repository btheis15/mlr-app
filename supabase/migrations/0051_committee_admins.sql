-- Committee admin improvements:
--   • areas text[] on committee_members — which area(s) each member works in
--   • requested_area text on committee_join_requests — area preference on sign-up
--   • set_committee_lead now open to committee leads (not just app admins)
--   • new set_committee_areas RPC (leads + admins can assign areas)
--   • request_to_join / review_join_request updated to carry requested_area through

-- ── Schema additions ──────────────────────────────────────────────────────────

alter table public.committee_members
  add column if not exists areas text[] not null default '{}';

alter table public.committee_join_requests
  add column if not exists requested_area text;

-- ── request_to_join: add optional requested_area ──────────────────────────────
-- Drop the 2-param version and re-create with a 3rd default-null param.

drop function if exists public.request_to_join(uuid, text);

create function public.request_to_join(
  cid            uuid,
  msg            text    default null,
  requested_area text    default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  -- Already a member → nothing to do.
  if exists (
    select 1 from public.committee_members m
    where m.committee_id = cid and m.user_id = auth.uid()
  ) then return; end if;

  insert into public.committee_join_requests
    (committee_id, user_id, message, requested_area, status)
  values (cid, auth.uid(), msg, request_to_join.requested_area, 'pending')
  on conflict (committee_id, user_id) do update
    set status         = 'pending',
        message        = excluded.message,
        requested_area = excluded.requested_area,
        created_at     = now(),
        reviewed_by    = null,
        reviewed_at    = null;
end;
$$;

revoke all on function public.request_to_join(uuid, text, text) from public, anon;
grant execute on function public.request_to_join(uuid, text, text) to authenticated;

-- ── review_join_request: seed areas from requested_area when approving ────────

create or replace function public.review_join_request(req_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.committee_join_requests;
begin
  select * into r from public.committee_join_requests where id = req_id;
  if not found then raise exception 'Request not found'; end if;
  if not public.is_committee_lead(r.committee_id) then
    raise exception 'Not authorized';
  end if;
  if approve then
    insert into public.committee_members (committee_id, user_id, areas)
    values (
      r.committee_id,
      r.user_id,
      case when r.requested_area is not null then array[r.requested_area] else '{}' end
    )
    on conflict (committee_id, user_id) do nothing;
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

-- ── set_committee_lead: open to committee leads, not just app admins ──────────

create or replace function public.set_committee_lead(cid uuid, target uuid, is_lead boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- is_committee_lead() returns true for the committee's own leads AND app admins.
  if not public.is_committee_lead(cid) then
    raise exception 'Only a committee lead or app admin can set committee leads';
  end if;
  if is_lead then
    insert into public.committee_members (committee_id, user_id, role)
    values (cid, target, 'Lead')
    on conflict (committee_id, user_id) do update set role = 'Lead';
  else
    update public.committee_members
      set role = null
      where committee_id = cid and user_id = target;
  end if;
end;
$$;

revoke all on function public.set_committee_lead(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_committee_lead(uuid, uuid, boolean) to authenticated;

-- ── set_committee_areas: assign area(s) to a committee member ─────────────────

create or replace function public.set_committee_areas(cid uuid, target uuid, areas text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_committee_lead(cid) then
    raise exception 'Only a committee lead or app admin can set member areas';
  end if;
  update public.committee_members
    set areas = set_committee_areas.areas
    where committee_id = cid and user_id = target;
end;
$$;

revoke all on function public.set_committee_areas(uuid, uuid, text[]) from public, anon;
grant execute on function public.set_committee_areas(uuid, uuid, text[]) to authenticated;
