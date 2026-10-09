# "Old data, new code": keeping people's saved work safe

People's work lives in **their own browser** (and in progress files they exported), not on your site. When you change a
feature, that old data meets your new code. These tests make sure it still works, and that nothing gets lost.

## What people have saved

| Where | What |
| --- | --- |
| `localStorage`, keys starting `vv:` | bookmarks (`vv:bookmarks`), their own orders (`vv:mine`), the order they were on (`vv:order`), settings (`vv:labels`, `vv:scribes`, `vv:ghosts`, `vv:3d:*`), the cookie choice (`vv:consent`) |
| IndexedDB `voynich-viewer`, store `crops` | each page they re-cut: its four corners on Yale's photograph, rotation, size |
| IndexedDB, store `img` | the pictures cut from those corners (`f1r_l`, `f1r_s`, ...) |
| IndexedDB, store `work` | a second copy of their orders and bookmarks |
| A progress file | "Your work" → Export (also Export in the Rearrange panel): `app`, `version`, `orders`, `bookmarks`, `crops` |

## How the tests work

Each released version of the site is **frozen as a "generation"**: a folder `v1.0/`, `v1.1/`, ... holding exactly what that
release wrote into a browser (`storage.json`), the progress file it exported (`progress.json`), and what was made (`meta.json`).
They were made by running a realistic visitor (`scenario.js`: 4 bookmarks, 2 orders of their own using every sewing option,
2 re-cut pages, settings) against that release's own code, taken from git, so they are the real thing and not a guess.

Then, for each generation, the tests open the **current** site with that visitor's data in a clean browser:

| Test file | Question it answers |
| --- | --- |
| `legacy-storage.spec.js` | Does their saved work come back exactly, and read and draw? Does just opening the site change or lose anything? What if the cut pictures, or localStorage, or IndexedDB are gone, or the database is older, or the two copies disagree? |
| `legacy-imports.spec.js` | Does every old progress file import, give what it promises, and read afterwards? Nothing lost on export then import again? Odd files: untidy, minimal, from a later version, sheets that no longer exist. |
| `legacy-format.spec.js` | **Did the format of what is saved change?** Compares what the current code saves, and exports, with every earlier release: a key may be added but not removed or changed into another kind of value. |
| `legacy-migrations.spec.js` | Crops saved under a panel a later release split (`f70r2`, `f70v2`) are carried to the new panels: exactly which corners, once only, nothing deleted, damaged or unmatched crops left alone, imports too. |
| `legacy-drift.spec.js` | Your **own data** changes under their work (a panel becomes a lost leaf, a sheet goes or appears, panels gain fields, pictures are regenerated, an order is removed). Also: last release's cached scripts against today's data. Also: panel keys, page names, sheet ids and each panel's Yale photograph are still what every release had, because saved work points at them. |

## When you change a feature

1. Make the change. Run `npm run test:legacy` (about a minute and a half).
2. **All green:** old data still works. Carry on.
3. **`legacy-format` fails:** you changed what is saved. The message lists exactly which key went or changed. Keep reading the
   old format (the other legacy tests show where it breaks), and convert old data when the site starts. Never edit the frozen
   files to make a failing test pass: they are what people have.
4. **`legacy-drift` "points at" fails:** you renamed or removed a panel key, page name or sheet id, or changed a panel's
   Yale photograph or its size. Saved crops, bookmarks and orders refer to those. Carry them across with a migration, or
   don't make the change.
5. When you **release**, freeze it (see below), so the next change is tested against this one too.

## Freezing a new release

After you have committed the release (the badge, `APP_VERSION` and `data/changelog.json` agree on the number):

```bash
npm run legacy:snapshot -- v1.2        # captures HEAD
git add tests/legacy && git commit -m "Freeze what v1.2 saves, for the old-data tests"
```

Do this for every release in which something people save could have changed, and it costs nothing to do it for all of them.
The snapshot is made from the committed code, not from your working copy, so it is what visitors really have. Each
generation adds about 100 KB.

## Things the tests found (so far)

- **1.1 retired two panel keys, and a migration now carries those crops across.** `f70r2` and `f70v2` became `f70r2-1`/`-2` and
  `f70v2-1`/`-2`, so a crop someone made of either page in 1.0 stopped applying. `RETIRED_PANELS` in `assets/work.js` now carries
  such a crop to the new panels, once, when the site starts and when a progress file is imported: the corners they *moved*, on
  the edges a new panel still shares with the old crop, plus the turn they gave the page; everything else is the published crop.
  Their old record is kept and marked (`migratedTo`), so nothing is deleted, it does not run twice, and a crop they throw away
  does not come back. `legacy-migrations.spec.js` holds it to that. To retire another panel, add an entry to `RETIRED_PANELS`
  in the same release: the "panel key still exists" test fails until you do.
- **A crop does not remember how big Yale's photograph was.** Its corners are pixels on that photograph, so if you ever
  change a panel's `src_size` (or Yale image id), old corners land in the wrong place. A skipped test
  (`test.fixme`) describes it; the "photograph ... is the same one, at the same size" test stops you doing it by accident.
  If you do need to change it, store the photograph's size with each saved crop first, and scale old corners on load.
- A hand-written order with no `id` makes a new order each time it is imported (an exported file's orders have ids, and
  replace themselves). Expected, not tested.

## Notes

- The tests that read old scripts and old data use `git show`, so a CI checkout needs the full history
  (`fetch-depth: 0`, already set in the workflow). Without it those tests skip with a message saying so.
- `tests/legacy/progress/` holds hand-made progress files. Add one when you hear of a real file that went wrong, with a
  line for it in `HAND_MADE` in `legacy-imports.spec.js` saying what it should give.
- Two test runs at the same time are fine: each local run uses its own output folder.
