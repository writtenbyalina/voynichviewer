/* Text: the manuscript's text beside its pages in the Reader (docs/text/REDESIGN.md, section 9). Loaded the first time the
   text opens (TextUI in app.js); uses app.js's helpers (h, $, $$, store, toast, R, Reader, D, S, ...).

   The text is RF1b, René Zandbergen's reference transliteration (tools/text/rf.py), written in Eva, FSG or Currier by his
   own tables, or shown as the glyphs themselves. One rule runs through it all: never take the page away.
   - Pointing at a word outlines it and says what it reads. Clicking chooses it without moving the page; shift-click
     takes in a phrase, ⌘/Ctrl-click collects words into a set.
   - The panel opens on the word itself (cut upright from Yale's photograph, its glyphs, one sentence), then its other
     places as real crops. A place opens in a peek beside the page, never in place of it; "Open page" commits, and
     the way back is one chip (or the browser's Back).
   - The strip under the pages (app.js) is the compass: where the words are, where you are, where you have been.
   - Two questions have views of their own: which pages share these words, in any order (a set: a word set, a ring, or
     a whole page), and which words repeat round a ring (an order: the ring unrolled into a line, its repeats joined).

   Search (the Text tab, search.js) still uses the earlier data, which keeps every transcriber's reading: Data, SHORT and
   load are for it. */

const DIR = "data/text/";
const got = new Map();   // path -> the promise of its JSON
export function load(path) {
  if (!got.has(path)) got.set(path, fetch(DIR + path).then(r => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }).catch(e => { got.delete(path); throw e; }));
  return got.get(path);
}

/* ---- for Search: the transcribers and the consensus (docs/TEXT.md) ---- */
export const SHORT = { ZL: "Zandbergen & Landini", GC: "Claston", IT: "Takahashi", FG: "Friedman's group",
  CD: "Currier & D'Imperio", LU: "Stolfi", LV: "Grove", LT: "Tiltman", LL: "Latham", LP: "Petersen", LR: "Roe",
  LX: "Mardle", RF: "RF1b", VT: "voynichese.com" };
export const Data = {
  meta: null, glyphs: null, ready: null,
  base() {
    return this.ready ||= Promise.all([load("meta.json"), load("glyphs.json")]).then(([m, g]) => {
      this.meta = m;
      this.glyphs = g.glyphs;
      this.names = new Map([...m.voters, ...m.references].map(v => [v.code, v.name]));
      this.names.set("RF", "RF1b, Zandbergen's reference transliteration");
    }).catch(e => { this.ready = null; throw e; });
  },
};

/* ---- RF1b, and how it is written ---- */
const SCRIPTS = [
  ["glyphs", "Glyphs", "The manuscript's own shapes (Glen Claston's font); words are matched as Eva"],
  ["eva", "Eva", "Eva (Landini and Zandbergen, 1998), the alphabet most people use: letters that name the shapes, not sounds"],
  ["fsg", "FSG", "The First Study Group's alphabet (William Friedman, 1944–46)"],
  ["cur", "Currier", "Prescott Currier's alphabet (1970s), from the papers that found the two hands' “languages” A and B"],
];
const SCRIPT_NAME = Object.fromEntries(SCRIPTS.map(([k, n]) => [k, n]));
const letters = script => script === "glyphs" ? "eva" : script;   // the alphabet words are matched and captioned in
const KINDS = { P: ["Paragraphs", "line", "lines"], L: ["Labels", "label", "labels"], C: ["Rings", "ring", "rings"],
  R: ["Radii", "radius", "radii"] };
const kindOf = loc => KINDS[loc.t[0]] ? loc.t[0] : "P";
const plural = (n, one, many) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
const lineNo = id => id.slice(id.lastIndexOf(".") + 1);
const pageName_ = p => p === "fRos" ? "Rosettes" : short(p);   // the Rosettes foldout is one page to the transcriptions

const Text = {
  pages: null,     // page -> its loci: [{ id, t, ps, words: [{ codes: ["A1", ...], gap }] }]; gap: what follows the word
  order: [],       // the pages, in the order of the transcriptions
  alpha: null, glyphs: null, credit: "", ready: null,
  base() {
    return this.ready ||= Promise.all([load("rf/text.json"), load("rf/alpha.json"), load("glyphs.json")]).then(([t, a, g]) => {
      this.pages = new Map();
      for (const [page, loci] of t.pages) {
        this.order.push(page);
        this.pages.set(page, loci.map(([id, tp, ps, s]) => {
          const parts = s.split(/([.,\-])/), words = [];
          for (let i = 0; i < parts.length; i += 2) words.push({ codes: parts[i].match(/[A-Z][0-9a-z%]/g) || [], gap: parts[i + 1] || "" });
          return { id, t: tp, ps: !!ps, words };
        }));
      }
      this.alpha = a.schemes;
      for (const s of Object.values(this.alpha)) s.approxSet = new Set(s.approx);
      this.search = a.search;
      this.glyphs = g.glyphs;
      this.credit = t.credit;
    }).catch(e => { this.ready = null; throw e; });
  },
  has(page) { return !!(this.pages && this.pages.get(page)); },
};

const chOf = code => (Text.glyphs[code] && Text.glyphs[code].ch) || "?";
/* a word's glyphs written in an alphabet: bitrans's way, a rule for two glyphs first, then glyph by glyph */
function writeAs(codes, script) {
  if (script === "glyphs") return codes.map(chOf).join("");
  const a = Text.alpha[script];
  let out = "";
  for (let i = 0; i < codes.length; i++) {
    const two = a.multi[codes[i] + (codes[i + 1] || "")];
    if (two !== undefined && i + 1 < codes.length) { out += two; i++; } else out += a.codes[codes[i]] ?? "?";
  }
  return out;
}
const approxIn = (codes, script) => (script === "fsg" || script === "cur") && codes.some(c => Text.alpha[script].approxSet.has(c));
/* A word as shown. In Eva a glyph that basic Eva has no letter for (one in two hundred) is drawn as itself, in the glyph
   font, and says so; an unreadable glyph stays a ?. */
function wordNodes(codes, script) {
  if (script === "glyphs") return [codes.map(chOf).join("")];
  const a = Text.alpha[script], out = [];
  let run = "";
  for (let i = 0; i < codes.length; i++) {
    const two = a.multi[codes[i] + (codes[i + 1] || "")];
    if (two !== undefined && i + 1 < codes.length) { run += two; i++; continue; }
    const e = a.codes[codes[i]] ?? "?";
    if (e.includes("?") && codes[i][0] !== "Z") { if (run) out.push(run); run = ""; out.push(h("span", { class: "rare", title: `a rare glyph ${SCRIPT_NAME[script]} has no letter for` }, chOf(codes[i]))); }
    else run += e;
  }
  if (run) out.push(run);
  return out;
}

/* ---- where each word is on the photographs, and its shape (data/text/rf/shapes, tools/text/rf.py) ---- */
const Shapes = {
  pages: null,
  async of(page) {
    if (!this.pages) this.pages = new Set(await load("rf/shapes/pages.json").catch(() => []));
    if (!this.pages.has(page)) return null;
    const b = await load(`rf/shapes/${encodeURIComponent(page)}.json`).catch(() => null);
    if (b && !b._map) {
      b._map = new Map();
      for (const r of b.words) {
        const [li, wi, p, kind] = r, n = kind === "r" ? 4 : kind === "o" ? 5 : 6;
        b._map.set(li + ":" + wi, { img: b.imgs[p][0], aspect: b.imgs[p][1], kind, g: r.slice(4, 4 + n), ang: r[4 + n], est: !!r[5 + n] });
      }
    }
    return b ? b._map : null;
  },
};
/* A reading made from the photograph by Claude (Anthropic's model), where no transcriber's covers a word well:
   data/text/rf/read/<page>.json, {by, about, words: [[locus, word, eva, confidence, note]]} (tools/text/read_photo.py) */
const PhotoReading = {
  pages: null,
  async of(page) {
    if (!this.pages) this.pages = new Set(await load("rf/read/pages.json").catch(() => []));
    if (!this.pages.has(page)) return null;
    const b = await load(`rf/read/${encodeURIComponent(page)}.json`).catch(() => null);
    if (b && !b._map) b._map = new Map(b.words.map(([li, wi, eva, conf, note]) => [li + ":" + wi, { eva, conf, note }]));
    return b;
  },
};
const rad = d => d * Math.PI / 180;
/* the outline of a shape, as an SVG path in its panel's units (thousandths of the panel's height) */
function shapePath(s) {
  const g = s.g;
  if (s.kind === "r") { const [x, y, w, hh] = g; return `M${x} ${y}h${w}v${hh}h${-w}Z`; }
  if (s.kind === "o") {
    const [cx, cy, L, t, a] = g, c = Math.cos(rad(a)), sn = Math.sin(rad(a));
    const pt = (dx, dy) => `${(cx + dx * c - dy * sn).toFixed(1)} ${(cy + dx * sn + dy * c).toFixed(1)}`;
    return `M${pt(-L / 2, -t / 2)}L${pt(L / 2, -t / 2)}L${pt(L / 2, t / 2)}L${pt(-L / 2, t / 2)}Z`;
  }
  const [cx, cy, r0, r1, a0, a1] = g, big = a1 - a0 > 180 ? 1 : 0;
  const pt = (r, a) => `${(cx + r * Math.cos(rad(a))).toFixed(1)} ${(cy + r * Math.sin(rad(a))).toFixed(1)}`;
  return `M${pt(r1, a0)}A${r1} ${r1} 0 ${big} 1 ${pt(r1, a1)}L${pt(r0, a1)}A${r0} ${r0} 0 ${big} 0 ${pt(r0, a0)}Z`;
}
/* the shape's centre, its height across the writing and its length along it, in its panel's units */
function shapeGeom(s) {
  const g = s.g;
  if (s.kind === "r") return { cx: g[0] + g[2] / 2, cy: g[1] + g[3] / 2, t: Math.min(g[2], g[3]), len: Math.max(g[2], g[3]) };
  if (s.kind === "o") return { cx: g[0], cy: g[1], t: g[3], len: g[2] };
  const [cx, cy, r0, r1, a0, a1] = g, am = rad((a0 + a1) / 2), rm = (r0 + r1) / 2;
  return { cx: cx + rm * Math.cos(am), cy: cy + rm * Math.sin(am), t: r1 - r0, len: rm * rad(a1 - a0) };
}

/* ---- every panel's photograph, by image and by page ---- */
let SEG_BY_IMG = null;
function segOfImg(img) {
  if (!SEG_BY_IMG) {
    SEG_BY_IMG = new Map();
    for (const s of D.sheets) for (const f of ["inside", "outside"]) for (const row of s[f] || []) for (const sg of row)
      if (sg && !sg.missing && sg.img && !SEG_BY_IMG.has(sg.img)) SEG_BY_IMG.set(sg.img, sg);
  }
  return SEG_BY_IMG.get(img);
}
let FACTS = null;   // page -> { section, lang, scribes, img }: what the Reader says of each page
function factsOf(page) {
  if (!FACTS) {
    FACTS = new Map();
    for (const s of D.sheets) for (const f of ["inside", "outside"]) for (const row of s[f] || []) for (const sg of row)
      if (sg && !sg.missing && sg.page && !FACTS.has(sg.page))
        FACTS.set(sg.page, { section: (sg.section || "").split("/")[0].trim() || "–", lang: (sg.vars && sg.vars.L) || "–", img: sg.img, v: sg.v, seg: sg });
  }
  return FACTS.get(page) || { section: "–", lang: "–" };
}

/* A word cut sharp from Yale's photograph and turned to read upright: Yale serves the region round it (the page crop's
   corners on the photograph, seg.quad, carry it across), and a canvas turns it. h: the height to draw the crop at; the
   width follows, at most maxW. ctx: how many word-lengths of the line around it to keep; mark: outline the word. Resolves
   to the canvas, or null where there is no photograph to cut. */
const YALE = "https://collections.library.yale.edu/iiif/2/";
function upright(shape, { h: lineH = 48, maxW = 328, pad = .55, ctx = 0, mark = false } = {}) {
  const seg = segOfImg(shape.img);
  const rot = ((seg?.rotate || 0) % 360 + 360) % 360;
  if (!seg || !seg.iiif || !seg.quad || seg.custom || (rot && rot !== 180)) return Promise.resolve(null);
  const geom = shapeGeom(shape), ang = shape.ang || 0, { cx, cy } = geom;
  const t = Math.max(geom.t, 12), len = Math.max(geom.len, t);   // never a sliver: at least a line's height
  const k = shape.aspect;                                  // panel units: thousandths of the height; x runs to 1000 k
  const span = len * (1 + ctx);                            // what is kept along the line
  const half = Math.hypot(span, t) / 2 + t * (pad + .4);   // round it, so it can turn without losing a corner
  const u0 = Math.max(0, (cx - half) / (1000 * k)), u1 = Math.min(1, (cx + half) / (1000 * k));
  const v0 = Math.max(0, (cy - half) / 1000), v1 = Math.min(1, (cy + half) / 1000);
  const [q0, q1, q2, q3] = seg.quad;
  const bl = (u, v) => [0, 1].map(i => (1 - u) * (1 - v) * q0[i] + u * (1 - v) * q1[i] + u * v * q2[i] + (1 - u) * v * q3[i]);
  const at = rot ? (u, v) => bl(1 - u, 1 - v) : bl;
  const pts = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  const X0 = Math.round(Math.min(...pts.map(p => p[0]))), X1 = Math.round(Math.max(...pts.map(p => p[0])));
  const Y0 = Math.round(Math.min(...pts.map(p => p[1]))), Y1 = Math.round(Math.max(...pts.map(p => p[1])));
  const photoPerUnit = (Y1 - Y0) / Math.max(1e-6, (v1 - v0) * 1000);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const scale = Math.min(1, lineH * dpr / (t * (1 + 2 * pad) * photoPerUnit));
  const W = Math.max(1, Math.round((X1 - X0) * scale)), H = Math.max(1, Math.round((Y1 - Y0) * scale));
  const url = `${YALE}${encodeURIComponent(seg.iiif)}/${X0},${Y0},${X1 - X0},${Y1 - Y0}/${W},${H}/${rot}/default.jpg`;
  return new Promise(ok => {
    const im = new Image();   // (drawn, never read back: no need to ask Yale for leave to)
    im.onerror = () => ok(null);
    im.onload = () => {
      const px = im.naturalWidth / ((u1 - u0) * 1000 * k), py = im.naturalHeight / ((v1 - v0) * 1000);
      const wx = (cx - u0 * 1000 * k) * px, wy = (cy - v0 * 1000) * py;
      const L = (span + 2 * pad * t) * px, T = t * (1 + 2 * pad) * py;
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(Math.min(maxW * dpr, L))); cv.height = Math.max(1, Math.round(T));
      const g = cv.getContext("2d");
      g.fillStyle = "#d9cdb4"; g.fillRect(0, 0, cv.width, cv.height);
      g.translate(cv.width / 2, cv.height / 2);
      g.rotate(-rad(ang));
      g.drawImage(im, -wx, -wy);
      if (mark) {   // the word itself, in the line around it
        g.rotate(rad(ang));
        g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 1.5 * dpr;
        g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 2 * dpr;
        g.strokeRect(-len * px / 2 - 3 * dpr, -t * py / 2 - 2 * dpr, len * px + 6 * dpr, t * py + 4 * dpr);
      }
      cv.style.width = cv.width / dpr + "px";
      cv.style.height = cv.height / dpr + "px";
      ok(cv);
    };
    im.src = url;
  });
}

