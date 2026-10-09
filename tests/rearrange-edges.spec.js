// Rearrange on the table, at its edges: keys while something is in hand, Esc for every kind of drag, the sheet under a pointer
// that stays still while its stack opens out, the gaps at the end of the table, names that can't be used, cut and paste onto
// itself, sheets left off the table, focus for keyboard users, a crowded set-aside pile, big quires, and what stays put.
const { test, expect } = require("./fixtures");
const { G, quire, sel, hud, bar, caption, still, openTable, screen, at, click, slot, drag, emptySpot } = require("./table");

const piles = page => page.evaluate(() => View3D.mod.debug.V.layout.piles.map(p => ({ key: p.key, row: p.row, x0: Math.round(p.x0), ids: p.ids })));

test("keys wait while a sheet is in hand: ⌘Z changes nothing under it, and Esc puts it back", async ({ page }) => {
  await openTable(page);
  await click(page, "9|16"); await page.keyboard.press("Meta+g");   // your own copy, and every quire after 2 one further on
  await expect.poll(() => quire(page, "New 1")).toBe("New 1:9|16");
  const before = await G(page);
  const from = await at(page, "41|48");
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 6, from.y - 6, { steps: 3 });
  const to = await slot(page, "13", 1);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.keyboard.press("Meta+z");
  expect(await G(page), "no undo while the sheet is in hand").toEqual(before);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await G(page), "Esc: it goes back").toEqual(before);
  expect(page.problems).toEqual([]);
});

test("a pointer that stays still while a stack opens out under it: the panel shows the sheet a click takes", async ({ page }) => {
  await openTable(page);
  for (const id of ["77|82", "76|83", "2|7", "105|114", "108|111"]) {
    await page.mouse.move(5, 300);   // off the table: every stack closed
    await still(page);
    const q = await screen(page, "return L.picks.get(arg)", id);   // where the sheet shows in its closed stack
    await page.mouse.move(q.x, q.y);
    await still(page);
    const shown = await hud(page).locator(".hud-id").textContent();
    await page.mouse.click(q.x, q.y);
    const taken = (await sel(page)).sheets;
    expect(taken.map(x => x.replace("|", " + ")), `aimed at ${id}`).toEqual([shown]);
  }
});

test("let go in the gap after the set-aside pile: a new quire at the end of the book, not the start", async ({ page }) => {
  await openTable(page);
  const q = await at(page, "77|82");
  await drag(page, q, () => screen(page, "const p = L.piles.find(x => x.key === 'aside'); return new p.label.constructor(p.x0 + p.w + 30, 0, p.z1 - 40);"));
  const g = await G(page);
  expect(g.at(-1)).toBe("New 1:77|82");
  expect(g[0]).toBe("1:1|8,2|7,3|6,4|5");
});

test("names that can't be used are refused: one that reads as another quire's number, the set-aside pile's", async ({ page }) => {
  await openTable(page);
  const rename = async (key, name, how = "Enter") => {
    await caption(page, key).dblclick();
    const input = caption(page, key).locator("input");
    await input.fill(name);
    if (how === "Enter") await input.press("Enter"); else await page.mouse.click(5, 300);
  };
  await rename("12", "013");
  await expect(page.locator("#cx-toast")).toContainText("already a quire called 13");
  await caption(page, "12").locator("input").press("Escape");
  await rename("9", "aside");
  await expect(page.locator("#cx-toast")).toContainText("kept for the set-aside pile");
  await caption(page, "9").locator("input").press("Escape");
  // clicking away from a name that can't be used gives up, and leaves the focus where it went
  await rename("10", "11", "away");
  await expect(caption(page, "10").locator("input")).toHaveCount(0);
  await expect(caption(page, "10")).toContainText("Q10");
  expect(await page.evaluate(() => [S.order, MyOrders.list.length]), "nothing renamed").toEqual(["beinecke", 0]);
  // a name that can be used: kept, as a number
  await rename("12", "012x");
  await expect.poll(() => G(page).then(g => g[11])).toBe("012x:73|74");
});

test("the panel goes once the sheet in hand leaves the piles, and comes back over one", async ({ page }) => {
  await openTable(page);
  const q = await at(page, "77|82");
  await page.mouse.move(q.x, q.y); await page.mouse.down();
  await page.mouse.move(q.x + 6, q.y - 6, { steps: 3 });
  const over = await slot(page, "2", 1);
  await page.mouse.move(over.x, over.y, { steps: 10 });
  await expect(hud(page)).toBeVisible();
  const st = await page.locator("#v3-stage").boundingBox();
  await page.mouse.move(st.x + st.width - 20, st.y + 30, { steps: 10 });   // the far corner of the table: nowhere to go
  await expect(hud(page)).toBeHidden();
  await page.mouse.up();
  expect(await quire(page, 13)).toBe("13:75|84,76|83,77|82,78|81,79|80");
});

test("Esc while a quire's name is dragged puts the quire back; while a box is drawn, the selection is as it was", async ({ page }) => {
  await openTable(page);
  const before = await G(page);
  const a = await caption(page, "12").boundingBox(), b = await caption(page, "3").boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await G(page), "the quire stays where it was").toEqual(before);
  await expect(page.locator("#v-three"), "and the table stays").toHaveClass(/table/);
  // a box
  await click(page, "41|48");
  const p = await screen(page, "const p = L.piles.find(x => x.key === '1'); return new p.label.constructor(p.x0 - 10, 0, p.z0 - 10);");
  const r = await screen(page, "const p = L.piles.find(x => x.key === '2'); return new p.label.constructor(p.x0 + p.w + 10, 0, p.z1 + 5);");
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(r.x, r.y, { steps: 10 });
  await page.keyboard.press("Escape");
  await expect(page.locator("#v3-marquee")).toBeHidden();
  await page.mouse.up();
  expect((await sel(page)).sheets, "the selection before the box").toEqual(["41|48"]);
});

