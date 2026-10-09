// Rearrange on the table (wide screens): the book comes apart into a pile per quire, and works like a drawing program:
// select (click, ⇧/⌘-click, a box), drag onto a pile or between piles, ⌘G / ⇧⌘G, ⌘] / ⌘[, ⌫, ⌘X / ⌘V, a quire's name
// to select, rename or move it, right-click menus, and a panel in a fixed place that shows what is under the pointer.
const { test, expect, openThree } = require("./fixtures");

const G = page => page.evaluate(() => ORDERS.get(S.order).gatherings.map(g => `${g.quire}${g.type === "singulions" ? "~" : ""}:${g.bifolia.join(",")}`));
const quire = async (page, name) => (await G(page)).find(x => x.split(":")[0].replace("~", "") === String(name));
const sel = page => page.evaluate(() => ({ sheets: [...Arrange.selected].sort(), quires: [...Arrange.selQ] }));
const hud = page => page.locator("#v3-hud");
const bar = page => page.locator("#v3-arr-acts");
const caption = (page, key) => page.locator(`.v3-pile[data-key="${key}"]`);

async function openTable(page, order = "beinecke") {
  await openThree(page, `#three/${order}`);
  await page.keyboard.press("a");
  await expect(page.locator("#v-three")).toHaveClass(/table/);
  await expect.poll(() => page.locator(".v3-pile").count()).toBeGreaterThan(5);
}
/** a point on the screen for a thing on the table (book-space point, from the 3D view's own layout) */
const screen = (page, fn, arg) => page.evaluate(([src, arg]) => {
  const d = View3D.mod.debug, v = new Function("L", "arg", src)(d.V.layout, arg), st = document.querySelector("#v3-stage").getBoundingClientRect();
  const p = v.clone().project(d.camera);
  return { x: st.left + (p.x + 1) / 2 * st.width, y: st.top + (1 - p.y) / 2 * st.height };
}, [fn, arg]);
/** point at a sheet as a person would: its pile first (a stack opens out), then the part of the sheet that shows */
async function at(page, id) {
  let q = await screen(page, "return L.picks.get(arg)", id);
  await page.mouse.move(q.x, q.y); await page.waitForTimeout(120);
  q = await screen(page, "return L.picks.get(arg)", id);
  await page.mouse.move(q.x, q.y);
  await expect.poll(() => page.evaluate(() => View3D.mod.debug.V.hover?.id), { message: `pointing at ${id}` }).toBe(id);
  return q;
}
async function click(page, id, mod) {
  const q = await at(page, id);
  if (mod) await page.keyboard.down(mod);
  await page.mouse.click(q.x, q.y);
  if (mod) await page.keyboard.up(mod);
}
/** where a dragged sheet would go: into pile `key` before its k-th sheet (k = its length: at the end), or the gap after quire `after` */
const slot = (page, key, k) => screen(page, "const p = L.piles.find(x => x.key === arg[0]); const a = p.anchors[arg[1]]; return a.clone();", [key, k]);
const gapAfter = (page, key) => screen(page, `const ps = L.piles, i = ps.findIndex(x => x.key === arg), a = ps[i], b = ps[i + 1];
  const x = b && b.row === a.row ? (a.x0 + a.w + b.x0) / 2 : a.x0 + a.w + 20; return new a.label.constructor(x, 0, a.z1 - 40);`, key);
async function drag(page, from, to, { hold = null } = {}) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 6, from.y - 6, { steps: 3 });
  if (typeof to === "function") {   // aim, let the stack there open out, and aim again as a person would
    let q = await to(); await page.mouse.move(q.x, q.y, { steps: 16 }); await page.waitForTimeout(200);
    q = await to(); await page.mouse.move(q.x, q.y, { steps: 4 }); await page.waitForTimeout(200);
  } else await page.mouse.move(to.x, to.y, { steps: 16 });
  if (hold) await hold();
  await page.mouse.up();
}
/** empty table: in the column beside the piles (the panel's, which lets the pointer through) */
const emptySpot = page => page.locator("#v3-stage").boundingBox().then(b => ({ x: b.x + 120, y: b.y + b.height * .6 }));
const captionsAt = page => page.evaluate(() => [...document.querySelectorAll(".v3-pile")].map(e => e.dataset.key + "@" + e.style.transform).join(" "));

