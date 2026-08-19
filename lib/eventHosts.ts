"use client";

// Client helpers for EVENT HOSTS (migration 0209) — who is actually running an
// event, and therefore who may change it and RSVP other people to it.
//
// Since 0187 any member can create an event, but managing one was "an app admin
// OR its creator" — too narrow for how the family runs things. A Work Weekend
// belongs to the Resort Maintenance committee, not to whoever typed it in first;
// if that person is away, nobody else can add the cousin who phoned to say she's
// coming. An event now carries zero or more hosts, each either a PERSON or a
// whole COMMITTEE.
//
// ⚠️⚠️ THE PERMISSION RULE IS NOT MIRRORED HERE, ON PURPOSE. Resolving it needs
// the viewer's committee memberships, which of those they lead, and whether each
// committee has any leads at all — three reads and a second copy of a four-branch
// predicate that would drift from the SQL the first time either side changed. So
// this module ASKS the database (`my_event_permissions`), which runs the very
// same `can_manage_event()` the write RPCs enforce. Same reasoning as
// `event_message_preview` (0192): a second source is worse than none.
//
// Degrades to "no hosts, nothing manageable beyond the old rule" with no backend
// or pre-migration (42P01/PGRST202) and never throws — the lib/polls.ts /
// lib/dropBoxes.ts / lib/houseRequests.ts idiom.

import { useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/** One host on an event — a person or a committee, never both. */
export interface EventHost {
  id: string;
  eventId: string;
  /** Set when the host is a person. */
  userId: string | null;
  /** Set when the host is a whole committee. */
  committeeId: string | null;
  /** The person's display name, or the committee's name. */
  displayName: string;
  /** Committee emoji (committee hosts only). */
  emoji: string | null;
  /** Committee slug, so the chip can link to the committee page. */
  slug: string | null;
}

/** What the viewer may do to one event, as resolved BY THE DATABASE. */
export interface EventPermission {
  canManage: boolean;
  canDelete: boolean;
}

interface HostRow {
  id: string;
  event_id: string;
  user_id: string | null;
  committee_id: string | null;
  display_name: string | null;
  emoji: string | null;
  slug: string | null;
}

function mapHost(r: HostRow): EventHost {
  return {
    id: r.id,
    eventId: r.event_id,
    userId: r.user_id,
    committeeId: r.committee_id,
    displayName: r.display_name ?? "Someone",
    emoji: r.emoji,
    slug: r.slug,
  };
}

/**
 * Every host on the given events, keyed by event id — ONE round-trip for a whole
 * calendar. Names/emoji arrive already resolved (the RPC joins profiles and
 * committees), so nothing here needs a second lookup.
 *
 * Returns an empty Map for a guest: the `event_hosts` read policy is
 * members-only (a host row names a person — the 0081 doctrine), so a guest
 * simply sees no host line rather than a partial one.
 */
export async function fetchEventHosts(eventIds: string[]): Promise<Map<string, EventHost[]>> {
  const out = new Map<string, EventHost[]>();
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || eventIds.length === 0) return out;
  try {
    const { data, error } = await sb.rpc("event_hosts_for", { p_event_ids: eventIds });
    if (error) return out; // pre-migration / not permitted → no hosts, never a throw
    for (const row of (data ?? []) as HostRow[]) {
      const host = mapHost(row);
      const list = out.get(host.eventId);
      if (list) list.push(host);
      else out.set(host.eventId, [host]);
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * What the viewer may do to each of these events, resolved server-side.
 *
 * ⚠️ Pre-migration this RPC doesn't exist, and returning "nothing is manageable"
 * would strip Edit/Delete from admins and creators who legitimately have them
 * today. So the caller passes `fallback`, which is the OLD rule (admin OR
 * creator) — the seam degrades to exactly the behaviour that shipped before this
 * feature, rather than to a locked-down app.
 */
export async function fetchEventPermissions(
  eventIds: string[],
  fallback: (eventId: string) => EventPermission,
): Promise<Map<string, EventPermission>> {
  const out = new Map<string, EventPermission>();
  const sb = supabase;
  const degrade = () => {
    for (const id of eventIds) out.set(id, fallback(id));
    return out;
  };
  if (!isSupabaseConfigured || !sb || eventIds.length === 0) return degrade();
  try {
    const { data, error } = await sb.rpc("my_event_permissions", { p_event_ids: eventIds });
    if (error) return degrade();
    for (const row of (data ?? []) as { event_id: string; can_manage: boolean; can_delete: boolean }[]) {
      out.set(row.event_id, { canManage: Boolean(row.can_manage), canDelete: Boolean(row.can_delete) });
    }
    // A guest gets zero rows back (the RPC filters on auth.uid()); anything the
    // server didn't rule on is simply not manageable.
    for (const id of eventIds) if (!out.has(id)) out.set(id, { canManage: false, canDelete: false });
    return out;
  } catch {
    return degrade();
  }
}

/** Name a person or a committee as a host. Exactly one of the two ids. */
export async function addEventHost(
  eventId: string,
  host: { userId?: string; committeeId?: string },
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  if (!host.userId === !host.committeeId) {
    return { error: "Pick either a person or a committee." };
  }
  const { error } = await sb.rpc("add_event_host", {
    p_event_id: eventId,
    p_user_id: host.userId ?? null,
    p_committee_id: host.committeeId ?? null,
  });
  return error ? { error: error.message } : {};
}

/** Remove one host row. ⚠️ Removing the LAST host re-opens the event to every
 *  member (the "no hosts → anyone" rule), so callers should say so. */
export async function removeEventHost(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("remove_event_host", { p_id: id });
  return error ? { error: error.message } : {};
}

/** One-line summary for a card: "🛠️ Resort Maintenance", "Rick Gorge & 2 others". */
export function hostSummary(hosts: EventHost[]): string | null {
  if (hosts.length === 0) return null;
  const label = (h: EventHost) => (h.emoji ? `${h.emoji} ${h.displayName}` : h.displayName);
  if (hosts.length === 1) return label(hosts[0]);
  if (hosts.length === 2) return `${label(hosts[0])} & ${label(hosts[1])}`;
  return `${label(hosts[0])} & ${hosts.length - 1} others`;
}

/**
 * Hosts + resolved permissions for a list of events, in two round-trips total.
 *
 * Shared by every surface that can open an `EventSheet` with management
 * affordances (`/events`, Home's `UpcomingEvents`) so they can't disagree about
 * who may edit what — the same sheet renders on several surfaces with different
 * data setups, and a permission rule computed per-surface is how one of them
 * ends up quietly stricter than the others.
 *
 * `fallback` is the PRE-0209 rule (admin OR creator) and is used verbatim when
 * the RPC isn't there yet, so an unmigrated database keeps exactly today's
 * behaviour rather than losing Edit for the people who legitimately have it.
 */
export function useEventHosting(
  events: { id: string; createdBy?: string | null }[],
  fallback: (event: { id: string; createdBy?: string | null }) => boolean,
): {
  hosts: Map<string, EventHost[]>;
  permFor: (eventId: string) => EventPermission;
  reload: () => void;
} {
  const [hosts, setHosts] = useState<Map<string, EventHost[]>>(new Map());
  const [perms, setPerms] = useState<Map<string, EventPermission>>(new Map());
  const [nonce, setNonce] = useState(0);

  // Keyed on the id LIST, not the array identity: the events hooks hand back a
  // fresh array on every realtime tick, which would otherwise re-ask on each one.
  const idsKey = events.map((e) => e.id).join(",");
  // Refs so a changing `fallback`/`events` closure never re-runs the effect.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) {
      setHosts(new Map());
      setPerms(new Map());
      return;
    }
    void fetchEventPermissions(ids, (id) => {
      const ev = eventsRef.current.find((e) => e.id === id);
      const allowed = ev ? fallbackRef.current(ev) : false;
      return { canManage: allowed, canDelete: allowed };
    }).then((m) => {
      if (!cancelled) setPerms(m);
    });
    void fetchEventHosts(ids).then((m) => {
      if (!cancelled) setHosts(m);
    });
    return () => {
      cancelled = true;
    };
  }, [idsKey, nonce]);

  const permFor = (eventId: string): EventPermission => {
    const cached = perms.get(eventId);
    if (cached) return cached;
    const ev = eventsRef.current.find((e) => e.id === eventId);
    const allowed = ev ? fallbackRef.current(ev) : false;
    return { canManage: allowed, canDelete: allowed };
  };

  return { hosts, permFor, reload: () => setNonce((n) => n + 1) };
}
