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

Data: `data/text/boxes/<page>.json`, voynichese.com's boxes fitted to our photographs (`tools/text/boxes.py`,
`wordmatch.py`; docs/text/boxes.md has the figures for each page).

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

- No boxes for the Rosettes foldout (fRos, 517 words) and f116v: voynichese.com never covered them. The one public
  set that does, daiin.net's word map (Konstantin Hamidullin, "farmerjohn"), states no licence, so it would need his
  permission; Zandbergen has boxes for every RF1 word but has not published them. Asking either is Alina's call.
- f101v's left panel (97 words) has none: voynichese.com's photograph of that page shows only its right panel, and
  our left panel is cut from a different photograph of Yale's.
- A few dozen words that voynichese.com never boxed (marginal letters, some labels) have none; 60 words have a place
  estimated from the words beside them, drawn with a dashed outline and said so.
- A word whose box is shared by two consensus words (one transcriber joined them) gets each half of the box.

## 6. The four reports

The research agents' full reports (with every measurement) and their 250 screenshots are in the session scratchpad,
not in the repo, since the screenshots are other sites' pages.

## 7. Built (7 Oct 2026)

Alina approved the direction and asked for white instead of pink, with the outline tight to the word. Built in
`assets/text.js` (the words on the photographs, the page text, the word panel) and `assets/search.js` (the Text tab),
with `tests/text.spec.js` and `tests/text.mobile.spec.js`. The Interlinear mode, the floating card, the reading switch
and the marks menu are gone; the compare view, the transcribers' lines and the rarer settings are one step away.

## 8. Round 3 (8 Oct 2026): simpler, RF1b, and the page you are on

Alina's review of the built panel: the information on the right is too dense; use René Zandbergen's RF1b, which is in
his STA alphabet and converts to Eva, FSG and Currier; let me take several words and see whether the run of words is
anywhere else; "Elsewhere in this book" jumping to the Text tab takes me out of the page; the Rosettes show no
highlights; "transcribers differ / all agree" on hover means nothing to me; words written round a circle should be
outlined as arcs, and I should be able to turn the page to read them. What would I want on this screen, and what can be
hidden?

### 8.1 What she is doing on this screen, and what it needs

| She is | She needs, at once | Was there | Now |
|---|---|---|---|
| Reading a word on the photograph | what it says, in the alphabet she thinks in | the reading, plus a vote, bars, a key, readings, credits | the reading, large, and the same word in every other alphabet as one row of chips (click one to read in it) |
| Seeing the word itself | the word, sharp and the right way up | a crop, upright only if the word was | a crop turned upright whatever the writing does |
| Checking a phrase | whether these words, in this order, are anywhere else | one word at a time | shift-click, drag across words in the text, or + word before / after; − last word |
| Comparing places | the other places, side by side, without losing her own | a count, and a link out to the Text tab | each place as a picture cut from its page with its line round it; click one and the book turns there, with ‹ 1 of 21 › and Back |
| Reading writing that turns | the page turned so it reads level | nothing | Turn upright (the page turns about the word and zooms to it), R / Shift+R a quarter, Alt-scroll freely, 0 back |
| Reading the Rosettes | the text beside the sheet | the sheet in a dialog over the text | the sheet opens over the pages; the text panel stays and reads it |

### 8.2 What goes

The consensus is no longer the Reader's text, so everything that explained the vote goes from the Reader: the sentence
on agreement, the bars and their key, the grouped readings with counts and names, "How each transcriber wrote this
line", the orange dots, Compare with a transcriber, and "all 6 agree / transcribers differ" on hover. The hover says
the word and how often it is in the book. The Text tab keeps the consensus and every transcriber as Readings (RF1b
first), so the comparison is still one step away for whoever wants it.

### 8.3 RF1b, and the alphabets

`tools/text/rf.py` builds `data/text/rf/`: every locus of RF1b in STA, and for each alphabet what each STA code is
written as, by Zandbergen's own bitrans tables (pinned in `inputs.json`). Tested line by line: **Eva** is his reduced
Eva (`STA-Eva_Bint.bit`), identical to his `RF1b-er.txt` on all 5,385 lines; **Eva, full** is `STA-Eva_def.bit`,
identical to `RF1b-e.txt`; **v101**, **FSG** and **Currier** reproduce the worked line f10r.6 of docs/TEXT.md 3.4.
FSG and Currier have letters for the basic glyphs only: a glyph they cannot write is written by its nearest basic form,
and the word panel says so. In Eva, a rare glyph basic Eva has no letter for is drawn as itself, in the glyph font.

