# -*- coding: utf-8 -*-
"""Content for the GENERAL-AUDIENCE edition of the MLR App Overview PDF.

Same engine and look as content.py, but written for a sharp non-engineer who
will be one of the app's admins — what the app does and how it feels to use,
illustrated with a screenshot beside nearly every part. Includes a day-by-day
walkthrough of how the app reshapes itself across the Family Fest week, a
plain-English look at privacy, and a short list of common questions. Returns a
flat list of flowables. Built by build_general_pdf.py."""

import os
from reportlab.platypus import (
    Paragraph, Spacer, PageBreak, NextPageTemplate, Table, TableStyle, KeepTogether, Image,
)
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.utils import ImageReader

from build_overview_pdf import (
    H1, H3, BODY, SMALL, KICKER, COVER_TITLE, COVER_SUB, TOC, TOCNUM,
    PINE, INK, CAMPFIRE, WINE, AZURE, LAKE, MUTE, BORDER,
    chip, callout, bullets, data_table, Rule, MARGIN, PAGE_W,
    style, clean_text,
)

DOCS = os.path.dirname(os.path.abspath(__file__))
AVAIL = PAGE_W - 2*MARGIN

def P(t, s=BODY): return Paragraph(clean_text(t), s)
def sp(h=6): return Spacer(1, h)

# ── Phone-screenshot figures (docs/screens/*.png) ────────────────────────────
_SHOTCAP = style("ShotCap", fontName="Helvetica-Oblique", fontSize=7.8, leading=10,
                 textColor=MUTE, alignment=TA_CENTER, spaceBefore=4)

def fig(filename, w=1.5*inch, caption=None):
    """A framed screenshot (aspect preserved), optionally captioned. Returns flowables."""
    path = os.path.join(DOCS, "screens", filename)
    iw, ih = ImageReader(path).getSize()
    img = Image(path, width=w, height=w*ih/iw)
    framed = Table([[img]], colWidths=[w])
    framed.setStyle(TableStyle([
        ("BOX", (0,0), (-1,-1), 0.6, BORDER),
        ("LEFTPADDING",(0,0),(-1,-1),0), ("RIGHTPADDING",(0,0),(-1,-1),0),
        ("TOPPADDING",(0,0),(-1,-1),0), ("BOTTOMPADDING",(0,0),(-1,-1),0),
    ]))
    cells = [framed]
    if caption:
        cells.append(Paragraph(clean_text(caption), _SHOTCAP))
    return cells

def figrow(text_flowables, filename, side="right", text_frac=0.60, shot_w=1.5*inch, caption=None):
    """A two-column block: explanatory text beside a phone screenshot."""
    fcells = fig(filename, w=shot_w, caption=caption)
    tw = AVAIL*text_frac
    iw = AVAIL - tw
    if side == "right":
        data = [[text_flowables, fcells]]; cols = [tw, iw]; imgcol = 1
    else:
        data = [[fcells, text_flowables]]; cols = [iw, tw]; imgcol = 0
    t = Table(data, colWidths=cols)
    t.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("ALIGN", (imgcol,0), (imgcol,0), "CENTER"),
        ("LEFTPADDING", (0,0), (-1,-1), 0), ("RIGHTPADDING", (0,0), (-1,-1), 0),
        ("TOPPADDING", (0,0), (-1,-1), 2), ("BOTTOMPADDING", (0,0), (-1,-1), 2),
        ("LEFTPADDING", (imgcol,0), (imgcol,0), 8),
        ("RIGHTPADDING", (imgcol,0), (imgcol,0), 8),
    ]))
    return KeepTogether(t)

def shotsrow(items, w):
    """A row of equal-width captioned screenshots. items: list of (filename, caption)."""
    cells = [fig(f, w, c) for f, c in items]
    t = Table([cells], colWidths=[AVAIL/len(cells)]*len(cells))
    t.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("ALIGN", (0,0), (-1,-1), "CENTER"),
        ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ]))
    return KeepTogether(t)

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

