# Tests for Voynich Viewer

A set of automatic checks that open the real site in a real browser and make sure it still works. They run on GitHub
(every push to `main` and every pull request) and on your own computer.

The site itself has no build step and these tests change nothing about it. `package.json` exists only to run them.

## What GitHub does with them

GitHub calls this **GitHub Actions**. The file [`.github/workflows/tests.yml`](../.github/workflows/tests.yml) tells GitHub
to start a fresh computer, install the tests, run them, and mark the commit with a green tick or a red cross. Two jobs:

| Job | Takes | Checks |
| --- | --- | --- |
| **Data and files** | seconds | the JSON files, every page picture, `index.html`, that every script parses |
| **Site in a browser** | a few minutes | the site in Chromium, on a desktop and on a phone (a screen-sized window with touch) |

If a run fails, open it under the repository's **Actions** tab. The browser job keeps a report (screenshots, and a
step-by-step recording of what the page did) as a download called `playwright-report`.

### Making the tests stop a bad deploy

Running the tests does not by itself stop anything from going live. The site is published straight from `main`, so a push to
`main` deploys whether or not the tests pass. To make a red cross block a deploy, work through a pull request:

1. Do your work on a branch and open a pull request into `main`. The tests run on it.
2. In the repository's **Settings → Branches → Add branch ruleset** (or *branch protection rule*) for `main`, tick
   **Require status checks to pass** and add **Data and files** and **Site in a browser**.
   Tick **Require a pull request before merging** too.

Now `main` (and so the live site) only ever receives work that passed. (The check names appear in the list after the
workflow has run once.)

## Running them yourself

You need Node.js (version 20 or newer) and Python 3, which you have if you can run the site locally.

```bash
npm install                      # once: fetches the test tool
npx playwright install chromium  # once: fetches the browser the tests drive
npm test                         # everything, about two minutes
npm run test:fast                # only the data and file checks, a few seconds
```

Useful variations:

```bash
npx playwright test tests/reader.spec.js            # one file
npx playwright test -g "zoom"                       # tests whose name contains "zoom"
npx playwright test --headed                        # watch the browser do it
npx playwright test --ui                            # a window to step through tests and see each moment
npm run test:report                                 # open the report of the last run
```

The tests start their own web server on port 4173. They do not use the internet: Yale's image server and Microsoft
Clarity are blocked on purpose, so the tests never depend on them and never send anything to them.

## What is covered

| File | What it checks |
| --- | --- |
| `data.spec.js` | `codex.json`, `orders.json`, `changelog.json`: shapes, unique ids, every sheet in every order exists and appears once, every source cited exists, every page has both its pictures and each is a whole JPEG, changelog dates and versions (and that the version is the same in the changelog, the badge and `APP_VERSION`) |
| `site.spec.js` | `index.html` points at files that exist, ids are unique, scripts load in order and parse, imports resolve, icons, `CNAME`, `.nojekyll`, no oversized file |
| `smoke.spec.js` | the site starts; the three tabs; the order menu; What's new; the help, bug and Your work dialogs; a clear message when data cannot load |
| `reader.spec.js` | turning pages every way; **walking every opening of every order** (pictures load, labels show, no page cut off); zoom limits; Go to; foldouts, with and without animation; the grid; labels, scribes and lost leaves; window sizes; the layout staying steady |
| `three.spec.js` | the 3D book is really drawn (not blank); every order; every key in the help; the five camera views; stepping through sheets; the controls; 3D and the Reader following each other; odd addresses; the message when WebGL is missing |
| `routing.spec.js` | every kind of address, old links, nonsense links; stale or damaged saved data; a browser that will not store anything |
| `work.spec.js` | bookmarks; the progress file (export, import into a fresh browser, hostile files); your own orders (Rearrange, undo, reload, delete); the crop tool (against a stand-in for Yale's photograph) |
| `privacy.spec.js` | no request leaves the site before consent; Accept, Reject, close and Global Privacy Control; the 6-month and version rules; changing the choice later; the cookieless visit counter (loads whatever the choice, off for local copy, no token and Global Privacy Control) and the notice describing it |
| `info.spec.js` | every Info section and its contents list; the Folio order tables; every link inside Info; external links open safely |
| `a11y.spec.js` | every control has a name and every picture has alt text; dialogs take focus and close with Escape; Tab reaches the header |
| `legacy-*.spec.js` | **Old data, new code**: what people already saved (bookmarks, their own orders, re-cut pages, settings) and the progress files they exported, from every released version, against the current site; whether the saved format changed; whether your own data changing (panels, sheets, pictures) would strand their work. See `tests/legacy/README.md`. Run on their own with `npm run test:legacy` |
| `mobile.spec.js` | on a phone: no sideways scrolling, controls on screen and tappable, the Reader, 3D, cookie strip and Info all fit |

Several tests are named **"1.1 fix: …"**. They guard bugs `data/changelog.json` lists as fixed, so a fix cannot quietly
come undone.

**Every browser test also fails on any error it did not expect**: an uncaught error, a `console.error`, or any file of
the site that fails to load. So a test about bookmarks also notices a broken image it happened to pass. (See
`fixtures.js`; a test that expects an error, such as a deliberate 404, clears the list itself.)

## Tests marked "fixme"

`test.fixme` means: this is a real problem the tests found, it is written down in a comment above the test with the line
to change, and the test is skipped so it does not turn the whole run red. Each shows as *skipped* in the output. When you fix the
problem, delete `.fixme` so the test guards it from then on.

## When you change the site

- **Added a button or a section?** If it has a name, `a11y.spec.js` already checks it. If it does something, add a test
  next to the closest one: copy a neighbour, they are short.
- **Renamed something in the code?** Tests reach into the app by name for a few things: `R` (the Reader's state),
  `S`, `ORDERS`, `SHEETS`, `PAGE_SHEET`, `Reader`, `View3D`, `Changes`, `Crops`, and the element ids `rd-*`, `cx-*`, `v3-*`.
  If a test fails right after a rename, that is why; update the test.
- **Released a new version?** Change the number in all three places (`data/changelog.json`, the badge in `index.html`,
  `APP_VERSION` in `assets/app.js`). `data.spec.js` fails if one is missed.
- **A test fails and you think the test is wrong?** Run it alone with `--headed` or `--ui` and watch. If it is the test,
  fix the test; do not delete it without knowing what it was guarding.

## Not covered (and why)

- **Exact appearance.** Screenshots compared pixel by pixel break on every font or driver difference, so they would cry
  wolf. The tests check that things are drawn, whole, in place and the right size instead. Look at the site yourself
  before a release.
- **Real graphics hardware.** In the tests WebGL is drawn in software, so they prove the 3D scene is built and drawn, not
  that it is smooth on a particular phone.
- **Safari and Firefox.** Only Chromium. Adding them is a few lines in `playwright.config.js` and an install step.
- **Yale's server itself.** The crop tool is tested with a stand-in picture.
