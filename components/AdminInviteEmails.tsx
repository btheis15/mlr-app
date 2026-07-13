"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSaveStatus } from "@/lib/hooks";
import { inviteByEmailLink, type InviteLinkResult } from "@/lib/admin";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

interface ParsedInvite {
  email: string;
  name?: string;
  valid: boolean;
}

// Forgiving on purpose — accepts however an admin is likely to paste a list:
// one per line, comma-separated (a spreadsheet column), or semicolon-separated
// (an email client's "To" field). Each piece can be a bare email or
// "Name <email@x.com>". Exact-duplicate emails (case-insensitive) are quietly
// dropped so pasting the same list twice can't double-invite anyone.
function parseEntries(text: string): ParsedInvite[] {
  const pieces = text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: ParsedInvite[] = [];
  for (const piece of pieces) {
    const m = /^(.*)<([^>]+)>$/.exec(piece);
    const email = (m ? m[2] : piece).trim();
    const name = m ? m[1].trim() : undefined;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ email, name, valid: EMAIL_RE.test(email) });
  }
  return out;
}

/**
 * Send new members a branded "you're invited" email whose button signs them
 * straight in (no code to type) and drops them into the app's existing
 * first-run profile setup. Separate from the plain code-based "Invite a
 * member" box on /admin/members, which stays as the quick single-person add.
 *
 * A live chip preview shows exactly what got parsed from the pasted text
 * (valid vs. not) before anything sends, so a bad paste is obvious up front
 * rather than discovered only in the per-address results after the fact.
 */
export function AdminInviteEmails() {
  const [raw, setRaw] = useState("");
  const [results, setResults] = useState<InviteLinkResult[] | null>(null);
  const save = useSaveStatus();

  const parsed = parseEntries(raw);
  const validEntries = parsed.filter((p) => p.valid);
  const invalidEntries = parsed.filter((p) => !p.valid);

  const send = () =>
    save.run(async () => {
      if (!validEntries.length) return "Enter at least one valid email.";
      const sb = supabase;
      const token = (await sb?.auth.getSession())?.data.session?.access_token;
      if (!token) return "Sign in again to send invites.";
      setResults(null);
      try {
        const r = await inviteByEmailLink(
          validEntries.map((p) => ({ email: p.email, name: p.name })),
          token,
        );
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
          Paste as many as you like — one per line, or separated by commas or
          semicolons (pastes straight from an email&rsquo;s &ldquo;To&rdquo;
          field or a spreadsheet column just fine). Add{" "}
          <code>Name &lt;email@x.com&gt;</code> to personalize a greeting.
          Each person gets their own private email with a button that signs
          them straight in — no code to type.
        </p>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={6}
          placeholder={"jane@example.com, John Smith <john@example.com>\nsam@example.com"}
          className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />

        {parsed.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {parsed.map((p, i) => (
              <span
                key={i}
                title={p.valid ? undefined : "Doesn't look like a valid email — check for typos"}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  p.valid ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"
                }`}
              >
                {p.valid ? "✓ " : "⚠️ "}
                {p.name ? `${p.name} <${p.email}>` : p.email}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {validEntries.length} ready to send
            {invalidEntries.length > 0
              ? ` · ${invalidEntries.length} need${invalidEntries.length === 1 ? "s" : ""} fixing`
              : ""}
          </p>
          <button
            type="button"
            onClick={send}
            disabled={save.pending || !validEntries.length}
            className="press shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {save.pending
              ? "Sending…"
              : validEntries.length
                ? `Send ${validEntries.length} invite${validEntries.length === 1 ? "" : "s"}`
                : "Send invites"}
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
