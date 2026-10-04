// A folded foldout in the Reader is a leaf like any other: the panel at the spine on each face (r1 / v1), one page to flip
// to, not one for every panel. The panels inside the folds are on show only when it is unfolded, and a page that is
// inside a fold (Go to 70v2, a link, a bookmark) is shown by unfolding the page it folds into.
const { test, expect, openSite, readerPicturesLoaded, readerState } = require("./fixtures");
const fs = require("fs");
const path = require("path");

const openReader = (page, at = "") => openSite(page, `#read/beinecke${at ? "/" + at : ""}`);
const where = page => page.locator("#rd-where");
const panelsOnShow = page => page.evaluate(() => [...document.querySelectorAll("#rd-zoomer .seg")].map(el => el.title));
const unfolded = page => page.evaluate(() => [R.unfold.L, R.unfold.R]);

test.describe("folded foldouts", () => {
  test("quire 9 reads 66v | 67r1, 67v1 | 68r1, 68v1 | 69r: each leaf is two pages, not one per panel", async ({ page }) => {
    await openReader(page);
    const seen = [];
    for (const k of [66, 67, 68]) {
      await page.evaluate(k => Reader.go(k, 0), k);
      seen.push((await where(page).innerText()).replace(/\s+/g, " "));
    }
    expect(seen).toEqual(["f66v | f67r1", "f67v1 | f68r1", "f68v1 | f69r"]);
  });

  test("every page side of every foldout shows its spine panel folded (the Rosettes keep their sourced reading)", async ({ page }) => {
    await openReader(page);
    const wrong = await page.evaluate(() => R.pages
      .filter(p => p.segs.length > 1 && !p.grid)
      .filter(p => p.shown !== p.segs[p.hinge === "left" ? 0 : p.segs.length - 1])
      .map(p => `${p.sheet} ${sideLabel(p)}`));
    expect(wrong, "pages that show a panel from inside a fold").toEqual([]);
    const folds = await page.evaluate(() => R.pages.filter(p => p.segs.length > 1 && !p.grid).length);
    expect(folds, "the book has foldouts that unfold in place").toBeGreaterThan(8);
    // the Rosettes: 84v | 85r1, 85r2 | 86v5, 86v3 | 87r, as voynich.nu reads them
    const ros = [];
    for (const k of [84, 85, 86]) {
      await page.evaluate(k => Reader.go(k, 0), k);
      ros.push((await where(page).innerText()).replace(/\s+/g, " "));
    }
    expect(ros).toEqual(["f84v | f85r1", "f85r2 | f86v5", "f86v3 | f87r"]);
  });

  test("folded, only the spine panels are on show; Unfold brings in the panels inside the folds, and Fold sends them back", async ({ page }) => {
    await openReader(page);
    await page.evaluate(() => Reader.go(67, 0));
    await readerPicturesLoaded(page);
    expect(await panelsOnShow(page)).toEqual(["f67v1", "f68r1"]);
    await page.keyboard.press("u");
    await expect.poll(() => unfolded(page)).toEqual([true, true]);
    expect(await panelsOnShow(page)).toEqual(["f67v2", "f67v1", "f68r1", "f68r2", "f68r3"]);
    await page.keyboard.press("u");
    await expect.poll(() => unfolded(page)).toEqual([false, false]);
    expect(await panelsOnShow(page)).toEqual(["f67v1", "f68r1"]);
  });

  test("the folded centre of quire 9 is the pair the note says it is sewn between", async ({ page }) => {
    await openReader(page);
    await page.evaluate(() => Reader.go(67, 0));
    await expect(page.locator("#rd-note")).toContainText("fold between 67v1 and 68r1");
    await expect(where(page)).toContainText("f67v1");
    await expect(where(page)).toContainText("f68r1");
  });

  test("3D keeps the roll-fold: the book's own page list still reads 67r2 | 68v2 where the Reader reads 67v1 | 68r1", async ({ page }) => {
    await openReader(page);
    const labels = await page.evaluate(() => ({
      physical: linearize(ORDERS.get("beinecke"), { ghosts: false }).map(sideLabel),
      reader: R.pages.filter(p => !p.lost).map(sideLabel),
    }));
    expect(labels.physical).toContain("f67r2");
    expect(labels.reader).not.toContain("f67r2");
    expect(labels.reader).toContain("f67v1");
    expect(labels.reader.length, "the same number of pages, whichever way they are read").toBe(labels.physical.length);
  });
});

test.describe("a page inside a fold", () => {
  const settled = page => page.evaluate(async () => { const t0 = performance.now(); while ((R.busy || R.queue.length) && performance.now() - t0 < 8000) await new Promise(r => setTimeout(r, 30)); });

  test("Go to a flap opens its opening with the page it folds into unfolded, so the flap is on show", async ({ page }) => {
    await openReader(page, "30r");
    for (const [name, panel, side] of [["70v2", "f70v2 (1)", 0], ["67r2", "f67r2", 1], ["89v2", "f89v2", 0]]) {
      await page.evaluate(n => Reader.go(Reader.find(n), 0, n), name);
      await settled(page);
      await readerPicturesLoaded(page);
      expect(await panelsOnShow(page), `Go to ${name}`).toContain(panel);
      expect((await unfolded(page))[side], `${name}: the side that folds it`).toBe(true);
    }
  });

  test("Go to a page that is on show folded does not unfold anything", async ({ page }) => {
    await openReader(page, "30r");
    for (const name of ["78v", "67r1", "101v"]) {
      await page.evaluate(n => Reader.go(Reader.find(n), 0, n), name);
      await settled(page);
      expect(await unfolded(page), `Go to ${name}`).toEqual([false, false]);
    }
  });

  test("the address names the flap while its fold is open, and opening it unfolds the same fold", async ({ page }) => {
    await openReader(page, "70v2");
    await readerPicturesLoaded(page);
    expect(await panelsOnShow(page)).toContain("f70v2 (1)");
    expect((await readerState(page)).hash).toBe("#read/beinecke/70v2");
    await page.reload();
    await expect.poll(async () => (await panelsOnShow(page)).includes("f70v2 (1)")).toBe(true);
  });

  test("turning on from a revealed flap folds the opening shut, then turns", async ({ page }) => {
    await openReader(page, "70v2");
    const at = (await readerState(page)).at;
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await readerState(page)).at).toBe(at + 1);
    expect(await unfolded(page)).toEqual([false, false]);
  });
});

