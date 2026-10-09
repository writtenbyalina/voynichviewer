// Text (docs/text/REDESIGN.md 9): pointing at words on the page photographs, the words chosen and their other places
// (peeks, never jumps), the strip as the book's compass, sets of words and pages like this one, rings unrolled, turning
// the page, the alphabets, the Rosettes, and the Text tab's search, export and saved searches. Needs the test kit
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
    // RF1b, Zandbergen's reference transliteration, in Eva (his reduced Eva, RF1b-er)
    await expect(line(page, "f2r.2").locator(".t")).toHaveText("dorchory chkar s shor cthy cto");
    expect(await page.locator("#rd-zoomer .wb").count(), "words with a place on the photographs").toBeGreaterThan(150);
    await expect(page.locator("#rd-text .tx-foot")).toContainText("RF1b");
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

  test("pointing at a word on the photograph outlines it, lights it in the text and says what it reads, and how often", async ({ page }) => {
    await openSite(page, "#read/beinecke/2r/text");
    await textReady(page);
    await box(page, "f2r|3|1").hover();
    await expect(page.locator("#tx-tip")).toContainText("chtoddy");
    await expect(page.locator("#tx-tip")).toContainText(/only here|more in the book/);
    await expect(page.locator("#tx-tip")).not.toContainText("transcribers");
    await expect(page.locator("#rd-zoomer .seg-words .out.hov")).toHaveCount(2);   // a white line over a dark hairline
    await expect(line(page, "f2r.4").locator(".w").nth(1)).toHaveClass(/lit/);
  });

  test("clicking a word chooses it without moving the page: its picture, glyphs and letters, one sentence, its places", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/2r/text");
    await textReady(page);
    const b = await box(page, "f2r|3|1").boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.locator("#rd-text .tx-where")).toHaveText("2r · line 4");
    await expect(page.locator("#rd-text .tx-reading .lt")).toHaveText("chtoddy");
    await expect(page.locator("#rd-text .tx-reading .gl")).not.toBeEmpty();
    await expect(page.locator("#rd-text .tx-crop canvas")).toHaveCount(1);
    await expect(page.locator("#rd-text .tx-say")).toContainText(/found|not found/);
    await expect(page.locator("#rd-text")).not.toContainText(/transcribers? (differ|agree)|v101|Eva, full/);
    await expect(page.locator("#rd-zoomer .seg-words .out.sel")).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/2r/text?w=f2r.4.2");
    expect(await page.evaluate(() => [R.zoom, R.rot]), "the page is not zoomed or turned").toEqual([1, 0]);
    await page.keyboard.press("Escape");
    await expect(page.locator("#rd-text .tx-page").first()).toBeVisible();
    await expect(page.locator("#rd-zoomer .seg-words .out.sel")).toHaveCount(0);
  });

  test("several words: shift-click, or the + beside its line, and where that run of words is found", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text");
    await textReady(page);
    await page.locator('#rd-text .w[data-k="f1r|14|7"]').click();
    // the word's line is in the word panel too: shift-click a word of it to take in the words up to it
    await page.locator('#rd-text .tx-inline .w[data-k="f1r|14|8"]').click({ modifiers: ["Shift"] });
    await expect(page.locator("#rd-text .tx-reading .lt")).toHaveText("chol chol");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/1r/text?w=f1r.15.8&n=2");
    await expect(page.locator("#rd-text .tx-say")).toContainText("These words, in this order, are found 21 more times");
    await expect(page.locator("#rd-text .tx-place")).toHaveCount(21);
    await page.locator('#rd-text .tx-grow[aria-label="Take in the word after"]').click();
    await expect(page.locator("#rd-text .tx-reading .lt")).toHaveText("chol chol kor");
    await expect(page.locator("#rd-text .tx-say")).toContainText("are found 1 more time, on 1 page");
    await page.locator("#rd-text .tx-acts button", { hasText: "− last word" }).click();
    await expect(page.locator("#rd-text .tx-reading .lt")).toHaveText("chol chol");
  });

  test("the strip under the pages marks where the words are, and the pages you have been to", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text?w=f1r.15.8&n=2");
    await expect(page.locator("#rd-text .tx-place").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#rd-strip")).toHaveClass(/has-hits/);
    expect(await page.locator("#rd-strip .t.hit").count(), "pages with the words").toBeGreaterThanOrEqual(15);
    await page.keyboard.press("Escape");
    await expect(page.locator("#rd-strip")).not.toHaveClass(/has-hits/);
    await expect(page.locator("#rd-strip .t.vis").first()).toBeAttached();
  });

  test("a place opens in a peek beside the page, without leaving it; N steps on, Open page goes there, Back returns", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/1r/text?w=f1r.15.8&n=2");
    await expect(page.locator("#rd-text .tx-place").first()).toBeVisible({ timeout: 15_000 });
    await page.locator("#rd-text .tx-place").first().click();
    const peek = page.locator("#rd-stage .tx-peek");
    await expect(peek).toContainText("1 of 21");
    await expect(peek).toContainText("8v · line 5");
    await expect(page.locator("#rd-where")).toHaveText(/1r/);        // the page you were on stays
    await page.keyboard.press("n");
    await expect(peek).toContainText("2 of 21");
    await page.keyboard.press("Shift+N");
    await peek.locator("button", { hasText: "Open 8v" }).click();
    await expect(page.locator("#rd-where")).toHaveText(/8v/, { timeout: 15_000 });
    await expect(page.locator("#rd-text .tx-reading .lt")).toHaveText("chol chol");
    await expect(page.locator("#rd-text .tx-return")).toContainText("Back to 1r");
    await page.goBack();
    await expect(page.locator("#rd-where")).toHaveText(/1r/, { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/1r/text?w=f1r.15.8&n=2");
    await expect(page.locator("#rd-text .tx-return")).toHaveCount(0);
  });

  test("the word across the book: a skyline of its places, page by page, with the page you are on marked; Esc puts it away", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/1r/text?w=f1r.15.8");
    await expect(page.locator("#rd-text .sky-open")).toBeVisible({ timeout: 15_000 });
    await page.locator("#rd-text .sky-open").click();
    const sky = page.locator("#rd-stage .sky");
    await expect(sky).toContainText("363 places");
    expect(await sky.locator(".sky-col").count(), "a stack for each page the word is on").toBeGreaterThan(130);
    await expect(sky.locator(".sky-arcs .here")).toHaveCount(1);
    await sky.locator(".sky-col").nth(20).hover();
    await expect(sky.locator(".sky-loupe")).toBeVisible();
    expect(await page.evaluate(() => R.zoom), "the page under it is left alone").toBe(1);
    await page.keyboard.press("Escape");
    await expect(sky).toHaveCount(0);
    await expect(page.locator("#rd-text .tx-reading .lt")).toHaveText("chol");
  });

  test("⌘-click collects words into a set: the pages that hold them, in any order", async ({ page }) => {
    await openSite(page, "#read/beinecke/1r/text");
    await textReady(page);
    await page.locator('#rd-text .w[data-k="f1r|8|0"]').click({ modifiers: ["Meta"] });   // daiin
    await page.locator('#rd-text .w[data-k="f1r|0|4"]').click({ modifiers: ["Meta"] });   // shol
    await expect(page.locator("#rd-text .tx-where")).toHaveText("2 words, any order");
    await expect(page.locator("#rd-text .tx-say")).toContainText(/All 2 are on \d+ pages/);
    expect(await page.locator("#rd-text .gh-b").count()).toBeGreaterThan(5);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/1r/text?s=daiin+shol");
    await page.locator("#rd-text .tx-chips .tx-x").first().click();
    await expect(page.locator("#rd-text .tx-where")).toHaveText("1 word, any order");
  });

  test("a zodiac page: the pages that share its labels, near spellings too", async ({ page }) => {
    await openSite(page, "#read/beinecke/71r/text?like=f71r.L");
    await expect(page.locator("#rd-text .tx-where")).toHaveText("Pages like 71r", { timeout: 15_000 });
    await expect(page.locator("#rd-text .gh-b").first()).toContainText("70v2");
    // each page as a ghost: blank but for the shared words, printed in the glyphs where they sit (after basil.js)
    await expect(page.locator("#rd-text .gh-b").first().locator(".gh-word").first()).toBeAttached();
    await page.locator("#rd-text .tx-chip", { hasText: "one glyph off counts too" }).click();
    await expect(page.locator("#rd-text .gh-b").first()).toContainText("≈");
    await page.locator("#rd-text .gh-b").first().click();
    await expect(page.locator("#rd-stage .tx-peek .pk-page img")).toBeVisible();
  });

  test("a ring unrolled: its repeats joined by arcs", async ({ page }) => {
    await openSite(page, "#read/beinecke/57v/text?ring=f57v.3");
    await expect(page.locator("#rd-text .tx-where")).toHaveText("57v · ring 3 · 68 words", { timeout: 15_000 });
    expect(await page.locator("#rd-text .rg-arcs path").count()).toBeGreaterThan(10);
    await expect(page.locator("#rd-text .rg-cell")).toHaveCount(68);
    await expect(page.locator("#rd-zoomer .seg-words .out.sel")).toHaveCount(136);   // the ring outlined on the page
  });

  test("a word written round a ring is outlined as part of the ring, and the page turns to read it only when asked", async ({ page }) => {
    await openSite(page, "#read/beinecke/57v/text?w=f57v.2.21");
    await expect(page.locator("#rd-text .tx-reading .lt")).toHaveText("ddal", { timeout: 15_000 });
    expect(await box(page, "f57v|1|20").getAttribute("d"), "drawn with arcs").toMatch(/A\d/);
    expect(await page.evaluate(() => R.rot)).toBe(0);
    await page.locator("#rd-text .tx-turn", { hasText: "Turn the page to read it" }).click();
    await expect.poll(() => page.evaluate(() => Math.round(R.rot))).toBe(-82);
    await expect(page.locator("#rd-zoomlvl")).toContainText("↻−82°");
    await page.locator("#rd-text .tx-turn", { hasText: "Turn the page back" }).click();
    await expect.poll(() => page.evaluate(() => R.rot)).toBe(0);
  });

  test("R turns the pages a quarter, 0 puts them back, and a new opening starts upright", async ({ page }) => {
    await openSite(page, "#read/beinecke/57v/text");
    await textReady(page);
    await page.keyboard.press("r");
    await expect.poll(() => page.evaluate(() => R.rot)).toBe(90);
    await expect(page.locator("#rd-zoomer")).toHaveAttribute("style", /rotate\(90deg\)/);
    await page.keyboard.press("0");
    await expect.poll(() => page.evaluate(() => R.rot)).toBe(0);
    await page.keyboard.press("Shift+R");
    await expect.poll(() => page.evaluate(() => R.rot)).toBe(-90);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => R.rot)).toBe(0);
  });

  test("the text as glyphs or in Eva, chosen from a dropdown, by Zandbergen's tables; and nothing else", async ({ page }) => {
    await openSite(page, "#read/beinecke/10r/text");
    await textReady(page);
    const sel = page.locator("#rd-text select.tx-script");
    await expect(sel.locator("option")).toHaveText(["Glyphs", "Eva"]);
    await expect(page.locator("#rd-text .tx-seg")).toHaveCount(0);
    const l6 = () => line(page, "f10r.6").locator(".t");
    await expect(l6()).toHaveText("ycheor cthy chor cthaiin qoctholy dy   chy taiin shy");
    await sel.selectOption("glyphs");
    await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('24px "Voynich VV"'); })).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#rd-text .ln .t")).fontFamily)).toContain("Voynich VV");
    await page.reload();
    await textReady(page);
    await expect(page.locator("#rd-text select.tx-script")).toHaveValue("glyphs");
    await page.locator("#rd-text select.tx-script").selectOption("eva");
    await expect(l6()).toHaveText("ycheor cthy chor cthaiin qoctholy dy   chy taiin shy");
  });

  test("an alphabet kept from before that is no longer offered (FSG, Currier) falls back to Eva", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("vv:text:script", JSON.stringify("fsg")));
    await openSite(page, "#read/beinecke/10r/text");
    await textReady(page);
    await expect(page.locator("#rd-text select.tx-script")).toHaveValue("eva");
    await expect(line(page, "f10r.6").locator(".t")).toHaveText("ycheor cthy chor cthaiin qoctholy dy   chy taiin shy");
  });

  test("one word, one count: the Reader and the Text tab agree, an uncertain space counted either way", async ({ page }) => {
    await openSite(page, "#read/beinecke/2r/text?w=f1v.2.7");
    await expect(page.locator("#rd-text .tx-say")).toContainText("found 3 more times, on 3 pages", { timeout: 15_000 });   // f67r2, f70r2 (oko,dar), the Rosettes
    await expect(page.locator("#rd-text .tx-grid li[data-page=f70r2]")).toBeVisible();
    await page.evaluate(() => { location.hash = "#text/beinecke/search?q=okodar"; });
    await results(page);
    await expect(page.locator("#sx-echo")).toContainText("okodar appears 4 times on 4 of");
  });

  test("the places as a concordance: sorted by the word after, grouped under it; two doors (where it sits, similar spellings), no transcribers and no notes", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/1r/text?w=f1r.15.8");
    await expect(page.locator("#rd-text .tx-say")).toContainText("363 more times", { timeout: 15_000 });
    await page.locator("#rd-text .tx-places select").selectOption("after");
    await expect(page.locator("#rd-text .tx-grid .tx-group").first()).toBeVisible();
    expect(await page.locator("#rd-text .tx-grid .tx-group").count()).toBeGreaterThan(3);
    await expect(page.locator("#rd-text .tx-door > summary")).toHaveText(["Where it sits", "Similar spellings"]);
    await expect(page.locator("#rd-text")).not.toContainText("How the transcribers read it");
    await expect(page.locator('#rd-text .tx-ic[aria-label="Add a note"]')).toHaveCount(0);
    await expect(page.locator("#rd-text .tx-stamp")).toHaveCount(0);
    await expect(page.locator("#rd-text .tx-src")).toContainText("RF1b · position: The Voynichese Project · photograph: Yale University");
  });

  test("Find is a live search: results as you type, the exact word first, then words that begin with it; a word opens on its places; the address keeps it", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/2r/text");
    await textReady(page);
    const find = page.locator("#rd-text .tx-find-in");
    await expect(find).toBeVisible();
    await find.pressSequentially("chol");
    await expect(page.locator("#rd-text .tx-fsum")).toContainText(/\d+ words · [\d,]+ places · \d+ pages/);
    const rows = page.locator("#rd-text .tx-fws .tx-fw");
    await expect(rows.first().locator(".e")).toHaveText("chol");                   // the exact word first
    await expect(rows.first().locator(".e mark")).toHaveText("chol");
    await expect(rows.nth(1).locator(".e")).toContainText(/^chol./);              // then words that begin with it
    await expect(page.locator("#rd-text .tx-fwi.on .tx-fw .e")).toHaveText("chol");
    await expect(page.locator("#rd-text .tx-fdetail .tx-places .tx-h")).toContainText("Places (364)");
    await expect(page.locator("#rd-text .tx-fdetail .tx-grid li").first()).toBeVisible();
    await expect(page.locator("#rd-text .tx-find-echo")).not.toBeEmpty();
    await expect(page.locator("#rd-zoomer .seg-words .out.set").first()).toBeAttached();   // its places on 1v and 2r
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/2r/text?find=chol&fw=chol");
    expect(await find.evaluate(e => document.activeElement === e), "typing never loses the caret").toBe(true);
    // another word of the list opens instead
    await rows.nth(1).click();
    await expect(page.locator("#rd-text .tx-fwi.on .tx-fw .e")).toContainText(/^chol./);
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/find=chol&fw=chol./);
    // whole word: one result; contains: more
    await page.locator("#rd-text .tx-fmodes .tx-chip", { hasText: "whole word" }).click();
    await expect(page.locator("#rd-text .tx-fsum")).toContainText("1 word · 364 places");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/2r/text?find=chol&fw=chol&fm=whole");
    await page.locator("#rd-text .tx-fmodes .tx-chip", { hasText: "contains" }).click();
    await expect(page.locator("#rd-text .tx-fsum")).not.toContainText("1 word ·");
    await page.locator("#rd-text .tx-fmodes .tx-chip", { hasText: "begins with" }).click();
    // Esc clears it, and the page text is back
    await find.press("Escape");
    await expect(find).toHaveValue("");
    await expect(page.locator("#rd-text .tx-page").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/2r/text");
    expect(await page.evaluate(() => [R.zoom, R.rot]), "the page is not zoomed or turned").toEqual([1, 0]);
  });

  test("Find: a pattern with *, from the address; nothing found says so and offers words one glyph away; the glyph keys type Eva; ↓ goes to the results", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/2r/text?find=qok*");
    await expect(page.locator("#rd-text .tx-fsum")).toContainText("places", { timeout: 15_000 });
    await expect(page.locator("#rd-text .tx-find-in")).toHaveValue("qok*");
    await expect(page.locator("#rd-text .tx-fmodes")).toContainText("A pattern");
    await expect(page.locator("#rd-text .tx-fwi.on .tx-fw .e")).toHaveText("qokeey");   // the most frequent, no exact word
    await expect(page.locator("#rd-text .tx-fdetail .tx-places .tx-h")).toContainText("Places (307)");
    await page.locator("#rd-text .tx-find-in").fill("qokq");
    await expect(page.locator("#rd-text .tx-say")).toContainText("No word in the book begins with qokq");
    await expect(page.locator("#rd-text .tx-sim .tx-chip").first()).toBeVisible();   // one glyph away
    await page.locator("#rd-text .tx-sim .tx-chip").first().click();
    await expect(page.locator("#rd-text .tx-fsum")).toContainText("1 word");
    await page.locator("#rd-text .tx-find-in").fill("");
    await textReady(page);
    await page.locator("#rd-text .tx-ic.tx-kb").click();
    await expect(page.locator("#rd-text .tx-keys")).toBeVisible();
    for (const e of ["d", "a", "i", "i", "n"]) await page.locator(`#rd-text .tx-key:has(.e:text-is("${e}"))`).click();
    await expect(page.locator("#rd-text .tx-find-in")).toHaveValue("daiin");
    await expect(page.locator("#rd-text .tx-fwi.on .tx-fw .e")).toHaveText("daiin");
    await page.locator("#rd-text .tx-find-in").press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement.className)).toContain("tx-fw");
    await page.keyboard.press("Escape");
    await textReady(page);
    await expect(page.locator("#rd-text .tx-find-in")).toHaveValue("");
  });

  test("the glyphs picked in a word find their words in the panel, not in the Text tab", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/1r/text?w=f1r.15.8");
    await expect(page.locator("#rd-text .tx-reading .gl .tx-g")).toHaveCount(3, { timeout: 15_000 });   // chol: ch, o, l
    await page.locator("#rd-text .tx-reading .gl .tx-g").first().click();
    await expect(page.locator("#rd-text .tx-gfind")).toBeVisible();
    await page.locator("#rd-text .tx-gfind .tx-link").first().click();
    await expect(page.locator("#rd-text .tx-find-in")).toHaveValue("ch");
    await expect(page.locator("#rd-text .tx-fsum")).toContainText("words");
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#read\/beinecke\/1r\/text\?find=ch/);
  });

  test("the panel's ? is short: how to use the text, a few keys, the sources; the site's ? keeps only the keys that matter", async ({ page }) => {
    await openSite(page, "#read/beinecke/2r/text");
    await textReady(page);
    await page.locator('#rd-text .tx-ic[aria-label="Help and sources"]').click();
    const d = page.locator("#tx-help-dlg");
    await expect(d).toBeVisible();
    await expect(d).toContainText("RF1b");
    await expect(d).toContainText("Voynichese Project");
    await expect(d).toContainText("Yale University");
    expect(await d.locator("kbd").count()).toBeLessThan(8);
    await page.keyboard.press("Escape");
    await expect(d).toBeHidden();
    await page.locator("#rd-text .tx-foot .tx-link", { hasText: "Sources" }).click();
    await expect(d).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await page.locator("#cx-help-dlg kbd").count()).toBeLessThan(25);
    await expect(page.locator("#cx-help-dlg")).not.toContainText("Crop editor");
  });

  test("a diagram drawn across two panels has its words on each", async ({ page }) => {
    await openSite(page, "#read/beinecke/70r2/text");
    await textReady(page);
    for (const [img, n] of [["f70r2-1", 161], ["f70r2-2", 81]])
      await expect(page.locator(`#rd-zoomer .seg:has(img[data-key="${img}"]) .wb[data-k^="f70r2|"]`), img).toHaveCount(n);
  });

  test("a panel shown upside down, as it is bound, turns its words with it", async ({ page }) => {
    await openSite(page, "#read/beinecke/86v5/text");
    await textReady(page);
    const seg = page.locator('#rd-zoomer .seg[data-page="f85r2"]');
    await expect(seg.locator(".wb")).toHaveCount(160);
    await expect(seg.locator(".seg-words")).toHaveAttribute("style", /rotate\(180deg\)/);
  });

  test("a word written with a rare form of a letter says so, since its count and places take every form", async ({ page }) => {
    await openSite(page, "#read/beinecke/30r/text?w=f30r.1.9");   // RF1b code Ac: a rare o
    await expect(page.locator("#rd-text .tx-say")).toContainText("more times", { timeout: 15_000 });
    await expect(page.locator("#rd-text .tx-form")).toContainText("rare form of o");
  });

  test("a word whose place is estimated from the words beside it is drawn dashed and says so", async ({ page }) => {
    await openSite(page, "#read/beinecke/57v/text");
    await textReady(page);
    const est = page.locator("#rd-zoomer .wb.est").first();   // a ring word the ink fit could not find (tools/text/inkfit.py)
    await expect(est).toBeAttached();
    await est.hover({ force: true });
    await expect(page.locator("#tx-tip")).toContainText("place estimated");
    expect(await page.locator("#rd-zoomer .seg-words .out.hov:not(.u)").evaluate(e => getComputedStyle(e).strokeDasharray)).not.toBe("none");
  });

  test("a foldout's panels show their text when unfolded", async ({ page }) => {
    await openSite(page, "#read/beinecke/69r/text");
    await textReady(page);
    await expect(page.locator("#rd-text .tx-folded")).toContainText("68v3, 68v2");
    await page.keyboard.press("u");
    await expect(page.locator("#rd-text .tx-page h3")).toHaveText(["68v3", "68v2", "68v1", "69r"], { timeout: 10_000 });
  });

  test("the Rosettes open out over the pages with their text beside them, and their words can be chosen there", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/85r2/text");
    await textReady(page);
    await page.keyboard.press("u");
    await expect(page.locator("#rd-stage .sv-over")).toBeVisible();
    await expect(page.locator("#rd-text .tx-page h3")).toHaveText(["Rosettes"]);
    await expect(page.locator("#rd-stage .sv-over .wb")).toHaveCount(530);   // Placa's positions carried to RF1b, gaps filled
    await page.locator('#rd-text .w[data-k="fRos|1|0"]').click();
    await expect(page.locator("#rd-text .tx-where")).toHaveText("Rosettes · line 2");
    await expect(page.locator("#rd-stage .sv-over .seg-words .out.sel")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.locator("#rd-stage .sv-over")).toHaveCount(0);
    await expect(page.locator("#rd-text .tx-page h3").first()).toHaveText("85r2");
  });
});

