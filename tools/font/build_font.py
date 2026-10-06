#!/usr/bin/env python3
"""Build the Voynich glyph font that Text uses, from Glen Claston's v101 font.

The source is "Voynich 1.23" (tools/font/src): "Voynich Manuscript Font courtesy Glenn Claston, 2005, distributed in
the public domain, corrected for UTF-8 by William Porquet", as published on Font Library
(https://fontlibrary.org/en/font/voynich, sha256 below). Claston drew the glyphs of his own alphabet, v101, so it is
not an Eva font: Text shows any transcription in it by converting each glyph through Zandbergen's STA alphabet, and
`v101.json` says which v101 character draws each STA glyph (learned from Claston's transcription GC2a against its STA
version on voynich.nu; every one of the 161 characters maps to a single STA glyph).

89 rare glyphs in the transcriptions have no v101 character, or have one this font does not draw. This script gives
each its own character in the Private Use Area, from U+E100, made only from Claston's own shapes, and says how good it
is:

  v101    Claston drew it: one of his rare characters, or two of his characters side by side
  joined  two or three of his shapes, set so that their strokes meet as they do in the manuscript
  drawn   cut and joined from his outlines (`draw.py`), for the rarest forms (1 to 14 times in the whole manuscript):
          a gallows leg, the loop above a bench, the plume of sh, set the way the form is built
  illegible  the four symbols at the end of f68r2's ring that nobody can read, shown as the unreadable mark

Shapes were judged against the pictures in Zandbergen's STA definition (STA1_def.pdf on voynich.nu) and the Yale
photographs; nothing is copied from any other font. It then kerns the pairs that occur inside words, where Claston's
spacing leaves a visibly wider or narrower gap than the rest (see `kern`), and renames the font so it cannot be
mistaken for the original. Needs Python with fonttools, skia-pathops, brotli, pillow and numpy.

  python3 tools/font/build_font.py            # writes assets/fonts/voynich-vv.woff2 and data/text/glyphs.json
  python3 tools/font/build_font.py --sheet    # also writes tools/font/out/sheet.png, every added glyph and kern
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import io
import json
import sys
from pathlib import Path

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent.parent
HERE = Path(__file__).resolve().parent
SRC = HERE / "src" / "voynich-1.23-webfont.ttf"
sys.path.insert(0, str(HERE))
import draw  # noqa: E402
from kern import PX  # noqa: E402

SRC_SHA256 = "39ba7b1e40d38031d155bc957994a07036e735106abff4495a7d4b80104d2962"
OUT_FONT = ROOT / "assets" / "fonts" / "voynich-vv.woff2"
OUT_MAP = ROOT / "data" / "text" / "glyphs.json"
FAMILY = "Voynich VV"
PUA = 0xE100

# How each missing STA glyph is made. Parts are characters of the source font (v101 characters as the font maps them:
# bytes 0x80-0x9F through cp1252, the micro sign as Greek mu). A gap is the narrowest space between the ink of one part
# and the next at any height, in pixels at 200 to the em (as in kern.py); a negative gap overlaps them so that a
# connecting stroke meets the next shape. Measuring at every height lets a glyph tuck under a gallows' loop.
JOIN = -3           # strokes that connect, as in a bench (ch) or a ligature
TIGHT = 8           # glyphs written close but not joined
RECIPES: dict[str, tuple] = {
    # v101 has it
    "Ai": ("v101", "œ"),            # @156;
    "Ki": ("v101", "Ô"),            # oy, @212;
    "Kg": ("v101", "ªo"),           # @170;o
    "Sf": ("v101", "Åk"),           # c't, @197;k
    "Wf": ("v101", "ÅH"),           # c'hkh, @197;H
    "H2": ("v101", "iM"),           # iiiin
    "H3": ("v101", "μy"),           # iiir, @181;y
    # benches and ligatures, joined from Claston's parts
    "Ka": ("joined", ["o", "Æ"], JOIN),          # oh: o and the right half of a bench
    "Ke": ("joined", ["i", "Æ"], JOIN),          # ih
    "Kc": ("joined", ["c", "9"], JOIN),          # cy
    "Kj": ("joined", ["a", "i"], TIGHT),         # ai
    "Ma": ("joined", ["1", "Æ"], JOIN),          # chh: a bench of three
    "Mc": ("joined", ["5", "Æ"], JOIN),          # ch'h: plumed middle
    "Lq": ("joined", ["Ð", "a"], JOIN),          # c'a: plumed c joined to a
    "Wa": ("joined", ["l", "Æ"], JOIN),          # ckhhh
    "Wb": ("joined", ["L", "Æ"], JOIN),          # cthhh
    "Wh": ("joined", ["ä", "Æ"], JOIN),          # ikhh
    "Wi": ("joined", ["ç", "Æ"], JOIN),          # ckoh
    "Wj": ("joined", ["ö", "Æ"], JOIN),          # ckah
    "Wl": ("joined", ["õ", "Æ"], JOIN),          # ctyh
    "Wm": ("joined", ["H", "9"], JOIN),          # ckhy
    "Wn": ("joined", ["K", "9"], JOIN),          # cthy
    "Wo": ("joined", ["c", "l"], JOIN),          # chkhh: c in front of ckhh
    "We": ("joined", ["c", "å"], JOIN),          # chky: c in front of cky
    "Wk": ("joined", ["è", "a", "Æ"], JOIN),     # ctah
    "Ue": ("joined", ["v", "i"], TIGHT),         # cki
    "Uf": ("joined", ["è", "i"], TIGHT),         # cti
    "Ui": ("joined", ["9", "h", "o"], TIGHT),    # yko
    "Vb": ("joined", ["™", "Æ"], JOIN),          # ifhh: ifh and another h
    "Vd": ("joined", ["a", "™", "Æ"], TIGHT),    # aifhh
    "Rb": ("joined", ["c", "g"], JOIN),          # cp, as Claston draws cf (@234;)
    "Re": ("joined", ["i", "f"], JOIN),          # if
    "Tq": ("joined", ["ê", "9"], JOIN),          # cfy: cf and y
    "Tr": ("joined", ["i", "f", "9"], JOIN),     # ify
    "Tp": ("joined", ["o", "f", "a"], JOIN),     # ofa
    "Dc": ("v101", "4o"),           # {q@207;}, qo written as one
    "Hc": ("v101", "iM"),           # iiiin, as H2
    "Km": ("v101", "á"),            # {cl}, which v101 writes @225;
    "Lu": ("joined", ["Ð", "c"], JOIN),          # e'e: plumed e joined to e
    "Md": ("joined", ["2", "a"], JOIN),          # c'ha: sh joined to a
    "Se": ("joined", ["c", "h"], TIGHT),         # ek
    # not Voynich script: the four illegible symbols ending the ring on f68r2, shown as the unreadable mark
    "Yd": ("illegible", "?"), "Yn": ("illegible", "?"), "Yp": ("illegible", "?"), "Ys": ("illegible", "?"),
}
# the 44 rare forms drawn in draw.py: cut and joined from Claston's outlines (see there)
DRAWN = ["Ta", "Tk", "Th", "Tb", "Tc", "Ti", "Td", "Uj", "Uk", "Rg", "Rf", "T3", "To", "Tn", "Va", "Ts", "Tt", "Uo", "Wp",
         "Sg", "Wq", "Wr", "Ud", "Vc", "Da", "Ae", "Pd", "Pe", "Pi", "Pk", "Qe", "Qg", "Qh", "Kk", "Kn", "Be", "Bh", "Bd",
         "Ef", "Cp", "Xm", "Xn", "Xo", "Xp"]
RSB = 63            # right side bearing of a drawn glyph past its body, as on Claston's bench (ch)


def glyph_of(font: TTFont, ch: str) -> str:
    return font.getBestCmap()[ord(ch)]


def ink(font: TTFont, name: str) -> tuple[float, float]:
    """x extent of a glyph's ink (composites included)."""
    pen = BoundsPen(font.getGlyphSet())
    font.getGlyphSet()[name].draw(pen)
    if not pen.bounds:
        return 0.0, 0.0
    return pen.bounds[0], pen.bounds[2]


