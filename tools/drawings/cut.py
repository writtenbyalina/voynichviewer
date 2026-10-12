#!/usr/bin/env python3
"""Drawings cut out of the page photographs: one outline (a mask, as an SVG path) for every drawing in the book.

  python3 tools/drawings/cut.py                 # every panel in tools/drawings/plan.json -> data/drawings/
  python3 tools/drawings/cut.py f9v f88r        # only these panels
  python3 tools/drawings/cut.py --look f9v      # the panel's pieces, numbered, on a grid (for writing the plan)
  python3 tools/drawings/cut.py --check f9v     # the cut-outs drawn over the panel, to look at

How a drawing is cut out of its panel photograph (data/panels/<img>_l.jpg, 1400 px tall):

  1. the parchment: the page's own colour, found round every pixel (a wide median), and the page itself (the light
     sheet, without the dark edges of the binding and of the leaves under it);
  2. the ink: what is darker than the parchment round it, on the darkest colour channel (red and brown ink alike);
     the paint: what is a different colour from the parchment round it, laid in areas, not in thin strokes;
  3. the writing out: every word's shape (data/text/rf/shapes, the boxes fitted to each word's glyphs) is taken off
     the ink, except where it is painted (paint is never writing), so a label beside a plant is not part of it;
  4. the pieces: ink and paint joined across hairline gaps, so a drawing's outline is one piece, then split into
     separate pieces where nothing joins them;
  5. the plan (tools/drawings/plan.json, written by looking at each page) says which drawings a panel holds and
     where: a drawing takes the pieces that lie mostly inside its box (a piece that is only partly inside is cut at
     the box's edge, for drawings that touch), and its own extra rules;
  6. its outline is filled: what its ink closes round is part of it (a leaf drawn in outline, the women's bodies),
     except a big empty space it only closes round by chance (two roots that cross); a diagram is filled whole;
  7. its outline is traced round the pixels and simplified to well under a pixel, in the units the text uses:
     thousandths of the panel's height. One path per drawing, holes and all (fill-rule evenodd).

The plan and what is said about each drawing (data/drawings/about.json) are written by hand; this file only cuts.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PANELS = ROOT / "data" / "panels"
SHAPES = ROOT / "data" / "text" / "rf" / "shapes"
OUT = ROOT / "data" / "drawings"
PLAN = HERE / "plan"         # plan/*.json: {"panels": {img: [drawing, ...]}}, written by looking at the pages
UNIT = 1000.0          # a panel is 1000 units tall (as the text's shapes are)


# ---------------------------------------------------------------- the panel
def load(img: str) -> np.ndarray:
    im = cv2.imread(str(PANELS / f"{img}_l.jpg"), cv2.IMREAD_COLOR)
    if im is None:
        raise SystemExit(f"no picture for {img}")
    return im


def parchment(im: np.ndarray) -> np.ndarray:
    """the parchment's colour round every pixel: a median over about a sixtieth of the page, taken on a smaller copy
    (a drawing's strokes and paint are too thin or too small to move it, except in big painted areas, which the
    second pass fills in from the parchment round them)"""
    h, w = im.shape[:2]
    s = 4
    small = cv2.resize(im, (w // s, h // s), interpolation=cv2.INTER_AREA)
    bg = cv2.medianBlur(small, 21)
    # where the median is still pulled by a big painted area, take the lighter parchment round it
    lab = cv2.cvtColor(bg, cv2.COLOR_BGR2LAB).astype(np.float32)
    chroma = np.hypot(lab[..., 1] - 128, lab[..., 2] - 128)
    ref = np.median(chroma)
    odd = (chroma > ref + 12) | (lab[..., 0] < np.percentile(lab[..., 0], 50) - 25)
    if odd.any():
        good = (~odd).astype(np.uint8)
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
        num = cv2.dilate(bg * good[..., None], k).astype(np.float32)   # crude: nearest good parchment, spread
        bg = np.where(odd[..., None], cv2.blur(bg * good[..., None], (31, 31)).astype(np.float32)
                      / np.maximum(cv2.blur(good.astype(np.float32), (31, 31)), 1e-3)[..., None], bg).astype(np.uint8)
        del num
    return cv2.resize(bg, (w, h), interpolation=cv2.INTER_LINEAR)


def grow_into(seed: np.ndarray, area: np.ndarray) -> np.ndarray:
    """the pieces of area that hold some seed (hysteresis)"""
    area = area | seed
    n, lab = cv2.connectedComponents(area.astype(np.uint8), connectivity=8)
    has = np.zeros(n, bool)
    has[np.unique(lab[seed])] = True
    has[0] = False
    return has[lab]


def fill_holes(m: np.ndarray) -> np.ndarray:
    return ndimage.binary_fill_holes(m.astype(bool)).astype(np.uint8)


def layers(im: np.ndarray):
    """(ink, paint, strength): ink is darker than the parchment round it; paint is another colour, laid in areas"""
    bg = parchment(im)
    g = im.min(axis=2).astype(np.float32)
    gb = bg.min(axis=2).astype(np.float32)
    d = gb - g                                                  # how much darker than the parchment
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB).astype(np.float32)
    lbg = cv2.cvtColor(bg, cv2.COLOR_BGR2LAB).astype(np.float32)
    dc = np.hypot(lab[..., 1] - lbg[..., 1], lab[..., 2] - lbg[..., 2])   # how much another colour
    dl = lbg[..., 0] - lab[..., 0]
    full = max(30.0, float(np.percentile(d, 99.5)))
    # ink: a stroke clearly darker than the parchment, with the fainter run of the same stroke (a pale stem, the
    # zodiac's pale outlines) kept where it carries on from a clear one
    ink = grow_into(d > max(16.0, 0.26 * full), d > max(8.0, 0.11 * full))
    # paint: another colour (or much darker), in an area at least a few pixels across; its paler wash kept where it
    # carries on from clear paint (a pale blue petal), not a pale stain on its own (paint offset from the facing page)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    clear = (dc > 10) | ((dc > 6) & (dl > 16))
    clear = cv2.morphologyEx(clear.astype(np.uint8), cv2.MORPH_OPEN, k).astype(bool)
    faint = cv2.morphologyEx(((dc > 5.5) | ((dc > 4) & (dl > 9))).astype(np.uint8), cv2.MORPH_OPEN, k).astype(bool)
    paint = grow_into(clear, faint)
    return ink, paint, clear, d, dc, full


# ---------------------------------------------------------------- the writing
def words_mask(img: str, shape: tuple[int, int], grow: float = 0.0) -> np.ndarray:
    """every word on this panel, as filled shapes (pixels); grow widens them by that many units"""
    h, w = shape
    m = np.zeros((h, w), np.uint8)
    page = img.split("-")[0] if img.startswith("f") else img
    for f in {SHAPES / f"{img}.json", SHAPES / f"{page}.json"}:
        if not f.exists():
            continue
        b = json.loads(f.read_text())
        for r in b["words"]:
            li, wi, p, kind = r[:4]
            if b["imgs"][p][0] != img:
                continue
            n = 4 if kind == "r" else 5 if kind == "o" else 6
            poly = shape_poly(kind, r[4:4 + n], grow)
            pts = np.round(poly * h / UNIT).astype(np.int32)
            cv2.fillPoly(m, [pts], 1)
    return m.astype(bool)


def shape_poly(kind, v, grow=0.0):
    if kind == "r":
        x, y, w, h = v
        x, y, w, h = x - grow, y - grow, w + 2 * grow, h + 2 * grow
        return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], float)
    if kind == "o":
        cx, cy, L, t, a = v
        L, t = L + 2 * grow, t + 2 * grow
        a = math.radians(a)
        d, n = np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])
        c = np.array([cx, cy])
        return np.array([c - d * L / 2 - n * t / 2, c + d * L / 2 - n * t / 2, c + d * L / 2 + n * t / 2, c - d * L / 2 + n * t / 2])
    cx, cy, r0, r1, a0, a1 = v
    r0, r1 = r0 - grow, r1 + grow
    angs = np.radians(np.linspace(a0, a1, 24))
    outer = np.c_[cx + r1 * np.cos(angs), cy + r1 * np.sin(angs)]
    inner = np.c_[cx + r0 * np.cos(angs[::-1]), cy + r0 * np.sin(angs[::-1])]
    return np.r_[outer, inner]


# ---------------------------------------------------------------- the pieces
def pieces(img: str, im: np.ndarray | None = None):
    """the panel's drawing, in pieces: (labels, stats, ink, paint, writing, page)"""
    im = load(img) if im is None else im
    h, w = im.shape[:2]
    ink, paint, clear, d, dc, full = layers(im)
    writing = words_mask(img, (h, w))
    # a word's box takes its glyphs off the ink; paint under a word stays (paint is never writing)
    marks = (ink & ~writing) | paint
    # specks of the parchment's grain out
    n, lab, st, _ = cv2.connectedComponentsWithStats(marks.astype(np.uint8), connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = st[1:, cv2.CC_STAT_AREA] >= 12
    marks = keep[lab]
    raw = marks.copy()          # before the edges are taken off: a drawing on the page's edge can ask for it back ("edge")
    # the page's edges out: the binding, the edges of the leaves under it, the trimmed edge's stains, which lie along
    # the panel's border: what runs into the border within a band round it; a drawing that reaches the band keeps
    # what is inside it
    e = int(0.035 * w)
    band = np.zeros((h, w), bool)
    band[:e, :] = band[-e:, :] = band[:, :e] = band[:, -e:] = True
    rim = np.zeros((h, w), bool)
    rim[:3, :] = rim[-3:, :] = rim[:, :3] = rim[:, -3:] = True
    edge = grow_into(marks & rim, marks & band)
    # and what is left of the edges just inside the band: a piece mostly in a band twice as wide
    marks &= ~edge
    band2 = np.zeros((h, w), bool)
    band2[:2 * e, :] = band2[-2 * e:, :] = band2[:, :2 * e] = band2[:, -2 * e:] = True
    n, lab, st, _ = cv2.connectedComponentsWithStats(marks.astype(np.uint8), connectivity=8)
    inband = np.bincount(lab[band2].ravel(), minlength=n)
    far = np.zeros(n, bool)
    far[1:] = (inband[1:] > 0.8 * st[1:, cv2.CC_STAT_AREA]) & (st[1:, cv2.CC_STAT_AREA] < 0.002 * h * w)
    # long straight lines near the sides: the edge of this leaf or of one under it (a drawing's stem is never that
    # long and that straight that close to the edge); and tall thin pieces down the sides (the gutter's shading)
    lines = np.zeros((h, w), bool)
    L = int(0.18 * h)
    v = cv2.morphologyEx(cv2.dilate(marks.astype(np.uint8), np.ones((1, 3), np.uint8)), cv2.MORPH_OPEN, np.ones((L, 1), np.uint8)).astype(bool)
    side = np.zeros((h, w), bool)
    side[:, :int(0.12 * w)] = side[:, -int(0.12 * w):] = True
    lines |= v & side
    L = int(0.18 * w)
    hz = cv2.morphologyEx(cv2.dilate(marks.astype(np.uint8), np.ones((3, 1), np.uint8)), cv2.MORPH_OPEN, np.ones((1, L), np.uint8)).astype(bool)
    top = np.zeros((h, w), bool)
    top[:int(0.08 * h), :] = top[-int(0.08 * h):, :] = True
    lines |= hz & top
    lines = cv2.dilate(lines.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    # but never through paint laid thick (a leaf down the side of the page: f49v, f52v)
    thick = cv2.morphologyEx(clear.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))).astype(bool)
    thick = cv2.dilate(thick.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))).astype(bool)
    edge |= lines & marks & ~thick
    tall = np.zeros(n, bool)
    cx = st[:, cv2.CC_STAT_LEFT] + st[:, cv2.CC_STAT_WIDTH] / 2
    cy = st[:, cv2.CC_STAT_TOP] + st[:, cv2.CC_STAT_HEIGHT] / 2
    tall[1:] = (((st[1:, cv2.CC_STAT_HEIGHT] > 0.45 * h) & (st[1:, cv2.CC_STAT_WIDTH] < 0.13 * w) & ((cx[1:] < 0.15 * w) | (cx[1:] > 0.85 * w)))
                | ((st[1:, cv2.CC_STAT_WIDTH] > 0.45 * w) & (st[1:, cv2.CC_STAT_HEIGHT] < 0.08 * h) & ((cy[1:] < 0.1 * h) | (cy[1:] > 0.9 * h))))
    far |= tall
    page = ~(edge | far[lab])
    marks &= page
    # hairline gaps closed: a drawing's outline is one piece
    joined = cv2.morphologyEx(marks.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    n, lab, st, cen = cv2.connectedComponentsWithStats(joined, connectivity=8)
    return dict(labels=lab, stats=st, n=n, ink=ink, paint=paint, clear=clear, writing=writing, page=page, dark=d, full=full, raw=raw,
                marks=marks, joined=joined.astype(bool), h=h, w=w)


# ---------------------------------------------------------------- where a drawing is (the plan's regions)
def region(P, spec) -> np.ndarray:
    """a region of the panel, in pixels, from the plan's words (all in units): {"box": [x0, y0, x1, y1]},
    {"poly": [[x, y], ...]}, {"circle": [cx, cy, r]}, {"ring": [cx, cy, r0, r1]}, or a list of them (their union)"""
    h, w = P["h"], P["w"]
    if isinstance(spec, list):
        m = np.zeros((h, w), bool)
        for s_ in spec:
            m |= region(P, s_)
        return m
    k = h / UNIT
    m = np.zeros((h, w), np.uint8)
    if "box" in spec:
        x0, y0, x1, y1 = [int(round(v * k)) for v in spec["box"]]
        m[max(0, y0):min(h, y1), max(0, x0):min(w, x1)] = 1
    elif "poly" in spec:
        cv2.fillPoly(m, [np.round(np.array(spec["poly"], float) * k).astype(np.int32)], 1)
    elif "circle" in spec:
        cx, cy, r = spec["circle"]
        cv2.circle(m, (int(round(cx * k)), int(round(cy * k))), int(round(r * k)), 1, -1, cv2.LINE_8)
    elif "ring" in spec:
        cx, cy, r0, r1 = spec["ring"]
        cv2.circle(m, (int(round(cx * k)), int(round(cy * k))), int(round(r1 * k)), 1, -1, cv2.LINE_8)
        cv2.circle(m, (int(round(cx * k)), int(round(cy * k))), int(round(r0 * k)), 0, -1, cv2.LINE_8)
    else:
        raise ValueError(f"a region needs box, poly, circle or ring: {spec}")
    return m.astype(bool)


def fit_circle(P, circle):
    """a circle the plan gives roughly, moved onto the ruled circle nearest it: the centre and radius (within 4%)
    where the most ink lies along the circle"""
    cx, cy, r = circle
    k = P["h"] / UNIT
    ink = cv2.GaussianBlur((P["ink"] & ~P["writing"]).astype(np.float32), (5, 5), 0)
    best = (-1.0, cx, cy, r)
    th = np.linspace(0, 2 * np.pi, 720, endpoint=False)
    for dx in np.linspace(-0.04 * r, 0.04 * r, 9):
        for dy in np.linspace(-0.04 * r, 0.04 * r, 9):
            for dr in np.linspace(-0.04 * r, 0.04 * r, 17):
                xs = ((cx + dx) + (r + dr) * np.cos(th)) * k
                ys = ((cy + dy) + (r + dr) * np.sin(th)) * k
                ok = (xs >= 0) & (ys >= 0) & (xs < P["w"] - 1) & (ys < P["h"] - 1)
                if ok.sum() < 200:
                    continue
                v = float(ink[ys[ok].astype(int), xs[ok].astype(int)].mean())
                if v > best[0]:
                    best = (v, cx + dx, cy + dy, r + dr)
    return [round(best[1], 1), round(best[2], 1), round(best[3], 1)]


# ---------------------------------------------------------------- the drawings of a panel
def fill(m: np.ndarray, P, how: str) -> np.ndarray:
    """what the drawing's ink closes round, filled: every hole ("all"), none ("none"), or ("auto") a hole unless it is
    big and mostly bare parchment (two roots that cross close round parchment by chance)"""
    if how == "none":
        return m
    filled = fill_holes(m).astype(bool)
    if how == "all":
        return filled
    holes = filled & ~m
    n, lab, st, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8), connectivity=4)
    h, w = m.shape
    big = 0.0025 * h * h          # about a twentieth of the page's height across
    painted = np.bincount(lab.ravel(), weights=P["clear"].ravel().astype(float), minlength=n)
    keep = np.zeros(n, bool)
    keep[1:] = (st[1:, cv2.CC_STAT_AREA] < big) | (painted[1:] / np.maximum(st[1:, cv2.CC_STAT_AREA], 1) > 0.4)
    return m | keep[lab]


