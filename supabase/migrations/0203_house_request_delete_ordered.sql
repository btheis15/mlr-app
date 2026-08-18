-- 0203_house_request_delete_ordered.sql
--
-- Let an ORDERED request be deleted.
--
-- PR #568 made `ordered` the END of the line for a purchase or an idea — there's
-- no "it arrived" step, since something ordered obviously turns up. The client
-- followed (isSettled counts it as done, so it lands in the Done filter and shows
-- a Delete button), but 0201/0202's delete gate still classed `ordered` as "in
-- progress" and refused. So the button was there and the RPC said no.
--
-- Recreated from 0202 §3's body — its current production form — with `ordered`
-- moved into the deletable list. Only `pending` and `approved` block now, and for
-- the right reasons:
--   • pending  — deny it instead, so the requester gets a note and a name rather
--                than watching their ask vanish;
--   • approved — that's the "somebody still has to buy this" state the whole
--                feature exists to keep visible.
--
-- Apply after 0202.

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

  -- Your own test row: always yours to remove (0202).
  if r.test_only and r.created_by = v_uid then
    delete from public.house_requests where id = p_id;
    return;
  end if;

  if not public.can_review_house_request(r.house_id) then
    raise exception 'Only a House Admin can remove this';
  end if;

  -- `ordered` is now terminal, so it joins received/denied/withdrawn as fair game.
  if not r.test_only and r.status not in ('ordered', 'received', 'denied', 'withdrawn') then
    if r.status = 'approved' then
      raise exception 'Nobody has bought this yet — mark it ordered first, or turn it down';
    else
      raise exception 'Turn it down instead of deleting it, so they know what happened';
    end if;
  end if;

  delete from public.house_requests where id = p_id;
end;
$$;
revoke all on function public.delete_house_request(uuid) from public, anon;
grant execute on function public.delete_house_request(uuid) to authenticated;

-- ── What's deletable now ─────────────────────────────────────────────────────
select r.title, r.status, r.test_only,
       (r.test_only or r.status in ('ordered','received','denied','withdrawn')) as can_delete
  from public.house_requests r
 order by r.created_at desc;
