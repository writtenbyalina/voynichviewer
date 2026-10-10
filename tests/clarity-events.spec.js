// What the viewer tells Microsoft Clarity: named actions (events) and the context they happen in (tags), so that visits can
// be filtered and the 3D canvas, which recordings show blank, is still readable. A stand-in for Clarity records each call,
// so these tests never reach Microsoft; without Clarity (a local copy, no consent) the same calls do nothing.
const { test, expect, openSite, goTo } = require("./fixtures");

async function withClarity(page) {
  await page.addInitScript(() => { window.__calls = []; window.clarity = (...a) => window.__calls.push(a); });
}
const events = page => page.evaluate(() => window.__calls.filter(c => c[0] === "event").map(c => c[1]));
const tags = page => page.evaluate(() => Object.fromEntries(window.__calls.filter(c => c[0] === "set").map(c => [c[1], c[2]])));

test("a visit is tagged with the version, the landing view, the order and the folio", async ({ page }) => {
  await withClarity(page);
  await openSite(page, "#read/beinecke/1v");
  await expect.poll(() => tags(page)).toMatchObject({ version: await page.evaluate(() => APP_VERSION), landing_view: "read", view: "read", order: "beinecke" });
  await page.evaluate(() => Reader.go(R.at + 1, 1));
  await expect.poll(async () => (await tags(page)).folio).not.toBe(undefined);
  expect(await events(page)).toContain("turn_page");
});

test("unfolding a foldout is named by how it was opened, and the opening is tagged while it is open", async ({ page }) => {
  await withClarity(page);
  await openSite(page, "#read/beinecke");
  await page.evaluate(() => Reader.go(67, 0));
  await expect(page.locator("#rd-fold")).toBeVisible();
  await page.locator("#rd-fold").click();
  await expect.poll(() => events(page)).toEqual(expect.arrayContaining(["jump_to_folio", "unfold_pill_click", "unfold"]));
  expect((await tags(page)).foldout_open).toBe("true");
  await expect.poll(() => page.evaluate(() => R.busy)).toBe(false);
  await page.keyboard.press("u");
  await expect.poll(() => events(page)).toEqual(expect.arrayContaining(["unfold_key", "fold"]));
  expect((await tags(page)).foldout_open).toBe("false");
});

test("switching views, help and What's new are named once each", async ({ page }) => {
  await withClarity(page);
  await openSite(page, "#read/beinecke");
  await goTo(page, "info");
  await page.keyboard.press("?");
  await page.keyboard.press("Escape");
  await page.locator("#cx-ver").click();
  const ev = await events(page);
  expect(ev.filter(e => e === "view_info")).toHaveLength(1);
  expect(ev.filter(e => e === "help_opened")).toHaveLength(1);
  expect(ev.filter(e => e === "whats_new_opened")).toHaveLength(1);
  expect((await tags(page)).view).toBe("info");
});

test("tags made before Clarity loads are handed to it when it does", async ({ page }) => {
  await page.route(/clarity\.ms/, r => r.abort());   // the real tag never reaches Microsoft from a test
  await openSite(page, "#read/beinecke");
  const queued = await page.evaluate(() => {
    Privacy.local = false;   // as on the live site, after Accept
    Privacy.loadClarity();
    return window.clarity.q.filter(c => c[0] === "set").map(c => c[1]);
  });
  expect(queued).toEqual(expect.arrayContaining(["version", "view", "order"]));
});

test("text a visitor types in a box (an order's name) is masked in recordings", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  const masked = await page.evaluate(() => { askText("Name"); return document.querySelector("dialog input[type=text]")?.dataset.clarityMask; });
  expect(masked).toBe("true");
});

test("the text panel names what is done in it, and never what was typed into Find", async ({ page }) => {
  await withClarity(page);
  await openSite(page, "#read/beinecke/1r");
  await page.evaluate(() => TextUI.toggle(true));
  await expect.poll(async () => (await tags(page)).script).toBeTruthy();
  const T = () => page.evaluate(() => TextUI.mod);
  await expect.poll(async () => !!(await T())).toBe(true);
  await page.evaluate(() => { TextUI.mod.setFind("qokeedy"); });
  await page.evaluate(() => { TextUI.mod.setFind("qokeedyy"); });   // a longer search is the same search
  await page.evaluate(() => { TextUI.mod.setFind("zzzzzz"); });
  await page.evaluate(() => { TextUI.mod.setScript(TextUI.mod.script === "eva" ? "glyphs" : "eva"); TextUI.mod.helpDialog(); });
  const ev = await events(page);
  expect(ev.filter(e => e === "find_search")).toHaveLength(1);
  expect(ev).toEqual(expect.arrayContaining(["text_panel_open", "find_no_results", "script_change", "text_help_opened"]));
  const all = JSON.stringify(await page.evaluate(() => window.__calls));
  expect(all, "no search text is sent").not.toMatch(/qokeedy|zzzzzz/);
});
