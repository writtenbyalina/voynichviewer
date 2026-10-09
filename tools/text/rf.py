#!/usr/bin/env python3
"""The Reader's text: RF1b, René Zandbergen's reference transliteration, and where each of its words is on the pages.

  python3 tools/text/rf.py        # after fetch.py, build.py and boxes.py; writes data/text/rf/

RF1b (https://www.voynich.nu/extra/sta-aaa.html) is Zandbergen's merge of his and Landini's transliteration (ZL) with
Glen Claston's (GC), aligned glyph by glyph, with clear mistakes corrected, made to count every line's glyphs as exactly
as possible. It is in his Super Transliteration Alphabet (STA, reduced): every glyph a family letter and a member (A1 o,
A3 a, K1 ch...). From STA his bitrans tables write it in any of the historical
alphabets, and this builds those tables for the site:

  text.json          every locus of every page, in book order: [id, type, paragraph starts (1/0), STA with '.' a
                     space, ',' an uncertain space, '-' a drawing in the line (<->)]
  alpha.json         for each alphabet (Eva, full Eva, FSG, Currier), what each STA code is written as, by
                     Zandbergen's own tables: Eva (basic) gives his RF1b-er.txt back exactly, full Eva his RF1b-e.txt
                     (test_text.py). FSG and Currier cannot write every glyph RF1b distinguishes; there the nearest
                     basic Eva form (STA-Eva_Bint.bit) is written in that alphabet instead, and marked approximate.
  shapes/<page>.json where each RF1b word is on the page photographs, and its shape: the word boxes of boxes.py (The
                     Voynichese Project's, fitted to Yale's photographs, tied to the consensus words) carried over to
                     RF1b's words through a glyph-by-glyph alignment; then, from the line each word is in, a shape that
                     follows the writing (below).

Shapes, in thousandths of the panel image's height on both axes (x runs to 1000 x width / height):

  ["r", x, y, w, h]                 an upright box: a word written straight across
  ["o", cx, cy, length, height, a]  a box turned to angle a: a word in a slanting line, or along a radius
  ["a", cx, cy, r0, r1, a0, a1]     a band of a ring, between radii r0 and r1, from angle a0 to a1: a word written
                                    round a circle (angles in degrees, clockwise from 3 o'clock, as on screen)

A ring's circle is fitted to its words' boxes; each word is then the stretch of the ring its box holds. Its reading
direction (which way the words of the ring follow one another) says which way up its glyphs stand. Each word row is
[locus, word, panel, shape..., reading angle, estimated]: the reading angle (degrees, on screen) is the direction the
word is read in, so turning the page by minus that angle sets the word upright.
"""
from __future__ import annotations

import collections
import difflib
import json
import math
import os
import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import sta  # noqa: E402

OUT = ROOT / "data" / "text" / "rf"
CODE = re.compile(r"[A-Z][0-9a-z%]")
CREDIT = ("Text: RF1b, René Zandbergen's reference transliteration (voynich.nu, CC0), a merge of the transliterations "
          "of Zandbergen and Gabriel Landini and of Glen Claston. Word positions: The Voynichese Project (2014, Apache "
          "License 2.0), fitted to Yale's photographs.")
SCHEMES = {   # code -> (name, table, what it is)
    "eva": ("Eva", "STA-Eva_Bint.bit", "basic Eva, each glyph by its nearest basic Eva letters, as in Zandbergen's RF1b-er.txt"),
    "evx": ("Eva, full", "STA-Eva_def.bit", "Extended Eva (Landini and Zandbergen, 1998), as in Zandbergen's RF1b-e.txt"),
    "fsg": ("FSG", "STA-FSG_def.bit", "the First Study Group's alphabet (William Friedman, 1944–46)"),
    "cur": ("Currier", "STA-Curr_def.bit", "Prescott Currier's alphabet (1970s)"),
}


