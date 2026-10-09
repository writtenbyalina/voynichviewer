// A visitor who has used the site a lot: bookmarks, two orders of their own with every kind of sewing change, two re-cut
// pages, and their settings. It uses the site's own code to save all of it, so what ends up in the browser is what that
// version of the site really writes. The same scenario runs against the frozen releases (capture.js, once, to make the
// fixtures) and against the current code (legacy-format.spec.js, every time, to see whether the format has moved).
//
// The page must already be on the site (booted), with Yale's photograph stood in for (helpers.standInForYale).
const { exportProgress, dumpStorage } = require("./helpers");

const BOOKMARKS = [
  ["f78v", "Waterspouts ★ “quoted” & <b>tags</b>"],
  ["f1r", null],                       // no name: the page name is used
  ["f67r1", "Big foldout"],
  ["f12r", "A lost leaf"],
];
const CROPS = [["f1r", 0], ["f78v", 90]];
// Panels only the earliest release had (1.1 split f70r2 and f70v2 in two). A visitor of that time may have re-cut them, with every
// corner moved; they are cropped only when the release being captured has the panel, so 1.1 and later skip them.
const LEGACY_CROPS = [
  ["f70r2", [[5311, 196], [8700, 150], [8700, 3740], [5316, 3694]], 0],   // the right edge pulled out to the page edge
  ["f70v2", [[167, 104], [3540, 90], [3545, 3680], [169, 3666]], 0],
];

async function waitForBoot(page) {
  await page.waitForFunction(() => document.querySelector("#cx-tabs [aria-selected='true']") && typeof Work !== "undefined" && typeof Crops !== "undefined", null, { timeout: 20_000 });
}

/** Build the state, and return what was made (so tests can check it came back) plus the export and the storage dump. */
async function buildScenario(page) {
  await waitForBoot(page);
  // the cookie choice, as a visitor makes it
  await page.locator("#pv-strip button[data-c=denied]").first().click().catch(() => {});

  // Reader settings, with the buttons a visitor uses
  await page.locator("#cx-tabs button[data-view=read]").click();
  await page.waitForSelector("#rd-where");
  await page.locator("#rd-labels").click();
  await page.locator("#rd-scribes").click();
  await page.locator("#rd-ghosts").click();

  // bookmarks and crops, through the site's own functions
  await page.evaluate(marks => { for (const [pg, name] of marks) Bookmarks.add(pg, name || undefined); }, BOOKMARKS);
  for (const [key, rotate] of CROPS) {
    await page.evaluate(async ([key, rotate]) => {
      const q = Crops.base.get(key).quad;
      const inset = [[30, 30], [-30, 30], [-30, -30], [30, -30]];
      await Crops.save(key, q.map(([x, y], i) => [x + inset[i][0], y + inset[i][1]]), rotate);
    }, [key, rotate]);
  }

  const legacy = [];
  for (const [key, quad, rotate] of LEGACY_CROPS) {
    const made = await page.evaluate(async ([key, quad, rotate]) => {
      if (!Crops.base.has(key)) return false;
      await Crops.save(key, quad, rotate);
      return true;
    }, [key, quad, rotate]);
    if (made) legacy.push(key);
  }

  // 3D: settings, then two orders of the visitor's own
  await page.locator("#cx-tabs button[data-view=three]").click();
  await page.waitForFunction(() => typeof View3D !== "undefined" && View3D.mod?.debug?.V?.built, null, { timeout: 20_000 });
  await page.locator("#v3-hint button").click().catch(() => {});      // "Got it"
  for (const key of ["p", "]", "v"]) await page.keyboard.press(key);   // standing/lying, spread, colour the edges

  const own = await page.evaluate(async () => {
    const ids = [];
    // 1. a copy of the current binding, rearranged in every way the panel allows
    setOrder("beinecke");
    Arrange.edit(() => {}, { ms: 0 });                                  // the first change makes the copy
    Arrange.move("1|8", 0, 4);                                           // a sheet to another place
    Arrange.setType(1, "singulions");                                    // a quire read as separate sheets
    Arrange.setOpt("9|16", "inside_out", true);
    Arrange.setOpt("10|15", "rot180", true);
    Arrange.setOpt("67|68", "spine", 2);                                 // sewn at another fold
    Arrange.newGathering("33|40");                                       // a new gathering, named by the site
    Arrange.move("105|114", -1, 0);                                      // a sheet set aside
    MyOrders.put({ ...ORDERS.get(S.order), title: "Alina’s own order" });
    ids.push(S.order);
    // 2. a copy of the Davis order, with a gathering moved, and one hidden in 3D
    setOrder("davis");
    Arrange.edit(() => {}, { ms: 0 });
    Arrange.moveGathering(0, 1);
    ids.push(S.order);
    return ids;
  });
  // 3D takes a moment to switch to the new order; hide a gathering only once it has, so it is saved for this order
  await page.waitForFunction(id => View3D.mod.debug.V.order?.id === id, own[1], { timeout: 15_000 });
  await page.evaluate(id => View3D.mod.setHidden(ORDERS.get(id).gatherings[2].quire, true, { quiet: true }), own[1]);
  // the first order is the one she was looking at last
  await page.evaluate(id => setOrder(id), own[0]);
  await page.waitForFunction(id => View3D.mod.debug.V.order?.id === id, own[0], { timeout: 15_000 });
  await page.waitForTimeout(300);

  const progress = await exportProgress(page);
  await page.keyboard.press("Escape");
  const storage = await dumpStorage(page);
  const meta = {
    orders: own.length, bookmarks: BOOKMARKS.length, crops: CROPS.length + legacy.length,
    orderIds: own, currentOrder: own[0], bookmarkPages: BOOKMARKS.map(b => b[0]), cropKeys: [...CROPS.map(c => c[0]), ...legacy],
  };
  return { progress, storage, meta };
}

module.exports = { buildScenario, waitForBoot, BOOKMARKS, CROPS, LEGACY_CROPS };
