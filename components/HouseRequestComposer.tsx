"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EventLink } from "@/lib/types";
import {
  KIND_META,
  addHouseRequestMedia,
  createHouseRequest,
  fetchHouseAdmins,
  fetchPayMethods,
  updateHouseRequest,
  type HouseAdmin,
  type HouseRequest,
  type HouseRequestKind,
  type PayMethods,
} from "@/lib/houseRequests";
import { prepareImageForUpload, uploadErrorMessage, uploadToMini } from "@/lib/media";
import { supabase } from "@/lib/supabase";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { LinksEditor, cleanLinks, toEditableLinks, type EditableLink } from "@/components/LinksEditor";
import { useIdentity } from "@/components/IdentityProvider";
import { useMediaPicker, useSheetDismiss } from "@/lib/hooks";
import { formatMoney } from "@/lib/format";

/**
 * Add or edit a house request (migration 0195). The KIND is chosen first, as
 * three tiles, and the rest of the form adapts to it — an idea asks for almost
 * nothing (which is the point: the friction is why ideas never get written
 * down), a purchase request wants the link and the estimate, and a
 * reimbursement wants the real amount plus a receipt.
 *
 * In edit mode the kind is FIXED. Changing it would silently invalidate the
 * fields already filled for the old kind (an idea has no amount, a
 * reimbursement must have one), and a reviewer editing someone's ask should be
 * correcting the details, not reclassifying what they asked for.
 */
