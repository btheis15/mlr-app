"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { MigrationHint } from "@/components/MigrationHint";

/**
 * Admin-only: recent member activity — who just **joined**, plus recent
 * authentication events with the IP they came from (so an admin can spot
 * access that looks far-off, e.g. a sign-in from another country, versus the
 * expected local members).
 *
 * Two sources, merged into one time-ordered list:
 *   • Joins come from `profiles.created_at` (a profile row is auto-created the
 *     moment someone signs up — migration 0001's `handle_new_user` trigger),
 *     read through the admin-gated `admin_members()` RPC (migration 0008) so we
 *     also get their email. This is the reliable signal that a new member just
 *     joined — it doesn't depend on the audit log.
 *   • Sign-ins come from `recent_signins()` — a SECURITY DEFINER function gated
 *     to admins that reads GoTrue's audit log (migration 0011). These carry an
 *     IP. The sign-up event in that log lets us attach the IP a member joined
 *     from to their "Joined" row.
 *
 * Tap any row to expand its IP + geolocation. IP → location is resolved
 * **on demand** (when a row is opened) via ipwho.is (free, no key, HTTPS). It's
 * approximate by nature: it lands near the right city / ISP region, not a
 * street address — precise location would need the device's GPS (and consent).
 * A join only has an IP if GoTrue recorded one at sign-up; otherwise the row
 * says so (the profile-creation timestamp itself carries no IP).
 */

const HOME_COUNTRY = "US"; // members are US-based; anything else gets flagged.

interface SigninRow {
  created_at: string;
  email: string | null;
  action: string | null;
  ip_address: string | null;
}

interface MemberRow {
  id: string;
  display_name: string | null;
  email: string | null;
  created_at: string | null;
}

// A unified activity entry: either a member join or an auth sign-in event.
type Activity =
  | { kind: "join"; created_at: string; email: string | null; name: string | null; ip_address: string | null }
  | {
      kind: "signin";
      created_at: string;
      email: string | null;
      action: string | null;
      ip_address: string | null;
    };

interface Geo {
  ok: boolean;
  city?: string;
  region?: string;
  country?: string;
  country_code?: string;
  flag?: string;
  isp?: string;
  lat?: number;
  lon?: number;
}

const ACTION_LABELS: Record<string, string> = {
  login: "Signed in",
  user_signedup: "New sign-up",
  user_modified: "Account updated",
  user_recovery_requested: "Recovery code requested",
  user_reauthenticate_requested: "Re-auth requested",
  otp_requested: "Login code requested",
};

