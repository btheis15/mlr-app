-- 0098_callout_completions.sql
-- Let a member mark a Home callout "done" — permanently, for them, across
-- sessions and devices — distinct from CalloutStack's existing swipe/✕
-- dismiss, which is only session-scoped (sessionStorage) and comes back next
-- time the app is opened. "Done" is for the t-shirt-order kind of callout:
-- once you've actually ordered, it should never nag you again, even after a
-- fresh session. Own-row RLS is enough here (no SECURITY DEFINER RPC needed) —
-- a member can only ever see/write their own completions.

create table if not exists public.home_callout_completions (
  callout_id   uuid not null references public.home_callouts (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (callout_id, user_id)
);

alter table public.home_callout_completions enable row level security;

drop policy if exists "home_callout_completions: own rows" on public.home_callout_completions;
create policy "home_callout_completions: own rows" on public.home_callout_completions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
