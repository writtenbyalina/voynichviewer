// The Drawings tab and the drawings outlined in the Reader: every drawing cut out, alone or on its page, what is known of
// it, and its outline on the Reader's pages. (Yale's server is blocked here, so pictures come from data/panels/.)
const { test, expect, openSite, goTo } = require("./fixtures");
const fs = require("fs");
const path = require("path");

const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
const ix = read("data/drawings/index.json").drawings;
const plant = ix.find(d => d.page === "f9v" && d.kind === "plant") || ix.find(d => d.kind === "plant");
// a page's set, as the gallery shows it: the women or the stars of a panel (three or more), else a cut-out group
const many = {};
for (const d of ix) if (["woman", "star"].includes(d.kind)) many[`${d.img}:${d.kind}`] = (many[`${d.img}:${d.kind}`] || 0) + 1;
const setOf = d => ["woman", "star"].includes(d.kind) && many[`${d.img}:${d.kind}`] >= 3 ? `${d.img}:${d.kind}` : d.group || null;
const member = ix.find(d => setOf(d));
const hashOf = page => decodeURIComponent(new URL(page.url()).hash);

test("the tab lists every drawing, a page's group as one card, and the count says how many", async ({ page }) => {
  await openSite(page, "#read/beinecke");
  await goTo(page, "draw");
  await expect(page.locator(".dw-card").first()).toBeVisible();
  const cards = ix.filter(d => !setOf(d)).length + new Set(ix.map(setOf).filter(Boolean)).size;
  await expect(page.locator(".dw-card")).toHaveCount(cards);
  await expect(page.locator(".dw-count")).toContainText(`${ix.length.toLocaleString("en")} drawing`);
  // the cut-outs are drawn as they come into view
  await expect(page.locator(".dw-card.ready").first()).toBeVisible();
  expect(hashOf(page)).toMatch(/^#draw\/beinecke\/all$/);
});

test("searching and filtering narrow the list, and the address keeps them", async ({ page }) => {
  await openSite(page, "#draw/beinecke/all");
  await expect(page.locator(".dw-card").first()).toBeVisible();
  await page.locator(".dw-chip[data-key=s][data-val=herbal]").click();
  await expect(page.locator(".dw-part h2")).toHaveCount(1);
  await expect(page.locator(".dw-part h2")).toContainText("Herbal");
  expect(hashOf(page)).toContain("s=herbal");
  await page.locator("#dw-q").fill("no such drawing anywhere");
  await expect(page.locator(".dw-none")).toBeVisible();
  await page.locator(".dw-none button").click();
  await expect(page.locator(".dw-card").first()).toBeVisible();
  expect(hashOf(page)).toBe("#draw/beinecke/all");
  // a filtered address opens filtered
  await page.goto("/index.html#draw/beinecke/all?k=plant");
  await expect(page.locator(".dw-kind")).toHaveValue("plant");
  await expect(page.locator(".dw-card")).toHaveCount(ix.filter(d => d.kind === "plant" && !setOf(d)).length + new Set(ix.filter(d => d.kind === "plant").map(setOf).filter(Boolean)).size);
});

test("a drawing opens alone with what is known of it, steps with the arrows, shows on its page, and Escape goes back", async ({ page }) => {
  await openSite(page, `#draw/beinecke/all`);
  await page.locator(`.dw-card[data-id="${plant.id}"]`).click();
  await expect(page.locator(".dw-view")).toBeVisible();
  await expect(page.locator(".dw-gallery")).toBeHidden();
  expect(hashOf(page)).toBe(`#draw/beinecke/${plant.id}`);
  await expect(page.locator(".dw-title")).not.toBeEmpty();
  await expect(page.locator(".dw-known.big")).toBeVisible();
  await expect.poll(() => page.evaluate(() => { const c = document.querySelector("canvas.dw-big"); return c ? c.width : 0; })).toBeGreaterThan(100);
  // on its page: the whole page, the drawing lit up
  await page.keyboard.press("f");
  await expect(page.locator(".dw-pagebox .dw-lit .edge").first()).toBeAttached();
  expect(hashOf(page)).toBe(`#draw/beinecke/${plant.id}?on=page`);
  await page.keyboard.press("f");
  await expect(page.locator("canvas.dw-big")).toBeVisible();
  // the next drawing, and back
  const at = ix.indexOf(plant);
  if (ix[at + 1]) {
    await page.keyboard.press("ArrowRight");
    expect(hashOf(page)).toBe(`#draw/beinecke/${ix[at + 1].id}`);
    await page.keyboard.press("ArrowLeft");
    expect(hashOf(page)).toBe(`#draw/beinecke/${plant.id}`);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".dw-gallery")).toBeVisible();
  expect(hashOf(page)).toBe("#draw/beinecke/all");
});

