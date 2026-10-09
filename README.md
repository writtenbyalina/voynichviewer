# Voynich Viewer

Read the Voynich Manuscript (Beinecke MS 408) page by page, unfold its foldouts, and see the whole book as a block of
sheets in 3D: in its current binding, in the orders Lisa Fagin Davis has proposed, or in any order you make yourself.

Credit for the images belongs to Yale University (Beinecke Rare Book & Manuscript Library, MS 408). The research shown
here (collation, scribes, sections, the proposed orders) belongs to Lisa Fagin Davis. Voynich Viewer is an independent
project, not made or endorsed by either.

Site: [voynichviewer.com](https://voynichviewer.com).

- **3D** (opens first): the book block in WebGL. Fan the sheets apart, pull one out, turn it over, unfold it, colour the edges by
  scribe, section, illustration, language or quire, and see which faces touched when the book was closed.
  **Rearrange** (key A) puts the sheets in your own order: drag sheets, or whole gatherings, by their handle; start
  new gatherings, set sheets aside, read a gathering as separate sheets, turn a sheet inside out or upside down, sew a
  foldout at another fold. Only the sheet you move lifts in the animation. The eye next to a gathering hides it in 3D,
  like a layer, without changing the order.
- **Reader**: turn the pages two at a time, unfold the foldouts, zoom, jump to a folio. Zoomed in, a page is shown at
  full size (about 3,600 px tall), loaded from Yale's IIIF image server. The Reader loads these ahead as you read (the
  opening you are on, the next two and the one behind), so zooming in is sharp at once; not where zooming in gains
  little, as on many phones, nor when the browser asks to save data. **▦ Grid** (key O) shows every page at once,
  quire by quire, with buttons for each section and for your bookmarks.
- **Text** in the Reader (key T): the text of the pages beside them, RF1b, René Zandbergen's reference
  transliteration, shown as glyphs or written in Eva, FSG or Currier by his own tables. Point at a word on the
  photograph to see what it reads; click it and the page stays put while the panel shows it cut upright from Yale's
  photograph, with its other places as crops that open beside the page (N steps, Open page goes, Back returns). The
  strip under the pages marks where the words are and where you have been. ⌘-click collects words to find the pages
  that hold them in any order; "Pages that share these words" does it for a page; a ring's number unrolls the ring with
  its repeats joined. Words round a circle are outlined as part of the ring, and the page turns to read them on request.
- **Text tab** (key /): search the whole book's text with a small query language (whole words, `*` and `?`, joins
  within and across words, repeated words, regular expressions, filters such as `scribe:2`), narrow the results by
  scribe, section, language, quire and kind of text, see the hits page by page in any order, open a result in the
  Reader, export results as CSV or IVTFF, and save searches and page sets in Your work.
- **Bookmarks**: the ☆ in a page's corner (Reader), next to a page (3D), or key B; ★ at the top lists them. Name them,
  and go to one: 3D and the Reader both follow.
- **Info**: credits, a plain-language guide, Davis's research (her 2025 post in brief, the Folio order tables built
  like her quire diagrams for any order, her history of the book, the 2026 proposal), notes on single sheets, sources.
- **Crop tool**: re-cut any page from Yale's photograph (✂ Crop in the Reader, or in 3D). The photograph is loaded from
  Yale's IIIF image server and cut in the browser.

The menu offers the current binding, "Davis: complete proposed order" (every sheet read on its own, quires 13 and 20
re-ordered as in Layfield & Davis 2026, quire 9 re-sewn as in her 2025 post), and your own orders. Old links to the
retired "Davis's blog (Jan 2025)" order open the complete proposed order.

The 🐞 button (top right) shows how to report a bug or suggest a feature. The version (`APP_VERSION` in
`assets/app.js`, and the badge in `index.html`) is 1.0.

## Your work is kept in the browser

