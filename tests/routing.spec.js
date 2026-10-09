// Addresses and stored state. People arrive from old links, odd links and browsers with stale or damaged saved data; none of
// those should ever give a blank page or an error.
const { test, expect, openSite, currentView, readerState, readerPicturesLoaded } = require("./fixtures");

test.describe("addresses", () => {
  const cases = [
    ["#read/beinecke/78v", "read"],
    ["#read/davis/81r", "read"],
    ["#three/davis", "three"],
    ["#info/beinecke", "info"],
    ["#info/beinecke/privacy", "info"],
    ["#info/beinecke/sources", "info"],
    ["#sources", "info"],       // old links: Sources and Folio order used to be tabs
    ["#collation", "info"],
    ["", "three"],              // the site opens on the 3D book
  ];
  for (const [hash, view] of cases) {
    test(`${hash || "(no address)"} opens the ${view} view`, async ({ page }) => {
      await openSite(page, hash);
      expect(await currentView(page)).toBe(view);
      await expect(page.locator(`#v-${view}`)).toBeVisible();
    });
  }

  test("the retired order name 'davis-blog-2025' opens the complete proposed order", async ({ page }) => {
    await openSite(page, "#read/davis-blog-2025/81r");
    await expect(page.locator("#cx-order")).toHaveValue("davis");
    await readerPicturesLoaded(page);
  });

  test("addresses that make no sense fall back to something that works", async ({ page }) => {
    const nonsense = ["#bogus", "#read", "#read/", "#read//", "#read/no-such-order", "#read/beinecke/zzzz", "#read/beinecke/%E0%A4%A", "#three/%E0%A4%A/%FF",
      "#info/beinecke/not-a-section", "#/read/beinecke/78v", "#read/beinecke/78v/extra/parts", "#READ/BEINECKE", "#read/__proto__/constructor"];
    for (const hash of nonsense) {
      await openSite(page, hash);
      const view = await currentView(page);
      expect(["read", "three", "info"], hash).toContain(view);
      await expect(page.locator(`#v-${view}`), hash).toBeVisible();
      await expect(page.locator("#cx-order"), `${hash}: the order menu holds a real order`).toHaveValue(/^(beinecke|davis)$/);
    }
  });

  test("a page that is not in the book leaves the Reader on a page rather than empty", async ({ page }) => {
    await openSite(page, "#read/beinecke/zzzz");
    await readerPicturesLoaded(page);
    expect((await readerState(page)).where).not.toBe("—");
  });

  test("changing the address while the site is open changes the view", async ({ page }) => {
    await openSite(page, "#read/beinecke/78v");
    await readerPicturesLoaded(page);
    await page.evaluate(() => { location.hash = "#info/beinecke"; });
    await expect(page.locator("#v-info")).toBeVisible();
    await page.evaluate(() => { location.hash = "#read/davis/81r"; });
    await expect(page.locator("#v-read")).toBeVisible();
    await expect(page.locator("#cx-order")).toHaveValue("davis");
    await expect(page.locator("#rd-where")).toContainText("f81r");
    await page.evaluate(() => { location.hash = "#three/beinecke"; });
    await expect(page.locator("#v-three")).toBeVisible();
  });

  test("the browser's back and forward buttons do not break the site", async ({ page }) => {
    await openSite(page, "#read/beinecke/78v");
    await page.evaluate(() => { location.hash = "#info/beinecke"; });
    await expect(page.locator("#v-info")).toBeVisible();
    await page.goBack();
    await expect(page.locator("#v-read")).toBeVisible();
    await page.goForward();
    await expect(page.locator("#v-info")).toBeVisible();
  });
});

