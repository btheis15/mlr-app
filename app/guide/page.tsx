"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * "Take the tour" — the complete, plain-English guide to the app. This used to
 * be an embedded PDF viewer for a slide-deck walkthrough; it's now a real,
 * extensive in-app guide covering every tab and feature, written for the least
 * technical family members and meant to be read start to finish (the jump-to
 * pills below are a shortcut for people who just want one section). Linked
 * from Help ("Take the tour") and Home's "App & help" group.
 *
 * Content here should stay in sync with what the app actually does — when a
 * feature changes, update the matching GuideSection below in the same PR.
 */

const SECTIONS = [
  { id: "home", label: "Home" },
  { id: "family-fest", label: "Family Fest" },
  { id: "feed", label: "Feed & chat" },
  { id: "events", label: "Events" },
  { id: "people", label: "People & Committees" },
  { id: "houses", label: "Houses" },
  { id: "polls", label: "Polls" },
  { id: "activity", label: "Activity" },
  { id: "help-requests", label: "Ask for Help" },
  { id: "local-places", label: "Local Places & Cabin Stay" },
  { id: "profile", label: "Your Profile" },
  { id: "install", label: "Add to phone" },
  { id: "admin", label: "For admins" },
] as const;

export default function GuidePage() {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <div className="space-y-5 pt-4">
      <button
        type="button"
        onClick={goBack}
        className="press inline-flex items-center gap-1 text-sm font-semibold text-primary"
      >
        ‹ Back
      </button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">The MLR app guide</h1>
        <p className="text-sm text-foreground/65">
          Everything the app can do, in plain English. Read it top to bottom,
          or jump straight to what you need — by the end you&rsquo;ll know all
          the ins and outs.
        </p>
      </header>

      <nav
        aria-label="Jump to a section"
        className="sticky top-0 z-30 -mx-4 bg-background/90 backdrop-blur"
      >
        <div className="flex gap-1.5 overflow-x-auto px-4 py-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="press flex h-9 shrink-0 items-center whitespace-nowrap rounded-full bg-card px-3.5 text-xs font-semibold text-foreground/70 ring-1 ring-border"
            >
              {s.label}
            </a>
          ))}
        </div>
      </nav>

      <GuideIntro />

      <GuideSection id="home" emoji="🏠" title="Home: your starting point">
        <p>
          Home is the front door — open the app and this is what you land on.
          It&rsquo;s built to surface whatever&rsquo;s most relevant right now
          and get out of your way, so nothing important is ever more than a
          glance away.
        </p>
        <p>
          Right up top, a card shows what&rsquo;s currently going on with{" "}
          <b>Family Fest</b> (see below) — a quiet reminder most of the year,
          building into a full countdown as the event gets close, and taking
          over Home entirely during the week itself. If there&rsquo;s a
          time-sensitive announcement or two, they&rsquo;ll stack as swipeable
          cards on top of that — swipe one away (or tap the ✕) and the next
          slides up. Dismissed cards come back the next time you open the app,
          so nothing important gets permanently lost.
        </p>
        <p>
          Below that, if a resort event is coming up, you&rsquo;ll see it
          front and center with a one-tap <b>Going / Maybe / Can&rsquo;t make
          it</b> button — no need to open the calendar just to RSVP.
        </p>
        <p>
          A <b>work checklist</b> lives just under that, collapsed by default
          with a quick summary (including how many items are marked urgent).
          Tap it open to see resort to-do items — and your house&rsquo;s own
          list, if you belong to one.
        </p>
        <p>
          The <b>quick actions grid</b> is always visible and is the fastest
          way to get anywhere: <b>Events</b> (RSVP to gatherings and work
          weekends), <b>Committees</b> (join a crew), <b>People</b> (find and
          contact anyone), <b>Ask for Help</b> (request a hand at the
          resort), <b>Local Places</b> (tee times, food, favorites nearby),
          and <b>Cabin Stay</b> (reserve a room for any week).
        </p>
        <p>
          Underneath, a handful of small cards show up only when they have
          something worth saying — today&rsquo;s weather at the lake, who
          else is up at the resort right now, an open family poll, upcoming
          birthdays, your house&rsquo;s hub, and (for signed-in members) a
          photo memory from this time in a past year. If none of that applies
          to you right now, those cards simply don&rsquo;t show up — Home
          never carries an empty box.
        </p>
        <p>
          At the very bottom, a small <b>&ldquo;App &amp; help&rdquo;</b>{" "}
          group holds this guide, the button to add MLR to your home screen,
          a way to share the app with someone else, and the Help page.
        </p>
      </GuideSection>

      <GuideSection id="family-fest" emoji="⛺" title="Family Fest">
        <p>
          Family Fest is the week-long annual family gathering, and it lives
          right inside the app as its own section (its own tab at the
          bottom) rather than a separate app. It has four parts, switchable
          from the pill bar at the top of the section:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b>Overview</b> — a countdown while the fest is approaching, a
            &ldquo;Day <i>n</i> of <i>N</i>&rdquo; view with today&rsquo;s
            events once the week has started, and a nudge to post your photos
            for a couple weeks after it wraps.
          </li>
          <li>
            <b>Schedule</b> — every scheduled happening for the week, plus an{" "}
            <b>anytime</b> list of things to do that aren&rsquo;t tied to a
            specific time (a scavenger hunt and similar activities). Tap
            anything for the full detail.
          </li>
          <li>
            <b>Dinners</b> — who&rsquo;s cooking what, which house is on crew
            duty, and who&rsquo;s heading it up each night. Tap a night to see
            the full crew and the head chef&rsquo;s contact info.
          </li>
          <li>
            <b>Pay</b> — covers your dues. A calculator lets you tap +/- for
            each person coming (adults, kids, per-day rates where they apply)
            and it fills in the right total and a note automatically, so
            nobody has to do the math by hand — it hands you straight off to
            Venmo or PayPal with the amount already filled in.
          </li>
        </ul>
        <p>
          RSVP&rsquo;ing to Family Fest works a little differently than a
          normal event, since it runs Sunday to Saturday: you can mark
          yourself going for the whole week, or open the day-by-day picker and
          say which specific days you&rsquo;ll be there. Going for even one
          day counts as &ldquo;Going&rdquo; on the overall calendar.
        </p>
        <p>
          Photos from Family Fest don&rsquo;t have their own page — they live
          right alongside everything else in the <b>Feed</b> tab, same as any
          other post.
        </p>
      </GuideSection>

      <GuideSection id="feed" emoji="💬" title="Feed: posts & chat">
        <p>
          The Feed tab is where the family talks — a shared photo/update feed
          plus a live chat room for every committee and house you&rsquo;re
          part of, switched between with pills at the top. You&rsquo;ll need
          to be signed in to post or chat (browsing is always free).
        </p>
        <p>
          <b>Posts</b> is the resort-wide feed: share a photo or an update,
          tag people in it, react, and comment. Comments support{" "}
          <b>@mentions</b> with autocomplete, same as tagging a post directly
          — type <code>@</code> and a name to notify someone specifically.
        </p>
        <p>
          <b>Committee and house chats</b> feel like a normal group chat:
          send messages and photos, react to a message (long-press it), reply
          to a specific message, and @mention people in that room. Tapping a
          reaction shows exactly who reacted, not just a count. You can edit
          or delete your own message for 24 hours after sending — after that,
          only an admin can. A deleted message quietly becomes &ldquo;message
          deleted&rdquo; for everyone rather than disappearing without a
          trace, and an edited one shows a small &ldquo;edited&rdquo; note.
        </p>
        <p>
          Committee chat @mentions only suggest people in that specific
          committee&rsquo;s roster — so a Beautification chat only lets you
          tag other Beautification folks, keeping things relevant. House
          chats work the same way, scoped to your house.
        </p>
      </GuideSection>

      <GuideSection id="events" emoji="📅" title="Events & RSVPs">
        <p>
          The Events tab is the full resort calendar — every upcoming
          gathering and work weekend, each with a simple{" "}
          <b>Going / Maybe / Can&rsquo;t make it</b> control. Tap into an
          event to see who else is coming, and for multi-day events like
          Family Fest, a day-by-day breakdown of who&rsquo;s around which
          days.
        </p>
        <p>
          The single nearest upcoming event is also spotlighted right on
          Home, so for most people RSVP&rsquo;ing never even requires opening
          the Events tab. Admins can create and edit events; anyone can RSVP
          to any of them once signed in.
        </p>
      </GuideSection>

      <GuideSection id="people" emoji="👥" title="People & Committees">
        <p>
          <b>People</b> is the family directory — everyone with an account,
          searchable by name, each with quick buttons to text, call, or pay
          them, plus a tap-through to their full profile. There&rsquo;s also
          a way to email a whole group at once rather than everyone
          one-by-one. This section is members-only — sign in to browse it.
        </p>
        <p>
          <b>Committees</b> are the volunteer crews that keep the resort
          running. Open one to see its roster, grouped by area with each
          area&rsquo;s lead pinned at the top. If you&rsquo;re not yet a
          member, you can request to join — a lead or admin approves it. Once
          you&rsquo;re in, you can pick or drop your own areas within that
          committee without needing anyone&rsquo;s approval (you just
          can&rsquo;t make yourself a Lead). Joining a committee also unlocks
          that committee&rsquo;s chat room in the Feed tab.
        </p>
        <p>
          Family Fest itself is really one big committee under the hood —
          each person&rsquo;s roles are the area(s) they own: Meals,
          Entertainment &amp; Games, Art &amp; Decorating, Merchandise/
          Fundraising/Polling, or Logistics/Scheduling/Finance.
        </p>
      </GuideSection>

      <GuideSection id="houses" emoji="🏡" title="Houses">
        <p>
          A <b>House</b> is a smaller group layered on top of the whole
          family — think of it as your own household or cabin group within
          MLR. Everyone is always part of MLR as a whole; a house is
          narrower, on top of that, never instead of it. An admin assigns
          people to a house — there&rsquo;s no self-serve joining.
        </p>
        <p>
          If you&rsquo;re in a house, you get a <b>House Hub</b> — a card on
          Home that gathers your house&rsquo;s calendar, chat, and to-do list
          in one place:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b>Calendar</b> — anyone in the house can add a stay
            (&ldquo;I&rsquo;m up these dates&rdquo;), including extra guests
            who don&rsquo;t have accounts (a spouse, kids, a friend, even the
            dog). Everyone in the house can see who&rsquo;s up and when, and
            overlapping stays make it obvious who&rsquo;ll be there at the
            same time. Resort-wide events are shown on the same calendar so
            your house never misses something family-wide.
          </li>
          <li>
            <b>Chat</b> — a private chat room just for your house, working
            exactly like committee chat (media, reactions, mentions, replies,
            24-hour edit/delete).
          </li>
          <li>
            <b>Work items</b> — your house can keep its own private to-do
            list, separate from (but shown alongside) the resort-wide one.
          </li>
        </ul>
      </GuideSection>

      <GuideSection id="polls" emoji="🗳️" title="Polls">
        <p>
          Polls are the family&rsquo;s quick way to settle something by vote
          — a t-shirt design, which meal to serve, picking a date. Any
          signed-in member can start one with a question and 2–10 options;
          everyone gets exactly one vote and can change their mind any time
          while it&rsquo;s open. Whoever created it (or an admin) can close it
          early, or it can auto-close on a date they set. The newest open
          poll shows right on Home so it&rsquo;s hard to miss.
        </p>
      </GuideSection>

      <GuideSection id="activity" emoji="🔔" title="Activity">
        <p>
          The bell icon in the bottom bar is your <b>Activity</b> tab — a
          running feed of everything that happened involving you: comments
          and reactions on your posts, @mentions anywhere, new posts to the
          Feed, committee decisions, new stays on your house calendar, and
          more. A red badge shows how many are unseen; opening the tab clears
          it. You can turn any individual kind of notification on or off from
          your Profile&rsquo;s notification settings (see below) — Activity
          keeps working even if phone push notifications are off.
        </p>
      </GuideSection>

      <GuideSection id="help-requests" emoji="🙌" title="Ask for Help">
        <p>
          Ask for Help is for the moment you&rsquo;re actually at the resort
          and could use an extra pair of hands — moving logs, setting up for
          an event, a ride, borrowing supplies, or a genuine emergency. Post
          what you need, how many people, and where; anyone who&rsquo;s
          opted into <b>&ldquo;Willing to help&rdquo;</b> and is also at the
          resort right now gets notified and can tap <b>On my way</b>. Once
          enough people are coming, the request shows as{" "}
          <b>✅ Covered</b> and everyone else is let off the hook. A request
          can also list specific things to bring (tables, chairs, coolers) so
          helpers can claim individual items.
        </p>
        <p>
          Marking a request <b>🚨 Urgent</b> is for real emergencies — it
          bypasses all the usual filtering and alerts every single member,
          not just the people who opted in.
        </p>
      </GuideSection>

      <GuideSection id="local-places" emoji="📍" title="Local Places & Cabin Stay">
        <p>
          <b>Local Places</b> (a tile on Home) is a shortcut to nearby
          businesses worth knowing about — tee times, restaurants, and other
          resort-adjacent favorites — each with quick buttons for their menu,
          ordering, calling, or their website.
        </p>
        <p>
          <b>Cabin Stay</b> lets you request a room in one of the resort
          houses for any week, not just Family Fest — see how many rooms are
          open, request one, and track the status of your own requests.
          Admins approve or deny requests from their side.
        </p>
      </GuideSection>

      <GuideSection id="profile" emoji="⚙️" title="Your Profile & settings">
        <p>
          Profile is where your identity and preferences live: your name,
          avatar, and contact/payment info (what shows up when someone taps
          your name to reach you or pay you — all optional).
        </p>
        <p>
          Two settings sections are worth knowing about. <b>Activity
          notifications</b> lets you switch each individual kind on or off —
          comments on your posts, mentions, new posts, committee decisions,
          event RSVPs, work items, and more. <b>Push notifications</b> is the
          same idea but for actual buzzes on your phone; there&rsquo;s a
          master on/off plus per-category control (broadcast alerts,
          birthdays, committee decisions, mentions, and so on). Urgent Ask for
          Help alerts are the one exception — those always get through, since
          they can be a real emergency.
        </p>
        <p>
          You can also make the text bigger anywhere in the app from here (or
          from Help) — it&rsquo;s remembered on your device from then on.
        </p>
        <p>
          If you&rsquo;re an admin, Profile carries one extra link down to
          the <b>Admin dashboard</b> — see the next section.
        </p>
      </GuideSection>

      <GuideSection id="install" emoji="📲" title="Add MLR to your Home Screen">
        <p>
          Adding the app to your phone&rsquo;s home screen gives you a normal
          tap-to-open icon, keeps you signed in, and is what lets event
          reminders and alerts actually reach you. Look for the install
          button on Home, Profile, or the Help page — tap it and it walks you
          through the couple of steps for your phone. Once it&rsquo;s
          installed, that button quietly disappears since you won&rsquo;t
          need it anymore.
        </p>
      </GuideSection>

      <GuideSection id="admin" emoji="🛠️" title="For admins">
        <p>
          Admins get one extra destination: the <b>Admin dashboard</b>,
          reached from a link at the bottom of Profile. It&rsquo;s the front
          door to every admin tool — managing members, posting alerts and
          notifications, reviewing reported content, approving committee join
          requests, assigning people to houses, approving cabin-stay
          requests, editing the Help page&rsquo;s contact info, checking
          recent sign-ins, and previewing the app as a member or guest to
          double-check what they&rsquo;d see. It also links out to the Family
          Fest Planner, where the whole fest&rsquo;s schedule, dinners, dues,
          and Home call-out cards are managed.
        </p>
      </GuideSection>

      <section
        id="contact"
        className="scroll-mt-16 space-y-2 rounded-2xl bg-primary/5 p-5 ring-1 ring-primary/15"
      >
        <h2 className="text-base font-bold">Still have questions?</h2>
        <p className="text-sm leading-relaxed text-foreground/75">
          Nothing beats a real person — the{" "}
          <Link href="/help" className="font-semibold text-primary underline-offset-2 hover:underline">
            Help page
          </Link>{" "}
          has a direct way to text or email for a hand with anything this
          guide didn&rsquo;t cover.
        </p>
      </section>

      <p className="pt-2 text-center text-xs text-muted">
        <Link href="/" className="underline-offset-2 hover:underline">
          ← Back to Home
        </Link>
      </p>
    </div>
  );
}

