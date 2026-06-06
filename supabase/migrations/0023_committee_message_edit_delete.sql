-- 0023_committee_message_edit_delete.sql
-- Edit / delete rules for committee chat messages.
--
-- Delete is now a SOFT delete: instead of removing the row we stamp deleted_at,
-- so the bubble becomes a "message deleted" tombstone (and any reply that quotes
-- it shows the same) — regardless of whether an author or an admin removed it.
-- Authors may edit OR delete their own message for 24 hours; admins may delete
-- any message at any time. Editing stamps edited_at (the UI shows a subtle
-- "edited"). All of this is an UPDATE, so the rules live in one update policy;
-- a true row DELETE is left to admins only (moderation cleanup) so a client can
-- never hard-delete around the tombstone.
--
-- Apply in the Supabase SQL editor after 0022.

alter table public.committee_messages add column if not exists deleted_at timestamptz;

-- Author edits/soft-deletes their own message within 24h; admin anytime.
drop policy if exists "cmsg: author update" on public.committee_messages;
drop policy if exists "cmsg: author edit/delete 24h or admin" on public.committee_messages;
create policy "cmsg: author edit/delete 24h or admin" on public.committee_messages for update
  using (
    (author_id = auth.uid() and created_at > now() - interval '24 hours')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  )
  with check (
    (author_id = auth.uid() and created_at > now() - interval '24 hours')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- Hard delete is admin-only now (the app uses soft delete; this is just a
-- moderation escape hatch). Replaces the old author-or-admin delete policy.
drop policy if exists "cmsg: author or admin delete" on public.committee_messages;
drop policy if exists "cmsg: admin hard delete" on public.committee_messages;
create policy "cmsg: admin hard delete" on public.committee_messages for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