test.describe("saved state in the browser", () => {
  const seed = (page, entries) => page.addInitScript(e => { for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v); }, entries);

  test("a saved order that no longer exists falls back to the current binding", async ({ page }) => {
    await seed(page, { "vv:order": JSON.stringify("my-deleted-order") });
    await openSite(page, "");
    await expect(page.locator("#cx-order")).toHaveValue("beinecke");
  });

  test("damaged saved data is ignored: invalid JSON, wrong types, and entries about pages that do not exist", async ({ page }) => {
    await seed(page, {
      "vv:bookmarks": "{this is not json",
      "vv:mine": JSON.stringify({ not: "a list" }),
      "vv:labels": "\u0000\u0001",
      "vv:order": "42",
      "vv:seenVersion": "[[[",
      "vv:3d:hinted": "maybe",
    });
    await openSite(page, "#read/beinecke");
    await readerPicturesLoaded(page);
    await expect(page.locator("#cx-order")).toHaveValue("beinecke");
    await page.locator("#cx-bm").click();
    await expect(page.locator("#bm-pop")).toContainText("No bookmarks yet");
  });

  test("saved bookmarks and orders that point at things that are gone are dropped quietly", async ({ page }) => {
    await seed(page, {
      "vv:bookmarks": JSON.stringify([
        { id: "ok", page: "f78v", name: "Real one" },
        { id: "bad1", page: "f9999z", name: "Page that does not exist" },
        null, 7, "text", { page: 5 },
      ]),
      "vv:mine": JSON.stringify([
        { id: "my-1", title: "Mixed up", gatherings: [{ quire: 1, type: "nested", bifolia: ["1|8", "1|8", "not-a-sheet", "2|7"] }, { bifolia: [] }, "junk"] },
        { id: "my-2", title: "Broken", gatherings: "no" },
        7, "text",
      ]),
    });
    await openSite(page, "#read/my-1");
    await readerPicturesLoaded(page);
    await page.locator("#cx-bm").click();
    await expect(page.locator("#bm-pop .bm-list li")).toHaveCount(1);
    await expect(page.locator("#bm-pop .bm-list")).toContainText("Real one");
    // the damaged order was repaired: sheets used once, unknown ones dropped, and every other sheet set aside rather than lost
    const sheets = await page.evaluate(() => ORDERS.get("my-1").gatherings.flatMap(g => g.bifolia));
    expect(sheets).toEqual(["1|8", "2|7"]);
    expect(await page.evaluate(() => ORDERS.get("my-1").unplaced.length)).toBe((await page.evaluate(() => SHEETS.size)) - 2);
    expect(await page.evaluate(() => ORDERS.has("my-2")), "an order with no gatherings is not kept").toBe(false);
  });

  // KNOWN BUG, found by this test: a `null` inside the saved list of your own orders stops the whole site from starting.
  // MyOrders.restore() in assets/work.js maps over the list reading `o.updated`, which throws on null, so boot() never
  // finishes (blank page, and the visitor cannot get out of it without clearing the site's data). Unlikely to happen
  // (the site only ever saves clean orders), but cheap to guard: `(o && o.updated)`. Remove `.fixme` once it is.
  test.fixme("a null entry in the saved list of your own orders does not stop the site from starting", async ({ page }) => {
    await seed(page, { "vv:mine": JSON.stringify([null, { id: "my-1", title: "Fine", gatherings: [{ quire: 1, type: "nested", bifolia: ["1|8"] }] }]) });
    await openSite(page, "#read/beinecke");
    await readerPicturesLoaded(page);
  });

  test("the site works when the browser refuses to store anything (a private window, blocked cookies)", async ({ page }) => {
    await page.addInitScript(() => {
      const refuse = () => { throw new DOMException("blocked", "SecurityError"); };
      Object.defineProperty(window, "localStorage", { get: refuse });
      Object.defineProperty(window, "indexedDB", { get: refuse });
    });
    await openSite(page, "#read/beinecke");
    await readerPicturesLoaded(page);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await readerState(page)).at).toBe(1);
    await page.locator("#cx-work").click();
    await expect(page.locator("#work-dlg")).toContainText("not letting the viewer store data");
    await page.keyboard.press("Escape");
    await page.locator("#cx-ver").click();
    await expect(page.locator("#cx-new-dlg")).toBeVisible();
  });
});
