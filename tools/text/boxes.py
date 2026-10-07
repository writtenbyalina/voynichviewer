#!/usr/bin/env python3
"""Where each word is on the page photographs: voynichese.com's word boxes, fitted to Voynich Viewer's page crops.

  python3 tools/text/boxes.py            # needs opencv-python-headless and numpy; writes data/text/boxes/<page>.json

The Voynichese Project (2014) bound every word of its transcription to a box on the Beinecke's photographs, and
published the boxes as XML under the Apache License 2.0 (voynichese_data.zip, pinned in inputs.json). Its boxes are in
the frame of each page's full photograph scaled to 1,500 px tall. To put them on this site's pages:

  1. the frame of the site's own page images (636 x 900, data/folio/image/glance/...) is fitted to the XML frame from
     the two sets of boxes, which are the same boxes (data/folio/script/<page>.js, word for word);
  2. that image is matched to this site's crop of Yale's photograph (data/panels/<img>_l.jpg) by SIFT features and a
     RANSAC homography;
  3. each box's corners go through both, and are kept in thousandths of the panel image's width and height;
  4. each of its words is lined up with the voynichese.com transcription in data/text (VT, Takahashi's) and so with
     the consensus words: a box belongs to the consensus word(s) it covers.

The photographs fetched for step 2 stay in tools/text/cache/vc (their checksums in vc-manifest.json); only the boxes
are published. Pages it cannot fit well are listed in docs/text/boxes.md and get no boxes.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import subprocess
import time
import zipfile
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = HERE / "cache"
VC = CACHE / "vc"
OUT = ROOT / "data" / "text" / "boxes"
SITE = "https://www.voynichese.com/2/data/folio/"
RENAME = {"f101r1": "f101r", "f101v2": "f101v"}         # voynichese.com's names -> the transcriptions'
MIN_INLIERS = 60                                        # fewer matched features than this: the fit is not trusted
CREDIT = ("Word boxes: The Voynichese Project (2014), Apache License 2.0, fitted to Yale's photographs by "
          "Voynich Viewer (tools/text/boxes.py).")

sys.path.insert(0, str(HERE))
import readings  # noqa: E402


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def fetch(pages: list[str]):
    """voynichese.com's page image and box script for each page, once; their checksums are kept and then checked."""
    VC.mkdir(parents=True, exist_ok=True)
    mpath = HERE / "vc-manifest.json"
    manifest = json.loads(mpath.read_text()) if mpath.exists() else {}
    for vp in pages:
        for name, url in ((f"{vp}.jpg", f"{SITE}image/glance/color/large/{vp}.jpg"), (f"{vp}.js", f"{SITE}script/{vp}.js")):
            dest = VC / name
            if not dest.exists():
                subprocess.run(["curl", "-sfL", "--max-time", "60", "-o", str(dest), url], check=True)
                time.sleep(0.3)                          # gently: it is someone else's site
            h = sha(dest)
            if manifest.get(name, h) != h:
                raise SystemExit(f"{name}: differs from vc-manifest.json")
            manifest[name] = h
    mpath.write_text(json.dumps(dict(sorted(manifest.items())), indent=1) + "\n")


def xml_words(z: zipfile.ZipFile, vp: str):
    t = z.read(f"data/{vp}.xml").decode()
    words = [(int(i), float(x), float(y), float(w), float(h), s) for i, x, y, w, h, s in
             re.findall(r'<word index="(\d+)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)">([^<]*)</word>', t)]
    return sorted(words)


def frame_fit(words, script):
    """XML frame -> the 636 x 900 image's frame: x' = a x + c, y' = b y + d, from the boxes both files give."""
    uniq, boxes = script
    if len(boxes) != len(words):
        return None
    A, B = [], []
    for (_, x, y, w, h, s), (wi, X, Y, W, H) in zip(words, boxes):
        if uniq[wi][0] != s:
            return None
        A.append((x, x + w, y, y + h)); B.append((X, X + W, Y, Y + H))
    A, B = np.array(A), np.array(B)
    ax = np.polyfit(A[:, :2].ravel(), B[:, :2].ravel(), 1)
    ay = np.polyfit(A[:, 2:].ravel(), B[:, 2:].ravel(), 1)
    err = max(np.abs(np.polyval(ax, A[:, :2]) - B[:, :2]).max(), np.abs(np.polyval(ay, A[:, 2:]) - B[:, 2:]).max())
    return ax, ay, float(err)


