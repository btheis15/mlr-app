-- 0212_revoke_anon_add_work_item_to_event.sql
-- Consistency hardening found while auditing what a SIGNED-OUT visitor can do.
--
-- Every event write RPC is revoked from `anon` — add_event_family_member,
-- add_event_guest, add_event_host, set_event_attendance, create_/update_/
-- delete_event, remove_event_attendance_entry, sync_event_work_items — with
-- exactly one exception: `add_work_item_to_event` (0050) still carried the
-- default PUBLIC execute grant.
--
-- ⚠️ It was NOT exploitable: the function opens with
--   if auth.uid() is null then raise exception 'auth required'; end if;
-- and an anonymous probe confirms it (P0001, not a successful insert). This is
-- defence in depth, not a fix for a live hole — it moves the block from a
-- single in-body check to the same grant boundary its siblings use, so the
-- rule is "signed-out callers cannot reach an event write RPC at all" with no
-- exception to remember.
--
-- Signed-in members are unaffected: `authenticated` keeps EXECUTE, which is
-- the only role the client ever calls this with (WorkItemComposer's "link to
-- an event" picker).

revoke execute on function public.add_work_item_to_event(text, uuid) from public, anon;
grant execute on function public.add_work_item_to_event(text, uuid) to authenticated;
