-- Committee roster as shared, self-linking data.
--
-- The roster (who's on a committee, with their roles) used to be hardcoded in
-- the web app (lib/data COMMITTEES) and invisible to iOS. Move it to the DB so
-- both apps show the same people, it can be edited, and — crucially — each slot
-- AUTO-LINKS to a real account when someone verifies with the matching email:
-- `linked_user_id` is stamped by a trigger on profiles.contact_email, so a
-- placeholder upgrades to the person's account (avatar, real name, contact) with
-- no duplicate. Reads are public; writes are admin-gated. Keyed by committee
-- slug (the apps key committees by slug). Separate from committee_members, which
-- is the chat-access control list.

create table if not exists public.committee_roster (
  id             uuid primary key default gen_random_uuid(),
  committee_slug text not null,
  name           text not null,
  email          text,                         -- claim key: matched to profiles.contact_email
  phone          text,
  roles          text[] not null default '{}', -- e.g. {'Meals · Lead','Logistics, Scheduling & Finance'}
  position       int not null default 0,
  linked_user_id uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id) on delete set null,
  unique (committee_slug, name)
);
create index if not exists committee_roster_slug_idx on public.committee_roster (committee_slug, position);

alter table public.committee_roster enable row level security;

drop policy if exists "committee_roster read" on public.committee_roster;
create policy "committee_roster read" on public.committee_roster for select using (true);

drop policy if exists "committee_roster write" on public.committee_roster;
create policy "committee_roster write" on public.committee_roster for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ── Auto-link: stamp linked_user_id when a profile's email matches a slot ──────
create or replace function public.link_committee_roster()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contact_email is not null and length(trim(new.contact_email)) > 0 then
    update public.committee_roster r
       set linked_user_id = new.id, updated_at = now()
     where r.email is not null
       and lower(r.email) = lower(new.contact_email)
       and r.linked_user_id is distinct from new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists link_committee_roster_trg on public.profiles;
create trigger link_committee_roster_trg
  after insert or update of contact_email on public.profiles
  for each row execute function public.link_committee_roster();

-- ── Seed: the current Family Fest roster (positions preserve the listed order) ─
insert into public.committee_roster (committee_slug, name, email, phone, roles, position)
values
  ('family-fest', 'Lauren Zerfas',          null,                      null,           array['Meals · Lead'], 0),
  ('family-fest', 'Jessica Stewart',         null,                      null,           array['Meals','Merchandise, Fundraising & Polling','Logistics, Scheduling & Finance'], 1),
  ('family-fest', 'Rob Hermanson',           'rob.hermanson@yahoo.com', null,           array['Meals','Logistics, Scheduling & Finance'], 2),
  ('family-fest', 'Lisa Gorge',              'lisagorge20@gmail.com',   null,           array['Meals'], 3),
  ('family-fest', 'Matthew Vinezeano',       'mvinezeano10@gmail.com',  null,           array['Meals','Entertainment & Games'], 4),
  ('family-fest', 'Kity Theis',              'grandmakity@gmail.com',   null,           array['Meals','Logistics, Scheduling & Finance'], 5),
  ('family-fest', 'Natalie Theis de Pareja', 'windycity531@yahoo.com',  null,           array['Meals','Entertainment & Games'], 6),
  ('family-fest', 'Keith Thibodeau',         'kay.are.tibbs@gmail.com', null,           array['Entertainment & Games · Lead'], 7),
  ('family-fest', 'Rick Gorge',              'rickgorge@gmail.com',     null,           array['Entertainment & Games','Merchandise, Fundraising & Polling · Lead'], 8),
  ('family-fest', 'Markus Hofer',            'hofermarkus82@gmail.com', null,           array['Entertainment & Games'], 9),
  ('family-fest', 'Karen Theis',             'kaelth6255@gmail.com',    null,           array['Entertainment & Games'], 10),
  ('family-fest', 'Zack Kauranen',           'zkauranen@yahoo.com',     null,           array['Entertainment & Games'], 11),
  ('family-fest', 'Abbie Theis',             'theisabigail@gmail.com',  null,           array['Entertainment & Games','Art & Decorating','Merchandise, Fundraising & Polling'], 12),
  ('family-fest', 'Brian Theis',             'brian.theis15@gmail.com', '+12248005389', array['Entertainment & Games','Merchandise, Fundraising & Polling','Logistics, Scheduling & Finance'], 13),
  ('family-fest', 'Jenny Snively',           'jayellebee29@gmail.com',  null,           array['Art & Decorating · Lead'], 14),
  ('family-fest', 'Christy Gorge',           'christymgorge@gmail.com', null,           array['Art & Decorating'], 15),
  ('family-fest', 'Lindsay Thibodeau',       'lindsayfier@gmail.com',   null,           array['Art & Decorating'], 16),
  ('family-fest', 'Ellie',                   null,                      null,           array['Art & Decorating'], 17),
  ('family-fest', 'Michelle Birkholz',       'michellebirkholz@gmail.com', null,        array['Art & Decorating'], 18),
  ('family-fest', 'Cathy Hofer',             'cathanndude@gmail.com',   null,           array['Logistics, Scheduling & Finance · Lead'], 19),
  ('family-fest', 'Cassie Paparigian',       'cpaparigian@gmail.com',   null,           array['Logistics, Scheduling & Finance'], 20)
on conflict (committee_slug, name) do nothing;

-- One-time backfill: link any slots whose email already has a verified account.
update public.committee_roster r
   set linked_user_id = p.id, updated_at = now()
  from public.profiles p
 where r.email is not null
   and lower(p.contact_email) = lower(r.email)
   and r.linked_user_id is distinct from p.id;
