// The Reader: turning pages, zoom, foldouts, Go to, the grid, bookmarks.
// Several of these are regression tests for bugs listed as fixed in data/changelog.json: if one comes back, a test fails.
const { test, expect, openSite, goTo, readerState, readerPicturesLoaded, cutOffPages } = require("./fixtures");
const fs = require("fs");
const path = require("path");

const orders = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/orders.json"), "utf8")).orders;

const openReader = (page, at = "") => openSite(page, `#read/beinecke${at ? "/" + at : ""}`);
const zoomText = page => page.locator("#rd-zoomlvl");
const toast = page => page.locator("#cx-toast");

test.describe("turning pages", () => {
  test("opens on the front cover with its picture loaded", async ({ page }) => {
    await openReader(page);
    await readerPicturesLoaded(page);
    const s = await readerState(page);
    expect(s.where).toBe("f1r");
    expect(s.meta).toMatch(/opening 1 of \d+/);
    expect(s.openings).toBeGreaterThan(50);
  });

  test("arrow keys, the buttons, Home and End turn the pages, and stop at both covers", async ({ page }) => {
    await openReader(page);
    const at = async () => (await readerState(page)).at;
    await page.keyboard.press("ArrowRight");
    await expect.poll(at).toBe(1);
    await page.locator("#rd-next").click();
    await expect.poll(at).toBe(2);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(at).toBe(1);
    await page.locator("#rd-prev").click();
    await expect.poll(at).toBe(0);
    await page.keyboard.press("ArrowLeft");   // already at the first page
    await expect.poll(at).toBe(0);
    await page.keyboard.press("End");
    const last = (await readerState(page)).openings - 1;
    await expect.poll(at).toBe(last);
    await page.keyboard.press("ArrowRight");  // already at the last page
    await expect.poll(at).toBe(last);
    await page.keyboard.press("Home");
    await expect.poll(at).toBe(0);
    await readerPicturesLoaded(page);
  });

  test("the address follows the page, and opening that address lands on the same page", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await readerState(page)).at).toBe(2);
    const s = await readerState(page);
    expect(s.hash).toMatch(/^#read\/beinecke\/.+/);
    await page.goto("/index.html" + s.hash);
    await page.reload();
    await expect(page.locator("#rd-where")).toHaveText(s.where);
  });

  test("the strip of ticks shows every page, and clicking a tick goes there", async ({ page }) => {
    await openReader(page);
    const pages = (await readerState(page)).pages;
    await expect(page.locator("#rd-strip .t")).toHaveCount(pages);
    await page.locator("#rd-strip .t").nth(40).click();
    await expect.poll(async () => (await readerState(page)).at).toBe(20);   // page 40 is on the 20th opening after the cover
  });

  test.describe("with animation on", () => {
    test.use({ reducedMotion: "no-preference" });   // the page-turn and unfold animations are separate code from the plain redraw

    test("turning and unfolding animate to the right place without errors", async ({ page }) => {
      await openReader(page);
      const k = await page.evaluate(() => R.spreads.findIndex(sp => sp.some(p => p && !p.lost && p.segs.length > 1 && !p.grid) && !sp.some(p => p && p.grid)));
      await page.evaluate(k => Reader.go(k, 0), k);
      await readerPicturesLoaded(page);
      const before = await readerState(page);
      const idle = () => expect.poll(() => page.evaluate(() => R.busy), { message: "the animation should finish", timeout: 10_000 }).toBe(false);
      await page.keyboard.press("ArrowRight");
      await idle();
      expect((await readerState(page)).at).toBe(before.at + 1);
      await expect(page.locator("#rd-where")).not.toHaveText(before.where);
      await readerPicturesLoaded(page);
      await page.keyboard.press("ArrowLeft");
      await idle();
      expect((await readerState(page)).at).toBe(before.at);
      await expect(page.locator("#rd-where")).toHaveText(before.where);
      await page.keyboard.press("u");
      await idle();
      expect((await readerState(page)).unfolded).toBe(true);
      await readerPicturesLoaded(page);
      await page.keyboard.press("u");
      await idle();
      expect((await readerState(page)).unfolded).toBe(false);
      expect(await cutOffPages(page), "pages cut off after the animation").toEqual([]);
    });
  });
});