def compose(font: TTFont, shapes, parts: list[str], gap: int | None) -> tuple[list[tuple[str, int]], int, int]:
    """Place the parts left to right. A gap of None puts the second part centred over the first (a gallows standing
    on a bench). Returns the components with their x offsets, the advance width and the left side bearing."""
    hmtx = font["hmtx"]
    names = [glyph_of(font, p) for p in parts]
    placed = [(names[0], 0)]
    if gap is None:
        base, top = names
        bx0, bx1 = ink(font, base)
        tx0, tx1 = ink(font, top)
        placed.append((top, round((bx0 + bx1) / 2 - (tx0 + tx1) / 2)))
        return placed, hmtx[base][0], round(bx0)
    scale = font["head"].unitsPerEm / PX
    x = 0
    for (pa, prev), (pb, name) in zip(zip(parts, names), list(zip(parts, names))[1:]):
        natural = shapes.gap(pa, pb)                    # px, with pb at prev's advance
        if natural is None:                             # no height in common: fall back to the ink boxes
            x = round(x + ink(font, prev)[1] + gap * scale - ink(font, name)[0])
        else:
            x = round(x + hmtx[prev][0] + (gap - natural) * scale)
        placed.append((name, x))
    advance = x + hmtx[names[-1]][0]
    return placed, advance, round(ink(font, names[0])[0])


