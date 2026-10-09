#!/usr/bin/env python3
"""Where each RF1b word of the Rosettes foldout (fRos) is on its photographs: called by rf.py; run alone to check it.

  python3 tools/text/rosettes.py          # prints how many words are placed, and which loci have none

No word boxes of voynichese.com cover the Rosettes. Alessandro Placa's voynich-spatial-data (2026, CC BY 4.0) places
and orients all 539 of its words by hand on a Beinecke scan of the foldout, 2412 x 2375 px; his text layer is
Zandbergen and Landini's ZL3b (pinned in inputs.json). Three steps carry his words to RF1b's:

  1. His scan to Yale's photograph 1006231 (the six panels of the sheet are crops of it): an affine map, first from the
     centres of the nine rosettes' rings (his ring shapes against the photograph), then refined so that his words'
     boxes cover as much ink as they can; each of his 46 regions may then move a little more on its own (at most
     80 px of Yale's 7925, kept only where it covers clearly more ink), since a large wavy foldout is never quite the
     same in two photographs. The result is the constants below (the fit is described in docs/text/REDESIGN.md 9).
  2. His words to RF1b's: each RF1b locus is matched to the run of his words that spells it best (a local alignment,
     word by word, allowing one-glyph differences), taking only his words around the rosette the locus belongs to
     (rosettes_hints.json: Petersen's circle numbers in ZL, and the interlinear's descriptions); the longest loci are
     placed first, and where two runs are as good, the one nearer the locus's known place wins.
  3. Shapes, in the panels' units (rf.py): a word of a ring is a band of the ring, round the ring's centre; any other is
     a box turned to Placa's angle for it.
"""
from __future__ import annotations

import csv
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = HERE / "cache"
CREDIT = ("Word positions on the Rosettes foldout: Alessandro Placa, voynich-spatial-data (2026), CC BY 4.0, carried to "
          "Yale's photograph and to RF1b's words by Voynich Viewer (tools/text/rosettes.py).")
YALE = "1006231"
# step 1: Placa's scan -> Yale's photograph (pixels): x' = M[0] . (x, y, 1), y' = M[1] . (x, y, 1)
M = [[2.887433180000001, -0.005672613140000001, 786.670308], [0.0218994891, 2.934360490000001, 136.4589809]]
OFFSETS = {3: (0, -10), 4: (-10, 20), 6: (-30, 10), 11: (30, -20), 13: (40, -20), 15: (40, -10), 16: (50, -10),
           17: (40, 0), 19: (40, 10), 23: (-40, 20), 24: (-30, 20), 25: (-40, 20), 26: (0, -10), 27: (-40, 20),
           28: (-50, 20), 29: (40, -30), 30: (-70, -20), 31: (40, -10), 42: (-10, 10), 43: (-30, 10), 46: (-30, 20)}
# how far (Yale px) a match may be from a locus's known place for each point of score, by how sure the place is
SURE = {"seen": 400, "clock": 600, "bay": 1000, "area": 1200, "ring": 3000}
# the rings' centres on Yale's photograph, measured on it, to start the fit (Petersen's circle numbers)
CENTRES = {1: (1885, 1385), 2: (1940, 3590), 3: (2000, 5700), 4: (4390, 1235), 5: (4330, 3580), 6: (4200, 5910),
           7: (6650, 1300), 8: (6530, 3700), 9: (6400, 5980)}


def scale() -> float:
    return math.hypot(M[0][0], M[1][0])


def to_yale(x: float, y: float, par: int) -> tuple[float, float]:
    dx, dy = OFFSETS.get(par, (0, 0))
    return M[0][0] * x + M[0][1] * y + M[0][2] + dx, M[1][0] * x + M[1][1] * y + M[1][2] + dy


def tokens() -> list[dict]:
    out = []
    for t in csv.DictReader((CACHE / "placa_tokens_f85v_86r.csv").open()):
        par = int(t["paragraph"])
        X, Y = to_yale(float(t["x_px"]), float(t["y_px"]), par)
        fs = float(t["font_size_px"] or 14)
        out.append({"par": par, "i": int(t["token_index"]), "eva": t["token"], "X": X, "Y": Y,
                    "L": max(float(t["trace_length_px"] or 0), fs) * scale(), "T": fs * scale(),
                    "ang": float(t["angle_deg"] or 0)})
    return out


# ---------------------------------------------------------------- step 2: his words to RF1b's
def sim(a: str, b: str) -> float:
    """how alike two words are, 0..1 (1 - edit distance / longer length); an unreadable ? or * counts half"""
    if a == b and "?" not in a and "*" not in a:
        return 1.0
    n, m = len(a), len(b)
    if not n or not m:
        return 0.0
    prev = [float(k) for k in range(m + 1)]
    for i in range(1, n + 1):
        cur = [float(i)] + [0.0] * m
        for j in range(1, m + 1):
            x, y = a[i - 1], b[j - 1]
            cost = 0.0 if x == y and x not in "?*" else 0.5 if (x in "?*" or y in "?*") else 1.0
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return 1 - prev[m] / max(n, m)


