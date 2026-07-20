"use client";

import { useEffect, useMemo, useState } from "react";
import { MigrationHint } from "@/components/MigrationHint";
import { SkeletonList } from "@/components/Skeleton";
import { useSaveStatus } from "@/lib/hooks";
import { plural } from "@/lib/format";
import { mailtoUrl, MAILTO_WARN_COUNT, type Recipient, type RecipientResult } from "@/lib/emailBlast";

/**
 * The shared "Email members" composer. Given a recipient pool (loaded by the
 * host — everyone, or one committee), the admin/lead picks the whole group or
 * specific people, optionally types a subject, and hits **Open email** — which
 * builds a `mailto:` and hands off to their mail app with everyone in the To
 * field. **Nothing is sent from the app.** A "Copy addresses" button is the
 * fallback for very large lists (some mail apps truncate a long mailto).
 *
 * `sourceKey` identifies the current pool; changing it reloads. `load` returns
 * the pool (and signals if migration 0028 hasn't been run yet). `groupNoun`
 * labels the audience — "members" for everyone, or a committee name.
 *
 * `allowAll` (default true) toggles the "Everyone (N)" one-tap mode. Set it
 * false for the open member directory ("Pick specific people"), so it stays a
 * deliberate hand-pick — emailing literally everyone is reserved for the gated
 * "Everyone" / committee pools.
 */
