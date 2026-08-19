"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { EventLink } from "@/lib/types";
import {
  KIND_META,
  KIND_ORDER,
  addHouseRequestMedia,
  createHouseRequest,
  fetchHouseAdmins,
  fetchPayMethods,
  hasMoney,
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
import { formatMoney, plural } from "@/lib/format";

/**
 * Per-kind wording for the links block. The shared LinksEditor defaults to EVENT
 * copy ("Button text, e.g. Sign up sheet"), which reads as nonsense when you're
 * pasting an Amazon link for a vacuum — that mismatch is what made it unclear
 * which box was which.
 */
const LINK_COPY: Record<HouseRequestKind, { heading: string; hint: string; urlPlaceholder: string; labelPlaceholder: string }> = {
  purchase: {
    heading: "Where a House Admin should buy it",
    // Names the reader of this field. The link isn't decoration on a purchase
    // request — it's the instruction for whoever places the order.
    hint: "Paste the link to the exact thing you mean. Whoever orders it shouldn't have to go hunting for the right one.",
    urlPlaceholder: "amazon.com/…",
    labelPlaceholder: "e.g. Amazon — 100 pack",
  },
  idea: {
    heading: "Link to an example (optional)",
    hint: "Only if you have one — a photo, a listing, anything that shows what you're picturing.",
    urlPlaceholder: "amazon.com/… (optional)",
    labelPlaceholder: "e.g. Something like these",
  },
  reimbursement: {
    heading: "Link to what you bought (optional)",
    hint: "Handy if the receipt photo isn't clear about what it was.",
    urlPlaceholder: "homedepot.com/… (optional)",
    labelPlaceholder: "e.g. Home Depot — deck stain",
  },
};

/**
 * Add or edit a house request (migration 0195).
 *
 * ⚠️⚠️ **PICKING THE KIND IS ITS OWN STEP, AND THERE IS NO DEFAULT.** The form
 * does not exist until you've chosen. This is the structural half of the fix
 * described on `KIND_META`: the composer used to open with **Purchase Request
 * pre-selected**, so it was entirely possible — easy, even — to fill the whole
 * thing in and send it having never read the three tiles or made a choice at
 * all. That is exactly what happened, and the House Admins on the other end got
 * "New purchase request" for something they assumed the sender was buying
 * himself. A default here isn't a convenience, it's a decision made on the
 * member's behalf about who spends whose money.
 *
 * Step 1 is three full-width rows, each stating the deal and who does what. Step
 * 2 is the form, headed by a **banner that keeps that deal on screen** while you
 * fill it in, with a Change link back. The form then adapts: an idea asks for
 * almost nothing and has **no cost field at all** (the friction is precisely why
 * ideas never get written down), a purchase wants the link + estimate, and a
 * reimbursement wants the real total plus a receipt.
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
  prefill,
  canTest = false,
  onClose,
  onSaved,
}: {
  houseId: string;
  houseName: string;
  /** Present = edit mode (creator while pending, or a reviewer any time). */
  request?: HouseRequest | null;
  /**
   * A brand-NEW request seeded from an existing one — today, "the house agreed to
   * this idea, now actually buy it" (see `HouseRequestSheet`). Distinct from
   * `request`, which EDITS a row: this creates a separate one, and the idea stays
   * on the board as the record of the conversation.
   *
   * ⚠️ Seeding a kind here is the one legitimate exception to "no default kind" —
   * the choice was made deliberately by the person tapping "Turn this into a
   * purchase request", not by the form on their behalf. It's still changeable.
   */
  prefill?: { kind: HouseRequestKind; title: string; reason: string; links?: EventLink[] } | null;
  /** Show the "only notify me" testing switch — reviewers only (0200). */
  canTest?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(request);
  const { userId } = useIdentity();
  const { closing, close } = useSheetDismiss(onClose);
  const media = useMediaPicker();

  // ⚠️ null = "hasn't chosen yet", and there is NO default (see the docblock).
  // Editing pins it to what was actually asked for.
  const [kind, setKind] = useState<HouseRequestKind | null>(request?.kind ?? prefill?.kind ?? null);
  const [title, setTitle] = useState(request?.title ?? prefill?.title ?? "");
  const [reason, setReason] = useState(request?.reason ?? prefill?.reason ?? "");
  const [links, setLinks] = useState<EditableLink[]>(toEditableLinks(request?.links ?? prefill?.links));
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
  // ⚠️ The picker is a plain always-mounted <input> with a plain always-mounted
  // sibling button that .click()s it — the PostsView shape. Do NOT move either
  // behind a popup/menu/sheet: in an installed iOS PWA the file never arrives and
  // there is NO error, which read as "sending photos just doesn't work" for as
  // long as chat's old "+" menu existed (see CLAUDE.md's incident writeup).
  const fileRef = useRef<HTMLInputElement>(null);

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
  // server-side too, so this is the friendly version of the same rule. It's the
  // TOTAL across everything on the receipt, not a per-item price.
  const needsAmount = kind === "reimbursement";
  const canSubmit = title.trim().length > 0 && !pending && (!needsAmount || (parsedCost ?? 0) > 0);

  // ── Step 1: what IS this? ──────────────────────────────────────────────────
  // No form, no footer, no send button — there is nothing to submit until the
  // deal has been chosen. Same <Sheet> element in the same tree position as the
  // form below, so picking a kind swaps the contents without re-animating.
  if (kind === null) {
    return (
      <Sheet
        closing={closing}
        onDismiss={close}
        labelledBy="house-request-title"
        header={
          <div className="pr-10">
            <h2 id="house-request-title" className="text-lg font-bold">
              What do you need?
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Three different things — pick the one that matches, and {houseName}&rsquo;s House Admins will know what
              you&rsquo;re asking them to do.
            </p>
          </div>
        }
      >
        <div className="space-y-2.5">
          {KIND_ORDER.map((k) => {
            const meta = KIND_META[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`press flex w-full items-start gap-3 rounded-2xl border-l-4 bg-card p-4 text-left ring-1 ring-border transition-shadow hover:shadow-sm ${meta.edge}`}
              >
                <span
                  aria-hidden
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl ${meta.tile}`}
                >
                  {meta.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-bold">{meta.ask}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.chip}`}>
                      {meta.money}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted">{meta.deal}</span>
                  {/* Who does what, spelled out on the tile itself — this is the
                      part that was missing everywhere. */}
                  <span className="mt-2 block space-y-0.5 text-[11px] text-faint">
                    <span className="block">
                      <span className="font-semibold text-foreground/70">You:</span> {meta.youDo}
                    </span>
                    <span className="block">
                      <span className="font-semibold text-foreground/70">House Admin:</span> {meta.adminDoes}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="pb-1 text-xs text-faint">
          Something <span className="font-semibold">broken</span>, or a job that needs doing? None of these — put it on
          the{" "}
          <Link href="/house" className="font-semibold text-primary underline">
            to-do list
          </Link>
          .
        </p>
      </Sheet>
    );
  }

  // ⚠️ No `costLabel` for an idea — there is no cost FIELD on an idea (see
  // `hasMoney`), so carrying a label for one would be dead config that invites
  // somebody to render it again.
  const COPY: Record<HouseRequestKind, { titleLabel: string; titlePlaceholder: string; reasonLabel: string; reasonPlaceholder: string }> = {
    idea: {
      titleLabel: "What's the idea?",
      titlePlaceholder: "Clear the small trees behind the house so we can see the lake",
      reasonLabel: "Why would it be good?",
      reasonPlaceholder: "You can barely see the water from the deck anymore — thinning it out would open the whole view back up.",
    },
    purchase: {
      titleLabel: "What should the house buy?",
      titlePlaceholder: "Soft-close bumpers for the kitchen cabinets",
      reasonLabel: "Why do we need it?",
      reasonPlaceholder: "Half the cabinet doors stick — these are a few dollars and fix it for good.",
    },
    reimbursement: {
      titleLabel: "What did you buy?",
      // Hints that several items on one receipt are fine — the common case is a
      // whole hardware run, not a single purchase.
      titlePlaceholder: "Deck stain, brushes and a drop cloth",
      reasonLabel: "What was it for?",
      reasonPlaceholder: "Picked these up for the work weekend so we didn't lose the day to a hardware run.",
    },
  };
  const copy = COPY[kind];
  const meta = KIND_META[kind];
  // "How much was it?" reads as one item; a reimbursement is usually a whole
  // receipt, so ask for the total outright.
  const costLabel = kind === "reimbursement" ? "What's the total?" : "Estimated cost";

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
      // ⚠️ Discard any amount typed before switching TO an idea — the field is
      // gone from the form, so leaving the state in the payload would persist a
      // cost the sender can no longer see or correct.
      estCost: hasMoney(kind) ? parsedCost : null,
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
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg ${meta.tile}`}
            >
              {meta.emoji}
            </span>
            <div className="min-w-0">
              <h2 id="house-request-title" className="text-lg font-bold leading-tight">
                {editing ? "Edit this request" : meta.ask}
              </h2>
              {/* ⚠️ The deal rides the FIXED (non-scrolling) header, so "who buys
                  this" stays on screen the entire time the form is being filled
                  in — not just for the moment it took to tap a tile. */}
              <p className="mt-0.5 text-xs text-muted">{meta.deal}</p>
            </div>
          </div>
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
            {/* The verb states the ask one last time, on the button that does it —
                "Send it" says nothing about what you're asking anyone to do. */}
            {pending
              ? "Sending…"
              : editing
                ? "Save changes"
                : kind === "idea"
                  ? "Write it down"
                  : kind === "purchase"
                    ? "Ask them to order it"
                    : "Ask to be paid back"}
          </button>
        </div>
      }
    >
      {/* What was chosen, and a way back out. The kind is FIXED while editing. */}
      {!editing && (
        <div className="flex items-center gap-2 rounded-xl bg-background p-2.5 ring-1 ring-border">
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.chip}`}>
            {meta.money}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted">{meta.label}</span>
          <button
            type="button"
            onClick={() => setKind(null)}
            className="press shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-primary underline"
          >
            Change
          </button>
        </div>
      )}

      {/* ⚠️ The one thing a requester most needs told, stated in full and not as a
          caption: on a purchase they are NOT the one shopping. Each kind also
          offers the one-tap switch to its natural neighbour, since "I'll just buy
          it myself" and "the house should buy it" is the exact confusion here. */}
      {!editing && kind === "purchase" && (
        <p className="rounded-xl bg-lake/10 p-3 text-xs leading-relaxed text-foreground/80">
          🛒 <span className="font-semibold">You&rsquo;re not the one buying this.</span> You&rsquo;re asking the House
          Admins to order it with House Trust money. Nothing is expected of you after you send it.{" "}
          <button type="button" onClick={() => setKind("reimbursement")} className="font-semibold text-primary underline">
            Already bought it yourself?
          </button>
        </p>
      )}
      {!editing && kind === "reimbursement" && (
        <p className="rounded-xl bg-accent/10 p-3 text-xs leading-relaxed text-foreground/80">
          🧾 <span className="font-semibold">This is for money you&rsquo;ve already spent.</span> A House Admin approves
          it and sends your money back.{" "}
          <button type="button" onClick={() => setKind("purchase")} className="font-semibold text-primary underline">
            Haven&rsquo;t bought it yet?
          </button>
        </p>
      )}
      {!editing && kind === "idea" && (
        <p className="rounded-xl bg-sun/10 p-3 text-xs leading-relaxed text-foreground/80">
          💡 <span className="font-semibold">No price, no link, nothing to buy.</span> Just get it written down so it
          doesn&rsquo;t die in conversation.{" "}
          <button type="button" onClick={() => setKind("purchase")} className="font-semibold text-primary underline">
            Know exactly what to buy?
          </button>
        </p>
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

      {/* ⚠️ AN IDEA HAS NO MONEY FIELDS AT ALL. Not an optional one, not a "rough
          cost if you know it" — none. A price box turns "wouldn't it be nice if"
          into a proposal somebody has to weigh, which is the friction that keeps
          ideas out of the app in the first place. If a real number is known, that
          ask is a purchase request. */}
      {hasMoney(kind) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <SectionLabel>
              {costLabel}
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
                aria-label={costLabel}
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
      )}

      {parsedCost !== null && parsedQty !== null && kind === "purchase" && parsedQty > 1 && (
        <p className="-mt-2 text-xs text-muted">
          {parsedQty} × {formatMoney(parsedCost)} — tell them the total in the box above if that&rsquo;s what you meant.
        </p>
      )}

      {/* Two bare stacked inputs read as "which box do I put what in?" — so each
          field is captioned, the placeholders describe the actual thing being
          asked for, and the hint says what happens if the name is left blank. */}
      <div className="space-y-1.5">
        <SectionLabel>{LINK_COPY[kind].heading}</SectionLabel>
        <p className="text-xs text-muted">{LINK_COPY[kind].hint}</p>
        <LinksEditor
          links={links}
          onChange={setLinks}
          showFieldLabels
          urlPlaceholder={LINK_COPY[kind].urlPlaceholder}
          labelPlaceholder={LINK_COPY[kind].labelPlaceholder}
          addLabel={links.length === 0 ? "+ Add a link" : "+ Add another link"}
        />
        {links.some((l) => l.href.trim()) && (
          <p className="text-xs text-faint">
            Leave the name blank and it&rsquo;ll just show the website, like &ldquo;Open on amazon.com&rdquo;.
          </p>
        )}
      </div>

      {/* Multiple files were always supported by the input; nothing SAID so, and
          the singular label implied one. A reimbursement gets a firmer nudge —
          the receipt is the evidence whoever pays out is checking. */}
      <div className="space-y-1.5">
        <SectionLabel>
          {kind === "reimbursement" ? "Receipt photos" : "Photos (optional)"}
        </SectionLabel>
        <p className="text-xs text-muted">
          {kind === "reimbursement"
            ? "Take a photo of the receipt, or upload one you already have — it's how whoever pays you back checks the total. Add as many as you need (a long receipt often takes two)."
            : kind === "purchase"
              ? "A photo of the problem helps — e.g. the cabinet door that sticks. You can add more than one."
              : "A photo of what you're picturing, if you have one. You can add more than one."}
        </p>
        {/* "Choose Files" is browser-supplied text that can't be changed, so the
            real button is ours and the input is hidden beside it. On a phone this
            opens the native sheet — Take Photo, Photo Library, or a file — which
            is why the label says both. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="press rounded-full bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"
          >
            {media.previews.length > 0
              ? "📷 Add another"
              : kind === "reimbursement"
                ? "📷 Take a photo or upload"
                : "📷 Add a photo"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={media.add}
            className="hidden"
          />
        </div>
        {/* A reimbursement with no receipt attached isn't blocked — sometimes
            there genuinely isn't one — but it shouldn't sail through silently
            either, since it's the first thing the approver will look for. */}
        {kind === "reimbursement" && media.previews.length === 0 && (
          <p className="rounded-xl bg-sun/12 p-2.5 text-xs text-foreground/80">
            📸 No receipt attached yet. You can still send it, but a photo saves whoever&rsquo;s paying you from having
            to ask.
          </p>
        )}
        {media.previews.length > 0 && (
          <p className="text-xs font-semibold text-primary">
            {media.previews.length} {plural(media.previews.length, "photo")} ready
          </p>
        )}
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
