"use client";

import { useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { useSaveStatus, useSheetDismiss } from "@/lib/hooks";
import { Sheet, FIELD } from "@/components/Sheet";
import { SettingsRow } from "@/components/SettingsRow";

/**
 * Self-serve display-name change. The name is what shows across the app
 * (header, People, posts, chat, committee rosters) — it's set at sign-up and
 * editable here. Writes `profiles.display_name` via `updateUser({ name })`
 * (the column clients are allowed to update, migration 0001). A settings row
 * (current name as the subtitle) opens a sheet with the edit form; hidden
 * while previewing as someone else.
 */
export function EditDisplayName() {
  const { user, previewMode } = useIdentity();
  const [open, setOpen] = useState(false);

  // Editing here writes the real session's profile, so it's meaningless /
  // misleading while an admin previews as another member.
  if (previewMode !== "off") return null;

  return (
    <>
      <SettingsRow icon="🙂" title="Name" subtitle={user?.name} onClick={() => setOpen(true)} />
      {open && <EditDisplayNameSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function EditDisplayNameSheet({ onClose }: { onClose: () => void }) {
  const { user, updateUser } = useIdentity();
  const [name, setName] = useState(user?.name ?? "");
  const { pending, status, run } = useSaveStatus();
  const { closing, close } = useSheetDismiss(onClose);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 60 && trimmed !== (user?.name ?? "");

  const save = () =>
    run(async () => {
      updateUser({ name: trimmed });
      close();
      return "Name updated.";
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="edit-name-title"
      header={
        <h2 id="edit-name-title" className="text-lg font-bold">
          Edit name
        </h2>
      }
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={close}
            className="press rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-foreground/60 ring-1 ring-border"
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
      }
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-foreground/70">Display name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={60}
          autoComplete="name"
          autoFocus
          className={`w-full ${FIELD}`}
        />
      </label>
      <p className="text-xs text-faint">This is how your name shows across the app.</p>
      {status && <p className="text-xs text-foreground/60">{status}</p>}
    </Sheet>
  );
}
