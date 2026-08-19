// Client helpers for House Requests (migrations 0194–0195) — the board that
// carries a house's "should we?" asks from somebody noticing to somebody
// actually buying it: an idea, a purchase request (link + estimate + reason), or
// a reimbursement for something already bought. A House Admin decides, then
// records what happened (ordered → received), so an approved-but-forgotten
// request is a visible state instead of an invisible one.
//
// NOT work items. work_items (lib/workItems.ts) stays the separate, more
// prominent list of things that NEED doing — with urgency tiers and recurrence.
// This is the "maybe we should" board; nothing here creates a work item and
// there's deliberately no repair/fix kind.
//
// Reads go through the Supabase client (RLS: the whole house sees its own
// board). Every write goes through a SECURITY DEFINER RPC. Degrades to "none"
// with no backend or pre-migration (42P01) and never throws — the lib/polls.ts /
// lib/dropBoxes.ts idiom.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { EventLink } from "@/lib/types";
import type { Media, MediaKind } from "@/lib/media";
import { fetchProfiles } from "@/lib/roles";
import { payActions, type Action, type MemberContact, type PayPrefill } from "@/lib/contact";

/** What's being asked for. The composer picks this FIRST and the form adapts. */
export type HouseRequestKind = "purchase" | "idea" | "reimbursement";

/**
 * Where a request is in its life.
 *
 * `approved` is deliberately NOT terminal — "approved but nobody ordered it" is
 * the exact failure this feature exists to make visible, so it's its own state
 * that the reviewer queue surfaces as a group of its own.
 */
export type HouseRequestStatus =
  | "pending"
  | "approved"
  | "denied"
  | "ordered"
  | "received"
  | "withdrawn";

export type HouseRequestMediaStatus = "visible" | "pending" | "hidden";

export interface HouseRequestMediaItem {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  type: MediaKind;
  status: HouseRequestMediaStatus;
  uploadedBy: string;
}

export interface HouseRequest {
  id: string;
  /** null = resort-wide MLR (nothing in the v1 UI creates one — see 0195). */
  houseId: string | null;
  kind: HouseRequestKind;
  title: string;
  reason: string;
  links: EventLink[];
  /** Estimate for purchase/idea; the real amount already spent for a reimbursement. */
  estCost: number | null;
  quantity: number | null;
  status: HouseRequestStatus;
  /** A test submission (0200) — only its author was notified, and only they and
   *  app admins can see it. Badged in the UI so it's never mistaken for a real ask. */
  testOnly: boolean;
  /**
   * Set when this row changed kind in place — today only `"purchase"`, meaning
   * "was a purchase request until the requester bought it themselves" (0207).
   * Surfaced on the sheet so an approved reimbursement doesn't look like it was
   * always a receipt, and the approval on it isn't misread as approving a spend
   * that had already happened.
   */
  convertedFromKind: HouseRequestKind | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  actualCost: number | null;
  orderNote: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  media: HouseRequestMediaItem[];
  /** Resolved client-side: is this the viewer's own request? */
  mine: boolean;
  /** Resolved client-side: can the viewer approve/deny/progress it? */
  canReview: boolean;
}

// ── Presentation helpers (pure — shared by the board, sheet and admin queue) ──

/**
 * What a kind IS, in the only terms that matter: **whose money, and who does the
 * buying.**
 *
 * ⚠️⚠️ THIS IS THE FIX FOR THE FEATURE'S ONE REAL USABILITY FAILURE. Brian filed
 * a "Purchase Request" and the House Admins read it as *"he's buying this
 * himself"* — so nobody ordered anything. Nothing on any screen contradicted
 * them, because every label named the PAPERWORK ("Purchase Request", "Request
 * Reimbursement") instead of the DEAL ("the House Trust pays and a House Admin
 * places the order"). Three tiles that differ only by a noun and an emoji cannot
 * teach anyone the difference.
 *
 * So: every kind now carries the deal as a sentence, and **every surface that
 * shows a kind shows that sentence** — the chooser, the composer banner, the
 * board card, the detail sheet. If you add a surface, show `deal` on it.
 *
 * The old labels are deliberately gone. "Purchase Request" is a form name;
 * "The house should buy this" is the ask.
 */
