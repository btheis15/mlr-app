"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { MigrationHint } from "@/components/MigrationHint";

/**
 * Admin-only: recent authentication events with the IP they came from, resolved
 * to an approximate city/country so an admin can spot access that looks far-off
 * (e.g. a sign-in from another country) versus the expected local members.
 *
 * Data comes from `recent_signins()` — a SECURITY DEFINER function gated to
 * admins that reads GoTrue's audit log (migration 0011). IP → location is
 * resolved client-side via ipwho.is (free, no key, HTTPS). IP geolocation is
 * approximate by nature: it lands near the right city / ISP region, not a
 * street address — precise location would need the device's GPS (and consent).
 */

const HOME_COUNTRY = "US"; // members are US-based; anything else gets flagged.

interface SigninRow {
  created_at: string;
  email: string | null;
  action: string | null;
  ip_address: string | null;
}

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
  const [rows, setRows] = useState<SigninRow[]>([]);
  const [geo, setGeo] = useState<Record<string, Geo>>({});
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      const { data, error } = await sb.rpc("recent_signins", { limit_n: 50 });
      if (!active) return;
      if (error || !data) {
        setReady(false);
        setLoading(false);
        return;
      }
      const list = data as SigninRow[];
      setReady(true);
      setRows(list);
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

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>
        <h2 className="text-sm font-semibold">Recent sign-ins</h2>
      </div>

      <p className="text-xs text-foreground/60">
        Where recent sign-ins came from, by IP address. Locations are{" "}
        <strong>approximate</strong> (city / ISP region) — useful to spot access from far away,
        not a precise spot. Anything outside the US is flagged.
      </p>

      {!ready && !loading && (
        <MigrationHint file="0011_admin_signin_log.sql">To turn this on,</MigrationHint>
      )}

      {loading ? (
        <p className="py-3 text-center text-xs text-foreground/45">Loading sign-ins…</p>
      ) : ready && rows.length === 0 ? (
        <p className="py-3 text-center text-xs text-foreground/45">No sign-in activity yet.</p>
      ) : ready ? (
        <ul className="space-y-1.5">
          {rows.map((r, i) => {
            const g = r.ip_address ? geo[r.ip_address] : undefined;
            const foreign = g?.ok && g.country_code && g.country_code !== HOME_COUNTRY;
            const place = g?.ok
              ? [g.city, g.region, g.country].filter(Boolean).join(", ")
              : null;
            return (
              <li
                key={`${r.created_at}-${i}`}
                className={`rounded-xl bg-background p-2.5 text-xs ring-1 ${
                  foreign ? "ring-accent/50" : "ring-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{labelFor(r.action)}</span>
                  {foreign && (
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      Outside US
                    </span>
                  )}
                  <span className="ml-auto text-foreground/45">{whenFor(r.created_at)}</span>
                </div>
                {r.email && <p className="truncate text-foreground/70">{r.email}</p>}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-foreground/55">
                  <span className="font-mono text-[11px]">{r.ip_address}</span>
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
                  {r.ip_address && g && !g.ok && <span className="text-foreground/40">· location unknown</span>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
