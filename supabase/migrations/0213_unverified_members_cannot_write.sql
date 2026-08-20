-- 0213_unverified_members_cannot_write.sql
-- POLICY: a self-signed-up account can do NOTHING until an admin verifies it.
--
-- 0181/0183 locked down what an unverified account can SEE, but never what it
-- can DO. Every write RPC gated on "is there a session", not on approval — so
-- a stranger who signed up with any email address could still RSVP, post to the
-- family feed, create a poll or a work item, request a cabin, and so on. Their
-- own screen would look empty (they can't read any of it back), but the rest of
-- the family would see it.
--
-- ── Why a trigger and not 180 function edits ─────────────────────────────────
-- 181 SECURITY DEFINER write RPCs are callable by `authenticated`; exactly ONE
-- checked approval. Adding the check to each body would mean recreating 180
-- function definitions — which is precisely how the 0160 incident happened (a
-- "recreate" silently dropped an unrelated earlier fix, and Postgres cannot
-- detect it). A SECURITY DEFINER function also bypasses RLS, so policies can't
-- carry this either.
--
-- A BEFORE trigger is the one choke point that catches all of them: it fires
-- inside the RPC's own INSERT/UPDATE/DELETE, no matter which function ran it,
-- and `auth.uid()` inside it still resolves to the CALLING member (the JWT is a
-- request GUC, unaffected by SECURITY DEFINER). No function body is touched.
--
-- ── Blast radius ─────────────────────────────────────────────────────────────
-- The guard is `auth.uid() is not null and not is_approved_member()`, so it
-- fires for exactly one kind of caller: signed in, not yet verified.
--   * service_role / pg_cron / the mac mini -> auth.uid() is null -> unaffected
--     (this is what keeps the mailer, push senders and cron sweeps working).
--   * anonymous visitors                    -> auth.uid() is null -> unaffected
--     (they are already stopped by grants + RLS; see 0212).
--   * approved members and admins           -> is_approved_member() -> unaffected
--     (`is_admin` counts as approved, per the function's own definition).
-- At the time of writing every one of the 57 accounts is approved, so this
-- changes nothing for anybody who exists today. It only governs future signups.
--
-- ⚠️ Pre-registered family are AUTO-APPROVED on signup (trg_auto_approve_preregistered),
-- so this does not add a manual step for anyone an admin already put on the
-- family roster. It bites genuine strangers only.
--
-- ── The exemptions, and why each one is load-bearing ─────────────────────────
-- Everything else in `public` is gated. These are not:
--   profiles           - signup CREATES this row, and the person must be able to
--                        fill in their name/phone or an admin has nothing to
--                        judge when deciding whether to approve them.
--   committee_roster,
--   family_roster      - the roster-LINK triggers on profiles (0056/0060/0123)
--                        write these DURING signup, while the new account is by
--                        definition still unapproved. Gating them would break
--                        signup for anyone whose email matches a roster slot.
--                        Both are already admin/lead-only for direct writes.
--   fest_activities,
--   fest_dinners,
--   fest_schedule_items - sync_fest_lead_names (0113) rewrites the denormalized
--                        lead/chef name whenever a member renames themselves.
--                        All three are can_edit_fest()-gated, which requires
--                        committee membership an unapproved account can't have.
--   notifications      - a derived fan-out written on people's behalf, never
--                        member content.
--   push_subscriptions,
--   apns_subscriptions - registering a device is harmless and happens before
--                        anyone looks at approval.
--   committee_reads,
--   committee_area_reads,
--   house_reads        - read receipts. They can't read the rooms anyway; this
--                        just avoids throwing errors into a client for a no-op.
--   media_moderation, content_embeddings, content_moderation_events,
--   event_messages, fest_reminder_emails, fest_signup_reminders_sent,
--   house_order_reminders_sent, tournament_match_reminders_sent
--                      - service-role/system ledgers. auth.uid() is null for
--                        those writers so the guard would never fire anyway;
--                        left off the list to keep the trigger surface honest.
--
-- ⚠️ A NEW member-writable table does NOT inherit this. The loop below attaches
-- triggers to the tables that exist today; adding a table means adding the
-- trigger too. Re-run the SELECT at the bottom of this file to find any table
-- that is missing one.

create or replace function public.require_approved_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only ever fires for a signed-in-but-unverified caller. See the header.
  if auth.uid() is not null and not public.is_approved_member() then
    raise exception 'Your account is waiting for an admin to verify it before you can do that'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  r record;
  exempt text[] := array[
    'profiles', 'committee_roster', 'family_roster',
    'fest_activities', 'fest_dinners', 'fest_schedule_items',
    'notifications', 'push_subscriptions', 'apns_subscriptions',
    'committee_reads', 'committee_area_reads', 'house_reads',
    'media_moderation', 'content_embeddings', 'content_moderation_events',
    'event_messages', 'fest_reminder_emails', 'fest_signup_reminders_sent',
    'house_order_reminders_sent', 'tournament_match_reminders_sent'
  ];
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not (c.relname = any(exempt))
    order by c.relname
  loop
    execute format(
      'drop trigger if exists require_approved_member_trg on public.%I', r.relname);
    execute format(
      'create trigger require_approved_member_trg before insert or update or delete on public.%I
         for each row execute function public.require_approved_member()', r.relname);
  end loop;
end;
$$;

-- Audit query — any public table without the guard (should return only the
-- documented exemptions above):
--
--   select c.relname
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r'
--      and not exists (select 1 from pg_trigger t
--                       where t.tgrelid = c.oid
--                         and t.tgname = 'require_approved_member_trg')
--    order by 1;