test.describe("the whole book, opening by opening", () => {
  // One test per order: Home, then → to the end. At every opening the pictures must load, the page labels must show,
  // and no page may be cut off by the edge of the stage (the f70r2 bug in 1.1). Any error on any opening fails it.
  for (const o of orders) {
    test(`order "${o.id}": every opening shows whole pages with working pictures`, async ({ page }) => {
      test.setTimeout(120_000);
      await openSite(page, `#read/${o.id}`);
      await page.keyboard.press("Home");
      const { openings } = await readerState(page);
      expect(openings).toBeGreaterThan(50);
      const problems = [];
      for (let i = 0; i < openings; i++) {
        await expect.poll(async () => (await readerState(page)).at, { message: `turning to opening ${i + 1}` }).toBe(i);
        await page.waitForFunction(() => {
          const imgs = [...document.querySelectorAll("#rd-zoomer img")];
          return imgs.every(img => img.complete);
        }, null, { timeout: 15_000 });
        const s = await readerState(page);
        const broken = await page.evaluate(() => [...document.querySelectorAll("#rd-zoomer img")].filter(i => i.naturalWidth === 0).map(i => i.alt || i.src));
        const cut = await cutOffPages(page);
        if (!s.where || s.where === "—") problems.push(`opening ${i + 1}: no page label`);
        if (broken.length) problems.push(`opening ${i + 1} (${s.where}): broken picture ${broken.join(", ")}`);
        if (cut.length) problems.push(`opening ${i + 1} (${s.where}): ${cut.join("; ")}`);
        if (i < openings - 1) await page.keyboard.press("ArrowRight");
      }
      expect(problems).toEqual([]);
    });
  }
});

test.describe("zoom", () => {
  test("+ and − step the zoom, 0 puts it back, and it never goes past its limits", async ({ page }) => {
    await openReader(page, "78v");
    await expect(zoomText(page)).toHaveText("100%");
    await page.keyboard.press("+");
    await expect(zoomText(page)).toHaveText("150%");
    await page.keyboard.press("0");
    await expect(zoomText(page)).toHaveText("100%");
    for (let i = 0; i < 8; i++) await page.keyboard.press("+");
    await expect(zoomText(page), "zoom in stops at 500%").toHaveText("500%");
    await page.keyboard.press("0");
    await page.locator("button[aria-label='Zoom in']").click();
    await expect(zoomText(page)).toHaveText("150%");
    await page.locator("button[aria-label='Zoom out']").click();
    await expect(zoomText(page)).toHaveText("100%");
  });

  test("1.1 fix: zoom can go out to 30%, no further, and stays out as you turn the pages", async ({ page }) => {
    await openReader(page, "78v");
    for (let i = 0; i < 6; i++) await page.keyboard.press("-");
    await expect(zoomText(page), "zoom out stops at 30%").toHaveText("30%");
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await readerState(page)).where).not.toContain("f78v");
    await expect(zoomText(page), "zoomed out stays zoomed out on the next opening").toHaveText("30%");
    await page.keyboard.press("0");
    await expect(zoomText(page)).toHaveText("100%");
  });

  test("zoomed in on a spot, the next opening starts whole", async ({ page }) => {
    await openReader(page, "78v");
    await page.keyboard.press("+");
    await expect(zoomText(page)).toHaveText("150%");
    await page.keyboard.press("ArrowRight");
    await expect(zoomText(page)).toHaveText("100%");
  });

  test("1.1 fix: the zoom buttons do not cover the bottom of the pages", async ({ page }) => {
    await openReader(page, "78v");
    await readerPicturesLoaded(page);
    const overlap = await page.evaluate(() => {
      const bar = document.querySelector(".rd-zoombar").getBoundingClientRect();
      return [...document.querySelectorAll("#rd-zoomer .seg")].map(el => {
        const r = el.getBoundingClientRect();
        const x = Math.min(r.right, bar.right) - Math.max(r.left, bar.left), y = Math.min(r.bottom, bar.bottom) - Math.max(r.top, bar.top);
        return x > 1 && y > 1 ? `${el.title}: ${Math.round(y)}px` : null;
      }).filter(Boolean);
    });
    expect(overlap).toEqual([]);
  });
});

