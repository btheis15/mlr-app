"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIdentity } from "@/components/IdentityProvider";
import { ModalPortal } from "@/components/ModalPortal";
import { SignInWall } from "@/components/Guard";
import { Sheet, FIELD, SectionLabel } from "@/components/Sheet";
import { SkeletonList } from "@/components/Skeleton";
import { BackLink } from "@/components/BackLink";
import { useDropBoxes, useDropBox, useSheetDismiss, useUrlParam } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { uploadToMini, prepareImageForUpload, capturedAtForFile, MEDIA_URL, type MediaKind } from "@/lib/media";
import {
  createDropBox,
  updateDropBox,
  deleteDropBox,
  setDropBoxArchived,
  addDropBoxMedia,
  removeDropBoxMedia,
  setDropBoxMediaStatus,
  sortDropBoxItems,
  DROP_BOX_SORT_DEFAULT,
  DROP_BOX_SORT_KEY,
  type DropBox,
  type DropBoxItem,
  type DropBoxSort,
} from "@/lib/dropBoxes";
import { mediaSrc } from "@/lib/mediaToken";

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
  // mediaSrc first so the token is present, then append dl=1. Order doesn't matter
  // for correctness (both are query params) but doing it this way means mediaSrc
  // sees a clean url and its "already signed?" check behaves predictably.
  const signed = mediaSrc(url);
  return signed + (signed.includes("?") ? "&" : "?") + "dl=1";
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