function GuideIntro() {
  return (
    <section className="space-y-2 rounded-2xl bg-card p-5 ring-1 ring-border">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <span aria-hidden className="text-lg">
          🌲
        </span>
        Welcome to MLR
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-foreground/75">
        <p>
          This app is the home base for Muskellunge Lake Resort — the
          schedule, Family Fest, photos, who&rsquo;s coming to what, and
          resort announcements, all in one place. Anyone in the family can
          use it, and you can look around freely without signing in. You only
          need to add your name and email when you want to <i>do</i>{" "}
          something — post a photo, RSVP, join a committee, or get alerts.
          There&rsquo;s no password to create or remember; you just get a
          quick code by email to confirm it&rsquo;s you.
        </p>
        <p>
          Five tabs run along the bottom of the app — <b>Home</b>,{" "}
          <b>Feed</b>, <b>Family Fest</b>, <b>Activity</b>, and{" "}
          <b>Profile</b> — and that&rsquo;s the shape of everything below.
          Read straight through, or use the pills up top to jump to whatever
          you need right now.
        </p>
      </div>
    </section>
  );
}

function GuideSection({
  id,
  emoji,
  title,
  children,
}: {
  id: string;
  emoji: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-16 space-y-2 rounded-2xl bg-card p-5 ring-1 ring-border"
    >
      <h2 className="flex items-center gap-2 text-base font-bold">
        <span aria-hidden className="text-lg">
          {emoji}
        </span>
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/75">
        {children}
      </div>
    </section>
  );
}
