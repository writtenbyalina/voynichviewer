// The Info pages: the guide, Davis's research, the Folio order tables, sources, privacy.
const { test, expect, openSite, currentView, readerState, readerPicturesLoaded } = require("./fixtures");
const fs = require("fs");
const path = require("path");

const orders = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/orders.json"), "utf8")).orders;

test("Info builds every section, and each item in the contents list scrolls to its section", async ({ page }) => {
  await openSite(page, "#info/beinecke");
  const toc = page.locator(".info-toc button");
  const n = await toc.count();
  expect(n, "contents entries").toBeGreaterThan(10);
  await expect(page.locator("#v-info .info-sec")).toHaveCount(n);
  for (let i = 0; i < n; i++) {
    const id = await toc.nth(i).getAttribute("data-id");
    await toc.nth(i).click();
    await expect(page.locator(`#info-${id}`), `section "${id}"`).toBeInViewport({ timeout: 5000 });
    expect(new URL(page.url()).hash, "the address names the section").toBe(`#info/beinecke/${id}`);
    await expect(page.locator(`.info-toc button[data-id="${id}"]`)).toHaveClass(/\bcur\b/);
  }
});

test("opening an address with a section scrolls straight to it", async ({ page }) => {
  await openSite(page, "#info/beinecke/sources");
  await expect(page.locator("#info-sources")).toBeInViewport({ timeout: 5000 });
});

test("every section has real content (not an empty heading)", async ({ page }) => {
  await openSite(page, "#info/beinecke");
  const thin = await page.evaluate(() => [...document.querySelectorAll("#v-info .info-sec")].filter(s => s.innerText.trim().length < 80).map(s => s.id));
  expect(thin).toEqual([]);
});

test("the Folio order tables are drawn for each order and change with the order menu", async ({ page }) => {
  await openSite(page, "#info/beinecke/quires");
  const body = page.locator("#info-folio-body");
  const seen = [];
  for (const o of orders) {
    await page.locator("#cx-order").selectOption(o.id);
    await expect(body.locator("svg, table").first()).toBeAttached();
    seen.push(await body.innerHTML());
  }
  expect(new Set(seen).size, "different orders give different tables").toBe(orders.length);
});

test("links inside Info open the place they promise", async ({ page }) => {
  await openSite(page, "#info/beinecke");
  const links = await page.evaluate(() => [...new Set([...document.querySelectorAll("#v-info a.try")].map(a => a.getAttribute("href")))]);
  expect(links.length, "in-page links in Info").toBeGreaterThan(10);
  const problems = [];
  for (const href of links) {
    await page.evaluate(h => { location.hash = h; }, href);
    const [view, order, at] = decodeURIComponent(href.slice(1)).split("/");
    const shown = await page.evaluate(() => S.view);
    if (shown !== view) problems.push(`${href}: opened ${shown}`);
    if (!(await page.evaluate(o => ORDERS.has(o), order))) problems.push(`${href}: no order "${order}"`);
    if (view === "read" && at) {
      const folio = at.match(/\d+/)[0];   // "81r" -> the Reader should be on an opening showing folio 81
      await expect.poll(() => page.evaluate(() => document.querySelector("#rd-where")?.textContent || ""), { message: href }).toContain(`f${folio}`);
    }
    if (view === "three") {
      const m = at && /s=(\d+-\d+)/.exec(at);
      if (m) {
        await page.waitForFunction(() => typeof View3D !== "undefined" && View3D.mod?.debug?.V?.built, null, { timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => View3D.mod.curSheet()), { message: href, timeout: 20_000 }).toBe(m[1].replace("-", "|"));
      }
    }
    await page.evaluate(() => { location.hash = "#info/beinecke"; });
  }
  expect(problems).toEqual([]);
});

test("links to other sites open in a new tab and cannot reach back into this one", async ({ page }) => {
  await openSite(page, "#info/beinecke");
  const bad = await page.evaluate(() => [...document.querySelectorAll("a[href^='http']")]
    .filter(a => a.target !== "_blank" || !/noopener/.test(a.rel)).map(a => a.href));
  expect(bad).toEqual([]);
  const n = await page.locator("#v-info a[href^='http']").count();
  expect(n, "Info should cite its sources with links").toBeGreaterThan(5);
});
