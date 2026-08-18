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
import { payActions, type Action, type MemberContact } from "@/lib/contact";

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

export const KIND_META: Record<HouseRequestKind, { emoji: string; label: string; tile: string }> = {
  idea: { emoji: "💡", label: "Idea", tile: "bg-sun/12" },
  purchase: { emoji: "🛒", label: "Purchase Request", tile: "bg-lake/12" },
  reimbursement: { emoji: "🧾", label: "Request Reimbursement", tile: "bg-accent/12" },
};

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
      return r.kind === "reimbursement" ? "Approved — not paid yet" : "Approved — not ordered yet";
    case "ordered":
      return "Ordered";
    case "received":
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
  if (r.status === "approved") return "toDo";
  if (r.status === "ordered") return "moving";
  return "done";
}

/** True once a request has reached a state that no longer needs anyone. */
export function isSettled(r: HouseRequest): boolean {
  return r.status === "received" || r.status === "denied" || r.status === "withdrawn";
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
  /** Approved but not yet ordered/received — the "we never do it" gap. */
  notOrdered: number;
  /** Money on approved/ordered/received requests decided this calendar year. */
  approvedThisYear: number;
}

export function summarize(requests: HouseRequest[], year = new Date().getFullYear()): HouseRequestSummary {
  let waiting = 0;
  let waitingCost = 0;
  let notOrdered = 0;
  let approvedThisYear = 0;
  for (const r of requests) {
    if (r.status === "pending") {
      waiting += 1;
      waitingCost += r.estCost ?? 0;
      continue;
    }
    if (r.status === "approved") notOrdered += 1;
    const decided = r.reviewedAt ?? r.createdAt;
    if (
      (r.status === "approved" || r.status === "ordered" || r.status === "received") &&
      new Date(decided).getFullYear() === year
    ) {
      approvedThisYear += requestCost(r) ?? 0;
    }
  }
  return { waiting, waitingCost, notOrdered, approvedThisYear };
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
  "id, house_id, kind, title, reason, links, est_cost, quantity, status, created_by, created_at," +
  " reviewed_by, reviewed_at, review_note, actual_cost, order_note, ordered_at, received_at," +
  " house_request_media(id, storage_path, thumbnail_url, media_type, status, uploaded_by)";

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
    const { data, error } = await sb
      .from("house_requests")
      .select(SELECT)
      .eq("house_id", houseId)
      .order("created_at", { ascending: false });
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

/** Every request the viewer can see, across all houses — the admin queue. */
export async function fetchAllHouseRequests(
  viewerId: string | null,
  canReview = false,
): Promise<HouseRequestsResult> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return NO_HOUSE_REQUESTS;
  try {
    const { data, error } = await sb.from("house_requests").select(SELECT).order("created_at", { ascending: false });
    if (error) {
      const missing = isMissingTable(error) || isMissingColumn(error);
      if (!missing) console.warn("fetchAllHouseRequests: read error", error.message);
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
}

export async function createHouseRequest(input: HouseRequestInput): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("create_house_request", {
    p_house_id: input.houseId,
    p_kind: input.kind,
    p_title: input.title,
    p_reason: input.reason,
    p_links: input.links,
    p_est_cost: input.estCost,
    p_quantity: input.quantity,
  });
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

export function withdrawHouseRequest(id: string): Promise<Res> {
  return rpc("withdraw_house_request", { p_id: id });
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
export async function fetchPayMethods(userId: string | null): Promise<PayMethods> {
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
    return { methods: payActions(data as MemberContact), resolved: true };
  } catch {
    return { methods: [], resolved: false };
  }
}
