// OLD DATA, NEW CODE: progress files that people exported (the "Your work" export, or Export in the Rearrange panel).
//
// Files from each released version are in tests/legacy/<version>/progress.json; odd and hand-made ones are in
// tests/legacy/progress/. Every one must import into the current site, give people what the file promises, and be readable
// afterwards. If you change the import (or the order, bookmark or crop format), a file somebody saved months ago must still work.
const { test, expect, openSite, goTo, walkAllOpenings, paintedFraction } = require("./fixtures");
const L = require("./legacy/helpers");
const fs = require("fs");
const path = require("path");

// these walk whole orders, opening by opening; give them room when the machine is busy
test.describe.configure({ timeout: 90_000 });

const gens = L.generations();
const dir = path.join(L.DIR, "progress");

// what each hand-made file should give a visitor: how many orders, bookmarks and crops end up in their browser
const HAND_MADE = {
  "empty.json": { orders: 0, bookmarks: 0, crops: 0 },
  "bookmarks-only-untidy.json": { orders: 0, bookmarks: 2, crops: 0 },        // a duplicate, a page that is not in the book and junk are left out
  "order-minimal.json": { orders: 1, bookmarks: 0, crops: 0 },
  "order-every-option.json": { orders: 1, bookmarks: 1, crops: 0 },
  "crops-only.json": { orders: 0, bookmarks: 0, crops: 2 },                   // the page that does not exist and the bad corners are left out
  "from-the-future.json": { orders: 1, bookmarks: 1, crops: 1 },              // a later version's extra fields are ignored
  "sheets-that-do-not-exist.json": { orders: 1, bookmarks: 0, crops: 0 },
};
const files = [
  ...gens.map(g => ({ name: `exported by ${g.generation}`, file: path.join(g.dir, "progress.json"), want: { orders: g.meta.orders, bookmarks: g.meta.bookmarks, crops: L.cropsToday(g).count } })),
  ...Object.entries(HAND_MADE).map(([f, want]) => ({ name: f, file: path.join(dir, f), want })),
];

/** What the site holds after an import, in a form that two browsers can be compared on. */
const state = page => page.evaluate(() => ({
  orders: MyOrders.list.map(o => ({ id: o.id, title: o.title, from: o.from, gatherings: o.gatherings, unplaced: o.unplaced })),
  bookmarks: Bookmarks.list.map(b => ({ page: b.page, name: b.name })).sort((a, b) => a.page.localeCompare(b.page)),
  crops: Object.fromEntries([...Crops.mine].map(([k, r]) => [k, { quad: r.quad, rotate: r.rotate }])),
}));

test("every progress file in tests/legacy/progress is listed here with what it should give", () => {
  expect(fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()).toEqual(Object.keys(HAND_MADE).sort());
});

for (const f of files) {
  test.describe(`old data: progress file ${f.name}`, () => {
    test("imports, gives what it promises, and every order in it can be read", async ({ page }) => {
      test.setTimeout(120_000);
      await L.standInForYale(page);
      await openSite(page, "#read/beinecke");
      await L.importProgress(page, f.file, f.want);
      const s = await state(page);
      expect({ orders: s.orders.length, bookmarks: s.bookmarks.length, crops: Object.keys(s.crops).length }).toEqual(f.want);
      await page.keyboard.press("Escape");   // close "Your work"

      // every order is whole: each sheet is somewhere once, nothing unknown, nothing missing
      const total = await page.evaluate(() => SHEETS.size);
      for (const o of s.orders) {
        const used = [...o.gatherings.flatMap(g => g.bifolia), ...o.unplaced];
        expect(new Set(used).size, `order "${o.title}": a sheet is in it twice`).toBe(used.length);
        expect(used.length, `order "${o.title}": every sheet is in a gathering or set aside`).toBe(total);
      }
      // the visitor's crops are cut again from their corners and shown
      for (const key of Object.keys(s.crops)) await page.waitForFunction(k => CUSTOM_IMG.has(k + "_l") && CUSTOM_IMG.has(k + "_s"), key, { timeout: 15_000 });
      // and every order they brought can be read, cover to cover
      for (const o of s.orders) {
        await page.locator("#cx-order").selectOption(o.id);
        expect(await walkAllOpenings(page), `reading "${o.title}"`).toEqual([]);
      }
      if (s.orders.length) {
        await goTo(page, "three");
        await page.waitForFunction(() => View3D.mod?.debug?.V?.built, null, { timeout: 20_000 });
        await expect.poll(() => paintedFraction(page, page.locator("#v-three canvas")), { timeout: 15_000 }).toBeGreaterThan(0.02);
      }
    });

    // An order carries an id the site gave it, so importing the same exported file again replaces it. A hand-written order
    // with no id has nothing to be matched on, so each import makes a new one: that is expected, and not tested here.
    const hasIds = (JSON.parse(fs.readFileSync(f.file, "utf8")).orders || []).every(o => o && /^my-/.test(o.id));
    (hasIds ? test : test.skip)("importing it a second time adds nothing twice", async ({ page }) => {
      await L.standInForYale(page);
      await openSite(page, "#read/beinecke");
      await L.importProgress(page, f.file, f.want);
      const once = await state(page);
      await L.importProgress(page, f.file);
      await page.waitForTimeout(500);
      expect(await state(page)).toEqual(once);
    });
  });
}

