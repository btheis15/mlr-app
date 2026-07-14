-- 0091_admin_notif_deep_links.sql
-- Two admin-facing notification kinds pointed at the wrong place: tapping "X
-- requested a cabin stay" landed on /profile (not even the admin dashboard),
-- and tapping "X asked to join <committee>" landed on the committee's public
-- roster page — not the admin approval queue (which only lives at
-- /admin/committees, in a per-committee accordion that's closed by default).
-- Neither let an admin actually act on the notification without separately
-- navigating to Admin → Cabin requests / Committees.
--
-- Fix: point both at the admin screen that can act on them, with a query
-- param the client uses to jump straight to (and flash-highlight) the
-- specific item — mirroring the existing `/posts?post=<id>` deep-link pattern.

create or replace function public.notif_on_cabin_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cabin text;
  v_name  text;
begin
  select name into v_cabin from public.cabins where id = NEW.cabin_id;
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_name
    from public.profiles where id = NEW.user_id;
  perform public._notify(
    p.id, 'cabin_request', NEW.user_id,
    v_name || ' requested a cabin stay',
    coalesce(v_cabin, 'A cabin') || ' · ' || to_char(NEW.check_in, 'Mon FMDD') || '–' || to_char(NEW.check_out, 'Mon FMDD'),
    '/admin/cabins?booking=' || NEW.id, 'cabin_booking', NEW.id, null)
  from public.profiles p
  where p.is_admin;
  return NEW;
end;
$$;

create or replace function public.notif_on_join_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cname text;
  v_slug  text;
  v_name  text;
begin
  if NEW.status <> 'pending' then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.status = 'pending' then return NEW; end if;

  select name, slug into v_cname, v_slug from public.committees where id = NEW.committee_id;
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_name
    from public.profiles where id = NEW.user_id;

  perform public._notify(
    p.id, 'committee_join_request', NEW.user_id,
    v_name || ' asked to join ' || coalesce(v_cname, 'a committee'),
    nullif(btrim(NEW.message), ''),
    '/admin/committees?committee=' || coalesce(v_slug, ''),
    'committee_join_request', NEW.id, null)
  from public.profiles p
  where p.is_admin
     or exists (
       select 1 from public.committee_members m
       where m.committee_id = NEW.committee_id
         and m.user_id = p.id
         and m.role = 'Lead'
     );
  return NEW;
end;
$$;
