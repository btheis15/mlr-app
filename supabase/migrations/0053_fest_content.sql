-- Family Fest content as editable, shared data (instead of hardcoded in both apps).
-- Holds the schedule, dinners, payees, anytime activities, and fest config so
-- admins / Family Fest committee members can edit it in-app and both the web app
-- and iOS show the same thing. Reads are public (browse-first); writes are gated
-- to can_edit_fest(). Year-keyed so future fests are supported.

-- ── Who may edit fest content: app admins OR members of the family-fest committee ──
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
      select 1
      from public.committee_members m
      join public.committees c on c.id = m.committee_id
      where m.user_id = auth.uid() and c.slug = 'family-fest'
    );
$$;
revoke all on function public.can_edit_fest() from public, anon;
grant execute on function public.can_edit_fest() to authenticated;

-- ── Config (one row per fest year) ────────────────────────────────────────────
create table if not exists public.fest_config (
  fest_year   int primary key,
  name        text not null,
  tagline     text,
  start_date  date not null,
  end_date    date not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

-- ── Dues tiers (Adult / Kid / per-day / without-food / …; each amount editable) ──
create table if not exists public.fest_dues (
  id         uuid primary key default gen_random_uuid(),
  fest_year  int not null default 2026,
  label      text not null,             -- e.g. "Adult (high school & up)"
  amount     int,                       -- null = TBD
  note       text,                      -- optional ("per person", "covers meals", …)
  position   int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
create index if not exists fest_dues_year_idx on public.fest_dues (fest_year, position);

-- ── Schedule: headline activities (multiple per day) ──────────────────────────
create table if not exists public.fest_schedule_items (
  id            uuid primary key default gen_random_uuid(),
  fest_year     int not null default 2026,
  day           date not null,
  start_time    text,                    -- freeform / null = TBD
  end_time      text,
  title         text not null,
  emoji         text,
  location      text,
  description   text,
  bring         text,                    -- optional "what to bring"
  is_private    boolean not null default false,
  lead_user_id  uuid references public.profiles (id) on delete set null,  -- linked member
  lead_name     text,                    -- fallback when not a member
  lead_phone    text,                    -- fallback contact
  position      int not null default 0,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null
);
create index if not exists fest_schedule_year_day_idx on public.fest_schedule_items (fest_year, day, position);

-- ── Dinners (one+ per night) ──────────────────────────────────────────────────
create table if not exists public.fest_dinners (
  id              uuid primary key default gen_random_uuid(),
  fest_year       int not null default 2026,
  day             date not null,
  title           text not null,
  emoji           text,
  chef_user_id    uuid references public.profiles (id) on delete set null,
  chef_name       text,
  chef_phone      text,
  houses          text[] not null default '{}',
  menu            text,
  served_time     text,
  served_location text,
  prep_time       text,
  prep_location   text,
  position        int not null default 0,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null
);
create index if not exists fest_dinners_year_day_idx on public.fest_dinners (fest_year, day, position);

-- ── Payees (who to pay; dues amount lives on fest_config) ─────────────────────
create table if not exists public.fest_payees (
  id         uuid primary key default gen_random_uuid(),
  fest_year  int not null default 2026,
  name       text not null,
  role       text,
  venmo      text,
  zelle      text,
  applecash  text,
  paypal     text,
  amount     int,                        -- optional per-payee override
  note       text,
  position   int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- ── Anytime activities (scavenger hunt, etc.) ─────────────────────────────────
create table if not exists public.fest_activities (
  id         uuid primary key default gen_random_uuid(),
  fest_year  int not null default 2026,
  title      text not null,
  emoji      text,
  blurb      text,
  details    text,
  location   text,
  position   int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- ── RLS: anyone may read (browse-first); only fest editors may write ──────────
do $$
declare t text;
begin
  foreach t in array array[
    'fest_config', 'fest_dues', 'fest_schedule_items', 'fest_dinners', 'fest_payees', 'fest_activities'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($p$drop policy if exists "%1$s read" on public.%1$I;$p$, t);
    execute format($p$create policy "%1$s read" on public.%1$I for select using (true);$p$, t);
    execute format($p$drop policy if exists "%1$s write" on public.%1$I;$p$, t);
    execute format($p$create policy "%1$s write" on public.%1$I for all
                      using (public.can_edit_fest()) with check (public.can_edit_fest());$p$, t);
  end loop;
end $$;

-- ── Seed: the current 2026 content (so day one is identical) ──────────────────
insert into public.fest_config (fest_year, name, tagline, start_date, end_date)
values (2026, 'Family Fest 2026', 'One week. The whole clan. The lake.', '2026-07-27', '2026-07-31')
on conflict (fest_year) do nothing;

-- Dues tiers — all amounts TBD until set in the planner.
insert into public.fest_dues (fest_year, label, amount, note, position)
values
  (2026, 'Adult (high school & up)', null, null, 0),
  (2026, 'Kid (K–8th grade)',        null, null, 1),
  (2026, 'Per day',                  null, 'per person', 2),
  (2026, 'Without food',             null, 'per person', 3);

insert into public.fest_schedule_items (fest_year, day, title, emoji, location, description, lead_name, position)
values
  (2026, '2026-07-27', 'Games Up Top',  '🏅', 'TBD', 'Details TBD.', null, 0),
  (2026, '2026-07-28', 'Lake Day',      '🏖️', 'TBD', 'Details TBD.', null, 1),
  (2026, '2026-07-29', 'Golf Outing',   '⛳', 'TBD', 'Details TBD.', null, 2),
  (2026, '2026-07-30', 'Variety Show',  '🎭', 'TBD', 'Hosted by Michelle Birkholz. Details TBD.', 'Michelle Birkholz', 3),
  (2026, '2026-07-31', 'TBD',           '🗓️', 'TBD', 'Details TBD.', null, 4);

insert into public.fest_dinners (fest_year, day, title, emoji, chef_name, menu, served_time, served_location, prep_time, position)
values
  (2026, '2026-07-27', 'Monday Dinner',    '🍽️', 'Jessica Stewart',            'TBD', 'TBD', 'TBD', 'TBD', 0),
  (2026, '2026-07-28', 'Tuesday Dinner',   '🍽️', 'Natalie de Pareja & Karen',  'TBD', 'TBD', 'TBD', 'TBD', 1),
  (2026, '2026-07-29', 'Wednesday Dinner', '🍽️', 'Lauren Zerfas',              'TBD', 'TBD', 'TBD', 'TBD', 2),
  (2026, '2026-07-30', 'Thursday Dinner',  '🍽️', 'Rob & Joe',                  'TBD', 'TBD', 'TBD', 'TBD', 3),
  (2026, '2026-07-31', 'Friday Dinner',    '🍽️', 'TBD',                        'TBD', 'TBD', 'TBD', 'TBD', 4);

insert into public.fest_payees (fest_year, name, role, venmo, position)
values (2026, 'Cathy Hofer', 'Family Fest dues — collects for the week', 'Cathy-Hofer-1', 0);

insert into public.fest_activities (fest_year, title, emoji, blurb, details, location, position)
values (2026, 'Family Fest scavenger hunt', '🗺️',
        'Track down hidden landmarks & oddities around the lake — any time, all week.',
        'Pick up a hunt card at the lodge, then find each spot around Muskellunge Lake at your own pace — solo, as a family, or as a house. Finish the list any day and turn it in at the lodge for a prize at the farewell BBQ.',
        'Pick up your card at the Main Lodge', 0);
