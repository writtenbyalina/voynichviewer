// The 3D book (WebGL, drawn in software in these tests). Does it draw, respond to every key the help lists, and stay in step
// with the Reader?
const { test, expect, openSite, openThree, goTo, paintedFraction, readerState, readerPicturesLoaded } = require("./fixtures");
const fs = require("fs");
const path = require("path");

const orders = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/orders.json"), "utf8")).orders;

const canvas = page => page.locator("#v-three canvas");
const sheet = page => page.evaluate(() => View3D.mod.curSheet());
const v3 = (page, fn) => page.evaluate(fn);
const drawn = async page => paintedFraction(page, canvas(page));

test("the 3D book is drawn: a WebGL canvas with the book on it, not a blank or black screen", async ({ page }) => {
  await openThree(page);
  const box = await canvas(page).boundingBox();
  expect(box.width).toBeGreaterThan(500);
  expect(box.height).toBeGreaterThan(300);
  expect(await v3(page, () => View3D.mod.debug.V.gl), "WebGL should be available").toBe(true);
  expect(await drawn(page)).toBeGreaterThan(0.05);
  await expect(page.locator("#v3-strip")).toBeVisible();   // the strip of every sheet along the bottom
});

for (const o of orders) {
  test(`order "${o.id}" is drawn in 3D`, async ({ page }) => {
    await openThree(page, `#three/${o.id}`);
    await expect(page.locator("#cx-order")).toHaveValue(o.id);
    expect(await drawn(page)).toBeGreaterThan(0.05);
  });
}

test("switching order in 3D redraws the book without errors", async ({ page }) => {
  await openThree(page);
  for (const o of [...orders].reverse().concat(orders)) {
    await page.locator("#cx-order").selectOption(o.id);
    await expect.poll(() => v3(page, () => S.order)).toBe(o.id);
    await expect.poll(() => drawn(page), { timeout: 15_000 }).toBeGreaterThan(0.05);
  }
});

test("every key the help lists does something sensible, and the book is still drawn after all of them", async ({ page }) => {
  await openThree(page);
  const keys = ["1", "2", "3", "4", "5", "0", "[", "]", "[", "p", "p", "m", "m", "+", "-", "v", "v", "v", "v", "v", "v", "v", "k", "ArrowRight", "ArrowLeft", "k",
    "ArrowRight", "ArrowRight", "Shift+ArrowRight", "Shift+ArrowLeft", "Home", "End", "Home", "Space", "t", "t", "u", "u", "o", "Escape",
    "Alt+ArrowLeft", "Alt+ArrowRight", "Alt+ArrowUp", "Alt+ArrowDown", "Alt+Shift+ArrowLeft", "r", "b", "b", "?", "Escape"];
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(40);
  }
  await expect(page.locator("#cx-help-dlg")).toBeHidden();
  expect(await drawn(page), "the book after the key sweep").toBeGreaterThan(0.05);
});

test("the five camera views (1 to 5) each move the camera, and 0 comes back to the front three-quarter angle", async ({ page }) => {
  await openThree(page);
  const cam = () => v3(page, () => { const c = View3D.mod.debug.CAM; return { yaw: ((c.yaw % 360) + 360) % 360, pitch: c.pitch, dist: c.dist }; });
  const label = c => `${Math.round(c.yaw)}°/${Math.round(c.pitch)}°/${Math.round(c.dist)}`;
  const start = await cam();
  const seen = new Set([label(start)]);
  for (const k of ["2", "3", "4", "5"]) {
    const before = label(await cam());
    await page.keyboard.press(k);
    await expect.poll(async () => label(await cam()), { message: `pressing ${k} should move the camera` }).not.toBe(before);
    seen.add(label(await cam()));
    expect(await drawn(page), `view ${k}`).toBeGreaterThan(0.02);
  }
  expect(seen.size, "the views are different camera positions").toBe(5);
  await page.keyboard.press("0");
  await expect.poll(async () => { const c = await cam(); return `${Math.round(c.yaw)}/${Math.round(c.pitch)}`; }).toBe(`${Math.round(start.yaw)}/${Math.round(start.pitch)}`);
  expect(await drawn(page)).toBeGreaterThan(0.05);
});

test("arrow keys step through the sheets, and the address and strip follow", async ({ page }) => {
  await openThree(page);
  const first = await sheet(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => sheet(page)).not.toBe(first);
  const second = await sheet(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => sheet(page)).not.toBe(second);
  await expect.poll(() => new URL(page.url()).hash).toContain("s=" + (await sheet(page)).replace("|", "-"));
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => sheet(page)).toBe(second);
  await page.keyboard.press("End");
  const last = await sheet(page);
  await page.keyboard.press("ArrowRight");   // at the last sheet
  expect(await sheet(page)).toBe(last);
  await page.keyboard.press("Home");
  await expect.poll(() => sheet(page)).toBe(first);
});

