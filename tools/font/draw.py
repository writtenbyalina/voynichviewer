"""The rare glyphs that `build_font.py` draws, cut and joined from Glen Claston's own outlines.

Claston drew each glyph as one outline (the loops are holes in it), so a stroke cannot simply be lifted out. Here a
part is cut from one of his glyphs with a rectangle (a gallows leg, the loop above a bench, the plume of sh, the
teardrop of e'), moved or scaled, and united with others, so every new glyph is made of his strokes, assembled the way
the rare form is built. The structure of each form follows Zandbergen's stroke alphabet (aaa, in `STA-aaa.bit` on
voynich.nu) and the pictures in his STA definition; nothing is copied from any other font. Coordinates are font units
(2048 to the em, baseline at 0, a bench's bar at about y 470-600).

Each recipe returns a path; `glyphs(font)` returns {STA code: (path, note)}.
"""
from __future__ import annotations

import math

import pathops
from fontTools.pens.transformPen import TransformPen

BIG = 4000


class Parts:
    def __init__(self, font):
        self.gs = font.getGlyphSet()
        self.cmap = font.getBestCmap()

    def __call__(self, ch: str) -> pathops.Path:
        """Claston's glyph for the character, as a path."""
        p = pathops.Path()
        self.gs[self.cmap[ord(ch)]].draw(p.getPen())
        return p


def rect(x0, y0, x1, y1) -> pathops.Path:
    p = pathops.Path()
    pen = p.getPen()
    pen.moveTo((x0, y0)); pen.lineTo((x1, y0)); pen.lineTo((x1, y1)); pen.lineTo((x0, y1)); pen.closePath()
    return p


def keep(p, x0=-BIG, y0=-BIG, x1=BIG, y1=BIG):
    """The part of p inside the rectangle."""
    return pathops.op(p, rect(x0, y0, x1, y1), pathops.PathOp.INTERSECTION, fix_winding=True)


def cut(p, x0=-BIG, y0=-BIG, x1=BIG, y1=BIG):
    """p with the rectangle cut away."""
    return pathops.op(p, rect(x0, y0, x1, y1), pathops.PathOp.DIFFERENCE, fix_winding=True)


def union(*ps):
    out = ps[0]
    for p in ps[1:]:
        out = pathops.op(out, p, pathops.PathOp.UNION, fix_winding=True)
    return out


def tf(p, a=1, b=0, c=0, d=1, e=0, f=0):
    out = pathops.Path()
    p.draw(TransformPen(out.getPen(), (a, b, c, d, e, f)))
    return out


def move(p, dx=0, dy=0):
    return tf(p, e=dx, f=dy)


def scale(p, sx, sy=None, ox=0, oy=0):
    """Scale about the point (ox, oy)."""
    sy = sx if sy is None else sy
    return tf(p, sx, 0, 0, sy, ox - sx * ox, oy - sy * oy)


def mirror(p, about=0):
    return tf(p, -1, 0, 0, 1, 2 * about, 0)


def box(p):
    return p.bounds          # (xMin, yMin, xMax, yMax)


def place(p, x=None, y=None, right=None, top=None):
    """Move p so its ink starts at x (or ends at right), and sits at y (or its top at top)."""
    x0, y0, x1, y1 = box(p)
    dx = (x - x0) if x is not None else (right - x1) if right is not None else 0
    dy = (y - y0) if y is not None else (top - y1) if top is not None else 0
    return move(p, dx, dy)


def contours(p) -> list[pathops.Path]:
    out, cur = [], pathops.Path()
    pen = cur.getPen()
    for verb, pts in p:
        if verb == pathops.PathVerb.MOVE:
            pen.moveTo(*pts)
        elif verb == pathops.PathVerb.LINE:
            pen.lineTo(*pts)
        elif verb == pathops.PathVerb.QUAD:
            pen.qCurveTo(*pts)
        elif verb == pathops.PathVerb.CUBIC:
            pen.curveTo(*pts)
        elif verb == pathops.PathVerb.CLOSE:
            pen.closePath()
            out.append(cur)
            cur = pathops.Path()
            pen = cur.getPen()
    return out


def drop_bits(p, x1, y1):
    """p without the loose pieces lying wholly left of x1 and below y1 (what a cut leaves of a c's tail)."""
    keep_ = [c for c in contours(p) if not (c.bounds[2] <= x1 and c.bounds[3] <= y1)]
    out = pathops.Path()
    for c in keep_:
        c.draw(out.getPen())
    return out


def dot(cx, cy, r=105) -> pathops.Path:
    """A round blob, the size of Claston's heaviest strokes."""
    k = 0.5523 * r
    p = pathops.Path()
    pen = p.getPen()
    pen.moveTo((cx + r, cy))
    pen.curveTo((cx + r, cy + k), (cx + k, cy + r), (cx, cy + r))
    pen.curveTo((cx - k, cy + r), (cx - r, cy + k), (cx - r, cy))
    pen.curveTo((cx - r, cy - k), (cx - k, cy - r), (cx, cy - r))
    pen.curveTo((cx + k, cy - r), (cx + r, cy - k), (cx + r, cy))
    pen.closePath()
    return p