def tidy(m: np.ndarray, smallest: int = 20) -> np.ndarray:
    """the outline smoothed by a pixel, specks and pinholes out"""
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = st[1:, cv2.CC_STAT_AREA] >= smallest
    m = keep[lab].astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats((1 - m).astype(np.uint8), connectivity=4)
    pin = np.zeros(n, bool)
    pin[1:] = st[1:, cv2.CC_STAT_AREA] < 12
    m[pin[lab]] = 1
    return m.astype(bool)


def faint_marks(P, R, spec, paint=False):
    """ink too faint for the pieces (a quick sketch, a pale stem): within region R, every mark a little darker than
    the parchment ("level" of the page's darkest ink), writing aside, joined across wider gaps ("gap" px); with paint,
    the paint there too (which can include paint offset from the facing page)"""
    t = max(5.0, spec.get("level", 0.07) * P["full"])
    m = (P["dark"] > t) & R & ~P["writing"] & P["page"]
    if paint:
        m |= P["paint"] & R
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    keep = np.zeros(n2, bool)
    keep[1:] = st2[1:, cv2.CC_STAT_AREA] >= 10
    m = keep[lab2]
    g = int(spec.get("gap", 7)) | 1
    return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (g, g))).astype(bool) & R


def split_bodies(m: np.ndarray, k: float) -> list[np.ndarray]:
    """a hole holding two figures that touch (two women side by side in a pool), cut between them: where the hole
    has two thick parts (bodies) joined by a thin one, it is cut along the thin part (a watershed of the distance
    to its edge)"""
    from skimage.feature import peak_local_max
    from skimage.segmentation import watershed
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = max(0, ys.min() - 2), ys.max() + 3, max(0, xs.min() - 2), xs.max() + 3
    sub = m[y0:y1, x0:x1]
    dist = ndimage.distance_transform_edt(sub)
    top = dist.max()
    peaks = peak_local_max(dist, min_distance=max(3, int(28 * k)), threshold_abs=0.62 * top, exclude_border=False)
    if len(peaks) < 2:
        return [m]
    markers = np.zeros(sub.shape, np.int32)
    for i, (y, x) in enumerate(peaks):
        markers[y, x] = i + 1
    lab = watershed(-dist, markers, mask=sub)
    out = []
    for i in range(1, len(peaks) + 1):
        part = np.zeros_like(m)
        part[y0:y1, x0:x1] = lab == i
        out.append(part)
    # a cut is kept only where the parts are joined by a neck clearly thinner than both bodies
    neck = 0.0
    for i in range(len(out)):
        edge = cv2.dilate(out[i][y0:y1, x0:x1].astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & (lab > 0) & (lab != i + 1)
        if edge.any():
            neck = max(neck, float(dist[edge].max()))
    return out if neck < 0.55 * top else [m]


def specks_out(m: np.ndarray, keep: float, near: int) -> np.ndarray:
    """a drawing without the stray marks its region also held: a part far from the drawing's body (more than near
    pixels from it) is kept only if it is at least keep of the size of its biggest part (a flower drawn apart from
    its stem stays; a speck of the facing page's paint goes)"""
    n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    if n <= 2:
        return m
    a = st[:, cv2.CC_STAT_AREA].copy()
    a[0] = 0
    big = a >= keep * a.max()
    body = big[lab]
    if near:
        reach = cv2.dilate(body.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * near + 1, 2 * near + 1))).astype(bool)
        close = np.zeros(n, bool)
        close[np.unique(lab[reach & m])] = True
        big |= close
    big[0] = False
    return big[lab]


