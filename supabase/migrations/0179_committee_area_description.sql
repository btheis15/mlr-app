-- 0179_committee_area_description.sql
--
-- Descriptions for roles / subcommittees. Committees already have a description
-- (0012, edited in Admin → Committees); this gives each ROLE ("area") the same,
-- so "what is this subcommittee for?" has an answer on the committee page.

-- Additive, defaults to '' so every existing role is unaffected.
alter table public.committee_areas
  add column if not exists description text not null default '';

-- Admin-only setter (the area taxonomy is admin-managed, mirroring
-- add_/rename_/archive_committee_area). Empty string clears it.
create or replace function public.set_committee_area_description(cid uuid, p_area text, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_area text := btrim(p_area);
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if v_area = '' then raise exception 'Invalid role name'; end if;
  select slug into v_slug from public.committees where id = cid;
  if v_slug is null then raise exception 'Committee not found'; end if;

  update public.committee_areas
     set description = coalesce(btrim(p_description), '')
   where committee_slug = v_slug and area = v_area;
end;
$$;
revoke all on function public.set_committee_area_description(uuid, text, text) from public, anon;
grant execute on function public.set_committee_area_description(uuid, text, text) to authenticated;
