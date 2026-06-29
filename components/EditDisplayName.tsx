"use client";

import { useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { useSaveStatus } from "@/lib/hooks";

/**
 * Self-serve display-name change. The name is what shows across the app
 * (header, People, posts, chat, committee rosters) — it's set at sign-up and
 * editable here. Writes `profiles.display_name` via `updateUser({ name })`
 * (the column clients are allowed to update, migration 0001). Mirrors the
 * inline "Change email" affordance; hidden while previewing as someone else.
 */
export function EditDisplayName() {
  const { user, previewMode, updateUser } = useIdentity();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const { pending, status, run } = useSaveStatus();

  // Editing here writes the real session's profile, so it's meaningless /
  // misleading while an admin previews as another member.
  if (previewMode !== "off") return null;

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 60 && trimmed !== (user?.name ?? "");

  const save = () =>
    run(async () => {
      updateUser({ name: trimmed });
      setOpen(false);
      return "Name updated.";
    });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setName(user?.name ?? "");
          setOpen(true);
        }}
        className="press text-xs font-medium text-primary"
      >
        Edit name
      </button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
      <label className="text-xs font-medium text-foreground/70">Display name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        maxLength={60}
        autoComplete="name"
        className="w-full rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <p className="text-xs text-foreground/45">This is how your name shows across the app.</p>
      {status && <p className="text-xs text-foreground/60">{status}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="press rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-foreground/60 ring-1 ring-border"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!valid || pending}
          className="press ml-auto rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save name"}
        </button>
      </div>
    </div>
  );
}
