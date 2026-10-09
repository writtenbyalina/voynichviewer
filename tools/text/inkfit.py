#!/usr/bin/env python3
"""Word outlines fitted to the ink: each word of a line drawn tight round its own glyphs, turned the way it is written.

  python3 tools/text/inkfit.py [page ...]     # refines data/text/rf/shapes/<page>.json in place (all pages if none)

rf.py gives every word a shape from The Voynichese Project's boxes (or, on the Rosettes, Placa's): close to the word,
but loose, often a few glyphs off, sometimes over the line above or below. This moves each shape onto the ink:

  1. the ink: what is darker than the parchment around it, leaving out the paint (greens, blues, reds);
  2. each line is straightened: a strip is cut along it (a ring is unrolled round its centre; a straight or drooping
     line follows a curve through its words), so the line runs level and its words follow one another left to right;
  3. in the strip, the band the glyphs sit in is found, and the line is cut where its glyphs leave a gap: the pieces
     are shared out among the line's words, in order, by how many glyphs each word has and where the old shapes put
     it (a dynamic programme: a word takes a run of pieces; a piece no word wants is left out, a drawing crossing the
     line; two words written without a gap are cut where the least ink is);
  4. each word's outline is the box round its own ink in the strip (its gallows and tails too, a hair's breadth
     outside them), turned back onto the page: a band of the ring for a ring, a box turned to the line otherwise;
  5. a word alone in its line (a label) is turned the way its ink runs, when its ink clearly runs one way.

A line the fit cannot read well (too little ink where its words should be, or words that would have to stretch or
shrink beyond reason) keeps rf.py's shapes. Shapes are in rf.py's units: thousandths of the panel image's height.
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SHAPES = ROOT / "data" / "text" / "rf" / "shapes"
CODE = re.compile(r"[A-Z][0-9a-z%]")

PAD = 0.25          # outline padding outside the ink, in x-heights: the outline just clear of the strokes
EVA = json.loads((ROOT / "data" / "text" / "rf" / "alpha.json").read_text())["schemes"]["eva"]["codes"]
MIN_FIT = 0.55      # a line is refitted only if this share of its words get ink of their own


# ---------------------------------------------------------------- the ink
def ink_map(im: np.ndarray) -> np.ndarray:
    """How much each pixel is the scribe's ink, 0..1: darker than the parchment around it (a median of its
    neighbourhood), measured against how dark this page's ink is (pages differ: the zodiac's is pale), and not
    the colour of paint (redder, greener or bluer than the page's ink)."""
    g = im.min(axis=2)                                         # the darkest channel: red ink is as dark as brown there
    bg = cv2.medianBlur(g, 31).astype(np.float32)
    d = bg - g.astype(np.float32)
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB).astype(np.int16)
    a, b = lab[..., 1] - 128, lab[..., 2] - 128
    strong = d > max(20.0, float(np.percentile(d, 99)) * 0.6)
    a_ink = float(np.median(a[strong])) if strong.any() else 4.0
    b_ink = float(np.median(b[strong])) if strong.any() else 12.0
    colour = (a > a_ink + 7) | (a < a_ink - 6) | (b < b_ink - 10)
    # paint is laid in areas; a thin stroke in a colour is writing in coloured ink (f67r2's red words): keep it
    k = max(3, im.shape[0] // 280) | 1
    wide = cv2.morphologyEx(colour.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    paint = cv2.dilate(wide, np.ones((3, 3), np.uint8)).astype(bool)
    full = max(25.0, float(np.percentile(d[~paint], 99.3)))     # this page's ink at its darkest
    dark = np.clip((d - 0.3 * full) / (0.45 * full), 0, 1)
    dark[paint] = 0
    # specks of the parchment's grain out: a mark smaller than a glyph's dot, alone
    n, lab, st, _ = cv2.connectedComponentsWithStats((dark > 0.2).astype(np.uint8), connectivity=8)
    small = np.zeros(n, bool)
    small[1:] = st[1:, cv2.CC_STAT_AREA] < max(6, im.shape[0] // 230)
    dark[small[lab]] = 0
    return dark


# ---------------------------------------------------------------- shapes
def shape_poly(kind, v):
    """a shape's outline as points (thousandths of height)"""
    if kind == "r":
        x, y, w, h = v[:4]
        return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], float)
    if kind == "o":
        cx, cy, L, h, a = v[:5]
        t = math.radians(a)
        d, n = np.array([math.cos(t), math.sin(t)]), np.array([-math.sin(t), math.cos(t)])
        c = np.array([cx, cy])
        return np.array([c - d * L / 2 - n * h / 2, c + d * L / 2 - n * h / 2, c + d * L / 2 + n * h / 2, c - d * L / 2 + n * h / 2])
    if kind == "a":
        cx, cy, r0, r1, a0, a1 = v[:6]
        angs = np.radians(np.linspace(a0, a1, 16))
        outer = np.c_[cx + r1 * np.cos(angs), cy + r1 * np.sin(angs)]
        inner = np.c_[cx + r0 * np.cos(angs[::-1]), cy + r0 * np.sin(angs[::-1])]
        return np.r_[outer, inner]
    raise ValueError(kind)


def thickness(kind, v):
    if kind == "r":
        return min(v[2], v[3])
    if kind == "o":
        return v[3]
    return v[3] - v[2]


# ---------------------------------------------------------------- a line, straightened
class Strip:
    """A strip cut along a curve: column s runs along the line in reading order, row v across it (downwards for the
    glyphs). pts(s) and nrm(s) give the curve's point and the glyphs' downward direction, in panel pixels."""

    def __init__(self, pts: np.ndarray, nrm: np.ndarray, half: int, ink: np.ndarray):
        self.pts, self.nrm, self.half = pts, nrm, half
        vs = np.arange(-half, half + 1, dtype=np.float32)
        mx = (pts[:, 0][None, :] + vs[:, None] * nrm[:, 0][None, :]).astype(np.float32)
        my = (pts[:, 1][None, :] + vs[:, None] * nrm[:, 1][None, :]).astype(np.float32)
        self.img = cv2.remap(ink, mx, my, cv2.INTER_LINEAR, borderValue=0)   # rows v (-half..half), columns s

    def at(self, s: float, v: float) -> np.ndarray:
        """a strip position back on the panel (pixels)"""
        i = min(max(s, 0), len(self.pts) - 1)
        i0 = int(math.floor(i)); i1 = min(i0 + 1, len(self.pts) - 1); f = i - i0
        p = self.pts[i0] * (1 - f) + self.pts[i1] * f
        n = self.nrm[i0] * (1 - f) + self.nrm[i1] * f
        return p + (v - self.half) * n


def straight_curve(centres: np.ndarray, ang: float, s_lo: float, s_hi: float):
    """a line through the words' centres at angle ang (degrees), drooping if they do: (points, normals, origin u)"""
    t = math.radians(ang)
    d, n = np.array([math.cos(t), math.sin(t)]), np.array([-math.sin(t), math.cos(t)])
    o = centres.mean(0)
    u = (centres - o) @ d
    w = (centres - o) @ n
    deg = 2 if len(u) >= 5 and np.ptp(u) > 0 else 1 if len(u) >= 2 and np.ptp(u) > 0 else 0
    coef = np.polyfit(u, w, deg) if deg else np.array([np.median(w)])
    if deg == 2 and abs(coef[0]) * (np.ptp(u) / 2) ** 2 > 0.03 * np.ptp(u):   # no more droop than a page's lines have
        coef = np.polyfit(u, w, 1)
    us = np.arange(s_lo, s_hi + 1, dtype=np.float64)
    ws = np.polyval(coef, us)
    dw = np.polyval(np.polyder(coef), us) if len(coef) > 1 else np.zeros_like(us)
    pts = o + us[:, None] * d + ws[:, None] * n
    tan = d + dw[:, None] * n
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    nrm = np.c_[-tan[:, 1], tan[:, 0]]
    return pts, nrm, u


def ring_curve(cx, cy, R, a_lo, a_hi, sense):
    """points round a circle from angle a_lo to a_hi (degrees, screen), read in direction sense (+1 clockwise)"""
    n = max(2, int(abs(math.radians(a_hi - a_lo)) * R) + 1)
    angs = np.radians(np.linspace(a_lo, a_hi, n))
    pts = np.c_[cx + R * np.cos(angs), cy + R * np.sin(angs)]
    tan = sense * np.c_[-np.sin(angs), np.cos(angs)]
    nrm = np.c_[-tan[:, 1], tan[:, 0]]
    return pts, nrm, angs


# ---------------------------------------------------------------- reading a strip
def band(strip: np.ndarray, cols: slice, xh_guess: float):
    """the row band the glyphs' bodies sit in: (centre row, x-height)"""
    prof = strip[:, cols].sum(1)
    k = max(3, int(xh_guess) | 1)
    sm = np.convolve(prof, np.ones(k) / k, mode="same")
    mid = len(prof) // 2
    lo, hi = max(0, mid - int(1.1 * xh_guess)), min(len(prof), mid + int(1.1 * xh_guess) + 1)
    c = lo + int(np.argmax(sm[lo:hi]))
    if sm[c] <= 0:
        return mid, xh_guess
    half = sm[c] / 2
    a = c
    while a > 0 and sm[a] > half:
        a -= 1
    b = c
    while b < len(sm) - 1 and sm[b] > half:
        b += 1
    xh = float(np.clip(b - a, 0.5 * xh_guess, 1.6 * xh_guess))
    return (a + b) / 2, xh


def pieces(col: np.ndarray, thr: float, bridge: int = 1):
    """runs of columns with ink, gaps narrower than bridge columns not ending a run (the small gaps between the
    strokes of one word): [(start, end, ink)]"""
    on = col > thr
    runs, i, n = [], 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n:
                if on[j]:
                    j += 1
                    continue
                g = j
                while g < n and not on[g] and g - j < bridge:
                    g += 1
                if g < n and on[g] and g - j < bridge:
                    j = g
                    continue
                break
            runs.append((i, j, float(col[i:j].sum())))
            i = j
        else:
            i += 1
    return runs


def share(units, n, expect, widths, xh, ext=None):
    """Share the units [(start, end, ink, cost of a cut before it)] out among n words in order: each word a run of
    units, units no word takes left out (a drawing, a stray mark). expect, widths: each word's expected centre and
    width. Returns [(first unit, last unit)] per word, or None."""
    U = len(units)
    if U == 0 or n == 0:
        return None
    BIG = 1e18
    starts = np.array([u[0] for u in units], float)
    stops = np.array([u[1] for u in units], float)
    inks = np.array([u[2] for u in units], float)
    cutc = np.array([u[3] for u in units], float)              # > 0: the unit begins at a cut through ink
    gapw = np.r_[0.0, starts[1:] - stops[:-1]]                 # the gap before each unit
    unit_ink = inks.mean() or 1.0
    leftout = np.r_[0.0, np.cumsum(inks)] / unit_ink * 2.5     # cost of leaving units out

    def word_cost(i, j, k):
        a, b = starts[j], stops[k]
        w = max(1.0, b - a)
        wpos = 0.8 if (ext is None or ext[i] is not None) else 0.15   # (an estimated place is trusted less)
        c = wpos * ((a + b) / 2 - expect[i]) ** 2 / (2.2 * xh) ** 2  # where the old shape put it
        c += 3.0 * math.log(w / widths[i]) ** 2                     # as wide as its glyphs
        c += 1.5 * float(np.clip(gapw[j + 1:k + 1] - 0.55 * xh, 0, None).sum()) / xh   # no word gap inside it
        if ext and ext[i]:                                          # not far past its old box
            lo, hi = ext[i]
            c += 0.6 * (max(0.0, lo - a - 1.0 * xh) + max(0.0, b - hi - 1.0 * xh)) / xh
        return c

    span = 20
    SKIP = 6.0                                                 # a word given no ink at all (it keeps its old shape)
    best = np.full((n + 1, U + 1), BIG)                        # best[i, k]: i words placed, units 0..k-1 used
    back = {}
    best[0, 0] = 0.0
    for i in range(n):
        for k in range(U + 1):                                 # word i skipped: units used stay as they were
            if best[i, k] < BIG and best[i, k] + SKIP < best[i + 1, k]:
                best[i + 1, k] = best[i, k] + SKIP
                back[(i + 1, k)] = None
        for k in range(1, U + 1):                              # word i ends with unit k-1
            for j in range(max(0, k - span), k):               # and starts with unit j
                if abs((starts[j] + stops[k - 1]) / 2 - expect[i]) > 8 * xh + widths[i]:
                    continue
                wc = word_cost(i, j, k - 1)
                for q in range(max(0, j - 25), j + 1):         # the previous word ended with unit q-1
                    prev = best[i, q]
                    if prev >= BIG:
                        continue
                    edge = 0.0
                    if i > 0 and q == j and q > 0:             # next to the previous word
                        edge = cutc[j] if gapw[j] <= 0 or cutc[j] > 0 else -0.4 * min(gapw[j], xh) / xh
                    c = prev + wc + (leftout[j] - leftout[q]) + edge
                    if c < best[i + 1, k]:
                        best[i + 1, k] = c
                        back[(i + 1, k)] = (j, q)
    tail = best[n] + (leftout[U] - leftout)                    # everything after the last word left out
    k = int(np.argmin(tail))
    if tail[k] >= BIG:
        return None
    out = []
    for i in range(n, 0, -1):
        b = back[(i, k)]
        if b is None:
            out.append(None)
            continue
        j, q = b
        out.append((j, k - 1))
        k = q
    return out[::-1]


def cut_units(col: np.ndarray, thr: float, xh: float):
    """the line's columns as units: runs of ink (gaps under 0.4 x-height bridged), and, inside a long run, pieces at
    its narrowest columns (a cut there costs its ink)"""
    runs = pieces(col, thr, max(1, int(round(0.4 * xh))))
    units = []
    cmax = max(1e-6, float(col.max()))
    for a, b, ink in runs:
        cuts = [a]
        if b - a > 2.0 * xh:
            seg = col[a:b]
            sm = np.convolve(seg, np.ones(3) / 3, mode="same")
            cand = [x for x in range(2, len(sm) - 2) if sm[x] <= sm[x - 1] and sm[x] <= sm[x + 1] and sm[x] < 0.5 * sm.max()]
            last = 0
            for x in cand:
                if x - last >= 0.8 * xh and (b - a) - x >= 0.8 * xh:
                    cuts.append(a + x); last = x
        cuts.append(b)
        for q in range(len(cuts) - 1):
            s0, s1 = cuts[q], cuts[q + 1]
            cost = 0.0 if q == 0 else 1.2 + 4 * float(col[s0]) / cmax
            units.append((s0, s1, float(col[s0:s1].sum()), cost))
    return units


def x_height(S: np.ndarray, vc: float, xh0: float, cols: slice) -> float:
    """the height of the glyphs' bodies (o, a, e...) around row vc: the median height of the small strokes there"""
    lo, hi = max(0, int(vc - 1.5 * xh0)), min(S.shape[0], int(vc + 1.5 * xh0) + 1)
    B = (S[lo:hi, cols] > 0.35).astype(np.uint8)
    n, _lab, stats, cent = cv2.connectedComponentsWithStats(B, connectivity=8)
    hs = [stats[i][3] for i in range(1, n) if stats[i][4] >= 6 and stats[i][3] < 2.2 * xh0
          and abs(cent[i][1] + lo - vc) < 0.8 * xh0]
    return float(np.clip(np.median(hs), 5, 1.6 * xh0)) if len(hs) >= 3 else xh0


WIDE = {"i": 0.5, "e": 0.75, "c": 0.8, "h": 0.8}           # how wide an Eva letter's stroke is, against an o


# ---------------------------------------------------------------- one line
class Line:
    """One line of one panel, straightened: its strip, where its words were expected along it, and the rows of the
    strip where a line of glyphs runs (candidates for this line's own row)."""

    def __init__(self, words, ink, H, ring=None, settled=False, est=None):
        self.words, self.ring, self.ok = words, ring, False
        self.est = est or [(0,)] * len(words)
        k = self.k = H / 1000.0                                    # thousandths of height -> pixels
        polys = [shape_poly(kind, v) * k for _, kind, v, _ in words]
        centres = np.array([p.mean(0) for p in polys])
        self.t_px = t_px = float(np.median([thickness(kind, v) for _, kind, v, _ in words])) * k
        self.xh0 = max(6.0, 0.45 * t_px)
        half = int(max(2.6 * t_px, 4 * self.xh0))
        if ring:
            cx, cy, R0 = ring[0] * k, ring[1] * k, ring[2] * k
            self.cx, self.cy = cx, cy
            angs = [math.degrees(math.atan2(c[1] - cy, c[0] - cx)) for c in centres]
            unw = [angs[0]]                                        # unwrapped word by word, in reading order
            for a_ in angs[1:]:
                unw.append(unw[-1] + ((a_ - unw[-1] + 180) % 360) - 180)
            steps = np.diff(unw)
            self.sense = sense = 1 if (np.sum(np.sign(steps)) if len(steps) else 1) >= 0 else -1
            lo_a, hi_a = min(unw), max(unw)
            for p, u_ in zip(polys, unw):                          # the words' own extents
                pa = [u_ + ((math.degrees(math.atan2(q[1] - cy, q[0] - cx)) - u_ + 180) % 360) - 180 for q in p]
                lo_a, hi_a = min(lo_a, min(pa)), max(hi_a, max(pa))
            m = math.degrees(1.5 * t_px / R0)
            lo_a, hi_a = lo_a - m, hi_a + m
            a_lo, a_hi = (lo_a, hi_a) if sense > 0 else (hi_a, lo_a)
            pts, nrm, _ = ring_curve(cx, cy, R0, a_lo, a_hi, sense)
            e_ring = [(u_ - a_lo) * sense * math.pi / 180 * R0 for u_ in unw]
            s_of = None
        else:
            given = [v[4] for _, kind, v, _ in words if kind == "o"]
            if given:
                ang = float(np.median(given))
            elif len(words) >= 2:
                d = centres[-1] - centres[0]
                ang = float(np.clip(math.degrees(math.atan2(d[1], d[0])), -10, 10))
            else:
                ang = 0.0
            if len(words) >= 2:                                    # the line runs from its first word to its last
                d = centres[-1] - centres[0]
                if d @ np.array([math.cos(math.radians(ang)), math.sin(math.radians(ang))]) < 0:
                    ang += 180.0
            t = math.radians(ang)
            dvec = np.array([math.cos(t), math.sin(t)])
            o = centres.mean(0)
            us = [float((p - o) @ dvec) for p in np.concatenate(polys)]
            lo_u, hi_u = min(us) - 2 * t_px, max(us) + 2 * t_px
            if self.est[0][-1]:                                    # a first or last word whose place is only estimated:
                lo_u -= 5 * t_px                                   # look further for it
            if self.est[-1][-1]:
                hi_u += 5 * t_px
            # the line's own slant: the angle at which its glyphs' row projects sharpest
            pts, nrm, _ = straight_curve(o[None, :], ang, lo_u, hi_u)
            S0 = Strip(pts, nrm, half, ink).img
            best, ang_fix = -1.0, 0.0
            cols = np.arange(S0.shape[1]); mid = cols.mean()
            for dd in np.arange(-6, 6.01, 0.25) if len(words) >= 2 else [0.0]:
                sh = np.round(math.tan(math.radians(dd)) * (cols - mid)).astype(int)
                rows = np.arange(S0.shape[0])[:, None] + sh[None, :]
                ok = (rows >= 0) & (rows < S0.shape[0])
                prof = np.where(ok, S0[np.clip(rows, 0, S0.shape[0] - 1), cols[None, :]], 0).sum(1)
                q = float((prof ** 2).sum())
                if q > best:
                    best, ang_fix = q, dd
            ang += ang_fix
            pts, nrm, _ = straight_curve(o[None, :], ang, lo_u, hi_u)
            s_of = lambda c: float(np.argmin(np.linalg.norm(pts - c, axis=1)))
        if len(pts) < 4:
            return
        self.pts, self.nrm, self.half = pts, nrm, half
        self.st = Strip(pts, nrm, half, ink)
        S = self.S = self.clean(self.st.img)
        self.e_s = np.array(e_ring if ring else [s_of(c) for c in centres])
        # each word's old extent along the strip (a soft limit: a word may shrink inside it, not run far past it)
        ext = []
        for p, es in zip(polys, self.e_s):
            if ring:
                ss = [es + (((math.degrees(math.atan2(q[1] - cy, q[0] - cx)) - math.degrees(math.atan2(c_[1] - cy, c_[0] - cx)) + 180) % 360 - 180)
                      * sense * math.pi / 180 * R0) for q in p for c_ in [p.mean(0)]]
            else:
                ss = [s_of(q) for q in p]
            ext.append((min(ss), max(ss)))
        self.ext = ext
        if ring and not settled:
            # a ring's writing wanders off the circle rf.py fitted (the circle is not quite round, the scribe drifts):
            # follow the writing's own row along the unrolled ring, near where the words' old shapes put it, and
            # unroll again along that path (column for column, so the words' places along it stay as they are)
            prior = np.full(S.shape[1], float(half))
            rows_w = [half + float((c - pts[int(np.clip(es, 0, len(pts) - 1))]) @ nrm[int(np.clip(es, 0, len(pts) - 1))])
                      for c, es in zip(centres, self.e_s)]
            o_ = np.argsort(self.e_s)
            prior = np.interp(np.arange(S.shape[1]), self.e_s[o_], np.array(rows_w)[o_])
            path = track_rows(S, self.xh0, prior)
            if len(path) >= 4:
                pc, pr = np.array([q[0] for q in path]), np.array([q[1] for q in path])
                rr = np.interp(np.arange(len(pts)), pc, pr)
                kk = max(3, int(6 * self.xh0) | 1)
                pad_ = np.pad(rr, kk // 2, mode="edge")
                rr = np.convolve(pad_, np.ones(kk) / kk, mode="valid")[:len(pts)]
                npts = np.array([self.st.at(i, r) for i, r in enumerate(rr)])
                tan = np.gradient(npts, axis=0)
                tan /= np.maximum(1e-9, np.linalg.norm(tan, axis=1, keepdims=True))
                nn = np.c_[-tan[:, 1], tan[:, 0]]
                nn *= np.sign((nn * nrm).sum(1, keepdims=True) + 1e-9)       # the glyphs' downward side as before
                self.pts, self.nrm = pts, nrm = npts, nn
                self.st = Strip(pts, nrm, half, ink)
                S = self.S = self.clean(self.st.img)
        self.cols = slice(max(0, int(self.e_s.min() - t_px)), min(S.shape[1], int(self.e_s.max() + t_px) + 1))
        # rows where a line of glyphs runs: peaks of the row profile across this line's columns
        prof = S[:, self.cols].sum(1)
        kk = max(3, int(self.xh0) | 1)
        sm = np.convolve(prof, np.ones(kk) / kk, mode="same")
        top = sm.max()
        self.cands = []
        if top > 0:
            for r in range(1, len(sm) - 1):
                if sm[r] >= sm[r - 1] and sm[r] > sm[r + 1] and sm[r] >= 0.2 * top:
                    self.cands.append((r, float(sm[r] / top)))
        mid = len(pts) // 2
        self.mid_pt, self.mid_n = pts[mid], nrm[mid]
        self.ok = bool(self.cands)

    def clean(self, S):
        """a strip's ink, faint ink read as ink, without drawings or ruled lines"""
        on = S[S > 0.2]                                            # faint ink read as ink: the strip's own darkest
        if on.size > 50:                                           # strokes count as full ink
            S = np.clip(S / max(0.45, float(np.percentile(on, 95))), 0, 1)
        # drawings out (a figure's outline, a stem): strokes too tall or too long for glyphs
        n_, lab_, st_, _c = cv2.connectedComponentsWithStats((S > 0.3).astype(np.uint8), connectivity=8)
        big = np.zeros(n_, bool)
        big[1:] = (st_[1:, 3] > 5.5 * self.xh0) | (st_[1:, 2] > 10 * self.xh0)   # (a line's first gallows can be tall)
        S = np.where(big[lab_], 0.0, S)
        # a ruled line along the writing (a ring's circle) out: rows inked along most of their length, piece by piece
        W_ = max(8, int(4 * self.xh0))
        for c0 in range(0, S.shape[1], W_):
            full = (S[:, c0:c0 + W_] > 0.3).mean(1) > 0.8
            if full.any():
                S[np.nonzero(full)[0], c0:c0 + W_] = 0.0
        return S

    def height(self, row: float, n_ref) -> float:
        """how far down the page a candidate row lies, measured along n_ref"""
        return float((self.mid_pt + (row - self.half) * self.mid_n) @ n_ref)

    def fit(self, vc: float):
        """the words' outlines with the glyphs' row at vc: {wi: (kind, nums, reading angle)}, or {}"""
        S, k, words, e_s = self.S, self.k, self.words, self.e_s
        xh = self.xh0
        xh = x_height(S, vc, self.xh0, self.cols)
        kk = max(3, int(xh) | 1)
        # drawings out: a stroke taller than a gallows or wider than a long word is a plant, a figure, a ring's line
        n_, lab_, st_, _c = cv2.connectedComponentsWithStats((S > 0.3).astype(np.uint8), connectivity=8)
        big = np.zeros(n_, bool)
        big[1:] = (st_[1:, 3] > 4.2 * xh) | (st_[1:, 2] > 10 * xh)
        S = np.where(big[lab_], 0.0, S)
        # the row per word, for a line that wanders
        offs = []
        for es in e_s:
            c0, c1 = max(0, int(es - 2 * xh)), min(S.shape[1], int(es + 2 * xh) + 1)
            lo = max(0, int(vc - 0.8 * xh))
            sub = S[lo:int(vc + 0.8 * xh) + 1, c0:c1].sum(1)
            if sub.sum() > 0:
                q = np.convolve(sub, np.ones(kk) / kk, mode="same")
                offs.append(lo + int(np.argmax(q)) - vc)
            else:
                offs.append(0.0)
        offs = np.clip(np.array(offs, float), -0.5 * xh, 0.5 * xh)
        order = np.argsort(e_s)
        off_at = np.interp(np.arange(S.shape[1]), e_s[order], offs[order])
        core = np.zeros(S.shape[1])
        lo_band = np.zeros(S.shape[1], int); hi_band = np.zeros(S.shape[1], int)
        for s in range(S.shape[1]):
            a = int(round(vc + off_at[s] - 0.55 * xh)); b = int(round(vc + off_at[s] + 0.55 * xh)) + 1
            lo_band[s], hi_band[s] = max(0, a), min(S.shape[0], b)
            core[s] = S[lo_band[s]:hi_band[s], s].sum()
        units = cut_units(core, 0.15 * xh, xh)
        if not units:
            return {}
        glyphs = [max(0.5, g) for _, _, _, g in words]               # each word's width in o's
        inked = sum(u[1] - u[0] for u in units if self.cols.start - xh <= u[0] <= self.cols.stop + xh)
        gw = max(0.5 * xh, min(1.8 * xh, inked / max(1, sum(glyphs))))
        widths = [g * gw for g in glyphs]
        got = share(units, len(words), e_s, widths, xh, [None if w[-1] else e for w, e in zip(self.est, self.ext)])
        if not got:
            return {}
        # This line's strip of the page, between seams: a path along the gap to the line above (and one to the line
        # below) that runs through the least ink, round a gallows rising from this line and under a tail hanging from
        # the line above, cutting a stroke only where two lines' strokes touch (seam carving, as in text-line
        # segmentation). Gallows rise about 2.5 x-heights, tails hang about 1.
        above = [r for r, st in self.cands if r < vc - 1.5 * xh and st >= 0.3]
        below = [r for r, st in self.cands if r > vc + 1.5 * xh and st >= 0.3]
        ra, rb = (max(above) if above else None), (min(below) if below else None)
        top = max(0, int(math.floor(vc - 3.4 * xh)))
        bot = min(S.shape[0], int(math.ceil(vc + 2.0 * xh)))
        up = seam(S, int(ra + 0.5 * xh), int(vc - 0.6 * xh)) if ra is not None else np.full(S.shape[1], top)
        dn = seam(S, int(vc + 0.6 * xh), int(rb - 0.5 * xh)) if rb is not None else np.full(S.shape[1], bot)
        up, dn = np.maximum(up, top), np.minimum(dn, bot)
        # a stroke that touches this line's body and no other line's is wholly this line's (a gallows' whole loop); one
        # that touches no body, or another line's too, is cut at the seams
        B = (S > 0.3).astype(np.uint8)
        ncomp, lab, _st, _c = cv2.connectedComponentsWithStats(B, connectivity=8)
        rows_ = np.arange(S.shape[0])[:, None]
        own_band = (rows_ >= lo_band[None, :]) & (rows_ < hi_band[None, :])
        cnt = lambda m: np.bincount(lab[m & (lab > 0)], minlength=ncomp)
        own_n = cnt(own_band)
        other = np.zeros_like(own_band)
        for r_ in (ra, rb):
            if r_ is not None:
                other |= np.abs(rows_ - r_) < 0.55 * xh
        oth_n = cnt(other)
        whole = (own_n > 0) & (oth_n == 0)
        whole[0] = False
        between = (rows_ >= up[None, :]) & (rows_ < dn[None, :])
        mine = B.astype(bool) & between & ((own_n[lab] >= oth_n[lab]) | whole[lab])
        self.debug = dict(vc=vc, xh=xh, top=top, bot=bot)
        out, good = {}, 0
        pad = PAD * xh
        for (wi, kind, v, g), jk, es, w_exp in zip(words, got, e_s, widths):
            if jk is None:
                continue
            j, kk2 = jk
            a, b = units[j][0], units[kk2][1]
            if not (0.4 * w_exp <= b - a <= 2.4 * w_exp + xh) or abs((a + b) / 2 - es) > 6 * xh + w_exp:
                continue
            keep = mine[top:bot, a:b]
            if keep.sum() < 3:
                continue
            ys, xs = np.nonzero(keep)
            v0, v1 = top + ys.min() - pad, top + ys.max() + 1 + pad
            u0, u1 = a + xs.min() - pad, a + xs.max() + 1 + pad
            # the box takes in no real part of another word: rows holding a glyph's worth of ink that is not this
            # word's are trimmed off its top and bottom (never into the word's body)
            c0_, c1_ = max(0, int(u0)), min(S.shape[1], int(math.ceil(u1)))
            foreign = (S[:, c0_:c1_] > 0.3) & ~mine[:, c0_:c1_]
            body_lo, body_hi = int(lo_band[a:b].min()), int(hi_band[a:b].max())
            lim = 0.2 * xh * xh
            r0_, r1_ = int(math.floor(v0)), int(math.ceil(v1))
            while r0_ < body_lo and foreign[max(0, r0_):max(0, r0_) + max(1, int(xh)), :].sum() > lim:
                r0_ += 1
            while r1_ > body_hi and foreign[max(0, r1_ - max(1, int(xh))):r1_, :].sum() > lim:
                r1_ -= 1
            v0, v1 = max(v0, r0_), min(v1, r1_)
            out[wi] = self.shape(u0, u1, v0, v1)
            good += 1
        if good < MIN_FIT * len(words):
            return {}
        return out

    def shape(self, u0, u1, v0, v1):
        st, k = self.st, self.k
        if self.ring:
            cx, cy, sense = self.cx, self.cy, self.sense
            p0, p1 = st.at(u0, (v0 + v1) / 2), st.at(u1, (v0 + v1) / 2)
            a0 = math.degrees(math.atan2(p0[1] - cy, p0[0] - cx)); a1 = math.degrees(math.atan2(p1[1] - cy, p1[0] - cx))
            rr = [float(np.linalg.norm(st.at((u0 + u1) / 2, vv) - [cx, cy])) for vv in (v0, v1)]
            if sense < 0:
                a0, a1 = a1, a0
            if a1 < a0:
                a1 += 360
            mid = math.radians((a0 + a1) / 2)
            read = math.degrees(math.atan2(sense * math.cos(mid), -sense * math.sin(mid)))
            return ("a", [cx / k, cy / k, min(rr) / k, max(rr) / k, a0, a1], read)
        sm = (u0 + u1) / 2
        c = st.at(sm, (v0 + v1) / 2)
        i0 = int(min(max(sm, 0), len(self.pts) - 1))
        tvec = np.array([self.nrm[i0][1], -self.nrm[i0][0]])
        ang = math.degrees(math.atan2(tvec[1], tvec[0]))
        L, Hh = u1 - u0, v1 - v0
        if abs(ang) < 1.0:
            return ("r", [(c[0] - L / 2) / k, (c[1] - Hh / 2) / k, L / k, Hh / k], 0.0)
        return ("o", [c[0] / k, c[1] / k, L / k, Hh / k, ang], ang)


def seam(S: np.ndarray, r0: int, r1: int) -> np.ndarray:
    """the path across a strip, between rows r0 and r1, through the least ink (a row per column, moving at most one
    row from column to column)"""
    r0, r1 = max(0, r0), min(S.shape[0] - 1, r1)
    if r1 <= r0:
        return np.full(S.shape[1], (r0 + r1) // 2)
    C = S[r0:r1 + 1] * 10.0 + 0.02                             # ink is dear; parchment nearly free
    mid, half = (r0 + r1) / 2, max(1.0, (r1 - r0) / 2)
    C += (0.15 * ((np.arange(r0, r1 + 1) - mid) / half) ** 2)[:, None]   # and the middle of the gap a little cheaper
    n, m = C.shape
    acc = C[:, 0].copy()
    back = np.zeros((m, n), np.int8)
    for c in range(1, m):
        up_ = np.r_[np.inf, acc[:-1]] + 0.05
        dn_ = np.r_[acc[1:], np.inf] + 0.05
        stack = np.vstack([acc, up_, dn_])
        k = np.argmin(stack, axis=0)
        acc = stack[k, np.arange(n)] + C[:, c]
        back[c] = k
    r = int(np.argmin(acc))
    path = np.empty(m, int)
    for c in range(m - 1, -1, -1):
        path[c] = r
        k = back[c, r]
        r = r - 1 if k == 1 else r + 1 if k == 2 else r
    return path + r0


def fit_circle(pts: np.ndarray):
    """least-squares circle through points (Kasa): centre and radius"""
    x, y = pts[:, 0], pts[:, 1]
    A = np.c_[2 * x, 2 * y, np.ones(len(x))]
    sol, *_ = np.linalg.lstsq(A, x * x + y * y, rcond=None)
    cx, cy = sol[0], sol[1]
    return cx, cy, math.sqrt(max(1e-9, sol[2] + cx * cx + cy * cy))


def track_rows(S: np.ndarray, xh: float, prior=None):
    """the row a line of writing runs along, window by window across a strip, as one smooth path (the strongest rows,
    with as little jumping as possible): [(column, row)]"""
    W = int(max(20, 6 * xh))
    k = max(3, int(xh) | 1)
    wins = []
    for c in range(0, S.shape[1] - W // 2, W // 2):
        prof = np.convolve(S[:, c:c + W].sum(1), np.ones(k) / k, mode="same")
        top = prof.max()
        if top <= 0.5 * xh:                                       # hardly any ink: a gap in the ring
            continue
        pk = [(r, prof[r] / top) for r in range(1, len(prof) - 1) if prof[r] >= prof[r - 1] and prof[r] > prof[r + 1]
              and prof[r] >= 0.35 * top]
        if prior is not None:                                     # near where the words were thought to be
            pr = float(prior[min(len(prior) - 1, int(c + W / 2))])
            pk = [(r, st - 0.35 * ((r - pr) / xh) ** 2) for r, st in pk if abs(r - pr) < 3.5 * xh]
        if pk:
            wins.append((c + W / 2, pk))
    if len(wins) < 2:
        return []
    BIG = 1e18
    best = [[-st for _r, st in wins[0][1]]]
    back = [[None] * len(wins[0][1])]
    for i in range(1, len(wins)):
        cur, bk = [], []
        for r, st in wins[i][1]:
            vals = [best[i - 1][j] + 0.5 * ((r - r0) / xh) ** 2 for j, (r0, _s) in enumerate(wins[i - 1][1])]
            j = int(np.argmin(vals))
            cur.append(vals[j] - st); bk.append(j)
        best.append(cur); back.append(bk)
    j = int(np.argmin(best[-1]))
    path = []
    for i in range(len(wins) - 1, -1, -1):
        path.append((wins[i][0], wins[i][1][j][0]))
        j = back[i][j] if i else None
    return path[::-1]


def choose_rows(lines: list) -> list:
    """Each line's own row of glyphs, chosen for a run of lines together: the lines of a paragraph (one after
    another, side by side on the page) take rows one below the next, never the same row, each near where it was
    expected. lines: [Line] in the transcription's order, all straight. Returns a row (or None) per line."""
    if not lines:
        return []
    sp = np.median([b[0] - a[0] for ln in lines for a, b in zip(ln.cands, ln.cands[1:])] or [3 * lines[0].xh0])
    sp = max(sp, 1.5 * lines[0].xh0)
    n_ref = lines[0].mid_n
    BIG = 1e18
    opts = []
    for ln in lines:
        o = [(r, st, ln.height(r, n_ref)) for r, st in ln.cands]
        opts.append(o)
    # cost of a choice: away from where it was expected, and a weak row
    def cost(i, c):
        r, st, _y = opts[i][c]
        return 2.0 * ((r - lines[i].half) / sp) ** 2 - 1.0 * st
    best = [[BIG] * len(o) for o in opts]
    back = [[None] * len(o) for o in opts]
    for c in range(len(opts[0])):
        best[0][c] = cost(0, c)
    for i in range(1, len(lines)):
        for c in range(len(opts[i])):
            yc = opts[i][c][2]
            for c0 in range(len(opts[i - 1])):
                if best[i - 1][c0] >= BIG:
                    continue
                # each line below the one before (strongly preferred, not forced: a paragraph can step round a drawing)
                v = best[i - 1][c0] + cost(i, c) + (3.0 if yc < opts[i - 1][c0][2] + 0.5 * sp else 0.0)
                if v < best[i][c]:
                    best[i][c], back[i][c] = v, c0
    out = [None] * len(lines)
    if not opts[-1] or min(best[-1]) >= BIG:
        return [nearest_row(ln) for ln in lines]                     # no order fits: each its nearest row
    c = int(np.argmin(best[-1]))
    for i in range(len(lines) - 1, -1, -1):
        out[i] = opts[i][c][0]
        c = back[i][c] if i else None
    return out


def nearest_row(ln: "Line"):
    """a lone line's row: the strongest near where it was expected"""
    good = [(st - 0.5 * ((r - ln.half) / ln.t_px) ** 2, r) for r, st in ln.cands
            if st >= 0.3 and abs(r - ln.half) <= 0.8 * ln.t_px]
    return max(good)[1] if good else None


def fit_label(kind, nums, glyphs, ink, H):
    """A label (a word alone) the line fit could not place: the word-shaped cluster of glyph strokes that overlaps its
    old shape most, outlined as a box turned to the way its ink runs. Returns (kind, nums, reading angle) or None."""
    k = H / 1000.0
    P = shape_poly(kind, nums) * k
    t = max(6.0, thickness(kind, nums) * k)
    xh = 0.45 * t
    x0, y0 = np.floor(P.min(0) - 2.5 * t).astype(int); x1, y1 = np.ceil(P.max(0) + 2.5 * t).astype(int)
    x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(ink.shape[1], x1), min(ink.shape[0], y1)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    sub = ink[y0:y1, x0:x1]
    B = (sub > 0.3).astype(np.uint8)
    n, lab, st, _c = cv2.connectedComponentsWithStats(B, connectivity=8)
    ok = np.zeros(n, bool)                                     # glyph strokes, not a drawing's lines
    ok[1:] = (st[1:, cv2.CC_STAT_HEIGHT] < 3.5 * xh) & (st[1:, cv2.CC_STAT_WIDTH] < 3.0 * xh) & (st[1:, cv2.CC_STAT_AREA] >= 4)
    G = ok[lab].astype(np.uint8)
    kk = max(3, int(0.9 * xh) | 1)
    J = cv2.dilate(G, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kk, kk)))
    nw, labw, stw, _ = cv2.connectedComponentsWithStats(J, connectivity=8)
    old = np.zeros_like(G)
    cv2.fillPoly(old, [np.int32(P - [x0, y0])], 1)
    best = None
    for i in range(1, nw):
        m = (labw == i) & (G > 0)
        ov = int((m & (old > 0)).sum())
        if ov < 0.3 * m.sum() or m.sum() < 1.2 * xh * xh:
            continue
        score = ov - 0.2 * int((m & (old == 0)).sum())
        if best is None or score > best[0]:
            best = (score, m)
    if best is None:
        return None
    ys, xs = np.nonzero(best[1])
    pts = np.c_[xs + x0, ys + y0].astype(np.float32)
    (cx, cy), (rw, rh), ang = cv2.minAreaRect(pts)
    if rw < rh:
        rw, rh, ang = rh, rw, ang + 90
    ang = ((ang + 90) % 180) - 90                              # read left to right (or downwards)
    if rw < 0.4 * glyphs * xh or rw > 3.0 * glyphs * xh + 2 * xh:   # not the size of this word
        return None
    pad = PAD * xh
    L, Hh = (rw + 2 * pad) / k, (rh + 2 * pad) / k
    if abs(ang) < 4:
        return ("r", [(cx / k) - L / 2, (cy / k) - Hh / 2, L, Hh], 0.0)
    return ("o", [cx / k, cy / k, L, Hh, ang], ang)


def label_angle(v_poly: np.ndarray, ink: np.ndarray, H: float, ratio: float = 4.0):
    """the way a lone word's ink runs, in degrees, when it clearly runs one way; else None"""
    k = H / 1000.0
    p = v_poly * k
    x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
    m = 0.3 * max(x1 - x0, y1 - y0)
    x0, y0 = max(0, int(x0 - m)), max(0, int(y0 - m)); x1, y1 = min(ink.shape[1], int(x1 + m)), min(ink.shape[0], int(y1 + m))
    sub = (ink[y0:y1, x0:x1] > 0.35).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(sub, connectivity=8)
    big = max(x1 - x0, y1 - y0) * 0.45                         # strokes of glyphs only, not a drawing's lines
    keep = np.zeros(n, bool)
    keep[1:] = (st[1:, cv2.CC_STAT_WIDTH] < big) & (st[1:, cv2.CC_STAT_HEIGHT] < big)
    ys, xs = np.nonzero(keep[lab])
    if len(xs) < 20:
        return None
    pts = np.c_[xs, ys].astype(float)
    pts -= pts.mean(0)
    evals, evecs = np.linalg.eigh(np.cov(pts.T))
    if evals[1] < ratio * max(evals[0], 1e-6):
        return None
    d = evecs[:, 1]
    ang = math.degrees(math.atan2(d[1], d[0]))
    ang = ((ang + 90) % 180) - 90                              # read left to right (or downwards)
    return ang


# ---------------------------------------------------------------- a page
def refine(page: str, data: dict, loci_sta: list[str], panels: dict[int, np.ndarray]) -> tuple[list, dict]:
    """data: a shapes file's content; loci_sta: each locus's RF1b STA; panels: panel index -> image (BGR).
    Returns the new word rows and counts."""
    words_by = {}
    for r in data["words"]:
        li, wi, pi, kind = r[0], r[1], r[2], r[3]
        nums = r[4:-2]
        words_by.setdefault((li, pi), []).append((wi, kind, nums, r))
    # a word of a line without a place, between two of its words that have one on the same panel: a place between
    # them to start from, estimated (the fit below then looks for it on the ink)
    for (li, pi), ws in words_by.items():
        sta = loci_sta[li] if li < len(loci_sta) else ""
        n = len(re.split(r"[.,\-]", sta)) if sta else 0
        have = {w[0]: w for w in ws}
        for wi in range(n):
            if wi in have:
                continue
            a = max((x for x in have if x < wi), default=None)
            b = min((x for x in have if x > wi), default=None)
            if a is None or b is None or b - a > 4:
                continue
            ra, rb = have[a][3], have[b][3]
            f = (wi - a) / (b - a)
            if ra[3] == rb[3] == "a" and abs(ra[4] - rb[4]) < 1 and abs(ra[5] - rb[5]) < 1:
                ea, sb = ra[9], rb[8]                          # the gap between them, round the ring
                span = ((sb - ea + 180) % 360) - 180
                mid = ea + span * f
                half = max(1.0, abs(span) / (b - a) / 2.5)
                nums = [ra[4], ra[5], (ra[6] + rb[6]) / 2, (ra[7] + rb[7]) / 2, mid - half, mid + half]
                row = [li, wi, pi, "a", *nums, ra[-2], 1]
            else:
                ca, cb = shape_poly(ra[3], ra[4:-2]).mean(0), shape_poly(rb[3], rb[4:-2]).mean(0)
                c = ca + (cb - ca) * f
                ang = math.degrees(math.atan2(*(cb - ca)[::-1]))
                t = min(thickness(ra[3], ra[4:-2]), thickness(rb[3], rb[4:-2]))
                L = max(t, np.linalg.norm(cb - ca) / (b - a) * 0.6)
                nums = [float(c[0]), float(c[1]), L, t, ang]
                row = [li, wi, pi, "o", *nums, ang, 1]
            ws.append((wi, row[3], row[4:-2], row))
    inks = {pi: ink_map(im) for pi, im in panels.items()}
    new, lines = {}, {}
    stats = {"lines": 0, "refit": 0, "words": 0, "words_refit": 0}
    for (li, pi), ws in words_by.items():
        if pi not in inks:
            continue
        ws.sort(key=lambda w: w[0])
        sta = loci_sta[li] if li < len(loci_sta) else ""
        glyphs = [sum(WIDE.get(ch, 1.0) for c in CODE.findall(w) for ch in EVA.get(c, "o")) for w in re.split(r"[.,\-]", sta)]
        items = [(wi, kind, nums, glyphs[wi] if wi < len(glyphs) else 4) for wi, kind, nums, _r in ws]
        H = panels[pi].shape[0]
        ring = ring_of(items)
        plain = items
        if len(items) == 1 and items[0][1] == "r":                # an upright label: turned if its ink clearly runs aslant
            wi, kind, nums, g = items[0]
            squarish = g >= 3 and max(nums[2], nums[3]) < 1.6 * min(nums[2], nums[3])   # too tall for a word written across
            ang = label_angle(shape_poly(kind, nums), inks[pi], H, 2.2 if squarish else 4.0)
            if ang is not None and abs(ang) >= 8:
                L = max(nums[2], nums[3]) if kind == "r" else nums[2]
                h = min(nums[2], nums[3]) if kind == "r" else nums[3]
                c = shape_poly(kind, nums).mean(0)
                items = [(wi, "o", [c[0], c[1], L, h, ang], g)]
        stats["lines"] += 1
        stats["words"] += len(items)
        # a line broken by a drawing: each stretch on its own (the two may not sit at quite the same height)
        segs = [items]
        if len(items) >= 2:                                      # (a ring too: on a foldout's panel it can show
            t = float(np.median([thickness(kind, v) for _, kind, v, _ in items]))   # its start and its end, apart)
            cs = [shape_poly(kind, v).mean(0) for _, kind, v, _ in items]
            segs, cur = [], [items[0]]
            for prev_c, c, it in zip(cs, cs[1:], items[1:]):
                if np.linalg.norm(c - prev_c) > (7 if ring else 5) * t:
                    segs.append(cur); cur = []
                cur.append(it)
            segs.append(cur)
        for si, seg in enumerate(segs):
            wis = {it[0] for it in seg}
            est_of = {w[0]: (w[3][-1],) for w in ws}
            try:
                ln = Line(seg, inks[pi], H, ring if len(seg) >= 2 else None, est=[est_of[it[0]] for it in seg])
            except Exception as e:                               # a strip off the panel's edge, say
                print(f"  {page} locus {li}: {e}", file=sys.stderr)
                ln = None
            alt = None
            if seg is items and items is not plain:              # the label as it was, should the turned one not fit
                try:
                    alt = Line(plain, inks[pi], H, None, est=[est_of[it[0]] for it in plain])
                except Exception:
                    alt = None
            lines[(li, pi, si)] = (ln, [w for w in ws if w[0] in wis], alt)
    # rows: a paragraph's lines together (straight lines, one after another, overlapping across the page)
    seq = sorted(lines)
    block, blocks = [], []
    for key in seq:
        ln, ws, _alt = lines[key]
        if ln is None or not ln.ok:
            continue
        if ln.ring or len(ln.words) < 2:
            blocks.append([key]); continue
        if block:
            pk = block[-1]
            pln = lines[pk][0]
            same = pk[1] == key[1] and 0 < key[0] - pk[0] <= 2 and overlap(pln, ln) > 0.2
            if not same:
                blocks.append(block); block = []
        block.append(key)
    if block:
        blocks.append(block)
    rows = {}
    for bl in blocks:
        lns = [lines[k][0] for k in bl]
        if len(bl) == 1 and (lns[0].ring or len(lns[0].words) < 2):
            rows[bl[0]] = nearest_row(lns[0])
        else:
            for key, r in zip(bl, choose_rows(lns)):
                rows[key] = r
    for key, (ln, ws, alt) in lines.items():
        got = {}
        if ln is not None and ln.ok and rows.get(key) is not None:
            got = ln.fit(rows[key])
        if not got and alt is not None and alt.ok and nearest_row(alt) is not None:
            got = alt.fit(nearest_row(alt))
        if not got and len(ws) == 1 and ln is not None and not ln.ring:   # a lone label: its own cluster of ink
            wi, kind, nums, r = ws[0]
            fl = fit_label(kind, nums, ln.words[0][3], inks[key[1]], panels[key[1]].shape[0])
            if fl:
                got = {wi: fl}
        if got:
            stats["refit"] += 1
            stats["words_refit"] += len(got)
        li, pi = key[0], key[1]
        for wi, kind, nums, r in ws:
            if wi in got:
                k2, n2, ang = got[wi][:3]
                rnd = [round(float(x)) for x in n2[:4]] + [round(float(x), 1) for x in n2[4:]]
                new[(li, wi)] = [li, wi, pi, k2, *rnd, round(((ang + 180) % 360) - 180, 1), 0]
            else:                                              # not found on the ink: rf.py's shape, as approximate
                new[(li, wi)] = r[:-1] + [1]
    return [new[k] for k in sorted(new)], stats


def ring_of(items):
    """a ring's centre and radius when most words of the line are bands of about the same circle (the circle is fitted
    to the ink afterwards), else None"""
    arcs = [n for _, kind, n, _ in items if kind == "a"]
    if len(items) < 2 or len(arcs) < 0.6 * len(items):
        return None
    cx, cy = float(np.median([n[0] for n in arcs])), float(np.median([n[1] for n in arcs]))
    R = float(np.median([(n[2] + n[3]) / 2 for n in arcs]))
    if any(math.hypot(n[0] - cx, n[1] - cy) > 0.08 * R for n in arcs):
        return None
    return (cx, cy, R)


def overlap(a: "Line", b: "Line") -> float:
    """how much two straight lines run over the same stretch across the page (0..1 of the shorter)"""
    d = np.array([a.mid_n[1], -a.mid_n[0]])
    ua = sorted([float(a.pts[0] @ d), float(a.pts[-1] @ d)]); ub = sorted([float(b.pts[0] @ d), float(b.pts[-1] @ d)])
    inter = max(0.0, min(ua[1], ub[1]) - max(ua[0], ub[0]))
    return inter / max(1e-6, min(ua[1] - ua[0], ub[1] - ub[0]))


def panel_images(imgs: list) -> dict[int, np.ndarray]:
    out = {}
    for pi, (img, _asp) in enumerate(imgs):
        im = cv2.imread(str(ROOT / "data" / "panels" / f"{img}_l.jpg"))
        if im is not None:
            out[pi] = im
    return out


def _one(args):
    page, sta = args
    f = SHAPES / f"{page}.json"
    data = json.loads(f.read_text())
    rows, st = refine(page, data, sta, panel_images(data["imgs"]))
    data["words"] = rows
    f.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    return page, st


def refine_all(pages=None, workers=8) -> dict:
    """refine data/text/rf/shapes/<page>.json in place, every page (or those given); returns the counts"""
    from multiprocessing import Pool
    text = json.loads((ROOT / "data" / "text" / "rf" / "text.json").read_text())
    sta = {page: [r[3] for r in rows] for page, rows in text["pages"]}
    pages = pages or sorted(p.stem for p in SHAPES.glob("f*.json"))
    with Pool(workers) as pool:
        res = pool.map(_one, [(p, sta.get(p, [])) for p in pages])
    tot = {}
    for _page, st in res:
        for k, v in st.items():
            tot[k] = tot.get(k, 0) + v
    return tot


def main():
    tot = refine_all(sys.argv[1:] or None)
    print(f"lines {tot['refit']} of {tot['lines']} refitted; words {tot['words_refit']} of {tot['words']} "
          f"({100 * tot['words_refit'] / max(1, tot['words']):.1f}%) on their ink")


if __name__ == "__main__":
    main()
