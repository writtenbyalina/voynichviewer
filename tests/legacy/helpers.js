// Helpers for the "old data, new code" tests (see tests/legacy/README.md).
//
// What people have saved lives in their own browser, in two places:
//   localStorage    keys starting "vv:"  (bookmarks, your own orders, settings, the cookie choice)
//   IndexedDB       database "voynich-viewer": stores "crops" (your corners), "img" (your cut pictures) and "work" (a second copy of orders)
// plus the progress files they exported. Each release that people have used is frozen here as a "generation": a snapshot of
// exactly what that release wrote (storage.json) and the progress file it exported (progress.json).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const DIR = __dirname;

// ------------------------------------------------------------------ the frozen generations
const readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));

const versionOf = label => label.slice(1).split(".").map(Number);
const byVersion = (a, b) => { const [x, y] = [versionOf(a.generation), versionOf(b.generation)]; return x[0] - y[0] || x[1] - y[1]; };

/** Every frozen generation, oldest first (by version, not by the order in releases.json): { generation, rev, storage, progress, meta }. */
function generations() {
  return readJson(path.join(DIR, "releases.json")).sort(byVersion).map(g => ({
    ...g,
    dir: path.join(DIR, g.generation),
    storage: readJson(path.join(DIR, g.generation, "storage.json")),
    progress: readJson(path.join(DIR, g.generation, "progress.json")),
    meta: readJson(path.join(DIR, g.generation, "meta.json")),
  }));
}

/** The parts of a generation's storage a test usually wants, parsed. */
function parsed(storage) {
  const ls = k => (storage.localStorage[k] == null ? null : JSON.parse(storage.localStorage[k]));
  const stores = Object.fromEntries(Object.entries(storage.indexedDB.stores).map(([n, e]) => [n, Object.fromEntries(e)]));
  return { ls, orders: ls("vv:mine") || [], bookmarks: ls("vv:bookmarks") || [], crops: stores.crops || {}, images: stores.img || {}, work: stores.work || {} };
}

const clone = v => JSON.parse(JSON.stringify(v));

// Crops saved under a panel key that a later release retired are carried to the panels that replaced it (Crops.carry in
// assets/work.js). So the crops a visitor from that generation has TODAY are: those for panels that still exist, plus these.
const MIGRATIONS = { "v1.0": { retired: ["f70r2", "f70v2"], carried: ["f70r2-1", "f70v2-2", "f70v2-1"] } };
/** The crop keys, and how many crops, a generation's visitor holds once the current site has opened their browser. */
function cropsToday(g) {
  const m = MIGRATIONS[g.generation] || { retired: [], carried: [] };
  const retired = m.retired.filter(k => g.meta.cropKeys.includes(k));
  const keys = [...g.meta.cropKeys.filter(k => !retired.includes(k)), ...(retired.length ? m.carried : [])];
  return { keys, count: keys.length, retired };
}

// ------------------------------------------------------------------ serving a past release's code
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css; charset=utf-8" };
const shown = new Map();
function gitShow(rev, file) {
  const k = rev + ":" + file;
  if (!shown.has(k)) {
    try { shown.set(k, execFileSync("git", ["show", k], { cwd: ROOT, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] })); }
    catch { shown.set(k, null); }
  }
  return shown.get(k);
}
/** A data file as it was at a git revision, parsed (null if the revision or the file is not there). */
function readAtRevision(rev, file) {
  const body = gitShow(rev, file);
  return body ? JSON.parse(body.toString("utf8")) : null;
}
function revisionAvailable(rev) {
  try { execFileSync("git", ["cat-file", "-e", rev + "^{commit}"], { cwd: ROOT, stdio: "ignore" }); return true; } catch { return false; }
}

/**
 * Make the page load the site's code (index.html and assets/) from git revision `code`, and codex.json, orders.json and
 * changelog.json from `data`. "worktree" means the files as they are now. Page pictures always come from the working tree.
 *   serveRevision(page, { code: rev, data: rev })        a past release, exactly as it was
 *   serveRevision(page, { code: rev, data: "worktree" })  yesterday's cached scripts talking to today's data files
 */
