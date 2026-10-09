"""Line up several witnesses' readings of one locus, glyph by glyph (docs/TEXT.md 3.2, steps 3 and 4).

A witness's reading is a list of glyph slots, each with its options (more than one where the transcriber wrote
[a:o]), and the space before each slot. Each witness is aligned to ZL, the only one that covers every locus, by
dynamic programming over slots. The cost of setting two slots against each other:
  - nothing for the same glyphs;
  - little where they share an STA family (a/o/y, r/s, k/t), or where their strokes nearly match (iin/in);
  - the fitted cost of a pair that transcribers often confuse, where costs.json has one (fitted on a fixed set of
    pages, see costs.py), if lower;
  - a 2-for-1 match only where the strokes match (ch against ee, che against eee), never across a word break.
A slot a witness skipped (the interlinear's %) costs little against anything. Then columns ("units") are cut wherever
every witness has a glyph boundary.
"""
from __future__ import annotations

import functools
import json
from pathlib import Path

import sta

GAP = 0.9
MERGE = 0.35            # extra cost of a 2-for-1 match
MERGE_MAX = 0.34        # and only where the stroke distance is at most this
BAND = 10
COSTS: dict[tuple[str, str], float] = {}


def load_costs(path: Path):
    COSTS.clear()
    if path.exists():
        for a, b, c, _n in json.loads(path.read_text())["pairs"]:
            COSTS[(a, b)] = COSTS[(b, a)] = c


class Wit:
    """One witness's reading of one locus."""

    def __init__(self, name: str, text: str):
        self.name = name
        self.glyphs: list[list[tuple[str, ...]]] = []
        self.space: list[str] = []          # space[k]: the mark before slot k; space[len] is the end
        pend = ""
        for kind, v in sta.tokenize(text):
            if kind == "s":
                pend = v if (pend == "" or v in ".-") else pend
            else:
                self.space.append(pend if self.glyphs else "")
                self.glyphs.append(v)
                pend = ""
        self.space.append("")

    def prim(self) -> list[tuple[str, ...]]:
        return [g[0] for g in self.glyphs]


@functools.lru_cache(maxsize=None)
def sdist(a: tuple, b: tuple) -> float:
    A = [s for c in a for s in sta.strokes(c)]
    B = [s for c in b for s in sta.strokes(c)]
    m, n = len(A), len(B)
    D = [[0.0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        D[i][0] = i
    for j in range(n + 1):
        D[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            x, y = A[i - 1], B[j - 1]
            sub = 0 if x == y else (0.3 if x[0] == y[0] else 1)
            D[i][j] = min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + sub)
    return D[m][n] / max(m, n, 1)


@functools.lru_cache(maxsize=None)
def gcost(a: tuple, b: tuple) -> float:
    if a == b:
        return 0.0
    if sta.SKIPPED in a or sta.SKIPPED in b:
        return 0.3
    fam = len(a) == len(b) and all(x[0] == y[0] for x, y in zip(a, b))
    c = min(0.35 if fam else 1.0, 0.15 + sdist(a, b))
    if len(a) == 1 and len(b) == 1:
        fitted = COSTS.get((sta.key(a[0]), sta.key(b[0])))
        if fitted is not None:
            c = min(c, fitted)
    return c


def align(P, Q, PS=None, QS=None):
    """Align slot lists P (the anchor) and Q. Returns ops (i0, i1, j0, j1): P[i0:i1] set against Q[j0:j1]."""
    m, n = len(P), len(Q)
    INF = 1e9
    D = [[INF] * (n + 1) for _ in range(m + 1)]
    B = [[None] * (n + 1) for _ in range(m + 1)]
    D[0][0] = 0
    for i in range(m + 1):
        for j in range(n + 1):
            d = D[i][j]
            if d >= INF:
                continue
            for di, dj in ((1, 1), (1, 0), (0, 1), (1, 2), (2, 1)):
                ii, jj = i + di, j + dj
                if ii > m or jj > n or abs(ii * n - jj * m) > BAND * max(m, n, 1):
                    continue
                if di == 2 and PS and PS[i + 1]:
                    continue
                if dj == 2 and QS and QS[j + 1]:
                    continue
                if di and dj:
                    a = tuple(c for s in P[i:ii] for c in s)
                    b = tuple(c for s in Q[j:jj] for c in s)
                    if di + dj == 3 and sdist(a, b) > MERGE_MAX:
                        continue
                    c = gcost(a, b) + (MERGE if di + dj == 3 else 0)
                else:
                    c = GAP
                if d + c < D[ii][jj]:
                    D[ii][jj] = d + c
                    B[ii][jj] = (i, j)
    ops, i, j = [], m, n
    while (i, j) != (0, 0):
        pi, pj = B[i][j]
        ops.append((pi, i, pj, j))
        i, j = pi, pj
    return ops[::-1]


def units(anchor: Wit, wits: list[Wit]) -> list[dict[str, list[int]]]:
    """Columns: for each, every witness's slot indices in it. An empty anchor column holds what others inserted."""
    P = anchor.prim()
    m = len(P)
    opsets, bad = {}, set()
    for w in wits:
        ops = align(P, w.prim(), anchor.space, w.space)
        opsets[w.name] = ops
        for (i0, i1, j0, j1) in ops:
            bad.update(range(i0 + 1, i1))
    cuts = [k for k in range(m + 1) if k not in bad]
    spans = []
    for a, b in zip(cuts, cuts[1:]):
        spans += [("ins", a, a), ("sub", a, b)]
    spans.append(("ins", m, m))
    out = []
    for kind, k0, k1 in spans:
        rd = {anchor.name: list(range(k0, k1)) if kind == "sub" else []}
        for w in wits:
            js = []
            for (i0, i1, j0, j1) in opsets[w.name]:
                if kind == "ins" and i0 == i1 == k0:
                    js += range(j0, j1)
                if kind == "sub" and i0 < i1 and k0 <= i0 and i1 <= k1:
                    js += range(j0, j1)
            rd[w.name] = js
        if kind == "ins" and not any(rd.values()):
            continue
        out.append(rd)
    return out
