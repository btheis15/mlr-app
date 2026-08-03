"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useIdentity } from "@/components/IdentityProvider";
import { SignInWall } from "@/components/Guard";
import { Sheet, FIELD, SectionLabel } from "@/components/Sheet";
import { SkeletonList } from "@/components/Skeleton";
import { BackLink } from "@/components/BackLink";
import { useDropBoxes, useDropBox, useSheetDismiss, useUrlParam } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { uploadToMini, compressImage, MEDIA_URL } from "@/lib/media";
import {
  createDropBox,
  updateDropBox,
  deleteDropBox,
  setDropBoxArchived,
  addDropBoxMedia,
  removeDropBoxMedia,
  setDropBoxMediaStatus,
  type DropBox,
  type DropBoxItem,
} from "@/lib/dropBoxes";

// Drop boxes (migration 0171): a shared "dump the photos/videos here, everyone
// sees them" folder — the app's account-free alternative to a Google Drive
// shared folder. One /drop screen switches between the list of folders and one
// open folder via a `?box=<id>` param (no dynamic route segment — the same
// idiom as /house's `?house=` and Events' `?activity=`), so the shareable link
// is just `/drop?box=<id>` and any signed-in member who opens it is in.
//
// The whole screen is members-only (SignInWall — the tables are members-only
// reads). Uploads reuse the Family Feed's exact pipeline: compress photos,
// stream to the Mac-mini media server (category "dropbox", no size cap), AI-
// moderate inline. The file picker is a PLAIN, always-mounted <input> triggered
// by a plain button — never from inside a popup/menu — because an installed iOS
// PWA silently drops the file otherwise (see the chat-composer incident in
// CLAUDE.md).