test.describe("old data: what an import keeps from a file", () => {
  const fileOf = name => path.join(dir, name);
  const json = name => JSON.parse(fs.readFileSync(fileOf(name), "utf8"));

  test("an order is kept as written: title, where it came from, every gathering with its type, name and sewing options", async ({ page }) => {
    await openSite(page, "#read/beinecke");
    await L.importProgress(page, fileOf("order-every-option.json"), HAND_MADE["order-every-option.json"]);
    const want = json("order-every-option.json").orders[0];
    const now = (await state(page)).orders[0];
    expect(now.id, "an id that looks like the site's own is kept").toBe(want.id);
    expect(now.title).toBe(want.title);
    expect(now.from).toBe(want.from);
    expect(now.gatherings).toEqual(want.gatherings);
    expect(now.unplaced.slice(0, 2), "what was set aside stays first in the set-aside list").toEqual(want.unplaced);
  });

  test("a bare-bones order gets sensible defaults, and the sheets it leaves out are set aside, not lost", async ({ page }) => {
    await openSite(page, "#read/beinecke");
    await L.importProgress(page, fileOf("order-minimal.json"), HAND_MADE["order-minimal.json"]);
    const [o] = (await state(page)).orders;
    expect(o.id).toMatch(/^my-/);
    expect(o.gatherings).toEqual([{ quire: 1, type: "nested", bifolia: ["1|8", "2|7"] }]);
    expect(o.unplaced.length).toBe((await page.evaluate(() => SHEETS.size)) - 2);
  });

  test("sheets that no longer exist, or are listed twice, are dropped and the rest of the order is kept", async ({ page }) => {
    await openSite(page, "#read/beinecke");
    await L.importProgress(page, fileOf("sheets-that-do-not-exist.json"), HAND_MADE["sheets-that-do-not-exist.json"]);
    const [o] = (await state(page)).orders;
    const all = [...o.gatherings.flatMap(g => g.bifolia), ...o.unplaced];
    expect(all).not.toContain("999|1000");
    expect(all).not.toContain("not a sheet");
    expect(o.gatherings.flatMap(g => g.bifolia).filter(id => id === "9|16")).toHaveLength(1);
    expect(o.gatherings.map(g => g.quire), "a gathering with nothing left in it goes").toEqual([1, 3]);
  });

  test("bookmarks: a page twice, a page not in the book and junk are left out; names are kept", async ({ page }) => {
    await openSite(page, "#read/beinecke");
    await L.importProgress(page, fileOf("bookmarks-only-untidy.json"), HAND_MADE["bookmarks-only-untidy.json"]);
    expect((await state(page)).bookmarks).toEqual([{ page: "f1r", name: "1r" }, { page: "f78v", name: "Waterspouts" }]);
  });

  test("a file made by a later version, with fields this version has never heard of, still imports", async ({ page }) => {
    await L.standInForYale(page);
    await openSite(page, "#read/beinecke");
    await L.importProgress(page, fileOf("from-the-future.json"), HAND_MADE["from-the-future.json"]);
    const s = await state(page);
    expect(s.orders[0].title).toBe("Made by a later version");
    expect(s.bookmarks).toEqual([{ page: "f78v", name: "With extra fields" }]);
    expect(s.crops.f1r.rotate).toBe(90);
  });

  test("importing adds to what they already have; nothing they had is lost", async ({ page }) => {
    const latest = gens[gens.length - 1];
    await L.standInForYale(page);
    await L.seedStorage(page, latest.storage);
    await openSite(page, "#read/beinecke");
    const before = await state(page);
    await L.importProgress(page, fileOf("order-every-option.json"), { orders: before.orders.length + 1, bookmarks: before.bookmarks.length + 1, crops: before.crops ? Object.keys(before.crops).length : 0 });
    const after = await state(page);
    expect(after.orders.map(o => o.id)).toEqual(expect.arrayContaining(before.orders.map(o => o.id)));
    expect(after.orders).toHaveLength(before.orders.length + 1);
    expect(after.bookmarks).toHaveLength(before.bookmarks.length + 1);
    expect(after.crops).toEqual(before.crops);
    for (const o of before.orders) expect(after.orders.find(x => x.id === o.id), `order "${o.title}" is unchanged`).toEqual(o);
  });
});

