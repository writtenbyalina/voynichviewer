"""Kerning for `build_font.py`: even out the gaps inside words that Claston's spacing leaves too wide or too narrow.

Every pair of glyphs that stands together inside a word (`pairs.json`, 99.5% of all pairs) is drawn at 200 px to the
em, and its gap is measured in the body of the line, between the baseline and the top of an *o*, where the eye reads
the spacing. The median gap is about a tenth of an em. Pairs more than twice as loose are brought in to 1.25 times the
median: these are almost all the gallows *p* and *f*, whose loop overhangs the next glyph, so in the manuscript that
glyph tucks in under it. Pairs whose ink collides by more than 3% of an em are pushed apart. Pairs that
merely touch are left alone: *qo* and *ain* are written joined. A pair is never brought closer than 5% of an em anywhere,
above or below the body either, and the unreadable mark `?` is not kerned.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
from fontTools.ttLib import TTFont
from PIL import ImageFont

HERE = Path(__file__).resolve().parent
PX = 200                # rendering size, pixels to the em
LOOSE = 2.0             # a gap over LOOSE x median is too loose
TO = 1.25               # and is brought to TO x median
COLLIDE = -6            # px: ink overlapping more than this is pushed apart
CLEAR = 10              # px: the gap a pushed-apart or tightened pair keeps everywhere (5% of an em)
# pairs inside the multi-character v101 sequences that stand for one STA glyph (ee = cc, iiiin = iM, ...)
INNER = ["cc", "cC", "Cc", "cd", "dc", "iM", "μy", "4o", "ªo", "Åk", "ÅH"]


class Shapes:
    def __init__(self, font: TTFont):
        buf = io.BytesIO()
        font.save(buf)
        self.pf = ImageFont.truetype(io.BytesIO(buf.getvalue()), PX)
        self.cache: dict[str, tuple[float, dict[int, tuple[int, int]]]] = {}
        self.body = range(min(self.rows("o")), 0)

    def rows(self, ch: str) -> dict[int, tuple[int, int]]:
        return self.get(ch)[1]

    def get(self, ch: str):
        if ch not in self.cache:
            mask, (ox, oy) = self.pf.getmask2(ch, anchor="ls")
            w, h = mask.size
            a = np.array(mask, dtype=np.uint8).reshape(h, w) > 100
            rows = {}
            for r in range(h):
                xs = np.nonzero(a[r])[0]
                if len(xs):
                    rows[oy + r] = (ox + int(xs[0]), ox + int(xs[-1]))
            self.cache[ch] = (self.pf.getlength(ch), rows)
        return self.cache[ch]

    def gap(self, a: str, b: str, rows=None) -> float | None:
        adv, ra = self.get(a)
        rb = self.rows(b)
        gs = [adv + rb[y][0] - ra[y][1] for y in (rows if rows is not None else ra) if y in ra and y in rb]
        return min(gs) if gs else None


def kern_pairs(font: TTFont, v101: dict, added: dict) -> dict[tuple[str, str], int]:
    def chars(code):
        return added[code]["ch"] if code in added else v101.get(code)
    cand: dict[tuple[str, str], int] = {}
    for a, b, n in json.loads((HERE / "pairs.json").read_text()):
        ca, cb = chars(a), chars(b)
        if ca and cb and "?" not in (ca[-1], cb[0]):     # an unreadable mark is not a glyph to space
            key = (ca[-1], cb[0])
            cand[key] = cand.get(key, 0) + n
    for s in INNER:
        cand.setdefault((s[0], s[1]), 1)
    shapes = Shapes(font)
    body = {k: shapes.gap(*k, rows=shapes.body) for k in cand}
    measured = [(g, cand[k]) for k, g in body.items() if g is not None]
    gs = np.array([g for g, _ in measured]); ws = np.array([w for _, w in measured])
    order = np.argsort(gs)
    median = gs[order][np.searchsorted(np.cumsum(ws[order]) / ws.sum(), 0.5)]
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    out = {}
    for (a, b), g in body.items():
        if g is None:
            continue
        if g > LOOSE * median:
            want = g - TO * median                      # pull in by this much
            full = shapes.gap(a, b)                     # but keep clear everywhere
            if full is not None:
                want = min(want, full - CLEAR)
            k = -want
        elif g < COLLIDE:
            k = CLEAR - g
        else:
            continue
        units = round(k * upm / PX / 5) * 5
        if abs(units) >= 20:
            out[(cmap[ord(a)], cmap[ord(b)])] = units
    return out