export interface HouseRequestKindMeta {
  emoji: string;
  /**
   * A plain third-person NOUN — what the row is, for chips, history, the detail
   * header and email subjects.
   *
   * ⚠️ Keep this a noun that survives a possessive. It's tempting to make it the
   * punchy requester-voice phrase instead ("Pay me back"), and that reads well on
   * a card right up until the co-admin email says *"Lee paid Brian's pay me
   * back"* — which the email preview duly produced. The first-person ask lives in
   * `ask` (chooser only); this one has to work in someone else's sentence.
   */
  label: string;
  /** The ask in the REQUESTER's own voice — the chooser tile's headline only. */
  ask: string;
  /**
   * ⚠️ The load-bearing sentence: whose money, and who places the order.
   *
   * ⚠️ Phrased NEUTRALLY (no "you"/"your"), because it renders both to the person
   * writing the request and to everyone else reading it later. The composer adds
   * its own second-person version of the same point per kind, where the emphasis
   * belongs.
   */
  deal: string;
  /**
   * Two or three words naming whose money this is. Card badge.
   *
   * ⚠️ Must read correctly to a THIRD PARTY, not just the requester — most views
   * of a request are by somebody else. "You're owed" is wrong on a House Admin's
   * screen looking at Cass's receipt.
   */
  money: string;
  /** What the requester is on the hook for after sending. Often "nothing". */
  youDo: string;
  /** What a House Admin actually does once they approve it. */
  adminDoes: string;
  /** Icon tile background. */
  tile: string;
  /** Left edge on a board card, so the three read apart at a glance. */
  edge: string;
  /** The kind's own text color. */
  text: string;
  /** The whose-money badge. */
  chip: string;
}

export const KIND_META: Record<HouseRequestKind, HouseRequestKindMeta> = {
  idea: {
    emoji: "💡",
    label: "Idea",
    ask: "Just an idea",
    deal: "Nobody buys anything — just a thought for the house to kick around.",
    money: "No money",
    youDo: "Write it down — that's the whole job.",
    adminDoes: "Says whether the house likes it. If it becomes a real thing to buy, that's a separate purchase request.",
    tile: "bg-sun/12",
    edge: "border-l-sun",
    text: "text-sun",
    chip: "bg-sun/15 text-sun",
  },
  purchase: {
    emoji: "🛒",
    label: "Purchase request",
    ask: "The house should buy this",
    // The sentence the whole incident turned on. Keep "not you" in it.
    deal: "House Trust money — a House Admin places the order, not the person asking.",
    money: "House Trust pays",
    youDo: "Nothing — sit tight. If you'd rather buy it yourself, send a “Pay me back” instead.",
    adminDoes: "Orders it with House Trust funds, then marks it ordered here.",
    tile: "bg-lake/12",
    edge: "border-l-lake",
    text: "text-lake",
    chip: "bg-lake/15 text-lake",
  },
  reimbursement: {
    emoji: "🧾",
    label: "Reimbursement",
    ask: "I already paid — pay me back",
    deal: "Already paid for out of pocket — the House Trust pays it back.",
    money: "Owed back",
    youDo: "Attach the receipt so nobody has to come asking for it.",
    adminDoes: "Approves it and sends you the money.",
    tile: "bg-accent/12",
    edge: "border-l-accent",
    text: "text-accent",
    chip: "bg-accent/15 text-accent",
  },
};

/** The three kinds in the order the chooser offers them — cheapest ask first. */
export const KIND_ORDER: HouseRequestKind[] = ["idea", "purchase", "reimbursement"];

/**
 * ⚠️ Only a REIMBURSEMENT and a PURCHASE involve money. An idea deliberately has
 * no cost field anywhere — a price box on a "wouldn't it be nice if" is exactly
 * the friction that stops ideas being written down, and a number on one makes it
 * look like a proposal somebody has to decide about.
 */
export function hasMoney(kind: HouseRequestKind): boolean {
  return kind !== "idea";
}

/**
 * The approve/deny verbs, per kind. "Approve" is right for money and wrong for a
 * thought — you don't *approve* an idea, you say whether the house is up for it.
 * Naming the follow-through in the approve verb ("I'll order it") is also the
 * last place to tell a House Admin the ball is theirs.
 */
export function decideLabels(kind: HouseRequestKind): { approve: string; deny: string } {
  switch (kind) {
    case "idea":
      return { approve: "Yes — the house likes it", deny: "Not now" };
    case "purchase":
      return { approve: "Approve — I'll order it", deny: "Turn it down" };
    case "reimbursement":
      return { approve: "Approve — pay them back", deny: "Turn it down" };
  }
}

