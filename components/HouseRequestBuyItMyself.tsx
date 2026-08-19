"use client";

import { useRef, useState } from "react";
import type { EventLink } from "@/lib/types";
import {
  KIND_META,
  OVERSPEND_GRACE,
  addHouseRequestMedia,
  conversionNeedsReapproval,
  convertToReimbursement,
  type HouseRequest,
} from "@/lib/houseRequests";
import { prepareImageForUpload, uploadErrorMessage, uploadToMini } from "@/lib/media";
import { supabase } from "@/lib/supabase";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { LinksEditor, cleanLinks, toEditableLinks, type EditableLink } from "@/components/LinksEditor";
import { useMediaPicker, useSheetDismiss } from "@/lib/hooks";
import { formatMoney, plural } from "@/lib/format";

/**
 * "They said just grab it and they'd pay me back."
 *
 * The smallest possible form for turning a purchase request you already wrote
 * into a reimbursement: **what it came to, and the receipt.** Everything else —
 * title, reason, links, photos, the discussion, the approval already on it — is
 * kept, because re-typing all of it is exactly the friction that made people
 * abandon the original request and leave the board stale instead.
 *
 * ⚠️ Only ever opened for the REQUESTER (see `convertToReimbursement` — the
 * payout follows `createdBy`, so the person who paid has to be the one to say
 * so). The server enforces it too.
 *
 * ⚠️ It says what will happen to the approval BEFORE you send. Quietly bouncing
 * an already-approved request back to "waiting on a House Admin" because the
 * receipt was a few dollars over would feel like being second-guessed; quietly
 * auto-approving any number at all would make the approval meaningless. So the
 * rule ($25 of grace) is stated on screen, live, as the amount is typed.
 */