# ---------------------------------------------------------------- the text
def rf_loci() -> dict[str, str]:
    """RF1b in STA: locus id -> its STA, with '.', ',' and '-' (a drawing in the line) between words."""
    out = {}
    for line in (sta.CACHE / "RF1b.txt").read_text(encoding="latin-1").splitlines():
        m = re.match(r"<(f[^.>]+\.[^,>]+),[^>]+>\s+(.*)", line)
        if not m:
            continue
        s = re.sub(r"<@[^>]*>|<![^>]*>", "", m.group(2).strip())   # a change of hand (<@H=2>), a comment
        s = s.replace("<->", "-").replace("<~>", "-")
        if re.search(r"[<>{}\[\]!?*%$]", s):
            raise SystemExit(f"{m.group(1)}: unexpected markup in RF1b: {s}")
        out[m.group(1)] = s
    return out


def words_of(s: str) -> list[list[str]]:
    return [CODE.findall(w) for w in re.split(r"[.,\-]", s)]


# ---------------------------------------------------------------- the alphabets
def bit_rules(name: str) -> list[tuple[str, str]]:
    out = []
    for line in (sta.CACHE / name).read_text(encoding="latin-1").splitlines():
        if not line or line[0] in "#<":
            continue
        p = line.split()
        if len(p) >= 2:
            out.append((p[0], p[1]))
    return out


def convert(codes: list[str], rules: dict[str, str]) -> str | None:
    """bitrans's way, STA to an alphabet: the longest rule that matches, along the codes; None if one has no rule"""
    s, out, i = "".join(codes), "", 0
    keys = sorted(rules, key=len, reverse=True)
    while i < len(s):
        k = next((k for k in keys if s.startswith(k, i)), None)
        if k is None:
            return None
        out += rules[k]; i += len(k)
    return out


# basic Eva letters FSG and Currier have no letter for, and the basic glyph each is drawn like
NEAREST = {"c": "e", "h": "e", "u": "a"}


def alphabets(used: set[str]) -> dict:
    eva_rules = dict(bit_rules("STA-Eva_def.bit"))
    basic = sta.BINT
    out = {"about": "What each STA code of RF1b is written as in each alphabet (tools/text/rf.py). 'multi' are rules "
                    "over two codes, applied first (bitrans takes the longest rule). 'approx' lists the codes the "
                    "alphabet cannot write: the nearest basic Eva form is written in it instead.",
           "schemes": {}}
    for key, (name, table, what) in SCHEMES.items():
        rules = dict(bit_rules(table))
        # the basic glyphs, from basic Eva back to STA, to write a glyph the alphabet lacks by its nearest basic form
        back = {}
        for code, e in eva_rules.items():
            if len(code) == 2 and code in rules and re.fullmatch(r"[a-z]+", e) and e not in back:
                back[e] = code
        singles, approx = {}, []
        for code in sorted(used):
            if code in rules:
                singles[code] = rules[code]
                if key == "eva" and rules[code] != eva_rules.get(code):
                    approx.append(code)                  # basic Eva: a glyph full Eva tells apart, by its nearest letters
                continue
            b = basic.get(code, "?")
            # the nearest basic form, letter by letter; where the alphabet has no letter for a basic letter either
            # (the halves of a bench, c and h; u, a form of a), the glyph it is drawn like stands in
            parts = None
            for form in (b, "".join(NEAREST.get(ch, ch) for ch in b)):
                parts, i = [], 0
                while i < len(form):
                    e = next((e for e in sorted(back, key=len, reverse=True) if form.startswith(e, i)), None)
                    if not e:
                        parts = None; break
                    parts.append(rules[back[e]]); i += len(e)
                if parts:
                    break
            singles[code] = "".join(parts) if parts else rules.get("Z1", "?")
            approx.append(code)
        multi = {k: v for k, v in rules.items() if len(k) > 2 and all(c in used for c in CODE.findall(k))}
        out["schemes"][key] = {"name": name, "what": what, "codes": singles, "multi": multi, "approx": approx}
    # not shown: basic Eva with the rare glyphs as Extended Eva's @nnn;, as Search's lines (data/text/w) are written,
    # to find a search result's words in RF1b
    out["search"] = {c: eva_rules.get(c, "?") if sta.eva(c) == "?" and "@" in eva_rules.get(c, "") else sta.eva(c)
                     for c in sorted(used)}
    return out