/**
 * "So what happens next, and who does it?" — null once nothing is owed by
 * anyone. Deliberately names the ACTOR every time: the failure this feature
 * exists to prevent is everyone assuming somebody else has it.
 */
export function nextStep(r: Pick<HouseRequest, "status" | "kind">): string | null {
  if (r.status === "pending") {
    switch (r.kind) {
      case "idea":
        return "A House Admin says yes or no";
      case "purchase":
        return "A House Admin decides, then orders it";
      case "reimbursement":
        return "A House Admin decides, then pays you back";
    }
  }
  if (r.status === "approved") {
    switch (r.kind) {
      // An agreed idea is finished — there's nothing to order.
      case "idea":
        return null;
      case "purchase":
        return "A House Admin still has to order it";
      case "reimbursement":
        return "Nobody has sent the money yet";
    }
  }
  return null;
}

/**
 * The status label a HUMAN should read, which depends on the kind: nothing gets
 * "ordered" for a reimbursement (0195 rejects it outright) and its terminal
 * state reads "Paid", not "Got it".
 */
export function statusLabel(r: Pick<HouseRequest, "status" | "kind">): string {
  switch (r.status) {
    case "pending":
      return "Waiting on a House Admin";
    case "approved":
      // ⚠️ Per kind, because "approved" means three different things. An IDEA is
      // FINISHED here — the house said yes and there is nothing to buy, so
      // labelling it "not ordered yet" invented a chore nobody owed and parked a
      // permanent nag on the board.
      if (r.kind === "idea") return "The house is up for it";
      return r.kind === "reimbursement" ? "Approved — not paid yet" : "Approved — nobody's ordered it yet";
    case "ordered":
      // Terminal for a purchase/idea — there's no "arrived" step to wait on.
      return "Ordered";
    case "received":
      // Only reachable for a reimbursement now; the other wording is kept so any
      // pre-existing row still reads sensibly rather than showing a raw status.
      return r.kind === "reimbursement" ? "Paid" : "Got it";
    case "denied":
      return "Not approved";
    case "withdrawn":
      return "Withdrawn";
  }
}

/** Chip colors — tokens only (light-mode app), never a raw hex. */
export function statusChip(status: HouseRequestStatus): string {
  switch (status) {
    case "pending":
      return "bg-sun/15 text-foreground";
    case "approved":
      return "bg-lake/15 text-lake";
    case "ordered":
      return "bg-primary/15 text-primary";
    case "received":
      return "bg-primary text-white";
    case "denied":
    case "withdrawn":
      return "bg-foreground/10 text-muted";
  }
}

/**
 * Which section of the reviewer queue a request belongs in — the order an
 * approver actually works, not the order rows were created.
 *
 * `toDo` is the load-bearing one: approved-but-not-ordered. Everything else is
 * either waiting on a decision, already moving, or history.
 */
export type HouseRequestGroup = "waiting" | "toDo" | "moving" | "done";

export function requestGroup(r: HouseRequest): HouseRequestGroup {
  if (r.status === "pending") return "waiting";
  // An approved IDEA is done — nothing is owed, so it must not sit in the
  // "somebody still has to buy this" group forever (see statusLabel).
  if (r.status === "approved") return r.kind === "idea" ? "done" : "toDo";
  if (r.status === "ordered") return "moving";
  return "done";
}

/**
 * True once a request has reached a state that no longer needs anyone.
 *
 * ⚠️ **`ordered` is the END OF THE LINE for a purchase or an idea** — there's no
 * "it arrived" step to chase, because something that's been ordered obviously
 * turns up, and asking a House Admin to come back later and tick a second box is
 * how a board fills with stale rows nobody closes. `received` survives only for a
 * REIMBURSEMENT, where it means **Paid** and is genuinely the moment that matters.
 */
export function isSettled(r: HouseRequest): boolean {
  // An approved IDEA is settled too — the house said yes and there's nothing to
  // buy. ⚠️ This is PRESENTATION only (the Open/Done filter). Do NOT reuse it as
  // the delete gate: the server still refuses to delete an `approved` row of any
  // kind (0203), so `canDeleteRequest` mirrors that SQL directly instead.
  if (r.status === "approved") return r.kind === "idea";
  return (
    r.status === "ordered" || r.status === "received" || r.status === "denied" || r.status === "withdrawn"
  );
}

