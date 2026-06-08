"use client";

import { useEffect, useState } from "react";
import { BackLink } from "@/components/BackLink";

const COURSE_ID = 19715;
const SCHEDULE_ID = 2251;
// "Daily Golf" booking class on schedule 2251. The schedule has two classes
// (Daily Golf + Members); without specifying one, foreUP shows a chooser
// before the time list. We pre-select Daily Golf in the deep link.
const DAILY_GOLF_BOOKING_CLASS_ID = 2431;
const FOREUP_BASE = `https://stage.foreupsoftware.com/index.php/booking/${COURSE_ID}/${SCHEDULE_ID}`;

// Pulled from Inshalla's profile in the foreUP booking page (the same blob
// that drives their own "About" widget). Public info; the course publishes
// it on their website too.
const INSHALLA_PHONE_DISPLAY = "(715) 453-3130";
const INSHALLA_PHONE_TEL = "+17154533130"; // E.164 for tel: links

// Sagacity Golf's "Daily Deals" embed widget for Inshalla. The /widget/ path
// + Access-Control-Allow-Origin: * + no X-Frame-Options + UTM-tagged partner
// referrals from foreUP itself together signal this is an explicit
// embed-on-partner-sites product. Different from the foreUP situation: this
// one is meant to be iframed.
const DAILY_DEALS_EMBED = new URL(
  "https://inshalla.dailydeals.golf/widget/layout/2/times"
);
DAILY_DEALS_EMBED.searchParams.set("utm_source", "mlr-app");
DAILY_DEALS_EMBED.searchParams.set("utm_medium", "tee-times");
DAILY_DEALS_EMBED.searchParams.set("utm_campaign", "daily-deals");
const DAILY_DEALS_URL = DAILY_DEALS_EMBED.toString();

/**
 * Builds a foreUP booking URL that skips the booking-class chooser. Discovered
 * in the SPA bundle:
 *
 *   if (urlParams.get('booking_class_id') && urlParams.get('schedule_id')) {
 *     filters.set('booking_class', urlParams.get('booking_class_id'));
 *     filters.set('schedule_id',   urlParams.get('schedule_id'));
 *     // also reads: date, players, time_of_day, holes
 *   }
 *
 * Date format is MM-DD-YYYY (foreUP's UI convention, not ISO).
 */
function buildForeUpUrl(opts: { dateMdY?: string } = {}) {
  const params = new URLSearchParams({
    booking_class_id: String(DAILY_GOLF_BOOKING_CLASS_ID),
    schedule_id: String(SCHEDULE_ID),
  });
  if (opts.dateMdY) params.set("date", opts.dateMdY);
  return `${FOREUP_BASE}?${params.toString()}#/teetimes`;
}

/**
 * Tee Times — a clean hand-off to foreUP (ported from the stock-game app;
 * same booking logic, restyled to MLR's light forest-green theme).
 *
 * We deliberately don't fetch foreUP's API or scrape its HTML. foreUP's terms
 * (§3.2.v) prohibit programmatic crawling/scraping; their robots.txt disallows
 * all automated agents. Instead, we present a minimal in-app landing with
 * quick-pick day chips that each deep-link straight into Daily Golf for that
 * day. Tapping a chip opens foreUP in a new tab pre-filtered to the chosen
 * date — no booking-class chooser, no extra tap. foreUP renders its own
 * (very nice) tee-time list with auth, payment, and captcha intact.
 *
 * The "today/tomorrow/day-after" dates are computed on the client (mounted
 * gate) rather than at build time — this page ships in MLR's static GitHub
 * Pages export, and a build-time `new Date()` would bake a stale "today" into
 * the HTML (wrong tee-time dates until JS loads, plus a hydration mismatch).
 */
export function TeeTimesView() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  return (
    <div className="space-y-6 pt-2">
      <BackLink href="/local-places" label="Local Places" />
      <header className="space-y-0.5">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50">
          Tee Times
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Inshalla CC</h1>
        <p className="text-sm text-foreground/60">Tomahawk, WI</p>
      </header>

      <section>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground/50">
          Quick book
        </div>
        <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border divide-y divide-border">
          {now && (
            <>
              <DayLink date={now} label="Today" />
              <DayLink date={addDays(now, 1)} label="Tomorrow" />
              <DayLink date={addDays(now, 2)} label={fmtDow(addDays(now, 2))} />
            </>
          )}
          {!now && <DaySkeleton />}
        </div>

        <a
          href={buildForeUpUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="press mt-4 flex items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-[15px] font-semibold text-white transition-colors active:bg-primary/90"
        >
          View all available times ↗
        </a>

        <a
          href={`tel:${INSHALLA_PHONE_TEL}`}
          className="press mt-2 flex items-center justify-center gap-2 rounded-2xl bg-card py-3 text-[14px] font-semibold text-foreground ring-1 ring-border transition-colors active:bg-background"
        >
          <PhoneIcon />
          <span>Call pro shop</span>
          <span className="font-medium tabular-nums text-foreground/50">
            {INSHALLA_PHONE_DISPLAY}
          </span>
        </a>
      </section>

      <section>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground/50">
          Daily Deals
        </div>
        <a
          href={DAILY_DEALS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="press flex items-center rounded-2xl bg-card px-4 py-4 ring-1 ring-border transition-colors active:bg-background"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-foreground">View Daily Deals</span>
              <span className="rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                Save
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-foreground/50">
              Discounted Inshalla tee times via Sagacity Golf
            </div>
          </div>
          <div className="ml-3 text-[18px] leading-none text-foreground/30">↗</div>
        </a>
      </section>

      <div>
        <p className="text-[11px] leading-relaxed text-foreground/50">
          Tee times, pricing, and booking are managed by Inshalla Country Club
          via foreUP. Tapping a day above opens foreUP&apos;s secure booking
          page pre-filtered to that day — your tee time, account, and payment
          all live there. Or tap the call button to book by phone.
        </p>
        <p className="mt-3 text-[11px] text-foreground/40">
          <a
            href={`${FOREUP_BASE}#/teetimes`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-border active:text-foreground/70"
          >
            Inshalla CC on foreUP →
          </a>
        </p>
      </div>
    </div>
  );
}

function DayLink({ date, label }: { date: Date; label: string }) {
  const fullDate = fmtFullDate(date);
  return (
    <a
      href={buildForeUpUrl({ dateMdY: toForeUpDate(date) })}
      target="_blank"
      rel="noopener noreferrer"
      className="press flex items-center px-4 py-4 transition-colors active:bg-background"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-foreground">{label}</div>
        <div className="text-[11px] text-foreground/50">{fullDate}</div>
      </div>
      <div className="ml-3 text-[18px] leading-none text-foreground/30">↗</div>
    </a>
  );
}

// Placeholder rows shown until the client computes today's date (keeps the
// card height stable; matches the server-prerendered HTML to avoid a
// hydration mismatch).
function DaySkeleton() {
  return (
    <div className="animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center px-4 py-4">
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-20 rounded bg-border" />
            <div className="h-2.5 w-28 rounded bg-border/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---- date helpers ----

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function toForeUpDate(d: Date): string {
  // foreUP's URL date is MM-DD-YYYY in local time.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}-${day}-${y}`;
}

function fmtFullDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDow(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long" });
}