test.describe("Go to a folio", () => {
  const ask = async page => {
    await page.keyboard.press("g");
    const d = page.locator("dialog.ask");
    await expect(d).toBeVisible();
    // The box takes focus and selects its text a moment (20 ms) after it opens; the "g" that opened it lands in the box and
    // is selected, so the next key replaces it. A person never notices; a test typing at once would, so wait for it.
    await expect.poll(() => page.evaluate(() => {
      const i = document.querySelector("dialog.ask input");
      return !!i && i === document.activeElement && i.selectionStart === 0 && i.selectionEnd === i.value.length;
    })).toBe(true);
    return d;
  };

  test("a folio name takes you there; so does a bare folio number", async ({ page }) => {
    await openReader(page);
    let d = await ask(page);
    await page.keyboard.type("78v");
    await page.keyboard.press("Enter");
    await expect(d).toHaveCount(0);
    await expect(page.locator("#rd-where")).toContainText("f78v");
    d = await ask(page);
    await page.keyboard.type("105");
    await page.keyboard.press("Enter");
    await expect(page.locator("#rd-where")).toContainText("f105r");
    await readerPicturesLoaded(page);
  });

  test("a page that is not in the book says so, and Escape leaves things where they were", async ({ page }) => {
    await openReader(page, "78v");
    let d = await ask(page);
    await page.keyboard.type("zzz");
    await page.keyboard.press("Enter");
    await expect(toast(page)).toContainText("No page zzz");
    await expect(page.locator("#rd-where")).toContainText("f78v");
    d = await ask(page);
    await page.keyboard.type("1r");
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.ask")).toHaveCount(0);
    await expect(page.locator("#rd-where")).toContainText("f78v");
  });

  test("1.1 fix: Go to and links for 70v2 and 101v open the opening where that page shows", async ({ page }) => {
    for (const [name, label] of [["70v2", "f70v2"], ["101v", "f101v"]]) {
      await openReader(page, name);
      await expect(page.locator("#rd-where"), `#read/beinecke/${name}`).toContainText(label);
      await page.keyboard.press("Home");
      await ask(page);
      await page.keyboard.type(name);
      await page.keyboard.press("Enter");
      await expect(page.locator("#rd-where"), `Go to ${name}`).toContainText(label);
    }
  });
});