There is no server and no account. Crops are kept in IndexedDB; your own orders, bookmarks, saved searches and page
sets in localStorage and, as a second copy, in IndexedDB. **Your work** (top right) exports all of it as a small progress file and imports it again, in this browser or
another one (the page images are cut again from Yale's photographs on import).

3D and the Reader follow the same place: the page you are on in the Reader is the sheet picked out in 3D, and the sheet
or opening you pick in 3D is where the Reader opens. Every view has its own URL (`#read/<order>/<page>`, `#three/<order>/<view>`), so a
view can be bookmarked or shared. The Reader's text panel adds `/text` (`#read/beinecke/1r/text?w=f1r.15.8&n=2` for the
two words from the eighth of f1r.15, `?s=daiin+shol` a set, `?like=f71r.L` pages like 71r's labels, `?ring=f57v.3`), and a search is `#text/<order>/search?q=qok*&steps=scribe:2`.

## Run it locally

It is a static site: plain HTML, CSS and JavaScript, no build step. Serve the folder with any web server, e.g.

```bash
python3 -m http.server 8000
```

and open <http://localhost:8000>. (Opening `index.html` straight from disk does not work: browsers block `fetch` of
local files.)

## Layout

```
index.html              the page
assets/app.js           the Reader, Info (with the Folio order tables), the order logic and the shared place (POS)
assets/work.js          your work: crops (cut in the browser), your own orders, export and import
assets/arrange.js       the Rearrange panel of the 3D view
assets/view3d.js        the 3D view (ES module, loaded when the 3D tab first opens)
assets/text.js          the Reader's text panel, the word card and the interlinear (ES module, loaded when the text opens)
assets/search.js        the Text tab: search, facets, the book strip, export (ES module)
assets/query.js         the search query language: parse, say back in words, compile to a regular expression
assets/search-worker.js runs the searches off the page's thread
assets/fonts/voynich-vv.woff2   Voynich VV: Glen Claston's public-domain v101 font, with rare glyphs and kerning added
assets/privacy.js       the cookie strip and consent; loads Microsoft Clarity only after "Accept"
assets/style.css
assets/vendor/          three.js r184 (MIT)
data/codex.json         the physical model: sheets, quires, panels, scribes, sections, page variables, and for each
                        panel its Yale photograph (IIIF id) and the corners it is cut from; `mask` (f89v2) is
                        the part of the photograph blacked out, another page showing past a torn edge
data/orders.json        reading orders, sources and per-sheet evidence notes; edited by hand
data/changelog.json     what changed and when, newest first; shown under the version number (top left)
data/panels/            two JPEGs per panel face: _l (1400 px tall) and _s (300 px); zoomed in, the Reader loads the
                        page at full size from Yale instead
data/seams.json         where the paper starts on a foldout's hinge panel: its photograph shows the stacked edges of the
                        book on the side the flaps hang, and the unfolded Reader lets the flap overlap them
data/text/rf/            the Reader's text (built by tools/text/rf.py): text.json (RF1b in STA, every line), alpha.json
                        (what each glyph is written as in each alphabet), shapes/<page>.json (where each word is on the
                        photographs, and its shape: a box, a turned box, or a band of a ring)
data/text/               Search's data (built by tools/text/build.py): pages/<page>.json (every line's consensus, its
                        split votes and gaps, and each transcriber's own line), index.json (every line's consensus, for
                        search), w/<code>.json (one transcriber's lines), meta.json (credits, method, page list),
                        glyphs.json (which font character draws each glyph)
tools/text/             the text pipeline: fetch.py (the pinned transcriptions), build.py, boxes.py, rf.py, rosettes.py, report.py,
                        test_text.py; the method is docs/TEXT.md section 3, the Reader's text docs/text/REDESIGN.md 8
tools/font/             builds Voynich VV from Claston's font (build_font.py), with test_font.py
docs/TEXT.md            the design of Text: sources, method, data, query language, screens, tests
tools/import_from_scout.py   refreshes data/codex.json and data/panels/ from a local Voynich Scout checkout
tools/seams.py          measures those bands from data/panels/ and rewrites data/seams.json (run it after an import)
CNAME                   the custom domain for GitHub Pages
```

## What's new: logging changes and fixes

Every change people can see, and every bug fix, gets an entry in `data/changelog.json`, in the same commit as the
change. Releases are newest first, each with its `version`, the `date` it went live (YYYY-MM-DD) and its `changes`,
each with a `kind` (`new`, `improved` or `fixed`) and a sentence written for readers, not developers. The site reads
this file: the badge at the top left shows the latest version, clicking it opens the list, and someone who has been
here before sees a dot on the badge until they have opened the newest notes.

