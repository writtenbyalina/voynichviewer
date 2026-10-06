// Text: the Reader's text panel, the word card, the interlinear, glyphs, and the Text tab's search, export and saved
// searches (docs/TEXT.md). Needs the test kit (tests/fixtures.js). The numbers asserted come from data/text, built by
// tools/text/build.py: a rebuild that changes them should change them here too, on purpose.
const { test, expect, openSite } = require("./fixtures");

const panel = page => page.locator("#rd-text");
const line = (page, id) => page.locator(`#rd-text .ln[data-id="${id}"]`);
const textReady = page => expect(page.locator("#rd-text .tx-page").first()).toBeVisible({ timeout: 15_000 });
const results = page => expect(page.locator("#sx-res .sx-hit, #sx-res .sx-none").first()).toBeVisible({ timeout: 15_000 });

test.describe("the Reader's text panel", () => {
  test("opens from a link, follows the pages, and T closes it", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text");
    await textReady(page);
    await expect(page.locator("#rd-textbtn")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#rd-text .tx-page h3")).toHaveText(["1r"]);
    await expect(page.locator("#rd-text .tx-count")).toHaveText("28 lines");
    // f1r.2 as the design works it through (docs/TEXT.md 3.4): an uncertain space, written as IVTFF's comma
    await expect(line(page, "f1r.2").locator(".t")).toHaveText("sory ckhar or,y kair chtaiin shar are cthar cthar dan");
    await expect(page.locator("#rd-text .tx-foot")).toContainText("voynich.nu");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#rd-text .tx-page h3")).toHaveText(["1v", "2r"]);
    await page.keyboard.press("t");
    await expect(panel(page)).toBeHidden();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/2r");
    await page.keyboard.press("t");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/2r/text");
  });

  test("an old link without /text still opens the Reader as it did", async ({ page }) => {
    await openSite(page, "#read/beinecke/78v");
    await expect(page.locator("#rd-where")).toHaveText(/78v/);
    await expect(panel(page)).toBeHidden();
  });

  test("a foldout's panels show their text when unfolded", async ({ page }) => {
    await openSite(page, "#read/beinecke/69r/text");
    await textReady(page);
    await expect(page.locator("#rd-text .tx-folded")).toContainText("68v3, 68v2");
    await page.keyboard.press("u");
    await expect(page.locator("#rd-text .tx-page h3")).toHaveText(["68v3", "68v2", "68v1", "69r"], { timeout: 10_000 });
  });

  test("a word's card shows every transcriber's reading, and Escape gives the focus back", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text");
    await textReady(page);
    const word = line(page, "f1r.2").locator(".w").nth(6);
    await word.click();
    const card = page.locator(".tx-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("f1r.2, word 7");
    for (const [reading, who] of [["ase", "Zandbergen & Landini"], ["are", "Takahashi"], ["@221;is", "Claston"], ["ary", "Stolfi"]])
      await expect(card.locator("tr", { hasText: who }).first().locator("td.r")).toHaveText(reading);
    await expect(card.locator(".tx-votes")).toContainText("a majority");
    await expect(card.locator(".tx-occ")).toContainText(/time|Only here/);
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(word).toBeFocused();
  });

  test("N and Shift+N step through the marked words", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text");
    await textReady(page);
    await page.keyboard.press("n");
    await expect(page.locator(".tx-card")).toContainText("f1r.1, word 7");
    await page.keyboard.press("n");
    const second = await page.locator(".tx-card .tx-ch").textContent();
    await page.keyboard.press("Shift+N");
    await expect(page.locator(".tx-card")).toContainText("f1r.1, word 7");
    expect(second).not.toContain("f1r.1, word 7");
  });

  test("glyphs: the manuscript's shapes, in Voynich VV, with each word's Eva under it", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text");
    await textReady(page);
    await page.locator('#rd-text .tx-seg button[data-font="glyphs"]').click();
    const w = line(page, "f1r.2").locator(".w.st").first();
    await expect(w.locator(".ev")).toHaveText("sory");
    await expect(w.locator(".gl")).toHaveAttribute("aria-hidden", "true");
    await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('26px "Voynich VV"'); })).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#rd-text .w.st .gl")).fontFamily)).toContain("Voynich VV");
  });

  test("one transcriber's reading, marked where it differs, kept in the address", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text?r=GC");
    await textReady(page);
    await expect(page.locator("#rd-text .tx-reading")).toHaveValue("GC");
    await expect(line(page, "f1r.2").locator(".w.mk", { hasText: "kaer" })).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/1r/text?r=GC");
  });

  test("the interlinear has a row for each transcriber, and I goes back to lines", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text");
    await textReady(page);
    await page.keyboard.press("i");
    const block = line(page, "f1r.2");
    await expect(block.locator(".il .who")).toContainText(["Consensus", "Zandbergen & Landini", "Claston", "Takahashi", "Friedman's group", "Currier & D'Imperio", "Stolfi", "RF1", "voynichese.com"]);
    await expect(block.locator(".seq.cons")).toContainText("cthar cthar");
    await page.keyboard.press("i");
    await expect(block.locator(".il")).toHaveCount(0);
  });
});

