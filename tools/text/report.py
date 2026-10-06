#!/usr/bin/env python3
"""Compare the consensus (data/text) with voynichese.com's text (VT0e), Zandbergen's RF1 and each full transcription.

  python3 tools/text/report.py        # after build.py; writes docs/text/report.md and docs/text/report-pages.csv

Everything is compared at the same grain, Zandbergen's nearest basic Eva, from the STA files: a word "differs" when
the glyphs between two word breaks differ, or when the breaks fall in different places. A consensus uncertain space
(',') is counted both ways where it matters, and said so. Examples are taken from a fixed sample of pages.
"""
from __future__ import annotations

import collections
import csv
import difflib
import json
import re
from pathlib import Path

import sta
from corpus import Corpus

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DATA = ROOT / "data" / "text"
DOCS = ROOT / "docs" / "text"


def words(line: str, unc_as_space=True) -> list[str]:
    line = line.replace(",", "." if unc_as_space else "")
    return [w for w in line.split(".") if w]


def edits(a: list[str], b: list[str]):
    """Word-level differences between a (the consensus) and b: (kind, a words, b words) for each changed stretch."""
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        A, B = a[i1:i2], b[j1:j2]
        if "".join(A) == "".join(B):
            kind = "split" if len(B) > len(A) else "joined" if len(B) < len(A) else "rebroken"
        elif not A:
            kind = "extra"
        elif not B:
            kind = "missing"
        else:
            kind = "glyphs"
        out.append((kind, A, B))
    return out


def bare(line: str) -> str:
    """Glyphs only: no spaces, and an Extended Eva @nnn; as one character."""
    return re.sub(r"@\d{3};", "@", line).replace(".", "").replace(",", "")


def glyph_agreement(a: str, b: str) -> tuple[int, int]:
    """Matching glyph count and length, spaces ignored."""
    x, y = a.replace(".", "").replace(",", ""), b.replace(".", "").replace(",", "")
    m = sum(bl.size for bl in difflib.SequenceMatcher(a=x, b=y, autojunk=False).get_matching_blocks())
    return m, max(len(x), len(y))


def section_of():
    codex = json.loads((ROOT / "data" / "codex.json").read_text())
    out = {}
    for sh in codex["sheets"]:
        for side in ("inside", "outside"):
            for row in sh.get(side, []):
                for seg in row:
                    if seg.get("page") and not seg.get("missing"):
                        out.setdefault(seg["page"], seg.get("section") or "?")
    return out


def compare(cons: dict, other: dict, name: str):
    """cons, other: {locus id: basic Eva line}. Returns totals and per-page rows."""
    t = collections.Counter()
    kinds, pairs = collections.Counter(), collections.Counter()
    per_page = collections.defaultdict(collections.Counter)
    examples = []
    for lid, c in cons.items():
        page = lid.rsplit(".", 1)[0]
        cw = words(c)
        t["cons_words"] += len(cw)
        if lid not in other or not other[lid]:
            t["loci_missing"] += 1
            t["words_in_missing_loci"] += len(cw)
            per_page[page]["missing_words"] += len(cw)
            continue
        o = other[lid]
        ow = words(o)
        t["loci"] += 1
        t["lines_identical"] += words(c) == ow
        t["lines_identical_unc_joined"] += words(c, False) == ow
        m, n = glyph_agreement(bare(c), bare(o))
        t["glyphs_match"] += m
        t["glyphs"] += n
        ed = edits(cw, ow)
        changed = sum(len(A) for _, A, _ in ed)
        t["words_differ_unc_joined"] += sum(len(A) for _, A, _ in edits(words(c, False), words(o, False)))
        t["words_compared_unc_joined"] += len(words(c, False))
        t["lines_glyph_identical"] += bare(c) == bare(o)
        t["words_compared"] += len(cw)
        t["words_differ"] += changed
        per_page[page]["words"] += len(cw)
        per_page[page]["differ"] += changed
        for kind, A, B in ed:
            if kind == "glyphs" and "@22" in " ".join(B):
                kind = "inbetween"
            kinds[kind] += max(len(A), 1)
            if kind == "glyphs" and len(A) == 1 and len(B) == 1:
                pairs[(B[0], A[0])] += 1
            if len(examples) < 4000:
                examples.append((lid, kind, " ".join(A), " ".join(B)))
        # doubtful gaps the other shows as plain space or no space
        t["unc_gaps"] += c.count(",")
    return t, kinds, pairs, per_page, examples


