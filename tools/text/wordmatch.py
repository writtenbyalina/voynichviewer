"""Which of voynichese.com's word boxes belongs to which word of the transcriptions (used by boxes.py).

voynichese.com lists a page's words in its own order: on the round diagrams, rings and labels first and paragraphs
last, its rings starting where it chose. Within a line, though, its words run in the same order as the transcriptions'.
So each line (locus) is found on its own:

  1. Its longest run of words in voynichese.com's list (a local alignment, Smith-Waterman, over the words not yet
     taken), the best-scoring line first, again and again until no line has a convincing run left. A ring that
     voynichese.com begins elsewhere is found in two runs.
  2. Words missing between two placed words of their line take the boxes voynichese.com lists between those two.
  3. Words still unplaced (mostly one-word labels) take the closest unused word with the same or nearly the same
     glyphs, the one nearest the line's other words, or its neighbouring lines', when there is a choice.
  4. A word still without a box, between two words of its line that have one, gets a box between them, marked as
     estimated (boxes.py).

A box goes to a word only where its line runs: a run is cut where next-door words sit far apart on the page, and a
single word must lie near the words of its line already placed.

Words are compared through voynichese.com's own transcription (VT, Takahashi's), as the consensus records it for each
consensus word; where VT has no line, through the consensus.
"""
from __future__ import annotations

import re

import numpy as np
from rapidfuzz.distance import Levenshtein
from rapidfuzz.process import cdist

import readings

GAP = 1.0
EXACT, NEAR, CLOSE, FAR = 3.0, 2.0, 1.0, -2.0
FAR_AWAY = 600          # in voynichese.com's frame, 1,500 px tall: about two fifths of the page
REACH = 120             # about four word-heights
JUMP = 9                # next-door words more than nine word-heights apart are not next door


def tokens(loci) -> list[list[dict]]:
    """For each locus, its words as voynichese.com would have them: {"text", "refs": [(locus, consensus word)]}."""
    out = []
    for li, loc in enumerate(loci):
        rd = readings.words_of(loc, "VT")
        rough = rd is None or ("x" in loc and "VT" in loc["x"])
        if rough:   # no VT line, or one that lines up only roughly: the consensus words themselves
            out.append([{"text": w.replace(",", ""), "refs": [(li, wi)]} for wi, w in enumerate(loc["c"].split("."))])
            continue
        toks, cur = [], None
        for wi, (text, nxt) in enumerate(rd):
            parts = re.split(r"[.,]", text) if text else [""]
            for k, part in enumerate(parts):
                if k and cur is not None:
                    toks.append(cur); cur = None
                if cur is None:
                    cur = {"text": "", "refs": []}
                cur["text"] += part
                if (li, wi) not in cur["refs"]:
                    cur["refs"].append((li, wi))
            if nxt in (".", ",") or wi == len(rd) - 1:
                toks.append(cur); cur = None
        if cur:
            toks.append(cur)
        out.append([t for t in toks if t["text"]])
    return out


def scores(a: list[str], b: list[str]) -> np.ndarray:
    """How well each word of a matches each of b: exact 3, one glyph in five off 2, one in three 1, else -2."""
    if not a or not b:
        return np.zeros((len(a), len(b)))
    d = cdist(a, b, scorer=Levenshtein.distance).astype(float)
    la = np.array([len(x) for x in a], float)[:, None]
    lb = np.array([len(x) for x in b], float)[None, :]
    r = d / np.maximum(1, np.maximum(la, lb))
    return np.where(d == 0, EXACT, np.where(r <= .2, NEAR, np.where(r <= .34, CLOSE, FAR)))