def order_of(masks, ring=None):
    """auto-numbered drawings in reading order: round a ring clockwise from the top, else in rows, left to right"""
    cs = []
    for m in masks:
        ys, xs = np.nonzero(m)
        cs.append((xs.mean(), ys.mean(), ys.min()))
    if ring:
        cx, cy = ring
        ang = [((math.degrees(math.atan2(y - cy, x - cx)) + 90) % 360) for x, y, _ in cs]
        return sorted(range(len(masks)), key=lambda i: ang[i])
    rows = sorted(range(len(masks)), key=lambda i: cs[i][1])
    out, row, top = [], [], None
    for i in rows:
        if top is not None and cs[i][1] - top > 70:
            out += sorted(row, key=lambda j: cs[j][0])
            row = []
            top = None
        row.append(i)
        top = cs[i][1] if top is None else top
    return out + sorted(row, key=lambda j: cs[j][0])


def cut(img: str, drawings: list[dict], P=None):
    """every drawing of a panel: [(id, entry, mask)], auto-numbered drawings expanded"""
    P = pieces(img) if P is None else P
    h, w, k = P["h"], P["w"], P["h"] / UNIT
    lab, st, n = P["labels"], P["stats"], P["n"]
    area = st[:, cv2.CC_STAT_AREA]
    reach = int(10 * k)            # how far past its region a drawing's own stroke is followed
    out = []
    # the regions; a fitted circle replaces the plan's rough one
    regs = {}
    for dr in drawings:
        spec = dr["in"]
        if dr.get("fit") and isinstance(spec, dict) and "circle" in spec:
            spec = {"circle": fit_circle(P, spec["circle"])}
            dr["_circle"] = spec["circle"]
        regs[dr["id"]] = region(P, spec)
        if dr.get("not"):
            regs[dr["id"]] &= ~region(P, dr["not"])
    # "pieces": the pieces each drawing's region holds, shared out where regions meet or pieces cross them
    claim = [dr for dr in drawings if dr.get("take", "pieces") == "pieces"]
    owner = np.full((h, w), -1, np.int32)
    if claim:
        sizes = np.array([regs[dr["id"]].sum() for dr in claim], float)
        inside = np.stack([np.bincount(lab[regs[dr["id"]]].ravel(), minlength=n) for dr in claim])   # drawings x pieces
        share = inside / np.maximum(area, 1)[None, :]
        whole = np.full(n, -1)
        for p in range(1, n):
            if area[p] < claim[0].get("min", 30) and share[:, p].max() < 1:
                continue
            ins = np.nonzero(share[:, p] >= 0.05)[0]
            if len(ins) == 1 and share[ins[0], p] >= claim[ins[0]].get("whole", 0.6):
                whole[p] = ins[0]
        owner = whole[lab]
        owner[lab == 0] = -1
        # pieces not taken whole: each pixel to the drawing whose region holds it (the smallest region where they
        # overlap), then along its own piece a little way past the region
        split = (owner < 0) & (lab > 0)
        held = np.zeros((h, w), np.int32) - 1
        for i in np.argsort(-sizes):
            held[regs[claim[i]["id"]]] = i
        part = split & (held >= 0)
        crossing = np.zeros(n, bool)
        crossing[np.unique(lab[part])] = True
        crossing &= share.max(axis=0) >= 0.3          # followed out of the region only if it is mostly in it
        owner[part] = held[part]
        rest = split & crossing[lab] & (held < 0)
        if rest.any():
            seeds = owner >= 0
            dist, (iy, ix) = ndimage.distance_transform_edt(~seeds, return_indices=True)
            near = rest & (dist <= reach) & (lab[iy, ix] == lab)
            owner[near] = owner[iy[near], ix[near]]
        for i, dr in enumerate(claim):
            m = (owner == i) & P["joined"]
            out.append((dr["id"], dr, m))
    # "each": every piece in the region, on its own
    for dr in drawings:
        take = dr.get("take", "pieces")
        R = regs[dr["id"]]
        if take == "each":
            inside = np.bincount(lab[R].ravel(), minlength=n)
            share = inside / np.maximum(area, 1)
            ps = [p for p in range(1, n) if share[p] >= dr.get("whole", 0.6) and area[p] >= dr.get("small", 40)]
            # pieces closer than "join" units are one drawing (a woman and the star she holds out)
            grp = list(range(len(ps)))
            j = int(dr.get("join", 0) * k)
            if j and ps:
                sub = np.zeros((h, w), np.int32)
                for q, p in enumerate(ps):
                    sub[lab == p] = q + 1
                grown = ndimage.grey_dilation(sub, footprint=cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * j + 1, 2 * j + 1)).astype(bool))
                par = list(range(len(ps)))
                def root(a):
                    while par[a] != a:
                        par[a] = par[par[a]]
                        a = par[a]
                    return a
                both = (grown > 0) & (sub > 0) & (grown != sub)
                for a, b in set(zip((sub[both] - 1).tolist(), (grown[both] - 1).tolist())):
                    par[root(a)] = root(b)
                grp = [root(q) for q in range(len(ps))]
            ms = []
            for g in sorted(set(grp)):
                m = np.isin(lab, [p for q, p in enumerate(ps) if grp[q] == g])
                if m.sum() >= dr.get("min", 300):
                    ms.append(m)
            ring = dr.get("_circle") or (dr["in"].get("ring") if isinstance(dr["in"], dict) else None)
            for j, i in enumerate(order_of(ms, (ring[0] * k, ring[1] * k) if ring else None)):
                out.append((f"{dr['id']}-{j + 1}", dr, ms[i]))
        elif take == "holes":
            # the bare figures a painted area closes round (the women in the pools): each hole with its outline
            S = P["joined"] & R
            F = fill_holes(S).astype(bool)
            holes = F & ~S
            n2, lab2, st2, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8), connectivity=4)
            ms = []
            for p in range(1, n2):
                if st2[p, cv2.CC_STAT_AREA] < dr.get("min", 1500):
                    continue
                for m in split_bodies(lab2 == p, k) if dr.get("split", True) else [lab2 == p]:
                    if m.sum() < dr.get("min", 1500):
                        continue
                    m = cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))).astype(bool) & F
                    ms.append(m)
            for j, i in enumerate(order_of(ms)):
                out.append((f"{dr['id']}-{j + 1}", dr, ms[i]))
        elif take == "region":
            out.append((dr["id"], dr, R.copy()))
        elif take == "faint":
            m = faint_marks(P, R, dr, paint=True)
            m = specks_out(m, dr.get("keep", 0.06), int(dr.get("near", 4) * k))
            out.append((dr["id"], dr, m))
    res = []
    under = P["ink"] & P["writing"] & P["page"]
    for did, dr, m in out:
        if dr.get("edge") and m.any():
            # a drawing running onto the page's edge (a flower touching the top): what was taken off as the edge,
            # inside its region and carrying on from it, given back; the region should be drawn tight round it
            R = regs[dr["id"]]
            back = cv2.morphologyEx((P["raw"] & R).astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))).astype(bool)
            m = m | grow_into(m & back, back)
        if dr.get("take", "pieces") == "pieces":
            m = specks_out(m, dr.get("keep", 0.04), int(dr.get("near", 6) * k))
        for extra in dr.get("plus", []):
            # a faint part of a drawing otherwise taken from its pieces (a pale stem, root or flower head): the faint
            # ink in that region that joins the drawing, ink only (no paint, so no offset from the facing page), and
            # not the parchment's grain
            f = faint_marks(P, region(P, extra["in"]), {"level": 0.12, "gap": 5, **extra})
            m = m | grow_into(f & cv2.dilate(m.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool), f)
        if dr.get("take", "pieces") in ("pieces", "each"):
            # the drawing's own strokes where a word's box took them off (a petal over a line of writing): the ink
            # under the words that carries on from the drawing, a few pixels at a time
            for _ in range(4):
                m = m | (under & cv2.dilate(m.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool))
        if dr.get("take", "pieces") != "region":
            m = fill(m, P, dr.get("fill", "auto"))
            if dr.get("not"):
                m &= ~region(P, dr["not"])
        m = tidy(m, 20 if dr.get("take") != "each" else 60)
        if m.any():
            res.append((did, dr, m))
    return res, P


