-- 0018_leave_committee.sql
-- Let a member remove THEMSELVES from a committee (leave). Anyone signed in can
-- leave any committee they're in; it removes only their own membership row (and
-- any leftover join-request, so re-joining later is clean). App-admin status and
-- an admin's moderation override are unaffected — an app admin who leaves a
-- committee can still see/moderate it. Apply after 0017.
--
-- Note: self-leave is intentionally allowed for EVERYONE, including a Lead
-- (unlike removing ANOTHER lead, which 0015 restricts to app admins) — leaving
-- is a personal choice. If a Lead leaves and a committee ends up with no lead,
-- an app admin can assign a new one via set_committee_lead.
create or replace function public.leave_committee(cid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  delete from public.committee_members where committee_id = cid and user_id = auth.uid();
  delete from public.committee_join_requests where committee_id = cid and user_id = auth.uid();
end;
$$;
revoke all on function public.leave_committee(uuid) from public, anon;
grant execute on function public.leave_committee(uuid) to authenticated;
