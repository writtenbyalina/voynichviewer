#!/usr/bin/env python3
"""Readings made from the photographs by Claude, beside RF1b: called by rf.py after the shapes; run alone to check it.

  python3 tools/text/read_photo.py        # writes data/text/rf/read/<page>.json and pages.json

The Rosettes foldout (fRos) is where the published transcriptions are thinnest. In October 2026 Claude (Anthropic's
model) read every word of it whose place is known from Yale's full-size photograph: each word cut out along its
outline, turned to read left to right, and read in Eva from the shapes alone, without being shown any transcription,
with a confidence and a note. The readings are kept in tools/text/read/<page>.jsonl, one per line:

  {"locus": "fRos.2", "word": 1, "eva": "otol", "confidence": "high" | "medium" | "low", "note": "..."}

("eva" is empty where the reader found no writing at the word's place, and has a space where the place held two words:
either way the place is wrong, and its box is marked approximate in the shapes.) They are an independent witness, not checked by a person, and never replace RF1b.
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SRC = HERE / "read"
OUT = ROOT / "data" / "text" / "rf" / "read"
SHAPES = ROOT / "data" / "text" / "rf" / "shapes"
ABOUT = ("Claude (Anthropic's AI model) read this word from Yale's photograph in October 2026, from the shapes alone, "
         "without being shown any transcription. It is an independent reading, not checked by a person; where it "
         "differs from RF1b, RF1b is the scholars' reading.")


def build() -> dict:
    """the readings, page by page, as the site loads them; and the shapes of words with no writing marked approximate"""
    text = json.loads((ROOT / "data" / "text" / "rf" / "text.json").read_text())
    li_of = {page: {r[0]: i for i, r in enumerate(rows)} for page, rows in text["pages"]}
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    pages, counts = [], {}
    for f in sorted(SRC.glob("*.jsonl")):
        page = f.stem
        words, empty = [], set()
        for line in f.read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            li = li_of[page][r["locus"]]
            words.append([li, r["word"], r["eva"], r["confidence"], r.get("note", "")])
            if not r["eva"] or " " in r["eva"]:               # no writing there, or two words: the box is wrong
                empty.add((li, r["word"]))
        words.sort()
        (OUT / f"{page}.json").write_text(json.dumps({"page": page, "by": "Claude (Anthropic)", "about": ABOUT,
                                                      "words": words}, separators=(",", ":"), ensure_ascii=False) + "\n")
        pages.append(page)
        sf = SHAPES / f"{page}.json"
        if sf.exists() and empty:                               # no writing where the outline is: not to be trusted
            d = json.loads(sf.read_text())
            for row in d["words"]:
                if (row[0], row[1]) in empty:
                    row[-1] = 1
            sf.write_text(json.dumps(d, separators=(",", ":")) + "\n")
        counts[page] = (len(words), len(empty))
    (OUT / "pages.json").write_text(json.dumps(pages) + "\n")
    return counts


if __name__ == "__main__":
    for page, (n, e) in build().items():
        print(f"{page}: {n} words read from the photograph, {e} places with no writing")