async function serveRevision(page, { code = "worktree", data = "worktree" } = {}) {
  await page.route(url => !/^https?:\/\/(?!127\.0\.0\.1|localhost)/.test(url.toString()), route => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, "") || "index.html";
    const isCode = p === "index.html" || p.startsWith("assets/");
    const isData = /^data\/(codex|orders|changelog)\.json$/.test(p);
    const rev = isCode ? code : isData ? data : "worktree";
    if (rev === "worktree") return route.fallback();
    const body = gitShow(rev, p);
    if (!body) return route.fulfill({ status: 404, body: `${p} did not exist in ${rev}` });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(p)] || "application/octet-stream", body, headers: { "cache-control": "no-store" } });
  });
}

// ------------------------------------------------------------------ Yale's photograph, stood in for
/** Yale's image server is never reached from tests. A small picture from the site stands in for the photograph. */
async function standInForYale(page) {
  const jpg = fs.readFileSync(path.join(ROOT, "data/panels/f1r_s.jpg"));
  await page.route("https://collections.library.yale.edu/**", route => route.fulfill({
    status: 200, contentType: "image/jpeg", body: jpg, headers: { "access-control-allow-origin": "*" } }));
}

// ------------------------------------------------------------------ reading and writing a browser's saved data
/**
 * Everything the site has saved in this browser, as plain JSON:
 *   { localStorage: { "vv:bookmarks": "<the stored string>", ... },
 *     indexedDB: { name, version, stores: { crops: [[key, value], ...], img: [[key, { $blob: base64, type }]], work: [...] } } }
 * The page must be on the site's origin.
 */
function dumpStorage(page) {
  return page.evaluate(async () => {
    const b64 = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(blob); });
    const enc = async v => (v instanceof Blob ? { $blob: await b64(v), type: v.type } : v);
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("vv:")) ls[k] = localStorage.getItem(k); }
    const db = await new Promise((res, rej) => { const r = indexedDB.open("voynich-viewer"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const stores = {};
    for (const name of db.objectStoreNames) {
      const st = db.transaction(name, "readonly").objectStore(name);
      const [keys, vals] = await Promise.all([
        new Promise(r => { const q = st.getAllKeys(); q.onsuccess = () => r(q.result); }),
        new Promise(r => { const q = st.getAll(); q.onsuccess = () => r(q.result); }),
      ]);
      stores[name] = [];
      for (let i = 0; i < keys.length; i++) stores[name].push([keys[i], await enc(vals[i])]);
      stores[name].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    }
    const version = db.version;
    db.close();
    return { localStorage: ls, indexedDB: { name: "voynich-viewer", version, stores } };
  });
}

/**
 * Put a snapshot into a browser that has never seen the site, as if the visitor had used it before. Does it from a blank
 * page on the site's origin, before the site's own code runs. `indexedDB: null` leaves no database at all.
 */
async function seedStorage(page, snapshot) {
  await page.route(url => new URL(url).pathname === "/__seed__", r => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>seed</title>" }));
  await page.goto("/__seed__");
  await page.evaluate(async snap => {
    const dec = v => (v && v.$blob !== undefined ? new Blob([Uint8Array.from(atob(v.$blob), c => c.charCodeAt(0))], { type: v.type }) : v);
    localStorage.clear();
    for (const [k, v] of Object.entries(snap.localStorage || {})) localStorage.setItem(k, v);
    await new Promise(res => { const r = indexedDB.deleteDatabase("voynich-viewer"); r.onsuccess = res; r.onerror = res; r.onblocked = res; });
    if (!snap.indexedDB) return;
    const { name, version, stores } = snap.indexedDB;
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(name, version);
      r.onupgradeneeded = () => { for (const s of Object.keys(stores)) r.result.createObjectStore(s); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    for (const [s, entries] of Object.entries(stores)) {
      const tx = db.transaction(s, "readwrite");
      for (const [k, v] of entries) tx.objectStore(s).put(dec(v), k);
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    }
    db.close();
  }, snapshot);
}

// ------------------------------------------------------------------ the progress file
/** Click Export in "Your work" and read the file it downloads. */
async function exportProgress(page) {
  if (!(await page.locator("#work-dlg").isVisible().catch(() => false))) await page.locator("#cx-work").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export progress file/ }).click()]);
  const file = path.join(fs.mkdtempSync(path.join(require("os").tmpdir(), "vv-")), download.suggestedFilename());
  await download.saveAs(file);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Import a progress file through "Your work", then wait until the site holds the counts that file should give. */