/** Whole-dollar-ish money for the summary strip; `null` reads as no number. */
export function requestCost(r: HouseRequest): number | null {
  return r.actualCost ?? r.estCost ?? null;
}

export interface HouseRequestSummary {
  /** Pending count — the number an approver needs to see first. */
  waiting: number;
  /** Total estimated cost of everything still pending. */
  waitingCost: number;
  /**
   * Approved PURCHASES nobody has ordered — the "we never actually do it" gap.
   * ⚠️ Purchases only. An approved idea has nothing to order, and an approved
   * reimbursement needs *paying*, not buying — lumping all three under "approved,
   * not bought yet" is how an agreed idea became a permanent fake chore.
   */
  notOrdered: number;
  /** Approved reimbursements nobody has paid — somebody is out of pocket. */
  unpaid: number;
  /** What those unpaid reimbursements come to. */
  unpaidCost: number;
  /** Money on approved/ordered/received requests decided this calendar year. */
  approvedThisYear: number;
}

export function summarize(requests: HouseRequest[], year = new Date().getFullYear()): HouseRequestSummary {
  let waiting = 0;
  let waitingCost = 0;
  let notOrdered = 0;
  let unpaid = 0;
  let unpaidCost = 0;
  let approvedThisYear = 0;
  for (const r of requests) {
    if (r.status === "pending") {
      waiting += 1;
      waitingCost += r.estCost ?? 0;
      continue;
    }
    if (r.status === "approved") {
      if (r.kind === "purchase") notOrdered += 1;
      if (r.kind === "reimbursement") {
        unpaid += 1;
        unpaidCost += requestCost(r) ?? 0;
      }
    }
    const decided = r.reviewedAt ?? r.createdAt;
    if (
      (r.status === "approved" || r.status === "ordered" || r.status === "received") &&
      new Date(decided).getFullYear() === year
    ) {
      approvedThisYear += requestCost(r) ?? 0;
    }
  }
  return { waiting, waitingCost, notOrdered, unpaid, unpaidCost, approvedThisYear };
}

/** "3 days" / "today" — how long a pending request has been sitting. */
export function ageLabel(iso: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

/** Adapt an attachment to the shared MediaGrid/Lightbox shape. */
export function toMedia(m: HouseRequestMediaItem): Media {
  return { url: m.url, type: m.type, thumbnailUrl: m.thumbnailUrl };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

type PgError = { code?: string; message?: string } | null;
function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? "");
}
function isMissingColumn(error: PgError): boolean {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist/i.test(error.message ?? "");
}

interface MediaRow {
  id: string;
  storage_path: string;
  thumbnail_url: string | null;
  media_type: MediaKind;
  status: HouseRequestMediaStatus;
  uploaded_by: string;
}
interface RequestRow {
  id: string;
  house_id: string | null;
  kind: HouseRequestKind;
  title: string;
  reason: string | null;
  links: EventLink[] | null;
  est_cost: string | number | null;
  quantity: number | null;
  status: HouseRequestStatus;
  test_only?: boolean | null;
  converted_from_kind?: HouseRequestKind | null;
  created_by: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  actual_cost: string | number | null;
  order_note: string | null;
  ordered_at: string | null;
  received_at: string | null;
  house_request_media: MediaRow[] | null;
}

