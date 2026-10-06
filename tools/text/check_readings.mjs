// Rebuild every transcriber's reading of every locus as the site does (assets/text.js, readingOf), and check it against
// their own line (data/text/w), except where the build kept the line itself (x). Run by test_text.py:
//   node tools/text/check_readings.mjs   -> prints {"checked": n, "wrong": [[locus, witness], ...]}
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
globalThis.store = { get: (k, d) => d, set() {} };   // what text.js takes from app.js when it loads
globalThis.TextUI = { wanted: null };
const tmp = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "vv-")), "text.mjs");
fs.copyFileSync(path.join(ROOT, "assets/text.js"), tmp);
const { Data, readingOf } = await import(pathToFileURL(tmp).href);
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, "data/text", f)));
Data.meta = read("meta.json");
Data.glyphs = read("glyphs.json").glyphs;
const ids = read("index.json").loci.map(r => r[0]);
const pos = new Map(ids.map((id, i) => [id, i]));
const W = {};
for (const f of fs.readdirSync(path.join(ROOT, "data/text/w"))) { const d = read("w/" + f); W[d.witness] = d.lines; }
const norm = s => s.replace(/@221;/g, "a").replace(/@222;/g, "y").replace(/[.,]+(?=[.,])/g, "").replace(/^[.,]+|[.,]+$/g, "");
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function matches(rebuilt, line) {
  const r = norm(rebuilt), want = norm(line);
  if (r === want) return true;
  const parts = r.split(/\[([^\]]*)\]/);
  return new RegExp("^" + parts.map((x, k) => k % 2 ? "(?:" + x.split(":").map(esc).join("|") + ")" : esc(x)).join("") + "$").test(want);
}
let checked = 0;
const wrong = [];
for (const f of fs.readdirSync(path.join(ROOT, "data/text/pages"))) {
  for (const loc of read("pages/" + f).loci) {
    for (const who of Object.keys(W)) {
      const rd = readingOf(loc, who);
      if (!rd || (loc.x && who in loc.x)) continue;
      checked++;
      const got = rd.map((w, i) => w.text + (i < rd.length - 1 ? w.next : "")).join("");
      if (!matches(got, W[who][pos.get(loc.id)])) wrong.push([loc.id, who]);
    }
  }
}
console.log(JSON.stringify({ checked, wrong }));
