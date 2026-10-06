/* The Text tab: search the text of the whole book (docs/TEXT.md 6.4). Loaded on first use (TextTab in app.js); uses
   app.js's helpers and text.js's data. The query language is query.js; the search itself runs in search-worker.js.

   The address holds the whole search: #text/beinecke/search?q=qok*&in=cons&sp=either&eq=eva&near=0&steps=scribe:2
   (defaults left out), so a search can be linked, saved and come back as it was. */
import { parse, describe, QueryError, CLASSES, QUALIFIERS } from "./query.js";
import { Data, SHORT, load } from "./text.js";

const DEFAULTS = { q: "", in: "cons", sp: "either", eq: "eva", near: "0", set: "", steps: "", sort: "book", cmp: "" };
const FACETS = [
  { key: "scribe", title: "Scribe (Davis)", label: v => v === "–" ? "none given" : `Scribe ${v}` },
  { key: "section", title: "Section", label: v => v },
  { key: "lang", title: "Language (Currier)", label: v => v === "–" ? "none given" : `Currier ${v}` },
  { key: "kind", title: "Kind of text", label: v => ({ P: "Paragraphs", L: "Labels", C: "Rings", R: "Radii" })[v] || v },
  { key: "quire", title: "Quire", label: v => qWord(isNaN(+v) ? v : +v) },
];
const SAY_SP = { either: "uncertain spaces either way", space: "uncertain spaces as spaces", none: "spaces ignored" };
const SAY_IN = code => code === "cons" ? "the consensus" : code === "all" ? "any transcriber" : SHORT[code];
const PAGE_SIZE = 150;

/* ---- what is known of every page and line, for the filters, the facets and the book strip ---- */
const Book = {
  ix: null, facts: null,
  async load() {
    if (this.ix) return;
    const [ix] = await Promise.all([load("index.json"), Data.base()]);
    this.ix = ix.loci;
    // each page's facts, from the codex (as the Reader shows them) and the current binding's quires
    const quireOf = new Map();
    for (const g of ORDERS.get("beinecke").gatherings) for (const id of g.bifolia) quireOf.set(id, g.quire);
    this.facts = new Map();
    for (const s of D.sheets) for (const f of ["inside", "outside"]) for (const row of s[f]) for (const seg of row) {
      if (seg.missing) continue;
      this.facts.set(seg.page, { seg, scribes: (seg.scribes || []).map(String), section: seg.section || "–",
        lang: (seg.vars && LANG[seg.vars.L]) ? seg.vars.L : "–", quire: String(quireOf.get(s.id) ?? "–") });
    }
    this.pageOf = this.ix.map(r => r[0].slice(0, r[0].lastIndexOf(".")));
    // the book's pages in today's binding, for page: ranges
    this.bound = [];
    for (const p of linearize(ORDERS.get("beinecke"), { ghosts: false })) for (const s of p.segs) if (!s.missing && !this.bound.includes(s.page)) this.bound.push(s.page);
  },
  /* the facets of a hit on line i */
  of(i) {
    const f = this.facts.get(this.pageOf[i]) || { scribes: [], section: "–", lang: "–", quire: "–" };
    return { scribe: f.scribes.length ? f.scribes : ["–"], section: [f.section], lang: [f.lang], quire: [f.quire], kind: [this.ix[i][1][0]] };
  },
  /* the order's page sides, and which side each page (every panel of a foldout) is on */
  sides(order) {
    const sides = linearize(order, { ghosts: false });
    const at = new Map();
    sides.forEach((p, k) => { for (const s of [p.shown, ...p.segs]) if (s && !s.missing && !at.has(s.page)) at.set(s.page, k); });
    return { sides, at };
  },
};

/* ---- the worker, stopped if a search takes too long ---- */
const Worker_ = {
  w: null, n: 0, wait: new Map(),
  start() {
    this.w = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
    this.w.onmessage = ({ data }) => { const r = this.wait.get(data.id); if (r) { this.wait.delete(data.id); r(data); } };
    this.w.onerror = e => { for (const r of this.wait.values()) r({ error: e.message || "The search stopped" }); this.wait.clear(); };
  },
  run(msg, ms = 6000) {
    if (!this.w) this.start();
    const id = ++this.n;
    return new Promise(done => {
      const t = setTimeout(() => {   // a pattern that runs away: stop the worker and start a fresh one
        if (!this.wait.has(id)) return;
        this.wait.delete(id);
        this.w.terminate(); this.w = null;
        for (const r of this.wait.values()) r({ error: "stopped" });
        this.wait.clear();
        done({ error: "This search took too long. A simpler pattern, or fewer stars, will be quicker.", mine: true });
      }, ms);
      this.wait.set(id, d => { clearTimeout(t); done(d); });
      this.w.postMessage({ ...msg, id });
    });
  },
};

