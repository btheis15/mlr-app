"use client";

import { useIdentity } from "@/components/IdentityProvider";
import type { NotifPrefType } from "@/lib/types";

type Row = {
  value: NotifPrefType;
  label: string;
  desc: string;
  icon: string;
  adminOnly?: boolean;
  locked?: boolean;
};

// Grouped the same way as the iOS app's NotifPrefsView — labeled sections, an
// icon per row, and iOS-style on/off switches. Each row maps to one
// profiles.notif_types kind (migration 0029). Keep the section order in sync
// with the iOS layout.
const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "Your activity",
    rows: [
      { value: "post_comment", icon: "💬", label: "Comments on my posts", desc: "When someone comments on a post you made" },
      { value: "post_reply", icon: "↩️", label: "Replies on posts I'm in", desc: "When someone else comments on a post you commented on" },
      { value: "post_mention", icon: "@", label: "Mentions in comments", desc: "When you're @mentioned in a post comment" },
      { value: "post_tag", icon: "🏷️", label: "Tagged in a post", desc: "When someone tags you in a post" },
      { value: "post_reaction", icon: "❤️", label: "Reactions to my posts", desc: "When someone reacts to a post you made" },
    ],
  },
  {
    title: "Social",
    rows: [
      { value: "new_post", icon: "📰", label: "New posts in the Feed", desc: "When anyone shares a new post" },
      { value: "chat_mention", icon: "🗨️", label: "Tagged in committee chat", desc: "When you're @mentioned in a committee chat" },
    ],
  },
  {
    title: "Committees",
    rows: [
      { value: "committee_join", icon: "👥", label: "Committee decisions", desc: "When your request to join a committee is approved or declined" },
      { value: "committee_join_request", icon: "🙋", label: "New committee join requests", desc: "When a member asks to join a committee (leads of that committee see these too)", adminOnly: true },
    ],
  },
  {
    title: "Cabin stays",
    rows: [
      { value: "cabin_request", icon: "🏡", label: "New cabin stay requests", desc: "When a member requests a cabin stay", adminOnly: true },
      { value: "cabin_decision", icon: "🏡", label: "My cabin stay decisions", desc: "When your cabin stay request is approved or declined" },
    ],
  },
  {
    title: "Events",
    rows: [
      { value: "event_rsvp", icon: "📅", label: "Event RSVPs", desc: "When a member marks themselves going to an event" },
    ],
  },
  {
    title: "House calendar",
    rows: [
      { value: "house_stay_created", icon: "🏡", label: "New stays at your house", desc: "When someone in your house adds a stay to the house calendar" },
    ],
  },
  {
    title: "Work items",
    rows: [
      { value: "work_item_created", icon: "🔧", label: "New work items", desc: "When someone adds a task to the checklist (resort-wide, or in your house)" },
      { value: "work_item_comment", icon: "💬", label: "Comments on work items", desc: "When someone comments on a work item you posted or commented on" },
      { value: "work_item_mention", icon: "@", label: "Mentions on work items", desc: "When you're @mentioned in a work item comment" },
    ],
  },
  {
    title: "Meetings",
    rows: [
      { value: "meeting_proposed", icon: "📅", label: "New meeting to schedule", desc: "When someone proposes a meeting in a committee or house you’re in — pick when you’re free" },
      { value: "meeting_scheduled", icon: "✅", label: "Meeting set", desc: "When a proposed meeting is locked to a time (with the join link)" },
    ],
  },
  {
    title: "Help requests",
    rows: [
      { value: "help_request", icon: "🙌", label: "Help requests near me", desc: "When someone at the resort asks for help (needs “Willing to help” on too)" },
      { value: "help_response", icon: "🚶", label: "Responses to my request", desc: "When someone’s on the way to help with your request" },
      { value: "help_urgent", icon: "🚨", label: "Urgent help (emergencies)", desc: "When someone marks a request Urgent — goes to everyone. Always on; the only way to silence it is your phone's notification permission.", locked: true },
    ],
  },
];

/** Visual-only iOS-style switch — the whole row is the real <button>, so this is
 *  aria-hidden and just reflects the on/off state. Mirrors the switch in
 *  PushToggle. */
function SwitchVisual({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-foreground/20"}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`}
      />
    </span>
  );
}

/** A single row's leading icon. The "@" mention glyph is rendered as styled text
 *  (matching the iOS "at" symbol); everything else is an emoji. */
function RowIcon({ icon }: { icon: string }) {
  if (icon === "@") {
    return (
      <span aria-hidden className="flex w-7 shrink-0 justify-center text-lg font-semibold text-primary">
        @
      </span>
    );
  }
  return (
    <span aria-hidden className="flex w-7 shrink-0 justify-center text-lg">
      {icon}
    </span>
  );
}

/**
 * Which in-app notifications land in the Activity tab (profiles.notif_types,
 * migration 0029) — an independent multi-select. Laid out to match the iOS app:
 * grouped sections, an icon per row, and iOS-style toggle switches. These are
 * the *in-app feed* prefs, separate from push (which can also buzz your phone).
 * Admin announcements always come through regardless of these.
 */
export function NotifPrefs() {
  const { user, isAdmin, updateUser } = useIdentity();
  if (!user) return null;

  const types = user.notifTypes ?? [];
  const has = (t: NotifPrefType) => types.includes(t);
  const toggle = (t: NotifPrefType) => {
    const next = has(t) ? types.filter((x) => x !== t) : [...types, t];
    updateUser({ notifTypes: next });
  };

  return (
    <div className="space-y-4">
      <p className="px-1 text-xs text-faint">
        Choose which activities show in your Activity tab. These are separate from
        push notifications. Admin announcements always come through.
      </p>

      {SECTIONS.map((section) => {
        // Admin-only kinds (e.g. "new cabin request") only fire for admins, so
        // only they see those rows — and a section that ends up empty is hidden.
        const rows = section.rows.filter((r) => !r.adminOnly || isAdmin);
        if (rows.length === 0) return null;

        return (
          <div key={section.title} className="space-y-2">
            <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
              {section.title}
            </p>
            <div className="overflow-hidden rounded-2xl ring-1 ring-border">
              {rows.map((r, i) => {
                // Locked kinds (emergencies) are always on and not toggleable —
                // a static row with a lock instead of a switch.
                if (r.locked) {
                  return (
                    <div
                      key={r.value}
                      className={`flex w-full items-start gap-3 bg-primary/10 p-4 text-left ${i ? "border-t border-border" : ""}`}
                    >
                      <RowIcon icon={r.icon} />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium">{r.label}</span>
                        <span className="block text-xs text-muted">{r.desc}</span>
                      </span>
                      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                        🔒 Always on
                      </span>
                    </div>
                  );
                }
                const on = has(r.value);
                return (
                  <button
                    key={r.value}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggle(r.value)}
                    className={`press flex w-full items-center gap-3 p-4 text-left ${i ? "border-t border-border" : ""} ${on ? "bg-primary/10" : "bg-card"}`}
                  >
                    <RowIcon icon={r.icon} />
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-medium">{r.label}</span>
                      <span className="block text-xs text-muted">{r.desc}</span>
                    </span>
                    <SwitchVisual on={on} />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
