"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSaveStatus } from "@/lib/hooks";
import { inviteByEmailLink, type InviteLinkResult } from "@/lib/admin";

// "Name <email@x.com>" or just "email@x.com", one per line.
function parseEntries(raw: string): { email: string; name?: string }[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(.*)<([^>]+)>$/.exec(line);
      return m ? { name: m[1].trim(), email: m[2].trim() } : { email: line };
    });
}

/**
 * Send new members a branded "you're invited" email whose button signs them
 * straight in (no code to type) and drops them into the app's existing
 * first-run profile setup. Separate from the plain code-based "Invite a
 * member" box on /admin/members, which stays as the quick single-person add.
 */
export function AdminInviteEmails() {
  const [raw, setRaw] = useState("");
  const [results, setResults] = useState<InviteLinkResult[] | null>(null);
  const save = useSaveStatus();

  const entries = parseEntries(raw);

  const send = () =>
    save.run(async () => {
      if (!entries.length) return "Enter at least one email.";
      const sb = supabase;
      const token = (await sb?.auth.getSession())?.data.session?.access_token;
      if (!token) return "Sign in again to send invites.";
      setResults(null);
      try {
        const r = await inviteByEmailLink(entries, token);
        setResults(r);
        const okCount = r.filter((x) => x.ok).length;
        return `Sent ${okCount}/${r.length} invite${r.length === 1 ? "" : "s"}.`;
      } catch (err) {
        return err instanceof Error ? err.message : "Couldn't send invites.";
      }
    });

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
        <p className="text-sm font-semibold">Invite people by email</p>
        <p className="text-xs text-muted">
          One per line — just an email, or <code>Name &lt;email@x.com&gt;</code> to
          personalize the greeting. Each person gets their own private email
          with a button that signs them straight in — no code to type.
        </p>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={6}
          placeholder={"jane@example.com\nJohn Smith <john@example.com>"}
          className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </p>
          <button
            type="button"
            onClick={send}
            disabled={save.pending || !entries.length}
            className="press shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {save.pending ? "Sending…" : "Send invites"}
          </button>
        </div>
        {save.status && <p className="text-xs text-muted">{save.status}</p>}
      </div>

      {results && results.length > 0 && (
        <ul className="space-y-1.5 rounded-2xl bg-card p-4 ring-1 ring-border">
          {results.map((r) => (
            <li key={r.email} className="flex items-start gap-2 text-sm">
              <span aria-hidden>{r.ok ? "✅" : "❌"}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{r.email}</span>
                {!r.ok && r.error && <span className="block text-xs text-accent">{r.error}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
