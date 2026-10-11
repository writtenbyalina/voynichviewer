# Drawings: every drawing in the book, cut out

`cut.py` cuts every drawing out of its page photograph and writes its outline for the site (`data/drawings/`). Which
drawings a page holds, and roughly where, is written by hand in `plan/*.json`, by looking at the pages; what is said
about each drawing (what it is, what people think it is, what nobody knows) is in `data/drawings/about.json`.

```bash
python3 tools/drawings/cut.py                      # every planned panel -> data/drawings/paths/<img>.json + index.json
python3 tools/drawings/cut.py f9v f88r             # only these panels (the index is rebuilt from all of them)
python3 tools/drawings/cut.py --look f9v --out DIR # DIR/f9v_look.jpg: the panel's pieces, coloured, on a grid
python3 tools/drawings/cut.py --check f9v --out DIR   # DIR/f9v_check.jpg: the planned drawings over the panel
python3 tools/drawings/cut.py --sheet f9v --out DIR   # DIR/f9v_sheet.jpg: each cut-out alone on a dark ground
```

It needs Python 3 with `numpy`, `scipy`, `opencv-python-headless` and `scikit-image`.

## Units

Everything is in the units the text uses: **thousandths of the panel's height**. A panel is 1000 units tall and
`1000 × width / height` wide (about 700–800 for a page). The grid on the `--look` and `--check` pictures has a fine
line every 50 units and a numbered line every 100.

## How a drawing is cut out

1. **The ink and the paint.** The parchment's own colour is found round every pixel; ink is what is darker than it,
   paint what is another colour, laid in areas. A faint stroke is kept where it carries on from a clear one.
2. **The writing out.** Every word's box (`data/text/rf/shapes`) is taken off the ink, except where it is painted.
   The drawing's own strokes that pass under a word are given back afterwards where they carry on from the drawing.
3. **The page's edges out.** What runs into the panel's border (the binding, the edges of the leaves underneath),
   long straight lines near the sides, and tall thin strips down them.
4. **The pieces.** Ink and paint joined across hairline gaps, then split where nothing joins them. `--look` shows them,
   each in its own colour, with the writing greyed.
5. **The plan** says which drawings the panel holds and where (below).
6. **Filled.** What a drawing's ink closes round is part of it (an unpainted leaf, a woman's body), except a big bare
   space closed by chance (two crossing roots).
7. **Traced** round the pixels, simplified to about half a pixel, as one SVG path (`fill-rule: evenodd`).

## The plan

`plan/<part>.json` is `{"panels": {"<img>": [drawing, ...]}}`; `<img>` is the panel's picture name (`f9v`,
`f70r2-1`, `fRos-tm`; see `data/panels/`). A panel with no drawing is simply left out. Each drawing:

| key | what |
| --- | --- |
| `id` | `<img>.<slug>`: the slug in lower case, `a-z`, `0-9` and `-`, unique on the panel (`f9v.plant`, `f88r.jar-2`, `f71r.centre`) |
| `kind` | one of the kinds below |
| `name` | what the site calls it, a few plain words with a capital: `Plant`, `Jar`, `Root`, `Woman holding a star`, `Ram` |
| `looks` | one plain sentence on what the drawing shows, no guessing what it is: `Five blue flowers, toothed leaves and a tangled brown root.` |
| `in` | where it is (a region, below) |
| `take` | how it is taken from the region (below); `pieces` if left out |
| `not` | a region taken off it (a stain, a page edge, a neighbour that touches it) |
| `fill` | `auto` (default), `all` (every space it closes round: a diagram, a pool with its women) or `none` |
| `fit` | `true` with a `circle`: the circle is moved onto the ruled circle nearest it |
| `joins` | the id of the same drawing's other part on the next panel of a foldout |

**Regions** (units): `{"box": [x0, y0, x1, y1]}`, `{"poly": [[x, y], ...]}`, `{"circle": [cx, cy, r]}`,
`{"ring": [cx, cy, r0, r1]}`, or a list of them (all of them together).

**Takes:**

- `pieces`: the pieces the region holds. A piece mostly (60%) inside the region is taken whole; one only partly inside
  is cut at the region's edge, and followed a few units out along its own stroke. Where two drawings' regions share
  a piece (two jars that touch), each takes the part in its own region, so draw their regions to meet where the
  drawings should part. Stray specks far from the drawing are dropped (`keep`, `near` tune it).
- `each`: every piece in the region on its own, numbered `-1`, `-2`, … in reading order (round a ring clockwise from
  the top). For the women round a zodiac medallion, the stars of the starred pages. `min` is the smallest piece in
  pixels (300); `join` (units) puts pieces that close together into one drawing (a woman and the star she holds).
- `holes`: the bare figures a painted area closes round, each with its outline, numbered: the women in the pools.
  `min` is the smallest in pixels (1500). Two women that touch are cut apart where they join (`"split": false` stops it).
- `region`: the region itself is the drawing (a medallion's disc; a shape the pieces cannot give, drawn by hand).

## Kinds

`plant` a whole plant · `root` a root or a plant's underground part · `leaf` a leaf or sprig on its own · `jar` a
container · `diagram` a whole round diagram or medallion · `emblem` the picture in a diagram's centre · `sun` · `moon` ·
`star` one star · `woman` a woman (the "nymphs") · `person` any other human figure · `animal` · `pool` a pool, tub or
tube · `rosette` one of the Rosettes · `building` a castle or tower · `other` anything else.

## A good cut-out

The cut-out (`--sheet`) holds the whole drawing and nothing else: no writing, no page edge, no stain, no part of a
neighbouring drawing. Where it falls short, tighten the region, add a `not`, or draw a `poly`; where a drawing cannot be
got from the pieces at all, a `region` drawn round it is better than a bad cut.
