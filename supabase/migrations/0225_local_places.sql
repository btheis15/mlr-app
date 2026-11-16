-- 0225_local_places.sql
-- Local Places (the /local-places list of nearby golf / food / coffee spots) as
-- editable, shared data. It used to be hard-coded in lib/places.ts, so fixing a
-- phone number or adding a restaurant needed a code change + redeploy. This
-- table lets app admins edit every field, add a place and delete one in-app
-- (/admin/local-places); the web app and the iOS app both read it.
--
-- Reads: everyone (anon included) sees active rows; admins also see inactive
-- (hidden) ones. Writes (insert/update/delete): app admins only, via direct
-- table writes under RLS (profiles.is_admin, the same predicate as 0082). RLS
-- is enabled WITH policies on purpose: committee_areas once had RLS and no
-- policy and silently returned nothing (fixed by 0170) -- don't repeat that.
--
-- Images: uploaded to the existing public `site-assets` bucket under
-- `local-places/`. The 0055 "site-assets write" policy already allows admins
-- (can_edit_fest() = app admin OR family-fest committee), so no storage policy
-- is added or loosened here.
--
-- Seeded from lib/places.ts PLACES (kept in code only as the offline /
-- first-paint fallback). `on conflict (slug) do nothing`, so re-running never
-- clobbers an admin's later edits. Clients fall back to the in-code list ONLY
-- when the read errors, never when it returns zero rows.

begin;

create table if not exists public.local_places (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  category      text,                                  -- short "what it is" line
  place_group   text not null default 'food',          -- golf | food | coffee known; any other string = its own section
  locality      text,
  address       text,
  blurb         text,
  emoji         text,
  accent        text not null default 'primary',       -- primary | lake | campfire | sun | dusk
  image_url     text,
  website       text,
  menu_url      text,
  order_url     text,
  phone_display text,
  phone_tel     text,                                  -- E.164, e.g. "+17154534984"
  internal_href text,
  internal_cta  text,
  booking_url   text,
  booking_cta   text,
  rates_url     text,
  rates_cta     text,
  position      int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null
);
create index if not exists local_places_order_idx on public.local_places (place_group, position, name);

drop trigger if exists local_places_set_updated_at on public.local_places;
create trigger local_places_set_updated_at
  before update on public.local_places
  for each row execute function public.set_updated_at();

alter table public.local_places enable row level security;

