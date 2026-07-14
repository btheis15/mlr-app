"use client";

import { useState } from "react";
import { useCachedResource } from "@/lib/swrCache";

// Open-Meteo, no API key needed. Lat/long is Tomahawk, WI (the resort).
// forecast_days=6 → today (index 0, used for the current hi/lo) + the next 5
// days for the strip below.
const FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=45.53492&longitude=-89.69830&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago&forecast_days=6";

const CACHE_MS = 30 * 60 * 1000; // 30 minutes

interface DayForecast {
  day: string; // "Mon", "Tue", …
  hi: number;
  lo: number;
  code: number;
  /** Chance of precipitation, 0-100, that day's max — omitted if Open-Meteo didn't return it. */
  precipProb: number | null;
}

interface WeatherSnapshot {
  ts: number;
  temp: number;
  hi: number;
  lo: number;
  code: number;
  /** Next 5 days, excluding today. */
  forecast: DayForecast[];
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

/** Fetch + validate the Open-Meteo forecast. THROWS on any failure (bad
 *  network, blocked fetch, malformed response) so the SWR cache keeps the last
 *  good snapshot instead of overwriting it with nothing. */
async function fetchWeather(): Promise<WeatherSnapshot> {
  const res = await fetch(FORECAST_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("weather fetch failed");
  const data = await res.json();
  const temp = data?.current?.temperature_2m;
  const code = data?.current?.weather_code;
  const hi = data?.daily?.temperature_2m_max?.[0];
  const lo = data?.daily?.temperature_2m_min?.[0];
  if (typeof temp !== "number" || typeof code !== "number" || typeof hi !== "number" || typeof lo !== "number") {
    throw new Error("weather response malformed");
  }
  const dailyTimes: string[] = data?.daily?.time ?? [];
  const dailyHi: number[] = data?.daily?.temperature_2m_max ?? [];
  const dailyLo: number[] = data?.daily?.temperature_2m_min ?? [];
  const dailyCode: number[] = data?.daily?.weather_code ?? [];
  const dailyPrecip: number[] = data?.daily?.precipitation_probability_max ?? [];
  const forecast: DayForecast[] = [];
  for (let i = 1; i < dailyTimes.length && forecast.length < 5; i++) {
    if (typeof dailyHi[i] !== "number" || typeof dailyLo[i] !== "number" || typeof dailyCode[i] !== "number") continue;
    forecast.push({
      day: new Date(`${dailyTimes[i]}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" }),
      hi: dailyHi[i],
      lo: dailyLo[i],
      code: dailyCode[i],
      precipProb: typeof dailyPrecip[i] === "number" ? dailyPrecip[i] : null,
    });
  }
  return { ts: Date.now(), temp, hi, lo, code, forecast };
}

/**
 * Compact "what's it like Up North" strip — current temp + today's hi/lo for
 * Tomahawk, WI, via Open-Meteo (no key, no backend). Collapsed to one row by
 * default; tapping it reveals a 5-day-forecast row underneath (same
 * "collapsed card that expands on tap" idiom as WorkChecklist — plain
 * conditional render, no animation). Public — no sign-in gate. Caches the
 * result via the shared SWR cache (localStorage, 30-minute TTL) so the strip
 * paints instantly on a cold open and tab-hopping doesn't blank it; a
 * background revalidate keeps it current. Renders nothing before the first
 * successful fetch — this is a nice-to-have, never worth an error state or
 * empty shell.
 *
 * Usage: `<WeatherCard />` — anywhere on Home, no props, public (works for
 * guests too).
 */
export function WeatherCard() {
  const { data: snap } = useCachedResource<WeatherSnapshot | null>(
    "weather",
    null,
    fetchWeather,
    { persist: "local", ttlMs: CACHE_MS },
  );
  const [open, setOpen] = useState(false);

  if (!snap) return null;

  const hasForecast = snap.forecast.length > 0;

  return (
    <div className="rounded-2xl bg-card ring-1 ring-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!hasForecast}
        className="press flex w-full items-center gap-3 p-4 text-left"
      >
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
        {hasForecast && (
          <span
            aria-hidden
            className={`shrink-0 text-faint transition-transform duration-[var(--dur-tap)] ease-[var(--ease-spring)] ${open ? "rotate-90" : ""}`}
          >
            ›
          </span>
        )}
      </button>

      {open && hasForecast && (
        <div className="grid grid-cols-5 gap-1 border-t border-border/60 px-4 pb-4 pt-3">
          {snap.forecast.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <span className="text-[11px] font-medium text-foreground/60">{d.day}</span>
              <span aria-hidden className="text-base leading-none">
                {weatherEmoji(d.code)}
              </span>
              <span className="text-[11px] font-semibold tabular-nums">{Math.round(d.hi)}°</span>
              <span className="text-[11px] tabular-nums text-faint">{Math.round(d.lo)}°</span>
              {d.precipProb != null && (
                <span className="text-[11px] tabular-nums text-lake">💧{d.precipProb}%</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
