"""The vote: one person, one vote, glyph by glyph and gap by gap (docs/TEXT.md 3.2, steps 5 to 7).

Glyphs. Each voter's reading of a column counts 1, split equally over their own alternatives ([a:o] gives a and o half
each). An unreadable mark, an illegible symbol or a skipped stretch is present but does not vote; so does one of
v101's in-between glyphs (it says "a circle-type glyph", not which). Statuses: unanimous (one reading, at least two
voters), majority (more than half the votes), plurality (most votes, not more than half), tie, single (one voter) and
none (nobody could read it). A tie shows the tied reading of the first voter in ORDER (the one that covers most of
the manuscript) and stays marked as a tie.

Gaps. A space or a drawing break counts 1, an uncertain space ',' a half, no space 0, among the voters with glyphs on
both sides. s is their mean: all (s = 1) and most (s >= 2/3) write a space; uncertain (1/3 < s < 2/3, or two or more
people wrote ',') writes ','; doubted (one person wrote ','), few (someone wrote a space) and none write nothing.
A gap at exactly s = 1/2 stays uncertain: it is never resolved.
"""
from __future__ import annotations

import collections
import itertools

import align
import sta

ORDER = ["ZL", "GC", "IT", "FG", "CD", "LU", "LV", "LT", "LL", "LP", "LR", "LX"]
VOTERS = set(ORDER)
REFERENCE = ["RF", "VT"]
SPACE = {".": 1.0, "-": 1.0, ",": 0.5, "": 0.0}
IN_BETWEEN = {"Aa": "@221;", "Ab": "@222;"}     # how RF1 writes v101's in-between glyphs


def shown(codes: tuple) -> str:
    """A witness's own reading of a column, in Eva (rare and in-between glyphs as Extended Eva)."""
    return "".join(IN_BETWEEN.get(c) or sta.eva(c) for c in codes)


def readings(w: align.Wit, idxs: list[int]):
    """(key, weight, codes) for each way the witness reads these slots; key None where it does not vote."""
    if not idxs:
        return [((), 1.0, ())]
    combos = list(itertools.product(*[w.glyphs[i] for i in idxs]))
    out = []
    for c in combos:
        codes = tuple(x for o in c for x in o)
        if any(sta.votes_nothing(x) or x in sta.FAMILY_ONLY for x in codes):
            out.append((None, 1 / len(combos), codes))
        else:
            out.append((tuple(sta.key(x) for x in codes), 1 / len(combos), codes))
    return out


def marks_str(marks: dict) -> str:
    """Each transcriber's mark at a gap, as stored: ZL.GC,IT0 (a space, an uncertain space, none)."""
    return "".join(f"{n}{marks[n] or '0'}" for n in ORDER + REFERENCE if n in marks)


def gap_status(s: float, marks: int) -> str:
    if s == 1:
        return "all"
    if s >= 2 / 3:
        return "most"
    if s > 1 / 3 or marks >= 2:
        return "unc"
    return "doubt" if marks else ("few" if s > 0 else "none")


SEPARATOR = {"all": ".", "most": ".", "unc": ",", "doubt": "", "few": "", "none": ""}


def locus(witnesses: dict[str, str]) -> dict:
    """The consensus of one locus from {witness code: STA text}. ZL must be among them."""
    wits = {n: align.Wit(n, t) for n, t in witnesses.items()}
    anchor = wits["ZL"]
    cols = align.units(anchor, [w for n, w in wits.items() if n != "ZL"])
    voters = [n for n in ORDER if n in wits]
    last = {n: None for n in wits}
    raw_units = []
    for col in cols:
        # the gap before this column
        marks = {}
        for n, idxs in col.items():
            if idxs and last[n] is not None and idxs[0] == last[n] + 1:
                w = wits[n]
                if sta.SKIPPED in w.glyphs[last[n]][0] or sta.SKIPPED in w.glyphs[idxs[0]][0]:
                    continue
                marks[n] = w.space[idxs[0]]
        tally, who, codes_of, abstain = collections.Counter(), collections.defaultdict(list), {}, []
        present = []
        for n in voters:
            if n not in col:
                continue
            present.append(n)
            for k, wt, codes in readings(wits[n], col[n]):
                if k is None:
                    abstain.append((n, codes))
                    continue
                tally[k] += wt
                who[k].append((n, round(wt, 2), codes))
                codes_of.setdefault(k, codes)
        refs = {n: shown(tuple(c for i in col.get(n, []) for c in wits[n].glyphs[i][0])) for n in REFERENCE if n in col}
        raw_units.append((marks, tally, who, codes_of, abstain, refs))
        for n, idxs in col.items():
            if idxs:
                last[n] = idxs[-1]
    # columns -> the consensus text, dropping columns that most read as nothing
    c, g, units, gaps, stats = "", "", [], [], collections.Counter()
    pend = None
    seen = {}       # each transcriber's mark at the gap after their last glyph, across columns the consensus leaves out
    for marks, tally, who, codes_of, abstain, refs in raw_units:
        vmarks = {n: v for n, v in marks.items() if n in VOTERS}
        before = dict(marks)
        seen.update(marks)
        if vmarks:
            s = sum(SPACE[v] for v in vmarks.values()) / len(vmarks)
            if pend is None or s > pend[0]:
                pend = (s, marks)
        if not tally:
            pick, status = None, "none"
        else:
            total, best = sum(tally.values()), max(tally.values())
            tops = [k for k, v in tally.items() if v == best]
            voted = {n for k in tally for (n, _, _) in who[k]}
            if len(tops) > 1:
                pick = next(k for n in ORDER for k in tops if any(x[0] == n for x in who[k]))
                status = "tie"
            else:
                pick = tops[0]
                status = ("unan" if len(tally) == 1 and len(voted) > 1 else "single" if len(voted) == 1
                          else "maj" if best > total / 2 else "plur")
        rows = [[shown(codes_of[k]), round(v, 2), " ".join(n for n, _, _ in who[k])] for k, v in tally.most_common()]
        rows += [[shown(codes), 0, n] for n, codes in abstain]
        if pick == ():
            # Nothing wins here: the consensus writes nothing and the gap joins the next one. The column stays in the
            # record, zero wide, unless everyone read nothing: someone's extra glyph is a reading too.
            # (it keeps the gap before it too, from those who read something here; the gap after is the next one's)
            if status != "unan" or abstain or any(refs.values()):
                units.append([len(c), 0, status[0], rows, refs, marks_str(before)])
            if status in ("tie", "plur"):
                stats["glyph." + status] += 1
            continue
        if c and pend:
            s0, m0 = pend
            st = gap_status(s0, sum(1 for n, v in m0.items() if n in VOTERS and v == ","))
            stats["gap." + st] += 1
            sep = SEPARATOR[st]
            # the marks kept are each transcriber's own at this gap: after a glyph only they read, the one after it
            if st not in ("all", "none") or any(("." if v == "-" else v) != sep for v in seen.values()):
                gaps.append([len(c), st[0], marks_str(seen)])
            c += SEPARATOR[st]
            g += SEPARATOR[st]
        pend = None
        seen = {}
        stats["glyph." + status] += 1
        codes = codes_of.get(pick, ()) if pick is not None else ("Z1",)
        text = shown(codes) if pick is not None else "?"
        if status != "unan" or abstain or any(v != text for v in refs.values()):   # all agree, and nobody abstained
            units.append([len(c), len(text), status[0], rows] + ([refs] if refs else []))
        c += text
        g += "".join(codes)
    return {"c": c, "g": g, "u": units, "s": gaps, "w": voters, "stats": stats}