// The photograph of a foldout's hinge panel is of the bound book, so on the side its flaps hang it shows the stacked edges
// of the book block, which are not part of the foldout. Opened out, the first flap overlaps that strip (data/seams.json).
test.describe("the seam of an opened-out foldout", () => {
  const seams = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/seams.json"), "utf8"));
  const codex = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/codex.json"), "utf8"));

  test("seams.json lists real hinge panels, measured on the crop codex.json has, with a plausible band", () => {
    const segs = new Map(codex.sheets.flatMap(sh => [...sh.inside.flat(), ...sh.outside.flat()]).map(s => [s.img, s]));
    expect(Object.keys(seams.panels).length, "the book has panels with a stack of edges on them").toBeGreaterThan(2);
    for (const [img, r] of Object.entries(seams.panels)) {
      expect(segs.has(img), `${img} is a panel`).toBe(true);
      expect(JSON.stringify(r.q), `${img}: measured on the crop that is in codex.json (re-run tools/seams.py after a re-import)`).toBe(JSON.stringify(segs.get(img).quad));
      expect(["L", "R"], `${img}: side`).toContain(r.side);
      expect(r.band, `${img}: band`).toBeGreaterThan(0.03);
      expect(r.band, `${img}: band`).toBeLessThan(0.25);
    }
  });

  /** For the opening showing `name` unfolded: how far the first flap reaches over its hinge panel, and what is on top there. */
  const overlapAt = async (page, name) => {
    await page.evaluate(n => Reader.go(Reader.find(n), 0), name);
    await page.evaluate(() => Reader.toggleUnfold());
    await readerPicturesLoaded(page);
    return page.evaluate(() => {
      for (const pg of document.querySelectorAll("#rd-zoomer .rd-page")) {
        const segs = [...pg.querySelectorAll(":scope > .seg")];
        if (segs.length < 2) continue;
        const left = pg.classList.contains("left");
        const hinge = left ? segs.at(-1) : segs[0], flap = left ? segs.at(-2) : segs[1];
        const h = hinge.getBoundingClientRect(), f = flap.getBoundingClientRect();
        const reach = left ? f.right - h.left : h.right - f.left;
        const probe = left ? [h.left + reach / 2, h.top + h.height / 2] : [h.right - reach / 2, h.top + h.height / 2];
        const top = reach > 1 ? document.elementFromPoint(...probe) : null;
        return { reach: Math.round(reach), hingeW: Math.round(h.width), flapOnTop: !!top && flap.contains(top), hinge: hinge.title, flap: flap.title };
      }
    });
  };

  test("f70v1 and f72v1: the flap overlaps the strip of page edges, and is the one on top there", async ({ page }) => {
    await openReader(page);
    for (const [name, img] of [["70v1", "f70v1"], ["72v1", "f72v1"]]) {
      const o = await overlapAt(page, name);
      expect(o.hinge, name).toBe(img);
      expect(o.reach / o.hingeW, `${img}: how much of the hinge panel the flap covers`).toBeCloseTo(seams.panels[img].band, 1);
      expect(o.flapOnTop, `${img}: what is on top in the overlap`).toBe(true);
    }
  });

  test("a foldout whose hinge photograph is clean opens flat, edge to edge", async ({ page }) => {
    await openReader(page);
    for (const name of ["67v1", "68r1", "89v1"]) {
      const o = await overlapAt(page, name);
      expect(o.reach, `${name} (${o.hinge} / ${o.flap})`).toBeLessThanOrEqual(1);
    }
  });

  test("folded, the hinge panel is the whole photograph, fore-edge and all", async ({ page }) => {
    await openReader(page);
    await page.evaluate(() => Reader.go(Reader.find("70v1"), 0));
    await readerPicturesLoaded(page);
    const m = await page.evaluate(() => [...document.querySelectorAll("#rd-zoomer .seg")].map(el => [el.title, el.style.marginLeft, el.style.marginRight, el.classList.contains("over")]));
    expect(m).toEqual([["f70v1", "", "", false], ["f71r", "", "", false]]);
  });

  test("folding it back and opening it again leaves nothing behind: the same overlap, no stray styles", async ({ page }) => {
    await openReader(page);
    const a = await overlapAt(page, "70v1");
    await page.evaluate(() => Reader.toggleUnfold());
    await expect.poll(() => unfolded(page)).toEqual([false, false]);
    await page.evaluate(() => Reader.toggleUnfold());
    await expect.poll(() => unfolded(page)).toEqual([true, false]);
    const b = await page.evaluate(() => { const segs = [...document.querySelectorAll("#rd-zoomer .rd-page.left > .seg")]; return segs.map(el => [el.title, Math.round(el.getBoundingClientRect().left)]); });
    expect(b.map(x => x[0])).toEqual(["f70v2 (2)", "f70v2 (1)", "f70v1"]);
    expect(a.reach).toBeGreaterThan(20);
  });
});