def num(v: float) -> str:
    t = f"{v:.1f}".rstrip("0").rstrip(".")
    return "0" if t in ("-0", "") else t


def trace(m: np.ndarray, h: int, eps: float = 0.55) -> str:
    """the mask's outline as an SVG path in units (one decimal): outer rings and holes (fill-rule evenodd),
    simplified to eps pixels"""
    cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    k = UNIT / h
    out = []
    for c in cs:
        a = cv2.approxPolyDP(c, eps, True).reshape(-1, 2).astype(float)
        if len(a) < 3:
            continue
        pts = np.round((a + 0.5) * k, 1)          # pixel centres, in units, to a tenth
        d = np.round(np.diff(pts, axis=0), 1)
        out.append(f"M{num(pts[0][0])} {num(pts[0][1])}" + "".join(f"l{num(dx)} {num(dy)}" for dx, dy in d) + "z")
    return "".join(out).replace(" -", "-")


def bbox_units(m: np.ndarray, h: int):
    ys, xs = np.nonzero(m)
    k = UNIT / h
    return [round(float(xs.min()) * k, 1), round(float(ys.min()) * k, 1),
            round(float(xs.max() + 1 - xs.min()) * k, 1), round(float(ys.max() + 1 - ys.min()) * k, 1)]


# ---------------------------------------------------------------- looking
PALETTE = [(230, 25, 75), (60, 180, 75), (0, 130, 200), (245, 130, 48), (145, 30, 180), (70, 240, 240), (240, 50, 230),
           (210, 245, 60), (250, 190, 212), (0, 128, 128), (170, 110, 40), (128, 0, 0), (128, 128, 0), (0, 0, 128)]


