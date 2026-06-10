// Retrieval for the AI Assistant: turn a classified question into a small set of
// allow-listed records the model is permitted to ground on.
//
// ⚠️ THE ALLOW-LIST IS THE PRIVACY BOUNDARY. The model only ever sees what this
// file returns. Two rules (see lib/assistant/types.ts):
//   • CHATS ARE NEVER A SOURCE. Resort chat + committee chat are intentionally
//     absent below and must stay that way. There is no code path here that reads
//     committee_messages or the chat store.
//   • Posts (public to any signed-in member) are the only sanctioned social
//     source — wired as a marked seam below, off until the server route lands.
//
// Everything here is over STATIC app data (already in the client bundle: the
// fest schedule, dinners, committee rosters, resort info, local places). It runs
// the same client-side now and server-side later. Member-directory (profiles)
// contact lookups are a separate, sign-in-gated seam (see contactRecords) that
// turns on with the server route + token auth — not enabled in this phase.

import {
  SCHEDULE,
  DINNERS,
  THINGS_TO_DO,
  RESORT_EVENTS,
  COMMITTEES,
  RESORT,
  FAMILY_FEST,
} from "@/lib/data";
import { PLACES } from "@/lib/places";
import { HELP_CONTACT } from "@/lib/help";
import { formatTime, formatDateLong, formatDateRange } from "@/lib/format";
import { resolveDay } from "@/lib/assistant/intent";
import type { AssistantIntent, ContextRecord, Source, SourceType } from "@/lib/assistant/types";

/** Source types the assistant may draw from. `post` is allow-listed (signed-in
 *  members can see all posts) but not yet wired; chat types are absent by design. */
export const SOURCE_ALLOWLIST: readonly SourceType[] = [
  "schedule",
  "dinner",
  "event",
  "committee",
  "activity",
  "place",
  "resort",
  "post",
  "app_help",
] as const;

/** Cap how many records reach the model — keeps us well under Apple Foundation
 *  Models' on-device context window and keeps answers focused. */
const MAX_CONTEXT_RECORDS = 12;

/** Where each app feature lives, for "how do I find…" / app_help answers. */
const APP_MAP: { id: string; label: string; text: string }[] = [
  { id: "events", label: "Events tab", text: "The resort calendar and RSVP (Going / Maybe / Can't make it) live on the Events page, linked from Home." },
  { id: "schedule", label: "Family Fest schedule", text: "The Family Fest week-by-week schedule is under the Family Fest tab → Schedule." },
  { id: "dinners", label: "Family Fest dinners", text: "Who's cooking which night is under the Family Fest tab → Dinners." },
  { id: "crew", label: "Family Fest crew", text: "Crew, RSVPs, and households are under the Family Fest tab → Crew." },
  { id: "pay", label: "Family Fest pay", text: "Dues and who to pay (Venmo/Zelle) are under the Family Fest tab → Pay." },
  { id: "posts", label: "Posts feed", text: "The shared photo/note feed is the Posts page (sign-in required to post)." },
  { id: "committees", label: "Committees", text: "Resort committees and how to join them are on the Committees pages." },
  { id: "dining", label: "Dining & amenities", text: "Resort dining and amenities are on the Dining page, linked from Home." },
  { id: "local-places", label: "Local Places", text: "Nearby businesses (menus, ordering, tee times) are on the Local Places page, linked from Home." },
  { id: "cabin", label: "Request a cabin stay", text: "Request a room in one of the resort houses from the Request a Stay screen, linked from Home." },
  { id: "profile", label: "Profile & sign-in", text: "Sign in, set notification preferences, and email members from the Profile tab. New sign-in is by email code — no password." },
  { id: "help", label: "Help & how-to", text: `The Help page has onboarding, text-size, and install steps. For a human, contact ${HELP_CONTACT.name} at ${prettyPhone(HELP_CONTACT.phone)} or ${HELP_CONTACT.email}.` },
];

/**
 * Build the grounding context + citations for a question. `today` is passed in
 * (demo/real clock) so date words ("Friday") resolve deterministically.
 */
