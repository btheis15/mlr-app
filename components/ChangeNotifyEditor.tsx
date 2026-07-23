"use client";

import { FIELD } from "@/components/Sheet";
import type { ActivityNotifyChannels } from "@/lib/activityNotify";

export interface ChangeNotifyState {
  enabled: boolean;
  message: string;
  channels: ActivityNotifyChannels;
}

/** Default: off, banner + Activity tab on (push + durable entry), email off. */
export function emptyChangeNotify(): ChangeNotifyState {
  return { enabled: false, message: "", channels: { banner: true, activity: true, email: false } };
}

/**
 * The "📣 Notify about this change" block for an activity/dinner editor. Turning
 * it on prefills the message (the parent passes `defaultMessage`, e.g. "Dinner is
 * now at 6:00 PM") so the sender barely types, then picks channels. The parent
 * owns the state and does the actual send after saving. Admin-only surface (the
 * broadcast RPCs are admin-gated), so mount it behind an isAdmin check.
 */
export function ChangeNotifyEditor({
  value,
  onChange,
  defaultMessage,
}: {
  value: ChangeNotifyState;
  onChange: (next: ChangeNotifyState) => void;
  defaultMessage: string;
}) {
  const setChannel = (k: keyof ActivityNotifyChannels, on: boolean) =>
    onChange({ ...value, channels: { ...value.channels, [k]: on } });

  return (
    <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="text-sm font-medium">📣 Notify about this change</span>
          <span className="block text-xs text-foreground/50">
            Tell everyone at Family Fest (skips people who RSVP&rsquo;d not coming).
          </span>
        </span>
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) =>
            onChange({
              ...value,
              enabled: e.target.checked,
              message: e.target.checked && !value.message.trim() ? defaultMessage : value.message,
            })
          }
          className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
        />
      </label>

      {value.enabled && (
        <div className="mt-3 space-y-3">
          <textarea
            value={value.message}
            onChange={(e) => onChange({ ...value, message: e.target.value })}
            rows={2}
            placeholder="e.g. Dinner was moved to 6:00 PM"
            className={`${FIELD} w-full`}
          />
          <div className="space-y-1.5">
            <ChannelRow
              label="📣 Banner + push"
              hint="Top of the app; buzzes phones with alerts on"
              checked={value.channels.banner}
              onChange={(on) => setChannel("banner", on)}
            />
            <ChannelRow
              label="🔔 Activity tab"
              hint="A durable entry in everyone's bell tab"
              checked={value.channels.activity}
              onChange={(on) => setChannel("activity", on)}
            />
            <ChannelRow
              label="✉️ Email"
              hint="Members who opted into email — good for minor changes with no push"
              checked={value.channels.email}
              onChange={(on) => setChannel("email", on)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
      <span className="min-w-0">
        <span className="text-sm">{label}</span>
        <span className="block text-[11px] text-foreground/50">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
      />
    </label>
  );
}
