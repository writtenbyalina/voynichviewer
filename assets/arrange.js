/* Voynich Viewer: rearrange the book, from the 3D view.
   A dock under the 3D book, with a tab for each quire in the order of the book (drag a tab to move the quire). The open
   quire is drawn as a pile of open sheets seen from above, the way it lies opened at its centre: the centre sheet on
   top, the outermost at the bottom. Pointing at a sheet shows which it is and its four pages; clicking picks it up (the
   3D book turns to it), and its buttons move it toward the centre or outward, into another quire or out of the book,
   or turn it inside out or upside down. A sheet can also be dragged up or down the pile, or onto a tab.
   On a wide screen the table (view3d.js) does all this instead, and ArrangeList (at the end) adds the classic list.
   Built-in orders are never changed: the first change makes your own copy (work.js MyOrders), which every view then
   shows. Each change animates in 3D and can be undone.
   Loaded after app.js and work.js; uses their globals. */
"use strict";

const svgEl = markup => { const t = document.createElement("template"); t.innerHTML = markup.trim(); return t.content.firstChild; };

/* A pictogram for each section (data/codex.json section names), in the outline style of the site's other icons. */
const SECTION_ICON = {
  Botanical: '<path d="M5 19c0-8.5 5.5-14 14-14 0 8.5-5.5 14-14 14z"/><path d="M5 19l9-9"/>',
  Astronomy: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  Zodiac: '<path d="M12 21V10"/><path d="M12 10c0-3-1.8-5.5-4.5-5.5S3.5 6.6 3.5 9s1.6 3.5 3 3.5"/><path d="M12 10c0-3 1.8-5.5 4.5-5.5s4 2.1 4 4.5-1.6 3.5-3 3.5"/>',
  Balneology: '<path d="M12 3.5s6 6.4 6 10.8a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/>',
  Rose: '<circle cx="12" cy="12" r="2.3"/><path d="M12 9.7c-2.6-1.2-2.6-5.2 0-6.2 2.6 1 2.6 5 0 6.2zM14 10.8c.2-2.9 3.7-4.8 5.8-3.1-.4 2.7-3.9 4.7-5.8 3.1zM14 13.2c2.4 1.6 2.3 5.6-.2 6.6M10 13.2c-2.4 1.6-2.3 5.6.2 6.6M10 10.8c-.2-2.9-3.7-4.8-5.8-3.1.4 2.7 3.9 4.7 5.8 3.1zM13.8 19.8c-1.1.5-2.5.5-3.6 0"/>',
  Pharmaceutical: '<path d="M9 3.5h6M10 3.5v6l-5.2 8.6A1.9 1.9 0 0 0 6.4 21h11.2a1.9 1.9 0 0 0 1.6-2.9L14 9.5v-6"/><path d="M7.4 15h9.2"/>',
  "Starred paragraphs": '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  lost: '<path d="M7 3.5h7l4.5 4.5v8.5M18.5 20.5H7a1.5 1.5 0 0 1-1.5-1.5V5.5"/><path d="M3.5 3.5l17 17"/>',
  aside: '<path d="M3.5 4.5h17v4h-17z"/><path d="M5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-10"/><path d="M10 12.5h4"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
const SECTION_NAME = { Rose: "Rosettes" };
const icon = (key, size = 18, cls = "ar-ic") => svgEl(`<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SECTION_ICON[key] || SECTION_ICON.lost}</svg>`);

const pairName = id => id.replace("|", " + ");
const sectionOf = id => {
  const sh = SHEETS.get(id);
  for (const s of [...sh.inside.flat(), ...sh.outside.flat()]) if (!s.missing && s.section) return s.section.split("/")[0].trim();
  return null;
};
const lostSheet = id => SHEETS.get(id).missing.every(Boolean);
const foldout = id => { const sh = SHEETS.get(id); return sh.inside[0].length > 2 || sh.inside.length > 1; };
const mostOf = list => { const n = new Map(); let best = null;
  for (const x of list) { n.set(x, (n.get(x) || 0) + 1); if (best === null || n.get(x) > n.get(best)) best = x; } return best; };
/* the leaf number of a side, from the page it shows (f84v -> 84): turned upside down, a sheet's leaves change places */
const leafNo = side => (short(side.shown.page).match(/^\d+/) || [""])[0];
/* indices of a longest increasing run in xs: the things that kept their order; the rest are what moved */
function keptOrder(xs) {
  const len = xs.map(() => 1), prev = xs.map(() => -1);
  let best = -1;
  xs.forEach((x, i) => {
    for (let j = 0; j < i; j++) if (xs[j] < x && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    if (best < 0 || len[i] > len[best]) best = i;
  });
  const keep = new Set();
  for (let i = best; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}
/* Move elements with a short slide from where they were (FLIP): `fn` changes the DOM. */
function slide(root, sel, fn) {
  const was = new Map($$(sel, root).map(e => [e.dataset.key, e.getBoundingClientRect()]));
  fn();
  if (REDUCED) return;
  for (const e of $$(sel, root)) {
    const b = was.get(e.dataset.key); if (!b) continue;
    const a = e.getBoundingClientRect(), dx = b.left - a.left, dy = b.top - a.top;
    if (!dx && !dy) continue;
    e.style.transition = "none"; e.style.transform = `translate(${dx}px, ${dy}px)`;
    e.getBoundingClientRect();
    e.style.transition = "transform .24s ease"; e.style.transform = "";
  }
}

/* A sheet as one piece with two faces: its inside, as it lies open (the two pages that face each other at its fold),
   and its outside, turned over. Each face's panels sit side by side, joined at the fold, rows top to bottom; the face
   is sized to fit maxW. */
function sheetFaces(id, opts = {}, ph = 60, maxW = 260, maxH = 140, { side = false } = {}) {
  const v = handled(SHEETS.get(id), opts);
  const ar = s => s.missing || !s.img ? .68 : aspect(s);
  const colsOf = rows => rows[0].map((_, c) => Math.max(...rows.map(r => ar(r[c]))));
  const span = rows => colsOf(rows).reduce((a, c) => a + c, 0);
  // the two sides next to each other when they fit at a good size, else one above the other
  const across = side && Math.min(ph, (maxW - 10) / (span(v.inside) + span(v.outside)), maxH / v.inside.length) >= 64;
  const fw = across ? (maxW - 10) * span(v.inside) / (span(v.inside) + span(v.outside)) : maxW;
  const face = (rows, spine, label, w) => {
    // every row's panels in the same columns (as the sheet is cut), so a sheet with two rows (the Rosettes) is one grid
    const cols = colsOf(rows);
    const hh = Math.floor(Math.min(ph, w / cols.reduce((a, c) => a + c, 0), maxH / rows.length));
    const pic = (s, c) => {
      const st = { height: hh + "px", width: Math.round(hh * cols[c]) + "px" };
      const cls = c === spine ? "fold" : null;
      return s.missing || !s.img ? h("span", { class: "sf-hole" + (cls ? " fold" : ""), style: st })
        : h("img", { class: cls, src: imgUrl(s.img, "s", s.v), alt: "", style: { ...st, ...(s.rot ? { transform: `rotate(${s.rot}deg)` } : {}) } });
    };
    // its pages, each named once ("Ros 85v top" and "Ros 85v bottom" are one page)
    const names = [...new Set(rows.flat().map(s => short(pageName(s)).replace(/ (top|bottom|middle)$/, "")))];
    return h("figure", { class: "sf", title: `${label}: ${names.join(", ")}` },
      h("div", { class: "sf-face" }, rows.map(r => h("div", { class: "sf-row" }, r.map(pic)))),
      h("figcaption", { style: { maxWidth: Math.max(w, 60) + "px" } }, h("b", {}, label), " ", names.join(" ")));
  };
  return [face(v.inside, v.spine, "inside", across ? fw : maxW), face(v.outside, v.n - v.spine, "outside", across ? maxW - 10 - fw : maxW)];
}

const Arrange = {
  on: false,
  sel: null,          // the sheet picked: the one the 3D book is on
  at: null,           // the open booklet: String(quire), or "aside"
  dragging: false,
  hist: new Map(),    // order id -> { undo: [snapshot], redo: [snapshot] }
  selected: new Set(), selQ: new Set(),   // on the table: the selected sheets, or the selected quires (by name)
  clip: null,         // sheets cut with ⌘X, waiting for ⌘V

  // ---------------------------------------------------------------- opening
  async open() {
    if (S.view !== "three") show("three");
    const m = await View3D.load();
    this.on = true;
    this.sel = this.hov = null;
    // on a wide screen the book itself comes apart on the table (view3d.js setArrange); on a phone, a drawer
    this.table = !matchMedia("(max-width: 760px)").matches;
    m.setPanel(true);
    // the table's own bar first, so the book comes apart in a view that keeps its size
    if (this.table) { $("#v-three").classList.add("table"); this.render(); m.setArrange(true); this.setSel([]); return; }   // nothing selected yet
    const id = m.curSheet();
    if (id) this.mark(id); else this.render();
  },
  close() {
    this.on = false; this.closeMenu(); this.selected = new Set(); this.selQ = new Set(); this.clip = null;
    if (this.table) View3D.mod?.setArrange(false);
    View3D.mod?.setPanel(false); this.render();
  },
  toggle() { this.on ? this.close() : this.open(); },

  order() { return ORDERS.get(S.order); },
  aside: o => o.unplaced || unplacedOf(o),   // built-in orders list lost sheets per gathering, or not at all
  el() { return $("#v3-arrange"); },

  // ---------------------------------------------------------------- editing
  snap: o => JSON.stringify({ gatherings: o.gatherings, unplaced: o.unplaced }),   // what undo brings back (not the order's name)

  /* Apply fn to a copy of the current order. A built-in order is first copied into an order of your own. `moved` names
     the sheets the change is about: only they lift in 3D, the others slide aside (null: let 3D decide). `renamed`:
     [old, new] quire names, so a quire hidden in 3D stays hidden under its new name. */
  edit(fn, { ms = 1000, moved = null, copy = false, renamed = null } = {}) {
    let o = this.order(), started = null, from = o.id;
    if (!MyOrders.isMine(o.id)) { started = o.title; o = MyOrders.copyOf(o); }
    const before = this.snap(o);
    const next = JSON.parse(JSON.stringify(o));
    if (fn(next) === false) return false;
    // a change that changes nothing (a sheet let go where it was) is no change, and doesn't start a copy either
    const changed = this.snap(next) !== before;
    if (!changed && !copy) return false;
    if (changed) {
      const hst = this.histOf(next.id);
      hst.undo.push({ s: before, moved }); hst.redo = [];
      if (hst.undo.length > 100) hst.undo.shift();
    }
    // the quires hidden in 3D: a copy keeps the ones hidden in the order it came from, a renamed one keeps its state
    View3D.mod?.keepHidden(next, { from: started ? from : null, renamed });
    MyOrders.put(next, { ms, moved });
    // a first move makes a new order: say so, and let it be taken back at once (until the next move: then Undo is
    // one step back, ⌘Z, and taking back the copy would throw that move away too)
    if (started) {
      const msg = `You're now changing your own copy, “${next.title}”. “${started}” stays as it was.`;
      toast(msg, { label: "Undo", fn: () => this.unstart(next.id, from) });
      this.firstMsg = { id: next.id, msg };
    } else if (this.firstMsg?.id === next.id) {
      const t = $("#cx-toast");
      if (t?.classList.contains("show") && t.firstChild?.textContent === this.firstMsg.msg) toast(this.firstMsg.msg);
      this.firstMsg = null;
    }
    this.render();
    return true;
  },
  /* Take back the copy a first move made: it goes, and the order it came from is shown again. (Only while that move is
     all there is in the copy; after more, it is an ordinary undo.) */
  unstart(id, from) {
    if (S.order !== id) return;
    if ((this.hist.get(id)?.undo.length || 0) > 1) return this.undo();
    MyOrders.remove(id);
    if (ORDERS.has(from) && S.order !== from) setOrder(from);
    toast(`Back to “${ORDERS.get(S.order).title}”, unchanged`);
    this.render();
  },
  histOf(id) { if (!this.hist.has(id)) this.hist.set(id, { undo: [], redo: [] }); return this.hist.get(id); },
  undo() { this.travel("undo", "redo"); },
  redo() { this.travel("redo", "undo"); },
  travel(from, to) {
    const o = this.order();
    if (!MyOrders.isMine(o.id)) return;
    const hst = this.histOf(o.id);
    if (!hst[from].length) { toast(from === "undo" ? "Nothing to undo" : "Nothing to redo"); return; }
    const e = hst[from].pop();
    hst[to].push({ s: this.snap(o), moved: e.moved });
    MyOrders.put({ ...o, ...JSON.parse(e.s) }, { ms: 900, moved: e.moved });
    this.render();
  },
  async rename() {
    const o = this.order();
    if (!MyOrders.isMine(o.id)) return;
    const t = await askText("Name your order", { value: o.title, ok: "Rename" });
    if (t) { MyOrders.put({ ...o, title: t }); this.render(); }
  },

  /* where a sheet is: { gi, i } in a gathering, or { gi: -1, i } set aside */
  locate(o, id) {
    for (let gi = 0; gi < o.gatherings.length; gi++) { const i = o.gatherings[gi].bifolia.indexOf(id); if (i >= 0) return { gi, i }; }
    return { gi: -1, i: this.aside(o).indexOf(id) };
  },
  take(o, id) {   // remove a sheet, returning its sewing options
    const { gi, i } = this.locate(o, id);
    if (gi < 0) { o.unplaced.splice(i, 1); return {}; }
    const g = o.gatherings[gi], opts = (g.sheets || {})[id] || {};
    g.bifolia.splice(i, 1);
    if (g.sheets) delete g.sheets[id];
    return opts;
  },
  put(o, id, gi, i, opts) {
    if (gi < 0) { o.unplaced.splice(i, 0, id); return; }
    const g = o.gatherings[gi];
    g.bifolia.splice(i, 0, id);
    if (Object.keys(opts).length) (g.sheets ||= {})[id] = opts;
  },
  /* Move a sheet to position i of gathering gi (-1: set aside). Empty gatherings are dropped. */
  move(id, gi, i) {
    this.sel = id;
    this.edit(o => {
      const from = this.locate(o, id);
      if (from.gi === gi && (i === from.i || i === from.i + 1)) return false;
      const opts = this.take(o, id);
      if (from.gi === gi && from.i < i) i--;
      this.put(o, id, gi, i, opts);
    }, { moved: [id] });
  },
  /* One place up or down the list; at the end of a gathering it moves into the next one (the 3D inspector's buttons). */
  step(id, d) {
    const o = this.order(), { gi, i } = this.locate(o, id);
    if (gi < 0) return;
    const n = o.gatherings[gi].bifolia.length;
    if (i + d >= 0 && i + d < n) this.move(id, gi, d > 0 ? i + 2 : i - 1);
    else if (d < 0 && gi > 0) this.move(id, gi - 1, o.gatherings[gi - 1].bifolia.length);
    else if (d > 0 && gi < o.gatherings.length - 1) this.move(id, gi + 1, 0);
    else toast(d < 0 ? "This sheet is already first" : "This sheet is already last");
  },
  /* into another booklet (gi; -1: set aside): at its centre, or after its last sheet if it reads sheet by sheet */
  moveInto(id, gi) {
    const o = this.order();
    this.move(id, gi, gi < 0 ? this.aside(o).length : o.gatherings[gi].bifolia.length);
  },
  newGathering(id) {
    this.sel = id;
    this.edit(o => {
      const { gi } = this.locate(o, id);
      const opts = this.take(o, id);
      const used = new Set(o.gatherings.map(g => String(g.quire)));
      let n = 1; while (used.has(`New ${n}`)) n++;
      const at = gi < 0 ? o.gatherings.length : gi + 1;
      o.gatherings.splice(at, 0, { quire: `New ${n}`, type: "nested", bifolia: [] });
      this.put(o, id, at, 0, opts);
    }, { moved: [id] });
  },
  setType(gi, type) { this.edit(o => { o.gatherings[gi].type = type; }); },
  moveGathering(gi, d) {
    this.edit(o => {
      const j = gi + d;
      if (j < 0 || j >= o.gatherings.length) return false;
      [o.gatherings[gi], o.gatherings[j]] = [o.gatherings[j], o.gatherings[gi]];
    }, { moved: [...this.order().gatherings[gi].bifolia] });
  },
  /* Move gathering gi so that it lands before the gathering now at position `to` (to = length: at the end). */
  moveGatheringTo(gi, to) {
    if (to === gi || to === gi + 1) return;
    this.edit(o => {
      const [g] = o.gatherings.splice(gi, 1);
      o.gatherings.splice(to > gi ? to - 1 : to, 0, g);
    }, { moved: [...this.order().gatherings[gi].bifolia] });
  },
  async renameGathering(gi) {
    const g = this.order().gatherings[gi];
    const t = await askText("Name this quire", { value: String(g.quire), ok: "Rename", placeholder: "e.g. 4, 13b, Herbal A" });
    if (!t) return;
    const was = String(g.quire);
    this.edit(o => { o.gatherings[gi].quire = /^\d+$/.test(t) ? +t : t; }, { ms: 300, renamed: [was, t] });
    if (this.at === was) this.at = String(this.order().gatherings[gi]?.quire ?? was);
    this.render();
  },
  setOpt(id, key, value) {
    this.sel = id;
    this.edit(o => {
      const { gi } = this.locate(o, id);
      if (gi < 0) return false;
      const g = o.gatherings[gi], cur = { ...((g.sheets || {})[id] || {}) };
      if (value == null || value === false) delete cur[key]; else cur[key] = value;
      g.sheets ||= {};
      if (Object.keys(cur).length) g.sheets[id] = cur; else delete g.sheets[id];
    }, { moved: [id] });
  },
  /* the sewing options of a sheet in the current order */
  optsOf(id) {
    const o = this.order(), { gi } = this.locate(o, id);
    return gi < 0 ? {} : ((o.gatherings[gi].sheets || {})[id] || {});
  },
  /* Put a sheet back where the order you started from has it, folded the same way. */
  putBack(id) {
    const src = this.source(this.order()), w = this.locate(src, id);
    this.sel = id;
    this.edit(o => {
      this.take(o, id);
      if (w.gi < 0) { o.unplaced.splice(Math.min(w.i, o.unplaced.length), 0, id); return; }
      const sg = src.gatherings[w.gi], key = String(sg.quire);
      let gi = o.gatherings.findIndex(g => String(g.quire) === key);
      if (gi < 0) {   // its booklet has gone: bring it back, after the booklet that came before it
        const before = src.gatherings.slice(0, w.gi).map(g => String(g.quire)).reverse()
          .map(k => o.gatherings.findIndex(g => String(g.quire) === k)).find(x => x >= 0) ?? -1;
        gi = before + 1;
        o.gatherings.splice(gi, 0, { quire: sg.quire, type: sg.type, bifolia: [] });
      }
      this.put(o, id, gi, Math.min(w.i, o.gatherings[gi].bifolia.length), (sg.sheets || {})[id] || {});
    }, { moved: [id] });
  },

  // ---------------------------------------------------------------- what changed
  /* the order yours was started from (a built-in order is its own source) */
  source(o) {
    if (!MyOrders.isMine(o.id)) return o;
    return ORDERS.get(o.fromId) || [...ORDERS.values()].find(x => !MyOrders.isMine(x.id) && x.title === o.from) || ORDERS.get("beinecke");
  },
  /* Booklets and sheets that differ from the source order. A sheet has changed when it is in another booklet, folded
     another way, or out of step with the sheets around it; moving one sheet doesn't mark the ones it pushed along. */
  changes(o) {
    const src = this.source(o), sheets = new Set(), booklets = new Set();
    if (src === o) return { sheets, booklets };
    const key = g => String(g.quire);
    const was = new Map();
    src.gatherings.forEach((g, gi) => g.bifolia.forEach((id, i) => was.set(id, { q: key(g), gi, i, o: JSON.stringify((g.sheets || {})[id] || {}) })));
    const srcAt = new Map(src.gatherings.map((g, i) => [key(g), i]));
    const kept = keptOrder(o.gatherings.map(g => srcAt.get(key(g)) ?? -1));
    o.gatherings.forEach((g, gi) => {
      const mine = g.bifolia.map((id, i) => [id, i]).filter(([id]) => was.get(id)?.q === key(g));
      const keep = keptOrder(mine.map(([id]) => was.get(id).i));
      const stays = new Set(mine.filter((_, j) => keep.has(j)).map(([id]) => id));
      for (const id of g.bifolia) if (!stays.has(id) || was.get(id).o !== JSON.stringify((g.sheets || {})[id] || {})) sheets.add(id);
      const s = srcAt.has(key(g)) ? src.gatherings[srcAt.get(key(g))] : null;
      if (!s || !kept.has(gi) || s.type !== g.type || s.bifolia.length !== g.bifolia.length || g.bifolia.some(id => sheets.has(id))) booklets.add(key(g));
    });
    const srcAside = new Set(this.aside(src));
    for (const id of this.aside(o)) if (!srcAside.has(id)) { sheets.add(id); booklets.add("aside"); }
    return { sheets, booklets };
  },

  // ---------------------------------------------------------------- naming a booklet
  /* { icon, name, range, extra, fold }: named by the section most of its sheets belong to, numbered by the leaves of
     the quire most of them come from; sheets from elsewhere are counted, not spanned ("75–84 +1"). */
  describe(ids, aside = false) {
    if (aside) return { icon: "aside", name: "Set aside", range: ids.length ? `${ids.length} sheet${ids.length === 1 ? "" : "s"}` : "out of the book", extra: 0 };
    const lost = ids.length > 0 && ids.every(lostSheet);
    const sec = mostOf(ids.map(sectionOf).filter(Boolean));
    const home = mostOf(ids.map(id => SHEETS.get(id).quire));
    const own = ids.filter(id => SHEETS.get(id).quire === home), leaves = own.flatMap(id => SHEETS.get(id).leaves);
    return { icon: lost ? "lost" : sec, name: lost ? "Lost" : SECTION_NAME[sec] || sec || "Empty",
             range: leaves.length ? `${Math.min(...leaves)}–${Math.max(...leaves)}` : "", extra: ids.length - own.length,
             fold: ids.length === 1 && foldout(ids[0]) };
  },
  /* the open booklet: { gi, key, ids, type, g } */
  booklet(o) {
    if (this.sel) {
      const { gi } = this.locate(o, this.sel);
      if (gi >= 0 || this.aside(o).includes(this.sel)) this.at = gi < 0 ? "aside" : String(o.gatherings[gi].quire);
    }
    let gi = this.at === "aside" ? -1 : o.gatherings.findIndex(g => String(g.quire) === this.at);
    if (gi < 0 && this.at !== "aside") { gi = 0; this.at = String(o.gatherings[0].quire); }
    const g = gi < 0 ? null : o.gatherings[gi];
    return { gi, key: this.at, g, ids: g ? g.bifolia : this.aside(o), type: g ? g.type : "aside" };
  },

  // ---------------------------------------------------------------- the dock
  render() {
    const el = this.el();
    if (!el) return;
    document.body.classList.toggle("arranging", this.on);   // messages rise above the dock (style.css)
    document.body.classList.toggle("on-table", this.on && !!this.table);   // or, on the table, go to its side
    const acts = $("#v3-arr-acts");
    if (!this.on) {
      el.hidden = true; el.innerHTML = ""; if (acts) { acts.hidden = true; acts.replaceChildren(); }
      document.documentElement.style.removeProperty("--dock-h");
      ArrangeList.render(); return;
    }
    const o = this.order();
    if (!o) return;   // an order being deleted: the page moves on to another, which draws it again
    this.shown = o;   // a different order, or a new version of yours, draws the dock again (mark)
    this.ch = this.changes(o);
    if (this.table) {   // on the table: a bar of its own above the book, and the picked sheet's buttons over it
      el.hidden = false; el.replaceChildren(this.topEl(o));
      this.renderActs(o);
      ArrangeList.render();   // and the list beside it, if it is open
      return;
    }
    const b = this.booklet(o), keep = $(".ar-tabs", el)?.scrollLeft;
    if (!b.ids.includes(this.hov)) this.hov = null;
    el.hidden = false;
    el.innerHTML = "";
    el.append(this.topEl(o), this.tabsEl(o, b), this.bookEl(o, b));
    // the tabs keep their place, and show the open quire's tab
    const tabs = $(".ar-tabs", el), cur = $(".ar-tab.cur", tabs);
    if (keep != null) tabs.scrollLeft = keep;
    if (cur) {
      const l = cur.offsetLeft, r = l + cur.offsetWidth;
      if (l < tabs.scrollLeft) tabs.scrollLeft = l - 12; else if (r > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = r - tabs.clientWidth + 12;
    }
    if (!this.ro) { this.ro = new ResizeObserver(() => this.fit()); this.ro.observe(el); }
    this.fit();
  },

  topEl(o) {
    const mine = MyOrders.isMine(o.id), hst = this.histOf(o.id), hidden = View3D.mod?.hiddenQuires().size || 0;
    const items = [
      mine ? { text: "Rename this order…", fn: () => this.rename() } : { text: "Make my own copy now", fn: () => this.edit(() => {}, { ms: 0, copy: true }) },
      { text: "Export a progress file", fn: () => Work.exportFile(), disabled: !MyOrders.list.length && !Crops.mine.size && !Bookmarks.list.length },
      { text: "Import a progress file…", fn: () => Work.pickFile() },
      { text: "All your work…", fn: () => Work.open() },
      hidden ? { text: `Show every quire in 3D (${hidden} hidden)`, fn: () => View3D.mod.showAllQuires() } : null,
      mine ? "-" : null,
      mine ? { text: "Delete this order…", danger: true, fn: async () => {
        if (await askYes(`Delete “${o.title}”?`, "This cannot be undone, unless you exported it.", "Delete", true)) { MyOrders.remove(o.id); this.render(); } } } : null];
    const lostOn = !!View3D.mod?.hideLost;
    return h("div", { class: "ar-top" },
      h("b", { class: "ar-h" }, "Rearrange"),
      mine
        ? h("span", { class: "ar-who" },
            h("button", { class: "ar-title", title: "Rename this order", onclick: () => this.rename() }, o.title, " ✎"),
            h("span", { class: "ar-saved", title: "Kept in this browser's storage. Export a progress file to keep a copy elsewhere." }, " · saved in this browser"))
        : h("span", { class: "ar-who" }, h("b", {}, o.title), " is never changed: your first move makes your own copy."),
      h("span", { class: "ar-tools" },
        mine ? h("button", { title: "Undo (⌘Z)", "aria-label": "Undo", disabled: !hst.undo.length, onclick: () => this.undo() }, "↶") : "",
        mine ? h("button", { title: "Redo (⇧⌘Z)", "aria-label": "Redo", disabled: !hst.redo.length, onclick: () => this.redo() }, "↷") : "",
        this.table ? h("button", { class: lostOn ? "on" : "", "aria-pressed": String(lostOn), title: "Leave the lost sheets off the table (L)",
          onclick: () => View3D.mod?.setHideLost(!lostOn) }, "Hide lost sheets") : "",
        this.table ? h("button", { class: `ar-keys${ArrangeList.open ? " on" : ""}`, title: "The list of quires and sheets, as Rearrange used to be", "aria-label": "List of quires",
          "aria-pressed": String(ArrangeList.open), onclick: () => ArrangeList.toggle() }, svgEl(LIST_ICON)) : "",
        this.table ? h("button", { class: "ar-keys", title: "Keyboard shortcuts", "aria-label": "Keyboard shortcuts", onclick: e => this.shortcuts(e.currentTarget) },
          svgEl('<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9"/></svg>')) : "",
        h("button", { class: "ar-more", title: "Export, import, rename, delete", "aria-label": "More", "aria-haspopup": "menu", onclick: e => this.menu(e.currentTarget, items) }, "⋯"),
        this.table ? h("button", { class: "ar-done", title: "Put the book back together (A or Esc)", onclick: () => this.close() }, "Done")
          : h("button", { title: "Close (A)", "aria-label": "Close Rearrange", onclick: () => this.close() }, "✕")),
      "");
  },

  /* One tab per quire, in the order of the book, like the strip of sheets under the book: its section, its name, and a
     tick for each of its sheets (hollow when the sheet is lost). The rest is in the tab's tooltip and the quire's head. */
  tabsEl(o, b) {
    const hidden = View3D.mod?.hiddenQuires() || new Set();
    const tab = (ids, key, gi) => {
      const aside = key === "aside", d = this.describe(ids, aside), g = o.gatherings[gi], hid = hidden.has(key);
      const lost = ids.filter(lostSheet).length, n = ids.length;
      const tip = aside ? `Set aside: ${n ? `${n} sheet${n === 1 ? "" : "s"} out of the book` : "nothing"}`
        : `${qWord(g.quire)} · ${d.name} · ${n} sheet${n === 1 ? "" : "s"}${lost ? `, ${lost} lost` : ""}${d.range ? ` · leaves ${d.range}` : ""}${hid ? " · hidden in 3D" : ""}`;
      return h("button", { class: `ar-tab${key === b.key ? " cur" : ""}${n && lost === n ? " lost" : ""}${hid ? " hid" : ""}`, role: "tab",
        "aria-selected": String(key === b.key), "data-key": key, "data-gi": gi, title: aside ? tip : `${tip}. Drag the tab to move the quire.`,
        onpointerdown: aside ? null : e => this.dragTab(e, gi), onclick: () => this.tabClick(key, gi) },
        h("span", { class: "ar-tn" }, icon(d.icon, 14), aside ? "Aside" : qTag(g.quire)),
        h("span", { class: "ar-ticks", "aria-hidden": "true" }, ids.map(id => h("i", { class: lostSheet(id) ? "lost" : "" }))),
        this.ch.booklets.has(key) ? h("span", { class: "ar-dot", title: "Changed in your order" }) : "");
    };
    return h("div", { class: "ar-tabs", role: "tablist", "aria-label": "Quires, in the order of the book" },
      o.gatherings.map((g, gi) => tab(g.bifolia, String(g.quire), gi)), tab(this.aside(o), "aside", -1));
  },

  bookEl(o, b) {
    const d = this.describe(b.ids, !b.g), n = b.ids.length, lost = b.ids.filter(lostSheet).length, nested = b.type === "nested";
    const facts = b.g
      ? [d.name, `${n} sheet${n === 1 ? "" : "s"}${lost ? ` (${lost} lost)` : ""}`, n > 1 ? (nested ? "tucked inside each other" : "separate, read one by one") : d.fold ? "a foldout" : "",
         d.range ? `leaves ${d.range}${d.extra ? ` and ${d.extra} more` : ""}` : ""]
      : [n ? `${n} sheet${n === 1 ? "" : "s"} out of the book` : "out of the book"];
    const head = h("div", { class: "ar-bh" },
      icon(d.icon, 18),
      h("b", {}, b.g ? qWord(b.g.quire) : "Set aside"),
      h("span", { class: "ar-sub" }, facts.filter(Boolean).join(" · ")),
      b.g ? h("button", { class: "ar-more", title: "Rename, how it is put together, hide in 3D, move", "aria-label": "Quire options", "aria-haspopup": "menu",
        onclick: e => this.menu(e.currentTarget, this.bookletMenu(o, b.gi)) }, "⋯") : "");
    const note = b.g?.note ? h("p", { class: "ar-bnote", title: b.g.note }, b.g.note) : "";
    const body = n ? h("div", { class: "ar-body" }, this.pileEl(o, b), this.detailEl(o, b))
      : h("p", { class: "ar-empty" }, "Nothing is set aside. To take a sheet out of the book, pick it and choose Move to › Set aside.");
    return h("section", { class: "ar-book", role: "tabpanel", "aria-label": b.g ? qWord(b.g.quire) : "Set aside" }, head, note, body);
  },

  optsIn: (b, id) => b.g ? ((b.g.sheets || {})[id] || {}) : {},
  picture: seg => h("img", { src: imgUrl(seg.img, "s", seg.v), alt: "", draggable: "false", style: seg.rot ? { transform: `rotate(${seg.rot}deg)` } : null }),

  /* The open quire as a pile of open sheets seen from above and to one side, the way it lies when you open it at its
     centre: the centre sheet on top, the outermost at the bottom. Each sheet shows its inside, the two pages that face
     each other when it lies open. Sheets read one by one (and a quire of one sheet) lie side by side instead. */
  pileEl(o, b) {
    const n = b.ids.length, nested = b.type === "nested" && n > 1;
    const layer = (id, i) => {
      const sides = sidesOf(SHEETS.get(id), this.optsIn(b, id));
      return h("div", { class: `ar-layer${id === this.sel ? " sel" : ""}${id === this.hov ? " hov" : ""}`, "data-id": id, style: { "--z": nested ? i : 0 },
        onpointerenter: () => this.hover(id), onpointerleave: () => this.hover(null, true),
        onpointerdown: e => this.dragLayer(e, id), onclick: () => this.pick(id) },
        [sides[1], sides[2]].map(s => s.lost ? h("span", { class: "ar-hole" }) : this.picture(spineShown(s))));
    };
    const label = (id, i) => h("button", { class: `ar-lbl${id === this.sel ? " sel" : ""}${id === this.hov ? " hov" : ""}`, "data-id": id,
      "aria-pressed": String(id === this.sel), "aria-label": `Sheet ${pairName(id)}${nested ? `, ${this.whereIn(b, i)}` : ""}`,
      onpointerenter: () => this.hover(id), onpointerleave: () => this.hover(null, true),
      onpointerdown: e => this.dragLayer(e, id), onclick: () => this.pick(id) },
      nested && (i === n - 1 || i === 0) ? h("span", { class: "ar-where" }, i === n - 1 ? "centre" : "outside") : "",
      h("span", { class: "ar-pair" }, pairName(id)),
      this.ch.sheets.has(id) ? h("span", { class: "ar-dot", title: "Moved or turned in your order" }) : "");
    if (!nested) return h("div", { class: "ar-row" }, b.ids.map((id, i) =>
      h("div", { class: "ar-one", "data-id": id }, h("div", { class: "ar-view" }, h("div", { class: "ar-pile" }, layer(id, i))), label(id, i))));
    return h("div", { class: "ar-stack" },
      h("div", { class: "ar-view" }, h("div", { class: "ar-pile" }, b.ids.map(layer))),
      h("div", { class: "ar-lbls" }, b.ids.map(label)));
  },
  whereIn(b, i) {
    const n = b.ids.length, nth = k => ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"][k] || `${k + 1}th`;
    if (!b.g) return "set aside";
    if (n === 1) return "the only sheet";
    if (b.type !== "nested") return `the ${nth(i)} of ${n}, read one by one`;
    return i === n - 1 ? "the centre sheet" : i === 0 ? "the outermost sheet" : `the ${nth(i)} sheet from the outside`;
  },

  /* The sheet pointed at, or else the one picked: where it is, and its four pages in the order they are read. */
  detailEl(o, b) {
    const id = b.ids.includes(this.hov) ? this.hov : this.sel, i = b.ids.indexOf(id);
    if (i < 0) return h("div", { class: "ar-detail" }, h("p", { class: "ar-hint" }, "Point at a sheet to see its pages. Click it to pick it up and move it."));
    const sh = SHEETS.get(id), sides = sidesOf(sh, this.optsIn(b, id));
    const v = varsOf([...sh.inside.flat(), ...sh.outside.flat()]);
    const about = [v.is.map(s => SECTION_NAME[s] || s).join(", "), v.hs.map(k => SCRIBES[k]).join(", ")].filter(Boolean).join(" · ");
    const page = s => { const p = spineShown(s);
      return h("figure", { class: "ar-page" }, s.lost ? h("span", { class: "ar-hole" }) : this.picture(p), h("figcaption", {}, short(pageName(p)), s.lost ? " lost" : "")); };
    return h("div", { class: "ar-detail" },
      h("div", { class: "ar-dh" }, h("b", {}, `Sheet ${pairName(id)}`), h("span", {}, `· ${this.whereIn(b, i)}`),
        this.ch.sheets.has(id) ? h("span", { class: "ar-dot", title: `Moved or turned since “${this.source(o).title}”` }) : ""),
      about ? h("div", { class: "ar-dsub" }, about) : "",
      h("div", { class: "ar-faces" }, sheetFaces(id, this.optsIn(b, id), 64, 300)),
      id === this.sel ? this.actsEl(o, b, id, i) : h("p", { class: "ar-hint" }, "Click to pick it up."));
  },

  actsEl(o, b, id, i) {
    const opts = this.optsOf(id), nested = b.type === "nested", n = b.ids.length;
    const into = [...o.gatherings.map((g, gi) => gi === b.gi ? null : { text: `${qWord(g.quire)} · ${this.describe(g.bifolia).name}`, fn: () => this.moveInto(id, gi) }),
      b.g ? "-" : null, b.g ? { text: "Set aside: out of the book", fn: () => this.moveInto(id, -1) } : null];
    return h("div", { class: "ar-acts" },
      b.g && n > 1 ? (nested
        ? [h("button", { disabled: i === n - 1, onclick: () => this.move(id, b.gi, i + 2), title: "One sheet further in: up the pile" }, "↑ Toward the centre"),
           h("button", { disabled: i === 0, onclick: () => this.move(id, b.gi, i - 1), title: "One sheet further out: down the pile" }, "↓ Outward")]
        : [h("button", { disabled: i === 0, onclick: () => this.move(id, b.gi, i - 1) }, "← Earlier"),
           h("button", { disabled: i === n - 1, onclick: () => this.move(id, b.gi, i + 2) }, "Later →")]) : "",
      h("button", { "aria-haspopup": "menu", title: "Into another quire, or out of the book", onclick: e => this.menu(e.currentTarget, into) }, b.g ? "Move to…" : "Put back in…"),
      b.g ? h("button", { class: opts.inside_out ? "on" : "", "aria-pressed": String(!!opts.inside_out), onclick: () => this.setOpt(id, "inside_out", !opts.inside_out),
        title: "Fold the sheet the other way, so its outside pages face each other in the middle" }, "Inside out") : "",
      b.g ? h("button", { class: opts.rot180 ? "on" : "", "aria-pressed": String(!!opts.rot180), onclick: () => this.setOpt(id, "rot180", !opts.rot180),
        title: "Turn the sheet round, so its first leaf becomes its last" }, "Upside down") : "",
      h("button", { class: "ar-more", title: "New quire, sewn at another fold, put back", "aria-label": "More for this sheet", "aria-haspopup": "menu",
        onclick: e => this.menu(e.currentTarget, this.sheetMenu(o, id, b)) }, "⋯"));
  },

  sheetMenu(o, id, b) {
    const sh = SHEETS.get(id), n = sh.inside[0].length, opts = this.optsOf(id), cur = opts.spine ?? sh.spine;
    const row = sh.inside[sh.proper_row ?? (sh.inside.length - 1)];
    return [
      { text: "Start a new quire with it", fn: () => this.newGathering(id) },
      ...(b.g && n > 2 ? ["-", { label: "Sewn at the fold between" },
        ...Array.from({ length: n - 1 }, (_, k) => k + 1).map(k => ({ check: cur === k, radio: true,
          text: `${short(pageName(row[k - 1]))} and ${short(pageName(row[k]))}${k === sh.spine ? " (as bound)" : ""}`,
          fn: () => this.setOpt(id, "spine", k === sh.spine ? null : k) }))] : []),
      ...(this.ch.sheets.has(id) ? ["-", { text: `Put it back as in “${this.source(o).title}”`, fn: () => this.putBack(id) }] : [])];
  },

  bookletMenu(o, gi) {
    const g = o.gatherings[gi], hid = !!View3D.mod?.hiddenQuires().has(String(g.quire));
    return [
      { text: "Rename…", fn: () => this.renameGathering(gi) },
      "-", { label: "Its sheets are" },
      { check: g.type !== "singulions", radio: true, text: "Tucked inside each other", fn: () => this.setType(gi, "nested") },
      { check: g.type === "singulions", radio: true, text: "Separate, read one by one", fn: () => this.setType(gi, "singulions") },
      "-",
      { text: hid ? "Show in 3D" : "Hide in 3D, like a layer", fn: () => View3D.mod?.setHidden(g.quire, !hid) },
      { text: "Move the quire earlier", disabled: gi === 0, fn: () => this.moveGathering(gi, -1) },
      { text: "Move the quire later", disabled: gi === o.gatherings.length - 1, fn: () => this.moveGathering(gi, 1) }];
  },

  /* Scale and centre the pile in the room it has, then line the labels up with the sheets. */
  fit() {
    const el = this.el();
    if (!el || el.hidden) return;
    document.documentElement.style.setProperty("--dock-h", el.offsetHeight + "px");
    for (const view of $$(".ar-view", el)) {
      const pile = $(".ar-pile", view);
      view.style.setProperty("--k", 1); view.style.setProperty("--tx", "0px"); view.style.setProperty("--ty", "0px");
      const rs = $$(".ar-layer", pile).map(l => l.getBoundingClientRect());
      if (!rs.length) continue;
      const top = Math.min(...rs.map(r => r.top)), bot = Math.max(...rs.map(r => r.bottom)), left = Math.min(...rs.map(r => r.left)), right = Math.max(...rs.map(r => r.right));
      const v = view.getBoundingClientRect();
      const k = Math.min(1.25, (v.height - 10) / (bot - top), (v.width - 10) / (right - left));
      view.style.setProperty("--k", k.toFixed(3));
      view.style.setProperty("--tx", (-k * ((left + right) / 2 - (v.left + v.width / 2))).toFixed(1) + "px");
      view.style.setProperty("--ty", (-k * ((top + bot) / 2 - (v.top + v.height / 2))).toFixed(1) + "px");
    }
    this.place();
  },
  /* Each label sits level with the front edge of its sheet, the part of it that shows under the sheet above. */
  place() {
    const lbls = $(".v3-arrange .ar-lbls"); if (!lbls) return;
    const view = lbls.previousElementSibling, base = lbls.getBoundingClientRect().top;
    const fronts = new Map($$(".ar-layer", view).map(l => [l.dataset.id, l.getBoundingClientRect().bottom - base]));
    const ys = [...fronts.values()].sort((a, c) => a - c), step = ys.length > 1 ? Math.min(...ys.slice(1).map((y, j) => y - ys[j])) : 24;
    for (const l of $$(".ar-lbl", lbls)) {
      const y = fronts.get(l.dataset.id);
      l.style.top = (y - Math.max(step, 20) / 2 - l.offsetHeight / 2).toFixed(1) + "px";
    }
  },

  // ---------------------------------------------------------------- pointing and picking
  /* Pointing at a sheet (in the pile or its label) shows it; leaving shows the picked one again, after a moment, so that
     sliding from one sheet to the next doesn't flicker. */
  hover(id, later = false) {
    clearTimeout(this.hovT);
    if (later) { this.hovT = setTimeout(() => this.hover(null), 120); return; }
    if (this.dragging || this.hov === id) return;
    this.hov = id;
    const el = this.el(); if (!el || el.hidden) return;
    for (const x of $$(".ar-layer, .ar-lbl", el)) x.classList.toggle("hov", x.dataset.id === id);
    const o = this.order();
    $(".ar-detail", el)?.replaceWith(this.detailEl(o, this.booklet(o)));
  },
  /* The 3D book moved to another sheet (or the dock asked it to): pick that sheet and open its quire. */
  mark(id, user = false) {
    if (!this.on || !id || this.dragging || !this.order()) return;
    const o = this.order(), was = this.at;
    if (this.table) {   // on the table: ← → (user) move the selection; an order redrawn only refreshes the bar
      if (this.shown !== o) this.render();
      else if (user && !this.selected.has(id)) this.setSel([id], { main: id });
      return;
    }
    if (id === this.sel && this.shown === o) return;
    this.sel = id;
    this.booklet(o);
    const el = this.el();
    if (this.shown !== o || this.at !== was || !el?.querySelector(`.ar-layer[data-id="${CSS.escape(id)}"]`)) return this.render();
    for (const x of $$(".ar-layer, .ar-lbl", el)) { const on = x.dataset.id === id; x.classList.toggle("sel", on); if (x.matches(".ar-lbl")) x.setAttribute("aria-pressed", String(on)); }
    $(".ar-detail", el)?.replaceWith(this.detailEl(o, this.booklet(o)));
  },
  pick(id) {
    if (this.noClick) return;
    View3D.mod?.focusSheet(id);   // the book turns to it, and calls mark()
    if (this.sel !== id) this.mark(id);
    $(".ar-acts", this.el())?.scrollIntoView({ block: "nearest" });   // on a phone the panel scrolls: its buttons, in view
  },
  tabClick(key, gi) {
    if (this.noClick) return;
    const o = this.order(), ids = gi < 0 ? this.aside(o) : o.gatherings[gi].bifolia;
    if (!ids.length) { this.at = key; this.sel = null; return this.render(); }
    const pick = ids.includes(this.sel) ? this.sel : ids[0];
    this.at = key;
    View3D.mod?.focusSheet(pick);
    if (this.sel !== pick) this.mark(pick);
  },

  // ---------------------------------------------------------------- on the table (wide screens)
  /* The selection: sheets (the main one is the 3D book's current sheet) or whole quires, never both. */
  /* the selection, without telling 3D yet (an edit is about to redraw it) */
  preSel(ids, { main, quires = [] } = {}) {
    this.selected = new Set(ids); this.selQ = new Set(quires.map(String));
    this.sel = main !== undefined ? main : ids.at(-1) ?? null;
    if (View3D.mod?.debug) Object.assign(View3D.mod.debug.V, { sel: new Set(this.selected), selQ: new Set(this.selQ), selMain: this.sel });
  },
  setSel(ids, { main, quires = [] } = {}) {
    this.selected = new Set(ids); this.selQ = new Set(quires.map(String));
    this.sel = main !== undefined ? main : this.selected.has(this.sel) ? this.sel : ids.at(-1) ?? null;
    View3D.mod?.setSelection([...this.selected], [...this.selQ], this.sel);
    this.renderActs(this.order());
    if (!this.selected.has(ArrangeList.optsFor)) ArrangeList.optsFor = null;
    ArrangeList.mark(true);
  },
  /* A click on the table: on a sheet, select it (⇧, ⌘ or Ctrl: add it, or take it out); on nothing, select nothing. */
  click(id, e) {
    if (this.noClick) return;
    const add = !!e && (e.shiftKey || e.metaKey || e.ctrlKey);
    if (!id) { if (!add) this.setSel([]); return; }
    if (!add) return this.setSel([id], { main: id });
    const s = new Set(this.selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    this.setSel([...s], { main: s.has(id) ? id : [...s].at(-1) ?? null });
  },
  /* the sheets a drag takes: the selection if the sheet is in it, else the sheet alone (which it then selects) */
  dragSet(id) {
    if (this.selected.has(id) && this.selected.size > 1) return this.inOrder([...this.selected]);
    this.setSel([id], { main: id });
    return [id];
  },
  /* a box drawn across the table (view3d.js marquee), live as it grows */
  marquee(ids, add, end) {
    this.mBase ||= add ? [...this.selected] : [];
    this.setSel([...new Set([...this.mBase, ...ids])], { main: ids.at(-1) ?? null });
    if (end) this.mBase = null;
  },
  clickQuire(e, key) {
    if (this.noClick) return;
    const o = this.order(), now = performance.now();
    if (key !== "aside" && this.lastQ?.key === key && now - this.lastQ.t < 450 && !(e.shiftKey || e.metaKey || e.ctrlKey)) {   // a double click: rename
      this.lastQ = null; return this.renameInline(key);
    }
    this.lastQ = { key, t: now };
    if (key === "aside") return this.setSel(this.aside(o).slice());   // the set-aside pile: its sheets
    const add = e.shiftKey || e.metaKey || e.ctrlKey, s = new Set(add ? this.selQ : []);
    if (add && s.has(key)) s.delete(key); else s.add(key);
    this.setSel([], { quires: [...s], main: null });
  },

  // the sheets and quires selected, as the order has them
  inOrder(ids, o = this.order()) {
    const pos = id => { const { gi, i } = this.locate(o, id); return gi < 0 ? [1e9, i] : [gi, i]; };
    return [...ids].sort((a, b) => { const [g1, i1] = pos(a), [g2, i2] = pos(b); return g1 - g2 || i1 - i2; });
  },
  gIndex: (o, key) => o.gatherings.findIndex(g => String(g.quire) === String(key)),
  quiresInOrder(keys, o = this.order()) { return [...keys].filter(k => this.gIndex(o, k) >= 0).sort((a, b) => this.gIndex(o, a) - this.gIndex(o, b)); },
  /* a quire name not yet used: "New 1", or `base` with a letter after it ("13a") */
  freeName(o, base = null) {
    const used = new Set(o.gatherings.map(g => String(g.quire)));
    if (base == null) { let n = 1; while (used.has(`New ${n}`)) n++; return `New ${n}`; }
    for (const c of "abcdefghijklmnopqrstuvwxyz") if (!used.has(`${base}${c}`)) return `${base}${c}`;
    let n = 2; while (used.has(`${base}-${n}`)) n++; return `${base}-${n}`;
  },
  say(msg) {   // for screen readers: what a change did
    let el = $("#ar-live");
    if (!el) { el = h("div", { id: "ar-live", class: "sr-only", "aria-live": "polite" }); document.body.append(el); }
    el.textContent = msg;
  },
  label: id => pairName(id).replace(/ /g, ""),
  qName(o, gi) { return gi < 0 ? "Set aside" : qTag(o.gatherings[gi].quire); },

  /* Move sheets (in the order they have) into gathering gi (-1: set aside), in front of sheet `anchor` (null: after the
     last). One step to undo. Returns whether the order changed. */
  moveMany(ids, gi, anchor = null) {
    const o0 = this.order(); ids = this.inOrder(ids, o0);
    const key = gi < 0 ? "aside" : String(o0.gatherings[gi].quire);
    const was = [this.selected, this.selQ, this.sel];
    this.preSel(ids, { main: ids.at(-1) });
    const done = this.edit(o => {
      const g = key === "aside" ? null : o.gatherings[this.gIndex(o, key)], list = g ? g.bifolia : o.unplaced;
      const before = list.indexOf(anchor), next = anchor && ids.includes(anchor) ? list.slice(before).find(x => !ids.includes(x)) ?? null : anchor;
      const opts = ids.map(id => this.take(o, id));
      let at = next ? list.indexOf(next) : list.length;
      if (at < 0) at = list.length;
      list.splice(at, 0, ...ids);
      if (g) ids.forEach((id, j) => { if (Object.keys(opts[j]).length) (g.sheets ||= {})[id] = opts[j]; });
    }, { moved: ids });
    if (done) { this.say(`${ids.map(this.label).join(", ")} moved to ${key === "aside" ? "set aside" : qTag(key)}`); this.setSel(ids, { main: ids.at(-1) }); }
    else this.setSel([...was[0]], { main: was[2], quires: [...was[1]] });
    return done;
  },
  /* Sheets let go over a pile, before the k-th of the sheets 3D shows there (lost ones may be hidden). */
  dropAt(ids, gi, shown, k) { return this.moveMany(ids, gi, shown[k] ?? null); },
  /* A new quire of these sheets, after quire `after` (null: first). Its sheets read as the ones they came from did. */
  newQuireAt(ids, after) {
    const o0 = this.order(); ids = this.inOrder(ids, o0);
    const from = new Set(ids.map(id => this.locate(o0, id).gi));
    if (from.size === 1 && !from.has(-1)) {   // a whole quire let go beside itself: nothing to do
      const gi = [...from][0], g = o0.gatherings[gi];
      if (g.bifolia.length === ids.length && (after === String(g.quire) || after === (gi ? String(o0.gatherings[gi - 1].quire) : null))) return false;
    }
    const types = new Set([...from].filter(gi => gi >= 0).map(gi => o0.gatherings[gi].type));
    let name = null;
    this.preSel([], { quires: [this.freeName(o0)] });
    const done = this.edit(o => {
      const opts = ids.map(id => this.take(o, id));
      const g = { quire: name = this.freeName(o), type: types.size === 1 ? [...types][0] : "nested", bifolia: ids.slice(), sheets: {} };
      ids.forEach((id, j) => { if (Object.keys(opts[j]).length) g.sheets[id] = opts[j]; });
      o.gatherings.splice(after == null ? 0 : this.gIndex(o, after) + 1, 0, g);
    }, { moved: ids });
    if (done) { this.say(`New quire ${name} of ${ids.length} sheet${ids.length === 1 ? "" : "s"}`); this.setSel([], { quires: [name] }); }
    return done;
  },
  /* ⌘G: the selected sheets make a new quire, where the first of them was; selected quires are merged into one. */
  group() {
    const o = this.order();
    if (this.selQ.size > 1) return this.merge([...this.selQ]);
    if (this.selQ.size === 1) { toast("Select two or more quires to merge them, or sheets to make a new quire of them"); return; }
    const ids = this.inOrder([...this.selected]);
    if (!ids.length) return;
    const gi = this.locate(o, ids[0]).gi;
    this.newQuireAt(ids, gi < 0 ? String(o.gatherings.at(-1).quire) : String(o.gatherings[gi].quire));
  },
  /* Quires into one, the first of them (in the order of the book) keeping its name and how it is put together: the
     sheets of the later ones go in after its own (inside its centre, if it is tucked). */
  merge(keys) {
    const o0 = this.order(); keys = this.quiresInOrder(keys, o0);
    if (keys.length < 2) return false;
    const moved = keys.slice(1).flatMap(k => o0.gatherings[this.gIndex(o0, k)].bifolia);
    const done = this.edit(o => {
      const g = o.gatherings[this.gIndex(o, keys[0])];
      for (const k of keys.slice(1)) {
        const i = this.gIndex(o, k), h2 = o.gatherings[i];
        g.bifolia.push(...h2.bifolia);
        for (const [id, op] of Object.entries(h2.sheets || {})) (g.sheets ||= {})[id] = op;
        o.gatherings.splice(i, 1);
      }
    }, { moved });
    if (done) { this.say(`${keys.map(qTag).join(", ")} merged into ${qTag(keys[0])}`); this.setSel([], { quires: [keys[0]] }); }
    return done;
  },
  /* ⇧⌘G: each selected quire (or the quire of each selected sheet) comes apart into quires of one sheet: 13a, 13b… */
  split(keys = null) {
    const o0 = this.order();
    keys = this.quiresInOrder(keys || (this.selQ.size ? [...this.selQ] : [...new Set([...this.selected].map(id => this.locate(o0, id).gi).filter(gi => gi >= 0).map(gi => String(o0.gatherings[gi].quire)))]), o0)
      .filter(k => o0.gatherings[this.gIndex(o0, k)].bifolia.length > 1);
    if (!keys.length) { toast("A quire of one sheet can't be split further"); return false; }
    const made = [];
    const done = this.edit(o => {
      for (const k of keys) {
        const i = this.gIndex(o, k), g = o.gatherings[i];
        o.gatherings.splice(i, 1);   // its name is free again for its parts
        g.bifolia.forEach((id, j) => {   // each part takes its place (and its name) before the next one is named
          const p = { quire: this.freeName(o, k), type: g.type, bifolia: [id], ...((g.sheets || {})[id] ? { sheets: { [id]: g.sheets[id] } } : {}) };
          o.gatherings.splice(i + j, 0, p);
          made.push(p.quire);
        });
      }
    }, { moved: keys.flatMap(k => o0.gatherings[this.gIndex(o0, k)].bifolia) });
    if (done) { this.say(`${keys.map(qTag).join(", ")} split into ${made.length} quires`); this.setSel([], { quires: made }); }
    return done;
  },
  setAside(ids) { return this.moveMany(ids, -1, null); },
  /* ⌘] / ⌘[: the selected sheets one place toward the centre (a fan: later) or outward (earlier); with ⌥, all the way.
     Selected quires: one place later or earlier in the book (⌥: to the end or the start). */
  reorder(d, far = false) {
    const o = this.order();
    if (this.selQ.size) {
      const keys = this.quiresInOrder([...this.selQ], o);
      if (keys.length !== 1) { toast("Move one quire at a time"); return; }
      const gi = this.gIndex(o, keys[0]);
      return far ? this.moveGatheringTo(gi, d > 0 ? o.gatherings.length : 0) : this.moveGathering(gi, d);
    }
    const ids = this.inOrder([...this.selected]); if (!ids.length) return;
    const gis = new Set(ids.map(id => this.locate(o, id).gi));
    if (gis.size !== 1) { toast("Select sheets from one quire to move them within it"); return; }
    const gi = [...gis][0], list = gi < 0 ? this.aside(o) : o.gatherings[gi].bifolia, rest = list.filter(x => !ids.includes(x));
    const before = id => rest.filter(x => list.indexOf(x) < list.indexOf(id)).length;   // how many others come before it
    const at = far ? (d > 0 ? rest.length : 0) : d > 0 ? Math.min(rest.length, before(ids.at(-1)) + 1) : Math.max(0, before(ids[0]) - 1);
    return this.moveMany(ids, gi, rest[at] ?? null);
  },
  /* ⌘X, then ⌘V: the cut sheets go after the selected sheet, or into the selected quire (at its end); with nothing
     selected, into a new quire at the end. */
  cut() {
    const ids = this.inOrder([...this.selected]);
    if (!ids.length) return;
    this.clip = ids;
    toast(`${ids.length === 1 ? this.label(ids[0]) : `${ids.length} sheets`} cut: select where ${ids.length === 1 ? "it goes" : "they go"}, then ⌘V`);
    this.renderActs(this.order());
  },
  paste() {
    const o = this.order(), ids = (this.clip || []).filter(id => SHEETS.has(id));
    if (!ids.length) return;
    let done;
    if (this.selQ.size === 1) done = this.moveMany(ids, this.gIndex(o, [...this.selQ][0]), null);
    else if (this.sel && !ids.includes(this.sel) && this.selected.size) {
      const { gi, i } = this.locate(o, this.sel), list = gi < 0 ? this.aside(o) : o.gatherings[gi].bifolia;
      done = this.moveMany(ids, gi, list.slice(i + 1).find(x => !ids.includes(x)) ?? null);
    } else done = this.newQuireAt(ids, String(o.gatherings.at(-1).quire));
    if (done !== false) this.clip = null;
  },
  /* Put sheets back where the order you started from has them, folded the same way. */
  putBackMany(ids) {
    const src = this.source(this.order());
    const done = this.edit(o => {
      for (const id of ids) {
        const w = this.locate(src, id);
        this.take(o, id);
        if (w.gi < 0) { o.unplaced.splice(Math.min(w.i, o.unplaced.length), 0, id); continue; }
        const sg = src.gatherings[w.gi], key = String(sg.quire);
        let gi = this.gIndex(o, key);
        if (gi < 0) {   // its quire has gone: bring it back, after the quire that came before it
          const before = src.gatherings.slice(0, w.gi).map(g => String(g.quire)).reverse().map(k => this.gIndex(o, k)).find(x => x >= 0) ?? -1;
          gi = before + 1;
          o.gatherings.splice(gi, 0, { quire: sg.quire, type: sg.type, bifolia: [] });
        }
        this.put(o, id, gi, Math.min(w.i, o.gatherings[gi].bifolia.length), (sg.sheets || {})[id] || {});
      }
    }, { moved: ids });
    if (done) this.say(`${ids.length} sheet${ids.length === 1 ? "" : "s"} put back`);
    return done;
  },
  /* the sheets on the table, in reading order (hidden quires and, if hidden, lost sheets left out) */
  onTable() {
    const o = this.order(), hid = View3D.mod?.hiddenQuires() || new Set(), noLost = !!View3D.mod?.hideLost;
    return [...o.gatherings.filter(g => !hid.has(String(g.quire))).flatMap(g => g.bifolia), ...this.aside(o)].filter(id => !(noLost && lostSheet(id)));
  },
  selectAll() {
    const o = this.order(), ids = [...this.selected], gis = new Set(ids.map(id => this.locate(o, id).gi));
    if (ids.length && gis.size === 1) {   // first its quire, then everything
      const gi = [...gis][0], all = (gi < 0 ? this.aside(o) : o.gatherings[gi].bifolia).filter(id => this.onTable().includes(id));
      if (all.length > ids.length) return this.setSel(all, { main: this.sel });
    }
    this.setSel(this.onTable(), { main: this.sel });
  },

  /* Keys on the table, as in drawing programs. Returns whether the key was used. */
  key(e) {
    if (!this.on || !this.table || this.menuEl) return false;
    const mod = e.metaKey || e.ctrlKey, c = e.code, o = this.order(), any = this.selected.size || this.selQ.size;
    const onCanvas = !document.activeElement || document.activeElement === document.body || document.activeElement.closest?.("#v3-stage");
    if (e.key === "Escape") {
      if (View3D.mod?.cancelDrag()) return true;
      if (any) this.setSel([]); else this.close();
      return true;
    }
    if (mod && c === "KeyA") { this.selectAll(); return true; }
    if (mod && c === "KeyG") { e.shiftKey ? this.split() : this.group(); return true; }
    if (mod && (c === "BracketRight" || c === "BracketLeft")) { this.reorder(c === "BracketRight" ? 1 : -1, e.altKey); return true; }
    if (mod && c === "KeyX") { this.cut(); return true; }
    if (mod && c === "KeyV") { this.paste(); return true; }
    if (mod) return false;
    if ((e.key === "Backspace" || e.key === "Delete") && any) {
      const ids = this.selQ.size ? [...this.selQ].flatMap(k => o.gatherings[this.gIndex(o, k)]?.bifolia || []) : [...this.selected];
      if (ids.every(id => this.locate(o, id).gi < 0)) return true;   // already out of the book
      const n = ids.length;
      if (this.setAside(ids)) toast(`${n === 1 ? this.label(ids[0]) : `${n} sheets`} set aside`, { label: "Undo", fn: () => this.undo() });
      return true;
    }
    if (e.shiftKey && (c === "Digit1" || c === "Digit2")) { View3D.mod?.frameTable(c === "Digit2" ? [...this.selected] : null); return true; }
    if (e.key === "Enter") {
      if (e.shiftKey && this.selected.size) { const keys = new Set([...this.selected].map(id => this.locate(o, id).gi).filter(gi => gi >= 0).map(gi => String(o.gatherings[gi].quire))); this.setSel([], { quires: [...keys] }); }
      else if (!e.shiftKey && this.selQ.size) { const ids = this.quiresInOrder([...this.selQ]).flatMap(k => o.gatherings[this.gIndex(o, k)].bifolia); this.setSel(ids, { main: ids[0] }); }
      else return false;
      return true;
    }
    if (e.key === "Tab" && onCanvas) {   // the next sheet (⇧: the one before), in reading order
      const all = this.onTable(), i = all.indexOf(this.sel);
      const id = all[(i < 0 ? 0 : i + (e.shiftKey ? -1 : 1) + all.length) % all.length];
      if (id) this.setSel([id], { main: id });
      return true;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && this.selected.size === 1) {   // up or down its pile
      const { gi, i } = this.locate(o, this.sel), list = gi < 0 ? this.aside(o) : o.gatherings[gi].bifolia;
      const id = list[i + (e.key === "ArrowUp" ? 1 : -1)];
      if (id) this.setSel([id], { main: id });
      return true;
    }
    return false;
  },

  // ---------------------------------------------------------------- what the selection can do
  /* The bar over the foot of the table: what is selected, and what it can do. Nothing selected: no bar. */
  renderActs(o) {
    const bar = $("#v3-arr-acts"); if (!bar) return;
    const ids = o ? this.inOrder([...this.selected].filter(id => SHEETS.has(id)), o) : [];
    if (!this.table || !this.on || !o || (!ids.length && !this.selQ.size)) { bar.hidden = true; bar.replaceChildren(); return; }
    bar.hidden = false;
    const btn = (text, fn, at = {}) => h("button", { ...at, onclick: e => fn(e) }, text);
    const more = items => h("button", { class: "ar-more", "aria-label": "More", title: "More", "aria-haspopup": "menu", onclick: e => this.menu(e.currentTarget, items()) }, "⋯");
    if (this.selQ.size) {
      const keys = this.quiresInOrder([...this.selQ], o);
      if (!keys.length) { bar.hidden = true; return; }
      const g = o.gatherings[this.gIndex(o, keys[0])], one = keys.length === 1, sing = g.type === "singulions";
      bar.replaceChildren(
        h("span", { class: "aa-what" }, one ? [View3D.mod?.glyph(g.bifolia, { fan: sing, hi: new Set(g.bifolia) }) || "", h("b", {}, qTag(g.quire))] : h("b", {}, `${keys.length} quires`)),
        one ? h("span", { class: "aa-seg", role: "group", "aria-label": "How its sheets are put together" },
          btn("Tucked", () => this.setType(this.gIndex(o, keys[0]), "nested"), { class: sing ? "" : "on", "aria-pressed": String(!sing), title: "Sheets tucked inside each other, sewn through the centre" }),
          btn("Separate", () => this.setType(this.gIndex(o, keys[0]), "singulions"), { class: sing ? "on" : "", "aria-pressed": String(sing), title: "Sheets read one by one, each on its own" })) : "",
        one ? btn("Merge with next", () => this.merge([keys[0], String(o.gatherings[this.gIndex(o, keys[0]) + 1]?.quire)]), { disabled: this.gIndex(o, keys[0]) === o.gatherings.length - 1, title: "Its sheets and the next quire's in one quire" })
          : btn("Merge", () => this.merge(keys), { title: "Into one quire (⌘G)" }),
        btn("Split", () => this.split(keys), { title: "Into quires of one sheet each (⇧⌘G)", disabled: keys.every(k => o.gatherings[this.gIndex(o, k)].bifolia.length < 2) }),
        more(() => this.quireItems(keys)));
      return;
    }
    const gis = new Set(ids.map(id => this.locate(o, id).gi)), same = gis.size === 1, gi = [...gis][0], g = o.gatherings[gi];
    const nested = g?.type === "nested", list = same ? (gi < 0 ? this.aside(o) : g.bifolia) : [];
    const first = same && list.indexOf(ids[0]) === 0, last = same && list.indexOf(ids.at(-1)) === list.length - 1;
    const where = ids.length === 1 ? [View3D.mod?.glyph(list, { fan: !nested, hi: new Set(ids) }) || "", h("b", {}, this.label(ids[0]))] : h("b", {}, `${ids.length} sheets`);
    const changed = ids.some(id => this.ch?.sheets.has(id));
    const id = ids[0], opts = ids.length === 1 && g ? this.optsOf(id) : null;
    bar.replaceChildren(
      h("span", { class: "aa-what" }, where, changed ? h("span", { class: "ar-dot", title: `Moved or turned since “${this.source(o).title}”` }) : ""),
      same && g && list.length > ids.length ? h("span", { class: "aa-seg" },
        btn(nested ? "↑" : "←", () => this.reorder(nested ? 1 : -1), { disabled: nested ? last : first, "aria-label": nested ? "Toward the centre" : "Earlier", title: nested ? "Toward the centre (⌘])" : "Earlier (⌘[)" }),
        btn(nested ? "↓" : "→", () => this.reorder(nested ? -1 : 1), { disabled: nested ? first : last, "aria-label": nested ? "Outward" : "Later", title: nested ? "Outward (⌘[)" : "Later (⌘])" })) : "",
      btn(gi < 0 && same ? "Put in…" : "Move to…", e => this.menu(e.currentTarget, this.moveToItems(ids)), { "aria-haspopup": "menu", title: "Into another quire, or out of the book" }),
      ids.length > 1 ? btn("New quire", () => this.group(), { title: "A quire of these sheets (⌘G)" }) : "",
      opts ? btn("Inside out", () => this.setOpt(id, "inside_out", !opts.inside_out), { class: opts.inside_out ? "on" : "", "aria-pressed": String(!!opts.inside_out), title: "Fold the sheet the other way, so its outside pages face each other in the middle" }) : "",
      opts ? btn("Upside down", () => this.setOpt(id, "rot180", !opts.rot180), { class: opts.rot180 ? "on" : "", "aria-pressed": String(!!opts.rot180), title: "Turn the sheet round, so its first leaf becomes its last" }) : "",
      ids.length > 1 && !(same && gi < 0) ? btn("Set aside", () => this.setAside(ids), { title: "Out of the book (⌫)" }) : "",
      more(() => this.sheetItems(ids)));
  },
  moveToItems(ids) {
    const o = this.order(), here = new Set(ids.map(id => this.locate(o, id).gi));
    return [...o.gatherings.map((g, gi) => here.size === 1 && here.has(gi) ? null
        : { text: `${qTag(g.quire)}`, note: [...new Set(g.bifolia.map(sectionOf).filter(Boolean))].map(s => SECTION_NAME[s] || s).join(", ") || "lost", fn: () => this.moveMany(ids, gi, null) }),
      "-", { text: "A new quire, at the end", fn: () => this.newQuireAt(ids, String(o.gatherings.at(-1).quire)) },
      here.size === 1 && here.has(-1) ? null : { text: "Set aside (out of the book)", kbd: "⌫", fn: () => this.setAside(ids) }];
  },
  sheetItems(ids) {
    const o = this.order(), gis = new Set(ids.map(id => this.locate(o, id).gi)), same = gis.size === 1, gi = [...gis][0], g = o.gatherings[gi];
    const nested = g?.type === "nested", one = ids.length === 1 ? ids[0] : null, n = ids.length;
    const sh = one && SHEETS.get(one), opts = one && g ? this.optsOf(one) : null, cols = sh ? sh.inside[0].length : 0;
    const row = sh && sh.inside[sh.proper_row ?? (sh.inside.length - 1)], spine = opts ? opts.spine ?? sh.spine : null;
    return [
      ...(same && g ? [
        { text: nested ? "Toward the centre" : "Later", kbd: "⌘]", fn: () => this.reorder(1) },
        { text: nested ? "Outward" : "Earlier", kbd: "⌘[", fn: () => this.reorder(-1) },
        { text: nested ? "To the centre" : "Last", kbd: "⌥⌘]", fn: () => this.reorder(1, true) },
        { text: nested ? "To the outside" : "First", kbd: "⌥⌘[", fn: () => this.reorder(-1, true) }, "-"] : []),
      { text: "Move to…", fn: () => this.menu(this.lastAnchor, this.moveToItems(ids)) },
      { text: n > 1 ? "New quire of these" : "New quire of it", kbd: "⌘G", fn: () => this.group() },
      same && gi < 0 ? null : { text: "Set aside", kbd: "⌫", fn: () => this.setAside(ids) },
      { text: "Cut", kbd: "⌘X", fn: () => this.cut() },
      this.clip?.length && !this.clip.some(x => ids.includes(x)) ? { text: `Paste ${this.clip.length === 1 ? this.label(this.clip[0]) : `${this.clip.length} sheets`} after`, kbd: "⌘V", fn: () => this.paste() } : null,
      ...(opts ? ["-",
        { check: !!opts.inside_out, text: "Inside out", fn: () => this.setOpt(one, "inside_out", !opts.inside_out) },
        { check: !!opts.rot180, text: "Upside down", fn: () => this.setOpt(one, "rot180", !opts.rot180) },
        ...(cols > 2 ? [{ label: "Sewn at the fold between" }, ...Array.from({ length: cols - 1 }, (_, k) => k + 1).map(k => ({ check: spine === k, radio: true,
          text: `${short(pageName(row[k - 1]))} and ${short(pageName(row[k]))}${k === sh.spine ? " (as bound)" : ""}`,
          fn: () => this.setOpt(one, "spine", k === sh.spine ? null : k) }))] : [])] : []),
      ...(ids.some(id => this.ch?.sheets.has(id)) ? ["-", { text: `Put back as in “${this.source(o).title}”`, fn: () => this.putBackMany(ids) }] : []),
      "-", { text: "Select the whole quire", kbd: "⇧↵", fn: () => this.key({ key: "Enter", shiftKey: true, code: "Enter" }) }];
  },
  quireItems(keys) {
    const o = this.order(), one = keys.length === 1, gi = this.gIndex(o, keys[0]), g = o.gatherings[gi];
    const hid = View3D.mod?.hiddenQuires() || new Set();
    return [
      one ? { text: "Rename", kbd: "double-click", fn: () => this.renameInline(keys[0]) } : null,
      one ? { label: "Its sheets are" } : null,
      one ? { check: g.type !== "singulions", radio: true, text: "Tucked inside each other", fn: () => this.setType(gi, "nested") } : null,
      one ? { check: g.type === "singulions", radio: true, text: "Separate, read one by one", fn: () => this.setType(gi, "singulions") } : null,
      "-",
      one ? { text: "Merge with the next quire", disabled: gi === o.gatherings.length - 1, fn: () => this.merge([keys[0], String(o.gatherings[gi + 1].quire)]) }
        : { text: "Merge into one quire", kbd: "⌘G", fn: () => this.merge(keys) },
      { text: "Split into single sheets", kbd: "⇧⌘G", disabled: keys.every(k => o.gatherings[this.gIndex(o, k)].bifolia.length < 2), fn: () => this.split(keys) },
      one ? { text: "Move earlier", kbd: "⌘[", disabled: gi === 0, fn: () => this.moveGathering(gi, -1) } : null,
      one ? { text: "Move later", kbd: "⌘]", disabled: gi === o.gatherings.length - 1, fn: () => this.moveGathering(gi, 1) } : null,
      "-",
      { text: "Hide in 3D", fn: () => { for (const k of keys) View3D.mod?.setHidden(k, true); this.setSel([]); } },
      { text: "Set its sheets aside", kbd: "⌫", fn: () => this.setAside(keys.flatMap(k => o.gatherings[this.gIndex(o, k)].bifolia)) },
      { text: "Select its sheets", kbd: "↵", fn: () => this.key({ key: "Enter", code: "Enter" }) }];
  },
  emptyItems() {
    const hidden = View3D.mod?.hiddenQuires().size || 0, lostOff = !!View3D.mod?.hideLost;
    return [
      { text: "Select all", kbd: "⌘A", fn: () => this.setSel(this.onTable()) },
      this.clip?.length ? { text: `Paste ${this.clip.length === 1 ? this.label(this.clip[0]) : `${this.clip.length} sheets`} as a new quire`, kbd: "⌘V", fn: () => this.paste() } : null,
      "-",
      hidden ? { text: `Show every quire (${hidden} hidden)`, fn: () => View3D.mod.showAllQuires() } : null,
      { check: lostOff, text: "Hide lost sheets", kbd: "L", fn: () => View3D.mod?.setHideLost(!lostOff) },
      { text: "Zoom to fit", kbd: "⇧1", fn: () => View3D.mod?.frameTable() },
      "-", { text: "Keyboard shortcuts", fn: () => this.shortcuts(this.lastAnchor) }];
  },
  /* the right-click menu on the table: for the sheet under the pointer (selected first, unless it already is), or for
     the table itself */
  context(x, y, id) {
    if (id && !this.selected.has(id)) this.setSel([id], { main: id });
    this.menu({ x, y }, id ? this.sheetItems(this.inOrder([...this.selected])) : this.emptyItems());
  },
  shortcuts(anchor) {
    const rows = [["Select, add to the selection", "click, ⇧-click"], ["Select a box of sheets", "drag the table"], ["Pan · zoom", "scroll, Space-drag · pinch, ⌘-scroll"],
      ["Move", "drag onto a pile"], ["New quire there", "drag between piles"], ["New quire of the selection · merge quires", "⌘G"], ["Split a quire into single sheets", "⇧⌘G"],
      ["Toward the centre · outward", "⌘] · ⌘["], ["All the way", "⌥⌘] · ⌥⌘["], ["Set aside", "⌫"], ["Cut · paste", "⌘X · ⌘V"], ["Select all", "⌘A"],
      ["Next · previous sheet", "Tab · ⇧Tab, ← →"], ["Up · down the pile", "↑ ↓"], ["The quire · its sheets", "⇧↵ · ↵"], ["Rename a quire", "double-click its name"],
      ["Zoom to fit · to the selection", "⇧1 · ⇧2"], ["Undo · redo", "⌘Z · ⇧⌘Z"], ["Deselect · done", "Esc"]];
    this.menu(anchor || { x: innerWidth - 20, y: 60 }, [{ label: "Keyboard shortcuts" }, ...rows.map(([text, kbd]) => ({ text, kbd, row: true }))]);
  },

  /* A quire's name under its pile: click selects the quire (⇧ or ⌘ adds), double-click renames it, drag moves it, a
     right-click opens its menu. The set-aside pile's name selects its sheets. */
  pileLabel(p) {
    const o = this.order(), aside = p.key === "aside", g = o.gatherings[this.gIndex(o, p.key)];
    if (!aside && !g) return h("span", { class: "v3-pile gone", "data-key": p.key, hidden: true });   // a quire just merged away
    const ids = aside ? this.aside(o) : g?.bifolia || [];
    const secs = [...new Set(ids.map(sectionOf).filter(Boolean))], lost = ids.filter(lostSheet).length, n = ids.length, d = this.describe(ids, aside);
    const tip = aside ? `Set aside: ${n ? `${n} sheet${n === 1 ? "" : "s"} out of the book` : "drop sheets here to take them out of the book"}`
      : `${qWord(g.quire)} · ${secs.map(x => SECTION_NAME[x] || x).join(", ") || "lost"} · ${n} sheet${n === 1 ? "" : "s"}${lost ? `, ${lost} lost` : ""} · ${g.type === "singulions" ? "read one by one" : "tucked inside each other"}${d.range ? ` · leaves ${d.range}` : ""}`;
    const sel = !aside && this.selQ.has(p.key);
    // the element outlives this quire's place in the order (view3d.js keeps it), so the handlers read its place from it
    return h("button", { class: `v3-pile${aside ? " aside" : ""}${sel ? " sel" : ""}`, "data-key": p.key, "data-gi": p.gi, title: tip, "aria-pressed": String(sel),
      onpointerdown: aside ? null : e => this.dragPile(e, +e.currentTarget.dataset.gi),
      onclick: e => this.clickQuire(e, e.currentTarget.dataset.key),
      oncontextmenu: aside ? null : e => { e.preventDefault(); const k = e.currentTarget.dataset.key; if (!this.selQ.has(k)) this.setSel([], { quires: [k] }); this.menu({ x: e.clientX, y: e.clientY }, this.quireItems(this.quiresInOrder([...this.selQ]))); } },
      h("b", {}, aside ? "Set aside" : qTag(g.quire)),
      h("span", { class: "pl-ics" }, (aside ? ["aside"] : secs.length ? secs : ["lost"]).map(x => icon(x, 14))),
      h("span", { class: "pl-n" }, aside && !n ? "drop here" : lost && lost === n ? `${n} lost` : `${n}${lost ? ` · ${lost} lost` : ""}`),
      this.ch?.booklets.has(p.key) ? h("span", { class: "ar-dot", title: "Changed in your order" }) : "");
  },
  /* Rename a quire in place: its name becomes a field (Enter keeps it, Esc gives up). */
  renameInline(key) {
    const el = $(`.v3-pile[data-key="${CSS.escape(String(key))}"]`), b = el?.querySelector("b");
    if (!b) { const gi = this.gIndex(this.order(), key); if (gi >= 0) this.renameGathering(gi); return; }   // not on the table (hidden): ask
    const was = b.textContent;
    const input = h("input", { class: "pl-name", value: String(this.order().gatherings[this.gIndex(this.order(), key)]?.quire ?? key), "aria-label": "Name of the quire", size: 8 });
    let gone = false;
    const finish = keep => {
      if (gone) return; gone = true;
      const t = input.value.trim(), o = this.order(), gi = this.gIndex(o, key);
      if (keep && t && t !== String(key) && gi >= 0) {
        if (o.gatherings.some((g, j) => j !== gi && String(g.quire) === t)) { toast(`There is already a quire called ${t}`); gone = false; input.select(); return; }
        input.replaceWith(h("b", {}, t));
        this.edit(oo => { oo.gatherings[this.gIndex(oo, key)].quire = /^\d+$/.test(t) ? +t : t; }, { ms: 300, renamed: [String(key), t] });
        this.setSel([], { quires: [t] });
      } else input.replaceWith(h("b", {}, was));
    };
    input.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("pointerdown", e => e.stopPropagation());
    input.addEventListener("click", e => e.stopPropagation());
    b.replaceWith(input);
    input.focus(); input.select();
  },
  /* A quire by its name: a gold bar shows where it will go among the others, in reading order. */
  dragPile(e, gi) {
    if (e.button !== 0 || e.target.closest("input")) return;
    const lbl = e.currentTarget, host = lbl.parentElement;
    let to = null;
    const others = () => $$(".v3-pile:not(.aside)", host).filter(x => x !== lbl);
    this.gesture(e, lbl, {
      start: () => { this.closeMenu(); lbl.classList.add("dragging"); },
      move: ev => {
        for (const x of $$(".ins-before, .ins-after", host)) x.classList.remove("ins-before", "ins-after");
        let best = null, bd = Infinity;
        for (const x of others()) { const r = x.getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - ev.clientX, r.top + r.height / 2 - ev.clientY); if (d < bd) { bd = d; best = x; } }
        if (!best) return;
        const r = best.getBoundingClientRect(), after = ev.clientX > r.left + r.width / 2, j = +best.dataset.gi;
        best.classList.add(after ? "ins-after" : "ins-before");
        to = after ? j + 1 : j;
      },
      end: ev => {
        lbl.classList.remove("dragging");
        for (const x of $$(".ins-before, .ins-after", host)) x.classList.remove("ins-before", "ins-after");
        if (ev && to != null) this.moveGatheringTo(gi, to);
      },
    });
  },

  // ---------------------------------------------------------------- menus
  /* A menu by a button (opening upward, the dock being at the foot) or at a point (a right-click). Items: { text, fn,
     kbd, note, check, disabled, danger }, { label }, { row } (a line of the shortcuts list) or "-". */
  menu(anchor, items) {
    const btn = anchor instanceof Element ? anchor : null;
    const again = btn && this.menuBtn === btn;
    this.closeMenu();
    if (again) return;
    this.lastAnchor = anchor;
    items = items.flat().filter(Boolean).filter((it, i, a) => it !== "-" || (i > 0 && a[i - 1] !== "-" && i < a.length - 1));   // no stray rules
    const m = h("div", { class: "ar-menu", role: "menu" }, items.map(it =>
      it === "-" ? h("hr") : it.label ? h("div", { class: "ar-ml" }, it.label)
        : it.row ? h("div", { class: "ar-row" }, h("span", {}, it.text), h("kbd", {}, it.kbd))
        : h("button", { role: it.check == null ? "menuitem" : it.radio ? "menuitemradio" : "menuitemcheckbox", "aria-checked": it.check != null ? String(it.check) : null,
            class: it.danger ? "danger" : "", disabled: it.disabled, onclick: () => { this.closeMenu(); it.fn(); } },
            it.check != null ? h("span", { class: "ar-chk" }, it.check ? "✓" : "") : "", h("span", { class: "ar-mt" }, it.text, it.note ? h("small", {}, it.note) : ""),
            it.kbd ? h("kbd", {}, it.kbd) : "")));
    document.body.append(m);
    const r = m.getBoundingClientRect(), H2 = innerHeight, W2 = innerWidth;
    let top, left;
    if (btn) {
      const b = btn.getBoundingClientRect();
      top = b.top - r.height - 6 >= 8 ? b.top - r.height - 6 : Math.min(H2 - r.height - 8, b.bottom + 6);
      left = Math.min(W2 - r.width - 8, Math.max(8, b.right - r.width));
    } else {
      top = anchor.y + r.height + 8 < H2 ? anchor.y : Math.max(8, anchor.y - r.height);
      left = anchor.x + r.width + 8 < W2 ? anchor.x : Math.max(8, anchor.x - r.width);
    }
    Object.assign(m.style, { top: top + "px", left: left + "px" });
    const away = e => { if (!m.contains(e.target) && !(btn && btn.contains(e.target))) this.closeMenu(); };
    const keys = e => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); this.closeMenu(); btn?.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const bs = $$("button:not([disabled])", m), i = bs.indexOf(document.activeElement);
        bs[(i + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length]?.focus(); e.preventDefault(); e.stopPropagation();
      }
    };
    addEventListener("pointerdown", away, true); addEventListener("keydown", keys, true);
    this.menuEl = m; this.menuBtn = btn;
    this.menuOff = () => { removeEventListener("pointerdown", away, true); removeEventListener("keydown", keys, true); };
    $("button:not([disabled])", m)?.focus();
  },
  closeMenu() { this.menuEl?.remove(); this.menuOff?.(); this.menuEl = this.menuBtn = this.menuOff = null; },

  // ---------------------------------------------------------------- drag and drop
  /* After a drag, the click that follows the pointer going up is not a click. */
  quietClick() { this.noClick = true; setTimeout(() => { this.noClick = false; }, 0); },
  /* When a drag starts: with a mouse or pen once the pointer has moved a few pixels; with a finger after it has rested a
     moment on the page or card (it lifts), so that a swipe still scrolls the shelf or the pages. Calls start(ev) once,
     then move(ev) for every move; end(ev) on release, with ev null when cancelled. */
  gesture(e, el, { start, move, end }) {
    const touch = e.pointerType === "touch", x0 = e.clientX, y0 = e.clientY;
    if (!touch) e.preventDefault();   // no text selection, which the browser would then drag itself
    let on = false, ready = !touch, gone = false;
    const hold = touch && setTimeout(() => { ready = true; this.dragging = true; el.classList.add("lifted"); navigator.vibrate?.(8); }, 320);
    // a lifted finger doesn't scroll: touch events stay with the element first touched, even once a redrawn strip has
    // taken it out of the page, so it is the one that has to say no
    const still = ev => { if (this.dragging) ev.preventDefault(); };
    el.addEventListener("touchmove", still, { passive: false });
    const stop = () => { gone = true; clearTimeout(hold); el.classList.remove("lifted"); el.removeEventListener("touchmove", still);
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", cancel); };
    const mv = ev => {
      if (gone) return;
      const d = Math.hypot(ev.clientX - x0, ev.clientY - y0);
      if (!on) {
        if (!ready) { if (touch && d > 8) stop(); return; }   // a finger that moves at once is scrolling
        if (!touch && d < 5) return;
        on = true; this.dragging = true; el.classList.remove("lifted"); start(ev);
      }
      move(ev);
    };
    const up = ev => { const was = on; stop(); if (was) { this.dragging = false; this.quietClick(); end(ev); } else if (ready && touch) { this.dragging = false; } };
    const cancel = () => { const was = on; stop(); this.dragging = false; if (was) end(null); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", cancel);
  },

  /* A quire's tab: the others make way as it passes them, and it lands where it is let go. */
  dragTab(e, gi) {
    if (e.button !== 0) return;
    const tab = e.currentTarget, bar = tab.parentElement;
    const tabs = () => $$(".ar-tab:not([data-key='aside'])", bar);
    this.gesture(e, tab, {
      start: () => { this.closeMenu(); tab.classList.add("dragging"); },
      move: ev => {
        const r = bar.getBoundingClientRect();   // near an end of the row: scroll it
        bar.scrollLeft += ev.clientX < r.left + 24 ? -10 : ev.clientX > r.right - 24 ? 10 : 0;
        tab.style.pointerEvents = "none";
        const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".ar-tab:not([data-key='aside'])");
        tab.style.pointerEvents = "";
        if (!hit || hit === tab || !bar.contains(hit)) return;
        const list = tabs(), i = list.indexOf(hit), j = list.indexOf(tab);
        slide(bar, ".ar-tab", () => (j < i ? hit.after(tab) : hit.before(tab)));
      },
      end: ev => {
        const to = tabs().indexOf(tab);
        if (ev && to !== gi) this.moveGatheringTo(gi, to > gi ? to + 1 : to); else this.render();
      },
    });
  },

  /* A sheet: up or down the pile (along the row, for sheets read one by one), the others making room; or onto a tab, to
     move it into that quire. */
  dragLayer(e, id) {
    if (e.button !== 0) return;
    const el = this.el(), grip = e.currentTarget, o = this.order(), b = this.booklet(o), from = b.ids.indexOf(id);
    const nested = !!$(".ar-stack", el);
    let k = from, drop = null;
    const show = list => {   // the order the sheets would have: the pile restacks (its sheets glide), the labels follow
      if (nested) {
        for (const l of $$(".ar-layer", el)) l.style.setProperty("--z", list.indexOf(l.dataset.id));
        this.place();
      } else {
        const row = $(".ar-row", el);
        slide(row, ".ar-one", () => list.forEach(x => row.append($(`.ar-one[data-id="${CSS.escape(x)}"]`, row))));
      }
    };
    this.gesture(e, grip, {
      start: () => {
        this.closeMenu(); this.hover(null);
        $(".ar-stack", el)?.classList.add("moving");
        if (this.sel !== id) { this.sel = id; View3D.mod?.focusSheet(id); }
        for (const x of $$(`.ar-layer[data-id="${CSS.escape(id)}"], .ar-lbl[data-id="${CSS.escape(id)}"]`, el)) x.classList.add("sel", "dragging");
      },
      move: ev => {
        const tab = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".ar-tab");
        $$(".ar-tab.drop", el).forEach(t => t.classList.remove("drop"));
        if (tab && el.contains(tab) && tab.dataset.key !== b.key) {
          tab.classList.add("drop"); drop = +tab.dataset.gi;
          if (k !== from) { k = from; show(b.ids); }
          return;
        }
        drop = null;
        if (!b.g) return;   // set aside: only out, onto a tab
        // the place nearest the pointer: the labels stand at the places in the pile, lowest (outermost) first; along
        // the row, the sheets do, first on the left
        const spots = (nested ? $$(".ar-lbl", el) : $$(".ar-one", el)).map(t => { const r = t.getBoundingClientRect(); return nested ? r.top + r.height / 2 : r.left + r.width / 2; });
        spots.sort((p, q) => nested ? q - p : p - q);
        const at = spots.reduce((best, x, j) => Math.abs(x - (nested ? ev.clientY : ev.clientX)) < Math.abs(spots[best] - (nested ? ev.clientY : ev.clientX)) ? j : best, 0);
        if (at !== k) { k = at; const list = b.ids.filter(x => x !== id); list.splice(k, 0, id); show(list); }
      },
      end: ev => {
        if (ev && drop != null) this.moveInto(id, drop);
        else if (ev && k !== from) this.move(id, b.gi, k > from ? k + 1 : k);
        else this.render();
      },
    });
  },
};

/* A window made narrower or wider than a phone's while Rearrange is open (a tablet turned, a window resized): it opens
   again the way that width has it, the table or the panel under the book. */
matchMedia("(max-width: 760px)").addEventListener("change", e => {
  if (Arrange.on && Arrange.table === e.matches) { Arrange.close(); Arrange.open(); }
});

/* The list: Rearrange as it was before the table, every quire and its sheets in a column beside the table. A second
   view of the same order: a change made in either shows in both at once (each goes through Arrange's edits, which the
   3D table animates), and so does the selection. Opened from the table's bar; it remembers whether it was open. */
const EYE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const LIST_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M17 8.5h1.5M17 12h1.5M17 15.5h1.5"/></svg>';

const ArrangeList = {
  open: store.get("arrange:list", false),
  optsFor: null,      // the sheet whose options are open
  el: () => $("#v3-list"),
  toggle(on = !this.open) {
    this.open = on; store.set("arrange:list", on);
    this.render();
    Arrange.render();   // the button in the bar
  },

  render() {
    const el = this.el();
    if (!el) return;
    const show = Arrange.on && Arrange.table && this.open && !!Arrange.order(), hud = $("#v3-hud");
    if (el.hidden === show) el.hidden = !show;
    document.body.classList.toggle("list-open", show);
    if (!show) {   // the panel goes back to its corner of the table
      if (hud && !$("#v3-stage")?.contains(hud)) $("#v3-stage")?.append(hud);
      if (el.childElementCount) el.replaceChildren();
      return;
    }
    const o = Arrange.order(), top = el.scrollTop, hidden = View3D.mod?.hiddenQuires().size || 0;
    // the panel that shows what is under the pointer sits over the top of the list, so the table has all its width
    const slot = h("div", { class: "al-hudslot" });
    if (hud) slot.append(hud);
    el.replaceChildren(slot,
      h("div", { class: "al-head" }, h("b", {}, "Quires"),
        h("button", { class: "al-close", title: "Close the list", "aria-label": "Close the list", onclick: () => this.toggle(false) }, "✕")),
      h("p", { class: "al-hint" }, "Drag a sheet or a whole quire by ", h("span", { class: "al-grip-demo" }, "⠿"), " to move it, or click a sheet for more. The eye hides a quire in 3D, like a layer. The table follows."),
      hidden ? h("div", { class: "al-hidden" }, `${hidden} hidden in 3D`, h("button", { onclick: () => View3D.mod.showAllQuires() }, "Show all")) : "",
      ...o.gatherings.map((g, gi) => this.gatheringEl(o, g, gi)),
      this.asideEl(o));
    el.scrollTop = top;
    this.mark();
  },
  /* the selection on the table, in the list (scroll: bring the main sheet into view) */
  mark(scroll = false) {
    const el = this.el();
    if (!el || el.hidden) return;
    for (const r of el.querySelectorAll(".al-row")) {
      const on = Arrange.selected.has(r.dataset.id);
      r.classList.toggle("sel", on); r.classList.toggle("cur", on && r.dataset.id === Arrange.sel);
    }
    for (const g of el.querySelectorAll(".al-g[data-key]")) g.classList.toggle("sel", Arrange.selQ.has(g.dataset.key));
    if (scroll && Arrange.sel) el.querySelector(`.al-row[data-id="${CSS.escape(Arrange.sel)}"]`)?.scrollIntoView({ block: "nearest" });
  },

  gatheringEl(o, g, gi) {
    const sing = g.type === "singulions", key = String(g.quire), hid = !!View3D.mod?.hiddenQuires().has(key);
    return h("section", { class: `al-g${sing ? " sing" : ""}${hid ? " hid" : ""}`, "data-gi": gi, "data-key": key },
      h("div", { class: "al-gh" },
        h("span", { class: "al-grip", title: "Drag to move this whole quire", "aria-hidden": "true", onpointerdown: e => this.dragGathering(e, gi) }, "⠿"),
        h("button", { class: `al-eye${hid ? " off" : ""}`, "aria-pressed": String(hid),
          title: hid ? "Hidden in 3D: click to show it" : "Hide this quire in 3D, like a layer (the order does not change)",
          "aria-label": hid ? `Show ${qWord(g.quire)} in 3D` : `Hide ${qWord(g.quire)} in 3D`,
          onclick: () => View3D.mod?.setHidden(g.quire, !hid) }, svgEl(hid ? EYE_OFF : EYE)),
        h("button", { class: "linkish al-gname", title: "Select this quire on the table; double-click to rename it",
          onclick: e => Arrange.clickQuire(e, key) }, qWord(g.quire)),
        h("span", { class: "al-seg", role: "group", "aria-label": "How this quire is put together" },
          h("button", { class: sing ? "" : "on", title: "A quire: the sheets are tucked inside each other and sewn through the middle", onclick: () => sing && Arrange.setType(gi, "nested") }, "Quire"),
          h("button", { class: sing ? "on" : "", title: "Separate sheets (singulions): each sheet is read on its own, front to back", onclick: () => !sing && Arrange.setType(gi, "singulions") }, "Separate")),
        h("button", { class: "al-mini", title: "Move this quire earlier", "aria-label": "Move quire up", disabled: gi === 0, onclick: () => Arrange.moveGathering(gi, -1) }, "↑"),
        h("button", { class: "al-mini", title: "Move this quire later", "aria-label": "Move quire down", disabled: gi === o.gatherings.length - 1, onclick: () => Arrange.moveGathering(gi, 1) }, "↓")),
      h("div", { class: "al-rows", "data-gi": gi }, g.bifolia.map((id, i) => this.rowEl(o, id, gi, i, (g.sheets || {})[id] || {}))),
      sing ? "" : h("div", { class: "al-note" }, "First sheet = outermost."));
  },

  asideEl(o) {
    const ids = Arrange.aside(o);
    return h("section", { class: "al-g al-aside", "data-gi": -1 },
      h("div", { class: "al-gh" }, h("b", {}, "Set aside"), h("span", { class: "muted" }, " not in the book")),
      h("div", { class: "al-rows", "data-gi": -1 }, ids.length ? ids.map((id, i) => this.rowEl(o, id, -1, i, {}))
        : h("div", { class: "al-empty" }, "Drop a sheet here to take it out of the book.")));
  },

  rowEl(o, id, gi, i, opts) {
    const sh = SHEETS.get(id), lost = sh.missing.every(Boolean);
    const first = sidesOf(sh, opts)[0].shown;
    const v = varsOf([...sh.inside.flat(), ...sh.outside.flat()]);
    const tags = [opts.inside_out ? "inside out" : "", opts.rot180 ? "upside down" : "", opts.spine != null && opts.spine !== sh.spine ? "other fold" : ""].filter(Boolean);
    const open = this.optsFor === id;
    const row = h("div", { class: `al-row${open ? " open" : ""}${lost ? " lost" : ""}`, "data-id": id, "data-gi": gi, "data-i": i },
      h("span", { class: "al-grip", title: "Drag to move", "aria-hidden": "true", onpointerdown: e => this.dragStart(e, id) }, "⠿"),
      h("button", { class: "al-main", title: "Select it on the table (⇧ or ⌘: add it); click again for its options",
        onclick: e => this.clickRow(e, id) },
        lost || first.missing ? h("span", { class: "al-thumb ghost" }) : h("img", { class: "al-thumb", src: imgUrl(first.img, "s", first.v), alt: "", loading: "lazy" }),
        h("span", { class: "al-id" }, id),
        h("span", { class: "al-sub" }, lost ? "lost" : [v.is[0] || "", v.hs.map(n => `S${n}`).join("+")].filter(Boolean).join(" · "),
          tags.length ? h("span", { class: "al-tag" }, tags.join(", ")) : "")),
      h("span", { class: "al-btns" },
        h("button", { class: "al-mini", title: "Move up", "aria-label": `Move ${id} up`, onclick: () => this.step(id, gi, i, -1) }, "↑"),
        h("button", { class: "al-mini", title: "Move down", "aria-label": `Move ${id} down`, onclick: () => this.step(id, gi, i, 1) }, "↓")));
    if (!open) return row;
    return h("div", { class: "al-wrap" }, row, this.optionsEl(o, id, gi, opts));
  },
  /* A click on a sheet: selects it on the table (⇧, ⌘ or Ctrl: adds it, or takes it out); a second click on the selected
     sheet opens its options (and a third closes them). */
  clickRow(e, id) {
    if (e.shiftKey || e.metaKey || e.ctrlKey) { this.optsFor = null; return Arrange.click(id, e); }
    const again = Arrange.selected.size === 1 && Arrange.selected.has(id);
    this.optsFor = again && this.optsFor !== id ? id : null;
    if (!again) Arrange.setSel([id], { main: id });
    this.render();
    if (this.optsFor) this.el()?.querySelector(".al-wrap")?.scrollIntoView({ block: "nearest" });   // its options, in view
  },
  /* one place up or down the list (at the end of a quire, into the next one), and the moved sheet selected */
  step(id, gi, i, d) {
    if (gi < 0) Arrange.move(id, -1, d < 0 ? Math.max(0, i - 1) : i + 2); else Arrange.step(id, d);
    Arrange.setSel([id], { main: id });
  },

  optionsEl(o, id, gi, opts) {
    const sh = SHEETS.get(id), n = sh.inside[0].length;
    const to = h("select", { "aria-label": "Move this sheet to", onchange: e => {
      const v = e.target.value;
      if (v === "new") Arrange.newGathering(id);
      else if (v === "aside") Arrange.move(id, -1, Arrange.aside(o).length);
      else if (v !== "") { const j = +v; Arrange.move(id, j, o.gatherings[j].bifolia.length); }
      Arrange.setSel([id], { main: id });
    } },
      h("option", { value: "" }, "Move to…"),
      ...o.gatherings.map((g, j) => j === gi ? "" : h("option", { value: j }, `the end of ${qWord(g.quire)}`)),
      h("option", { value: "new" }, "a new quire of its own"),
      gi < 0 ? "" : h("option", { value: "aside" }, "set it aside (out of the book)"));
    const row = sh.inside[sh.proper_row ?? (sh.inside.length - 1)];
    const folds = n > 2 ? h("label", { class: "al-opt" }, "Sewn at ",
      h("select", { onchange: e => Arrange.setOpt(id, "spine", +e.target.value === sh.spine ? null : +e.target.value) },
        Array.from({ length: n - 1 }, (_, k) => k + 1).map(k => h("option", { value: k, selected: (opts.spine ?? sh.spine) === k },
          `the fold between ${short(pageName(row[k - 1]))} and ${short(pageName(row[k]))}${k === sh.spine ? " (as bound)" : ""}`)))) : "";
    const segs = [...sh.inside.flat(), ...sh.outside.flat()].filter(s => s.img && !s.missing);
    return h("div", { class: "al-opts" },
      to,
      gi < 0 ? "" : h("label", { class: "al-opt", title: "Fold the sheet the other way, so its outside pages face each other in the middle" },
        h("input", { type: "checkbox", checked: !!opts.inside_out, onchange: e => Arrange.setOpt(id, "inside_out", e.target.checked) }), " Inside out"),
      gi < 0 ? "" : h("label", { class: "al-opt", title: "Turn the sheet round, so its first leaf becomes its last" },
        h("input", { type: "checkbox", checked: !!opts.rot180, onchange: e => Arrange.setOpt(id, "rot180", e.target.checked) }), " Upside down"),
      gi < 0 ? "" : folds,
      segs.length ? h("div", { class: "al-crop" }, "✂ Crop: ", segs.map(s => h("button", { class: "linkish", onclick: () => CropEditor.open(s.img) }, short(pageName(s))))) : "");
  },

  // ---------------------------------------------------------------- drag and drop (as it always was)
  /* A whole quire, by the handle in its header: drop it between two others. */
  dragGathering(e, gi) {
    if (e.button !== 0) return;
    e.preventDefault();
    const panel = this.el(), card = e.target.closest(".al-g"), head = card.querySelector(".al-gh");
    const r = head.getBoundingClientRect(), dy = e.clientY - r.top;
    const ghost = head.cloneNode(true);
    ghost.classList.add("al-ghost", "al-gghost");
    Object.assign(ghost.style, { width: r.width + "px", left: r.left + "px", top: r.top + "px" });
    document.body.append(ghost);
    card.classList.add("dragging");
    const bar = h("div", { class: "al-drop al-gdrop" });
    let to = null, scrollT = null;
    const cards = () => [...panel.querySelectorAll(".al-g:not(.al-aside)")];
    const move = ev => {
      ghost.style.top = (ev.clientY - dy) + "px";
      const list = cards();
      to = list.length;
      for (const c of list) { const b = c.getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { to = +c.dataset.gi; break; } }
      bar.remove();
      if (to < list.length) list.find(c => +c.dataset.gi === to).before(bar); else list[list.length - 1].after(bar);
      const pr = panel.getBoundingClientRect();
      clearInterval(scrollT);
      const edge = ev.clientY < pr.top + 40 ? -1 : ev.clientY > pr.bottom - 40 ? 1 : 0;
      if (edge) scrollT = setInterval(() => { panel.scrollTop += edge * 16; }, 30);
    };
    const end = ev => {
      clearInterval(scrollT);
      removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", cancel);
      ghost.remove(); bar.remove(); card.classList.remove("dragging");
      if (to != null && ev) Arrange.moveGatheringTo(gi, to);
    };
    const cancel = () => { to = null; end(null); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", cancel);
  },

  /* A sheet, by its handle: drop it between two sheets, or anywhere in a quire (its end), or in Set aside. */
  dragStart(e, id) {
    if (e.button !== 0) return;
    e.preventDefault();
    const row = e.target.closest(".al-row"), panel = this.el();
    const r = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add("al-ghost");
    Object.assign(ghost.style, { width: r.width + "px", left: r.left + "px", top: r.top + "px" });
    document.body.append(ghost);
    row.classList.add("dragging");
    const bar = h("div", { class: "al-drop" });
    let target = null, scrollT = null;
    const dy = e.clientY - r.top;
    const where = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      const rowEl = hit?.closest?.(".al-row");
      if (rowEl && panel.contains(rowEl) && rowEl !== row) {
        const b = rowEl.getBoundingClientRect(), after = y > b.top + b.height / 2;
        return { gi: +rowEl.dataset.gi, i: +rowEl.dataset.i + (after ? 1 : 0), anchor: rowEl.closest(".al-wrap") || rowEl, after };
      }
      const box = hit?.closest?.(".al-g");
      if (box && panel.contains(box)) return { gi: +box.dataset.gi, anchor: box.querySelector(".al-rows"), end: true };   // anywhere else in a quire: its end
      return null;
    };
    const move = ev => {
      ghost.style.top = (ev.clientY - dy) + "px";
      ghost.style.display = "none";
      target = where(ev.clientX, ev.clientY);
      ghost.style.display = "";
      bar.remove();
      if (target) {
        if (target.end) target.anchor.append(bar);
        else target.after ? target.anchor.after(bar) : target.anchor.before(bar);
      }
      const pr = panel.getBoundingClientRect();   // scroll the panel when the pointer nears its top or bottom
      clearInterval(scrollT);
      const edge = ev.clientY < pr.top + 40 ? -1 : ev.clientY > pr.bottom - 40 ? 1 : 0;
      if (edge) scrollT = setInterval(() => { panel.scrollTop += edge * 14; }, 30);
    };
    const end = () => {
      clearInterval(scrollT);
      removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", cancel);
      ghost.remove(); bar.remove(); row.classList.remove("dragging");
      if (target) {
        const o = Arrange.order(), len = target.gi < 0 ? Arrange.aside(o).length : o.gatherings[target.gi].bifolia.length;
        Arrange.move(id, target.gi, target.end ? len : target.i);
        Arrange.setSel([id], { main: id });
      }
    };
    const cancel = () => { target = null; end(); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", cancel);
  },
};
