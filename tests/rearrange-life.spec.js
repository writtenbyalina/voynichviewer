// Rearrange and the rest of the app: the copy a first move makes and its Undo, undo and the order's name, quires hidden in
// 3D through copies, renames and merges, renaming and deleting from Your work, importing over the open order, a bookmark
// opened on the table, and a window that becomes narrower or wider than a phone's while Rearrange is open.
const { test, expect, openThree } = require("./fixtures");
const fs = require("fs");

const G = page => page.evaluate(() => ORDERS.get(S.order).gatherings.map(g => `${g.quire}:${g.bifolia.join(",")}`));
const still = page => page.waitForFunction(() => !View3D.mod.debug.busy, null, { timeout: 15_000 });
const caption = (page, key) => page.locator(`.v3-pile[data-key="${key}"]`);
const bar = page => page.locator("#v3-arrange");
const msg = page => page.locator("#cx-toast");
async function openTable(page, order = "beinecke") {
  await openThree(page, `#three/${order}`);
  await page.keyboard.press("a");
  await expect(page.locator("#v-three")).toHaveClass(/table/);
  await still(page);
}
/** select sheets by the app's own selection (where they are on the table is tested in rearrange-table.spec.js) */
const select = (page, ...ids) => page.evaluate(ids => Arrange.setSel(ids, { main: ids.at(-1) }), ids);
const hidden = page => page.evaluate(() => [...View3D.mod.hiddenQuires()].sort());

test("a first move's message can take the copy back, but once more moves are made it no longer offers to", async ({ page }) => {
  await openTable(page);
  await select(page, "3|6"); await page.keyboard.press("Meta+BracketLeft");
  await expect(msg(page)).toContainText("your own copy");
  await expect(msg(page).getByRole("button", { name: "Undo" })).toBeVisible();
  await select(page, "9|16"); await page.keyboard.press("Meta+BracketRight");
  await expect(msg(page).getByRole("button", { name: "Undo" }), "taking back the copy would throw this move away too").toHaveCount(0);
  await expect(msg(page)).toContainText("your own copy");
  // ⌘Z is one step back, and the copy keeps the first move
  await page.keyboard.press("Meta+z");
  await expect.poll(() => G(page).then(g => g.slice(0, 2))).toEqual(["1:1|8,3|6,2|7,4|5", "2:9|16,10|15,11|14,12|13"]);
  expect(await page.evaluate(() => S.order)).toMatch(/^my-/);
});

test("Undo in the message of a first move on Davis's order goes straight back to Davis's order", async ({ page }) => {
  await openTable(page, "davis");
  const before = await G(page);
  await select(page, "1|8"); await page.keyboard.press("Meta+BracketRight");
  await msg(page).getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => page.evaluate(() => [S.order, MyOrders.list.length])).toEqual(["davis", 0]);
  expect(await G(page)).toEqual(before);
  expect(await page.evaluate(() => View3D.mod.debug.V.prevOrder), "not by way of the current binding (Replay would show that)").not.toBe("beinecke");
  await expect(page.locator("#v-three"), "still on the table").toHaveClass(/table/);
});

test("undo takes back moves, not the name you gave the order; a fresh copy has nothing to undo", async ({ page }) => {
  await openTable(page);
  await bar(page).getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Make my own copy now" }).click();
  await expect.poll(() => page.evaluate(() => S.order)).toMatch(/^my-/);
  await expect(bar(page).getByRole("button", { name: "Undo" }), "nothing to undo yet").toBeDisabled();
  await select(page, "1|8"); await page.keyboard.press("Meta+BracketRight");
  await page.evaluate(() => MyOrders.put({ ...ORDERS.get(S.order), title: "Renamed A" }));
  await page.keyboard.press("Meta+z");
  await expect.poll(() => G(page).then(g => g[0])).toBe("1:1|8,2|7,3|6,4|5");
  expect(await page.evaluate(() => ORDERS.get(S.order).title)).toBe("Renamed A");
  await expect(bar(page)).toContainText("Renamed A");
});

test("a quire hidden in 3D stays hidden in the copy a first move makes, and under a new name; one merged away is forgotten", async ({ page }) => {
  await openTable(page);
  await caption(page, "5").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Hide in 3D" }).click();
  await expect(caption(page, "5")).toHaveCount(0);
  await select(page, "3|6"); await page.keyboard.press("Meta+BracketRight");
  await expect.poll(() => page.evaluate(() => S.order)).toMatch(/^my-/);
  expect(await hidden(page), "the copy hides what the binding hid").toEqual(["5"]);
  await expect(caption(page, "5")).toHaveCount(0);
  // renamed (from the list, where a hidden quire still is): hidden under its new name
  await page.evaluate(() => { const gi = ORDERS.get(S.order).gatherings.findIndex(g => String(g.quire) === "5");
    Arrange.edit(o => { o.gatherings[gi].quire = "Herbal X"; }, { renamed: ["5", "Herbal X"] }); });
  expect(await hidden(page)).toEqual(["Herbal X"]);
  await expect(caption(page, "Herbal X"), "still off the table").toHaveCount(0);
  // a hidden quire merged into the one before it: nothing hidden is left, and no later quire 20 starts out hidden
  await caption(page, "20").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Hide in 3D" }).click();
  await caption(page, "19").click();
  await page.locator("#v3-arr-acts").getByRole("button", { name: "Merge with next" }).click();
  await expect.poll(() => hidden(page)).toEqual(["Herbal X"]);
});

