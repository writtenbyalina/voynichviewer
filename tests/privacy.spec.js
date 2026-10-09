// Cookies and privacy. The site promises: no analytics until a visitor clicks Accept; Reject, closing the strip, or a Global
// Privacy Control signal all mean "no"; nothing runs on a local copy. The one exception is the cookieless visit counter
// (Cloudflare Web Analytics), which needs no choice but is off for Global Privacy Control, on a local copy and with no token.
// These tests hold the site to that promise, because a slip here is a privacy problem, not just a bug.
const { test, expect, openSite, goTo, openThree } = require("./fixtures");

const strip = page => page.locator("#pv-strip");
const consent = page => page.evaluate(() => JSON.parse(localStorage.getItem("vv:consent")));
const THIRD_PARTY = /clarity\.ms|clarity\.microsoft|cloudflareinsights|google-analytics|googletagmanager|facebook|doubleclick/i;

test("a first-time visitor is asked, with Accept and Reject side by side, and nothing is chosen for them", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  await expect(strip(page)).toBeVisible();
  await expect(strip(page)).toContainText("Microsoft Clarity");
  await expect(strip(page).getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(strip(page).getByRole("button", { name: "Reject" })).toBeVisible();
  await expect(strip(page).getByRole("button", { name: /Close/ })).toBeVisible();
  expect(await consent(page), "no choice is stored before the visitor makes one").toBeNull();
});

test("no request leaves the site before consent, in any view (the visit counter is off on a local copy)", async ({ page }) => {
  await openThree(page);
  await goTo(page, "read");
  await goTo(page, "info");
  await page.keyboard.press("?");
  await page.keyboard.press("Escape");
  expect(page.external, "requests to any other site").toEqual([]);
});

test("Reject is remembered and the strip does not come back", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  await strip(page).getByRole("button", { name: "Reject" }).click();
  await expect(strip(page)).toHaveCount(0);
  expect((await consent(page)).choice).toBe("denied");
  await page.reload();
  await page.waitForTimeout(300);
  await expect(strip(page)).toHaveCount(0);
  expect(page.external.filter(u => THIRD_PARTY.test(u))).toEqual([]);
});

test("closing the strip counts as Reject", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  await strip(page).getByRole("button", { name: /Close/ }).click();
  await expect(strip(page)).toHaveCount(0);
  expect((await consent(page)).choice).toBe("denied");
});

test("Accept is remembered; on a local copy, analytics still never load", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  await strip(page).getByRole("button", { name: "Accept" }).click();
  await expect(strip(page)).toHaveCount(0);
  expect((await consent(page)).choice).toBe("granted");
  await page.reload();
  await page.waitForTimeout(500);
  await expect(strip(page)).toHaveCount(0);
  expect(page.external.filter(u => THIRD_PARTY.test(u)), "Clarity must not load on localhost even after Accept").toEqual([]);
});

test("a Global Privacy Control signal means no: no strip, no analytics, and the option to allow it is switched off", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
  await openSite(page, "#info/beinecke/privacy");
  await expect(strip(page)).toHaveCount(0);
  await expect(page.locator(".pv-status")).toContainText("Global Privacy Control");
  await expect(page.getByRole("button", { name: "Allow analytics" })).toBeDisabled();
  expect(page.external).toEqual([]);
});

test("an old choice, or one made under an older notice, is asked again", async ({ page }) => {
  const seed = (c) => page.addInitScript(c => localStorage.setItem("vv:consent", JSON.stringify(c)), c);
  const sevenMonthsAgo = new Date(Date.now() - 7 * 30.44 * 864e5).toISOString();
  await seed({ choice: "denied", at: sevenMonthsAgo, v: 1 });
  await openSite(page, "#read/beinecke");
  await expect(strip(page)).toBeVisible();
});

test("a recent choice stored under a different version of the notice is asked again (so raising Privacy.VERSION re-asks everyone)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vv:consent", JSON.stringify({ choice: "denied", at: new Date().toISOString(), v: 99 })));
  await openSite(page, "#read/beinecke");
  await expect(strip(page)).toBeVisible();
});

test("a recent choice under the current notice is respected", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vv:consent", JSON.stringify({ choice: "denied", at: new Date().toISOString(), v: 1 })));
  await openSite(page, "#read/beinecke");
  await page.waitForTimeout(300);
  await expect(strip(page)).toHaveCount(0);
});

