-- Committee join requests: multiple requested areas + roster membership on approval.
--
-- Two changes drove this:
--   1. A requester can now ask for MORE THAN ONE area (e.g. "Meals" + "Art &
--      Decorating") when joining a role-based committee like Family Fest. The
--      single `requested_area text` (0051) becomes `requested_areas text[]`.
--   2. Membership is roster-based since 0057 (is_committee_member checks
--      committee_roster.linked_user_id, NOT committee_members). Approval used to
--      only touch committee_members, so approved people never appeared on the
--      roster or gained chat access. review_join_request now ALSO upserts a
--      committee_roster row linking the user with their requested areas as roles.
--
-- Also retargets the committee_join_request notification's entity to the REQUEST
-- id (was the committee id) so the phone push can approve that specific request
-- inline; the media-server resolves the committee id from the request row.
--
-- After applying: pull + restart the mini (`com.mlr.media-server`) for the
-- apns-sender change that pairs with this.

-- ── 1. Schema + backfill ──────────────────────────────────────────────────────

alter table public.committee_join_requests
  add column if not exists requested_areas text[] not null default '{}';

-- Carry any existing single-area requests into the array so nothing is lost.
update public.committee_join_requests
   set requested_areas = array[requested_area]
 where requested_area is not null
   and requested_areas = '{}';

-- ── 2. request_to_join: accept an array of areas ──────────────────────────────
-- Replace the single-area (uuid,text,text) version with an array version. Callers
-- that pass no area (e.g. committee chat "Request to join") still work via the
-- '{}' default; callers that picked areas pass requested_areas. We keep writing
-- requested_area (element 1) so any legacy read still sees a value.

drop function if exists public.request_to_join(uuid, text, text);

create function public.request_to_join(
  cid             uuid,
  msg             text    default null,
  requested_areas text[]  default '{}'
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
    (committee_id, user_id, message, requested_area, requested_areas, status)
  values (
    cid, auth.uid(), msg,
    (request_to_join.requested_areas)[1],                 -- legacy single-area column
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

-- ── 3. review_join_request: on approve, set areas AND add to the roster ───────
-- The roster upsert is the membership fix (0057): without it an approved member
-- has no chat access and doesn't appear on the committee.

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
    -- Prefer the array; fall back to the legacy single area; else none.
    v_areas := case
      when coalesce(array_length(r.requested_areas, 1), 0) > 0 then r.requested_areas
      when r.requested_area is not null then array[r.requested_area]
      else '{}'::text[]
    end;

    -- (a) chat-access list (kept in sync with membership).
    insert into public.committee_members (committee_id, user_id, areas)
    values (r.committee_id, r.user_id, v_areas)
    on conflict (committee_id, user_id) do update set areas = excluded.areas;

    -- (b) roster row — the actual source of membership since 0057. Keyed by
    -- (committee_slug, name); we set linked_user_id directly so access works even
    -- when the roster email doesn't match, and preserve any curated email.
    select slug into v_slug from public.committees where id = r.committee_id;
    select coalesce(nullif(btrim(display_name), ''), 'Member'),
           nullif(btrim(contact_email), '')
      into v_name, v_email
      from public.profiles where id = r.user_id;

    insert into public.committee_roster
      (committee_slug, name, email, roles, linked_user_id, updated_at, updated_by)
    values (v_slug, v_name, v_email, v_areas, r.user_id, now(), auth.uid())
    on conflict (committee_slug, name) do update
      set roles          = excluded.roles,
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

-- ── 4. Point the join-request notification at the REQUEST id ──────────────────
-- Was ('committee', NEW.committee_id) — now ('committee_join_request', NEW.id) so
-- the APNs sender can approve the specific request from an inline button. The
-- in-app deep link still uses the `url` (/committees/<slug>).

create or replace function public.notif_on_join_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cname text;
  v_slug  text;
  v_name  text;
begin
  if NEW.status <> 'pending' then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.status = 'pending' then return NEW; end if;

  select name, slug into v_cname, v_slug from public.committees where id = NEW.committee_id;
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_name
    from public.profiles where id = NEW.user_id;

  perform public._notify(
    p.id, 'committee_join_request', NEW.user_id,
    v_name || ' asked to join ' || coalesce(v_cname, 'a committee'),
    nullif(btrim(NEW.message), ''),
    '/committees/' || coalesce(v_slug, ''),
    'committee_join_request', NEW.id, null)
  from public.profiles p
  where p.is_admin
     or exists (
       select 1 from public.committee_members m
       where m.committee_id = NEW.committee_id
         and m.user_id = p.id
         and m.role = 'Lead'
     );
  return NEW;
end;
$$;

drop trigger if exists trg_notif_join_request on public.committee_join_requests;
create trigger trg_notif_join_request after insert or update on public.committee_join_requests
  for each row execute function public.notif_on_join_request();