/* ---- the whole book's words, for finding them ---- */
const Find = {
  script: null, toks: null, byWord: null, byPage: null, N: 0,
  /* every word of the book in reading order, as written in an alphabet; on: the next word follows on from it (the same
     line, or the next line of the same paragraph); first/last: in its line */
  build(script) {
    script = letters(script);
    if (this.script === script) return;
    const toks = [], byWord = new Map(), byPage = new Map(), byJoin = new Map();
    for (const page of Text.order) {
      const loci = Text.pages.get(page), mine = [];
      loci.forEach((loc, li) => {
        const next = loci[li + 1];
        const goesOn = next && kindOf(loc) === "P" && kindOf(next) === "P" && !next.ps;
        const ws = loc.words.map((w, wi) => [w, wi]).filter(([w]) => w.codes.length);
        ws.forEach(([w, wi], n) => {
          const s = writeAs(w.codes, script);
          const i = toks.length;
          toks.push({ page, li, wi, s, kind: kindOf(loc), first: n === 0, last: n === ws.length - 1, on: n < ws.length - 1 || !!goesOn });
          if (!byWord.has(s)) byWord.set(s, []);
          byWord.get(s).push(i);
          mine.push(i);
          // two words with an uncertain space between them are one word too (as the Text tab counts them, either way)
          if (n && ws[n - 1][0].gap === ",") { const j = toks[i - 1].s + s; if (!byJoin.has(j)) byJoin.set(j, []); byJoin.get(j).push(i - 1); }
        });
      });
      byPage.set(page, mine);
    }
    Object.assign(this, { script, toks, byWord, byPage, byJoin, N: toks.length });
  },
  /* the places a run of words is found, in order: [{ page, li, wi, n, i }] */
  find(words, script) {
    this.build(script);
    const out = [];
    for (const i of this.byWord.get(words[0]) || []) {
      let ok = true;
      for (let j = 1; j < words.length && ok; j++) ok = this.toks[i + j - 1].on && this.toks[i + j]?.s === words[j];
      if (ok) out.push({ ...this.toks[i], n: words.length, i });
    }
    if (words.length === 1) for (const i of this.byJoin.get(words[0]) || []) out.push({ ...this.toks[i], n: 2, i, joined: true });
    return out.sort((a, b) => a.i - b.i);
  },
  /* the words either side of a place, for its line of context */
  around(i, n, d = 2) {
    const before = [], after = [];
    for (let j = i - 1; j >= Math.max(0, i - d) && this.toks[j].on; j--) before.unshift(this.toks[j]);
    for (let j = i + n; j < Math.min(this.toks.length, i + n + d) && this.toks[j - 1].on; j++) after.push(this.toks[j]);
    return { before, after };
  },
  /* on how many pages each word is (for weighing shared words: rare ones count for more) */
  df(s) { return new Set((this.byWord.get(s) || []).map(i => this.toks[i].page)).size; },
  /* page -> how many of these words it holds, and which: a set's pages, in any order. scope: a kind of text only */
  pagesWith(words, script, scope = null) {
    this.build(script);
    const out = new Map();
    for (const w of new Set(words)) for (const i of this.byWord.get(w) || []) {
      const t = this.toks[i];
      if (scope && t.kind !== scope) continue;
      if (!out.has(t.page)) out.set(t.page, { page: t.page, words: new Map() });
      const e = out.get(t.page);
      e.words.set(w, [...(e.words.get(w) || []), i]);
    }
    return out;
  },
  /* how many pages would hold all of these words if words fell on pages by chance, each as often as it does in the book */
  expected(words, script) {
    this.build(script);
    let all = 0;
    for (const [, idx] of this.byPage) {
      const n = idx.length;
      if (!n) continue;
      all += words.reduce((p, w) => p * (1 - Math.pow(1 - (this.byWord.get(w)?.length || 0) / this.N, n)), 1);
    }
    return all;
  },
};