test("cut and paste: not onto the sheets cut; the table's \"as a new quire\" makes one whatever is selected", async ({ page }) => {
  await openTable(page);
  await click(page, "1|8"); await page.keyboard.press("Meta+x");
  await page.keyboard.press("Meta+v");
  await expect(page.locator("#cx-toast")).toContainText("Select where the cut sheets go");
  expect(await quire(page, 1), "nothing moved").toBe("1:1|8,2|7,3|6,4|5");
  await click(page, "41|48");
  const e = await emptySpot(page);
  await page.mouse.click(e.x, e.y, { button: "right" });
  await page.getByRole("menuitem", { name: /as a new quire/ }).click();
  await expect.poll(() => G(page).then(g => g.at(-1))).toBe("New 1:1|8");
  expect(await quire(page, 6)).toBe("6:41|48,42|47,43|46,44|45");
});

test("↑ ↓ keep to the sheets on the table; ⇧↵ on a set-aside sheet selects the set-aside pile", async ({ page }) => {
  await openTable(page);
  await page.locator("#v3-arrange").getByRole("button", { name: "Hide lost sheets" }).click();
  await click(page, "108|111");
  await page.keyboard.press("ArrowUp");
  expect((await sel(page)).sheets, "109|110 is lost and off the table: there is nothing further in").toEqual(["108|111"]);
  await page.locator("#v3-arrange").getByRole("button", { name: "Hide lost sheets" }).click();
  await click(page, "1|8"); await page.keyboard.press("Backspace");
  await click(page, "2|7"); await page.keyboard.press("Backspace");
  await click(page, "1|8");
  await page.keyboard.press("Shift+Enter");
  expect((await sel(page)).sheets).toEqual(["1|8", "2|7"]);
});

test("what can't be seen is not left selected: a quire hidden, a quire undone", async ({ page }) => {
  await openTable(page);
  await click(page, "1|8");
  await page.evaluate(() => View3D.mod.setHidden("1", true));
  expect(await sel(page)).toEqual({ sheets: [], quires: [] });
  await expect(bar(page)).toBeHidden();
  await page.evaluate(() => View3D.mod.setHidden("1", false));
  await click(page, "77|82"); await click(page, "78|81", "Shift"); await page.keyboard.press("Meta+g");
  expect((await sel(page)).quires).toEqual(["New 1"]);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => sel(page)).toEqual({ sheets: [], quires: [] });
});

test("keyboard: Tab moves the focus among the table's buttons and names; a button used keeps the focus", async ({ page }) => {
  await openTable(page);
  await click(page, "2|7");
  const toward = bar(page).getByRole("button", { name: "Toward the centre" });
  await toward.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => quire(page, 1)).toBe("1:1|8,3|6,2|7,4|5");
  await expect(toward, "still in focus, for the next press").toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => quire(page, 1)).toBe("1:1|8,3|6,4|5,2|7");
  await caption(page, "3").focus();
  await page.keyboard.press("Tab");
  expect((await sel(page)).sheets, "Tab on a name moves the focus, not the selection").toEqual(["2|7"]);
  await expect(caption(page, "3")).not.toBeFocused();
});

test("a crowded set-aside pile: every sheet in it can still be pointed at", async ({ page }) => {
  await openTable(page);
  const ids = ["1|8", "9|16", "17|24", "25|32", "33|40", "41|48"];
  await page.evaluate(ids => { Arrange.setSel(ids); Arrange.setAside(ids); }, ids);
  await still(page);
  for (const id of ids) await at(page, id);
});

test("a big quire selected: the bar at the foot stays a bar", async ({ page }) => {
  await openTable(page);
  await page.keyboard.press("Meta+a");   // nothing selected: every sheet
  await page.keyboard.press("Meta+g");
  await expect.poll(() => G(page).then(g => g.length)).toBe(1);
  const b = await bar(page).boundingBox();
  expect(b.height, "no taller than a line of buttons, give or take").toBeLessThan(80);
});

test("merging a quire into the one before it leaves the rest of its row where it was", async ({ page }) => {
  await openTable(page);
  const before = await piles(page), row = before.find(p => p.key === "19").row;
  await caption(page, "19").click();
  await bar(page).getByRole("button", { name: "Merge with next" }).click();
  await expect.poll(() => quire(page, 19)).toContain("103|116");
  const after = await piles(page);
  for (const p of before.filter(p => p.row === row && p.key !== "20")) expect(after.find(x => x.key === p.key).x0, `quire ${p.key}`).toBe(p.x0);
});

test("in a small window the panel has a column of its own: it never covers a pile", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await openTable(page);
  await at(page, "1|8");
  const h = await hud(page).boundingBox();
  for (const k of ["1", "7", "14"]) {
    const p = await screen(page, `const p = L.piles.find(x => x.key === '${k}'); return new p.label.constructor(p.x0, 0, p.z1);`);
    expect(p.x, `quire ${k} starts right of the panel`).toBeGreaterThan(h.x + h.width);
  }
});

test("a sheet's menu offers no move it can't make", async ({ page }) => {
  await openTable(page);
  const q = await at(page, "79|80");   // the centre sheet of quire 13
  await page.mouse.click(q.x, q.y, { button: "right" });
  await expect(page.getByRole("menuitem", { name: "Toward the centre" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Outward" })).toBeEnabled();
});
