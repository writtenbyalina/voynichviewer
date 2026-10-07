/* Text: the transcriptions of the manuscript, tied to its pages in the Reader (docs/text/REDESIGN.md). Point at any word
   on a page photograph for its reading; click it for the word panel. Loaded the first time the text opens (TextUI in
   app.js), and uses app.js's helpers (h, $, $$, store, toast, R, Reader, ...).

   The data is built offline by tools/text/ (docs/TEXT.md). For every line of the manuscript (a "locus", as IVTFF calls
   it: f1r.2 is the second line of f1r) it holds the consensus of independent transcriptions, voted glyph by glyph, and
   every reading wherever they differ. The text is Eva: names for shapes, not sounds. */

const DIR = "data/text/";
const got = new Map();   // path -> the promise of its JSON
export function load(path) {
  if (!got.has(path)) got.set(path, fetch(DIR + path).then(r => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }).catch(e => { got.delete(path); throw e; }));
  return got.get(path);
}

/* The transcribers, by the codes of Zandbergen's files and of the Landini-Stolfi interlinear (meta.json has the full
   names); RF and VT are references, shown but not voting. */
export const SHORT = { ZL: "Zandbergen & Landini", GC: "Claston", IT: "Takahashi", FG: "Friedman's group",
  CD: "Currier & D'Imperio", LU: "Stolfi", LV: "Grove", LT: "Tiltman", LL: "Latham", LP: "Petersen", LR: "Roe",
  LX: "Mardle", RF: "RF1", VT: "voynichese.com" };

export const Data = {
  meta: null, glyphs: null, ready: null,
  base() {
    return this.ready ||= Promise.all([load("meta.json"), load("glyphs.json")]).then(([m, g]) => {
      this.meta = m;
      this.glyphs = g.glyphs;
      this.names = new Map([...m.voters, ...m.references].map(v => [v.code, v.name]));
    }).catch(e => { this.ready = null; throw e; });
  },
  has(page) { return !!(this.meta && this.meta.lines[page]); },
  page(page) { return load(`pages/${encodeURIComponent(page)}.json`); },
};

/* The glyph font (Voynich VV, Claston's v101 font finished for Text: tools/font): the characters that draw each STA
   glyph, and, for a transcriber's reading (which the data keeps in Eva), the commonest glyph for each Eva letter. */
const chOf = code => (Data.glyphs[code] && Data.glyphs[code].ch) || "?";
let EVA_GLYPH = null;
function evaGlyphs(eva) {
  if (!EVA_GLYPH) {
    const best = new Map();
    const rank = c => /[0-9]/.test(c[1]) ? +c[1] : 10;   // the plain member of a family first (A1, K2), then the rest
    for (const [code, g] of Object.entries(Data.glyphs)) {
      if (!/^[a-z?]+$/.test(g.eva)) continue;
      const b = best.get(g.eva);
      if (!b || rank(code) < rank(b) || (rank(code) === rank(b) && code < b)) best.set(g.eva, code);
    }
    for (const [code, e] of Object.entries(Data.meta.rare_eva)) best.set(e, code);
    best.set("@221;", "Aa"); best.set("@222;", "Ab");
    EVA_GLYPH = { best, keys: [...best.keys()].sort((a, b) => b.length - a.length) };
  }
  let out = "";
  for (let i = 0; i < eva.length;) {
    const k = EVA_GLYPH.keys.find(k => eva.startsWith(k, i));
    if (k) { out += chOf(EVA_GLYPH.best.get(k)); i += k.length; } else { out += eva[i]; i++; }
  }
  return out;
}

/* What each kind of locus is called. IVTFF's locus types: P paragraph text, L labels, C text along a circle, R text
   along a radius. */
const KINDS = { P: ["Paragraphs", "line", "lines"], L: ["Labels", "label", "labels"], C: ["Rings", "ring", "rings"],
  R: ["Radii", "radius", "radii"] };
const kindOf = loc => KINDS[loc.t[0]] ? loc.t[0] : "P";
const plural = (n, k) => `${n} ${n === 1 ? KINDS[k][1] : KINDS[k][2]}`;

/* A locus as words of glyphs. The consensus comes twice: c in Eva and g in Zandbergen's STA codes, two characters a
   glyph (P2A3K1…), with the same separators; each glyph's Eva is its rare-glyph code or glyphs.json's. Offsets are
   into c, as the data's are. */
export function words(loc) {
  if (loc._words) return loc._words;
  const G = Data.glyphs, RE = Data.meta.rare_eva;
  const out = [];
  let cur = null, off = 0;
  for (const [t] of loc.g.matchAll(/[A-Z][0-9a-z%]|[.,]/g)) {
    if (t === ".") { cur = null; off++; continue; }
    if (!cur) out.push(cur = { off, toks: [] });
    if (t === ",") { cur.toks.push({ sep: true, off }); off++; continue; }
    const eva = RE[t] || (G[t] && G[t].eva) || "?";
    cur.toks.push({ code: t, eva, off, len: eva.length });
    off += eva.length;
  }
  for (const w of out) {
    const last = w.toks[w.toks.length - 1];
    w.end = last.off + (last.len || 1);
    w.eva = loc.c.slice(w.off, w.end);
  }
  return (loc._words = out);
}

/* Where the data keeps a column or a gap that is not everyone's: column start -> unit, offset -> the zero-width units
   there, offset -> the gap's status and each transcriber's mark (. space, , uncertain, 0 none, - drawing break). */
function lookup(loc) {
  if (loc._ix) return loc._ix;
  const unitAt = new Map(), emptyAt = new Map(), gapAt = new Map();
  for (const u of loc.u) {
    if (u[1] > 0) unitAt.set(u[0], u);
    else emptyAt.set(u[0], [...(emptyAt.get(u[0]) || []), u]);
  }
  for (const [o, st, m] of loc.s) {
    const marks = {};
    for (const [, n, v] of m.matchAll(/([A-Z]{2})([.,\-0])/g)) marks[n] = v === "-" ? "." : v === "0" ? "" : v;
    gapAt.set(o, { st, marks });
  }
  return (loc._ix = { unitAt, emptyAt, gapAt });
}
export const isRef = who => who === "RF" || who === "VT";
const present = (loc, who) => isRef(who) ? !!(loc.r && who in loc.r) : loc.w.includes(who);

/* how one transcriber reads a column: their reading, both readings of an alternative ([a:o]), or what they wrote
   where they did not vote (an unreadable ?, Claston's in-between glyph) */
