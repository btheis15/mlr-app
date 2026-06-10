// Intent classification + date resolution for the AI Assistant.
//
// Pure functions, no data imports — so they're trivial to test and run the same
// on the client (today) and in the server route (later). Deliberately simple
// keyword/regex heuristics: the dataset is tiny and the question set is narrow
// ("who's in charge Friday", "where's the schedule", "Sarah's number"). A model
// could classify too, but rules keep the per-question token budget down (Apple
// Foundation Models' on-device context window is small) and stay debuggable.

import type { AssistantIntent } from "@/lib/assistant/types";

const RULES: { intent: AssistantIntent; patterns: RegExp[] }[] = [
  {
    // Phone / email / how-do-I-reach-someone.
    intent: "contact_lookup",
    patterns: [
      /\b(phone|number|call|text|email|e-?mail|contact|reach|get a hold of)\b/i,
    ],
  },
  {
    // Who's in charge / leading / running / the chef / the lead.
    intent: "role_lookup",
    patterns: [
      /\b(in charge|who'?s? running|who'?s? leading|lead|leader|head chef|chef|organizer|committee|responsible)\b/i,
    ],
  },
  {
    // Who's assigned / on crew / cooking / covering a thing.
    intent: "assignment_lookup",
    patterns: [
      /\b(assigned|assignment|on (the )?crew|cooking|covering|covers?|signed up|whose turn|who'?s? bringing)\b/i,
    ],
  },
  {
    // When / what time / what's happening on a day.
    intent: "schedule_lookup",
    patterns: [
      /\b(schedule|agenda|when|what time|what'?s? (happening|on|going on)|events?|tonight|today|tomorrow|this (morning|afternoon|evening)|mon|tue|wed|thu|fri|sat|sun)\b/i,
    ],
  },
  {
    // Where is it / which building / location of a thing.
    intent: "location_lookup",
    patterns: [/\b(where|location|located|which (building|cabin|place)|address|how do i get to)\b/i],
  },
  {
    // How the app works / where to find a feature.
    intent: "app_help",
    patterns: [
      /\b(how do i|where (do|can) i find|how to|where is the (page|tab|screen|button)|app|sign ?in|log ?in|rsvp|install|notifications?)\b/i,
    ],
  },
];

/**
 * Classify a question into one intent. First matching rule wins, in priority
 * order (contact → role → assignment → schedule → location → app_help). Returns
 * "unknown" when nothing matches, so the answer layer can offer the fallback
 * "try asking about a person, date, role, or location" guidance.
 */
export function classifyIntent(message: string): AssistantIntent {
  const m = message.trim();
  if (!m) return "unknown";
  for (const { intent, patterns } of RULES) {
    if (patterns.some((p) => p.test(m))) return intent;
  }
  return "unknown";
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Resolve a date reference in the question to an ISO "YYYY-MM-DD", relative to
 * `today` (the caller passes the demo/real clock so this stays testable). Handles
 * "today", "tonight", "tomorrow", and bare weekday names (next occurrence,
 * including today). Returns null when the question names no day — the schedule
 * lookup then answers about the whole span instead of one date.
 */
export function resolveDay(message: string, today: Date): string | null {
  const m = message.toLowerCase();
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(m)) return toISO(today);
  if (/\btomorrow\b/.test(m)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return toISO(d);
  }
  for (let i = 0; i < WEEKDAYS.length; i++) {
    // Match "fri"/"friday" but not as a substring of another word.
    const re = new RegExp(`\\b${WEEKDAYS[i].slice(0, 3)}(${WEEKDAYS[i].slice(3)})?\\b`);
    if (re.test(m)) {
      const d = new Date(today);
      const delta = (i - d.getDay() + 7) % 7; // next occurrence, 0 = today
      d.setDate(d.getDate() + delta);
      return toISO(d);
    }
  }
  return null;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