// An optimistic upload-in-progress tile. We paint one the instant files are
// picked — a local object-URL preview + a progress ring — so the grid never
// sits empty waiting on the realtime insert (which read as "nothing happened").
// Each is handed off to its real DB row seamlessly and pruned afterward.
interface Pending {
  key: string;
  file: File;
  previewUrl: string;
  type: MediaKind;
  loaded: number;
  total: number;
  status: "uploading" | "done" | "error";
  errorMsg?: string;
  /** The mini url once uploaded — used to hide this tile the moment its real row lands. */
  uploadedUrl?: string;
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
        <p className="line-clamp-2 text-sm font-semibold">
          {box.emoji ? `${box.emoji} ` : ""}
          {box.title}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {box.count === 0 ? "Empty" : `${box.count} ${box.count === 1 ? "item" : "items"}`} · by {box.createdByName}
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
  const [pending, setPending] = useState<Pending[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [managing, setManaging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // The viewer's own sort choice — a VIEWING preference only. It's applied
  // client-side below and stored per device, so switching it never reorders the
  // album for anyone else. Read post-mount (not in the initializer) so the first
  // client render matches the prerendered HTML.
  const [sort, setSort] = useState<DropBoxSort>(DROP_BOX_SORT_DEFAULT);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DROP_BOX_SORT_KEY);
      if (saved === "uploaded" || saved === "captured") setSort(saved);
    } catch {
      /* private mode / storage disabled — just use the default */
    }
  }, []);
  const chooseSort = (next: DropBoxSort) => {
    setSort(next);
    try {
      window.localStorage.setItem(DROP_BOX_SORT_KEY, next);
    } catch {
      /* non-fatal: the choice just won't persist */
    }
  };
  // One sorted list backing BOTH the grid and the full-screen carousel, so a
  // tapped tile always opens the same item the viewer pressed.
  const items = useMemo(() => sortDropBoxItems(box?.items ?? [], sort), [box?.items, sort]);

  // ── Optimistic upload tiles ────────────────────────────────────────────────
  const pendingRef = useRef<Pending[]>([]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  // Free every preview object-URL on unmount (nav away mid-upload).
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  const patchPending = (key: string, patch: Partial<Pending>) =>
    setPending((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const dropPending = (key: string) =>
    setPending((prev) => {
      const t = prev.find((p) => p.key === key);
      if (t) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((p) => p.key !== key);
    });

  // When a real row for an optimistic tile arrives (matched by url), drop the
  // tile and free its preview. Depends only on `box`, and no-ops when nothing
  // matched, so it can't loop.
  useEffect(() => {
    const urls = new Set((box?.items ?? []).map((i) => i.url));
    setPending((prev) => {
      const gone = prev.filter((p) => p.uploadedUrl && urls.has(p.uploadedUrl));
      if (!gone.length) return prev;
      gone.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return prev.filter((p) => !(p.uploadedUrl && urls.has(p.uploadedUrl)));
    });
  }, [box]);

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

  // Upload one already-queued file. Shared by the initial pick AND by retry —
  // the Pending keeps its raw File in memory, so a failed tile can be re-sent in
  // place with no re-picking. Returns true on success; never calls reload itself
  // (callers batch that). Mirrors the client error-wording the tiles show.
  const uploadOne = async (p: Pending, token: string, boxId: string): Promise<boolean> => {
    try {
      const isVideo = p.type === "video";
      const taken = isVideo ? { iso: null, source: null } : await capturedAtForFile(p.file);
      const f = isVideo ? p.file : await prepareImageForUpload(p.file);
      const uploaded = await uploadToMini(f, token, {
        category: "dropbox",
        room: boxId,
        capturedAt: taken.iso,
        capturedAtSource: taken.source,
        onProgress: (loaded, total) => patchPending(p.key, { loaded, total: total || p.total }),
      });
      const { error } = await addDropBoxMedia(
        boxId,
        uploaded.url,
        isVideo ? "video" : "image",
        uploaded.thumbnailUrl,
        uploaded.capturedAt,
        uploaded.capturedAtSource,
      );
      if (error) throw new Error(error);
      patchPending(p.key, { status: "done", uploadedUrl: uploaded.url, loaded: p.total });
      // Safety net: if realtime/reload never repoints to this exact url (a bg
      // transcode can swap a .mov's url), don't strand the tile — drop it once
      // the real row has surely landed.
      window.setTimeout(() => dropPending(p.key), 12000);
      return true;
    } catch (err) {
      const m = err instanceof Error ? err.message : "";
      const friendly = /too many|429/i.test(m)
        ? "hit the upload limit — try again shortly"
        : /max|size|large|exceed|413|payload/i.test(m)
          ? "that file was too big"
          : "upload failed";
      patchPending(p.key, { status: "error", errorMsg: friendly });
      return false;
    }
  };

  const freshToken = async (): Promise<string | null> => {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token ?? null;
    if (!token) {
      setMsg("Finishing sign-in — try again in a second.");
      window.setTimeout(() => setMsg(null), 4000);
    }
    return token;
  };

  /** Re-send a single failed tile (its File is still in memory). */
  const retry = async (p: Pending) => {
    if (!box) return;
    if (!user) return promptSignIn();
    const token = await freshToken();
    if (!token) return;
    patchPending(p.key, { status: "uploading", loaded: 0, errorMsg: undefined });
    if (await uploadOne(p, token, box.id)) await reload();
  };

  /** Re-send every failed tile at once — the "these all hit the limit" case. */
  const retryAllFailed = async () => {
    if (!box) return;
    if (!user) return promptSignIn();
    const stuck = pending.filter((p) => p.status === "error");
    if (!stuck.length) return;
    const token = await freshToken();
    if (!token) return;
    const boxId = box.id;
    stuck.forEach((p) => patchPending(p.key, { status: "uploading", loaded: 0, errorMsg: undefined }));
    let idx = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, stuck.length) }, async () => {
        while (idx < stuck.length) await uploadOne(stuck[idx++], token, boxId);
      }),
    );
    await reload();
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

    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    if (!token) {
      setMsg("Finishing sign-in — try again in a second.");
      window.setTimeout(() => setMsg(null), 4000);
      return;
    }
    const boxId = box.id;

    // Paint the picked files as tiles immediately (newest first), each with a
    // live progress ring — the grid fills the instant you pick, not when the
    // upload finishes. Then upload them in the background.
    const batch: Pending[] = files.map((raw) => ({
      key: crypto.randomUUID(),
      file: raw,
      previewUrl: URL.createObjectURL(raw),
      type: raw.type.startsWith("video") ? "video" : "image",
      loaded: 0,
      total: raw.size || 1,
      status: "uploading",
    }));
    setPending((prev) => [...batch, ...prev]);

    let added = 0;
    let failed = 0;
    // Upload a few at a time so a big dump overlaps on the network instead of
    // crawling one-by-one — without stampeding the mini's ffmpeg/moderation.
    // uploadOne is component-scoped so a failed tile can be retried in place.
    const LIMIT = 3;
    let idx = 0;
    await Promise.all(
      Array.from({ length: Math.min(LIMIT, batch.length) }, async () => {
        while (idx < batch.length) {
          if (await uploadOne(batch[idx++], token, boxId)) added++;
          else failed++;
        }
      }),
    );

    // Realtime usually fills the real rows before we get here; this is the backstop.
    await reload();
    if (added || failed) {
      setMsg(failed ? `Added ${added} · ${failed} couldn't upload` : `Added ${added} ${added === 1 ? "item" : "items"} ✓`);
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
      setMsg(`Preparing ${n} ${n === 1 ? "item" : "items"} — your download will start shortly…`);
      postDownload(`${MEDIA_URL}/dropbox-zip`, fields);
      exitSelect();
      // The mini zips + streams server-side; the browser hands off to its own
      // download UI once bytes arrive. There's no client signal for "started,"
      // so hold the busy state briefly rather than snapping the button back to
      // idle the instant the form submits (which read as "nothing happened").
      window.setTimeout(() => setZipping(false), 2500);
      window.setTimeout(() => setMsg(null), 6000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't start the download.");
      setZipping(false);
      window.setTimeout(() => setMsg(null), 6000);
    }
  };

  // Delete the selected items the viewer is allowed to remove. The RPC also
  // enforces this, so anything not theirs is simply skipped (not attempted).
  const deleteSelected = async () => {
    if (deleting || !box) return;
    const targets = items.filter((i) => selected.has(i.id) && canManageItem(i));
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

  // Optimistic tiles still waiting on their real row (matched by url), and a
  // batch-wide progress figure for the thin bar. Rendered ahead of items,
  // so a tile whose row has landed simply stops rendering here — no dup frame.
  const itemUrls = new Set(items.map((i) => i.url));
  const visiblePending = pending.filter((p) => !(p.uploadedUrl && itemUrls.has(p.uploadedUrl)));
  const uploadingCount = pending.filter((p) => p.status === "uploading").length;
  const failedCount = pending.filter((p) => p.status === "error").length;
  const aggLoaded = pending.reduce((s, p) => (p.status === "uploading" ? s + p.loaded : s), 0);
  const aggTotal = pending.reduce((s, p) => (p.status === "uploading" ? s + p.total : s), 0);
  const aggPct = aggTotal ? Math.min(99, Math.round((aggLoaded / aggTotal) * 100)) : 0;

  return (
    <div className="space-y-4 pt-2">
      <BackLink href="/drop" label="All folders" />

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {box.emoji ? `${box.emoji} ` : ""}
          {box.title}
        </h1>
        <p className="mt-0.5 text-sm text-muted">
          {box.count === 0 && visiblePending.length === 0
            ? "Empty — be the first to add something"
            : `${box.count} ${box.count === 1 ? "item" : "items"}`}
          {" "}· created by {box.createdByName}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Sort is the VIEWER'S OWN choice (device-local, never written to the
            album), so switching it can't reorder anyone else's view. Defaults to
            newest-upload so your just-added photos are at the front instead of
            scattered by shot date, which reads as the app glitching. */}
        {box.count > 1 && !selecting && (
          <button
            onClick={() => chooseSort(sort === "uploaded" ? "captured" : "uploaded")}
            title={
              sort === "uploaded"
                ? "Sorted by when it was added — tap to sort by when it was taken"
                : "Sorted by when it was taken — tap to sort by when it was added"
            }
            className="press rounded-full bg-card px-3 py-2 text-sm font-medium text-foreground/70 ring-1 ring-border"
          >
            {sort === "uploaded" ? "↕ Newest added" : "↕ Date taken"}
          </button>
        )}
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
            onClick={() => downloadZip(items)}
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

      {box.archivedAt && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
          This album is archived — hidden from the list, but still here via its link.
        </p>
      )}

      {selecting ? (
        // Selection toolbar (replaces the dump button while picking).
        (() => {
          const deletableCount = items.filter((i) => selected.has(i.id) && canManageItem(i)).length;
          return (
            <div className="space-y-2.5 rounded-2xl bg-card p-3 ring-1 ring-border">
              <div className="flex items-center justify-between gap-2">
                <button onClick={exitSelect} className="press px-1 text-sm font-medium text-foreground/70">
                  Cancel
                </button>
                <span className="text-sm font-semibold tabular-nums">{selected.size} selected</span>
                <button
                  onClick={() => setSelected(new Set(items.map((i) => i.id)))}
                  className="press rounded-full bg-background px-3 py-1.5 text-sm font-medium text-foreground/70 ring-1 ring-border"
                >
                  Select all
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadZip(items.filter((i) => selected.has(i.id)))}
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
          {/* The one big "dump" button — a plain trigger + always-mounted input.
              Stays tappable during an upload so you can keep adding while the
              first batch finishes; progress shows on the tiles themselves. */}
          <button
            onClick={() => (user ? inputRef.current?.click() : promptSignIn())}
            className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-sm font-semibold text-white"
          >
            {uploadingCount > 0 ? `Adding ${uploadingCount}…  ＋ add more` : "＋ Add photos & videos"}
          </button>
          <input ref={inputRef} type="file" accept="image/*,video/*" multiple onChange={onPick} className="hidden" />
        </>
      )}

      {uploadingCount > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${aggPct}%` }} />
        </div>
      )}
      {msg && <p className="text-center text-sm text-muted">{msg}</p>}

      {failedCount > 0 && (
        <button
          onClick={retryAllFailed}
          className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent/10 py-2.5 text-sm font-semibold text-accent ring-1 ring-accent/20"
        >
          ↻ Retry {failedCount} that didn&rsquo;t upload
        </button>
      )}

      {box.count === 0 && visiblePending.length === 0 ? (
        <p className="rounded-2xl bg-card p-8 text-center text-sm text-muted ring-1 ring-border">
          Nothing here yet.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {visiblePending.map((p) => (
            <PendingTile key={p.key} p={p} onDismiss={() => dropPending(p.key)} onRetry={() => retry(p)} />
          ))}
          {items.map((item, idx) => {
            const isSel = selected.has(item.id);
            return (
              <button
                key={item.id}
                onClick={() => (selecting ? toggleSelect(item.id) : setViewerIndex(idx))}
                className={`press cv-tile relative aspect-square overflow-hidden rounded-lg bg-primary/5 ${
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

      {viewerIndex !== null && items[viewerIndex] && (
        <FolderCarousel
          items={items}
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
  const isVideo = item.type === "video";
  // A video tile needs a visible ▶ badge: with a generated poster frame it is
  // otherwise indistinguishable from a photo, and without one it's a black box.
  const inner = item.thumbnailUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={mediaSrc(item.thumbnailUrl)} alt="" loading="lazy" className="h-full w-full object-cover" />
  ) : isVideo ? (
    // No poster frame yet (pre-thumbnail upload, or generation failed) —
    // `preload="metadata"` paints the first frame on most browsers, though iOS
    // often leaves it black. The badge below is what keeps that readable as a
    // video rather than a broken tile; the mini's backfill fills these in.
    <video src={mediaSrc(item.url)} muted playsInline preload="metadata" className="h-full w-full bg-black object-cover" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={mediaSrc(item.url)} alt="" loading="lazy" className="h-full w-full object-cover" />
  );

  if (!isVideo) return inner;
  return (
    <div className="relative h-full w-full">
      {inner}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 pl-0.5 text-sm text-white ring-1 ring-white/25">
          ▶
        </span>
      </span>
    </div>
  );
}

// An optimistic upload-in-progress tile: the picked file's own local preview
// (an object URL — instant, no network) under a scrim + progress ring, so a
// dropped photo/video shows the moment it's picked and animates to done. On
// failure it flips to a tappable "couldn't upload" state the user can dismiss.
function PendingTile({ p, onDismiss, onRetry }: { p: Pending; onDismiss: () => void; onRetry: () => void }) {
  const pct = p.total ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0;
  const isError = p.status === "error";
  const isBusy = p.status === "uploading" && pct < 100;
  return (
    <div className={`relative aspect-square overflow-hidden rounded-lg bg-primary/5 ${isError ? "ring-2 ring-red-500/60" : ""}`}>
      {p.type === "video" ? (
        <video src={mediaSrc(p.previewUrl)} muted playsInline preload="metadata" className="h-full w-full bg-black object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaSrc(p.previewUrl)} alt="" className="h-full w-full object-cover" />
      )}
      {isError ? (
        // Tap the tile to RETRY (its file is still in memory), or the ✕ to remove.
        <div className="absolute inset-0 bg-black/60 text-white">
          <button onClick={onRetry} className="press flex h-full w-full flex-col items-center justify-center gap-0.5" aria-label="Retry upload">
            <span className="text-lg leading-none">↻</span>
            <span className="px-1 text-center text-[9px] font-semibold leading-tight">{p.errorMsg} · tap to retry</span>
          </button>
          <button
            onClick={onDismiss}
            aria-label="Remove"
            className="press absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-xs font-bold text-white"
          >
            ✕
          </button>
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 bg-black/35" />
          {isBusy && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            </span>
          )}
          <div className="pointer-events-none absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  );
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
  const didInit = useRef(false);
  const [active, setActive] = useState(startIndex);
  const [busy, setBusy] = useState(false);

  // Jump to the tapped item on open — via a CALLBACK REF, not a mount effect,
  // so it fires exactly when the scroller attaches to the DOM. ModalPortal
  // mounts its children one tick late (its `mounted` gate), so a plain
  // useEffect([startIndex]) ran while scrollerRef was still null and never
  // re-ran — leaving the viewer stuck at scrollLeft 0 (slide 0, which is
  // windowed-out → black) while `active` said 44. That also broke next/prev:
  // step() read scrollLeft 0 → jumped to slide 1 instead of stepping from 44.
  const attachScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scrollerRef.current = el;
      if (el && !didInit.current) {
        didInit.current = true;
        el.scrollLeft = startIndex * el.clientWidth;
      }
    },
    [startIndex],
  );

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
    <ModalPortal>
    <div className="fixed inset-0 z-[65] flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <button aria-label="Close" onClick={onClose} className="press rounded-full bg-white/10 px-3 py-1.5 text-sm">
          ✕
        </button>
        <span className="flex flex-col items-center text-center leading-tight">
          <span className="text-sm font-medium tabular-nums">
            {active + 1} / {items.length}
          </span>
          <span className="text-[11px] text-white/60">by {item.uploadedByName}</span>
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
        ref={attachScroller}
        onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-contain"
      >
        {items.map((it, i) => {
          // Windowed: only the current slide and its immediate neighbors mount
          // real media. Every slide still renders a full-width spacer div so the
          // scroll geometry (and the scrollLeft math above) is unchanged — a
          // 2,000-item album keeps ≤3 <img>/<video> elements alive at once
          // instead of thousands, and the neighbor is already loaded by the time
          // you swipe onto it.
          const near = Math.abs(i - active) <= 1;
          return (
            <div key={it.id} className="flex w-full shrink-0 snap-center items-center justify-center">
              {!near ? null : it.type === "video" ? (
                <video src={mediaSrc(it.url)} controls playsInline preload="metadata" className="max-h-full max-w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaSrc(it.url)} alt="" className="max-h-full max-w-full object-contain" />
              )}
            </div>
          );
        })}
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
    </ModalPortal>
  );
}

// ── Sheets ────────────────────────────────────────────────────────────────────

function NewBoxSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
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
    // Land the creator straight in the new (empty) folder, ready to dump —
    // client-side (the /drop screen swaps list→detail on the ?box param, and
    // useUrlParam picks up a router.push), so no white-flash full reload.
    close();
    router.push(`/drop?box=${id}`);
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
  const router = useRouter();
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
    close();
    router.push("/drop");
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
