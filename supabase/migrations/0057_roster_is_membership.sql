-- Make the committee ROSTER the single source of membership.
--
-- Previously two things tracked membership: committee_members (the "chat members"
-- list) and committee_roster (the public roster that auto-links to accounts on
-- verify). That was redundant. Now: you're a member of a committee if your
-- account is linked to a roster entry (committee_roster.linked_user_id) — or
-- you're an app admin. Chat read/post (which lean on is_committee_member) and
-- Family Fest editing (can_edit_fest) both follow the roster, so a "Pending
-- verification" person gains chat access automatically the moment they verify.
--
-- committee_members is left in place (harmless) but no longer drives access.

create or replace function public.is_committee_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    or exists (
      select 1
      from public.committee_roster r
      join public.committees c on c.slug = r.committee_slug
      where c.id = cid and r.linked_user_id = auth.uid()
    );
$$;

-- Family Fest editing follows the same roster membership (admin OR linked
-- family-fest roster member).
create or replace function public.can_edit_fest()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    or exists (
      select 1 from public.committee_roster r
      where r.committee_slug = 'family-fest' and r.linked_user_id = auth.uid()
    );
$$;

revoke all on function public.can_edit_fest() from public, anon;
grant execute on function public.can_edit_fest() to authenticated;
