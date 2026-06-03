# -*- coding: utf-8 -*-
"""Content for the MLR App Overview PDF. Returns a flat list of flowables."""

from reportlab.platypus import (
    Paragraph, Spacer, PageBreak, NextPageTemplate, Table, TableStyle, KeepTogether,
)
from reportlab.lib.units import inch
from reportlab.lib import colors

from build_overview_pdf import (
    H1, H2, H3, BODY, BODYJ, SMALL, LBL, BULLET, KICKER,
    COVER_TITLE, COVER_SUB, TOC, TOCNUM,
    PINE, PINE_DK, INK, CAMPFIRE, WINE, AZURE, LAKE, MUTE, TINT, PARCH, BORDER,
    chip, callout, code_block, bullets, data_table, Rule, MARGIN, PAGE_W,
    style, clean_text,
)
from reportlab.lib.enums import TA_LEFT

def P(t, s=BODY): return Paragraph(clean_text(t), s)
def sp(h=6): return Spacer(1, h)

# Section header helper that keeps the kicker + rule + title together
def section(num, title, kicker=None):
    out = [Spacer(1, 2)]
    out.append(Paragraph(f"SECTION {num}", KICKER))
    out.append(Paragraph(title, H1))
    out.append(Rule(PINE, 1.4, space=8))
    if kicker:
        out.append(Paragraph(kicker, style("Lede", fontName="Helvetica-Oblique",
                    fontSize=10.5, leading=15, textColor=MUTE, spaceAfter=8)))
    return out


