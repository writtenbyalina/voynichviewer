// OLD DATA, NEW CODE: crops saved under panels that a later release retired.
//
// Version 1.1 split two panels, f70r2 and f70v2, in two. A crop is saved under the panel's key, so anyone who had cropped
// either page in 1.0 would have lost the crop without a word. assets/work.js now carries such a crop to the panels that
// replaced it (RETIRED_PANELS, Crops.carry), once, at start-up and when a progress file is imported. These tests hold it to what
// it promises: carry what is theirs, invent nothing, delete nothing, and never do it twice.
const { test, expect, openSite } = require("./fixtures");
const L = require("./legacy/helpers");
const { LEGACY_CROPS } = require("./legacy/scenario");
const fs = require("fs");
const path = require("path");

test.describe.configure({ timeout: 90_000 });

const v10 = L.generations().find(g => g.generation === "v1.0");
const codex = JSON.parse(fs.readFileSync(path.join(L.ROOT, "data/codex.json"), "utf8"));
const published = key => codex.sheets.flatMap(s => ["inside", "outside"].flatMap(f => s[f].flat())).find(s => s.img === key);
const pub = key => published(key).quad;
const [R2, V2] = LEGACY_CROPS.map(c => c[1]);   // the 1.0 visitor's corners for f70r2 and f70v2: TL, TR, BR, BL

// what the carry should give for that visitor: their corners on the edges a new panel shares with the old crop, the published rest
const EXPECT = {
  "f70r2-1": [R2[0], pub("f70r2-1")[1], pub("f70r2-1")[2], R2[3]],          // shares the left edge
  "f70v2-2": [V2[0], pub("f70v2-2")[1], pub("f70v2-2")[2], V2[3]],          // the left half: shares the left edge
  "f70v2-1": [pub("f70v2-1")[0], V2[1], V2[2], pub("f70v2-1")[3]],          // the right half: shares the right edge
};
const quadSize = q => { const d = (a, b) => Math.hypot(q[a][0] - q[b][0], q[a][1] - q[b][1]); return [Math.max(d(0, 1), d(3, 2)), Math.max(d(0, 3), d(1, 2))]; };

/** A copy of the 1.0 visitor's storage with the crop records for f70r2 and f70v2 replaced (null removes one). */
function withF70(records) {
  const snap = L.clone(v10.storage);
  const crops = snap.indexedDB.stores.crops.filter(([k]) => !(k in records) || records[k] !== null).map(([k, v]) => [k, k in records ? records[k] : v]);
  for (const [k, v] of Object.entries(records)) if (v && !crops.some(([x]) => x === k)) crops.push([k, v]);
  snap.indexedDB.stores.crops = crops;
  return snap;
}
const rec = (quad, extra = {}) => ({ quad, rotate: 0, w: 1000, h: 1000, v: 1, updated: "2026-10-03T12:00:00.000Z", ...extra });
const minePage = page => page.evaluate(() => Object.fromEntries([...Crops.mine].map(([k, r]) => [k, { quad: r.quad, rotate: r.rotate, w: r.w, h: r.h }])));
const dump = async (page, store = "crops") => Object.fromEntries((await L.dumpStorage(page)).indexedDB.stores[store]);

