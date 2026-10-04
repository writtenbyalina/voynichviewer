// OLD DATA, NEW CODE: the site's OWN data changes while people's saved work stays the same.
//
// You are going to change the cutouts and the image quality, which means codex.json and the pictures move under people's
// saved crops, bookmarks and orders. Each test here changes the data the way such an edit might, with the latest frozen
// visitor's work already saved, and checks that the site still starts, that their work is not damaged, and that nothing
// they saved is deleted behind their back. (The data is changed on its way to the browser; your files are not touched.)
//
// The second half runs the scripts of the PREVIOUS releases against today's data: for a few minutes after a deploy, a visitor's
// browser may still have the old scripts cached while it fetches the new data files.
const { test, expect, openSite, goTo, walkAllOpenings, paintedFraction } = require("./fixtures");
const L = require("./legacy/helpers");
const fs = require("fs");
const path = require("path");

// these walk whole orders, opening by opening; give them room when the machine is busy
test.describe.configure({ timeout: 90_000 });

const gens = L.generations();
const latest = gens[gens.length - 1];
const saved = L.parsed(latest.storage);
const readData = f => JSON.parse(fs.readFileSync(path.join(L.ROOT, "data", f), "utf8"));
const segsOf = codex => codex.sheets.flatMap(s => ["inside", "outside"].flatMap(f => s[f].flat()));

/** Serve codex.json / orders.json with a change made to them on the way, then open the site with the latest visitor's work saved. */
async function boot(page, { codex, orders, hash = "#read/beinecke", change } = {}) {
  if (codex) await page.route("**/data/codex.json", r => { const d = readData("codex.json"); codex(d); return r.fulfill({ json: d }); });
  if (orders) await page.route("**/data/orders.json", r => { const d = readData("orders.json"); orders(d); return r.fulfill({ json: d }); });
  const snap = L.clone(latest.storage);
  if (change) change(snap);
  await L.seedStorage(page, snap);
  await openSite(page, hash);
}
const sameStorage = async page => {   // what they saved is exactly what they saved
  const after = await L.dumpStorage(page);
  for (const k of ["vv:bookmarks", "vv:mine"]) expect(JSON.parse(after.localStorage[k]), `localStorage ${k} was rewritten`).toEqual(JSON.parse(latest.storage.localStorage[k]));
  for (const [store, entries] of Object.entries(latest.storage.indexedDB.stores)) {
    const now = Object.fromEntries(after.indexedDB.stores[store] || []);
    for (const [k, v] of entries) expect(now[k], `IndexedDB ${store} / ${k} changed or went`).toEqual(v);
  }
};
/** Remove a sheet from the data, everywhere the data mentions it (as an edit of codex.json and orders.json would). */
const dropSheet = id => ({
  codex: d => { d.sheets = d.sheets.filter(s => s.id !== id); for (const q of d.quires) q.bifolia = q.bifolia.filter(b => b !== id); },
  orders: d => {
    delete d.evidence[id];
    for (const o of d.orders) {
      for (const g of o.gatherings || []) { g.bifolia = g.bifolia.filter(b => b !== id); if (g.sheets) delete g.sheets[id]; }
      if (o.gatherings) o.gatherings = o.gatherings.filter(g => g.bifolia.length);   // a gathering with nothing left in it goes too
    }
  },
});

