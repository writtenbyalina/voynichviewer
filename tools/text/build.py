#!/usr/bin/env python3
"""Build Text's data from the transliterations: the consensus of every locus, with every reading kept.

  python3 tools/text/fetch.py          # once: the pinned inputs, into tools/text/cache
  python3 tools/text/build.py          # writes data/text/{meta,index,witnesses}.json and data/text/pages/*.json

The method is docs/TEXT.md section 3; the steps are in align.py and vote.py, the costs in costs.json (costs.py). Per
page, each locus holds:
  id, t, loc     IVTFF locus ("f1r.2"), locus type ("P0", "Lp", "Cc", "Ri"...), locator (@ first, * new paragraph, ...)
  ps, pe         paragraph starts / ends here (<%>, <$> in ZL)
  c              the consensus in Eva, with IVTFF's '.' (space) and ',' (uncertain space)
  g              the same glyphs as STA codes, for the glyph font (data/text/glyphs.json)
  w              the voters that cover this locus, in the order ties follow
  u              columns that are not unanimous: [offset in c, length, status, [[reading, votes, "voters"], ...],
                 {reference: reading}]; status u(nanimous, kept for a reference that differs), m(ajority),
                 p(lurality), t(ie), s(ingle voter), n(one); votes 0 = present but not voting (unreadable, in-between)
  s              gaps that are not unanimous: [offset in c, status, "ZL,GC.IT0..."]: each voter's and reference's own
                 mark, '.' space, ',' uncertain, '-' drawing break, '0' none; status a(ll), m(ost), u(ncertain),
                 d(oubted), f(ew), n(one)
  r              every witness's line as written, in its own alphabet
index.json lists every locus as [id, type, consensus, paragraph starts here (1/0)]; w/<witness>.json holds that
witness's lines in basic Eva, in the index's order ("" where it has none), for Search's "every transcriber".
"""
from __future__ import annotations

import collections
import json
import re
from pathlib import Path

import align
import sta
import vote
from corpus import ALPHABET, NAMES, Corpus

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / "data" / "text"
METHOD = "1"


def eva_line(text: str) -> str:
    """A witness's STA line as basic Eva with '.' and ',' (first option of an alternative), for searching it."""
    out = []
    for kind, v in sta.tokenize(text):
        out.append(("." if v == "-" else v) if kind == "s" else "".join(sta.eva(c) for c in v[0]))
    return re.sub(r"[.,]+(?=[.,])", "", "".join(out)).strip(".,")


def main():
    align.load_costs(HERE / "costs.json")
    C = Corpus()
    pages = collections.OrderedDict()
    index, stats, cover = [], collections.Counter(), collections.Counter()
    wit_lines = collections.defaultdict(dict)
    for key in C.keys():
        zl = C.zl[key]
        wits = C.witnesses(key)
        r = vote.locus(wits)
        ps, pe = sta.para_marks(C.zln[key].text if key in C.zln else zl.text)
        loc = {"id": zl.id, "t": zl.type, "loc": zl.loc, "ps": ps, "pe": pe, "c": r["c"], "g": r["g"], "w": r["w"],
               "u": r["u"], "s": r["s"], "r": C.own_lines(key)}
        pages.setdefault(key[0], []).append(loc)
        index.append([zl.id, zl.type, r["c"], int(ps)])
        stats.update(r["stats"])
        cover[len(r["w"])] += 1
        for n, t in wits.items():
            wit_lines[n][zl.id] = eva_line(t)
    (OUT / "pages").mkdir(parents=True, exist_ok=True)
    for old in (OUT / "pages").glob("*.json"):
        old.unlink()
    for page, loci in pages.items():
        (OUT / "pages" / f"{page}.json").write_text(
            json.dumps({"page": page, "vars": C.pages.get(page, {}), "loci": loci}, ensure_ascii=False,
                       separators=(",", ":")) + "\n")
    ids = [i for i, *_ in index]
    (OUT / "index.json").write_text(json.dumps({"method": METHOD, "loci": index}, ensure_ascii=False,
                                               separators=(",", ":")) + "\n")
    (OUT / "w").mkdir(exist_ok=True)
    for old in (OUT / "w").glob("*.json"):
        old.unlink()
    for n, lines in sorted(wit_lines.items()):       # one file per witness, so Search loads only those it needs
        (OUT / "w" / f"{n}.json").write_text(json.dumps({"method": METHOD, "witness": n, "lines": [lines.get(i, "") for i in ids]},
                                                        ensure_ascii=False, separators=(",", ":")) + "\n")
    old = OUT / "witnesses.json"
    if old.exists():
        old.unlink()
    inputs = json.loads((HERE / "inputs.json").read_text())["files"]
    costs = json.loads((HERE / "costs.json").read_text())
    coverage = {n: len(v) for n, v in wit_lines.items()}
    meta = {
        "method": METHOD,
        "about": "The consensus of independent transcriptions of the Voynich Manuscript, built by tools/text/build.py; "
                 "the method is docs/TEXT.md section 3.",
        "credit": "Transcriptions by René Zandbergen and Gabriel Landini, Glen Claston, Takeshi Takahashi, the First "
                  "Study Group (William Friedman), Prescott Currier and Mary D'Imperio, Jorge Stolfi, John Grove, John "
                  "Tiltman, Don Latham, Karl Kluge (from Theodore Petersen's copy), Mike Roe and Denis Mardle, from René "
                  "Zandbergen's voynich.nu (CC0) and the Landini-Stolfi interlinear.",
        "voters": [{"code": n, "name": NAMES[n], "alphabet": ALPHABET.get(n, "Eva"), "loci": coverage.get(n, 0)}
                   for n in vote.ORDER],
        "references": [{"code": n, "name": NAMES[n], "loci": coverage.get(n, 0)} for n in vote.REFERENCE],
        "loci": len(index), "pages": len(pages),
        "lines": {page: len(loci) for page, loci in pages.items()},   # the pages with text, so nothing asks for one without
        "voters_per_locus": {str(k): v for k, v in sorted(cover.items())},
        "columns": {k.split(".")[1]: v for k, v in sorted(stats.items()) if k.startswith("glyph.")},
        "gaps": {k.split(".")[1]: v for k, v in sorted(stats.items()) if k.startswith("gap.")},
        "rare_eva": dict(sorted(sta.RARE_EVA.items())),
        "costs_fit_on": costs["fit_on"],
        "inputs": [{"name": f["name"], "sha256": f["sha256"], "url": f["url"]} for f in inputs],
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(index)} loci on {len(pages)} pages; columns {meta['columns']}; gaps {meta['gaps']}")


if __name__ == "__main__":
    main()
