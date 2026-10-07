// Text (docs/text/REDESIGN.md): pointing at words on the page photographs, the word panel, the page text, glyphs,
// comparing with one transcriber, and the Text tab's search, export and saved searches. Needs the test kit
// (tests/fixtures.js). The numbers asserted come from data/text, built by tools/text: a rebuild that changes them should
// change them here too, on purpose.
const { test, expect, openSite } = require("./fixtures");

// Yale's image server, stood in for by a one-pixel photograph (an empty answer would fail to load, and a word's crop
// would then give way to "could not be loaded" while a test looks at it)
const PIXEL = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9mKKKKAP/2Q==", "base64");
const fromYale = r => r.fulfill({ status: 200, contentType: "image/jpeg", body: PIXEL });

const panel = page => page.locator("#rd-text");
const line = (page, id) => page.locator(`#rd-text .ln[data-id="${id}"]`);
const textReady = page => expect(page.locator("#rd-text .tx-page").first()).toBeVisible({ timeout: 15_000 });
const results = page => expect(page.locator("#sx-res .sx-hit, #sx-res .sx-none").first()).toBeVisible({ timeout: 15_000 });
const box = (page, k) => page.locator(`#rd-zoomer .wb[data-k="${k}"]`);

test.describe("the text in the Reader", () => {
  test("opens from a link, puts the words on the photographs, follows the pages, and T closes it", async ({ page }) => {
    await openSite(page, "#read/beinecke/2r/text");
    await textReady(page);
    await expect(page.locator("#rd-textbtn")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#rd-text .tx-page h3")).toHaveText(["1v", "2r"]);
    await expect(line(page, "f2r.2").locator(".t")).toContainText("dorchory chkar s shor cthy cto");
    expect(await page.locator("#rd-zoomer .wb").count(), "words with a place on the photographs").toBeGreaterThan(150);
    await expect(page.locator("#rd-text .tx-foot")).toContainText("voynich.nu");
    await page.keyboard.press("t");
    await expect(panel(page)).toBeHidden();
    await expect(page.locator("#rd-zoomer .wb")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/2r");
    await page.keyboard.press("t");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/2r/text");
  });

  test("an old link without /text still opens the Reader as it did", async ({ page }) => {
    await openSite(page, "#read/beinecke/78v");
    await expect(page.locator("#rd-where")).toHaveText(/78v/);
    await expect(panel(page)).toBeHidden();
  });

  test("pointing at a word on the photograph outlines it, lights it in the text and says what it reads", async ({ page }) => {
    await openSite(page, "#read/beinecke/2r/text");
    await textReady(page);
    await box(page, "f2r|3|0").hover();
    await expect(page.locator("#tx-tip")).toContainText("shaiidy");
    await expect(page.locator("#tx-tip")).toContainText("transcribers differ");
    await expect(box(page, "f2r|3|0")).toHaveClass(/hov/);
    await expect(line(page, "f2r.4").locator(".w").first()).toHaveClass(/lit/);
  });

  test("clicking a word on the photograph opens the word: a crop, its reading, one sentence, the readings", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/2r/text");
    await textReady(page);
    const b = await box(page, "f2r|3|0").boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.locator("#rd-text .tx-where")).toHaveText("2r · line 4 · word 1");
    await expect(page.locator("#rd-text .tx-reading .ev")).toHaveText("shaiidy");
    await expect(page.locator("#rd-text .tx-verdict")).toContainText("Transcribers differ on the first glyph");
    for (const [reading, who] of [["shaiidy", "Claston"], ["soaiidy", "Zandbergen & Landini"], ["chaindy", "Takahashi"]])
      await expect(page.locator("#rd-text .rd", { hasText: who }).first().locator(".r")).toHaveText(reading);
    await expect(page.locator("#rd-text .tx-crop")).toHaveAttribute("src", /collections\.library\.yale\.edu\/iiif\/2\/.+\/\d+,\d+,\d+,\d+\//);
    await expect(box(page, "f2r|3|0")).toHaveClass(/sel/);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/2r/text?w=f2r.4.1");
    await expect.poll(() => page.evaluate(() => R.zoom), "a small word is zoomed to").toBeGreaterThan(1.5);
    await page.keyboard.press("Escape");
    await expect(page.locator("#rd-text .tx-page").first()).toBeVisible();
    await expect(box(page, "f2r|3|0")).not.toHaveClass(/sel/);
  });

  test("a word chosen in the text is chosen on the photograph too; ‹ › step to the next word", async ({ page }) => {
    await openSite(page, "#read/beinecke/2r/text");
    await textReady(page);
    await line(page, "f2r.1").locator(".w").first().click();
    await expect(page.locator("#rd-text .tx-where")).toHaveText("2r · line 1 · word 1");
    await expect(box(page, "f2r|0|0")).toHaveClass(/sel/);
    await page.locator('#rd-text button[aria-label="Next word"]').click();
    await expect(page.locator("#rd-text .tx-where")).toHaveText("2r · line 1 · word 2");
  });

  test("the transcribers' lines are one step deeper, only those who differ", async ({ page }) => {
    await openSite(page, "#read/beinecke/2r/text?w=f2r.4.1");
    await expect(page.locator("#rd-text .tx-where")).toHaveText("2r · line 4 · word 1", { timeout: 15_000 });
    await page.locator("#rd-text .tx-line summary").click();
    const al = page.locator("#rd-text .tx-al");
    await expect(al.locator(".who").first()).toHaveText("Consensus");
    await expect(al).toContainText("Takahashi");
    await expect(al.locator(".x").first()).toBeVisible();
  });

  test("N steps to the words where transcribers disagree; dots mark them, and can be turned off", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text");
    await textReady(page);
    expect(await page.locator("#rd-text .g.d").count()).toBeGreaterThan(3);
    await page.keyboard.press("n");
    await expect(page.locator("#rd-text .tx-verdict")).toContainText(/differ|tie|Nobody/);
    await page.keyboard.press("Escape");
    await page.locator("#rd-text .tx-menu summary").click();
    await page.locator("#rd-text .tx-menu input[type=checkbox]").uncheck();
    await expect(page.locator("#rd-text .g.d")).toHaveCount(0);
  });

  test("a diagram drawn across two panels has its words on each, and every word of it has a box", async ({ page }) => {
    await openSite(page, "#read/beinecke/70r2/text");
    await textReady(page);
    for (const img of ["f70r2-1", "f70r2-2"])
      expect(await page.locator(`#rd-zoomer .seg:has(img[data-key="${img}"]) .wb[data-k^="f70r2|"]`).count(), img).toBeGreaterThan(70);
    await expect(page.locator('#rd-zoomer .wb[data-k^="f70r2|"]')).toHaveCount(239);
  });

  test("a ring running over the cut onto the next page's panel is drawn there, and opens as its own page's word", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/72r2/text?w=f72r2.6.36");
    await expect(page.locator("#rd-text .tx-where")).toHaveText("72r2 · line 6 · word 36", { timeout: 15_000 });
    await expect(page.locator('#rd-zoomer .seg:has(img[data-key="f72r1"]) .wb[data-k="f72r2|5|35"]')).toHaveClass(/sel/);
    await expect(page.locator('#rd-zoomer .wb[data-k^="f72r2|"]')).toHaveCount(108);
    await expect(page.locator("#rd-text .tx-crop")).toHaveAttribute("src", /\/iiif\/2\/1006203\//);
  });

  test("a panel shown upside down, as it is bound, turns its word boxes with it", async ({ page }) => {
    await openSite(page, "#read/beinecke/86v5/text");
    await textReady(page);
    const seg = page.locator('#rd-zoomer .seg[data-page="f85r2"]');
    await expect(seg.locator(".wb")).toHaveCount(155);
    // f85r2 line 1 word 3 is at [856, 695, 45, 38] in thousandths of the photo; turned half round it shows at 99, 267
    const [s, b] = [await seg.boundingBox(), await box(page, "f85r2|0|2").boundingBox()];
    expect(Math.round((b.x - s.x) / s.width * 1000)).toBeCloseTo(99, -1);
    expect(Math.round((b.y - s.y) / s.height * 1000)).toBeCloseTo(267, -1);
  });

  test("a word whose place is estimated from the words beside it is drawn dashed and says so", async ({ page }) => {
    await openSite(page, "#read/beinecke/57v/text");
    await textReady(page);
    const est = box(page, "f57v|2|9");
    await expect(est).toHaveClass(/est/);
    await est.hover();
    await expect(page.locator("#tx-tip")).toContainText("place estimated");
    expect(await est.evaluate(e => getComputedStyle(e).outlineStyle)).toBe("dashed");
  });

  test("glyphs: the manuscript's shapes, in Voynich VV", async ({ page }) => {
    await openSite(page, "#read/beinecke/57v/text");
    await textReady(page);
    await page.locator("#rd-text .tx-seg button", { hasText: "Glyphs" }).click();
    await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('24px "Voynich VV"'); })).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#rd-text .ln .t")).fontFamily)).toContain("Voynich VV");
    // the uncertain-space dot is never drawn in the glyph font (it once showed as a gold glyph)
    expect(await page.evaluate(() => [...document.querySelectorAll("#rd-text .us")].every(e => !getComputedStyle(e, "::after").content || getComputedStyle(e, "::after").content === "none"))).toBe(true);
  });

  test("comparing with one transcriber fades what they read alike, and is kept in the address", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text?r=GC");
    await textReady(page);
    await expect(page.locator("#rd-text .tx-cmp")).toContainText("Comparing with Glen Claston");
    await expect(line(page, "f1r.2").locator(".w.cx", { hasText: "kaer" })).toHaveCount(1);
    expect(await line(page, "f1r.2").locator(".w.cs").count()).toBeGreaterThan(5);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/1r/text?r=GC");
    await page.locator("#rd-text .tx-cmp button", { hasText: "Stop" }).click();
    await expect(page.locator("#rd-text .tx-cmp")).toHaveCount(0);
  });

  test("a foldout's panels show their text when unfolded", async ({ page }) => {
    await openSite(page, "#read/beinecke/69r/text");
    await textReady(page);
    await expect(page.locator("#rd-text .tx-folded")).toContainText("68v3, 68v2");
    await page.keyboard.press("u");
    await expect(page.locator("#rd-text .tx-page h3")).toHaveText(["68v3", "68v2", "68v1", "69r"], { timeout: 10_000 });
  });
});

