// OLD DATA, NEW CODE: what people already have saved in their browser.
//
// tests/legacy/ holds frozen snapshots of what each released version of the site wrote into a browser (see
// tests/legacy/README.md). Each test puts one into a clean browser, opens the CURRENT site, and checks that everything the
// visitor made is still there and still works: bookmarks, their own orders, their crops, their settings.
// If you change how the site saves or reads anything and one of these fails, a real person's work would have been lost.
const { test, expect, openSite, openThree, goTo, readerPicturesLoaded, walkAllOpenings, paintedFraction } = require("./fixtures");
const L = require("./legacy/helpers");

// these walk whole orders, opening by opening; give them room when the machine is busy
test.describe.configure({ timeout: 90_000 });

const gens = L.generations();
const latest = gens[gens.length - 1];
const VOLATILE = new Set(["vv:workChanged", "vv:seenVersion"]);   // the site rewrites these as part of normal use

/** Seed a browser with a generation's saved data (optionally changed first), then open the current site. */
async function boot(page, g, { hash = "#read/beinecke", change } = {}) {
  const snap = L.clone(g.storage);
  if (change) change(snap);
  await L.seedStorage(page, snap);
  await openSite(page, hash);
}
const parse = raw => { try { return JSON.parse(raw); } catch { return raw; } };

