"""All witnesses of every locus, in STA, keyed by locus; and their own lines as written, for display."""
from __future__ import annotations

import re

import lsi
import sta

FILES = {"ZL": "ZL3b.txt", "GC": "GC2a_0.txt", "IT": "IT2a.txt", "FG": "FG2a.txt", "CD": "CD2a_0.txt",
         "RF": "RF1b.txt", "VT": "VT0e.txt"}
NATIVE = {"ZL": "ZL3b-n.txt", "GC": "GC2a-n.txt", "IT": "IT2a-n.txt", "FG": "FG2a-n.txt", "CD": "CD2a-n.txt",
          "RF": "RF1b-e.txt", "VT": "VT0e-n.txt"}
NAMES = {"ZL": "René Zandbergen & Gabriel Landini", "GC": "Glen Claston", "IT": "Takeshi Takahashi",
         "FG": "First Study Group (Friedman)", "CD": "Prescott Currier & Mary D'Imperio", "LU": "Jorge Stolfi",
         "LV": "John Grove", "LT": "John Tiltman", "LL": "Don Latham", "LP": "Theodore Petersen (via Karl Kluge)",
         "LR": "Mike Roe", "LX": "Denis Mardle", "RF": "RF1, Zandbergen's merge of ZL and GC",
         "VT": "voynichese.com (Takahashi)"}
ALPHABET = {"ZL": "Extended Eva", "GC": "v101", "IT": "Eva", "FG": "FSG", "CD": "Currier", "RF": "Eva",
            "VT": "Eva"}


def clean(text: str) -> str:
    """A line as its transcriber wrote it, without comments and IVTFF markup."""
    text = re.sub(r"<![^>]*>", "", text)
    text = text.replace("<->", "-").replace("<~>", "-")
    return re.sub(r"<[^>]*>", "", text).strip()


class Corpus:
    def __init__(self):
        sta.learn_rare_eva()
        self.pages, self.zl = sta.read("ZL3b.txt")
        self.zln = sta.read("ZL3b-n.txt")[1]
        self.sta = {n: sta.read(f)[1] for n, f in FILES.items()}
        self.native = {n: sta.read(f)[1] for n, f in NATIVE.items()}
        lsi_sta, self.lsi_raw = lsi.read()
        self.sta.update(lsi_sta)

    def keys(self):
        return list(self.zl)

    def witnesses(self, key) -> dict[str, str]:
        return {n: loci[key].text if hasattr(loci[key], "text") else loci[key]
                for n, loci in self.sta.items() if key in loci}

    def own_lines(self, key) -> dict[str, str]:
        out = {n: clean(loci[key].text) for n, loci in self.native.items() if key in loci}
        out.update({n: re.sub(r"<->", "-", re.sub(r"<[^>]*>", "", v[key])) for n, v in self.lsi_raw.items() if key in v})
        return out