test("at first nothing is selected; pointing at a sheet shows its place in its pile and both its sides, in a panel that stays put", async ({ page }) => {
  await openTable(page);
  await expect(bar(page), "no bar until something is selected").toBeHidden();
  await at(page, "77|82");
  await expect(hud(page)).toBeVisible();
  await expect(hud(page).locator(".hud-id")).toHaveText("77 + 82");
  await expect(hud(page).locator(".hud-where")).toContainText("Q13");
  await expect(hud(page).locator(".hud-where .g-hi"), "its layer in gold in a picture of the pile").toHaveCount(1);
  await expect(hud(page).locator(".hud-where .g-sh")).toHaveCount(4);
  await expect(hud(page).locator("figcaption")).toHaveText(["inside 77v 82r", "outside 82v 77r"]);
  expect(await hud(page).innerText(), "no sentences").not.toMatch(/sheet from|Drag|Scribe|Balneology/);
  const still = await hud(page).boundingBox();
  await at(page, "78|81");
  expect(await hud(page).boundingBox().then(b => [b.x, b.y]), "the panel stays in its corner").toEqual([still.x, still.y]);
  // the Rosettes: both sides, each one picture, its pages named once
  await at(page, "85|86");
  await expect(hud(page).locator("figcaption").first()).toHaveText("inside Ros 85v Ros 86r");
  // a lost sheet: dashed places, no pictures
  await at(page, "91|92");
  await expect(hud(page).locator(".sf-hole")).not.toHaveCount(0);
  // the panel never covers a pile's name
  const box = await hud(page).boundingBox();
  for (const c of await page.locator(".v3-pile").all()) {
    const r = await c.boundingBox(); if (!r) continue;
    expect(r.x >= box.x + box.width || r.y >= box.y + box.height, `the panel covers ${await c.getAttribute("data-key")}`).toBe(true);
  }
});

test("click selects a sheet; ⇧- or ⌘-click adds and takes away; a click on the table clears", async ({ page }) => {
  await openTable(page);
  await click(page, "77|82");
  expect((await sel(page)).sheets).toEqual(["77|82"]);
  await expect(bar(page)).toContainText("77+82");
  await click(page, "78|81", "Shift");
  await click(page, "41|48", "Meta");
  expect((await sel(page)).sheets).toEqual(["41|48", "77|82", "78|81"]);
  await expect(bar(page)).toContainText("3 sheets");
  await click(page, "77|82", "Shift");
  expect((await sel(page)).sheets).toEqual(["41|48", "78|81"]);
  const empty = await emptySpot(page);
  await page.mouse.click(empty.x, empty.y);
  expect((await sel(page)).sheets).toEqual([]);
  await expect(bar(page)).toBeHidden();
});

test("a box drawn across the table selects the sheets in it; with ⇧ it adds to the selection", async ({ page }) => {
  await openTable(page);
  const a = await screen(page, "const p = L.piles.find(x => x.key === '1'); return new p.label.constructor(p.x0 - 10, 0, p.z0 - 10);");
  const b = await screen(page, "const p = L.piles.find(x => x.key === '2'); return new p.label.constructor(p.x0 + p.w + 10, 0, p.z1 + 5);");
  await drag(page, a, b, { hold: () => expect(page.locator("#v3-marquee")).toBeVisible() });
  await expect(page.locator("#v3-marquee")).toBeHidden();
  expect((await sel(page)).sheets).toEqual(["1|8", "2|7", "3|6", "4|5", "9|16", "10|15", "11|14", "12|13"].sort());
  const c = await screen(page, "const p = L.piles.find(x => x.key === '9'); return new p.label.constructor(p.x0 - 5, 0, p.z0 - 5);");
  const d = await screen(page, "const p = L.piles.find(x => x.key === '9'); return new p.label.constructor(p.x0 + p.w + 5, 0, p.z1 + 5);");
  await page.keyboard.down("Shift"); await drag(page, c, d); await page.keyboard.up("Shift");
  expect((await sel(page)).sheets).toContain("67|68");
  expect((await sel(page)).sheets).toHaveLength(9);
});