def qa(q, a):
    """One plain-English question + answer, kept together."""
    return KeepTogether([
        P(f"<b>{q}</b>", style("QAQ", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=INK)),
        sp(1),
        P(a, BODY),
        sp(8),
    ])


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
        Paragraph('<font color="#9fc4b1">What it does · who it’s for · who can see what · how it’s built</font>',
                  style("CoverNote", fontName="Helvetica", fontSize=11, leading=15, textColor=colors.white)),
        Spacer(1, 1.6*inch),
        Paragraph('<font color="#cfe0d6">EST. 1987  ·  Tomahawk, Wisconsin  ·  A private app for the family &amp; resort community</font>',
                  style("CoverFoot", fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=colors.white)),
        Paragraph('<font color="#bcd2c6">Written in plain English — the ideas with a screenshot of nearly every part. No technical background needed.</font>',
                  style("CoverFoot2", fontName="Helvetica-Oblique", fontSize=9, leading=13, textColor=colors.white)),
        NextPageTemplate("body"),
        PageBreak(),
    ]

    # ───────────────────────────── TOC ─────────────────────────────
    F += [Paragraph("Contents", H1), Rule(PINE, 1.4, space=8), sp(6)]
    toc = [
        ("1",  "What it is &amp; who it’s for", "The app in one page"),
        ("2",  "A walk through the app", "The rooms, and how you move around"),
        ("3",  "Getting in", "Look freely; a verified email lets you take part"),
        ("4",  "The family feed", "A shared album that stays in sync"),
        ("5",  "Reaching, paying &amp; emailing each other", "Tap a name to call, text, or pay"),
        ("6",  "Announcements", "A notice board that never nags"),
        ("7",  "Notifications", "Your own “what happened” list — exactly as much as you want"),
        ("8",  "Booking a cabin", "Ask for a room; an organizer says yes"),
        ("9",  "Family Fest — the festival colors", "When the app changes its garb for the reunion"),
        ("10", "The week, day by day", "How the app reshapes itself as the day changes"),
        ("11", "Is it private?", "Who can see what, in plain terms"),
        ("12", "How it’s built, in plain terms", "The moving parts, without the jargon"),
        ("13", "What you can do as an organizer", "The keys you’ll hold"),
        ("14", "Where everything lives", "The cloud, the home server, and what it costs"),
        ("15", "Common questions", "Quick answers to the things people ask first"),
        ("16", "Honest trade-offs &amp; open questions", "The judgment calls"),
    ]
    rows = []
    for n, t, sub in toc:
        rows.append([Paragraph(n, TOCNUM),
                     Paragraph(f"{t}<br/><font color='#5b6b63' size=8.5>{sub}</font>", TOC)])
    tb = Table(rows, colWidths=[0.4*inch, None])
    tb.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6.5),
        ("TOPPADDING", (0,0), (-1,-1), 1),
        ("LINEBELOW", (0,0), (-1,-2), 0.4, BORDER),
    ]))
    F += [tb]
    F += [sp(12), callout("How to read this",
          [P("This is the non-technical companion to a more engineering-focused version, illustrated with a "
             "screenshot of nearly every part — all captured from the app itself. Sections 1–11 are what the app "
             "does and how it feels (including how it transforms across the festival week, and who can see what); "
             "12–14 are how it’s built, what you’d do as an organizer, and where it lives; 15 answers the questions "
             "people ask first; 16 is a short list of open questions.", BODY)],
          accent=CAMPFIRE, bg=colors.HexColor("#fbf0e8"))]
    F += [sp(14)]

    # ───────────────── SECTION 1 — WHAT IT IS ─────────────────
    F += section("1", "What it is &amp; who it’s for",
                 "A small, private app for one family’s Northwoods resort — and the week-long reunion at its heart.")
    F += [figrow([
        P("<b>Muskellunge Lake Resort (MLR)</b> is a real family resort near Tomahawk, Wisconsin — the original "
          "light-housekeeping cabins on the lake, established 1987. This app is a private, members-first space for "
          "the family and community around it: think less a public website, more an invitation-only club. Anyone "
          "with the link can look around; doing anything that touches other people — posting a photo, replying, "
          "signing up for a meal — takes a <b>verified email</b>."),
    ], "home.png", side="right", caption="The home screen")]
    F += [figrow([
        P("It does <b>double duty</b>. Most of the year it’s the year-round resort companion — the volunteer "
          "committees, the season work-weekends, booking a cabin, and tee-time booking. Once a year it becomes the "
          "home base for <b>Family Fest</b>, a week-long reunion, which lives <i>inside</i> the same app as a themed "
          "section rather than off in a separate place."),
    ], "fest.png", side="left", caption="The Family Fest section")]
    F += [sp(4), Paragraph("The two halves, one app", H3)]
    F += [data_table(
        ["", "Year-round resort", "Family Fest week"],
        [
            [("Feel", "b"), "Forest-green Northwoods heritage", "Renaissance-fair parchment &amp; heraldry"],
            [("What’s there", "b"), "Committees, tee times, work weekends, cabins", "Schedule, the feast nights, dues, the gathering itself"],
            [("Mood", "b"), "Calm and evergreen", "Festive and a little ceremonial"],
        ],
        [0.18, 0.40, 0.42])]
    F += [sp(8), callout("The one idea that ties it together",
        [P("Rather than build two apps, Family Fest is treated as a <b>“season” of the resort</b> that rises and "
           "fades across the calendar — quiet most of the year, then a gradual build-up, the full festival week, and "
           "a gentle wind-down. The app quietly reshapes itself to match the time of year (Section 10).", BODY)],
        accent=PINE)]
    F += [PageBreak()]

    # ───────────────── SECTION 2 — THE MAP ─────────────────
    F += section("2", "A walk through the app",
                 "Five tabs along the bottom carry the whole app; a few Home cards reach the year-round extras. Nothing is ever more than a tap from home.")
    F += [P("The bottom row has five tabs — <b>Home</b> (the front porch), <b>Feed</b> (the family photo feed, "
            "Section 4), <b>Family Fest</b> (the reunion, Sections 9–10), <b>Activity</b> (your notifications, "
            "Section 7), and <b>Profile</b> (you and your settings, Section 3). A handful of year-round extras are "
            "reached from the Home porch rather than getting their own tab:")]
    F += [sp(2), figrow([
        P("<b>Committees</b> — the volunteer groups that keep the resort running (Maintenance, Beautification, and "
          "the Family Fest crew). Tap one to see who’s on it and what they do, and — if you’re a member — to open its "
          "own private group chat."),
    ], "committees.png", side="right", caption="Committees")]
    F += [figrow([
        P("<b>Tee Times</b> — a friendly hand-off into the local club’s real booking page, pre-set to the day you "
          "picked, so nobody has to hunt for it."),
    ], "tee.png", side="left", caption="Tee Times")]
    F += [figrow([
        P("<b>Work Weekends</b> — the season-prep weekends where the family pitches in to open or close the resort. "
          "(It tucks itself away during the festival week.)"),
    ], "work.png", side="right", caption="Work Weekends")]
    F += [sp(4), Paragraph("Inside Family Fest — the click-throughs", H3)]
    F += [figrow([
        P("The reunion lives on one flowing page. Each event opens to its own detail — the time, the place, what to "
          "bring, and who’s running it, with a tap to call or text them. Every detail page has a clear “back” link, "
          "so you can never get lost."),
    ], "fest_event.png", side="left", caption="An event detail page")]
    F += [PageBreak()]

    # ───────────────── SECTION 3 — GETTING IN ─────────────────
    F += section("3", "Getting in",
                 "Public to look, verified to take part. No passwords — a one-time code to your email, and you stay signed in.")
    F += [figrow([
        P("Identity is asked for <b>only when it’s needed</b>, never as a wall at the front door. You can wander the "
          "whole app without signing in. The moment you try to do something that affects others — post a photo, "
          "react, sign up for a meal — a sign-in panel slides up."),
        sp(2),
        P("<b>How it feels:</b> enter your name and email; a six-digit code lands in your inbox; type it in, and "
          "you’re a verified member. There’s <b>no password</b> to invent or forget, and the app remembers you on "
          "that device — you’d only re-enter a code on a new phone. (That choice is deliberate: it’s gentle on the "
          "less tech-comfortable relatives.)"),
    ], "getin.png", side="right", text_frac=0.58, caption="“Add your name & email”")]
    F += [sp(2), callout("Why a code instead of a password",
        [P("The only thing the app truly needs to know is that a <b>real, reachable email belongs to you</b>. A "
           "one-time code proves exactly that — without the burden of passwords nobody remembers. It’s a "
           "trusted-family setting, and it’s honest that it’s not a high-security system.", BODY)],
        accent=PINE)]
    F += [PageBreak()]

    # ───────────────── SECTION 4 — THE FEED ─────────────────
    F += section("4", "The family feed",
                 "The social heart of the app — a shared album that behaves like a small, private Instagram for the family.")
    F += [figrow([
        P("Open the <b>Feed</b> tab and you get a living scrapbook: photos and video, several to a post in a "
          "swipeable gallery (tap any one for full screen), with comments and a handful of emoji reactions. You can "
          "<b>tag people</b>, and a “tagged me” filter gathers every post you appear in."),
        sp(2),
        P("It <b>stays in sync on its own</b>: post from one phone and it appears on everyone else’s within "
          "moments — no refreshing. And because names and faces are looked up live, changing your nickname or photo "
          "updates everywhere you appear, even on years-old posts."),
    ], "posts.png", side="right", text_frac=0.58, caption="The family Feed")]
    F += [sp(2), Paragraph("A faithful record", H3)]
    F += [P("Posts arrange themselves by day (“Today,” “Yesterday,” a date). And if you post a photo weeks late, you "
            "can date it to <i>when it actually happened</i>, so the family’s record stays in true chronological "
            "order rather than bunching at the day you got around to it.")]
    F += [PageBreak()]

    # ───────────────── SECTION 5 — CONTACT, PAY & EMAIL ─────────────────
    F += section("5", "Reaching, paying &amp; emailing each other",
                 "Tap anyone’s name or photo, anywhere in the app, to reach or pay them — with their own preferred method first.")
    F += [figrow([
        P("Every name and face in the app is tappable, opening a small <b>contact card</b> that turns whatever that "
          "person chose to share into one-tap actions: <b>Text, Call, or Email</b>, and pay buttons for <b>Venmo, "
          "Zelle, Apple Cash, Cash App, or PayPal</b>. Each person marks how they’d <i>like</i> to be reached or "
          "paid, and that option floats to the top."),
        sp(2),
        P("It’s all optional and self-managed, and <b>no banking details ever live in the app</b> — the buttons "
          "simply hand off to the person’s own Venmo or Messages, the way tapping a phone number opens your dialer. "
          "The same pattern powers the committee rosters (shown here) and each feast night’s head chef."),
    ], "committee_detail.png", side="left", text_frac=0.58, caption="Call / Text / Email, per person")]
    F += [sp(4), Paragraph("Emailing a group, without a mailing list", H3)]
    F += [P("When you need a real email rather than a quick text, there’s a built-in <b>Email members</b> tool in "
            "your Profile. Pick the exact people you want, or a whole committee you’re part of, and it opens your "
            "normal email app with everyone already in the “To” line — you write and send it yourself. The names "
            "come straight from the app, so you’re never working off a stale address book, and <b>nothing is ever "
            "sent on your behalf</b>. Emailing the <i>entire</i> family in one go is reserved for organizers and "
            "anyone active on a committee, so that big a send stays with people who are involved.")]
    F += [PageBreak()]

    # ───────────────── SECTION 6 — ANNOUNCEMENTS ─────────────────
    F += section("6", "Announcements",
                 "A notice at the top of every screen — and a simple way for organizers to post to it without nagging.")
    F += [P("Organizers can post a notice — a loud <b>alert</b> for something time-sensitive, or a quiet <b>note</b> "
            "for an FYI. It appears as a banner across the top of the app for everyone:")]
    F += [sp(4)] + fig("banner.png", w=AVAIL, caption="The notice banner, as it appears atop every screen")
    F += [sp(6), P("Each person can <b>dismiss</b> a notice once they’ve read it, and it won’t come back — the app "
            "says its piece once and then lets it go, rather than pestering people who’ve already seen it. A notice "
            "can also <b>email the members who’ve opted in</b>, so a last-minute change (“dinner moved to 6:30”) "
            "reaches the people who aren’t in the app that day.")]
    F += [PageBreak()]

    # ───────────────── SECTION 7 — NOTIFICATIONS ─────────────────
    F += section("7", "Notifications — your “what happened” list",
                 "A running list of everything that involves you, with a switch for each kind so it’s exactly as quiet or as chatty as you want.")
    F += [figrow([
        P("The <b>Activity</b> tab is your own running list of <b>everything that happened that involves you</b> — "
          "much like the little bell on a social app. A small number on the bell tells you how many are new; open the "
          "tab and the count clears, while the list itself stays, so you can always look back."),
        sp(2),
        P("It gathers the things you’d actually want to know: someone <b>comments on or reacts to your photo</b>, "
          "<b>tags or @mentions you</b>, posts a <b>new photo to the family feed</b>, an organizer sends an "
          "<b>announcement</b>, or your <b>cabin request gets an answer</b>. Tap any one to jump straight to it."),
    ], "notifications.png", side="right", text_frac=0.58, caption="The Activity tab")]
    F += [sp(2), Paragraph("You decide what reaches you", H3)]
    F += [P("Every kind of notification has its <b>own on/off switch</b> in your Profile — comments on your posts, "
            "tags, new feed photos, group-chat mentions, cabin updates, and so on. Turn off what you don’t care about "
            "and keep the rest; it’s as fine-grained as you like. A busy group chat won’t bury you, either — you only "
            "hear about a committee conversation when someone actually <b>tags you</b> in it.")]
    F += [sp(4), callout("One set of switches, inside the app and on your phone",
        [P("If you also turn on phone notifications, that <b>same</b> set of switches decides what’s allowed to buzz "
           "your phone — so you set your preferences once and they apply both inside the app and on your lock "
           "screen. Nothing is on that you didn’t leave on.", BODY)], accent=PINE)]
    F += [PageBreak()]

    # ───────────────── SECTION 8 — CABINS ─────────────────
    F += section("8", "Booking a cabin",
                 "Ask for a room in one of the two houses for the dates you want; an organizer approves it, and the app keeps the count honest.")
    F += [figrow([
        P("The resort has two houses to stay in — <b>Cabin 1</b> and the <b>Red &amp; White House</b>. From "
          "<b>Request a Cabin Stay</b>, a member picks a house and their dates (it suggests Family Fest week) and "
          "sends a request; an <b>organizer approves or declines</b> it, and the requester is notified of the answer."),
        sp(2),
        P("The app keeps the count honest: it shows <b>how many rooms are still open</b> for the nights you want and "
          "won’t let a house be overbooked. One room per request, so a family needing two rooms simply asks twice. "
          "You see <b>only your own requests</b>; organizers see the whole queue."),
    ], "cabin.png", side="right", text_frac=0.58, caption="Request a Cabin Stay")]
    F += [PageBreak()]

    # ───────────────── SECTION 9 — FAMILY FEST LOOK ─────────────────
    F += section("9", "Family Fest — when the app puts on its festival colors",
                 "The reunion gets its own look and feel inside the same app: a Renaissance-fair world of feasts and heraldry.")
    F += [figrow([
        P("Where the year-round resort is forest-green and woodsy, the <b>Family Fest</b> section turns to "
          "<b>parchment, heraldic wine and azure, and a Roman-serif display type</b> — a Renaissance-fair feel "
          "suited to a week of feasts, gatherings, and a scavenger hunt."),
        sp(2),
        P("The cooking teams are organized into <b>“houses,”</b> and each feast night has a head chef you can call "
          "or text right from the page. Tap a night to see its menu, when it’s served versus when the crew preps, "
          "and which houses are cooking."),
    ], "fest_dinner.png", side="right", caption="A feast night")]
    F += [figrow([
        P("<b>Dues are simple, too.</b> The pay page shows the amount and the organizers to send it to, with the "
          "same one-tap Venmo / Zelle buttons as everywhere else — no chasing people for handles."),
    ], "fest_pay.png", side="left", caption="Family Fest dues")]
    F += [PageBreak()]

    # ───────────────── SECTION 10 — DAY BY DAY ─────────────────
    F += section("10", "The week, day by day",
                 "Here’s the part people love: the app doesn’t just describe the week — it reshapes itself around it, on its own, as the calendar turns.")
    F += [P("A single, quiet rule maps <b>today’s date</b> to a <b>phase</b>, and the whole app follows along — "
            "nobody flips a switch. As the day rolls over, the home screen, the tab bar, and the Family Fest page "
            "all change to match where you are in the season:")]
    F += [data_table(
        ["Phase", "When", "What the app does"],
        [
            [("Off-season", "b"), "More than ~2 months out", "Resort-normal, with just a quiet Family Fest note on the porch."],
            [("Planning", "b"), "The run-up", "A partial takeover: rally volunteers, preview the plan, collect dues."],
            [("Live", "b"), "During the week", "Full takeover — “Day 3 of 5” and today’s events lead the home screen; a pulse on the tab."],
            [("Afterglow", "b"), "A couple weeks after", "“That’s a wrap” — nudges everyone to post the photos they didn’t get to."],
        ],
        [0.18, 0.24, 0.58])]
    F += [sp(8), Paragraph("Watch the home screen change", H3)]
    F += [P("Same screen, three different times of year — it transforms automatically as the festival approaches, "
            "arrives, and winds down:")]
    F += [shotsrow([
        ("day_leadup.png", "Days before — “Almost here”"),
        ("day_live.png",   "On the day — “Day 3 of 5”"),
        ("day_after.png",  "Just after — “That’s a wrap”"),
    ], w=1.42*inch)]
    F += [sp(6), figrow([
        P("<b>On the day itself,</b> the Family Fest page leads with <b>“Day n of 5”</b> and <i>everything you need "
          "today, right here</i> — each event with its time and place, what to bring, and who’s in charge (one tap "
          "to call them), plus the night’s feast and head chef."),
        sp(2),
        P("When tomorrow comes, it simply advances — Day 1, Day 2, Day 3 — and yesterday’s schedule steps aside for "
          "today’s. No one has to update anything; the date does the work."),
    ], "day_festlive.png", side="right", text_frac=0.58, caption="Family Fest, on Day 3")]
    F += [sp(4), callout("Preview any day — “time-travel”",
        [P("Because the app keys off the date, there’s a hidden control that lets an organizer say <b>“show me as if "
           "it were the third day of the festival.”</b> So the entire live-week experience can be previewed and "
           "polished in the dead of winter — it’s how you make sure the big week works <i>before</i> it’s the big "
           "week. (Every screen in this section was captured exactly that way.)", BODY)],
        accent=CAMPFIRE, bg=colors.HexColor("#fbf0e8"))]
    F += [PageBreak()]

    # ───────────────── SECTION 11 — PRIVACY ─────────────────
    F += section("11", "Is it private?",
                 "Private by design, not a public website — open to look around, but anything personal takes a verified sign-in. Here’s exactly who can see what.")
    F += [P("Because this is a family space, it’s worth being clear about how it handles privacy. The short version: "
            "<b>it’s private by design, not a public website</b>, and the personal parts are behind a verified "
            "sign-in.")]
    F += [sp(2), bullets([
        "<b>Not out on the open web.</b> It isn’t in any app store and isn’t meant to turn up in a web search — you "
        "reach it through a link shared within the family. The general resort info is browsable; the personal things "
        "are gated.",
        "<b>You sign in to do anything personal.</b> Posting a photo, commenting, signing up for a meal, requesting a "
        "cabin, and seeing the member directory all require a <b>verified email</b>, proven by a one-time code, so "
        "it’s really you (Section 3).",
        "<b>Private group chats stay private.</b> Each committee’s chat can be read only by that committee’s "
        "members — that’s enforced by the system itself, not merely hidden from a menu.",
        "<b>Your photos stay in the family’s hands.</b> The actual pictures and videos live on a computer <b>at the "
        "house</b> — not a big tech company’s cloud — reached over a secure private connection (Section 14). The "
        "family keeps custody of its own album.",
        "<b>You share only what you choose.</b> Your phone number, address, and payment handles are optional and "
        "shown only to other signed-in members. <b>No banking details are ever stored</b> — pay buttons simply open "
        "Venmo, Zelle, and the like.",
        "<b>There’s always a person who can tidy up.</b> A few trusted family members (organizers) can edit or "
        "remove any post and remove a member if needed — so a mistake or a problem can be handled. And there’s no "
        "stranger-comment problem, because there are no strangers: everyone is a known, signed-in member.",
    ])]
    F += [sp(4), callout("Honest about what it is",
        [P("This is built for a <b>trusted family circle</b>, and its security is sized to match — good-neighbor, "
           "not a bank vault. There are no passwords to be stolen, personal actions need a verified email, and "
           "organizers can remove anyone; but it deliberately trades maximum lock-down for being <b>gentle and "
           "welcoming</b> to relatives of every comfort level with technology. If a part of it ever needs to be "
           "truly locked down, that’s an easy conversation to have.", BODY)],
        accent=CAMPFIRE, bg=colors.HexColor("#fbf0e8"))]
    F += [PageBreak()]

    # ───────────────── SECTION 12 — HOW IT'S BUILT ─────────────────
    F += section("12", "How it’s built, in plain terms",
                 "Enough to picture how it works and why it’s sturdy — without the jargon.")
    F += [P("It’s a <b>web app that installs to a phone’s home screen</b> like a normal app, so there’s nothing to "
            "download from an app store and updates are instant for everyone. (For the curious: it’s built on modern, "
            "mainstream web technology — the same family of tools behind a great many apps you already use.) A few "
            "principles are worth knowing, because they shape how it feels:")]
    F += [bullets([
        "<b>One identity, used everywhere.</b> A person is a single profile — change your name or photo once and it "
        "updates everywhere you appear. No duplicate accounts, no stale copies.",
        "<b>Built to bend, not break.</b> If a piece of the system is briefly unavailable, the app still lets you "
        "look around rather than throwing an error.",
        "<b>A calm, consistent look,</b> with small, tasteful animations — a gentle “give” when you tap, sections "
        "that fold open smoothly — so it feels alive without being flashy. It also honors the phone’s “reduce "
        "motion” accessibility setting and fits neatly around camera notches.",
    ])]
    F += [sp(4), Paragraph("The same app, two costumes", H3)]
    F += [P("All the styling lives in one place, so the Family Fest wing can swap its entire palette and lettering "
            "the moment you step into it — green-and-woodsy out here, parchment-and-heraldry in there — with nothing "
            "else changing:")]
    F += [twoshots_block()]
    F += [PageBreak()]

    # ───────────────── SECTION 13 — AS AN ORGANIZER ─────────────────
    F += section("13", "What you can do as an organizer",
                 "You’ll be one of the app’s organizers — here’s what that adds beyond a normal member.")
    F += [P("Most people use the app as members: browse, post, react, sign up. A few trusted family members are "
            "marked as <b>organizers (admins)</b> — and you’ll be one. Organizer status is set in the system itself, "
            "not granted from inside the app, so it can’t be self-assigned. What it adds:")]
    F += [bullets([
        "<b>Post announcements</b> to the banner at the top of everyone’s app — an alert or a quiet note (Section 6).",
        "<b>Send a notification</b> straight to people’s Activity tab — to everyone, or first to a small "
        "<b>“beta testers”</b> group you can appoint, so you can try something out before the whole family sees it.",
        "<b>Approve or decline cabin requests</b>, with the app guarding against overbooking (Section 8).",
        "<b>Email any group</b> by name — the whole family, a committee, or a hand-picked set (Section 5).",
        "<b>Manage the member list</b> — see everyone who’s registered, and grant or remove organizer (or "
        "beta-tester) status. You can’t remove your own organizer access, so you can’t accidentally lock yourself out.",
        "<b>Edit or take down any post</b>, not just your own — handy for tidying a duplicate or fixing a caption.",
        "<b>See the directory</b> — members’ emails are kept tucked away from ordinary view and surfaced only to "
        "organizers, so you can reach anyone when you need to.",
    ])]
    F += [sp(2), callout("In short",
        [P("Members see and share the family’s world; as an organizer you also <b>steward</b> it — the "
           "announcements, the roster, cabin approvals, and the occasional cleanup. Nothing here is heavy or "
           "technical; it’s all a tap or two from your Profile screen.", BODY)], accent=PINE)]
    F += [PageBreak()]

    # ───────────────── SECTION 14 — WHERE IT LIVES ─────────────────
    F += section("14", "Where everything lives — and what it costs",
                 "A frugal mix of free services plus one small computer at the house — and a deliberate choice about custody.")
    F += [P("The app is split across a few places, each chosen on purpose: <b>what you see</b> (the screens) is "
            "delivered by free, fast, professional hosting; <b>accounts, profiles, and the words of posts</b> live in "
            "a managed cloud database; and the <b>actual photo and video files</b> live on a small computer at the "
            "house — a Mac mini — reached over a secure private tunnel.")]
    F += [sp(2), Paragraph("Why keep the photos at home", H3)]
    F += [P("Cloud storage gets expensive — and capped — for a media-heavy family album that grows every summer. "
            "Keeping the files on a machine the family <i>owns</i> sidesteps that entirely: the only real limit is "
            "the size of the hard drive. There’s a nice principle in it, too — the family literally keeps custody of "
            "its own pictures.")]
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
        [P("The home computer restarts its own software if it ever crashes and keeps the machine from sleeping; "
           "there’s a small control panel to start it, stop it, and watch activity. And because the free cloud "
           "database would otherwise nod off during the quiet off-season, a tiny automated “heartbeat” checks in "
           "every few days to keep it awake — so the app is ready the moment the family is.", BODY)], accent=PINE)]
    F += [PageBreak()]

    # ───────────────── SECTION 15 — COMMON QUESTIONS ─────────────────
    F += section("15", "Common questions",
                 "Quick, plain answers to the things people ask first.")
    F += [
        qa("Do I have to download anything?",
           "No. It opens in your phone’s web browser, and you can “add it to your home screen” so it sits next to "
           "your other apps and opens full-screen. There’s no app store to deal with, and updates appear on their "
           "own — everyone’s always on the latest version."),
        qa("Is there a password to remember?",
           "No. You type your email, the app sends a one-time code, you enter it — done. It then remembers you on "
           "that phone, so you’d only enter a code again on a new device."),
        qa("Who can see my photos and posts?",
           "Only signed-in members of this family app. Posts aren’t public, and the photo files themselves live on a "
           "computer at the house rather than a public cloud (Section 11)."),
        qa("Is it safe for the whole family to use?",
           "It’s a closed, invitation-style circle — everyone is a known, signed-in member, there’s no commenting "
           "from outsiders, and organizers can edit or remove anything and remove a member if needed."),
        qa("Will it flood me with notifications?",
           "Only if you let it. Every kind has its own on/off switch in your Profile, and a busy group chat only "
           "reaches you when someone tags you (Section 7)."),
        qa("Does it cost anything to use?",
           "No. It runs on free services plus the family’s own computer for photo storage; the only ongoing cost is "
           "that computer’s electricity (Section 14)."),
        qa("What if I’m not very comfortable with technology?",
           "That’s exactly who it’s built for. Most things are a tap or two, there’s no jargon, and it leans on the "
           "simplest possible sign-in. If you can use a photos app and send a text, you can use this."),
        qa("I got a new phone — what do I do?",
           "Open the app, enter your email, and type the code it sends. Your name, photo, and history are all still "
           "there — they’re tied to you, not the device."),
        qa("Who runs it, and who do I ask for help?",
           "A few family members are organizers. They post announcements, keep the member list, approve cabin "
           "requests, and can help with anything that’s stuck."),
        qa("What happens to all the photos over the years?",
           "They’re kept on the family’s computer and stay in the feed in true date order. (One honest caveat about "
           "backing them up is in Section 16.)"),
    ]
    F += [PageBreak()]

    # ───────────────── SECTION 16 — TRADE-OFFS ─────────────────
    F += section("16", "Honest trade-offs &amp; open questions",
                 "The rough edges and the judgment calls — the parts worth a second look. None are emergencies; all are real.")
    F += [idea("The photos live on one machine",
        "Keeping the family’s pictures on a single home computer is a lovely cost-and-custody choice — but it’s also "
        "a single point of failure. If that machine fails, loses power, or its address changes, older photo links "
        "could break, and the only backup is a local one. Worth adding inexpensive cloud storage purely as a safety "
        "net, or keep the savings and the self-reliance?",
        "RELIABILITY", CAMPFIRE)]
    F += [idea("The feed reloads fully on every change",
        "Each new post or reaction prompts the feed to reload itself completely. That’s perfectly fine for a "
        "family-sized album, but it wouldn’t scale to thousands of posts and could feel sluggish on a very busy "
        "festival evening. Worth refining now, or a problem to leave until it’s actually a problem?",
        "PERFORMANCE", LAKE)]
    F += [idea("A little housekeeping to reduce future mistakes",
        "There are a couple of overlapping settings in the code that could be merged into one, and some festival "
        "logic still lives in an older, separate copy of the project that ought to be retired. Neither is visible to "
        "anyone using the app — but tidying them lowers the chance of a confusing slip-up down the road.",
        "UPKEEP", AZURE)]

    F += [sp(6), callout("What’s already arrived — and what’s next",
        [P("Several things that were once on the wish-list are now live: <b>emailing the family by name</b>, "
           "<b>requesting and approving</b> committee membership and cabin stays, an in-app <b>notifications</b> "
           "center with a switch for every kind, and optional <b>phone push-notifications</b>. The most worthwhile "
           "thing still open is a simple <b>off-site backup of the photos</b> (see above) — the one place the current "
           "setup trades a little safety for cost. If you were choosing what to firm up next, would it be that?", BODY)],
        accent=PINE)]
    F += [sp(10), Rule(BORDER, 0.8, space=6),
          P("<font color='#5b6b63'><i>Thanks for reading. I’d be glad to walk through any of this in person — and "
            "to answer anything this didn’t cover.</i></font>", SMALL)]

    return F


def twoshots_block():
    """Two small screenshots side by side, captioned — the theme comparison (§12)."""
    w = 1.42*inch
    t = Table([[fig("home.png", w, "Year-round resort"), fig("fest.png", w, "Family Fest")]],
              colWidths=[AVAIL/2, AVAIL/2])
    t.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("ALIGN", (0,0), (-1,-1), "CENTER"),
        ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ]))
    return KeepTogether(t)
