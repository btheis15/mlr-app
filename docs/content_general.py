# -*- coding: utf-8 -*-
"""Content for the GENERAL-AUDIENCE edition of the MLR App Overview PDF.

Same engine and look as content.py, but written for a sharp non-engineer —
the design choices, the safeguards, and the trade-offs in plain English, with
a legal/evidentiary and a light Renaissance-fair frame. Returns a flat list of
flowables. Built by build_general_pdf.py."""

import os
from reportlab.platypus import (
    Paragraph, Spacer, PageBreak, NextPageTemplate, Table, TableStyle, KeepTogether, Image,
)
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER

from build_overview_pdf import (
    H1, H3, BODY, SMALL, KICKER, COVER_TITLE, COVER_SUB, TOC, TOCNUM,
    PINE, INK, CAMPFIRE, WINE, AZURE, LAKE, MUTE, BORDER,
    chip, callout, bullets, data_table, Rule, MARGIN, PAGE_W,
    style, clean_text,
)

DOCS = os.path.dirname(os.path.abspath(__file__))

def P(t, s=BODY): return Paragraph(clean_text(t), s)
def sp(h=6): return Spacer(1, h)

# ── Phone-screenshot figures (docs/screens/*.png) ────────────────────────────
SHOT_W = 1.45 * inch            # display width; captures are 700x1555 (a phone screen)
SHOT_H = SHOT_W * 1555 / 700
_SHOTCAP = style("ShotCap", fontName="Helvetica", fontSize=8.3, leading=10.5,
                 textColor=INK, alignment=TA_CENTER, spaceBefore=5)

def _shot(filename, label, text):
    """A framed phone screenshot with a step caption — one grid cell."""
    img = Image(os.path.join(DOCS, "screens", filename), width=SHOT_W, height=SHOT_H)
    framed = Table([[img]], colWidths=[SHOT_W])
    framed.setStyle(TableStyle([
        ("BOX", (0,0), (-1,-1), 0.6, BORDER),
        ("LEFTPADDING",(0,0),(-1,-1),0), ("RIGHTPADDING",(0,0),(-1,-1),0),
        ("TOPPADDING",(0,0),(-1,-1),0), ("BOTTOMPADDING",(0,0),(-1,-1),0),
    ]))
    cap = Paragraph(clean_text(f"<b>{label}</b>  {text}"), _SHOTCAP)
    return [framed, cap]

def screens_grid(cells):
    """Lay phone-screenshot cells two-per-row."""
    rows = [cells[i:i+2] for i in range(0, len(cells), 2)]
    for r in rows:
        while len(r) < 2:
            r.append("")
    avail = PAGE_W - 2*MARGIN
    t = Table(rows, colWidths=[avail/2, avail/2])
    t.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("ALIGN", (0,0), (-1,-1), "CENTER"),
        ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 12),
    ]))
    return t

def section(num, title, kicker=None):
    out = [Spacer(1, 2)]
    out.append(Paragraph(f"SECTION {num}", KICKER))
    out.append(Paragraph(title, H1))
    out.append(Rule(PINE, 1.4, space=8))
    if kicker:
        out.append(Paragraph(kicker, style("Lede", fontName="Helvetica-Oblique",
                    fontSize=10.5, leading=15, textColor=MUTE, spaceAfter=8)))
    return out

def idea(title, body, tag, tagcolor):
    head = Table([[Paragraph(clean_text(title), style("IdeaT", fontName="Helvetica-Bold",
                   fontSize=11, leading=14, textColor=INK)),
                   chip(tag, tagcolor)]], colWidths=[None, 1.15*inch])
    head.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"MIDDLE"),
                              ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
                              ("ALIGN",(1,0),(1,0),"RIGHT")]))
    return KeepTogether([head, sp(2), P(body, BODY), sp(8)])