for (const g of gens) {
  const saved = L.parsed(g.storage);

  test.describe(`old data: saved by ${g.generation}`, () => {
    test("opens on the order they were looking at, in 3D and in the Reader, without errors", async ({ page }) => {
      await L.seedStorage(page, g.storage);
      await openThree(page, "");
      expect(await page.evaluate(() => S.order), "the saved order is still the current one").toBe(g.meta.currentOrder);
      await goTo(page, "read");
      await readerPicturesLoaded(page);
      expect(await walkAllOpenings(page)).toEqual([]);
    });

    test("their bookmarks are all there, with their names, shown as text", async ({ page }) => {
      await boot(page, g);
      const now = await page.evaluate(() => Bookmarks.list.map(({ id, page, name }) => ({ id, page, name })));
      expect(now).toEqual(saved.bookmarks.map(({ id, page, name }) => ({ id, page, name })));
      await expect(page.locator("#cx-bm")).toHaveClass(/\bhas\b/);
      await page.locator("#cx-bm").click();
      await expect(page.locator("#bm-pop .bm-list li")).toHaveCount(saved.bookmarks.length);
      expect(await page.locator("#bm-pop .bm-list b").count(), "a name with <b> in it is text, not markup").toBe(0);
      await expect(page.locator("#rd-strip .t.bm")).not.toHaveCount(0);
    });

    test("their own orders come back exactly as they made them, and read from cover to cover", async ({ page }) => {
      test.setTimeout(120_000);
      await boot(page, g);
      await expect(page.locator("#cx-order optgroup[label='Your orders'] option")).toHaveText(saved.orders.map(o => o.title));
      for (const o of saved.orders) {
        const now = await page.evaluate(id => { const x = ORDERS.get(id); return x && { title: x.title, from: x.from, gatherings: x.gatherings, unplaced: x.unplaced }; }, o.id);
        expect(now, `order ${o.id} (${o.title})`).toEqual({ title: o.title, from: o.from, gatherings: o.gatherings, unplaced: o.unplaced });
        await page.locator("#cx-order").selectOption(o.id);
        await expect(page.locator("#rd-where")).not.toBeEmpty();
        expect(await walkAllOpenings(page), `reading "${o.title}"`).toEqual([]);
      }
    });

    test("their own orders are drawn in 3D, and the sheets they hid are still hidden", async ({ page }) => {
      await boot(page, g, { hash: `#three/${g.meta.orderIds[1]}` });
      await page.waitForFunction(() => View3D.mod?.debug?.V?.built, null, { timeout: 20_000 });
      await expect.poll(() => paintedFraction(page, page.locator("#v-three canvas")), { timeout: 15_000 }).toBeGreaterThan(0.02);
      const stored = parse(g.storage.localStorage["vv:3d:hidden"]);
      const hidden = await page.evaluate(() => [...View3D.mod.hiddenQuires()].map(String));
      expect(hidden).toEqual((stored[g.meta.orderIds[1]] || []).map(String));
      expect(hidden.length, "the scenario hid a gathering").toBeGreaterThan(0);
    });

    test("their crops come back, with their corners, and the pages show their own picture", async ({ page }) => {
      await boot(page, g, { hash: "#read/beinecke/78v" });
      const today = L.cropsToday(g);   // crops of panels a later release split are carried to the new panels: see legacy-migrations.spec.js
      const kept = Object.keys(saved.crops).filter(k => !today.retired.includes(k));
      const now = await page.evaluate(() => Object.fromEntries([...Crops.mine].map(([k, r]) => [k, { quad: r.quad, rotate: r.rotate, w: r.w, h: r.h, v: r.v }])));
      expect(Object.keys(now).sort(), "the crops they have now").toEqual([...today.keys].sort());
      for (const k of kept) expect(now[k], `crop of ${k}`).toEqual({ quad: saved.crops[k].quad, rotate: saved.crops[k].rotate, w: saved.crops[k].w, h: saved.crops[k].h, v: saved.crops[k].v });
      await readerPicturesLoaded(page);
      for (const key of g.meta.cropKeys.filter(k => kept.includes(k))) {
        await page.evaluate(k => Reader.go(Reader.find(k), 0, k), key);
        await readerPicturesLoaded(page);
        const src = await page.locator(`#rd-zoomer img[data-key="${key}"]`).first().getAttribute("src");
        expect(src, `${key} should show the visitor's own picture, not the published one`).toMatch(/^blob:/);
      }
      await page.locator("#cx-work").click();
      await expect(page.locator("#work-dlg")).toContainText(`Your crops (${today.count})`);
    });

    test("their settings are remembered", async ({ page }) => {
      await boot(page, g, { hash: "" });
      await page.waitForFunction(() => View3D.mod?.debug?.V?.built, null, { timeout: 20_000 });
      const ls = saved.ls;
      const now = await page.evaluate(() => ({ labels: S.labels, scribes: S.scribes, ghosts: S.ghosts, order: S.order,
        posture: View3D.mod.debug.V.posture, spread: View3D.mod.debug.V.spread, overlay: View3D.mod.debug.V.overlay, hinted: !!document.querySelector("#v3-hint") }));
      expect(now).toMatchObject({ labels: ls("vv:labels"), scribes: ls("vv:scribes"), ghosts: ls("vv:ghosts"), order: ls("vv:order"),
        posture: ls("vv:3d:posture"), spread: ls("vv:3d:spread"), overlay: ls("vv:3d:overlay") });
      expect(now.hinted, "the 'Got it' hint stays dismissed").toBe(false);
      await expect(page.locator("#pv-strip"), "the cookie choice is remembered").toHaveCount(0);
    });

    test("just opening and using the site changes nothing they saved, and loses nothing", async ({ page }) => {
      await boot(page, g, { hash: "#read/beinecke/78v" });
      await readerPicturesLoaded(page);
      await goTo(page, "three");
      await page.waitForFunction(() => View3D.mod?.debug?.V?.built, null, { timeout: 20_000 });
      for (const k of ["ArrowRight", "ArrowRight", "ArrowLeft"]) await page.keyboard.press(k);
      await goTo(page, "info");
      await page.locator("#cx-work").click();
      await page.keyboard.press("Escape");
      await page.locator("#cx-bm").click();
      await page.keyboard.press("Escape");
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#cx-tabs [aria-selected='true']"));
      await page.waitForTimeout(800);
      const after = await L.dumpStorage(page);
      for (const [k, v] of Object.entries(g.storage.localStorage)) {
        if (VOLATILE.has(k)) continue;
        expect(parse(after.localStorage[k]), `localStorage ${k}`).toEqual(parse(v));
      }
      const retired = L.cropsToday(g).retired;
      for (const [store, entries] of Object.entries(g.storage.indexedDB.stores)) {
        const now = Object.fromEntries(after.indexedDB.stores[store] || []);
        for (const [k, v] of entries) {
          // the one change that is allowed: the record of a crop of a retired panel is kept, and marked as carried across
          if (store === "crops" && retired.includes(k)) expect(now[k], `IndexedDB crops / ${k} (kept, marked)`).toMatchObject(v);
          else expect(now[k], `IndexedDB ${store} / ${k}`).toEqual(v);
        }
      }
    });
  });
}

