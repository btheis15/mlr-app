-- 0126_unified_broadcast_composer.sql
-- Backs the unified admin broadcast composer (AdminBroadcastComposer), which
-- replaces the separate "Post an alert" (AdminAlertComposer) and "Send a
-- notification" (AdminNotificationComposer) forms with one form offering
-- three independent channels: Banner, Activity feed, Email. Banner and Email
-- both key off `announcements` (as before); Activity feed still goes through
-- send_broadcast_notification — unchanged. The one new primitive needed is
-- decoupling "show the banner" from "email opted-in members", so a send can
-- email without showing a banner (e.g. a Home callout's "Also email" action —
-- see AdminCallouts) or show a banner without emailing (unchanged default).
--
-- Also backs the same decoupling for a callout's optional "Also send a
-- notification" / "Also send an email" one-time side actions (lib/broadcast.ts
-- postAnnouncement/sendActivityNotification) — no schema change needed there,
-- since those just call the same two primitives this migration touches.

alter table public.announcements
  add column if not exists show_banner boolean not null default true;

-- Re-declares run_scheduled_broadcasts() on top of its latest prior body
-- (migration 0122 — onlyUnconfirmed + excludeCalloutDone), adding show_banner
-- support to the 'announcement' branch only. Everything else (incl. the
-- 'notification' branch and its legacy alsoBanner mirror) is unchanged.
create or replace function public.run_scheduled_broadcasts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.scheduled_broadcasts;
  v_expires_at timestamptz;
  v_event_id text;
  v_exclude boolean;
  v_callout_id uuid;
  v_only_unconfirmed boolean;
begin
  for r in
    select * from public.scheduled_broadcasts
    where sent_at is null and cancelled_at is null and scheduled_at <= now()
    order by scheduled_at
  loop
    begin
      v_expires_at := case
        when (r.payload->>'expiryHours') is not null
          then now() + make_interval(hours => (r.payload->>'expiryHours')::int)
        else null
      end;
      v_event_id := r.payload->>'eventId';
      v_exclude := coalesce((r.payload->>'excludeNotAttending')::boolean, false);
      v_only_unconfirmed := coalesce((r.payload->>'onlyUnconfirmed')::boolean, false);
      v_callout_id := case
        when r.payload->>'sourceType' = 'callout'
             and coalesce((r.payload->>'excludeCalloutDone')::boolean, true)
        then nullif(r.payload->>'sourceId', '')::uuid
        else null
      end;

      if r.kind = 'announcement' then
        insert into public.announcements
          (author_id, title, body, severity, notify_email, email_audience, expires_at, event_id, exclude_not_attending, show_banner)
        values (
          r.created_by,
          r.payload->>'title',
          nullif(r.payload->>'body', ''),
          'alert',
          coalesce((r.payload->>'notifyEmail')::boolean, false),
          coalesce(r.payload->>'emailAudience', 'all'),
          coalesce(v_expires_at, now() + interval '6 hours'),
          v_event_id,
          v_exclude,
          coalesce((r.payload->>'showBanner')::boolean, true)
        );

      elsif r.kind = 'notification' then
        insert into public.notifications
          (recipient_id, type, actor_id, title, body, url, entity_type, expires_at)
        select p.id, 'broadcast', r.created_by, r.payload->>'title', nullif(r.payload->>'body', ''),
               nullif(r.payload->>'url', ''), 'broadcast', v_expires_at
        from public.profiles p
        where case coalesce(r.payload->>'audience', 'everyone')
                when 'everyone' then true
                when 'admins'   then p.is_admin
                else false
              end
          and not (
            v_exclude and v_event_id is not null
            and exists (
              select 1 from public.event_attendance ea
              where ea.event_id = v_event_id and ea.user_id = p.id and ea.status = 'not_going'
            )
          )
          and not (
            v_callout_id is not null
            and exists (
              select 1 from public.home_callout_completions hcc
              where hcc.callout_id = v_callout_id and hcc.user_id = p.id
            )
          )
          and (
            not v_only_unconfirmed or v_event_id is null
            or not exists (
              select 1 from public.event_attendance ea
              where ea.event_id = v_event_id and ea.user_id = p.id and ea.confirmed = true
            )
          );

        -- Legacy mirror kept for any already-queued rows from the old
        -- AdminNotificationComposer's "Also show as a top-of-app banner"
        -- checkbox. The new composer schedules Banner as its own
        -- 'announcement' row instead, so new payloads won't set this.
        if coalesce((r.payload->>'alsoBanner')::boolean, false)
           and coalesce(r.payload->>'audience', 'everyone') = 'everyone' then
          insert into public.announcements
            (author_id, title, body, severity, notify_email, expires_at, event_id, exclude_not_attending)
          values (
            r.created_by, r.payload->>'title', nullif(r.payload->>'body', ''), 'alert', false,
            coalesce(v_expires_at, now() + interval '6 hours'), v_event_id, v_exclude
          );
        end if;
      end if;

      update public.scheduled_broadcasts set sent_at = now(), error = null where id = r.id;
    exception when others then
      update public.scheduled_broadcasts set error = sqlerrm where id = r.id;
    end;
  end loop;
end;
$$;