def sw(S: np.ndarray):
    """Smith-Waterman over a score matrix (rows: a line's words; columns: unused boxes): (best score, [(row, col)])."""
    m, n = S.shape
    H = np.zeros((m + 1, n + 1))
    P = np.zeros((m + 1, n + 1), dtype=np.int8)        # 1 diagonal, 2 up, 3 left, 0 start
    ar = np.arange(n + 1) * GAP
    for i in range(1, m + 1):
        diag = H[i - 1, :-1] + S[i - 1]
        up = H[i - 1, 1:] - GAP
        F = np.maximum(0, np.maximum(diag, up))
        ptr = np.where(F == 0, 0, np.where(diag >= up, 1, 2))
        Fp = np.concatenate([[0.0], F])
        acc = np.maximum.accumulate(Fp + ar) - ar      # a run of gaps from the left
        H[i] = acc
        P[i, 1:] = np.where(acc[1:] > Fp[1:], 3, ptr)
    i, j = np.unravel_index(np.argmax(H), H.shape)
    best, pairs = H[i, j], []
    while i > 0 and j > 0 and P[i, j]:
        p = P[i, j]
        if p == 1:
            if S[i - 1, j - 1] > 0:
                pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif p == 2:
            i -= 1
        else:
            j -= 1
    return float(best), pairs[::-1]


def split(boxes: list[int], texts: list[str]) -> list[list[int]]:
    """Boxes (in order) shared out in order among words, each word at least one box, so that each word's glyphs
    differ least from its boxes' glyphs read together."""
    m, n = len(boxes), len(texts)
    read = lambda g: "".join(split.xml[x][0] for x in g)
    best = {(0, 0): (0, [])}
    for i in range(n):
        nxt = {}
        for (ii, p), (c, gs) in best.items():
            for q in range(p + 1, m - (n - i - 1) + 1):
                g = boxes[p:q]
                cc = c + Levenshtein.distance(texts[i], read(g))
                if (i + 1, q) not in nxt or cc < nxt[(i + 1, q)][0]:
                    nxt[(i + 1, q)] = (cc, gs + [g])
        best = nxt
    return best[(n, m)][1]


