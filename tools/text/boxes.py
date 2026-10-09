#!/usr/bin/env python3
"""Where each word is on the page photographs: voynichese.com's word boxes, fitted to Voynich Viewer's page crops.

  python3 tools/text/boxes.py            # needs opencv-python-headless and numpy; writes data/text/boxes/<page>.json

The Voynichese Project (2014) bound every word of its transcription to a box on the Beinecke's photographs, and
published the boxes as XML under the Apache License 2.0 (voynichese_data.zip, pinned in inputs.json). Its boxes are in
the frame of each page's full photograph scaled to 1,500 px tall. To put them on this site's pages:

  1. the frame of the site's own page images (636 x 900, data/folio/image/glance/...) is fitted to the XML frame from
     the two sets of boxes, which are the same boxes (data/folio/script/<page>.js, word for word);
  2. that image is matched to this site's crop of Yale's photograph (data/panels/<img>_l.jpg) by SIFT features and a
     RANSAC homography; of a foldout page's panels, the one it matches best;
  3. each box's corners go through both, and are kept in thousandths of the panel image's width and height;
  4. each of its words is lined up with the voynichese.com transcription in data/text (VT, Takahashi's) and so with
     the consensus words (wordmatch.py): a box belongs to the consensus word(s) it covers;
  5. a foldout page's words go on whichever of its panels shows them, each panel with its own fit, or on the next
     page's panel cut from the same photograph of Yale's where a ring runs over the cut; a panel its 636 x 900 image
     does not show gets none (carried across that far, boxes land up to a line or a word off).

Each page's file: {"page", "imgs": [its panels], "credit", "words": [[locus, word, x, y, w, h(, estimated, panel)]]},
estimated 1 where a word has no box of voynichese.com's and its place is estimated from its line's words around it,
panel an index into imgs (0 when left out; imgs lists every panel the page's words sit on, which can include a
neighbouring page's).

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
import wordmatch  # noqa: E402


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
        if W > 0 and H > 0 and X > 0 and Y > 0:        # not cut away at the frame's edge (to nothing, at 0)
            A.append((x, x + w, y, y + h)); B.append((X, X + W, Y, Y + H))
    if len(A) < 3:
        return None
    A, B = np.array(A), np.array(B)
    ax = np.polyfit(A[:, :2].ravel(), B[:, :2].ravel(), 1)
    ay = np.polyfit(A[:, 2:].ravel(), B[:, 2:].ravel(), 1)
    err = max(np.abs(np.polyval(ax, A[:, :2]) - B[:, :2]).max(), np.abs(np.polyval(ay, A[:, 2:]) - B[:, 2:]).max())
    return ax, ay, float(err)


NEAR = 150                                              # thousandths past a panel's edge: looked for on the next
FOLD = 15                                               # thousandths: a word centred this far past the edge, in the fold
MAX_FRAME_ERR = 12                                      # px in its page image: more, and the two frames disagree

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


def register_elsewhere(words, idx, sg):
    """voynichese.com's boxes words[idx] (its XML frame) laid on panel sg, which its photo does not show: the scale and
    translation where the boxes cover the most ink, then an affine refinement (ECC) of the boxes against the ink. Returns the XML -> panel-pixel affine
    (2x3), or None when the boxes do not settle onto the ink convincingly."""
    import inkfit
    pan = cv2.imread(str(ROOT / "data" / "panels" / f"{sg['img']}_l.jpg"))
    H, W = pan.shape[:2]
    ink = inkfit.ink_map(pan).astype(np.float32)
    ws = [words[i] for i in idx]
    A = np.array([w[1:5] for w in ws], float)
    best = None
    for sc in np.linspace(0.6, 1.3, 36):
        x0 = A[:, 0].min() * sc
        mh, mw = int((A[:, 1] + A[:, 3]).max() * sc) + 4, int((A[:, 0] + A[:, 2]).max() * sc - x0) + 4
        if mh >= H or mw >= W:
            continue
        mask = np.zeros((mh, mw), np.float32)
        for x, y, w, h in A:
            cv2.rectangle(mask, (int(x * sc - x0), int(y * sc)), (int((x + w) * sc - x0), int((y + h) * sc)), 1.0, -1)
        mask -= mask.mean()
        res = cv2.matchTemplate(ink, mask, cv2.TM_CCORR)
        _, mx, _, loc = cv2.minMaxLoc(res)
        mx /= np.sqrt((mask ** 2).sum())
        if best is None or mx > best[0]:
            best = (mx, sc, loc, x0)
    if best is None:
        return None
    _mx, sc, (lx, ly), x0 = best
    M0 = np.float32([[sc, 0, lx - x0], [0, sc, ly]])

    def render(M):
        m = np.zeros((H, W), np.float32)
        for x, y, w, h in A:
            cv2.fillConvexPoly(m, np.int32(cv2.transform(np.float32([[[x, y]], [[x + w, y]], [[x + w, y + h]], [[x, y + h]]]), M).reshape(-1, 2)), 1.0)
        return m
    Wm, cc = np.eye(2, 3, dtype=np.float32), 0.0
    T0 = render(M0)
    for sig in (12, 6, 3):
        try:
            cc, Wm = cv2.findTransformECC(cv2.GaussianBlur(T0, (0, 0), sig), cv2.GaussianBlur(ink, (0, 0), sig), Wm,
                                          cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
        except cv2.error:
            return None
    if cc < 0.25:
        return None
    return (np.vstack([Wm, [0, 0, 1]]) @ np.vstack([M0, [0, 0, 1]]))[:2].astype(np.float32)


def to_photo(sg):
    """A panel's thousandths -> Yale's photograph (pixels of the full-size image), and back: its quad's corners."""
    quad = np.float32(sg["quad"])
    unit = np.float32([[0, 0], [1000, 0], [1000, 1000], [0, 1000]])
    if (sg.get("rotate") or 0) % 360 == 180:           # served turned half round
        unit = unit[[2, 3, 0, 1]]
    return cv2.getPerspectiveTransform(unit, quad), cv2.getPerspectiveTransform(quad, unit)