# ---------------------------------------------------------------- from the consensus words' boxes to RF1b's words
def glyphs_with_words(g: str, split_on_comma: bool):
    """[(code, word index)] of a line in STA, its words split on '.' (and ',' when asked)"""
    out, wi = [], 0
    for t in re.findall(r"[A-Z][0-9a-z%]|[.,\-]", g):
        if t == "." or t == "-" or (t == "," and split_on_comma):
            wi += 1
        elif t != ",":
            out.append((t, wi))
    return out


def glyph_map(cons: list[tuple[str, int]], rf: list[tuple[str, int]]) -> list[float]:
    """For each RF1b glyph, the position (glyph index) of the consensus glyph it lines up with, compared as basic Eva."""
    key = lambda c: sta.BINT.get(c, c)
    a, b = [key(c) for c, _ in rf], [key(c) for c, _ in cons]
    pos = [None] * len(a)
    for tag, i0, i1, j0, j1 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        for i in range(i0, i1):
            if j1 > j0:
                pos[i] = j0 + (i - i0) * (j1 - j0) / max(1, i1 - i0)
            else:
                pos[i] = j0 - 0.5            # a glyph only RF1b has: between its neighbours
    return pos


def rf_boxes(loc: dict, rf_sta: str, boxes: dict):
    """RF1b word index -> (panel, (x0, y0, x1, y1) in thousandths, estimated), from the consensus words' boxes."""
    cons = glyphs_with_words(loc["g"], False)
    rf = glyphs_with_words(rf_sta, True)
    if not cons or not rf:
        return {}
    pos = glyph_map(cons, rf)
    nwc = max(w for _, w in cons) + 1
    span = [[None, None] for _ in range(nwc)]          # each consensus word's glyph range
    for j, (_, w) in enumerate(cons):
        if span[w][0] is None:
            span[w][0] = j
        span[w][1] = j
    out = {}
    nwr = max(w for _, w in rf) + 1
    for r in range(nwr):
        ps = [p for (c, w), p in zip(rf, pos) if w == r]
        if not ps:
            continue
        j0, j1 = min(ps), max(ps) + 1                   # the consensus glyphs it covers: [j0, j1)
        parts, whole = [], True
        for w, (a, b) in enumerate(span):
            if a is None or b + 1 <= j0 or a >= j1:
                continue
            bx = boxes.get(w)
            if not bx:
                continue
            n = b - a + 1
            f0, f1 = max(0.0, (j0 - a) / n), min(1.0, (j1 - a) / n)
            if f1 - f0 < 0.15:                          # a sliver of a word: not worth a box
                continue
            if f0 > 0.05 or f1 < 0.95:
                whole = False
            parts.append((bx, f0, f1))
        if not parts:
            continue
        panel = collections.Counter(bx[0] for bx, _, _ in parts).most_common(1)[0][0]
        rects, est = [], not whole
        for (p, x, y, w, h, e), f0, f1 in parts:
            if p != panel:
                continue
            est = est or bool(e)
            if w >= h:                                  # a part of a word: cut along its length
                rects.append((x + w * f0, y, x + w * f1, y + h))
            else:
                rects.append((x, y + h * f0, x + w, y + h * f1))
        x0 = min(r[0] for r in rects); y0 = min(r[1] for r in rects)
        x1 = max(r[2] for r in rects); y1 = max(r[3] for r in rects)
        out[r] = (panel, (x0, y0, x1, y1), est)
    return out


