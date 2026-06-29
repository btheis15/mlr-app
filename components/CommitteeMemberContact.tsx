import { Protected } from "@/components/Guard";

/**
 * Compact contact icons (✉️ / 📞 / 💬) for a committee member, gated behind
 * sign-in. Self-hides entirely when there's no email/phone on file yet (most
 * people, until they link an account), so the roster stays clean.
 */
export function CommitteeMemberContact({ email, phone }: { email?: string; phone?: string }) {
  if (!email && !phone) return null;
  const cls = "press inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs";
  return (
    <Protected label="Sign in to contact">
      <div className="flex items-center gap-1.5">
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
          <a href={`sms:${phone}`} aria-label="Text" className={`${cls} bg-accent/10`}>
            💬
          </a>
        )}
      </div>
    </Protected>
  );
}