SIFT = cv2.SIFT_create(nfeatures=8000)


def homography(src, dst):
    k1, d1 = SIFT.detectAndCompute(cv2.cvtColor(src, cv2.COLOR_BGR2GRAY), None)
    k2, d2 = SIFT.detectAndCompute(cv2.cvtColor(dst, cv2.COLOR_BGR2GRAY), None)
    if d1 is None or d2 is None or len(k1) < 10 or len(k2) < 10:
        return None, 0
    good = [a for a, b in cv2.BFMatcher().knnMatch(d1, d2, k=2) if a.distance < 0.75 * b.distance]
    if len(good) < 10:
        return None, 0
    p1 = np.float32([k1[a.queryIdx].pt for a in good]); p2 = np.float32([k2[a.trainIdx].pt for a in good])
    H, mask = cv2.findHomography(p1, p2, cv2.RANSAC, 4.0)
    return H, int(mask.sum()) if mask is not None else 0


def vt_tokens(loci):
    """VT's words over the page, each with the consensus words (locus index, word index) it covers."""
    toks = []
    for li, loc in enumerate(loci):
        rd = readings.words_of(loc, "VT")
        if rd is None:
            continue
        cur = None
        for wi, (text, nxt) in enumerate(rd):
            parts = re.split(r"[.,]", text) if text else [""]
            for k, part in enumerate(parts):
                if k and cur is not None:
                    toks.append(cur); cur = None
                if cur is None:
                    cur = {"text": "", "refs": []}
                cur["text"] += part
                if (li, wi) not in cur["refs"]:
                    cur["refs"].append((li, wi))
            if nxt in (".", ",") or wi == len(rd) - 1:
                toks.append(cur); cur = None
        if cur:
            toks.append(cur)
    return [t for t in toks if t["text"]]