test("the choice can be changed later in Info, and the notice shows what it is now", async ({ page }) => {
  await openSite(page, "#info/beinecke/privacy");
  await expect(page.locator(".pv-status")).toContainText("not made yet");
  await page.getByRole("button", { name: "Allow analytics" }).click();
  await expect(page.locator(".pv-status")).toContainText("analytics allowed");
  expect((await consent(page)).choice).toBe("granted");
  await page.getByRole("button", { name: "Turn analytics off" }).click();
  await expect(page.locator(".pv-status")).toContainText("analytics off");
  expect((await consent(page)).choice).toBe("denied");
});

test("the privacy notice is reachable from the strip, the help and the bug box", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  await strip(page).getByRole("link", { name: "Privacy notice" }).click();
  await expect(page.locator("#info-privacy")).toBeVisible();
  await page.locator("#cx-help").click();
  await page.locator("#cx-help-dlg").getByRole("link", { name: /Cookie settings and privacy/ }).click();
  await expect(page.locator("#cx-help-dlg")).toBeHidden();
  await expect(page.locator("#info-privacy")).toBeVisible();
  await page.locator("#cx-bug").click();
  await page.locator("#cx-bug-dlg").getByRole("link", { name: /Cookie settings and privacy/ }).click();
  await expect(page.locator("#cx-bug-dlg")).toBeHidden();
});

// The visit counter. The tests run on localhost, where it is always off, so these switch on the conditions by hand.
const BEACON = /static\.cloudflareinsights\.com\/beacon\.min\.js/;
const countVisit = (page, { token = "abc123", local = false } = {}) => page.evaluate(({ token, local }) => {
  document.querySelectorAll("script[data-cf-beacon]").forEach(s => s.remove());
  Privacy.CF_TOKEN = token; Privacy.local = local; Privacy.countVisit();
  const s = document.querySelector("script[data-cf-beacon]");
  return s ? { src: s.src, type: s.type, config: JSON.parse(s.getAttribute("data-cf-beacon")) } : null;
}, { token, local });

test("the visit counter loads with no choice made and sets no cookie or stored value of its own", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  expect(await consent(page)).toBeNull();
  const s = await countVisit(page);
  expect(s.src).toMatch(BEACON);
  expect(s.config).toEqual({ token: "abc123" });
  expect(s.type, "a module script, as in Cloudflare's own snippet").toBe("module");
  await expect.poll(() => page.external.filter(u => BEACON.test(u)).length).toBe(1);
  expect(await page.evaluate(() => document.cookie), "the site itself sets no cookie").toBe("");
  expect(await consent(page), "counting does not record a choice").toBeNull();
});

test("Reject turns off Clarity only: the visit counter still loads", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  await strip(page).getByRole("button", { name: "Reject" }).click();
  expect((await countVisit(page)).src).toMatch(BEACON);
  expect(page.external.filter(u => /clarity/i.test(u)), "Clarity stays off").toEqual([]);
});

test("the visit counter stays off on a local copy, with no token, and with a Global Privacy Control signal", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  expect(await countVisit(page, { local: true }), "local copy").toBeNull();
  expect(await countVisit(page, { token: "" }), "no token").toBeNull();
  expect(page.external.filter(u => BEACON.test(u))).toEqual([]);
});

test("the visit counter stays off with a Global Privacy Control signal", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
  await openSite(page, "#read/beinecke");
  expect(await countVisit(page)).toBeNull();
  expect(page.external.filter(u => BEACON.test(u))).toEqual([]);
});

test("the privacy notice describes the visit counter, and says it ignores the choice above", async ({ page }) => {
  await openSite(page, "#info/beinecke/privacy");
  await expect(page.locator("#info-privacy")).toContainText("A visit counter, without cookies");
  await expect(page.locator("#info-privacy")).toContainText("whatever you choose above");
  await expect(page.locator("#info-privacy a[href*='cloudflare']")).toHaveCount(2);
  await expect(page.locator("#info-privacy")).toContainText("Detailed analytics, only if you say yes");
});

test("with the token emptied, the counter does not run and the notice does not mention it", async ({ page }) => {
  await page.route("**/assets/privacy.js", async route => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/CF_TOKEN: "[^"]*"/, 'CF_TOKEN: ""') });
  });
  await openSite(page, "#info/beinecke/privacy");
  await expect(page.locator("#info-privacy")).not.toContainText("Cloudflare");
  expect(await page.evaluate(() => Privacy.CF_TOKEN)).toBe("");
  expect(await page.evaluate(() => document.querySelector("script[data-cf-beacon]"))).toBeNull();
});