def grid(vis: np.ndarray, h: int, step: int = 50):
    H, W = vis.shape[:2]
    k = H / UNIT
    for u in range(0, int(W / k) + 1, step):
        x = int(u * k)
        cv2.line(vis, (x, 0), (x, H), (200, 200, 200) if u % 100 else (120, 120, 255), 1)
        if u % 100 == 0:
            cv2.putText(vis, str(u), (x + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 200), 1, cv2.LINE_AA)
    for u in range(0, 1001, step):
        y = int(u * k)
        cv2.line(vis, (0, y), (W, y), (200, 200, 200) if u % 100 else (120, 120, 255), 1)
        if u % 100 == 0:
            cv2.putText(vis, str(u), (2, y - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 200), 1, cv2.LINE_AA)


def look(img: str, path: Path, scale: float = 0.75):
    im = load(img)
    P = pieces(img, im)
    vis = (im.astype(np.float32) * 0.45 + 140).astype(np.uint8)
    lab, st = P["labels"], P["stats"]
    order = np.argsort(-st[:, cv2.CC_STAT_AREA])
    shown = [i for i in order if i and st[i, cv2.CC_STAT_AREA] >= 150]
    for j, i in enumerate(shown):
        vis[lab == i] = PALETTE[j % len(PALETTE)][::-1]
    vis[P["writing"]] = (vis[P["writing"]] * 0.5 + np.array([60, 60, 60]) * 0.5).astype(np.uint8)
    grid(vis, P["h"])
    vis = cv2.resize(vis, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(path), vis, [cv2.IMWRITE_JPEG_QUALITY, 85])


