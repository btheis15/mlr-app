#!/usr/bin/env python3
"""
Builds the "Muskellunge Lake Resort — App Overview" PDF.

A self-contained technical + product walkthrough of the MLR app, written for a
programmer audience. Pure reportlab (no system deps). Run:

    python3 docs/build_overview_pdf.py

Output: docs/MLR-App-Overview.pdf
"""

import os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    NextPageTemplate, PageBreak, ListFlowable, ListItem, HRFlowable, KeepTogether,
)
from reportlab.platypus.flowables import Flowable

# ── Brand palette (from app/globals.css) ────────────────────────────────────
PINE      = colors.HexColor("#15503a")  # --color-primary, forest green
PINE_DK   = colors.HexColor("#0c4029")  # manifest background
INK       = colors.HexColor("#14241c")  # --color-foreground
PAPER     = colors.HexColor("#f6f6f1")  # --color-background
CARD      = colors.HexColor("#ffffff")
BORDER    = colors.HexColor("#e5e4da")
LAKE      = colors.HexColor("#0e7490")
CAMPFIRE  = colors.HexColor("#c2410c")
SUN       = colors.HexColor("#b45309")
DUSK      = colors.HexColor("#6d28d9")
WINE      = colors.HexColor("#8b2e2e")  # Family Fest heraldic wine
PARCH     = colors.HexColor("#f4ecd8")  # Family Fest parchment
AZURE     = colors.HexColor("#1e3a8a")
MUTE      = colors.HexColor("#5b6b63")
CODE_BG   = colors.HexColor("#0f1f18")
CODE_FG   = colors.HexColor("#e8efe9")
TINT      = colors.HexColor("#eef3ef")  # faint pine tint for callouts

PAGE_W, PAGE_H = LETTER
MARGIN = 0.85 * inch

# Running header subtitle (top-right of every body page). Overridable per edition
# — the general-audience build sets a plainer phrase before building.
RUNNING_SUBTITLE = "Technical & Product Walkthrough"

import re as _re
# Helvetica (WinAnsi) has no color emoji and no U+2190-block arrows. Strip the
# emoji and map the few arrows we use onto a WinAnsi-safe guillemet so the doc
# never shows missing-glyph boxes.
_ARROW_MAP = {"→": "»", "↗": "»", "➡": "»",
              "➜": "»", "⮕": "»"}
_EMOJI_RE = _re.compile(
    "["
    "\U0001F000-\U0001FAFF"   # pictographs, emoji, symbols & faces
    "\U0001F1E6-\U0001F1FF"   # regional indicators
    "\U00002600-\U000027BF"   # misc symbols + dingbats
    "\U00002190-\U000021FF"   # arrows block (leftover)
    "\U00002B00-\U00002BFF"   # misc symbols & arrows
    "\U00002300-\U000023FF"   # technical (hourglass, etc.)
    "\U0000FE00-\U0000FE0F"   # variation selectors
    "\U0000200D"              # zero-width joiner
    "\U000020E3"              # combining keycap
    "]"
)

def clean_text(s):
    """Drop emoji/pictographs and map arrows; tidy the spacing left behind."""
    if not isinstance(s, str):
        return s
    for k, v in _ARROW_MAP.items():
        s = s.replace(k, v)
    s = _EMOJI_RE.sub("", s)
    s = s.replace(" ,", ",").replace(" .", ".")
    s = _re.sub(r"[ \t]{2,}", " ", s)
    s = _re.sub(r"(<br/>)\s+", r"\1", s)
    return s.strip()

# ── Stylesheet ──────────────────────────────────────────────────────────────
ss = getSampleStyleSheet()

def style(name, **kw):
    return ParagraphStyle(name, **kw)

H1 = style("H1", fontName="Helvetica-Bold", fontSize=21, leading=25, textColor=PINE,
           spaceBefore=2, spaceAfter=4)
KICKER = style("Kicker", fontName="Helvetica-Bold", fontSize=9.5, leading=12,
               textColor=CAMPFIRE, spaceAfter=2)
H2 = style("H2", fontName="Helvetica-Bold", fontSize=14.5, leading=18, textColor=PINE,
           spaceBefore=14, spaceAfter=5)
H3 = style("H3", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=INK,
           spaceBefore=10, spaceAfter=3)
BODY = style("Body", fontName="Helvetica", fontSize=10, leading=14.5, textColor=INK,
             spaceAfter=6, alignment=TA_LEFT)
BODYJ = style("BodyJ", parent=BODY, alignment=TA_JUSTIFY)
SMALL = style("Small", fontName="Helvetica", fontSize=8.5, leading=11.5, textColor=MUTE)
LBL = style("Lbl", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=INK)
BULLET = style("Bullet", fontName="Helvetica", fontSize=10, leading=14, textColor=INK)
CODE = style("Code", fontName="Courier", fontSize=8.3, leading=11.5, textColor=CODE_FG)
CODECMT = style("CodeCmt", fontName="Courier-Oblique", fontSize=8.3, leading=11.5,
                textColor=colors.HexColor("#8fb39f"))