def estimate(per: dict, loci, off=(), size=None) -> dict:
    """Boxes for the words of a line that have none, between (or after) the words of the same line that have one:
    along the line from one to the next, as wide as their glyphs. Marked as estimated. Not for words known to be on
    another panel (off), nor where the estimate falls off this one (size: its width and height)."""
    est = {}
    for li, loc in enumerate(loci):
        ws = loc["c"].split(".")
        have = [wi for wi in range(len(ws)) if (li, wi) in per]
        if not have or len(have) == len(ws):
            continue
        c = lambda b: np.array([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])
        glyph_w = np.mean([(per[(li, wi)][2] - per[(li, wi)][0]) / max(1, len(ws[wi])) for wi in have])
        hgt = np.mean([per[(li, wi)][3] - per[(li, wi)][1] for wi in have])
        if len(have) > 1:   # the way the line runs, from its first boxed word to its last
            a, b = c(per[(li, have[0])]), c(per[(li, have[-1])])
            step = (b - a) / max(1, sum(len(ws[x]) + 1 for x in range(have[0], have[-1])))
        else:
            step = np.array([glyph_w, 0.0])
        for wi in range(len(ws)):
            if (li, wi) in per or (li, wi) in off:
                continue
            prev = max((x for x in have if x < wi), default=None)
            nxt = min((x for x in have if x > wi), default=None)
            if prev is not None and nxt is not None:   # between two: shared out along the gap by glyph counts
                pa, pb = per[(li, prev)], per[(li, nxt)]
                a, b = np.array([pa[2], (pa[1] + pa[3]) / 2]), np.array([pb[0], (pb[1] + pb[3]) / 2])
                lens = [len(ws[x]) + 1 for x in range(prev + 1, nxt)]
                before = sum(lens[:wi - prev - 1])
                f0, f1 = before / sum(lens), (before + lens[wi - prev - 1]) / sum(lens)
                p0, p1 = a + (b - a) * f0, a + (b - a) * f1
            elif prev is not None:                      # after the last: on along the line
                pa = per[(li, prev)]
                start = sum(len(ws[x]) + 1 for x in range(prev + 1, wi))
                o = np.array([pa[2], (pa[1] + pa[3]) / 2]) + step * start
                p0, p1 = o, o + step * len(ws[wi])
            else:                                       # before the first: back along the line
                pb = per[(li, nxt)]
                start = sum(len(ws[x]) + 1 for x in range(wi + 1, nxt)) + 1
                o = np.array([pb[0], (pb[1] + pb[3]) / 2]) - step * start
                p0, p1 = o - step * len(ws[wi]), o
            # a word's own size, about where it falls: as wide as its glyphs, as tall as its line's words
            cx, cy = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
            half = glyph_w * max(1, len(ws[wi])) / 2
            if size and not (0 <= cx <= size[0] and 0 <= cy <= size[1]):
                continue
            est[(li, wi)] = (cx - half, cy - hgt / 2, cx + half, cy + hgt / 2)
    return est