test("renaming your order in Your work shows the new name at once, on the table and off it", async ({ page }) => {
  await openTable(page);
  await select(page, "1|8"); await page.keyboard.press("Meta+BracketRight");
  const rename = async name => {
    await page.locator("#cx-work").click();
    await page.locator("#work-dlg").getByRole("button", { name: "Rename" }).click();
    await page.locator("dialog.ask input").fill(name);
    await page.locator("dialog.ask").getByRole("button", { name: "Rename" }).click();
    await page.locator("#work-dlg").press("Escape");
  };
  await rename("Via Work");
  await expect(bar(page)).toContainText("Via Work");
  await bar(page).getByRole("button", { name: "Done" }).click();
  await rename("Second name");
  await expect(page.locator("#v3-title")).toHaveText("Second name");
});

test("deleting a copy of Davis's order goes back to Davis's order", async ({ page }) => {
  await openTable(page, "davis");
  await select(page, "1|8"); await page.keyboard.press("Meta+BracketRight");
  await expect.poll(() => page.evaluate(() => S.order)).toMatch(/^my-/);
  await bar(page).getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Delete this order/ }).click();
  await page.locator("dialog.ask").getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => page.evaluate(() => [S.order, MyOrders.list.length])).toEqual(["davis", 0]);
});

test("importing a file over the order open on the table starts its undo afresh", async ({ page }, info) => {
  await openTable(page);
  await select(page, "1|8"); await page.keyboard.press("Meta+BracketRight");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => Work.exportFile())]);
  const file = info.outputPath("progress.json");
  await dl.saveAs(file);
  // two more moves after the file was saved
  await select(page, "9|16"); await page.keyboard.press("Backspace");
  await expect.poll(() => page.evaluate(() => ORDERS.get(S.order).unplaced)).toEqual(["9|16"]);
  await select(page, "17|24"); await page.keyboard.press("Meta+BracketRight");
  await expect.poll(() => G(page).then(g => g[2])).toBe("3:18|23,17|24,19|22,20|21");
  await page.evaluate(async text => Work.importFile(new File([text], "progress.json")), fs.readFileSync(file, "utf8"));
  await expect.poll(() => page.evaluate(() => ORDERS.get(S.order).unplaced), "the file's version is on the table").toEqual([]);
  const now = await G(page);
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(300);
  expect(await G(page), "nothing from before the import to undo into (it would mix the two)").toEqual(now);
});

test("a bookmark opened on the table selects its sheet there; the 3D inspector stays shut", async ({ page }) => {
  await openTable(page);
  await page.evaluate(() => Bookmarks.go({ page: "f57v" }));
  await expect.poll(() => page.evaluate(() => [...Arrange.selected])).toEqual(["57|66"]);
  expect(await page.evaluate(() => View3D.mod.debug.V.inspect)).toBe(false);
  await expect(page.locator(".v3-insp")).toBeHidden();
});

test("leaving the table after the inspector was open: the address no longer asks for the inspector", async ({ page }) => {
  await openThree(page);
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => location.hash)).toContain("i=1");
  await page.keyboard.press("a");
  await expect(page.locator("#v-three")).toHaveClass(/table/);
  await expect.poll(() => page.evaluate(() => location.hash)).not.toContain("i=1");
  await bar(page).getByRole("button", { name: "Done" }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).not.toContain("i=1");
});

test("a window made as narrow as a phone's while on the table opens Rearrange as the phone's panel, and wider again, the table", async ({ page }) => {
  await openTable(page);
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.locator("#v-three"), "no table on a phone").not.toHaveClass(/table/);
  await expect(page.locator("#v3-arrange .ar-tabs")).toBeVisible();
  expect(await page.evaluate(() => Arrange.on)).toBe(true);
  await page.setViewportSize({ width: 1360, height: 860 });
  await expect(page.locator("#v-three")).toHaveClass(/table/);
  await expect(page.locator("#v3-arrange .ar-tabs")).toHaveCount(0);
});

test("on the table, messages keep to the corner beside the piles; in the Reader they are where they always are", async ({ page }) => {
  await openTable(page);
  await page.evaluate(() => toast("A message"));
  const onTable = await msg(page).boundingBox();
  expect(onTable.x, "at the left").toBeLessThan(40);
  await page.locator("#cx-tabs button[data-view=read]").click();
  await page.evaluate(() => toast("Another message"));
  await expect.poll(async () => { const b = await msg(page).boundingBox(); return Math.abs(b.x + b.width / 2 - page.viewportSize().width / 2); }, "centred").toBeLessThan(2);
});
