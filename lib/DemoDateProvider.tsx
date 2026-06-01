"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { toISODate } from "@/lib/festSeason";

const KEY = "mlr-demo-date";

interface DemoDateValue {
  /** ISO "YYYY-MM-DD" override, or null when showing the real today. */
  demoDate: string | null;
  setDemoDate: (d: string | null) => void;
  /** Effective "now" for season math; null until mounted (SSR-safe). */
  now: Date | null;
  /** Effective today as ISO "YYYY-MM-DD"; null until mounted. */
  today: string | null;
}

const Ctx = createContext<DemoDateValue>({
  demoDate: null,
  setDemoDate: () => {},
  now: null,
  today: null,
});

export function useDemoDate() {
  return useContext(Ctx);
}

/**
 * A device-local "see the app as if it's this day" override, for testing/demo.
 * When a demo date is set, the whole season model (countdown / live week / wrap)
 * and the "today" filters behave as if it were that date. Persisted in
 * localStorage; set it from Profile. Returns null `now`/`today` until mounted so
 * server and first client render match (no hydration mismatch).
 */
export function DemoDateProvider({ children }: { children: React.ReactNode }) {
  const [demoDate, setState] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    try {
      setState(localStorage.getItem(KEY));
    } catch {
      /* ignore */
    }
    setMounted(true);
    // With no override, refresh hourly so a long-open tab rolls over days.
    const id = setInterval(() => force((n) => n + 1), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const setDemoDate = (d: string | null) => {
    setState(d);
    try {
      if (d) localStorage.setItem(KEY, d);
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  };

  const now = !mounted
    ? null
    : demoDate
      ? new Date(`${demoDate}T12:00:00`)
      : new Date();
  const today = !mounted ? null : (demoDate ?? toISODate(new Date()));

  return (
    <Ctx.Provider value={{ demoDate, setDemoDate, now, today }}>
      {children}
    </Ctx.Provider>
  );
}
