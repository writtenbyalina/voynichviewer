// Site checks: no browser needed. Does the page point at files that exist, do the scripts even parse, is the repository
// in a state GitHub Pages can publish? A typo in a file name, a half-saved script or a forgotten vendor file shows up here,
// in a second, instead of as a blank page on voynichviewer.com.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const exists = rel => fs.existsSync(path.join(ROOT, rel));

// the page's own references, with the commented-out parts removed first
const source = html.replace(/<!--[\s\S]*?-->/g, "");
const refs = [...source.matchAll(/<(link|script|img|a)\b[^>]*?\b(href|src)="([^"]*)"/g)].map(m => ({ tag: m[1], url: m[3] }));
const local = refs.filter(r => r.url && !/^(https?:|mailto:|#|data:|javascript:)/.test(r.url));

test.describe("index.html", () => {
  test("every local file it links to exists (scripts, styles, icons)", () => {
    expect(local.length, "found no local references: is the page parsed right?").toBeGreaterThan(4);
    const missing = local.filter(r => !exists(r.url.split(/[?#]/)[0])).map(r => `<${r.tag}> ${r.url}`);
    expect(missing).toEqual([]);
  });

  test("ids are unique and the containers the app fills in are there", () => {
    const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, "duplicate ids").toEqual([]);
    for (const id of ["cx-top", "cx-tabs", "cx-order", "cx-main", "v-read", "v-three", "v-info", "cx-toast", "cx-bug-dlg", "cx-new-dlg", "cx-help-dlg", "cx-ver", "cx-bm", "cx-work", "cx-help", "cx-bug"]) {
      expect(ids, `#${id} is needed by assets/app.js`).toContain(id);
    }
  });

  test("it has the basics a search engine, a phone and a screen reader need", () => {
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toMatch(/<html[^>]*\blang="en"/);
    expect(html).toMatch(/<meta name="viewport"[^>]*width=device-width/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}"/);
  });

  test("the scripts load in the order the code relies on", () => {
    const scripts = [...source.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
    // work.js and arrange.js use globals from app.js, so they come after it
    expect(scripts.indexOf("assets/app.js")).toBeGreaterThanOrEqual(0);
    expect(scripts.indexOf("assets/work.js")).toBeGreaterThan(scripts.indexOf("assets/app.js"));
    expect(scripts.indexOf("assets/arrange.js")).toBeGreaterThan(scripts.indexOf("assets/work.js"));
  });
});

test.describe("scripts", () => {
  const classic = ["app.js", "work.js", "arrange.js", "privacy.js"];

  for (const f of classic) {
    test(`assets/${f} parses`, () => {
      expect(() => new vm.Script(fs.readFileSync(path.join(ROOT, "assets", f), "utf8"), { filename: f })).not.toThrow();
    });
  }

  test("assets/view3d.js (an ES module) and the vendored three.js parse", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vv-"));
    try {
      for (const f of ["view3d.js", "vendor/three.module.min.js", "vendor/three.core.min.js"]) {
        const tmp = path.join(dir, path.basename(f, ".js") + ".mjs");
        fs.copyFileSync(path.join(ROOT, "assets", f), tmp);
        try { execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" }); }
        catch (e) { throw new Error(`${f} does not parse:\n${e.stderr}`); }
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test("the module imports in view3d.js and three.js point at files that exist", () => {
    let found = 0;
    for (const file of ["view3d.js", "vendor/three.module.min.js"]) {
      const code = fs.readFileSync(path.join(ROOT, "assets", file), "utf8");
      for (const m of code.matchAll(/\bfrom\s*["'](\.[^"']+)["']/g)) {
        found++;
        expect(fs.existsSync(path.join(ROOT, "assets", path.dirname(file), m[1])), `${file} imports ${m[1]}`).toBe(true);
      }
    }
    expect(found, "found no imports: has the check stopped seeing them?").toBeGreaterThanOrEqual(2);
  });

  test("app.js loads view3d.js from a file that is there", () => {
    const js = fs.readFileSync(path.join(ROOT, "assets/app.js"), "utf8");
    const loaded = [...js.matchAll(/import\(\s*ASSETS\s*\+\s*["']([^"']+)["']\s*\)/g)].map(m => m[1]);
    expect(loaded, "app.js no longer imports a module next to itself: has the check stopped seeing it?").not.toHaveLength(0);
    for (const f of loaded) expect(exists("assets/" + f), `app.js imports ${f}`).toBe(true);
  });
});

test.describe("what GitHub Pages publishes", () => {
  test("CNAME names the custom domain and .nojekyll is there", () => {
    expect(exists("CNAME"), "CNAME").toBe(true);
    expect(fs.readFileSync(path.join(ROOT, "CNAME"), "utf8").trim()).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
    expect(exists(".nojekyll"), ".nojekyll (without it Pages may skip files)").toBe(true);
  });

  test("the icons and favicon exist and are real images", () => {
    for (const f of ["favicon.ico", "assets/favicon-32.png", "assets/icon-192.png", "assets/apple-touch-icon.png"]) {
      expect(exists(f), f).toBe(true);
      expect(fs.statSync(path.join(ROOT, f)).size, `${f} is empty`).toBeGreaterThan(100);
    }
    for (const f of ["assets/favicon-32.png", "assets/icon-192.png", "assets/apple-touch-icon.png"]) {
      const b = fs.readFileSync(path.join(ROOT, f));
      expect(b.subarray(1, 4).toString(), `${f} is not a PNG`).toBe("PNG");
    }
  });

  test("no file is big enough to trouble GitHub (it warns at 50 MB and refuses 100 MB)", () => {
    const big = [];
    const walk = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if ([".git", "node_modules", "playwright-report", "test-results", ".claude"].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (fs.statSync(p).size > 25 * 1024 * 1024) big.push(`${path.relative(ROOT, p)} (${Math.round(fs.statSync(p).size / 1048576)} MB)`);
      }
    };
    walk(ROOT);
    expect(big).toEqual([]);
  });

  test("the README's run-locally command and the layout it describes are still true", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    const layout = readme.match(/```\nindex\.html[\s\S]*?```/)?.[0] || "";
    const named = [...layout.matchAll(/^(\S+)\s{2,}/gm)].map(m => m[1]).filter(f => !f.endsWith("/") || f.length > 1);
    expect(named.length, "found no files in the README's Layout section: has the check stopped seeing it?").toBeGreaterThan(6);
    const gone = named.filter(f => !exists(f.replace(/\/$/, "")));
    expect(gone, "files the README's Layout section names that do not exist").toEqual([]);
  });
});
