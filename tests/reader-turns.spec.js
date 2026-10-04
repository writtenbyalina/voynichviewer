// The Reader's page turns, with the animation ON (the other tests run with reduced motion, which skips it):
// every move to another opening turns a leaf, whatever started it and whatever state the opening was in, and the
// book stays where it is while it turns.
const { test, expect, openSite, readerPicturesLoaded } = require("./fixtures");

test.use({ reducedMotion: "no-preference" });

/** Put a recorder in the page: while it runs, every animation frame notes where the book is and whether a leaf is in the air. */
async function recorder(page) {
  await page.evaluate(() => {
    const where = () => {
      const g = document.querySelector(".spread .rd-gutter")?.getBoundingClientRect();
      const leaf = document.querySelector(".spread .turn");
      const imgs = leaf ? [...leaf.querySelectorAll("img")] : [];
      return g && { gutter: g.left, top: g.top, height: g.height, leaf: !!leaf, blank: imgs.some(i => !i.complete || !i.naturalWidth), unfolded: R.unfold.L || R.unfold.R };
    };
    // Leaves are counted as they are added to the page, not by frames: a busy machine can skip frames (the 3D view's
    // software GL does), and a frame sampler would then miss a leaf that was there, or merge two turns that ran back to back.
    window.__turned = 0;
    new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains("turn")) __turned++; })
      .observe(document.querySelector("#rd-zoomer"), { childList: true, subtree: true });
    window.__frames = [];
    window.__run = false;
    window.__rec = () => { __frames = []; __turned = 0; __run = true; const tick = () => { if (!__run) return; const w = where(); if (w) __frames.push(w); requestAnimationFrame(tick); }; requestAnimationFrame(tick); };
    window.__end = () => { __run = false; return __frames; };
    window.__idle = async () => { const t0 = performance.now(); while ((R.busy || R.queue.length) && performance.now() - t0 < 8000) await new Promise(r => setTimeout(r, 30)); await new Promise(r => setTimeout(r, 60)); };
    window.__leaves = () => __turned;
  });
}

const openReader = async (page, at = "") => {
  await openSite(page, `#read/beinecke${at ? "/" + at : ""}`);
  await page.waitForFunction(() => typeof R !== "undefined" && R.spreads && document.querySelector("#rd-zoomer .spread"));
  await readerPicturesLoaded(page);
  await recorder(page);
};

