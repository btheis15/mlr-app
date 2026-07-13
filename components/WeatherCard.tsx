"use client";

import { useEffect, useState } from "react";

// Open-Meteo, no API key needed. Lat/long is Tomahawk, WI (the resort).
const FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=45.47&longitude=-89.72&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago";

const CACHE_KEY = "mlr.weather.cache";
const CACHE_MS = 30 * 60 * 1000; // 30 minutes

interface WeatherSnapshot {
  ts: number;
  temp: number;
  hi: number;
  lo: number;
  code: number;
}

/** WMO weather-code → one of the design's seven emoji buckets. */
function weatherEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code === 1 || code === 2) return "🌤";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "🌧";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "❄️";
  if (code >= 95) return "⛈";
  return "☁️";
}

function readCache(): WeatherSnapshot | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WeatherSnapshot;
    if (!parsed || typeof parsed.ts !== "number" || Date.now() - parsed.ts > CACHE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(snap: WeatherSnapshot) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(snap));
  } catch {
    /* private-browsing / quota — the card just re-fetches next time */
  }
}

/**
 * Compact "what's it like Up North" strip — current temp + today's hi/lo
 * for Tomahawk, WI, via Open-Meteo (no key, no backend). Public — no sign-in
 * gate. Caches the result in sessionStorage for 30 minutes so tab-hopping
 * around the app doesn't re-fetch. Renders nothing while loading or on any
 * failure (bad network, blocked fetch, malformed response) — this is a
 * nice-to-have, never worth an error state or empty shell.
 *
 * Usage: `<WeatherCard />` — anywhere on Home, no props, public (works for
 * guests too).
 */
export function WeatherCard() {
  const [snap, setSnap] = useState<WeatherSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache();
    if (cached) {
      setSnap(cached);
      return;
    }
    (async () => {
      try {
        const res = await fetch(FORECAST_URL, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const temp = data?.current?.temperature_2m;
        const code = data?.current?.weather_code;
        const hi = data?.daily?.temperature_2m_max?.[0];
        const lo = data?.daily?.temperature_2m_min?.[0];
        if (typeof temp !== "number" || typeof code !== "number" || typeof hi !== "number" || typeof lo !== "number") {
          return;
        }
        const next: WeatherSnapshot = { ts: Date.now(), temp, hi, lo, code };
        writeCache(next);
        if (!cancelled) setSnap(next);
      } catch {
        /* offline / blocked / malformed — stay hidden, never show an error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!snap) return null;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <span aria-hidden className="text-3xl leading-none">
        {weatherEmoji(snap.code)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{Math.round(snap.temp)}° Up North</p>
        <p className="mt-0.5 text-xs text-foreground/60">
          H {Math.round(snap.hi)}° / L {Math.round(snap.lo)}°
        </p>
      </div>
      <p className="shrink-0 text-xs italic text-faint">Tomahawk, WI</p>
    </div>
  );
}