test("⌘G makes a new quire of the selected sheets, after the quire they came from; ⌘Z takes it back", async ({ page }) => {
  await openTable(page);
  await click(page, "77|82"); await click(page, "78|81", "Shift");
  await page.keyboard.press("Meta+g");
  await expect.poll(() => G(page)).toContain("13:75|84,76|83,79|80");
  const g = await G(page), i = g.indexOf("13:75|84,76|83,79|80");
  expect(g[i + 1], "right after quire 13").toBe("New 1:77|82,78|81");
  expect((await sel(page)).quires, "the new quire is selected").toEqual(["New 1"]);
  await expect(caption(page, "New 1")).toBeVisible();
  await page.keyboard.press("Meta+z");
  await expect.poll(() => quire(page, 13)).toBe("13:75|84,76|83,77|82,78|81,79|80");
  expect((await G(page)).some(x => x.startsWith("New"))).toBe(false);
});

test("selected quires merge into one with ⌘G; ⇧⌘G splits a quire into quires of one sheet, 13a, 13b…", async ({ page }) => {
  await openTable(page);
  await caption(page, "15").click();
  await caption(page, "17").click({ modifiers: ["Shift"] });
  expect((await sel(page)).quires).toEqual(["15", "17"]);
  await expect(bar(page)).toContainText("2 quires");
  await page.keyboard.press("Meta+g");
  await expect.poll(() => quire(page, 15)).toBe("15:87|90,88|89,93|96,94|95");
  expect(await quire(page, 17)).toBeUndefined();
  await caption(page, "13").click();
  await page.keyboard.press("Meta+Shift+g");
  await expect.poll(() => G(page).then(g => g.filter(x => x.startsWith("13")))).toEqual(["13a:75|84", "13b:76|83", "13c:77|82", "13d:78|81", "13e:79|80"]);
  expect((await sel(page)).quires).toEqual(["13a", "13b", "13c", "13d", "13e"]);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => quire(page, 13)).toBe("13:75|84,76|83,77|82,78|81,79|80");
});

test("⌘] and ⌘[ move a sheet toward the centre and outward, ⌥ all the way; in a fan, later and earlier", async ({ page }) => {
  await openTable(page);
  await click(page, "76|83");
  await page.keyboard.press("Meta+BracketRight");
  await expect.poll(() => quire(page, 13)).toBe("13:75|84,77|82,76|83,78|81,79|80");
  await page.keyboard.press("Meta+Alt+BracketRight");
  await expect.poll(() => quire(page, 13)).toBe("13:75|84,77|82,78|81,79|80,76|83");
  await page.keyboard.press("Meta+Alt+BracketLeft");
  await expect.poll(() => quire(page, 13)).toBe("13:76|83,75|84,77|82,78|81,79|80");
  await page.keyboard.press("Meta+BracketLeft");   // already outermost: nothing happens
  await page.waitForTimeout(200);
  expect(await quire(page, 13)).toBe("13:76|83,75|84,77|82,78|81,79|80");
  // a selected quire: one place later in the book
  await caption(page, "9").click();
  await page.keyboard.press("Meta+BracketRight");
  await expect.poll(() => G(page).then(g => g.map(x => x.split(":")[0]).slice(8, 11))).toEqual(["10", "9", "11"]);
});

