// Your orders are saved as they change, and their earlier versions are kept: the order as it was before each visit to
// Rearrange, before a file is imported over it, before an earlier version is restored. And two things about how the table
// moves: a card drawn out of a fan goes up, clear of the name in front; the book coming apart goes to the far side of
// the table first, so no sheet passes through it.
const { test, expect, openThree } = require("./fixtures");
const { G, caption, still, openTable, at, click } = require("./table");
const fs = require("fs");

const versions = page => page.evaluate(() => Versions.list(S.order).map(v => v.why));
const msg = page => page.locator("#cx-toast");
const more = page => page.locator("#v3-arrange").getByRole("button", { name: "More", exact: true });

async function ownOrder(page) {   // your own copy, made by a first move: the version before it is the built-in order itself
  await openTable(page);
  await click(page, "1|8"); await page.keyboard.press("Meta+BracketRight");
  await expect.poll(() => page.evaluate(() => S.order)).toMatch(/^my-/);
  expect(await versions(page), "a fresh copy has nothing earlier of its own").toEqual([]);
  await page.locator("#v3-arrange").getByRole("button", { name: "Done" }).click();
}

test("each visit to Rearrange keeps your order as it was before its first change; Done says so; it survives a reload", async ({ page }) => {
  await ownOrder(page);
  const before = await G(page);
  await page.keyboard.press("a"); await still(page);
  await click(page, "2|7"); await page.keyboard.press("Meta+BracketRight");
  await click(page, "9|16"); await page.keyboard.press("Meta+BracketRight");
  expect(await versions(page), "one version for the visit, however many changes").toEqual(["before"]);
  await page.locator("#v3-arrange").getByRole("button", { name: "Done" }).click();
  await expect(msg(page)).toContainText("The order as it was before is kept");
  await expect(msg(page).getByRole("button", { name: "Earlier versions" })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => typeof Versions !== "undefined" && MyOrders.list.length === 1);
  expect(await page.evaluate(() => Versions.list(S.order).map(v => JSON.stringify(v.gatherings.map(g => `${g.quire}:${g.bifolia.join(",")}`))))).toEqual([JSON.stringify(before)]);
});

test("an earlier version can be restored exactly, and the order it replaces is kept in turn; ⌘Z takes the restore back", async ({ page }) => {
  await ownOrder(page);
  const before = await G(page);
  await page.keyboard.press("a"); await still(page);
  await click(page, "2|7"); await page.keyboard.press("Backspace");
  const changed = await G(page);
  await more(page).click();
  await page.getByRole("menuitem", { name: /Earlier versions \(1\)/ }).click();
  const dlg = page.locator("dialog.versions-dlg");
  await expect(dlg).toContainText("before you rearranged it");
  await expect(dlg).toContainText("1 sheet moved since");
  await dlg.getByRole("button", { name: "Restore" }).click();
  await expect.poll(() => G(page)).toEqual(before);
  expect(await page.evaluate(() => ORDERS.get(S.order).unplaced)).toEqual([]);
  expect(await versions(page), "the order it replaced is a version now").toEqual(["before", "restore"]);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => G(page)).toEqual(changed);
});

test("an earlier version can be opened as a copy, beside the order as it is", async ({ page }) => {
  await ownOrder(page);
  const before = await G(page), id = await page.evaluate(() => S.order);
  await page.keyboard.press("a"); await still(page);
  await click(page, "3|6"); await page.keyboard.press("Meta+BracketLeft");
  const now = await G(page);
  await page.locator("#cx-work").click();
  await page.locator("#work-dlg").getByRole("button", { name: "Versions (1)" }).click();
  await page.locator("dialog.versions-dlg").getByRole("button", { name: "Open as a copy" }).click();
  await expect.poll(() => page.evaluate(() => MyOrders.list.length)).toBe(2);
  expect(await page.evaluate(() => S.order)).not.toBe(id);
  expect(await G(page), "the copy is the earlier version").toEqual(before);
  expect(await page.evaluate(id => ORDERS.get(id).gatherings.map(g => `${g.quire}:${g.bifolia.join(",")}`), id), "the order itself is as it was").toEqual(now);
});