def build_story():
    F = []

    # ───────────────────────────── COVER ─────────────────────────────
    F += [
        Spacer(1, 2.5*inch),
        Paragraph("Muskellunge", COVER_TITLE),
        Paragraph("Lake Resort", COVER_TITLE),
        Spacer(1, 10),
        Paragraph("The resort app — a product &amp; engineering walkthrough", COVER_SUB),
        Spacer(1, 6),
        Paragraph('<font color="#9fc4b1">What it is · every feature · how it’s built · where it could go next</font>',
                  style("CoverNote", fontName="Helvetica", fontSize=11, leading=15, textColor=colors.white)),
        Spacer(1, 1.6*inch),
        Paragraph('<font color="#cfe0d6">EST. 1987  ·  Tomahawk, Wisconsin  ·  A Next.js 16 / React 19 PWA</font>',
                  style("CoverFoot", fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=colors.white)),
        Paragraph('<font color="#bcd2c6">Prepared for a fellow programmer — skim the product half, then dig into the backend.</font>',
                  style("CoverFoot2", fontName="Helvetica-Oblique", fontSize=9, leading=13, textColor=colors.white)),
        NextPageTemplate("body"),
        PageBreak(),
    ]

    # ───────────────────────────── TOC ─────────────────────────────
    F += [Paragraph("Contents", H1), Rule(PINE, 1.4, space=8), sp(6)]
    toc = [
        ("1", "What it is &amp; who it’s for", "The product in one page"),
        ("2", "The map — navigation &amp; every screen", "Tabs, cards, and click-throughs"),
        ("3", "Sign-in &amp; identity", "Passwordless email OTP, public browse, admins"),
        ("4", "The Posts feed in depth", "The little family social network"),
        ("5", "Contact &amp; pay — the member card", "Tap a name, reach or pay them"),
        ("6", "Announcements &amp; alerts", "Push notices to the top of the app"),
        ("7", "The Family Fest “season” engine", "How the app rises and recedes across the year"),
        ("8", "Technical architecture", "Stack, rendering model, theming, PWA"),
        ("9", "Data &amp; backend — Supabase", "Schema, row-level security, realtime, auth"),
        ("10", "Self-hosted media server", "Why photos/videos live on a Mac mini"),
        ("11", "Hosting, infrastructure &amp; resources", "Where every piece runs and what it costs"),
        ("12", "Ideas to kick around", "Where I’d love your take"),
    ]
    rows = []
    for n, t, sub in toc:
        rows.append([Paragraph(n, TOCNUM),
                     Paragraph(f"{t}<br/><font color='#5b6b63' size=8.5>{sub}</font>", TOC)])
    tb = Table(rows, colWidths=[0.4*inch, None])
    tb.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("BOTTOMPADDING", (0,0), (-1,-1), 7),
        ("TOPPADDING", (0,0), (-1,-1), 1),
        ("LINEBELOW", (0,0), (-1,-2), 0.4, BORDER),
    ]))
    F += [tb]
    F += [sp(14), callout("How to read this",
          [P("Sections 1–7 are the product — what the app does and how it feels to use. "
             "Sections 8–11 are the engineering — stack, database, security, and deploy. "
             "Section 12 is a short list of trade-offs I’d genuinely like a second opinion on.", BODY)],
          accent=CAMPFIRE, bg=colors.HexColor("#fbf0e8"))]
    # No page break: Section 1 follows the contents/callout to avoid a blank page.
    F += [sp(16)]

    # ───────────────── SECTION 1 — WHAT IT IS ─────────────────
    F += section("1", "What it is &amp; who it’s for",
                 "A private, mobile-first app for one family’s Northwoods resort — and the week-long reunion at the heart of it.")
    F += [P(
        "<b>Muskellunge Lake Resort (MLR)</b> is a real family resort near Tomahawk, Wisconsin "
        "(the original light-housekeeping cabins on the lake, EST 1987). This app is a small, private "
        "<b>progressive web app</b> for the family and community around it — think “a tiny private "
        "social network + event tool,” not a public booking site. Anyone with the link can browse; a "
        "<b>verified email unlocks interaction</b> (posting, RSVP, reactions).")]
    F += [P(
        "It does double duty. Most of the year it’s the <b>year-round resort app</b> — activities, dining, "
        "amenities, committees, tee-time booking. Once a year it becomes the home base for <b>Family Fest</b>, "
        "a week-long family reunion, which lives <i>inside</i> the same app as a themed section at "
        "<font face='Courier' size=9>/family-fest</font>.")]
    F += [sp(2), Paragraph("The two halves, one app", H3)]
    F += [data_table(
        ["", "Year-round MLR", "Family Fest section"],
        [
            [("Look", "b"), "Forest-green, Northwoods heritage", "Renaissance / parchment (scoped theme)"],
            [("Lives at", "b"), ("/, /posts, /profile, …", "m"), ("/family-fest/*", "m")],
            [("Content", "b"), "Activities, dining, committees, tee times", "Schedule, dinners, dues, the week itself"],
            [("Display font", "b"), "Yellowtail script wordmark", "Cinzel Roman-serif titles"],
        ],
        [0.16, 0.42, 0.42])]
    F += [sp(8), callout("The one trick that ties it together",
        [P("Rather than build two apps, the Family Fest is modeled as a <b>“season” of the resort</b> that "
           "rises and recedes through the year — <b>off-season → planning → live → wrap</b>. The home "
           "screen, the tab bar, and the fest hub all reshape themselves around that phase. Full detail in "
           "Section 7.", BODY)], accent=PINE)]
    F += [sp(8), Paragraph("Current status", H3)]
    F += [P(
        "The backend is <b>live</b>: passwordless auth, member profiles, and the shared photo/video feed all run "
        "on Supabase, with media files self-hosted on a Mac mini. A <font face='Courier' size=9>READ_ONLY</font> "
        "feature flag still gates a few not-yet-backed features (in-app committee join, RSVP writes) behind a "
        "tasteful “coming soon,” so nothing ever looks broken. It’s deployed on both <b>Vercel</b> and "
        "<b>GitHub Pages</b>. Recent additions: an admin <b>member directory</b>, a guest <b>privacy wall</b> "
        "(sensitive info hidden until sign-in), and a collapsible, spring-animated Profile.")]
    F += [PageBreak()]

    # ───────────────── SECTION 2 — THE MAP ─────────────────
    F += section("2", "The map — navigation &amp; every screen",
                 "Four bottom tabs carry the whole app; a few Home cards reach the year-round extras. Nothing is ever more than one tap from home.")
    F += [Paragraph("The four tabs (bottom nav)", H3)]
    F += [data_table(
        ["Tab", "Route", "What’s there"],
        [
            [("\U0001F3E0 Home", "b"), ("/", "m"), "Logo, share-the-app, the Family Fest season card, dues CTA, resort cards, tee-time link"],
            [("\U0001F4E3 Posts", "b"), ("/posts", "m"), "The shared family feed — photos, videos, comments, reactions, tagging, a photo timeline"],
            [("\U0001F389 Family Fest", "b"), ("/family-fest", "m"), "The whole week in one view; wears a live “pulse” dot during the event"],
            [("\U0001F464 Profile", "b"), ("/profile", "m"), "Identity, avatar, contact/pay info, email-alert toggle, admin tools (incl. member directory), sign out — the sections collapse into tidy windows"],
        ],
        [0.22, 0.18, 0.60])]
    F += [sp(6), P(
        "The <font face='Courier' size=9>TABS</font> array in "
        "<font face='Courier' size=9>TabBar.tsx</font> is the single source of truth for the nav. The Family Fest "
        "tab is colored heraldic-wine (not green) so it reads as its own world, and shows a pulsing red dot during "
        "the live and wrap phases.")]

    F += [sp(6), Paragraph("Reached from the Home screen (not tabs)", H3)]
    F += [data_table(
        ["Destination", "Route", "Notes"],
        [
            ["Activities", ("/activities", "m"), "Resort things-to-do in 4 color-coded categories (water / land / kids / evening)"],
            ["Dining &amp; amenities", ("/dining", "m"), "Eat-and-drink venues + practical amenities (WiFi, check-in, laundry…)"],
            ["Committees", ("/committees", "m"), "Volunteer groups; tap one → roster with call/text/email + “request to join”"],
            ["Work Weekends", ("/work-weekends", "m"), "Season-prep weekends (hidden during the fest week)"],
            ["Tee Times", ("/tee-times", "m"), "Deep-links into Inshalla CC’s foreUP booking, pre-filtered to a day"],
        ],
        [0.26, 0.22, 0.52])]

    F += [sp(8), Paragraph("Inside Family Fest — the click-throughs", H3)]
    F += [P("The fest hub is one flowing page (no sub-nav), built to answer “what’s happening, and what do I do today?”:")]
    F += [bullets([
        "<b>FestStatus</b> at the top — during the week it shows <b>Day n of N</b> and every one of today’s "
        "events in full (time, place, what to bring, who’s in charge with tap-to-call/text), plus tonight’s dinner and head chef.",
        "<b>FestWeek</b> below — an “anytime all week” list (e.g. the scavenger hunt) plus a day-by-day "
        "accordion. Tap a day to expand its events and dinner; each row links to a detail page.",
        "<b>Detail pages</b> — <font face='Courier' size=9>/family-fest/schedule/[id]</font> (an event) and "
        "<font face='Courier' size=9>/family-fest/dinners/[id]</font> (a dinner: menu, prep vs. serve time/place, the cooking “houses,” chef contact).",
        "<b>/family-fest/pay</b> — the dues amount + organizers to pay by Venmo/Zelle.",
    ])]
    F += [sp(4), callout("Navigation principle",
        [P("Detail pages carry an iOS-style <b>‹ back</b> link that always names its destination, and the bottom "
           "tab bar is always present — so you can never get stranded.", BODY)], accent=AZURE,
        bg=colors.HexColor("#eef1f8"))]
    F += [PageBreak()]

    # ───────────────── SECTION 3 — IDENTITY ─────────────────
    F += section("3", "Sign-in &amp; identity",
                 "Public to browse, verified to act. No passwords — a 6-digit email code and a session that sticks.")
    F += [P(
        "Identity is <b>on-demand, not a gate</b>. The entire app is browsable signed-out — though sensitive details "
        "are gated for guests (see “What a guest sees” below). The moment you try to "
        "<i>do</i> something — post, react, RSVP — a sign-in sheet slides up. That’s "
        "<font face='Courier' size=9>promptSignIn()</font> from a small React context "
        "(<font face='Courier' size=9>IdentityProvider</font>) that any component can call.")]
    F += [sp(2), Paragraph("The flow", H3)]
    F += [bullets([
        "<b>Enter name + email</b> → Supabase <font face='Courier' size=9>signInWithOtp()</font> emails a 6-digit code. "
        "The name is passed as user metadata so a DB trigger can seed the profile.",
        "<b>Enter the code</b> → <font face='Courier' size=9>verifyOtp()</font> creates a real session. Supabase persists "
        "the refresh token on-device and auto-refreshes it, so you <b>stay logged in</b> — a new code is only needed on a new device.",
        "<b>On every load</b>, the provider restores the session and loads the member’s row from the "
        "<font face='Courier' size=9>profiles</font> table (display name, avatar, alert opt-in, admin flag).",
    ])]
    F += [sp(4), Paragraph("What a guest sees — the privacy wall", H3)]
    F += [P(
        "Browsing is open, but anything a stranger or scraper could misuse is hidden until sign-in. A small "
        "<font face='Courier' size=9>Guard</font> module (<font face='Courier' size=9>SignInWall</font>, "
        "<font face='Courier' size=9>Protected</font>, <font face='Courier' size=9>PrivateName</font>) plus "
        "<font face='Courier' size=9>lib/privacy.ts</font> gate it consistently: the <b>Posts</b> feed and the "
        "<b>Pay</b> screens are full sign-in walls; phone/email/Venmo/Zelle and event locations show a “Sign in” "
        "chip; and members appear by <b>first name only</b> to guests. Signed-in members see everything as before. "
        "It activates only when sign-in actually exists, so a backend-less build stays fully open.")]
    F += [sp(4), Paragraph("Admins", H3)]
    F += [P(
        "Admin is a <font face='Courier' size=9>profiles.is_admin</font> boolean in the database (set from the SQL "
        "editor, never from the client), with a tiny bootstrap allow-list in code so there’s an admin from day "
        "one. Admins get an in-app <b>alert composer</b> (Section 6) and a <b>member directory</b> on their "
        "Profile — see everyone who’s registered (with their email) and promote or remove other admins, all from "
        "<b>Profile → Admin → Members</b>. You can’t remove your own admin access, so you can’t lock yourself out.")]
    F += [sp(4), callout("Why this shape",
        [P("It’s deliberately not high-security — the only requirement is “a real, verified email to "
           "interact.” Email OTP confirms the address, the saved session keeps it effortless for the older "
           "relatives, and there are no passwords for anyone to forget. Build-safe, too: if Supabase env vars are "
           "absent, sign-in simply isn’t offered and the app stays fully browsable.", BODY)], accent=PINE)]
    F += [PageBreak()]

    # ───────────────── SECTION 4 — POSTS ─────────────────
    F += section("4", "The Posts feed in depth",
                 "The social heart of the app — a shared, cross-device feed that behaves like a small private Instagram for the family.")
    F += [P("<font face='Courier' size=9>PostsView.tsx</font> is the largest component in the app. It backs the Posts tab and powers:")]
    F += [bullets([
        "<b>A collapsing composer</b> — starts as a single “Share something…” box; on focus it reveals "
        "photo/video attach, people-tagging, and a backdate control.",
        "<b>Multi-photo &amp; video posts</b> — a swipeable, snap-scrolling carousel with dot indicators and an n/N counter; "
        "tap a photo for a full-screen lightbox.",
        "<b>Tagging</b> — search the family roster and tag people; a “\U0001F3F7️ Tagged me” filter shows posts you’re in.",
        "<b>Comments &amp; emoji reactions</b> — six reactions, one per member per post (upsert); tap a reaction chip to see who reacted.",
        "<b>A photo timeline</b> — posts group by day with “Today / Yesterday / date” headers, plus month chips and a date picker to jump back. "
        "Posting late? <b>Backdate</b> a photo to <i>when it happened</i> (a separate <font face='Courier' size=9>occurred_at</font>) so it slots into history.",
        "<b>Inline editing</b> — author or admin can edit text, add/remove media, retag, move the date, or delete — saved as a diff.",
        "<b>Share out</b> — the native Web Share sheet (→ Instagram, Messages…), falling back to the family Facebook group.",
    ])]
    F += [sp(4), Paragraph("How it stays live", H3)]
    F += [P(
        "The feed subscribes to Supabase <b>Realtime</b> on five tables (<font face='Courier' size=9>posts, "
        "post_media, post_comments, post_reactions, post_tags</font>); any change re-queries the feed, so a photo "
        "posted on one phone appears on everyone’s. Display names and avatars are resolved from a separate "
        "<font face='Courier' size=9>profiles</font> query and joined client-side — so renaming yourself updates "
        "your name on <i>every</i> past post and comment retroactively.")]
    F += [sp(2), Paragraph("Media handling", H3)]
    F += [P(
        "Photos are <b>compressed in-browser</b> to ~1920px JPEGs via canvas before upload (smaller, faster, and it "
        "sidesteps iPhone HDR/HEIC display quirks); videos upload as-is. Uploads stream to the Mac-mini media server "
        "over <font face='Courier' size=9>XMLHttpRequest</font> (chosen over fetch for a real progress bar). If "
        "there’s no backend, the feed degrades to seed posts + local-only posting so the UI is never empty.")]
    F += [PageBreak()]

    # ───────────────── SECTION 5 — CONTACT & PAY ─────────────────
    F += section("5", "Contact &amp; pay — the member card",
                 "Tap anyone’s name or avatar, anywhere, to reach or pay them — with their own preferred method floated to the top.")
    F += [P(
        "Every name and avatar in the app — a post author, a comment, a tagged person — is tappable. It opens "
        "<font face='Courier' size=9>MemberSheet</font>, a drag-to-dismiss bottom sheet that reads that member’s "
        "optional contact and payment fields from their profile and turns them into one-tap actions:")]
    F += [bullets([
        "<b>Contact</b> — \U0001F4AC Text (<font face='Courier' size=9>sms:</font>), \U0001F4DE Call "
        "(<font face='Courier' size=9>tel:</font>), ✉️ Email (<font face='Courier' size=9>mailto:</font>).",
        "<b>Pay</b> — Venmo (deep-links straight to the pay screen), Zelle (copy handle), Apple Cash (via Messages), "
        "Cash App, PayPal — each as a brand-colored button.",
        "<b>Preferred method</b> — each member marks how they’d <i>like</i> to be reached/paid; that option is "
        "moved to the front and flagged.",
    ])]
    F += [sp(4), P(
        "Members fill these in (all optional) under <b>Profile → Contact &amp; payment</b> (a collapsible section). "
        "Phones are stored E.164 so <font face='Courier' size=9>tel:</font>/<font face='Courier' size=9>sms:</font> "
        "work on both iPhone and Android. No payment credentials ever live in the app — buttons just hand off to the "
        "user’s own Venmo/bank/Messages. <b>Guests</b> don’t see any of this: a “Sign in” chip stands in for the "
        "contact and pay actions (the privacy wall, Section 3).")]
    F += [sp(4), callout("Nice touch",
        [P("The same contact pattern powers committee rosters and the Family Fest “who’s in charge” / "
           "“head chef” lines — it’s one helper (<font face='Courier' size=9>lib/contact.ts</font>) reused "
           "everywhere.", BODY)], accent=PINE)]
    F += [PageBreak()]

    # ───────────────── SECTION 6 — ANNOUNCEMENTS ─────────────────
    F += section("6", "Announcements &amp; alerts",
                 "A dismissible notice banner at the top of every screen — with an admin composer to push to it.")
    F += [P(
        "<font face='Courier' size=9>AnnouncementBanner</font> renders at the top of the app on every page. It merges "
        "two sources: server-fed announcements (today seed data; the seam is built for a Google-Drive feed later) and "
        "<b>admin-posted local alerts</b>. Notices come in two severities — a loud \U0001F4E3 alert and a quiet "
        "ℹ️ info — and each is <b>dismissible per-device</b> (remembered in "
        "<font face='Courier' size=9>localStorage</font>) so it never nags after it’s read.")]
    F += [sp(2), P(
        "Admins get a composer on their Profile (title, body, severity → Push). Today it writes to local storage "
        "and fires an event so the banner updates instantly across tabs. The <b>backend seam</b> is already designed: "
        "the same action will validate the admin server-side, broadcast to all devices, and email the members who "
        "opted into alerts.")]
    F += [PageBreak()]

    # ───────────────── SECTION 7 — SEASON ENGINE ─────────────────
    F += section("7", "The Family Fest “season” engine",
                 "One small pure function decides how the whole app behaves on any given day of the year.")
    F += [P(
        "This is the conceptual core. <font face='Courier' size=9>getFestSeason(start, end, now)</font> in "
        "<font face='Courier' size=9>lib/festSeason.ts</font> is a pure, dependency-free function that maps today’s "
        "date to a <b>phase</b> and a bag of derived facts (day number, days-until, wrap days left…):")]
    F += [data_table(
        ["Phase", "When", "What the app does"],
        [
            [("off-season", "b"), "&gt; 60 days out", "A quiet Family Fest banner on Home; everything resort-normal"],
            [("planning", "b"), "60 days → start", "Partial takeover: rally volunteers, preview the plan, push dues"],
            [("live", "b"), "during the week", "Full takeover: “Day n of N + today’s events,” a live dot on the tab, resort cards recede"],
            [("wrap", "b"), "14 days after", "Takeover lingers, nudging “post the photos you didn’t get to”"],
        ],
        [0.18, 0.24, 0.58])]
    F += [sp(8), Paragraph("Why it’s computed on the client", H3)]
    F += [P(
        "The phase depends on “now,” and the app ships as a <b>static export</b> to GitHub Pages. A build-time "
        "<font face='Courier' size=9>new Date()</font> would freeze the phase at deploy time. So a "
        "<font face='Courier' size=9>useFestSeason</font> hook computes it in the browser and returns "
        "<font face='Courier' size=9>null</font> until mounted — which also avoids a hydration mismatch. The same "
        "code is correct on the static Pages build and on Vercel.")]
    F += [sp(4), callout("Demo time-travel (a developer favorite)",
        [P("A <font face='Courier' size=9>DemoDateProvider</font> lets you set “see the app as if it’s this day,” "
           "persisted in localStorage and exposed on the Profile screen with quick-jumps (Run-up / Day 1–7 / After). "
           "Every season-aware surface respects it, so you can preview the live-week takeover in the middle of winter. "
           "The countdown component reads the same override.", BODY)], accent=CAMPFIRE,
        bg=colors.HexColor("#fbf0e8"))]
    F += [sp(6), P(
        "<b>Note:</b> the constants live in two repos. The fest started as its own standalone app, so "
        "<font face='Courier' size=9>festSeason.ts</font> and the event seed data are <i>mirrored byte-for-byte</i> "
        "in a <font face='Courier' size=9>family-fest</font> repo; the standalone is being retired into this section.")]
    F += [PageBreak()]

    # ───────────────── SECTION 8 — ARCHITECTURE ─────────────────
    F += section("8", "Technical architecture",
                 "Next.js 16 App Router, React 19, Tailwind v4, TypeScript — a mobile-first PWA with a CSS-token theme system.")
    F += [Paragraph("Stack", H3)]
    F += [data_table(
        ["Layer", "Choice", "Notes"],
        [
            [("Framework", "b"), "Next.js 16 (App Router)", "Server components by default; client components opt in with “use client”"],
            [("UI", "b"), "React 19 + TypeScript", "Strict types; shared domain shapes in lib/types.ts"],
            [("Styling", "b"), "Tailwind v4", "Theme tokens as CSS variables in an @theme block — no hard-coded hex"],
            [("Backend", "b"), "Supabase", "Postgres + Auth (email OTP) + Realtime; @supabase/supabase-js client"],
            [("Media", "b"), "Self-hosted Express", "On a Mac mini behind a Tailscale Funnel (Section 10)"],
            [("Hosting", "b"), "Vercel + GitHub Pages", "Same code, two build targets (Section 11)"],
        ],
        [0.18, 0.30, 0.52])]
    F += [sp(8), Paragraph("Rendering model", H3)]
    F += [P(
        "Pages are server components that pass static seed data into client components; anything time- or "
        "auth-dependent is computed client-side behind a <i>mounted gate</i> (return null until mounted) to keep the "
        "static export and the first client paint identical. Dynamic routes "
        "(<font face='Courier' size=9>/committees/[slug]</font>, the fest detail pages) use "
        "<font face='Courier' size=9>generateStaticParams()</font> so they pre-render for the static export.")]
    F += [sp(2), Paragraph("Theming &amp; the scoped sub-theme", H3)]
    F += [P(
        "All color is CSS variables in <font face='Courier' size=9>app/globals.css</font>; Tailwind v4 turns each "
        "<font face='Courier' size=9>--color-*</font> token into <font face='Courier' size=9>bg-*/text-*/ring-*</font> "
        "utilities. The clever bit: the Family Fest section’s parchment palette and Cinzel serif are scoped by "
        "<b>re-declaring those same CSS variables</b> under a <font face='Courier' size=9>.ff-section</font> wrapper. "
        "Every Tailwind utility inside that subtree instantly renders in heraldic wine/parchment, while the "
        "forest-green resort chrome above and below is untouched — a whole theme swap with zero component changes.")]
    F += [sp(2), code_block([
        ("/* globals.css */", True),
        ("@theme {", False),
        ("  --color-primary: #15503a;   /* forest green */", False),
        ("  --color-background: #f6f6f1;", False),
        ("}", False),
        (".ff-section {                 /* the Family Fest subtree */", False),
        ("  --color-primary: #8b2e2e;   /* heraldic wine */", False),
        ("  --color-background: #f4ecd8;/* parchment */", False),
        ("  --font-display: var(--font-cinzel), serif;", False),
        ("}", False),
    ])]
    F += [sp(6), Paragraph("Conventions worth noting", H3)]
    F += [bullets([
        "<b>Light mode only, forever</b> — there’s an explicit guard against dark translucent surface tints "
        "(they go muddy grey on the light bg); a recurring lesson written into the CSS.",
        "<b>One formatter module</b> — every date/time/currency string goes through "
        "<font face='Courier' size=9>lib/format.ts</font> so the whole app reads consistently.",
        "<b>A small iOS-feel motion system</b> — transform/opacity keyframes (page-enter, sheet, pop, rise), a "
        "spring-eased “poppy” tap (a scale that overshoots 1.0, then settles), and an auto-height accordion "
        "(grid-rows) for collapsible sections; everything collapses to a 1ms fade under "
        "<font face='Courier' size=9>prefers-reduced-motion</font>.",
        "<b>PWA</b> — web manifest, installable, iOS “Add to Home Screen” hint, safe-area insets for notches.",
    ])]
    F += [PageBreak()]

    # ───────────────── SECTION 9 — DATA & BACKEND ─────────────────
    F += section("9", "Data &amp; backend — Supabase",
                 "One Postgres database, one identity, row-level security on every table, and realtime on the social tables.")
    F += [P(
        "Static resort content (activities, dining, schedule, dinners, committees, dues) lives as typed seed data in "
        "<font face='Courier' size=9>lib/data.ts</font> — swappable for an API later without touching pages. "
        "Everything multi-user is in Supabase. The schema is eight idempotent SQL migrations:")]
    F += [data_table(
        ["Table", "Holds", "Realtime"],
        [
            [("profiles", "b"), "One row per auth user: display_name, avatar_url, is_admin, email_alerts, + contact/pay fields", "—"],
            [("posts", "b"), "Feed posts: author, text, created_at, occurred_at (timeline)", "yes"],
            [("post_media", "b"), "Multiple photos/videos per post (storage_path, type, position)", "yes"],
            [("post_comments", "b"), "Comments, by author", "yes"],
            [("post_reactions", "b"), "One emoji per member per post (PK = post+user)", "yes"],
            [("post_tags", "b"), "Tagged members per post", "yes"],
            [("albums", "b"), "Optional post grouping", "yes"],
        ],
        [0.18, 0.62, 0.20])]
    F += [sp(8), Paragraph("Row-level security (the real access model)", H3)]
    F += [P(
        "Every table has RLS enabled with a consistent posture: <b>public read</b> (anyone with the link can browse), "
        "<b>insert your own rows only</b> (<font face='Courier' size=9>auth.uid() = author_id</font>), and "
        "<b>delete/edit your own or admin</b>. Privilege escalation is blocked at the database: clients are "
        "<font face='Courier' size=9>GRANT</font>ed update on specific profile columns only — never "
        "<font face='Courier' size=9>is_admin</font> — so admin can’t be self-assigned from the client. Admins "
        "promote or demote each other through an admin-gated <font face='Courier' size=9>SECURITY DEFINER</font> "
        "function (<font face='Courier' size=9>set_admin</font>); a companion "
        "<font face='Courier' size=9>admin_members()</font> returns the member directory <i>with</i> private "
        "emails, which are deliberately kept out of the world-readable <font face='Courier' size=9>profiles</font> "
        "table (migration 0008).")]
    F += [sp(2), code_block([
        ("-- representative policy (posts)", True),
        ("create policy \"posts: insert own\" on public.posts", False),
        ("  for insert with check (auth.uid() = author_id);", False),
        ("create policy \"posts: delete own or admin\" on public.posts", False),
        ("  for delete using (", False),
        ("    auth.uid() = author_id", False),
        ("    or exists (select 1 from profiles p", False),
        ("               where p.id = auth.uid() and p.is_admin));", False),
    ])]
    F += [sp(6), Paragraph("Triggers &amp; identity glue", H3)]
    F += [bullets([
        "A <font face='Courier' size=9>handle_new_user()</font> trigger auto-creates a profile on sign-up, seeding "
        "<font face='Courier' size=9>display_name</font> from the entered name (or the email local-part) and "
        "<font face='Courier' size=9>contact_email</font> from the auth email.",
        "An <font face='Courier' size=9>updated_at</font> trigger keeps timestamps fresh.",
        "Migrations are written idempotently (<font face='Courier' size=9>if not exists</font>, "
        "<font face='Courier' size=9>drop policy if exists</font>) and the app degrades gracefully if a migration "
        "hasn’t run yet (e.g. the timeline’s <font face='Courier' size=9>occurred_at</font> falls back to "
        "<font face='Courier' size=9>created_at</font>).",
    ])]
    F += [PageBreak()]

    # ───────────────── SECTION 10 — MEDIA SERVER ─────────────────
    F += section("10", "Self-hosted media server",
                 "Login and data stay in cloud Supabase; the photo and video <i>files</i> live on a Mac mini at the house.")
    F += [P(
        "To dodge cloud-storage size caps (and cost) on a media-heavy family feed, post photos/videos are stored on a "
        "small <b>Express server running on a Mac mini</b>, fronted by a stable HTTPS tunnel (Tailscale Funnel). The "
        "app stores the returned file URL in <font face='Courier' size=9>post_media.storage_path</font>.")]
    F += [sp(2), Paragraph("How it’s secured", H3)]
    F += [bullets([
        "<b>Uploads are gated to signed-in family.</b> The server takes the caller’s Supabase access token and "
        "validates it against the cloud project (<font face='Courier' size=9>/auth/v1/user</font>) before accepting a file — no secrets needed on the mini.",
        "<b>Reads are public</b> (anyone with the app can view photos), served via "
        "<font face='Courier' size=9>express.static</font> with HTTP Range support, so videos seek/stream and files cache for a year.",
        "<b>Endpoints:</b> <font face='Courier' size=9>POST /upload</font> (auth), "
        "<font face='Courier' size=9>GET /f/&lt;name&gt;</font> (public), <font face='Courier' size=9>GET /health</font>. "
        "Filenames are random UUIDs; per-file size cap is configurable.",
    ])]
    F += [sp(4), P(
        "It also serves the pay-method logos at <font face='Courier' size=9>/assets</font>. Ops are handled with a "
        "launchd agent + a little “MLR Media Server” control-panel app, with request logging "
        "(<font face='Courier' size=9>[req]/[upload]/[auth]</font>) for diagnosing upload issues. The "
        "<b>one constraint</b>: the public URL must stay constant, because it’s baked into stored links.")]
    F += [PageBreak()]

    # ───────────────── SECTION 11 — HOSTING & RESOURCES ─────────────────
    F += section("11", "Hosting, infrastructure &amp; resources",
                 "One codebase, two build targets, and a deliberately frugal mix of free tiers plus a single home server. Here’s every moving piece and what it costs.")
    F += [Paragraph("Dual-target build", H3)]
    F += [P(
        "<font face='Courier' size=9>next.config.ts</font> branches on a "
        "<font face='Courier' size=9>PAGES_BASE_PATH</font> env var, so the <i>same</i> codebase produces two builds:")]
    F += [bullets([
        "<b>Default (Vercel):</b> served at the root with cache-control headers (always-revalidate, so a fresh deploy "
        "is picked up immediately on an installed PWA). This is the primary, full-featured target.",
        "<b>GitHub Pages:</b> <font face='Courier' size=9>PAGES_BASE_PATH=/mlr-app</font> switches Next.js to "
        "<font face='Courier' size=9>output: \"export\"</font> — a fully static site under that subpath, with "
        "unoptimized images and trailing slashes. A free, always-on mirror of the browse experience.",
    ])]
    F += [P(
        "Pages auto-deploys on push to <font face='Courier' size=9>main</font> via GitHub Actions; Vercel is a manual "
        "<font face='Courier' size=9>vercel --prod</font>. The two live at "
        "<font face='Courier' size=9>mlr-app-omega.vercel.app</font> and "
        "<font face='Courier' size=9>btheis15.github.io/mlr-app</font>.")]

    F += [sp(6), Paragraph("Where each piece runs", H3)]
    F += [data_table(
        ["Concern", "Runs on", "Notes"],
        [
            [("Web app / UI", "b"), "Vercel (primary) + GitHub Pages (mirror)", "Static + client-rendered; CDN-delivered"],
            [("Database", "b"), "Supabase Postgres (cloud)", "profiles, posts, media metadata, comments, reactions, tags"],
            [("Auth", "b"), "Supabase Auth (cloud)", "Email OTP; delivery via Gmail/Resend SMTP"],
            [("Live updates", "b"), "Supabase Realtime (cloud)", "WebSocket postgres-changes on the social tables"],
            [("Photo/video files", "b"), "Mac mini (home) + Tailscale Funnel", "Express server; disk is the storage limit"],
            [("Pay/brand assets", "b"), "Mac mini (/assets)", "SVG logos served off the mini, not the cloud"],
            [("Fonts", "b"), "Self-hosted via next/font", "Yellowtail + Cinzel bundled at build (works offline/PWA)"],
            [("Keep-alive cron", "b"), "GitHub Actions", "Read-only ping every ~3 days so Supabase doesn’t pause"],
        ],
        [0.20, 0.34, 0.46])]

    F += [sp(8), Paragraph("Resources &amp; what they cost", H3)]
    F += [P("The whole thing is built to run at essentially <b>$0/month</b> on free tiers, with one home machine doing the heavy media lifting:")]
    F += [data_table(
        ["Resource", "Tier / spec", "Cost"],
        [
            [("Vercel", "b"), "Hobby plan — static + edge, generous bandwidth", ("free", "b")],
            [("GitHub Pages + Actions", "b"), "Static hosting + CI minutes (deploy + cron)", ("free", "b")],
            [("Supabase", "b"), "Free project: ~500 MB Postgres, Auth, Realtime; pauses after 7 days idle", ("free", "b")],
            [("Email (OTP)", "b"), "Gmail SMTP (or Resend free, 3k/mo) — one code per login", ("free", "b")],
            [("Tailscale Funnel", "b"), "Stable public HTTPS tunnel to the mini", ("free", "b")],
            [("Mac mini", "b"), "Always-on box at the house: Express + disk for all media", "electricity"],
            [("Domain", "b"), "Uses *.vercel.app / *.github.io today; custom domain optional", ("optional", "b")],
        ],
        [0.26, 0.55, 0.19])]

    F += [sp(8), Paragraph("Mac mini operations", H3)]
    F += [P(
        "The media server is the one piece that isn’t a managed cloud service, so it’s hardened for "
        "unattended uptime: it runs as a <b>launchd agent</b> (auto-starts on login, restarts on crash), "
        "<font face='Courier' size=9>caffeinate</font> keeps the mini awake, and there’s a small "
        "“MLR Media Server” control-panel app for start/stop + a live request log. The dev/build clone lives at "
        "<font face='Courier' size=9>~/mlr-build</font> (kept off the iCloud-synced Desktop, which corrupts git repos).")]

    F += [sp(4), callout("Keeping a seasonal app awake",
        [P("Supabase’s free tier pauses a project after a week of inactivity — and this app is quiet for most "
           "of the year. A <b>GitHub Actions cron</b> does a read-only ping every ~3 days to keep it alive. It runs on "
           "GitHub’s cloud (not the mini), never writes anything, and is inert until the secrets are set. Note the "
           "split-brain by design: even if the database pauses or the mini sleeps, the static browse experience on "
           "Vercel/Pages keeps working — only interaction (posting, sign-in) depends on the cloud + mini.", BODY)],
        accent=PINE)]
    F += [PageBreak()]

    # ───────────────── SECTION 12 — IDEAS ─────────────────
    F += section("12", "Ideas to kick around",
                 "Honest trade-offs and rough edges — the parts where I’d most value your read. None are on fire; all are real.")

    def idea(title, body, tag, tagcolor):
        head = Table([[Paragraph(title, style("IdeaT", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=INK)),
                       chip(tag, tagcolor)]], colWidths=[None, 1.05*inch])
        head.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"MIDDLE"),
                                  ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
                                  ("ALIGN",(1,0),(1,0),"RIGHT")]))
        return KeepTogether([head, sp(2), P(body, BODY), sp(8)])

    F += [Paragraph("Performance &amp; data", H3)]
    F += [idea("Realtime feed does a full re-query on every change",
        "Each insert/edit/reaction on any of five tables triggers a complete <font face='Courier' size=9>refetch()</font> "
        "of the whole feed (six queries). Fine for a family-sized feed; it won’t scale to thousands of posts and can "
        "thrash during a busy event evening. Options: apply granular realtime payloads to local state, paginate/window "
        "the feed, or debounce refetches. Worth it, or premature for this audience?",
        "PERF", LAKE)]
    F += [idea("Sequential uploads &amp; N+1 inserts",
        "Media files upload one-by-one and each <font face='Courier' size=9>post_media</font> / "
        "<font face='Courier' size=9>post_tags</font> row is inserted in its own round-trip. Batching the inserts and "
        "uploading in parallel (with a concurrency limit) would speed up multi-photo posts noticeably on phone networks.",
        "PERF", LAKE)]
    F += [idea("No image CDN / responsive sizes",
        "Photos are client-compressed to ~1920px and served at full size from the mini for every view, including tiny "
        "grid thumbnails. A thumbnail tier (or a CDN/transform in front of the mini) would cut data use a lot on the "
        "feed. Is a CDN worth adding given everything else is free-tier?",
        "PERF", LAKE)]

    F += [sp(2), Paragraph("Security &amp; privacy", H3)]
    F += [idea("“Public read” still exposes member contact info at the API",
        "A <b>UI privacy wall</b> now hides sensitive info from guests (<font face='Courier' size=9>Guard.tsx</font> / "
        "<font face='Courier' size=9>lib/privacy.ts</font>: “Sign in” chips, first-name-only, walled Posts &amp; Pay — "
        "see Section 3). But that’s the <i>UI layer</i> only: the <font face='Courier' size=9>profiles</font> columns "
        "(phone, Venmo/Zelle/PayPal) are still world-readable at the Supabase API, so a determined fetch still sees "
        "them. The remaining step is server-side — column-level RLS / gated reads (members-only for contact fields), "
        "keeping personal data out of the client bundle. Given it’s a small trusted family, is that the right next "
        "step, or overkill?",
        "SECURITY", WINE)]
    F += [idea("Media server trusts any valid token",
        "Upload auth checks only that the bearer token is a valid Supabase user — not that they’re a member in "
        "good standing, and there’s no per-user rate limit or content-type allowlist beyond the size cap. Low risk "
        "for a private link, but a cheap hardening target.",
        "SECURITY", WINE)]

    F += [sp(2), Paragraph("Architecture &amp; ops", H3)]
    F += [idea("The Mac mini is a single point of failure",
        "Photos live on one machine behind a home tunnel; if it sleeps, loses power, or the tunnel URL ever changes, "
        "stored links break (and there’s no off-box backup beyond Time Machine). It’s a great cost play — but "
        "would you keep it, or move to cheap object storage (R2/B2) with the mini as a cache?",
        "OPS", CAMPFIRE)]
    F += [idea("Two flags to reason about: READ_ONLY vs isSupabaseConfigured",
        "Feature availability is gated by both a hand-set <font face='Courier' size=9>READ_ONLY</font> boolean and a "
        "runtime <font face='Courier' size=9>isSupabaseConfigured</font> check. Now that auth is live, the two can "
        "disagree in confusing ways. Collapsing to one source of truth (derive read-only from config + per-feature "
        "capability) would simplify the mental model.",
        "CLEANUP", CAMPFIRE)]
    F += [idea("Mirrored season code across two repos",
        "<font face='Courier' size=9>festSeason.ts</font> + event seed data are duplicated byte-for-byte in a separate "
        "<font face='Courier' size=9>family-fest</font> repo. The merge into this app is done; retiring that repo (or "
        "extracting a shared package) removes a real drift risk.",
        "CLEANUP", CAMPFIRE)]

    F += [sp(6), callout("The big-picture question",
        [P("The roadmap still wants <b>“email everyone by name”</b> (the member directory now exists, #75 — the "
           "compose-and-send doesn’t), a committee request→approve loop with live rosters, Google-Drive-fed "
           "announcements, and Android web-push. All are designed as isolated backend seams. <b>If you were picking "
           "the next thing to build — for maximum payoff to a non-technical family — what would it be?</b>", BODY)],
        accent=PINE)]
    F += [sp(10), Rule(BORDER, 0.8, space=6),
          P("<font color='#5b6b63'><i>Thanks for reading. Happy to walk through any part of the code — it’s all "
            "TypeScript, and the README / CLAUDE.md / NEXT-STEPS.md in the repo go deeper on each seam.</i></font>", SMALL)]

    return F