// numeric(10,2) comes back as a STRING from PostgREST, not a number — coercing
// it here is what keeps every cost sum from silently becoming concatenation.
function num(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

const SELECT =
  "id, house_id, kind, title, reason, links, est_cost, quantity, status, test_only, converted_from_kind, created_by, created_at," +
  " reviewed_by, reviewed_at, review_note, actual_cost, order_note, ordered_at, received_at," +
  " house_request_media(id, storage_path, thumbnail_url, media_type, status, uploaded_by)";
// ⚠️ A COLUMN-GROUP LADDER, newest migration first. An unknown column fails the
// WHOLE select with 42703 and the board renders empty — which the `ready` flag
// would then report as "migration missing", i.e. a healthy board nagging about a
// migration that HAS been run. So each newer column group peels off in turn:
// 0207's `converted_from_kind`, then 0200's `test_only`. Same idiom as
// insertMediaRow's ladder for 0176/0173.
const SELECT_NO_CONVERTED = SELECT.replace(" converted_from_kind,", "");
const SELECT_NO_TEST = SELECT_NO_CONVERTED.replace(" test_only,", "");
const SELECT_LADDER = [SELECT, SELECT_NO_CONVERTED, SELECT_NO_TEST];

function assemble(row: RequestRow, viewerId: string | null, canReview: boolean, names: Map<string, string>): HouseRequest {
  return {
    id: row.id,
    houseId: row.house_id,
    kind: row.kind,
    title: row.title,
    reason: row.reason ?? "",
    links: row.links ?? [],
    estCost: num(row.est_cost),
    quantity: row.quantity,
    status: row.status,
    testOnly: row.test_only === true,
    convertedFromKind: row.converted_from_kind ?? null,
    createdBy: row.created_by,
    createdByName: names.get(row.created_by) ?? "Member",
    createdAt: row.created_at,
    reviewedBy: row.reviewed_by,
    reviewedByName: row.reviewed_by ? names.get(row.reviewed_by) ?? "A House Admin" : null,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    actualCost: num(row.actual_cost),
    orderNote: row.order_note,
    orderedAt: row.ordered_at,
    receivedAt: row.received_at,
    media: (row.house_request_media ?? []).map((m) => ({
      id: m.id,
      url: m.storage_path,
      thumbnailUrl: m.thumbnail_url,
      type: m.media_type,
      status: m.status,
      uploadedBy: m.uploaded_by,
    })),
    mine: !!viewerId && row.created_by === viewerId,
    canReview,
  };
}

/**
 * The board, plus whether the feature actually EXISTS yet.
 *
 * ⚠️ `ready` is the difference between "0195 hasn't been applied" and "nobody has
 * asked for anything yet" — two states that both produce an empty array. Keying a
 * "run the migration" hint on `requests.length === 0` shows it forever on a
 * healthy, empty board, which is the same class of bug as the callout fallback
 * masking an unreadable table (see CLAUDE.md's committee_areas incident).
 */
export interface HouseRequestsResult {
  requests: HouseRequest[];
  ready: boolean;
}

/** Empty + ready — the safe default: never accuse the DB of missing a table we
 *  haven't actually failed to read. Also what the prerendered HTML renders. */
export const NO_HOUSE_REQUESTS: HouseRequestsResult = { requests: [], ready: true };

/**
 * Every request on a house's board, newest first.
 *
 * `canReview` is resolved by the CALLER (an app admin, or a House Admin of this
 * house) rather than re-derived per row: RLS and the RPCs are the real gate, and
 * this only decides which buttons paint.
 */
export async function fetchHouseRequests(
  houseId: string,
  viewerId: string | null,
  canReview = false,
): Promise<HouseRequestsResult> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return NO_HOUSE_REQUESTS;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the ladder's select shapes can't share one inferred type
    let res: any = null;
    for (const select of SELECT_LADDER) {
      res = await sb
        .from("house_requests")
        .select(select)
        .eq("house_id", houseId)
        .order("created_at", { ascending: false });
      // Only a MISSING COLUMN is worth stepping down for — any other error is
      // real and must be reported, not retried into a false empty board.
      if (!res.error || !isMissingColumn(res.error)) break;
    }
    const { data, error } = res;
    if (error) {
      const missing = isMissingTable(error) || isMissingColumn(error);
      if (!missing) console.warn("fetchHouseRequests: read error", error.message);
      return { requests: [], ready: !missing };
    }
    const rows = (data ?? []) as unknown as RequestRow[];
    return { requests: await finish(rows, viewerId, () => canReview), ready: true };
  } catch {
    return NO_HOUSE_REQUESTS;
  }
}

/** Resolve every display name in one bulk call, then map the rows. */
async function finish(
  rows: RequestRow[],
  viewerId: string | null,
  canReview: (row: RequestRow) => boolean,
): Promise<HouseRequest[]> {
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.created_by);
    if (r.reviewed_by) ids.add(r.reviewed_by);
  }
  const names = new Map((await fetchProfiles(Array.from(ids))).map((p) => [p.id, p.name]));
  return rows.map((r) => assemble(r, viewerId, canReview(r), names));
}

// ── House Admins (migration 0194) ─────────────────────────────────────────────