test.describe("the Text tab", () => {
  test("opens on an example, says the count in a sentence, and narrows step by step", async ({ page }) => {
    await openSite(page, "#text/beinecke/search");
    await results(page);
    const echo = page.locator("#sx-echo");
    await expect(echo).toContainText("daiin appears 898 times on 210 of 227 pages");
    await expect(echo).toContainText("An example");
    await expect(page.locator(".sx-secn")).toContainText("Herbal");
    await page.locator(".sx-frow", { hasText: "Recipes" }).click();
    await expect(echo).toContainText("(Recipes)");
    await expect.poll(() => page.evaluate(() => location.hash)).toContain("steps=section");
  });

  test("a search, its range behind the i, and Scribe narrowing", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=qokeedy");
    await results(page);
    const echo = page.locator("#sx-echo");
    await expect(echo).toContainText("qokeedy appears 309 times");
    await page.locator(".sx-why summary").click();
    await expect(page.locator(".sx-why-m")).toContainText(/three fullest transcriptions alone/, { timeout: 15_000 });
    await page.locator(".sx-facet.one summary", { hasText: "Scribe" }).click();
    await page.locator(".sx-frow", { hasText: "Scribe 2" }).click();
    await expect(page.locator("#sx-steps")).toContainText("Scribe 2");
    await expect(echo).toContainText("(Scribe 2)");
  });

  test("a result opens in the Reader on its word, and steps on to the next", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#text/beinecke/search?q=chol%20daiin");
    await results(page);
    await page.locator(".sx-hit").nth(2).click();
    await expect(page.locator(".tx-step")).toContainText("Result 3 of 34", { timeout: 15_000 });
    await expect(page.locator("#rd-text .tx-where")).toHaveText(/3r · line 3 · word \d/);
    await page.locator('.tx-step button[aria-label="Next result"]').click();
    await expect(page.locator(".tx-step")).toContainText("Result 4 of 34", { timeout: 15_000 });
    await page.locator(".tx-step a", { hasText: "All results" }).click();
    await expect(page.locator("#v-text")).toBeVisible();
  });

  test("a query it cannot read is answered in plain words", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=Qok");
    await expect(page.locator("#sx-echo .sx-err")).toContainText("Capitals stand for whole words");
  });

  test("/ anywhere goes to the search box", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r");
    await page.keyboard.press("/");
    await expect(page.locator("#sx-q")).toBeFocused();
  });

  test("the query language finds what it says", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=qokeedy");
    await results(page);
    const count = q => page.evaluate(async q => {
      location.hash = "#text/beinecke/search?q=" + encodeURIComponent(q);
      await new Promise(r => { const t0 = Date.now(); const k = () => TextTab.mod.res && TextTab.mod.st.q === q ? r() : Date.now() - t0 > 10000 ? r() : setTimeout(k, 50); k(); });
      return TextTab.mod.filtered(TextTab.mod.res.hits).length;
    }, q);
    const qok = await count("qok*");
    expect(qok).toBeGreaterThan(2500);
    expect(await count("qok* scribe:2")).toBeLessThan(qok);
    expect(await count("chol~daiin")).toBeGreaterThanOrEqual(await count("chol daiin"));
    expect(await count("A A")).toBeGreaterThan(100);
    expect(await count("/qo[kt]e+dy/")).toBeGreaterThan(await count("qokeedy"));
    expect(await count("^qo*")).toBeLessThan(qok);
  });

  test("a search takes well under a second", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=qok*");
    await results(page);
    for (const q of ["qokeedy", "*dy", "chol~daiin", "A A", "/qo[kt]e+dy/"]) {
      await page.evaluate(q => { location.hash = "#text/beinecke/search?q=" + encodeURIComponent(q); }, q);
      await expect.poll(() => page.evaluate(q => TextTab.mod.st.q === q && TextTab.mod.res && TextTab.mod.ms, q)).toBeTruthy();
      const ms = await page.evaluate(() => TextTab.mod.ms);
      expect(ms, `${q} took ${Math.round(ms)} ms`).toBeLessThan(500);
    }
  });

  test("results export as CSV and IVTFF", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=qokeedy%20scribe:3");
    await results(page);
    const n = await page.evaluate(() => TextTab.mod.list.length);
    await page.locator(".sx-exp summary").click();
    const [csv] = await Promise.all([page.waitForEvent("download"), page.locator(".sx-exp-m button", { hasText: "CSV" }).click()]);
    const rows = (await (await csv.createReadStream()).toArray()).join("").trim().split("\n");
    expect(rows[0]).toBe("line,page,section,scribe,language,quire,kind,before,match,after,reading,transcribers");
    expect(rows.length).toBe(n + 1);
    await page.locator(".sx-exp summary").click();
    const [iv] = await Promise.all([page.waitForEvent("download"), page.locator(".sx-exp-m button", { hasText: "IVTFF" }).click()]);
    const text = (await (await iv.createReadStream()).toArray()).join("");
    expect(text.startsWith("#=IVTFF Eva- 2.0")).toBe(true);
    expect(text).toMatch(/\n<f\w+>\s+<! \$Q=/);
    expect(text).toMatch(/\n<f\w+\.\d+,[@+*=&~]\w+>\s+\S+/);
  });
});