def align(words: list[str], toks: list[dict]) -> tuple[float, list[tuple[int, int]]]:
    """the best local alignment of a locus's words with a run of tokens not yet taken: score, pairs (word, token)"""
    n, m = len(words), len(toks)
    S = [[0.0] * (m + 1) for _ in range(n + 1)]
    B = [[None] * (m + 1) for _ in range(n + 1)]
    best, at = 0.0, None
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            s = 0.0 if toks[j - 1].get("used") else sim(words[i - 1], toks[j - 1]["eva"])
            w = 2.0 if s == 1 else 1.2 if s >= .75 else .5 if s >= .6 else -1.0
            opts = [(0.0, None), (S[i - 1][j - 1] + w, "d"), (S[i - 1][j] - .8, "u"), (S[i][j - 1] - .8, "l")]
            S[i][j], B[i][j] = max(opts, key=lambda o: o[0])
            if S[i][j] > best:
                best, at = S[i][j], (i, j)
    pairs = []
    while at and B[at[0]][at[1]]:
        i, j = at
        if B[i][j] == "d":
            if not toks[j - 1].get("used") and sim(words[i - 1], toks[j - 1]["eva"]) >= .6:
                pairs.append((i - 1, j - 1))
            at = (i - 1, j - 1)
        elif B[i][j] == "u":
            at = (i - 1, j)
        else:
            at = (i, j - 1)
    return best, pairs[::-1]


def roles() -> dict[int, str]:
    return {int(r["paragraph"]): r["role"] for r in csv.DictReader((CACHE / "placa_poly_transforms_f85v_86r.csv").open())}


def match(loci: list[tuple[str, str, list[str]]]):
    """RF1b's loci [(id, type, words in basic Eva)] -> {(locus index, word index): token}. Each locus is matched to
    the run of Placa's words that spells it best, near where the locus is known to be: within its rosette (his region's
    own rosette, C<n>, or the nearest), or, where its place has been seen on the photograph, close to that."""
    hints = json.loads((HERE / "rosettes_hints.json").read_text())["loci"]
    role = roles()
    by_par = {}
    for t in tokens():
        by_par.setdefault(t["par"], []).append(t)
    for par in by_par:
        by_par[par].sort(key=lambda t: t["i"])
    def circle(par, ts):
        m = re.match(r"C(\d)\.", role.get(par, ""))
        if m:
            return int(m.group(1))
        mx = sum(t["X"] for t in ts) / len(ts); my = sum(t["Y"] for t in ts) / len(ts)
        return min(CENTRES, key=lambda c: math.hypot(CENTRES[c][0] - mx, CENTRES[c][1] - my))
    out = {}
    for k in sorted(range(len(loci)), key=lambda k: -len(loci[k][2])):
        lid, typ, words = loci[k]
        if not words:
            continue
        circ, hx, hy, how = hints.get(lid, [None, None, None, None])
        best = None
        for par, ts in by_par.items():
            score, pairs = align(words, ts)
            if not pairs:
                continue
            tx = sum(ts[j]["X"] for _, j in pairs) / len(pairs); ty = sum(ts[j]["Y"] for _, j in pairs) / len(pairs)
            if hx is not None:   # a point off the locus's known place costs, as much as that place is sure
                pen = math.hypot(tx - hx, ty - hy) / SURE.get(how, 1200)
            else:
                pen = 0.0 if not circ or circle(par, ts) == circ else 1.5
            if not best or score - pen > best[0]:
                best = (score - pen, par, pairs, score)
        if not best:
            continue
        value, par, pairs, score = best
        if len(pairs) < max(1, math.ceil(.4 * len(words))) or value < .6:
            continue
        for wi, j in pairs:
            by_par[par][j]["used"] = True
            out[(k, wi)] = by_par[par][j]
    # then the words Placa writes joined (one of his for two of RF1b's) or split (two of his for one), and single
    # words left over, near where their locus is known to be
    free = [t for ts in by_par.values() for t in ts if not t.get("used")]
    for k, (lid, typ, words) in enumerate(loci):
        circ, hx, hy, how = hints.get(lid, [None, None, None, None])
        def near(t):
            return math.hypot(t["X"] - hx, t["Y"] - hy) / SURE.get(how, 1200) if hx is not None else 0.0
        for wi, w in enumerate(words):
            if (k, wi) in out:
                continue
            nxt = words[wi + 1] if wi + 1 < len(words) and (k, wi + 1) not in out else None
            cands = []
            for t in free:
                if t.get("used"):
                    continue
                if nxt and sim(w + nxt, t["eva"]) >= .8:                      # joined: one token for two words
                    cands.append((sim(w + nxt, t["eva"]) - near(t), "join", t, None))
                if sim(w, t["eva"]) >= .75:
                    cands.append((sim(w, t["eva"]) - near(t), "one", t, None))
                ts = by_par[t["par"]]; j = ts.index(t)
                if j + 1 < len(ts) and not ts[j + 1].get("used") and sim(w, t["eva"] + ts[j + 1]["eva"]) >= .8:
                    cands.append((sim(w, t["eva"] + ts[j + 1]["eva"]) - near(t), "split", t, ts[j + 1]))
            if not cands:
                continue
            v, kind, t, t2 = max(cands, key=lambda c: c[0])
            if v < .4:
                continue
            t["used"] = True
            if kind == "join":
                n1, n2 = len(w), len(nxt)
                out[(k, wi)] = {**t, "part": (0, n1 / (n1 + n2))}
                out[(k, wi + 1)] = {**t, "part": (n1 / (n1 + n2), 1)}
            elif kind == "split":
                t2["used"] = True
                out[(k, wi)] = {**t, "X": (t["X"] + t2["X"]) / 2, "Y": (t["Y"] + t2["Y"]) / 2,
                                "L": math.hypot(t2["X"] - t["X"], t2["Y"] - t["Y"]) + (t["L"] + t2["L"]) / 2}
            else:
                out[(k, wi)] = t
    return out