export function EmailMembersComposer({
  sourceKey,
  load,
  groupNoun,
  allowAll = true,
  migrationFile = "0028_email_recipients.sql",
}: {
  sourceKey: string;
  load: () => Promise<RecipientResult>;
  groupNoun: string;
  allowAll?: boolean;
  /** Which migration turns this pool's recipient RPC on — shown in the
   *  MigrationHint before it's been applied. Defaults to the members/committee
   *  RPC (0028); the house pool passes 0123. */
  migrationFile?: string;
}) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [mode, setMode] = useState<"all" | "role" | "pick">(allowAll ? "all" : "pick");
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const copied = useSaveStatus();

  // Area name without the " · Lead" suffix — the canonical key for role chips.
  const roleArea = (r: string) => r.replace(/ · Lead$/, "");

  // (Re)load whenever the pool changes. Reset the picker so a stale selection
  // from a different group can't leak into the next one.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNeedsMigration(false);
    setMode(allowAll ? "all" : "pick");
    setSelectedRole(null);
    setSelected(new Set());
    setQuery("");
    load().then((res) => {
      if (cancelled) return;
      setRecipients(res.recipients);
      setNeedsMigration(res.needsMigration);
      setError(res.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const hasRoles = recipients.some((r) => r.roles?.length);
  const roleOptions = useMemo(
    () => [...new Set(recipients.flatMap((r) => (r.roles ?? []).map(roleArea)))].sort(),
    [recipients], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const audience = useMemo(() => {
    if (mode === "all") return recipients;
    if (mode === "role") return selectedRole
      ? recipients.filter((r) => r.roles?.some((rl) => roleArea(rl) === selectedRole))
      : [];
    return recipients.filter((r) => selected.has(r.id));
  }, [mode, recipients, selected, selectedRole]); // eslint-disable-line react-hooks/exhaustive-deps
  const emails = useMemo(() => audience.map((r) => r.email), [audience]);
  const href = useMemo(() => mailtoUrl(emails, subject), [emails, subject]);

  const q = query.trim().toLowerCase();
  const shown = q
    ? recipients.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
    : recipients;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () => setSelected(new Set(recipients.map((r) => r.id)));
  const clearAll = () => setSelected(new Set());

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      copied.show(`Copied ${emails.length} ${plural(emails.length, "address", "addresses")} ✓`);
    } catch {
      copied.show("Couldn't copy — select and copy them manually.", 5000);
    }
  };

  if (loading) {
    return <SkeletonList count={2} />;
  }
  if (needsMigration) {
    return (
      <MigrationHint file="0028_email_recipients.sql">
        To turn on emailing {groupNoun},
      </MigrationHint>
    );
  }
  if (error) {
    return <p className="rounded-2xl bg-accent/10 p-4 text-center text-xs text-accent ring-1 ring-accent/30">{error}</p>;
  }
  if (recipients.length === 0) {
    return <p className="rounded-2xl bg-card p-4 text-center text-xs text-faint ring-1 ring-border">No one to email here yet.</p>;
  }

  const tooMany = audience.length > MAILTO_WARN_COUNT;

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <p className="text-xs text-foreground/60">
        Opens your email app with {mode === "all" ? <strong>everyone below</strong> : <strong>the people you pick</strong>} in
        the <strong>To</strong> field — write and send it from there. Nothing is sent from the app.
      </p>

      {/* Everyone / By Role / Pick specific. Hidden for the open
          directory pool (allowAll=false), which is hand-pick only. */}
      {allowAll && (
        <div className="flex gap-1.5 rounded-xl bg-background p-1 ring-1 ring-border">
          <button
            type="button"
            onClick={() => setMode("all")}
            className={`press flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              mode === "all" ? "bg-primary text-white" : "text-foreground/60"
            }`}
          >
            Everyone ({recipients.length})
          </button>
          {hasRoles && (
            <button
              type="button"
              onClick={() => setMode("role")}
              className={`press flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                mode === "role" ? "bg-primary text-white" : "text-foreground/60"
              }`}
            >
              By Role
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode("pick")}
            className={`press flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              mode === "pick" ? "bg-primary text-white" : "text-foreground/60"
            }`}
          >
            Pick specific
          </button>
        </div>
      )}

      {/* Role chips — pick one area to email just that group */}
      {mode === "role" && (
        <div className="space-y-1.5">
          {roleOptions.map((area) => {
            const count = recipients.filter((r) => r.roles?.some((rl) => roleArea(rl) === area)).length;
            const on = selectedRole === area;
            return (
              <button
                key={area}
                type="button"
                onClick={() => setSelectedRole(on ? null : area)}
                className={`press flex w-full items-center justify-between rounded-xl px-3 py-2.5 ring-1 transition-colors ${
                  on ? "bg-primary/10 ring-primary/30" : "bg-card ring-border"
                }`}
              >
                <span className={`text-sm font-medium ${on ? "text-primary" : "text-foreground/80"}`}>{area}</span>
                <span className={`text-xs font-semibold ${on ? "text-primary" : "text-faint"}`}>
                  {on ? "✓ " : ""}{count} {count === 1 ? "person" : "people"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {mode === "pick" && (
        <div className="space-y-2 rounded-xl bg-background p-2.5 ring-1 ring-border">
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or email…"
              className="min-w-0 flex-1 rounded-lg bg-card px-2.5 py-1.5 text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
            {allowAll && (
              <button type="button" onClick={selectAll} className="press shrink-0 text-xs font-semibold text-primary">All</button>
            )}
            <button type="button" onClick={clearAll} className="press shrink-0 text-xs font-semibold text-foreground/50">Clear</button>
          </div>
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {shown.map((r) => {
              const on = selected.has(r.id);
              return (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-card">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(r.id)}
                      className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-faint">{r.email}</span>
                    </span>
                  </label>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-2 py-1 text-xs text-faint">No one matches that.</li>}
          </ul>
        </div>
      )}

      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject (optional)"
        className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />

      <p className="text-xs text-muted">
        {audience.length > 0 ? (
          <>Emailing <strong>{audience.length}</strong> {plural(audience.length, "person", "people")}.</>
        ) : mode === "role" ? (
          <>Pick a role above to choose who to email.</>
        ) : (
          <>No one selected yet.</>
        )}
      </p>

      {tooMany && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs text-foreground/70">
          That&rsquo;s a lot of recipients. If your mail app doesn&rsquo;t open or drops some, tap{" "}
          <strong>Copy addresses</strong> and paste them into a new email instead.
        </p>
      )}

      <div className="flex items-center gap-2">
        {audience.length > 0 ? (
          <a
            href={href}
            className="press flex-1 rounded-xl bg-primary py-2.5 text-center text-sm font-semibold text-white"
          >
            ✉️ Open email
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="press flex-1 rounded-xl bg-primary py-2.5 text-center text-sm font-semibold text-white opacity-40"
          >
            ✉️ Open email
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          disabled={audience.length === 0}
          className="press shrink-0 rounded-xl bg-background px-4 py-2.5 text-sm font-semibold text-primary ring-1 ring-primary/40 disabled:opacity-40"
        >
          Copy addresses
        </button>
      </div>
      {copied.status && <p className="text-xs font-medium text-accent">{copied.status}</p>}
    </div>
  );
}