TH = style("TH", fontName="Helvetica-Bold", fontSize=8.8, leading=11, textColor=colors.white)
TD = style("TD", fontName="Helvetica", fontSize=8.8, leading=11.5, textColor=INK)
TDB = style("TDB", fontName="Helvetica-Bold", fontSize=8.8, leading=11.5, textColor=PINE)
TDM = style("TDM", fontName="Courier", fontSize=8.0, leading=11, textColor=colors.HexColor("#243b30"))
COVER_TITLE = style("CoverTitle", fontName="Helvetica-Bold", fontSize=34, leading=38,
                    textColor=colors.white, alignment=TA_LEFT)
COVER_SUB = style("CoverSub", fontName="Helvetica", fontSize=13, leading=18,
                  textColor=colors.HexColor("#cfe0d6"), alignment=TA_LEFT)
TOC = style("TOC", fontName="Helvetica", fontSize=10.5, leading=18, textColor=INK)
TOCNUM = style("TOCNum", fontName="Helvetica-Bold", fontSize=10.5, leading=18, textColor=CAMPFIRE)


# ── Custom flowables ─────────────────────────────────────────────────────────
class Rule(Flowable):
    def __init__(self, color=BORDER, thickness=0.8, width=None, space=4):
        super().__init__(); self.color=color; self.thickness=thickness; self.width=width; self.space=space
    def wrap(self, aw, ah):
        self._w = self.width or aw; return (self._w, self.space + self.thickness)
    def draw(self):
        self.canv.setStrokeColor(self.color); self.canv.setLineWidth(self.thickness)
        y = self.space/2; self.canv.line(0, y, self._w, y)


def chip(text, fill, fg=colors.white):
    """A small rounded label rendered as a 1-cell table."""
    p = Paragraph(f'<font color="#{fg.hexval()[2:]}"><b>{text}</b></font>', SMALL)
    t = Table([[p]], colWidths=[None])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), fill),
        ("LEFTPADDING", (0,0), (-1,-1), 7), ("RIGHTPADDING", (0,0), (-1,-1), 7),
        ("TOPPADDING", (0,0), (-1,-1), 3), ("BOTTOMPADDING", (0,0), (-1,-1), 3),
        ("ROUNDEDCORNERS", [5,5,5,5]),
    ]))
    return t


def callout(title, body_flowables, accent=PINE, bg=TINT):
    """A left-bar tinted info box."""
    inner = []
    if title:
        inner.append(Paragraph(title, style("CoTitle", fontName="Helvetica-Bold",
                     fontSize=10, leading=13, textColor=accent, spaceAfter=3)))
    inner.extend(body_flowables)
    t = Table([[inner]], colWidths=[PAGE_W - 2*MARGIN])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), bg),
        ("LINEBEFORE", (0,0), (0,-1), 3, accent),
        ("LEFTPADDING", (0,0), (-1,-1), 12), ("RIGHTPADDING", (0,0), (-1,-1), 12),
        ("TOPPADDING", (0,0), (-1,-1), 9), ("BOTTOMPADDING", (0,0), (-1,-1), 9),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
    ]))
    return t


def code_block(lines):
    """lines: list of (text, is_comment)."""
    paras = []
    for txt, is_cmt in lines:
        safe = (txt.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                   .replace(" ", "&nbsp;"))
        paras.append(Paragraph(safe, CODECMT if is_cmt else CODE))
    t = Table([[p] for p in paras], colWidths=[PAGE_W - 2*MARGIN])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), CODE_BG),
        ("LEFTPADDING", (0,0), (-1,-1), 12), ("RIGHTPADDING", (0,0), (-1,-1), 12),
        ("TOPPADDING", (0,0), (0,0), 9), ("BOTTOMPADDING", (-1,-1), (-1,-1), 9),
        ("TOPPADDING", (0,1), (-1,-1), 0.5), ("BOTTOMPADDING", (0,0), (-1,-2), 0.5),
        ("ROUNDEDCORNERS", [6,6,6,6]),
    ]))
    return t


def bullets(items, st=BULLET, leftIndent=14, bulletColor=PINE):
    li = []
    for it in items:
        if isinstance(it, str):
            li.append(ListItem(Paragraph(clean_text(it), st), leftIndent=leftIndent,
                      value="•", bulletColor=bulletColor))
        else:
            li.append(ListItem(it, leftIndent=leftIndent))
    return ListFlowable(li, bulletType="bullet", start="•", leftIndent=leftIndent,
                        bulletFontSize=9, spaceBefore=0, spaceAfter=2)


