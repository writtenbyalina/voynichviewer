#!/usr/bin/env node
// Freeze what a release of the site saves, so later versions can be tested against it.
//
//   node tests/legacy/capture.js v1.2            captures the current commit (HEAD), the release you just made
//   node tests/legacy/capture.js v1.0 d9dd62d    captures an older commit
//
// It opens the release's own code (taken from git, exactly as committed) in a browser, runs tests/legacy/scenario.js, and
// writes tests/legacy/<label>/{storage,progress,meta}.json and adds the release to tests/legacy/releases.json.
// Commit those files. Run it for every release whose way of saving things people may still have in their browsers.
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("@playwright/test");
const { ROOT, DIR, byVersion, serveRevision, standInForYale, revisionAvailable } = require("./helpers");
const { buildScenario } = require("./scenario");

const [label, revArg = "HEAD"] = process.argv.slice(2);
if (!/^v\d+\.\d+$/.test(label || "")) { console.error("usage: node tests/legacy/capture.js v1.2 [git revision, default HEAD]"); process.exit(1); }
if (!revisionAvailable(revArg)) { console.error(`git has no revision "${revArg}"`); process.exit(1); }
const rev = execFileSync("git", ["rev-parse", revArg], { cwd: ROOT }).toString().trim();

(async () => {
  const port = 4190 + Math.floor(Math.random() * 50);
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    const context = await browser.newContext({ baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1360, height: 860 }, reducedMotion: "reduce", acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()) && !/yale\.edu/.test(url.toString()), r => r.abort());
    await serveRevision(page, { code: rev, data: rev });
    await standInForYale(page);
    await page.goto("/index.html#read/beinecke/78v");
    const { progress, storage, meta } = await buildScenario(page);
    if (errors.length) throw new Error("the site raised errors while the scenario ran:\n" + errors.join("\n"));

    const dir = path.join(DIR, label);
    fs.mkdirSync(dir, { recursive: true });
    const write = (f, v) => fs.writeFileSync(path.join(dir, f), JSON.stringify(v, null, 1) + "\n");
    write("storage.json", { generation: label, rev, ...storage });
    write("progress.json", progress);
    write("meta.json", { generation: label, rev, capturedWith: "tests/legacy/capture.js", ...meta });

    const file = path.join(DIR, "releases.json");
    const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    const entry = { generation: label, rev };
    const i = list.findIndex(g => g.generation === label);
    if (i >= 0) list[i] = entry; else list.push(entry);
    fs.writeFileSync(file, JSON.stringify(list.sort(byVersion), null, 1) + "\n");

    const kb = n => Math.round(n / 102.4) / 10;
    console.log(`${label} (${rev.slice(0, 7)}): ${meta.orders} orders, ${meta.bookmarks} bookmarks, ${meta.crops} crops`);
    console.log(`  storage.json ${kb(fs.statSync(path.join(dir, "storage.json")).size)} KB, progress.json ${kb(fs.statSync(path.join(dir, "progress.json")).size)} KB`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