# ---------------------------------------------------------------- shapes that follow the writing
def fit_circle(pts: np.ndarray):
    """least-squares circle through points (Kåsa): centre and radius"""
    x, y = pts[:, 0], pts[:, 1]
    A = np.c_[2 * x, 2 * y, np.ones(len(x))]
    sol, *_ = np.linalg.lstsq(A, x * x + y * y, rcond=None)
    cx, cy = sol[0], sol[1]
    return cx, cy, math.sqrt(max(1e-9, sol[2] + cx * cx + cy * cy))


def wrap(a: float) -> float:
    return (a + 180) % 360 - 180


def arc_in_box(cx, cy, r, box, mid):
    """the run of angles (degrees) where the circle of radius r lies inside box, the run nearest angle mid"""
    x0, y0, x1, y1 = box
    inside = []
    for k in range(720):
        a = k / 2
        t = math.radians(a)
        px, py = cx + r * math.cos(t), cy + r * math.sin(t)
        inside.append(x0 <= px <= x1 and y0 <= py <= y1)
    if not any(inside):
        return None
    runs, k0 = [], None
    start = inside.index(False) if not all(inside) else 0
    for i in range(1, 721):                             # walk round from a point outside, so no run is cut in two
        k = (start + i) % 720
        if inside[k] and k0 is None:
            k0 = k
        if not inside[k] and k0 is not None:
            runs.append((k0 / 2, ((k - 1) % 720) / 2)); k0 = None
    if k0 is not None:
        runs.append((k0 / 2, ((start) % 720) / 2))
    best = min(runs, key=lambda ab: abs(wrap((ab[0] + (wrap(ab[1] - ab[0]) % 360) / 2) - mid)))
    a0, a1 = best
    if a1 < a0:
        a1 += 360
    return a0, a1