// A `?dl=1` on the mini streams the file with Content-Disposition: attachment,
// so this SAVES the original instead of opening it inline — and works
// cross-origin, unlike the bare HTML `download` attribute (the app and the mini
// are different origins). See the media-server /f handler.
function downloadHref(url: string): string {
  return url + (url.includes("?") ? "&" : "?") + "dl=1";
}
function triggerDownload(href: string, filename?: string) {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = href;
  if (filename) a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function zipName(title: string): string {
  return (title || "drop-box").replace(/[^\w.\-]+/g, "-").slice(0, 40) || "drop-box";
}

// An item's on-disk path relative to the MEDIA ROOT (everything after `/f/`),
// derived from its public URL — what the zip endpoint's `path` fields expect.
// Root-relative (not box-relative) so an album can include files referenced
// from elsewhere in the tree, e.g. a Feed post's photo also added to the album.
function mediaRelPath(url: string): string | null {
  const marker = "/f/";
  const i = url.indexOf(marker);
  return i >= 0 ? url.slice(i + marker.length).split("?")[0] : null;
}

// Download via a hidden form POST → hidden iframe: carries the token + any
// number of `path` fields with no URL-length limit, and the browser saves the
// streamed zip natively (Content-Disposition: attachment) without navigating
// away or buffering it in JS memory. Used for both "download all" (no paths)
// and "download selection".
function postDownload(action: string, fields: [string, string][]) {
  if (typeof document === "undefined") return;
  let iframe = document.getElementById("dropbox-dl-frame") as HTMLIFrameElement | null;
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.name = "dropbox-dl";
    iframe.id = "dropbox-dl-frame";
    iframe.style.display = "none";
    document.body.appendChild(iframe);
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.target = "dropbox-dl";
  form.style.display = "none";
  for (const [k, v] of fields) {
    const inp = document.createElement("input");
    inp.type = "hidden";
    inp.name = k;
    inp.value = v;
    form.appendChild(inp);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export function DropBoxes() {
  const boxId = useUrlParam("box");
  return (
    <SignInWall title="Albums" note="Add your name & email to see and add to the family albums from our time Up North — no password, just a code we email you.">
      {boxId ? <DropBoxDetail boxId={boxId} /> : <DropBoxList />}
    </SignInWall>
  );
}

// ── The list of folders ───────────────────────────────────────────────────────

function DropBoxList() {
  const { boxes, loading } = useDropBoxes();
  const [composing, setComposing] = useState(false);

  const active = boxes.filter((b) => !b.archivedAt);

  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/" label="Home" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">📸 Albums</h1>
          <p className="mt-1 text-sm text-muted">
            Shared albums from our time Up North. Add as many photos & videos as you want — everyone with the app can see them.
          </p>
        </div>
      </div>

      <button
        onClick={() => setComposing(true)}
        className="press w-full rounded-2xl border-2 border-dashed border-border bg-card/50 py-4 text-sm font-semibold text-primary"
      >
        ＋ New album
      </button>

      {loading && active.length === 0 ? (
        <SkeletonList count={3} />
      ) : active.length === 0 ? (
        <p className="rounded-2xl bg-card p-6 text-center text-sm text-muted ring-1 ring-border">
          No albums yet. Make one and start adding photos.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {active.map((box) => (
            <BoxCard key={box.id} box={box} />
          ))}
        </div>
      )}

      {composing && <NewBoxSheet onClose={() => setComposing(false)} />}
    </div>
  );
}

function BoxCard({ box }: { box: DropBox }) {
  const cover = box.items.find((i) => i.status === "visible") ?? box.items[0];
  return (
    <Link
      href={`/drop?box=${box.id}`}
      className="press group block overflow-hidden rounded-2xl bg-card ring-1 ring-border"
    >
      <div className="aspect-square w-full bg-primary/5">
        {cover ? (
          <Thumb item={cover} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl">{box.emoji || "📦"}</div>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-semibold">
          {box.emoji ? `${box.emoji} ` : ""}
          {box.title}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {box.count === 0 ? "Empty" : `${box.count} ${box.count === 1 ? "item" : "items"}`}
        </p>
      </div>
    </Link>
  );
}

// ── One open folder ───────────────────────────────────────────────────────────

function DropBoxDetail({ boxId }: { boxId: string }) {
  const { box, loading, reload } = useDropBox(boxId);
  const { user, userId, isAdmin, promptSignIn } = useIdentity();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [managing, setManaging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Who may delete a given item: its uploader, the folder's creator, or an
  // admin (same rule the remove RPC enforces server-side). Regular members can
  // clean up their OWN accidental adds; creator/admin can remove anything.
  const canManageItem = (i: DropBoxItem) =>
    !!box && (i.uploadedBy === userId || box.createdBy === userId || isAdmin);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    // Copy the FileList into a stable array BEFORE resetting the input. On iOS
    // WebKit `input.files` is live — clearing input.value first empties the very
    // reference we're about to read, so Array.from() would yield nothing and the
    // upload would silently no-op (exactly the "select photos, nothing happens"
    // report). Read first, THEN clear — same order as the chat/useMediaPicker
    // pickers. Never clear before the copy.
    const files = input.files ? Array.from(input.files) : [];
    input.value = "";
    if (!files.length || !box) return;
    if (!user) { promptSignIn(); return; }
    setMsg(null);
    setUploading(true);
    setPct(0);
    try {
      const token = (await supabase?.auth.getSession())?.data.session?.access_token;
      if (!token) throw new Error("Finishing sign-in — try again in a second.");
      const totalBytes = files.reduce((s, f) => s + f.size, 0) || 1;
      let doneBytes = 0;
      for (const raw of files) {
        const isVideo = raw.type.startsWith("video");
        // Photos → web JPEG (smaller/faster, fixes HDR/HEIC); videos as-is.
        const f = isVideo ? raw : await compressImage(raw);
        const uploaded = await uploadToMini(f, token, {
          category: "dropbox",
          room: box.id,
          onProgress: (loaded, total) => {
            const frac = total ? loaded / total : 0;
            setPct(Math.min(99, Math.round(((doneBytes + frac * raw.size) / totalBytes) * 100)));
          },
        });
        doneBytes += raw.size;
        const { error } = await addDropBoxMedia(box.id, uploaded.url, isVideo ? "video" : "image", uploaded.thumbnailUrl);
        if (error) throw new Error(error);
      }
      setPct(100);
      // Realtime refills the grid; a nudge in case the channel is slow.
      setMsg(`Added ${files.length} ${files.length === 1 ? "item" : "items"} ✓`);
    } catch (err) {
      const m = err instanceof Error ? err.message : "please try again";
      const friendly = /max|size|large|exceed|413|payload/i.test(m) ? "one of those files was too big to upload." : m;
      setMsg(`Couldn't add: ${friendly}`);
    } finally {
      setUploading(false);
      setPct(0);
      window.setTimeout(() => setMsg(null), 6000);
    }
  };

  const share = async () => {
    if (typeof window === "undefined") return;
    const link = `${window.location.origin}/drop?box=${boxId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: box?.title || "Album", url: link });
      } else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      /* user cancelled the share sheet — no-op */
    }
  };

  // Zip + download originals for an explicit set of items (all, or a selection).
  // Every item's media-root path is sent, so items referenced from elsewhere in
  // the tree (a Feed post's photo added to the album) are included. The mini
  // streams it; nothing is buffered in the browser.
  const downloadZip = async (items: DropBoxItem[]) => {
    if (zipping || !box || !items.length) return;
    setZipping(true);
    try {
      const token = (await supabase?.auth.getSession())?.data.session?.access_token;
      if (!token) throw new Error("Finishing sign-in — try again.");
      const fields: [string, string][] = [
        ["token", token],
        ["box", box.id],
        ["name", zipName(box.title)],
      ];
      let n = 0;
      for (const it of items) {
        const rel = mediaRelPath(it.url);
        if (rel) { fields.push(["path", rel]); n++; }
      }
      if (!n) throw new Error("Couldn't resolve those files.");
      setMsg(`Preparing ${n} ${n === 1 ? "item" : "items"}…`);
      postDownload(`${MEDIA_URL}/dropbox-zip`, fields);
      exitSelect();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't start the download.");
    } finally {
      setZipping(false);
      window.setTimeout(() => setMsg(null), 6000);
    }
  };

  // Delete the selected items the viewer is allowed to remove. The RPC also
  // enforces this, so anything not theirs is simply skipped (not attempted).
  const deleteSelected = async () => {
    if (deleting || !box) return;
    const targets = box.items.filter((i) => selected.has(i.id) && canManageItem(i));
    if (!targets.length) return;
    if (!window.confirm(`Delete ${targets.length} ${targets.length === 1 ? "item" : "items"} from the album? This can't be undone.`)) return;
    setDeleting(true);
    let ok = 0;
    let fail = 0;
    for (const it of targets) {
      const { error } = await removeDropBoxMedia(it.id);
      if (error) fail++;
      else ok++;
    }
    setDeleting(false);
    exitSelect();
    await reload();
    setMsg(fail ? `Deleted ${ok} — ${fail} couldn't be removed.` : `Deleted ${ok} ${ok === 1 ? "item" : "items"} ✓`);
    window.setTimeout(() => setMsg(null), 6000);
  };

  if (loading && !box) {
    return (
      <div className="space-y-4 pt-2">
        <BackLink href="/drop" label="All albums" />
        <SkeletonList count={2} />
      </div>
    );
  }
  if (!box) {
    return (
      <div className="space-y-4 pt-2">
        <BackLink href="/drop" label="All albums" />
        <p className="rounded-2xl bg-card p-6 text-center text-sm text-muted ring-1 ring-border">
          This album isn&apos;t available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      <BackLink href="/drop" label="All folders" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {box.emoji ? `${box.emoji} ` : ""}
            {box.title}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {box.count === 0 ? "Empty — be the first to add something" : `${box.count} ${box.count === 1 ? "item" : "items"}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {box.count > 0 && !selecting && (
            <button
              onClick={() => setSelecting(true)}
              className="press rounded-full bg-card px-3 py-2 text-sm font-medium text-foreground/70 ring-1 ring-border"
            >
              Select
            </button>
          )}
          {box.count > 0 && !selecting && (
            <button
              onClick={() => downloadZip(box.items)}
              disabled={zipping}
              className="press rounded-full bg-card px-3 py-2 text-sm font-medium text-foreground/70 ring-1 ring-border disabled:opacity-60"
            >
              {zipping ? "…" : "⬇ All"}
            </button>
          )}
          <button onClick={share} className="press rounded-full bg-card px-3 py-2 text-sm font-medium text-foreground/70 ring-1 ring-border">
            {copied ? "Copied ✓" : "Share"}
          </button>
          {box.canManage && (
            <button
              onClick={() => setManaging(true)}
              aria-label="Album settings"
              className="press rounded-full bg-card px-3 py-2 text-sm font-medium text-foreground/70 ring-1 ring-border"
            >
              ⋯
            </button>
          )}
        </div>
      </div>

      {box.archivedAt && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
          This album is archived — hidden from the list, but still here via its link.
        </p>
      )}

      {selecting ? (
        // Selection toolbar (replaces the dump button while picking).
        (() => {
          const deletableCount = box.items.filter((i) => selected.has(i.id) && canManageItem(i)).length;
          return (
            <div className="space-y-2.5 rounded-2xl bg-card p-3 ring-1 ring-border">
              <div className="flex items-center justify-between gap-2">
                <button onClick={exitSelect} className="press px-1 text-sm font-medium text-foreground/70">
                  Cancel
                </button>
                <span className="text-sm font-semibold tabular-nums">{selected.size} selected</span>
                <button
                  onClick={() => setSelected(new Set(box.items.map((i) => i.id)))}
                  className="press rounded-full bg-background px-3 py-1.5 text-sm font-medium text-foreground/70 ring-1 ring-border"
                >
                  Select all
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadZip(box.items.filter((i) => selected.has(i.id)))}
                  disabled={selected.size === 0 || zipping || deleting}
                  className="press flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {zipping ? "…" : `⬇ Download${selected.size ? ` (${selected.size})` : ""}`}
                </button>
                {deletableCount > 0 && (
                  <button
                    onClick={deleteSelected}
                    disabled={deleting || zipping}
                    className="press flex-1 rounded-xl bg-card px-4 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-red-600/30 disabled:opacity-50"
                  >
                    {deleting ? "Deleting…" : `🗑 Delete (${deletableCount})`}
                  </button>
                )}
              </div>
            </div>
          );
        })()
      ) : (
        <>
          {/* The one big "dump" button — a plain trigger + always-mounted input. */}
          <button
            onClick={() => (user ? inputRef.current?.click() : promptSignIn())}
            disabled={uploading}
            className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {uploading ? `Uploading… ${pct}%` : "＋ Add photos & videos"}
          </button>
          <input ref={inputRef} type="file" accept="image/*,video/*" multiple onChange={onPick} className="hidden" />
        </>
      )}

      {uploading && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {msg && <p className="text-center text-sm text-muted">{msg}</p>}

      {box.count === 0 ? (
        <p className="rounded-2xl bg-card p-8 text-center text-sm text-muted ring-1 ring-border">
          Nothing here yet.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {box.items.map((item, idx) => {
            const isSel = selected.has(item.id);
            return (
              <button
                key={item.id}
                onClick={() => (selecting ? toggleSelect(item.id) : setViewerIndex(idx))}
                className={`press relative aspect-square overflow-hidden rounded-lg bg-primary/5 ${
                  selecting && isSel ? "ring-2 ring-primary" : ""
                }`}
              >
                <Thumb item={item} />
                {item.type === "video" && (
                  <span className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                    ▶
                  </span>
                )}
                {item.status !== "visible" && (
                  <span className="pointer-events-none absolute inset-x-1 top-1 rounded bg-accent/90 px-1 py-0.5 text-center text-[9px] font-semibold text-white">
                    Held for review
                  </span>
                )}
                {selecting && (
                  <span
                    className={`pointer-events-none absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      isSel ? "bg-primary text-white" : "bg-black/30 text-white ring-1 ring-white/70"
                    }`}
                  >
                    {isSel ? "✓" : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {viewerIndex !== null && box.items[viewerIndex] && (
        <FolderCarousel
          items={box.items}
          startIndex={viewerIndex}
          userId={userId}
          creatorId={box.createdBy}
          isAdmin={isAdmin}
          onClose={() => setViewerIndex(null)}
        />
      )}
      {managing && <ManageBoxSheet box={box} onClose={() => setManaging(false)} />}
    </div>
  );
}

// A single thumbnail. Prefer the small, mini-generated preview (thumbnailUrl)
// so scrolling a big album never re-downloads full-res photos/videos just to
// fill a grid tile — falls back to the full asset when no thumbnail exists yet
// (pre-migration rows, or a thumbnail that failed to generate). Videos with no
// thumbnail fall back to a metadata-only <video> first frame (no full download).
function Thumb({ item }: { item: DropBoxItem }) {
  if (item.thumbnailUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />;
  }
  if (item.type === "video") {
    return <video src={item.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />;
}

// Full-screen swipe carousel over EVERY item in the folder — swipe (native
// scroll-snap) or tap the edge arrows to move between photos/videos without
// closing and reopening. Each slide carries a Download button (originals), plus
// Remove (uploader/creator/admin) and Approve (admin, held items).
function FolderCarousel({
  items,
  startIndex,
  userId,
  creatorId,
  isAdmin,
  onClose,
}: {
  items: DropBoxItem[];
  startIndex: number;
  userId: string | null;
  creatorId: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(startIndex);
  const [busy, setBusy] = useState(false);

  // Jump to the tapped item on open (no smooth-scroll — it should already be there).
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollLeft = startIndex * el.clientWidth;
  }, [startIndex]);

  // Escape closes; ←/→ step (desktop niceties, harmless on mobile).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = (dir: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Read the live position (not the closure-captured `active`) so the keydown
    // handler registered once with [] deps always steps from where we actually are.
    const cur = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    const next = Math.max(0, Math.min(items.length - 1, cur + dir));
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  const item = items[active];
  if (!item) return null;
  const canRemove = item.uploadedBy === userId || creatorId === userId || isAdmin;

  const remove = async () => {
    if (busy || !window.confirm("Remove this from the album?")) return;
    setBusy(true);
    const { error } = await removeDropBoxMedia(item.id);
    setBusy(false);
    if (error) { window.alert(`Couldn't remove: ${error}`); return; }
    onClose(); // realtime refreshes the grid
  };
  const approve = async () => {
    setBusy(true);
    await setDropBoxMediaStatus(item.id, "visible");
    setBusy(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[65] flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <button aria-label="Close" onClick={onClose} className="press rounded-full bg-white/10 px-3 py-1.5 text-sm">
          ✕
        </button>
        <span className="text-sm font-medium tabular-nums">
          {active + 1} / {items.length}
        </span>
        <button
          onClick={() => triggerDownload(downloadHref(item.url))}
          className="press rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold"
        >
          ⬇ Save
        </button>
      </div>

      {/* Swipeable slides */}
      <div
        ref={scrollerRef}
        onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-contain"
      >
        {items.map((it) => (
          <div key={it.id} className="flex w-full shrink-0 snap-center items-center justify-center">
            {it.type === "video" ? (
              <video src={it.url} controls playsInline preload="metadata" className="max-h-full max-w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.url} alt="" className="max-h-full max-w-full object-contain" />
            )}
          </div>
        ))}
      </div>

      {/* Edge arrows (mainly desktop; swipe is primary on touch) */}
      {items.length > 1 && (
        <>
          <button
            aria-label="Previous"
            onClick={() => step(-1)}
            className="press absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 px-3 py-4 text-white sm:block"
          >
            ‹
          </button>
          <button
            aria-label="Next"
            onClick={() => step(1)}
            className="press absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 px-3 py-4 text-white sm:block"
          >
            ›
          </button>
        </>
      )}

      {/* Held / manage actions for the current item */}
      {(canRemove || (isAdmin && item.status !== "visible") || item.status !== "visible") && (
        <div className="flex flex-wrap items-center justify-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white">
          {item.status !== "visible" && (
            <span className="rounded-full bg-accent/80 px-3 py-1.5 text-xs font-semibold">Held for review</span>
          )}
          {isAdmin && item.status !== "visible" && (
            <button onClick={approve} disabled={busy} className="press rounded-full bg-primary px-4 py-1.5 text-sm font-semibold disabled:opacity-60">
              Approve
            </button>
          )}
          {canRemove && (
            <button onClick={remove} disabled={busy} className="press rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold ring-1 ring-white/20 disabled:opacity-60">
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sheets ────────────────────────────────────────────────────────────────────

function NewBoxSheet({ onClose }: { onClose: () => void }) {
  const { closing, close } = useSheetDismiss(onClose);
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const { id, error } = await createDropBox(title.trim(), emoji.trim() || null);
    setBusy(false);
    if (error || !id) { setErr(error || "Couldn't create the album."); return; }
    // Land the creator straight in the new (empty) folder, ready to dump.
    if (typeof window !== "undefined") window.location.assign(`/drop?box=${id}`);
    close();
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="new-box-title"
      header={<h2 id="new-box-title" className="text-lg font-bold">New album</h2>}
      footer={
        <button
          onClick={create}
          disabled={!title.trim() || busy}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create album"}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <SectionLabel>Name</SectionLabel>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Fest 2026 photos"
            autoFocus
            className={`${FIELD} w-full`}
          />
        </div>
        <div className="space-y-1.5">
          <SectionLabel>Emoji (optional)</SectionLabel>
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
            placeholder="📸"
            className={`${FIELD} w-24`}
          />
        </div>
        <p className="text-xs text-muted">
          Anyone with the app can open this album and add to it. Share the link once it&apos;s made.
        </p>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Sheet>
  );
}

function ManageBoxSheet({ box, onClose }: { box: DropBox; onClose: () => void }) {
  const { closing, close } = useSheetDismiss(onClose);
  const [title, setTitle] = useState(box.title);
  const [emoji, setEmoji] = useState(box.emoji || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const { error } = await updateDropBox(box.id, { title: title.trim(), emoji: emoji.trim() || null });
    setBusy(false);
    if (error) { setErr(error); return; }
    close();
  };
  const toggleArchive = async () => {
    setBusy(true);
    await setDropBoxArchived(box.id, !box.archivedAt);
    setBusy(false);
    close();
  };
  const destroy = async () => {
    if (!window.confirm(`Delete "${box.title}" and everything in it? This can't be undone.`)) return;
    setBusy(true);
    const { error } = await deleteDropBox(box.id);
    setBusy(false);
    if (error) { setErr(error); return; }
    if (typeof window !== "undefined") window.location.assign("/drop");
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="manage-box-title"
      header={<h2 id="manage-box-title" className="text-lg font-bold">Album settings</h2>}
      footer={
        <button
          onClick={save}
          disabled={!title.trim() || busy}
          className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <SectionLabel>Name</SectionLabel>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${FIELD} w-full`} />
        </div>
        <div className="space-y-1.5">
          <SectionLabel>Emoji</SectionLabel>
          <input value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 2))} className={`${FIELD} w-24`} />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="space-y-2 border-t border-border pt-4">
          <button onClick={toggleArchive} disabled={busy} className="press w-full rounded-xl bg-card py-3 text-sm font-semibold text-foreground/80 ring-1 ring-border">
            {box.archivedAt ? "Unarchive album" : "Archive album"}
          </button>
          <button onClick={destroy} disabled={busy} className="press w-full rounded-xl bg-card py-3 text-sm font-semibold text-red-600 ring-1 ring-border">
            Delete album
          </button>
        </div>
      </div>
    </Sheet>
  );
}