export interface HouseAdmin {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * The House Admins of a house, so the House Hub can say who to ask. Reads
 * `profiles` directly — it's members-readable and `house_admin` is a non-PII
 * boolean, which is exactly why 0194 doesn't widen `admin_members()` (the same
 * reasoning migration 0181 gives for `profiles.approved`). Empty pre-migration.
 */
export async function fetchHouseAdmins(houseId: string): Promise<HouseAdmin[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data, error } = await sb
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("house_id", houseId)
      .eq("house_admin", true);
    if (error) return [];
    return ((data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).map((p) => ({
      id: p.id,
      name: p.display_name?.trim() || "Member",
      avatarUrl: p.avatar_url ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Is this member a House Admin (of their own house)? Used to decide whether the
 * board paints approve/deny controls. `false` pre-migration (missing column) —
 * so the feature degrades to "app admins only", never to "everyone".
 */
export async function fetchIsHouseAdmin(userId: string | null): Promise<boolean> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || !userId) return false;
  try {
    const { data, error } = await sb.from("profiles").select("house_admin").eq("id", userId).maybeSingle();
    if (error) return false;
    return !!(data as { house_admin?: boolean } | null)?.house_admin;
  } catch {
    return false;
  }
}

// ── Writes ────────────────────────────────────────────────────────────────────

type Res = { error?: string };
type IdRes = { id?: string; error?: string };

async function rpc(name: string, params: Record<string, unknown>): Promise<Res> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc(name, params);
  return error ? { error: error.message } : {};
}

export interface HouseRequestInput {
  houseId: string | null;
  kind: HouseRequestKind;
  title: string;
  reason: string;
  links: EventLink[];
  estCost: number | null;
  quantity: number | null;
  /**
   * A test submission (migration 0200): a real request that runs the whole
   * pipeline — RPC, realtime, push, email — but notifies ONLY the person who
   * made it, and stays hidden from the rest of the house. For checking the
   * plumbing works without paging the family.
   */
  testOnly?: boolean;
}

export async function createHouseRequest(input: HouseRequestInput): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const params = {
    p_house_id: input.houseId,
    p_kind: input.kind,
    p_title: input.title,
    p_reason: input.reason,
    p_links: input.links,
    p_est_cost: input.estCost,
    p_quantity: input.quantity,
  };
  let { data, error } = await sb.rpc("create_house_request", {
    ...params,
    p_test_only: input.testOnly ?? false,
  });
  // Pre-0200 fallback: no p_test_only param yet. Only safe to retry WITHOUT the
  // flag when it wasn't set — silently dropping a "notify just me" would page the
  // whole house, which is the opposite of what was asked for.
  const isStale = (e: { code?: string; message?: string } | null) =>
    !!e && (e.code === "PGRST202" || /find the function|schema cache/i.test(e.message ?? ""));
  if (isStale(error)) {
    if (input.testOnly) {
      return { error: "Test mode needs migration 0200_house_request_test_only.sql applied first." };
    }
    ({ data, error } = await sb.rpc("create_house_request", params));
  }
  return error ? { error: error.message } : { id: data as string };
}

/**
 * Edit a request. The creator can fix their own while it's still pending; a
 * reviewer can correct the ask at any point ("yes, but two of them") — which is
 * the "modify the request" half of approve/deny/modify. Undefined fields are
 * left alone; pass `estCost: null` / `quantity: null` explicitly to CLEAR one.
 */
export function updateHouseRequest(
  id: string,
  patch: {
    title?: string;
    reason?: string;
    links?: EventLink[];
    estCost?: number | null;
    quantity?: number | null;
    /** A reviewer's optional "why I changed it" — rides the requester's in-app
     *  row, phone push and its own email. Ignored when the creator edits their
     *  own pending request (nobody to tell). */
    note?: string;
    /** false skips the change EMAIL; the in-app row + push still go. */
    notify?: boolean;
  },
): Promise<Res> {
  return rpc("update_house_request", {
    p_id: id,
    p_title: patch.title ?? null,
    p_reason: patch.reason ?? null,
    p_links: patch.links ?? null,
    p_est_cost: patch.estCost ?? null,
    p_quantity: patch.quantity ?? null,
    // A null in `patch` means "clear it"; absent means "leave it".
    p_clear_cost: "estCost" in patch && patch.estCost === null,
    p_clear_quantity: "quantity" in patch && patch.quantity === null,
    p_note: patch.note?.trim() ? patch.note.trim() : null,
    p_notify: patch.notify ?? true,
  });
}