def build_story():
    F = []

    # ───────────────────────────── COVER ─────────────────────────────
    F += [
        Spacer(1, 2.5*inch),
        Paragraph("Muskellunge", COVER_TITLE),
        Paragraph("Lake Resort", COVER_TITLE),
        Spacer(1, 10),
        Paragraph("The family’s private app — a guided tour", COVER_SUB),
        Spacer(1, 6),
        Paragraph('<font color="#9fc4b1">What it does · who it’s for · how it keeps the family’s world private · where it’s headed</font>',
                  style("CoverNote", fontName="Helvetica", fontSize=11, leading=15, textColor=colors.white)),
        Spacer(1, 1.6*inch),
        Paragraph('<font color="#cfe0d6">EST. 1987  ·  Tomahawk, Wisconsin  ·  A private app for the family &amp; resort community</font>',
                  style("CoverFoot", fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=colors.white)),
        Paragraph('<font color="#bcd2c6">Written for the non-engineer — the ideas, the safeguards, and the honest trade-offs, in plain English. No code required.</font>',
                  style("CoverFoot2", fontName="Helvetica-Oblique", fontSize=9, leading=13, textColor=colors.white)),
        NextPageTemplate("body"),
        PageBreak(),
    ]

    # ───────────────────────────── TOC ─────────────────────────────
    F += [Paragraph("Contents", H1), Rule(PINE, 1.4, space=8), sp(6)]
    toc = [
        ("1", "What it is &amp; who it’s for", "The app in one page"),
        ("2", "A walk through the app", "The four rooms, and how you move around"),
        ("3", "Getting in — the guest-list model", "Look freely; a verified email lets you take part"),
        ("4", "The family feed", "A private, shared album that stays in sync"),
        ("5", "Reaching &amp; paying each other", "Tap a name to call, text, or pay"),
        ("6", "Announcements", "A notice board that never nags"),
        ("7", "Family Fest — the festival colors", "When the app changes its garb for the reunion"),
        ("8", "How it’s built, in plain terms", "The moving parts, without the jargon"),
        ("9", "Who can see what", "Privacy &amp; access — and an honest limit"),
        ("10", "Where everything lives", "The cloud, the home server, and what it costs"),
        ("11", "Honest trade-offs &amp; open questions", "Where I’d most value your read"),
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
          [P("This is the non-technical companion to a more engineering-focused version. "
             "Sections 1–7 are what the app does and how it feels to use; sections 8–10 are how it’s put "
             "together and where it lives; section 11 is a short list of judgment calls I’d genuinely value "
             "your read on — especially from the law-and-evidence side.", BODY)],
          accent=CAMPFIRE, bg=colors.HexColor("#fbf0e8"))]
    F += [sp(16)]

    # ───────────────── SECTION 1 — WHAT IT IS ─────────────────
    F += section("1", "What it is &amp; who it’s for",
                 "A small, private app for one family’s Northwoods resort — and the week-long reunion at its heart.")
    F += [P(
        "<b>Muskellunge Lake Resort (MLR)</b> is a real family resort near Tomahawk, Wisconsin — the original "
        "light-housekeeping cabins on the lake, established 1987. This app is a private, members-first space for the "
        "family and community around it. Think of it less as a public website and more as an invitation-only club: "
        "anyone with the link can look around, but doing anything that touches other people — posting a photo, "
        "replying, signing up for a meal — takes a <b>verified email</b>. It’s the difference between walking through "
        "the lobby and being handed a key.")]
    F += [P(
        "It does double duty. Most of the year it’s the <b>year-round resort companion</b> — what to do, where to eat, "
        "who’s on which volunteer committee, how to book a tee time. Once a year it becomes the home base for "
        "<b>Family Fest</b>, a week-long reunion, which lives <i>inside</i> the same app rather than off in a separate place.")]
    F += [sp(2), Paragraph("The two halves, one app", H3)]
    F += [data_table(
        ["", "Year-round resort", "Family Fest week"],
        [
            [("Feel", "b"), "Forest-green Northwoods heritage", "Renaissance-fair parchment &amp; heraldry"],
            [("What’s there", "b"), "Activities, dining, committees, tee times", "The week’s schedule, the feast nights, dues, the gathering itself"],
            [("Mood", "b"), "Calm and evergreen", "Festive and a little ceremonial"],
        ],
        [0.18, 0.40, 0.42])]
    F += [sp(8), callout("The one idea that ties it together",
        [P("Rather than build two apps, Family Fest is treated as a <b>“season” of the resort</b> that rises and fades "
           "across the calendar — quiet for most of the year, then a gradual build-up, the full festival week, and a "
           "gentle wind-down. The app quietly reshapes itself to match the time of year, the way a realm changes with "
           "its seasons. Full detail in Section 7.", BODY)], accent=PINE)]
    F += [sp(8), Paragraph("Where things stand today", H3)]
    F += [P(
        "The app is <b>live and in real use</b>. People sign in, build a small profile, and share photos and video in "
        "a common feed; the family’s pictures are kept on a modest computer at the house rather than rented cloud "
        "storage. A few features are still being finished (joining a committee from inside the app, meal RSVPs) and "
        "show a tasteful “coming soon,” so nothing ever looks broken.")]
    F += [PageBreak()]

    # ───────────────── SECTION 2 — THE MAP ─────────────────
    F += section("2", "A walk through the app",
                 "Four tabs along the bottom carry the whole app; nothing is ever more than a tap from home.")
    F += [Paragraph("The four rooms", H3)]
    F += [data_table(
        ["Tab", "What you’ll find there"],
        [
            [("Home", "b"), "The front porch — the resort’s logo, a one-tap “share this app with family,” the Family Fest status, and cards leading to everything else."],
            [("Posts", "b"), "The family feed — the shared wall of photos, videos, comments, and reactions."],
            [("Family Fest", "b"), "The whole reunion week in one view; during the event it wears a small, living “pulse.”"],
            [("Profile", "b"), "You — your photo, your name, how you like to be reached or paid, your alert settings, and (for organizers) the admin tools."],
        ],
        [0.22, 0.78])]
    F += [sp(6), P(
        "A handful of year-round extras are reached from the Home porch rather than getting their own tab: "
        "<b>Activities</b> (things to do, by category), <b>Dining &amp; amenities</b>, the volunteer <b>Committees</b>, "
        "the season-prep <b>Work Weekends</b>, and <b>Tee Times</b> (a hand-off into the local club’s booking page, "
        "pre-set to a chosen day).")]
    F += [sp(8), Paragraph("Inside Family Fest", H3)]
    F += [P("The reunion lives on one flowing page that answers a single question — “what’s happening, and what do I do today?”")]
    F += [bullets([
        "<b>Today, in full</b> — during the week, the top of the page shows the day (“Day 3 of 5”) and every one of "
        "today’s events: the time, the place, what to bring, and who’s running it, with a tap to call or text them — "
        "plus the night’s feast and its head chef.",
        "<b>The rest of the week</b> — a tap-to-open list of the days; open one to see its events and dinner, each "
        "leading to its own detail page (an event; or a feast night with the menu, prep-vs-serve timing, the cooking "
        "“houses,” and the chef’s contact).",
    ])]
    F += [sp(4), callout("So you can never get lost",
        [P("Every detail page carries a clearly-labeled “back” link that names where it returns to, and the bottom "
           "row of tabs is always present. There’s no maze — you’re always one tap from the porch.", BODY)],
        accent=AZURE, bg=colors.HexColor("#eef1f8"))]
    F += [PageBreak()]

    # ───────────────── A QUICK VISUAL TOUR (unnumbered) ─────────────────
    F += [Paragraph("A quick visual tour", H1), Rule(PINE, 1.4, space=8)]
    F += [P("What a normal first visit looks like, four screens at a time — captured from the app itself, on a phone.")]
    F += [sp(4), KeepTogether(screens_grid([
        _shot("home.png",  "1 · Open it",
              "The home “porch” — resort, festival status, links to everything."),
        _shot("getin.png", "2 · Get in",
              "Add your name &amp; email; a one-time code signs you in — no password."),
        _shot("posts.png", "3 · The family feed",
              "Photos, videos, comments and reactions — members only."),
        _shot("fest.png",  "4 · Family Fest",
              "The reunion week in its own Renaissance colors."),
    ]))]
    F += [P("<font color='#5b6b63'><i>Screens shown signed-out, with sample family content; the look is the same once you’re in.</i></font>", SMALL)]
    F += [PageBreak()]

    # ───────────────── SECTION 3 — GETTING IN ─────────────────
    F += section("3", "Getting in — the guest-list model",
                 "Public to look, verified to take part. No passwords — a one-time code to your email, and you stay signed in.")
    F += [P(
        "Identity is asked for <b>only when it’s needed</b>, never as a wall at the front door. You can wander the "
        "whole app without signing in. The moment you try to do something that affects other people — post a photo, "
        "react, sign up for a meal — a sign-in panel slides up. It’s a need-to-know bar, not a vault.")]
    F += [sp(2), Paragraph("How it feels", H3)]
    F += [bullets([
        "Enter your name and email. A <b>six-digit code</b> lands in your inbox; type it in, and you’re a verified member.",
        "There’s <b>no password</b> to invent or forget. The app remembers you on that device, so you’d only repeat "
        "the code on a new phone. (That choice is deliberate — it’s gentle on the less tech-comfortable relatives.)",
    ])]
    F += [sp(2), Paragraph("Why a code instead of a password", H3)]
    F += [P(
        "The only thing the app truly needs to know is that a <b>real, reachable email belongs to you</b>. A one-time "
        "code proves exactly that — without the burden, and the security baggage, of passwords nobody remembers. This "
        "is intentionally <i>not</i> a high-security system; it’s a trusted-family setting, and it’s honest about that.")]
    F += [sp(2), Paragraph("Organizers", H3)]
    F += [P(
        "A few trusted family members are marked as <b>organizers</b> (admins). Crucially, that status is set in the "
        "system itself — it cannot be granted from inside the app — so no one can quietly promote themselves. "
        "Organizers can post announcements and manage the member list.")]
    F += [PageBreak()]

    # ───────────────── SECTION 4 — THE FEED ─────────────────
    F += section("4", "The family feed",
                 "The social heart of the app — a members-only wall that behaves like a small, private Instagram for the family.")
    F += [P("Open the Posts tab and you get a shared, living scrapbook. It supports:")]
    F += [bullets([
        "<b>Photo &amp; video posts</b> — several photos to a post in a swipeable gallery; tap any one for full screen.",
        "<b>Tagging people</b> — note who’s in a photo; a “tagged me” filter gathers every post you appear in.",
        "<b>Comments &amp; reactions</b> — a small set of emoji reactions; tap one to see who reacted.",
        "<b>A faithful timeline</b> — posts arrange themselves by day (“Today,” “Yesterday,” a date). And if you post a "
        "photo weeks late, you can date it to <i>when it actually happened</i>, so the family’s record stays in true "
        "chronological order rather than bunching at the day you got around to it.",
        "<b>Editing &amp; removal</b> — the author (or an organizer) can fix a caption, add or remove photos, or take a post down.",
        "<b>Sharing outward</b> — hand a photo to your phone’s normal share sheet (Messages, Instagram…), or to the family Facebook group.",
    ])]
    F += [sp(4), Paragraph("It stays in sync on its own", H3)]
    F += [P(
        "When someone posts from one phone, it appears on everyone else’s within moments — no refreshing, no “pull to "
        "update.” And because names and faces are looked up <i>live</i>, if someone changes their nickname or photo it "
        "updates everywhere they appear, even on years-old posts. The record reads as one consistent whole.")]
    F += [sp(2), Paragraph("A note on the photos themselves", H3)]
    F += [P(
        "Before a photo is sent, the phone quietly tidies and shrinks it — faster to upload, and it sidesteps a common "
        "iPhone color quirk. The files themselves are kept on the family’s own computer at the house (more on that "
        "custody choice in Section 10).")]
    F += [PageBreak()]

    # ───────────────── SECTION 5 — CONTACT & PAY ─────────────────
    F += section("5", "Reaching &amp; paying each other",
                 "Tap anyone’s name or photo, anywhere in the app, to reach or pay them — with their own preferred method first.")
    F += [P(
        "Every name and face in the app is tappable. Tapping one opens a small <b>contact card</b> that turns whatever "
        "that person chose to share into one-tap actions:")]
    F += [bullets([
        "<b>Reach them</b> — Text, Call, or Email.",
        "<b>Pay them</b> — Venmo, Zelle, Apple Cash, Cash App, or PayPal, each as its own button.",
        "<b>Their preference, first</b> — each person marks how they’d <i>like</i> to be reached or paid, and that "
        "option floats to the top, flagged. It’s a small courtesy that removes a lot of guesswork.",
    ])]
    F += [sp(4), P(
        "Everything here is optional and self-managed. <b>No banking details ever live in the app</b> — the buttons "
        "simply hand off to the person’s own Venmo or Messages, the way tapping a phone number opens your dialer. And "
        "a stranger who hasn’t signed in sees none of it; they get a polite “Sign in” prompt instead (see Section 9).")]
    F += [sp(4), callout("One pattern, reused everywhere",
        [P("This same contact card is what powers the “who’s in charge” lines on committees and the “head chef” for "
           "each feast night. Learn it once, and it works the same all through the app.", BODY)], accent=PINE)]
    F += [PageBreak()]

    # ───────────────── SECTION 6 — ANNOUNCEMENTS ─────────────────
    F += section("6", "Announcements",
                 "A notice at the top of every screen — and a simple way for organizers to post to it without nagging.")
    F += [P(
        "Organizers can post a notice — a loud <b>alert</b> for something time-sensitive, or a quiet <b>note</b> for "
        "an FYI. It appears as a banner across the top of the app for everyone. Each person can <b>dismiss</b> a notice "
        "once they’ve read it, and it won’t come back — the app says its piece once and then lets it go, rather than "
        "pestering people who’ve already seen it.")]
    F += [sp(2), P(
        "The next step already designed for this: the same post will also <b>email the members who’ve opted in</b>, so "
        "a last-minute change (“dinner moved to 6:30”) reaches the people who aren’t in the app that day.")]
    F += [PageBreak()]

    # ───────────────── SECTION 7 — SEASON ENGINE ─────────────────
    F += section("7", "Family Fest — when the app puts on its festival colors",
                 "Once a year the whole app changes its garb for the reunion week — and it does so on its own, by the calendar.")
    F += [P(
        "A single, quiet rule decides the app’s mood on any given day of the year. As Family Fest approaches, the app "
        "moves through four phases, with no one having to flip a switch:")]
    F += [data_table(
        ["Phase", "When", "What the app does"],
        [
            [("Off-season", "b"), "More than ~2 months out", "Everything resort-normal, with just a quiet Family Fest note on the porch."],
            [("Planning", "b"), "The run-up", "A partial takeover: rally volunteers, preview the plan, collect dues."],
            [("Live", "b"), "During the week", "The full takeover — “Day 3 of 5” and today’s events take over the home screen, with a pulse on the tab."],
            [("Afterglow", "b"), "A couple of weeks after", "The takeover lingers, gently nudging “post the photos you didn’t get to.”"],
        ],
        [0.20, 0.26, 0.54])]
    F += [sp(8), Paragraph("The festival wears its own costume", H3)]
    F += [P(
        "Where the year-round resort is forest-green and woodsy, the Family Fest section turns to <b>parchment, "
        "heraldic wine and azure, and a Roman-serif display type</b> — a Renaissance-fair feel that suits a week of "
        "feasts, gatherings, and (yes) a scavenger hunt. The cooking teams are even organized into <b>“houses.”</b> "
        "It’s the same app, but it changes its colors and its lettering the moment you step into that wing — a small "
        "bit of theater that makes the week feel like an occasion.")]
    F += [sp(4), callout("A builder’s nicety: time-travel",
        [P("There’s a hidden control that lets an organizer tell the app “show me as if it were the third day of the "
           "festival” — so the whole live-week experience can be previewed and polished in the dead of winter, months "
           "before anyone arrives. It’s how you make sure the big week works <i>before</i> it’s the big week.", BODY)],
        accent=CAMPFIRE, bg=colors.HexColor("#fbf0e8"))]
    F += [PageBreak()]

    # ───────────────── SECTION 8 — HOW IT'S BUILT ─────────────────
    F += section("8", "How it’s built, in plain terms",
                 "Enough to picture how it works and why it’s sturdy — without the jargon.")
    F += [P(
        "It’s a <b>web app that installs to a phone’s home screen</b> like a normal app, so there’s nothing to "
        "download from an app store and updates are instant for everyone. (For the technically curious: it’s built on "
        "modern, mainstream web technology — the same family of tools behind a great many apps you already use.) A few "
        "principles are worth knowing, because they shape how it feels:")]
    F += [bullets([
        "<b>One identity, used everywhere.</b> A person is a single profile — change your name or photo once, and it "
        "updates everywhere you appear. No duplicate accounts, no stale copies.",
        "<b>Built to bend, not break.</b> If a piece of the system is briefly unavailable, the app still lets you look "
        "around rather than throwing an error. The public, browse-only experience is designed to almost never go dark.",
        "<b>A calm, consistent look.</b> One light theme throughout (deliberately no “dark mode”), one place that "
        "defines every color, and small, tasteful animations — a gentle “give” when you tap, sections that fold open "
        "smoothly — so it feels responsive and alive without being flashy.",
        "<b>Respectful of the device and the person.</b> It honors the phone’s “reduce motion” accessibility setting, "
        "fits neatly around camera notches, and is mindful of older phones and slower connections.",
    ])]
    F += [PageBreak()]

    # ───────────────── SECTION 9 — WHO CAN SEE WHAT ─────────────────
    F += section("9", "Who can see what",
                 "The app is private by invitation — and what an outsider can see is deliberately limited.")
    F += [P(
        "<b>Two postures: looking versus doing.</b> Anyone with the link can look around — it isn’t a fortress, by "
        "design — but only verified members can act. That’s a deliberate, low-friction choice for a trusted family, "
        "and the app is honest that it’s not a high-security system.")]
    F += [sp(2), Paragraph("What a stranger (or a web crawler) is kept from", H3)]
    F += [bullets([
        "The family <b>photo feed</b> and the <b>payment screens</b> are closed entirely until you sign in.",
        "Personal contact details — <b>phone, email, payment handles</b> — are hidden, replaced with a “Sign in” prompt.",
        "Even people’s <b>last names</b> and the <b>locations of events</b> are withheld from guests.",
    ])]
    F += [P(
        "In short: a casual passer-by sees a tasteful resort brochure, not the family’s private life. And there are "
        "guardrails against overreach from the inside, too — organizer status can’t be self-granted, and members’ "
        "email addresses are kept out of the openly-readable part of the system, visible only to organizers.")]
    F += [sp(4), callout("An honest limit — the kind worth flagging to a careful reader",
        [P("Today these protections are enforced at the <b>screen level</b>: the sensitive things are reliably hidden "
           "from view. A determined, technically-skilled person could still pull some of the underlying records "
           "directly, because the data was built to be openly readable for the sake of simplicity. Closing that gap — "
           "so the information is not merely <i>hidden</i> but truly <i>withheld</i> at the data level — is the clearly "
           "identified next step. For a small, trusted family this is a defensible order of operations; for anything "
           "more sensitive, it would come first. I’d value your read on where that line should sit here.", BODY)],
        accent=WINE, bg=colors.HexColor("#f7ecec"))]
    F += [PageBreak()]

    # ───────────────── SECTION 10 — WHERE IT LIVES ─────────────────
    F += section("10", "Where everything lives — and what it costs",
                 "A frugal mix of free services plus one small computer at the house — and a deliberate choice about custody.")
    F += [P(
        "The app is split across a few places, each chosen on purpose:")]
    F += [bullets([
        "<b>What you see</b> (the screens themselves) is delivered by free, fast, professional hosting services.",
        "<b>Accounts, profiles, and the words of posts</b> live in a managed cloud database.",
        "<b>The actual photo and video files</b> live on a small computer at the house — a Mac mini — reached over a "
        "secure private tunnel.",
    ])]
    F += [sp(2), Paragraph("Why keep the photos at home", H3)]
    F += [P(
        "Cloud storage gets expensive — and capped — for a media-heavy family album that grows every summer. Keeping "
        "the files on a machine the family <i>owns</i> sidesteps that entirely: the only real limit is the size of the "
        "hard drive. There’s a nice principle in it, too — the family literally holds custody of its own pictures.")]
    F += [sp(2), Paragraph("What it costs", H3)]
    F += [data_table(
        ["Piece", "What it does", "Cost"],
        [
            [("Web hosting", "b"), "Delivers the app’s screens, fast, worldwide", ("free", "b")],
            [("Cloud database", "b"), "Holds accounts, profiles, and post text", ("free", "b")],
            [("Email codes", "b"), "Sends the one-time sign-in codes", ("free", "b")],
            [("Secure tunnel", "b"), "Connects the app to the home computer safely", ("free", "b")],
            [("The Mac mini", "b"), "Stores all the photos and videos", "electricity"],
            [("A custom web address", "b"), "Optional — a friendlier link than the default", ("optional", "b")],
        ],
        [0.27, 0.54, 0.19])]
    F += [sp(6), callout("Kept dependable, and awake",
        [P("The home computer is set up to restart its own software if it ever crashes and to keep the machine from "
           "sleeping; there’s a small control panel to start it, stop it, and watch activity. And because the free "
           "cloud database would otherwise nod off during the quiet off-season, a tiny automated “heartbeat” checks in "
           "every few days to keep it awake — so the app is ready the moment the family is.", BODY)], accent=PINE)]
    F += [PageBreak()]

    # ───────────────── SECTION 11 — TRADE-OFFS ─────────────────
    F += section("11", "Honest trade-offs &amp; open questions",
                 "The rough edges and the judgment calls — the parts where I’d most value your read. None are emergencies; all are real.")
    F += [idea("Hidden today, not yet truly withheld",
        "As in Section 9, sensitive details are hidden at the screen level, but the underlying records were built to "
        "be openly readable, so a skilled person could still reach some of them directly. Tightening that at the data "
        "level is the obvious next step. For a small, trusted family, is screen-level privacy enough for now — or "
        "worth hardening sooner than the fun features?",
        "PRIVACY", WINE)]
    F += [idea("The photos live on one machine",
        "Keeping the family’s pictures on a single home computer is a lovely cost-and-custody choice — but it’s also a "
        "single point of failure. If that machine fails, loses power, or its address changes, older photo links could "
        "break, and the only backup is a local one. Worth adding inexpensive cloud storage purely as a safety net, or "
        "keep the savings and the self-reliance?",
        "RELIABILITY", CAMPFIRE)]
    F += [idea("The feed reloads fully on every change",
        "Each new post or reaction prompts the feed to reload itself completely. That’s perfectly fine for a "
        "family-sized album, but it wouldn’t scale to thousands of posts and could feel sluggish on a very busy "
        "festival evening. Worth refining now, or a problem to leave until it’s actually a problem?",
        "PERFORMANCE", LAKE)]
    F += [idea("A little housekeeping to reduce future mistakes",
        "There are two overlapping “on/off” settings in the code that could be merged into one, and some of the "
        "festival logic still exists in an older, separate copy of the project that ought to be retired. Neither is "
        "visible to anyone using the app — but tidying them lowers the chance of a confusing slip-up down the road.",
        "UPKEEP", AZURE)]

    F += [sp(6), callout("The big-picture question",
        [P("The next things on the list are: letting anyone <b>email the whole family by name</b> (so nobody’s working "
           "off a stale address book), a <b>request-and-approve flow</b> for joining committees, pulling "
           "<b>announcements from a shared document</b>, and <b>phone push-notifications</b>. If you were choosing what "
           "to build next for the most payoff to a non-technical family, what would it be?", BODY)], accent=PINE)]
    F += [sp(10), Rule(BORDER, 0.8, space=6),
          P("<font color='#5b6b63'><i>Thanks for reading. I’d be glad to walk through any of this in person — and "
            "especially to hear where your eye, from the law-and-evidence side, lands on the trade-offs above.</i></font>", SMALL)]

    return F
