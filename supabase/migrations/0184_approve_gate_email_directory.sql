-- 0184 — close the two SECURITY DEFINER functions 0183 missed.
--
-- ⚠️ WHY THIS EXISTS: 0183 swapped 29 RLS **policies** from `auth.uid() is not null`
-- to `is_approved_member()`. It contained no function statements at all, so every
-- SECURITY DEFINER function kept its old "any signed-in user" check — and a DEFINER
-- function bypasses RLS by design, which is the whole point of it. So the policy
-- lockdown had two holes straight through it.
--
-- WHAT LEAKED: a brand-new account created with any throwaway email address — no admin
-- approval, nothing — could call these two over the public REST RPC endpoint and get
-- back the family email directory:
--   * directory_recipients() → name + best email for every member AND every
--     account-less family_roster slot (68 people at the time of writing, 12 of whom
--     have never created an account)
--   * admin_recipients()     → name + email of all 7 app admins, i.e. a target list
-- Nothing else was exposed: the same caller still gets zero rows from `profiles` and
-- `family_roster` directly, which is 0183 working exactly as intended.
--
-- Verified with `pg_proc` that these are the ONLY two remaining offenders:
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
--      and pg_get_functiondef(p.oid) ilike '%auth.uid() is not null%'
--      and pg_get_functiondef(p.oid) not ilike '%is_approved_member%';
-- Re-run that after this migration; it should return no rows.
--
-- ⚠️⚠️ BOTH BODIES BELOW ARE COPIED VERBATIM FROM THE LIVE `pg_get_functiondef()`
-- OUTPUT, not from 0031/0123/0124. That is the 0160 rule: this codebase has already
-- had one incident where a function was "recreated" from an older migration's copy and
-- silently dropped an unrelated fix that had landed in between. The ONLY edit here is
-- the predicate. Diff before and after if you want to confirm.
--
-- ⚠️ `set search_path to ''` means every reference MUST be schema-qualified — hence
-- `public.is_approved_member()`, not `is_approved_member()`. Unqualified, it would fail
-- at runtime with "function does not exist" and break the admin email composer.
--
-- Wrapped in a transaction: create-or-replace of two functions the email composer
-- depends on should land together or not at all.

begin;

-- ── directory_recipients() ──────────────────────────────────────────────────────
-- Two UNION branches, and BOTH need the new predicate. Changing only the first would
-- keep leaking the 12 account-less roster emails, which are arguably the most
-- sensitive rows here (people who never signed up for anything).
create or replace function public.directory_recipients()
returns table(id uuid, name text, email text)
language sql
stable security definer
set search_path to ''
as $function$
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
    coalesce(nullif(btrim(p.contact_email), ''), u.email) as email
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_approved_member()
    and coalesce(nullif(btrim(p.contact_email), ''), u.email) is not null
  union
  select
    r.id,
    coalesce(nullif(btrim(r.name), ''), split_part(r.email, '@', 1)) as name,
    btrim(r.email) as email
  from public.family_roster r
  where public.is_approved_member()
    and r.linked_user_id is null
    and nullif(btrim(r.email), '') is not null
  order by name;
$function$;

-- ── admin_recipients() ─────────────────────────────────────────────────────────
-- `and p.is_admin` stays as the ROW filter; the predicate governs the CALLER. Those
-- are two different questions and it is easy to conflate them: an approved member is
-- allowed to email the admins, which is the legitimate use ("contact an admin").
create or replace function public.admin_recipients()
returns table(id uuid, name text, email text)
language sql
stable security definer
set search_path to ''
as $function$
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
    coalesce(nullif(btrim(p.contact_email), ''), u.email) as email
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_approved_member()
    and p.is_admin
    and coalesce(nullif(btrim(p.contact_email), ''), u.email) is not null
  order by name;
$function$;

-- `create or replace` PRESERVES existing grants, so these are belt-and-braces rather
-- than strictly required — but they cost nothing and make the intent explicit if the
-- function is ever dropped and recreated instead of replaced.
grant execute on function public.directory_recipients() to authenticated;
grant execute on function public.admin_recipients() to authenticated;

commit;

-- AFTER RUNNING, verify in the app (not just in SQL):
--   1. Open People → "Email a group" as an approved member. The Everyone and
--      App Admins recipient lists must still populate. If either is empty, the
--      likely cause is an unqualified is_approved_member() call — check the logs.
--   2. Re-run the pg_proc query in the header; expect zero rows.
-- All 56 current members are approved, so no legitimate member loses access here.