const key = (page, li, wi) => `${page}|${li}|${wi}`;
const unkey = k => { const [page, li, wi] = k.split("|"); return { page, li: +li, wi: +wi }; };
const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v); return e; };
/* edit distance, for spellings one glyph apart */
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const p = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    let prev = p[0]; p[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = p[j]; p[j] = Math.min(p[j] + 1, p[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return p[b.length];
}

const T = {
  el: null, onShow: "", gen: 0,
  script: (s => SCRIPT_NAME[s] ? s : "eva")(store.get("text:script", store.get("text:font", "eva") === "glyphs" ? "glyphs" : "eva")),
  loaded: new Map(),        // page -> its loci, for the pages on show
  shapes: new Map(),        // page -> its words' shapes (or null)
  anchor: null, focus: null,   // a word or phrase chosen: from anchor to focus, on one page ("page|li|wi")
  set: [],                  // words collected with ⌘-click, or a set made from a page or a ring: [{ s, k? }]
  view: null,               // what the panel shows: null (the words chosen), { kind: "set", ... }, { kind: "ring", ... }
  hov: null,                // the word pointed at
  peekAt: null,             // the peek beside the page: { list, at, mode: "place" | "page", words }
  back: null,               // where "Open page" came from: { hash, label }
  sortBy: "book", filter: null, similar: null,   // the places: their order, a narrowing ("Where it sits"), another spelling
  want: null, ask: null,

  /* ---- following the Reader ---- */
  async sync() {
    const el = $("#rd-text");
    if (!el || el.hidden || !R.spreads) { this.undecorate(); Reader.markHits(null); return; }
    const shown = this.shown();
    const key_ = JSON.stringify([shown.map(x => x.page || x.folded || x.sheet), this.script, !!SheetView?.inReader]);
    if (!el.firstChild || el !== this.el) { this.el = el; this.frame(el); this.onShow = ""; }
    if (this.wantSheet && !SheetView.inReader) {   // a place on a sheet that opens out whole: open it, then read on
      const p = (R.spreads[R.at] || []).find(x => x && x.grid && x.sheet === this.wantSheet);
      if (p) { this.wantSheet = null; SheetView.open(p.sheet); return; }
    }
    if (key_ === this.onShow) { this.decorate(); this.keepInView(); return; }
    this.onShow = key_;
    this.hov = null; $("#tx-tip")?.remove();
    const gen = ++this.gen;
    if (!Text.pages) $(".tx-body", el).replaceChildren(h("p", { class: "tx-msg" }, "Loading the text…"));
    try {
      await Text.base();
      const pages = [...new Set(shown.filter(x => x.page && Text.has(x.page)).map(x => x.page))];
      const got_ = await Promise.all(pages.map(async p => [p, await Shapes.of(p)]));
      if (gen !== this.gen) return;
      this.loaded = new Map(pages.map(p => [p, Text.pages.get(p)]));
      this.shapes = new Map(got_);
      this.shownNow = shown;
      if (this.anchor && !this.loaded.has(unkey(this.anchor).page)) { this.anchor = this.focus = null; }
      if (this.view?.kind === "ring" && !this.loaded.has(this.view.page)) this.view = null;
      if (this.peekAt) this.closePeek();
      this.closeSky();
      this.takeWanted();
      this.show();
      this.decorate();
      this.light();
    } catch (e) {
      if (gen !== this.gen) return;
      this.onShow = "";
      $(".tx-body", el).replaceChildren(h("p", { class: "tx-msg" }, "The text could not be loaded (" + e.message + ")."));
    }
  },

  /* the pages on show, left to right, with the panels folded away inside them; a whole sheet when it is open over the
     Reader (the Rosettes) */
  shown() {
    if (SheetView?.inReader) return SheetView.segs().map(seg => ({ page: seg.page, seg }));
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
      if (p.grid) out.push({ sheet: p.sheet, side: p });
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
    // shift-click takes in the words up to the one clicked: the browser must not stretch its own text selection too
    body.addEventListener("mousedown", e => { if ((e.shiftKey || e.metaKey || e.ctrlKey) && e.target.closest(".w[data-k]")) e.preventDefault(); });
    body.addEventListener("click", e => {
      const w = e.target.closest(".w[data-k]");
      if (!w) return;
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey && getSelection()?.toString() && this.fromTextSelection()) return;   // dragged over
      getSelection()?.removeAllRanges();
      this.pick(w.dataset.k, { extend: e.shiftKey, collect: e.metaKey || e.ctrlKey });
    });
    body.addEventListener("mouseup", e => { if (!e.shiftKey && !e.metaKey && !e.ctrlKey) setTimeout(() => this.fromTextSelection(), 0); });
    body.addEventListener("keydown", e => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches(".w[data-k]")) { e.preventDefault(); this.pick(e.target.dataset.k, { extend: e.shiftKey, collect: e.metaKey || e.ctrlKey }); }
    });
    body.addEventListener("pointerover", e => { const w = e.target.closest(".w[data-k]"); if (w) this.hover(w.dataset.k, false); });
    body.addEventListener("pointerout", e => { if (e.target.closest(".w[data-k]") && !e.relatedTarget?.closest?.(".w[data-k]")) this.hover(null); });
    this.wireStage();
  },
  /* words dragged over in the page text become the words chosen */
  fromTextSelection() {
    const s = getSelection();
    if (!s || s.isCollapsed || !this.el) return false;
    const ws = $$(".tx-body .w[data-k]", this.el).filter(w => s.containsNode(w, true));
    if (ws.length < 2) return false;
    const a = ws[0].dataset.k, b = ws[ws.length - 1].dataset.k;
    if (unkey(a).page !== unkey(b).page) return false;
    s.removeAllRanges();
    this.anchor = a; this.focus = b; this.set = []; this.view = null;
    this.chosen();
    return true;
  },

  /* Drag the panel's edge to make it wider (beside the pages) or taller (below them, on a phone); arrow keys too. */
  grip(g, el) {
    const BELOW = "(max-width: 760px) and (orientation: portrait), (max-width: 560px)";   // as style.css stacks them
    const below = () => matchMedia(BELOW).matches;
    const apply = () => {
      const s = store.get("text:size", null);
      el.style.removeProperty("--tx-w"); el.style.removeProperty("--tx-h");
      if (s && s.w) el.style.setProperty("--tx-w", `min(${s.w}px, 46vw)`);   // a width chosen in a bigger window never squeezes the pages
      if (s && s.hh) el.style.setProperty("--tx-h", `min(${s.hh}px, 60vh)`);
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
    matchMedia(BELOW).addEventListener("change", apply);
    apply();
  },

  /* ---- the words on the photographs ---- */
  /* Over each panel on show, an SVG of its words' shapes, inside the page so it zooms, pans and turns with it: a ring's
     words as bands of the ring, a slanting line's as turned boxes. The shapes are invisible until pointed at or chosen;
     their outlines are drawn on a layer of their own (marks). */
  decorate() {
    const segEls = SheetView?.inReader ? $$("#rd-stage .sv-over .seg[data-page]") : $$("#rd-zoomer .spread .seg[data-page]");
    for (const segEl of segEls) {
      const img = $("img", segEl)?.dataset.key;
      const mine = [...this.shapes].flatMap(([page, m]) => m ? [...m].filter(([, s]) => s.img === img).map(([k, s]) => [page, k, s]) : []);
      if (!mine.length) { $(".seg-words", segEl)?.remove(); continue; }
      let layer = $(".seg-words", segEl);
      if (!layer || layer.dataset.n !== String(mine.length) || layer.dataset.img !== img) {
        layer?.remove();
        const aspect = mine[0][2].aspect;
        layer = svg("svg", { class: "seg-words", viewBox: `0 0 ${(1000 * aspect).toFixed(1)} 1000`, preserveAspectRatio: "none", "aria-hidden": "true" });
        layer.dataset.n = mine.length; layer.dataset.img = img;
        const hits = svg("g", { class: "hits" });
        for (const [page, k, s] of mine) {
          const [li, wi] = k.split(":");
          const p = svg("path", { d: shapePath(s), class: s.est ? "wb est" : "wb" });
          p.dataset.k = key(page, li, wi);
          hits.append(p);
        }
        layer.append(hits, svg("path", { class: "dim", "fill-rule": "evenodd" }), svg("g", { class: "marks" }));
        segEl.append(layer);
      }
      const rot = ((([...this.shownNow || []].find(x => x.seg?.img === img)?.seg?.rot) || 0) % 360 + 360) % 360;
      layer.style.transform = rot ? `rotate(${rot}deg)` : "";
    }
    this.marks();
  },
  undecorate() {
    $$("#rd-stage .seg-words").forEach(l => l.remove());
    $$("#rd-stage .has-sel").forEach(e => e.classList.remove("has-sel"));
    $("#tx-tip")?.remove();
    this.closePeek();
  },
  /* the words chosen, from the anchor to the focus, in reading order */
  chosenKeys() {
    if (!this.anchor) return [];
    const { page } = unkey(this.anchor), all = this.pageOrder(page);
    let a = all.indexOf(this.anchor), b = all.indexOf(this.focus ?? this.anchor);
    if (a < 0) return [];
    if (b < 0) b = a;
    if (a > b) [a, b] = [b, a];
    return all.slice(a, b + 1);
  },
  pageOrder(page) {
    const out = [], loci = this.loaded.get(page) || Text.pages?.get(page) || [];
    loci.forEach((loc, li) => loc.words.forEach((w, wi) => { if (w.codes.length) out.push(key(page, li, wi)); }));
    return out;
  },
  /* the words lit on the photographs: the words chosen (white, the page dimmed round them), the words of a set that are
     on show (outlined only), the word pointed at */
  lit() {
    if (this.view?.kind === "set") return new Set(this.view.onShow || []);
    if (this.view?.kind === "ring") return new Set(this.view.keys || []);
    return new Set(this.chosenKeys());
  },
  marks() {
    const chosen = this.lit(), dimming = !this.view || this.view.kind === "ring";
    let any = false;
    for (const layer of $$("#rd-stage .seg-words")) {
      const marks = $(".marks", layer), dim = $(".dim", layer);
      marks.replaceChildren();
      // a dark hairline under a thin white line, so it shows on pale parchment and dark ink alike
      const outline = (p, cls) => { const est = p.classList.contains("est") ? " est" : "";
        marks.append(svg("path", { d: p.getAttribute("d"), class: `out u ${cls}${est}` }), svg("path", { d: p.getAttribute("d"), class: `out ${cls}${est}` })); };
      const sel = $$(".wb", layer).filter(p => chosen.has(p.dataset.k));
      const vb = layer.viewBox.baseVal;
      if (sel.length && dimming) dim.setAttribute("d", `M0 0H${vb.width}V1000H0Z` + sel.map(p => p.getAttribute("d")).join(""));
      else dim.removeAttribute("d");
      if (sel.length) any = true;
      for (const p of sel) outline(p, this.view?.kind === "set" ? "set" : "sel");
      const hp = this.hov && !chosen.has(this.hov) && $(`.wb[data-k="${CSS.escape(this.hov)}"]`, layer);
      if (hp) outline(hp, "hov");
      layer.closest(".seg")?.classList.toggle("sel-seg", sel.length > 0);
    }
    const holder = $("#rd-stage .sv-over") || $("#rd-zoomer .spread");
    holder?.classList.toggle("has-sel", any && dimming);
    if (this.el) {
      $$(".tx-body .w.lit, .tx-body .w.sel, .tx-body .w.inset", this.el).forEach(w => w.classList.remove("lit", "sel", "inset"));
      for (const k of chosen) $$(`.tx-body .w[data-k="${CSS.escape(k)}"]`, this.el).forEach(w => w.classList.add(this.view?.kind === "set" ? "inset" : "sel"));
      if (this.hov) $$(`.tx-body .w[data-k="${CSS.escape(this.hov)}"]`, this.el).forEach(w => w.classList.add("lit"));
    }
  },
  /* the words just arrived at (a place opened from elsewhere): their outline pulses once, so the eye finds them */
  flash() {
    for (const o of $$("#rd-stage .seg-words .out.sel:not(.u)")) { o.classList.remove("flash"); void o.getBBox(); o.classList.add("flash"); }
  },
  /* Point at a word: it is outlined on the photograph, lit in the text, and says in one line what it reads. */
  hover(k, onPhoto = true) {
    if (k === this.hov) return;
    this.hov = k;
    this.marks();
    const tip = $("#tx-tip");
    if (!k || !onPhoto) { tip?.remove(); return; }
    const box = $(`#rd-stage .wb[data-k="${CSS.escape(k)}"]`), it = this.item(k);
    if (!box || !it) { tip?.remove(); return; }
    const st = $("#rd-stage"), r = box.getBoundingClientRect(), sr = st.getBoundingClientRect();
    const t = tip || h("div", { id: "tx-tip", class: "tx-tip", role: "status" });
    const glyph = this.script === "glyphs";
    const n = Find.find([writeAs(it.w.codes, letters(this.script))], this.script).length;
    t.replaceChildren(h("b", { class: glyph ? "gl" : "" }, ...wordNodes(it.w.codes, this.script)),
      glyph ? h("span", { class: "ev" }, writeAs(it.w.codes, "eva")) : "",
      h("span", { class: "say" }, n > 1 ? `${(n - 1).toLocaleString("en")} more in the book` : "only here"),
      box.classList.contains("est") ? h("span", { class: "say" }, "place estimated") : "");
    if (!tip) st.append(t);
    t.style.left = Math.max(80, Math.min(sr.width - 80, r.left - sr.left + r.width / 2)) + "px";
    t.style.top = Math.max(44, r.top - sr.top) + "px";
  },
  /* Clicks on the photograph: a click that does not drag chooses the word under it (shift: the words up to it; ⌘/Ctrl:
     into a set); one on bare parchment lets go. */
  wireStage() {
    const st = $("#rd-stage");
    if (st.dataset.words) return;
    st.dataset.words = "1";
    let down = null;
    // the hit areas are wider than the words, so the one nearest the pointer is taken, not the one drawn last
    st.addEventListener("pointermove", e => { if (TextUI.open && e.pointerType === "mouse") { const b = this.wordAt(e.clientX, e.clientY); if (b) this.hover(b.dataset.k); else if (this.hov && !e.target.closest?.(".tx-peek, .sky")) this.hover(null); } });
    st.addEventListener("pointerleave", () => { if (this.hov) this.hover(null); });
    st.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; $("#tx-tip")?.remove(); });
    st.addEventListener("wheel", () => { if (this.hov) this.hover(null); }, { passive: true });
    st.addEventListener("pointerup", e => {
      if (!TextUI.open || !down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), long = Date.now() - down.t;
      down = null;
      if (moved > 5 || long > 700 || e.target.closest("button, .tx-peek, .sky")) return;
      const hits = document.elementsFromPoint(e.clientX, e.clientY);
      const b = this.wordAt(e.clientX, e.clientY, hits);
      if (b) { this.picked = Date.now(); this.pick(b.dataset.k, { extend: e.shiftKey, collect: e.metaKey || e.ctrlKey }); }
      else if ((this.anchor || this.view) && hits.some(x => x.classList?.contains("seg"))) this.unpick();
    });
  },
  /* the word under the pointer: of the shapes whose hit area is there, the one whose own outline is nearest */
  wordAt(x, y, hits = document.elementsFromPoint(x, y)) {
    const ws = hits.filter(el => el.classList?.contains("wb"));
    if (ws.length < 2) return ws[0] || null;
    const d = el => { const r = el.getBoundingClientRect(); return Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)); };
    return ws.reduce((a, b) => d(b) < d(a) ? b : a);
  },
  /* the Reader's double-click zoom leaves alone a click that just chose a word */
  justPicked() { return Date.now() - (this.picked || 0) < 450; },

  /* ---- choosing words ---- */
  item(k) {
    const { page, li, wi } = unkey(k), loci = this.loaded.get(page) || Text.pages?.get(page);
    const loc = loci && loci[li];
    if (!loc || !loc.words[wi]) return null;
    return { page, li, wi, loc, w: loc.words[wi] };
  },
  wordText(w) { return writeAs(w.codes, letters(this.script)); },
  /* Choose a word, without moving the page. extend: the words from the one chosen to it (a phrase, on one page);
     collect: into a set, or out of it */
  pick(k, { extend = false, collect = false } = {}) {
    const it = this.item(k);
    if (!it) return;
    this.closePeek();
    this.closeSky();
    if (collect) {
      if (this.view?.kind === "set" && this.view.from === "page") this.set = [];   // a page's words: start afresh
      else if (this.view?.kind !== "set") {   // from what was chosen
        this.set = this.chosenKeys().map(x => ({ s: this.wordText(this.item(x).w), k: x }));
        if (this.set.length > 1) toast(`The ${this.set.length} words chosen are now a set, in any order`);
      }
      const s = this.wordText(it.w), at = this.set.findIndex(x => x.s === s);
      if (at >= 0) this.set.splice(at, 1); else this.set.push({ s, k });
      this.anchor = this.focus = null;
      this.openSet();
      return;
    }
    if (extend && this.anchor && unkey(this.anchor).page === unkey(k).page && !this.view) this.focus = k;
    else { this.anchor = this.focus = k; }
    this.view = null; this.similar = null; this.filter = null;
    this.chosen();
  },
  chosen({ arrived = false } = {}) {
    $("#tx-tip")?.remove();
    this.closeSky();   // the skyline was drawn for the words chosen before
    this.show();
    this.marks();
    this.ensureVisible();
    if (arrived) requestAnimationFrame(() => this.flash());
    setHash();
  },
  unpick() {
    this.closeSky();
    const k = this.anchor;
    this.anchor = this.focus = null;
    this.view = null; this.set = []; this.similar = null; this.filter = null;
    this.closePeek();
    this.show();
    this.marks();
    setHash();
    if (k) $(`.tx-body .w[data-k="${CSS.escape(k)}"]`, this.el)?.scrollIntoView({ block: "nearest" });
  },
  /* the words chosen grow by one word before or after, or let go of the last one */
  extend(d) {
    const ks = this.chosenKeys();
    if (!ks.length) return;
    const all = this.pageOrder(unkey(ks[0]).page), a = all.indexOf(ks[0]), b = all.indexOf(ks[ks.length - 1]);
    const na = d < 0 ? a - 1 : a, nb = d > 0 ? b + 1 : b;
    if (na < 0 || nb >= all.length) return;
    this.anchor = all[na]; this.focus = all[nb];
    this.chosen();
  },
  shrink() {
    const ks = this.chosenKeys();
    if (ks.length < 2) return;
    this.anchor = ks[0]; this.focus = ks[ks.length - 2];
    this.chosen();
  },
  stepWord(d) {
    const ks = this.chosenKeys();
    if (!ks.length) return;
    const all = this.pageOrder(unkey(ks[0]).page), i = all.indexOf(d > 0 ? ks[ks.length - 1] : ks[0]) + d;
    if (all[i]) this.pick(all[i]);
  },
  canExtend(d) {
    const ks = this.chosenKeys();
    if (!ks.length) return false;
    const all = this.pageOrder(unkey(ks[0]).page), i = all.indexOf(d < 0 ? ks[0] : ks[ks.length - 1]) + d;
    return i >= 0 && i < all.length;
  },

  /* ---- keeping the page where it is ---- */
  /* the words' box on screen */
  onScreen(keys) {
    const ps = keys.map(k => $(`#rd-stage .wb[data-k="${CSS.escape(k)}"]`)).filter(Boolean);
    if (!ps.length) return null;
    const z = $("#rd-zoomer");   // a zoom still easing would be measured half way: let it land first
    if (z.style.transition) { z.style.transition = ""; void z.offsetWidth; }
    const rs = ps.map(p => p.getBoundingClientRect());
    const box = { left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)), right: Math.max(...rs.map(r => r.right)), bottom: Math.max(...rs.map(r => r.bottom)) };
    return { box, cx: (box.left + box.right) / 2, cy: (box.top + box.bottom) / 2 };
  },
  /* Choosing a word never zooms or turns the page. Only if the page is zoomed in and the words are out of sight is it
     moved, as little as it takes, at the same zoom. */
  ensureVisible() {
    if (SheetView.inReader || R.zoom <= 1 && !R.rot) return;
    const at = this.onScreen(this.chosenKeys());
    if (!at) return;
    const sr = $("#rd-stage").getBoundingClientRect();
    const inView = at.box.left > sr.left + 20 && at.box.right < sr.right - 20 && at.box.top > sr.top + 20 && at.box.bottom < sr.bottom - 20;
    if (!inView) Reader.view({ at: [at.cx - sr.left, at.cy - sr.top], ease: true });
  },
  /* Turn the page so the words read level, about them, at the same zoom: asked for, never done by itself */
  turnUpright() {
    const ks = this.chosenKeys(), at = this.onScreen(ks), r = this.uprightTurn(ks[0]);
    if (!at || r === null) return;
    const sr = $("#rd-stage").getBoundingClientRect();
    Reader.view({ at: [at.cx - sr.left, at.cy - sr.top], rot: r, ease: true });
  },
  uprightTurn(k) {
    const it = this.item(k), s = it && this.shapes.get(it.page)?.get(`${it.li}:${it.wi}`);
    if (!s) return null;
    const seg = (this.shownNow || []).find(x => x.seg?.img === s.img)?.seg;
    const want = -((s.ang || 0) + (seg?.rot || 0));
    return ((want % 360) + 540) % 360 - 180;
  },
  tilt(k) {
    const u = this.uprightTurn(k);
    if (u === null) return 0;
    return Math.abs((((u - (R.rot || 0)) % 360) + 540) % 360 - 180);
  },
  /* The stage changed size while zoomed in on the words chosen: they are brought back into view. */
  keepInView() {
    if (!this.recentre) return;
    this.recentre = false;
    if (this.anchor && R.zoom > 1) this.ensureVisible();
  },
  /* the page was turned: the panel's turn button follows */
  reacts() {
    const old = this.el && $(".tx-body .tx-fig-acts", this.el);
    if (!old || !this.anchor) return;
    old.replaceChildren(this.zoomButton() || "", this.turnButton() || "");
  },

  /* ---- the panel ---- */
  show() {
    if (!this.el) return;
    const body = $(".tx-body", this.el);
    const kind = this.view?.kind || (this.anchor ? "word" : "page");
    if (body.dataset.view === "page" && kind !== "page") this.pageScroll = body.scrollTop;
    if (kind === "set") this.setView(body);
    else if (kind === "ring") this.ringView(body);
    else if (kind === "word") this.wordView(body);
    else this.pageView(body);
    const was = body.dataset.view;
    body.dataset.view = kind;
    body.classList.toggle("caps", this.script === "fsg" || this.script === "cur");
    if (!this.keepScroll) body.scrollTop = kind === "page" ? this.pageScroll || 0 : was === kind ? body.scrollTop : 0;
    this.keepScroll = false;
    this.strip();
  },
  /* how the text is shown: the glyphs, or one of three alphabets */
  scriptMenu() {
    return h("div", { class: "tx-seg", role: "group", "aria-label": "Show the text as" },
      SCRIPTS.map(([v, n, what]) => h("button", { title: what, "aria-pressed": String(this.script === v), onclick: () => this.setScript(v) }, n)));
  },
  setScript(v) {
    if (!SCRIPT_NAME[v] || v === this.script) return;
    const from = letters(this.script);
    this.script = v;
    store.set("text:script", v);
    if (this.set.length && letters(v) !== from) {   // a set's words, rewritten in the new alphabet
      this.set = this.set.map(x => x.k && this.item(x.k) ? { ...x, s: this.wordText(this.item(x.k).w) } : x);
    }
    this.keepScroll = true;
    this.onShow = "";
    this.sync();
  },
  head(kids) {
    const head = $(".tx-head", this.el);
    head.replaceChildren(...kids, this.scriptMenu(),
      h("button", { class: "tx-ic", title: "The keys and clicks (?)", "aria-label": "Help", onclick: () => $("#cx-help-dlg").showModal() }, "?"),
      h("button", { class: "tx-ic", title: "Close the text (T)", "aria-label": "Close the text", onclick: () => TextUI.toggle(false) }, "✕"));
  },
  backButton(title = "Back to the page text (Esc)") {
    return h("button", { class: "tx-ic", title, "aria-label": title, onclick: () => this.unpick() }, "←");
  },
  /* the way back to where "Open page" came from */
  returnChip() {
    if (!this.back) return "";
    return h("button", { class: "tx-return", title: "Back where you were (the browser's Back does it too)", onclick: () => this.goBack() },
      "↩ Back to ", h("b", {}, this.back.label));
  },
  goBack() {
    const b = this.back;
    this.back = null;
    if (!b) return;
    if (history.state?.vvFrom === b.hash) history.back(); else location.hash = b.hash;
  },

  /* The text of the pages on show: plain lines, words you can point at and choose. */
  pageView(body) {
    const pages = [...this.loaded.keys()];
    this.head([h("span", { class: "tx-title" }, pages.map(pageName_).join(" · ") || "Text"), h("span", { class: "sp" })]);
    const kids = [];
    if (this.back) kids.push(this.returnChip());
    const seen = new Set();
    for (const x of this.shownNow || []) {
      if (x.folded) {
        const n = x.folded.filter(p => Text.has(p));
        if (n.length) kids.push(h("p", { class: "tx-folded" }, `Folded in: ${n.map(short).join(", ")}. `,
          h("button", { class: "tx-link", onclick: () => Reader.toggleUnfold() }, "Unfold"), " to read ", n.length > 1 ? "them" : "it", " (U)."));
        continue;
      }
      if (x.sheet) {
        kids.push(h("p", { class: "tx-folded" }, "This page opens out into a whole sheet. ",
          h("button", { class: "tx-link", onclick: () => SheetView.open(x.sheet) }, "Open it"), " to read its text beside it (U)."));
        continue;
      }
      if (!x.page || seen.has(x.page)) continue;
      seen.add(x.page);
      const loci = this.loaded.get(x.page);
      if (loci) kids.push(this.pageEl(x.page, loci, x));
    }
    if (!kids.some(k => k.classList?.contains("tx-page")))
      kids.unshift(h("p", { class: "tx-msg" }, (this.shownNow || []).length ? "No text on these pages." : "No text here: these leaves are lost."));
    kids.push(this.credits());
    body.classList.toggle("glyph", this.script === "glyphs");
    body.replaceChildren(...kids);
    this.marks();
  },
  pageEl(page, loci, x) {
    const seg = x.seg, facts = [];
    for (const n of seg?.scribes || []) if (SCRIBES[n]) facts.push(SCRIBES[n]);
    if (seg?.vars && LANG[seg.vars.L]) facts.push(LANG[seg.vars.L]);
    const counts = {};
    for (const l of loci) counts[kindOf(l)] = (counts[kindOf(l)] || 0) + 1;
    const groups = [];
    loci.forEach((l, li) => {
      const k = kindOf(l);
      let g = groups.find(x => x.k === k);
      if (!g) groups.push(g = { k, rows: [] });
      g.rows.push([l, li]);
    });
    const placed = this.shapes.get(page);
    return h("section", { class: "tx-page", "data-page": page, "aria-label": `Text of ${pageName_(page)}` },
      h("header", { class: "tx-ph" }, h("h3", {}, pageName_(page)),
        h("span", { class: "tx-count" }, [Object.keys(KINDS).filter(k => counts[k]).map(k => plural(counts[k], KINDS[k][1], KINDS[k][2])).join(", "), ...facts].join(" · ")),
        h("button", { class: "tx-share", title: "The pages that share the most of this page's words", onclick: () => this.openPageSet(page) }, "Pages like this one ", h("span", { "aria-hidden": "true" }, "›"))),
      placed ? "" : h("p", { class: "tx-nobox" }, "Where these words sit on the photograph is not known yet, so they cannot be pointed at there."),
      groups.flatMap(g => [
        groups.length > 1 || g.k !== "P" ? h("h4", { class: "tx-kind" }, KINDS[g.k][0],
          g.k === "C" ? h("span", { class: "tx-kind-n" }, " · click a ring's number to unroll it") : "") : null,
        h("div", { class: `tx-lines k-${g.k}` }, g.rows.map(([l, li], i) => this.lineEl(page, l, li, i)))]));
  },
  lineEl(page, loc, li, i, [from, to] = [0, Infinity]) {
    const out = [];
    if (from > 0) out.push(h("span", { class: "us" }, "… "));
    loc.words.forEach((w, wi) => {
      if (wi < from || wi > to) return;
      if (w.codes.length) out.push(h("span", { class: "w", "data-k": key(page, li, wi), tabindex: "0",
        title: this.script === "glyphs" ? writeAs(w.codes, "eva") : null }, ...wordNodes(w.codes, this.script)));
      if (wi < loc.words.length - 1 && wi < to) out.push(w.gap === "," ? h("span", { class: "us", title: "an uncertain space" }, " · ") : w.gap === "-" ? h("span", { class: "dr", title: "a drawing interrupts the line here" }, "   ") : " ");
    });
    if (to < loc.words.length - 1) out.push(h("span", { class: "us" }, " …"));
    const ring = kindOf(loc) === "C";
    return h("div", { class: `ln${loc.ps && i ? " ps" : ""}`, "data-id": loc.id },
      ring ? h("button", { class: "no ring", title: `Unroll this ring (${loc.id})`, onclick: () => this.openRing(page, li) }, lineNo(loc.id))
        : h("span", { class: "no", title: loc.id }, lineNo(loc.id)),
      h("span", { class: "t" }, out));
  },
  credits() {
    return h("footer", { class: "tx-foot" },
      h("p", {}, "Text: RF1b, René Zandbergen's reference transliteration (",
        h("a", { href: "https://www.voynich.nu/extra/sta-aaa.html", target: "_blank", rel: "noopener" }, "voynich.nu"),
        ", CC0), written in each alphabet by his own tables. ", h("a", { href: "#info/beinecke/consensus" }, "About the text"), "."),
      h("p", {}, "Word positions: The Voynichese Project (Apache 2.0), and on the Rosettes Alessandro Placa (CC BY 4.0), fitted to Yale's photographs."));
  },

  /* ---- the word, or phrase, chosen ---- */
  /* Layer one is the word itself: cut upright from the photograph, its glyphs with its letters under them, and one
     sentence. Then its line, then its other places as crops; then, behind named doors, where it sits and its near
     spellings. */
  /* glyphs picked in the word on show: one, or a run in one word (shift-click), and a way to find them elsewhere */
  pickGlyph(its, wn, ci, extend) {
    const g = this.gpick;
    if (extend && g && g.w === wn) this.gpick = { w: wn, a: Math.min(g.a, ci), b: Math.max(g.b, ci) };
    else if (g && g.w === wn && g.a === ci && g.b === ci) this.gpick = null;
    else this.gpick = { w: wn, a: ci, b: ci };
    const p = this.gpick, el = this.el;
    $$(".tx-reading .tx-g", el).forEach(b => b.classList.toggle("on", !!p && +b.dataset.w === p.w && +b.dataset.i >= p.a && +b.dataset.i <= p.b));
    const f = $(".tx-gfind", el);
    if (!f) return;
    if (!p) { f.hidden = true; f.replaceChildren(); return; }
    const codes = its[p.w].w.codes, run = codes.slice(p.a, p.b + 1), eva = writeAs(run, "eva");
    const whole = p.a === 0 && p.b === codes.length - 1;
    const q = whole ? eva : `${p.a === 0 ? "" : "*"}${eva}${p.b === codes.length - 1 ? "" : "*"}`;
    f.hidden = false;
    const where = whole ? "as a whole word" : p.a === 0 ? "starting words" : p.b === codes.length - 1 ? "ending words" : "inside words";
    f.replaceChildren(h("span", { class: "g", "aria-hidden": "true" }, run.map(chOf).join("")), ` ${eva}: find it `,
      h("a", { href: `#text/beinecke/search?q=${encodeURIComponent(q)}`, title: `Search the book for ${q}` }, where),
      ...(q === `*${eva}*` ? [] : [" · ", h("a", { href: `#text/beinecke/search?q=${encodeURIComponent(`*${eva}*`)}`, title: `Search the book for *${eva}*` }, "anywhere in a word")]));
  },
  wordView(body) {
    const ks = this.chosenKeys(), its = ks.map(k => this.item(k)).filter(Boolean);
    if (!its.length) { this.anchor = this.focus = null; this.pageView(body); return; }
    const first = its[0], last = its[its.length - 1], n = its.length;
    const where = first.loc.id === last.loc.id ? `${pageName_(first.page)} · line ${lineNo(first.loc.id)}` : `${pageName_(first.page)} · lines ${lineNo(first.loc.id)}–${lineNo(last.loc.id)}`;
    this.head([this.backButton(), h("span", { class: "tx-where" }, where), h("span", { class: "sp" }),
      h("button", { class: "tx-ic", title: "Copy the words, with where they are", "aria-label": "Copy", onclick: () => this.copy(its) }, "⧉"),
      h("button", { class: "tx-ic", title: "Copy a link to these words", "aria-label": "Copy a link", onclick: () => navigator.clipboard?.writeText(location.href).then(() => toast("Link copied"), () => toast(location.href)) }, "🔗"),
      h("button", { class: "tx-ic", title: "Note what you make of these words (kept in Your work)", "aria-label": "Add a note", onclick: () => this.note(its) }, "✎")]);
    const kids = [];
    if (this.back) kids.push(this.returnChip());
    // 1. the word: its picture, its glyphs and letters, one sentence
    const shapes = its.map(it => this.shapes.get(it.page)?.get(`${it.li}:${it.wi}`)).filter(Boolean);
    const fig = h("figure", { class: "tx-fig" });
    if (shapes.length) {
      fig.append(h("div", { class: "tx-crops" }, shapes.slice(0, 6).map(s => {
        const hh = n > 2 ? 52 : n > 1 ? 72 : 96, g = shapeGeom(s);
        const slot = h("span", { class: "tx-crop", style: { height: hh + "px", width: Math.min(n > 1 ? 164 : 328, Math.round(hh * (g.len + .6 * g.t) / (1.6 * g.t))) + "px" } });   // its size, before the photograph arrives
        upright(s, { h: hh, maxW: n > 1 ? 164 : 328, pad: .3 }).then(cv => { if (cv) { slot.replaceChildren(cv); slot.style.width = slot.style.height = ""; } else { slot.classList.add("failed"); slot.title = "Yale's photograph could not be loaded"; } });
        return slot;
      })), h("div", { class: "tx-fig-acts" }, this.zoomButton() || "", this.turnButton() || ""));
      if (shapes.some(s => s.est)) fig.append(h("figcaption", {}, "Where this word sits is estimated from the words beside it."));
    }
    kids.push(fig);
    const L = letters(this.script);
    // the glyphs, each one a key: pick one (shift-click for a run) to find it in other words
    this.gpick = null;
    const gl = h("span", { class: "gl", role: "group", "aria-label": "The word's glyphs: pick one, or shift-click a run, to find them in other words" });
    its.forEach((it, wn) => {
      if (wn) gl.append(" ");
      it.w.codes.forEach((c, ci) => gl.append(h("button", { type: "button", class: "tx-g", "data-w": wn, "data-i": ci,
        title: `${writeAs([c], "eva")}: pick to find it in other words (shift-click for a run of glyphs)`, "aria-label": `glyph ${writeAs([c], "eva")}`,
        onclick: e => this.pickGlyph(its, wn, ci, e.shiftKey) }, chOf(c))));
    });
    kids.push(h("div", { class: "tx-reading" }, gl,
      h("span", { class: "lt" }, ...its.flatMap((it, i) => [i ? " " : "", ...wordNodes(it.w.codes, L)])),
      h("p", { class: "tx-gfind", hidden: true })));
    const words = its.map(it => this.wordText(it.w));
    const places = this.placesOf(words);
    for (const x of Saved.placesAt(location.hash)) kids.push(h("p", { class: "tx-note" }, h("b", {}, "Your note: "), x.note, " ",
      h("button", { class: "tx-x", title: "Delete this note", "aria-label": "Delete this note", onclick: async () => { if (await askYes("Delete this note?", x.note, "Delete", true)) { Saved.removePlace(x.id); this.show(); } } }, "×")));
    kids.push(h("p", { class: "tx-say" }, this.sentence(words, places, first.page),
      h("span", { class: "tx-stamp" }, ` RF1b · ${SCRIPT_NAME[L]}${approxIn(its.flatMap(it => it.w.codes), L) ? ` · ${SCRIPT_NAME[L]} writes a glyph here by its nearest basic form` : ""}`)));
    if (n === 1) {                                              // Claude's own reading from the photograph, where there is one
      const slot = h("p", { class: "tx-photo", hidden: true });
      kids.push(slot);
      PhotoReading.of(first.page).then(b => {
        const r = b && b._map.get(`${first.li}:${first.wi}`);
        if (!r) return;
        const rf = writeAs(first.w.codes, "eva");
        slot.hidden = false;
        slot.replaceChildren(h("span", { class: "tx-dim" }, "Read from the photograph by Claude: "),
          r.eva ? h("b", { class: "mono" }, r.eva) : h("i", {}, "no writing found here"),
          r.eva ? h("span", { class: "tx-dim" }, r.eva === rf ? " · the same as RF1b" : ` · RF1b has ${rf}`) : "",
          h("span", { class: "tx-dim" }, ` · ${r.conf} confidence`),
          h("button", { class: "tx-i", title: b.about, "aria-label": "About this reading", onclick: () => toast(b.about) }, "i"));
      });
    }
    // its line: click a word of it to choose it instead, shift-click to take in the words up to it
    kids.push(h("div", { class: "tx-inline", "aria-label": "In its line" },
      h("button", { class: "tx-grow", title: "Take in the word before ({)", "aria-label": "Take in the word before", disabled: !this.canExtend(-1), onclick: () => this.extend(-1) }, "+"),
      h("div", { class: "tx-inl" }, [...new Set(its.map(it => it.li))].map(li => {
        const loc = (this.loaded.get(first.page) || Text.pages.get(first.page))[li];
        const mine = its.filter(it => it.li === li).map(it => it.wi);
        return this.lineEl(first.page, loc, li, 0, [Math.min(...mine) - 5, Math.max(...mine) + 5]);
      })),
      h("button", { class: "tx-grow", title: "Take in the word after (})", "aria-label": "Take in the word after", disabled: !this.canExtend(1), onclick: () => this.extend(1) }, "+")));
    const acts = [];
    if (n > 1) acts.push(h("button", { class: "tx-btn", title: "Let go of the last word", onclick: () => this.shrink() }, "− last word"),
      h("button", { class: "tx-btn", title: "Which pages hold all of these words, in any order", onclick: () => this.openSet(words.map((s, i) => ({ s, k: ks[i] })), "words") }, "Pages with these words, any order"));
    if (kindOf(first.loc) === "C") acts.push(h("button", { class: "tx-btn", title: "The ring laid out in a line, its repeats joined", onclick: () => this.openRing(first.page, first.li) }, "Unroll the ring"));
    if (acts.length) kids.push(h("div", { class: "tx-acts" }, acts));
    // 2. its other places
    if (places.length) kids.push(this.placesEl(words, places, first));
    // 3. where it sits; near spellings
    if (places.length) kids.push(this.sitsEl(places));
    if (n === 1) kids.push(this.similarEl(words[0]));
    if (n === 1) kids.push(this.transcribersEl(first));
    kids.push(h("p", { class: "tx-src" }, `RF1b${shapes.length ? " · position: " + (first.page === "fRos" ? "Alessandro Placa" : "The Voynichese Project") : ""}${shapes.length ? " · photograph: Yale University" : ""}`));
    body.classList.toggle("glyph", this.script === "glyphs");
    body.replaceChildren(...kids);
  },
  /* Zoom in on the words chosen, when they are small on screen: asked for, never done by itself */
  zoomButton() {
    const ks = this.chosenKeys(), at = this.onScreen(ks);
    if (!at || SheetView.inReader || at.box.bottom - at.box.top >= 36 || R.zoom >= MAX_ZOOM) return null;
    return h("button", { class: "tx-turn", title: "Zoom in on it (0 zooms out again)", onclick: () => this.zoomTo() }, "⌕ Zoom to it");
  },
  zoomTo() {
    const at = this.onScreen(this.chosenKeys());
    if (!at) return;
    const sr = $("#rd-stage").getBoundingClientRect(), hh = Math.max(4, at.box.bottom - at.box.top);
    Reader.view({ at: [at.cx - sr.left, at.cy - sr.top], zoom: Math.min(MAX_ZOOM, Math.max(R.zoom, R.zoom * 48 / hh)), ease: true });
    setTimeout(() => this.reacts(), 400);
  },
  turnButton() {
    const k = this.chosenKeys()[0];
    if (!k || SheetView.inReader) return null;   // (a whole sheet open over the pages zooms on its own, and does not turn)
    const tilt = this.tilt(k), turned = Math.abs(((R.rot % 360) + 540) % 360 - 180) > .5;
    if (tilt > 12) return h("button", { class: "tx-turn", title: "Turn the page so this reads level (0 turns it back)", onclick: () => this.turnUpright() }, "↻ Turn the page to read it");
    if (turned) return h("button", { class: "tx-turn", title: "Turn the page back (0)", onclick: () => Reader.view({ rot: 0, ease: true }) }, "Turn the page back");
    return null;
  },
  /* the places of the words (another spelling's, if one is chosen below), in the order asked for, narrowed as asked */
  placesOf(words) {
    const self = this.chosenKeys()[0];
    let all = Find.find(this.similar ? [this.similar] : words, this.script).filter(x => key(x.page, x.li, x.wi) !== self);
    if (this.filter) all = all.filter(this.filter.test);
    const pos = this.bookOrder();
    const ctx = (x, d) => { const a = Find.around(x.i, x.n, 1); return (d < 0 ? a.before[0]?.s : a.after[0]?.s) || "~"; };
    all.sort(this.sortBy === "before" ? (a, b) => ctx(a, -1).localeCompare(ctx(b, -1)) || a.i - b.i
      : this.sortBy === "after" ? (a, b) => ctx(a, 1).localeCompare(ctx(b, 1)) || a.i - b.i
      : (a, b) => (pos.get(a.page) ?? 1e9) - (pos.get(b.page) ?? 1e9) || a.i - b.i);
    return all;
  },
  sentence(words, places, here) {
    const pages = new Set(places.map(x => x.page));
    const what = this.similar ? h("b", {}, this.similar) : words.length > 1 ? "These words, in this order," : "This word";
    const is = words.length > 1 && !this.similar ? "are" : "is";
    if (!places.length) return [what, ` ${is} not found anywhere else in the book${this.filter ? ` (${this.filter.say})` : ""}.`];
    return [what, ` ${is} found ${plural(places.length, this.similar ? "time" : "more time", this.similar ? "times" : "more times")}, on ${plural(pages.size, "page", "pages")}${pages.has(here) && !this.similar ? " (this one too)" : ""}${this.filter ? ` (${this.filter.say})` : ""}.`];
  },
  /* the pages in the order chosen at the top (and, for a page not in it, the transcriptions' order) */
  bookOrder() {
    const pos = new Map();
    (R.pages || []).forEach((p, i) => { if (!p.lost) for (const s of [p.shown, ...p.segs]) if (s && !pos.has(s.page)) pos.set(s.page, i); });
    Text.order.forEach((p, i) => { if (!pos.has(p)) pos.set(p, 1e6 + i); });
    return pos;
  },
  /* Layer two: every other place, as a crop of the photograph centred on the word, with where it is; book order, or
     sorted by the word before or after so that a recurring frame lines up. A click opens it in a peek. */
  placesEl(words, places, first) {
    const sec = h("details", { class: "tx-places", open: !this.placesShut, ontoggle: e => { this.placesShut = !e.target.open; } });
    const sort = h("select", { "aria-label": "Order of the places", onclick: e => e.stopPropagation(), onchange: e => { this.sortBy = e.target.value; this.keepScroll = true; this.show(); } },
      [["book", "in book order"], ["before", "by the word before"], ["after", "by the word after"]].map(([v, t]) => { const o = h("option", { value: v }, t); o.selected = this.sortBy === v; return o; }));
    sec.append(h("summary", { class: "tx-ph2" }, h("h4", { class: "tx-h" }, this.similar ? `Places of ${this.similar}` : `Other places (${places.length.toLocaleString("en")})`),
      this.similar ? h("button", { class: "tx-x", title: "Back to the word chosen", onclick: e => { e.preventDefault(); this.similar = null; this.show(); } }, "×") : "",
      this.filter ? h("button", { class: "tx-chip on", title: "Show them all", onclick: e => { e.preventDefault(); this.filter = null; this.show(); } }, this.filter.say, " ×") : "",
      h("span", { class: "sp" }), places.length > 3 ? sort : "",
      h("button", { class: "tx-x", title: "Export the places as CSV (page, line, word, the words, the line)", "aria-label": "Export the places as CSV", onclick: e => { e.preventDefault(); this.exportPlaces(places, words); } }, "⤓")));
    if (!places.length) return sec;
    sec.append(this.miniSky(places, words, first), h("p", { class: "tx-dim" }, "Click one to see it beside this page; they are marked on the strip under the pages."));
    const grid = h("ol", { class: "tx-grid" });
    const SHOW = 24;
    // sorted by the word before or after, the places group under that word, as a concordance does
    const side = this.sortBy === "before" ? -1 : this.sortBy === "after" ? 1 : 0;
    const ctxOf = x => { const a = Find.around(x.i, x.n, 1); return (side < 0 ? a.before[0]?.s : a.after[0]?.s) || null; };
    const counts = new Map();
    if (side) for (const x of places) { const c = ctxOf(x); counts.set(c, (counts.get(c) || 0) + 1); }
    let last;
    const add = from => {
      for (const x of places.slice(from, from + SHOW)) {
        if (side) { const c = ctxOf(x); if (from === 0 && last === undefined || c !== last) { last = c;
          grid.append(h("li", { class: "tx-group" }, h("span", { class: `tx-group-w${this.script === "glyphs" ? " glyph" : ""}` }, c === null ? (side < 0 ? "first in its line" : "last in its line") : c), h("span", { class: "n" }, counts.get(c)))); } }
        grid.append(this.placeEl(x, places, words));
      }
      if (places.length > from + SHOW) grid.append(h("li", { class: "tx-more-li" }, h("button", { class: "tx-btn", onclick: e => { e.target.closest("li").remove(); add(from + SHOW); } },
        `Show ${Math.min(SHOW, places.length - from - SHOW)} more`)));
      this.lazyCrops(grid);
    };
    add(0);
    sec.append(grid);
    return sec;
  },
  async note(its) {
    const L = letters(this.script), words = its.map(it => writeAs(it.w.codes, L)).join(" ");
    const t = await askText(`A note on ${words}`, { placeholder: "e.g. the final glyph is not the same as on 67r2", ok: "Keep",
      body: "Kept in this browser and in your progress file (Your work), with a link back to these words." });
    if (!t) return;
    const x = Saved.addPlace(location.hash, `${pageName_(its[0].page)} · ${words}`, t);
    if (x) { toast("Note kept in Your work"); this.keepScroll = true; this.show(); }
  },
  /* the places as a file: one row each, with its line */
  exportPlaces(places, words) {
    const L = letters(this.script), q = s => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [["page", "locus", "word", "words", "line", "alphabet", "text"]];
    for (const x of places) {
      const loc = Text.pages.get(x.page)[x.li];
      rows.push([x.page, loc.id, x.wi + 1, Array.from({ length: x.n }, (_, k) => Find.toks[x.i + k].s).join(" "), loc.words.map(w => writeAs(w.codes, L)).join(" "), SCRIPT_NAME[L], "RF1b"]);
    }
    const blob = new Blob([rows.map(r => r.map(q).join(",")).join("\n") + "\n"], { type: "text/csv" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `places-${(this.similar || words.join("-")).replace(/[^a-z0-9?-]/gi, "_")}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  placeEl(x, list, words) {
    const loc = Text.pages.get(x.page)[x.li], a = Find.around(x.i, x.n, 1);
    const g = this.script === "glyphs", show = t => g ? Text.pages.get(t.page)[t.li].words[t.wi].codes.map(chOf).join("") : t.s;
    return h("li", { "data-page": x.page },
      h("button", { class: `tx-place${this.peekAt && this.peekAt.list[this.peekAt.at] === x ? " cur" : ""}`, title: `${pageName_(x.page)}, line ${lineNo(loc.id)}: see it beside this page`,
        onclick: () => this.openPeek(list, list.indexOf(x), words) },
        h("span", { class: "tx-hcrop", "data-page": x.page, "data-li": x.li, "data-wi": x.wi }),
        h("span", { class: `cx${g ? " glyph" : ""}` }, a.before.length ? show(a.before[0]) + " " : "",
          h("b", {}, Array.from({ length: x.n }, (_, k) => show(Find.toks[x.i + k])).join(" ")), a.after.length ? " " + show(a.after[0]) : ""),
        h("span", { class: "wh" }, `${pageName_(x.page)}·${lineNo(loc.id)}`)));
  },
  /* the pictures of the places, cut as they scroll into view */
  lazyCrops(list) {
    const io = this._io ||= new IntersectionObserver(es => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const d = e.target.dataset;
        Shapes.of(d.page).then(m => {
          const s = m && m.get(`${d.li}:${d.wi}`);
          if (!s) { e.target.classList.add("none"); return; }
          return upright(s, { h: 40, maxW: 240 }).then(cv => { if (cv) e.target.replaceChildren(cv); else e.target.classList.add("none"); });
        }).catch(() => e.target.classList.add("none"));
      }
    }, { root: $(".tx-body", this.el), rootMargin: "300px" });
    for (const c of $$(".tx-hcrop:not(.seen)", list)) { c.classList.add("seen"); io.observe(c); }
  },
  /* Layer three, behind a named door: where the places sit (first or last in a line, the kind of text, the section, the
     hand's “language”); a click narrows the places to one of them */
  sitsEl(places) {
    const groups = [
      ["In its line", [["first word of a line", x => x.first && x.kind === "P"], ["last word of a line", x => x.last && x.kind === "P"], ["inside a line", x => !x.first && !x.last && x.kind === "P"]]],
      ["Kind of text", Object.entries(KINDS).map(([k, [n]]) => [n.toLowerCase(), x => x.kind === k])],
      ["Section", [...new Set(places.map(x => factsOf(x.page).section))].sort().map(s => [s, x => factsOf(x.page).section === s])],
      ["Currier's language", [["A", x => factsOf(x.page).lang === "A"], ["B", x => factsOf(x.page).lang === "B"]]],
    ];
    const d = h("details", { class: "tx-door" }, h("summary", {}, "Where it sits"));
    const max = places.length;
    for (const [title, rows] of groups) {
      const counted = rows.map(([say, test]) => [say, test, places.filter(test).length]).filter(r => r[2]);
      if (counted.length < 1) continue;
      d.append(h("div", { class: "tx-sits" }, h("span", { class: "tx-sits-t" }, title),
        counted.map(([say, test, n]) => h("button", { class: "tx-bar", title: `Show only the places ${title === "Section" || title === "Currier's language" ? "in " : "as "}${say}`,
          onclick: () => { this.filter = { say: `${title === "Currier's language" ? "Currier " : ""}${say}`, test }; this.keepScroll = true; this.show(); } },
          h("span", { class: "nm" }, say), h("span", { class: "bar" }, h("i", { style: { width: Math.max(3, 100 * n / max) + "%" } })), h("span", { class: "n" }, n)))));
    }
    return d;
  },
  /* near spellings: the words one glyph off, most frequent first; a click shows their places instead */
  similarEl(w) {
    const d = h("details", { class: "tx-door" }, h("summary", {}, "Similar spellings"));
    d.addEventListener("toggle", () => {
      if (!d.open || d.children.length > 1) return;
      Find.build(this.script);
      const near = [];
      for (const [s, idx] of Find.byWord) if (s !== w && lev(s, w) === 1) near.push([s, idx.length]);
      near.sort((a, b) => b[1] - a[1]);
      d.append(near.length ? h("div", { class: "tx-sim" }, near.slice(0, 24).map(([s, n], k) => {
        const chip = h("button", { class: `tx-chip tx-simc${this.similar === s ? " on" : ""}`, title: `Show the places of ${s}`,
          onclick: () => { this.similar = s; this.filter = null; this.show(); $(".tx-places", this.el)?.scrollIntoView({ block: "start" }); } }, s, h("span", { class: "n" }, n));
        if (k < 12) {   // the spelling as it is written, at its first place: the judgement is made on the ink, not the letters
          const t = Find.toks[Find.byWord.get(s)[0]], slot = h("span", { class: "sim-crop" });
          chip.prepend(slot);
          Shapes.of(t.page).then(m => { const sh = m?.get(`${t.li}:${t.wi}`); return sh ? upright(sh, { h: 26, maxW: 110, pad: .25 }) : null; }).then(cv => { if (cv) slot.replaceChildren(cv); else slot.remove(); });
        }
        return chip;
      })) : h("p", { class: "tx-dim" }, "No word in the book is one glyph from it."));
    });
    return d;
  },
  /* Behind a door: what the independent transcriptions (the consensus Search is built on) read here. RF1b's word is
     matched to the consensus word with the same basic Eva, nearest the same position in the line. */
  transcribersEl(it) {
    const d = h("details", { class: "tx-door" }, h("summary", {}, "How the transcribers read it"));
    d.addEventListener("toggle", async () => {
      if (!d.open || d.children.length > 1) return;
      const out = h("div", { class: "tx-tr" }, h("p", { class: "tx-dim" }, "Loading…"));
      d.append(out);
      try {
        await Data.base();
        const pg = await load(`pages/${encodeURIComponent(it.page)}.json`);
        const loc = pg.loci.find(l => l.id === it.loc.id);
        if (!loc) { out.replaceChildren(h("p", { class: "tx-dim" }, "This line is not in the transcriptions compared.")); return; }
        const want = writeAs(it.w.codes, "eva");
        const ws = []; let off = 0;
        for (const w of loc.c.split(".")) { ws.push({ off, end: off + w.length, text: w.replace(/,/g, "") }); off += w.length + 1; }
        const same = ws.map((w, i) => [w, i]).filter(([w]) => w.text === want);
        const [w] = same.length ? same.reduce((a, b) => Math.abs(b[1] - it.wi) < Math.abs(a[1] - it.wi) ? b : a) : [null];
        if (!w) { out.replaceChildren(h("p", { class: "tx-dim" }, `The transcriptions compared do not split this line into the same words (their line: ${loc.c.replace(/\./g, " ")}).`)); return; }
        const n = loc.w.length, units = loc.u.filter(u => u[1] ? u[0] >= w.off && u[0] < w.end : u[0] > w.off && u[0] < w.end);
        const split = units.filter(u => u[2] !== "u");
        const kids = [h("p", { class: "tx-say" }, split.length ? `${n} transcribers; they differ on ${split.length === 1 ? "one glyph" : split.length + " glyphs"}:` : `All ${n} transcribers read it this way.`)];
        for (const u of split) kids.push(h("div", { class: "tx-tr-u" }, h("span", { class: "tx-dim" }, u[1] ? `glyph${u[1] > 1 ? "s" : ""} ${w.text.slice(u[0] - w.off, u[0] - w.off + u[1]) || "–"}: ` : "between two glyphs: "),
          ...u[3].filter(r => r[1] > 0).flatMap((r, i) => [i ? "; " : "", h("b", { class: "mono" }, r[0] || "nothing"), ` ${Number.isInteger(r[1]) ? r[1] : r[1].toFixed(1)} (${r[2].split(" ").map(c => SHORT[c] || c).join(", ")})`])));
        kids.push(h("p", { class: "tx-dim" }, `${loc.w.map(c => SHORT[c] || c).join(", ")}. The Text tab's Reading menu searches the consensus or any one of them.`));
        out.replaceChildren(...kids);
      } catch (e) { out.replaceChildren(h("p", { class: "tx-dim" }, "The transcriptions could not be loaded (" + e.message + ").")); }
    });
    return d;
  },
  copy(its) {
    const L = letters(this.script);
    const words = its.map(it => writeAs(it.w.codes, L)).join(" ");
    const t = `${words} (${its[0].loc.id}${its.length > 1 ? `, ${its.length} words` : ""}, RF1b, ${SCRIPT_NAME[L]})`;
    navigator.clipboard?.writeText(t).then(() => toast("Copied: " + t), () => toast(t));
  },

  /* ---- the strip under the pages: where the words are ---- */
  strip() {
    const kind = this.view?.kind || (this.anchor ? "word" : null);
    if (!kind || !Text.pages) { Reader.markHits(null); return; }
    const count = new Map();
    if (kind === "word") {
      const ks = this.chosenKeys(), words = ks.map(k => this.wordText(this.item(k).w));
      for (const x of Find.find(this.similar ? [this.similar] : words, this.script)) count.set(x.page, (count.get(x.page) || 0) + 1);
    } else if (kind === "set" && this.view.rows) {
      for (const r of this.view.rows) count.set(r.page, r.weight);
    } else if (kind === "ring" && this.view.matches) {
      for (const m of this.view.matches) count.set(m.page, (count.get(m.page) || 0) + m.n);
    }
    const max = Math.max(1, ...count.values());
    Reader.markHits(new Map([...count].map(([p, n]) => [p, n / max])), p => kind === "word" ? count.get(p) || 0 : 0);
  },

  /* ---- the peek: another place, beside the page, never in place of it ---- */
  /* list: places ({ page, li, wi, n }) or pages ({ page, keys }); a place shows its line round it, cut from the
     photograph, with the word outlined, and where it is on its page; a page shows the whole page with the words
     outlined. ‹ › (N, Shift+N) go through them; Open page goes there; Esc closes. */
  openPeek(list, at, words, mode = "place") {
    if (!list[at]) return;
    this.peekAt = { list, at, words, mode };
    const st = $("#rd-stage");
    let el = $(".tx-peek", st);
    if (!el) { el = h("div", { class: "tx-peek", role: "dialog", "aria-label": "Another place, beside this page" }); st.append(el); }
    // on the side of the stage away from the words chosen, so they stay in sight
    const at_ = this.onScreen(this.chosenKeys().length ? this.chosenKeys() : [...this.lit()]), sr = st.getBoundingClientRect();
    el.classList.toggle("left", !!at_ && at_.cx > sr.left + sr.width / 2);
    this.drawPeek(el);
    $$(".tx-place.cur", this.el).forEach(b => b.classList.remove("cur"));
    $$(".tx-place", this.el)[at]?.classList.add("cur");
    this.peekStrip();
  },
  drawPeek(el) {
    const { list, at, words, mode } = this.peekAt, x = list[at];
    const loci = Text.pages.get(x.page), loc = x.li != null ? loci[x.li] : null;
    const title = mode === "page" ? `${pageName_(x.page)}${x.say ? ` · ${x.say}` : ""}` : `${pageName_(x.page)} · line ${lineNo(loc.id)}`;
    const facts = factsOf(x.page);
    const body = h("div", { class: "pk-body" }, h("p", { class: "tx-msg" }, "Loading…"));
    el.replaceChildren(
      h("div", { class: "pk-head" },
        h("button", { class: "tx-ic", title: "The one before (Shift+N)", "aria-label": "The one before", disabled: at <= 0, onclick: () => this.peekStep(-1) }, "‹"),
        h("span", { class: "pk-n" }, `${at + 1} of ${list.length}`),
        h("button", { class: "tx-ic", title: "The next one (N)", "aria-label": "The next one", disabled: at >= list.length - 1, onclick: () => this.peekStep(1) }, "›"),
        h("span", { class: "pk-t" }, h("b", {}, title), h("span", {}, [facts.section !== "–" ? facts.section : "", facts.lang !== "–" ? `Currier ${facts.lang}` : ""].filter(Boolean).join(" · "))),
        h("button", { class: "tx-ic", title: "Close (Esc)", "aria-label": "Close", onclick: () => this.closePeek() }, "✕")),
      body,
      h("div", { class: "pk-foot" }, h("button", { class: "tx-btn on", title: `Turn the book to ${pageName_(x.page)}; Back returns here`, onclick: () => this.commit() }, `Open ${pageName_(x.page)}`)));
    Shapes.of(x.page).then(async m => {
      if (this.peekAt?.list[this.peekAt.at] !== x) return;
      if (mode === "page") { body.replaceChildren(this.ghostPage(x.page, m, x.keys || [], 300)); return; }
      const s = m && m.get(`${x.li}:${x.wi}`);
      const kids = [];
      const cv = s ? await upright(s, { h: 84, maxW: 560, ctx: 3, mark: true }) : null;
      if (this.peekAt?.list[this.peekAt.at] !== x) return;
      if (cv) kids.push(h("div", { class: "pk-crop" }, cv));
      else kids.push(h("p", { class: "tx-dim" }, s ? "Yale's photograph could not be loaded." : "Where this word sits on the photograph is not known."));
      const g = this.script === "glyphs";
      kids.push(h("div", { class: `pk-line${g ? " glyph" : ""}` }, h("span", { class: "no" }, lineNo(loc.id)),
        h("span", {}, loc.words.flatMap((w, wi) => w.codes.length ? [wi ? " " : "", wi >= x.wi && wi < x.wi + (x.n || 1) ? h("b", {}, ...wordNodes(w.codes, this.script)) : h("span", {}, ...wordNodes(w.codes, this.script))] : []))));
      kids.push(this.ghostPage(x.page, m, [key(x.page, x.li, x.wi)], 150, true));
      body.replaceChildren(...kids);
    });
  },
  /* a page as a small picture, its words of interest outlined on it */
  ghostPage(page, shapes, keys, height, small = false) {
    const f = factsOf(page), seg = f.seg;
    const wrap = h("div", { class: `pk-page${small ? " small" : ""}` });
    if (!seg) return wrap;
    const img = h("img", { src: imgUrl(seg.img, small ? "s" : "l", seg.v), alt: `${pageName_(page)}`, style: { height: height + "px" } });
    wrap.append(img);
    const mine = keys.map(k => { const { li, wi } = unkey(k); return shapes?.get(`${li}:${wi}`); }).filter(s => s && s.img === seg.img);
    if (mine.length) {
      const o = svg("svg", { class: "pk-marks", viewBox: `0 0 ${(1000 * mine[0].aspect).toFixed(1)} 1000`, preserveAspectRatio: "none" });
      for (const s of mine) o.append(svg("path", { d: shapePath(s), class: small ? "dot" : "out" }));
      wrap.append(o);
    }
    return wrap;
  },
  peekStep(d) {
    const p = this.peekAt;
    if (!p || !p.list[p.at + d]) return;
    p.at += d;
    this.drawPeek($(".tx-peek"));
    $$(".tx-place.cur", this.el).forEach(b => b.classList.remove("cur"));
    const btn = $$(".tx-place", this.el)[p.at];
    btn?.classList.add("cur");
    btn?.scrollIntoView({ block: "nearest" });
    this.peekStrip();
  },
  peekStrip() {
    const p = this.peekAt, page = p && p.list[p.at]?.page;
    for (const t of $$("#rd-strip .t")) { const q = R.pages[+t.dataset.i]; t.classList.toggle("peek", !!page && !!q && Reader.pagesOf(q).includes(page)); }
  },
  closePeek() {
    if (!this.peekAt) return;
    this.peekAt = null;
    $(".tx-peek")?.remove();
    $$("#rd-strip .t.peek").forEach(t => t.classList.remove("peek"));
    $$(".tx-place.cur", this.el).forEach(b => b.classList.remove("cur"));
  },
  /* Open page: the book turns to the place, which is chosen there; the way back is one chip, and the browser's Back */
  commit() {
    const p = this.peekAt;
    if (!p) return;
    const x = p.list[p.at];
    const here = this.chosenKeys()[0] ? this.item(this.chosenKeys()[0]) : null;
    this.back = { hash: location.hash, label: here ? `${pageName_(here.page)} · ${this.wordText(here.w)}` : pageName_([...this.loaded.keys()][0] || "") };
    history.pushState({ vvFrom: location.hash }, "", location.hash);
    this.closePeek();
    if (x.li != null) { this.want = { page: x.page, li: x.li, wi: x.wi, n: x.n || 1, arrived: true }; this.view = null; this.set = []; }
    else { this.want = null; this.view = null; this.set = []; this.anchor = this.focus = null; }
    if (this.loaded.has(x.page)) { this.takeWanted(); return; }
    this.turnTo(x.page);
  },
  turnTo(page) {
    const p = (R.pages || []).find(x => x && x.grid && x.segs.some(s => s.page === page));
    if (p) this.wantSheet = p.sheet;
    goToPage(page);
  },
  /* a word asked for (a place opened, the address) is chosen once its page is on show */
  takeWanted() {
    const w = this.want;
    if (!w || !this.loaded.has(w.page)) return;
    this.want = null;
    const all = this.pageOrder(w.page), i = all.indexOf(key(w.page, w.li, w.wi));
    if (i < 0) return;
    this.anchor = all[i]; this.focus = all[Math.min(all.length - 1, i + (w.n || 1) - 1)];
    this.view = null;
    this.chosen({ arrived: !!w.arrived });
  },

  /* ---- which pages share these words, in any order: a set ---- */
  /* from ⌘-clicks (or a phrase's words, any order) */
  openSet(set = this.set, from = null) {
    this.set = set;
    if (!this.set.length) { this.view = null; this.show(); this.marks(); setHash(); return; }
    this.view = { kind: "set", from };
    this.computeSet();
    this.show(); this.marks(); setHash();
  },
  /* from a whole page: its words, rare ones counting for more; scope: one kind of text only (labels, rings) */
  openPageSet(page, scope = null) {
    Find.build(this.script);
    const ws = [...new Set((Find.byPage.get(page) || []).map(i => Find.toks[i]).filter(t => !scope || t.kind === scope).map(t => t.s))];
    this.set = ws.map(s => ({ s }));
    this.anchor = this.focus = null;
    this.view = { kind: "set", from: "page", page, scope };
    this.computeSet();
    this.show(); this.marks(); setHash();
  },
  computeSet() {
    const v = this.view, words = this.set.map(x => x.s), scope = v.scope || null;
    Find.build(this.script);
    // each word stands for itself, or, one glyph off, for its family of near spellings too (most labels are found once:
    // their near spellings are what recurs)
    const family = new Map(words.map(w => [w, [w]]));
    if (this.near) for (const x of Find.byWord.keys()) for (const w of words) if (x !== w && lev(x, w) === 1) family.get(w).push(x);
    const of = new Map();
    for (const [w, xs] of family) for (const x of xs) { if (!of.has(x)) of.set(x, []); of.get(x).push(w); }
    const byPage = Find.pagesWith([...of.keys()], this.script, scope);
    const N = Text.order.length, idf = new Map(words.map(w => [w, Math.log(N / Math.max(1, Find.df(w)))]));
    const rows = [];
    for (const [page, e] of byPage) {
      if (v.from === "page" && page === v.page) continue;
      const exact = new Set(), near = new Map();   // set word -> the near spelling found
      for (const x of e.words.keys()) for (const w of of.get(x)) { if (x === w) exact.add(w); else if (!near.has(w)) near.set(w, x); }
      for (const w of exact) near.delete(w);
      const shared = [...exact, ...near.keys()];
      rows.push({ page, shared, near, n: shared.length, score: [...exact].reduce((a, w) => a + (idf.get(w) || 0), 0) + [...near.keys()].reduce((a, w) => a + .5 * (idf.get(w) || 0), 0),
        keys: [...e.words.values()].flat().map(i => key(Find.toks[i].page, Find.toks[i].li, Find.toks[i].wi)) });
    }
    if (v.from === "page") rows.sort((a, b) => b.score - a.score || b.n - a.n);
    else rows.sort((a, b) => b.n - a.n || b.score - a.score);
    const max = Math.max(1e-9, ...rows.map(r => v.from === "page" ? r.score : r.n));
    for (const r of rows) r.weight = (v.from === "page" ? r.score : r.n) / max;
    v.rows = rows;
    v.onShow = [...this.loaded.keys()].flatMap(p => (byPage.get(p)?.words ? [...byPage.get(p).words.values()].flat() : []).map(i => key(Find.toks[i].page, Find.toks[i].li, Find.toks[i].wi)));
    v.expected = words.length > 1 && words.length <= 12 && v.from !== "page" && !this.near ? Find.expected(words, this.script) : null;
  },
  setView(body) {
    const v = this.view, words = this.set.map(x => x.s), n = words.length;
    const pageSet = v.from === "page";
    this.head([this.backButton("Back (Esc)"), h("span", { class: "tx-where" }, pageSet ? `Pages like ${pageName_(v.page)}` : `${n} word${n === 1 ? "" : "s"}, any order`), h("span", { class: "sp" })]);
    const kids = [];
    if (this.back) kids.push(this.returnChip());
    if (pageSet) {
      const kinds = new Set((Find.byPage.get(v.page) || []).map(i => Find.toks[i].kind));
      kids.push(h("p", { class: "tx-say" }, `The pages that share the most of ${pageName_(v.page)}'s ${plural(n, "word", "different words")}${v.scope ? ` (its ${KINDS[v.scope][2]} only)` : ""}. A word found on few pages counts for more than a common one.`));
      if (kinds.size > 1) kids.push(h("div", { class: "tx-chips", role: "group", "aria-label": "Which of its words" },
        [[null, "all its text"], ...[...kinds].map(k => [k, `its ${KINDS[k][2]}`])].map(([k, say]) =>
          h("button", { class: `tx-chip${(v.scope || null) === k ? " on" : ""}`, onclick: () => this.openPageSet(v.page, k) }, say))));
    } else {
      kids.push(h("div", { class: "tx-chips" }, this.set.map((x, i) => h("span", { class: "tx-chip on" }, x.s,
        h("button", { class: "tx-x", title: `Take ${x.s} out`, "aria-label": `Take ${x.s} out`, onclick: () => { this.set.splice(i, 1); this.openSet(this.set, v.from); } }, "×")))));
      const all = v.rows.filter(r => r.n === n).length, most = v.rows.filter(r => r.n === n - 1).length;
      kids.push(h("p", { class: "tx-say" }, n === 1 ? `On ${plural(v.rows.length, "page", "pages")}.`
        : [`All ${n} are on ${plural(all, "page", "pages")}`, n > 2 ? `; ${n - 1} of them on ${plural(most, "more page", "more pages")}` : "", ".",
          v.expected != null ? h("span", { class: "tx-stamp" }, ` If these words fell on pages by chance, about ${v.expected < 0.1 ? "none" : v.expected.toFixed(1)} would hold all ${n}.`) : ""]),
        h("p", { class: "tx-dim" }, "⌘-click (Ctrl-click) words, here or on the page, to add or take them out."));
    }
    kids.push(h("div", { class: "tx-chips", role: "group", "aria-label": "How alike the words must be" },
      [[false, "the same spelling"], [true, "one glyph off counts too"]].map(([on, say]) =>
        h("button", { class: `tx-chip${!!this.near === on ? " on" : ""}`, title: on ? "A word one glyph different (otaly for otal) counts as half a match" : "Only the same word counts",
          onclick: () => { this.near = on; this.computeSet(); this.keepScroll = true; this.show(); this.marks(); } }, say))));
    const list = h("ol", { class: "tx-ghosts" });
    const SHOW = 20;
    const add = from => {
      for (const r of v.rows.slice(from, from + SHOW)) list.append(this.ghostCard(r, v.rows, n, pageSet));
      if (v.rows.length > from + SHOW) list.append(h("li", { class: "tx-more-li" }, h("button", { class: "tx-btn", onclick: e => { e.target.closest("li").remove(); add(from + SHOW); } }, `Show ${Math.min(SHOW, v.rows.length - from - SHOW)} more`)));
    };
    add(0);
    if (!v.rows.length) kids.push(h("p", { class: "tx-dim" }, "No other page holds these words."));
    kids.push(list);
    if (!pageSet) {   // the text of the pages on show stays at hand, to add words from
      const d = h("details", { class: "tx-door", open: true }, h("summary", {}, "The text here: ⌘-click (Ctrl-click) words to add them"));
      for (const x of this.shownNow || []) if (x.page && this.loaded.get(x.page)) d.append(this.pageEl(x.page, this.loaded.get(x.page), x));
      kids.push(d);
    }
    body.classList.toggle("glyph", this.script === "glyphs");
    body.replaceChildren(...kids);
  },
  pageRow(r, rows, n, pageSet) {
    const dots = pageSet ? h("span", { class: "tx-score", title: "how much it shares (rare words count more)" }, h("i", { style: { width: Math.round(100 * r.weight) + "%" } }))
      : h("span", { class: "tx-deg", "aria-label": `${r.n} of ${n}` }, Array.from({ length: Math.min(n, 12) }, (_, i) => h("i", { class: i < r.n ? "on" : "" })));
    const shown = r.shared.slice().sort((a, b) => Find.df(a) - Find.df(b)).slice(0, 8).map(w => r.near?.has(w) ? `≈${r.near.get(w)}` : w);
    const thumb = h("span", { class: "tx-thumb" });
    Shapes.of(r.page).then(m => thumb.replaceChildren(this.ghostPage(r.page, m, r.keys, 64, true)));
    return h("li", {}, h("button", { class: "tx-prow", title: `See ${pageName_(r.page)} beside this page, with these words marked`,
      onclick: () => this.openPeek(rows.map(x => ({ page: x.page, keys: x.keys, say: pageSet ? `${x.n} shared words` : `${x.n} of ${n}` })), rows.indexOf(r), this.set.map(x => x.s), "page") },
      thumb,
      h("span", { class: "tx-pr" }, h("span", { class: "tx-pr-t" }, h("b", {}, pageName_(r.page)), h("span", { class: "tx-dim" }, factsOf(r.page).section !== "–" ? factsOf(r.page).section : ""), dots),
        h("span", { class: "tx-pr-w" }, shown.join(" · "), r.shared.length > shown.length ? ` +${r.shared.length - shown.length}` : ""))));
  },

  /* ---- a ring unrolled: which words repeat round it, and which other lines share runs of its words ---- */
  openRing(page, li) {
    this.anchor = this.focus = null; this.set = [];
    const loc = (this.loaded.get(page) || Text.pages.get(page))[li];
    const keys = loc.words.map((w, wi) => w.codes.length ? key(page, li, wi) : null).filter(Boolean);
    this.view = { kind: "ring", page, li, keys };
    this.computeRing();
    this.show(); this.marks(); setHash();
  },
  computeRing() {
    const v = this.view, loc = Text.pages.get(v.page)[v.li];
    Find.build(this.script);
    const ws = loc.words.filter(w => w.codes.length).map(w => this.wordText(w));
    v.words = ws;
    // repeats inside the ring: each word joined to its next occurrence; a repeated run of two or more words as one band
    const arcs = [];
    for (let i = 0; i < ws.length; i++) {
      const j = ws.indexOf(ws[i], i + 1);
      if (j < 0) continue;
      let n = 1;
      while (i + n < j && j + n < ws.length && ws[i + n] === ws[j + n]) n++;
      if (arcs.some(a => a.i < i && a.i + a.n > i && a.j - a.i === j - i)) continue;   // inside a run already joined
      arcs.push({ i, j, n });
    }
    v.arcs = arcs;
    // other lines sharing a run of its words in the same order: for each, its longest run. Common words make chance
    // runs, so a run counts only if it is three words or more, or two words that are not common
    const N = Text.order.length, idf = w => Math.log(N / Math.max(1, Find.df(w)));
    const best = new Map();
    for (let i = 0; i + 1 < ws.length; i++) {
      for (const x of Find.find([ws[i], ws[i + 1]], this.script)) {
        if (x.page === v.page && x.li === v.li) continue;
        let n = 2;
        while (i + n < ws.length && Find.toks[x.i + n - 1]?.on && Find.toks[x.i + n]?.s === ws[i + n]) n++;
        const run = ws.slice(i, i + n), weight = run.reduce((a, w) => a + idf(w), 0);
        if (n < 3 && (weight < 4 || run.some(w => w.length < 3))) continue;
        const id = `${x.page}|${x.li}`, old = best.get(id);
        if (!old || n > old.n || (n === old.n && weight > old.weight)) best.set(id, { page: x.page, li: x.li, wi: x.wi, n, run, weight, i });
      }
    }
    v.matches = [...best.values()].map(r => ({ ...r, kind: kindOf(Text.pages.get(r.page)[r.li]) }))
      .sort((a, b) => b.n - a.n || b.weight - a.weight).slice(0, 12);
  },
  ringView(body) {
    const v = this.view, loc = Text.pages.get(v.page)[v.li];
    this.head([this.backButton("Back to the page text (Esc)"), h("span", { class: "tx-where" }, `${pageName_(v.page)} · ring ${lineNo(loc.id)} · ${plural(v.words.length, "word", "words")}`), h("span", { class: "sp" })]);
    const kids = [];
    if (this.back) kids.push(this.returnChip());
    kids.push(h("p", { class: "tx-say" }, "The ring laid out in a line, in the transcription's reading order, from where it starts. An arc joins a word to the next place it comes round again; a thick one, a run of words."));
    // the strip: each word upright, cut from the photograph, in a cell as wide as its glyphs
    const W = ws => Math.max(44, 10 * ws.length + 14);
    const cells = v.words.map(W);
    const x0 = []; let acc = 0; for (const c of cells) { x0.push(acc); acc += c + 6; }
    const height = Math.min(90, 18 + Math.max(0, ...v.arcs.map(a => (x0[a.j] - x0[a.i]) / 6)));
    const arcs = svg("svg", { class: "rg-arcs", width: acc, height, viewBox: `0 0 ${acc} ${height}` });
    for (const a of v.arcs) {
      const xa = x0[a.i] + cells[a.i] / 2, xb = x0[a.j] + cells[a.j] / 2, hh = Math.min((height - 3) / 1.3, 10 + (xb - xa) / 6);
      arcs.append(svg("path", { d: `M${xa} ${height}C${xa} ${height - hh * 1.3} ${xb} ${height - hh * 1.3} ${xb} ${height}`, class: a.n > 1 ? "run" : "one", "stroke-width": a.n > 1 ? Math.min(6, 1.5 + a.n / 2) : 1 }));
    }
    const repeated = new Set(v.arcs.flatMap(a => Array.from({ length: a.n }, (_, k) => [a.i + k, a.j + k]).flat()));
    const row = h("div", { class: "rg-row" }, v.words.map((w, i) => {
      const cell = h("button", { class: `rg-cell${repeated.has(i) ? " rep" : ""}`, style: { width: cells[i] + "px" }, title: `${w}: choose it`,
        onclick: () => this.pick(v.keys[i]) },
        h("span", { class: "rg-crop" }), h("span", { class: `rg-w${this.script === "glyphs" ? " glyph" : ""}` }, ...wordNodes(Text.pages.get(v.page)[v.li].words.filter(x => x.codes.length)[i].codes, this.script)));
      cell.addEventListener("pointerenter", () => this.hover(v.keys[i], false));
      cell.addEventListener("pointerleave", () => this.hover(null));
      return cell;
    }));
    const scroller = h("div", { class: "rg-scroll" }, arcs, row);
    kids.push(scroller);
    Shapes.of(v.page).then(m => {
      const cropsAt = $$(".rg-crop", row);
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        const i = cropsAt.indexOf(e.target), { li, wi } = unkey(v.keys[i]), s = m?.get(`${li}:${wi}`);
        if (s) upright(s, { h: 34, maxW: cells[i] }).then(cv => { if (cv) e.target.replaceChildren(cv); });
      }), { root: scroller, rootMargin: "0px 400px" });
      cropsAt.forEach(c => io.observe(c));
    });
    const reps = v.arcs.length;
    kids.push(h("p", { class: "tx-dim" }, reps ? `${plural(reps, "repeat", "repeats")} round this ring.` : "No word comes round twice in this ring."));
    // elsewhere in the same order
    kids.push(h("h4", { class: "tx-h tx-h2" }, "The same words, in the same order, elsewhere"));
    if (!v.matches.length) kids.push(h("p", { class: "tx-dim" }, "No other line shares a run of its words (three in a row, or two that are not common)."));
    else {
      const list = h("ol", { class: "tx-runs" });
      v.matches.forEach((mt, k) => {
        const l = Text.pages.get(mt.page)[mt.li];
        list.append(h("li", {}, h("button", { class: "tx-prow", title: `See it beside this page`,
          onclick: () => this.openPeek(v.matches.map(x => ({ page: x.page, li: x.li, wi: x.wi, n: x.n })), k, [], "place") },
          h("span", { class: "tx-pr" }, h("span", { class: "tx-pr-t" }, h("b", {}, `${pageName_(mt.page)} · ${KINDS[mt.kind][1]} ${lineNo(l.id)}`),
            h("span", { class: "tx-dim" }, `${mt.n} words in a row`)),
            h("span", { class: "tx-pr-w" }, mt.run.join(" "))))));
      });
      kids.push(list);
    }
    body.classList.toggle("glyph", false);
    body.replaceChildren(...kids);
  },

  /* ---- a page, blanked but for the words that matter (after basil.js's "Frequency mapping") ---- */
  /* The page as a sheet of parchment: every word of it a faint hairline where it sits, and only the shared words
     printed, in the manuscript's own glyphs, at their place, size and angle. Their places say what a list cannot: in a
     label, at the start of a line, round a ring. */
  ghostCard(r, rows, n, pageSet) {
    const card = h("li", { class: "gh" });
    const btn = h("button", { class: "gh-b", title: `See ${pageName_(r.page)} beside this page, these words marked`,
      onclick: () => this.openPeek(rows.map(x => ({ page: x.page, keys: x.keys, say: pageSet ? `${x.n} shared words` : `${x.n} of ${n}` })), rows.indexOf(r), this.set.map(x => x.s), "page") });
    const sheet = h("span", { class: "gh-sheet" });
    const deg = pageSet ? h("span", { class: "gh-score", title: "how much it shares (rare words count more)" }, h("i", { style: { width: Math.round(100 * r.weight) + "%" } }))
      : h("span", { class: "tx-deg", "aria-label": `${r.n} of ${n}` }, Array.from({ length: Math.min(n, 12) }, (_, i) => h("i", { class: i < r.n ? "on" : "" })));
    const words = r.shared.slice().sort((a, b) => Find.df(a) - Find.df(b)).slice(0, 6).map(w => r.near?.has(w) ? `≈${r.near.get(w)}` : w);
    btn.append(sheet, h("span", { class: "gh-cap" }, h("b", {}, pageName_(r.page)), deg),
      h("span", { class: "gh-sub" }, factsOf(r.page).section !== "–" ? factsOf(r.page).section : "", ` · ${pageSet ? plural(r.n, "word", "words") : `${r.n} of ${n}`}`),
      h("span", { class: "gh-w" }, words.join(" · ")));
    card.append(btn);
    Shapes.of(r.page).then(m => sheet.replaceChildren(this.ghostSheet(r.page, m, new Set(r.keys)) || h("span", { class: "gh-none" }, "no positions")));
    return card;
  },
  ghostSheet(page, shapes, keep) {
    if (!shapes) return null;
    // the panel where most of the kept words are
    const tally = new Map();
    for (const k of keep) { const { li, wi } = unkey(k), s = shapes.get(`${li}:${wi}`); if (s) tally.set(s.img, (tally.get(s.img) || 0) + 1); }
    const img = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] || [...shapes.values()][0]?.img;
    const mine = [...shapes].filter(([, s]) => s.img === img);
    if (!mine.length) return null;
    const aspect = mine[0][1].aspect, W = 1000 * aspect;
    const o = svg("svg", { class: "gh-svg", viewBox: `0 0 ${W.toFixed(1)} 1000`, preserveAspectRatio: "xMidYMid meet" });
    o.append(svg("rect", { x: 0, y: 0, width: W, height: 1000, rx: 14, class: "gh-paper" }));
    const loci = Text.pages.get(page);
    for (const [k, s] of mine) {
      const g = shapeGeom(s), a = s.ang || 0, c = Math.cos(rad(a)), sn = Math.sin(rad(a));
      if (!keep.has(key(page, ...k.split(":").map(Number)))) {   // the rest of the page: a hairline along each word
        const L = g.len * .9;
        o.append(svg("line", { x1: g.cx - c * L / 2, y1: g.cy - sn * L / 2, x2: g.cx + c * L / 2, y2: g.cy + sn * L / 2, class: "gh-hair" }));
        continue;
      }
      const [li, wi] = k.split(":").map(Number), w = loci[li]?.words[wi];
      if (!w) continue;
      // larger than life, so a word stays readable on a page this small; upright text never upside down
      const up = a > 90 || a < -90 ? a + 180 : a;
      const t = svg("text", { x: g.cx, y: g.cy, class: "gh-word", "font-size": Math.max(62, g.t * 1.7), transform: `rotate(${up.toFixed(1)} ${g.cx.toFixed(1)} ${g.cy.toFixed(1)})` });
      t.textContent = w.codes.map(chOf).join("");
      o.append(t);
    }
    return o;
  },

  /* ---- the word across the book (after UCLAB's VIKUS Viewer, "Past Visions"; arcs after Chris Harrison) ---- */
  /* In the panel, a small skyline: one column per page in the book's order (the order chosen at the top), a brick for
     each place the word is there, the page you are on in gold. A click opens it over the page, large. */
  miniSky(places, words) {
    const sides = (R.pages || []).length || 1, pos = this.bookOrder(), cur = this.curSides();
    const W = 100, cols = new Map();
    for (const x of places) { const i = pos.get(x.page); if (i != null && i < 1e6) cols.set(i, (cols.get(i) || 0) + 1); }
    const max = Math.max(1, ...cols.values());
    const o = svg("svg", { class: "sky-mini", viewBox: `0 0 ${W} 30`, preserveAspectRatio: "none", "aria-hidden": "true" });
    for (const [i, n] of cols) {
      const x = (i + .5) / sides * W, hh = 4 + 22 * Math.sqrt(n / max);
      o.append(svg("rect", { x: x - .35, y: 28 - hh, width: .7, height: hh, class: "b" }));
    }
    for (const i of cur) o.append(svg("rect", { x: (i + .5) / sides * W - .45, y: 2, width: .9, height: 27, class: "cur" }));
    o.append(svg("rect", { x: 0, y: 28.6, width: W, height: .4, class: "base" }));
    return h("button", { class: "sky-open", title: "See it across the whole book", onclick: () => this.openSky(places, words) },
      h("span", { class: "sky-lab" }, h("span", {}, "Across the book"), h("span", { class: "sky-go" }, "Open ↗")), o);
  },
  /* the strip's page sides on show */
  curSides() {
    const out = [];
    (R.spreads?.[R.at] || []).forEach(p => { if (p) { const i = R.pages.indexOf(p); if (i >= 0) out.push(i); } });
    return out;
  },
  /* Over the page (Esc puts it away): the book laid out left to right, quire by quire; over each page a stack of the
     word as it is written there, a brick a place, cut from the photograph once there is room to see it (scroll to
     zoom, drag to move); under the line, arcs from the page you are on to every page the word is on. Pointing at a
     page lifts its places into a loupe; a click opens them in a peek. */
  async openSky(places, words) {
    const st = $("#rd-stage");
    this.closeSky();
    this._sh = new Map(await Promise.all([...new Set(places.map(x => x.page))].map(async p => [p, await Shapes.of(p)])));
    const pos = this.bookOrder(), sides = R.pages.length, cur = this.curSides();
    const cols = new Map();
    for (const x of places) { const i = pos.get(x.page); if (i == null || i >= 1e6) continue; if (!cols.has(i)) cols.set(i, []); cols.get(i).push(x); }
    const x0 = places[0], glyphs = x0 ? Array.from({ length: x0.n }, (_, k) => { const t = Find.toks[x0.i + k]; return Text.pages.get(t.page)[t.li].words[t.wi].codes.map(chOf).join(""); }).join(" ") : "";
    const el = h("div", { class: "sky", role: "dialog", "aria-label": "The word across the book" });
    const head = h("div", { class: "sky-head" },
      h("span", { class: "sky-glyph", "aria-hidden": "true" }, glyphs),
      h("span", { class: "sky-title" }, h("i", {}, words.join(" ")), h("span", { class: "sky-sc" }, `${plural(places.length, "place", "places")} · ${plural(new Set(places.map(x => x.page)).size, "page", "pages")} · ${R.order?.name || "the binding"}`)),
      h("span", { class: "sp" }),
      h("span", { class: "sky-hint" }, "scroll to zoom · drag to move · click a page"),
      h("button", { class: "tx-ic", title: "Close (Esc)", "aria-label": "Close", onclick: () => this.closeSky() }, "✕"));
    const scroll = h("div", { class: "sky-scroll" });
    const track = h("div", { class: "sky-track" });
    scroll.append(track);
    const loupe = h("div", { class: "sky-loupe", hidden: true });
    el.append(head, scroll, loupe);
    st.append(el);
    this.sky = { el, scroll, track, loupe, cols, places, sides, cur, z: 1, words };
    // quires along the line (as Past Visions sets its years)
    const quires = [];
    R.pages.forEach((p, i) => { const q = p.quire; if (!quires.length || quires[quires.length - 1].q !== q) quires.push({ q, a: i, b: i }); else quires[quires.length - 1].b = i; });
    this.sky.quires = quires;
    this.drawSky(true);
    // zoom about the pointer; drag to move
    scroll.addEventListener("wheel", e => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) return;   // a sideways scroll moves along
      e.preventDefault();
      const r = scroll.getBoundingClientRect(), px = e.clientX - r.left + scroll.scrollLeft, f = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * .004);
      const z0 = this.sky.z, z1 = Math.max(1, Math.min(14, z0 * f));
      if (z1 === z0) return;
      this.sky.z = z1;
      this.drawSky(false);
      scroll.scrollLeft = px * z1 / z0 - (e.clientX - r.left);
    }, { passive: false });
    let drag = null;
    scroll.addEventListener("pointerdown", e => { if (e.button === 0) drag = { x: e.clientX, l: scroll.scrollLeft, moved: false }; });
    scroll.addEventListener("pointermove", e => { if (drag) { const d = e.clientX - drag.x; if (Math.abs(d) > 3) drag.moved = true; scroll.scrollLeft = drag.l - d; } });
    const end = () => { setTimeout(() => { drag = null; }, 0); };
    scroll.addEventListener("pointerup", end); scroll.addEventListener("pointercancel", end);
    scroll.addEventListener("scroll", () => this.skyCrops(), { passive: true });
    this.sky.isDrag = () => drag?.moved;
  },
  drawSky(first) {
    const k = this.sky;
    if (!k) return;
    const W = k.scroll.clientWidth, H = k.scroll.clientHeight, pad = 28;
    const TW = Math.max(W, (W - 2 * pad) * k.z + 2 * pad), u = (TW - 2 * pad) / k.sides;
    const base = Math.round(H * .72), top = base - 18;
    const colW = Math.max(1.6, Math.min(64, u * .78));
    const crops = colW >= 15;
    // a brick's height: the word's own shape, once there is room to see it; until then a bar of light, as tall as lets
    // the busiest page's stack reach most of the way up (the skyline is the point)
    const most = Math.max(1, ...[...k.cols.values()].map(xs => xs.length));
    const plain = Math.max(2, Math.min(9, (top - 10) / most - 1));
    const brickH = x => crops ? Math.max(5, colW * this.wordAspect(x)) : plain;
    const stackH = xs => xs.reduce((a, x) => a + brickH(x) + (crops ? 2 : 1), 0);
    const tallest = Math.max(1, ...[...k.cols.values()].map(stackH));
    const fit = Math.min(1, (top - 10) / tallest);
    k.track.style.width = TW + "px";
    k.track.replaceChildren();
    const xOf = i => pad + (i + .5) * u;
    // the arcs: from the page you are on to every page the word is on, under the line (after Harrison's arcs)
    const arcs = svg("svg", { class: "sky-arcs", width: TW, height: H, viewBox: `0 0 ${TW} ${H}` });
    const from = k.cur.length ? k.cur.reduce((a, b) => a + b, 0) / k.cur.length : null;
    if (from != null) arcs.append(svg("circle", { cx: xOf(from), cy: base + 3, r: 3.5, class: "here" }));
    k.track.append(arcs);
    // the line, and the quires along it
    k.track.append(h("div", { class: "sky-base", style: { top: base + "px", left: pad + "px", width: (TW - 2 * pad) + "px" } }));
    for (const q of k.quires) {
      const x0 = pad + q.a * u, x1 = pad + (q.b + 1) * u;
      if (x1 - x0 < 10) continue;
      k.track.append(h("div", { class: "sky-q", style: { left: x0 + "px", width: (x1 - x0 - 2) + "px", top: (base + 8) + "px" } }, x1 - x0 > 22 ? qTag(q.q) : ""));
    }
    // the stacks
    for (const [i, xs] of k.cols) {
      const col = h("div", { class: `sky-col${k.cur.includes(i) ? " cur" : ""}`, "data-i": i, style: { left: (xOf(i) - colW / 2) + "px", width: colW + "px", bottom: (H - base) + "px" } });
      if (first && !REDUCED) col.style.animationDelay = Math.min(700, Math.abs(i - (from ?? i)) * 3) + "ms";
      for (const x of xs) col.append(h("span", { class: "sky-b", "data-page": x.page, "data-li": x.li, "data-wi": x.wi, style: { height: (brickH(x) * fit).toFixed(1) + "px" } }));
      col.addEventListener("pointerenter", () => this.skyLoupe(i, col));
      col.addEventListener("pointerleave", () => { k.loupe.hidden = true; k.el.classList.remove("focus"); col.classList.remove("on"); });
      col.addEventListener("click", () => { if (k.isDrag()) return; const at = k.places.indexOf(xs[0]); this.openPeek(k.places, at, k.words); });
      k.track.append(col);
    }
    k.crops = crops;
    if (first && !REDUCED) k.el.classList.add("rise");
    requestAnimationFrame(() => this.skyCrops());
  },
  /* a word's height for its length, from its shape (for the bricks) */
  wordAspect(x) {
    const s = this._sh?.get(x.page)?.get(`${x.li}:${x.wi}`);
    if (!s) return .32;
    const g = shapeGeom(s);
    return Math.max(.18, Math.min(.9, g.t / Math.max(1, g.len)));
  },
  /* the bricks on screen, cut from the photograph, a few at a time */
  skyCrops() {
    const k = this.sky;
    if (!k || !k.crops) return;
    const r = k.scroll.getBoundingClientRect();
    const todo = $$(".sky-b:not(.got)", k.track).filter(b => { const q = b.getBoundingClientRect(); return q.right > r.left - 100 && q.left < r.right + 100; });
    for (const b of todo.slice(0, 160)) {
      b.classList.add("got");
      const d = b.dataset;
      this.cropQueue(() => Shapes.of(d.page).then(m => { const s = m?.get(`${d.li}:${d.wi}`); return s ? upright(s, { h: Math.max(12, b.clientHeight * 1.6), maxW: 140, pad: .25 }) : null; })
        .then(cv => { if (cv && b.isConnected) { b.replaceChildren(cv); b.classList.add("ink"); } }));
    }
  },
  cropQueue(job) {
    const q = this._q ||= { n: 0, list: [] };
    q.list.push(job);
    const pump = () => {
      while (q.n < 6 && q.list.length) { q.n++; q.list.shift()().catch(() => {}).finally(() => { q.n--; pump(); }); }
    };
    pump();
  },
  /* a page's places, lifted into a loupe above its stack */
  skyLoupe(i, col) {
    const k = this.sky, xs = k.cols.get(i), p = R.pages[i];
    k.el.classList.add("focus"); col.classList.add("on");
    const lp = k.loupe;
    lp.hidden = false;
    lp.replaceChildren(h("div", { class: "sky-lt" }, h("b", {}, p ? sideLabel(p) : ""), h("span", {}, [factsOf(xs[0].page).section !== "–" ? factsOf(xs[0].page).section : "", plural(xs.length, "place", "places")].filter(Boolean).join(" · "))),
      h("div", { class: "sky-lc" }, xs.slice(0, 8).map(x => {
        const slot = h("span", { class: "sky-lcrop" }, h("span", { class: "sky-lph" }));
        Shapes.of(x.page).then(m => { const s = m?.get(`${x.li}:${x.wi}`); return s ? upright(s, { h: 30, maxW: 180, pad: .35 }) : null; }).then(cv => { if (cv) slot.replaceChildren(cv); });
        return h("span", { class: "sky-lrow" }, slot, h("span", { class: "sky-ll" }, `${lineNo(Text.pages.get(x.page)[x.li].id)}`));
      }), xs.length > 8 ? h("span", { class: "tx-dim" }, `and ${xs.length - 8} more`) : ""));
    const cr = col.getBoundingClientRect(), er = k.el.getBoundingClientRect(), lw = lp.offsetWidth;
    lp.style.left = Math.max(8, Math.min(er.width - lw - 8, cr.left - er.left + cr.width / 2 - lw / 2)) + "px";
    lp.style.bottom = Math.max(8, er.bottom - cr.top + 10) + "px";
  },
  closeSky() {
    if (!this.sky) return;
    this.sky.el.remove();
    this.sky = null;
  },

  /* ---- keys and the address ---- */
  key(e) {
    if (e.key === "Escape" && this.peekAt && this.sky) { this.closePeek(); return true; }
    if (e.key === "Escape" && this.sky) { this.closeSky(); return true; }
    if (e.key === "Escape" && this.peekAt) { this.closePeek(); return true; }
    if (e.key === "Escape" && (this.anchor || this.view)) { this.unpick(); return true; }
    if (this.peekAt && (e.key === "n" || e.key === "N")) { this.peekStep(e.shiftKey ? -1 : 1); return true; }
    if (this.peekAt && e.key === "Enter") { this.commit(); return true; }
    if (!this.peekAt && this.anchor && (e.key === "n" || e.key === "N")) {   // N: the first (or last) other place, in a peek
      const ks = this.chosenKeys(), places = this.placesOf(ks.map(k => this.wordText(this.item(k).w)));
      if (places.length) this.openPeek(places, e.shiftKey ? places.length - 1 : 0, []);
      return true;
    }
    if (this.anchor && (e.key === "]" || e.key === "[")) { this.stepWord(e.key === "]" ? 1 : -1); return true; }
    if (this.anchor && (e.key === "}" || e.key === "{")) { this.extend(e.key === "}" ? 1 : -1); return true; }
    return false;
  },
  /* text, then the words chosen (w=f1r.2.3, the third word of f1r.2; n=2 for two words), a set (s=), and a search
     result being stepped through */
  hash() {
    const p = new URLSearchParams();
    const ks = this.chosenKeys();
    if (ks.length) {
      const it = this.item(ks[0]);
      if (it) { p.set("w", `${it.loc.id}.${it.wi + 1}`); if (ks.length > 1) p.set("n", ks.length); }
    }
    if (this.view?.kind === "set" && this.view.from !== "page") p.set("s", this.set.map(x => x.s).join(" "));
    if (this.view?.kind === "set" && this.view.from === "page") p.set("like", this.view.page + (this.view.scope ? "." + this.view.scope : ""));
    if (this.view?.kind === "ring") p.set("ring", Text.pages.get(this.view.page)[this.view.li].id);
    if (this.ask) {
      p.set("l", this.ask.l);
      if (this.ask.m) p.set("m", this.ask.m.join("-"));
      if (this.ask.r) p.set("r", this.ask.r);
      if (this.ask.hit) p.set("hit", this.ask.hit);
    }
    const q = p.toString();
    return "text" + (q ? "?" + q.replace(/%20/g, "+") : "");
  },
  fromHash(q) {
    const p = new URLSearchParams(q);
    this.ask = p.get("l") ? { l: p.get("l"), m: p.get("m") ? p.get("m").split("-").map(Number) : null, r: p.get("r") || null, hit: +p.get("hit") || 0, seen: false } : null;
    const w = p.get("w");
    this.wantId = w ? { id: w.slice(0, w.lastIndexOf(".")), wi: +w.slice(w.lastIndexOf(".") + 1) - 1, n: Math.max(1, +p.get("n") || 1) } : null;
    this.wantSet = p.get("s") ? p.get("s").split(/[ +]/).filter(Boolean) : null;
    this.wantLike = p.get("like") || null;
    this.wantRing = p.get("ring") || null;
    if (this.back && location.hash === this.back.hash) this.back = null;   // the browser's Back went there
    if (!w && !this.wantSet && !this.wantLike && !this.wantRing && (this.anchor || this.view)) { this.anchor = this.focus = null; this.view = null; this.set = []; }
    this.onShow = "";
    if (this.el) this.sync();
  },
  /* what the address asks for, once its page's text is here */
  light() {
    const bar = $(".tx-step", this.el);
    const findLocus = id => { for (const [page, loci] of this.loaded) { const li = loci.findIndex(l => l.id === id); if (li >= 0) return { page, li }; } return null; };
    if (this.wantId) {
      const f = findLocus(this.wantId.id);
      if (f) { this.want = { page: f.page, li: f.li, wi: this.wantId.wi, n: this.wantId.n }; this.wantId = null; this.takeWanted(); }
    }
    if (this.wantSet) { const s = this.wantSet; this.wantSet = null; this.openSet(s.map(x => ({ s: x }))); }
    if (this.wantLike) { const [pg, sc] = this.wantLike.split("."); this.wantLike = null; if (Text.has(pg)) this.openPageSet(pg, KINDS[sc] ? sc : null); }
    if (this.wantRing) { const f = findLocus(this.wantRing); if (f) { this.wantRing = null; this.openRing(f.page, f.li); } }
    const a = this.ask;
    if (!a) { bar.hidden = true; return; }
    const f = findLocus(a.l);
    if (!f) { bar.hidden = true; if (a.seen) { this.ask = null; setHash(); } return; }
    if (!a.seen) {
      a.seen = true;
      // the result's place in its line: offsets into the line Search read (RF1b, as Search writes it, or another
      // reading's), found among RF1b's words; for another reading, by how far along the line it is
      const loc = this.loaded.get(f.page)[f.li];
      const spans = [];
      let off = 0;
      loc.words.forEach((w, wi) => { const s = w.codes.map(c => Text.search[c] ?? "?").join(""); spans.push([off, off + s.length, wi]); off += s.length + 1; });
      const place = len => {
        let [m0, m1] = a.m || [0, 1];
        if (len) { m0 = m0 * off / len; m1 = Math.max(m0 + .5, m1 * off / len); }
        const hit = spans.filter(([s, e]) => s < m1 && e > m0);
        if (hit.length) { this.want = { page: f.page, li: f.li, wi: hit[0][2], n: hit.length }; this.takeWanted(); }
      };
      if (a.r === "RF") place(0);
      else
        load("index.json").then(async ix => {
          const i = ix.loci.findIndex(l => l[0] === a.l);
          const line = a.r ? (await load(`w/${a.r}.json`)).lines[i] : ix.loci[i][2];
          place(line ? line.length + 1 : 0);
        }).catch(() => place(0));
    }
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

export { Text, Shapes, writeAs, Find };
export default T;
