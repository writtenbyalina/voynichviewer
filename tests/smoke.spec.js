// Smoke tests: does the site start, show every part of itself, and open every dialog without a single error?
// (Every test here also fails on any console error, uncaught error or failed file: see fixtures.js.)
const { test, expect, openSite, currentView, goTo, changesLoaded } = require("./fixtures");
const fs = require("fs");
const path = require("path");

const orders = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/orders.json"), "utf8")).orders;
const changelog = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/changelog.json"), "utf8"));

test("the site opens on the 3D book with the header in place", async ({ page }) => {
  await openSite(page);
  await expect(page).toHaveTitle("Voynich Viewer");
  expect(await currentView(page)).toBe("three");
  for (const sel of ["#cx-tabs", "#cx-order", "#cx-bm", "#cx-work", "#cx-help", "#cx-bug", "#cx-ver"]) {
    await expect(page.locator(sel), sel).toBeVisible();
  }
  await expect(page.locator("#cx-tabs button")).toHaveText(["3D", "Reader", "Info"]);
});

test("each tab shows its own view, and only that one", async ({ page }) => {
  await openSite(page);
  for (const view of ["read", "info", "three", "read"]) {
    await goTo(page, view);
    expect(await currentView(page)).toBe(view);
    for (const other of ["read", "info", "three"].filter(v => v !== view)) await expect(page.locator(`#v-${other}`)).toBeHidden();
    expect(new URL(page.url()).hash, "the address follows the tab").toMatch(new RegExp(`^#${view}/`));
  }
});

test("the order menu lists every reading order from orders.json, and choosing one keeps the view", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  await expect(page.locator("#cx-order option")).toHaveText(orders.map(o => o.title));
  for (const o of orders) {
    await page.locator("#cx-order").selectOption(o.id);
    await expect(page.locator("#rd-where")).not.toBeEmpty();
    expect(await currentView(page)).toBe("read");
    expect(new URL(page.url()).hash).toContain(`#read/${o.id}`);
  }
});

test.describe("What's new", () => {
  test("the badge shows the latest version and the dialog lists every release and change", async ({ page }) => {
    await openSite(page);
    await changesLoaded(page);   // the badge already says "v1.1" from the page itself: wait for the list, or the dialog may open empty
    const latest = changelog.releases[0];
    await expect(page.locator("#cx-ver")).toHaveText("v" + latest.version);
    await page.locator("#cx-ver").click();
    const dlg = page.locator("#cx-new-dlg");
    await expect(dlg).toBeVisible();
    await expect(dlg.locator(".rel")).toHaveCount(changelog.releases.length);
    await expect(dlg.locator(".rel-v")).toHaveText(changelog.releases.map(r => "v" + r.version));
    await expect(dlg.locator("li")).toHaveCount(changelog.releases.reduce((n, r) => n + r.changes.length, 0));
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(dlg).toBeHidden();
  });

  test("a returning visitor sees a dot until they open it; a first-time visitor sees none", async ({ page }) => {
    await openSite(page);
    await changesLoaded(page);
    await expect(page.locator("#cx-ver"), "a first visit has nothing to catch up on").not.toHaveClass(/\bdot\b/);
    await page.evaluate(() => localStorage.setItem("vv:seenVersion", JSON.stringify("0.9")));   // someone who last saw an older version
    await page.reload();
    await expect(page.locator("#cx-ver")).toHaveClass(/\bdot\b/);
    await page.locator("#cx-ver").click();
    await page.getByRole("button", { name: "Close" }).and(page.locator("#cx-new-dlg button")).click();
    await expect(page.locator("#cx-ver")).not.toHaveClass(/\bdot\b/);
    await page.reload();
    await changesLoaded(page);
    await expect(page.locator("#cx-ver"), "once seen, it stays seen").not.toHaveClass(/\bdot\b/);
  });

  test("if the list cannot be loaded, the badge keeps the version in the page and the dialog says so", async ({ page }) => {
    await page.route("**/data/changelog.json", r => r.fulfill({ status: 404, body: "" }));
    await openSite(page);
    await page.locator("#cx-ver").click();
    await expect(page.locator("#cx-new-list")).toContainText("could not be loaded");
    page.problems.length = 0;   // the 404 is what we asked for
  });
});

test("the keyboard help opens from the button and from ?, and closes with Escape", async ({ page }) => {
  await openSite(page);
  const dlg = page.locator("#cx-help-dlg");
  await page.locator("#cx-help").click();
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Reader");
  await expect(dlg).toContainText("Crop editor");
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await page.keyboard.press("?");
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Close" }).click();
  await expect(dlg).toBeHidden();
});

test("the bug-report box opens, copies the address, and closes from its button and by clicking outside", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await openSite(page);
  const dlg = page.locator("#cx-bug-dlg");
  await page.locator("#cx-bug").click();
  await expect(dlg).toBeVisible();
  await expect(dlg.locator("a[href^='mailto:']")).toBeVisible();
  await dlg.locator("#cx-bug-copy").click();
  await expect(page.locator("#cx-toast")).toHaveClass(/show/);   // "Email address copied" (or the fallback line when the browser refuses)
  await dlg.getByRole("button", { name: "Close" }).click();
  await expect(dlg).toBeHidden();
  await page.locator("#cx-bug").click();
  await page.mouse.click(5, 5);   // outside the box
  await expect(dlg).toBeHidden();
});

test("'Your work' opens and offers export and import", async ({ page }) => {
  await openSite(page);
  await page.locator("#cx-work").click();
  const dlg = page.locator("#work-dlg");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("button", { name: /Export progress file/ })).toBeVisible();
  await expect(dlg.getByRole("button", { name: /Import a progress file/ })).toBeVisible();
  await expect(dlg).toContainText("Your orders (0)");
  await dlg.getByRole("button", { name: "Close" }).click();
  await expect(dlg).toBeHidden();
});

test("if the page data cannot be loaded, the visitor gets a message instead of a blank page", async ({ page }) => {
  await page.route("**/data/codex.json", r => r.fulfill({ status: 500, body: "" }));
  await page.goto("/index.html");
  await expect(page.locator("#cx-main")).toContainText("The page data could not be loaded");
  page.problems.length = 0;   // the 500 is what we asked for
});
