// Text on a phone (runs in the mobile project: its name ends in mobile.spec.js). The panel sits below the pages, a
// word's card is a sheet at the bottom, and the Text tab's facets open as a sheet. Nothing scrolls sideways.
const { test, expect, openSite } = require("./fixtures");

const sideways = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);

test("the text panel sits below the pages, and a word's card is a sheet at the bottom", async ({ page }) => {
  await openSite(page, "#read/beinecke/1r/text");
  await expect(page.locator("#rd-text .tx-page").first()).toBeVisible({ timeout: 15_000 });
  const stage = await page.locator("#rd-stage").boundingBox(), text = await page.locator("#rd-text").boundingBox();
  expect(text.y, "the panel is below the pages").toBeGreaterThanOrEqual(stage.y + stage.height - 1);
  expect(text.width).toBeGreaterThan(page.viewportSize().width - 2);
  const tbtn = await page.locator("#rd-textbtn").boundingBox();
  expect(tbtn.x + tbtn.width, "the Text button is on screen").toBeLessThanOrEqual(page.viewportSize().width);
  await page.locator('#rd-text .ln[data-id="f1r.2"] .w').nth(6).tap();
  const card = page.locator(".tx-card");
  await expect(card).toHaveClass(/sheet/);
  const box = await card.boundingBox();
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(page.viewportSize().height - 2);
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  await page.locator(".tx-card .tx-cx").tap();
  await expect(card).toBeHidden();
  await page.locator('#rd-text .tx-seg button[data-view="inter"]').tap();
  await expect(page.locator('#rd-text .ln[data-id="f1r.2"] .il')).toBeVisible();
  expect(await sideways(page), "the interlinear scrolls inside its blocks, not the page").toBeLessThanOrEqual(1);
});

test("the Text tab: results fit the screen, and Narrow opens the facets as a sheet", async ({ page }) => {
  await openSite(page, "#text/beinecke/search?q=qok*");
  await expect(page.locator(".sx-hit").first()).toBeVisible({ timeout: 15_000 });
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  await expect(page.locator("#sx-facets")).toBeHidden();
  await page.locator("#sx-ftog").tap();
  await expect(page.locator("#sx-facets")).toBeVisible();
  await page.locator(".sx-frow", { hasText: "Scribe 2" }).tap();
  await expect(page.locator("#sx-steps")).toContainText("Scribe 2");
});