/** Approve or deny. `notify: false` skips the email (the in-app row always goes). */
export function reviewHouseRequest(id: string, approve: boolean, note?: string, notify = true): Promise<Res> {
  return rpc("review_house_request", {
    p_id: id,
    p_approve: approve,
    p_note: note?.trim() ? note.trim() : null,
    p_notify: notify,
  });
}

/** Move an approved request along: ordered → received (a reimbursement goes
 *  straight to `received`, which reads as "Paid"). */
export function setHouseRequestProgress(
  id: string,
  status: "approved" | "ordered" | "received",
  actualCost?: number | null,
  orderNote?: string | null,
): Promise<Res> {
  return rpc("set_house_request_progress", {
    p_id: id,
    p_status: status,
    p_actual_cost: actualCost ?? null,
    p_order_note: orderNote?.trim() ? orderNote.trim() : null,
  });
}

/**
 * How far over the approved estimate a receipt can land before it needs a second
 * OK. ⚠️ Mirrors `_house_request_overspend_grace()` in migration 0207 — the
 * client only uses it to TELL the requester what will happen before they submit;
 * the server decides. Keep the two numbers in step.
 */
export const OVERSPEND_GRACE = 25;

/**
 * Will converting this request need a fresh approval? Pure, so the conversion
 * form can say so up front rather than surprising someone afterwards.
 */
export function conversionNeedsReapproval(r: HouseRequest, actualCost: number): boolean {
  if (r.status !== "approved") return true; // nothing was approved to begin with
  if (r.estCost === null) return false; // approved with no number = no ceiling to breach
  return actualCost > r.estCost + OVERSPEND_GRACE;
}

/**
 * "They told me to just buy it and they'd pay me back" — turn a purchase request
 * into a reimbursement **in place**, keeping the title, reason, links, photos,
 * discussion and the approval already on it (migration 0207).
 *
 * ⚠️ Requester-only, and that's a correctness rule rather than a permission
 * preference: a reimbursement pays `createdBy`, so if anyone else could convert
 * it the money would be routed to the person who ASKED for the item instead of
 * the person who actually paid. The server enforces the same.
 *
 * Resolves the resulting status — `approved` (just needs paying) or `pending`
 * (the receipt was materially over what was approved, so it needs another look).
 */
export async function convertToReimbursement(
  id: string,
  actualCost: number,
  opts?: { note?: string; title?: string; links?: EventLink[] },
): Promise<{ status?: HouseRequestStatus; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("convert_request_to_reimbursement", {
    p_id: id,
    p_actual_cost: actualCost,
    p_note: opts?.note?.trim() ? opts.note.trim() : null,
    p_title: opts?.title?.trim() ? opts.title.trim() : null,
    p_links: opts?.links ?? null,
  });
  if (error) {
    // Pre-0207 the function doesn't exist yet. Say so plainly instead of
    // surfacing PostgREST's "schema cache" wording at a family member.
    if (error.code === "PGRST202" || /find the function|schema cache/i.test(error.message ?? "")) {
      return { error: "This needs migration 0207_house_request_buy_it_myself.sql applied first." };
    }
    return { error: error.message };
  }
  return { status: (data as HouseRequestStatus) ?? "approved" };
}

export function withdrawHouseRequest(id: string): Promise<Res> {
  return rpc("withdraw_house_request", { p_id: id });
}

/**
 * Permanently remove a finished request — for clearing test rows and dead
 * entries off the board (migration 0201). Reviewers only.
 *
 * ⚠️ A still-PENDING request can't be deleted unless it's a test row: quietly
 * deleting an open ask is not the same as denying it, since a denial leaves the
 * requester a note and a name while a deletion just makes their request vanish.
 * `canDeleteRequest()` mirrors the server rule so the button only appears where
 * the RPC would actually succeed.
 */
export function deleteHouseRequest(id: string): Promise<Res> {
  return rpc("delete_house_request", { p_id: id });
}

/**
 * Client-side twin of **0203's** gate — keep the two in step, and spell the
 * statuses out rather than calling `isSettled()`. They used to be the same
 * function, but `isSettled` now counts an approved IDEA as done for the
 * Open/Done filter, and the server still refuses to delete any `approved` row —
 * so sharing it would paint a Delete button the RPC answers with an error.
 */