def match(xml: list[tuple], loci) -> tuple[dict, list]:
    """xml: voynichese.com's words as (text, cx, cy, height). Returns {(locus, token): xml index} and the tokens by locus."""
    toks = tokens(loci)
    split.xml = xml
    flat = [(k, j) for k, ts in enumerate(toks) for j in range(len(ts))]
    row = {kj: n for n, kj in enumerate(flat)}
    S = scores([toks[k][j]["text"] for k, j in flat], [w[0] for w in xml])
    used = np.zeros(len(xml), bool)
    got: dict[tuple, int] = {}
    how: dict[tuple, tuple] = {}        # how each word was placed, for looking into a page (match.how)
    centre = lambda xi: np.mean([xml[x][1:3] for x in xi], 0) if isinstance(xi, tuple) else np.array(xml[xi][1:3])

    def expect(k, j, own=False):
        """Where word j of line k should be, and how far from there a box may be: between its line's nearest placed
        words before and after it (a ring's centre is not near its words), else beside one of them, else (unless own)
        near the neighbouring lines."""
        mine = sorted((jj, x) for (kk, jj), x in got.items() if kk == k)
        before = [x for jj, x in mine if jj < j]
        after = [x for jj, x in mine if jj > j]
        if before and after:
            a, b = centre(before[-1]), centre(after[0])
            return (a + b) / 2, np.linalg.norm(b - a) / 2 + REACH
        if before or after:
            return centre((before or after)[-1 if before else 0]), 2 * REACH
        if own:
            return None, None
        for d in range(1, 4):
            ns = [centre(x) for (kk, _j), x in got.items() if kk in (k - d, k + d)]
            if ns:
                return np.mean(ns, 0), FAR_AWAY
        return None, None

    hmed = float(np.median([w[3] for w in xml])) if xml and len(xml[0]) > 3 else 30.0

    def steady(pairs, cols):
        """A run's longest stretch whose next-door words sit near each other on the page: a run that jumps across the
        page (two words listed together, written apart) is cut at the jump, and the rest found again on its own."""
        if len(pairs) < 2:
            return pairs
        segs, cur = [], [pairs[0]]
        for p0, p1 in zip(pairs, pairs[1:]):
            gap_words = p1[0] - p0[0]
            if np.linalg.norm(centre(cols[p1[1]]) - centre(cols[p0[1]])) > JUMP * hmed * gap_words:
                segs.append(cur); cur = []
            cur.append(p1)
        segs.append(cur)
        return max(segs, key=len)

    # 1. runs, the most convincing first: within a line, or along a list of one-word labels written one after another
    #    (a column of single letters), which voynichese.com lists in the same order
    groups = [[(k, j) for j in range(len(ts))] for k, ts in enumerate(toks)]
    k = 0
    while k < len(loci):
        e = k
        while e < len(loci) and len(toks[e]) == 1 and loci[e]["t"][0] == "L":
            e += 1
        if e - k >= 3:
            groups.append([(kk, 0) for kk in range(k, e)])
        k = max(e, k + 1)
    while True:
        cols = np.where(~used)[0]
        if not len(cols):
            break
        best = None
        for group in groups:
            rows = [kj for kj in group if kj not in got]
            if not rows:
                continue
            sub = S[[row[kj] for kj in rows]][:, cols]
            sc, pairs = sw(sub)
            pairs = steady(pairs, cols)
            sc = float(sum(sub[a, b] for a, b in pairs)) - GAP * max(0, (pairs[-1][1] - pairs[0][1]) - (len(pairs) - 1)) if pairs else 0
            # one word alone is convincing only if its glyphs are exact, no other unused box reads the same, and it
            # sits where the rest of its line, if any of it is placed, says it should
            if len(pairs) == 1:
                a, b = pairs[0]
                if sub[a, b] < EXACT or (sub[a] == EXACT).sum() > 1:
                    continue
                here, reach = expect(*rows[a], own=True)
                if here is not None and np.linalg.norm(centre(cols[b]) - here) > reach:
                    continue
            if pairs and (best is None or sc > best[0]):
                best = (sc, [(rows[a], cols[b]) for a, b in pairs])
        if best is None or best[0] < EXACT:
            break
        for kj, x in best[1]:
            got[kj] = x
            used[x] = True
            how[kj] = ("run", round(best[0], 1), len(best[1]))

    # 2. words between two placed words of their line take the boxes voynichese.com lists between those two, when
    #    nothing else has them and they lie where the line runs: a box each, or a few boxes together where it splits a
    #    word the transcriptions keep whole (grouped so the glyphs agree best)
    for k, ts in enumerate(toks):
        mine = sorted((j, x) for (kk, j), x in got.items() if kk == k)
        for (j0, x0), (j1, x1) in zip(mine, mine[1:]):
            n, free = j1 - j0 - 1, list(range(x0 + 1, x1))
            if not n or not free or len(free) < n or len(free) > n + 3 or used[free].any():
                continue
            a, b = centre(x0), centre(x1)
            if any(np.linalg.norm(centre(x) - (a + b) / 2) > np.linalg.norm(b - a) / 2 + REACH for x in free):
                continue
            groups = split(free, [ts[j]["text"] for j in range(j0 + 1, j1)])
            for j, g in zip(range(j0 + 1, j1), groups):
                got[(k, j)] = g[0] if len(g) == 1 else tuple(g)
                used[g] = True
                how[(k, j)] = ("between", len(free), n)

    # 3. the rest, one by one: the best text match, the nearest when there is a choice
    while True:
        cand = []
        for k, ts in enumerate(toks):
            for j in range(len(ts)):
                if (k, j) in got:
                    continue
                s = S[row[(k, j)]].copy()
                s[used] = -9
                top = s.max() if len(s) else -9
                if top < CLOSE:
                    continue
                xs = np.where(s == top)[0]
                here, reach = expect(k, j)
                if here is not None:
                    xi = min(xs, key=lambda x: np.linalg.norm(centre(x) - here))
                    dist = np.linalg.norm(centre(xi) - here)
                    if dist > reach:   # never a box away from where its line runs
                        continue
                else:
                    xi, dist = xs[0], 1e6
                cand.append((-top, dist, k, j, xi))
        if not cand:
            break
        _t, _d, k, j, xi = min(cand)
        got[(k, j)] = xi
        used[xi] = True
        how[(k, j)] = ("one", -_t, round(_d))
    match.how = how
    match.quality = {"exact": int(sum(not isinstance(x, tuple) and S[row[kj], x] == EXACT for kj, x in got.items())),
                     "matched": len(got)}
    return got, toks
