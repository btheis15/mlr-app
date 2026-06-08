-- 0027_admin_set_member_profile.sql
-- Let an admin edit ANOTHER member's profile info (name, household, phone,
-- contact/pay handles, birthday, address, bio) — the same "Edit a member's
-- information" backup as the email change, gated identically: caller must be an
-- admin AND the two-admin override window must be open (migration 0025). The
-- login email itself still goes through the mini's /admin/set-email (it lives in
-- auth.users); this RPC covers everything in public.profiles.
--
-- Safety: SECURITY DEFINER (bypasses the own-row UPDATE policy) but writes only
-- an allow-listed set of columns — never id, is_admin, push prefs, or email_alerts
-- — and only while unlocked. Present-key semantics: a field is changed only if its
-- key is in `patch` (so the form can send a subset); empty string clears to null.
--
-- Apply: paste into the Supabase SQL editor and Run.

create or replace function public.admin_set_member_profile(target uuid, patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target is null then
    raise exception 'No member specified';
  end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if not coalesce((select unlocked_until from public.admin_override where id = 1) > now(), false) then
    raise exception 'Admin editing is locked. Two admins must unlock it first.';
  end if;

  update public.profiles p set
    display_name      = case when patch ? 'display_name'      then nullif(btrim(patch->>'display_name'), '')      else p.display_name end,
    full_name         = case when patch ? 'full_name'         then nullif(btrim(patch->>'full_name'), '')         else p.full_name end,
    household         = case when patch ? 'household'         then nullif(btrim(patch->>'household'), '')         else p.household end,
    bio               = case when patch ? 'bio'               then nullif(btrim(patch->>'bio'), '')               else p.bio end,
    phone             = case when patch ? 'phone'             then nullif(btrim(patch->>'phone'), '')             else p.phone end,
    contact_email     = case when patch ? 'contact_email'     then nullif(btrim(patch->>'contact_email'), '')     else p.contact_email end,
    venmo             = case when patch ? 'venmo'             then nullif(btrim(patch->>'venmo'), '')             else p.venmo end,
    zelle             = case when patch ? 'zelle'             then nullif(btrim(patch->>'zelle'), '')             else p.zelle end,
    cashapp           = case when patch ? 'cashapp'           then nullif(btrim(patch->>'cashapp'), '')           else p.cashapp end,
    paypal            = case when patch ? 'paypal'            then nullif(btrim(patch->>'paypal'), '')            else p.paypal end,
    pay_preferred     = case when patch ? 'pay_preferred'     then nullif(btrim(patch->>'pay_preferred'), '')     else p.pay_preferred end,
    contact_preferred = case when patch ? 'contact_preferred' then nullif(btrim(patch->>'contact_preferred'), '') else p.contact_preferred end,
    address           = case when patch ? 'address'           then nullif(btrim(patch->>'address'), '')           else p.address end,
    birthday          = case when patch ? 'birthday'          then nullif(patch->>'birthday', '')::date           else p.birthday end,
    apple_cash        = case when patch ? 'apple_cash'        then coalesce((patch->>'apple_cash')::boolean, false) else p.apple_cash end
  where p.id = target;

  if not found then
    raise exception 'Member not found';
  end if;
end;
$$;

revoke all on function public.admin_set_member_profile(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_member_profile(uuid, jsonb) to authenticated;
