#!/usr/bin/env python3
"""Refresh the viewer's page data and images from a local Voynich Scout checkout.

The physical model (sheets, quires, panels, page variables, Davis's folio table) and the panel images are made by
Scout (`scout codex-build`, with its crop editor). This copies what the viewer needs into this repository:

  data/codex.json      sheets, quires, folio table and image attribution; for each panel its photograph (Yale's IIIF
                       image id and size) and the corners it is cut from, which the in-browser crop editor starts from
  data/panels/         one large (_l, 1400 px tall) and one small (_s, 300 px) JPEG per panel face

The reading orders, sources and evidence notes are NOT imported: they live in data/orders.json and are edited by hand.

  python3 tools/import_from_scout.py                     # Scout at ~/voynich/scout
  python3 tools/import_from_scout.py --scout PATH --dry-run
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEEP_SEG = ("page", "img", "label", "missing", "blank", "vars", "scribes", "section", "w", "h", "v", "src_size", "quad", "rotate")
KEEP_SHEET = ("id", "quire", "leaves", "missing", "inside", "outside", "spine", "proper_row", "read")


def panel(seg: dict) -> dict:
    out = {k: seg[k] for k in KEEP_SEG if k in seg}
    if "source" in seg:   # "002_1r_1006076.jpg": the last number is the photograph's id on Yale's IIIF image server
        m = re.search(r"_(\d+)\.jpg$", seg["source"])
        if not m:
            raise SystemExit(f"cannot read a Yale image id from {seg['source']}")
        out["iiif"] = m.group(1)
    return out


def slim(d: dict) -> dict:
    sheets = []
    for sh in d["sheets"]:
        s = {k: sh[k] for k in KEEP_SHEET if k in sh}
        for face in ("inside", "outside"):
            s[face] = [[panel(seg) for seg in row] for row in sh[face]]
        sheets.append(s)
    return {"sheets": sheets, "quires": d["quires"], "folio_table": d["folio_table"], "attribution": d.get("attribution", "")}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--scout", type=Path, default=Path.home() / "voynich" / "scout", help="the Scout checkout (default ~/voynich/scout)")
    ap.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    a = ap.parse_args()

    src = a.scout / "data" / "codex"
    d = json.loads((src / "codex.json").read_text())
    out = slim(d)
    keys = sorted({seg["img"] for sh in out["sheets"] for f in ("inside", "outside") for row in sh[f] for seg in row if "img" in seg})

    panels = ROOT / "data" / "panels"
    copy, missing = [], []
    for k in keys:
        for size in ("l", "s"):
            f = src / "panels" / f"{k}_{size}.jpg"
            if not f.exists():
                missing.append(f.name); continue
            dst = panels / f.name
            if not dst.exists() or dst.read_bytes() != f.read_bytes():
                copy.append((f, dst))
    stale = sorted(p.name for p in panels.glob("*.jpg") if p.stem.rsplit("_", 1)[0] not in keys) if panels.exists() else []

    print(f"{len(out['sheets'])} sheets, {len(keys)} panel faces; {len(copy)} images new or changed; {len(stale)} no longer used")
    if missing:
        raise SystemExit(f"missing in Scout (run `scout codex-build`): {', '.join(missing[:10])}{' …' if len(missing) > 10 else ''}")
    if a.dry_run:
        return
    panels.mkdir(parents=True, exist_ok=True)
    for f, dst in copy:
        shutil.copyfile(f, dst)
    for name in stale:
        (panels / name).unlink()
    (ROOT / "data" / "codex.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print("wrote data/codex.json and data/panels/")


if __name__ == "__main__":
    main()