Versions: the second number goes up with each release (1.1, 1.2, …), the first with a redesign. Change the fallback
version in `index.html` (`#cx-ver`) at the same time, for the moment before the list loads.

Credit people who report bugs by name only if they have said that is all right; otherwise "Reported by a reader".

## Editing the orders

`data/orders.json` holds the reading orders. Each order lists its gatherings front to back; a gathering is `nested`
(a normal quire, bifolia outer to inner) or `singulions` (each bifolium read on its own). An order with `base` copies
another order and swaps in the gatherings in `replace`. Per-sheet options: `spine` (sew at another fold) and
`inside_out`. `evidence` holds the notes shown for a sheet; each `src` must be a key of `sources`.

## Refreshing the page images

The panel crops and the physical model are made in Voynich Scout (`scout codex-build` and its crop editor). To copy a
new build here:

```bash
python3 tools/import_from_scout.py --dry-run
python3 tools/import_from_scout.py
```

## Hosting on GitHub Pages

1. Push this repository to GitHub.
2. In the repository's **Settings → Pages**, deploy from the `main` branch, root folder.
3. The `CNAME` file already names `voynichviewer.com`. At your domain registrar, point the apex domain at GitHub
   Pages with `A` records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`, and add a
   `CNAME` record for `www` pointing to `<your-username>.github.io`. Then tick **Enforce HTTPS** once it is offered.

The `.nojekyll` file makes Pages serve the files as they are.

## Analytics, cookies and privacy

Microsoft Clarity (visitor analytics, project `ys2r2nospw`) is loaded by `assets/privacy.js`, and only after a visitor
clicks **Accept** in the thin strip at the bottom of the page. **Reject**, or closing the strip, means no: Clarity is
never loaded. A Global Privacy Control signal also counts as no. The choice is kept for 6 months and can be changed in
Info > Privacy and cookies, which is the site's privacy notice. Clarity never runs on `localhost` or `127.0.0.1`.

A separate, cookieless visit counter (Cloudflare Web Analytics) runs whatever the visitor chose, because it sets no
cookies and keeps nothing in the browser; **Reject** only turns off Clarity. It is the one request made before a choice.
It is off with a Global Privacy Control signal, on a local copy, and while `CF_TOKEN` in `assets/privacy.js` is empty. The
token is the site's Cloudflare Web Analytics token (Cloudflare dashboard > Analytics & Logs > Web Analytics > Manage site;
the `token` inside `data-cf-beacon`). It is public, so it is fine in the repository. The privacy notice has its "visit
counter" section only while the token is set, so to switch the counter off, empty `CF_TOKEN`.

`CONTACT` in `assets/privacy.js` is the address the notice gives for questions about data; change `HOST` there if the
site is not hosted on GitHub Pages. In Clarity's project settings
you can also turn on "Cookie consent", so that Clarity itself waits for the consent signal the site sends.

## Credits

- Photographs: Beinecke Rare Book and Manuscript Library, Yale University, MS 408, from
  [Yale University Library's digital collections](https://collections.library.yale.edu/catalog/2002046).
- Collation, scribes and sections: Lisa Fagin Davis,
  ["Voynich Codicology"](https://manuscriptroadtrip.wordpress.com/2025/01/19/voynich-codicology/) (2025).
- Foldout structure: René Zandbergen, [voynich.nu](https://www.voynich.nu/). Illustration type and Currier language:
  the page variables of his ZL transliteration.
- Text: transcriptions by René Zandbergen and Gabriel Landini, Glen Claston, Takeshi Takahashi, the First Study Group
  (William Friedman), Prescott Currier and Mary D'Imperio, Jorge Stolfi, John Grove, John Tiltman, Don Latham, Karl
  Kluge (from Theodore Petersen's copy), Mike Roe and Denis Mardle, from René Zandbergen's
  [voynich.nu](https://www.voynich.nu/transcr.html) (CC0) and the Landini–Stolfi interlinear.
- Glyph font: Glen Claston's Voynich font (2005, public domain; UTF-8 fix by William Porquet), as Voynich VV.
- 3D: [three.js](https://threejs.org) (MIT licence, `assets/vendor/three.LICENSE`).