def main():
    inputs = {f["name"]: f for f in json.loads((HERE / "inputs.json").read_text())["files"]}
    zpath = CACHE / "voynichese_data.zip"
    if not zpath.exists() or sha(zpath) != inputs["voynichese_data.zip"]["sha256"]:
        raise SystemExit("run tools/text/fetch.py first (voynichese_data.zip)")
    z = zipfile.ZipFile(zpath)
    vps = sorted(n[5:-4] for n in z.namelist() if re.match(r"data/f.*\.xml$", n))
    fetch(vps)
    codex = json.loads((ROOT / "data" / "codex.json").read_text())
    all_segs = []
    segs_of = {}                                        # page -> its panels (a foldout's page can have several)
    for s in codex["sheets"]:
        for f in ("inside", "outside"):
            for row in s[f]:
                for sg in row:
                    if not sg.get("missing") and not sg.get("custom") and sg.get("quad"):
                        segs_of.setdefault(sg["page"], []).append(sg)
                        all_segs.append(sg)
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])                            # boxes.py f70r2 f57v: just those pages, to look at
    if only:
        vps = [v for v in vps if RENAME.get(v, v) in only]
    else:
        for old in OUT.glob("*.json"):
            old.unlink()                                # (pages.json too: it is written again at the end)
    report, quality = [], {}
    for vp in vps:
        page = RENAME.get(vp, vp)
        pfile = ROOT / "data" / "text" / "pages" / f"{page}.json"
        segs = segs_of.get(page)
        if not pfile.exists() or not segs:
            report.append((page, "no page", 0, 0, 0, 0, 0)); continue
        words = xml_words(z, vp)
        script = json.loads((VC / f"{vp}.js").read_text())
        fit = frame_fit(words, script)
        if not fit or fit[2] > MAX_FRAME_ERR:
            report.append((page, "frames differ", 0, 0, len(words), 0, 0)); continue
        ax, ay, ferr = fit
        big = cv2.imread(str(VC / f"{vp}.jpg"))
        fits = []                                       # voynichese.com's photo against each of the page's panels
        for sg in segs:
            pan = cv2.imread(str(ROOT / "data" / "panels" / f"{sg['img']}_l.jpg"))
            s = big.shape[0] / pan.shape[0]
            H, inl = homography(big, cv2.resize(pan, None, fx=s, fy=s, interpolation=cv2.INTER_AREA))
            if H is not None:
                fits.append((inl, sg, np.diag([1 / s, 1 / s, 1]) @ H, pan.shape[1], pan.shape[0]))
        fits = sorted((f for f in fits if f[0] >= MIN_INLIERS), key=lambda f: -f[0])
        if not fits:
            report.append((page, "photo not matched", max((f[0] for f in fits), default=0), 0, len(words), 0, 0)); continue
        inl = fits[0][0]
        loci = json.loads(pfile.read_text())["loci"]
        xml = []
        for _, x, y, w, h, t in words:
            xml.append((t, x + w / 2, y + h / 2, h))
        got, toks = wordmatch.match(xml, loci)
        quality[page] = wordmatch.match.quality
        corners = lambda x, y, w, h: np.float32([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])

        def on_panel(xi, fit):
            """voynichese.com's box (XML frame) -> a panel, in thousandths; None where the fit folds over (far
            beyond what it was measured on)"""
            _inl, _sg, Hp, PW, PH = fit
            _, x, y, w, h, _s = words[xi]
            c = corners(x, y, w, h)
            pts = np.stack([np.polyval(ax, c[:, 0]), np.polyval(ay, c[:, 1])], 1).astype(np.float32)
            if (np.c_[pts, np.ones(4)] @ Hp[2] <= 0).any():
                return None
            q = cv2.perspectiveTransform(pts.reshape(-1, 1, 2), Hp).reshape(-1, 2)
            return q / [PW, PH] * 1000

        def shown(q):
            """how much of a box (thousandths of a panel) lies on the panel"""
            (x0, y0), (x1, y1) = q.min(0), q.max(0)
            return max(0, min(x1, 1000) - max(x0, 0)) * max(0, min(y1, 1000) - max(y0, 0)) / max(1e-9, (x1 - x0) * (y1 - y0))

        # Each word goes on the panel that shows most of it (at least a tenth, or any of it if it sinks into the fold
        # just past the edge; the box is then cut to the panel's edge). Every panel of the page that voynichese.com's photo shows has its own fit; through Yale's
        # photograph the word can also land on a neighbouring page's panel cut from the same photograph (a ring running
        # over the cut between two pages of a foldout). A panel its photo does not show gets no boxes: carried across
        # that far they land up to a line or a word off.
        near = [sg for sg in all_segs if sg["page"] != page and sg.get("iiif") == fits[0][1].get("iiif")
                and (sg.get("rotate") or 0) % 180 == 0]
        placed = {}                                     # (locus, token) -> (panel's seg, corners in thousandths)
        for kj, xi in got.items():
            best = None
            for fit in fits:
                qs = [on_panel(one, fit) for one in (xi if isinstance(xi, tuple) else (xi,))]
                if any(q is None for q in qs):
                    break
                q = np.concatenate(qs)
                tries = [(fit[1], q)]
                if shown(q) < 1 and near and (-NEAR < q.mean(0)).all() and (q.mean(0) < 1000 + NEAR).all():
                    photo = cv2.perspectiveTransform(q.reshape(-1, 1, 2).astype(np.float32), to_photo(fit[1])[0])
                    tries += [(sg, cv2.perspectiveTransform(photo, to_photo(sg)[1]).reshape(-1, 2)) for sg in near]
                for sg, qq in tries:
                    c = qq.mean(0)
                    ok = shown(qq) >= .1 or (shown(qq) > 0 and (-FOLD < c).all() and (c < 1000 + FOLD).all())
                    if ok and (best is None or shown(qq) > best[0]):
                        best = (shown(qq), sg, qq)
            if best:
                placed[kj] = best[1:]
        # a panel of the page that voynichese.com's photo leaves out (f101v's left half): its words' layout, as the XML
        # has it, laid on that panel's ink (register_elsewhere); their boxes are rough, so marked estimated, and
        # inkfit.py later fits them to the ink
        rough = set()
        left = [kj for kj in got if kj not in placed]
        others = [sg for sg in segs if all(sg is not f[1] for f in fits)]
        if left and others and placed:
            idx = sorted({x for kj in left for x in (got[kj] if isinstance(got[kj], tuple) else (got[kj],))})
            for sg in others:
                M = register_elsewhere(words, idx, sg)
                if M is None:
                    continue
                pan2 = cv2.imread(str(ROOT / "data" / "panels" / f"{sg['img']}_l.jpg"))
                PH2, PW2 = pan2.shape[:2]
                for kj in left:
                    if kj in placed:
                        continue
                    qs = []
                    for one in (got[kj] if isinstance(got[kj], tuple) else (got[kj],)):
                        _, x, y, w, h, _s = words[one]
                        qs.append(cv2.transform(corners(x, y, w, h).reshape(-1, 1, 2), M).reshape(-1, 2))
                    q = np.concatenate(qs) / [PW2, PH2] * 1000
                    if shown(q) >= .5:
                        placed[kj] = (sg, q)
                        rough.update(toks[kj[0]][kj[1]]["refs"])
                print(f"  {page}: {sum(1 for v in placed.values() if v[0] is sg)} words laid on {sg['img']} by their layout")
        panels = [f[1] for f in fits if any(sg is f[1] for sg, _q in placed.values())]
        panels += [sg for sg in near if any(x is sg for x, _q in placed.values())]
        panels += [sg for sg in segs if sg not in panels and any(x is sg for x, _q in placed.values())]
        placed = {kj: (next(n for n, p in enumerate(panels) if p is sg), q) for kj, (sg, q) in placed.items()}
        if not panels:
            report.append((page, "no word on its panels", inl, 0, len(words), 0, 0)); continue
        # the boxes, by panel; a box over several consensus words (VT joins them) is shared out along its width by
        # their lengths
        per = [{} for _ in panels]
        for kj, (pi, q) in placed.items():
            x0, y0 = q.min(0); x1, y1 = q.max(0)
            refs = toks[kj[0]][kj[1]]["refs"]
            ws = [readings.word_text(loci[li], wi) for li, wi in refs]
            tot = sum(max(1, len(t)) for t in ws)
            acc = 0
            for (li, wi), t in zip(refs, ws):
                f0, f1 = acc / tot, (acc + max(1, len(t))) / tot
                acc += max(1, len(t))
                bx = (x0 + (x1 - x0) * f0, y0, x0 + (x1 - x0) * f1, y1)
                old = per[pi].get((li, wi))
                per[pi][(li, wi)] = bx if not old else (min(old[0], bx[0]), min(old[1], bx[1]), max(old[2], bx[2]), max(old[3], bx[3]))
        # a word written across the fold, in two of voynichese.com's boxes, one on each panel: on the one with more of it
        for pi in range(1, len(per)):
            for w in [w for w in per[pi] if any(w in per[pj] for pj in range(pi))]:
                pj = next(pj for pj in range(pi) if w in per[pj])
                a, b = per[pi][w], per[pj][w]
                del (per[pj] if (a[2] - a[0]) > (b[2] - b[0]) else per[pi])[w]
        # words that voynichese.com places but not on any of these panels: no estimate for them
        off = {r for kj, xi in got.items() if kj not in placed for r in toks[kj[0]][kj[1]]["refs"]}
        k = lambda v: int(round(max(0, min(1000, v))))
        out, n_est = [], 0
        for pi, pp in enumerate(per):
            # (an estimate goes only where its line has words on this panel, and not onto a word placed on another)
            elsewhere = off | {w for pj, o in enumerate(per) if pj != pi for w in o}
            est = estimate(pp, loci, elsewhere, (1000, 1000))
            est.update({w: pp[w] for w in pp if w in rough})          # laid by layout only: as estimated
            n_est += len(est)
            for (li, wi), b in {**pp, **est}.items():
                out.append([li, wi, k(b[0]), k(b[1]), max(1, k(b[2] - b[0])), max(1, k(b[3] - b[1]))]
                           + ([1 if (li, wi) in est else 0, pi] if pi else [1] if (li, wi) in est else []))
        out.sort()
        nwords = sum(len(l["c"].split(".")) for l in loci)
        (OUT / f"{page}.json").write_text(json.dumps({"page": page, "imgs": [sg["img"] for sg in panels],
                                                      "credit": CREDIT, "words": out}, separators=(",", ":")) + "\n")
        report.append((page, "ok", inl, len(out), nwords, n_est, len(off - {(r[0], r[1]) for r in out})))
        print(page, "inliers", inl, "boxes", len(out), "of", nwords, "estimated", n_est, "frame err", round(ferr, 1),
              "panels", len({r[7] if len(r) > 7 else 0 for r in out}))
    jumps = check_jumps(only or None)
    q = {k: sum(v[k] for v in quality.values()) for k in ("exact", "matched")}
    print(f"matched {q['matched']}, exactly {q['exact']} ({100 * q['exact'] / max(1, q['matched']):.1f}%); jumps {len(jumps)}")
    for j in jumps[:30]:
        print("  jump", *j)
    if only:
        return
    # the pages that have boxes, so the site asks only for those
    (OUT / "pages.json").write_text(json.dumps(sorted(r[0] for r in report if r[1] == "ok"), separators=(",", ":")) + "\n")
    write_report(report)


