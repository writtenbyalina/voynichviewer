#!/usr/bin/env python3
"""Fetch the inputs of build.py (inputs.json) into tools/text/cache, checking every file's sha256.

  python3 tools/text/fetch.py                    # download from voynich.nu
  python3 tools/text/fetch.py --from ~/voynich/raw ~/voynich/sta   # copy from folders that already hold them

A file whose checksum differs is refused: Zandbergen updates his files from time to time, and the data in
data/text/ must say exactly which versions it was built from. To move to a newer file, change its sha256 in
inputs.json on purpose, rebuild, and read the report.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="src", nargs="*", default=[], help="folders to copy from instead of downloading")
    args = ap.parse_args()
    CACHE.mkdir(exist_ok=True)
    for f in json.loads((HERE / "inputs.json").read_text())["files"]:
        dest = CACHE / f["name"]
        if dest.exists() and sha(dest) == f["sha256"]:
            continue
        local = [Path(d).expanduser() / f["name"] for d in args.src]
        found = next((p for p in local if p.exists() and sha(p) == f["sha256"]), None)
        if found:
            shutil.copyfile(found, dest)
        else:
            with urllib.request.urlopen(f["url"], timeout=60) as r:
                dest.write_bytes(r.read())
        if sha(dest) != f["sha256"]:
            dest.unlink()
            raise SystemExit(f"{f['name']}: sha256 differs from inputs.json; not used")
        print("ok", f["name"])
    print("all inputs in", CACHE.relative_to(HERE.parent.parent))


if __name__ == "__main__":
    main()
