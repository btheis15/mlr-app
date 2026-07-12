-- Home call-out cards as editable, shared data (instead of hardcoded in
-- HomeSpotlight). Each row is one swipe-away card stacked above the permanent
-- Family Fest spotlight on Home (see components/CalloutStack.tsx) — an image
-- flyer, a title/body, an optional tel:/mailto:/https action button, and a
-- show window. Reads are public (the stack renders on Home for everyone,
-- guests included); writes are gated to can_edit_fest() (app admins OR
-- family-fest committee members, defined in 0053) so the fest committee can
-- post/retire cards without full admin.

create table if not exists public.home_callouts (
  id         uuid primary key default gen_random_uuid(),
  title      text,                       -- optional headline (an image flyer may need none)
  body       text,                       -- optional supporting copy
  image_url  text,                       -- optional image (site-assets URL or a /public path)
  link_href  text,                       -- optional action: tel:… / mailto:… / https:…
  link_label text,                       -- the action button's label
  starts_on  date,                       -- null = show immediately
  ends_on    date,                       -- inclusive last day shown; null = open-ended
  dismiss_id text not null,              -- the CalloutStack session-dismissal key; version it
                                         -- (e.g. slug+date) to resurface an updated card
  position   int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);
create index if not exists home_callouts_active_idx on public.home_callouts (is_active, position);

-- ── RLS: anyone may read (Home is browse-first); only fest editors may write ──
alter table public.home_callouts enable row level security;
drop policy if exists "home_callouts read" on public.home_callouts;
create policy "home_callouts read" on public.home_callouts for select using (true);
drop policy if exists "home_callouts write" on public.home_callouts;
create policy "home_callouts write" on public.home_callouts for all
  using (public.can_edit_fest()) with check (public.can_edit_fest());

-- Realtime, so a Planner edit shows up on Home without a reload (same guarded
-- pattern as 0065 / 0068 — the publication add is idempotent).
do $$ begin alter publication supabase_realtime add table public.home_callouts; exception when duplicate_object then null; end $$;

-- ── Seed: the t-shirt order flyer this feature replaces (identical to the ──────
-- in-code fallback in lib/festContent.ts, so Home looks the same whether or not
-- this migration has run). Same dismiss_id as the old hard-coded card so a
-- swipe-away from earlier in the session still holds.
insert into public.home_callouts
  (title, body, image_url, link_href, link_label, starts_on, ends_on, dismiss_id, position, is_active)
select
  null,
  null,
  '/ff2026-tshirt-order.jpg',
  'tel:7153653195',
  '📞 Call Tricia at Metro to order',
  null,
  '2026-07-15',
  'tshirt-order-jul15-2026',
  0,
  true
where not exists (
  select 1 from public.home_callouts where dismiss_id = 'tshirt-order-jul15-2026'
);