test.describe("the Text tab", () => {
  test("a search says what it means, counts with a range, and narrows step by step", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=qokeedy");
    await results(page);
    const echo = page.locator("#sx-echo");
    await expect(echo).toContainText("the word qokeedy");
    await expect(echo).toContainText("309 times");
    await expect(echo).toContainText(/in ZL, GC and IT/);
    await expect(page.locator(".sx-bar")).not.toHaveCount(0);
    await page.locator(".sx-frow", { hasText: "Scribe 2" }).click();
    await expect(page.locator("#sx-steps")).toContainText("Scribe 2");
    await expect.poll(() => page.evaluate(() => location.hash)).toContain("steps=scribe%3A2");
    await expect(echo).toContainText("before narrowing");
  });

  test("a result opens in the Reader with its line lit, and steps on to the next", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=chol%20daiin");
    await results(page);
    await page.locator(".sx-hit").nth(2).click();
    await expect(page.locator("#rd-text .ln.lit")).toHaveAttribute("data-id", "f3r.3", { timeout: 15_000 });
    await expect(page.locator("#rd-text .w.hit")).toHaveText(["chol", "daiin"]);
    await expect(page.locator(".tx-step")).toContainText("Result 3 of 34");
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
    await openSite(fresh, "#text/beinecke");
    await fresh.locator("#cx-work").click();
    await expect(fresh.locator("#work-dlg")).toContainText("Your searches (0)");
    await fresh.locator("#work-dlg input[type=file]").setInputFiles({ name: "progress.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
    await expect(fresh.locator("#work-dlg")).toContainText("Your searches (1)");
    await expect(fresh.locator("#work-dlg a", { hasText: "my qokeedy" })).toHaveAttribute("href", "#text/beinecke/search?q=qokeedy");
    // and again: nothing twice
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
    return [...document.querySelectorAll("button, a[href], select, input:not([type=hidden]):not([type=file]), [role=button], [tabindex='0']")]
      .filter(visible).filter(e => !name(e)).map(e => e.outerHTML.slice(0, 100));
  });
  test("the text panel, its card and the Text tab: every control has a name", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text");
    await textReady(page);
    await line(page, "f1r.2").locator(".w").nth(6).click();
    expect(await unnamed(page)).toEqual([]);
    await openSite(page, "#text/beinecke/search?q=qok*");
    await results(page);
    expect(await unnamed(page)).toEqual([]);
  });
  test("a marked word says why it is marked", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text");
    await textReady(page);
    await expect(line(page, "f1r.1").locator(".w.mk").first()).toHaveAttribute("aria-label", /readings differ|uncertain space|nobody/);
  });
});
