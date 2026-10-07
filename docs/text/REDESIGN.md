# Text, redesigned: the page is the way in

Alina's review of Phase 3 (7 Oct 2026): nothing connects the text to the photographs; she wants to zoom in, point at
any word on the page, see it sharp, and get a sidebar about it. The glyphs looked broken, the interlinear was
unreadable, the yellow marks meant nothing, and the Text tab was overwhelming. "The complexity is in my face."

This spec answers that. It is compiled from a benchmark of 53 tools in four fields, each captured and measured by a
research agent (screenshots kept outside the repo; the four reports are summarised in section 6):

- **Manuscript viewers that tie the image to its text** (11): Codex Sinaiticus, Electronic Beowulf, EVT, Shelley-Godwin
  Archive, MDZ/Mirador, Internet Archive, Transkribus, papyri.info, Van Gogh Letters, Chinese Text Project,
  voynichese.com; plus Jason Davies' Voyager and VIB.
- **Readers where a word opens a breakdown** (17): Quran.com, Sefaria, Scaife/Perseus, Logeion, STEP Bible, Bible Hub,
  Blue Letter Bible, Bible Gateway, NET Bible, CNTR, Versioning Machine, TRAViz, Genius, Duolingo stories, Readlang,
  LingQ, Kindle Word Wise.
- **Science and museum inspectors** (13): AlphaFold DB, RCSB Mol*, NCBI MSA viewer, JalviewJS, Nightingale, WebLogo,
  IGV, Ensembl, UCSC (docs), the Bosch Garden of Earthly Delights, Smithsonian Voyager, Rijksmuseum/Google Arts &
  Culture, Google Maps.
- **Search and "where in the book" displays** (12): Internet Archive BookReader and search, Voyant, Google Ngram,
  Bible Gateway, Blue Letter Bible, Scaife search, BlackLab, AntConc, voynichese.com, VS Code find, Google Scholar.

## 1. Principles the references agree on

1. **Hover previews, click commits.** Every reference with regions on an image reacts to hover with an outline or one
   line of text, and opens a panel only on click (13 of 13 that link image and text).
2. **One panel, summary first, proof one click deeper.** Panels are 300–461 px (median 360). They open with the thing
   itself and one sentence, then collapsed sections (Maps, Quran.com, Sefaria, Bosch, Ensembl, EVT, Sinaiticus).
3. **One colour means one thing.** Sinaiticus, Versioning Machine and the Internet Archive use one mark for "this
   word" in every place. NET Bible's 48 markers in 18 verses and Jalview's unlabelled rows are the anti-patterns.
4. **Layers start off.** Electronic Beowulf, EVT, Voyager and IGV open clean and switch layers on by name.
5. **Variants are summarised, not stacked.** CNTR groups readings with a share ("70% / 29%"); TRAViz keeps one main
   line and branches in small type; UCSC and Jalview collapse many rows into one summary row. The full stack is an
   expert view (VIB shows how heavy it is by default).
6. **Say it in words.** Bible Gateway's popover names the mark ("FOOTNOTE"), AlphaFold's legend pairs each band with a
   word, Blue Letter Bible states counts as a sentence ("leper occurs 17 times in 16 verses").

## 2. The Reader

### 2.1 Pointing at a word on the photograph

Data: `data/text/boxes/<page>.json`, voynichese.com's boxes fitted to our photographs (`tools/text/boxes.py`;
98.3% of words on 224 pages).

