"""Tests of the text pipeline and its data: python3 tools/text/test_text.py (after fetch.py and build.py)."""
import collections
import hashlib
import json
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DATA = ROOT / "data" / "text"
sys.path.insert(0, str(HERE))

import lsi  # noqa: E402
import sta  # noqa: E402
import vote  # noqa: E402
import align  # noqa: E402
from corpus import Corpus  # noqa: E402


def page(p):
    return json.loads((DATA / "pages" / f"{p}.json").read_text())


def locus(lid):
    return next(l for l in page(lid.rsplit(".", 1)[0])["loci"] if l["id"] == lid)


class Inputs(unittest.TestCase):
    def test_every_input_is_the_pinned_file(self):
        for f in json.loads((HERE / "inputs.json").read_text())["files"]:
            self.assertEqual(hashlib.sha256((sta.CACHE / f["name"]).read_bytes()).hexdigest(), f["sha256"], f["name"])

    def test_eva_rules_reproduce_zandbergens_sta_for_takahashi(self):
        ok, n = lsi.check()
        self.assertGreaterEqual(ok, 5208)
        self.assertEqual(n, 5215)


class Data(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = json.loads((DATA / "index.json").read_text())["loci"]
        cls.meta = json.loads((DATA / "meta.json").read_text())

    def test_every_zl_locus_is_there(self):
        self.assertEqual(len(self.index), 5385)
        self.assertEqual(self.meta["pages"], 227)
        types = collections.Counter(row[1][0] for row in self.index)
        self.assertEqual(dict(types), {"P": 4130, "L": 1029, "C": 84, "R": 142})
        self.assertTrue(any(row[0].startswith("fRos.") for row in self.index))
        self.assertEqual(sum(row[3] for row in self.index), sum(1 for f in (DATA / "pages").glob("*.json")
                                                                 for l in json.loads(f.read_text())["loci"] if l["ps"]))

    def test_index_matches_pages(self):
        by_page = collections.defaultdict(list)
        for i, t, c, _ in self.index:
            by_page[i.rsplit(".", 1)[0]].append((i, t, c))
        for p, rows in by_page.items():
            self.assertEqual([(l["id"], l["t"], l["c"]) for l in page(p)["loci"]], rows, p)

    def test_word_tokens_near_published(self):
        n = sum(len([w for w in row[2].replace(",", ".").split(".") if w]) for row in self.index)
        m = sum(len([w for w in row[2].replace(",", "").split(".") if w]) for row in self.index)
        self.assertTrue(36000 < m < (m + n) / 2 < n < 41000, (m, n))

    def test_worked_lines(self):
        self.assertEqual(locus("f10r.6")["c"], "ycheor.cthy.chor.cthaiin.qoctholy.dy.chy.taiin.shy")
        self.assertEqual(locus("f10r.6")["u"], [])
        f1r2 = locus("f1r.2")
        self.assertEqual(f1r2["c"], "sory.ckhar.or,y.kair.chtaiin.shar.are.cthar.cthar.dan")
        gap = next(g for g in f1r2["s"] if g[1] == "u")
        self.assertEqual(f1r2["c"][gap[0]], ",")
        self.assertIn("ZL,", gap[2]); self.assertIn("GC,", gap[2]); self.assertIn("IT.", gap[2])
        are = next(u for u in f1r2["u"] if u[0] == f1r2["c"].index("are") + 2)
        self.assertEqual(are[2], "p")                       # e: the most votes, not a majority
        self.assertEqual(locus("f3v.5")["c"], "ychear.otchal.cho,r.char.ckhy")

    def test_rare_glyphs_vote_as_themselves(self):
        c = locus("f57v.3")["c"]
        for g in ("@169;", "@170;", "@172;"):
            self.assertIn(g, c)

    def test_every_voter_votes_once_per_column(self):
        for p in ("f1r", "f3v", "f57v", "f67r1", "f75r", "fRos"):
            for l in page(p)["loci"]:
                for u in l["u"]:
                    voting = {n for _, w, who in u[3] if w > 0 for n in who.split()}
                    silent = {n for _, w, who in u[3] if w == 0 for n in who.split()}
                    self.assertTrue(voting | silent <= set(l["w"]), (l["id"], u))
                    # a voter in both is one who wrote [a:?]: half a vote, half unreadable
                    total = sum(w for _, w, _ in u[3])
                    self.assertLessEqual(total, len(voting) + 0.01, (l["id"], u))
                    self.assertGreaterEqual(total, len(voting - silent) + 0.5 * len(voting & silent) - 0.01, (l["id"], u))

    def test_unanimous_lines_have_nothing_to_mark(self):
        for l in page("f10r")["loci"]:     # a unanimous column is kept only if someone abstained or a reference differs
            for u in l["u"]:
                text = l["c"][u[0]:u[0] + u[1]]
                self.assertTrue(u[2] != "u" or any(w == 0 for _, w, _ in u[3])
                                or any(v != text for v in (u[4] if u[4:] else {}).values()), u)

    def test_glyph_font_draws_every_consensus_glyph(self):
        glyphs = json.loads((DATA / "glyphs.json").read_text())["glyphs"]
        missing = collections.Counter()
        for f in (DATA / "pages").glob("*.json"):
            for l in json.loads(f.read_text())["loci"]:
                for code in sta.CODE.findall(l["g"]):
                    if code not in glyphs:
                        missing[code] += 1
        self.assertEqual(dict(missing), {})

    def test_separators_only_between_glyphs(self):
        bad = [i for i, _t, c, _p in json.loads((DATA / "index.json").read_text())["loci"]
               if re.search(r"[.,][.,]|^[.,]|[.,]$", c)]
        self.assertEqual(bad, [])

    def test_meta_lists_every_page_with_text(self):
        meta = json.loads((DATA / "meta.json").read_text())
        files = {f.stem: len(json.loads(f.read_text())["loci"]) for f in (DATA / "pages").glob("*.json")}
        self.assertEqual(meta["lines"], files)

    def test_witness_files_follow_the_index(self):
        n = len(self.index)
        for f in (DATA / "w").glob("*.json"):
            self.assertEqual(len(json.loads(f.read_text())["lines"]), n, f.name)
        self.assertEqual({f.stem for f in (DATA / "w").glob("*.json")},
                         set(vote.ORDER) | set(vote.REFERENCE))

    def test_readings_rebuild_every_transcribers_line(self):
        """The site rebuilds each transcriber's reading from the page files (assets/text.js); it must give their own
        line back, wherever the build did not keep that line as it is (x, a line that lines up only roughly)."""
        import shutil
        import subprocess
        if not shutil.which("node"):
            self.skipTest("needs node")
        out = json.loads(subprocess.run(["node", str(HERE / "check_readings.mjs")], capture_output=True, text=True,
                                        check=True).stdout)
        self.assertGreater(out["checked"], 30000)
        self.assertEqual(out["wrong"], [])

    def test_few_lines_line_up_only_roughly(self):
        n = collections.Counter()
        for f in (DATA / "pages").glob("*.json"):
            for l in json.loads(f.read_text())["loci"]:
                for w in l.get("x", {}):
                    n[w] += 1
        self.assertEqual(n["ZL"], 0)
        self.assertLess(sum(n.values()), 300)

    def test_word_boxes_cover_most_words_and_stay_on_the_page(self):
        """data/text/boxes (tools/text/boxes.py): voynichese.com's boxes fitted to the site's page photos. Rows are
        [locus, word, x, y, w, h(, estimated, panel)]; the panels are the page's own in data/codex.json, the first
        always, or a neighbour's cut from the same photograph of Yale's."""
        files = [f for f in (DATA / "boxes").glob("*.json") if f.name != "pages.json"]
        self.assertEqual(json.loads((DATA / "boxes" / "pages.json").read_text()), sorted(f.stem for f in files))
        self.assertGreaterEqual(len(files), 220)
        codex = json.loads((ROOT / "data" / "codex.json").read_text())
        imgs, photo = collections.defaultdict(set), {}
        for s in codex["sheets"]:
            for side in ("inside", "outside"):
                for row in s[side]:
                    for sg in row:
                        if "img" in sg:
                            imgs[sg.get("page")].add(sg["img"])
                            photo[sg["img"]] = sg.get("iiif")
        boxed = total = est = 0
        for f in files:
            b = json.loads(f.read_text())
            loci = page(b["page"])["loci"]
            self.assertIn(b["imgs"][0], imgs[b["page"]])
            for img in b["imgs"][1:]:
                self.assertTrue(img in imgs[b["page"]] or photo[img] == photo[b["imgs"][0]], (b["page"], img))
            seen = set()
            for row in b["words"]:
                self.assertIn(len(row), (6, 7, 8), (b["page"], row))
                li, wi, x, y, w, h = row[:6]
                e, p = (row[6:] + [0, 0])[:2]
                self.assertIn(e, (0, 1))
                self.assertTrue(0 <= p < len(b["imgs"]), (b["page"], row))
                self.assertLess(wi, len(loci[li]["c"].split(".")), (b["page"], li, wi))
                self.assertTrue(0 <= x <= 1000 and 0 <= y <= 1000 and 0 < w <= 1000 and 0 < h <= 1000, (b["page"], li, wi))
                self.assertNotIn((li, wi), seen)
                seen.add((li, wi))
                est += e
            boxed += len(b["words"])
            total += sum(len(l["c"].split(".")) for l in loci)
        self.assertGreater(boxed / total, 0.99)
        self.assertLess(est / boxed, 0.005)          # almost every box is voynichese.com's own

    def test_every_ring_and_radius_word_has_a_box(self):
        """On the round diagrams voynichese.com covers, each word written along a circle or a radius has a box."""
        have = set(json.loads((DATA / "boxes" / "pages.json").read_text()))
        missing = []
        for name in have:
            b = json.loads((DATA / "boxes" / f"{name}.json").read_text())
            got = {(r[0], r[1]) for r in b["words"]}
            for li, l in enumerate(page(name)["loci"]):
                if l["t"][0] in "CR":
                    missing += [(l["id"], wi) for wi in range(len(l["c"].split("."))) if (li, wi) not in got]
        self.assertEqual(missing, [])

    def test_sizes(self):
        self.assertLess((DATA / "index.json").stat().st_size, 400_000)
        self.assertLess(max(f.stat().st_size for f in (DATA / "pages").glob("*.json")), 160_000)

    def test_split_is_not_published(self):
        costs = json.loads((HERE / "costs.json").read_text())
        self.assertEqual(set(costs["fit_on"]), {"pages", "sha256"})
        for f in [HERE / "costs.json", DATA / "meta.json", ROOT / "docs" / "text" / "report.md"]:
            self.assertNotRegex(f.read_text(), r"\bDEV\b|\bEVAL\b|\bFINAL\b")


class Vote(unittest.TestCase):
    def test_tie_follows_order(self):
        r = vote.locus({"ZL": "A1C1", "GC": "A3C1"})
        self.assertEqual(r["c"], "or")
        self.assertEqual(r["u"][0][2], "t")

    def test_alternatives_split_a_vote(self):
        r = vote.locus({"ZL": "[A1:A3]C1", "GC": "A3C1", "IT": "A1C1"})
        rows = {t: w for t, w, _ in r["u"][0][3]}
        self.assertEqual(rows, {"o": 1.5, "a": 1.5})

    def test_uncertain_space_counts_half(self):
        r = vote.locus({"ZL": "A1C1,A2", "GC": "A1C1.A2", "IT": "A1C1A2"})
        self.assertEqual(r["c"], "or,y")
        r = vote.locus({"ZL": "A1C1,A2", "GC": "A1C1,A2", "IT": "A1C1A2", "FG": "A1C1A2"})
        self.assertEqual(r["c"], "or,y")                    # two people doubted it: uncertain

    def test_unreadable_does_not_vote(self):
        r = vote.locus({"ZL": "A1Z1", "GC": "A1C1", "IT": "A1C2"})
        rows = {t: w for t, w, _ in r["u"][0][3]}
        self.assertEqual(rows["?"], 0)

    def test_an_abstainer_is_kept_where_the_rest_agree(self):
        r = vote.locus({"ZL": "A1C1", "GC": "A1C1", "IT": "A1Z1"})
        self.assertEqual(r["c"], "or")
        rows = {who: (t, w) for t, w, who in r["u"][0][3]}
        self.assertEqual(rows["IT"], ("?", 0))

    def test_a_glyph_only_one_reads_is_kept(self):
        r = vote.locus({"ZL": "A1C1", "GC": "A1C1", "IT": "A1C2C1"})
        self.assertEqual(r["c"], "or")
        extra = [u for u in r["u"] if u[1] == 0]
        self.assertEqual(len(extra), 1)
        self.assertIn(["s", 1.0, "IT"], extra[0][3])

    def test_in_between_glyph_votes_family_only(self):
        r = vote.locus({"ZL": "A1", "GC": "Aa", "IT": "A3"})
        rows = {t: (w, who) for t, w, who in r["u"][0][3]}
        self.assertEqual(rows["@221;"], (0, "GC"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