test.describe("old data: when part of what was saved is missing", () => {
  const savedLatest = L.parsed(latest.storage);

  test("their cut pictures are gone from the cache: the site cuts them again from their saved corners", async ({ page }) => {
    await L.standInForYale(page);
    await boot(page, latest, { hash: "#read/beinecke/78v", change: s => { s.indexedDB.stores.img = []; } });
    await page.waitForFunction(() => CUSTOM_IMG.size >= 4 && !Crops.pending.size, null, { timeout: 20_000 });
    await readerPicturesLoaded(page);
    expect(await page.locator('#rd-zoomer img[data-key="f78v"]').first().getAttribute("src")).toMatch(/^blob:/);
    const after = await L.dumpStorage(page);
    expect(after.indexedDB.stores.img.map(e => e[0]).sort(), "the pictures are stored again").toEqual(["f1r_l", "f1r_s", "f78v_l", "f78v_s"]);
    expect(Object.fromEntries(after.indexedDB.stores.crops), "their corners were not touched").toEqual(Object.fromEntries(latest.storage.indexedDB.stores.crops));
  });

  test("…and if Yale cannot be reached, their corners are kept and the published pictures show in the meantime", async ({ page }) => {
    await boot(page, latest, { hash: "#read/beinecke/78v", change: s => { s.indexedDB.stores.img = []; } });
    await page.waitForFunction(() => !Crops.pending.size, null, { timeout: 20_000 });
    await expect(page.locator("#cx-toast")).toContainText("Could not cut");
    await readerPicturesLoaded(page);
    expect(await page.evaluate(() => Crops.mine.size)).toBe(2);
    expect(await page.locator('#rd-zoomer img[data-key="f78v"]').first().getAttribute("src")).toContain("data/panels/f78v_l.jpg");
    const after = await L.dumpStorage(page);
    expect(Object.fromEntries(after.indexedDB.stores.crops)).toEqual(Object.fromEntries(latest.storage.indexedDB.stores.crops));
  });

  test("localStorage was cleared but IndexedDB was not: orders and bookmarks come back from the second copy", async ({ page }) => {
    await boot(page, latest, { change: s => { delete s.localStorage["vv:mine"]; delete s.localStorage["vv:bookmarks"]; } });
    expect(await page.evaluate(() => MyOrders.list.map(o => o.id))).toEqual(savedLatest.orders.map(o => o.id));
    expect(await page.evaluate(() => Bookmarks.list.map(b => b.page))).toEqual(savedLatest.bookmarks.map(b => b.page));
    const after = await L.dumpStorage(page);
    expect(JSON.parse(after.localStorage["vv:mine"]).map(o => o.id), "and they are written back to localStorage").toEqual(savedLatest.orders.map(o => o.id));
  });

  test("IndexedDB was cleared but localStorage was not: orders and bookmarks stay, crops are gone, nothing breaks", async ({ page }) => {
    await boot(page, latest, { hash: "#read/beinecke/78v", change: s => { s.indexedDB = null; } });
    await readerPicturesLoaded(page);
    expect(await page.evaluate(() => MyOrders.list.length)).toBe(savedLatest.orders.length);
    expect(await page.evaluate(() => Bookmarks.list.length)).toBe(savedLatest.bookmarks.length);
    expect(await page.evaluate(() => Crops.mine.size)).toBe(0);
    expect(await page.locator('#rd-zoomer img[data-key="f78v"]').first().getAttribute("src")).toContain("data/panels/f78v_l.jpg");
    const after = await L.dumpStorage(page);
    expect(after.indexedDB.stores.work.length, "the second copy is made again").toBeGreaterThan(0);
  });

  test("a database from before the 'work' store existed is upgraded and keeps their crops", async ({ page }) => {
    await boot(page, latest, { change: s => { s.indexedDB.version = 1; delete s.indexedDB.stores.work; } });
    expect(await page.evaluate(() => Crops.mine.size)).toBe(2);
    const after = await L.dumpStorage(page);
    expect(after.indexedDB.version).toBeGreaterThanOrEqual(2);
    expect(Object.keys(after.indexedDB.stores).sort()).toEqual(["crops", "img", "work"]);
    expect(Object.fromEntries(after.indexedDB.stores.crops)).toEqual(Object.fromEntries(latest.storage.indexedDB.stores.crops));
  });

  test("when the two copies of their orders differ, the newer one wins, and the other is brought up to date", async ({ page }) => {
    const old = o => ({ ...o, title: "OLD " + o.title, updated: "2020-01-01T00:00:00.000Z" });
    // localStorage holds the stale copy
    await boot(page, latest, { change: s => { s.localStorage["vv:mine"] = JSON.stringify(savedLatest.orders.map(old)); } });
    expect(await page.evaluate(() => MyOrders.list.map(o => o.title))).toEqual(savedLatest.orders.map(o => o.title));
  });

  test("…and the other way round", async ({ page }) => {
    const old = o => ({ ...o, title: "OLD " + o.title, updated: "2020-01-01T00:00:00.000Z" });
    await boot(page, latest, { change: s => { s.indexedDB.stores.work = s.indexedDB.stores.work.map(([k, v]) => [k, k === "orders" ? v.map(old) : v]); } });
    expect(await page.evaluate(() => MyOrders.list.map(o => o.title))).toEqual(savedLatest.orders.map(o => o.title));
    await page.waitForTimeout(500);
    const after = await L.dumpStorage(page);
    const orders = Object.fromEntries(after.indexedDB.stores.work).orders;
    expect(orders.map(o => o.title), "the second copy is brought up to date").toEqual(savedLatest.orders.map(o => o.title));
  });
});
