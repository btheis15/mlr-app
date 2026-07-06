-- 0072_house_rules.sql
-- "House Rules": a simple shared, editable open-text doc per house (like a
-- lightweight group note), shown as a card in the House Hub. Editable by ANY
-- member of the house (or an admin) — not admin-only — so we bypass the houses
-- table's admin-write policy (0064) through a SECURITY DEFINER RPC gated on
-- is_house_member() (0064), matching set_member_house / mark_house_read.
--
-- Storage is a single free-text column on the house row (last-write-wins, no
-- history for now). World-readable like the rest of the house row (0064's public
-- read policy already exposes it). Apply in the Supabase SQL editor after 0071.

alter table public.houses
  add column if not exists rules text not null default '';

-- Set the house's rules — any member of that house (admins pass via
-- is_house_member). Length-capped defensively. Last write wins.
create or replace function public.set_house_rules(hid uuid, p_rules text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_house_member(hid) then raise exception 'Not a member of this house'; end if;
  update public.houses
    set rules = left(coalesce(p_rules, ''), 20000)
    where id = hid;
end;
$$;
revoke all on function public.set_house_rules(uuid, text) from public, anon;
grant execute on function public.set_house_rules(uuid, text) to authenticated;
