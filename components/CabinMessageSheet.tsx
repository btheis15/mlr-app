"use client";

import { useEffect, useState } from "react";
import { FIELD, SectionLabel, Sheet } from "@/components/Sheet";
import { useIdentity } from "@/components/IdentityProvider";
import { useSaveStatus, useSheetDismiss } from "@/lib/hooks";
import { fetchManageableCabins, sendCabinMessage } from "@/lib/cabins";

// Message the current + upcoming guests of a place you run (migration 0120).
// For the approver of a cabin/house (or an app admin) to reach exactly the
// people staying there — "water's off this weekend", "gate code is 1-2-3-4",
// etc. Opens from AdminCabinBookings (which both admins and non-admin approvers
// see). Recipients are resolved server-side (approved bookings not yet ended);
// this just collects which place + the note.

export function CabinMessageSheet({ onClose }: { onClose: () => void }) {
  const { userId, isAdmin } = useIdentity();
  const { closing, close } = useSheetDismiss(onClose);
  const [cabins, setCabins] = useState<{ id: string; name: string }[]>([]);
  const [cabinId, setCabinId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);
  const { pending, status, run } = useSaveStatus();

  useEffect(() => {
    let cancelled = false;
    fetchManageableCabins(userId ?? "", isAdmin).then((list) => {
      if (cancelled) return;
      setCabins(list);
      if (list.length === 1) setCabinId(list[0].id);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, isAdmin]);

  const submit = () =>
    run(async () => {
      if (!cabinId) return "Pick which place this is about.";
      if (!body.trim()) return "Write a message first.";
      const res = await sendCabinMessage(cabinId, {
        subject: subject.trim() || null,
        body: body.trim(),
        email,
      });
      if (res.error) return res.error;
      setSentCount(res.count ?? 0);
      return null;
    });

  const cabinName = cabins.find((c) => c.id === cabinId)?.name ?? "this place";

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="cabin-message-title"
      header={
        <div className="pr-10">
          <h2 id="cabin-message-title" className="text-lg font-bold">
            📣 Message guests
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Reaches everyone with a current or upcoming approved stay
          </p>
        </div>
      }
      footer={
        sentCount === null ? (
          <div className="space-y-2">
            {status && <p className="text-sm font-medium text-red-600">{status}</p>}
            <button
              onClick={submit}
              disabled={pending}
              className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send message"}
            </button>
          </div>
        ) : (
          <button
            onClick={close}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white"
          >
            Done
          </button>
        )
      }
    >
      {sentCount !== null ? (
        <div className="space-y-2 rounded-2xl bg-primary/10 p-5 text-center ring-1 ring-primary/20">
          <div className="text-3xl" aria-hidden>
            ✅
          </div>
          <p className="text-sm font-semibold text-primary">
            {sentCount === 0
              ? "Message saved — no one has an upcoming stay there right now."
              : `Sent to ${sentCount} ${sentCount === 1 ? "guest" : "guests"} staying at ${cabinName}.`}
          </p>
        </div>
      ) : (
        <>
          {cabins.length !== 1 && (
            <div className="space-y-1.5">
              <SectionLabel>Which place?</SectionLabel>
              <select
                value={cabinId}
                onChange={(e) => setCabinId(e.target.value)}
                className={`${FIELD} w-full`}
              >
                <option value="">Choose a place…</option>
                {cabins.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {cabins.length === 0 && (
                <p className="px-0.5 text-xs text-muted">You don’t manage any places to stay.</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <SectionLabel>Subject (optional)</SectionLabel>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Water is off this weekend"
              maxLength={120}
              className={`${FIELD} w-full`}
            />
          </div>

          <div className="space-y-1.5">
            <SectionLabel>Message</SectionLabel>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Let everyone staying there know what's going on…"
              rows={4}
              maxLength={2000}
              className={`${FIELD} w-full resize-none`}
            />
          </div>

          <label className="flex items-start gap-2.5 rounded-xl bg-background p-3 ring-1 ring-border">
            <input
              type="checkbox"
              checked={email}
              onChange={(e) => setEmail(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">📧 Also email them</span>
              <span className="block text-xs text-muted">
                For something important. Only reaches guests who have email alerts on.
              </span>
            </span>
          </label>
        </>
      )}
    </Sheet>
  );
}