export function HouseRequestBuyItMyself({
  request,
  onClose,
  onDone,
}: {
  request: HouseRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const media = useMediaPicker();
  const fileRef = useRef<HTMLInputElement>(null);

  // Pre-filled with the estimate: most of the time the receipt matches what was
  // asked for, and typing it again is pure friction.
  const [cost, setCost] = useState(request.estCost != null ? String(request.estCost) : "");
  const [note, setNote] = useState("");
  // ⚠️ Editable, because "I bought a different one" is a normal outcome — a
  // better price, or the linked product was out of stock. Leaving the row
  // pointing at something nobody bought makes the receipt impossible to check.
  const [changedProduct, setChangedProduct] = useState(false);
  const [title, setTitle] = useState(request.title);
  const [links, setLinks] = useState<EditableLink[]>(toEditableLinks(request.links));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedCost = (() => {
    const n = Number.parseFloat(cost.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const canSubmit = parsedCost !== null && !pending;
  const needsReapproval = parsedCost !== null && conversionNeedsReapproval(request, parsedCost);

  const submit = async () => {
    if (!canSubmit || parsedCost === null) return;
    setPending(true);
    setError(null);

    const { error: err } = await convertToReimbursement(request.id, parsedCost, {
      note,
      ...(changedProduct
        ? { title: title.trim(), links: cleanLinks(links) as EventLink[] }
        : {}),
    });
    if (err) {
      setPending(false);
      setError(err);
      return;
    }

    // The conversion has already landed, so a failed photo means "converted, but
    // this receipt didn't attach" — reported by name, never silently dropped
    // (the WorkItemComposer / HouseRequestComposer pattern).
    const failed: string[] = [];
    if (media.files.length && supabase) {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        if (!token) throw new Error("Not signed in.");
        let position = request.media.length;
        for (const raw of media.files) {
          const isVideo = raw.type.startsWith("video");
          try {
            const f = isVideo ? raw : await prepareImageForUpload(raw);
            const uploaded = await uploadToMini(f, token, { category: "work" });
            const { error: mErr } = await addHouseRequestMedia(
              request.id,
              uploaded.url,
              isVideo ? "video" : "image",
              uploaded.thumbnailUrl,
              position,
            );
            if (mErr) throw new Error(mErr);
            position += 1;
          } catch (e) {
            failed.push(`${raw.name || "a photo"} (${uploadErrorMessage(e)})`);
          }
        }
      } catch (e) {
        failed.push(uploadErrorMessage(e));
      }
    }

    setPending(false);
    onDone();
    if (failed.length) {
      setError(`Done — but the receipt didn't attach: ${failed.join(", ")}. You can add it from the request.`);
      return;
    }
    close();
  };

  const meta = KIND_META.reimbursement;

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="buy-it-myself-title"
      header={
        <div className="pr-10">
          <h2 id="buy-it-myself-title" className="text-lg font-bold leading-tight">
            🧾 I bought it myself
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            This turns your purchase request into a reimbursement. Everything you already wrote stays — just add what it
            came to.
          </p>
        </div>
      }
      footer={
        <div className="space-y-2">
          {/* What happens to the approval, stated before the send. */}
          {parsedCost !== null && (
            <p className="text-xs text-muted">
              {needsReapproval ? (
                <>
                  <span className="font-semibold text-accent">Goes back for a quick OK.</span>{" "}
                  {request.status === "approved"
                    ? `That's more than ${formatMoney(OVERSPEND_GRACE)} over the ${formatMoney(request.estCost)} that was approved.`
                    : "This hadn't been approved yet, so a House Admin still needs to say yes."}
                </>
              ) : (
                <>
                  <span className="font-semibold text-primary">Already approved.</span> It just needs paying — a House
                  Admin will send you {formatMoney(parsedCost)}.
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
            {pending ? "Saving…" : "Ask to be paid back"}
          </button>
        </div>
      }
    >
      {/* What's being converted, so there's no doubt which request this is. */}
      <div className={`flex items-center gap-2 rounded-xl border-l-4 bg-card p-3 ring-1 ring-border ${meta.edge}`}>
        <span aria-hidden className="text-lg">
          🛒
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{request.title}</span>
          <span className="block text-xs text-muted">
            {request.estCost != null ? `${formatMoney(request.estCost)} estimated` : "No estimate"} ·{" "}
            {request.status === "approved" ? "approved" : "waiting on a decision"}
          </span>
        </span>
      </div>

      <div className="space-y-1.5">
        <SectionLabel>What did it come to? *</SectionLabel>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>
            $
          </span>
          <input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            aria-label="What did it come to?"
            className={`${FIELD} w-full pl-7`}
          />
        </div>
        <p className="text-xs text-faint">The total you actually paid, including tax and shipping.</p>
      </div>

      <div className="space-y-1.5">
        <SectionLabel>Receipt</SectionLabel>
        <p className="text-xs text-muted">
          A photo of the receipt is how whoever pays you back checks the total. Add as many as you need.
        </p>
        {/* Plain always-mounted input + plain sibling button — never behind a
            menu or popup (the installed-iOS-PWA file-drop incident). */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="press rounded-full bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"
          >
            {media.previews.length > 0 ? "📷 Add another" : "📷 Take a photo or upload"}
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/*" multiple onChange={media.add} className="hidden" />
        </div>
        {media.previews.length === 0 && (
          <p className="rounded-xl bg-sun/12 p-2.5 text-xs text-foreground/80">
            📸 No receipt yet. You can still send it, but a photo saves whoever&rsquo;s paying you from having to ask.
          </p>
        )}
        {media.previews.length > 0 && (
          <>
            <p className="text-xs font-semibold text-primary">
              {media.previews.length} {plural(media.previews.length, "photo")} ready
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {media.previews.map((p, i) => (
                <div key={p.url} className="relative">
                  {p.type === "video" ? (
                    <video src={p.url} className="h-16 w-16 rounded-lg object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- a local object-URL preview
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
          </>
        )}
      </div>

      {/* Collapsed by default — the common case is "I bought the linked thing",
          and showing a title + links editor every time would rebuild the very
          form this flow exists to avoid. */}
      {!changedProduct ? (
        <button
          type="button"
          onClick={() => setChangedProduct(true)}
          className="press text-left text-xs font-semibold text-primary underline"
        >
          Bought something different? Update the name or link →
        </button>
      ) : (
        <div className="space-y-3 rounded-xl bg-background p-3 ring-1 ring-border">
          <div className="space-y-1.5">
            <SectionLabel>What you actually bought</SectionLabel>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${FIELD} w-full`} />
          </div>
          <div className="space-y-1.5">
            <SectionLabel>Link to it</SectionLabel>
            <p className="text-xs text-muted">
              Swap the link if you bought a different one — otherwise the receipt points at something nobody bought.
            </p>
            <LinksEditor
              links={links}
              onChange={setLinks}
              showFieldLabels
              urlPlaceholder="amazon.com/…"
              labelPlaceholder="e.g. Home Depot — 100 pack"
              addLabel={links.length === 0 ? "+ Add a link" : "+ Add another link"}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <SectionLabel>Anything to add? (optional)</SectionLabel>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. “Beth said to grab it — the 100-pack was cheaper.”"
          className={`${FIELD} w-full`}
        />
      </div>

      {error && <p className="text-xs text-accent">{error}</p>}
    </Sheet>
  );
}
