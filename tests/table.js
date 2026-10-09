// Helpers for the tests of Rearrange on the table (rearrange-*.spec.js): open the table, find things on it, point, click
// and drag as a person would.
const { expect, openThree } = require("./fixtures");

const G = page => page.evaluate(() => ORDERS.get(S.order).gatherings.map(g => `${g.quire}${g.type === "singulions" ? "~" : ""}:${g.bifolia.join(",")}`));
const quire = async (page, name) => (await G(page)).find(x => x.split(":")[0].replace("~", "") === String(name));
const sel = page => page.evaluate(() => ({ sheets: [...Arrange.selected].sort(), quires: [...Arrange.selQ] }));
const hud = page => page.locator("#v3-hud");
const bar = page => page.locator("#v3-arr-acts");
const caption = (page, key) => page.locator(`.v3-pile[data-key="${key}"]`);

/** wait until nothing on the table is moving or about to (a slow machine draws few frames: don't guess from two readings) */
const still = page => page.waitForFunction(() => !View3D.mod.debug.busy, null, { timeout: 15_000 });
async function openTable(page, order = "beinecke") {
  await openThree(page, `#three/${order}`);
  await page.keyboard.press("a");
  await expect(page.locator("#v-three")).toHaveClass(/table/);
  await expect.poll(() => page.locator(".v3-pile").count()).toBeGreaterThan(5);
  await still(page);
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

module.exports = { G, quire, sel, hud, bar, caption, still, openTable, screen, at, click, slot, gapAfter, drag, emptySpot };