drop policy if exists "local_places: read" on public.local_places;
create policy "local_places: read" on public.local_places
  for select to anon, authenticated
  using (is_active or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "local_places: admin insert" on public.local_places;
create policy "local_places: admin insert" on public.local_places
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "local_places: admin update" on public.local_places;
create policy "local_places: admin update" on public.local_places
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists "local_places: admin delete" on public.local_places;
create policy "local_places: admin delete" on public.local_places
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

grant select on public.local_places to anon, authenticated;
grant insert, update, delete on public.local_places to authenticated;

do $$ begin alter publication supabase_realtime add table public.local_places; exception when duplicate_object then null; end $$;

-- Seed: every entry of lib/places.ts PLACES, in its current order within each group.
insert into public.local_places
  (slug, name, category, place_group, locality, blurb, emoji, accent, website, menu_url, order_url,
   phone_display, phone_tel, internal_href, internal_cta, booking_url, booking_cta, rates_url, rates_cta, position)
values
  ('inshalla', 'Inshalla Country Club', 'Golf · Country Club', 'golf', 'Tomahawk, WI', 'Public 18-hole course with a pro shop, driving range, and bar & grill. Book your tee time right here in the app.', '⛳', 'primary', 'https://inshallacc.com', null, null, '(715) 453-3130', '+17154533130', '/tee-times', 'Book Tee Time', null, null, null, null, 0),
  ('edgewater', 'Edgewater Country Club', 'Golf · Public 9-Hole', 'golf', 'Tomahawk, WI', 'Family-friendly public 9-hole course tucked along the shores of Lake Alice, just outside town.', '⛳', 'lake', 'https://edgewaterccgolf.com', null, null, '(715) 453-3320', '+17154533320', null, null, null, null, 'https://edgewaterccgolf.com/rates', null, 1),
  ('pinewood', 'Pinewood Country Club', 'Golf · Public 18-Hole', 'golf', 'Harshaw, WI', 'Public 18-hole course open April through October, with a pro shop and online tee-time booking.', '⛳', 'primary', null, null, null, '(715) 282-5500', '+17152825500', null, null, null, null, 'https://www.pinewoodcc.com', null, 2),
  ('merrill-golf', 'Merrill Golf Club', 'Golf · Public 18-Hole', 'golf', 'Merrill, WI', '18-hole championship public course with a pro shop, lessons, and a bar & grill.', '⛳', 'sun', 'https://www.merrillgolfclub.com', null, null, '(715) 536-2529', '+17155362529', null, null, 'https://merrill-golf-club.book.teeitup.com/?course=17053', null, null, null, 3),
  ('timber-ridge', 'Timber Ridge Golf Club', 'Golf · Public 18-Hole', 'golf', 'Minocqua, WI', 'Scenic 18-hole, par-72 Northwoods course with rolling elevation changes, a short drive south of Minocqua.', '⛳', 'campfire', 'https://timberridgegolfclub.com', null, null, '(715) 356-9502', '+17153569502', null, null, 'https://www.chronogolf.com/club/19672/widget?medium=widget&source=club', null, null, null, 4),
  ('northwood-golf', 'Northwood Golf Club', 'Golf · Public 18-Hole', 'golf', 'Rhinelander, WI', '18-hole public course carved out of ancient rock and timber, with a full clubhouse, restaurant, and bar.', '⛳', 'dusk', 'https://northwoodgolfclub.com', null, null, '(715) 282-6565', '+17152826565', null, null, 'https://foreupsoftware.com/index.php/booking/22872/12171#/teetimes', null, null, null, 5),
  ('trout-lake', 'Trout Lake Golf Club', 'Golf · Public 18-Hole', 'golf', 'Arbor Vitae, WI', 'The Northwoods'' oldest 18-hole course (est. 1924), freshly renovated, with a driving range and a historic clubhouse.', '⛳', 'lake', 'https://troutlakegolf.com', null, null, '(715) 385-2189', '+17153852189', null, null, 'https://foreupsoftware.com/index.php/booking/19524/1784#/teetimes', null, null, null, 6),
  ('billy-bobs', 'Billy Bob''s Sports Bar & Grill', 'Pizza & Sports Bar', 'food', 'Tomahawk, WI', 'Our usual pizza order — plus burgers, baskets, and the big game on.', '🍕', 'campfire', 'https://billybobssportsbarandgrill.com', 'https://billybobssportsbarandgrill.com/menu/', null, '(715) 453-4984', '+17154534984', null, null, null, null, null, null, 0),
  ('tilted-loon', 'Tilted Loon', 'Bar & Grill · Pizza', 'food', 'Lake Nokomis · Tomahawk, WI', 'Lakeside saloon known for pizza, burgers, and the Friday fish fry — and it takes online orders.', '🍻', 'lake', 'https://www.tiltedloon.com', 'https://www.tiltedloon.com/menus-1', 'https://order.toasttab.com/online/tilted_loon', '(715) 453-2768', '+17154532768', null, null, null, null, null, null, 1),
  ('outboards', 'Outboards Bar & Grill', 'Sports Bar & Grill', 'food', 'Downtown Tomahawk, WI', 'Downtown bar & grill — fish fry, happy hour, and a full grill menu.', '🍔', 'sun', 'https://outboardsbarandgrill.com', 'https://outboardsbarandgrill.com/menu/', null, '(715) 224-3594', '+17152243594', null, null, null, null, null, null, 2),
  ('sideways', 'Sideways Wine & Craft Beer', 'Wine & Craft Beer', 'food', 'Downtown Tomahawk, WI', 'Wine, Wisconsin craft beer, flatbreads, and charcuterie — a relaxed night out.', '🍷', 'dusk', 'https://www.sidewayswineandcraftbeer.com', 'https://www.sidewayswineandcraftbeer.com/menu', null, '(715) 493-0826', '+17154930826', null, null, null, null, null, null, 3),
  ('northwoods-cafe', 'Northwoods Cafe & Coffeehouse', 'Cafe & Coffeehouse', 'coffee', 'Tomahawk, WI', 'A cozy, family-run downtown cafe serving breakfast, lunch, and specialty coffee drinks.', '☕', 'campfire', 'https://northwoods-cafe.square.site', null, null, '(715) 453-6280', '+17154536280', null, null, null, null, null, null, 0),
  ('whats-brewin', 'What''s Brewin'' Coffee Shop', 'Coffee House & Cafe', 'coffee', 'Downtown Tomahawk, WI', 'Downtown coffee shop pairing gourmet coffee and cold brew with homemade soups, sandwiches, baked goods, and fudge.', '☕', 'dusk', 'https://www.facebook.com/whatsbrewintomahawk/', null, null, '(715) 453-3555', '+17154533555', null, null, null, null, null, null, 1),
  ('rise-coffee', 'Rise Coffee Co.', 'Coffee & Espresso', 'coffee', 'Tomahawk, WI', 'A friendly mother-daughter drive-thru serving fresh espresso and coffee on the go.', '☕', 'sun', 'https://risecoffeetomahawk.com', null, null, '(715) 966-1311', '+17159661311', null, null, null, null, null, null, 2)

on conflict (slug) do nothing;

commit;
