// "Davis: proposed order" re-sequences only quires 13 and 20, as the 2026 paper does. Every other quire keeps today's sequence
// of sheets, and the viewer must say so wherever it shows the order, so nobody takes that sequence for part of the proposal
// (Davis asked for this in Oct 2026: there are no results for quires 1–8 yet).
const { test, expect, openSite } = require("./fixtures");
const fs = require("fs");
const path = require("path");

const orders = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/orders.json"), "utf8"));
const davis = orders.orders.find(o => o.id === "davis");
const bound = orders.orders.find(o => o.id === "beinecke");

test("only quires 13 and 20 differ from today's sequence, and every other quire of several sheets says it is not a proposal", () => {
  const today = new Map(bound.gatherings.map(g => [g.quire, g.bifolia.join(",")]));
  const resequenced = davis.gatherings.filter(g => g.bifolia.join(",") !== today.get(g.quire)).map(g => g.quire);
  expect(resequenced).toEqual([13, 20]);
  const unmarked = davis.gatherings.filter(g => g.bifolia.length > 1 && ![13, 20].includes(g.quire))
    .filter(g => !/^Today's sequence of sheets, not a proposal/.test(g.note || "")).map(g => g.quire);
  expect(unmarked).toEqual([]);
  for (const q of [1, 2, 3, 4, 5, 6, 7, 8]) expect(davis.gatherings.find(g => g.quire === q).note).toContain("quires 1–8");
  expect(davis.title).toBe("Davis: proposed order");
  expect(davis.subtitle).toContain("only quires 13 and 20");
  expect(davis.summary).toContain("quires 1–8 included");
});

test("the Reader, on Davis's order, says quire 1 is in today's sequence", async ({ page }) => {
  await openSite(page, "#read/davis/1r");
  await expect(page.locator("#rd-note")).toContainText("not a proposal");
});

test("Info says only quires 13 and 20 get a new order of sheets", async ({ page }) => {
  await openSite(page, "#info/davis/orders");
  await expect(page.locator("#info-orders")).toContainText("Only quires 13 and 20 get a new order of sheets");
  await expect(page.locator("#info-orders")).toContainText("quires 1–8 included");
});