test.describe("page turns", () => {
  test("every step turns a leaf, and the gutter, the top and the page height stay put while it turns", async ({ page }) => {
    test.setTimeout(120_000);
    await openReader(page);
    // the cover, an ordinary stretch, the neighbourhood of the one wide page (f89v2), a lost leaf, and the back cover
    const stretches = [[0, 6], [56, 62], [85, 92], [110, 116]];
    const problems = [];
    const sizes = [];
    for (const [from, to] of stretches) {
      await page.evaluate(k => Reader.go(k, 0, null, true), from);
      await page.evaluate(() => __idle());
      for (let k = from; k < to; k++) {
        const r = await page.evaluate(async () => {
          __rec(); Reader.step(1); await __idle();
          const frames = __end();
          return { at: R.at, leaves: __leaves(frames), blank: frames.some(f => f.leaf && f.blank), last: frames.at(-1),
            moved: Math.max(...frames.map(f => f.gutter)) - Math.min(...frames.map(f => f.gutter)) };
        });
        if (r.at !== k + 1) problems.push(`step from ${k}: ended on ${r.at}`);
        if (r.leaves !== 1) problems.push(`step to ${k + 1}: ${r.leaves} leaves`);
        if (r.blank) problems.push(`step to ${k + 1}: the leaf had a blank face`);
        if (r.moved > 1) problems.push(`step to ${k + 1}: the gutter moved ${r.moved.toFixed(1)}px while turning`);
        sizes.push(r.last);
      }
    }
    expect(problems).toEqual([]);
    const gutters = new Set(sizes.map(s => Math.round(s.gutter)));
    expect([...gutters], "the gutter is in the same place on every opening").toHaveLength(1);
    const hs = sizes.map(s => s.height), tallest = Math.max(...hs), shortest = Math.min(...hs);
    expect(shortest / tallest, "page height varies by no more than the one wide opening needs").toBeGreaterThan(0.96);
  });

  test("going back turns a leaf the other way", async ({ page }) => {
    await openReader(page, "40v");
    const r = await page.evaluate(async () => {
      const from = R.at; __rec(); Reader.step(-1); await __idle(); const frames = __end();
      return { from, at: R.at, leaves: __leaves(frames) };
    });
    expect(r.at).toBe(r.from - 1);
    expect(r.leaves).toBe(1);
  });

  test("a jump (Home, End, the strip, Go to) turns a leaf too", async ({ page }) => {
    test.setTimeout(60_000);
    await openReader(page, "30r");
    const leafAfter = async action => page.evaluate(async action => {
      const from = R.at; __rec(); action === "home" ? document.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
        : action === "end" ? document.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
        : action === "strip" ? document.querySelectorAll("#rd-strip .t")[90].click()
        : Reader.go(Reader.find("78v"), 0, "78v");
      await __idle(); const frames = __end();
      return { from, at: R.at, leaves: __leaves(frames), where: document.querySelector("#rd-where").textContent };
    }, action);
    const home = await leafAfter("home");
    expect([home.at, home.leaves], "Home").toEqual([0, 1]);
    const end = await leafAfter("end");
    expect(end.leaves, "End").toBe(1);
    expect(end.at).toBe(await page.evaluate(() => R.spreads.length - 1));
    const strip = await leafAfter("strip");
    expect([strip.at, strip.leaves], "a tick in the strip").toEqual([45, 1]);
    const go = await leafAfter("goto");
    expect(go.leaves, "Go to").toBe(1);
    expect(go.where).toContain("f78v");
  });

  test("an unfolded foldout folds shut where it stands, then the leaf turns", async ({ page }) => {
    test.setTimeout(60_000);
    await openReader(page);
    const r = await page.evaluate(async () => {
      const k = R.spreads.findIndex(sp => sp.some(p => p && !p.lost && p.segs.length > 1 && !p.grid) && !sp.some(p => p && p.grid));
      Reader.go(k, 0, null, true); await __idle();
      Reader.toggleUnfold(); await __idle();
      const open = R.unfold.L || R.unfold.R;
      __rec(); Reader.step(1); await __idle(); const frames = __end();
      const firstLeaf = frames.findIndex(f => f.leaf);
      return { k, at: R.at, open, unfolded: R.unfold.L || R.unfold.R, leaves: __leaves(frames), shutFirst: frames.slice(0, Math.max(firstLeaf, 1)).some(f => f.unfolded),
        gutters: [...new Set(frames.map(f => Math.round(f.gutter)))] };
    });
    expect(r.open, "the foldout was open").toBe(true);
    expect(r.at).toBe(r.k + 1);
    expect(r.unfolded).toBe(false);
    expect(r.shutFirst, "it folded shut before the leaf lifted").toBe(true);
    expect(r.leaves).toBe(1);
    expect(r.gutters, "the gutter did not move while it folded and turned").toHaveLength(1);
  });

  test("zoomed in on a spot, the view eases out and the leaf turns", async ({ page }) => {
    await openReader(page, "78v");
    const r = await page.evaluate(async () => {
      Reader.zoomAt(2.5, 500, 300);
      __rec(); Reader.step(1); await __idle(); const frames = __end();
      return { zoom: R.zoom, leaves: __leaves(frames) };
    });
    expect(r.zoom).toBe(1);
    expect(r.leaves).toBe(1);
  });

  test("presses made while a leaf is turning are not dropped, and a held key turns the pages one by one", async ({ page }) => {
    test.setTimeout(60_000);
    await openReader(page, "30r");
    const quick = await page.evaluate(async () => {
      const from = R.at; __rec();
      for (let i = 0; i < 4; i++) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await new Promise(r => setTimeout(r, 90)); }
      await __idle(); const frames = __end();
      return { moved: R.at - from, leaves: __leaves(frames) };
    });
    expect(quick, "four quick presses").toEqual({ moved: 4, leaves: 4 });
    const held = await page.evaluate(async () => {
      const from = R.at; __rec();
      const t0 = performance.now();
      while (performance.now() - t0 < 1800) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", repeat: true, bubbles: true })); await new Promise(r => setTimeout(r, 33)); }
      await __idle(); const frames = __end();
      return { moved: R.at - from, leaves: __leaves(frames) };
    });
    expect(held.moved, "every page the held key turned showed a leaf").toBe(held.leaves);
    expect(held.moved).toBeGreaterThanOrEqual(2);
  });

  test("a window resize while the leaf is in the air does not take it away", async ({ page }) => {
    await openReader(page, "30r");
    await page.evaluate(() => Reader.step(1));
    await expect.poll(() => page.evaluate(() => !!document.querySelector(".spread .turn"))).toBe(true);
    await page.setViewportSize({ width: 1200, height: 760 });
    expect(await page.evaluate(() => !!document.querySelector(".spread .turn")), "the leaf is still turning").toBe(true);
    await page.evaluate(() => __idle());
    expect(await page.evaluate(() => ({ busy: R.busy, leaves: document.querySelectorAll(".turn").length, spreads: document.querySelectorAll(".spread").length }))).toEqual({ busy: false, leaves: 0, spreads: 1 });
  });

  test("the leaf does not lift until the pictures are ready, even when they are slow", async ({ page }) => {
    test.setTimeout(60_000);
    await openReader(page, "10r");
    let slowed = 0;
    await page.route(url => /data\/panels\/.*_l\.jpg/.test(url.toString()), async route => { slowed++; await new Promise(r => setTimeout(r, 600)); route.continue(); });
    const r = await page.evaluate(async () => {
      const k = Reader.find("78v");   // two pages with pictures (opening 60, say, is a pair of lost leaves with none)
      __rec(); Reader.go(k, 0); await __idle(); const frames = __end();
      return { k, at: R.at, leaves: __leaves(frames), blank: frames.filter(f => f.leaf && f.blank).length };
    });
    expect(slowed, "the pictures really were slowed").toBeGreaterThan(0);
    expect(r.at).toBe(r.k);
    expect(r.leaves).toBe(1);
    expect(r.blank, "frames of the leaf with a blank face").toBe(0);
  });
});