async function importProgress(page, file, want) {
  if (!(await page.locator("#work-dlg").isVisible().catch(() => false))) await page.locator("#cx-work").click();
  await page.locator("#work-dlg input[type=file]").setInputFiles(file);
  if (want) {
    await page.waitForFunction(w => MyOrders.list.length >= w.orders && Bookmarks.list.length >= w.bookmarks && Crops.mine.size >= w.crops && !Crops.pending.size,
      want, { timeout: 20_000 });
  } else await page.waitForTimeout(600);
}

// ------------------------------------------------------------------ comparing the shape of saved data
// A "shape" lists every path in the data and what types of value are found there. A new release may ADD paths; it may not
// remove one or change what kind of value is there, because people's saved data (and old progress files) have the old shape.
// MAPS are places where the keys are data (a sheet id, a panel key), not part of the format: their children are merged.
const MAPS = [
  "localStorage.vv:3d:hidden", "localStorage.vv:mine[].gatherings[].sheets",
  "indexedDB.crops", "indexedDB.img", "indexedDB.work.orders[].gatherings[].sheets",
  "progress.orders[].gatherings[].sheets", "progress.crops",
];
const typeOf = v => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

function shapeOf(value, at = "", out = new Map()) {
  const add = (p, t) => { if (!out.has(p)) out.set(p, new Set()); out.get(p).add(t); };
  add(at, typeOf(value));
  if (Array.isArray(value)) for (const v of value) shapeOf(v, at + "[]", out);
  else if (value && typeof value === "object") {
    if (value.$blob !== undefined) { out.get(at).delete("object"); add(at, "blob"); return out; }
    const asMap = MAPS.includes(at);
    for (const [k, v] of Object.entries(value)) shapeOf(v, `${at}${at ? "." : ""}${asMap ? "*" : k}`, out);
  }
  return out;
}

/** The saved data of one browser as a tree to take the shape of: localStorage values parsed, IndexedDB as store -> key -> value. */
function storageTree(storage) {
  const ls = {};
  for (const [k, v] of Object.entries(storage.localStorage)) { try { ls[k] = JSON.parse(v); } catch { ls[k] = v; } }
  const idb = {};
  for (const [name, entries] of Object.entries(storage.indexedDB?.stores || {})) idb[name] = Object.fromEntries(entries);
  return { localStorage: ls, indexedDB: idb };
}

/** What an old shape needs that the new one no longer gives: paths that went away and paths whose kind of value changed. */
function brokenBy(oldShape, newShape) {
  const problems = [];
  for (const [p, types] of oldShape) {
    if (!newShape.has(p)) { problems.push(`${p} is no longer saved`); continue; }
    const now = newShape.get(p);
    const lost = [...types].filter(t => t !== "null" && !now.has(t));
    if (lost.length) problems.push(`${p} was ${[...types].join("/")}, is now ${[...now].join("/")}`);
  }
  return problems;
}
const addedBy = (oldShape, newShape) => [...newShape.keys()].filter(p => !oldShape.has(p));

module.exports = {
  ROOT, DIR, byVersion, generations, parsed, clone, MIGRATIONS, cropsToday, revisionAvailable, readAtRevision, serveRevision, standInForYale,
  dumpStorage, seedStorage, exportProgress, importProgress, shapeOf, storageTree, brokenBy, addedBy,
};
