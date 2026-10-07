"""Each transcriber's reading of a locus, rebuilt from the vote as the site rebuilds it (assets/text.js, readingOf).

The page files keep only the columns and gaps that are not everyone's, so a transcriber's reading is the consensus with
their own reading of every column and gap kept. Where a transcriber's line lines up with the others only roughly (a
line shifted, a long unreadable stretch), that rebuilt reading is not quite their line: build.py checks every one
against the line itself and keeps the line where they differ, so the site never puts words in anyone's mouth.
"""
from __future__ import annotations

import re

REFERENCE = ("RF", "VT")
MARK = re.compile(r"([A-Z]{2})([.,\-0])")


def marks(s: str) -> dict[str, str]:
    return {n: ("." if v == "-" else "" if v == "0" else v) for n, v in MARK.findall(s)}


def present(loc: dict, who: str) -> bool:
    return who in loc.get("r", {}) if who in REFERENCE else who in loc["w"]


def unit_reading(u: list, who: str, cons: str) -> str:
    if who in REFERENCE:
        refs = u[4] if len(u) > 4 else {}
        return refs.get(who, cons)
    rows = [r for r in u[3] if who in r[2].split(" ")]
    if not rows:
        return cons
    return rows[0][0] if len(rows) == 1 else "[" + ":".join(r[0] for r in rows) + "]"


def reading_of(loc: dict, who: str) -> str | None:
    """Their reading as one string of Eva with their own . and , (the consensus's breaks where they agree)."""
    if not present(loc, who):
        return None
    unit_at, empty_at, gap_at = {}, {}, {}
    for u in loc["u"]:
        if u[1]:
            unit_at[u[0]] = u
        else:
            empty_at.setdefault(u[0], []).append(u)
    for o, _st, m in loc["s"]:
        gap_at[o] = marks(m)

    def mark(o, d):
        g = gap_at.get(o)
        return g[who] if g is not None and who in g else d

    c, out, i = loc["c"], [], 0
    while i <= len(c):
        for u in empty_at.get(i, []):
            t = unit_reading(u, who, "")
            if t:
                b = marks(u[5]).get(who, "") if len(u) > 5 else ""
                out.append(b + t)
        if i == len(c):
            break
        ch = c[i]
        if ch in ".,":
            out.append(mark(i, ch))
            i += 1
            continue
        if i > 0 and c[i - 1] not in ".," and i in gap_at:
            out.append(mark(i, ""))
        u = unit_at.get(i)
        if u:
            out.append(unit_reading(u, who, c[i:i + u[1]]))
            i += u[1]
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def words_of(loc: dict, who: str) -> list[tuple[str, str]] | None:
    """Their reading word by word of the consensus, as assets/text.js readingOf gives it: for each consensus word
    (text, next), text with their own . and , inside it, next their mark at the break after it (. , or "")."""
    if not present(loc, who):
        return None
    unit_at, empty_at, gap_at = {}, {}, {}
    for u in loc["u"]:
        if u[1]:
            unit_at[u[0]] = u
        else:
            empty_at.setdefault(u[0], []).append(u)
    for o, _st, m in loc["s"]:
        gap_at[o] = marks(m)

    def mark(o, d):
        g = gap_at.get(o)
        return g[who] if g is not None and who in g else d

    c = loc["c"]
    out = [["", "."] for _ in c.split(".")]
    wi, i = 0, 0
    while i <= len(c):
        for u in empty_at.get(i, []):
            t = unit_reading(u, who, "")
            if t:
                out[wi][0] += (marks(u[5]).get(who, "") if len(u) > 5 else "") + t
        if i == len(c):
            break
        ch = c[i]
        if ch == ".":
            out[wi][1] = mark(i, ".")
            wi += 1
            i += 1
            continue
        if ch == ",":
            out[wi][0] += mark(i, ",")
            i += 1
            continue
        if i > 0 and c[i - 1] not in ".," and i in gap_at:
            out[wi][0] += mark(i, "")
        u = unit_at.get(i)
        if u:
            out[wi][0] += unit_reading(u, who, c[i:i + u[1]])
            i += u[1]
        else:
            out[wi][0] += ch
            i += 1
    return [tuple(x) for x in out]


def word_text(loc: dict, wi: int) -> str:
    """Consensus word wi of a locus, in Eva."""
    return loc["c"].split(".")[wi]


def _norm(s: str) -> str:
    s = s.replace("@221;", "a").replace("@222;", "y")
    return re.sub(r"^[.,]+|[.,]+$", "", re.sub(r"[.,]+(?=[.,])", "", s))


def matches(rebuilt: str, line: str) -> bool:
    """Whether a rebuilt reading is the transcriber's line (basic Eva, first option of an alternative): either option of
    an alternative may stand, and Claston's in-between glyphs stand for the glyph RF1 and Bint give them."""
    r, want = _norm(rebuilt), _norm(line)
    if r == want:
        return True
    parts = re.split(r"\[([^\]]*)\]", r)     # literal, alternatives, literal, ...
    pat = "".join(re.escape(x) if k % 2 == 0 else "(?:" + "|".join(map(re.escape, x.split(":"))) + ")"
                  for k, x in enumerate(parts))
    return re.fullmatch(pat, want) is not None
