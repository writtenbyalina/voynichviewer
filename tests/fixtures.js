// Shared setup for the browser tests.
//
// Every test that uses `page` from here gets a safety net for free: while the test runs, anything that looks like a
// bug is written down (an uncaught error, a console.error, a file of the site that failed to load), and when the test
// ends it fails if that list is not empty. So a test about bookmarks also notices a broken image it happened to pass.
//
// The site's own files are served locally. Anything on another origin (Yale's image server, Microsoft Clarity) is
// blocked, so tests never depend on the internet and never send analytics: the blocked requests are collected in
// `page.external` instead, which a test can inspect (see privacy.spec.js).
const base = require("@playwright/test");
const { expect } = base;

const test = base.test.extend({
  page: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL).origin;
    const isLocal = url => { try { return new URL(url).origin === origin; } catch { return true; } };
    const problems = [];
    const external = [];

    page.on("pageerror", e => problems.push(`uncaught error: ${e.message}`));
    page.on("console", m => {
      if (m.type() !== "error" && m.type() !== "assert") return;
      if (!isLocal(m.location().url || baseURL)) return;   // the "failed to load" line for a request we blocked on purpose
      problems.push(`console.error: ${m.text()}`);
    });
    page.on("response", r => {
      if (isLocal(r.url()) && r.status() >= 400) problems.push(`HTTP ${r.status()} for ${new URL(r.url()).pathname}`);
    });
    page.on("requestfailed", r => {
      if (isLocal(r.url()) && !/ERR_ABORTED/.test(r.failure()?.errorText || "")) problems.push(`request failed: ${r.url()}`);
    });
    await page.route(url => !isLocal(url.toString()), route => { external.push(route.request().url()); return route.abort(); });

    page.problems = problems;
    page.external = external;
    await use(page);
    expect(problems, "errors seen while the page ran").toEqual([]);
  },
});

/** Open the site on a hash route and wait until the app has booted (data loaded, tabs wired up, view shown). */
async function openSite(page, hash = "") {
  await page.goto("/index.html" + hash);
  await page.waitForFunction(() => document.querySelector("#cx-tabs [aria-selected='true']"), null, { timeout: 15_000 });
}

/** The tab that is showing, as "three" | "read" | "info". */
const currentView = page => page.locator("#cx-tabs [aria-selected='true']").getAttribute("data-view");

/** Switch tab the way a visitor does, and wait for that view to be the one showing. */
async function goTo(page, view) {
  await page.locator(`#cx-tabs button[data-view="${view}"]`).click();
  await expect(page.locator(`#v-${view}`)).toBeVisible();
}

/** Images inside `root` that are on screen but did not load (broken file, bad URL, corrupt JPEG). */
function brokenImages(page, root = "body") {
  return page.evaluate(sel => [...document.querySelectorAll(`${sel} img`)]
    .filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute("src")), root);
}

/** What the Reader is showing right now, read the way a visitor reads it: the page labels and the "opening N of M" line. */
const readerState = page => page.evaluate(() => ({
  where: document.querySelector("#rd-where").textContent.trim(),
  meta: document.querySelector("#rd-meta").textContent.trim(),
  zoom: document.querySelector("#rd-zoomlvl").textContent.trim(),
  at: R.at, openings: R.spreads.length, pages: R.pages.length,
  unfolded: !!(R.unfold.L || R.unfold.R),
  hash: location.hash,
}));

/** Wait until every picture in the Reader has loaded (or failed). Fails the test if one is broken. */
async function readerPicturesLoaded(page) {
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll("#rd-zoomer img")];
    return imgs.length > 0 && imgs.every(i => i.complete);
  }, null, { timeout: 15_000 });
  expect(await brokenImages(page, "#rd-zoomer"), "broken pictures in the Reader").toEqual([]);
}

/**
 * How much of an element shows something other than its own background colour (0 to 1), judged from a screenshot.
 * A blank canvas, a black screen or a failed texture give ~0; the book in 3D gives a good fraction.
 */
