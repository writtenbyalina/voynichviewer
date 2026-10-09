"""Review sheet for `build_font.py --sheet`: an HTML page (open it in a browser, or screenshot it) showing every added
glyph with how it was made, every kerned pair before and after, and some words in both fonts."""
from __future__ import annotations

import html
from pathlib import Path

# words that the kerning changes most, as STA glyphs, with their Eva
WORDS = [("pchedy", "P1 K1 J1 B1 A2"), ("qopchedy", "D1 A1 P1 K1 J1 B1 A2"), ("opaiin", "A1 P1 A3 G1"),
         ("fchol", "P2 K1 A1 B2"), ("pcheol", "P1 K1 J1 A1 B2"), ("shopchey", "L1 A1 P1 K1 J1 A2"),
         ("polaiin", "P1 A1 B2 A3 G1"), ("ofchey", "A1 P2 K1 J1 A2"), ("qokeedy", "D1 A1 Q1 K2 B1 A2"),
         ("ykpar", "A2 Q1 P1 A3 C1")]


def sheet(glyphs: dict, recipes: dict, pairs: dict, cmap_rev: dict, out: Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    esc = html.escape

    def text(codes: str) -> str:
        return "".join(glyphs[c]["ch"] for c in codes.split())

    added = sorted((c for c in glyphs if glyphs[c]["kind"] != "v101" or c in recipes), key=lambda c: (glyphs[c]["kind"], c))
    cells = "".join(
        f'<div class="g {glyphs[c]["kind"]}"><span class="new">{esc(glyphs[c]["ch"])}</span>'
        f'<span class="lab">{c} · {esc(glyphs[c].get("eva", ""))}</span><span class="kind" title="{esc(glyphs[c].get("note", ""))}">{glyphs[c]["kind"]}</span></div>'
        for c in added)
    kerned = sorted(pairs.items(), key=lambda kv: kv[1])
    rows = "".join(
        f'<div class="k"><span class="old">{esc(cmap_rev[a] + cmap_rev[b])}</span><span class="new">{esc(cmap_rev[a] + cmap_rev[b])}</span>'
        f'<span class="lab">{v:+d}</span></div>' for (a, b), v in kerned)
    words = "".join(
        f'<div class="w"><span class="lab">{esc(e)}</span><span class="old">{esc(text(s))}</span><span class="new">{esc(text(s))}</span></div>'
        for e, s in WORDS if all(c in glyphs for c in s.split()))
    out.write_text(f"""<!doctype html><meta charset="utf-8"><title>Voynich VV review</title><style>
@font-face{{font-family:Old;src:url(../src/voynich-1.23-webfont.ttf)}}
@font-face{{font-family:New;src:url(../../../assets/fonts/voynich-vv.woff2)}}
body{{margin:0;padding:20px;background:#fff;color:#1f2328;font:13px/1.4 -apple-system,system-ui,sans-serif;width:1360px}}
h2{{font-size:15px;margin:18px 0 8px}} .note{{color:#646b73;margin-bottom:8px}}
.old{{font-family:Old;font-size:40px;color:#8a8f96}} .new{{font-family:New;font-size:40px}}
.grid{{display:grid;grid-template-columns:repeat(12,1fr);gap:6px}}
.g{{border:1px solid #d9d5cc;border-radius:6px;display:flex;flex-direction:column;align-items:center;padding:4px}}
.g.drawn{{background:#eef8f1}} .g.joined{{background:#eef4ff}} .g.illegible{{background:#f3f3f3}}
.lab{{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#646b73}} .kind{{font-size:10px;color:#646b73}}
.kgrid{{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}}
.k{{border:1px solid #d9d5cc;border-radius:6px;display:grid;grid-template-columns:1fr 1fr;align-items:center;justify-items:center;padding:4px}}
.k .lab{{grid-column:1/-1}}
.w{{display:grid;grid-template-columns:120px 1fr 1fr;align-items:center;border-bottom:1px solid #eee}}
.w .old,.w .new{{font-size:44px}}
</style>
<h2>{len(added)} glyphs added</h2><div class="note">White: drawn by Claston (a rare v101 character or two side by side). Blue: joined from his shapes. Green: cut and joined from his outlines (draw.py). Grey: illegible in the manuscript.</div>
<div class="grid">{cells}</div>
<h2>{len(pairs)} kerned pairs: grey before, black after (font units, 2048 to the em)</h2><div class="kgrid">{rows}</div>
<h2>Words: grey before, black after</h2>{words}""")
