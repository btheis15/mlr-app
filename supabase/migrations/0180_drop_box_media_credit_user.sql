-- 0180_drop_box_media_credit_user.sql
-- Give credit to the original creator of the content, not whoever performed
-- THIS add — e.g. an admin editing a member's Feed post and checking "also
-- add to an album" should still show the post's author as the uploader in
-- the album, not the admin who happened to be the one editing.
--
-- Widen add_drop_box_media with a trailing `p_credit_user_id` default param —
-- same "new overload, drop the stale one" shape as 0173/0174/0175 (see the
-- CLAUDE.md 0115 incident on silently coexisting overloads). Recreated
-- verbatim from 0175's current production body (the CLAUDE.md 0160 rule:
-- always recreate from the CURRENT definition, never an older copy), plus the
-- one new param.

drop function if exists public.add_drop_box_media(uuid, text, text, text, timestamptz, text);
create or replace function public.add_drop_box_media(
  p_box               uuid,
  p_url               text,
  p_type              text,
  p_thumbnail_url     text default null,
  p_captured_at       timestamptz default null,
  p_captured_at_source text default null,
  p_credit_user_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  -- Defaults to whoever is actually calling; only redirected below when the
  -- caller is an admin explicitly crediting someone else (e.g. the post's
  -- original author). A non-admin's p_credit_user_id is silently ignored —
  -- they can't attribute an upload to anyone but themselves.
  v_uploader uuid := auth.uid();
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  if p_type not in ('image', 'video') then raise exception 'Unsupported media type.'; end if;
  if not exists (select 1 from public.drop_boxes b where b.id = p_box and b.archived_at is null) then
    raise exception 'That folder is not available.';
  end if;
  if p_credit_user_id is not null and p_credit_user_id <> auth.uid()
     and exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin)
     and exists (select 1 from public.profiles pr where pr.id = p_credit_user_id)
  then
    v_uploader := p_credit_user_id;
  end if;
  insert into public.drop_box_media
      (box_id, storage_path, media_type, uploaded_by, thumbnail_url, captured_at, captured_at_source)
    values (
      p_box, p_url, p_type, v_uploader,
      nullif(btrim(coalesce(p_thumbnail_url, '')), ''),
      p_captured_at,
      case when p_captured_at is null then null
           when p_captured_at_source in ('exif', 'video', 'file', 'post') then p_captured_at_source
           else 'exif' end
    )
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_drop_box_media(uuid, text, text, text, timestamptz, text, uuid) from public, anon;
grant execute on function public.add_drop_box_media(uuid, text, text, text, timestamptz, text, uuid) to authenticated;