def glyphs(font) -> dict[str, tuple[pathops.Path, str]]:
    P = Parts(font)
    bench = P("1")                                      # ch: left c, bar, right c
    bar = keep(bench, 600, 470, 1100, 594)              # a stretch of the bench's bar
    plume = keep(P("2"), 700, 650, 1150, 1600)          # the plume of sh
    leg_top = keep(P("h"), -100, 1150, 290, 1900)       # k's left leg above its crossbar: a stem with a pointed head
    stem_flag = place(leg_top, y=470)                   # standing on y 470, as on a bench's bar
    leg = keep(P("h"), -100, -100, 290, 1000)           # k's left leg below its crossbar
    e_loop = keep(P("e"), 180, 300, 700, 720)           # the loop of l, with the start of its tail
    small_c = scale(P("c"), 0.55)
    small_o = scale(P("o"), 0.6)

    def loop_on(stem):
        """A stem with l's open loop at its head, the loop's tail running into the stem."""
        x0, y0, x1, y1 = box(stem)
        return union(stem, place(e_loop, x=x0, y=y1 - 60))

    loop_stem = loop_on(place(keep(leg, -100, 300, 290, 1000), y=470))     # short, standing on a bench
    tall_loop_stem = loop_on(keep(leg, -100, -100, 290, 1000))             # gallows height
    g_noloop = union(keep(P("h"), -100, -100, 290, 1000),                       # k's left leg, below its crossbar
                     keep(P("h"), 380, -100, 760, 1000),                         # k's right stem, below its loop
                     place(keep(bench, 0, 470, 760, 594), x=40, y=980),          # joined at the top by a bar
                     place(keep(P("h"), 560, 1000, 900, 1320), x=600, y=990))    # with the start of k's loop as a hook
    k_small = union(keep(P("h"), -100, -100, 760, 1150), scale(keep(P("h"), 380, 1050, 1600, 1900), 0.55, 0.55, 600, 1100))

    def on_bench(part, at=650, base=bench):
        """Stand a part on a bench, its foot in the bar, centred at x = at."""
        x0, y0, x1, y1 = box(part)
        return union(base, move(part, at - (x0 + x1) / 2, 470 - y0))

    def no_left_c(g, x):
        """A bench without its first c: everything left of x below the bar, and the c's tail beneath."""
        return drop_bits(cut(cut(g, -BIG, -BIG, x, 640), -BIG, -BIG, min(x + 200, 690), 400), x + 320, 420)

    wedge = keep(P("™"), -60, -150, 560, 640)           # the i that starts a bench, with the bar's start
    eps = union(P("c"), keep(bench, 150, 230, 650, 330))      # c with a bar through its middle (@191;)
    eps_h = union(keep(P("Æ"), -100, 450, 700, 700), move(eps, 650 - box(eps)[0], 0))

    J = P("J")
    J_open = no_left_c(J, 470)                          # cph without its left c, keeping the bar
    i_bench = union(no_left_c(bench, 470), wedge)       # a bench begun with i
    ti = union(stem_flag, place(small_o, x=box(stem_flag)[2] - 40, top=box(stem_flag)[3] + 40))
    out: dict[str, tuple[pathops.Path, str]] = {}

    # benches with a short stem or a small loop standing on them (c@132;h and kin)
    out["Ta"] = (on_bench(stem_flag), "bench with a short stem, its head pointed (k's left leg)")
    out["Tk"] = (on_bench(scale(keep(P("k"), -300, 950, 330, 1900), 0.85)), "bench with the curled head of t's left leg")
    out["Th"] = (on_bench(scale(keep(k_small, 380, -100, 1600, 1900), 0.8)), "bench with a stem ending in a small loop (k's right stem)")
    out["Tb"] = (on_bench(loop_stem), "bench with a stem carrying l's loop")
    out["Tc"] = (on_bench(loop_stem, at=560), "bench with a looped stem, set further left")
    out["Ti"] = (on_bench(ti), "bench with a stem and a small o beside its head")
    out["Td"] = (union(cut(J, 700, 1250, 980, 1900), place(scale(leg_top, 0.8), x=760, y=1150)), "cph with a shorter, pointed left leg")
    out["Uj"] = (on_bench(g_noloop, at=930), "bench with a two-legged gallows whose loop is only a hook")
    out["Uk"] = (union(no_left_c(out["Uj"][0], 470), place(P("9"), right=520, top=640)), "the same begun with y")
    out["Rg"] = (union(keep(bench, -BIG, -BIG, 900, BIG), move(stem_flag, 650 - (box(stem_flag)[0] + box(stem_flag)[2]) / 2, 0)),
                 "c with a short pointed stem")
    out["Rf"] = (union(place(stem_flag, y=0), place(small_c, right=box(stem_flag)[0] + 170, y=0)), "a short stem with a small c at its foot")
    # cph started by i, o or y instead of c
    out["T3"] = (union(J_open, wedge), "cph begun with i (ifh's start)")
    out["To"] = (union(J_open, place(P("o"), right=520, y=5)), "cph begun with o")
    out["Tn"] = (union(J_open, place(P("9"), right=520, top=640)), "cph begun with y")
    out["Va"] = (union(J_open, wedge, place(P("Æ"), x=box(J)[2] - 420, y=-51)), "iph with another h")
    out["Ts"] = (on_bench(loop_stem, base=i_bench), "bench begun with i, with a looped stem")
    out["Tt"] = (on_bench(mirror(stem_flag), base=i_bench), "bench begun with i, with a stem pointed to the right")
    # benches with a dot for their first c (@246;), or a plume
    out["Uo"] = (union(no_left_c(P("H"), 470), dot(390, 520)), "ckh begun with a dot")
    out["Wp"] = (union(no_left_c(P("L"), 430), dot(350, 520)), "cthh begun with a dot")
    out["Sg"] = (union(no_left_c(P("v"), 430), dot(350, 520)), "ck begun with a dot")
    out["Wq"] = (union(P("H"), place(eps_h, x=box(P("H"))[2] - 560, y=-40)), "ckh followed by an epsilon-like h (@191;)")
    wr = union(no_left_c(P("H"), 470), dot(390, 520))
    wr = union(wr, place(eps_h, x=box(wr)[2] - 560, y=-40))
    out["Wr"] = (union(wr, place(eps_h, x=box(wr)[2] - 560, y=-40)), "ckh begun with a dot, then two epsilon-like h")
    out["Ud"] = (union(P("K"), place(scale(plume, 0.85), x=150, y=720)), "cth with a plume over its first c")
    out["Vc"] = (union(P("r"), place(scale(plume, 0.85), x=1720, y=700)), "cfhh with a plume over its last bench")
    out["Da"] = (union(P("4"), place(scale(plume, 0.7), x=880, y=820)), "q with a plume")
    out["Ae"] = (union(P("a"), place(scale(plume, 0.7), x=820, y=640)), "a with a plume")
    # gallows on their own: a leg, a stem with a loop or a flag
    out["Pd"] = (keep(P("h"), -100, -100, 290, 1900), "k's left leg alone: a stem with a pointed head")
    out["Pe"] = (tall_loop_stem, "a gallows stem with l's loop at its head")
    out["Pi"] = (union(leg, place(keep(bench, 0, 470, 640, 594), x=-120, y=900), place(scale(P("c"), 0.45), x=330, y=780)),
                 "a gallows stem with a bar and a hook at its head")
    out["Pk"] = (union(leg, place(small_c, x=200, y=760)), "a gallows stem with a small c at its head")
    out["Qe"] = (k_small, "k gallows with a small loop")
    out["Qg"] = (union(k_small, place(keep(bench, 0, 470, 900, 594), x=-60, y=640)), "k gallows with a small loop and a bar across")
    out["Qh"] = (union(P("k"), move(scale(e_loop, 0.7), 1150, 1300)), "t gallows with a second loop on its loop")
    # c and ligature forms
    out["Kk"] = (union(P("c"), place(keep(P("9"), -100, -900, 800, 250), x=720, top=330)), "c running into y's tail")
    out["Kn"] = (union(P("o"), place(mirror(P("c")), x=560, y=-2)), "o joined to a reversed c")
    # m, l and n family variants
    out["Be"] = (union(small_o, place(scale(leg, 0.8, 0.9), x=150, y=-480)), "a stem through a small o")
    out["Bh"] = (union(P("c"), place(e_loop, x=640, y=300)), "c running into l's loop")
    out["Bd"] = (union(place(keep(leg, -100, -100, 290, 1000), x=200, y=-500), place(mirror(e_loop), right=270, y=440)), "a descending stem with a loop on its left")
    out["Ef"] = (P("±"), "drawn by Claston as Cl (@177;), the same three-shaped glyph")
    out["Cp"] = (union(P("±"), place(scale(P("o"), 0.5), x=box(P("±"))[2] - 220, y=-30)), "a three-shaped glyph with a small o")
    # weirdos
    pi_leg = keep(leg, -100, -100, 290, 560)
    out["Xm"] = (union(place(keep(bench, 0, 470, 900, 594), x=0, y=560), place(pi_leg, x=140, y=0), place(mirror(pi_leg), x=600, y=0)),
                 "a bar on two legs (pi-shaped)")
    out["Xn"] = (P("«"), "Claston's @171; hook, the same 7-shape")
    out["Xo"] = (P("²"), "Claston's @178; (Cm), the same S-shape")
    out["Xp"] = (P("¢"), "Claston's @162; hook, the same small form")
    return {code: (clean(p), note) for code, (p, note) in out.items()}


def clean(p) -> pathops.Path:
    """Drop the specks that overlapping parts can leave: contours under 45 units across, or under 90 both ways."""
    out = pathops.Path()
    for c in contours(p):
        x0, y0, x1, y1 = c.bounds
        w, h = x1 - x0, y1 - y0
        if w < 45 or h < 45 or (w < 90 and h < 90):
            continue
        c.draw(out.getPen())
    return out
