-- 0006_member_contact_pay.sql
-- Member contact + pay info for the tap-to-open member card. Each field is
-- optional; members fill in what they want shared. `contact_preferred` /
-- `pay_preferred` mark the default option the card highlights. Public read
-- (same as the rest of profiles — this is a private family app); a member can
-- only edit their OWN row (the grant below + existing RLS).
--
-- Apply: paste into the Supabase SQL editor and Run. The app degrades
-- gracefully until this runs (the card just shows no contact/pay options).

alter table public.profiles
  add column if not exists phone text,
  add column if not exists contact_email text,
  add column if not exists venmo text,
  add column if not exists zelle text,
  add column if not exists cashapp text,
  add column if not exists paypal text,
  add column if not exists pay_preferred text,      -- 'venmo'|'zelle'|'applecash'|'cashapp'|'paypal'
  add column if not exists contact_preferred text;   -- 'text'|'call'|'email'

-- Let signed-in members edit their own new fields (extends the 0001 grant;
-- RLS "profiles: update own" still restricts it to auth.uid() = id).
grant update (phone, contact_email, venmo, zelle, cashapp, paypal, pay_preferred, contact_preferred)
  on public.profiles to authenticated;
