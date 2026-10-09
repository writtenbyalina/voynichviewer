#!/usr/bin/env python3
"""Fit the aligner's costs for glyphs transcribers often confuse (costs.json), like a substitution matrix in BLAST.

Runs the vote on a fixed set of pages with the default costs, counts how often each pair of single glyphs stands
against each other in a column (a against o, r against s, ...), and gives the frequent pairs a lower cost, so that the
aligner sets them against each other rather than inserting and deleting. Pairs seen fewer than MIN times keep the
default costs (align.py). The set of pages is Alina's development set from her research protocol: it is read from the
file given and never written here; costs.json records only how many pages it had and the sha256 of their sorted
names.

  python3 tools/text/costs.py ~/voynich/data/SPLIT.json
"""
from __future__ import annotations

import collections
import hashlib
import json
import math
import sys
from pathlib import Path

import align
import vote
from corpus import Corpus

HERE = Path(__file__).resolve().parent
MIN = 10
LOW, HIGH = 0.15, 0.6


def main():
    split = json.loads(Path(sys.argv[1]).expanduser().read_text())["assignment"]
    pages = sorted(p for p, s in split.items() if s == "DEV")
    align.COSTS.clear()
    C = Corpus()
    pairs = collections.Counter()
    for key in C.keys():
        if key[0] not in split or split[key[0]] != "DEV":
            continue
        r = vote.locus(C.witnesses(key))
        for u in r["u"]:
            rows = [(t, w) for t, w, _ in u[3] if w > 0]
            if len(rows) < 2:
                continue
            top = rows[0][0]
            for t, w in rows[1:]:
                if len(top) <= 3 and len(t) <= 3 and top and t and top != t:
                    pairs[tuple(sorted((top, t)))] += w
    common = [(a, b, n) for (a, b), n in pairs.most_common() if n >= MIN and " " not in a + b]
    top = math.log(common[0][2])
    out = [[a, b, round(LOW + (HIGH - LOW) * (1 - math.log(n) / top), 3), round(n, 1)] for a, b, n in common]
    (HERE / "costs.json").write_text(json.dumps({
        "about": "Aligner costs for pairs of glyphs that transcribers often set against each other: [a, b, cost, "
                 "count]. Fitted by costs.py on a fixed set of pages, identified here only by size and hash.",
        "fit_on": {"pages": len(pages), "sha256": hashlib.sha256("\n".join(pages).encode()).hexdigest()},
        "pairs": out}, indent=0, ensure_ascii=False) + "\n")
    print(f"{len(out)} pairs from {len(pages)} pages; the commonest:", out[:8])


if __name__ == "__main__":
    main()