test("in Davis's order the quires are fans of cards, and the same moves work there", async ({ page }) => {
  await openTable(page, "davis");
  expect(await page.evaluate(() => View3D.mod.debug.V.layout.piles.filter(p => p.key !== "aside").every(p => p.fan))).toBe(true);
  await click(page, "4|5");
  await expect(bar(page).getByRole("button", { name: "Earlier" })).toBeEnabled();
  await page.keyboard.press("Meta+BracketLeft");
  await expect.poll(() => quire(page, 1)).toBe("1~:1|8,2|7,4|5,3|6");
  // drag a card into the middle of quire 13's fan, and see where in the panel first
  await drag(page, await at(page, "1|8"), () => slot(page, "13", 2), { hold: async () => {
    await expect(hud(page).locator(".hud-head")).toHaveText("Q1 → Q13");
    await expect(hud(page).locator(".g-thi")).toHaveText("1+8");
  } });
  await expect.poll(() => quire(page, 13)).toBe("13~:77|82,78|81,1|8,75|84,76|83,79|80");
});

test("⌫ sets the selection aside, and the message offers Undo", async ({ page }) => {
  await openTable(page);
  await click(page, "41|48"); await click(page, "42|47", "Shift");
  await page.keyboard.press("Backspace");
  await expect.poll(() => page.evaluate(() => ORDERS.get(S.order).unplaced)).toEqual(["41|48", "42|47"]);
  await expect(caption(page, "aside")).toContainText("2");
  const msg = page.locator("#cx-toast");
  await expect(msg).toContainText("2 sheets set aside");
  await msg.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => quire(page, 6)).toBe("6:41|48,42|47,43|46,44|45");
});

test("⌘X then ⌘V moves sheets after the selected sheet, or into a selected quire", async ({ page }) => {
  await openTable(page);
  await click(page, "1|8"); await page.keyboard.press("Meta+x");
  await click(page, "41|48"); await page.keyboard.press("Meta+v");
  await expect.poll(() => quire(page, 6)).toBe("6:41|48,1|8,42|47,43|46,44|45");
  await click(page, "2|7"); await page.keyboard.press("Meta+x");
  await caption(page, "9").click(); await page.keyboard.press("Meta+v");
  await expect.poll(() => quire(page, 9)).toBe("9:67|68,2|7");
});

test("a sheet dragged into a stack lands exactly where the panel shows it, and nothing else on the table moves", async ({ page }) => {
  await openTable(page);
  await click(page, "41|48");   // the first move makes a copy: get that out of the way
  await page.keyboard.press("Meta+BracketRight");
  await expect.poll(() => page.evaluate(() => S.order)).toMatch(/^my-/);
  const before = await captionsAt(page);
  await drag(page, await at(page, "3|6"), () => slot(page, "13", 2), { hold: async () => {
    await expect(caption(page, "13"), "the pile it would go into lights up").toHaveClass(/target/);
    await expect(hud(page).locator(".hud-head")).toHaveText("Q1 → Q13");
    // the picture: the quire's sheets, the outermost at the bottom, with 3+6 in gold between 76+83 and 77+82
    expect(await hud(page).locator("text").allTextContents()).toEqual(["75+84", "76+83", "3+6", "77+82", "78+81", "79+80"]);
    await expect(hud(page).locator(".g-thi")).toHaveText("3+6");
    expect(await hud(page).boundingBox().then(b => b.width), "the picture's panel is as wide as the picture").toBeLessThan(200);
  } });
  await expect.poll(() => quire(page, 13)).toBe("13:75|84,76|83,3|6,77|82,78|81,79|80");
  await page.mouse.move(5, 5);
  await expect.poll(() => captionsAt(page), "no quire moved").toBe(before);
  // within the same pile there is no "Q13 → Q13", only the picture
  await drag(page, await at(page, "79|80"), () => slot(page, "13", 0), { hold: () => expect(hud(page).locator(".hud-head")).toHaveCount(0) });
  await expect.poll(() => quire(page, 13)).toBe("13:79|80,75|84,76|83,3|6,77|82,78|81");
});

