-- 0102_reminder_exclude_callout_done.sql
-- A callout reminder ("today's the last day to order t-shirts!") shouldn't nag
-- someone who already tapped "I did this — don't show again"
-- (home_callout_completions, migration 0098) on that callout — they've told us
-- they're done, same as an RSVP'd "not going" being excluded from an
-- event-targeted broadcast (migration 0096). Reminders created by
-- ReminderScheduler tag their payload with sourceType/sourceId (migration
-- 0101); when sourceType = 'callout', run_scheduled_broadcasts() now skips any
-- recipient who has a completion row for that callout id.

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
      v_callout_id := case when r.payload->>'sourceType' = 'callout'
        then nullif(r.payload->>'sourceId', '')::uuid
        else null
      end;

      if r.kind = 'announcement' then
        insert into public.announcements
          (author_id, title, body, severity, notify_email, email_audience, expires_at, event_id, exclude_not_attending)
        values (
          r.created_by,
          r.payload->>'title',
          nullif(r.payload->>'body', ''),
          'alert',
          coalesce((r.payload->>'notifyEmail')::boolean, false),
          coalesce(r.payload->>'emailAudience', 'all'),
          coalesce(v_expires_at, now() + interval '6 hours'),
          v_event_id,
          v_exclude
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
          );

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
revoke all on function public.run_scheduled_broadcasts() from public, anon, authenticated;
