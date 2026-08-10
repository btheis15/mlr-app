-- Auto-approve people whose email was already registered by an admin.
--
-- WHY 0181 WASN'T ENOUGH
--
-- 0181 backfilled every existing profile to approved (56 members, 0 pending). But
-- people an admin has ALREADY put in the rosters — committee_roster / family_roster
-- entries with an email and no linked account yet — have NO profiles row at all.
-- They'd sign up months later, land as approved=false, and sit there waiting on a
-- manual tap even though the admin had explicitly added them by name and email.
--
-- The intent is "gate people who aren't already known to us", not "gate everyone
-- who happens to be slow to sign up". Those roster emails ARE the admin's own list,
-- and they're already the trusted claim key for auto-linking a roster slot to a new
-- account (0056/0060). Approval reuses exactly that trust.
--
-- Anyone NOT in the rosters and NOT already a member still gets gated, which is
-- the whole point.

-- 1. approved_at becomes "when the last approval decision was made", not "when
--    approved". This gives us a reliable "has a human ever decided about this
--    person?" signal, which the trigger below needs so it can never override an
--    admin's deliberate revoke.
create or replace function set_member_approved(p_user uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin is true) then
    raise exception 'Only app admins can approve members';
  end if;
  update profiles
     set approved = p_value,
         -- Always stamped, on approve AND revoke, so `approved_at is null` means
         -- "never decided" rather than "not currently approved".
         approved_at = now(),
         approved_by = auth.uid()
   where id = p_user;
end;
$$;

revoke all on function set_member_approved(uuid, boolean) from public;
grant execute on function set_member_approved(uuid, boolean) to authenticated;

comment on column profiles.approved_at is
  'When the last approval decision was made (approve OR revoke). NULL = no admin has ever decided, which is what lets the pre-registered auto-approval fire exactly once.';

-- 2. Is this email on an admin-maintained roster? Trim/case-insensitive, matching
--    how 0056/0060 already match roster emails to profiles.contact_email.
create or replace function is_preregistered_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from committee_roster
     where email is not null
       and lower(btrim(email)) = lower(btrim(p_email))
  ) or exists (
    select 1 from family_roster
     where email is not null
       and lower(btrim(email)) = lower(btrim(p_email))
  );
$$;

revoke all on function is_preregistered_email(text) from public;

-- 3. Approve on signup when the email was pre-registered.
--
-- Fires on INSERT (the on_auth_user_created trigger creates the profile) and on a
-- later UPDATE of contact_email (Supabase may seed it after the row exists, and an
-- admin can correct an email during the override window).
--
-- ⚠️ Guarded on `approved_at is null` — "no human has decided yet". Without that,
-- an admin who deliberately REVOKED someone would see them silently re-approved the
-- next time their email was touched, which would make revoke useless.
create or replace function auto_approve_preregistered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approved is not true
     and new.approved_at is null
     and new.contact_email is not null
     and is_preregistered_email(new.contact_email)
  then
    new.approved := true;
    new.approved_at := now();
    -- approved_by stays NULL: nobody tapped a button, the roster entry did it.
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_approve_preregistered on profiles;
create trigger trg_auto_approve_preregistered
  before insert or update of contact_email on profiles
  for each row
  execute function auto_approve_preregistered();

-- 4. Catch anyone already in this state (a roster email that somehow has an
--    unapproved profile). Expected to affect 0 rows right now.
update profiles p
   set approved = true, approved_at = now()
 where p.approved is not true
   and p.approved_at is null
   and p.contact_email is not null
   and is_preregistered_email(p.contact_email);

-- 5. Confirm: who is on a roster but has no account yet? These are the people this
--    migration protects — they'll be auto-approved whenever they sign up.
select 'roster emails with no account yet' as what, count(*) as n
  from (
    select lower(btrim(email)) as e from committee_roster where email is not null
    union
    select lower(btrim(email)) from family_roster where email is not null
  ) r
 where not exists (
   select 1 from profiles p where lower(btrim(p.contact_email)) = r.e
 )
union all
select 'members approved', count(*) from profiles where approved
union all
select 'members pending (should be 0)', count(*) from profiles where not approved;