"Elsewhere" matches words as written in the alphabet on show, so the older, smaller alphabets find more. One thing to
know: RF1b keeps Glen Claston's second form of *d* (STA Ba, 2,714 times) and his in-between *a/o* and *o/y* (Aa, Ab).
Full Eva writes them by number (@152;, @221;, @222;) and treats them as different glyphs: *daiin* is a word 719 times
in full Eva, 834 in Eva. That is why Eva, not full Eva, is the default.

### 8.4 Shapes that follow the writing

The word boxes (`data/text/boxes`, voynichese.com's, fitted to Yale's photographs) are tied to the consensus words;
rf.py carries them to RF1b's words through a glyph alignment (a box shared out where RF1b splits a word, joined where it
joins two), then gives each word a shape from its line: for a ring (IVTFF C), a circle is fitted to the ring's measured
boxes and each word is the band of the ring its box holds (the radius fitted per word, as rings wander), and words
without a box are placed along the ring between their neighbours by glyph count, dashed; for a radius (R, and f68v3's
spiral arms), each word is a box turned the way its line runs there; for a paragraph or label line that slants by more
than 8°, a box turned to the line. Every word also gets its reading angle, so turning the page by minus that angle sets
it upright (a ring's words read clockwise with their tops out, or anticlockwise with them in, as their order says).
Of 37,980 words on the pages with boxes, 37,811 have a shape: 1,941 round a ring, 1,229 turned.

### 8.5 Still to do

- **The Rosettes and f116v have no word positions.** The text panel says so. Zandbergen has boxes for every RF1 word
  (unpublished); asking him for them would place every word of RF1b, the Rosettes included, exactly. Alina's call.
- A ring running onto the next page's panel (f72r2 onto f72r1) has too few words there to fit its circle: those words
  are upright boxes.
- Labels written at an angle with only one word (most zodiac labels) keep upright boxes: one box says nothing about its
  angle. The page can still be turned by hand.

## 9. Round 4 (8 Oct 2026): research first; never take the page away

Alina's review of round 3: the Rosettes text was still unclickable; the alphabet tags under the glyph meant nothing to her
("stick to Eva, FSG and Currier"); it was easy to lose your place; the tool should answer what researchers ask (on a
zodiac page: which pages have these words, in any order? which words go round in the same pattern?); and the product
thinking had not been done. She asked for research into voynichologists' pain points, how other fields show such data,
and visual inspiration. The research is ~/voynich/reports/Voynich text and glyph research needs.md (notes in
~/voynich/research_notes/Voynich text and glyph research needs/: forum pain points, scholarly methods, Voynich tools,
labels and the zodiac, orientation in reading tools, tools for other scripts, sequence visualisation in biology and
music, visual references).

### 9.1 What the research says, in one line each

- Researchers work in one loop: find every instance, look at each on the photograph, judge it, then count. Every public
  tool breaks the loop; Voynich Viewer already has current text (RF1b) tied to the photographs.
- Orientation breaks at the jump from a hit to its page. Fixed overviews, one-way coupling, cheap returns (Back), no
  unrequested zoom (Cockburn et al.; NN/g); peek beside rather than replace.
- The concordance aligned on the word, with real image crops, is the oldest and most useful display for undeciphered
  scripts (Indus, SigLA, TLA, DigiPal).
- "Which pages share these words, in any order" is a set question; "which words repeat round the rings" is an order
  question. Biology keeps the two apart (content vs synteny). Linear beats radial for reading (Waldner et al. 2019).
- 80% of zodiac labels occur once: exact matching finds little; near spellings are what recur.
- Beauty from restraint: the photograph the only saturated colour, real crops as the ornament, one meaning per colour.

### 9.2 What changed

| Before | Now |
|---|---|
| Clicking a word zoomed the page up to 4× | Choosing a word never moves the page (it is only panned into sight if zoomed in and out of view); zoom and turn are asked for |
| Eva, full Eva, v101, FSG, Currier, and chips of every alphabet under the word | Glyphs · Eva · FSG · Currier, one quiet switch; under the word only its glyphs and its letters |
| "Elsewhere": a list; a click turned the book there | Other places as a grid of crops (book order, or sorted by the word before or after); a click opens a peek beside the page (the line cut from the photograph, where it is on its page); N / Shift+N step; Open page commits, with a Back chip, and the browser's Back works |
| A strip of ticks inside the panel | The Reader's own page strip is the compass: every page in a fixed place, the words' pages lit, visited pages dotted, a preview on hover |
| Phrases only | ⌘/Ctrl-click collects words into a set: pages holding all or most of them, with how many chance would give; "Pages that share these words" for a whole page (or its labels, or rings), rare words weighted; "one glyph off" for near spellings |
| Rings as text only | Unroll the ring: its words cut upright in a line, arcs joining repeats (a run as one thick arc), and other lines sharing a run of its words in order (three words, or two uncommon ones, so chance runs are left out) |
| "Where it sits", near spellings: absent | Behind named doors: first / last / inside a line, kind of text, section, Currier A/B (a click narrows the places); words one glyph off (a click shows their places) |
| Rosettes: no positions | 507 of its 543 words placed, from Alessandro Placa's voynich-spatial-data (CC BY 4.0), carried to Yale's photograph and to RF1b (tools/text/rosettes.py) |

### 9.3 The Rosettes' positions

Placa placed all 539 of his words by hand on a 2412 × 2375 px Beinecke scan; his text is ZL3b. `tools/text/rosettes.py`
maps his scan onto Yale's photograph 1006231 (the six panels are crops of it): an affine fit to the nine rosettes' ring
centres (residuals 4–37 px of 7925), refined so his boxes cover the most ink in the site's panel images, then a small
shift per region where that clearly covers more ink (never one at the limit of the search, which meant it had found a
drawing). Each RF1b locus is then matched to the run of his words that spells it best (local alignment, one-glyph
tolerance), near where ZL's Petersen codes and the Landini–Stolfi interlinear say it is (`rosettes_hints.json`), with
words he writes joined or split handled after. Ring words become bands of their ring; the rest turned boxes.

### 9.4 Still open

- Labels written at an angle with a single word keep upright boxes; the page can be turned by hand.
- 36 Rosettes words are not placed (seven labels with no close match in Placa's text, and parts of a few rings).
- Not yet built from the research: the full concordance (sorting and grouping by scribe), the ring-against-ring view,
  an export of the places with their loci, and a "suggest a reading" link.

### 9.5 The devices, each from one reference (Alina: "more granular with the inspo")

The visual references are in the research notes (visual_inspiration.md). Rather than averaging them into a mood, each
device below takes one reference's specific mechanism.

| Device | Taken from | What exactly | Where |
|---|---|---|---|
| The word across the book | UCLAB's VIKUS Viewer, "Past Visions" (1,492 drawings as cream stacks over a charcoal ground, years set under a hairline baseline, a faint reflection below) | One column per page in the order chosen at the top, a brick per place; the busiest page's stack reaches the top; quires set under the line in small caps; `-webkit-box-reflect` gives the reflection. Scroll zooms; at about 15 px a column the bricks become the word cut from Yale's photograph | the "Across the book" figure in the word panel, and the overlay it opens |
| Arcs from where you are | Chris Harrison's Bible cross-references (arcs over a baseline of chapters) and Culturegraphy's fans | Hairline gold arcs fall from the page you are on to every page the word is on, under the baseline, drawn in (stroke-dashoffset) as the stacks rise | the same overlay |
| The loupe | VIKUS's zoom from the histogram to the item | Pointing at a stack dims the rest and lifts its places, cut from the photograph, with their line numbers | the same overlay |
| Ghost pages | basil.js "Frequency mapping" (pages blanked but for one word, which keeps its place) | Each page that shares the words as a parchment sheet: every other word a faint hairline along its line, the shared words printed in Voynich VV at their own place and angle, larger than life, with a paper halo | "Pages that share these words" and word sets |
| Glowing marks on the strip | Nadieh Bremer, "Royal Constellations" (warm points of light on navy) | The strip's lit pages glow, brighter with more places | the page strip |
| Type | Cipher Museum, Verso, Kemet Eternal (high-contrast serif with small caps on near-black, one gold accent) | Newsreader (SIL OFL, served from the site) for words about the words: italic titles, all-small-caps labels at 0.12em; monospace stays for Eva and loci | the panel, the overlay, the ghost pages |