export function HouseRequestComposer({
  houseId,
  houseName,
  request,
  canTest = false,
  onClose,
  onSaved,
}: {
  houseId: string;
  houseName: string;
  /** Present = edit mode (creator while pending, or a reviewer any time). */
  request?: HouseRequest | null;
  /** Show the "only notify me" testing switch — reviewers only (0200). */
  canTest?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(request);
  const { userId } = useIdentity();
  const { closing, close } = useSheetDismiss(onClose);
  const media = useMediaPicker();

  const [kind, setKind] = useState<HouseRequestKind>(request?.kind ?? "purchase");
  const [title, setTitle] = useState(request?.title ?? "");
  const [reason, setReason] = useState(request?.reason ?? "");
  const [links, setLinks] = useState<EditableLink[]>(toEditableLinks(request?.links));
  // Money is a TEXT field, not <input type="number">: the spinners are useless
  // on a phone and a number input silently yields NaN for "40." mid-typing.
  const [cost, setCost] = useState(request?.estCost != null ? String(request.estCost) : "");
  const [quantity, setQuantity] = useState(request?.quantity != null ? String(request.quantity) : "");
  const [pay, setPay] = useState<PayMethods>({ methods: [], resolved: false });
  const [payLoaded, setPayLoaded] = useState(false);
  // ⚠️ WHO THIS WILL REACH, shown before the send. Read from the same predicate
  // the fan-out uses (profiles.house_admin for this house — see migration 0199),
  // so the preview cannot disagree with who actually gets contacted. A preview
  // built from a second source would be worse than none.
  const [recipients, setRecipients] = useState<HouseAdmin[] | null>(null);
  // "Just test it" (migration 0200) — a real request through the whole pipeline
  // that notifies only its author and stays off everyone else's board. Offered
  // only to people who'd actually be testing the review side.
  const [testOnly, setTestOnly] = useState(false);
  // A reviewer's "why I changed it" note + whether to email it. Only shown when
  // a House Admin is editing SOMEONE ELSE'S request — a member fixing their own
  // wording has nobody to explain it to.
  const [changeNote, setChangeNote] = useState("");
  const [notifyChange, setNotifyChange] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewerEditing = editing && !!request && !request.mine;

  // Only the reimbursement form needs this, so don't pay for the read until
  // that kind is actually selected.
  useEffect(() => {
    if (kind !== "reimbursement" || payLoaded) return;
    let alive = true;
    fetchPayMethods(userId).then((p) => {
      if (!alive) return;
      setPay(p);
      setPayLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [kind, payLoaded, userId]);

  // Resolve the audience as soon as the sheet opens — never at submit time,
  // since the whole point is seeing it BEFORE deciding to send.
  useEffect(() => {
    if (editing) return; // an edit notifies the requester, not the admins
    let alive = true;
    fetchHouseAdmins(houseId).then((a) => {
      if (alive) setRecipients(a);
    });
    return () => {
      alive = false;
    };
  }, [editing, houseId]);

  const parsedCost = (() => {
    const n = Number.parseFloat(cost.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  })();
  const parsedQty = (() => {
    const n = Number.parseInt(quantity, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  // A reimbursement without an amount can't be acted on — 0195 rejects it
  // server-side too, so this is the friendly version of the same rule.
  const needsAmount = kind === "reimbursement";
  const canSubmit = title.trim().length > 0 && !pending && (!needsAmount || (parsedCost ?? 0) > 0);

  const COPY: Record<HouseRequestKind, { titleLabel: string; titlePlaceholder: string; reasonLabel: string; reasonPlaceholder: string; costLabel: string }> = {
    idea: {
      titleLabel: "What's the idea?",
      titlePlaceholder: "European-style dressers for the bedrooms",
      reasonLabel: "Why would it be good?",
      reasonPlaceholder: "Mom loved these — they'd fit the upstairs rooms and give everyone real drawer space.",
      costLabel: "Rough cost, if you know it",
    },
    purchase: {
      titleLabel: "What should we get?",
      titlePlaceholder: "Soft-close bumpers for the kitchen cabinets",
      reasonLabel: "Why do we need it?",
      reasonPlaceholder: "Half the cabinet doors stick — these are a few dollars and fix it for good.",
      costLabel: "Estimated cost",
    },
    reimbursement: {
      titleLabel: "What did you buy?",
      titlePlaceholder: "Two gallons of deck stain",
      reasonLabel: "What was it for?",
      reasonPlaceholder: "Picked these up for the work weekend so we didn't lose the day to a hardware run.",
      costLabel: "How much was it?",
    },
  };
  const copy = COPY[kind];

  /** Upload the picked files and attach them. The request itself is already
   *  saved by the time this runs, so a failure here means "the request exists,
   *  this photo didn't attach" — reported by name, never a silent drop (the
   *  WorkItemComposer pattern). */
  const uploadPicked = async (requestId: string): Promise<{ name: string; reason: string }[]> => {
    if (!media.files.length || !supabase) return [];
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error("Not signed in.");
    const failed: { name: string; reason: string }[] = [];
    let position = request?.media.length ?? 0;
    for (const raw of media.files) {
      const isVideo = raw.type.startsWith("video");
      try {
        const f = isVideo ? raw : await prepareImageForUpload(raw);
        // Reuses the EXISTING "work" upload category, so this feature needed no
        // media-server change at all (see migration 0195's header).
        const uploaded = await uploadToMini(f, token, { category: "work" });
        const { error: mErr } = await addHouseRequestMedia(
          requestId,
          uploaded.url,
          isVideo ? "video" : "image",
          uploaded.thumbnailUrl,
          position,
        );
        if (mErr) throw new Error(mErr);
        position += 1;
      } catch (e) {
        failed.push({ name: raw.name || (isVideo ? "a video" : "a photo"), reason: uploadErrorMessage(e) });
      }
    }
    return failed;
  };

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);

    const payload = {
      title: title.trim(),
      reason: reason.trim(),
      links: cleanLinks(links) as EventLink[],
      estCost: parsedCost,
      quantity: kind === "purchase" ? parsedQty : null,
    };

    let id = request?.id ?? null;
    if (editing && id) {
      const { error: err } = await updateHouseRequest(id, {
        ...payload,
        ...(reviewerEditing ? { note: changeNote, notify: notifyChange } : {}),
      });
      if (err) {
        setPending(false);
        setError(err);
        return;
      }
    } else {
      const { id: newId, error: err } = await createHouseRequest({ houseId, kind, ...payload, testOnly });
      if (err || !newId) {
        setPending(false);
        setError(err ?? "Couldn't save that.");
        return;
      }
      id = newId;
    }

    let failed: { name: string; reason: string }[] = [];
    try {
      failed = await uploadPicked(id);
    } catch (e) {
      failed = media.files.map((f) => ({ name: f.name || "a photo", reason: uploadErrorMessage(e) }));
    }
    setPending(false);
    if (failed.length) {
      setError(
        `Saved, but ${failed.length === 1 ? "this didn't attach" : "these didn't attach"}: ${failed
          .map((f) => `${f.name} (${f.reason})`)
          .join(", ")}. You can add them from the request itself.`,
      );
      onSaved();
      return;
    }
    onSaved();
    close();
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="house-request-title"
      header={
        <div className="pr-10">
          <h2 id="house-request-title" className="text-lg font-bold">
            {editing ? "Edit this request" : `Add a request`}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {editing ? "Fix the details — everyone in the house sees this." : `Goes to ${houseName}'s House Admins.`}
          </p>
        </div>
      }
      footer={
        <div className="space-y-2">
          {/* Named, resolved, and directly above the button that sends it. */}
          {!editing && recipients !== null && (
            <p className="text-xs text-muted">
              {testOnly ? (
                <>
                  <span className="font-semibold text-primary">Goes to: just you.</span> Nobody else is notified and it
                  stays off {houseName}&rsquo;s board.
                </>
              ) : recipients.length === 0 ? (
                <>
                  <span className="font-semibold text-accent">Nobody will be notified.</span> {houseName} has no House
                  Admin yet, so this will sit on the board until one is named.
                </>
              ) : (
                <>
                  <span className="font-semibold">Goes to:</span>{" "}
                  {recipients.map((r) => r.name).join(", ")}{" "}
                  <span className="text-faint">
                    ({recipients.length === 1 ? "the only House Admin" : `${recipients.length} House Admins`} for{" "}
                    {houseName}
                    {recipients.some((r) => r.id === userId) ? ", including you" : ""})
                  </span>
                </>
              )}
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="press w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Sending…" : editing ? "Save changes" : "Send it"}
          </button>
        </div>
      }
    >
      {/* Kind first — the form below adapts to it. Fixed while editing. */}
      {!editing && (
        <div className="space-y-2">
          <SectionLabel>What is this?</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(KIND_META) as HouseRequestKind[]).map((k) => {
              const meta = KIND_META[k];
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={active}
                  className={`press flex flex-col items-center gap-1 rounded-2xl p-3 text-center ring-1 transition-colors ${
                    active ? "bg-primary/10 ring-primary" : "bg-card ring-border"
                  }`}
                >
                  <span aria-hidden className="text-2xl">
                    {meta.emoji}
                  </span>
                  <span className={`text-[11px] font-semibold leading-tight ${active ? "text-primary" : "text-muted"}`}>
                    {meta.label}
                  </span>
                </button>
              );
            })}
          </div>
          {kind === "idea" && (
            <p className="text-xs text-muted">
              No link or price needed — write it down now so it doesn&rsquo;t get lost.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <SectionLabel>{copy.titleLabel}</SectionLabel>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={copy.titlePlaceholder}
          className={`${FIELD} w-full`}
        />
      </div>

      <div className="space-y-1.5">
        <SectionLabel>{copy.reasonLabel}</SectionLabel>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder={copy.reasonPlaceholder}
          className={`${FIELD} w-full`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <SectionLabel>
            {copy.costLabel}
            {needsAmount ? " *" : ""}
          </SectionLabel>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>
              $
            </span>
            <input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              aria-label={copy.costLabel}
              className={`${FIELD} w-full pl-7`}
            />
          </div>
        </div>
        {kind === "purchase" && (
          <div className="space-y-1.5">
            <SectionLabel>How many?</SectionLabel>
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="numeric"
              placeholder="1"
              aria-label="How many"
              className={`${FIELD} w-full`}
            />
          </div>
        )}
      </div>

      {parsedCost !== null && parsedQty !== null && kind === "purchase" && parsedQty > 1 && (
        <p className="-mt-2 text-xs text-muted">
          {parsedQty} × {formatMoney(parsedCost)} — tell them the total in the box above if that&rsquo;s what you meant.
        </p>
      )}

      <div className="space-y-1.5">
        <SectionLabel>{kind === "reimbursement" ? "Link to what you bought (optional)" : "Link to it"}</SectionLabel>
        <LinksEditor links={links} onChange={setLinks} />
        {kind === "purchase" && links.length === 0 && (
          <p className="text-xs text-muted">Paste the Amazon / Home Depot link so nobody has to hunt for it.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <SectionLabel>{kind === "reimbursement" ? "Receipt" : "Photo"} (optional)</SectionLabel>
        {/* A plain, always-mounted input next to a plain button — never behind a
            popup/menu. See CLAUDE.md's installed-iOS-PWA file-picker incident. */}
        <input
          type="file"
          multiple
          onChange={media.add}
          className="block w-full text-xs text-muted file:mr-3 file:rounded-full file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary"
        />
        {media.previews.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {media.previews.map((p, i) => (
              <div key={p.url} className="relative">
                {p.type === "video" ? (
                  <video src={p.url} className="h-16 w-16 rounded-lg object-cover" muted />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- a local object-URL preview, never a remote asset
                  <img src={p.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => media.removeAt(i)}
                  aria-label="Remove"
                  className="press absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[10px] text-white"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Only speak up once we've actually looked (`resolved`) — a failed read
          must never be reported as "you haven't set anything up". */}
      {kind === "reimbursement" && payLoaded && pay.resolved && (
        <div className="rounded-xl bg-background p-3 text-xs ring-1 ring-border">
          {pay.methods.length > 0 ? (
            <>
              <p className="text-muted">
                Whoever pays this will see <span className="font-semibold">every</span> way you take money, and use
                whichever they have too:
              </p>
              <ul className="mt-1.5 space-y-1">
                {pay.methods.map((m) => (
                  <li key={m.key} className="flex items-baseline gap-1.5">
                    <span className="font-semibold">{m.label}</span>
                    <span className="min-w-0 truncate text-muted">{m.value}</span>
                    {m.preferred && <span className="shrink-0 text-[10px] text-faint">preferred</span>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              You haven&rsquo;t added a way to get paid, so nobody knows where to send it.{" "}
              <Link href="/profile" className="font-semibold text-primary underline">
                Add one in your profile
              </Link>{" "}
              — or say how in the box above.
            </>
          )}
        </div>
      )}

      {/* A reviewer changing someone else's ask owes them an explanation —
          silently rewriting a request and then approving "theirs" is the one
          move here that could feel like being overruled behind your back. */}
      {reviewerEditing && (
        <div className="space-y-2 rounded-xl bg-background p-3 ring-1 ring-border">
          <SectionLabel>Tell {request?.createdByName ?? "them"} what you changed</SectionLabel>
          <textarea
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            rows={2}
            placeholder="Optional — e.g. “Going with the 100-pack, works out cheaper.”"
            className={`${FIELD} w-full`}
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={notifyChange}
              onChange={(e) => setNotifyChange(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            Email them about this change
          </label>
          <p className="text-[11px] text-faint">
            They get a notification either way — the box only controls the email.
          </p>
        </div>
      )}

      {/* Testing switch — shown only to the people who'd be exercising the review
          side. A regular member has nothing to test and doesn't need the choice. */}
      {!editing && canTest && (
        <label className="flex items-start gap-2 rounded-xl bg-background p-3 ring-1 ring-border">
          <input
            type="checkbox"
            checked={testOnly}
            onChange={(e) => setTestOnly(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          />
          <span className="text-xs">
            <span className="font-semibold">Just test it — only notify me</span>
            <span className="mt-0.5 block text-muted">
              Runs the whole thing for real (notification, phone push, email) but sends all of it to you and nobody
              else. Stays hidden from the rest of {houseName}, and shows a TEST badge so you can tell it apart.
            </span>
          </span>
        </label>
      )}

      {error && <p className="text-xs text-accent">{error}</p>}

      {!editing && (
        <p className="pb-1 text-xs text-faint">
          Something <span className="font-semibold">broken</span> instead? Put it on the{" "}
          <Link href="/house" className="font-semibold text-primary underline">
            to-do list
          </Link>{" "}
          — that&rsquo;s the list of things that need doing.
        </p>
      )}
    </Sheet>
  );
}
