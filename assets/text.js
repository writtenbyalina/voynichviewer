/* Text: the transcriptions of the manuscript, beside its pages in the Reader. Loaded the first time the panel opens
   (TextUI in app.js), and uses app.js's helpers (h, $, $$, store, toast, R, Reader, ...).

   The data is built offline by tools/text/ (docs/TEXT.md). For every line of the manuscript (a "locus", as IVTFF calls
   it: f1r.2 is the second line of f1r) it holds the consensus of independent transcriptions, voted glyph by glyph, and
   every reading wherever they differ. The text is Eva: names for shapes, not sounds. */

const DIR = "data/text/";
const got = new Map();   // path -> the promise of its JSON
function load(path) {
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

/* What each kind of locus is called. IVTFF's locus types: P paragraph text, L labels, C text along a circle, R text
   along a radius. */
const KINDS = { P: ["Paragraphs", "line", "lines"], L: ["Labels", "label", "labels"], C: ["Rings", "ring", "rings"],
  R: ["Radii", "radius", "radii"] };
const kindOf = loc => KINDS[loc.t[0]] ? loc.t[0] : "P";
const plural = (n, k) => `${n} ${n === 1 ? KINDS[k][1] : KINDS[k][2]}`;

/* What a mark means. Units (columns of the vote): t tie, p plurality, m majority, n none, s single, u unanimous (kept
   only because a reference reads it otherwise). Gaps: u uncertain, m most wrote a space, d doubted (one wrote an
   uncertain space), f few wrote a space. */
const SAY = {
  t: "readings differ: a tie", p: "readings differ: most read it so, but fewer than half",
  m: "readings differ: more than half read it so", n: "nobody could read it", s: "only one transcriber read it",
};
const GAP_SAY = {
  u: "uncertain space: about half wrote a space here", m: "most wrote a space here, not all",
  d: "one transcriber wrote an uncertain space here", f: "some wrote a space here, most did not",
};
/* Which marks show: quietly only where the vote is really split; or every disagreement; or none. The uncertain space is
   part of the text, so it always shows. */
const MARKS = {
  quiet: { units: "tpn", gaps: "" },
  every: { units: "tpnm", gaps: "mdf" },
  none: { units: "", gaps: "" },
};

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

/* the marks of a locus under a setting: glyph offset -> unit status; boundary offset -> gap status; and the
   zero-width units (an empty reading that won) at their offsets */
function marksOf(loc, how) {
  const set = MARKS[how] || MARKS.quiet;
  const glyph = new Map(), gap = new Map(), empty = new Map();
  for (const u of loc.u) {
    const [o, len, st] = u;
    if (!set.units.includes(st)) continue;
    if (len === 0) empty.set(o, st);
    for (let i = o; i < o + len; i++) glyph.set(i, st);
  }
  for (const [o, st] of loc.s) if (set.gaps.includes(st)) gap.set(o, st);
  return { glyph, gap, empty };
}

const T = {
  el: null, onShow: "", gen: 0,
  marks: store.get("text:marks", "quiet"),
  query: "",   // the address's options after "text?", kept for what reads them

  /* Fill the panel for the pages on show, unless they are the ones already there. */
  async sync() {
    const el = $("#rd-text");
    if (!el || el.hidden || !R.spreads) return;
    const shown = this.shown();
    const key = JSON.stringify([shown.map(x => x.page), this.marks]);
    if (el === this.el && key === this.onShow) return;
    this.el = el; this.onShow = key;
    const gen = ++this.gen;
    if (!el.firstChild) this.frame(el);
    const body = $(".tx-body", el);
    if (!Data.meta) body.replaceChildren(h("p", { class: "tx-msg" }, "Loading the text…"));
    try {
      await Data.base();
      const pages = await Promise.all(shown.filter(x => Data.has(x.page)).map(x => Data.page(x.page).then(d => ({ ...x, d }))));
      if (gen !== this.gen) return;
      this.render(body, shown, pages);
    } catch (e) {
      if (gen !== this.gen) return;
      this.onShow = "";
      body.replaceChildren(h("p", { class: "tx-msg" }, "The text could not be loaded (" + e.message + ")."));
    }
  },

  /* The pages on show, left to right: each visible panel of each page side, with that side for its facts; and the
     panels folded in, which show when the page is unfolded. */
  shown() {
    const out = [];
    const sp = R.spreads[R.at] || [];
    sp.forEach((p, i) => {
      if (!p || p.lost) return;
      const side = i === 0 ? "L" : "R";
      const open = R.unfold[side];
      const vis = Reader.pageParts(p, side, open).segs.filter(s => !s.missing);
      for (const seg of vis) out.push({ page: seg.page, seg, side: p });
      if (!open && !p.grid && p.segs.length > 1) {
        const folded = p.segs.filter(s => !s.missing && !vis.includes(s)).map(s => s.page);
        if (folded.length) out.push({ folded, side: p });
      }
    });
    return out;
  },

  /* the panel's frame: its head with the settings, and the body that scrolls */
  frame(el) {
    const marks = h("select", { class: "tx-sel", "aria-label": "Marks in the text",
      onchange: e => { this.marks = e.target.value; store.set("text:marks", this.marks); this.sync(); } },
      h("option", { value: "quiet" }, "Marks: where the vote is split"),
      h("option", { value: "every" }, "Marks: every disagreement"),
      h("option", { value: "none" }, "Marks: none"));
    marks.value = this.marks;
    el.replaceChildren(
      h("div", { class: "tx-grip", role: "separator", tabindex: "0", "aria-label": "Resize the text panel",
        "aria-orientation": "vertical" }),
      h("div", { class: "tx-head" },
        h("div", { class: "tx-ctl" }, marks,
          h("button", { class: "tx-x", title: "Close the text (T)", "aria-label": "Close the text", onclick: () => TextUI.toggle(false) }, "✕"))),
      h("div", { class: "tx-body", tabindex: "-1" }));
    this.grip($(".tx-grip", el), el);
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
      if (dim === "w") s.w = Math.round(Math.max(300, Math.min(row.width * .62, v)));
      else s.hh = Math.round(Math.max(120, Math.min(row.height - 140, v)));
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

  render(body, shown, pages) {
    const byPage = new Map(pages.map(x => [x.page, x.d]));
    const kids = [];
    for (const x of shown) {
      if (x.folded) {
        const n = x.folded.filter(p => Data.has(p));
        if (n.length) kids.push(h("p", { class: "tx-folded" }, `Folded in: ${n.map(short).join(", ")}. `,
          h("button", { class: "tx-link", onclick: () => Reader.toggleUnfold() }, "Unfold"), " to read ", n.length > 1 ? "them" : "it", " (U)."));
        continue;
      }
      const d = byPage.get(x.page);
      if (d) kids.push(this.pageEl(d, x));
    }
    if (!kids.some(k => k.classList.contains("tx-page")))
      kids.unshift(h("p", { class: "tx-msg" }, shown.length ? "No text on these pages." : "No text here: these leaves are lost."));
    kids.push(this.credits());
    body.replaceChildren(...kids);
    body.scrollTop = 0;
    const want = R.focus && $$(".tx-page", body).find(el => short(el.dataset.page) === short(R.focus));
    if (want && want !== body.querySelector(".tx-page")) want.scrollIntoView({ block: "start" });
  },

  /* one page: a header with its facts, then its loci by kind, each kind said once */
  pageEl(d, x) {
    const loci = d.loci, seg = x.seg;
    const counts = {};
    for (const l of loci) counts[kindOf(l)] = (counts[kindOf(l)] || 0) + 1;
    const who = new Map();
    for (const l of loci) for (const n of l.w) who.set(n, (who.get(n) || 0) + 1);
    const order = Data.meta.voters.map(v => v.code).filter(n => who.has(n));
    const facts = [];
    for (const n of seg.scribes || []) if (SCRIBES[n]) facts.push(SCRIBES[n]);
    if (seg.vars && LANG[seg.vars.L]) facts.push(LANG[seg.vars.L]);
    if (seg.section) facts.push(seg.section + (seg.vars && seg.vars.I === "T" ? ", text only" : ""));
    facts.push(qWord(x.side.quire));
    const groups = [];
    for (const l of loci) {
      const k = kindOf(l);
      let g = groups.find(x => x.k === k);
      if (!g) groups.push(g = { k, loci: [] });
      g.loci.push(l);
    }
    return h("section", { class: "tx-page", "data-page": d.page, "aria-label": `Text of ${short(d.page)}` },
      h("header", { class: "tx-ph" },
        h("h3", {}, short(d.page)),
        h("span", { class: "tx-count" }, Object.keys(KINDS).filter(k => counts[k]).map(k => plural(counts[k], k)).join(", ")),
        h("details", { class: "tx-who" },
          h("summary", {}, `${order.length} transcriber${order.length === 1 ? "" : "s"}`),
          h("ul", {}, order.map(n => h("li", {}, Data.names.get(n) || n, h("span", {}, ` ${who.get(n)} of ${loci.length}`)))),
          h("p", {}, "Shown for comparison, without a vote: RF1, Zandbergen's merge of his and Claston's, and voynichese.com."))),
      h("p", { class: "tx-facts" }, facts.join(" · ")),
      groups.flatMap(g => [
        groups.length > 1 || g.k !== "P" ? h("h4", { class: "tx-kind" }, KINDS[g.k][0]) : null,
        h("div", { class: `tx-lines k-${g.k}` }, g.loci.map((l, i) => this.lineEl(l, i)))]));
  },

  lineEl(loc, i) {
    const n = loc.id.slice(loc.id.lastIndexOf(".") + 1);
    return h("div", { class: `ln${loc.ps && i ? " ps" : ""}`, "data-id": loc.id },
      h("button", { class: "no", title: `${loc.id}: click to copy`, "aria-label": `Line ${loc.id}, copy its name`,
        onclick: () => copy(loc.id) }, n),
      h("span", { class: "t" }, this.textOf(loc)));
  },

  /* A locus's consensus as words: runs of glyphs with the same mark in one span; an uncertain space as its IVTFF comma
     (drawn as a dot, copied as a comma); gap marks between glyphs or words. */
  textOf(loc) {
    const mk = marksOf(loc, this.marks);
    const ws = words(loc), out = [];
    ws.forEach((w, wi) => {
      if (wi) {
        const st = mk.gap.get(w.off - 1), est = mk.empty.get(w.off - 1);
        if (est) out.push(h("span", { class: "dj", title: SAY[est] }));
        out.push(st ? h("span", { class: "gm", title: GAP_SAY[st] }, " ") : " ");
      }
      const el = h("span", { class: "w", "data-o": w.off });
      const why = new Set();
      let run = null, runSt = null;
      const flush = () => { if (run) el.append(runSt ? h("span", { class: `c c-${runSt}` }, run) : run); run = null; };
      for (const t of w.toks) {
        const gst = t !== w.toks[0] && !t.sep && mk.gap.get(t.off), est = mk.empty.get(t.off);
        if (gst || est) {
          flush();
          el.append(h("span", { class: "dj", title: est ? SAY[est] : GAP_SAY[gst] }));
          why.add(est ? SAY[est] : GAP_SAY[gst]);
        }
        if (t.sep) {
          flush();
          el.append(h("span", { class: "us", title: GAP_SAY.u }, ","));
          why.add(GAP_SAY.u);
          continue;
        }
        const st = mk.glyph.get(t.off) || null;
        if (st !== runSt) flush();
        runSt = st;
        run = (run || "") + t.eva;
        if (st) why.add(SAY[st]);
      }
      flush();
      if (why.size) {
        el.classList.add("mk");
        el.tabIndex = 0;
        el.setAttribute("aria-label", `${w.eva}: ${[...why].join("; ")}`);
      }
      out.push(el);
    });
    const end = mk.empty.get(loc.c.length);
    if (end) out.push(h("span", { class: "dj", title: SAY[end] }));
    return out;
  },

  credits() {
    const m = Data.meta;
    return h("footer", { class: "tx-foot" },
      h("p", {}, "The text is the consensus of independent transcriptions, lined up and voted glyph by glyph; wherever they differ, every reading is kept. ",
        h("a", { href: "#info/beinecke/text" }, "How it is made"), "."),
      h("p", {}, m.credit.replace(/,? from René Zandbergen's voynich\.nu.*$/, ""), ", from René Zandbergen's ",
        h("a", { href: "https://www.voynich.nu/transcr.html", target: "_blank", rel: "noopener" }, "voynich.nu"),
        " (CC0) and the Landini–Stolfi interlinear."));
  },

  key() { return false; },
  hash() { return "text" + (this.query ? "?" + this.query : ""); },
  fromHash(q) { this.query = q; },
};

/* copy a locus name */
async function copy(s) {
  try { await navigator.clipboard.writeText(s); toast(`Copied ${s}`); }
  catch { toast(`Copy did not work: the line is ${s}`); }
}

if (TextUI.wanted) T.fromHash(String(TextUI.wanted).split("?")[1] || "");

export default T;
