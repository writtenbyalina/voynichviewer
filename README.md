# Voynich Viewer 1.0

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

## Layout

```
index.html              the page
assets/app.js           the Reader, Info (with the Folio order tables), the order logic and the shared place (POS)
assets/work.js          your work: crops (cut in the browser), your own orders, export and import
assets/arrange.js       the Rearrange panel of the 3D view
assets/view3d.js        the 3D view (ES module, loaded when the 3D tab first opens)
assets/privacy.js       the cookie strip and consent; loads Microsoft Clarity only after "Accept"
assets/style.css
assets/vendor/          three.js r184 (MIT)
data/codex.json         the physical model: sheets, quires, panels, scribes, sections, page variables, and for each
                        panel its Yale photograph (IIIF id) and the corners it is cut from
data/orders.json        reading orders, sources and per-sheet evidence notes; edited by hand
data/panels/            two JPEGs per panel face: _l (1400 px tall) and _s (300 px); zoomed in, the Reader loads the
                        page at full size from Yale instead
tools/import_from_scout.py   refreshes data/codex.json and data/panels/ from a local Voynich Scout checkout
CNAME                   the custom domain for GitHub Pages
```

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
