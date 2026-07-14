-- 0097_scheduled_broadcasts.sql
-- Schedule a banner announcement or a broadcast notification for a future
-- time instead of sending it right away, with a queue of what's waiting to
-- fire (Admin → Alerts & Notifications → Scheduled). Runs entirely inside
-- Postgres via pg_cron (already enabled on this project) — NOT the mac mini —
-- so a scheduled send still fires even if the mini is asleep/off.
--
-- `payload` carries the same fields the two existing composers already
-- collect (title/body/audience/expiry/etc — see AdminAlertComposer /
-- AdminNotificationComposer), so scheduling is just "the same send, deferred"
-- rather than a second code path to keep in sync. schedule_broadcast()
-- validates just enough to fail fast (kind, title, scheduled_at in the
-- future); the real per-kind validation happens at fire time, reusing the
-- exact same rules send_broadcast_notification already enforces.

create table if not exists public.scheduled_broadcasts (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('announcement', 'notification')),
  payload       jsonb not null,
  scheduled_at  timestamptz not null,
  created_by    uuid references public.profiles (id) on delete set null,
  sent_at       timestamptz,
  cancelled_at  timestamptz,
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists scheduled_broadcasts_pending_idx
  on public.scheduled_broadcasts (scheduled_at)
  where sent_at is null and cancelled_at is null;

alter table public.scheduled_broadcasts enable row level security;

-- Admin-only, both ends — this is a queue of not-yet-sent content, not
-- something any other member should be able to read or poke at.
drop policy if exists "scheduled_broadcasts: admin only" on public.scheduled_broadcasts;
create policy "scheduled_broadcasts: admin only" on public.scheduled_broadcasts for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

alter table public.scheduled_broadcasts replica identity full;
do $$ begin alter publication supabase_realtime add table public.scheduled_broadcasts; exception when duplicate_object then null; end $$;

-- ── schedule_broadcast — queue one up (admin-only) ───────────────────────────
create or replace function public.schedule_broadcast(
  p_kind text,
  p_payload jsonb,
  p_scheduled_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if p_kind not in ('announcement', 'notification') then
    raise exception 'Unknown kind';
  end if;
  if coalesce(btrim(p_payload->>'title'), '') = '' then
    raise exception 'A title is required';
  end if;
  if p_scheduled_at <= now() then
    raise exception 'Scheduled time must be in the future';
  end if;

  insert into public.scheduled_broadcasts (kind, payload, scheduled_at, created_by)
  values (p_kind, p_payload, p_scheduled_at, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.schedule_broadcast(text, jsonb, timestamptz) from public, anon;
grant execute on function public.schedule_broadcast(text, jsonb, timestamptz) to authenticated;

-- ── cancel_scheduled_broadcast — pull one out of the queue before it fires ───
create or replace function public.cancel_scheduled_broadcast(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  update public.scheduled_broadcasts
    set cancelled_at = now()
    where id = p_id and sent_at is null and cancelled_at is null;
end;
$$;
revoke all on function public.cancel_scheduled_broadcast(uuid) from public, anon;
grant execute on function public.cancel_scheduled_broadcast(uuid) to authenticated;

-- ── run_scheduled_broadcasts — the pg_cron tick, every minute ────────────────
-- Fires anything due, one row at a time so a bad payload on one row can't
-- sink the rest of the queue; failures are recorded on the row (`error`) —
-- never silently dropped — for the admin queue view to surface. Recomputes
-- each expiry relative to the moment it actually posts, not when it was
-- scheduled, so "6 hours" means 6 hours from going live either way.
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
                when 'beta'     then p.beta_tester
                when 'admins'   then p.is_admin
                else false
              end
          and not (
            v_exclude and v_event_id is not null
            and exists (
              select 1 from public.event_attendance ea
              where ea.event_id = v_event_id and ea.user_id = p.id and ea.status = 'not_going'
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

-- Re-running this migration replaces the same named job rather than stacking
-- a duplicate every time.
do $$
begin
  perform cron.unschedule('run-scheduled-broadcasts');
exception when others then null;
end $$;
select cron.schedule('run-scheduled-broadcasts', '* * * * *', $$select public.run_scheduled_broadcasts();$$);
