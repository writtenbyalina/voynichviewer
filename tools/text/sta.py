"""Zandbergen's STA alphabet: the files in it, his tables, and the grain at which Text compares glyphs.

STA writes every glyph as a family letter and a member (A1 o, A3 a, A2 y, K1 ch, Q1 k, ...). Zandbergen publishes every
transliteration in it, with tables to strokes (aaa: STA-aaa.bit), to the nearest basic Eva (STA-Eva_Bint.bit) and to
reduced STA (STA1R.bit). See https://www.voynich.nu/extra/sta.html and sta-aaa.html.

Two things are decided here and nowhere else:
  - `key(code)`: what a glyph votes as. Normally its nearest basic Eva, the finest grain every witness can write. A rare
    glyph that basic Eva has no letter for (Zandbergen's X family, @nnn; in Extended Eva) votes as itself. An unreadable
    mark (Z family), an illegible non-script symbol (Y family) or a placeholder for text a witness skipped votes as
    nothing. v101's two in-between glyphs, which RF1 writes @221; and @222;, vote on their family only (`FAMILY_ONLY`).
  - `eva(code)`: how a glyph is written in the consensus text: basic Eva, or Extended Eva's @nnn; for a rare glyph.
"""
from __future__ import annotations

import collections
import re
from pathlib import Path

CACHE = Path(__file__).resolve().parent / "cache"
CODE = re.compile(r"[A-Z][0-9a-z%]")
SKIPPED = "Z%"              # a stretch a witness skipped (the interlinear's %): no vote
UNREADABLE = {"Z1", "Z4", "Z5", SKIPPED}
FAMILY_ONLY = {"Aa", "Ab"}


def bit(name: str) -> dict[str, str]:
    out = {}
    for line in (CACHE / name).read_text(encoding="latin-1").splitlines():
        if not line or line[0] in "#<":
            continue
        p = line.split()
        if len(p) >= 2:
            out[p[0]] = p[1]
    return out


AAA = bit("STA-aaa.bit")
BINT = bit("STA-Eva_Bint.bit")
RED = bit("STA1R.bit")


def strokes(code: str) -> list[str]:
    s = AAA.get(code)
    return re.split("[:~]", s) if s else ["z0"]


def is_rare(code: str) -> bool:
    """A glyph basic Eva cannot write (Bint gives '?'), but which is not an unreadable or illegible mark."""
    return "?" in BINT.get(code, "?") and code not in UNREADABLE and code[0] not in "YZ"


def votes_nothing(code: str) -> bool:
    return code in UNREADABLE or code[0] in "YZ"


def key(code: str) -> str:
    if votes_nothing(code):
        return ""
    if is_rare(code):
        return "@" + code
    return BINT[code]


RARE_EVA: dict[str, str] = {}       # filled by learn_rare_eva(): STA code -> ZL's Extended Eva (@nnn;)


def eva(code: str) -> str:
    if votes_nothing(code):
        return "?"
    if is_rare(code):
        return RARE_EVA.get(code, "?")
    return BINT[code]


LOC = re.compile(r"^<(?P<page>[^.,>]+)\.(?P<num>\d+),(?P<loc>.)(?P<type>[A-Z][a-z0-9])(?:;(?P<tr>.))?>\s*(?P<text>.*)$")
PAGE = re.compile(r"^<(?P<page>[^.,>]+)>\s*<!(?P<vars>[^>]*)>")


class Locus(collections.namedtuple("Locus", "page num loc type text")):
    @property
    def id(self) -> str:
        return f"{self.page}.{self.num}"


def read(name: str):
    """An IVTFF file (any alphabet) -> page variables, and loci by (page, number) in file order."""
    pages, loci = {}, {}
    for line in (CACHE / name).read_text(encoding="latin-1").splitlines():
        if line.startswith("#"):
            continue
        m = PAGE.match(line)
        if m:
            pages[m["page"]] = dict(re.findall(r"\$([A-Z])=(\S)", m["vars"]))
            continue
        m = LOC.match(line)
        if m:
            loci[(m["page"], int(m["num"]))] = Locus(m["page"], int(m["num"]), m["loc"], m["type"], m["text"])
    return pages, loci


def tokenize(text: str):
    """STA text -> items: ('g', [option, ...]) with each option a tuple of codes, or ('s', '.' | ',' | '-')."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == "<":
            j = text.index(">", i)
            if text[i + 1:j] in ("-", "~"):
                out.append(("s", "-"))
            i = j + 1
        elif c == "[":
            j = text.index("]", i)
            out.append(("g", [tuple(CODE.findall(o)) for o in text[i + 1:j].split(":")]))
            i = j + 1
        elif c in ".,":
            out.append(("s", c))
            i += 1
        elif CODE.match(text, i):
            out.append(("g", [(text[i:i + 2],)]))
            i += 2
        else:
            i += 1
    return out


def para_marks(text: str) -> tuple[bool, bool]:
    return "<%>" in text, "<$>" in text


def learn_rare_eva():
    """How ZL writes each rare glyph in Extended Eva: from ZL3b-n.txt against ZL3b.txt, word by word, where a word
    has exactly one @nnn; on one side and one rare STA glyph on the other."""
    _, e = read("ZL3b-n.txt")
    _, s = read("ZL3b.txt")
    seen = collections.defaultdict(collections.Counter)
    for k, loc in s.items():
        if k not in e:
            continue
        ew = re.split(r"[.,]|<->", re.sub(r"<![^>]*>|<[%$]>", "", e[k].text))
        sw = re.split(r"[.,]|<->", re.sub(r"<![^>]*>|<[%$]>", "", loc.text))
        if len(ew) != len(sw):
            continue
        for a, b in zip(ew, sw):
            ats = re.findall(r"@\d{3};", a)
            rares = [c for c in CODE.findall(b) if is_rare(c)]
            if len(ats) == 1 and len(rares) == 1:
                seen[rares[0]][ats[0]] += 1
    RARE_EVA.update({code: c.most_common(1)[0][0] for code, c in seen.items()})
    RARE_EVA.setdefault("Xc", "@223;")      # added to Eva on 16/5/2025 (STA definition, X family); not in ZL
    return RARE_EVA
