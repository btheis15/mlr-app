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
 *     also get their email. This is the reliable signal that a new member like
 *     Meher just joined — it doesn't depend on the audit log.
 *   • Sign-ins come from `recent_signins()` — a SECURITY DEFINER function gated
 *     to admins that reads GoTrue's audit log (migration 0011). These carry an
 *     IP, resolved client-side to an approximate city/country via ipwho.is
 *     (free, no key, HTTPS). GoTrue's audit log can be empty/pruned, which is
 *     why joins are surfaced independently rather than relying on it.
 *
 * IP geolocation is approximate by nature: it lands near the right city / ISP
 * region, not a street address — precise location would need the device's GPS
 * (and consent).
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
  | { kind: "join"; created_at: string; email: string | null; name: string | null }
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

      let list: SigninRow[] = [];
      if (!audit.error && audit.data) {
        list = audit.data as SigninRow[];
        setSignins(list);
        setSigninsReady(true);
      } else {
        setSigninsReady(false);
      }
      setLoading(false);

      // Resolve each unique IP to an approximate location (one lookup per IP).
      const ips = Array.from(
        new Set(list.map((r) => r.ip_address).filter(Boolean) as string[]),
      );
      for (const ip of ips) {
        try {
          const res = await fetch(`https://ipwho.is/${ip}`);
          const j = await res.json();
          if (!active) return;
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
          if (!active) return;
          setGeo((prev) => ({ ...prev, [ip]: { ok: false } }));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Merge joins + sign-ins into one newest-first list. A join is already
  // represented by GoTrue's "New sign-up" audit event when that exists, so drop
  // the duplicate (keep the audit row — it carries the IP/location).
  const signupEmails = new Set(
    signins
      .filter((r) => r.action === "user_signedup" && r.email)
      .map((r) => (r.email as string).toLowerCase()),
  );
  const activity: Activity[] = [
    ...joins
      .filter((m) => m.created_at && !(m.email && signupEmails.has(m.email.toLowerCase())))
      .map(
        (m): Activity => ({
          kind: "join",
          created_at: m.created_at as string,
          email: m.email,
          name: m.display_name,
        }),
      ),
    ...signins.map(
      (r): Activity => ({
        kind: "signin",
        created_at: r.created_at,
        email: r.email,
        action: r.action,
        ip_address: r.ip_address,
      }),
    ),
  ].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>
        <h2 className="text-sm font-semibold">Recent activity</h2>
      </div>

      <p className="text-xs text-foreground/60">
        New members and recent sign-ins. Sign-in locations are{" "}
        <strong>approximate</strong> (city / ISP region) — useful to spot access from far away,
        not a precise spot. Anything outside the US is flagged.
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
            if (a.kind === "join") {
              const name = a.name?.trim() || a.email || "New member";
              return (
                <li
                  key={`join-${a.created_at}-${i}`}
                  className="rounded-xl bg-background p-2.5 text-xs ring-1 ring-primary/30"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Joined</span>
                    <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      New member
                    </span>
                    <span className="ml-auto text-foreground/45">{whenFor(a.created_at)}</span>
                  </div>
                  <p className="truncate text-foreground/70">{name}</p>
                  {a.email && a.email !== name && (
                    <p className="truncate text-foreground/55">{a.email}</p>
                  )}
                </li>
              );
            }

            const g = a.ip_address ? geo[a.ip_address] : undefined;
            const foreign = g?.ok && g.country_code && g.country_code !== HOME_COUNTRY;
            const place = g?.ok
              ? [g.city, g.region, g.country].filter(Boolean).join(", ")
              : null;
            return (
              <li
                key={`signin-${a.created_at}-${i}`}
                className={`rounded-xl bg-background p-2.5 text-xs ring-1 ${
                  foreign ? "ring-accent/50" : "ring-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{labelFor(a.action)}</span>
                  {foreign && (
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      Outside US
                    </span>
                  )}
                  <span className="ml-auto text-foreground/45">{whenFor(a.created_at)}</span>
                </div>
                {a.email && <p className="truncate text-foreground/70">{a.email}</p>}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-foreground/55">
                  <span className="font-mono text-[11px]">{a.ip_address}</span>
                  {place && (
                    <span>
                      {g?.flag ? `${g.flag} ` : ""}
                      {place}
                    </span>
                  )}
                  {g?.isp && <span className="text-foreground/40">· {g.isp}</span>}
                  {g?.ok && g.lat != null && g.lon != null && (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lon}#map=11/${g.lat}/${g.lon}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      map
                    </a>
                  )}
                  {a.ip_address && g && !g.ok && <span className="text-foreground/40">· location unknown</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
