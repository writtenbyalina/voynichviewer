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
const STATUS = { m: "a majority", p: "the most votes, not a majority", t: "a tie, broken by the order of transcribers",
  n: "nobody could read it", s: "only one read it", u: "everyone who voted" };

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

const T = {
  el: null, onShow: "", gen: 0,
  reading: "cons",   // whose reading the lines show: the consensus, or a transcriber's code
  loaded: new Map(),   // page -> its data, for the pages on show
  marks: store.get("text:marks", "quiet"),
  query: "",   // the address's options after "text?", kept for what reads them

  /* Fill the panel for the pages on show, unless they are the ones already there. */
  async sync() {
    const el = $("#rd-text");
    if (!el || el.hidden || !R.spreads) return;
    const shown = this.shown();
    const key = JSON.stringify([shown.map(x => x.page), this.marks, this.reading]);
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
      this.loaded = new Map(pages.map(x => [x.page, x.d]));
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
    const reading = h("select", { class: "tx-sel tx-reading", "aria-label": "Whose reading",
      onchange: e => { this.reading = e.target.value; this.closeCard(); this.sync(); setHash(); } });
    el.replaceChildren(
      h("div", { class: "tx-grip", role: "separator", tabindex: "0", "aria-label": "Resize the text panel",
        "aria-orientation": "vertical" }),
      h("div", { class: "tx-head" },
        h("div", { class: "tx-ctl" }, reading, marks,
          h("button", { class: "tx-x", title: "Close the text (T)", "aria-label": "Close the text", onclick: () => TextUI.toggle(false) }, "✕"))),
      h("div", { class: "tx-body", tabindex: "-1" }));
    this.grip($(".tx-grip", el), el);
    const body = $(".tx-body", el);
    body.addEventListener("click", e => {
      const w = e.target.closest(".w");
      if (w) this.openCard(w, true);
    });
    body.addEventListener("keydown", e => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches(".w")) { e.preventDefault(); this.openCard(e.target, true); }
    });
    if (matchMedia("(hover: hover)").matches) {
      body.addEventListener("pointerover", e => {
        const w = e.target.closest(".w.mk");
        clearTimeout(this.hoverT);
        if (w && (!this.card || this.card.word !== w)) this.hoverT = setTimeout(() => { if (!this.card || !this.card.pinned) this.openCard(w, false); }, 300);
      });
      body.addEventListener("pointerout", e => {
        clearTimeout(this.hoverT);
        if (this.card && !this.card.pinned && !e.relatedTarget?.closest?.(".tx-card")) this.leaveT = setTimeout(() => this.card && !this.card.pinned && this.closeCard(), 250);
      });
    }
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
    this.closeCard();
    const byPage = new Map(pages.map(x => [x.page, x.d]));
    const here = new Set();
    for (const x of pages) for (const l of x.d.loci) { l.w.forEach(n => here.add(n)); for (const n in l.r || {}) if (isRef(n)) here.add(n); }
    const sel = $(".tx-reading", this.el);
    if (this.reading !== "cons" && !here.has(this.reading)) here.add(this.reading);
    sel.replaceChildren(h("option", { value: "cons" }, "The consensus"),
      h("optgroup", { label: "One transcriber" }, Data.meta.voters.filter(v => here.has(v.code)).map(v => h("option", { value: v.code }, SHORT[v.code]))),
      h("optgroup", { label: "For comparison" }, Data.meta.references.filter(v => here.has(v.code)).map(v => h("option", { value: v.code }, SHORT[v.code]))));
    sel.value = this.reading;
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
      h("span", { class: "t" }, this.reading === "cons" ? this.textOf(loc) : this.readingText(loc, this.reading)));
  },

  /* a transcriber's own reading of a locus, word by word of the consensus, marked where it differs */
  readingText(loc, who) {
    const rd = readingOf(loc, who);
    if (!rd) return [h("span", { class: "tx-none" }, `${SHORT[who]} did not transcribe this line`)];
    if (loc.x && who in loc.x)   // a line that lines up with the others only roughly: as it is, unmarked
      return [h("span", { class: "tx-rough", title: ROUGH }, "≈ "), loc.x[who].replace(/\./g, " ").replace(/,/g, "·")];
    const ws = words(loc), out = [];
    ws.forEach((w, i) => {
      if (i) out.push(rd[i - 1].next === "." ? " " : "");
      const t = rd[i].text, dif = differs(rd, ws, i);
      const el = h("span", { class: `w${dif ? " mk" : ""}`, "data-o": w.off, "data-e": w.eva },
        dif ? h("span", { class: "c" }, t.replace(/\./g, " ").replace(/,/g, "·") || "–") : t);
      if (i < ws.length - 1 && rd[i].next !== ".") el.append(h("span", { class: rd[i].next === "," ? "us" : "jn", title: rd[i].next === "," ? "uncertain space" : `${SHORT[who]} writes this and the next as one word` }, rd[i].next === "," ? "," : ""));
      if (dif) { el.tabIndex = 0; el.setAttribute("aria-label", `${t || "nothing"}: the consensus reads ${w.eva}`); }
      out.push(el);
    });
    return out;
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
      const el = h("span", { class: "w", "data-o": w.off, "data-e": w.eva });
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

  /* ---- the card: one word as each transcriber reads it ---- */
  card: null, hoverT: null, leaveT: null,
  openCard(wordEl, pinned) {
    clearTimeout(this.leaveT);
    if (this.card && this.card.word === wordEl) { if (pinned && !this.card.pinned) this.pin(); return; }
    this.closeCard(false);
    const line = wordEl.closest(".ln"), id = line.dataset.id;
    const loc = this.locus(id);
    if (!loc) return;
    const ws = words(loc), wi = ws.findIndex(w => w.off === +wordEl.dataset.o), w = ws[wi];
    const { unitAt, emptyAt } = lookup(loc);
    // the transcribers' readings of this word, alike ones together, then the references
    const groups = new Map(), refs = [], rough = [];
    for (const n of [...loc.w, ...["RF", "VT"].filter(n => present(loc, n))]) {
      if (loc.x && n in loc.x) { rough.push(n); continue; }
      const t = shownReading(readingOf(loc, n), wi);
      if (isRef(n)) refs.push([t, n]);
      else groups.set(t, [...(groups.get(t) || []), n]);
    }
    // each glyph's support, and the votes where they are split
    const glyphs = w.toks.filter(t => !t.sep);
    const bar = [], said = [];
    const units = [];
    for (let i = w.off; i <= w.end; i++) {
      for (const u of emptyAt.get(i) || []) units.push(u);
      const u = unitAt.get(i);
      if (u) units.push(u);
    }
    for (const t of glyphs) {
      const u = units.find(u => u[1] && t.off >= u[0] && t.off < u[0] + u[1]);
      const tot = u ? u[3].reduce((a, r) => a + r[1], 0) : 1, top = u ? Math.max(0, ...u[3].map(r => r[1])) : 1;
      bar.push({ t, share: tot ? top / tot : 0 });
    }
    for (const u of units) {
      const k = glyphs.findIndex(t => t.off >= u[0]);
      const span = u[1] ? glyphs.filter(t => t.off >= u[0] && t.off < u[0] + u[1]).length : 0;
      const where = !u[1] ? "Between glyphs" : span > 1 ? `Glyphs ${k + 1}–${k + span}` : `The ${nth(k)} glyph`;
      const voted = u[3].filter(r => r[1] > 0), not = u[3].filter(r => r[1] === 0);
      if (u[2] === "u" && !not.length) continue;
      said.push(h("li", {}, `${where}: `, voted.flatMap((r, i) => [i ? " · " : "", i === 0 && u[2] !== "n" ? h("b", {}, r[0] || "nothing") : r[0] || "nothing", ` ${votes(r[1])}`]),
        voted.length ? ` (${STATUS[u[2]]})` : STATUS.n,
        not.length ? h("span", { class: "muted" }, `; not voting: ${not.map(r => `${SHORT[r[2]]} ${r[0] || "nothing"}`).join(", ")}`) : ""));
    }
    const verdict = this.reading === "cons" ? "consensus" : `${SHORT[this.reading]}'s reading`;
    const occ = h("span", { class: "muted tx-occ" }, "counting…");
    const card = h("div", { class: "tx-card", role: "dialog", "aria-label": `${w.eva}, in ${id}`, tabindex: "-1" },
      h("button", { class: "tx-cx", "aria-label": "Close", title: "Close (Esc)", onclick: () => this.closeCard() }, "✕"),
      h("div", { class: "tx-ch" }, h("span", { class: "tx-big" }, w.eva.replace(/,/g, "·")), h("span", { class: "muted" }, `${id}, word ${wi + 1} · ${verdict}`)),
      h("div", { class: "tx-agree", role: "img", "aria-label": bar.map(b => `${b.t.eva} ${Math.round(b.share * 100)}%`).join(", ") },
        bar.map(b => h("span", { class: b.share < 1 ? "lo" : "", style: { width: `${b.t.len}ch` }, title: `${b.t.eva}: ${Math.round(b.share * 100)}% of the votes` }))),
      h("table", {}, h("tbody", {},
        [...groups].sort((a, b) => b[1].length - a[1].length).map(([t, who]) => {
          const d = doubt(t);
          return h("tr", {}, h("td", { class: "r" }, t), h("td", {}, who.map(n => SHORT[n]).join(", "), d ? h("span", { class: "muted" }, ` (${d})`) : ""),
            h("td", { class: "n", title: "transcribers" }, String(who.length)));
        }),
        refs.map(([t, n]) => h("tr", { class: "ref" }, h("td", { class: "r" }, t), h("td", {}, Data.names.get(n)), h("td", { class: "n" }))))),
      rough.length ? h("p", { class: "tx-roughs" }, `${rough.map(n => SHORT[n]).join(", ")}: ${rough.length > 1 ? "their lines line" : "the line lines"} up with the others only roughly here. `,
        rough.map(n => h("span", { class: "mono" }, loc.x[n].replace(/\./g, " ").replace(/,/g, "·"))).flatMap((e, i) => i ? ["; ", e] : [e])) : "",
      said.length ? h("ul", { class: "tx-votes" }, said) : h("p", { class: "tx-votes" }, "Everyone who transcribed it reads it so."),
      h("p", { class: "tx-occ-l" }, occ),
      h("div", { class: "tx-acts" },
        h("a", { class: "tx-btn", href: `#text/${encodeURIComponent(S.order)}/search?q=${encodeURIComponent(w.eva.replace(/,/g, "~"))}` }, "Search the book"),
        h("button", { class: "tx-btn", onclick: () => copy(id) }, `Copy ${id}`)));
    card.addEventListener("keydown", e => this.cardKey(e));
    card.addEventListener("pointerleave", () => { if (!this.card?.pinned) this.leaveT = setTimeout(() => this.card && !this.card.pinned && this.closeCard(), 250); });
    card.addEventListener("pointerenter", () => clearTimeout(this.leaveT));
    $("#v-read").append(card);
    this.card = { el: card, word: wordEl, pinned: false };
    this.place(card, wordEl);
    wordEl.classList.add("sel");
    const same = $$(".tx-body .w", this.el).filter(x => x !== wordEl && x.dataset.e === w.eva);
    same.forEach(x => x.classList.add("hl"));
    Count.load().then(() => {
      const e = Count.map.get(w.eva);
      occ.textContent = !e ? "Not elsewhere in the book" : e.n === 1 ? "Only here in the book" :
        `${e.n} times in the book, on ${e.pages.size} page${e.pages.size === 1 ? "" : "s"}` + (same.length ? `; ${same.length + 1} here, lit` : "");
    }).catch(() => { occ.textContent = ""; });
    if (pinned) this.pin();
  },
  pin() {
    this.card.pinned = true;
    this.card.el.classList.add("pinned");
    this.card.el.focus();
  },
  place(card, wordEl) {
    if (matchMedia("(max-width: 760px)").matches) { card.classList.add("sheet"); return; }
    const host = $("#v-read").getBoundingClientRect(), r = wordEl.getBoundingClientRect();
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let x = Math.min(host.width - cw - 8, Math.max(8, r.left - host.left - cw / 2 + r.width / 2));
    let y = r.bottom - host.top + 8;
    if (y + ch > host.height - 8) y = Math.max(8, r.top - host.top - ch - 8);
    card.style.left = x + "px"; card.style.top = y + "px";
  },
  closeCard(refocus = true) {
    clearTimeout(this.hoverT); clearTimeout(this.leaveT);
    if (!this.card) return;
    const { el, word, pinned } = this.card;
    this.card = null;
    el.remove();
    word.classList.remove("sel");
    $$(".tx-body .w.hl", this.el || document).forEach(x => x.classList.remove("hl"));
    if (refocus && pinned && word.isConnected) word.focus({ preventScroll: true });
  },
  cardKey(e) {
    if (e.key === "Escape") { e.stopPropagation(); this.closeCard(); return; }
    if (e.key === "Tab") {   // focus stays in the card
      const f = $$("a, button", this.card.el);
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
    if (e.key === "n" || e.key === "N") { e.stopPropagation(); this.step(e.shiftKey ? -1 : 1); }
  },
  locus(id) {
    const pg = id.slice(0, id.lastIndexOf("."));
    const d = this.loaded.get(pg);
    return d && d.loci.find(l => l.id === id);
  },

  /* N / Shift+N: the next or previous marked word, with its card */
  step(d) {
    const all = $$(".tx-body .w.mk", this.el);
    if (!all.length) { toast(this.marks === "none" && this.reading === "cons" ? "Marks are off: choose them in the text panel" : "Nothing marked on these pages"); return; }
    const at = this.card ? all.indexOf(this.card.word) : -1;
    const next = all[at < 0 ? (d > 0 ? 0 : all.length - 1) : (at + d + all.length) % all.length];
    next.scrollIntoView({ block: "nearest" });
    this.openCard(next, true);
  },

  key(e) {
    if ((e.key === "n" || e.key === "N") && !e.altKey) { this.step(e.shiftKey ? -1 : 1); return true; }
    if (e.key === "Escape" && this.card) { this.closeCard(); return true; }
    return false;
  },
  /* the address: text, then the reading if it is not the consensus */
  hash() { return "text" + (this.reading !== "cons" ? "?r=" + this.reading : ""); },
  fromHash(q) {
    const p = new URLSearchParams(q);
    const r = p.get("r");
    this.reading = r && (SHORT[r]) ? r : "cons";
    if (this.el) this.sync();
  },
};

/* copy a locus name */
async function copy(s) {
  try { await navigator.clipboard.writeText(s); toast(`Copied ${s}`); }
  catch { toast(`Copy did not work: the line is ${s}`); }
}

if (TextUI.wanted) T.fromHash(String(TextUI.wanted).split("?")[1] || "");

export default T;