/* ---- the state, in the address ---- */
const T = {
  st: { ...DEFAULTS }, built: false, res: null, shownN: PAGE_SIZE, gen: 0, cmpRes: null,
  readState(s) {
    const p = new URLSearchParams(String(s || "").replace(/^search\??/, ""));
    this.st = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (p.has(k)) this.st[k] = p.get(k);
  },
  state() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(this.st)) if (v !== DEFAULTS[k]) p.set(k, v);
    const q = p.toString();
    return "search" + (q ? "?" + q : "");
  },
  steps() { return this.st.steps ? this.st.steps.split(";").filter(Boolean).map(s => { const i = s.indexOf(":"); return [s.slice(0, i), s.slice(i + 1)]; }) : []; },
  setSteps(list) { this.st.steps = list.map(([k, v]) => `${k}:${v}`).join(";"); },

  /* ---- the view ---- */
  mount() {
    const v = $("#v-text");
    if (!this.built) this.build(v);
    const fromHash = location.hash.replace(/^#\/?text\/[^/]*\/?/, "");
    const before = this.state();
    if (fromHash.startsWith("search")) this.readState(fromHash);
    $("#sx-q").value = this.st.q;
    this.syncControls();
    if (this.state() !== before || !this.res) this.run();
    else this.draw();
  },
  build(v) {
    const sel = (key, label, opts) => h("label", { class: "sx-opt" }, h("span", {}, label),
      h("select", { "data-k": key, onchange: e => { this.st[key] = e.target.value; this.go(); } }, opts.map(([val, t]) => h("option", { value: val }, t))));
    v.replaceChildren(
      h("div", { class: "sx-top" },
        h("form", { class: "sx-row", role: "search", onsubmit: e => { e.preventDefault(); this.st.q = $("#sx-q").value.trim(); this.st.steps = ""; this.go(); } },
          h("label", { class: "sx-lbl", for: "sx-q" }, "Search the text"),
          h("input", { id: "sx-q", type: "search", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
            placeholder: "qokeedy, qok*, chol daiin, dy_qo …", "aria-describedby": "sx-echo",
            onkeydown: e => { if (e.key === "Escape") { e.target.value = ""; } if (e.key === "ArrowDown") { e.preventDefault(); $(".sx-hit")?.focus(); } } }),
          h("button", { type: "button", class: "sx-glyphs-b", "aria-expanded": "false", "aria-controls": "sx-pal", onclick: e => this.palette(e.currentTarget) }, "Glyphs"),
          h("button", { class: "primary", type: "submit" }, "Search")),
        h("div", { class: "sx-pal", id: "sx-pal", hidden: true }),
        h("p", { class: "sx-echo", id: "sx-echo", "aria-live": "polite" }),
        h("div", { class: "sx-opts" },
          sel("in", "Reading", [["cons", "the consensus"], ["all", "any transcriber"]]),
          sel("sp", "Spaces", [["either", "uncertain either way"], ["space", "uncertain as spaces"], ["none", "ignored"]]),
          sel("eq", "Match", [["eva", "exact Eva"], ["family", "same STA family (a o y, r s, k t…)"]]),
          sel("near", "Near", [["0", "off"], ["1", "within 1 edit"], ["2", "within 2 edits"]]),
          sel("set", "Pages", [["", "the whole book"]]),
          h("button", { type: "button", class: "sx-cmp-b", onclick: () => this.compareOpen() }, "+ Compare with another search")),
        h("form", { class: "sx-cmp", hidden: true, onsubmit: e => { e.preventDefault(); this.st.cmp = $("#sx-cmp-q").value.trim(); this.go(); } },
          h("label", { for: "sx-cmp-q" }, "Compare with"),
          h("input", { id: "sx-cmp-q", type: "search", autocomplete: "off", spellcheck: "false", placeholder: "another query" }),
          h("button", { type: "submit" }, "Compare"),
          h("button", { type: "button", onclick: () => { this.st.cmp = ""; this.go(); } }, "Remove")),
        h("div", { class: "sx-steps", id: "sx-steps" })),
      h("div", { class: "sx-strip", id: "sx-strip" }),
      h("div", { class: "sx-body" },
        h("aside", { class: "sx-facets", id: "sx-facets", "aria-label": "Narrow the results" }),
        h("div", { class: "sx-res", id: "sx-res" })));
    $("#sx-res").addEventListener("keydown", e => {
      const hits = $$(".sx-hit", v), i = hits.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === "ArrowDown" && hits[i + 1]) { e.preventDefault(); hits[i + 1].focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); (hits[i - 1] || $("#sx-q")).focus(); }
    });
    this.built = true;
  },
  syncControls() {
    this.fillSets();
    for (const s of $$(".sx-opts select", $("#v-text"))) s.value = this.st[s.dataset.k];
    const cmp = $(".sx-cmp");
    cmp.hidden = !this.st.cmp && !this.cmpOpen;
    $("#sx-cmp-q").value = this.st.cmp;
  },
  /* the Pages menu: the whole book, your page sets (Your work), and a new one */
  fillSets() {
    const sel = $(".sx-opts select[data-k=set]");
    if (!sel) return;
    const want = this.st.set;
    sel.replaceChildren(h("option", { value: "" }, "the whole book"),
      ...Saved.sets.map(x => h("option", { value: x.name }, `set:${x.name} (${x.pages.length})`)),
      want && !Saved.setNamed(want) ? h("option", { value: want }, `set:${want} (not in this browser)`) : "",
      h("option", { value: "+new" }, "New page set…"));
    sel.value = want;
    sel.onchange = async e => {
      if (e.target.value !== "+new") { this.st.set = e.target.value; this.go(); return; }
      e.target.value = this.st.set;
      const x = await this.newSet();
      if (x) { this.st.set = x.name; this.go(); }
    };
  },
  async newSet() {
    const name = await askText("Name the page set", { placeholder: "e.g. herbal-a", ok: "Next",
      body: "Searches can keep to it: choose it under Pages, or write set:name in a query. It is kept in this browser and in your progress file." });
    if (!name) return null;
    const list = await askText(`Pages in “${name}”`, { placeholder: "f1r f1v f75r-f84v", ok: "Save",
      body: "Pages and ranges in today's binding, separated by spaces or commas." });
    if (list == null) return null;
    await Book.load();
    const pages = [];
    for (const t of list.split(/[\s,]+/).filter(Boolean)) {
      const [a, b] = t.toLowerCase().split("-").map(p => "f" + p.replace(/^f/, ""));
      const i0 = Book.bound.indexOf(a), i1 = b ? Book.bound.indexOf(b) : i0;
      if (i0 < 0 || i1 < 0) { toast(`${t} is not a page`); continue; }
      pages.push(...Book.bound.slice(Math.min(i0, i1), Math.max(i0, i1) + 1));
    }
    const x = Saved.putSet(name, pages);
    if (!x) { toast("A page set needs a name and at least one page"); return null; }
    toast(`Saved the page set set:${x.name}, ${x.pages.length} page${x.pages.length === 1 ? "" : "s"}`);
    return x;
  },
  savedChanged() { if (this.built) { this.fillSets(); if (!this.st.q) this.empty(); } },
  compareOpen() { this.cmpOpen = true; $(".sx-cmp").hidden = false; $("#sx-cmp-q").focus(); },
  focus() { $("#sx-q")?.focus(); $("#sx-q")?.select(); },
  go() {
    this.shownN = PAGE_SIZE;
    setHash();
    this.syncControls();
    this.run();
  },

  /* ---- searching ---- */
  async run() {
    const gen = ++this.gen;
    const st = this.st, echo = $("#sx-echo");
    this.res = null;
    if (!st.q) { this.empty(); return; }
    let p;
    try { p = parse(st.q); if (!p.items.length && !p.regex) throw new QueryError("Give something to search for, as well as the filters"); }
    catch (e) { this.fail(e.message); return; }
    echo.replaceChildren("Searching…");
    try { await Book.load(); } catch (e) { this.fail("The text could not be loaded (" + e.message + ")."); return; }
    if (gen !== this.gen) return;
    // the voters, for "any transcriber" and for the reading menu
    const rd = $(".sx-opts select[data-k=in]");
    if (rd.options.length < 3) {
      rd.append(h("optgroup", { label: "One transcriber" }, Data.meta.voters.map(v => h("option", { value: v.code }, SHORT[v.code]))),
        h("optgroup", { label: "For comparison" }, Data.meta.references.map(v => h("option", { value: v.code }, SHORT[v.code]))));
      rd.value = st.in;
    }
    const who = st.in === "all" ? Data.meta.voters.map(v => v.code) : [st.in];
    const opts = { sp: st.sp, eq: st.eq, near: +st.near };
    const t0 = performance.now();
    const r = await Worker_.run({ q: st.q, opts, who });
    this.ms = performance.now() - t0;   // how long the search took, for the benchmark (tests/text.spec.js)
    if (gen !== this.gen) return;
    if (r.error) { this.fail(r.mine ? r.error : "The search failed (" + r.error + ")."); return; }
    const lines = {};
    for (const w of who) lines[w] = w === "cons" ? Book.ix.map(x => x[2]) : (await load(`w/${w}.json`)).lines;
    if (gen !== this.gen) return;
    this.res = { p, hits: this.collect(r.hits, lines, st.in === "all"), lines, near: r.near, ranges: null };
    this.draw();
    // the same search on the three fullest transcriptions, for the range of every count
    if (st.in === "cons") {
      const rr = await Worker_.run({ q: st.q, opts, who: ["ZL", "GC", "IT"] });
      if (gen !== this.gen || rr.error) return;
      const per = {};
      for (const w of ["ZL", "GC", "IT"]) per[w] = this.collect({ [w]: rr.hits[w] }, null, false);
      this.res.ranges = per;
      this.draw();
    }
    if (st.cmp) {
      const rc = await Worker_.run({ q: st.cmp, opts, who: st.in === "all" ? who : [st.in] });
      if (gen !== this.gen) return;
      this.res.cmp = rc.error ? { error: rc.error } : { hits: this.collect(rc.hits, this.res.lines, st.in === "all") };
      this.drawStrip();
      this.drawEcho();
    }
  },
  /* hits as { i (line), s, len, who: [codes] }; for any transcriber, one per line and reading found */
  collect(byWho, lines, merge) {
    const out = [], key = new Map();
    for (const [w, a] of Object.entries(byWho)) {
      for (let k = 0; k < a.length; k += 3) {
        const i = a[k], s = a[k + 1], len = a[k + 2];
        if (!merge) { out.push({ i, s, len, who: [w] }); continue; }
        const text = lines[w][i].slice(s, s + len).replace(/,/g, "");
        const id = i + "|" + text;
        const h_ = key.get(id);
        if (h_) { if (!h_.who.includes(w)) h_.who.push(w); continue; }
        const hit = { i, s, len, who: [w] };
        key.set(id, hit); out.push(hit);
      }
    }
    return out;
  },
  /* the hits that pass the query's filters, then the steps */
  filtered(hits, steps = this.steps()) {
    const f = this.st.set ? [...this.res.p.filters, ["set", this.st.set]] : this.res.p.filters, lines = this.res.lines;
    return hits.filter(x => passes(x, f, lines) && steps.every(([k, v]) => Book.of(x.i)[k].includes(v)));
  },

  /* ---- drawing ---- */
  empty() {
    $("#sx-echo").replaceChildren("Search the whole book's text: the consensus of its transcriptions, or any one of them.");
    $("#sx-steps").replaceChildren();
    $("#sx-strip").replaceChildren();
    $("#sx-facets").replaceChildren();
    const ex = [["qokeedy", "a word"], ["qok*", "words beginning qok"], ["*dy", "ending dy"], ["chol daiin", "two words in a row"],
      ["dy_qo", "across a word break"], ["chol~daiin", "however it is split"], ["<gallows>edy", "a class of glyphs"], ["A A", "a word twice in a row"],
      ["qok* scribe:2", "with a filter"], ["^qo*", "first in a line"]];
    $("#sx-res").replaceChildren(h("div", { class: "sx-help" },
      h("h3", {}, "Try"),
      h("ul", { class: "sx-ex" }, ex.map(([q, t]) => h("li", {}, h("button", { type: "button", class: "sx-chip", onclick: () => { $("#sx-q").value = q; this.st.q = q; this.st.steps = ""; this.go(); } }, q), " ", t))),
      h("p", {}, "Eva letters name the glyphs' shapes, not sounds. ", h("b", {}, "*"), " is any run of glyphs in a word, ", h("b", {}, "?"), " any one glyph, ",
        h("b", {}, "[kt]"), " either glyph. Join parts with ", h("b", {}, "-"), " (no break), ", h("b", {}, "_"), " (a word break) or ", h("b", {}, "~"), " (either). ",
        h("b", {}, "/…/"), " is a regular expression. Filters: ", Object.keys(QUALIFIERS).filter((k, i, a) => a.indexOf(k) === i && k !== "hand" && k !== "language" && k !== "pages").map(k => k + ":").join(" "), "."),
      Saved.searches.length ? [h("h3", {}, "Your searches"), h("ul", { class: "sx-ex" }, Saved.searches.map(x => h("li", {}, h("a", { class: "sx-chip sx-saved", href: x.hash }, x.name))))] : "",
      h("p", { class: "muted" }, "The text is the consensus of up to twelve transcriptions, voted glyph by glyph (", h("a", { href: "#info/beinecke/text" }, "how"), ").")));
  },
  fail(msg) {
    $("#sx-echo").replaceChildren(h("span", { class: "sx-err" }, msg));
    $("#sx-res").replaceChildren();
    $("#sx-facets").replaceChildren();
    $("#sx-strip").replaceChildren();
    $("#sx-steps").replaceChildren();
  },
  draw() {
    if (!this.res) return;
    this.drawEcho();
    this.drawSteps();
    this.drawStrip();
    this.drawFacets();
    this.drawResults();
  },
  drawEcho() {
    const { p } = this.res, st = this.st;
    const all = this.filtered(this.res.hits, []), now = this.filtered(this.res.hits);
    const lines = new Set(now.map(x => x.i)), pages = new Set(now.map(x => Book.pageOf[x.i]));
    const bits = describe(p).map(([k, t]) => k === "b" ? h("b", {}, t) : t);
    const fs = (this.st.set ? [...p.filters, ["set", this.st.set]] : p.filters).map(([k, v]) => sayFilter(k, v));
    const rng = this.res.ranges && rangeOf(Object.values(this.res.ranges).map(hs => this.filtered(hs).length));
    $("#sx-echo").replaceChildren(
      h("span", {}, ...bits, fs.length ? ", " + fs.join(", ") : "", ` — in ${SAY_IN(st.in)}, ${SAY_SP[st.sp]}${st.eq === "family" ? ", STA families alike" : ""}`,
        this.res.near ? `, with ${this.res.near.length} word${this.res.near.length === 1 ? "" : "s"} within ${st.near} edit${st.near === "1" ? "" : "s"}` : "", ": "),
      h("b", {}, now.length.toLocaleString("en")), now.length === 1 ? " time" : " times",
      now.length ? ` in ${lines.size.toLocaleString("en")} line${lines.size === 1 ? "" : "s"} on ${pages.size} page${pages.size === 1 ? "" : "s"}` : "",
      rng ? h("span", { class: "sx-rng", title: "The same search in Zandbergen & Landini's, Claston's and Takahashi's transcriptions" }, ` (${rng} in ZL, GC and IT)`) : "",
      now.length !== all.length ? h("span", { class: "muted" }, ` of ${all.length.toLocaleString("en")} before narrowing`) : "",
      this.res.cmp ? h("span", { class: "sx-cmpsay" }, this.res.cmp.error ? ` · compare: ${this.res.cmp.error}` : ` · compared with “${st.cmp}”: ${this.filtered(this.res.cmp.hits).length.toLocaleString("en")} times`) : "");
  },
  drawSteps() {
    const steps = this.steps();
    const el = $("#sx-steps");
    if (!steps.length && this.st.sort === "book") { el.replaceChildren(); return; }
    const chip = (t, rm) => h("span", { class: "sx-step" }, t, h("button", { type: "button", "aria-label": `Remove ${t}`, title: "Remove", onclick: rm }, "✕"));
    el.replaceChildren(h("span", { class: "sx-q0" }, this.st.q),
      ...steps.map(([k, v], n) => [" › ", chip(FACETS.find(f => f.key === k)?.label(v) || `${k} ${v}`, () => { const s = this.steps(); s.splice(n, 1); this.setSteps(s); this.go(); })]).flat(),
      ...(this.st.sort !== "book" ? [" › ", chip(SORTS[this.st.sort], () => { this.st.sort = "book"; this.go(); })] : []));
  },
  /* one bar per page side in the order chosen: its height the hits there; gold what the steps leave, grey the rest */
  drawStrip() {
    const el = $("#sx-strip");
    const order = ORDERS.get(S.order);
    const { sides, at } = Book.sides(order);
    const count = hs => { const n = new Array(sides.length).fill(0); for (const x of hs) { const k = at.get(Book.pageOf[x.i]); if (k != null) n[k]++; } return n; };
    const all = count(this.filtered(this.res.hits, [])), now = count(this.filtered(this.res.hits));
    const cmp = this.res.cmp && this.res.cmp.hits ? count(this.filtered(this.res.cmp.hits)) : null;
    const max = Math.max(1, ...all, ...(cmp || []));
    const H = 40;
    const top = all.map((n, k) => [n, k]).filter(x => x[0]).sort((a, b) => b[0] - a[0]).slice(0, 3);
    el.replaceChildren(
      h("div", { class: "sx-strip-h" }, h("span", {}, `The book in ${order.title}`),
        h("span", { class: "muted" }, all.some(Boolean) ? `hits on ${all.filter(Boolean).length} of ${sides.length} pages; most on ${top.map(([n, k]) => `${short(sideLabel(sides[k]))} (${n})`).join(", ")}` : "no hits")),
      h("div", { class: "sx-bars", role: "img", "aria-label": `Hits page by page in ${order.title}` },
        sides.map((p, k) => h("button", { type: "button", class: `sx-bar${now[k] ? " on" : ""}`, tabindex: "-1",
          title: `${short(sideLabel(p))}: ${now[k]}${all[k] !== now[k] ? ` of ${all[k]}` : ""}${cmp ? ` · compared: ${cmp[k]}` : ""}`,
          onclick: () => this.jump(p) },
          h("i", { class: "all", style: { height: Math.round(H * all[k] / max) + "px" } }),
          h("i", { class: "now", style: { height: Math.round(H * now[k] / max) + "px" } }),
          cmp ? h("i", { class: "cmp", style: { height: Math.round(H * cmp[k] / max) + "px" } }) : ""))));
  },
  jump(side) {
    const pages = [side.shown, ...side.segs].filter(Boolean).map(s => s.page);
    const g = $$(".sx-pg", $("#sx-res")).find(x => pages.includes(x.dataset.page));
    if (g) { g.scrollIntoView({ block: "start", behavior: REDUCED ? "auto" : "smooth" }); g.classList.remove("flash"); void g.offsetWidth; g.classList.add("flash"); }
    else toast(`No results on ${short(sideLabel(side))}${this.steps().length ? " as narrowed" : ""}`);
  },
  drawFacets() {
    const el = $("#sx-facets");
    const steps = this.steps(), now = this.filtered(this.res.hits);
    const ranges = this.res.ranges ? Object.values(this.res.ranges).map(hs => this.filtered(hs)) : null;
    const tally = hs => { const m = {}; for (const f of FACETS) m[f.key] = new Map(); for (const x of hs) { const o = Book.of(x.i); for (const f of FACETS) for (const v of o[f.key]) m[f.key].set(v, (m[f.key].get(v) || 0) + 1); } return m; };
    const t = tally(now), tr = ranges ? ranges.map(tally) : null;
    el.replaceChildren(
      h("div", { class: "sx-fhead" }, h("b", {}, "Narrow"), h("button", { type: "button", class: "sx-fclose", onclick: () => el.classList.remove("open") }, "Done")),
      ...FACETS.map(f => {
        const rows = [...t[f.key]].sort((a, b) => f.key === "quire" ? (parseInt(a[0]) || 99) - (parseInt(b[0]) || 99) : b[1] - a[1]);
        if (!rows.length) return "";
        const step = steps.find(([k]) => k === f.key);
        return h("section", { class: "sx-facet" }, h("h4", {}, f.title),
          rows.map(([v, n]) => {
            const rg = tr && rangeOf(tr.map(m => m[f.key].get(v) || 0));
            return h("button", { type: "button", class: `sx-frow${step && step[1] === v ? " sel" : ""}`, "aria-pressed": String(!!(step && step[1] === v)),
              onclick: () => { const s = this.steps().filter(([k]) => k !== f.key); if (!(step && step[1] === v)) s.push([f.key, v]); this.setSteps(s); this.go(); } },
              h("span", {}, f.label(v)), h("span", { class: "n" }, n.toLocaleString("en"), rg ? h("small", { title: "in ZL, GC and IT" }, " · " + rg) : ""));
          }));
      }));
  },
  drawResults() {
    const el = $("#sx-res");
    const hits = this.filtered(this.res.hits);
    const { at } = Book.sides(ORDERS.get(S.order));
    const order = x => [at.get(Book.pageOf[x.i]) ?? 1e6, x.i, x.s];
    const lineOf = x => this.res.lines[x.who[0]][x.i];
    const after = x => lineOf(x).slice(x.s + x.len).replace(/^[.,]/, ""), before = x => [...lineOf(x).slice(0, x.s).replace(/[.,]$/, "")].reverse().join("");
    const cmpStr = (a, b) => (!a) - (!b) || (a < b ? -1 : a > b ? 1 : 0);   // nothing after (or before): last
    const sorted = hits.slice().sort((a, b) => {
      if (this.st.sort === "right") return cmpStr(after(a), after(b));
      if (this.st.sort === "left") return cmpStr(before(a), before(b));
      if (this.st.sort === "match") return cmpStr(lineOf(a).slice(a.s, a.s + a.len), lineOf(b).slice(b.s, b.s + b.len));
      const A = order(a), B = order(b);
      return A[0] - B[0] || A[1] - B[1] || A[2] - B[2];
    });
    this.list = sorted;
    const shown = sorted.slice(0, this.shownN);
    const head = h("div", { class: "sx-res-h" },
      h("span", { class: "sx-cnt" }, hits.length ? `${hits.length.toLocaleString("en")} result${hits.length === 1 ? "" : "s"}` : "No results"),
      h("label", { class: "sx-opt" }, h("span", {}, "Order"), h("select", { onchange: e => { this.st.sort = e.target.value; this.go(); } },
        Object.entries(SORTS).map(([v, t]) => h("option", { value: v, selected: this.st.sort === v }, t)))),
      h("span", { class: "sx-acts" },
        h("button", { type: "button", onclick: () => this.save(), title: "Keep this search in Your work" }, this.savedAs() ? "★ Saved" : "Save"),
        h("details", { class: "sx-exp" }, h("summary", {}, "Export"),
          h("div", { class: "sx-exp-m" },
            h("button", { type: "button", disabled: !hits.length, onclick: () => this.exportCSV() }, "Results as CSV"),
            h("button", { type: "button", disabled: !hits.length, onclick: () => this.exportIVTFF() }, "Their lines as IVTFF"),
            h("button", { type: "button", disabled: !hits.length, onclick: () => this.copyLoci() }, "Copy the list of lines")))));
    const kids = [head];
    if (!hits.length) kids.push(h("p", { class: "sx-none" }, this.res.hits.length ? "Nothing is left after narrowing: remove a step above." : "Nothing matches. Try * for any glyphs, or set Near to find words a glyph or two away."));
    const row = (x, k) => {
      const id = Book.ix[x.i][0], line = lineOf(x), shownL = s => s.replace(/\./g, " ").replace(/,/g, "·");
      const L = line.slice(0, x.s), M = line.slice(x.s, x.s + x.len), R_ = line.slice(x.s + x.len);
      const pg = Book.pageOf[x.i];
      const n = Data.meta.voters.length;
      return h("a", { class: "sx-hit", href: this.href(x, k),
        "data-k": k },
        h("span", { class: "sx-id" }, id.slice(id.lastIndexOf(".") + 1)),
        h("span", { class: "sx-l" }, h("span", {}, shownL(L.length > 60 ? "…" + L.slice(-60) : L))),
        h("span", { class: "sx-m" }, shownL(M)),
        h("span", { class: "sx-r" }, shownL(R_.length > 60 ? R_.slice(0, 60) + "…" : R_)),
        this.st.in === "all" ? h("span", { class: "sx-who", title: x.who.map(w => SHORT[w]).join(", ") }, `in ${x.who.length} of ${presentOn(x.i, this.res.lines)}`) : "");
    };
    if (this.st.sort === "book") {
      let cur = null, box = null;
      shown.forEach((x, k) => {
        const pg = Book.pageOf[x.i];
        if (pg !== cur) {
          cur = pg;
          const f = Book.facts.get(pg), n = hits.filter(y => Book.pageOf[y.i] === pg).length;
          const seg = f && f.seg;
          kids.push(box = h("section", { class: "sx-pg", "data-page": pg },
            h("header", {}, seg ? h("img", { src: imgUrl(seg.img, "s", seg.v), alt: "", loading: "lazy", width: 36, height: Math.round(36 / aspect(seg)) }) : "",
              h("div", {}, h("b", {}, short(pg)), h("span", { class: "muted" }, ` ${n} result${n === 1 ? "" : "s"}`),
                h("div", { class: "muted small" }, factsOf(pg))))));
        }
        box.append(row(x, k));
      });
    } else kids.push(h("div", { class: "sx-flat" }, shown.map((x, k) => [h("span", { class: "sx-fpg" }, short(Book.pageOf[x.i])), row(x, k)]).flat()));
    if (sorted.length > shown.length) kids.push(h("button", { type: "button", class: "sx-more", onclick: () => { this.shownN += PAGE_SIZE * 2; this.drawResults(); } },
      `Show more (${(sorted.length - shown.length).toLocaleString("en")} left)`));
    el.replaceChildren(...kids);
    $("#sx-ftog")?.remove();
    head.prepend(h("button", { id: "sx-ftog", type: "button", class: "sx-ftog", onclick: () => $("#sx-facets").classList.add("open") }, "Narrow"));
  },

  /* ---- keeping and exporting ---- */
  savedAs() { return Saved.searches.find(x => x.hash === location.hash); },
  async save() {
    const had = this.savedAs();
    if (had) { toast(`Already in Your work as “${had.name}”`, { label: "Rename", fn: () => Work.open() }); return; }
    const name = await askText("Name this search", { value: this.st.q, ok: "Save", body: "It is kept in Your work, with its settings and steps." });
    if (!name) return;
    Saved.addSearch(name, location.hash);
    toast(`Saved “${name}” in Your work`);
    this.drawResults();
  },
  rows() {
    return this.list.map(x => {
      const id = Book.ix[x.i][0], line = this.res.lines[x.who[0]][x.i], pg = Book.pageOf[x.i], o = Book.of(x.i);
      return { id, pg, o, x, L: line.slice(0, x.s), M: line.slice(x.s, x.s + x.len), R: line.slice(x.s + x.len) };
    });
  },
  fileName(ext) {
    const slug = this.st.q.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "search";
    return `voynich-text-${slug}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  },
  download(text, ext, type) {
    const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: this.fileName(ext) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $(".sx-exp")?.removeAttribute("open");
  },
  exportCSV() {
    const q = v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const head = ["line", "page", "section", "scribe", "language", "quire", "kind", "before", "match", "after", "reading", "transcribers"];
    const out = [head.join(",")];
    for (const r of this.rows()) out.push([r.id, r.pg, r.o.section[0], r.o.scribe.join(" "), r.o.lang[0], r.o.quire[0], r.o.kind[0], r.L, r.M, r.R,
      this.st.in === "all" ? "any transcriber" : this.st.in === "cons" ? "consensus" : this.st.in, r.x.who[0] === "cons" ? "" : r.x.who.join(" ")].map(q).join(","));
    this.download(out.join("\n") + "\n", "csv", "text/csv");
    toast(`Saved ${this.list.length.toLocaleString("en")} results as CSV (Eva in IVTFF's notation: . a space, , an uncertain one)`);
  },
  /* the lines with results, as IVTFF, from the page files (their locators and page variables) */
  async exportIVTFF() {
    const ids = [...new Set(this.list.map(x => x.i))].sort((a, b) => a - b);
    const pages = [...new Set(ids.map(i => Book.pageOf[i]))];
    const data = new Map(await Promise.all(pages.map(async p => [p, await load(`pages/${encodeURIComponent(p)}.json`)])));
    const own = this.st.in !== "cons" && this.st.in !== "all";
    const out = ["#=IVTFF Eva- 2.0 M 5", `# Lines of the Voynich Manuscript found by the search “${this.st.q}” in Voynich Viewer, ${new Date().toISOString().slice(0, 10)}.`,
      own ? `# Text: ${Data.names.get(this.st.in)}'s reading, in basic Eva.` : `# Text: the consensus of independent transcriptions (method ${Data.meta.method}, docs/TEXT.md in the viewer's code).`,
      `# ${Data.meta.credit}`, "#"];
    let cur = null;
    for (const i of ids) {
      const pg = Book.pageOf[i], d = data.get(pg), id = Book.ix[i][0], loc = d.loci.find(l => l.id === id);
      if (pg !== cur) {
        cur = pg;
        out.push(`<${pg}>      <! ${Object.entries(d.vars).map(([k, v]) => `$${k}=${v}`).join(" ")}>`);
      }
      const text = own ? this.res.lines[this.st.in][i] : loc.c;
      out.push(`<${id},${loc.loc}${loc.t}>`.padEnd(19) + (loc.ps ? "<%>" : "") + text + (loc.pe ? "<$>" : ""));
    }
    this.download(out.join("\n") + "\n", "txt", "text/plain");
    toast(`Saved ${ids.length.toLocaleString("en")} lines as IVTFF`);
  },
  async copyLoci() {
    const ids = [...new Set(this.list.map(x => Book.ix[x.i][0]))];
    try { await navigator.clipboard.writeText(ids.join("\n")); toast(`Copied ${ids.length.toLocaleString("en")} lines`); }
    catch { this.download(ids.join("\n") + "\n", "txt", "text/plain"); toast("Copying did not work: saved the list as a file"); }
    $(".sx-exp")?.removeAttribute("open");
  },

  /* where a result opens in the Reader: its page, the text panel at its line, and which result it is */
  href(x, k) {
    const id = Book.ix[x.i][0], pg = Book.pageOf[x.i];
    return `#read/${encodeURIComponent(S.order)}/${short(pg)}/text?l=${id}&m=${x.s}-${x.s + x.len}${x.who[0] !== "cons" ? "&r=" + x.who[0] : ""}&hit=${k + 1}`;
  },
  /* the results as last listed, for stepping through them in the Reader */
  hit(k) { return this.list && this.list[k - 1] ? { href: this.href(this.list[k - 1], k - 1), n: this.list.length } : null; },
  back() { return `#text/${encodeURIComponent(S.order)}/${this.state()}`; },

  /* ---- the glyph palette: each glyph with its Eva; a click puts it in the box ---- */
  palette(btn) {
    const el = $("#sx-pal");
    const open = el.hidden;
    el.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (!open || el.firstChild) return;
    Data.base().then(() => {
      const G = Data.glyphs, put = s => { const q = $("#sx-q"); const a = q.selectionStart ?? q.value.length, b = q.selectionEnd ?? a; q.value = q.value.slice(0, a) + s + q.value.slice(b); q.focus(); q.setSelectionRange(a + s.length, a + s.length); };
      const glyphs = [["A1", "o"], ["A3", "a"], ["A2", "y"], ["D1", "q"], ["B1", "d"], ["B2", "l"], ["B3", "m"], ["B4", "g"], ["C1", "r"], ["C2", "s"],
        ["E1", "i"], ["E2", "n"], ["J1", "e"], ["K1", "ch"], ["L1", "sh"], ["Q1", "k"], ["Q2", "t"], ["P1", "p"], ["P2", "f"],
        ["U1", "ckh"], ["U2", "cth"], ["T1", "cph"], ["T2", "cfh"], ["X1", "x"], ["X2", "v"], ["Z1", "?"]];
      el.replaceChildren(
        h("div", { class: "sx-pal-g" }, glyphs.map(([c, e]) => h("button", { type: "button", title: `Eva ${e}`, "aria-label": `Eva ${e}`, onclick: () => put(e) },
          h("span", { class: "g", "aria-hidden": "true" }, (G[c] && G[c].ch) || e), h("span", { class: "e" }, e)))),
        h("div", { class: "sx-pal-c" }, Object.entries(CLASSES).map(([k, c]) => h("button", { type: "button", title: c.say, onclick: () => put(`<${k}>`) }, `<${k}>`)),
          ["*", "?", "-", "_", "~"].map(s => h("button", { type: "button", onclick: () => put(s) }, s))));
    });
  },
};

