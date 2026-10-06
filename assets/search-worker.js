/* Text's search, off the page's thread (a module worker started by search.js), so that a slow pattern never holds the
   page up: search.js stops it after a few seconds. It loads the consensus of every line (data/text/index.json) and,
   when asked, a transcriber's lines (data/text/w/<code>.json), and returns where the query matches in each. */
import { parse, compile, nearCost, QueryError } from "./query.js";

const BASE = new URL("../data/text/", import.meta.url).href;
let IX = null;
const LINES = {};
async function json(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function lines(who) {
  if (!IX) IX = (await json("index.json")).loci;
  if (who === "cons") return (LINES.cons ||= IX.map(r => r[2]));
  if (!LINES[who]) LINES[who] = (await json(`w/${who}.json`)).lines;
  return LINES[who];
}

/* a plain word with near matches on: the words of the readings searched that are within so many edits of it */
function nearWords(word, near, all) {
  const seen = new Set(), out = [];
  for (const L of all) for (const l of L) for (const w of l.split(".")) {
    if (!w || seen.has(w)) continue;
    seen.add(w);
    if (Math.abs(w.replace(/,/g, "").length - word.length) <= near && nearCost(w.replace(/,/g, ""), word) <= near) out.push(w);
  }
  return out.sort((a, b) => nearCost(a.replace(/,/g, ""), word) - nearCost(b.replace(/,/g, ""), word) || a.localeCompare(b));
}

onmessage = async ({ data: m }) => {
  try {
    const p = parse(m.q);
    const all = {};
    for (const who of m.who) all[who] = await lines(who);
    let re = compile(p, m.opts), near = null;
    const it = p.items[0];
    if (m.opts.near > 0 && p.items.length === 1 && it.kind === "word" && it.whole && it.parts[0].every(x => x.k === "lit")) {
      const word = it.parts[0].map(x => x.s).join("");
      near = nearWords(word, m.opts.near, Object.values(all));
      const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      re = new RegExp(`(?<![^.,])(?:${near.map(esc).join("|") || esc(word)})(?![^.,])`, "g");
    }
    const hits = {};
    for (const [who, L] of Object.entries(all)) {
      const out = [];
      if (re) for (let i = 0; i < L.length; i++) {
        const l = L[i];
        if (!l) continue;
        re.lastIndex = 0;
        let x;
        while ((x = re.exec(l))) {
          if (!x[0].length) { re.lastIndex++; continue; }
          out.push(i, x.index, x[0].length);
        }
      }
      hits[who] = new Int32Array(out);
    }
    postMessage({ id: m.id, hits, near }, Object.values(hits).map(a => a.buffer));
  } catch (e) {
    postMessage({ id: m.id, error: e.message, mine: e instanceof QueryError || e instanceof SyntaxError });
  }
};
