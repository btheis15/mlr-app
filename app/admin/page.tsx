import Link from "next/link";
import { AdminGuard } from "@/app/admin/AdminGuard";

/**
 * Admin dashboard — the front door for everything that used to be buried in
 * Profile → Admin tools as ~9 stacked, nested accordions. Each card is a
 * one-tap link to its own /admin/* sub-page (which mounts the same components
 * that used to live in the accordion, just without the nesting). See
 * CLAUDE.md "Identity, admins & alerts" for the underlying data model.
 */

const CARDS: {
  href: string;
  emoji: string;
  tile: string;
  title: string;
  sub: string;
}[] = [
  { href: "/admin/members", emoji: "🧑‍🤝‍🧑", tile: "bg-lake/12", title: "Members", sub: "Directory · promote admins · edit a member's info" },
  { href: "/admin/alerts", emoji: "📣", tile: "bg-campfire/12", title: "Alerts & Notifications", sub: "Banner alerts + Activity notifications" },
  { href: "/admin/content-review", emoji: "🛡️", tile: "bg-dusk/12", title: "Content review", sub: "Held & reported posts · blocked words" },
  { href: "/admin/committees", emoji: "👥", tile: "bg-sun/12", title: "Committees & join requests", sub: "Who's in each + pending requests" },
  { href: "/admin/houses", emoji: "🏠", tile: "bg-primary/12", title: "Houses", sub: "Create houses & assign members" },
  { href: "/admin/cabins", emoji: "🏡", tile: "bg-lake/12", title: "Cabin requests", sub: "Approve room stay requests" },
  { href: "/admin/help-contact", emoji: "☎️", tile: "bg-campfire/12", title: "Help contact", sub: "Who the Help page says to text or call" },
  { href: "/admin/signins", emoji: "🔐", tile: "bg-dusk/12", title: "Sign-ins", sub: "Who joined & recent sign-ins" },
  { href: "/admin/preview", emoji: "👁️", tile: "bg-sun/12", title: "View as", sub: "Preview the app as a member or guest" },
];

export default function AdminPage() {
  return (
    <AdminGuard>
      <div className="space-y-4 pt-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Admin dashboard</h1>
          <p className="text-sm text-foreground/60">
            Everything for running the resort app, in one place.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3">
          {CARDS.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="press flex min-h-[104px] flex-col justify-center rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
            >
              <span
                aria-hidden
                className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${c.tile}`}
              >
                {c.emoji}
              </span>
              <span className="mt-2 text-sm font-semibold">{c.title}</span>
              <span className="mt-0.5 text-xs text-foreground/60">{c.sub}</span>
            </Link>
          ))}
        </div>

        <Link
          href="/family-fest/planner"
          className="press flex items-center gap-3 rounded-2xl bg-primary p-4 text-white shadow-sm"
        >
          <span aria-hidden className="shrink-0 text-2xl">
            🎪
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Family Fest Planner</p>
            <p className="mt-0.5 text-xs text-white/80">
              Schedule, dinners, dues, Home callout cards
            </p>
          </div>
          <span className="shrink-0 text-lg leading-none text-white/70" aria-hidden>
            ›
          </span>
        </Link>

        {/* Opens Google's own "new form" page — works great on a phone, no
            account-switching prompts needed since it just uses whatever
            Google account is already signed in. The resulting share link
            then gets pasted into a Home callout's "Button link" (see
            HomeSpotlight/CalloutStack) or the People tab's "email a group"
            tool — no in-app form builder needed. */}
        <a
          href="https://docs.google.com/forms/create"
          target="_blank"
          rel="noreferrer"
          className="press flex items-center gap-3 rounded-2xl bg-accent p-4 text-white shadow-sm"
        >
          <span aria-hidden className="shrink-0 text-2xl">
            📝
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Create a Google Form</p>
            <p className="mt-0.5 text-xs text-white/80">
              Survey, poll, or sign-up — then link it from a Home callout or an email
            </p>
          </div>
          <span className="shrink-0 text-lg leading-none text-white/70" aria-hidden>
            ↗
          </span>
        </a>
      </div>
    </AdminGuard>
  );
}