test.describe("the Rosettes read from the photograph", () => {
  test("a Rosettes word shows Claude's reading beside RF1b, said for what it is", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/85r2/text");
    await textReady(page);
    await page.keyboard.press("u");
    await expect(page.locator("#rd-stage .sv-over")).toBeVisible();
    await page.locator('#rd-text .w[data-k="fRos|1|3"]').click();
    const line = page.locator("#rd-text .tx-photo");
    await expect(line).toContainText("Read from the photograph by Claude");
    await expect(line).toContainText("confidence");
    await expect(line.locator(".tx-i")).toHaveAttribute("title", /not checked by a person/);
  });
});

test.describe("searching by glyphs", () => {
  test("the glyph keyboard types a word by its shapes, shows it back in glyphs, and the lines can be read in glyphs", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=qokeedy");
    await results(page);
    await page.locator("#sx-kb").click();
    await expect(page.locator("#sx-pal")).toBeVisible();
    await page.locator("#sx-q").fill("");
    for (const e of ["ch", "o", "l"]) await page.locator(`#sx-pal .sx-pal-g button[aria-label="Eva ${e}"]`).click();
    await expect(page.locator("#sx-q")).toHaveValue("chol");
    await expect(page.locator("#sx-qg")).not.toHaveText("");        // the query, drawn in the manuscript's glyphs
    await page.locator("#sx-pal button", { hasText: "⌫" }).click();
    await expect(page.locator("#sx-q")).toHaveValue("cho");          // takes back a whole glyph
    await page.locator('#sx-pal .sx-pal-g button[aria-label="Eva l"]').click();
    await page.locator("#sx-pal button.primary", { hasText: "Search" }).click();
    await expect(page.locator("#sx-echo")).toContainText("chol");
    await page.locator(".sx-script button", { hasText: "Glyphs" }).click();
    await expect(page.locator("#sx-res")).toHaveClass(/glyph/);
    expect(await page.locator("#sx-res .sx-t").first().evaluate(e => getComputedStyle(e).fontFamily)).toContain("Voynich VV");
    await page.locator(".sx-script button", { hasText: "Eva" }).click();
    await expect(page.locator("#sx-res")).not.toHaveClass(/glyph/);
  });

  test("a word's glyphs on the page can be picked, one or a run, to find them in other words", async ({ page }) => {
    await page.route("https://collections.library.yale.edu/**", fromYale);
    await openSite(page, "#read/beinecke/2r/text?w=f2r.5.4");
    await expect(page.locator("#rd-text .tx-reading .tx-g")).toHaveCount(3);   // chol: ch, o, l
    await page.locator('#rd-text .tx-reading .tx-g[data-i="1"]').click();
    await page.locator('#rd-text .tx-reading .tx-g[data-i="2"]').click({ modifiers: ["Shift"] });
    await expect(page.locator("#rd-text .tx-reading .tx-g.on")).toHaveCount(2);
    const find = page.locator("#rd-text .tx-gfind .tx-link").first();
    await expect(find).toHaveText("ending words");
    await find.click();   // Find, in the panel: the pattern *ol
    await expect(page.locator("#rd-text .tx-find-in")).toHaveValue("*ol");
    await expect(page.locator("#rd-text .tx-fmodes")).toContainText("A pattern");
    await expect(page.locator("#rd-text .tx-fwi.on .tx-fw .e")).toHaveText("ol");   // the most frequent word ending in ol
    await expect(page.locator("#rd-text .tx-fws .tx-fw .e").nth(1)).toHaveText("chol");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#read/beinecke/2r/text?find=*ol&fw=ol");
  });
});

