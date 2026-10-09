// Rearrange and the progress file: an order made on the table, with every kind of change it can make, goes out in a
// progress file and comes back in another browser exactly as it was, and Rearrange works on it there.
const { test, expect, openThree } = require("./fixtures");
const fs = require("fs");

const G = page => page.evaluate(() => { const o = ORDERS.get(S.order); return { gatherings: o.gatherings.map(g => ({ quire: g.quire, type: g.type, bifolia: g.bifolia, sheets: g.sheets || {} })), unplaced: o.unplaced, title: o.title, from: o.from }; });
const screen = (page, fn, arg) => page.evaluate(([src, arg]) => {
  const d = View3D.mod.debug, v = new Function("L", "arg", src)(d.V.layout, arg), st = document.querySelector("#v3-stage").getBoundingClientRect();
  const p = v.clone().project(d.camera);
  return { x: st.left + (p.x + 1) / 2 * st.width, y: st.top + (1 - p.y) / 2 * st.height };
}, [fn, arg]);
async function at(page, id) {
  let q = await screen(page, "return L.picks.get(arg)", id); await page.mouse.move(q.x, q.y); await page.waitForTimeout(120);
  q = await screen(page, "return L.picks.get(arg)", id); await page.mouse.move(q.x, q.y);
  await expect.poll(() => page.evaluate(() => View3D.mod.debug.V.hover?.id)).toBe(id);
  return q;
}
async function click(page, id, mod) { const q = await at(page, id); if (mod) await page.keyboard.down(mod); await page.mouse.click(q.x, q.y); if (mod) await page.keyboard.up(mod); }
const caption = (page, key) => page.locator(`.v3-pile[data-key="${key}"]`);
async function openTable(page, order = "beinecke") {
  await openThree(page, `#three/${order}`);
  await page.keyboard.press("a");
  await expect(page.locator("#v-three")).toHaveClass(/table/);
}
async function exportFile(page) {
  await page.locator("#v3-arrange").getByRole("button", { name: "More", exact: true }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /Export/ }).click()]);
  const file = await dl.path();
  return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
}
async function importFile(page, file) {
  await page.locator("#v3-arrange").getByRole("button", { name: "More", exact: true }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("menuitem", { name: /Import/ }).click()]);
  await chooser.setFiles(file);
  await expect(page.locator("#cx-toast")).toContainText("Imported");
}

test("an order made on the table, with every kind of change, comes back from a progress file exactly, and Rearrange works on it", async ({ page, browser }) => {
  await openTable(page);
  // a move between quires, cut and paste, a new quire from two sheets, a merge, a split, a rename, a quire read
  // sheet by sheet, inside out, upside down, a foldout sewn at another fold, a sheet set aside, a quire moved
  await click(page, "3|6"); await page.keyboard.press("Meta+BracketRight");
  await click(page, "41|48"); await page.keyboard.press("Meta+x"); await click(page, "57|66"); await page.keyboard.press("Meta+v");
  await click(page, "77|82"); await click(page, "78|81", "Shift"); await page.keyboard.press("Meta+g");
  await caption(page, "15").click(); await caption(page, "17").click({ modifiers: ["Shift"] }); await page.keyboard.press("Meta+g");
  await caption(page, "20").click(); await page.keyboard.press("Meta+Shift+g");
  await caption(page, "New 1").dblclick(); await caption(page, "New 1").locator("input").fill("Bath B"); await caption(page, "New 1").locator("input").press("Enter");
  await caption(page, "2").click({ button: "right" }); await page.getByRole("menuitemcheckbox", { name: /Separate/ }).or(page.getByRole("menuitemradio", { name: /Separate/ })).click();
  await click(page, "1|8"); await page.locator("#v3-arr-acts").getByRole("button", { name: "Inside out" }).click();
  await click(page, "9|16"); await page.locator("#v3-arr-acts").getByRole("button", { name: "Upside down" }).click();
  await click(page, "67|68"); await page.locator("#v3-arr-acts").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^the fold between 67v2 and 67v1/ }).click();
  await click(page, "33|40"); await page.keyboard.press("Backspace");
  await caption(page, "9").click(); await page.keyboard.press("Meta+BracketRight");
  const made = await G(page);
  expect(made.gatherings.find(g => g.quire === "Bath B").bifolia).toEqual(["77|82", "78|81"]);
  expect(made.gatherings.filter(g => String(g.quire).startsWith("20")).length).toBe(7);
  expect(made.gatherings.find(g => g.quire === 1).sheets["1|8"]).toEqual({ inside_out: true });
  expect(made.gatherings.find(g => g.quire === 9).sheets["67|68"]).toEqual({ spine: 1 });
  expect(made.unplaced).toContain("33|40");

  const { file, data } = await exportFile(page);
  expect(data.orders).toHaveLength(1);

  // another browser: nothing of ours in it, then the file
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const other = await ctx.newPage();
  const problems = []; other.on("pageerror", e => problems.push(e.message));
  await openTable(other);
  await importFile(other, file);
  await other.locator("#cx-order").selectOption(data.orders[0].id);
  await expect.poll(() => other.evaluate(() => S.order)).toBe(data.orders[0].id);
  const back = await G(other);
  expect(back, "the same order, sheet for sheet, with every sheet's folding").toEqual(made);
  // Rearrange on it there: the table, the gold dots and Put back measure it against the order it came from
  await expect(other.locator(".v3-pile")).toHaveCount(made.gatherings.length + 1);
  const dots = await other.evaluate(() => [...Arrange.changes(ORDERS.get(S.order)).sheets].sort());
  expect(dots).toContain("3|6"); expect(dots).not.toContain("2|7");
  await click(other, "3|6");
  await other.locator("#v3-arr-acts").getByRole("button", { name: "More", exact: true }).click();
  await other.getByRole("menuitem", { name: /Put back as in “Current binding/ }).click();
  await expect.poll(() => other.evaluate(() => ORDERS.get(S.order).gatherings[0].bifolia.join(" "))).toBe("1|8 2|7 3|6 4|5");
  expect(problems).toEqual([]);
  await ctx.close();
});

