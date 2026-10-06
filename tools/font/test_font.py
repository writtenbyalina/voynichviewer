"""Checks on the built font and glyph map: python3 tools/font/test_font.py (needs fonttools)."""
import hashlib
import json
import sys
import unittest
from pathlib import Path

from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import build_font  # noqa: E402


class FontTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.font = TTFont(ROOT / "assets/fonts/voynich-vv.woff2")
        cls.map = json.loads((ROOT / "data/text/glyphs.json").read_text())
        cls.cmap = cls.font.getBestCmap()

    def test_source_is_the_font_library_file(self):
        self.assertEqual(hashlib.sha256(build_font.SRC.read_bytes()).hexdigest(), build_font.SRC_SHA256)

    def test_every_sta_glyph_is_drawn(self):
        v101 = json.loads((HERE / "v101.json").read_text())
        codes = set(v101) | set(build_font.RECIPES) | set(build_font.DRAWN)
        self.assertEqual(codes, set(self.map["glyphs"]))
        for code, d in self.map["glyphs"].items():
            for ch in d["ch"]:
                self.assertIn(ord(ch), self.cmap, f"{code} draws {ch!r}, which the font lacks")
            self.assertIn(d["kind"], ("v101", "joined", "drawn", "illegible"))
            self.assertTrue(d["eva"], code)

    def test_common_glyphs_come_from_claston(self):
        g = self.map["glyphs"]
        for code, ch in {"A1": "o", "A2": "9", "A3": "a", "K1": "1", "J1": "c", "Q1": "h", "Q2": "k", "D1": "4",
                         "G1": "m", "K2": "cc", "M1": "ccc", "U2": "K"}.items():
            self.assertEqual(g[code]["ch"], ch, code)

    def test_added_glyphs_are_in_the_private_use_area(self):
        for code in list(build_font.RECIPES) + build_font.DRAWN:
            self.assertTrue(0xE100 <= ord(self.map["glyphs"][code]["ch"]) < 0xE200, code)

    def test_drawn_glyphs_are_outlines_with_ink(self):
        glyf = self.font["glyf"]
        for code in build_font.DRAWN:
            g = glyf[self.cmap[ord(self.map["glyphs"][code]["ch"])]]
            self.assertFalse(g.isComposite(), code)
            self.assertGreater(g.numberOfContours, 0, code)
            self.assertEqual(self.font["hmtx"][self.cmap[ord(self.map["glyphs"][code]["ch"])]][1], 30, code)

    def test_no_approximate_glyphs_left(self):
        self.assertNotIn("near", {d["kind"] for d in self.map["glyphs"].values()})

    def test_gallows_and_bench_are_kerned(self):
        pairs = {}
        for lookup in self.font["GPOS"].table.LookupList.Lookup:
            for st in lookup.SubTable:
                if st.Format == 1:
                    for first, ps in zip(st.Coverage.glyphs, st.PairSet):
                        for pv in ps.PairValueRecord:
                            pairs[(first, pv.SecondGlyph)] = pv.Value1.XAdvance
        p, ch = self.cmap[ord("g")], self.cmap[ord("1")]
        self.assertLess(pairs[(p, ch)], -200)            # pch: the bench tucks under the gallows' loop
        self.assertFalse(any(self.cmap[ord("?")] in k for k in pairs))

    def test_renamed(self):
        names = {r.nameID: r.toUnicode() for r in self.font["name"].names if r.platformID == 3}
        self.assertEqual(names[1], build_font.FAMILY)
        self.assertIn("Glen Claston", names[0])
        self.assertIn("public domain", names[0])


if __name__ == "__main__":
    unittest.main(verbosity=1)
