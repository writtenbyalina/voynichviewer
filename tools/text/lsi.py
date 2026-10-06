"""The Landini-Stolfi interlinear (LSI_ivtff_0d.txt): the transcribers it adds, in STA.

LSI holds several transcriptions line by line, in basic Eva, each with a one-letter code (its header, section f0.A).
Text counts people, not files, so only these vote (see docs/TEXT.md 1.1):
  U Jorge Stolfi, V John Grove, T John Tiltman, L Don Latham, R Mike Roe, X Denis Mardle, and K and P together as one
  person, Theodore Petersen (Karl Kluge's readings of Petersen's hand copy).
Left out: H, C and F (the same people as IT, CD and FG, which vote from their own files); D, G, I, Q and M (second
choices unfolded from C, F, J, K and L); N and Z (Landini and Zandbergen, the authors of ZL); J (Reeds' readings of
single unreadable glyphs).

LSI is in Eva, so its lines are put into STA with the rules that turn Zandbergen's Eva IT2a into his STA IT2a, learned
from those two files: longest Eva sequence first, each to the STA glyph IT2a uses for it. They reproduce his conversion
on 5,208 of IT2a's 5,215 lines (the rest are rare compound gallows). The interlinear's fillers: '!' is dropped; '%'
("this transcription has no information here") becomes one SKIPPED placeholder per character, which aligns but votes
for nothing.
"""
from __future__ import annotations

import collections
import re

import sta

VOTERS = {"U": "LU", "V": "LV", "T": "LT", "L": "LL", "R": "LR", "X": "LX", "K": "LP", "P": "LP"}


def learn_rules():
    _, its = sta.read("IT2a.txt")
    used = collections.Counter(c for loc in its.values() for c in sta.CODE.findall(re.sub(r"<[^>]*>", "", loc.text)))
    inv = {}
    for code, _ in used.most_common():
        e = sta.BINT.get(code)
        if e and "?" not in e and e not in inv:
            inv[e] = code
    return inv, sorted(inv, key=len, reverse=True)


INV, KEYS = learn_rules()


def eva_to_sta(text: str) -> str:
    text = re.sub(r"<![^>]*>|\{[^}]*\}", "", text)
    text = text.replace("<->", "-").replace("<~>", "-")
    text = re.sub(r"<[^>]*>", "", text)
    out, i = [], 0
    while i < len(text):
        ch = text[i]
        if ch in ".,-":
            out.append("<->" if ch == "-" else ch)
            i += 1
            continue
        if ch == "%":
            out.append(sta.SKIPPED)
            i += 1
            continue
        if ch in "! =\t":
            i += 1
            continue
        if ch == "?":
            out.append("Z1")
            i += 1
            continue
        for k in KEYS:
            if text.startswith(k, i):
                out.append(INV[k])
                i += len(k)
                break
        else:
            out.append("Z1")
            i += 1
    return "".join(out)


def read() -> dict[str, dict[tuple[str, int], str]]:
    """Voter code -> {(page, num): STA text}. K and P are one voter (Petersen); where both have a line, K's is kept."""
    out = collections.defaultdict(dict)
    raw = collections.defaultdict(dict)
    for line in (sta.CACHE / "LSI_ivtff_0d.txt").read_text(encoding="latin-1").splitlines():
        m = sta.LOC.match(line)
        if m and m["tr"] in VOTERS:
            k = (m["page"], int(m["num"]))
            v = VOTERS[m["tr"]]
            if k in out[v] and m["tr"] == "P":
                continue
            out[v][k] = eva_to_sta(m["text"])
            raw[v][k] = re.sub(r"<![^>]*>|\{[^}]*\}|[!%]", "", m["text"]).strip()
    return out, raw


def check() -> tuple[int, int]:
    """How many of IT2a's lines the rules reproduce exactly."""
    _, its = sta.read("IT2a.txt")
    _, ite = sta.read("IT2a-n.txt")
    ok = 0
    for k, loc in ite.items():
        if k in its:
            a = eva_to_sta(loc.text).replace("<->", ".")
            b = re.sub(r"<[^>]*>", "", its[k].text.replace("<->", ".").replace("<~>", "."))
            ok += a == b
    return ok, sum(1 for k in ite if k in its)