def add_glyph(font: TTFont, glyph_name: str, components: list[tuple[str, int]], advance: int, lsb: int, cp: int):
    pen = TTGlyphPen(font.getGlyphSet())
    for name, dx in components:
        pen.addComponent(name, (1, 0, 0, 1, dx, 0))
    font["glyf"][glyph_name] = pen.glyph()
    font["hmtx"][glyph_name] = (advance, lsb)
    order = font.getGlyphOrder()
    if glyph_name not in order:
        font.setGlyphOrder(order + [glyph_name])
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[cp] = glyph_name


def natural(font: TTFont, parts: str) -> tuple[list[tuple[str, int]], int, int]:
    """Characters as typed: each starts where the previous one's advance ends."""
    placed, x = [], 0
    for ch in parts:
        name = glyph_of(font, ch)
        placed.append((name, x))
        x += font["hmtx"][name][0]
    return placed, x, round(ink(font, placed[0][0])[0])


def outline(font: TTFont, name: str, path, cp: int):
    """Add a drawn path as a simple glyph: its ink starts 30 units in, and it advances RSB past its body (the ink
    below 700), so that a gallows' loop overhangs the next glyph as Claston's do."""
    import pathops
    x0, y0, x1, y1 = path.bounds
    body = pathops.op(path, draw.rect(-4000, -4000, 4000, 700), pathops.PathOp.INTERSECTION)
    bx1 = x1 if body.area == 0 else body.bounds[2]
    pen = TTGlyphPen(None)
    path.draw(TransformPen(Cu2QuPen(pen, max_err=1.0, reverse_direction=False), (1, 0, 0, 1, 30 - x0, 0)))
    font["glyf"][name] = pen.glyph()
    font["glyf"][name].recalcBounds(font["glyf"])
    font["hmtx"][name] = (round(bx1 - x0 + 30 + RSB), 30)
    if name not in font.getGlyphOrder():
        font.setGlyphOrder(font.getGlyphOrder() + [name])
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[cp] = name


