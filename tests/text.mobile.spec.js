// Text on a phone (runs in the mobile project: its name ends in mobile.spec.js). The text sits below the pages; tapping a
// word on the photograph opens it there; the Text tab's filters open as a sheet. Nothing scrolls sideways.
const { test, expect, openSite } = require("./fixtures");

const sideways = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);

test("the text sits below the pages; tapping a word on the photograph opens it", async ({ page }) => {
  await page.route("https://collections.library.yale.edu/**", r => r.fulfill({ status: 200, contentType: "image/jpeg", body: Buffer.alloc(0) }));
  await openSite(page, "#read/beinecke/2r/text");
  await expect(page.locator("#rd-text .tx-page").first()).toBeVisible({ timeout: 15_000 });
  const stage = await page.locator("#rd-stage").boundingBox(), text = await page.locator("#rd-text").boundingBox();
  expect(text.y, "the text is below the pages").toBeGreaterThanOrEqual(stage.y + stage.height - 1);
  const tbtn = await page.locator("#rd-textbtn").boundingBox();
  expect(tbtn.x + tbtn.width, "the Text button is on screen").toBeLessThanOrEqual(page.viewportSize().width);
  const b = await page.locator('#rd-zoomer .wb[data-k="f2r|3|0"]').boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator("#rd-text .tx-where")).toHaveText("2r · line 4 · word 1");
  await expect(page.locator("#rd-text .tx-verdict")).toBeVisible();
  expect(await sideways(page)).toBeLessThanOrEqual(1);
});

test("the Text tab: results fit the screen, and Narrow opens the filters as a sheet", async ({ page }) => {
  await openSite(page, "#text/beinecke/search?q=qok*");
  await expect(page.locator(".sx-hit").first()).toBeVisible({ timeout: 15_000 });
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  await expect(page.locator("#sx-facets")).toBeHidden();
  await page.locator("#sx-ftog").tap();
  await expect(page.locator("#sx-facets")).toBeVisible();
  await page.locator(".sx-frow", { hasText: "Recipes" }).tap();
  await expect(page.locator("#sx-steps")).toContainText("Recipes");
});