test.describe("old data: the site's own data changes under their saved work", () => {
  test("a page becomes a lost leaf: its crop is kept in storage for if it comes back, and nothing else is disturbed", async ({ page }) => {
    await boot(page, { codex: d => { for (const s of segsOf(d)) if (s.img === "f1r") { for (const k of Object.keys(s)) if (!["page", "vars", "scribes", "section"].includes(k)) delete s[k]; s.missing = true; } } });
    expect(await page.evaluate(() => [Crops.mine.has("f1r"), Crops.mine.has("f78v")])).toEqual([false, true]);
    expect(await page.evaluate(() => Bookmarks.list.length)).toBe(saved.bookmarks.length);
    expect(await walkAllOpenings(page)).toEqual([]);
    await sameStorage(page);
  });

  test("a sheet disappears from the data: it goes from their orders and bookmarks, the rest stays, and nothing is rewritten", async ({ page }) => {
    test.setTimeout(120_000);
    const gone = "67|68";   // in the first order with a sewing option, and carries the 'Big foldout' bookmark (f67r1)
    await boot(page, dropSheet(gone));
    const orders = await page.evaluate(() => MyOrders.list.map(o => ({ id: o.id, bifolia: o.gatherings.flatMap(g => g.bifolia), unplaced: o.unplaced })));
    for (const o of saved.orders) {
      const now = orders.find(x => x.id === o.id);
      expect(now.bifolia, `"${o.title}": the same sheets, minus the one that went`).toEqual(o.gatherings.flatMap(g => g.bifolia).filter(id => id !== gone));
      expect([...now.bifolia, ...now.unplaced], "nothing else goes missing").not.toContain(gone);
    }
    expect(await page.evaluate(() => Bookmarks.list.map(b => b.page))).toEqual(saved.bookmarks.map(b => b.page).filter(p => p !== "f67r1"));
    for (const o of saved.orders) {
      await page.locator("#cx-order").selectOption(o.id);
      expect(await walkAllOpenings(page), `reading "${o.title}"`).toEqual([]);
    }
    await goTo(page, "info");   // the Folio order tables are drawn for their orders too
    await sameStorage(page);
  });

  test("a new sheet appears in the data: it turns up set aside in their orders, never lost", async ({ page }) => {
    await boot(page, {
      hash: `#three/${latest.meta.currentOrder}`,
      codex: d => {
        const n = JSON.parse(JSON.stringify(d.sheets.find(s => s.id === "1|8")));
        n.id = "200|201"; n.leaves = [200, 201]; n.quire = 20;
        for (const f of ["inside", "outside"]) for (const r of n[f]) for (const g of r) g.page = g.page.replace(/^f(\d+)/, (_, num) => (num === "1" ? "f200" : "f201"));
        d.sheets.push(n);
        d.quires.find(q => q.q === 20).bifolia.push("200|201");
      },
    });
    for (const o of saved.orders) {
      expect(await page.evaluate(id => ORDERS.get(id).unplaced.includes("200|201"), o.id), `"${o.title}" sets the new sheet aside`).toBe(true);
    }
    await page.waitForFunction(() => View3D.mod?.debug?.V?.built, null, { timeout: 20_000 });
    await page.keyboard.press("a");
    await expect(page.locator("#v3-arrange")).toContainText("200|201");
    await sameStorage(page);
  });

  test("every panel gains new fields (a cutout outline, say): ignored by the pages, and no saved work is touched", async ({ page }) => {
    await boot(page, { hash: "#read/beinecke/78v", codex: d => { for (const s of segsOf(d)) if (!s.missing) { s.cutout = { outline: [[0, 0], [1, 0], [1, 1]], quality: "hi" }; s.future = true; } } });
    expect(await walkAllOpenings(page)).toEqual([]);
    expect(await page.evaluate(() => Crops.mine.size)).toBe(latest.meta.crops);
    await sameStorage(page);
  });

  test("the published pictures are regenerated (new versions): their own crops still show, the others pick up the new picture", async ({ page }) => {
    await boot(page, { hash: "#read/beinecke/78v", codex: d => { for (const s of segsOf(d)) if (s.v) s.v += 1000; } });
    // a panel nobody cropped, whose picture carries a version
    const other = await page.evaluate(() => { for (const sh of D.sheets) for (const f of ["inside", "outside"]) for (const r of sh[f]) for (const sg of r) if (sg.img && sg.v && !Crops.mine.has(sg.img)) return { key: sg.img, v: sg.v }; });
    expect(other, "some panel should carry a version").toBeTruthy();
    await page.evaluate(k => Reader.go(Reader.find(k), 0, k), other.key);
    await expect.poll(() => page.locator(`#rd-zoomer img[data-key="${other.key}"]`).first().getAttribute("src")).toContain(`?v=${other.v}`);
    await page.evaluate(() => Reader.go(Reader.find("f78v"), 0, "f78v"));
    expect(await page.locator('#rd-zoomer img[data-key="f78v"]').first().getAttribute("src"), "their own crop of 78v is still what shows").toMatch(/^blob:/);
    expect(await walkAllOpenings(page)).toEqual([]);
    await sameStorage(page);
  });

  test("a built-in order is removed: the order they had selected falls back, and the order they copied from it still works", async ({ page }) => {
    await boot(page, { orders: d => { d.orders = d.orders.filter(o => o.id !== "davis"); }, hash: "", change: s => { s.localStorage["vv:order"] = JSON.stringify("davis"); } });
    expect(await page.evaluate(() => S.order)).toBe("beinecke");
    const copy = latest.meta.orderIds[1];   // the copy of the Davis order
    await page.locator("#cx-tabs button[data-view=read]").click();
    await page.locator("#cx-order").selectOption(copy);
    expect(await walkAllOpenings(page)).toEqual([]);
    await sameStorage(page);
  });

  // KNOWN GAP, found by this test: a saved crop is four corners in the pixels of Yale's photograph, but the record does not say
  // how big that photograph was. If codex.json starts describing a panel's photograph at another size (src_size), the saved
  // corners fall outside it and the crop editor opens with corners off the photograph (and cutting the page again would cut
  // the wrong place). Until crop records remember the photograph size they refer to, never change a panel's src_size or iiif
  // id once released: the data tests at the bottom of this file fail if you do. Remove `.fixme` when records carry the size.
  test.fixme("the photograph is described at another size: the site starts, their crop still shows, the editor keeps corners on the photograph", async ({ page }) => {
    await L.standInForYale(page);
    await boot(page, { hash: "#read/beinecke/78v", codex: d => { for (const s of segsOf(d)) if (s.src_size) { s.src_size = s.src_size.map(v => Math.round(v / 2)); s.quad = s.quad.map(p => p.map(v => Math.round(v / 2))); } } });
    expect(await page.locator('#rd-zoomer img[data-key="f78v"]').first().getAttribute("src")).toMatch(/^blob:/);
    await page.keyboard.press("c");
    await expect(page.locator("#crop-dlg #ce-loading")).toBeHidden({ timeout: 15_000 });
    const outside = await page.evaluate(() => { const [W, H] = CE.seg.src_size; return CE.quad.filter(([x, y]) => x < 0 || y < 0 || x > W || y > H); });
    expect(outside, "corners outside the photograph").toEqual([]);
  });
});