test.describe("foldouts", () => {
  /** The first opening where a page unfolds in place (not one that opens the sheet viewer instead). */
  const findFoldout = page => page.evaluate(() => R.spreads.findIndex(sp =>
    sp.some(p => p && !p.lost && p.segs.length > 1 && !p.grid) && !sp.some(p => p && p.grid)));

  test("U unfolds a foldout into more panels, and U again folds it back", async ({ page }) => {
    await openReader(page);
    const k = await findFoldout(page);
    expect(k, "the book should have at least one foldout that unfolds in place").toBeGreaterThan(0);
    await page.evaluate(k => Reader.go(k, 0), k);
    await readerPicturesLoaded(page);
    const folded = await page.locator("#rd-zoomer .seg").count();
    await page.keyboard.press("u");
    await expect.poll(async () => (await readerState(page)).unfolded).toBe(true);
    await readerPicturesLoaded(page);
    expect(await page.locator("#rd-zoomer .seg").count(), "unfolding shows more panels").toBeGreaterThan(folded);
    expect(await cutOffPages(page), "unfolded pages cut off").toEqual([]);
    await page.keyboard.press("u");
    await expect.poll(async () => (await readerState(page)).unfolded).toBe(false);
    expect(await page.locator("#rd-zoomer .seg").count()).toBe(folded);
  });

  test("turning the page folds an unfolded opening", async ({ page }) => {
    await openReader(page);
    await page.evaluate(async () => Reader.go(R.spreads.findIndex(sp => sp.some(p => p && !p.lost && p.segs.length > 1 && !p.grid)), 0));
    await page.keyboard.press("u");
    await expect.poll(async () => (await readerState(page)).unfolded).toBe(true);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await readerState(page)).unfolded).toBe(false);
  });

  test("1.1 fix: f70v2 (Pisces) is a page of normal width, and its flap opens with Unfold", async ({ page }) => {
    await openReader(page, "70v2");
    await readerPicturesLoaded(page);
    const width = await page.evaluate(() => {
      const segs = [...document.querySelectorAll("#rd-zoomer .seg")].map(el => ({ title: el.title, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
      return segs;
    });
    for (const s of width) expect(s.w / s.h, `${s.title} should be about page-shaped, not a wide strip`).toBeLessThan(1.1);
    await page.keyboard.press("u");
    await expect.poll(async () => (await readerState(page)).unfolded).toBe(true);
  });

  test("an opening with a folded sheet shows the sheet viewer on U, and Escape closes it", async ({ page }) => {
    await openReader(page);
    const k = await page.evaluate(() => R.spreads.findIndex(sp => sp.some(p => p && p.grid)));
    expect(k, "the book should have a sheet that opens in the sheet viewer").toBeGreaterThan(0);
    await page.evaluate(k => Reader.go(k, 0), k);
    await page.keyboard.press("u");
    await expect(page.locator("#sheet-dlg")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => [...document.querySelectorAll("#sheet-dlg img")].every(i => i.complete && i.naturalWidth > 0))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("#sheet-dlg")).toBeHidden();
  });

  test("on an opening with nothing folded, U says so", async ({ page }) => {
    await openReader(page, "78v");
    await page.keyboard.press("u");
    await expect(toast(page)).toContainText("Nothing folded");
  });
});

test.describe("notes under the pages", () => {
  test("1.1 fix: a long note has a 'more' link that shows the whole note", async ({ page }) => {
    await openReader(page);
    // find an opening whose note is cut off, as a reader would by turning pages
    const n = (await readerState(page)).openings;
    let found = -1;
    for (let k = 0; k < n && found < 0; k++) {
      await page.evaluate(k => Reader.go(k, 0), k);
      if (await page.locator("#rd-more").isVisible()) found = k;
    }
    expect(found, "somewhere in the book a note should be long enough to need 'more'").toBeGreaterThanOrEqual(0);
    await page.locator("#rd-more").click();
    await expect(page.locator("#rd-notepop")).toBeVisible();
    await expect(page.locator("#rd-more")).toHaveAttribute("aria-expanded", "true");
    const full = (await page.locator("#rd-notepop").innerText()).length;
    const shown = (await page.locator("#rd-note").innerText()).length;
    expect(full, "the panel holds the whole note").toBeGreaterThanOrEqual(shown);
    await page.keyboard.press("Escape");
    await expect(page.locator("#rd-notepop")).toBeHidden();
  });
});

