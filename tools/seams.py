#!/usr/bin/env python3
"""Find where the paper starts on each foldout's hinge panel, for the Reader's unfolded view.

A foldout's hinge panel (r1 / v1, the one at the spine) was photographed in the bound book, so on the side where the
flaps hang the photograph shows the stacked edges of the book block, a band of dark layers that is not part of the
foldout. The flaps were photographed opened out. Side by side, in the unfolded view, the band sits in the middle of the
sheet. `data/seams.json` says how wide the band is on each such panel, as a fraction of the panel's width, and the
Reader lets the flap overlap the hinge panel by that much. The folded page, a page of the bound book, still shows its
fore-edge as photographed.

The band is found from the panel picture alone: it is there if, past the photo's own rim, the brightness dips well below
the paper's (DARK), and it ends where the brightness is back near the paper's (PAPER, held over a few per cent of the
width). A gradual shading of the paper is not a band, and bands narrower than MIN are the rim or a crease. Needs Python
with numpy and pillow.

  python3 tools/seams.py           # rewrite data/seams.json from data/codex.json and data/panels/*_l.jpg
  python3 tools/seams.py --show    # print what it finds without writing

The entry is only used while the panel is cut as in codex.json (`q` is its crop); a page you re-crop, or a sheet you
turn, has none.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BORDER = 0.015      # the dark rim of the photograph, skipped
DARK = 0.80         # a stack of edges dips below this share of the paper's own brightness
PAPER = 0.90        # and the paper is back at this share
RUN = 0.04          # held for this much of the width
MIN = 0.04          # narrower bands are not stacks of edges


def band(img: str, side: str) -> float:
    """Width of the band on the `side` ("L" or "R") of the panel picture, as a fraction of its width."""
    g = np.asarray(Image.open(ROOT / "data" / "panels" / f"{img}_l.jpg").convert("L"), dtype=float)
    if side == "R":
        g = g[:, ::-1]                      # index 0 is the outer edge, whichever side it is
    h, w = g.shape
    lum = g[int(h * .08):int(h * .92)].mean(axis=0)
    k = max(3, int(w * .008))
    lum = np.convolve(lum, np.ones(k) / k, mode="same")
    paper = np.median(lum[int(w * .25):int(w * .5)])
    need, run = PAPER * paper, max(3, int(w * RUN))
    x0 = x = int(w * BORDER)
    while x < int(w * .30) and not (lum[x:x + run] >= need).all():
        x += 1
    return x / w if x > x0 and lum[x0:x].min() < DARK * paper else x0 / w


def hinge_panels(codex: dict):
    """(panel, side of its picture that faces the flaps) for each leaf side of a foldout that unfolds in place."""
    for sh in codex["sheets"]:
        if len(sh["inside"]) > 1:
            continue                        # the Rosettes open in the sheet viewer
        n, s = len(sh["inside"][0]), sh["spine"]
        ins, out = sh["inside"][0], sh["outside"][0]
        # the four leaf sides of a plain sheet, as app.js sidesOf lays them out
        for row, cols, hinge in ((out, range(n - s, n), "left"), (ins, range(0, s), "right"),
                                 (ins, range(s, n), "left"), (out, range(0, n - s), "right")):
            segs = [row[c] for c in cols]
            if len(segs) > 1 and not any(x.get("missing") for x in segs):
                yield (segs[0] if hinge == "left" else segs[-1]), ("R" if hinge == "left" else "L")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--show", action="store_true", help="print the bands without writing data/seams.json")
    args = ap.parse_args()
    codex = json.loads((ROOT / "data" / "codex.json").read_text())
    panels = {}
    for seg, side in hinge_panels(codex):
        b = band(seg["img"], side)
        print(f"{seg['img']:10s} flaps on the {side} of the picture: band {b * 100:4.1f}%{'' if b >= MIN else '  (none)'}")
        if b >= MIN and seg.get("quad"):
            panels[seg["img"]] = {"side": side, "band": round(b, 3), "q": seg["quad"]}
    if args.show:
        return
    out = {"about": "Where the paper starts on a foldout's hinge panel (tools/seams.py): the picture shows the stacked edges of the "
                    "bound book as a band this wide on the side the flaps hang, as a fraction of the panel's width. The unfolded "
                    "Reader lets the flap overlap it. `q` is the crop it was measured on; the Reader ignores the entry if the page is re-cropped.",
           "version": 1, "panels": panels}
    (ROOT / "data" / "seams.json").write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote data/seams.json: {len(panels)} panels")


if __name__ == "__main__":
    main()