async function paintedFraction(page, locator) {
  const png = await locator.screenshot();
  return page.evaluate(async b64 => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const cx = c.getContext("2d");
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    const [r0, g0, b0] = d;   // the top-left pixel is the background
    let diff = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 30) diff++;
    return diff / (d.length / 4);
  }, png.toString("base64"));
}

/** Open the 3D view and wait until the WebGL book has been built and drawn. */
async function openThree(page, hash = "#three/beinecke") {
  await openSite(page, hash);
  await page.waitForFunction(() => typeof View3D !== "undefined" && View3D.mod?.debug?.V?.built, null, { timeout: 20_000 });
  await expect.poll(() => paintedFraction(page, page.locator("#v-three canvas")), { message: "the 3D book should be drawn", timeout: 15_000 }).toBeGreaterThan(0.05);
}

/** Wait until "What's new" has been fetched (the badge and its dot are settled only then). */
const changesLoaded = page => expect.poll(() => page.evaluate(() => Changes.rel.length), { message: "changelog.json should load" }).toBeGreaterThan(0);

/**
 * Pages in the Reader that spill outside the stage they sit in (cut off at an edge), as a list of "label: how far".
 * `tolerance` is in pixels, for rounding.
 */
function cutOffPages(page, tolerance = 2) {
  return page.evaluate(tol => {
    const stage = document.querySelector("#rd-stage").getBoundingClientRect();
    return [...document.querySelectorAll("#rd-zoomer .seg")].flatMap(el => {
      const r = el.getBoundingClientRect();
      const over = Math.max(stage.left - r.left, r.right - stage.right, stage.top - r.top, r.bottom - stage.bottom);
      return over > tol ? [`${el.title || el.textContent.trim()}: ${Math.round(over)}px outside`] : [];
    });
  }, tolerance);
}

/**
 * Turn through every opening of the Reader's current order and report what is wrong on any of them: pictures that did not
 * load, no page label, pages cut off. Returns a list of problems (empty is good). Quicker than pressing the arrow key
 * 100 times: it calls the Reader directly, then checks what is on screen.
 */
async function walkAllOpenings(page) {
  return page.evaluate(async () => {
    const problems = [];
    const n = R.spreads.length;
    for (let k = 0; k < n; k++) {
      Reader.go(k, 0);
      const imgs = [...document.querySelectorAll("#rd-zoomer img")];
      const settled = Promise.all(imgs.map(i => (i.complete ? 0 : new Promise(res => { i.addEventListener("load", res, { once: true }); i.addEventListener("error", res, { once: true }); }))));
      const gaveUp = await Promise.race([settled.then(() => false), new Promise(res => setTimeout(() => res(true), 10_000))]);
      const where = document.querySelector("#rd-where").textContent.trim();
      const at = `opening ${k + 1} (${where})`;
      if (!where || where === "—") problems.push(`opening ${k + 1}: no page label`);
      if (gaveUp) problems.push(`${at}: a picture never finished loading`);
      for (const i of imgs) if (i.complete && i.naturalWidth === 0) problems.push(`${at}: broken picture ${i.getAttribute("src")}`);
      const stage = document.querySelector("#rd-stage").getBoundingClientRect();
      for (const el of document.querySelectorAll("#rd-zoomer .seg")) {
        const r = el.getBoundingClientRect();
        const over = Math.max(stage.left - r.left, r.right - stage.right, stage.top - r.top, r.bottom - stage.bottom);
        if (over > 2) problems.push(`${at}: ${el.title || el.textContent.trim()} is ${Math.round(over)}px outside the stage`);
      }
    }
    return problems;
  });
}

module.exports = { walkAllOpenings, changesLoaded, cutOffPages, test, expect, openSite, openThree, currentView, goTo, brokenImages, readerState, readerPicturesLoaded, paintedFraction };
