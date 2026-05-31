"use client";

import { useEffect, useMemo, useState } from "react";
import type { CrewMember, RsvpStatus } from "@/lib/types";
import { useIdentity } from "@/components/IdentityProvider";
import { READ_ONLY } from "@/lib/features";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";

const STORAGE_KEY = "family-fest-rsvps";

const STATUS_META: Record<RsvpStatus, { label: string; emoji: string; tone: string }> = {
  yes: { label: "Coming", emoji: "✅", tone: "text-primary" },
  maybe: { label: "Maybe", emoji: "🤔", tone: "text-accent" },
  no: { label: "Can't make it", emoji: "🚫", tone: "text-foreground/40" },
};

/**
 * Crew / RSVP view. Seed households come from lib/data; anything added here is
 * stored in localStorage so it survives reloads on the same device (no backend
 * yet). When a real API lands, swap the load/save calls.
 */
export function CrewView({ seed }: { seed: CrewMember[] }) {
  const { user, promptSignIn } = useIdentity();
  const [added, setAdded] = useState<CrewMember[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setAdded(JSON.parse(raw));
    } catch {
      /* ignore malformed storage */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(added));
  }, [added, loaded]);

  const everyone = useMemo(() => [...seed, ...added], [seed, added]);

  const goingHeadcount = everyone
    .filter((c) => c.status === "yes")
    .reduce((sum, c) => sum + c.headcount, 0);
  const maybeHeadcount = everyone
    .filter((c) => c.status === "maybe")
    .reduce((sum, c) => sum + c.headcount, 0);

  const byStatus = (s: RsvpStatus) => everyone.filter((c) => c.status === s);

  return (
    <div className="space-y-6 pt-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Crew</h1>
        <p className="text-sm text-foreground/60">
          Who&rsquo;s coming, and who&rsquo;s bringing what.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
          <div className="text-2xl font-bold text-primary">{goingHeadcount}</div>
          <div className="text-xs text-foreground/60">confirmed</div>
        </div>
        <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
          <div className="text-2xl font-bold text-accent">+{maybeHeadcount}</div>
          <div className="text-xs text-foreground/60">maybe</div>
        </div>
      </section>

      {(["yes", "maybe", "no"] as RsvpStatus[]).map((status) => {
        const group = byStatus(status);
        if (group.length === 0) return null;
        const meta = STATUS_META[status];
        return (
          <section key={status} className="space-y-2">
            <h2 className={`text-sm font-semibold ${meta.tone}`}>
              {meta.emoji} {meta.label} · {group.length}
            </h2>
            <ul className="space-y-2">
              {group.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3 ring-1 ring-border"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                    {c.bringing && (
                      <p className="truncate text-xs text-foreground/60">
                        🍽️ {c.bringing}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-background px-2 py-1 text-xs font-medium text-foreground/70 ring-1 ring-border">
                    {c.headcount} {c.headcount === 1 ? "person" : "people"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {READ_ONLY ? (
        <ComingSoonCTA
          icon="✋"
          title="RSVP opens soon"
          note="You'll be able to add your household and what you're bringing once sign-in is live."
        />
      ) : user ? (
        <AddRsvp onAdd={(member) => setAdded((prev) => [...prev, member])} />
      ) : (
        <button
          onClick={promptSignIn}
          className="w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-white"
        >
          Add your name &amp; email to RSVP
        </button>
      )}
    </div>
  );
}

function AddRsvp({ onAdd }: { onAdd: (member: CrewMember) => void }) {
  const [name, setName] = useState("");
  const [headcount, setHeadcount] = useState(1);
  const [status, setStatus] = useState<RsvpStatus>("yes");
  const [bringing, setBringing] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      id: `user-${Date.now()}`,
      name: name.trim(),
      headcount: Math.max(1, headcount),
      status,
      bringing: bringing.trim() || undefined,
    });
    setName("");
    setHeadcount(1);
    setStatus("yes");
    setBringing("");
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border"
    >
      <h2 className="text-sm font-semibold text-primary">Add your RSVP</h2>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your family / household name"
        className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <div className="flex gap-3">
        <label className="flex flex-1 items-center gap-2 text-sm text-foreground/70">
          People
          <input
            type="number"
            min={1}
            value={headcount}
            onChange={(e) => setHeadcount(Number(e.target.value))}
            className="w-16 rounded-xl bg-background px-2 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as RsvpStatus)}
          className="flex-1 rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="yes">Coming</option>
          <option value="maybe">Maybe</option>
          <option value="no">Can&rsquo;t make it</option>
        </select>
      </div>
      <input
        value={bringing}
        onChange={(e) => setBringing(e.target.value)}
        placeholder="Bringing something? (optional)"
        className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <button
        type="submit"
        className="w-full rounded-xl bg-primary py-2 text-sm font-semibold text-white"
      >
        Add to the crew
      </button>
    </form>
  );
}
