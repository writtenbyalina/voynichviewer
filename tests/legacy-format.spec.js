// OLD DATA, NEW CODE: has the FORMAT of what the site saves changed?
//
// The other legacy tests prove that old data still loads. This one catches the change itself, at the moment it is made:
// it makes the same visitor (tests/legacy/scenario.js) with the CURRENT code, and compares what is saved, and what the
// export file contains, with what every earlier release saved. A release may ADD things; it may not remove a key, or turn a
// number into text, because people already have the old shape in their browser and in files.
const { test, expect, openSite } = require("./fixtures");
const L = require("./legacy/helpers");
const { buildScenario } = require("./legacy/scenario");
const fs = require("fs");
const path = require("path");

const gens = L.generations();

test("the frozen releases are intact: each has its files, and the counts in meta.json are what is really in them", () => {
  const listed = JSON.parse(fs.readFileSync(path.join(L.DIR, "releases.json"), "utf8")).map(g => g.generation);
  const onDisk = fs.readdirSync(L.DIR).filter(f => /^v\d+\.\d+$/.test(f));
  expect(onDisk.sort(), "every folder in tests/legacy is listed in releases.json, and the other way round").toEqual([...listed].sort());
  for (const g of gens) {
    const p = L.parsed(g.storage);
    expect({ orders: p.orders.length, bookmarks: p.bookmarks.length, crops: Object.keys(p.crops).length }, `${g.generation} storage.json`)
      .toEqual({ orders: g.meta.orders, bookmarks: g.meta.bookmarks, crops: g.meta.crops });
    expect({ orders: g.progress.orders.length, bookmarks: g.progress.bookmarks.length, crops: Object.keys(g.progress.crops).length }, `${g.generation} progress.json`)
      .toEqual({ orders: g.meta.orders, bookmarks: g.meta.bookmarks, crops: g.meta.crops });
    expect(g.storage.rev, `${g.generation}: storage.json is from the revision releases.json names`).toBe(g.rev);
    expect(Object.keys(p.images).length, `${g.generation}: two pictures per crop`).toBe(2 * g.meta.crops);
  }
});

test("what the site saves today still contains everything earlier releases saved, in the same kinds of value", async ({ page }) => {
  test.setTimeout(90_000);
  await L.standInForYale(page);
  await page.goto("/index.html#read/beinecke/78v");
  const now = await buildScenario(page);

  const shapeOfStorage = s => L.shapeOf(L.storageTree(s), "");
  const shapeOfExport = e => L.shapeOf({ progress: e });
  const newStorage = shapeOfStorage(now.storage), newExport = shapeOfExport(now.progress);

  const broken = [];
  for (const g of gens) {
    for (const p of L.brokenBy(shapeOfStorage(g.storage), newStorage)) broken.push(`saved in the browser, as ${g.generation} saved it: ${p}`);
    for (const p of L.brokenBy(shapeOfExport(g.progress), newExport)) broken.push(`in the export file, as ${g.generation} wrote it: ${p}`);
    if (now.storage.indexedDB.name !== g.storage.indexedDB.name) broken.push(`the IndexedDB database was called "${g.storage.indexedDB.name}" and is now "${now.storage.indexedDB.name}"`);
    if (now.storage.indexedDB.version < g.storage.indexedDB.version) broken.push(`the IndexedDB version went down: ${g.storage.indexedDB.version} → ${now.storage.indexedDB.version}`);
    if (now.progress.app !== g.progress.app) broken.push(`the export's "app" was "${g.progress.app}" and is now "${now.progress.app}"`);
    if (now.progress.version < g.progress.version) broken.push(`the export's "version" went down: ${g.progress.version} → ${now.progress.version}`);
  }
  expect(broken, [
    "The format of saved work has changed in a way that breaks what people already have.",
    "If this was on purpose: keep reading the old format (see the 'old data' tests, which must still pass), and migrate it when the site starts.",
    "Do not edit the frozen files in tests/legacy to make this pass.",
  ].join("\n")).toEqual([]);

  const latest = gens[gens.length - 1];
  const added = [...L.addedBy(shapeOfStorage(latest.storage), newStorage).map(p => `saved: ${p}`), ...L.addedBy(shapeOfExport(latest.progress), newExport).map(p => `export: ${p}`)];
  if (added.length) test.info().annotations.push({ type: `new since ${latest.generation}`, description: `${added.join(", ")}  (when you release this, run: npm run legacy:snapshot -- vX.Y)` });
});

test("the site still writes the keys people's data lives under", async ({ page }) => {
  // a rename of a key would make everybody's saved data invisible without any error, so the names themselves are pinned
  await L.standInForYale(page);
  await page.goto("/index.html#read/beinecke/78v");
  const now = await buildScenario(page);
  const mustKeep = ["vv:bookmarks", "vv:mine", "vv:order", "vv:labels", "vv:scribes", "vv:ghosts", "vv:consent", "vv:3d:posture", "vv:3d:spread", "vv:3d:overlay", "vv:3d:hidden", "vv:3d:hinted"];
  expect(Object.keys(now.storage.localStorage)).toEqual(expect.arrayContaining(mustKeep));
  expect(Object.keys(now.storage.indexedDB.stores).sort()).toEqual(expect.arrayContaining(["crops", "img", "work"]));
  expect(now.storage.indexedDB.name).toBe("voynich-viewer");
});