test.describe("old data: nothing is lost on the way out and back in", () => {
  // import a file, export, import that export into a second, clean browser: both browsers must hold the same things
  const round = [
    ...gens.map(g => ({ name: `exported by ${g.generation}`, file: path.join(g.dir, "progress.json"), want: { orders: g.meta.orders, bookmarks: g.meta.bookmarks, crops: L.cropsToday(g).count } })),
    { name: "order-every-option.json", file: path.join(dir, "order-every-option.json"), want: HAND_MADE["order-every-option.json"] },
    { name: "from-the-future.json", file: path.join(dir, "from-the-future.json"), want: HAND_MADE["from-the-future.json"] },
  ];
  for (const r of round) {
    test(`${r.name}: import, export, import again gives the same orders, bookmarks and crops`, async ({ page, browser }) => {
      await L.standInForYale(page);
      await openSite(page, "#read/beinecke");
      await L.importProgress(page, r.file, r.want);
      const first = await state(page);
      const exported = await L.exportProgress(page);
      expect(exported.app).toBe("voynich-viewer");

      const out = path.join(require("os").tmpdir(), `vv-roundtrip-${process.pid}-${Date.now()}.json`);
      fs.writeFileSync(out, JSON.stringify(exported));
      const ctx = await browser.newContext({ baseURL: page.url().split("/index.html")[0], reducedMotion: "reduce" });
      const other = await ctx.newPage();
      await other.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => route.fulfill({ status: 200, contentType: "image/jpeg", body: fs.readFileSync(path.join(L.ROOT, "data/panels/f1r_s.jpg")), headers: { "access-control-allow-origin": "*" } }));
      const problems = [];
      other.on("pageerror", e => problems.push(e.message));
      await openSite(other, "#read/beinecke");
      await L.importProgress(other, out, r.want);
      expect(await state(other)).toEqual(first);
      expect(problems).toEqual([]);
      await ctx.close();
    });
  }
});

test("Import in the Rearrange menu takes the same files", async ({ page }) => {
  const latest = gens[gens.length - 1];
  await L.standInForYale(page);
  await openSite(page, "#three/beinecke");
  await page.waitForFunction(() => View3D.mod?.debug?.V?.built, null, { timeout: 20_000 });
  await page.keyboard.press("a");
  await expect(page.locator("#v3-arrange")).toBeVisible();
  await page.locator("#v3-arrange").getByRole("button", { name: "More", exact: true }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("menuitem", { name: /Import/ }).click()]);
  await chooser.setFiles(path.join(latest.dir, "progress.json"));
  await page.waitForFunction(w => MyOrders.list.length >= w.orders && Bookmarks.list.length >= w.bookmarks && !Crops.pending.size,
    { orders: latest.meta.orders, bookmarks: latest.meta.bookmarks }, { timeout: 20_000 });
  await expect(page.locator("#cx-order optgroup[label='Your orders'] option")).toHaveCount(latest.meta.orders);
});
