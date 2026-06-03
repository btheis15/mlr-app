-- 0009_admin_remove_member.sql
-- Admin: permanently remove a member. Deletes their `auth.users` row, which
-- cascades through every table keyed off it (profiles → posts, comments,
-- reactions, post_media, tags, albums — all `on delete cascade`). Gated to
-- admins; you can't delete yourself, and you can't delete another admin (demote
-- them first, so there's always at least one admin left standing).
--
-- NOTE: storage files (the `avatars` / `post-photos` buckets and any media on
-- the Mac mini) are NOT removed by the FK cascade — only database rows are.
-- Orphaned files are harmless and can be swept separately later.
--
-- Apply: paste into the Supabase SQL editor and Run.

create or replace function public.delete_member(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if target = auth.uid() then
    raise exception 'You can''t remove your own account here.';
  end if;
  if exists (select 1 from public.profiles p where p.id = target and p.is_admin) then
    raise exception 'Remove admin from this member before deleting them.';
  end if;
  delete from auth.users where id = target;  -- cascades to profiles + all their content
end;
$$;

revoke all on function public.delete_member(uuid) from public, anon;
grant execute on function public.delete_member(uuid) to authenticated;
