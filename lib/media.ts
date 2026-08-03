// Shared media helpers for talking to the Mac-mini media server.
//
// These mirror the originals inside PostsView (kept there so the working Posts
// feature is left untouched). Committee chat uses these — and passes a
// `category`/`room` so its uploads are filed under chat/<committee>/ on the mini
// instead of the Posts folder. See media-server/server.js for the layout.

// All uploads go to the resort's mini (no size cap); the server returns a full
// URL, which the app stores verbatim. NEXT_PUBLIC_MEDIA_URL overrides it (local
// dev / if the tunnel URL ever changes).
export const MEDIA_URL = (
  process.env.NEXT_PUBLIC_MEDIA_URL || "https://brians-mac-mini.tail49943c.ts.net"
).replace(/\/+$/, "");

export interface UploadOptions {
  /** Folder bucket on the mini: "posts" (default), "chat", "work", or "dropbox". */
  category?: "posts" | "chat" | "work" | "dropbox";
  /** The sub-folder within the bucket: a chat room slug, or a drop-box id. */
  room?: string;
  onProgress?: (loaded: number, total: number) => void;
}

/** A single photo/video attachment (shared across posts, work items, etc.). */
export type MediaKind = "image" | "video";
export interface Media {
  url: string;
  type: MediaKind;
  /** The mini path (for delete), when known. */
  path?: string;
  /** Small preview url (grids/albums render this instead of the full-res `url`). */
  thumbnailUrl?: string | null;
}

/** What the mini's /upload actually returns. */
export interface UploadResult {
  url: string;
  thumbnailUrl: string | null;
  type: MediaKind | "file";
  path: string;
}

// Ask the mini to AI-grade a caption/post's text for inappropriate language.
// Returns true if the post should be HELD for admin review. FAIL-OPEN: any
// error/unavailability returns false (the word-list gate + Flag-as-inappropriate
// are the backstops). Backed by the media-server's POST /moderate/text.
export async function moderatePostText(text: string, token: string): Promise<boolean> {
  const t = (text || "").trim();
  if (!t) return false;
  try {
    const res = await fetch(`${MEDIA_URL}/moderate/text`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: t }),
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { flagged?: boolean };
    return !!j.flagged;
  } catch {
    return false;
  }
}

// XMLHttpRequest (not fetch) so we get real upload progress for the bar.
// Returns the full { url, thumbnailUrl } pair — the mini now generates a small
// preview alongside the original at upload time (media-server/thumbnail.js),
// so callers building a *_media row insert should carry `thumbnailUrl` through
// alongside `url`/`storage_path` (grids/albums render it instead of the
// full-res file). `thumbnailUrl` is null when generation failed — always a
// safe fallback to the full-res url, never a reason to fail the upload.
export function uploadToMini(file: File, token: string, opts: UploadOptions = {}): Promise<UploadResult> {
  const params = new URLSearchParams();
  if (opts.category) params.set("category", opts.category);
  if (opts.room) params.set("room", opts.room);
  const qs = params.toString();
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${MEDIA_URL}/upload${qs ? `?${qs}` : ""}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(e.loaded, e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const json = JSON.parse(xhr.responseText) as Partial<UploadResult>;
          if (!json.url) return reject(new Error("media server returned no URL"));
          resolve({ url: json.url, thumbnailUrl: json.thumbnailUrl ?? null, type: json.type ?? "file", path: json.path ?? "" });
        } catch {
          reject(new Error("media server returned a bad response"));
        }
      } else {
        reject(new Error((xhr.responseText || "").slice(0, 160) || `media upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Couldn't reach the media server."));
    xhr.send(fd);
  });
}

// Downscale + re-encode photos to web JPEGs before upload (smaller + faster,
// and fixes HDR/HEIC display). Videos and anything non-image pass through.
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    bitmap.close();
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // never block sending on a compression hiccup
  }
}
