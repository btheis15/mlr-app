-- Admin approval before a signup becomes a real member.
--
-- ⚠️ THE HOLE THIS CLOSES
--
-- Anyone can sign up with any email address, verify the OTP, and immediately read
-- everything a member can: posts, chat, the Drop Box albums, and every member's
-- phone number and address. There is currently no gate at all between "typed an
-- email" and "full access to the family's private content".
--
-- After this, a new signup sees what a signed-out visitor sees until an app admin
-- approves them.
--
-- ⚠️⚠️ THIS FILE IS ONLY STEP 1 (the column, the predicate, and the admin RPC).
-- It does NOT yet change the ~40 read policies that currently key off
-- `auth.uid() is not null`. Until those are swapped to is_approved_member(), an
-- unapproved user can still read that data DIRECTLY from the Supabase REST API
-- even though the app's UI hides it — this app is a PWA using the member's own
-- token, so the client is not an enforcement boundary. Step 2 must be done
-- table-by-table with judgement, NOT a blind find/replace, because several of
-- those policies also cover a member reading THEIR OWN row and would lock an
-- unapproved user out of their own profile and sign-in flow.

-- 1. The flag. NOT NULL with a false default, so every existing row is set false
--    here and then flipped true by the backfill in step 2 — order matters.
alter table profiles add column if not exists approved boolean not null default false;
alter table profiles add column if not exists approved_at timestamptz;
-- on delete set null: delete_member() hard-deletes via auth.users cascade, and a
-- plain FK here would make deleting an admin FAIL once they'd approved anyone.
alter table profiles add column if not exists approved_by uuid references profiles(id) on delete set null;

-- 2. Backfill: everyone who already has access keeps it. Doing this BEFORE the
--    default takes effect for new rows is what stops this migration locking the
--    whole family out of their own app.
update profiles set approved = true, approved_at = now() where approved = false;

-- 3. New signups start unapproved. The on_auth_user_created trigger inserts the
--    profile row, and the column default (false) now applies to it.

-- 4. The predicate every read policy should use instead of `auth.uid() is not null`.
--    SECURITY DEFINER so it can read profiles regardless of the caller's own
--    (about to be restricted) access to that table.
create or replace function is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
     where id = auth.uid()
       and (approved is true or is_admin is true)  -- an admin is implicitly approved
  );
$$;

revoke all on function is_approved_member() from public;
grant execute on function is_approved_member() to authenticated, anon;

-- 5. Admin-only approve/revoke. Mirrors set_admin()/set_member_house(): the column
--    is deliberately NOT in any client update grant, so this RPC is the only write
--    path and a member can never approve themselves.
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
         approved_at = case when p_value then now() else null end,
         approved_by = case when p_value then auth.uid() else null end
   where id = p_user;
end;
$$;

revoke all on function set_member_approved(uuid, boolean) from public;
grant execute on function set_member_approved(uuid, boolean) to authenticated;

-- 6. The admin UI reads profiles.approved DIRECTLY rather than widening
--    admin_members(). That function has been recreated by several migrations, and
--    per the 0160 lesson recreating it from an older copy silently drops whatever
--    the newest version added. profiles is already members-readable, so an admin
--    can simply select id/approved and join it to the directory client-side.

comment on column profiles.approved is
  'Admin-approved member. False = signup exists but sees only what a signed-out visitor sees. Set only via set_member_approved().';

-- Sanity check — run this after and confirm pending = 0 (everyone existing keeps
-- access; only NEW signups will start unapproved).
select count(*) filter (where approved) as approved,
       count(*) filter (where not approved) as pending,
       count(*) as total
  from profiles;