test("a file imported over your order keeps the order as it was; deleting the order drops its versions", async ({ page }, info) => {
  await ownOrder(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => Work.exportFile())]);
  const file = info.outputPath("progress.json"); await dl.saveAs(file);
  await page.keyboard.press("a"); await still(page);
  await click(page, "41|48"); await page.keyboard.press("Backspace");   // a change made after the file was saved
  const lost = await G(page);
  await page.evaluate(async text => Work.importFile(new File([text], "progress.json")), fs.readFileSync(file, "utf8"));
  await expect.poll(() => page.evaluate(() => ORDERS.get(S.order).unplaced)).toEqual([]);
  expect(await versions(page)).toEqual(["before", "import"]);
  expect(await page.evaluate(() => Versions.list(S.order).at(-1).gatherings.map(g => `${g.quire}:${g.bifolia.join(",")}`)), "what the file replaced").toEqual(lost);
  const id = await page.evaluate(() => S.order);
  await page.evaluate(id => MyOrders.remove(id), id);
  expect(await page.evaluate(id => [Versions.list(id).length, JSON.parse(localStorage.getItem("vv:versions") || "{}")[id]], id)).toEqual([0, undefined]);
});

test("a card selected in a fan stays where it lies, its whole outline drawn over the cards on it", async ({ page }) => {
  await openTable(page, "davis");
  const before = await page.evaluate(() => View3D.mod.debug.V.layout.centers.get("77|82").clone());
  const q = await at(page, "77|82");
  await page.mouse.click(q.x, q.y);
  await page.mouse.move(5, 400); await still(page);
  const after = await page.evaluate(() => View3D.mod.debug.V.layout.centers.get("77|82"));
  expect([after.x, after.z], "not drawn out of line, either way").toEqual([before.x, before.z]);
  expect(await page.evaluate(() => View3D.mod.debug.V.layout.centers.get("77|82").z === View3D.mod.debug.V.layout.centers.get("78|81").z)).toBe(true);
  const ol = await page.evaluate(() => { const l = View3D.mod.debug.selOutlines.find(x => x.visible); return l && { depthTest: l.material.depthTest, w: l.scale.x }; });
  expect(ol, "an outline as wide as the card, not hidden under the next card").toEqual({ depthTest: false, w: expect.any(Number) });
  // and in a stack, the selected sheet still comes a little out toward you
  await page.locator("#cx-order").selectOption("beinecke");
  await page.keyboard.press("Escape");   // nothing selected
  await page.mouse.move(5, 400); await still(page);
  const s0 = await page.evaluate(() => View3D.mod.debug.V.layout.centers.get("77|82").z);
  const r = await at(page, "77|82"); await page.mouse.click(r.x, r.y);
  await page.mouse.move(5, 400); await still(page);
  expect(await page.evaluate(() => View3D.mod.debug.V.layout.centers.get("77|82").z)).toBeGreaterThan(s0);
});

test.describe("the book coming apart", () => {
  test.use({ reducedMotion: "no-preference" });
  test("first goes to the far side of the table, behind the first row, so the sheets dealt out never pass through it", async ({ page }) => {
    await openThree(page, "#three/beinecke");
    await page.keyboard.press("a");
    await expect(page.locator("#v-three")).toHaveClass(/table/);
    const at = k => page.evaluate(k => {
      const d = View3D.mod.debug; d.seek(k);
      const L = d.V.layout, V3 = L.frame.min.constructor, back = Math.min(...L.piles.filter(p => p.row === 0).map(p => p.z0));
      const zs = d.V.model.all.map(en => d.V.objs.get(en.id)).filter(o => o?.group.visible).map(o => o.group.getWorldPosition(new V3()).z);
      return { back, front: Math.max(...zs) };
    }, k);
    const glided = await at(.14);
    expect(glided.front, "every sheet behind the first row's piles").toBeLessThan(glided.back);
    await page.evaluate(() => View3D.mod.debug.settle());
  });
});
