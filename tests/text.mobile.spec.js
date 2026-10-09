// Text on a phone (runs in the mobile project: its name ends in mobile.spec.js). The text sits below the pages; tapping a
// word on the photograph opens it there; the Text tab's filters open as a sheet. Nothing scrolls sideways.
const { test, expect, openSite } = require("./fixtures");

// Yale's image server, stood in for by a one-pixel photograph (an empty answer would fail to load, and a word's crop
// would then give way to "could not be loaded" while a test looks at it)
const PIXEL = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9mKKKKAP/2Q==", "base64");
const fromYale = r => r.fulfill({ status: 200, contentType: "image/jpeg", body: PIXEL });

const sideways = page => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);

test("the text sits below the pages; tapping a word on the photograph opens it", async ({ page }) => {
  await page.route("https://collections.library.yale.edu/**", fromYale);
  await openSite(page, "#read/beinecke/2r/text");
  await expect(page.locator("#rd-text .tx-page").first()).toBeVisible({ timeout: 15_000 });
  const stage = await page.locator("#rd-stage").boundingBox(), text = await page.locator("#rd-text").boundingBox();
  expect(text.y, "the text is below the pages").toBeGreaterThanOrEqual(stage.y + stage.height - 1);
  const tbtn = await page.locator("#rd-textbtn").boundingBox();
  expect(tbtn.x + tbtn.width, "the Text button is on screen").toBeLessThanOrEqual(page.viewportSize().width);
  const b = await page.locator('#rd-zoomer .wb[data-k="f2r|3|1"]').boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator("#rd-text .tx-where")).toHaveText("2r · line 4");
  await expect(page.locator("#rd-text .tx-reading .lt")).toHaveText("chtoddy");
  await expect(page.locator('#rd-text .tx-grow[aria-label="Take in the word after"]')).toBeVisible();   // no shift on a phone
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
