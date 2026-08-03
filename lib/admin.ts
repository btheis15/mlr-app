// Admin actions that must run on the Mac mini (they use the service_role key /
// GoTrue admin API, which can't be exposed to the browser): inviting a member
// and — while the two-admin override window is open — setting a member's email
// for them. Mirrors lib/media.ts's "POST to MEDIA_URL with the user's Bearer
// token" pattern; the mini re-checks admin + the unlock window server-side.

import { MEDIA_URL } from "@/lib/media";

async function postAdminJson<T>(path: string, token: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${MEDIA_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

async function postAdmin(path: string, token: string, body: unknown): Promise<void> {
  await postAdminJson(path, token, body);
}

async function getAdminJson<T>(path: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${MEDIA_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

/** Invite a new member: pre-creates a named account and emails them a sign-in code. */
export const inviteMember = (name: string, email: string, token: string) =>
  postAdmin("/admin/invite", token, { name, email });

/** Set a member's email for them. Only succeeds while the override window is open. */
export const setMemberEmail = (userId: string, newEmail: string, token: string) =>
  postAdmin("/admin/set-email", token, { userId, newEmail });

export interface InviteLinkResult {
  email: string;
  ok: boolean;
  error?: string;
}

/** Invite one or more people by email — a branded email whose button signs them
 *  straight in, no code to type. Returns per-email success/failure. */
export const inviteByEmailLink = (entries: { email: string; name?: string }[], token: string) =>
  postAdminJson<{ results: InviteLinkResult[] }>("/admin/invite-link", token, { entries }).then((r) => r.results);

export interface MediaServerDisk {
  /** Absolute MEDIA_DIR the server is storing files under. */
  path: string;
  /** True when MEDIA_DIR is an external volume (/Volumes/…). */
  external: boolean;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface MediaUsageCategory {
  key: string;
  /** e.g. "Photos", "Videos", "Other files". */
  label: string;
  /** Total bytes for this type — INCLUDES each object's auto-generated thumbnail. */
  bytes: number;
  /** Count of real objects (thumbnails are not counted as separate items). */
  files: number;
}

export interface MediaServerUsage {
  /** What the MLR app itself is storing under MEDIA_DIR (not the whole drive). */
  totalBytes: number;
  totalFiles: number;
  categories: MediaUsageCategory[];
}

export interface MediaServerStatus {
  ok: boolean;
  commit: string;
  upToDate: boolean;
  behind: number;
  startedAt: string;
  /** Space on the drive holding the media. Optional — absent on an older mini
   *  that predates this field, so the UI must degrade gracefully. */
  disk?: MediaServerDisk | null;
  /** Per-media-type breakdown of the app's own footprint. Optional — same
   *  graceful-degrade reason as `disk`. */
  usage?: MediaServerUsage | null;
}

/** Current git commit on the mini + how many commits behind origin/main it is. */
export const getMediaServerStatus = (token: string) =>
  getAdminJson<MediaServerStatus>("/admin/media-server-status", token);

export interface RestartMediaServerResult {
  ok: boolean;
  updated: boolean;
  from: string;
  to: string;
  filesChanged: number;
}

/** Pulls origin/main (fast-forward only) into the mini's checkout, then exits
 *  the process — launchd relaunches it within ~10s on the new code. */
export const restartMediaServer = (token: string) =>
  postAdminJson<RestartMediaServerResult>("/admin/restart-media-server", token, {});
