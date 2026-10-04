// Basic accessibility: can a screen reader or the keyboard find and use the controls? Not a full audit (colour contrast and
// the like need a person), but the things that break silently when a button is added without a label.
const { test, expect, openSite, openThree, goTo } = require("./fixtures");

/** Controls (and pictures) with no name a screen reader could say. */
const unnamed = page => page.evaluate(() => {
  const visible = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const name = e => (e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") && document.getElementById(e.getAttribute("aria-labelledby"))?.textContent
    || e.textContent || e.getAttribute("title") || e.querySelector("img[alt]")?.alt || (e.labels && e.labels[0]?.textContent) || e.closest("label")?.textContent || "").trim();
  const controls = [...document.querySelectorAll("button, a[href], select, input:not([type=hidden]):not([type=file]), textarea, [role=button], [role=tab]")]
    .filter(visible).filter(e => !name(e)).map(e => e.outerHTML.slice(0, 100));
  const pictures = [...document.querySelectorAll("img:not([alt])")].map(e => e.outerHTML.slice(0, 100));
  return { controls, pictures };
});

for (const [label, hash] of [["3D", "#three/beinecke"], ["the Reader", "#read/beinecke/78v"], ["Info", "#info/beinecke"]]) {
  test(`${label}: every control has a name and every picture has alt text`, async ({ page }) => {
    await openSite(page, hash);
    await page.waitForTimeout(800);
    expect(await unnamed(page)).toEqual({ controls: [], pictures: [] });
  });
}

test("the page has a language, a main landmark, and the tabs say which one is selected", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("#cx-tabs")).toHaveAttribute("role", "tablist");
  await expect(page.locator("#cx-tabs [role=tab][aria-selected='true']")).toHaveCount(1);
  await goTo(page, "info");
  await expect(page.locator("#cx-tabs [aria-selected='true']")).toHaveText("Info");
});

test("dialogs open with focus inside them and close with Escape, giving the page back", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  for (const [open, dlg] of [["#cx-help", "#cx-help-dlg"], ["#cx-bug", "#cx-bug-dlg"], ["#cx-ver", "#cx-new-dlg"], ["#cx-work", "#work-dlg"]]) {
    await page.locator(open).click();
    await expect(page.locator(dlg), dlg).toBeVisible();
    expect(await page.evaluate(d => document.querySelector(d).contains(document.activeElement), dlg), `${dlg}: focus is inside`).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(dlg), `${dlg} closes with Escape`).toBeHidden();
  }
});

test("the site can be driven by keyboard alone: Tab reaches the header controls in order", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  const reached = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    reached.push(await page.evaluate(() => document.activeElement.id || document.activeElement.dataset.view || document.activeElement.className || document.activeElement.tagName));
  }
  for (const want of ["cx-ver", "three", "read", "info", "cx-order", "cx-bm", "cx-work", "cx-help", "cx-bug"]) {
    expect(reached, `Tab should reach ${want}`).toContain(want);
  }
});
