#!/usr/bin/env python3
"""Count which glyphs stand next to each other inside words, for the font's kerning (`build_font.py`).

Reads the STA versions of the transcriptions that voynich.nu publishes (https://www.voynich.nu/data/sta/, CC0):
ZL3b, GC2a_0, IT2a and RF1b, from the folder given, and writes `pairs.json`: STA glyph pairs inside a word with their
counts, most frequent first, enough of them to cover 99.5% of all pairs. Spaces, uncertain spaces and drawing breaks
end a word; an alternative reading `[a:b]` counts its first option.

  python3 tools/font/count_pairs.py ~/voynich/sta     # the folder holding ZL3b.txt, GC2a_0.txt, IT2a.txt, RF1b.txt
"""
from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILES = ["ZL3b", "GC2a_0", "IT2a", "RF1b"]
CODE = re.compile(r"[A-Z][0-9a-z]")
COVER = 0.995


def words(text: str):
    text = re.sub(r"<->|<~>", ".", text)
    text = re.sub(r"<[^>]*>", "", text)
    text = re.sub(r"\[([^:\]]*)[^\]]*\]", r"\1", text)
    for w in re.split(r"[.,]", text):
        codes = CODE.findall(w)
        if codes:
            yield codes


def main():
    folder = Path(sys.argv[1]).expanduser()
    pairs = collections.Counter()
    for name in FILES:
        for line in (folder / f"{name}.txt").read_text(encoding="latin-1").splitlines():
            m = re.match(r"^<[^>]+\.\d+,[^>]*>\s*(.*)$", line)
            if m:
                for w in words(m.group(1)):
                    pairs.update(zip(w, w[1:]))
    total, kept, run = sum(pairs.values()), [], 0
    for (a, b), n in pairs.most_common():
        kept.append([a, b, n])
        run += n
        if run >= COVER * total:
            break
    (HERE / "pairs.json").write_text(json.dumps(kept, separators=(",", ":")) + "\n")
    print(f"{len(kept)} pairs cover {run / total:.1%} of {total:,} pairs inside words")


if __name__ == "__main__":
    main()