def arc_bbox(cx, cy, r0, r1, a0, a1):
    angs = [a0, a1] + [k * 90 for k in range(-4, 9) if a0 < k * 90 < a1]
    xs, ys = [], []
    for a in angs:
        t = math.radians(a)
        for r in (r0, r1):
            xs.append(cx + r * math.cos(t)); ys.append(cy + r * math.sin(t))
    return min(xs), min(ys), max(xs), max(ys)


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / max(1e-9, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def oriented(box, ang, t):
    """a box turned to angle ang (degrees) through the centre of an upright box: as long as the line through its
    centre at that angle runs inside the box, and t high"""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    dx, dy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    lims = []
    if abs(dx) > 1e-6:
        lims.append(abs((x1 - x0) / 2 / dx))
    if abs(dy) > 1e-6:
        lims.append(abs((y1 - y0) / 2 / dy))
    half = min(lims) if lims else 0
    length = max(2 * half - t * 0.5, t)                # the corners of a slanting word's box hold its height too
    return cx, cy, length, t


def text_height(rects: list) -> float:
    hs = sorted(min(r[2] - r[0], r[3] - r[1]) for r in rects)
    return hs[len(hs) // 3] if hs else 20.0


def shapes_for_page(loci: list, rfwords: list, rows: list, aspect_of: dict) -> list:
    """rows: [li, wi, panel, (x0, y0, x1, y1) thousandths, est]; rfwords: each locus's RF1b words' glyph counts.
    Returns the shape rows (see the module's doc)."""
    out = []
    by_panel = collections.defaultdict(list)
    for r in rows:
        by_panel[r[2]].append(r)
    for panel, prow in by_panel.items():
        others = [{li: {wi: 1}} for p2, rr_ in by_panel.items() if p2 != panel for li, wi, *_ in rr_]
        placed_est = set()
        k = aspect_of[panel]
        U = lambda b: (b[0] * k, b[1], b[2] * k, b[3])          # thousandths of width -> of height
        rects = {(li, wi): U(b) for li, wi, _p, b, _e in prow}
        est = {(li, wi): e for li, wi, _p, _b, e in prow}
        t_all = text_height(list(rects.values()))
        straight = [b for (li, wi), b in rects.items() if loci[li]["t"][0] == "P"]
        t_line = text_height(straight) if len(straight) > 5 else t_all
        by_locus = collections.defaultdict(dict)
        for (li, wi), b in rects.items():
            by_locus[li][wi] = b
        rings = []                                       # (cx, cy, r) of each ring fitted on this panel
        shape = {}
        # rings first (the radii need their centres)
        for li, ws in by_locus.items():
            sure = {w: b for w, b in ws.items() if not est[(li, w)]}   # the circle is fitted to measured boxes only
            if loci[li]["t"][0] != "C" or len(sure) < 4:
                continue
            order = sorted(sure)
            cs = np.array([((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for b in (sure[w] for w in order)])
            cx, cy, r = fit_circle(cs)
            d = np.hypot(cs[:, 0] - cx, cs[:, 1] - cy)
            angs = np.degrees(np.arctan2(cs[:, 1] - cy, cs[:, 0] - cx))
            spread = 360 - max(wrap(b - a) % 360 for a, b in zip(np.sort(angs), np.r_[np.sort(angs)[1:], np.sort(angs)[0] + 360]))
            if np.sqrt(np.mean((d - r) ** 2)) > 0.12 * r or spread < 60 or r < 3 * t_all:
                continue
            steps = [wrap(b - a) for a, b in zip(angs, angs[1:])]
            sense = 1 if np.median(steps) >= 0 else -1  # clockwise on screen: the glyphs' tops face out
            rings.append((cx, cy, r))
            t = text_height(list(sure.values()))
            known = {}                                   # word -> (radius, start, end) along the reading direction
            for w, (cxw, cyw) in zip(order, cs):
                b = sure[w]
                mid = math.degrees(math.atan2(cyw - cy, cxw - cx))
                best = None
                for f in np.linspace(-0.6, 0.6, 13):     # the ring wanders: the radius this word's box fits best
                    rr = r + f * t * 1.5
                    m = 0.08 * t
                    run = arc_in_box(cx, cy, rr, (b[0] - m, b[1] - m, b[2] + m, b[3] + m), mid)
                    if not run:
                        continue
                    a0, a1 = run
                    score = iou(arc_bbox(cx, cy, rr - t / 2, rr + t / 2, a0, a1), b)
                    if not best or score > best[0]:
                        best = (score, rr, a0, a1)
                if best and best[0] >= 0.45:
                    _, rr, a0, a1 = best
                    known[w] = (rr, a0, a1)
            if len(known) < 3:
                continue
            # along the reading direction, unwrapped from the first known word: s = sense x angle
            ks = sorted(known)
            ref = None
            pos = {}
            for w in ks:
                rr, a0, a1 = known[w]
                lo, hi = (a0, a1) if sense > 0 else (-a1, -a0)
                if ref is None:
                    ref = lo
                base = ref + (wrap(lo - ref) % 360 if w != ks[0] else 0)
                if pos and base < max(p[2] for p in pos.values()) - 30:
                    base += 360                          # past the start of the ring again
                pos[w] = (rr, base, base + (hi - lo))
            for w in ks:
                rr, s0, s1 = pos[w]
                a0, a1 = (s0, s1) if sense > 0 else (-s1, -s0)
                shape[(li, w)] = (["a", cx, cy, rr - t / 2, rr + t / 2, a0, a1], wrap((a0 + a1) / 2 + 90 * sense))
            # the other words of the ring (estimated boxes, or none): along the ring between the measured ones, shared
            # out by their glyphs; past the first or last measured word, at the ring's own glyph spacing
            n = len(rfwords[li])
            per_glyph = np.median([(pos[w][2] - pos[w][1]) / max(1, rfwords[li][w]) for w in ks])
            gap = 0.6 * per_glyph
            def place(w, s0, s1, rr):
                a0, a1 = (s0, s1) if sense > 0 else (-s1, -s0)
                am = math.radians((a0 + a1) / 2)
                x, y = cx + rr * math.cos(am), cy + rr * math.sin(am)
                if not (0 <= x <= 1000 * k and 0 <= y <= 1000) or s1 - s0 > 90:
                    return
                shape[(li, w)] = (["a", cx, cy, rr - t / 2, rr + t / 2, a0, a1], wrap((a0 + a1) / 2 + 90 * sense))
                placed_est.add((li, w))
            for w in range(n):
                if w in known or (w not in ws and any(w in o.get(li, {}) for o in others)):
                    continue                             # measured here, or placed on another panel
                prev = max((x for x in ks if x < w), default=None)
                nxt = min((x for x in ks if x > w), default=None)
                if prev is not None and nxt is not None:
                    lens = [rfwords[li][x] + 0.6 for x in range(prev + 1, nxt)]
                    s_a, s_b = pos[prev][2] + gap / 2, pos[nxt][1] - gap / 2
                    if s_b <= s_a:
                        continue
                    before = sum(lens[:w - prev - 1])
                    f0, f1 = before / sum(lens), (before + lens[w - prev - 1] - 0.6) / sum(lens)
                    rr = (pos[prev][0] + pos[nxt][0]) / 2
                    place(w, s_a + (s_b - s_a) * f0, s_a + (s_b - s_a) * f1, rr)
                elif prev is not None:
                    start = pos[prev][2] + gap + sum(rfwords[li][x] * per_glyph + gap for x in range(prev + 1, w))
                    place(w, start, start + rfwords[li][w] * per_glyph, pos[prev][0])
                elif nxt is not None:
                    end = pos[nxt][1] - gap - sum(rfwords[li][x] * per_glyph + gap for x in range(w + 1, nxt))
                    place(w, end - rfwords[li][w] * per_glyph, end, pos[nxt][0])
        # radii (and the spiral arms of f68v3, which IVTFF counts as radii): each word turned the way its line runs
        # there, from the word before it to the word after; a radius of one word reads out from the nearest ring's centre
        for li, ws in by_locus.items():
            if loci[li]["t"][0] != "R":
                continue
            order = sorted(ws)
            cs = np.array([((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for b in (ws[w] for w in order)])
            for i, w in enumerate(order):
                if len(cs) >= 2:
                    v = cs[min(i + 1, len(cs) - 1)] - cs[max(i - 1, 0)]
                    ang = math.degrees(math.atan2(v[1], v[0]))
                elif rings:
                    cx, cy, _r = min(rings, key=lambda c: math.hypot(c[0] - cs[0][0], c[1] - cs[0][1]))
                    ang = math.degrees(math.atan2(cs[0][1] - cy, cs[0][0] - cx))
                else:
                    continue
                b = ws[w]
                ocx, ocy, L, t = oriented(b, ang, t_line)
                cA, sA = abs(math.cos(math.radians(ang))), abs(math.sin(math.radians(ang)))
                bb = (ocx - (L * cA + t * sA) / 2, ocy - (L * sA + t * cA) / 2, ocx + (L * cA + t * sA) / 2, ocy + (L * sA + t * cA) / 2)
                if iou(bb, b) >= 0.35:                   # its box agrees with the turn
                    shape[(li, w)] = (["o", ocx, ocy, L, t, ang], ang)
        # lines of paragraphs and labels that slant
        for li, ws in by_locus.items():
            kind = loci[li]["t"][0]
            if kind not in "PL" or len(ws) < (3 if kind == "P" else 2):
                continue
            order = sorted(ws)
            cs = np.array([((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for b in (ws[w] for w in order)])
            u, s, vt = np.linalg.svd(cs - cs.mean(0))
            d = vt[0] if np.dot(vt[0], cs[-1] - cs[0]) >= 0 else -vt[0]
            if s[0] < 3 * t_line or (len(s) > 1 and s[1] > 0.35 * s[0]):
                continue                                # too short to say, or not one straight line
            ang = math.degrees(math.atan2(d[1], d[0]))
            if abs(ang) < 8:
                continue
            for w in order:
                ocx, ocy, L, t = oriented(ws[w], ang, t_line)
                shape[(li, w)] = (["o", ocx, ocy, L, t, ang], ang)
        for key_ in sorted(set(rects) | set(shape)):
            b = rects.get(key_)
            s, ang = shape.get(key_) or (["r", b[0], b[1], b[2] - b[0], b[3] - b[1]], 0.0)
            if s[0] == "r" and min(s[3], s[4]) < 0.3 * t_line:
                # a sliver (a box shared out between words that the transcriptions break differently): a line's
                # height, as wide as its glyphs, about its middle, marked estimated
                cx, cy = s[1] + s[3] / 2, s[2] + s[4] / 2
                w = max(s[3], 0.5 * t_line * max(1, rfwords[key_[0]][key_[1]]))
                s = ["r", cx - w / 2, cy - t_line / 2, w, t_line]
                placed_est.add(key_)
            nums = [round(v) for v in s[1:5]] + [round(v, 1) for v in s[5:]]   # lengths whole, angles to a tenth
            e = key_ in placed_est or (est.get(key_, 0) and key_ not in placed_est and s[0] != "a")
            out.append([key_[0], key_[1], panel, s[0], *nums, round(ang, 1), 1 if e else 0])
    out.sort(key=lambda r: (r[0], r[1]))
    return out


def write_rosettes(rows, codex, stats):
    """shapes/fRos.json, from Placa's positioned words carried to RF1b's (rosettes.py), in the six panels' units"""
    import rosettes
    a = json.loads(json.dumps(alphabets({c for r in rows for c in CODE.findall(r[3])})))["schemes"]["eva"]["codes"]
    loci = [(r[0], r[1], ["".join(a[c] for c in CODE.findall(w)) for w in re.split(r"[.,\-]", r[3])]) for r in rows]
    segs = [sg for s in codex["sheets"] for f in ("inside", "outside") for row in s[f] for sg in row
            if not sg.get("missing") and sg.get("page") == "fRos" and sg.get("iiif") == rosettes.YALE]
    panels = [(sg["img"], sg["quad"][0][0], sg["quad"][0][1], sg["quad"][2][0], sg["quad"][2][1]) for sg in segs]
    got, n = rosettes.shapes(loci, panels)
    out = []
    for li, wi, pi, shape, ang in sorted(got, key=lambda r: (r[0], r[1])):
        nums = [round(v) for v in shape[1:5]] + [round(v, 1) for v in shape[5:]]
        out.append([li, wi, pi, shape[0], *nums, round(((ang + 180) % 360) - 180, 1), 0])
        stats[shape[0]] += 1
    stats["words"] += sum(len(l[2]) for l in loci); stats["placed"] += len(out)
    (OUT / "shapes" / "fRos.json").write_text(json.dumps(
        {"page": "fRos", "imgs": [[sg["img"], round(sg["w"] / sg["h"], 5)] for sg in segs], "credit": rosettes.CREDIT,
         "words": out}, separators=(",", ":")) + "\n")


# ---------------------------------------------------------------- main
def main():
    rf = rf_loci()
    codex = json.loads((ROOT / "data" / "codex.json").read_text())
    aspect = {}
    for s in codex["sheets"]:
        for f in ("inside", "outside"):
            for row in s[f]:
                for sg in row:
                    if not sg.get("missing") and sg.get("w"):
                        aspect[sg["img"]] = sg["w"] / sg["h"]
    pages, used = [], set()
    (OUT / "shapes").mkdir(parents=True, exist_ok=True)
    for old in (OUT / "shapes").glob("*.json"):
        old.unlink()
    with_boxes = set(json.loads((ROOT / "data" / "text" / "boxes" / "pages.json").read_text()))
    stats = collections.Counter()
    order = list(dict.fromkeys(l[0].rsplit(".", 1)[0] for l in json.loads((ROOT / "data" / "text" / "index.json").read_text())["loci"]))
    for page in order:
        pf = ROOT / "data" / "text" / "pages" / f"{page}.json"
        if not pf.exists():
            continue
        loci = json.loads(pf.read_text())["loci"]
        rows = []
        for l in loci:
            s = rf.get(l["id"])
            if s is None:
                raise SystemExit(f"{l['id']}: not in RF1b")
            used.update(CODE.findall(s))
            rows.append([l["id"], l["t"], 1 if l.get("ps") else 0, s])
        pages.append([page, rows])
        if page == "fRos":   # the Rosettes: Alessandro Placa's word positions (rosettes.py)
            write_rosettes(rows, codex, stats)
            continue
        if page not in with_boxes:
            continue
        bx = json.loads((ROOT / "data" / "text" / "boxes" / f"{page}.json").read_text())
        cons_boxes = collections.defaultdict(dict)       # locus -> consensus word -> (panel, x, y, w, h, est)
        for row in bx["words"]:
            li, wi, x, y, w, h = row[:6]
            e = row[6] if len(row) > 6 else 0
            p = row[7] if len(row) > 7 else 0
            cons_boxes[li][wi] = (p, x, y, w, h, e)
        prow = []
        for li, l in enumerate(loci):
            if li not in cons_boxes:
                continue
            for wi, (p, b, e) in rf_boxes(l, rf[l["id"]], cons_boxes[li]).items():
                prow.append([li, wi, p, b, e])
        nwords = sum(len(words_of(r[3])) for r in rows)
        rfw = [[len(w) for w in words_of(rf[l["id"]])] for l in loci]
        sh = shapes_for_page(loci, rfw, prow, {p: aspect[img] for p, img in enumerate(bx["imgs"])})
        stats["words"] += nwords; stats["placed"] += len(sh)
        for r in sh:
            stats[r[3]] += 1
            stats["estimated"] += r[-1]
        (OUT / "shapes" / f"{page}.json").write_text(json.dumps(
            {"page": page, "imgs": [[img, round(aspect[img], 5)] for img in bx["imgs"]], "words": sh},
            separators=(",", ":")) + "\n")
    (OUT / "text.json").write_text(json.dumps({"about": "RF1b in STA, every locus, page by page in the order of the "
        "transcriptions: [id, type, paragraph starts, STA] ('.' space, ',' uncertain space, '-' a drawing in the line); "
        "tools/text/rf.py.", "credit": CREDIT, "version": "RF1b", "pages": pages}, separators=(",", ":"), ensure_ascii=False) + "\n")
    (OUT / "alpha.json").write_text(json.dumps(alphabets(used), separators=(",", ":"), ensure_ascii=False) + "\n")
    (OUT / "shapes" / "pages.json").write_text(json.dumps(sorted(p.stem for p in (OUT / "shapes").glob("f*.json")), separators=(",", ":")) + "\n")
    # every word's outline fitted to its ink (inkfit.py); INKFIT=0 leaves the shapes as above, to look at
    stats["on ink"] = 0
    if os.environ.get("INKFIT", "1") != "0":
        import inkfit
        stats["on ink"] = inkfit.refine_all()["words_refit"]
    print(f"{len(pages)} pages, {sum(len(r) for _, r in pages)} loci; words {stats['words']}, placed {stats['placed']} "
          f"({100 * stats['placed'] / max(1, stats['words']):.1f}%): upright {stats['r']}, turned {stats['o']}, "
          f"round a ring {stats['a']}; estimated {stats['estimated']}; fitted to the ink {stats['on ink']}")


if __name__ == "__main__":
    main()
