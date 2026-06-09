import type { Metadata } from "next";
import Link from "next/link";
import { HELP_CONTACT } from "@/lib/help";
import { InstallButton } from "@/components/InstallButton";
import { TextSizeControl } from "@/components/TextSizeControl";

export const metadata: Metadata = {
  title: "Help · Muskellunge Lake Resort",
  description: "How the MLR app works, sign-in help, and who to contact.",
};

/**
 * The Help / how-to page. Written for the least-technical family members, so it
 * leads with a real human to contact, keeps every answer short and concrete, and
 * avoids jargon. Linked from Profile and from the sign-in sheet.
 */
export default function HelpPage() {
  const { name, phone, email } = HELP_CONTACT;

  return (
    <div className="space-y-6 pt-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Help &amp; how-to</h1>
        <p className="text-sm text-foreground/65">
          New here, or stuck on something? Start below — and you can always just
          text {name}.
        </p>
      </header>

      {/* Escape hatch FIRST — a real person beats any feature for the least
          technical folks. */}
      <section className="space-y-3 rounded-2xl bg-primary/5 p-5 ring-1 ring-primary/15">
        <h2 className="text-base font-bold">Need a hand? Text {name}.</h2>
        <p className="text-sm text-foreground/70">
          If anything here doesn&rsquo;t work or doesn&rsquo;t make sense, send a
          quick text and {name} will help you out.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {phone ? (
            <>
              <a
                href={`sms:${phone}`}
                className="press flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white"
              >
                💬 Text {name}
              </a>
              <a
                href={`tel:${phone}`}
                className="press flex flex-1 items-center justify-center gap-2 rounded-xl bg-card py-3 text-sm font-semibold text-primary ring-1 ring-primary/20"
              >
                📞 Call {name}
              </a>
            </>
          ) : (
            <a
              href={`mailto:${email}?subject=${encodeURIComponent("MLR app — I need help")}`}
              className="press flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white"
            >
              ✉️ Email {name}
            </a>
          )}
        </div>
        {phone && (
          <a
            href={`mailto:${email}?subject=${encodeURIComponent("MLR app — I need help")}`}
            className="press block text-center text-xs text-foreground/55 underline-offset-2 hover:underline"
          >
            Prefer email? {email}
          </a>
        )}
      </section>

      <HelpItem emoji="🌲" title="What is this app?">
        It&rsquo;s the home base for Muskellunge Lake Resort — the schedule,
        photos, dining, Family Fest, who&rsquo;s coming to events, and resort
        announcements, all in one place. Anyone in the family can use it.
      </HelpItem>

      <HelpItem emoji="👀" title="Do I need an account?">
        No — you can <b>look around freely</b> without signing in. You only add
        your name and email when you want to <b>do</b> something: post a photo,
        RSVP to an event, or get alerts. There&rsquo;s <b>no password</b> to
        create or remember — we just email you a quick code to confirm
        it&rsquo;s you.
      </HelpItem>

      <HelpItem emoji="📨" title="I didn't get my sign-in code">
        <ul className="mt-1 list-disc space-y-1.5 pl-5">
          <li>
            Give it a minute, then <b>check your spam / junk folder</b> — that&rsquo;s
            where it hides most often.
          </li>
          <li>
            Still nothing? On the sign-in screen, tap <b>&ldquo;Resend code.&rdquo;</b>
          </li>
          <li>
            Make sure the email address you typed is correct — tap{" "}
            <b>&ldquo;Use a different email&rdquo;</b> to fix it.
          </li>
          <li>
            The code expires after a while. If it says expired, just resend a
            fresh one.
          </li>
          <li>
            Still stuck? <b>Text {name}</b> (top of this page).
          </li>
        </ul>
      </HelpItem>

      <HelpItem emoji="📲" title="Add the app to your home screen">
        Adding MLR to your home screen gives you a tap-to-open icon (no more
        hunting for the link), keeps you signed in, and lets event reminders and
        alerts reach you. Tap below and we&rsquo;ll walk you through it.
        <div className="mt-3">
          <InstallButton />
        </div>
      </HelpItem>

      <HelpItem emoji="🔠" title="Make the text bigger">
        Pick a size that&rsquo;s comfortable to read — it changes the whole app
        and is remembered on this device. (You can also pinch to zoom anywhere.)
        <div className="mt-3">
          <TextSizeControl />
        </div>
      </HelpItem>

      <p className="pt-2 text-center text-xs text-foreground/50">
        <Link href="/" className="underline-offset-2 hover:underline">
          ← Back to Home
        </Link>
      </p>
    </div>
  );
}

function HelpItem({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-2xl bg-card p-5 ring-1 ring-border">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <span aria-hidden className="text-lg">
          {emoji}
        </span>
        {title}
      </h2>
      <div className="text-sm leading-relaxed text-foreground/75">{children}</div>
    </section>
  );
}