function unitReading(u, who, cons) {
  if (isRef(who)) return u[4] && who in u[4] ? u[4][who] : cons;
  const rows = u[3].filter(r => r[2].split(" ").includes(who));
  if (!rows.length) return cons;
  return rows.length === 1 ? rows[0][0] : "[" + rows.map(r => r[0]).join(":") + "]";
}

/* One transcriber's reading of a locus, word by word of the consensus: the consensus, with their own reading of each
   column and gap the data keeps (the rest is everyone's). For each consensus word, { text, next }: text in Eva with
   their own spaces inside it (. or ,), next their mark at the break after it ("." where they agree that a word ends
   there, "," uncertain, "" joined). null if they did not transcribe this locus. */
export function readingOf(loc, who) {
  if (!present(loc, who)) return null;
  loc._rd ||= {};
  if (loc._rd[who]) return loc._rd[who];
  const { unitAt, emptyAt, gapAt } = lookup(loc);
  const c = loc.c, ws = words(loc);
  const out = ws.map(() => ({ text: "", next: "." }));
  const mark = (o, d) => { const g = gapAt.get(o); return g && who in g.marks ? g.marks[who] : d; };
  let wi = 0, i = 0;
  while (i <= c.length) {
    for (const u of emptyAt.get(i) || []) {   // a glyph only some read, with their space before it
      const t = unitReading(u, who, "");
      const b = t && u[5] ? (u[5].match(new RegExp(who + "([.,\\-0])")) || [])[1] : null;
      if (t) out[wi].text += (b === "." || b === "-" ? "." : b === "," ? "," : "") + t;
    }
    if (i === c.length) break;
    const ch = c[i];
    if (ch === ".") { out[wi].next = mark(i, "."); wi++; i++; continue; }
    if (ch === ",") { out[wi].text += mark(i, ","); i++; continue; }
    if (i > 0 && c[i - 1] !== "." && c[i - 1] !== "," && gapAt.has(i)) out[wi].text += mark(i, "");
    const u = unitAt.get(i);
    if (u) { out[wi].text += unitReading(u, who, c.slice(i, i + u[1])); i += u[1]; }
    else { out[wi].text += ch; i++; }
  }
  return (loc._rd[who] = out);
}
/* whether their reading of consensus word i differs from it, its breaks included */
const differs = (rd, ws, i) => rd[i].text !== ws[i].eva || (i < ws.length - 1 && rd[i].next !== ".") || (i > 0 && rd[i - 1].next !== ".");
/* their reading of word i as shown: spaces they put inside it, and a join with the word before or after */
function shownReading(rd, i) {
  const pre = i > 0 && rd[i - 1].next !== "." ? (rd[i - 1].next === "," ? "·" : "‿") : "";
  const post = i < rd.length - 1 && rd[i].next !== "." ? (rd[i].next === "," ? "·" : "‿") : "";
  return pre + (rd[i].text.replace(/\./g, " ").replace(/,/g, "·") || "–") + post;
}
/* what a reading says of the transcriber's own doubt */
function doubt(t) {
  const out = [];
  if (/\[/.test(t)) out.push("could not decide between two readings");
  if (/\?/.test(t)) out.push("could not read a glyph");
  if (/@22[12];/.test(t)) out.push("@221; and @222; are Claston's in-between glyphs: a circle-type glyph, not saying which");
  if (/·/.test(t)) out.push("was unsure of a space");
  return out.join("; ");
}
const ROUGH = "This transcriber's line lines up with the others only roughly here, so it is shown as it is, unmarked";
const ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const nth = k => ORD[k] || `${k + 1}th`;
const votes = v => Number.isInteger(v) ? String(v) : v.toFixed(1);

/* how often a word is in the consensus of the whole book, from index.json (loaded on first use) */
const Count = {
  map: null, loading: null,
  load() {
    return this.loading ||= load("index.json").then(ix => {
      const m = new Map();
      for (const [id, , c] of ix.loci) {
        const pg = id.slice(0, id.lastIndexOf("."));
        for (const w of c.split(".")) {
          let e = m.get(w);
          if (!e) m.set(w, e = { n: 0, pages: new Set() });
          e.n++; e.pages.add(pg);
        }
      }
      this.map = m;
    }).catch(e => { this.loading = null; throw e; });
  },
};

/* ---- word positions on the photographs (data/text/boxes, tools/text/boxes.py) ---- */
const Boxes = {
  pages: null,
  async list() {
    if (!this.pages) this.pages = new Set(await load("boxes/pages.json").catch(() => []));
    return this.pages;
  },
  /* page -> Map("li:wi" -> [x, y, w, h] in thousandths of the page image), or null when it has none */
  async of(page) {
    const list = await this.list();
    if (!list.has(page)) return null;
    const b = await load(`boxes/${encodeURIComponent(page)}.json`).catch(() => null);
    return b ? (b._map ||= new Map(b.words.map(([li, wi, ...r]) => [li + ":" + wi, r]))) : null;
  },
};

const DIFFER = "tpn";   // a split vote: a tie, the most votes without a majority, or nobody could read it
const key = (page, li, wi) => `${page}|${li}|${wi}`;
const unkey = k => { const [page, li, wi] = k.split("|"); return { page, li: +li, wi: +wi }; };
/* the columns of the vote inside word w of a locus */
function unitsIn(loc, w) {
  return loc.u.filter(u => u[1] ? u[0] >= w.off && u[0] < w.end : u[0] > w.off && u[0] < w.end);
}
/* the glyphs of a word where the vote is split */
const disputed = (loc, w) => unitsIn(loc, w).some(u => DIFFER.includes(u[2]));
const names = list => list.length < 3 ? list.join(" and ") : list.slice(0, -1).join(", ") + " and " + list[list.length - 1];

/* The word in one sentence: do the transcribers agree, and where not, how they split. */
function verdict(loc, w) {
  const us = unitsIn(loc, w), n = loc.w.length;
  const glyphs = w.toks.filter(t => !t.sep);
  const where = u => {
    if (!u[1]) return "a glyph between two others";
    const k = glyphs.findIndex(t => t.off >= u[0]);
    const span = glyphs.filter(t => t.off >= u[0] && t.off < u[0] + u[1]).length;
    return span > 1 ? `glyphs ${k + 1} to ${k + span}` : `the ${nth(k)} glyph`;
  };
  const read = r => r[0] ? h("b", { class: "mono" }, r[0].replace(/,/g, "·")) : "nothing";
  const votes_ = u => u[3].filter(r => r[1] > 0);
  const off = us.flatMap(u => u[3].filter(r => r[1] === 0)).map(r => SHORT[r[2]]);
  const split = us.filter(u => DIFFER.includes(u[2])), most = us.filter(u => u[2] === "m");
  if (n === 1) return [`Only ${Data.names.get(loc.w[0]) || SHORT[loc.w[0]]} transcribed this line.`];
  if (!split.length && !most.length)
    return off.length ? [`Everyone who could read it agrees. ${names([...new Set(off)])} could not read part of it.`] : [`All ${n} transcribers read it this way.`];
  if (split.length) {
    const u = split[0], v = votes_(u), out = [];
    if (u[2] === "n") out.push(`Nobody could read ${where(u)}.`);
    else if (u[2] === "t") out.push(`A tie on ${where(u)}: `, ...v.slice(0, 2).flatMap((r, i) => [i ? " and " : "", read(r)]), `, ${votes(v[0][1])} each. The tie goes to the transcriber who covered most of the book.`);
    else {
      const tot = v.reduce((a, r) => a + r[1], 0);
      out.push(`Transcribers differ on ${where(u)}: `, ...v.flatMap((r, i) => [i ? (i === v.length - 1 ? " and " : ", ") : "", `${votes(r[1])} of ${votes(tot)} read `, read(r)]), ".");
    }
    const more = split.length - 1 + most.length;
    if (more) out.push(` They differ on ${more} more glyph${more === 1 ? "" : "s"} too.`);
    return out;
  }
  const u = most[0], v = votes_(u), tot = v.reduce((a, r) => a + r[1], 0);
  const minority = v.slice(1).map(r => u[3].filter(x => x[0] === r[0]).flatMap(x => x[2].split(" ")).map(c => SHORT[c]));
  return [`Most agree: ${votes(v[0][1])} of ${votes(tot)} read it this way. `, ...v.slice(1).flatMap((r, i) => [i ? "; " : "", names(minority[i]), " read ", read(r), ` for ${where(u).replace(/^the /, "the ")}`]), most.length > 1 ? `, and they differ on ${most.length - 1} more.` : "."];
}

/* the characters of reading a that are not in b, marked (a plain LCS, enough for words) */
function diffMark(a, b) {
  const m = a.length, n = b.length, L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0, run = "", diff = false;
  const flush = () => { if (run) out.push(diff ? h("span", { class: "x" }, run) : run); run = ""; };
  while (i < m) {
    if (j < n && a[i] === b[j]) { if (diff) flush(); diff = false; run += a[i]; i++; j++; }
    else if (j < n && L[i][j + 1] >= L[i + 1][j]) j++;
    else { if (!diff) flush(); diff = true; run += a[i]; i++; }
  }
  flush();
  return out;
}

/* A sharp crop of a word from Yale's full-size photograph (the Reader already loads from Yale to zoom): the page crop's
   corners on the photograph (seg.quad) carry the word's box across. */
function cropUrl(seg, b, px = 656) {
  if (!seg || !seg.iiif || !seg.quad || seg.rotate || seg.custom) return null;
  const [q0, q1, q2, q3] = seg.quad;
  const at = (u, v) => [0, 1].map(k => (1 - u) * (1 - v) * q0[k] + u * (1 - v) * q1[k] + u * v * q2[k] + (1 - u) * v * q3[k]);
  const [x, y, w, hh] = b.map(v => v / 1000);
  const u0 = Math.max(0, x - w * .35), u1 = Math.min(1, x + w * 1.35), v0 = Math.max(0, y - hh * .9), v1 = Math.min(1, y + hh * 1.9);
  const pts = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  const X0 = Math.round(Math.min(...pts.map(p => p[0]))), X1 = Math.round(Math.max(...pts.map(p => p[0])));
  const Y0 = Math.round(Math.min(...pts.map(p => p[1]))), Y1 = Math.round(Math.max(...pts.map(p => p[1])));
  return `${YALE_IIIF}${encodeURIComponent(seg.iiif)}/${X0},${Y0},${X1 - X0},${Y1 - Y0}/${px},/0/default.jpg`;
}

const T = {
  el: null, onShow: "", gen: 0,
  font: store.get("text:font", "eva"),        // "eva" or "glyphs"
  dots: store.get("text:dots", true),         // mark the glyphs where transcribers disagree
  compare: null,                              // a transcriber's code: the page text shows their reading against the consensus
  loaded: new Map(),                          // page -> its data, for the pages on show
  boxes: new Map(),                           // page -> its word positions (or null)
  segs: new Map(),                            // page -> its codex panel, for the crop
  sel: null,                                  // the word chosen: "page|li|wi"
  hov: null,                                  // the word pointed at
  ask: null,                                  // a search result asked for in the address: { l, m, hit, seen }

  /* ---- following the Reader ---- */
  async sync() {
    const el = $("#rd-text");
    if (!el || el.hidden || !R.spreads) { this.undecorate(); return; }
    const shown = this.shown();
    const key_ = JSON.stringify([shown.map(x => x.page || x.folded), this.font, this.dots, this.compare]);
    if (!el.firstChild || el !== this.el) { this.el = el; this.frame(el); this.onShow = ""; }
    if (key_ === this.onShow) { this.decorate(); return; }
    this.onShow = key_;
    const gen = ++this.gen;
    if (!Data.meta) $(".tx-body", el).replaceChildren(h("p", { class: "tx-msg" }, "Loading the text…"));
    try {
      await Data.base();
      const pages = shown.filter(x => x.page && Data.has(x.page));
      const got_ = await Promise.all(pages.map(async x => [x.page, await Data.page(x.page), await Boxes.of(x.page)]));
      if (gen !== this.gen) return;
      this.loaded = new Map(got_.map(([p, d]) => [p, d]));
      this.boxes = new Map(got_.map(([p, , b]) => [p, b]));
      this.segs = new Map(pages.map(x => [x.page, x.seg]));
      this.shownNow = shown;
      if (this.sel && !this.loaded.has(unkey(this.sel).page)) { this.sel = null; setHash(); }
      this.show();
      this.decorate();
      this.light();
    } catch (e) {
      if (gen !== this.gen) return;
      this.onShow = "";
      $(".tx-body", el).replaceChildren(h("p", { class: "tx-msg" }, "The text could not be loaded (" + e.message + ")."));
    }
  },

  /* the pages on show, left to right, with the panels folded away inside them */
  shown() {
    const out = [];
    (R.spreads[R.at] || []).forEach((p, i) => {
      if (!p || p.lost) return;
      const side = i === 0 ? "L" : "R", open = R.unfold[side];
      const vis = Reader.pageParts(p, side, open).segs.filter(s => !s.missing);
      for (const seg of vis) out.push({ page: seg.page, seg, side: p });
      if (!open && !p.grid && p.segs.length > 1) {
        const folded = p.segs.filter(s => !s.missing && !vis.includes(s)).map(s => s.page);
        if (folded.length) out.push({ folded, side: p });
      }
    });
    return out;
  },

  frame(el) {
    el.replaceChildren(
      h("div", { class: "tx-grip", role: "separator", tabindex: "0", "aria-label": "Resize the text panel", "aria-orientation": "vertical" }),
      h("div", { class: "tx-head" }),
      h("div", { class: "tx-step", hidden: true, role: "navigation", "aria-label": "Search results" }),
      h("div", { class: "tx-body", tabindex: "-1" }));
    this.grip($(".tx-grip", el), el);
    const body = $(".tx-body", el);
    body.addEventListener("click", e => {
      const w = e.target.closest(".w[data-k]");
      if (w) this.pick(w.dataset.k);
    });
    body.addEventListener("keydown", e => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches(".w[data-k]")) { e.preventDefault(); this.pick(e.target.dataset.k); }
    });
    body.addEventListener("pointerover", e => { const w = e.target.closest(".w[data-k]"); if (w) this.hover(w.dataset.k, false); });
    body.addEventListener("pointerout", e => { if (e.target.closest(".w[data-k]") && !e.relatedTarget?.closest?.(".w[data-k]")) this.hover(null); });
    this.wireStage();
  },

  /* Drag the panel's edge to make it wider (beside the pages) or taller (below them, on a phone); arrow keys too. */
  grip(g, el) {
    const below = () => matchMedia("(max-width: 760px)").matches;
    const apply = () => {
      const s = store.get("text:size", null);
      el.style.removeProperty("--tx-w"); el.style.removeProperty("--tx-h");
      if (s && s.w) el.style.setProperty("--tx-w", s.w + "px");
      if (s && s.hh) el.style.setProperty("--tx-h", s.hh + "px");
      g.setAttribute("aria-orientation", below() ? "horizontal" : "vertical");
    };
    const set = (dim, v) => {
      const row = $("#rd-row").getBoundingClientRect();
      const s = { ...store.get("text:size", {}) };
      if (dim === "w") s.w = Math.round(Math.max(300, Math.min(row.width * .5, v)));
      else s.hh = Math.round(Math.max(140, Math.min(row.height - 140, v)));
      store.set("text:size", s);
      apply();
    };
    g.addEventListener("pointerdown", e => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect();
      const move = ev => below() ? set("hh", r.bottom - ev.clientY) : set("w", r.right - ev.clientX);
      const up = () => { g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
    });
    g.addEventListener("keydown", e => {
      const r = el.getBoundingClientRect(), d = e.shiftKey ? 80 : 20;
      if (below() && (e.key === "ArrowUp" || e.key === "ArrowDown")) set("hh", r.height + (e.key === "ArrowUp" ? d : -d));
      else if (!below() && (e.key === "ArrowLeft" || e.key === "ArrowRight")) set("w", r.width + (e.key === "ArrowLeft" ? d : -d));
      else return;
      e.preventDefault(); e.stopPropagation();
    });
    matchMedia("(max-width: 760px)").addEventListener("change", apply);
    apply();
  },

  /* ---- the words on the photographs ---- */
  /* A layer of word boxes over each page on show (inside the page, so it zooms and pans with it). Drawn again whenever
     the Reader draws the opening. */
  decorate() {
    for (const segEl of $$("#rd-zoomer .spread .seg[data-page]")) {
      const page = segEl.dataset.page, b = this.boxes.get(page), seg = this.segs.get(page);
      if (!b || !seg || seg.custom || seg.rot) { $(".seg-words", segEl)?.remove(); continue; }
      let layer = $(".seg-words", segEl);
      if (!layer || layer.dataset.n !== String(b.size)) {
        layer?.remove();
        layer = h("div", { class: "seg-words", "data-n": b.size, "aria-hidden": "true" });
        for (const [k, [x, y, w, hh]] of b) {
          const [li, wi] = k.split(":");
          layer.append(h("i", { class: "wb", "data-k": key(page, li, wi), style: { left: x / 10 + "%", top: y / 10 + "%", width: w / 10 + "%", height: hh / 10 + "%" } }));
        }
        segEl.append(layer);
      }
    }
    this.marks();
  },
  undecorate() {
    $$("#rd-zoomer .seg-words").forEach(l => l.remove());
    $("#rd-zoomer .spread")?.classList.remove("has-sel");
    $("#tx-tip")?.remove();
  },
  /* the chosen and pointed-at word, wherever it shows: on the photograph and in the text */
  marks() {
    const sp = $("#rd-zoomer .spread");
    $$("#rd-zoomer .wb.sel, #rd-zoomer .wb.hov").forEach(b => b.classList.remove("sel", "hov"));
    $$("#rd-zoomer .seg.sel-seg").forEach(s => s.classList.remove("sel-seg"));
    const selBox = this.sel && $(`#rd-zoomer .wb[data-k="${CSS.escape(this.sel)}"]`);
    if (selBox) { selBox.classList.add("sel"); selBox.closest(".seg").classList.add("sel-seg"); }
    sp?.classList.toggle("has-sel", !!selBox);
    if (this.hov && this.hov !== this.sel) $(`#rd-zoomer .wb[data-k="${CSS.escape(this.hov)}"]`)?.classList.add("hov");
    if (this.el) {
      $$(".tx-body .w.lit, .tx-body .w.sel", this.el).forEach(w => w.classList.remove("lit", "sel"));
      if (this.sel) $(`.tx-body .w[data-k="${CSS.escape(this.sel)}"]`, this.el)?.classList.add("sel");
      if (this.hov) $(`.tx-body .w[data-k="${CSS.escape(this.hov)}"]`, this.el)?.classList.add("lit");
    }
  },
  /* Point at a word: it is outlined on the photograph and lit in the text, and says in one line what it is. */
  hover(k, onPhoto = true) {
    if (k === this.hov) return;
    this.hov = k;
    this.marks();
    const tip = $("#tx-tip");
    if (!k || !onPhoto || (this.sel && k === this.sel)) { tip?.remove(); return; }
    const box = $(`#rd-zoomer .wb[data-k="${CSS.escape(k)}"]`), it = this.item(k);
    if (!box || !it) { tip?.remove(); return; }
    const st = $("#rd-stage"), r = box.getBoundingClientRect(), sr = st.getBoundingClientRect();
    const t = tip || h("div", { id: "tx-tip", class: "tx-tip", role: "status" });
    const glyph = this.font === "glyphs";
    t.replaceChildren(h("b", { class: glyph ? "gl" : "" }, glyph ? it.w.toks.map(x => x.sep ? " " : chOf(x.code)).join("") : it.w.eva.replace(/,/g, "·")),
      glyph ? h("span", { class: "ev" }, it.w.eva.replace(/,/g, "·")) : "",
      h("span", { class: "say" }, this.short(it)), h("span", { class: "chev", "aria-hidden": "true" }, "›"));
    if (!tip) st.append(t);
    t.style.left = Math.max(80, Math.min(sr.width - 80, r.left - sr.left + r.width / 2)) + "px";
    t.style.top = Math.max(44, r.top - sr.top) + "px";
  },
  short(it) {
    const us = unitsIn(it.loc, it.w), n = it.loc.w.length;
    if (n === 1) return "one transcriber";
    if (us.some(u => DIFFER.includes(u[2]))) return "transcribers differ";
    if (us.some(u => u[2] === "m")) return "most agree";
    return `all ${n} agree`;
  },
  /* Clicks on the photograph: a click that does not drag picks the word under it; one on bare parchment lets go. */
  wireStage() {
    const st = $("#rd-stage");
    if (st.dataset.words) return;
    st.dataset.words = "1";
    let down = null;
    st.addEventListener("pointerover", e => { if (TextUI.open && e.pointerType === "mouse") { const b = e.target.closest(".wb"); if (b) this.hover(b.dataset.k); } });
    st.addEventListener("pointerout", e => { if (e.target.closest(".wb") && !e.relatedTarget?.closest?.(".wb")) this.hover(null); });
    st.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; $("#tx-tip")?.remove(); });
    st.addEventListener("wheel", () => { if (this.hov) this.hover(null); }, { passive: true });
    st.addEventListener("pointerup", e => {
      if (!TextUI.open || !down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), long = Date.now() - down.t;
      down = null;
      if (moved > 5 || long > 700 || e.target.closest("button")) return;
      const b = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList?.contains("wb"));
      if (b) { this.picked = Date.now(); this.pick(b.dataset.k, { from: "photo" }); }
      else if (this.sel && document.elementsFromPoint(e.clientX, e.clientY).some(x => x.classList?.contains("seg"))) this.unpick();
    });
  },
  /* the Reader's double-click zoom leaves alone a click that just picked a word */
  justPicked() { return Date.now() - (this.picked || 0) < 450; },

  /* ---- choosing a word ---- */
  item(k) {
    const { page, li, wi } = unkey(k), d = this.loaded.get(page);
    const loc = d && d.loci[li];
    if (!loc) return null;
    return { page, li, wi, loc, w: words(loc)[wi], d };
  },
  pick(k, { from = "text", zoom = true } = {}) {
    if (!this.item(k)) return;
    this.sel = k;
    $("#tx-tip")?.remove();
    this.show();
    this.marks();
    if (zoom) this.frameWord(k, from === "photo");
    setHash();
  },
  unpick() {
    if (!this.sel) return;
    const k = this.sel;
    this.sel = null;
    this.show();
    this.marks();
    setHash();
    $(`.tx-body .w[data-k="${CSS.escape(k)}"]`, this.el)?.scrollIntoView({ block: "nearest" });
  },
  /* Bring the word into view: zoomed in until it is about 48 px tall if it is smaller than 36 (at most 4x), and moved to
     the middle of the room the panel leaves. A word picked on the photograph is only zoomed if it is small. */
  frameWord(k, fromPhoto) {
    const box = $(`#rd-zoomer .wb[data-k="${CSS.escape(k)}"]`);
    if (!box) return;
    const st = $("#rd-stage"), sr = st.getBoundingClientRect(), r = box.getBoundingClientRect();
    const z0 = R.zoom, z1 = r.height < 36 ? Math.min(4, MAX_ZOOM, Math.max(z0, z0 * 48 / Math.max(4, r.height))) : z0;
    const inView = r.left > sr.left + 30 && r.right < sr.right - 30 && r.top > sr.top + 30 && r.bottom < sr.bottom - 30;
    if (fromPhoto && z1 === z0 && inView) return;
    const px = (r.left + r.width / 2 - sr.left - R.zx) / z0, py = (r.top + r.height / 2 - sr.top - R.zy) / z0;   // the word's centre, unzoomed
    R.zoom = z1; R.zx = sr.width / 2 - px * z1; R.zy = sr.height / 2 - py * z1;
    const z = $("#rd-zoomer");
    if (!REDUCED) { z.style.transition = "transform .3s ease"; setTimeout(() => { z.style.transition = ""; }, 320); }
    Reader.applyZoom();
  },
  /* every word on show, in reading order, for ‹ › */
  order() {
    const out = [];
    for (const [page, d] of this.loaded) d.loci.forEach((loc, li) => words(loc).forEach((w, wi) => out.push(key(page, li, wi))));
    return out;
  },
  stepWord(d) {
    const all = this.order(), i = all.indexOf(this.sel);
    if (i < 0) return;
    const next = all[i + d];
    if (next) this.pick(next, { from: "step" });
  },
  /* N / Shift+N: the next or previous word where transcribers disagree */
  stepDispute(d) {
    const all = this.order().filter(k => { const it = this.item(k); return disputed(it.loc, it.w); });
    if (!all.length) { toast("Transcribers agree on every word here"); return; }
    const flat = this.order(), at = this.sel ? flat.indexOf(this.sel) : (d > 0 ? -1 : flat.length);
    const next = d > 0 ? all.find(k => flat.indexOf(k) > at) || all[0] : [...all].reverse().find(k => flat.indexOf(k) < at) || all[all.length - 1];
    this.pick(next, { from: "step" });
  },

  /* ---- the panel ---- */
  show() {
    if (!this.el) return;
    const body = $(".tx-body", this.el);
    const keep = this.sel ? 0 : this.pageScroll || 0;
    if (!this.sel) this.pageView(body); else { if (body.dataset.view === "page") this.pageScroll = body.scrollTop; this.wordView(body); }
    body.dataset.view = this.sel ? "word" : "page";
    body.scrollTop = this.sel ? 0 : keep;
  },

  /* The text of the pages on show: plain lines, one mark (a dot under a glyph where transcribers disagree). */
  pageView(body) {
    const head = $(".tx-head", this.el);
    const pages = [...this.loaded.keys()];
    const fonts = h("div", { class: "tx-seg", role: "group", "aria-label": "Show the text as" },
      [["eva", "Eva", "The text in Eva letters, names for the shapes"], ["glyphs", "Glyphs", "The text in the manuscript's own glyphs"]]
        .map(([v, t, title]) => h("button", { title, "aria-pressed": String(this.font === v), onclick: () => { this.font = v; store.set("text:font", v); this.sync(); } }, t)));
    head.replaceChildren(h("span", { class: "tx-title" }, pages.map(short).join(" · ") || "Text"), h("span", { class: "sp" }), fonts,
      this.menu(), h("button", { class: "tx-ic", title: "Close the text (T)", "aria-label": "Close the text", onclick: () => TextUI.toggle(false) }, "✕"));
    const kids = [];
    if (this.compare) kids.push(h("div", { class: "tx-cmp" }, `Comparing with ${Data.names.get(this.compare) || SHORT[this.compare]}: words read the same way are faded.`,
      h("button", { class: "tx-link", onclick: () => this.setCompare(null) }, "Stop")));
    for (const x of this.shownNow || []) {
      if (x.folded) {
        const n = x.folded.filter(p => Data.has(p));
        if (n.length) kids.push(h("p", { class: "tx-folded" }, `Folded in: ${n.map(short).join(", ")}. `,
          h("button", { class: "tx-link", onclick: () => Reader.toggleUnfold() }, "Unfold"), " to read ", n.length > 1 ? "them" : "it", " (U)."));
        continue;
      }
      const d = this.loaded.get(x.page);
      if (d) kids.push(this.pageEl(d, x));
    }
    if (!kids.some(k => k.classList.contains("tx-page")))
      kids.unshift(h("p", { class: "tx-msg" }, (this.shownNow || []).length ? "No text on these pages." : "No text here: these leaves are lost."));
    kids.push(this.credits());
    body.classList.toggle("glyph", this.font === "glyphs");
    body.replaceChildren(...kids);
    this.marks();
  },
  /* ⋯: the rarer settings, one step away */
  menu() {
    const here = new Set();
    for (const d of this.loaded.values()) for (const l of d.loci) { l.w.forEach(n => here.add(n)); for (const n in l.r || {}) if (isRef(n)) here.add(n); }
    const sel = h("select", { "aria-label": "Compare with a transcriber", onchange: e => this.setCompare(e.target.value || null) },
      h("option", { value: "" }, "nobody"),
      Data.meta ? Data.meta.voters.filter(v => here.has(v.code)).map(v => h("option", { value: v.code }, SHORT[v.code])) : [],
      Data.meta ? h("optgroup", { label: "For comparison" }, Data.meta.references.filter(v => here.has(v.code)).map(v => h("option", { value: v.code }, SHORT[v.code]))) : "");
    sel.value = this.compare || "";
    return h("details", { class: "tx-menu" }, h("summary", { class: "tx-ic", title: "More", "aria-label": "More settings" }, "⋯"),
      h("div", { class: "tx-menu-m" },
        h("label", {}, h("input", { type: "checkbox", checked: this.dots, onchange: e => { this.dots = e.target.checked; store.set("text:dots", this.dots); this.sync(); } }),
          " Mark where transcribers disagree"),
        h("label", {}, "Compare with ", sel),
        h("a", { href: `#text/${encodeURIComponent(S.order)}/search` }, "Search the whole book (/)"),
        h("a", { href: "#info/beinecke/consensus" }, "How the text is made")));
  },
  setCompare(code) {
    this.compare = code && (SHORT[code]) ? code : null;
    this.sel = null;
    this.onShow = "";
    this.sync();
    setHash();
  },

  pageEl(d, x) {
    const seg = x.seg, loci = d.loci;
    const facts = [];
    for (const n of seg.scribes || []) if (SCRIBES[n]) facts.push(SCRIBES[n]);
    if (seg.vars && LANG[seg.vars.L]) facts.push(LANG[seg.vars.L]);
    if (seg.section) facts.push(seg.section);
    const counts = {};
    for (const l of loci) counts[kindOf(l)] = (counts[kindOf(l)] || 0) + 1;
    const groups = [];
    loci.forEach((l, li) => {
      const k = kindOf(l);
      let g = groups.find(x => x.k === k);
      if (!g) groups.push(g = { k, rows: [] });
      g.rows.push([l, li]);
    });
    return h("section", { class: "tx-page", "data-page": d.page, "aria-label": `Text of ${short(d.page)}` },
      h("header", { class: "tx-ph" }, h("h3", {}, short(d.page)),
        h("span", { class: "tx-count" }, [Object.keys(KINDS).filter(k => counts[k]).map(k => plural(counts[k], k)).join(", "), ...facts].join(" · "))),
      groups.flatMap(g => [
        groups.length > 1 || g.k !== "P" ? h("h4", { class: "tx-kind" }, KINDS[g.k][0]) : null,
        h("div", { class: `tx-lines k-${g.k}` }, g.rows.map(([l, li], i) => this.lineEl(d.page, l, li, i)))]));
  },
  lineEl(page, loc, li, i) {
    const n = loc.id.slice(loc.id.lastIndexOf(".") + 1);
    return h("div", { class: `ln${loc.ps && i ? " ps" : ""}`, "data-id": loc.id },
      h("span", { class: "no", title: loc.id }, n),
      h("span", { class: "t" }, this.compare ? this.compareText(page, loc, li) : this.lineText(page, loc, li)));
  },
  /* the consensus: each word a span (pointing lights it on the photograph); a dot under each glyph where the vote is
     split; an uncertain space as a faint middle dot */
  lineText(page, loc, li) {
    const glyph = this.font === "glyphs", split = new Set();
    if (this.dots) for (const u of loc.u) if (DIFFER.includes(u[2])) for (let i = u[0]; i < u[0] + Math.max(1, u[1]); i++) split.add(i);
    const out = [];
    words(loc).forEach((w, wi) => {
      if (wi) out.push(" ");
      const el = h("span", { class: "w", "data-k": key(page, li, wi), tabindex: "0", title: glyph ? w.eva : null });
      for (const t of w.toks) {
        if (t.sep) { el.append(h("span", { class: "us", title: "an uncertain space: about half the transcribers wrote a space here" }, glyph ? " " : "·")); continue; }
        const d = split.has(t.off);
        el.append(d || glyph ? h("span", { class: `g${d ? " d" : ""}` }, glyph ? chOf(t.code) : t.eva) : t.eva);
      }
      if (this.dots && disputed(loc, w)) el.setAttribute("aria-label", `${w.eva}: transcribers disagree`);
      out.push(el);
    });
    return out;
  },
  /* one transcriber's reading: words read as the consensus faded, the rest in full */
  compareText(page, loc, li) {
    const who = this.compare, rd = readingOf(loc, who);
    if (!rd) return [h("span", { class: "tx-none" }, `Not in ${SHORT[who]}'s transcription`)];
    if (loc.x && who in loc.x) return [h("span", { class: "tx-rough", title: ROUGH }, "≈ " + loc.x[who].replace(/\./g, " ").replace(/,/g, "·"))];
    const ws = words(loc), out = [];
    ws.forEach((w, wi) => {
      if (wi) out.push(" ");
      const dif = differs(rd, ws, wi);
      out.push(h("span", { class: `w${dif ? " cx" : " cs"}`, "data-k": key(page, li, wi), tabindex: "0", title: dif ? `the consensus reads ${w.eva}` : null },
        dif ? shownReading(rd, wi) : rd[wi].text.replace(/,/g, "·")));
    });
    return out;
  },
  credits() {
    const m = Data.meta;
    return h("footer", { class: "tx-foot" },
      h("p", {}, "The text is the consensus of independent transcriptions, compared glyph by glyph; every reading is kept. ",
        h("a", { href: "#info/beinecke/consensus" }, "How it is made"), "."),
      h("p", {}, m.credit.replace(/,? from René Zandbergen's voynich\.nu.*$/, ""), ", from René Zandbergen's ",
        h("a", { href: "https://www.voynich.nu/transcr.html", target: "_blank", rel: "noopener" }, "voynich.nu"),
        " (CC0) and the Landini–Stolfi interlinear. Word positions on the photographs: The Voynichese Project (Apache 2.0)."));
  },

  /* The word: a sharp crop from the photograph, its reading, one sentence, the readings grouped, and the transcribers'
     lines one step deeper. */
  wordView(body) {
    const it = this.item(this.sel);
    if (!it) { this.sel = null; this.pageView(body); return; }
    const { page, li, wi, loc, w } = it;
    const all = this.order(), at = all.indexOf(this.sel);
    const head = $(".tx-head", this.el);
    head.replaceChildren(
      h("button", { class: "tx-ic", title: "Back to the page text (Esc)", "aria-label": "Back to the page text", onclick: () => this.unpick() }, "←"),
      h("span", { class: "tx-where" }, `${short(page)} · line ${loc.id.slice(loc.id.lastIndexOf(".") + 1)} · word ${wi + 1}`),
      h("span", { class: "sp" }),
      h("button", { class: "tx-ic", title: "Previous word", "aria-label": "Previous word", disabled: at <= 0, onclick: () => this.stepWord(-1) }, "‹"),
      h("button", { class: "tx-ic", title: "Next word", "aria-label": "Next word", disabled: at >= all.length - 1, onclick: () => this.stepWord(1) }, "›"),
      h("button", { class: "tx-ic", title: "Close the text (T)", "aria-label": "Close the text", onclick: () => TextUI.toggle(false) }, "✕"));
    const box = this.boxes.get(page)?.get(li + ":" + wi);
    const url = box && cropUrl(this.segs.get(page), box);
    const glyphs = w.toks.filter(t => !t.sep), us = unitsIn(loc, w);
    const band = t => {
      const u = us.find(u => u[1] && t.off >= u[0] && t.off < u[0] + u[1]);
      if (!u || u[2] === "u") return "all";
      const v = u[3].filter(r => r[1] > 0), tot = v.reduce((a, r) => a + r[1], 0), top = v.length ? v[0][1] : 0;
      return DIFFER.includes(u[2]) || top / tot <= .5 ? "disputed" : "most";
    };
    // the readings, alike ones together, most first
    const groups = new Map(), refs = [], rough = [];
    for (const n of [...loc.w, ...["RF", "VT"].filter(n => isRef(n) && loc.r && n in loc.r)]) {
      if (loc.x && n in loc.x) { rough.push(n); continue; }
      const rd = readingOf(loc, n);
      if (!rd) continue;
      const t = shownReading(rd, wi);
      if (isRef(n)) refs.push([t, n]); else groups.set(t, [...(groups.get(t) || []), n]);
    }
    const cons = w.eva.replace(/,/g, "·");
    const rows = [...groups].sort((a, b) => b[1].length - a[1].length || (b[0] === cons) - (a[0] === cons));
    const row = ([t, who], ref) => h("div", { class: `rd${ref ? " ref" : ""}` },
      h("span", { class: "r" }, t === cons ? t : diffMark(t, cons)),
      h("span", { class: "n" }, ref ? "" : `${who.length} of ${loc.w.length}`),
      h("span", { class: "who" }, ref ? Data.names.get(who) : who.flatMap((n, i) => [i ? ", " : "",
        h("button", { class: "tx-name", title: `Read the page as ${SHORT[n]} did`, onclick: () => this.setCompare(n) }, SHORT[n])]),
        !ref && doubt(t) ? h("span", { class: "dbt" }, ` · ${doubt(t)}`) : ""));
    const more = rows.length > 3 || refs.length || rough.length;
    const occ = h("span", {}, "…");
    Count.load().then(() => {
      const e = Count.map.get(w.eva);
      occ.textContent = !e ? "Not elsewhere in the book." : e.n === 1 ? "Only here in the book." : `${e.n.toLocaleString("en")} times on ${e.pages.size} page${e.pages.size === 1 ? "" : "s"}.`;
    }).catch(() => { occ.textContent = ""; });
    const crop = url ? h("img", { class: "tx-crop", src: url, alt: `${w.eva}, on the page`, loading: "eager",
      onerror: e => e.target.replaceWith(h("p", { class: "tx-msg" }, "Yale's photograph could not be loaded.")) }) : null;
    body.replaceChildren(
      crop ? h("figure", { class: "tx-fig" }, crop, h("figcaption", {}, `From Yale's photograph of ${short(page)}`)) : "",
      h("div", { class: "tx-reading" }, h("span", { class: "gl", "aria-hidden": "true" }, glyphs.map(t => chOf(t.code)).join("")),
        h("span", { class: "ev" }, cons)),
      h("p", { class: "tx-verdict" }, ...verdict(loc, w)),
      h("div", { class: "tx-bars", role: "img", "aria-label": glyphs.map(t => `${t.eva}: ${band(t).replace("all", "all agree").replace("most", "most agree")}`).join(", ") },
        glyphs.map(t => h("span", {}, h("span", { class: "e" }, t.eva), h("i", { class: `b-${band(t)}` })))),
      h("div", { class: "tx-key" }, h("span", {}, h("i", { class: "b-all" }), "all agree"), h("span", {}, h("i", { class: "b-most" }), "most agree"), h("span", {}, h("i", { class: "b-disputed" }), "disputed")),
      h("h4", { class: "tx-h" }, "Readings"),
      ...rows.slice(0, 3).map(r => row(r)),
      more ? h("details", { class: "tx-more" }, h("summary", {}, `All readings${rows.length > 3 ? ` (${rows.length})` : ""}${refs.length ? ", and RF1 and voynichese.com" : ""}`),
        ...rows.slice(3).map(r => row(r)), ...refs.map(r => row(r, true)),
        rough.length ? h("p", { class: "tx-dim" }, `${names(rough.map(n => SHORT[n]))}: ${rough.length > 1 ? "their lines line" : "the line lines"} up with the others only roughly here.`) : "") : "",
      h("h4", { class: "tx-h" }, "Elsewhere in the book"),
      h("p", { class: "tx-else" }, occ, h("a", { href: `#text/${encodeURIComponent(S.order)}/search?q=${encodeURIComponent(w.eva.replace(/,/g, ""))}` }, "Find it in the book ›")),
      this.lineDetails(loc, wi),
      h("p", { class: "tx-src" }, `Consensus of ${loc.w.length} transcription${loc.w.length === 1 ? "" : "s"}`, box ? " · word position: The Voynichese Project" : "", crop ? " · photograph: Yale University" : ""));
  },
  /* one step deeper: each transcriber's line, words read as the consensus faded, only those who differ */
  lineDetails(loc, wi0) {
    const ws = words(loc);
    const d = h("details", { class: "tx-line" }, h("summary", {}, "How each transcriber wrote this line"));
    d.addEventListener("toggle", () => {
      if (!d.open || d.children.length > 1) return;
      const rows = [h("div", { class: "who c" }, "Consensus"), h("div", { class: "seq c" }, ws.map((w, i) => h("span", { class: i === wi0 ? "on" : "" }, w.eva.replace(/,/g, "·"))).flatMap((e, i) => i ? [" ", e] : [e]))];
      let same = 0;
      for (const n of loc.w) {
        if (loc.x && n in loc.x) { rows.push(h("div", { class: "who" }, SHORT[n]), h("div", { class: "seq rough", title: ROUGH }, "≈ " + loc.x[n].replace(/\./g, " ").replace(/,/g, "·"))); continue; }
        const rd = readingOf(loc, n);
        if (!rd) continue;
        if (!ws.some((_, i) => differs(rd, ws, i))) { same++; continue; }
        rows.push(h("div", { class: "who" }, SHORT[n]), h("div", { class: "seq" }, ws.flatMap((w, i) => [i ? " " : "",
          differs(rd, ws, i) ? h("span", { class: "x" }, shownReading(rd, i)) : h("span", { class: "s" }, rd[i].text.replace(/,/g, "·"))])));
      }
      if (same) rows.push(h("div"), h("div", { class: "note" }, `and ${same} more read the line as the consensus`));
      d.append(h("div", { class: "tx-al" }, rows));
    });
    return d;
  },

  /* ---- keys and the address ---- */
  key(e) {
    if ((e.key === "n" || e.key === "N") && !e.altKey) { this.stepDispute(e.shiftKey ? -1 : 1); return true; }
    if (e.key === "Escape" && this.sel) { this.unpick(); return true; }
    if (this.sel && (e.key === "[" || e.key === "]")) { this.stepWord(e.key === "]" ? 1 : -1); return true; }
    return false;
  },
  /* text, then the word chosen, the transcriber compared, and a search result being stepped through */
  hash() {
    const p = new URLSearchParams();
    if (this.sel) { const { page, li, wi } = unkey(this.sel); const d = this.loaded.get(page); if (d) p.set("w", `${d.loci[li].id}.${wi + 1}`); }
    if (this.compare) p.set("r", this.compare);
    if (this.ask) {
      p.set("l", this.ask.l);
      if (this.ask.m) p.set("m", this.ask.m.join("-"));
      if (this.ask.hit) p.set("hit", this.ask.hit);
    }
    const q = p.toString();
    return "text" + (q ? "?" + q : "");
  },
  fromHash(q) {
    const p = new URLSearchParams(q);
    const r = p.get("r");
    this.compare = r && SHORT[r] ? r : null;
    this.ask = p.get("l") ? { l: p.get("l"), m: p.get("m") ? p.get("m").split("-").map(Number) : null, hit: +p.get("hit") || 0, seen: false } : null;
    this.wantWord = p.get("w") || null;
    this.onShow = "";
    if (this.el) this.sync();
  },
  /* the word asked for in the address (w=f2r.4.1, or a search result's line and match), chosen once its page is on show */
  light() {
    const bar = $(".tx-step", this.el);
    const find = (id, test) => {
      for (const [page, d] of this.loaded) {
        const li = d.loci.findIndex(l => l.id === id);
        if (li < 0) continue;
        const wi = words(d.loci[li]).findIndex(test);
        return wi >= 0 ? key(page, li, wi) : null;
      }
      return undefined;   // not on show (yet)
    };
    if (this.wantWord) {
      const id = this.wantWord.slice(0, this.wantWord.lastIndexOf(".")), n = +this.wantWord.slice(this.wantWord.lastIndexOf(".") + 1);
      const k = find(id, (w, i) => i === n - 1);
      if (k !== undefined) { this.wantWord = null; if (k) this.pick(k, { from: "link" }); }
    }
    const a = this.ask;
    if (!a) { bar.hidden = true; return; }
    const k = find(a.l, w => !a.m || (w.off < a.m[1] && w.end > a.m[0]));
    if (k === undefined) {   // not there yet (the reader is on its way), or the reader has moved on
      bar.hidden = true;
      if (a.seen) { this.ask = null; setHash(); }
      return;
    }
    if (!a.seen) { a.seen = true; if (k) this.pick(k, { from: "search" }); }
    const S_ = typeof TextTab !== "undefined" && TextTab.mod, n = a.hit && S_ ? S_.hit(a.hit) : null;
    bar.hidden = !n;
    if (!n) return;
    const prev = S_.hit(a.hit - 1), next = S_.hit(a.hit + 1);
    bar.replaceChildren(
      h("span", {}, `Result ${a.hit.toLocaleString("en")} of ${n.n.toLocaleString("en")}`),
      h("button", { title: "Previous result", "aria-label": "Previous result", disabled: !prev, onclick: () => { location.hash = prev.href; } }, "‹"),
      h("button", { title: "Next result", "aria-label": "Next result", disabled: !next, onclick: () => { location.hash = next.href; } }, "›"),
      h("span", { class: "sp" }),
      h("a", { href: S_.back() }, "All results"));
  },
};

export { Boxes, verdict };
export default T;