test.describe("old data: crops of panels that were split are carried to the new panels", () => {
  test("a 1.0 visitor's crops of f70r2 and f70v2: their edges go to the panels that share them, the rest is the published crop", async ({ page }) => {
    await L.seedStorage(page, v10.storage);
    await openSite(page, "#read/beinecke/70v2");
    const now = await minePage(page);
    for (const [key, quad] of Object.entries(EXPECT)) {
      expect(now[key], `a crop for ${key}`).toBeTruthy();
      expect(now[key].quad, `${key}: corners`).toEqual(quad);
      expect(now[key].rotate).toBe(0);
      const [w, h] = quadSize(quad);
      expect([now[key].w, now[key].h], `${key}: size follows the corners`).toEqual([Math.round(w), Math.round(h)]);
    }
    expect(now["f70r2-2"], "f70r2-2 has nothing of theirs: the published crop of the whole page shows").toBeUndefined();
    expect(Object.keys(now).sort(), "and their other crops are as they were").toEqual([...L.cropsToday(v10).keys].sort());
    expect(now.f1r.quad).toEqual(JSON.parse(JSON.stringify(Object.fromEntries(v10.storage.indexedDB.stores.crops).f1r.quad)));
  });

  test("it is saved: the new crops are in IndexedDB, and the old records are kept, whole, and marked", async ({ page }) => {
    await L.seedStorage(page, v10.storage);
    await openSite(page, "#read/beinecke");
    await page.waitForTimeout(500);
    const crops = await dump(page);
    for (const [key, quad] of Object.entries(EXPECT)) expect(crops[key].quad, `${key} in IndexedDB`).toEqual(quad);
    const was = Object.fromEntries(v10.storage.indexedDB.stores.crops);
    for (const key of ["f70r2", "f70v2"]) {
      expect(crops[key], `the old record of ${key} is kept, with everything in it`).toMatchObject(was[key]);
      expect(crops[key].migratedTo).toEqual(key === "f70r2" ? ["f70r2-1"] : ["f70v2-2", "f70v2-1"]);
      expect(crops[key].migrated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    expect(Object.keys((await dump(page, "img"))), "their old cut pictures are not touched").toEqual(expect.arrayContaining(v10.storage.indexedDB.stores.img.map(e => e[0])));
  });

  test("the new panels are cut from Yale's photograph and show their picture; with no photograph, the published pictures show", async ({ page }) => {
    await L.standInForYale(page);
    await L.seedStorage(page, v10.storage);
    await openSite(page, "#read/beinecke/70v2");
    await page.waitForFunction(() => ["f70r2-1", "f70v2-2", "f70v2-1"].every(k => CUSTOM_IMG.has(k + "_l")), null, { timeout: 20_000 });
    expect(await page.evaluate(() => CUSTOM_IMG.has("f70r2-2_l")), "no picture is made for a panel they did not change").toBe(false);
    expect(Object.keys(await dump(page, "img"))).toEqual(expect.arrayContaining(["f70r2-1_l", "f70r2-1_s", "f70v2-2_l", "f70v2-1_l"]));
  });

  test("they are told once, with a way to check the edges", async ({ page }) => {
    await L.seedStorage(page, v10.storage);
    await openSite(page, "#read/beinecke");
    await expect(page.locator("#cx-toast")).toContainText("carried over", { timeout: 8000 });
    await expect(page.locator("#cx-toast")).toContainText("f70r2-1");
    await expect(page.locator("#cx-toast").getByRole("button", { name: "Check" })).toBeVisible();
    await page.reload();
    await page.waitForTimeout(2500);
    await expect(page.locator("#cx-toast"), "not told again").not.toContainText("carried over");
  });

  test("it happens once: opening again changes nothing", async ({ page }) => {
    await L.seedStorage(page, v10.storage);
    await openSite(page, "#read/beinecke");
    await page.waitForTimeout(500);
    const first = await dump(page);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#cx-tabs [aria-selected='true']"));
    await page.waitForTimeout(800);
    expect(await dump(page), "crops store after a second visit").toEqual(first);
  });

  test("a carried crop they throw away does not come back", async ({ page }) => {
    await L.seedStorage(page, v10.storage);
    await openSite(page, "#read/beinecke");
    await page.evaluate(() => Crops.reset("f70v2-1"));
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#cx-tabs [aria-selected='true']"));
    expect((await minePage(page))["f70v2-1"]).toBeUndefined();
    expect((await minePage(page))["f70v2-2"], "the other one stays").toBeTruthy();
  });

  test("a new panel they have cropped themselves since is left exactly as it is", async ({ page }) => {
    const theirs = rec([[1500, 100], [3500, 100], [3500, 3650], [1500, 3650]], { w: 2000, h: 3550 });
    await L.seedStorage(page, withF70({ "f70v2-1": theirs }));
    await openSite(page, "#read/beinecke");
    const now = await minePage(page);
    expect(now["f70v2-1"].quad).toEqual(theirs.quad);
    expect(now["f70v2-2"].quad, "the other half is still carried").toEqual(EXPECT["f70v2-2"]);
    expect((await dump(page))["f70v2"].migratedTo, "and the old record says only what it wrote").toEqual(["f70v2-2"]);
  });

  test("a crop that is the published one, untouched, leaves nothing to keep: no records are made", async ({ page }) => {
    await L.seedStorage(page, withF70({ f70r2: rec([[5331, 184], [7775, 184], [7775, 3704], [5331, 3704]]), f70v2: null }));
    await openSite(page, "#read/beinecke");
    const now = await minePage(page);
    expect(Object.keys(now).filter(k => k.startsWith("f70"))).toEqual([]);
    expect((await dump(page)).f70r2.migratedTo, "marked as done, so it is not looked at again").toEqual([]);
  });

  test("only the corners they actually moved are carried: one they never touched takes the new published corner", async ({ page }) => {
    // only the bottom-left corner of f70r2 was moved (by 11 px left, 14 px up); the top-left is still the old published one
    await L.seedStorage(page, withF70({ f70r2: rec([[5331, 184], [7775, 184], [7775, 3704], [5320, 3690]]), f70v2: null }));
    await openSite(page, "#read/beinecke");
    const now = await minePage(page);
    expect(now["f70r2-1"].quad).toEqual([pub("f70r2-1")[0], pub("f70r2-1")[1], pub("f70r2-1")[2], [5320, 3690]]);
  });

  test("the turn they gave a page is carried to every panel it was split into", async ({ page }) => {
    await L.seedStorage(page, withF70({ f70r2: rec([[5331, 184], [7775, 184], [7775, 3704], [5331, 3704]], { rotate: 180 }), f70v2: null }));
    await openSite(page, "#read/beinecke");
    const now = await minePage(page);
    expect(now["f70r2-1"].rotate).toBe(180);
    expect(now["f70r2-2"].rotate, "even the panel with no corners of theirs: the page is upside down for them").toBe(180);
    expect(now["f70r2-2"].quad).toEqual(pub("f70r2-2"));
  });

  test("a damaged crop is left alone, and does not stop the site from starting", async ({ page }) => {
    const bad = { quad: [["x", 1], [2, 3]], rotate: 0 };
    await L.seedStorage(page, withF70({ f70r2: bad, f70v2: { quad: "no", rotate: 0 } }));
    await openSite(page, "#read/beinecke");
    expect(Object.keys(await minePage(page)).filter(k => k.startsWith("f70"))).toEqual([]);
    const crops = await dump(page);
    expect(crops.f70r2, "untouched: no mark, nothing lost").toEqual(bad);
    expect(crops.f70v2).toEqual({ quad: "no", rotate: 0 });
  });

  test("if the data no longer has the panels the table names, nothing is guessed and the old record is left as it was", async ({ page }) => {
    await page.route("**/data/codex.json", route => {
      const d = JSON.parse(fs.readFileSync(path.join(L.ROOT, "data/codex.json"), "utf8"));
      for (const s of d.sheets) for (const f of ["inside", "outside"]) for (const r of s[f]) for (const g of r) if (g.img === "f70r2-2") { delete g.img; g.missing = true; }
      return route.fulfill({ json: d });
    });
    await L.seedStorage(page, v10.storage);
    await openSite(page, "#read/beinecke");
    const crops = await dump(page);
    expect(crops.f70r2.migratedTo, "f70r2 cannot be carried: not marked").toBeUndefined();
    expect(crops["f70r2-1"]).toBeUndefined();
    expect(crops["f70v2-2"], "f70v2 is unaffected").toBeTruthy();
  });

  test("a progress file from 1.0 carries the same crops across when it is imported", async ({ page }) => {
    await L.standInForYale(page);
    await openSite(page, "#read/beinecke");
    await L.importProgress(page, path.join(v10.dir, "progress.json"), { orders: v10.meta.orders, bookmarks: v10.meta.bookmarks, crops: L.cropsToday(v10).count });
    const now = await minePage(page);
    for (const [key, quad] of Object.entries(EXPECT)) expect(now[key].quad, `${key} from the file`).toEqual(quad);
    expect(now["f70r2-2"]).toBeUndefined();
    expect(Object.keys(now).sort()).toEqual([...L.cropsToday(v10).keys].sort());
  });

  test("a progress file that already has the new panels is not overwritten by the old ones", async ({ page }) => {
    const file = path.join(require("os").tmpdir(), `vv-f70-${process.pid}.json`);
    const own = [[1500, 100], [3500, 100], [3500, 3650], [1500, 3650]];
    fs.writeFileSync(file, JSON.stringify({ app: "voynich-viewer", version: 1, crops: { f70v2: { quad: V2, rotate: 0 }, "f70v2-1": { quad: own, rotate: 0 } } }));
    await L.standInForYale(page);
    await openSite(page, "#read/beinecke");
    await L.importProgress(page, file, { orders: 0, bookmarks: 0, crops: 2 });
    const now = await minePage(page);
    expect(now["f70v2-1"].quad).toEqual(own);
    expect(now["f70v2-2"].quad).toEqual(EXPECT["f70v2-2"]);
  });
});
