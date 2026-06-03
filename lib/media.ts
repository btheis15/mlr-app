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
  /** Folder bucket on the mini: "posts" (default) or "chat". */
  category?: "posts" | "chat";
  /** For chat: the committee slug, so files group under chat/<room>/. */
  room?: string;
  onProgress?: (loaded: number, total: number) => void;
}

// XMLHttpRequest (not fetch) so we get real upload progress for the bar.
export function uploadToMini(file: File, token: string, opts: UploadOptions = {}): Promise<string> {
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
          const json = JSON.parse(xhr.responseText) as { url?: string };
          if (!json.url) return reject(new Error("media server returned no URL"));
          resolve(json.url);
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
