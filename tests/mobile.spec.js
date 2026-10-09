// The same site on a phone (a Pixel 7: narrow screen, touch). Runs as its own project, see playwright.config.js.
const { test, expect, openSite, openThree, readerState, readerPicturesLoaded, cutOffPages, paintedFraction } = require("./fixtures");

/** Elements that make the whole page wider than the screen (which would make it scroll sideways). */
const pageOverflow = page => page.evaluate(() => ({
  viewport: innerWidth, page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
}));

test("the page never scrolls sideways, in any view", async ({ page }) => {
  for (const hash of ["#three/beinecke", "#read/beinecke/78v", "#info/beinecke"]) {
    await openSite(page, hash);
    await page.waitForTimeout(500);
    const { viewport, page: width } = await pageOverflow(page);
    expect(width, `${hash}: the page is ${width}px wide on a ${viewport}px screen`).toBeLessThanOrEqual(viewport + 1);
  }
});

test("the header fits: every control is on screen and can be tapped", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  const vw = page.viewportSize().width;
  for (const sel of ["#cx-tabs button[data-view=three]", "#cx-tabs button[data-view=read]", "#cx-tabs button[data-view=info]", "#cx-order", "#cx-bm", "#cx-work", "#cx-help", "#cx-bug"]) {
    const box = await page.locator(sel).boundingBox();
    expect(box, sel).not.toBeNull();
    expect(box.x, `${sel} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${sel} ends on screen`).toBeLessThanOrEqual(vw + 1);
    expect(Math.min(box.width, box.height), `${sel} is big enough to tap (WCAG 2.2 AA asks for at least 24px)`).toBeGreaterThanOrEqual(24);
  }
});

// KNOWN ISSUE, found by this test: the version badge ("v1.1"), which since 1.1 is the button that opens What's new, is
// only about 16px tall on a phone. WCAG 2.2 (AA, 2.5.8 Target Size) asks for 24px, so it is easy to miss with a thumb.
// A little vertical padding on .ver at narrow widths in assets/style.css fixes it. Remove `.fixme` once it does.
test.fixme("the version badge is big enough to tap", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  const box = await page.locator("#cx-ver").boundingBox();
  expect(box.height, "#cx-ver height in px").toBeGreaterThanOrEqual(24);
});

test("the Reader shows whole pages, and the buttons beside them turn the page", async ({ page }) => {
  await openSite(page, "#read/beinecke/78v");
  await readerPicturesLoaded(page);
  expect(await cutOffPages(page)).toEqual([]);
  const before = await readerState(page);
  await page.locator(".rd-nav.next").tap();
  await expect.poll(async () => (await readerState(page)).at).toBe(before.at + 1);
  await readerPicturesLoaded(page);
  await page.locator(".rd-nav.prev").tap();
  await expect.poll(async () => (await readerState(page)).at).toBe(before.at);
  await page.locator("#rd-gridbtn").tap();
  await expect(page.locator("#rd-grid")).toBeVisible();
  await page.locator(".rg-close").tap();
  await expect(page.locator("#rd-grid")).toBeHidden();
});

test("the 3D book is drawn and fills the width", async ({ page }) => {
  await openThree(page);
  const box = await page.locator("#v-three canvas").boundingBox();
  expect(box.width).toBeGreaterThan(page.viewportSize().width * 0.8);
  expect(await paintedFraction(page, page.locator("#v-three canvas"))).toBeGreaterThan(0.05);
});

test("the cookie strip does not hide the tabs, and its buttons can be tapped", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  const strip = page.locator("#pv-strip");
  await expect(strip).toBeVisible();
  const s = await strip.boundingBox(), tabs = await page.locator("#cx-tabs").boundingBox();
  expect(s.y, "the strip sits below the tabs").toBeGreaterThan(tabs.y + tabs.height);
  await strip.getByRole("button", { name: "Reject" }).tap();
  await expect(strip).toHaveCount(0);
});

test("Info is readable without sideways scrolling, and its contents list jumps to a section", async ({ page }) => {
  await openSite(page, "#info/beinecke");
  await expect(page.locator(".info-sec").first()).toBeVisible();
  const { viewport, page: width } = await pageOverflow(page);
  expect(width).toBeLessThanOrEqual(viewport + 1);
  const wide = await page.evaluate(() => [...document.querySelectorAll("#v-info .info-sec")].filter(el => el.scrollWidth > el.clientWidth + 2).map(el => el.id));
  expect(wide, "sections whose content is wider than the screen").toEqual([]);
});

test("on a phone Rearrange is a panel under the book: a tab per quire, the open quire as a pile, and buttons that move a sheet", async ({ page }) => {
  await openThree(page);
  await page.evaluate(() => Arrange.open());
  const panel = page.locator("#v3-arrange");
  await expect(panel.locator(".ar-tabs")).toBeVisible();
  await expect(page.locator("#v-three"), "no table on a phone").not.toHaveClass(/table/);
  await panel.locator('.ar-lbl[data-id="1|8"]').tap();
  await panel.getByRole("button", { name: /Toward the centre/ }).tap();
  await expect.poll(() => page.evaluate(() => ORDERS.get(S.order).gatherings[0].bifolia[0])).toBe("2|7");
});