export function canDeleteRequest(r: HouseRequest): boolean {
  return (
    r.testOnly ||
    r.status === "ordered" ||
    r.status === "received" ||
    r.status === "denied" ||
    r.status === "withdrawn"
  );
}

export async function addHouseRequestMedia(
  requestId: string,
  url: string,
  type: MediaKind,
  thumbnailUrl?: string | null,
  position = 0,
): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("add_house_request_media", {
    p_request: requestId,
    p_url: url,
    p_type: type,
    p_thumbnail_url: thumbnailUrl ?? null,
    p_position: position,
  });
  return error ? { error: error.message } : { id: data as string };
}

export function removeHouseRequestMedia(mediaId: string): Promise<Res> {
  return rpc("remove_house_request_media", { p_media: mediaId });
}

/** Promote/demote a House Admin. App-admin-in-that-house only (RPC-gated, 0194). */
export function setHouseAdmin(target: string, value: boolean): Promise<Res> {
  return rpc("set_house_admin", { target, value });
}

/**
 * ⚠️ The `pay_preferred` VALUE and the COLUMN name are not the same word for
 * Apple Cash: `pay_preferred` stores `'applecash'` (migration 0006's comment),
 * but the column is **`apple_cash`** — and unlike the others it's a boolean
 * opt-in, not a handle (migration 0021). Selecting the non-existent `applecash`
 * made PostgREST reject the WHOLE select with 42703, which read back as "this
 * member has no payment method" and told people who'd filled it in that they
 * hadn't. Hence the explicit pref→column map.
 */
const PAY_METHODS: { pref: string; column: string; label: string }[] = [
  { pref: "venmo", column: "venmo", label: "Venmo" },
  { pref: "zelle", column: "zelle", label: "Zelle" },
  { pref: "applecash", column: "apple_cash", label: "Apple Cash" },
  { pref: "cashapp", column: "cashapp", label: "Cash App" },
  { pref: "paypal", column: "paypal", label: "PayPal" },
];

export interface PayMethods {
  /**
   * EVERY way this person can be paid, not just their preferred one — with the
   * preferred floated to the front and flagged. ⚠️ Showing only the preference
   * would be actively harmful here: whoever pays out may only *have* Zelle, and
   * if the requester also has Zelle they should just be paid on Zelle. The
   * preference is a hint, never a restriction.
   */
  methods: Action[];
  /**
   * Did we actually manage to look? `false` when the read failed or there's no
   * backend — in which case the UI must show NOTHING rather than "no payment
   * method on file", because a failed query can't prove a negative. Conflating
   * those two is what made this claim people had set nothing up when they had.
   */
  resolved: boolean;
}

/**
 * Every registered way to pay a member. Reuses `payActions()` (lib/contact.ts)
 * — the same builder MemberSheet's Pay section uses — so the handles, deep
 * links, brand colors and preferred-first ordering are identical everywhere and
 * can't drift. Reads the `profiles` columns ContactPaySettings writes (0006 +
 * 0021); `profiles` is members-readable, so an approver can resolve the
 * requester's options in order to actually pay them.
 */
export async function fetchPayMethods(userId: string | null, prefill?: PayPrefill): Promise<PayMethods> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || !userId) return { methods: [], resolved: false };
  try {
    const { data, error } = await sb
      .from("profiles")
      // `phone` is needed too: Apple Cash sends via Messages, so payActions()
      // only offers it when there's a number to send to.
      .select(`phone, pay_preferred, ${PAY_METHODS.map((m) => m.column).join(", ")}`)
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return { methods: [], resolved: false };
    return { methods: payActions(data as MemberContact, prefill), resolved: true };
  } catch {
    return { methods: [], resolved: false };
  }
}

/**
 * The pay-link pre-fill for a reimbursement: the total owed, plus a memo so the
 * transaction is identifiable in someone's Venmo history months later. Uses the
 * ACTUAL cost when a reviewer has corrected it, otherwise what was submitted.
 */
export function payPrefillFor(r: HouseRequest): PayPrefill {
  // Plain hyphen, not an em dash — this is a payment memo that ends up in
  // somebody's Venmo history, not prose.
  return { amount: requestCost(r), note: `MLR: ${r.title}`.slice(0, 80) };
}