test("dragging into the gap between two quires makes a new quire there", async ({ page }) => {
  await openTable(page);
  await drag(page, await at(page, "9|16"), await gapAfter(page, "4"), { hold: async () => {
    await expect(hud(page).locator(".hud-head")).toHaveText("Q2 → new quire");
  } });
  await expect.poll(() => G(page).then(g => g.map(x => x.split(":")[0]).slice(2, 6))).toEqual(["3", "4", "New 1", "5"]);
  expect(await quire(page, "New 1")).toBe("New 1:9|16");
  // at the end of a row: after its last quire
  const rowEnd = await page.evaluate(() => { const ps = View3D.mod.debug.V.layout.piles; return ps.find((p, i) => ps[i + 1] && ps[i + 1].row !== p.row).key; });
  await drag(page, await at(page, "10|15"), await gapAfter(page, rowEnd));
  await expect.poll(() => G(page).then(g => g[g.findIndex(x => x.startsWith(rowEnd + ":")) + 1])).toBe("New 2:10|15");
});

test("several selected sheets are dragged together", async ({ page }) => {
  await openTable(page);
  await click(page, "2|7"); await click(page, "4|5", "Shift");
  await drag(page, await at(page, "2|7"), () => slot(page, "20", 2), { hold: () => expect(hud(page).locator(".g-hi")).toHaveCount(2) });
  await expect.poll(() => quire(page, 20)).toBe("20:103|116,104|115,2|7,4|5,105|114,106|113,107|112,108|111,109|110");
  expect((await sel(page)).sheets, "they stay selected").toEqual(["2|7", "4|5"]);
});

test("a quire's name: click selects it, double-click renames it (not to a name in use), right-click opens its menu, drag moves it", async ({ page }) => {
  await openTable(page);
  await caption(page, "13").click();
  await expect(caption(page, "13")).toHaveClass(/sel/);
  await expect(bar(page)).toContainText("Q13");
  await caption(page, "13").dblclick();
  const field = caption(page, "13").locator("input");
  await expect(field).toBeFocused();
  await field.fill("12"); await field.press("Enter");
  await expect(page.locator("#cx-toast")).toContainText("already a quire called 12");
  await field.fill("Bath"); await field.press("Enter");
  await expect.poll(() => quire(page, "Bath")).toBe("Bath:75|84,76|83,77|82,78|81,79|80");
  await caption(page, "Bath").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /Split into single sheets/ })).toBeVisible();
  await expect(page.locator(".ar-menu kbd").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ar-menu")).toHaveCount(0);
  const from = await caption(page, "Bath").boundingBox(), to = await caption(page, "9").boundingBox();
  await drag(page, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, { x: to.x + 4, y: to.y + to.height / 2 });
  await expect.poll(() => G(page).then(g => g.map(x => x.split(":")[0]).slice(7, 10))).toEqual(["8", "Bath", "9"]);
});

test("right-click on a sheet: its actions, with their shortcuts; on the table: select all, zoom to fit", async ({ page }) => {
  await openTable(page);
  const q = await at(page, "77|82");
  await page.mouse.click(q.x, q.y, { button: "right" });
  expect((await sel(page)).sheets, "a right-click selects the sheet").toEqual(["77|82"]);
  const items = await page.locator(".ar-menu [role^=menuitem]").allInnerTexts();
  for (const t of ["Toward the centre", "Outward", "Move to…", "New quire of it", "Set aside", "Inside out", "Upside down"]) expect(items.join("|")).toContain(t);
  await page.getByRole("menuitem", { name: /^Move to…/ }).click();
  await page.getByRole("menuitem", { name: /^Q9/ }).click();
  await expect.poll(() => quire(page, 9)).toBe("9:67|68,77|82");
  const empty = await emptySpot(page);
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await page.getByRole("menuitem", { name: /Select all/ }).click();
  expect((await sel(page)).sheets.length).toBe(58);
});