test("Space pulls a sheet out, Esc puts it back, and the inspector names the sheet", async ({ page }) => {
  await openThree(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(page.locator("#v3-insp")).toBeVisible();
  await expect(page.locator("#v3-insp")).toContainText(await sheet(page));
  expect(await drawn(page)).toBeGreaterThan(0.02);
  await page.keyboard.press("Escape");
  await expect(page.locator("#v3-insp")).toBeHidden();
});

test("the controls above the book (standing, lying, block, opening, colour, thickness) all work", async ({ page }) => {
  await openThree(page);
  for (const name of ["Lying", "Standing", "Opening", "Block", "Spine", "Head", "Fore-edge", "Reader's eye", "Front ¾"]) {
    await page.getByRole("button", { name: new RegExp(name) }).first().click();
    await page.waitForTimeout(80);
    expect(await drawn(page), name).toBeGreaterThan(0.02);
  }
  const colour = page.locator("#v-three select").filter({ has: page.locator("option", { hasText: /scribe/i }) }).first();
  const values = await colour.locator("option").evaluateAll(o => o.map(x => x.value));
  expect(values.length, "colour choices").toBeGreaterThan(3);
  for (const v of values) { await colour.selectOption(v); await page.waitForTimeout(60); }
  await page.getByRole("button", { name: "Touching faces" }).click();
  await expect(page.locator("#v3-contact")).toBeVisible();
  await page.getByRole("button", { name: "Touching faces" }).click();
  expect(await drawn(page)).toBeGreaterThan(0.02);
});

test("the spread slider fans the sheets out and back in", async ({ page }) => {
  await openThree(page);
  const slider = page.locator("#v-three input[type=range]").first();
  for (const v of ["0", "100", "50"]) {
    await slider.fill(v);
    await page.waitForTimeout(100);
    expect(await drawn(page), `spread ${v}`).toBeGreaterThan(0.01);
  }
});

test.describe("3D and the Reader follow each other", () => {
  test("Enter on a sheet in 3D opens the Reader at that sheet", async ({ page }) => {
    await openThree(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const id = await sheet(page);
    await page.keyboard.press("Enter");
    await expect(page.locator("#v-read")).toBeVisible();
    await readerPicturesLoaded(page);
    const pagesOfSheet = await page.evaluate(id => [...SHEETS.get(id).inside, ...SHEETS.get(id).outside].flat().map(s => s.page), id);
    const where = (await readerState(page)).where;
    expect(pagesOfSheet.some(p => where.includes(p)), `the Reader shows "${where}", which should be on sheet ${id} (${pagesOfSheet.join(", ")})`).toBe(true);
  });

  test("a page found in the Reader is the sheet picked in 3D", async ({ page }) => {
    await openSite(page, "#read/beinecke/78v");
    await readerPicturesLoaded(page);
    const expected = await page.evaluate(() => PAGE_SHEET.get("f78v"));
    await goTo(page, "three");
    await page.waitForFunction(() => typeof View3D !== "undefined" && View3D.mod?.debug?.V?.built);
    await expect.poll(() => sheet(page)).toBe(expected);
    expect(await drawn(page)).toBeGreaterThan(0.05);
  });
});

test.describe("deep links", () => {
  test("an address saved from 3D reopens the same sheet and view", async ({ page }) => {
    await openThree(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("2");
    const id = await sheet(page);
    expect(id).not.toBe("1|8");
    // the address is written a moment after the change: wait until it names this sheet and the spine view (2)
    await expect.poll(() => new URL(page.url()).hash).toMatch(new RegExp(`^#three/beinecke/s=${id.replace("|", "-")}&v=2`));
    const hash = new URL(page.url()).hash;
    await page.goto("/index.html" + hash);
    await page.reload();
    await page.waitForFunction(() => typeof View3D !== "undefined" && View3D.mod?.debug?.V?.built);
    await expect.poll(() => sheet(page)).toBe(id);
  });

  test("an address with a sheet that does not exist, or nonsense, still opens the book", async ({ page }) => {
    for (const bad of ["#three/beinecke/s=999-1000&v=1", "#three/beinecke/s=&v=&sp=NaN", "#three/beinecke/garbage", "#three/beinecke/s=1-8&v=99&sp=-5&i=abc"]) {
      await openThree(page, bad);
      expect(await drawn(page), bad).toBeGreaterThan(0.05);
    }
  });
});

test("if WebGL is not available, 3D says so and points to the Reader instead of failing", async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (/webgl/i.test(type)) return null;
      return orig.call(this, type, ...rest);
    };
  });
  await openSite(page, "#three/beinecke");
  await expect(page.locator(".v3-nogl")).toContainText("cannot draw WebGL");
  await page.locator(".v3-nogl").getByRole("button", { name: "Reader" }).click();
  await expect(page.locator("#v-read")).toBeVisible();
  await readerPicturesLoaded(page);
  page.problems.length = 0;   // three.js reports the missing context on the console
});
