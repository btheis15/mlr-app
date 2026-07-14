"use client";

import type { HomeCallout } from "@/lib/festContent";
import { formatDate, formatPhoneNational } from "@/lib/format";

/**
 * One admin-managed Home call-out card (a `home_callouts` row / the in-code
 * seed) — the swipeable face that stacks above the permanent Family Fest
 * spotlight in HomeSpotlight, and the live preview inside the callout editor
 * (Admin → Alerts & Notifications). Every part is optional: an image flyer
 * can stand alone, or a title/body can run without art. A call-out can carry
 * more than one action link (migration 0093) — each renders on its own line
 * so two links read as distinctly separate actions, not run together. Any
 * tel:/mailto:/https href works; a tel: link also shows the number, mirroring
 * the old hard-coded "Call Tricia" t-shirt card this replaced.
 *
 * `onMarkDone` (omitted in the admin editor's live preview) renders a small
 * "I did this" action that hides the card **permanently** for the viewer —
 * migration 0098, distinct from CalloutStack's swipe/✕, which only dismisses
 * it for the current session.
 */
export function CalloutCard({
  callout,
  onMarkDone,
  marking,
}: {
  callout: HomeCallout;
  onMarkDone?: () => void;
  marking?: boolean;
}) {
  const { title, body, imageUrl, links, endsOn } = callout;
  const hasText = Boolean(title?.trim() || body?.trim() || links.length > 0 || endsOn);

  return (
    <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border shadow-sm">
      {imageUrl && (
        // Plain <img>, not next/image: these come from the site-assets bucket
        // (arbitrary Supabase URLs, unknown dimensions) — same as MediaGrid /
        // PostsView / the callout editor's ImageRow render mini-hosted images.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={title?.trim() || "Announcement"} className="w-full" />
      )}
      {hasText && (
        <div className={`px-3.5 pb-3.5 ${imageUrl ? "pt-3" : "pt-3.5"}`}>
          {title?.trim() && <p className="text-sm font-bold">{title}</p>}
          {body?.trim() && (
            <p className={`whitespace-pre-wrap text-sm text-foreground/70 ${title?.trim() ? "mt-1" : ""}`}>
              {body}
            </p>
          )}
          {links.length > 0 && (
            <div className={`space-y-2 ${title?.trim() || body?.trim() ? "mt-2.5" : ""}`}>
              {links.map((l, i) => {
                const href = l.href.trim();
                if (!href) return null;
                const tel = href.startsWith("tel:") ? href.slice(4) : null;
                const external = /^https?:/i.test(href);
                return (
                  <a
                    key={i}
                    href={href}
                    data-callout-no-drag
                    {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="press flex items-center justify-between rounded-xl bg-primary/10 px-3.5 py-2.5 text-sm font-semibold text-primary ring-1 ring-primary/20"
                  >
                    <span>{l.label?.trim() || (tel ? "📞 Call" : external ? "Open link" : "✉️ Email")}</span>
                    {tel && <span className="font-normal text-primary/70">{formatPhoneNational(tel)}</span>}
                  </a>
                );
              })}
            </div>
          )}
          {endsOn && (
            <p className="mt-2 text-center text-[11px] text-foreground/45">
              Due {formatDate(`${endsOn}T00:00:00`)}
            </p>
          )}
        </div>
      )}
      {onMarkDone && (
        <div className={`px-3.5 pb-3.5 ${hasText ? "pt-0" : imageUrl ? "pt-3" : "pt-3.5"}`}>
          <button
            type="button"
            data-callout-no-drag
            onClick={onMarkDone}
            disabled={marking}
            className="press w-full rounded-xl bg-background py-2 text-xs font-semibold text-primary ring-1 ring-primary/25 disabled:opacity-60"
          >
            {marking ? "Marking done…" : "✓ I did this — don't show again"}
          </button>
        </div>
      )}
    </div>
  );
}