test.describe("old data: yesterday's cached scripts, today's data files", () => {
  // A browser keeps a page's scripts for only a few minutes (GitHub Pages: 10), so the pair that can really meet is the
  // release before this one, not 1.0 from months ago.
  for (const g of [latest]) {
    test(`${g.generation}'s scripts, as a visitor's browser may still hold them, run against the data files as they are now`, async ({ page }) => {
      test.skip(!L.revisionAvailable(g.rev), `git history for ${g.generation} is not here (the CI checkout must have fetch-depth: 0)`);
      test.setTimeout(90_000);
      await L.serveRevision(page, { code: g.rev, data: "worktree" });
      await L.seedStorage(page, g.storage);
      await openSite(page, "#read/beinecke");
      expect(await page.evaluate(() => [MyOrders.list.length, Bookmarks.list.length, Crops.mine.size])).toEqual([g.meta.orders, g.meta.bookmarks, g.meta.crops]);
      expect(await walkAllOpenings(page)).toEqual([]);
      await page.locator("#cx-order").selectOption(g.meta.orderIds[0]);
      expect(await walkAllOpenings(page), "their own order").toEqual([]);
      await goTo(page, "three");
      await page.waitForFunction(() => View3D.mod?.debug?.V?.built, null, { timeout: 20_000 });
      await expect.poll(() => paintedFraction(page, page.locator("#v-three canvas")), { timeout: 15_000 }).toBeGreaterThan(0.02);
      await goTo(page, "info");
    });
  }
});

// What saved work points at must still exist. Crops are saved against a panel's key and Yale's photograph (its id and size),
// bookmarks against a page name, orders against sheet ids. These compare today's codex.json with the one in each release.
/** The table of retired panels in assets/work.js (RETIRED_PANELS: which crops are carried to which new panels), read as data. */
function appRetiredPanels() {
  const js = fs.readFileSync(path.join(L.ROOT, "assets/work.js"), "utf8");
  const m = js.match(/const RETIRED_PANELS = (\{[\s\S]*?\n\});/);
  expect(m, "RETIRED_PANELS in assets/work.js").toBeTruthy();
  return new Function(`return (${m[1]})`)();
}

