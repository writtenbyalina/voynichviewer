# Voynich Viewer

Read the Voynich Manuscript (Beinecke MS 408) page by page, unfold its foldouts, and see the whole book as a block of
sheets in 3D: in its current binding, in the orders Lisa Fagin Davis has proposed, or in any order you make yourself.

Credit for the images belongs to Yale University (Beinecke Rare Book & Manuscript Library, MS 408). The research shown
here (collation, scribes, sections, the proposed orders) belongs to Lisa Fagin Davis. Voynich Viewer is an independent
project, not made or endorsed by either.

Site: [voynichviewer.com](https://voynichviewer.com).

- **3D** (opens first): the book block in WebGL. Fan the sheets apart, pull one out, turn it over, unfold it, colour the edges by
  scribe, section, illustration, language or quire, and see which faces touched when the book was closed.
  **Rearrange** (key A) takes the book apart on the table: each quire lies open as a pile (sheets tucked inside each
  other stacked with the centre sheet on top; sheets read one by one fanned like cards). It works like a drawing
  program: click, ⇧/⌘-click or drag a box to select; drag onto a pile or between piles (a new quire); ⌘G new quire or
  merge, ⇧⌘G split, ⌘] / ⌘[ toward the centre / outward, ⌫ set aside, ⌘X / ⌘V; a quire's name selects, renames
  (double-click) or moves it; right-click menus. A panel in a fixed place shows the sheet pointed at (its place in its
  pile, both its sides) or where dragged sheets will land. On a phone it opens as a panel under the book instead.
  **Hide lost sheets** (key L) leaves the lost sheets out of the 3D book. A quire can be hidden in 3D, like a layer,
  without changing the order.
- **Reader**: turn the pages two at a time, unfold the foldouts, zoom, jump to a folio. Zoomed in, a page is shown at
  full size (about 3,600 px tall), loaded from Yale's IIIF image server. The Reader loads these ahead as you read (the
  opening you are on, the next two and the one behind), so zooming in is sharp at once; not where zooming in gains
  little, as on many phones, nor when the browser asks to save data. **▦ Grid** (key O) shows every page at once,
  quire by quire, with buttons for each section and for your bookmarks.
- **Bookmarks**: the ☆ in a page's corner (Reader), next to a page (3D), or key B; ★ at the top lists them. Name them,
  and go to one: 3D and the Reader both follow.
- **Info**: credits, a plain-language guide, Davis's research (her 2025 post in brief, the Folio order tables built
  like her quire diagrams for any order, her history of the book, the 2026 proposal), notes on single sheets, sources.
- **Crop tool**: re-cut any page from Yale's photograph (✂ Crop in the Reader, or in 3D). The photograph is loaded from
  Yale's IIIF image server and cut in the browser.

The menu offers the current binding, "Davis: proposed order" (every sheet read on its own, quires 13 and 20
re-ordered as in Layfield & Davis 2026, quire 9 re-sewn as in her 2025 post; the other quires keep today's sequence of
sheets, which is not part of the proposal), and your own orders. Old links to the
retired "Davis's blog (Jan 2025)" order open Davis's proposed order.

The 🐞 button (top right) shows how to report a bug or suggest a feature. The version (`APP_VERSION` in
`assets/app.js`, and the badge in `index.html`) is 1.0.

## Your work is kept in the browser

There is no server and no account. Crops are kept in IndexedDB; your own orders and bookmarks in localStorage and, as a
second copy, in IndexedDB. **Your work** (top right) exports all of it as a small progress file and imports it again, in this browser or
another one (the page images are cut again from Yale's photographs on import).

3D and the Reader follow the same place: the page you are on in the Reader is the sheet picked out in 3D, and the sheet
or opening you pick in 3D is where the Reader opens. Every view has its own URL (`#read/<order>/<page>`, `#three/<order>/<view>`), so a
view can be bookmarked or shared.

## Run it locally

It is a static site: plain HTML, CSS and JavaScript, no build step. Serve the folder with any web server, e.g.

```bash
python3 -m http.server 8000
```

and open <http://localhost:8000>. (Opening `index.html` straight from disk does not work: browsers block `fetch` of
local files.)

To run the automatic checks (Node.js 20 or newer): `npm install`, `npx playwright install chromium` once, then
`npm test`. GitHub runs the same checks on every pull request; see [tests/README.md](tests/README.md).

## Layout

```
index.html              the page
assets/app.js           the Reader, Info (with the Folio order tables), the order logic and the shared place (POS)
assets/work.js          your work: crops (cut in the browser), your own orders, export and import
assets/arrange.js       Rearrange in 3D: the table's selection, bar, menus and keys (the table itself is drawn in
                        view3d.js), the list beside it, and the panel under the book on phones
assets/view3d.js        the 3D view (ES module, loaded when the 3D tab first opens)
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
data/folds.json         which way each foldout's folds go and which faces touch when the book is closed, as Lisa
                        Fagin Davis described them; 3D folds the sheets by it and marks those contacts confirmed
tools/import_from_scout.py   refreshes data/codex.json and data/panels/ from a local Voynich Scout checkout
tools/seams.py          measures those bands from data/panels/ and rewrites data/seams.json (run it after an import)
CNAME                   the custom domain for GitHub Pages
tests/                  the automatic checks (Playwright); what they cover and how to read a failure: tests/README.md
.github/workflows/tests.yml   runs them on GitHub for every pull request and every push to main
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
  the page variables of his ZL transliteration (the text itself is not used).
- 3D: [three.js](https://threejs.org) (MIT licence, `assets/vendor/three.LICENSE`).
