-- 0045_member_intro.sql
-- First-run "Welcome" intro for brand-new members. The first time someone
-- verifies their sign-in code and their profile is still essentially empty, the
-- app pops a guided multi-step sheet (WelcomeIntro): a welcome + a short form for
-- the basics (phone, birthday, preferred payment) and then the push-notification
-- settings — so a newcomer never has to discover Settings on their own.
--
-- `intro_seen` drives the one-time show. New profiles default to FALSE (show it);
-- everyone who already has an account is backfilled to TRUE so the current family
-- is never re-onboarded. The app reads this column in a *separate, guarded* query,
-- so until this migration runs the intro simply stays dormant — sign-in and the
-- rest of the app are unaffected.
--
-- Apply: paste into the Supabase SQL editor and Run.

alter table public.profiles
  add column if not exists intro_seen boolean not null default false;

-- Don't re-onboard anyone who already has an account.
update public.profiles set intro_seen = true;

-- Members may set their own intro flag (column-level grant, same guardrail
-- pattern as push_prompted in 0034 — still can't touch is_admin etc.). RLS
-- "profiles: update own" still restricts it to auth.uid() = id.
grant update (intro_seen) on public.profiles to authenticated;
