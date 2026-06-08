"use client";

import { useIdentity } from "@/components/IdentityProvider";
import type { NotifPrefType } from "@/lib/types";

const TYPES: { value: NotifPrefType; label: string; desc: string }[] = [
  { value: "post_comment", label: "Comments on my posts", desc: "When someone comments on a post you made" },
  { value: "post_reply", label: "Replies on posts I'm in", desc: "When someone else comments on a post you commented on" },
  { value: "post_mention", label: "Mentions in comments", desc: "When you're @mentioned in a post comment" },
  { value: "post_tag", label: "Tagged in a post", desc: "When someone tags you in a post" },
  { value: "post_reaction", label: "Reactions to my posts", desc: "When someone reacts to a post you made" },
  { value: "new_post", label: "New posts in the Feed", desc: "When anyone shares a new post" },
  { value: "chat_mention", label: "Tagged in committee chat", desc: "When you're @mentioned in a committee chat" },
  { value: "committee_join", label: "Committee decisions", desc: "When your request to join a committee is approved or declined" },
];

/**
 * Which in-app notifications land in the Activity tab (profiles.notif_types,
 * migration 0029) — an independent multi-select, the same shape as PushToggle.
 * These are the *in-app feed* prefs, separate from push (which can also buzz your
 * phone). Admin announcements always come through regardless of these.
 */
export function NotifPrefs() {
  const { user, updateUser } = useIdentity();
  if (!user) return null;

  const types = user.notifTypes ?? [];
  const has = (t: NotifPrefType) => types.includes(t);
  const toggle = (t: NotifPrefType) => {
    const next = has(t) ? types.filter((x) => x !== t) : [...types, t];
    updateUser({ notifTypes: next });
  };

  return (
    <div className="space-y-2">
      <p className="px-1 text-sm font-medium">In-app notifications</p>
      <p className="px-1 text-xs text-foreground/45">
        What shows in your Activity tab. Admin announcements always come through.
      </p>
      <div className="overflow-hidden rounded-2xl ring-1 ring-border">
        {TYPES.map((l, i) => {
          const on = has(l.value);
          return (
            <button
              key={l.value}
              type="button"
              onClick={() => toggle(l.value)}
              aria-pressed={on}
              className={`press flex w-full items-start justify-between gap-3 p-4 text-left ${i ? "border-t border-border" : ""} ${on ? "bg-primary/10" : "bg-card"}`}
            >
              <span className="min-w-0">
                <span className="text-sm font-medium">{l.label}</span>
                <span className="block text-xs text-foreground/50">{l.desc}</span>
              </span>
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs text-white ring-1 ${on ? "bg-primary ring-primary" : "ring-border"}`}
              >
                {on ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
