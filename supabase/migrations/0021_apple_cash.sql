-- 0021_apple_cash.sql — opt-in Apple Cash, Apple-only.
-- Apple Cash is person-to-person via Messages and only works on Apple devices.
-- So a member explicitly opts in (the toggle shows only on an Apple device), and
-- the card shows Apple Cash only to viewers who are also on Apple devices.
alter table public.profiles add column if not exists apple_cash boolean not null default false;

grant update (apple_cash) on public.profiles to authenticated;