test.describe("saved searches and the progress file", () => {
  test("a saved search goes into the progress file, version 2, and comes back from it", async ({ page, browser, baseURL }) => {
    await openSite(page, "#text/beinecke/search?q=qokeedy");
    await results(page);
    await page.locator(".sx-acts button", { hasText: "Save" }).click();
    await page.locator("dialog.ask input").fill("my qokeedy");
    await page.locator("dialog.ask button", { hasText: "Save" }).click();
    await expect(page.locator(".sx-acts button", { hasText: "Saved" })).toBeVisible();
    await page.locator("#cx-work").click();
    await expect(page.locator("#work-dlg")).toContainText("my qokeedy");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#work-dlg button", { hasText: "Export progress file" }).click()]);
    const file = JSON.parse((await (await dl.createReadStream()).toArray()).join(""));
    expect(file.version).toBe(2);
    expect(file.searches.map(s => s.name)).toEqual(["my qokeedy"]);
    expect(file.searches[0].hash).toBe("#text/beinecke/search?q=qokeedy");
    // another browser: nothing saved, then the file imported
    const ctx = await browser.newContext({ baseURL, reducedMotion: "reduce" });
    const fresh = await ctx.newPage();
    await fresh.route(url => !url.toString().startsWith(baseURL), r => r.abort());
    const problems = [];
    fresh.on("pageerror", e => problems.push(e.message));
    await openSite(fresh, "#info/beinecke");
    await fresh.locator("#cx-work").click();
    await expect(fresh.locator("#work-dlg")).toContainText("Your searches (0)");
    await fresh.locator("#work-dlg input[type=file]").setInputFiles({ name: "progress.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
    await expect(fresh.locator("#work-dlg")).toContainText("Your searches (1)");
    await expect(fresh.locator("#work-dlg a", { hasText: "my qokeedy" })).toHaveAttribute("href", "#text/beinecke/search?q=qokeedy");
    await fresh.locator("#work-dlg input[type=file]").setInputFiles({ name: "progress.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
    await fresh.waitForTimeout(300);
    await expect(fresh.locator("#work-dlg")).toContainText("Your searches (1)");
    expect(problems).toEqual([]);
    await ctx.close();
  });

  test("a version-1 progress file still imports as it did", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r");
    await page.locator("#cx-work").click();
    const v1 = { app: "voynich-viewer", version: 1, exported: "2026-10-01T00:00:00.000Z", crops: {}, orders: [],
      bookmarks: [{ id: "bm-t1", page: "f2r", name: "Two", at: "2026-10-01T00:00:00.000Z" }], viewer: "1.4" };
    await page.locator("#work-dlg input[type=file]").setInputFiles({ name: "v1.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(v1)) });
    await expect(page.locator("#work-dlg")).toContainText("Your bookmarks (1)");
    await expect(page.locator("#work-dlg")).toContainText("Your searches (0)");
  });

  test("a page set keeps a search to its pages", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=qokeedy");
    await results(page);
    await page.evaluate(() => Saved.putSet("mine", ["f75r", "f76r"]));
    await page.evaluate(() => { location.hash = "#text/beinecke/search?q=qokeedy&set=mine"; });
    await expect(page.locator("#sx-echo")).toContainText("on the pages of set:mine");
    const pages = await page.locator(".sx-pg").evaluateAll(els => els.map(e => e.dataset.page));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every(p => ["f75r", "f76r"].includes(p))).toBe(true);
  });
});

test.describe("accessibility", () => {
  const unnamed = page => page.evaluate(() => {
    const visible = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const name = e => (e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || (e.labels && e.labels[0]?.textContent) || e.closest("label")?.textContent || "").trim();
    return [...document.querySelectorAll("button, a[href], select, input:not([type=hidden]):not([type=file]), [role=button], [tabindex='0'], summary")]
      .filter(visible).filter(e => !name(e)).map(e => e.outerHTML.slice(0, 100));
  });
  test("the text, the word panel and the Text tab: every control has a name", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/2r/text");
    await textReady(page);
    expect(await unnamed(page)).toEqual([]);
    await line(page, "f2r.4").locator(".w").first().click();
    expect(await unnamed(page)).toEqual([]);
    await openSite(page, "#text/beinecke/search?q=qok*");
    await results(page);
    expect(await unnamed(page)).toEqual([]);
  });
  test("a word where transcribers disagree says so", async ({ page }) => {
    await openSite(page, "#read/beinecke/2r/text");
    await textReady(page);
    await expect(line(page, "f2r.4").locator(".w").first()).toHaveAttribute("aria-label", /transcribers disagree/);
  });
});