test("keys: Tab steps through the sheets, ↑ ↓ through a pile, ⇧↵ selects the quire and ↵ its sheets, Esc deselects and then leaves", async ({ page }) => {
  await openTable(page);
  await click(page, "1|8");
  await page.keyboard.press("Tab");
  expect((await sel(page)).sheets).toEqual(["2|7"]);
  await page.keyboard.press("ArrowUp");
  expect((await sel(page)).sheets, "up the pile: toward the centre").toEqual(["3|6"]);
  await page.keyboard.press("Shift+Enter");
  expect(await sel(page)).toEqual({ sheets: [], quires: ["1"] });
  await page.keyboard.press("Enter");
  expect((await sel(page)).sheets).toEqual(["1|8", "2|7", "3|6", "4|5"]);
  await page.keyboard.press("Escape");
  expect(await sel(page)).toEqual({ sheets: [], quires: [] });
  await page.keyboard.press("Escape");
  await expect(page.locator("#v-three")).not.toHaveClass(/table/);
});

test("a first move makes your own copy, and its message can take that back", async ({ page }) => {
  await openTable(page);
  await click(page, "1|8"); await page.keyboard.press("Meta+BracketRight");
  const msg = page.locator("#cx-toast");
  await expect(msg).toContainText("your own copy");
  await msg.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => page.evaluate(() => [S.order, MyOrders.list.length])).toEqual(["beinecke", 0]);
});

test("hiding a quire or the lost sheets takes them off the table; the other rows stay as they were", async ({ page }) => {
  await openTable(page);
  const rows = () => page.evaluate(() => View3D.mod.debug.V.layout.piles.map(p => `${p.key}:${p.row}:${Math.round(p.x0)}`));
  const before = await rows();
  await caption(page, "16").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Hide in 3D" }).click();
  await expect(caption(page, "16")).toHaveCount(0);
  const after = await rows(), row16 = before.find(x => x.startsWith("16:")).split(":")[1];
  expect(after.filter(x => x.split(":")[1] !== row16), "rows without quire 16 don't move").toEqual(before.filter(x => x.split(":")[1] !== row16));
  await page.locator("#v3-arrange").getByRole("button", { name: "Hide lost sheets" }).click();
  await expect(caption(page, "18"), "quire 18 is all lost").toHaveCount(0);
});

