import { Protected } from "@/components/Guard";

/**
 * Compact contact icons (✉️ / 📞 / 💬) for a committee member, gated behind
 * sign-in. Self-hides entirely when there's no email/phone on file yet (most
 * people, until they link an account), so the roster stays clean.
 */
export function CommitteeMemberContact({ email, phone }: { email?: string; phone?: string }) {
  if (!email && !phone) return null;
  // Ghost icons, not filled pills. A roster of 7 people rendered 28 filled
  // 44px circles, which read as the loudest thing on the committee page — the
  // NAMES are the content, contact is secondary. Still a 44px tap target
  // (min-h/w-11), just without the background.
  const cls = "press inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-xs opacity-45";
  return (
    <Protected label="Sign in to contact">
      <div className="flex items-center -space-x-1.5">
        {email && (
          <a href={`mailto:${email}`} aria-label="Email" className={cls}>
            ✉️
          </a>
        )}
        {phone && (
          <a href={`tel:${phone}`} aria-label="Call" className={cls}>
            📞
          </a>
        )}
        {phone && (
          <a href={`sms:${phone}`} aria-label="Text" className={cls}>
            💬
          </a>
        )}
      </div>
    </Protected>
  );
}
