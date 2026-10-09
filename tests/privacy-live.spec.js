// Privacy on a REAL host. On localhost the site switches every kind of tracking off, so the tests in privacy.spec.js cannot see
// the live policy. Chromium treats any "*.localhost" name as this machine, and the site does not treat it as local, so here the
// site behaves as it does on voynichviewer.com. Requests to other sites are blocked and written down instead of sent.
//
// The policy (assets/privacy.js): Microsoft Clarity (cookies) only after Accept. A cookieless visit counter (Cloudflare Web
// Analytics) runs whatever was chosen, because it sets no cookies and stores nothing; it is the one analytics thing that loads
// before a choice. A Global Privacy Control signal switches both off. (Photographs from Yale are not analytics: see YALE below.)
const { test, expect } = require("@playwright/test");

const COUNTER = /static\.cloudflareinsights\.com/;
const CLARITY = /clarity\.ms/;
// Since 1.2 the Reader loads the pages around the one being read from Yale's server at full size, so zooming is sharp. That is not
// analytics, and the privacy notice says so; it is allowed here and everything else that leaves the site is not.
const YALE = /^https:\/\/collections\.library\.yale\.edu\//;
const strangers = external => external.filter(u => !COUNTER.test(u) && !YALE.test(u));

/** Open the site as if on a real host. Returns the list of requests to other sites that the page tried to make. */
async function visit(page, baseURL, { hash = "#read/beinecke", gpc = false, consent = null } = {}) {
  const live = baseURL.replace("127.0.0.1", "vv.localhost");
  const external = [];
  page.on("pageerror", e => { throw new Error("uncaught error: " + e.message); });
  await page.route(url => new URL(url).origin !== new URL(live).origin, route => { external.push(route.request().url()); return route.abort(); });
  if (gpc) await page.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
  if (consent) await page.addInitScript(c => { if (!localStorage.getItem("vv:consent")) localStorage.setItem("vv:consent", JSON.stringify(c)); }, consent);
  await page.goto(live + "/index.html" + hash);
  await page.waitForFunction(() => document.querySelector("#cx-tabs [aria-selected='true']"), null, { timeout: 15_000 });
  expect(await page.evaluate(() => Privacy.local), "this should look like a real host to the site").toBe(false);
  return external;
}
const strip = page => page.locator("#pv-strip");
const choice = page => page.evaluate(() => JSON.parse(localStorage.getItem("vv:consent"))?.choice ?? null);

test("before any choice, the only analytics request is the cookieless visit counter; nothing else but Yale's photographs leaves the site", async ({ page, baseURL }) => {
  const external = await visit(page, baseURL);
  await expect(strip(page)).toBeVisible();
  expect(external.filter(u => COUNTER.test(u)), "the counter, once").toHaveLength(1);
  expect(strangers(external), "no Clarity, no other site").toEqual([]);
  expect(await choice(page), "no choice is stored for them").toBeNull();
});

test("Reject switches off Clarity only: the counter still runs, and Clarity never loads, on this visit or the next", async ({ page, baseURL }) => {
  let external = await visit(page, baseURL);
  await strip(page).getByRole("button", { name: "Reject" }).click();
  expect(await choice(page)).toBe("denied");
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#cx-tabs [aria-selected='true']"));
  await page.waitForTimeout(500);
  await expect(strip(page)).toHaveCount(0);
  expect(external.some(u => CLARITY.test(u)), "Clarity must not load after Reject").toBe(false);
  expect(external.some(u => COUNTER.test(u)), "the counter is not a cookie and does not wait for a choice").toBe(true);
});

test("Accept loads Clarity as well as the counter", async ({ page, baseURL }) => {
  const external = await visit(page, baseURL);
  expect(external.some(u => CLARITY.test(u)), "not yet").toBe(false);
  await strip(page).getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => external.some(u => CLARITY.test(u)), { message: "Clarity loads once they say yes" }).toBe(true);
  expect(external.some(u => COUNTER.test(u))).toBe(true);
  expect(await choice(page)).toBe("granted");
});

test("a visitor who accepted earlier gets both on their next visit, without being asked again", async ({ page, baseURL }) => {
  const external = await visit(page, baseURL, { consent: { choice: "granted", at: new Date().toISOString(), v: 1 } });
  await expect(strip(page)).toHaveCount(0);
  await expect.poll(() => external.some(u => CLARITY.test(u))).toBe(true);
  expect(external.some(u => COUNTER.test(u))).toBe(true);
});

test("a Global Privacy Control signal switches both off: no strip, no counter, no Clarity", async ({ page, baseURL }) => {
  const external = await visit(page, baseURL, { gpc: true });
  await expect(strip(page)).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(external.filter(u => COUNTER.test(u) || CLARITY.test(u)), "no analytics request at all").toEqual([]);
  expect(strangers(external)).toEqual([]);
});

test("the counter is added once, however much they move around the site", async ({ page, baseURL }) => {
  await visit(page, baseURL);
  for (const view of ["three", "info", "read"]) await page.locator(`#cx-tabs button[data-view="${view}"]`).click();
  expect(await page.locator("script[data-cf-beacon]").count()).toBe(1);
});

test("the privacy notice tells visitors about the counter", async ({ page, baseURL }) => {
  await visit(page, baseURL, { hash: "#info/beinecke/privacy" });
  await expect(page.locator("#info-privacy")).toContainText("Cloudflare");
});