test.describe("old data: what saved work points at is still in the data", () => {
  for (const g of gens) {
    test.describe(`as of ${g.generation}`, () => {
      test.skip(!L.revisionAvailable(g.rev), `git history for ${g.generation} is not here (the CI checkout must have fetch-depth: 0)`);
      const before = () => readData2(g);
      const now = readData("codex.json");
      const panels = codex => new Map(segsOf(codex).filter(s => s.img).map(s => [s.img, s]));
      const hint = "People have work saved against this. If it is deliberate, saved work has to be migrated, not left to disappear (see tests/legacy/README.md).";

      test("every sheet still exists (their orders list sheets by id)", () => {
        const have = new Set(now.sheets.map(s => s.id));
        expect(before().sheets.map(s => s.id).filter(id => !have.has(id)), hint).toEqual([]);
      });
      test("every page name still exists (their bookmarks are saved by page name)", () => {
        const have = new Set(segsOf(now).map(s => s.page));
        expect([...new Set(segsOf(before()).map(s => s.page))].filter(p => !have.has(p)), hint).toEqual([]);
      });
      test("every panel key still exists (their crops are saved by panel key)", () => {
        // a panel key may go only if work.js carries crops saved under it to the panels that replace it (RETIRED_PANELS)
        const have = panels(now), migrated = appRetiredPanels();
        expect([...panels(before()).keys()].filter(k => !have.has(k) && !(k in migrated)), `${hint} Add it to RETIRED_PANELS in assets/work.js.`).toEqual([]);
      });
      test("each panel's photograph at Yale is the same one, at the same size (their crop corners are pixels on it)", () => {
        const have = panels(now), moved = [];
        for (const [k, old] of panels(before())) {
          const cur = have.get(k);
          if (!cur) continue;
          if (cur.iiif !== old.iiif) moved.push(`${k}: Yale image ${old.iiif} -> ${cur.iiif}`);
          if (JSON.stringify(cur.src_size) !== JSON.stringify(old.src_size)) moved.push(`${k}: photograph ${old.src_size} -> ${cur.src_size}`);
        }
        expect(moved, hint).toEqual([]);
      });
    });
  }
  function readData2(g) { return L.readAtRevision(g.rev, "data/codex.json"); }
});

// The migration table must say what the data said when the panel was retired, or the corners it carries would be wrong.
test.describe("old data: the table of retired panels matches the data", () => {
  const table = appRetiredPanels();
  const now = readData("codex.json");
  const panels = codex => new Map(segsOf(codex).filter(s => s.img).map(s => [s.img, s]));

  for (const [key, old] of Object.entries(table)) {
    test(`${key}: its published crop in the table is the one the last release that had it shipped, and what replaced it is there`, () => {
      const holders = gens.filter(g => L.revisionAvailable(g.rev) && panels(L.readAtRevision(g.rev, "data/codex.json")).has(key));
      test.skip(!L.revisionAvailable(gens[0].rev), "git history is not here (the CI checkout must have fetch-depth: 0)");
      expect(holders.length, `no release has a panel "${key}": is the table entry for a panel that never existed?`).toBeGreaterThan(0);
      const was = panels(L.readAtRevision(holders[holders.length - 1].rev, "data/codex.json")).get(key);
      expect(old.quad, `${key}: quad`).toEqual(was.quad);
      expect(old.rotate, `${key}: rotate`).toBe(was.rotate || 0);
      expect(panels(now).has(key), `${key} is back in the data: the table entry is stale, remove it`).toBe(false);
      for (const into of Object.keys(old.into)) {
        const cur = panels(now).get(into);
        expect(cur, `${key} is carried to "${into}", which is not in the data`).toBeTruthy();
        expect({ iiif: cur.iiif, src_size: cur.src_size }, `${into} must be cut from the same photograph as ${key}`).toEqual({ iiif: was.iiif, src_size: was.src_size });
      }
    });
  }
});