def main():
    sta.learn_rare_eva()
    index = json.loads((DATA / "index.json").read_text())["loci"]
    order = [row[0] for row in index]
    idx = {row[0]: row[2] for row in index}
    meta = json.loads((DATA / "meta.json").read_text())
    lines = {f.stem: dict(zip(order, json.loads(f.read_text())["lines"])) for f in (DATA / "w").glob("*.json")}
    sections = section_of()
    C = Corpus()
    rf_inbetween = {lid for lid in order
                    if (p := lid.rsplit(".", 1)) and (p[0], int(p[1])) in C.sta["RF"]
                    and re.search(r"A[ab]", C.sta["RF"][(p[0], int(p[1]))].text)}
    from vote import shown
    rf = {}
    for lid in order:
        p, num = lid.rsplit(".", 1)
        if (p, int(num)) in C.sta["RF"]:
            out = []
            for kind, v in sta.tokenize(C.sta["RF"][(p, int(num))].text):
                out.append(("." if v == "-" else v) if kind == "s" else shown(v[0]))
            rf[lid] = re.sub(r"[.,]+(?=[.,])", "", "".join(out)).strip(".,")
    lines["RF"] = rf
    res = {n: compare(idx, lines[n], n) for n in ("VT", "RF", "ZL", "GC", "IT")}
    split = Path("~/voynich/data/SPLIT.json").expanduser()
    dev = set(p for p, v in json.loads(split.read_text())["assignment"].items() if v == "DEV") if split.exists() else None
    # examples from a fixed sample of pages (every page whose number ends in 1 or 6): enough to read, not a split
    sample = lambda lid: re.match(r"f\d*[16][rv]", lid) is not None and (dev is None or lid.rsplit(".", 1)[0] in dev)
    md = []
    pct = lambda a, b: f"{100 * a / b:.1f}%" if b else "-"
    t0 = res["VT"][0]
    md.append("# Text data: the consensus against voynichese.com and RF1\n")
    md.append(f"Built by `tools/text/build.py` (method {meta['method']}) from the pinned inputs in "
              "`tools/text/inputs.json`. Everything is compared at Zandbergen's nearest-basic-Eva grain, from his STA "
              "files. A word differs when its glyphs differ or its word breaks fall elsewhere. Unless said otherwise, "
              "the consensus's uncertain spaces count as spaces.\n")
    md.append("**These are differences, not errors.** Which reading is right is for the gold set (docs/TEXT.md 8.1) to "
              "show, against the photographs. What this report can say is how far each source is from the consensus, "
              "where, and in which direction.\n")
    md.append("## What was built\n")
    md.append(f"- **{meta['loci']:,} loci** on {meta['pages']} pages: every locus in ZL, the Rosettes included.")
    v = meta["voters_per_locus"]
    md.append("- **Voters per locus**: " + ", ".join(f"{k}: {n:,}" for k, n in v.items()) + ".")
    cols = meta["columns"]
    tot = sum(cols.values())
    md.append("- **Columns**: " + ", ".join(f"{k} {n:,} ({pct(n, tot)})" for k, n in sorted(cols.items(), key=lambda x: -x[1])) + ".")
    gaps = meta["gaps"]
    gt = sum(gaps.values())
    md.append("- **Gaps between columns**: " + ", ".join(f"{k} {n:,} ({pct(n, gt)})" for k, n in sorted(gaps.items(), key=lambda x: -x[1])) + ".")
    md.append("- **Voters**: " + "; ".join(f"{x['code']} {x['name']} ({x['loci']:,} loci)" for x in meta["voters"]) + ".")
    cons_words = res["VT"][0]["cons_words"]
    md.append(f"- **Words in the consensus**: {cons_words:,} with uncertain spaces as spaces, "
              f"{sum(len(words(c, False)) for c in idx.values()):,} without, about "
              f"{round((cons_words + sum(len(words(c, False)) for c in idx.values())) / 2):,} counting them half.\n")
    md.append("## Against every transcription\n")
    md.append("| | voynichese.com (VT0e) | RF1 | ZL | GC | IT |")
    md.append("|---|---|---|---|---|---|")
    def row(label, f):
        md.append(f"| {label} | " + " | ".join(f(res[n][0]) for n in ("VT", "RF", "ZL", "GC", "IT")) + " |")
    row("loci it lacks", lambda t: f"{t['loci_missing']:,}")
    row("lines identical", lambda t: pct(t["lines_identical"], t["loci"]))
    row("words that differ", lambda t: f"{t['words_differ']:,} ({pct(t['words_differ'], t['words_compared'])})")
    row("… if uncertain spaces are no space", lambda t: f"{t['words_differ_unc_joined']:,} ({pct(t['words_differ_unc_joined'], t['words_compared_unc_joined'])})")
    row("lines with the same glyphs, spaces aside", lambda t: pct(t["lines_glyph_identical"], t["loci"]))
    row("glyphs that match, spaces aside", lambda t: pct(t["glyphs_match"], t["glyphs"]))
    md.append("")
    md.append("The consensus is closest to ZL, as it should be: ZL covers everything and is one of the most careful "
              "voters. It is no transcription's copy: every one of them differs from it somewhere.\n")
    for n, title in (("VT", "voynichese.com (VT0e)"), ("RF", "RF1")):
        t, kinds, pairs, per_page, ex = res[n]
        md.append(f"## {title}\n")
        md.append(f"- It lacks **{t['loci_missing']:,} loci** ({t['words_in_missing_loci']:,} consensus words)." +
                  (" " + ", ".join(sorted({lid.rsplit('.', 1)[0] for lid in idx if lid not in lines[n] or not lines[n][lid]}))
                   if t["loci_missing"] else ""))
        md.append(f"- On the {t['loci']:,} loci it has, **{t['words_differ']:,} of {t['words_compared']:,} words differ "
                  f"({pct(t['words_differ'], t['words_compared'])})**, and {pct(t['lines_identical'], t['loci'])} of "
                  f"lines are identical ({pct(t['lines_identical_unc_joined'], t['loci'])} if uncertain spaces are "
                  "read as no space).")
        md.append("- **What kind of difference**, in consensus words:")
        labels = {"glyphs": "different glyphs", "split": f"{title} breaks a consensus word in two or more",
                  "joined": f"{title} joins consensus words", "rebroken": "same glyphs, breaks moved",
                  "missing": f"{title} has nothing for it", "extra": f"{title} has words the consensus lacks",
                  "inbetween": "RF1 writes v101's in-between glyph (@221; or @222;), where the consensus says a, o or y"}
        for k, c in kinds.most_common():
            md.append(f"  - {labels[k]}: {c:,}")
        md.append(f"- **Commonest glyph differences** ({title} reads → consensus reads):")
        md.append("  " + ", ".join(f"`{a}`→`{b}` {c}" for (a, b), c in pairs.most_common(14)))
        secs = collections.defaultdict(collections.Counter)
        for page, c in per_page.items():
            secs[sections.get(page, "?")].update(c)
        md.append(f"- **By section** (Davis), words that differ: " + "; ".join(
            f"{s} {pct(c['differ'], c['words'])}" for s, c in sorted(secs.items(), key=lambda x: -x[1]['words']) if c["words"]))
        exs = [e for e in ex if sample(e[0])]
        picked, per_kind, pages_seen = [], collections.Counter(), set()
        for lid, kind, A, B in exs:
            page = lid.rsplit(".", 1)[0]
            if per_kind[kind] >= 2 or page in pages_seen:
                continue
            per_kind[kind] += 1
            pages_seen.add(page)
            picked.append(f"  - `{lid}` {kind}: consensus `{A or '∅'}`, {title} `{B or '∅'}`")
        md.append("- **Examples**:")
        md += picked[:12]
        md.append("")
    md.append("## Checks against published numbers\n")
    zi = compare({k: v for k, v in lines["ZL"].items() if v}, lines["IT"], "IT")[0]
    md.append(f"- ZL against IT. The research repo's exp01 measured 97.86% of glyphs agreeing, 61.03% of lines with "
              f"the same glyphs (spaces aside) and 86% of word tokens matching. Here, at STA grain: "
              f"{pct(zi['glyphs_match'], zi['glyphs'])} of glyphs, {pct(zi['lines_glyph_identical'], zi['loci'])} of "
              f"lines with the same glyphs, {pct(zi['words_compared'] - zi['words_differ'], zi['words_compared'])} of "
              f"ZL's words (its uncertain spaces as spaces). Counting word breaks too, only "
              f"{pct(zi['lines_identical'], zi['loci'])} of lines are identical.")
    types = collections.Counter(row[1][0] for row in index)
    md.append("- Loci by type (Zandbergen: P 4,130, L 1,029, C 84, R 142): " +
              ", ".join(f"{k} {v:,}" for k, v in sorted(types.items())) + ".")
    md.append("- Word tokens: about 38,000 expected; see 'Words in the consensus' above.")
    single = [lid for lid in order if len(json.loads((DATA / "pages" / f"{lid.rsplit('.', 1)[0]}.json").read_text())["loci"][0]["w"]) == 0]
    ones = []
    for page in dict.fromkeys(lid.rsplit(".", 1)[0] for lid in order):
        for loc in json.loads((DATA / "pages" / f"{page}.json").read_text())["loci"]:
            if len(loc["w"]) == 1:
                ones.append(loc["id"])
    md.append(f"- Loci only ZL covers: {', '.join(ones)}.\n")
    (DOCS / "report.md").write_text("\n".join(md) + "\n")
    with open(DOCS / "report-pages.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["page", "section", "consensus words", "differ from VT0e", "missing in VT0e", "differ from RF1"])
        for page in dict.fromkeys(lid.rsplit(".", 1)[0] for lid in order):
            v, r = res["VT"][3][page], res["RF"][3][page]
            w.writerow([page, sections.get(page, ""), v["words"] + v["missing_words"], v["differ"], v["missing_words"], r["differ"]])
    print("docs/text/report.md, docs/text/report-pages.csv")


if __name__ == "__main__":
    main()