test.describe("the Text tab", () => {
  test("opens on an example, says the count in a sentence, and narrows step by step", async ({ page }) => {
    await openSite(page, "#text/beinecke/search");
    await results(page);
    const echo = page.locator("#sx-echo");
    await expect(echo).toContainText("daiin appears 836 times on 205 of 227 pages");   // in RF1b, the default reading
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
    await expect(echo).toContainText("qokeedy appears 306 times");
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
    await expect(page.locator(".tx-step")).toContainText("Result 3 of 30", { timeout: 15_000 });
    await expect(page.locator("#rd-text .tx-where")).toHaveText("3r · line 3");
    await expect(page.locator("#rd-text .tx-reading .lt")).toHaveText("chol daiin");
    await page.locator('.tx-step button[aria-label="Next result"]').click();
    await expect(page.locator(".tx-step")).toContainText("Result 4 of 30", { timeout: 15_000 });
    await page.locator(".tx-step a", { hasText: "All results" }).click();
    await expect(page.locator("#v-text")).toBeVisible();
  });

  test("a query it cannot read is answered in plain words", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=Qok");
    await expect(page.locator("#sx-echo .sx-err")).toContainText("Capitals stand for whole words");
  });

  test("Compare: a second search beside the first, in blue, in the count, the strip, every filter and the lines (docs/text/TEXT_TAB_AUDIT.md)", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=qokeedy&cmp=qokedy");
    await results(page);
    const echo = page.locator("#sx-echo");
    await expect(echo).toContainText("qokeedy appears 306 times on 56 of 227 pages");
    await expect(echo.locator(".sx-cmpsay")).toContainText("qokedy appears 270 times on 63 of 227 pages");
    await expect(page.locator("#sx-cmp-s")).toHaveText("Compared with qokedy");
    await expect(page.locator(".sx-bars")).toHaveClass(/two/);
    expect(await page.locator(".sx-bar i.cmp:not(.z)").count()).toBe(62);   // 63 pages, two of them panels of one side
    // each filter row gives both counts
    await expect(page.locator(".sx-frow", { hasText: "Recipes" }).locator(".n")).toHaveText("(133 · 60)");
    await expect(page.locator(".sx-frow", { hasText: "Pharmaceutical" }).locator(".n")).toHaveText("(0 · 1)");
    // a page's heading gives both, and a line holds both searches' marks, the second's in blue
    await expect(page.locator(".sx-pg[data-page=f26r] header")).toContainText("3 · 6");
    const l5 = page.locator(".sx-pg[data-page=f26r] .sx-line", { hasText: "saiin shedy chdy chdy" });
    await expect(l5.locator("em:not(.b)")).toHaveText("qokeedy");
    await expect(l5.locator("em.b")).toHaveText("qokedy");
    // a line the first search has nothing on opens in the Reader without a result number
    const only = page.locator(".sx-line.sx-cmp-only").first();
    expect(await only.getAttribute("href")).not.toContain("hit=");
    // the i: lines with both
    await page.locator(".sx-why summary").click();
    await expect(page.locator(".sx-why-m")).toContainText("41 lines hold both");
    // narrowing applies to both; Remove takes the second away
    await page.locator(".sx-frow", { hasText: "Recipes" }).click();
    await expect(echo.locator(".sx-cmpsay")).toContainText("qokedy appears 60 times");
    await page.locator("#sx-cmp-s").click();
    await expect(page.locator("#sx-cmp-q")).toBeFocused();
    await expect(page.locator("#sx-cmp-q")).toHaveValue("qokedy");
    await page.locator(".sx-cmp-rm").click();
    await expect(echo.locator(".sx-cmpsay")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => location.hash)).not.toContain("cmp=");
  });

  test("the popovers (More options, Compare) close on a click elsewhere or Esc, and stay inside a narrow window", async ({ page }) => {
    await page.setViewportSize({ width: 750, height: 553 });
    await openSite(page, "#text/beinecke/search?q=qokeedy");
    await results(page);
    await page.locator(".sx-more-opts > summary").click();
    await expect(page.locator(".sx-more-opts")).toHaveAttribute("open", "");
    await expect.poll(async () => { const b = await page.locator(".sx-more-m").boundingBox(); return b.x + b.width; }, { message: "the popover's right edge" }).toBeLessThanOrEqual(750);
    await page.locator("#sx-cmp-s").click();   // one open at a time
    await expect(page.locator(".sx-more-opts")).not.toHaveAttribute("open", "");
    await expect(page.locator("#sx-cmp-d")).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(page.locator("#sx-cmp-d")).not.toHaveAttribute("open", "");
    await page.locator("#sx-cmp-s").click();
    await page.locator(".sx-res-h .sx-opt > span").click();   // anywhere outside it
    await expect(page.locator("#sx-cmp-d")).not.toHaveAttribute("open", "");
    expect(await page.evaluate(() => document.querySelector("#v-text").scrollLeft), "nothing scrolled sideways").toBe(0);
  });

  test("a page clicked in the strip is shown even when its results are past the first 150; nothing found draws no strip and no filters", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=qokeedy");
    await results(page);
    expect(await page.locator(".sx-pg").count()).toBeLessThan(40);
    await page.locator('.sx-bar[aria-label^="116r"]').dispatchEvent("click");
    await expect(page.locator(".sx-pg[data-page=f116r]")).toBeVisible();
    await expect(page.locator(".sx-pg[data-page=f116r]")).toHaveClass(/flash/);
    await page.evaluate(() => { location.hash = "#text/beinecke/search?q=qokqz"; });
    await expect(page.locator("#sx-echo")).toContainText("qokqz appears nowhere");
    await expect(page.locator("#sx-strip")).toBeEmpty();
    await expect(page.locator("#sx-facets")).toBeEmpty();
  });

  test("any transcriber: a word twice in one line counts twice, and both are marked", async ({ page }) => {
    await openSite(page, "#text/beinecke/search?q=qokeedy&in=all");
    await results(page);
    await expect(page.locator("#sx-echo")).toContainText("qokeedy appears 320 times");
    await expect(page.locator(".sx-pg[data-page=f26r] .sx-line", { hasText: "daiin shedy" }).locator("em")).toHaveCount(2);
  });

  test("#text alone opens the search with a whole address", async ({ page }) => {
    await openSite(page, "#text");
    await results(page);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#text/beinecke/search");
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
  test("a saved search goes into the progress file, version 3, and comes back from it", async ({ page, browser, baseURL }) => {
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
    expect(file.version).toBe(3);
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
});