def empty(res, drawings):
    got = {dr["id"] for _, dr, _ in res}
    for dr in drawings:
        if dr["id"] not in got:
            print(f"  {dr['id']}: planned, but nothing was cut (its region holds no ink?)", file=sys.stderr)


def check(img: str, drawings: list[dict], path: Path, scale: float = 0.75):
    im = load(img)
    res, P = cut(img, drawings)
    empty(res, drawings)
    vis = (im.astype(np.float32) * 0.35 + 150).astype(np.uint8)
    for j, (did, dr, m) in enumerate(res):
        col = np.array(PALETTE[j % len(PALETTE)][::-1], np.float32)
        vis[m] = (im[m] * 0.6 + col * 0.4).astype(np.uint8)
        cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        cv2.drawContours(vis, cs, -1, tuple(int(c) for c in col), 1)
    for j, (did, dr, m) in enumerate(res):
        col = tuple(int(c) for c in PALETTE[j % len(PALETTE)][::-1])
        ys, xs = np.nonzero(m)
        cv2.putText(vis, did.split(".", 1)[-1], (int(xs.mean()) - 20, int(ys.mean())), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(vis, did.split(".", 1)[-1], (int(xs.mean()) - 20, int(ys.mean())), cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, 1, cv2.LINE_AA)
    grid(vis, P["h"])
    vis = cv2.resize(vis, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(path), vis, [cv2.IMWRITE_JPEG_QUALITY, 85])


def sheet_of(img: str, drawings: list[dict], path: Path, cell: int = 220):
    """every cut-out of a panel on a dark ground, side by side (what the site shows)"""
    im = load(img)
    res, P = cut(img, drawings)
    empty(res, drawings)
    tiles = []
    for did, dr, m in res:
        ys, xs = np.nonzero(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        crop = im[y0:y1, x0:x1].astype(np.float32)
        a = cv2.GaussianBlur(m[y0:y1, x0:x1].astype(np.float32), (3, 3), 0)[..., None]
        bg = np.full_like(crop, 38)
        t = (crop * a + bg * (1 - a)).astype(np.uint8)
        f = cell / max(t.shape[:2])
        t = cv2.resize(t, (max(1, int(t.shape[1] * f)), max(1, int(t.shape[0] * f))), interpolation=cv2.INTER_AREA)
        tile = np.full((cell + 18, cell, 3), 38, np.uint8)
        tile[:t.shape[0], (cell - t.shape[1]) // 2:(cell - t.shape[1]) // 2 + t.shape[1]] = t
        cv2.putText(tile, did.split(".", 1)[-1], (4, cell + 13), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (230, 230, 230), 1, cv2.LINE_AA)
        tiles.append(tile)
    if not tiles:
        return
    cols = 6
    rows = [np.hstack(tiles[i:i + cols] + [np.full_like(tiles[0], 38)] * (cols - len(tiles[i:i + cols]))) for i in range(0, len(tiles), cols)]
    cv2.imwrite(str(path), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])


# ---------------------------------------------------------------- the site's data
def load_plan(strict: bool = True) -> dict:
    """every plan file's panels together (looking only: a file being written, or a panel planned twice, is warned
    about and passed over)"""
    panels = {}
    for f in sorted(PLAN.glob("*.json")):
        try:
            got = json.loads(f.read_text())["panels"]
        except (ValueError, KeyError) as e:
            if strict:
                raise SystemExit(f"{f.name}: {e}")
            print(f"(passing over {f.name}: {e})", file=sys.stderr)
            continue
        for img, drs in got.items():
            if img in panels:
                if strict:
                    raise SystemExit(f"{img} is planned twice ({f.name})")
                print(f"({img} is planned twice; {f.name} wins)", file=sys.stderr)
            panels[img] = drs
    return panels


def panel_pages() -> dict:
    """img -> (page, aspect of its _l picture)"""
    codex = json.loads((ROOT / "data" / "codex.json").read_text())
    out = {}
    for s_ in codex["sheets"]:
        for f in ("inside", "outside"):
            for row in s_[f]:
                for sg in row:
                    if sg and not sg.get("missing") and sg.get("img") and sg["img"] not in out:
                        out[sg["img"]] = sg["page"]
    return out


# ---------------------------------------------------------------- what else is worked out for each drawing
class Labels:
    """the label words written beside the drawings (the transcription's labels, placed by their word shapes)"""

    def __init__(self):
        t = json.loads((ROOT / "data" / "text" / "rf" / "text.json").read_text())
        self.loci = {page: loci for page, loci in t["pages"]}
        eva = json.loads((ROOT / "data" / "text" / "rf" / "alpha.json").read_text())["schemes"]["eva"]
        self.eva = eva["codes"]
        self.multi = eva.get("multi") or {}
        self.glyph = {k: v["ch"] for k, v in json.loads((ROOT / "data" / "text" / "glyphs.json").read_text())["glyphs"].items()}

    def write_as(self, s: str, table) -> str:
        out = []
        for word in s.replace(",", ".").replace("-", ".").split("."):
            codes = [word[i:i + 2] for i in range(0, len(word), 2)]
            w, i = "", 0
            while i < len(codes):
                two = self.multi.get(codes[i] + (codes[i + 1] if i + 1 < len(codes) else "")) if table is self.eva else None
                if two is not None and i + 1 < len(codes):
                    w += two
                    i += 2
                    continue
                w += table.get(codes[i], "?")
                i += 1
            if w:
                out.append(w)
        return " ".join(out)

    def near(self, img: str, page: str, res, h: int, reach: float = 40.0):
        """each label line on this panel, given to the drawing nearest it (within reach units): {id: [[locus, eva,
        glyphs], ...]}"""
        f = SHAPES / f"{page}.json"
        loci = self.loci.get(page)
        if not f.exists() or not loci or not res:
            return {}
        b = json.loads(f.read_text())
        k = h / UNIT
        centres = {}
        for r in b["words"]:
            li, wi, pi, kind = r[:4]
            if b["imgs"][pi][0] != img or li >= len(loci) or not loci[li][1].startswith("L"):
                continue
            n = 4 if kind == "r" else 5 if kind == "o" else 6
            poly = shape_poly(kind, r[4:4 + n])
            centres.setdefault(li, []).append(poly.mean(axis=0) * k)
        if not centres:
            return {}
        dists = [ndimage.distance_transform_edt(~m) for _, _, m in res]
        whole = [dr.get("take") == "region" or dr["kind"] in ("diagram", "pool") for _, dr, _ in res]
        out = {}
        for li, cs in centres.items():
            # the nearest drawing in it; a whole diagram or pool only if no drawing in it is near
            best, who = None, None
            for tier in (False, True):
                for j, d in enumerate(dists):
                    if whole[j] != tier:
                        continue
                    v = min(float(d[min(d.shape[0] - 1, max(0, int(y))), min(d.shape[1] - 1, max(0, int(x)))]) for x, y in cs)
                    if best is None or v < best:
                        best, who = v, j
                if best is not None and best <= reach * k:
                    break
            if best is not None and best <= reach * k:
                lid, _, _, sta = loci[li]
                out.setdefault(res[who][0], []).append([lid, self.write_as(sta, self.eva), self.write_as(sta, self.glyph)])
        for v in out.values():
            v.sort(key=lambda x: int(x[0].rsplit(".", 1)[1]) if x[0].rsplit(".", 1)[1].isdigit() else 0)
        return out


HUES = [("red", 0, 8), ("orange-brown", 8, 22), ("yellow", 22, 35), ("green", 35, 85), ("blue", 85, 130),
        ("purple", 130, 165), ("red", 165, 181)]


def colours(im: np.ndarray, m: np.ndarray, P) -> list:
    """the paints a drawing is coloured with: [[name, share of the drawing, swatch #rrggbb]], most first"""
    paint = m & P["clear"]
    total = int(m.sum())
    if not total or not paint.any():
        return []
    px = im[paint]
    hsv = cv2.cvtColor(px.reshape(-1, 1, 3), cv2.COLOR_BGR2HSV).reshape(-1, 3)
    got = {}
    for name, a, b in HUES:
        sel = (hsv[:, 0] >= a) & (hsv[:, 0] < b)
        if sel.any():
            got.setdefault(name, []).append(px[sel])
    out = []
    for name, parts in got.items():
        v = np.concatenate(parts)
        share = len(v) / total
        if share < 0.03:
            continue
        b, g, r = np.median(v, axis=0).astype(int)
        out.append([name, round(share, 2), f"#{r:02x}{g:02x}{b:02x}"])
    return sorted(out, key=lambda x: -x[1])


def signature(im: np.ndarray, m: np.ndarray) -> dict:
    """a drawing's shape and colouring in a few numbers, to find others like it: its outline on a 24 x 24 grid (kept
    upright, scaled to fit) and how its colours are shared out"""
    ys, xs = np.nonzero(m)
    sub = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype(np.float32)
    hh, ww = sub.shape
    f = 24 / max(hh, ww)
    small = cv2.resize(sub, (max(1, round(ww * f)), max(1, round(hh * f))), interpolation=cv2.INTER_AREA)
    grid_ = np.zeros((24, 24), np.float32)
    y0, x0 = (24 - small.shape[0]) // 2, (24 - small.shape[1]) // 2
    grid_[y0:y0 + small.shape[0], x0:x0 + small.shape[1]] = small
    bits = "".join("1" if v > 0.35 else "0" for v in grid_.ravel())
    hsv = cv2.cvtColor(im[m].reshape(-1, 1, 3), cv2.COLOR_BGR2HSV).reshape(-1, 3)
    sat = hsv[:, 1] > 60
    hist = np.histogram(hsv[sat, 0], bins=9, range=(0, 180))[0].astype(float) / max(1, len(hsv))
    return {"bits": hex(int(bits, 2))[2:].zfill(144), "aspect": round(ww / hh, 3), "hues": [round(float(v), 3) for v in hist]}


FAMILY = {"plant": "plant", "root": "plant", "leaf": "plant", "jar": "jar", "woman": "woman", "person": "woman",
          "diagram": "diagram", "rosette": "diagram", "emblem": "emblem", "animal": "emblem", "sun": "face", "moon": "face",
          "star": "star", "pool": "pool", "building": "other", "other": "other"}


def similar(sigs: dict, kinds: dict, groups: dict, top: int = 6) -> dict:
    """for each drawing, the drawings most like it in outline and colour, of the same family of kinds, not on the
    same page's group"""
    ids = list(sigs)
    bits = np.array([[c == "1" for c in bin(int(sigs[i]["bits"], 16))[2:].zfill(576)] for i in ids], np.float32)
    hues = np.array([sigs[i]["hues"] for i in ids], np.float32)
    asp = np.log(np.array([sigs[i]["aspect"] for i in ids], np.float32))
    fam = np.array([FAMILY.get(kinds[i], "other") for i in ids])
    inter = bits @ bits.T
    area = bits.sum(1)
    iou = inter / np.maximum(area[:, None] + area[None, :] - inter, 1)
    hd = np.abs(hues[:, None, :] - hues[None, :, :]).sum(-1)
    score = iou - 0.35 * hd - 0.25 * np.abs(asp[:, None] - asp[None, :])
    out = {}
    for a, i in enumerate(ids):
        ok = (fam == fam[a])
        ok[a] = False
        if groups.get(i):
            ok &= np.array([groups.get(j) != groups[i] for j in ids])
        cand = np.nonzero(ok)[0]
        if not len(cand):
            continue
        best = cand[np.argsort(-score[a, cand])][:top]
        out[i] = [[ids[b], round(float(score[a, b]), 3)] for b in best if score[a, b] > 0.2]
    return out


def write(imgs: list[str], plan: dict):
    """cut each panel's drawings and write data/drawings/paths/<img>.json; then the index of every drawing"""
    (OUT / "paths").mkdir(parents=True, exist_ok=True)
    pages = panel_pages()
    labels = Labels()
    for img in imgs:
        if img not in pages:
            raise SystemExit(f"{img} is not a panel of the book")
        res, P = cut(img, plan[img])
        im = load(img)
        h = P["h"]
        near = labels.near(img, pages[img], res, h)
        paths, facts = {}, {}
        for did, dr, m in res:
            paths[did] = trace(m, h)
            facts[did] = {"box": bbox_units(m, h), "area": round(float(m.sum()) / (P["h"] * P["w"]), 4),
                          "colours": colours(im, m, P), "sig": signature(im, m)}
            if near.get(did):
                facts[did]["labels"] = near[did]
        empty(res, plan[img])
        f = OUT / "paths" / f"{img}.json"
        if not paths:
            f.unlink(missing_ok=True)
            continue
        doc = {"img": img, "page": pages[img], "aspect": round(P["w"] / P["h"], 5), "paths": paths, "facts": facts}
        f.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
        print(f"{img}: {len(res)} drawings, {sum(len(v) for v in paths.values()) // 1024} KB of outline")
    index(plan, pages)


def folio_key(img: str):
    """a panel's place in the book by its folio number: f1r, f1v, f2r … f70v2-1, f70v2-2 … f85r2, the Rosettes, f86v3 …"""
    if img.startswith("fRos"):
        return (85.5, 0, 0, ["tl", "tm", "tr", "bl", "bm", "br"].index(img[5:]) if img[5:] in ("tl", "tm", "tr", "bl", "bm", "br") else 0)
    m = re.match(r"f(\d+)([rv])(\d*)(?:-(\d+))?", img)
    if not m:
        return (999, 0, 0, 0)
    return (int(m.group(1)), m.group(2) == "v", int(m.group(3) or 0), int(m.group(4) or 0))


def index(plan: dict, pages: dict):
    """data/drawings/index.json: every drawing, in the book's order of panels, with what the site lists it by"""
    out, sigs, kinds, groups, extra = [], {}, {}, {}, {}
    for f in sorted((OUT / "paths").glob("*.json")):
        doc = json.loads(f.read_text())
        img = doc["img"]
        if img not in plan:
            f.unlink()          # a panel taken out of the plan
            continue
        by = {dr["id"]: dr for dr in plan[img]}
        rank = {dr["id"]: i for i, dr in enumerate(plan[img])}
        for did, fact in doc["facts"].items():
            base = did if did in by else did.rsplit("-", 1)[0]
            dr = by[base]
            e = {"id": did, "img": img, "page": doc["page"], "kind": dr["kind"], "name": dr.get("name", ""),
                 "box": fact["box"], "area": fact["area"], "_rank": rank[base]}
            if base != did:
                e["group"] = base
                e["n"] = int(did.rsplit("-", 1)[1])
            sigs[did], kinds[did], groups[did] = fact["sig"], dr["kind"], e.get("group")
            for key in ("looks", "joins"):
                if dr.get(key):
                    e[key] = dr[key]
            out.append(e)
    out.sort(key=lambda e: (folio_key(e["img"]), e.pop("_rank"), e.get("n", 0)))
    (OUT / "index.json").write_text(json.dumps({"units": "thousandths of the panel's height", "drawings": out},
                                               ensure_ascii=False, separators=(",", ":")) + "\n")
    (OUT / "similar.json").write_text(json.dumps({"about": "for each drawing, the drawings most like it in outline and "
                                                  "colour (tools/drawings/cut.py similar): a computer's comparison, "
                                                  "not a claim that they show the same thing",
                                                  "similar": similar(sigs, kinds, groups)}, separators=(",", ":")) + "\n")
    print(f"index: {len(out)} drawings")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("imgs", nargs="*")
    ap.add_argument("--look", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--sheet", action="store_true")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    if a.look:
        out = Path(a.out or ".")
        out.mkdir(parents=True, exist_ok=True)
        for img in a.imgs:
            look(img, out / f"{img}_look.jpg")
        return
    plan = load_plan(strict=not (a.check or a.sheet))
    if a.check or a.sheet:
        out = Path(a.out or ".")
        out.mkdir(parents=True, exist_ok=True)
        for img in a.imgs:
            if img not in plan:
                print(f"{img} is not in the plan", file=sys.stderr)
                continue
            if a.check:
                check(img, plan[img], out / f"{img}_check.jpg")
            if a.sheet:
                sheet_of(img, plan[img], out / f"{img}_sheet.jpg")
        return
    write(a.imgs or list(plan), plan)


if __name__ == "__main__":
    main()
