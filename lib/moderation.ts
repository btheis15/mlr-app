/**
 * Client helpers for the content safeguards (see migration 0040 +
 * docs/content-moderation.md).
 *
 * These are the first, friendly line of defense — they keep obvious mistakes
 * out of the request and give fast feedback. They are NOT the enforcement
 * point: the Postgres triggers (length cap + blocklist hold), the report
 * auto-hide, and the media server's magic-byte guard all re-check server-side,
 * because anything in the browser can be bypassed.
 */
import { supabase } from "@/lib/supabase";

/** Hard caps, mirrored by the `moderate_content_text` trigger in 0040. */
export const POST_TEXT_MAX = 5000;
export const COMMENT_TEXT_MAX = 2000;

/** Per-file upload ceiling we surface in the UI (the mini's own cap is larger). */
export const MAX_UPLOAD_MB = 1024;

export type ReportEntity = "post" | "comment";

/** Why-are-you-reporting choices shown in the report menu. */
export const REPORT_REASONS = [
  "Inappropriate or offensive",
  "Sensitive / private info",
  "Spam",
  "Something else",
] as const;

/**
 * File a report on a post or comment. Backed by the `report_content` RPC, which
 * dedups per member and auto-holds the item once enough people report it.
 * Returns an error message on failure, or null on success.
 */
export async function reportContent(
  entity: ReportEntity,
  entityId: string,
  reason?: string,
): Promise<string | null> {
  if (!supabase) return "Sign-in isn't available right now.";
  const { error } = await supabase.rpc("report_content", {
    p_entity_type: entity,
    p_entity_id: entityId,
    p_reason: reason ?? null,
  });
  return error ? error.message || "Couldn't send the report." : null;
}

/**
 * Reject a picked file that clearly isn't an image/video or is over the cap,
 * before we waste an upload. Returns a human message, or null if it's fine.
 */
export function fileRejectionReason(file: File): string | null {
  const isImage = file.type.startsWith("image");
  const isVideo = file.type.startsWith("video");
  if (!isImage && !isVideo) return `"${file.name}" isn't a photo or video.`;
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `"${file.name}" is too large (max ${MAX_UPLOAD_MB} MB).`;
  }
  return null;
}
