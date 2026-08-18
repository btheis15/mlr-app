-- 0201_house_request_delete.sql
--
-- Let a reviewer DELETE a finished request, so test rows and dead entries don't
-- pile up on the board forever.
--
-- ⚠️ WHAT CANNOT BE DELETED: a request that's still PENDING, unless it's a test
-- row. Quietly deleting someone's open ask is not the same as turning it down —
-- a denial leaves a note, a name and a timestamp the requester can see, whereas a
-- deletion just makes their request evaporate with no explanation. So a live ask
-- has to be denied or withdrawn first, and only then can it be removed. That's
-- the one rule here worth protecting.
--
-- Deletable:
--   • anything settled — received / denied / withdrawn, i.e. the "Done" list;
--   • any test_only row (0200) in ANY state, since clearing test junk is the
--     entire reason this exists and a test nobody else can see has no audit value.
--
-- Approved-but-unordered is deliberately NOT deletable either: that's the
-- "somebody still has to buy this" state the whole feature exists to keep
-- visible, and deleting it would hide exactly what shouldn't be hidden.
--
-- Attachments cascade with the row. The FILES on the mini stay until
-- orphan-sweep.js notices they're unreferenced, quarantines them for 7 days and
-- then purges — the same path as every other media deletion in this app, so
-- there's nothing extra to clean up by hand.
--
-- Apply after 0200.

create or replace function public.delete_house_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.house_requests;
begin
  select * into r from public.house_requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if not public.can_review_house_request(r.house_id) then raise exception 'Not authorized'; end if;

  if not r.test_only and r.status not in ('received', 'denied', 'withdrawn') then
    if r.status = 'approved' or r.status = 'ordered' then
      raise exception 'This is still in progress — mark it done first, or turn it down';
    else
      raise exception 'Turn it down instead of deleting it, so they know what happened';
    end if;
  end if;

  -- house_request_media cascades (0195).
  delete from public.house_requests where id = p_id;
end;
$$;
revoke all on function public.delete_house_request(uuid) from public, anon;
grant execute on function public.delete_house_request(uuid) to authenticated;

-- ── What's deletable right now ───────────────────────────────────────────────
select coalesce(h.name, 'MLR') as house,
       r.title,
       r.status,
       r.test_only,
       (r.test_only or r.status in ('received', 'denied', 'withdrawn')) as can_delete
  from public.house_requests r
  left join public.houses h on h.id = r.house_id
 order by r.created_at desc;