test("a group's member shows the others of its page, and opening one moves to it", async ({ page }) => {
  test.skip(!member, "no grouped drawings");
  await openSite(page, `#draw/beinecke/${member.id}`);
  const n = ix.filter(d => setOf(d) === setOf(member)).length;
  await expect(page.locator(".dw-sec h3", { hasText: `All ${n} on this page` })).toBeVisible();
  if (n > 1) {
    await page.locator(".dw-mini:not(.cur)").first().click();
    await expect.poll(() => hashOf(page)).not.toBe(`#draw/beinecke/${member.id}`);
    await expect(page.locator(".dw-mini.cur")).toHaveCount(1);
  }
});

test("Save picture gives a PNG of the drawing alone", async ({ page }) => {
  await openSite(page, `#draw/beinecke/${plant.id}`);
  await expect(page.locator("canvas.dw-big")).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save picture" }).click()]);
  expect(dl.suggestedFilename()).toBe(`voynich-${plant.id.replace(/\./g, "-")}.png`);
  const file = await dl.path();
  const head = fs.readFileSync(file).subarray(0, 8);
  expect([...head], "a PNG file").toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

test("the Reader outlines the drawings (D): pointing names one, a click lights it up and opens it alone", async ({ page }) => {
  await openSite(page, `#read/beinecke/${plant.page.replace(/^f/, "")}`);
  await page.keyboard.press("d");
  await expect(page.locator("#rd-drawbtn")).toHaveAttribute("aria-pressed", "true");
  const path_ = page.locator(`#rd-stage .dp[data-id="${plant.id}"]`);
  await expect(path_).toBeAttached();
  // a point inside the drawing: the middle of its outline's box, moved onto the outline if that misses
  const pt = await page.evaluate(id => {
    const p = document.querySelector(`#rd-stage .dp[data-id="${id}"]`), r = p.getBoundingClientRect();
    for (let i = 0; i < 400; i++) {
      const x = r.left + r.width * ((i * 37) % 100) / 100, y = r.top + r.height * ((i * 61) % 100) / 100;
      if (document.elementsFromPoint(x, y).includes(p)) return { x, y };
    }
    return null;
  }, plant.id);
  expect(pt, "a point on the drawing").not.toBeNull();
  await page.mouse.move(pt.x, pt.y);
  await expect(page.locator("#dw-tip")).toBeVisible();
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator("#dw-pop")).toBeVisible();
  await expect(page.locator("#rd-stage")).toHaveClass(/dw-has-sel/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#dw-pop")).toBeHidden();
  await page.mouse.click(pt.x, pt.y);
  await page.locator("#dw-pop").getByRole("button", { name: "See it alone" }).click();
  await expect(page.locator(".dw-view")).toBeVisible();
  expect(hashOf(page)).toBe(`#draw/beinecke/${plant.id}`);
  // and back: "Open in the Reader" goes to its page with it lit up
  await page.locator(".dw-read").click();
  await expect(page.locator("#v-read")).toBeVisible();
  await expect(page.locator("#dw-pop")).toBeVisible();
  // D again hides the outlines
  await page.keyboard.press("Escape");
  await page.keyboard.press("d");
  await expect(page.locator("#rd-stage .seg-draws")).toHaveCount(0);
});

test("side by side puts another drawing beside this one at the same scale, and the address keeps it", async ({ page }) => {
  const other = ix.find(d => d.id !== plant.id && d.kind === plant.kind) || ix.find(d => d.id !== plant.id);
  await openSite(page, `#draw/beinecke/${plant.id}?with=${other.id}`);
  await expect(page.locator(".dw-pair figure")).toHaveCount(2);
  await expect(page.locator(".dw-pair figcaption").nth(1)).toContainText(other.page.replace(/^f/, ""));
  await page.locator(".dw-seg button", { hasText: "Cut out" }).click();
  await expect(page.locator("canvas.dw-big")).toBeVisible();
  expect(hashOf(page)).toBe(`#draw/beinecke/${plant.id}`);
});

test("Surprise me opens a drawing from those listed", async ({ page }) => {
  await openSite(page, "#draw/beinecke/all?k=plant");
  await page.getByRole("button", { name: "Surprise me" }).click();
  await expect(page.locator(".dw-view")).toBeVisible();
  const id = hashOf(page).split("/")[2];
  expect(ix.find(d => d.id === id)?.kind).toBe("plant");
});