test.describe("the list beside the table (Rearrange as it used to be)", () => {
  const list = page => page.locator("#v3-list");
  const row = (page, id) => list(page).locator(`.al-row[data-id="${id}"]`);
  async function openList(page, order) {
    await openTable(page, order);
    await page.locator("#v3-arrange").getByRole("button", { name: "List of quires" }).click();
    await expect(list(page)).toBeVisible();
    // the table is narrower now: wait for the camera to have fitted it again
    let was = -1;
    await expect.poll(async () => { const d = await page.evaluate(() => View3D.mod.debug.CAM.dist); const same = Math.abs(d - was) < .01; was = d; return same; }, { intervals: [250] }).toBe(true);
  }
  /** drag a list row by its handle onto another row (its lower half: after it) */
  async function dragRow(page, from, to, after = true) {
    const a = await from.locator(".al-grip").boundingBox(), b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * (after ? .75 : .25), { steps: 14 });
    await page.mouse.up();
  }

  test("it opens from the bar, beside the table, with every quire and sheet; it stays open next time", async ({ page }) => {
    await openList(page);
    await expect(list(page).locator(".al-g:not(.al-aside)")).toHaveCount(20);
    await expect(list(page).locator(".al-row")).toHaveCount(58);
    const l = await list(page).boundingBox(), st = await page.locator("#v3-stage").boundingBox();
    expect(l.x, "on the right of the table").toBeGreaterThanOrEqual(st.x + st.width - 1);
    const pile = await page.locator('.v3-pile[data-key="6"]').boundingBox();
    expect(pile.x + pile.width, "the table fits beside it").toBeLessThanOrEqual(l.x);
    await page.locator("#v3-arrange").getByRole("button", { name: "Done" }).click();
    await page.keyboard.press("a");
    await expect(list(page), "it remembers").toBeVisible();
    await list(page).getByRole("button", { name: "Close the list" }).click();
    await expect(list(page)).toBeHidden();
  });

  test("a sheet dragged in the list moves on the table too, and stays selected in both", async ({ page }) => {
    await openList(page);
    await dragRow(page, row(page, "3|6"), row(page, "10|15"));
    await expect.poll(() => quire(page, 2)).toBe("2:9|16,10|15,3|6,11|14,12|13");
    await expect.poll(() => page.evaluate(() => View3D.mod.debug.V.layout.piles.find(p => p.key === "2").ens.length), "the table's pile").toBe(5);
    expect((await sel(page)).sheets).toEqual(["3|6"]);
    await expect(row(page, "3|6")).toHaveClass(/sel/);
    await page.keyboard.press("Meta+z");
    await expect.poll(() => quire(page, 1)).toBe("1:1|8,2|7,3|6,4|5");
  });

  test("selecting on the table shows in the list, and a click in the list selects on the table; a second click opens the sheet's options", async ({ page }) => {
    await openList(page);
    await click(page, "107|112");
    await expect(row(page, "107|112")).toHaveClass(/cur/);
    await expect(row(page, "107|112")).toBeInViewport();
    await row(page, "42|47").locator(".al-main").click();
    expect((await sel(page)).sheets).toEqual(["42|47"]);
    await row(page, "44|45").locator(".al-main").click({ modifiers: ["Shift"] });
    expect((await sel(page)).sheets).toEqual(["42|47", "44|45"]);
    await row(page, "42|47").locator(".al-main").click();
    await row(page, "42|47").locator(".al-main").click();
    await list(page).getByLabel("Inside out").check();
    await expect.poll(() => page.evaluate(() => JSON.stringify(ORDERS.get(S.order).gatherings[5].sheets || {}))).toContain("inside_out");
    await expect(row(page, "42|47")).toContainText("inside out");
  });

  test("a change made on the table shows in the list at once; the list's quire controls work on the table", async ({ page }) => {
    await openList(page);
    await click(page, "77|82"); await click(page, "78|81", "Shift");
    await page.keyboard.press("Meta+g");
    await expect(list(page).locator('.al-g[data-key="New 1"] .al-row')).toHaveCount(2);
    await expect(list(page).locator('.al-g[data-key="New 1"]'), "the new quire, selected").toHaveClass(/sel/);
    await list(page).locator('.al-g[data-key="9"] .al-eye').click();
    await expect(page.locator('.v3-pile[data-key="9"]'), "hidden on the table").toHaveCount(0);
    await list(page).locator('.al-g[data-key="9"] .al-eye').click();
    await expect(page.locator('.v3-pile[data-key="9"]')).toHaveCount(1);
    await list(page).locator('.al-g[data-key="1"]').getByRole("button", { name: "Separate" }).click();
    await expect.poll(() => quire(page, 1)).toBe("1~:1|8,2|7,3|6,4|5");
    await expect.poll(() => page.evaluate(() => View3D.mod.debug.V.layout.piles.find(p => p.key === "1").fan), "a fan on the table").toBe(true);
  });
});