function labelFor(action: string | null): string {
  if (!action) return "Activity";
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

function whenFor(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AdminSignins() {
  const [joins, setJoins] = useState<MemberRow[]>([]);
  const [signins, setSignins] = useState<SigninRow[]>([]);
  const [geo, setGeo] = useState<Record<string, Geo>>({});
  const [open, setOpen] = useState<string | null>(null); // key of the expanded row
  const [loading, setLoading] = useState(true);
  // True once the GoTrue audit-log function answers (migration 0011 applied).
  const [signinsReady, setSigninsReady] = useState(false);

  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      // Joins (reliable) and sign-ins (audit log, may be empty) load in
      // parallel — neither blocks the other.
      const [members, audit] = await Promise.all([
        sb.rpc("admin_members"),
        sb.rpc("recent_signins", { limit_n: 50 }),
      ]);
      if (!active) return;

      if (!members.error && members.data) {
        setJoins(members.data as MemberRow[]);
      }
      if (!audit.error && audit.data) {
        setSignins(audit.data as SigninRow[]);
        setSigninsReady(true);
      } else {
        setSigninsReady(false);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Resolve one IP to an approximate location, on demand (when its row opens).
  // Cached in `geo` so re-opening a row doesn't look it up again.
  const lookupGeo = async (ip: string) => {
    if (geo[ip]) return;
    setGeo((prev) => ({ ...prev, [ip]: { ok: false } })); // optimistic placeholder
    try {
      const res = await fetch(`https://ipwho.is/${ip}`);
      const j = await res.json();
      setGeo((prev) => ({
        ...prev,
        [ip]: j?.success
          ? {
              ok: true,
              city: j.city,
              region: j.region,
              country: j.country,
              country_code: j.country_code,
              flag: j.flag?.emoji,
              isp: j.connection?.isp || j.connection?.org,
              lat: j.latitude,
              lon: j.longitude,
            }
          : { ok: false },
      }));
    } catch {
      setGeo((prev) => ({ ...prev, [ip]: { ok: false } }));
    }
  };

  const toggle = (key: string, ip: string | null) => {
    const next = open === key ? null : key;
    setOpen(next);
    if (next && ip) lookupGeo(ip);
  };

  // The IP each member joined from, pulled from GoTrue's "New sign-up" audit
  // event (when it recorded one), keyed by email so we can attach it to joins.
  const signupIpByEmail = new Map<string, string>();
  for (const r of signins) {
    if (r.action === "user_signedup" && r.email && r.ip_address) {
      signupIpByEmail.set(r.email.toLowerCase(), r.ip_address);
    }
  }

  // Merge joins + sign-ins into one newest-first list. Sign-up audit events are
  // dropped — the "Joined" row already represents them (and now carries the
  // sign-up IP), so we keep the join's friendlier name + email.
  const activity: Activity[] = [
    ...joins
      .filter((m) => m.created_at)
      .map(
        (m): Activity => ({
          kind: "join",
          created_at: m.created_at as string,
          email: m.email,
          name: m.display_name,
          ip_address: m.email ? signupIpByEmail.get(m.email.toLowerCase()) ?? null : null,
        }),
      ),
    ...signins
      .filter((r) => r.action !== "user_signedup")
      .map(
        (r): Activity => ({
          kind: "signin",
          created_at: r.created_at,
          email: r.email,
          action: r.action,
          ip_address: r.ip_address,
        }),
      ),
  ].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  // The IP + location detail shown when a row is expanded.
  const detail = (ip: string | null) => {
    if (!ip) {
      return (
        <p className="mt-2 rounded-lg bg-card px-2.5 py-2 text-foreground/55">
          No sign-in IP on record — a location will show once this member signs in.
        </p>
      );
    }
    const g = geo[ip];
    const place = g?.ok ? [g.city, g.region, g.country].filter(Boolean).join(", ") : null;
    return (
      <div className="mt-2 space-y-1 rounded-lg bg-card px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="text-foreground/45">IP</span>
          <span className="font-mono text-[11px] text-foreground/70">{ip}</span>
        </div>
        {!g ? (
          <p className="text-foreground/45">Looking up location…</p>
        ) : g.ok ? (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-foreground/65">
              {place && (
                <span>
                  {g.flag ? `${g.flag} ` : ""}
                  {place}
                </span>
              )}
              {g.isp && <span className="text-foreground/40">· {g.isp}</span>}
            </div>
            {g.lat != null && g.lon != null && (
              <a
                href={`https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lon}#map=11/${g.lat}/${g.lon}`}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-primary underline"
              >
                View on map ↗
              </a>
            )}
          </>
        ) : (
          <p className="text-foreground/45">Location unavailable for this IP.</p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>
        <h2 className="text-sm font-semibold">Recent activity</h2>
      </div>

      <p className="text-xs text-foreground/60">
        New members and recent sign-ins. <strong>Tap a row</strong> to see the IP and an{" "}
        <strong>approximate</strong> location (city / ISP region) — useful to spot access from far
        away, not a precise spot. Anything outside the US is flagged.
      </p>

      {!signinsReady && !loading && (
        <MigrationHint file="0011_admin_signin_log.sql">
          To also show sign-ins and where they came from,
        </MigrationHint>
      )}

      {loading ? (
        <p className="py-3 text-center text-xs text-foreground/45">Loading activity…</p>
      ) : activity.length === 0 ? (
        <p className="py-3 text-center text-xs text-foreground/45">No activity yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {activity.map((a, i) => {
            const key = `${a.kind}-${a.created_at}-${i}`;
            const isOpen = open === key;
            const g = a.ip_address ? geo[a.ip_address] : undefined;
            const foreign = g?.ok && g.country_code && g.country_code !== HOME_COUNTRY;
            const isJoin = a.kind === "join";
            const name = isJoin ? a.name?.trim() || a.email || "New member" : null;
            return (
              <li
                key={key}
                className={`overflow-hidden rounded-xl bg-background text-xs ring-1 ${
                  foreign ? "ring-accent/50" : isJoin ? "ring-primary/30" : "ring-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(key, a.ip_address)}
                  aria-expanded={isOpen}
                  className="press flex w-full flex-col items-stretch gap-0.5 p-2.5 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{isJoin ? "Joined" : labelFor(a.action)}</span>
                    {isJoin && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        New member
                      </span>
                    )}
                    {foreign && (
                      <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                        Outside US
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1.5 text-foreground/45">
                      {whenFor(a.created_at)}
                      <span className={`transition-transform ${isOpen ? "rotate-180" : ""}`}>⌄</span>
                    </span>
                  </div>
                  {isJoin ? (
                    <>
                      <span className="truncate text-foreground/70">{name}</span>
                      {a.email && a.email !== name && (
                        <span className="truncate text-foreground/55">{a.email}</span>
                      )}
                    </>
                  ) : (
                    a.email && <span className="truncate text-foreground/70">{a.email}</span>
                  )}
                </button>
                {isOpen && <div className="px-2.5 pb-2.5">{detail(a.ip_address)}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