# ---------------------------------------------------------------- step 3: shapes, for rf.py
def shapes(loci, panels):
    """rows for rf.py: (locus, word, panel index, shape, reading angle); panels: [(img, x0, y0, x1, y1)] on Yale's
    photograph. A ring's word is a band round the ring's centre (Placa's ring shapes)."""
    got = match(loci)
    poly = json.loads((CACHE / "placa_polygons_f85v_86r.json").read_text())["polygons"]
    ring_c = [to_yale(p["cx"], p["cy"], p["id"]) for p in poly if p.get("shape") == "ring" and p.get("cx") is not None]
    rows = []
    for (li, wi), t in got.items():
        X, Y, L0 = t["X"], t["Y"], t["L"]
        if "part" in t:   # one of Placa's words for two of RF1b's: each its share of it, along its line
            f0, f1 = t["part"]; c, s_ = math.cos(math.radians(t["ang"])), math.sin(math.radians(t["ang"]))
            mid = (f0 + f1) / 2 - .5
            X, Y, L0 = X + c * mid * L0, Y + s_ * mid * L0, L0 * (f1 - f0)
        pi = next((i for i, (_, x0, y0, x1, y1) in enumerate(panels) if x0 <= X < x1 and y0 <= Y < y1), None)
        if pi is None:
            continue
        _, x0, y0, x1, y1 = panels[pi]
        u = 1000 / (y1 - y0)                              # Yale px -> the panel's units (thousandths of its height)
        cx, cy, L, T, ang = (X - x0) * u, (Y - y0) * u, L0 * u, t["T"] * 1.25 * u, t["ang"]
        shape = None
        if loci[li][1][0] == "C" and ring_c:
            rx, ry = min(ring_c, key=lambda c: math.hypot(c[0] - X, c[1] - Y))
            rcx, rcy = (rx - x0) * u, (ry - y0) * u
            r = math.hypot(cx - rcx, cy - rcy)
            mid = math.degrees(math.atan2(cy - rcy, cx - rcx))
            off = ((ang - mid) + 180) % 360 - 180
            if r > 3 * T and abs(abs(off) - 90) < 25:     # written along the ring: a band of it
                half = math.degrees(L / 2 / r)
                shape = ["a", rcx, rcy, r - T / 2, r + T / 2, mid - half, mid + half]
        if not shape:
            shape = ["o", cx, cy, L, T, ang]
        rows.append((li, wi, pi, shape, ang))
    return rows, len(got)


def main():
    sys.path.insert(0, str(HERE))
    t = json.loads((ROOT / "data" / "text" / "rf" / "text.json").read_text())
    a = json.loads((ROOT / "data" / "text" / "rf" / "alpha.json").read_text())["schemes"]["eva"]["codes"]
    loci = []
    for page, ls in t["pages"]:
        if page == "fRos":
            for lid, typ, ps, s in ls:
                loci.append((lid, typ, ["".join(a[c] for c in re.findall(r"[A-Z][0-9a-z%]", w)) for w in re.split(r"[.,\-]", s)]))
    got = match(loci)
    n = sum(len(w) for _, _, w in loci)
    print(f"fRos: {len(got)} of {n} RF1b words placed ({100 * len(got) / n:.0f}%)")
    missing = [loci[k][0] for k in range(len(loci)) if not any((k, w) in got for w in range(len(loci[k][2])))]
    print("loci with no word placed:", " ".join(missing) or "none")


if __name__ == "__main__":
    main()
