#!/usr/bin/env python3
"""
Builds the GENERAL-AUDIENCE edition of the MLR App Overview PDF.

Same engine and look as build_overview_pdf.py, but the content (content_general.py)
is written in plain English for a sharp non-engineer. Run:

    python3 docs/build_general_pdf.py

Output: docs/MLR-App-Overview-General.pdf
"""

import os
import build_overview_pdf
from build_overview_pdf import build
from content_general import build_story

# This edition is for a non-engineer — plainer running header than the techy one.
build_overview_pdf.RUNNING_SUBTITLE = "A Plain-English Guided Tour"

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "MLR-App-Overview-General.pdf")
    build(build_story(), out)
    print("wrote", out)