test("hiding lost sheets on the table: an emptied set-aside pile shows its dashed place at once, under its name", async ({ page }) => {
  await openTable(page, "davis");   // its only set-aside sheet, 109|110, is lost
  await page.locator("#v3-arrange").getByRole("button", { name: "Hide lost sheets" }).click();
  await expect(caption(page, "aside")).toContainText("1 lost");
  await expect.poll(() => page.evaluate(() => View3D.mod.debug.tray.visible)).toBe(true);
  // drawn, not just set: the canvas has the dashed outline where the place is (lighter than the table)
  const at = await page.evaluate(() => {
    const d = View3D.mod.debug, t = d.tray, st = document.querySelector("#v3-stage").getBoundingClientRect();
    t.updateMatrixWorld(true);
    const p = (x, y) => { const v = t.position.clone().set(x, y, 0).applyMatrix4(t.matrixWorld).project(d.camera); return { x: st.left + (v.x + 1) / 2 * st.width, y: st.top + (1 - v.y) / 2 * st.height }; };
    return { l: p(-.5, -.5), r: p(.5, -.5) };
  });
  const cap = await caption(page, "aside").boundingBox();
  expect(Math.abs(cap.x + cap.width / 2 - (at.l.x + at.r.x) / 2), "its name centred under it").toBeLessThan(3);
  const shot = await page.screenshot({ clip: { x: Math.min(at.l.x, at.r.x) - 2, y: at.l.y - 3, width: Math.abs(at.r.x - at.l.x) + 4, height: 6 } });
  const lit = await page.evaluate(async b64 => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const px = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 90) n++; return n;
  }, shot.toString("base64"));
  expect(lit, "the dashed outline is on the screen").toBeGreaterThan(10);
});

test("A puts the book back together, as Done and Esc do, and opens the table again", async ({ page }) => {
  await openTable(page);
  await page.keyboard.press("a");
  await expect(page.locator("#v-three")).not.toHaveClass(/table/);
  expect(await page.evaluate(() => [Arrange.on, View3D.mod.arranging])).toEqual([false, false]);
  await page.keyboard.press("a");
  await expect(page.locator("#v-three")).toHaveClass(/table/);
});

test("a change that changes nothing leaves a built-in order alone: no copy is made", async ({ page }) => {
  await openTable(page);
  const untouched = async why => expect(await page.evaluate(() => [S.order, MyOrders.list.length]), why).toEqual(["beinecke", 0]);
  // a sheet picked up and let go where it was
  const q = await at(page, "77|82");
  await drag(page, q, () => slot(page, "13", 2));
  await untouched("let go where it was");
  expect(await quire(page, 13)).toBe("13:75|84,76|83,77|82,78|81,79|80");
  // the centre sheet one further in, the outermost one further out
  await click(page, "79|80"); await page.keyboard.press("Meta+BracketRight");
  await click(page, "75|84"); await page.keyboard.press("Meta+BracketLeft");
  await untouched("⌘] on the centre sheet, ⌘[ on the outermost");
  // the way a quire is put together, chosen again
  await caption(page, "2").click();
  await bar(page).getByRole("button", { name: "Tucked" }).click();
  await untouched("Tucked on a tucked quire");
  await expect(page.locator("#cx-toast")).not.toContainText("your own copy");
  // and a real change still makes the copy
  await page.keyboard.press("Meta+BracketRight");
  await expect.poll(() => page.evaluate(() => S.order)).toMatch(/^my-/);
});

test("the list of shortcuts fits in the window, every line of it", async ({ page }) => {
  await openTable(page);
  await page.locator("#v3-arrange").getByRole("button", { name: "Keyboard shortcuts" }).click();
  const m = page.locator(".ar-menu");
  await expect(m).toBeVisible();
  expect(await m.evaluate(e => e.scrollHeight - e.clientHeight), "nothing to scroll to").toBeLessThanOrEqual(1);
  const r = await m.boundingBox();
  expect(r.y + r.height).toBeLessThanOrEqual(page.viewportSize().height);
  await expect(m.locator(".ar-row").last()).toBeInViewport({ ratio: 1 });
});