def additions(font: TTFont) -> dict[str, dict]:
    """Add one glyph per recipe and per drawn form; returns STA code -> {ch, kind}."""
    from kern import Shapes
    shapes = Shapes(font)
    drawn = draw.glyphs(font)
    out = {}
    for i, (code, recipe) in enumerate(sorted(RECIPES.items())):
        kind, parts = recipe[0], recipe[1]
        if isinstance(parts, str):
            components, advance, lsb = natural(font, parts)
        else:
            components, advance, lsb = compose(font, shapes, parts, recipe[2])
        cp = PUA + i
        add_glyph(font, f"sta.{code}", components, advance, lsb, cp)
        out[code] = {"ch": chr(cp), "kind": kind}
    for j, code in enumerate(DRAWN):
        cp = PUA + len(RECIPES) + j
        path, note = drawn[code]
        outline(font, f"sta.{code}", clockwise(path), cp)
        out[code] = {"ch": chr(cp), "kind": "drawn", "note": note}
    return out


def clockwise(path):
    """TrueType wants outer contours clockwise."""
    import pathops
    return pathops.simplify(path, fix_winding=True, clockwise=True)


def rename(font: TTFont):
    note = ("Voynich VV: Glen Claston's Voynich 1.23 (2005, public domain; UTF-8 fix by William Porquet) with 89 rare "
            "glyphs composed from his shapes and kerning added for Voynich Viewer, 2026. Public domain (CC0).")
    for rec in font["name"].names:
        if rec.nameID in (1, 16):
            rec.string = FAMILY
        elif rec.nameID == 4:
            rec.string = FAMILY + " Regular"
        elif rec.nameID == 6:
            rec.string = "VoynichVV-Regular"
        elif rec.nameID == 0:
            rec.string = note
        elif rec.nameID == 3:
            rec.string = "VoynichVV-1.0"
        elif rec.nameID == 5:
            rec.string = "Version 1.0 (from Voynich 1.23)"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sheet", action="store_true", help="also write tools/font/out/sheet.png")
    args = ap.parse_args()
    data = SRC.read_bytes()
    if hashlib.sha256(data).hexdigest() != SRC_SHA256:
        raise SystemExit(f"{SRC} is not the Font Library file (sha256 differs)")
    font = TTFont(io.BytesIO(data))
    v101 = json.loads((HERE / "v101.json").read_text())
    added = additions(font)
    from kern import kern_pairs
    pairs = kern_pairs(font, v101, added)
    if pairs:
        fea = "feature kern {\n" + "".join(f"  pos {a} {b} {v};\n" for (a, b), v in sorted(pairs.items())) + "} kern;\n"
        addOpenTypeFeaturesFromString(font, fea)
    rename(font)
    OUT_FONT.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(OUT_FONT)
    eva = eva_names()
    glyphs = {code: {"ch": ch, "kind": "v101"} for code, ch in v101.items()}
    glyphs.update(added)
    for code, d in glyphs.items():
        d["eva"] = eva.get(code, "?")
    OUT_MAP.parent.mkdir(parents=True, exist_ok=True)
    OUT_MAP.write_text(json.dumps({"font": "assets/fonts/voynich-vv.woff2", "family": FAMILY, "glyphs": glyphs},
                                  ensure_ascii=False, indent=0, sort_keys=True) + "\n")
    kinds = collections.Counter(d["kind"] for d in glyphs.values())
    print(f"{OUT_FONT.relative_to(ROOT)}: {OUT_FONT.stat().st_size:,} bytes; {len(added)} glyphs added; "
          f"{len(pairs)} kerning pairs; {OUT_MAP.relative_to(ROOT)}: {len(glyphs)} STA glyphs {dict(kinds)}")
    if args.sheet:
        from sheet import sheet
        rev = {name: chr(cp) for cp, name in font.getBestCmap().items()}
        sheet(glyphs, RECIPES, pairs, rev, HERE / "out" / "sheet.html")
        print("tools/font/out/sheet.html")


def eva_names() -> dict[str, str]:
    """Zandbergen's nearest basic Eva for each STA glyph (src/STA-Eva_Bint.bit), for labels and screen readers."""
    out = {}
    for line in (HERE / "src" / "STA-Eva_Bint.bit").read_text(encoding="latin-1").splitlines():
        p = line.split()
        if len(p) >= 2 and line[:1] not in "#<":
            out[p[0]] = p[1]
    return out


if __name__ == "__main__":
    main()