const SORTS = { book: "in book order", right: "by what follows", left: "by what comes before", match: "by the match" };

function rangeOf(ns) {
  const lo = Math.min(...ns), hi = Math.max(...ns);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}
function presentOn(i, lines) { return Object.values(lines).filter(L => L[i]).length; }
function factsOf(pg) {
  const f = Book.facts.get(pg);
  if (!f) return "";
  const bits = f.scribes.map(s => SCRIBES[s]).filter(Boolean);
  if (LANG[f.lang]) bits.push(LANG[f.lang]);
  if (f.section !== "–") bits.push(f.section);
  if (f.quire !== "–") bits.push(qWord(+f.quire || f.quire));
  return bits.join(" · ");
}
const KIND_IN = { label: "L", labels: "L", para: "P", paragraph: "P", paragraphs: "P", text: "P", ring: "C", rings: "C", circle: "C", radius: "R", radii: "R" };
/* whether a hit passes the query's own filters */
function passes(x, filters, lines) {
  if (!filters.length) return true;
  const o = Book.of(x.i), r = Book.ix[x.i];
  return filters.every(([k, v]) => {
    if (k === "scribe") return o.scribe.includes(v);
    if (k === "lang") return o.lang[0].toLowerCase() === v;
    if (k === "section") return o.section[0].toLowerCase().includes(v);
    if (k === "quire") { const [a, b] = v.split("-").map(Number); return +o.quire[0] >= a && +o.quire[0] <= (b || a); }
    if (k === "in") return o.kind[0] === (KIND_IN[v] || v.toUpperCase()[0]);
    if (k === "at") {
      const line = lines && lines[x.who[0]] ? lines[x.who[0]][x.i] : r[2];
      if (v.startsWith("para")) return !!r[3] && x.s === 0;
      if (v.includes("end")) return x.s + x.len === line.length;
      return x.s === 0;
    }
    if (k === "set") { const ps = Saved.setNamed(v); return !!ps && ps.pages.includes(Book.pageOf[x.i]); }
    if (k === "page") {
      const [a, b] = v.split("-").map(p => "f" + p.replace(/^f/, ""));
      const pg = Book.pageOf[x.i];
      if (!b) return pg === a || pg.startsWith(a) && /^\d$/.test(pg.slice(a.length));
      const i0 = Book.bound.indexOf(a), i1 = Book.bound.indexOf(b), ip = Book.bound.indexOf(pg);
      return i0 >= 0 && i1 >= 0 && ip >= Math.min(i0, i1) && ip <= Math.max(i0, i1);
    }
    return true;
  });
}
function sayFilter(k, v) {
  if (k === "scribe") return `in Scribe ${v}'s hand`;
  if (k === "lang") return `in Currier ${v.toUpperCase()}`;
  if (k === "section") return `in sections matching “${v}”`;
  if (k === "quire") return `in quire ${v}`;
  if (k === "in") return `in ${({ L: "labels", P: "paragraphs", C: "rings", R: "radii" })[KIND_IN[v] || v.toUpperCase()[0]] || v}`;
  if (k === "at") return v.startsWith("para") ? "at the start of a paragraph" : v.includes("end") ? "at the end of a line" : "at the start of a line";
  if (k === "page") return `on ${v.includes("-") ? "pages " + v : v}`;
  if (k === "set") return Saved.setNamed(v) ? `on the pages of set:${v}` : `on set:${v}, which this browser does not have`;
  return `${k}: ${v}`;
}

export default T;