export function retrieveContext(
  intent: AssistantIntent,
  message: string,
  today: Date,
): { records: ContextRecord[]; sources: Source[] } {
  const day = resolveDay(message, today);
  let records: ContextRecord[] = [];

  switch (intent) {
    case "schedule_lookup":
      records = scheduleRecords(message, day);
      break;
    case "role_lookup":
    case "assignment_lookup":
      records = [...crewRecords(message, day), ...committeeRecords(message)];
      break;
    case "contact_lookup":
      records = contactRecords(message);
      break;
    case "location_lookup":
      records = [...scheduleRecords(message, day), ...placeRecords(message), resortRecord()];
      break;
    case "app_help":
      records = appHelpRecords(message);
      break;
    case "unknown":
      // Best effort: a light touch of schedule + app help so a vague question
      // still gets something useful rather than a flat "I don't know".
      records = [...scheduleRecords(message, day).slice(0, 3), ...appHelpRecords(message).slice(0, 3)];
      break;
  }

  // De-dupe (same record can match two passes) and cap.
  const seen = new Set<string>();
  records = records
    .filter((r) => {
      const key = `${r.kind}:${r.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CONTEXT_RECORDS);

  const sources: Source[] = records.map((r) => ({ type: r.kind, id: r.id, label: r.label }));
  return { records, sources };
}

// ── per-intent record builders ──────────────────────────────────────────────

function scheduleRecords(message: string, day: string | null): ContextRecord[] {
  const all = SCHEDULE.filter((e) => (day ? e.day === day : matchesTerms(message, e.title)));
  // No keyword/day match → fall back to the whole week (small dataset, fine to
  // hand over) plus the event window so "what's the schedule" still answers.
  const events = all.length ? all : day ? [] : SCHEDULE;
  const recs: ContextRecord[] = events.map((e) => ({
    kind: "schedule",
    id: e.id,
    label: `${e.title} (${formatDateLong(e.day)})`,
    text: `${e.title} — ${formatDateLong(e.day)} at ${formatTime(e.start)}${e.end ? `–${formatTime(e.end)}` : ""}, ${e.location}. ${e.description}${e.lead ? ` Lead: ${e.lead.name}.` : ""}`,
  }));
  // Surface the dinner of a resolved day too (people ask "what's for dinner Friday").
  if (day) {
    const d = DINNERS.find((x) => x.day === day);
    if (d) recs.push(dinnerRecord(d));
  }
  // Always include the overall fest window for orientation.
  recs.push({
    kind: "event",
    id: "family-fest-2026",
    label: FAMILY_FEST.name,
    text: `${FAMILY_FEST.name}: ${formatDateRange(FAMILY_FEST.startDate, FAMILY_FEST.endDate)} at ${FAMILY_FEST.location}.`,
  });
  return recs;
}

function crewRecords(message: string, day: string | null): ContextRecord[] {
  const recs: ContextRecord[] = [];
  // Dinners carry the "head chef of the day" + houses on crew (who's in charge /
  // who's cooking / assigned).
  for (const d of DINNERS) {
    if (day ? d.day === day : matchesTerms(message, `${d.title} ${d.menu} ${d.chef.name} ${d.houses.join(" ")}`)) {
      recs.push(dinnerRecord(d));
    }
  }
  // Schedule items carry a lead (who's running each event).
  for (const e of SCHEDULE) {
    if (!e.lead) continue;
    if (day ? e.day === day : matchesTerms(message, `${e.title} ${e.lead.name}`)) {
      recs.push({
        kind: "schedule",
        id: e.id,
        label: `${e.title} lead`,
        text: `${e.lead.name} is leading "${e.title}" on ${formatDateLong(e.day)} at ${formatTime(e.start)} (${e.location}).`,
      });
    }
  }
  return recs;
}

function committeeRecords(message: string): ContextRecord[] {
  const recs: ContextRecord[] = [];
  for (const c of COMMITTEES) {
    const lead = c.members.find((m) => m.role === "Lead");
    const hitName = matchesTerms(message, c.name);
    const hitLead = lead && matchesTerms(message, lead.name);
    if (!hitName && !hitLead) continue;
    recs.push({
      kind: "committee",
      id: c.slug,
      label: `${c.name} committee`,
      text: `${c.name} committee${lead ? ` — Lead: ${lead.name}` : ""}. ${c.description} Members: ${c.members.map((m) => m.name).join(", ")}.`,
    });
  }
  return recs;
}

// Member-directory (Supabase profiles) contact lookups are SIGN-IN-GATED and go
// through the server route in Phase 1 (profiles are public-read to signed-in
// members, but we keep PII reads behind the server boundary). For now contact
// lookups resolve over the static contacts already in the bundle: committee
// leads/members, fest leads/chefs, the organizer, the front desk, and the help
// contact. Chats are never consulted.
function contactRecords(message: string): ContextRecord[] {
  const recs: ContextRecord[] = [];

  for (const c of COMMITTEES) {
    for (const m of c.members) {
      if (!matchesTerms(message, m.name)) continue;
      recs.push({
        kind: "committee",
        id: `${c.slug}:${m.name}`,
        label: `${m.name} (${c.name})`,
        text: `${m.name}${m.role ? `, ${m.role} of ${c.name}` : ` (${c.name})`}: ${prettyPhone(m.phone)}, ${m.email}.`,
      });
    }
  }
  for (const d of DINNERS) {
    if (!matchesTerms(message, d.chef.name)) continue;
    recs.push({
      kind: "dinner",
      id: d.id,
      label: `${d.chef.name} (head chef)`,
      text: `${d.chef.name} is head chef for ${d.title} (${formatDateLong(d.day)}): ${prettyPhone(d.chef.phone)}.`,
    });
  }
  // Always-available fallbacks so contact questions land somewhere useful.
  recs.push({
    kind: "resort",
    id: "front-desk",
    label: "Front desk",
    text: `${RESORT.name} front desk (${RESORT.frontDesk}): ${prettyPhone(RESORT.phone)}.`,
  });
  recs.push({
    kind: "app_help",
    id: "help-contact",
    label: `${HELP_CONTACT.name} (app help)`,
    text: `${HELP_CONTACT.name} handles app help: ${prettyPhone(HELP_CONTACT.phone)} or ${HELP_CONTACT.email}.`,
  });
  return recs;
}

function placeRecords(message: string): ContextRecord[] {
  return PLACES.filter((p) => matchesTerms(message, `${p.name} ${p.category} ${p.locality}`)).map((p) => ({
    kind: "place",
    id: p.slug,
    label: p.name,
    text: `${p.name} — ${p.category}, ${p.locality}. ${p.blurb}${p.phoneDisplay ? ` Phone: ${p.phoneDisplay}.` : ""}`,
  }));
}

function appHelpRecords(message: string): ContextRecord[] {
  const hits = APP_MAP.filter((a) => matchesTerms(message, `${a.label} ${a.text}`));
  const list = hits.length ? hits : APP_MAP;
  return list.map((a) => ({ kind: "app_help", id: a.id, label: a.label, text: a.text }));
}

function dinnerRecord(d: (typeof DINNERS)[number]): ContextRecord {
  return {
    kind: "dinner",
    id: d.id,
    label: `${d.title} (${formatDateLong(d.day)})`,
    text: `${d.title} — ${formatDateLong(d.day)}, served ${d.time} at ${d.location}. Head chef: ${d.chef.name}. Houses on crew: ${d.houses.join(", ")}. Menu: ${d.menu}. Prep ${d.prepTime}${d.prepLocation ? ` at ${d.prepLocation}` : ""}.`,
  };
}

function resortRecord(): ContextRecord {
  return {
    kind: "resort",
    id: "resort",
    label: RESORT.name,
    text: `${RESORT.name}: ${RESORT.address}. Check-in ${RESORT.checkIn}, check-out ${RESORT.checkOut}. Front desk: ${prettyPhone(RESORT.phone)} (${RESORT.frontDesk}).`,
  };
}

// `THINGS_TO_DO` is exported for completeness / future intents; reference it so
// the import stays honest even while no intent maps to it yet.
void THINGS_TO_DO;
void RESORT_EVENTS;

// ── helpers ───────────────────────────────────────────────────────────────

/** Loose match: every alphabetic word ≥3 chars in the question that also looks
 *  like a content word is checked against the haystack; any hit counts. Good
 *  enough for "Sarah", "beautification", "bonfire" over a tiny dataset. */
function matchesTerms(message: string, haystack: string): boolean {
  const hay = haystack.toLowerCase();
  const terms = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return terms.some((t) => hay.includes(t));
}

const STOPWORDS = new Set([
  "the", "who", "what", "when", "where", "which", "whose", "how", "for", "and", "are", "was",
  "this", "that", "with", "from", "out", "get", "can", "does", "did", "will", "you", "your",
  "charge", "running", "leading", "lead", "phone", "number", "email", "contact", "today",
  "tonight", "tomorrow", "night", "find", "tell", "show", "about", "there", "they", "them",
]);

/** "+17155550100" → "(715) 555-0100" for US numbers; otherwise returned as-is. */
function prettyPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