def check_jumps(pages=None):
    """Words of one line whose boxes are far apart: next-door words more than five word-heights from each other, a
    sign that a box went to the wrong word. Rings and radii bend, so they get a wider allowance."""
    out = []
    for f in sorted(OUT.glob("f*.json")):
        b = json.loads(f.read_text())
        if pages and b["page"] not in pages:
            continue
        loci = json.loads((ROOT / "data" / "text" / "pages" / f"{b['page']}.json").read_text())["loci"]
        by = {}
        for row in b["words"]:                          # (a line across a foldout's panels: each panel's part alone)
            by.setdefault((row[0], row[7] if len(row) > 7 else 0), {})[row[1]] = row
        for (li, _panel), ws in by.items():
            hs = sorted(r[5] for r in ws.values())
            hmed = hs[len(hs) // 2] or 1
            allow = 8 if loci[li]["t"][0] in "CR" else 5
            for wi in sorted(ws):
                if wi + 1 in ws:
                    a, c = ws[wi], ws[wi + 1]
                    gap = max(c[2] - (a[2] + a[4]), a[2] - (c[2] + c[4]), c[3] - (a[3] + a[5]), a[3] - (c[3] + c[5]), 0)
                    if gap > allow * hmed:
                        out.append((b["page"], loci[li]["id"], wi + 1, gap, hmed))
    return out


def write_report(rows):
    ok = [r for r in rows if r[1] == "ok"]
    lines = ["# Word boxes on the photographs", "",
             "Built by `tools/text/boxes.py` from The Voynichese Project's word boxes (2014, Apache License 2.0), fitted to the "
             "site's page crops of Yale's photographs. A word with a box can be pointed at on the page.", "",
             f"- Pages with boxes: **{len(ok)}**; words with a box: **{sum(r[3] for r in ok):,}** of {sum(r[4] for r in ok):,} "
             f"on those pages ({100 * sum(r[3] for r in ok) / max(1, sum(r[4] for r in ok)):.1f}%), "
             f"{sum(r[5] for r in ok):,} of them estimated between the words around them.",
             "- Pages without: " + (", ".join(f"{r[0]} ({r[1]})" for r in rows if r[1] != "ok") or "none")
             + "; and the pages voynichese.com has no boxes for: "
             + ", ".join(sorted({f.stem for f in (ROOT / "data" / "text" / "pages").glob("*.json")} - {r[0] for r in rows})) + ".",
             "- Words on a foldout's panel that voynichese.com's photograph leaves out (no box): "
             + (", ".join(f"{r[0]} ({r[6]})" for r in ok if r[6]) or "none") + ".", "",
             "| Page | Fit (matched features) | Words with a box | Estimated | Words |", "|---|---|---|---|---|"]
    lines += [f"| {r[0]} | {r[2]} | {r[3]} | {r[5]} | {r[4]} |" for r in ok]
    (ROOT / "docs" / "text" / "boxes.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