test.describe("the grid of every page", () => {
  test("O shows every page quire by quire; clicking one opens it; O or Escape closes the grid", async ({ page }) => {
    await openReader(page);
    const { pages } = await readerState(page);
    const gatherings = await page.evaluate(() => R.order.gatherings.length);
    await page.keyboard.press("o");
    const grid = page.locator("#rd-grid");
    await expect(grid).toBeVisible();
    await expect(page.locator("#rd-stage")).toBeHidden();
    await expect(grid.locator(".rg-q")).toHaveCount(gatherings);
    await expect(grid.locator(".rg-cell")).toHaveCount(pages);
    expect(await page.evaluate(() => [...document.querySelectorAll("#rd-grid img")].filter(i => i.complete && i.naturalWidth === 0).length), "broken thumbnails").toBe(0);

    await grid.locator(".rg-cell:not(.lost)").nth(120).click();
    await expect(grid).toBeHidden();
    await expect(page.locator("#rd-stage")).toBeVisible();
    await readerPicturesLoaded(page);
    expect((await readerState(page)).at).toBeGreaterThan(40);

    await page.keyboard.press("o");
    await expect(grid).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(grid).toBeHidden();
    await page.keyboard.press("o");
    await page.keyboard.press("o");
    await expect(grid).toBeHidden();
  });

  test("the section buttons scroll the grid, and the grid button works too", async ({ page }) => {
    await openReader(page);
    await page.locator("#rd-gridbtn").click();
    const chips = page.locator("#rd-grid .rg-chip:not(.bm)");
    expect(await chips.count(), "a button for each section").toBeGreaterThan(3);
    for (let i = 0; i < await chips.count(); i++) await chips.nth(i).click();
    await page.locator(".rg-close").click();
    await expect(page.locator("#rd-grid")).toBeHidden();
  });
});

test.describe("toggles", () => {
  test("Labels, Scribes and Lost leaves redraw the page; hiding lost leaves takes the blank pages out", async ({ page }) => {
    await openReader(page, "78v");
    const withLost = (await readerState(page)).pages;
    const labels = page.locator("#rd-zoomer .lbl");
    expect(await labels.count()).toBeGreaterThan(0);
    await page.locator("#rd-labels").click();
    await expect(labels).toHaveCount(0);
    await page.locator("#rd-labels").click();
    expect(await labels.count()).toBeGreaterThan(0);
    await page.locator("#rd-scribes").click();
    await expect(page.locator("#rd-zoomer .scribe").first()).toBeVisible();
    await page.locator("#rd-scribes").click();
    await expect(page.locator("#rd-zoomer .scribe")).toHaveCount(0);
    await page.locator("#rd-ghosts").click();
    await expect.poll(async () => (await readerState(page)).pages).toBeLessThan(withLost);
    await expect(page.locator("#rd-where")).toContainText("f78v");   // you stay on the page you were on
    await page.locator("#rd-ghosts").click();
    await expect.poll(async () => (await readerState(page)).pages).toBe(withLost);
  });

  test("your choices are remembered after a reload", async ({ page }) => {
    await openReader(page, "78v");
    await page.locator("#rd-scribes").click();
    await expect(page.locator("#rd-scribes")).toHaveClass(/\bon\b/);
    await page.reload();
    await expect(page.locator("#rd-scribes")).toHaveClass(/\bon\b/);
  });
});

test.describe("the window", () => {
  test("pages stay whole at different window sizes", async ({ page }) => {
    await openReader(page, "78v");
    for (const [w, h] of [[1360, 860], [1000, 700], [1800, 1000], [800, 600], [1360, 860]]) {
      await page.setViewportSize({ width: w, height: h });
      await expect.poll(() => cutOffPages(page), { message: `pages cut off at ${w}×${h}` }).toEqual([]);
      await readerPicturesLoaded(page);
    }
  });

  test("1.1 fix: the stage and the bar under it keep their size and place on every opening of the book", async ({ page }) => {
    await openReader(page, "78v");
    await readerPicturesLoaded(page);
    const boxes = () => page.evaluate(() => ["#rd-stage", "#rd-foot", "#rd-strip"].map(sel => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return `${sel} top ${Math.round(r.top)} height ${Math.round(r.height)} width ${Math.round(r.width)}`;
    }).join(" · "));
    const first = await boxes();
    const n = (await readerState(page)).openings;
    const moved = [];
    for (let k = 0; k < n; k++) {
      await page.evaluate(k => Reader.go(k, 0), k);
      const now = await boxes();
      if (now !== first) moved.push(`opening ${k + 1} (${(await readerState(page)).where}): ${now}`);
    }
    expect(moved, `the layout should stay as it was on the first opening: ${first}`).toEqual([]);
  });
});