| Property | Reference values | Spec | Why |
|---|---|---|---|
| Hover outline | Voynichese 2 px #ffff00; Sinaiticus 2 px #d75700; IA 1–2 px; Mol* 1.5 px | **1 px white at 85% with a 1 px dark hairline outside it, tight to the word, no fill, instant** | Alina chose a demure white (7 Oct); the hairline keeps it visible on pale parchment |
| Hover readout | Quran.com 150×34–40 px pill 8 px above the word; Mol* 330×86 label; Duolingo ≤320 px bubble | **one line, 8 px above the word, dark pill, 13 px: "chtaiin · all 6 agree"**, ends in › | the hint sits at the word (STEP's top banner is the anti-pattern) |
| Selected outline | Voynichese 3 px; Sinaiticus 2 px; Mol* fill + outline | **1.5 px solid white with a 1 px dark hairline, no gap and no halo**; lines kept this thin at any zoom | her review of the mocks: the halo and gap were too wide |
| Fill | Voynichese 55–60% (hides the ink); IA ~35%; MDZ ~30% | **none** (outline only) | under every reference that stays readable |
| Rest of the page while a word is selected | Shelley-Godwin fades to #d9d9d9; AlphaFold greys 100%; Bosch ~25% | **table colour at 38% over the photo, with a cut-out round the word; 160 ms fade** | middle of the range; colour stays, focus is clear |
| Re-framing | Bosch flies in ~4×; Mol* centres; Maps pans the pin clear of its card; Sinaiticus's 22×10 px box is "easy to miss" | **if the word is under 36 px tall on screen, zoom until it is ~48 px (at most 4×); centre it in the free area** | 56 px reached the 5× limit; 48 is enough to read |
| "Crisp" | Transkribus line crop; Beowulf 110×75 crops; Shelley-Godwin fade | **a sharp crop of the word from Yale's full-size photograph at the top of the panel**, up to 328 px wide | Yale serves exact regions (the Reader already uses it to zoom) |
| Tap target | WCAG 2.2: 24 px | **hit area grown to 24 px; the drawn outline stays the word's size** | |
| Words without a box | EVT falls back to lines | **the panel still works from the text; the photo shows no outline** (never a wrong box) | EVT's off-by-one zones broke trust |

On a phone: tap a word on the photo (no hover); the panel is a bottom sheet (2.5).

### 2.2 The panel

One panel, **360 px** wide (Bosch 340, Ensembl 340, RCSB 300, Maps 408, Quran.com 384, Genius 448, Sefaria 461),
beside the pages as today. It has two states.

**Page text** (when no word is selected; key T opens and closes it):

- Header: "1r · 28 lines", an **Eva | Glyphs** switch, and a ⋯ menu ("Mark disagreements", "Compare with a
  transcriber…", "About this text").
- The lines, at 15 px, line numbers in the margin. **One mark only**: a 3 px orange dot (#ff8a4c at 85%) under a glyph
  where transcribers disagree (a split vote or a tie), as papyri.info marks one uncertain letter with a 2 px dot. No
  underlines, no gold, nothing on hover but a light background.
- Hovering a word in the text outlines it on the photo; hovering a word on the photo lights it in the text.
- Glyph mode shows the glyphs only, a line at a time; Eva is in the hover readout and in the word panel.
- The credits close the text, as now.

**Word** (after a click on the photo or the text):

| Order | Content | Reference |
|---|---|---|
| Header | "← Page text" · "1r · line 2 · word 7" · ‹ › previous / next word · ✕ (Esc) | Quran.com ‹ ›, Sefaria back, Mol* header |
| 1 | The word, cut sharp from Yale's photograph | Transkribus, Beowulf |
| 2 | The reading, large: glyphs 34 px and Eva 22 px | Maps card title, Sefaria headword 18–24 px |
| 3 | **One sentence**: "All 6 transcribers read it this way." / "Transcribers differ on one glyph: 4 of 6 read *r*." / "A tie between *e* and *s*: the first in our fixed order is shown." | Maps, CNTR, NCBI "6 of 13" |
| 4 | Each glyph with a 3 px bar under it: **all agree** (warm grey), **most agree** (pale orange), **disputed** (orange), with those three words as its key | AlphaFold's 4 worded bands, simplified to 3 |
| 5 | **Readings**, one row per distinct reading, most votes first: the reading (differing glyph in orange), "4 of 6", the names in 12 px grey. Three rows, then "All readings (n)" | CNTR %, Genius "8 contributors", LingQ caps at 3 |
| 6 | "Elsewhere: 31 times on 18 pages" with a small section-coloured strip, and "Find them all ›" | voynichese.com count, IA "1 / 61" |
| 7 | Collapsed: **"How each transcriber wrote this line ▸"** (2.3) | UCSC full mode on demand |
| Footer | 12 px grey: "Consensus of 6 transcriptions · word position: The Voynichese Project" | Sefaria source line |

### 2.3 The interlinear becomes three steps of depth

| Depth | What | Reference |
|---|---|---|
| Default | The consensus line with its orange dots | UCSC dense, papyri.info |
| On a word | Readings grouped with counts (2.2, row 5) | CNTR, TRAViz |
| On demand | "How each transcriber wrote this line": the consensus, then only the transcribers who differ somewhere on the line, one row each, name on the left (12 px); glyphs that agree drawn at 30% ink, the differing ones in full orange; "and 3 more read it as the consensus" | NCBI "Show differences", CNTR inverted letters, UCSC full |

The separate Interlinear mode and the I key go. "Compare with a transcriber…" (⋯ menu) shows one transcriber's
line in the page text with agreeing glyphs at 35% and differences in orange, on the same line (Shelley-Godwin's
"focus one source").

### 2.4 Colours: one meaning each

| Token | Means | Value | Used for |
|---|---|---|---|
| (white) | the word you are on | white, 1–1.5 px, with a dark hairline | photo outlines, the text's chosen word (white underline) |
| (ink) | a search's match | the ink colour, bold and underlined | search results, the book strip's bars |
| `--differ` | transcribers disagree here | #ff8a4c (orange) | the dot under a glyph, the "disputed" bar, differing glyphs |
| (none) | everything else | the Reader's existing table colours | |

Gold stays for what it already means in the Reader (the page you are on, in the strip). It is not used in the text.

### 2.5 Phone

The panel is a bottom sheet, **55% of the screen** at rest (Quran.com 433/844, Sefaria 456/844), dragged up for more.
Tap a word on the photo: the sheet shows rows 1–3 and the Readings; the selected word stays visible above it, the
photo panning if needed.

## 3. The Text tab

| Property | Reference values | Spec |
|---|---|---|
| Box | Ngram 720×50; Bible Gateway 805×48 | one box, 48 px, the query guide behind a "?" inside it |
| Settings | Ngram 4 chips 32 px; BLB "Adv. Options"; BlackLab Simple has 1 field | chips that read as words: **"Consensus ▾"**, **"Spaces: either way ▾"**; filled only when changed; Near, Pages, Match and Compare under **"More options"** |
| First view | Ngram opens on a finished query | opens on **daiin**, the commonest word, run, with "an example" beside it |
| Count | BLB "occurs 17 times in 16 verses"; voynichese "4151 matches, in f46r… and 113 other folios" | **"daiin appears 898 times on 210 of 227 pages."** The range across ZL, GC and IT goes behind an ⓘ |
| Book strip | IA 644 px for 681 pages, ticks 2×6 px on the slider; Voyant 32 px; voynichese 57 px, unlabelled (the anti-pattern) | 3 px bar, 1 px gap, 36 px tall, in the chosen order; **an 8 px band under it coloured by section with the names in 11 px where a section is ≥ 40 px**; quires as alternating #f3f1ec/#fbfaf7 shading behind the bars |
| Narrowing | Ngram fades to ~40% | matched pages in ink; pages a step removes as a 20% ghost; no hits: a hairline |
| Strip hover | IA 350×55 card; Ngram card | "f75r · Balneological · Quire 13 · 12 hits" and the first matching line |
| Facets | Bible Gateway: book order, 16 px, 24 px rows, "(n)"; IA 6 rows then More; Scholar states defaults | **Section** open (book order, only with hits, "(n)"); Scribe, Language, Kind of text, Quire as one-line "Scribe: any ▾"; no ranges in rows |
| Results | BlackLab 14 px title per document; Bible Gateway reference + highlighted line; "status said once" | a heading per page with a thumbnail "f75r · Balneological · 12 hits", the lines at reading size with the match in bold, underlined, the line opens the page; the centred concordance becomes an option ("Concordance") |
| Stepping | IA "1 / 61 ‹ ›"; VS Code "1 of 22" | kept: "Result 3 of 864 ‹ ›" in the Reader |

## 4. What goes, what stays

| Goes | Stays (one step away) |
|---|---|
| The Interlinear mode and its key I | "How each transcriber wrote this line" in the word panel |
| The reading switch in the panel header | "Compare with a transcriber…" in the ⋯ menu; "Read the page as …" from a reading row |
| The marks menu (split / every / none) | one "Mark disagreements" switch (on by default, a dot) |
| Gold underlines, ticks, dots and fills in the text | the orange dot; white for the selected word |
| Eva under every glyph word | Eva in the hover readout and the word panel |
| The facet ranges, four setting dropdowns, the two-series strip | the ⓘ range, "More options", one series with ghosts |
| The card as a floating box | the word panel |

Nothing in the data changes. Search's query language, saved searches, export, the address of every view and the
progress file stay as they are; old `#read/…/text?r=GC` links open the compare view.

## 5. Known gaps

- The boxes of the round diagrams (f70r2, f86v3 and others) follow voynichese.com's word order, which differs from the
  transcriptions', so fewer of their words have a box (docs/text/boxes.md). Matching line by line would recover most.
- f101v has no boxes yet (its photograph did not match), nor do the Rosettes and f116v (voynichese.com has none).
- A word whose box is shared by two consensus words (one transcriber joined them) gets each half of the box.

## 6. The four reports

The research agents' full reports (with every measurement) and their 250 screenshots are in the session scratchpad,
not in the repo, since the screenshots are other sites' pages.

## 7. Built (7 Oct 2026)

Alina approved the direction and asked for white instead of pink, with the outline tight to the word. Built in
`assets/text.js` (the words on the photographs, the page text, the word panel) and `assets/search.js` (the Text tab),
with `tests/text.spec.js` and `tests/text.mobile.spec.js`. The Interlinear mode, the floating card, the reading switch
and the marks menu are gone; the compare view, the transcribers' lines and the rarer settings are one step away.