def data_table(header, rows, col_widths, header_bg=PINE, font_rows=None):
    """font_rows: optional list of per-cell styles matching rows; if None uses TD."""
    avail = PAGE_W - 2*MARGIN
    cw = [w * avail for w in col_widths]
    data = [[Paragraph(clean_text(h), TH) for h in header]]
    for r in rows:
        cells = []
        for j, c in enumerate(r):
            stl = TD
            if isinstance(c, tuple):
                c, which = c
                stl = {"b": TDB, "m": TDM}.get(which, TD)
            cells.append(Paragraph(clean_text(str(c)), stl))
        data.append(cells)
    t = Table(data, colWidths=cw, repeatRows=1)
    tstyle = [
        ("BACKGROUND", (0,0), (-1,0), header_bg),
        ("LEFTPADDING", (0,0), (-1,-1), 7), ("RIGHTPADDING", (0,0), (-1,-1), 7),
        ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LINEBELOW", (0,0), (-1,-1), 0.5, BORDER),
        ("LINEBELOW", (0,0), (-1,0), 0, header_bg),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            tstyle.append(("BACKGROUND", (0,i), (-1,i), colors.HexColor("#f4f6f3")))
    t.setStyle(TableStyle(tstyle))
    return t


# ── Page furniture ────────────────────────────────────────────────────────────
def cover_bg(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PINE_DK); canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # lower forest-green band
    canvas.setFillColor(PINE); canvas.rect(0, 0, PAGE_W, PAGE_H*0.40, fill=1, stroke=0)
    # top + bottom campfire accent strips
    canvas.setFillColor(CAMPFIRE); canvas.rect(0, PAGE_H-12, PAGE_W, 12, fill=1, stroke=0)
    canvas.setFillColor(CAMPFIRE); canvas.rect(0, 0, PAGE_W, 6, fill=1, stroke=0)
    # a simple pine-ridge silhouette sitting on the band seam
    base = PAGE_H*0.40
    canvas.setFillColor(colors.HexColor("#0a3a26"))
    n = 11; step = PAGE_W/(n-1)
    p = canvas.beginPath(); p.moveTo(0, base)
    for i in range(n):
        x = i*step
        peak = base + (34 if i % 2 else 60)
        p.lineTo(x - step*0.5, base)
        p.lineTo(x, peak)
    p.lineTo(PAGE_W, base); p.lineTo(PAGE_W, base-2); p.lineTo(0, base-2); p.close()
    canvas.drawPath(p, fill=1, stroke=0)
    canvas.restoreState()


def header_footer(canvas, doc):
    canvas.saveState()
    # top hairline + running title
    canvas.setStrokeColor(BORDER); canvas.setLineWidth(0.6)
    canvas.line(MARGIN, PAGE_H-MARGIN+22, PAGE_W-MARGIN, PAGE_H-MARGIN+22)
    canvas.setFont("Helvetica", 7.5); canvas.setFillColor(MUTE)
    canvas.drawString(MARGIN, PAGE_H-MARGIN+27, "MUSKELLUNGE LAKE RESORT — APP OVERVIEW")
    canvas.drawRightString(PAGE_W-MARGIN, PAGE_H-MARGIN+27, RUNNING_SUBTITLE)
    # footer
    canvas.setStrokeColor(BORDER)
    canvas.line(MARGIN, MARGIN-14, PAGE_W-MARGIN, MARGIN-14)
    canvas.setFont("Helvetica", 8); canvas.setFillColor(MUTE)
    canvas.drawString(MARGIN, MARGIN-26, "Muskellunge Lake Resort · EST 1987")
    canvas.setFont("Helvetica-Bold", 8); canvas.setFillColor(PINE)
    canvas.drawRightString(PAGE_W-MARGIN, MARGIN-26, f"{canvas.getPageNumber()}")
    canvas.restoreState()


def build(flowables, out_path):
    doc = BaseDocTemplate(out_path, pagesize=LETTER,
                          leftMargin=MARGIN, rightMargin=MARGIN,
                          topMargin=MARGIN, bottomMargin=MARGIN,
                          title="Muskellunge Lake Resort — App Overview",
                          author="MLR")
    content_frame = Frame(MARGIN, MARGIN, PAGE_W-2*MARGIN, PAGE_H-2*MARGIN-6,
                          id="content")
    full_frame = Frame(0, 0, PAGE_W, PAGE_H, id="full",
                       leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[full_frame], onPage=cover_bg),
        PageTemplate(id="body", frames=[content_frame], onPage=header_footer),
    ])
    doc.build(flowables)


# Content is assembled in content.py to keep this file as the engine.
if __name__ == "__main__":
    from content import build_story
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "MLR-App-Overview.pdf")
    build(build_story(), out)
    print("wrote", out)