test("a copy of Davis's order made before it was renamed still knows where it came from", async ({ page }) => {
  // as exported before "Davis: complete proposed order" became "Davis: proposed order"
  await openThree(page, "#three/davis");
  const davis = await page.evaluate(() => JSON.parse(JSON.stringify(ORDERS.get("davis"))));
  const q13 = davis.gatherings.find(g => g.quire === 13);
  const old = { app: "voynich-viewer", version: 1, exported: "2026-10-05T10:00:00Z", crops: {}, bookmarks: [],
    orders: [{ id: "my-oldcopy", title: "My Davis", from: "Davis: complete proposed order", updated: "2026-10-05T10:00:00Z",
      gatherings: davis.gatherings.map(g => g.quire === 13 ? { ...g, bifolia: [q13.bifolia[1], q13.bifolia[0], ...q13.bifolia.slice(2)] } : g), unplaced: davis.unplaced || [] }] };
  const file = test.info().outputPath("old-davis.json");
  fs.writeFileSync(file, JSON.stringify(old));
  await page.keyboard.press("a");
  await importFile(page, file);
  await page.locator("#cx-order").selectOption("my-oldcopy");
  await expect.poll(() => page.evaluate(() => Arrange.source(ORDERS.get(S.order)).id)).toBe("davis");
  // only the two sheets swapped in quire 13 count as changed, not every sheet Davis's order moved
  expect(await page.evaluate(() => [...Arrange.changes(ORDERS.get(S.order)).sheets].length)).toBeLessThanOrEqual(2);
  await expect(page.locator("#cx-order option:checked")).toHaveText("My Davis");
  expect(await page.evaluate(() => ORDERS.get(S.order).from), "the name it was started from, kept as written").toBe("Davis: complete proposed order");
  expect(await page.evaluate(() => ORDERS.get(S.order).subtitle), "shown by the name it has now").toContain("Davis: proposed order");
  const { data } = await exportFile(page);
  expect(data.orders.find(o => o.id === "my-oldcopy").fromId, "and by id from now on").toBe("davis");
});

test("importing a file over the order open on the table shows the imported version at once", async ({ page }) => {
  await openTable(page);
  await page.keyboard.press("Tab"); await page.keyboard.press("Meta+BracketRight");   // 1|8 one place in: a copy of our own
  await expect.poll(() => page.evaluate(() => S.order)).toMatch(/^my-/);
  const { file, data } = await exportFile(page);
  // carry on here, then bring the exported version back over it
  await page.keyboard.press("Meta+BracketRight");
  await expect.poll(() => page.evaluate(() => ORDERS.get(S.order).gatherings[0].bifolia.join(" "))).toBe("2|7 3|6 1|8 4|5");
  await importFile(page, file);
  await expect.poll(() => page.evaluate(() => ORDERS.get(S.order).gatherings[0].bifolia.join(" "))).toBe("2|7 1|8 3|6 4|5");
  await expect.poll(() => page.evaluate(() => View3D.mod.debug.V.layout.piles.find(p => p.key === "1").ens.map(e => e.id).join(" ")),
    "the table shows it too").toBe("2|7 1|8 3|6 4|5");
  expect(data.orders[0].id).toBe(await page.evaluate(() => S.order));
});

test("Export in Rearrange's menu is on when there is anything to export, bookmarks included", async ({ page }) => {
  await openThree(page);
  await page.evaluate(() => Bookmarks.toggle("f1r"));   // a bookmark, and nothing else of ours
  await expect.poll(() => page.evaluate(() => Bookmarks.list.length)).toBe(1);
  expect(await page.evaluate(() => MyOrders.list.length + Crops.mine.size)).toBe(0);
  await page.keyboard.press("a");
  await page.locator("#v3-arrange").getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /Export/ })).toBeEnabled();
});