def lev(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def align(xs: list[str], ys: list[str]):
    """Pairs (i, j) lining up two word lists in order (Needleman-Wunsch; a word pair costs its share of edits)."""
    n, m = len(xs), len(ys)
    GAP = 0.8
    D = np.full((n + 1, m + 1), np.inf); D[0, :] = np.arange(m + 1) * GAP; D[:, 0] = np.arange(n + 1) * GAP
    B = np.zeros((n + 1, m + 1), dtype=np.int8)
    for i in range(1, n + 1):
        for j in range(max(1, i - 60), min(m, i + 60) + 1):
            a, b = xs[i - 1], ys[j - 1]
            sub = D[i - 1, j - 1] + (0 if a == b else min(1.6, 2 * lev(a, b) / max(len(a), len(b), 1)))
            up, left = D[i - 1, j] + GAP, D[i, j - 1] + GAP
            D[i, j], B[i, j] = min((sub, 0), (up, 1), (left, 2))
    pairs, i, j = [], n, m
    while i > 0 and j > 0:
        if B[i, j] == 0:
            if xs[i - 1] == ys[j - 1] or 2 * lev(xs[i - 1], ys[j - 1]) / max(len(xs[i - 1]), len(ys[j - 1]), 1) <= 1:
                pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif B[i, j] == 1:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def main():
    inputs = {f["name"]: f for f in json.loads((HERE / "inputs.json").read_text())["files"]}
    zpath = CACHE / "voynichese_data.zip"
    if not zpath.exists() or sha(zpath) != inputs["voynichese_data.zip"]["sha256"]:
        raise SystemExit("run tools/text/fetch.py first (voynichese_data.zip)")
    z = zipfile.ZipFile(zpath)
    vps = sorted(n[5:-4] for n in z.namelist() if re.match(r"data/f.*\.xml$", n))
    fetch(vps)
    codex = json.loads((ROOT / "data" / "codex.json").read_text())
    seg_of = {}
    for s in codex["sheets"]:
        for f in ("inside", "outside"):
            for row in s[f]:
                for sg in row:
                    if not sg.get("missing"):
                        seg_of.setdefault(sg["page"], sg)
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()                                    # (pages.json too: it is written again at the end)
    report = []
    for vp in vps:
        page = RENAME.get(vp, vp)
        pfile = ROOT / "data" / "text" / "pages" / f"{page}.json"
        seg = seg_of.get(page)
        if not pfile.exists() or not seg:
            report.append((page, "no page", 0, 0, 0)); continue
        words = xml_words(z, vp)
        fit = frame_fit(words, json.loads((VC / f"{vp}.js").read_text()))
        if not fit:
            report.append((page, "frames differ", 0, 0, len(words))); continue
        ax, ay, ferr = fit
        big = cv2.imread(str(VC / f"{vp}.jpg"))
        pan = cv2.imread(str(ROOT / "data" / "panels" / f"{seg['img']}_l.jpg"))
        s = big.shape[0] / pan.shape[0]
        H, inl = homography(big, cv2.resize(pan, None, fx=s, fy=s, interpolation=cv2.INTER_AREA))
        if H is None or inl < MIN_INLIERS:
            report.append((page, "photo not matched", inl, 0, len(words))); continue
        Hp = np.diag([1 / s, 1 / s, 1]) @ H
        PH, PW = pan.shape[:2]
        loci = json.loads(pfile.read_text())["loci"]
        toks = vt_tokens(loci)
        pairs = align([w[5] for w in words], [t["text"] for t in toks])
        per = {}
        for i, j in pairs:
            _, x, y, w, h, _s = words[i]
            pts = np.float32([[np.polyval(ax, x), np.polyval(ay, y)], [np.polyval(ax, x + w), np.polyval(ay, y)],
                              [np.polyval(ax, x + w), np.polyval(ay, y + h)], [np.polyval(ax, x), np.polyval(ay, y + h)]])
            q = cv2.perspectiveTransform(pts.reshape(-1, 1, 2), Hp).reshape(-1, 2)
            x0, y0 = q.min(0); x1, y1 = q.max(0)
            refs = toks[j]["refs"]
            # a box over several consensus words (VT joins them) is shared out along its width by their lengths
            ws = [readings.word_text(loci[li], wi) for li, wi in refs]
            tot = sum(max(1, len(t)) for t in ws)
            acc = 0
            for (li, wi), t in zip(refs, ws):
                f0, f1 = acc / tot, (acc + max(1, len(t))) / tot
                acc += max(1, len(t))
                bx = (x0 + (x1 - x0) * f0, y0, x0 + (x1 - x0) * f1, y1)
                old = per.get((li, wi))
                per[(li, wi)] = bx if not old else (min(old[0], bx[0]), min(old[1], bx[1]), max(old[2], bx[2]), max(old[3], bx[3]))
        k = lambda v, d: int(round(max(0, min(1, v / d)) * 1000))
        out = [[li, wi, k(b[0], PW), k(b[1], PH), max(1, k(b[2] - b[0], PW)), max(1, k(b[3] - b[1], PH))]
               for (li, wi), b in sorted(per.items())]
        nwords = sum(len(l["c"].split(".")) for l in loci)
        (OUT / f"{page}.json").write_text(json.dumps({"page": page, "img": seg["img"], "credit": CREDIT, "words": out},
                                                     separators=(",", ":")) + "\n")
        report.append((page, "ok", inl, len(out), nwords))
        print(page, "inliers", inl, "boxes", len(out), "of", nwords, "frame err", round(ferr, 1))
    # the pages that have boxes, so the site asks only for those
    (OUT / "pages.json").write_text(json.dumps(sorted(r[0] for r in report if r[1] == "ok"), separators=(",", ":")) + "\n")
    write_report(report)


def write_report(rows):
    ok = [r for r in rows if r[1] == "ok"]
    lines = ["# Word boxes on the photographs", "",
             "Built by `tools/text/boxes.py` from The Voynichese Project's word boxes (2014, Apache License 2.0), fitted to the "
             "site's page crops of Yale's photographs. A word with a box can be pointed at on the page.", "",
             f"- Pages with boxes: **{len(ok)}**; words with a box: **{sum(r[3] for r in ok):,}** of {sum(r[4] for r in ok):,} "
             f"on those pages ({100 * sum(r[3] for r in ok) / max(1, sum(r[4] for r in ok)):.1f}%).",
             "- Pages without: " + (", ".join(f"{r[0]} ({r[1]})" for r in rows if r[1] != "ok") or "none") + ".", "",
             "| Page | Fit (matched features) | Words with a box | Words |", "|---|---|---|---|"]
    lines += [f"| {r[0]} | {r[2]} | {r[3]} | {r[4]} |" for r in ok]
    (ROOT / "docs" / "text" / "boxes.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
