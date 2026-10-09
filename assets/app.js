/* Voynich Viewer: read Beinecke MS 408 page by page, see it as a book in 3D, compare collations.
   Plain JS, no build step. Data: data/codex.json (sheets, panels and page facts, refreshed by tools/import_from_scout.py)
   and data/orders.json (reading orders, sources and evidence notes, edited by hand). */
"use strict";

const ASSETS = new URL(".", document.currentScript.src).href;   // this file's folder: view3d.js lives next to it

// ---------------------------------------------------------------- helpers
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) if (sk.startsWith("--")) el.style.setProperty(sk, sv); else el.style[sk] = sv;
    }
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem("vv:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("vv:" + k, JSON.stringify(v)); } catch { /* private window */ } },
};
let toastTimer;
function toast(msg, action) {
  let t = $("#cx-toast");
  if (!t) { t = h("div", { id: "cx-toast", role: "status", "aria-live": "polite" }); document.body.append(t); }
  const top = [...document.querySelectorAll("dialog[open]")].pop();
  (top || document.body).append(t);   // inside an open modal, or it is hidden behind it
  t.innerHTML = "";
  t.append(h("span", {}, msg));
  if (action) t.append(h("button", { onclick: () => { t.classList.remove("show"); action.fn(); } }, action.label));
  t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), action ? 7000 : 3200);
}
/* An in-page replacement for prompt(), which some embedded browsers do not support. */
function modal({ title, body = "", input = null, ok = "OK", cancel = "Cancel", danger = false }) {
  return new Promise(resolve => {
    const field = input ? h("input", { type: "text", value: input.value || "", placeholder: input.placeholder || "",
      "aria-label": input.label || title }) : null;
    const done = v => { const t = $("#cx-toast", d); if (t) document.body.append(t); d.close(); d.remove(); resolve(v); };
    const okBtn = h("button", { class: danger ? "danger-solid" : "primary", onclick: () => done(field ? field.value.trim() : true) }, ok);
    const d = h("dialog", { class: "ask" },
      h("h3", {}, title),
      body ? h("p", {}, body) : "",
      input?.label ? h("label", {}, input.label) : "",
      field || "",
      h("div", { class: "ask-acts" }, h("button", { onclick: () => done(field ? null : false) }, cancel), okBtn));
    d.addEventListener("cancel", e => { e.preventDefault(); done(field ? null : false); });
    if (field) field.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); done(field.value.trim()); } });
    document.body.append(d);
    d.showModal();
    setTimeout(() => (field ? (field.focus(), field.select()) : okBtn.focus()), 20);
  });
}
const askText = (title, opts = {}) => modal({ title, input: { value: opts.value, placeholder: opts.placeholder, label: opts.label }, body: opts.body, ok: opts.ok || "OK" });
const askYes = (title, body, ok = "OK", danger = false) => modal({ title, body, ok, danger });
const CUSTOM_IMG = new Map();   // "f1r_l" -> object URL of your own crop of that page (work.js)
const imgUrl = (key, size, v) => CUSTOM_IMG.get(`${key}_${size}`) || `data/panels/${encodeURIComponent(key)}_${size}.jpg${v ? "?v=" + v : ""}`;
const SCRIBES = { 1: "Scribe 1", 2: "Scribe 2", 3: "Scribe 3", 4: "Scribe 4", 5: "Scribe 5" };
const LANG = { A: "Currier A", B: "Currier B" };
const SECTION = { H: "Herbal", A: "Astronomical", Z: "Zodiac", B: "Balneological", C: "Cosmological",
  P: "Pharmaceutical", S: "Stars", T: "Text" };

// ---------------------------------------------------------------- model
let D;                       // codex.json
const SHEETS = new Map();    // "77|82" -> sheet
let ORDERS = new Map();      // id -> resolved order
const APP_VERSION = "1.6";
const PAGE_SHEET = new Map();   // "f78v" -> "78|81", every page including lost ones
const RETIRED = { "davis-blog-2025": "davis" };   // orders taken out of the menu -> the order an old link now opens

const pageName = seg => seg.label || seg.page;
const short = p => String(p).replace(/^f/, "");
/* A gathering's name: "Q13" / "Quire 13", or the name an order gives a gathering that is not a numbered quire. */
const qTag = q => typeof q === "number" ? `Q${q}` : String(q);
const qWord = q => typeof q === "number" ? `Quire ${q}` : String(q);
const aspect = seg => (seg.w && seg.h) ? seg.w / seg.h : 0.7;

function resolveOrders() {
  ORDERS = new Map();
  const raw = new Map(D.orders.orders.map(o => [o.id, o]));
  const resolve = o => {
    if (!o.base) return { ...o, gatherings: o.gatherings.map(g => ({ ...g })) };
    const base = resolve(raw.get(o.base));
    const rep = new Map((o.replace || []).map(g => [g.quire, g]));
    return { ...base, ...o, gatherings: base.gatherings.map(g => rep.has(g.quire) ? { ...rep.get(g.quire) } : g) };
  };
  for (const o of raw.values()) ORDERS.set(o.id, resolve(o));
  for (const o of MyOrders.load()) ORDERS.set(o.id, o);   // your own orders, kept in this browser (work.js)
}

/* A sheet as it would be handled: optionally rotated 180° in the plane, folded inside-out, or sewn in a
   different fold. Returns the same shape as a sheet (inside/outside rows, spine, proper_row), with every
   segment carrying `rot` (degrees) for display. */
function handled(sheet, opts = {}) {
  const n = sheet.inside[0].length;
  const tag = (rows, rot) => rows.map(r => r.map(s => ({ ...s, rot: ((s.rot || 0) + rot) % 360 })));
  let v = {
    inside: tag(sheet.inside, 0), outside: tag(sheet.outside, 0),
    spine: sheet.spine, proper: sheet.proper_row ?? (sheet.inside.length - 1), id: sheet.id,
  };
  if (opts.spine != null) v.spine = opts.spine;
  if (opts.inside_out) v = { ...v, inside: v.outside, outside: v.inside, spine: n - v.spine };
  if (opts.rot180) {
    const flip = rows => tag(rows.slice().reverse().map(r => r.slice().reverse()), 180);
    v = { ...v, inside: flip(v.inside), outside: flip(v.outside), spine: n - v.spine, proper: v.inside.length - 1 - v.proper };
  }
  v.n = n;
  v.plain = !opts.spine && !opts.inside_out && !opts.rot180;
  return v;
}

/* The four page sides of a handled sheet folded at its spine, as read: left leaf front (a recto
   position), left leaf back, right leaf front, right leaf back. Each side lists its panels left to right
   as they lie when the leaf is opened out, which panel is the leaf proper (at the spine), and which
   panel shows when the leaf is folded up: the back of panel 2, as extra panels fold onto the inside of
   the sheet (voynich.nu infers this from where the folio numbers were written). Where Davis found other
   faces showing (quires 11, 15, 17, 19), 3D takes hers from data/folds.json. */
function sidesOf(sheet, opts = {}) {
  const v = handled(sheet, opts);
  const { n, spine: s, proper } = v;
  const rowIn = v.inside[proper], rowOut = v.outside[proper];
  const side = (face, row, cols, hinge, foldedOver) => {
    const segs = cols.map(c => row[c]);
    const properSeg = hinge === "left" ? segs[0] : segs[segs.length - 1];
    let shown = properSeg;
    if (foldedOver && segs.length > 1) {
      const p2 = hinge === "left" ? cols[1] : cols[cols.length - 2];
      shown = rowOut[n - 1 - p2];
    }
    return { sheet: sheet.id, face, cols, hinge, segs, shown, grid: sheet.inside.length > 1,
             lost: segs.every(x => x.missing), v };
  };
  const sides = [
    side("outside", rowOut, range(n - s, n), "left", false),   // left leaf, front
    side("inside", rowIn, range(0, s), "right", true),          // left leaf, back
    side("inside", rowIn, range(s, n), "left", true),           // right leaf, front
    side("outside", rowOut, range(0, n - s), "right", false),   // right leaf, back
  ];
  if (sheet.read && v.plain) {  // sheets whose folding is described explicitly (the Rosettes)
    const all = [...sheet.inside.flat(), ...sheet.outside.flat()];
    sheet.read.forEach((r, i) => {
      const seg = all.find(x => x.page === r.page);
      if (seg) sides[i].shown = { ...seg, rot: r.rot || 0 };
    });
  }
  return sides;
}

/* How a folded leaf stacks, given which way each fold goes (ways[j] for the fold before piece j: 1 in, -1 out; data/folds.json).
   Piece 0, the panel at the spine, lies face up; each next piece lies straight against the one it hangs from, on the
   side its fold goes, inside whatever already lay there, so a fold in under a panel that faces down tucks the next piece
   between it and the leaf. Returns each piece's layer (0 is the spine panel's, more is nearer the facing page) and
   whether its inside face looks that way. 3D and the drawings on the Info page both stack by it. */
function foldStack(ways) {
  const stack = [0], up = [1];
  for (let j = 1; j < ways.length; j++) {
    const i = stack.indexOf(j - 1);
    stack.splice(up[j - 1] * ways[j] > 0 ? i + 1 : i, 0, j);
    up.push(-up[j - 1]);
  }
  return { layer: up.map((_, j) => stack.indexOf(j) - stack.indexOf(0)), up: up.map(u => u > 0) };
}

/* Which way the fold between two neighbouring panels turns, seen from the face whose pictures are named (data/folds.json):
   1 toward you, -1 away. The record names the sheet's inside panels; from the outside face a fold that goes in turns away.
   A fold the record doesn't list goes in. */
function foldWay(sheetId, imgA, imgB) {
  const f = D.folds?.sheets?.[sheetId]?.folds || {}, sh = SHEETS.get(sheetId);
  const get = (a, b) => f[`${a}|${b}`] || f[`${b}|${a}`];
  const backOf = img => {   // the same panel's picture on the inside face
    for (const [r, row] of (sh?.outside || []).entries()) { const c = row.findIndex(x => x.img === img); if (c >= 0) return sh.inside[r][row.length - 1 - c].img; }
    return null;
  };
  const seenOut = (sh?.outside || []).flat().some(x => x.img === imgA || x.img === imgB);
  const w = seenOut ? get(backOf(imgA), backOf(imgB)) : get(imgA, imgB);
  return (w === "out" ? -1 : 1) * (seenOut ? -1 : 1);
}

/* What a foldout shows folded in the Reader: the panel at the spine of each face (r1 / v1), and nothing of the panels
   that fold in: they are inside the folds, and appear when it is unfolded. A sheet whose folded reading is given
   outright (the Rosettes) shows that. 3D keeps the roll-fold of sidesOf, where a flap lies over one face of its leaf. */
const spineShown = s => s.segs.length > 1 && !s.grid ? s.segs[s.hinge === "left" ? 0 : s.segs.length - 1] : s.shown;

/* The strip of stacked page edges that a foldout's hinge panel shows on the side its flaps hang (data/seams.json, from
   tools/seams.py): its picture is of the bound book, whose fore-edge is that strip, while the flaps were photographed
   opened out. Unfolded, the first flap overlaps the strip, so the sheet runs on without the edges of the book in the
   middle of it. { hinge, flap, band } with band a fraction of the hinge panel's width, or null for a page that has none,
   is re-cropped, or is turned (the strip is then on another side). */
function seamOf(p) {
  if (!p || p.lost || p.grid || p.segs.length < 2) return null;
  const last = p.segs.length - 1, left = p.hinge === "left";
  const hinge = p.segs[left ? 0 : last], flap = p.segs[left ? 1 : last - 1];
  const r = D.seams?.panels?.[hinge.img];
  if (!r || hinge.missing || flap.missing || hinge.custom || (hinge.rot || 0) % 360) return null;
  return r.side === (left ? "R" : "L") && hinge.quad && JSON.stringify(hinge.quad) === JSON.stringify(r.q) ? { hinge, flap, band: r.band } : null;
}
/* how many pixels the first flap overlaps the hinge panel by, at page height ph */
const seamPx = (p, ph) => { const m = seamOf(p); return m ? Math.round(Math.round(ph * aspect(m.hinge)) * m.band) : 0; };

/* Order -> flat list of page sides. `spine`: as the Reader shows them (see spineShown). */
function linearize(order, { ghosts = true, spine = false } = {}) {
  const pages = [];
  order.gatherings.forEach((g, gi) => {
    const placed = g.bifolia.map(id => {
      const sh = SHEETS.get(id);
      if (!sh) throw new Error(`order ${order.id}: no sheet ${id}`);
      return { sh, sides: sidesOf(sh, (g.sheets || {})[id] || {}) };
    });
    const push = (p, sides, k) => pages.push({ ...sides[k], ...(spine ? { shown: spineShown(sides[k]) } : {}), gi, quire: g.quire, type: g.type,
                                               bif: p.sh.id, leafNo: p.sh.leaves[k < 2 ? 0 : 1] });
    if (g.type === "singulions") {
      for (const p of placed) [0, 1, 2, 3].forEach(k => push(p, p.sides, k));
    } else {
      for (const p of placed) [0, 1].forEach(k => push(p, p.sides, k));
      for (const p of placed.slice().reverse()) [2, 3].forEach(k => push(p, p.sides, k));
    }
  });
  return ghosts ? pages : pages.filter(p => !p.lost);
}

/* lost sheets an order leaves out (listed per gathering or for the whole order) */
const unplacedOf = o => [...(o.unplaced || []), ...o.gatherings.flatMap(g => g.unplaced || [])];

const sideLabel = p => p ? (p.lost ? `[${p.shown.page}]` : pageName(p.shown)) : "";
const sideKey = p => p ? `${p.sheet}:${p.face}:${p.cols.join(",")}` : "";

/* Facing pairs (left|right) of an order, by panel name, for the reader's "new pair" tag. Lost leaves are left out, so
   two pages that face each other in today's book because the leaves between them are lost count as facing. */
function openings(order, spine = false) {
  const pages = linearize(order, { ghosts: false, spine });
  const set = new Set();
  for (let i = 1; i + 1 < pages.length; i += 2) set.add(sideLabel(pages[i]) + "|" + sideLabel(pages[i + 1]));
  return set;
}

function varsOf(segs) {
  const hs = new Set(), ls = new Set(), is = new Set();
  for (const s of segs) {
    if (!s) continue;
    for (const n of s.scribes || []) if (SCRIBES[n]) hs.add(n);
    if (s.vars && LANG[s.vars.L]) ls.add(s.vars.L);
    if (s.section) is.add(s.section);
  }
  return { hs: [...hs], ls: [...ls], is: [...is] };
}

// ---------------------------------------------------------------- segment element
function segEl(seg, height, { size = "l", labels = true, scribes = true, cls = "", crop = false, lazy = true } = {}) {
  const w = Math.round(height * (seg.missing ? 0.68 : aspect(seg)));
  if (seg.missing) {
    return h("div", { class: "seg ghost " + cls, style: { width: w + "px", height: height + "px" } },
      h("span", {}, `${short(seg.page).replace(/[rv]\d*$/, "")} lost`));
  }
  const rot = seg.rot || 0;
  const img = h("img", { src: imgUrl(seg.img, size, seg.v), alt: pageName(seg), draggable: "false", loading: lazy ? "lazy" : "eager",
    "data-key": seg.img, "data-v": seg.v || "", style: rot ? { transform: `rotate(${rot}deg)` } : null });
  Sharp.seg.set(img, seg);
  const el = h("div", { class: "seg " + cls, style: { width: w + "px", height: height + "px" }, title: pageName(seg) }, img);
  const sc = (seg.scribes || []).filter(n => SCRIBES[n]);
  if (scribes && sc.length) el.append(h("i", { class: "scribe", title: sc.map(n => SCRIBES[n]).join(" + "),
    style: { background: sc.length === 1 ? `var(--h${sc[0]})`
      : `linear-gradient(90deg, ${sc.map((n, i) => `var(--h${n}) ${i * 100 / sc.length}% ${(i + 1) * 100 / sc.length}%`).join(", ")})` } }));
  if (labels) el.append(h("span", { class: "lbl", title: seg.custom ? "Your crop" : null }, short(pageName(seg)) + (seg.custom ? " ✂" : "")));
  if (crop) el.append(h("button", { class: "seg-crop", title: `Re-cut ${pageName(seg)} from Yale's photograph (C)`,
    onpointerdown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); CropEditor.open(seg.img); } }, "✂ Crop"));
  return el;
}

// ---------------------------------------------------------------- app state + routing
const S = {
  view: "three",   // the site opens on the 3D book
  order: store.get("order", "beinecke"),
  compare: "beinecke",
  labels: store.get("labels", true),
  scribes: store.get("scribes", false),
  ghosts: store.get("ghosts", true),
};

/* The page side the reader is on: the page asked for while its opening is shown, else the right-hand page (the
   left one at the back cover). */
function curSide() {
  const sp = R.spreads && R.spreads[R.at];
  if (!sp) return null;
  return (R.focus && sp.find(p => p && Reader.match(p, R.focus))) || sp[1] || sp[0];
}
/* The name of the page you are on, for the address: the page asked for, when it is on show only because its fold is open
   (70v2); else the label of the page side. */
const curLabel = () => {
  const p = curSide();
  if (!p) return null;
  const seg = p.segs.length > 1 && (R.unfold.L || R.unfold.R) && R.focus && Reader.panelNamed(p, R.focus);
  return seg ? seg.page : sideLabel(p);   // the page id, which Reader.find always finds
};
/* the same page as an id Reader.find() always finds, lost leaves included ("f59r", "f68r2") */
const curPage = () => { const p = curSide(); return p ? p.shown.page : null; };

/* Where you are in the book, shared by the Reader and 3D: the page last looked at, its sheet, and which view put it there.
   A view that opens after the other one moved goes to that place. Read reports the right-hand page of its opening;
   3D reports the opening it shows, or in the block the first page of the current sheet (unless the place is already
   on that sheet). */
const POS = { page: null, sheet: null, by: null };
function setPos(page, sheet, by) {
  if (!page || !sheet) return;
  Object.assign(POS, { page, sheet, by });
}
/* The page you are on: the Reader's page, or in 3D the shared place if it is on the current sheet, else that sheet's
   first page. */
function herePage() {
  if (S.view === "read" && R.spreads) return curPage();
  const id = S.view === "three" && View3D.mod?.curSheet();
  if (id) {
    if (POS.sheet === id) return POS.page;
    const g = ORDERS.get(S.order).gatherings.find(x => x.bifolia.includes(id));
    return sidesOf(SHEETS.get(id), (g?.sheets || {})[id] || {})[0].shown.page;
  }
  return POS.page;
}
/* The pages you can bookmark where you are: both pages of the Reader's opening, or in 3D the opening shown or the pages
   of the sheet you have picked. */
function herePages() {
  if (S.view === "read" && R.spreads) return R.spreads[R.at].filter(p => p && !p.lost).map(p => p.shown.page);
  if (S.view === "three" && View3D.mod) return View3D.mod.herePages();
  return POS.page ? [POS.page] : [];
}
/* Go to a page (a bookmark, a grid cell) in the view you are in; the other view follows when you open it. */
function goToPage(page, { open = false } = {}) {
  const sheet = PAGE_SHEET.get(page);
  if (!sheet) return;
  setPos(page, sheet, "nav");
  if (S.view === "read") {
    const k = Reader.find(page);
    if (k >= 0) Reader.go(k, 0, page); else toast(`${short(page)} is not in this order`);
  } else if (S.view === "three") View3D.load().then(m => m.sync(POS, { open }));
  else show("three");
}

function setHash() {
  const at = S.view === "read" ? short(curLabel() || "") : S.view === "three" ? View3D.state() : S.view === "info" ? (Info.at || "") : "";
  const hash = `#${S.view}/${encodeURIComponent(S.order)}${at ? "/" + at : ""}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

function readHash() {
  const [view, order, at] = location.hash.replace(/^#\/?/, "").split("/").map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  if (["read", "three", "info"].includes(view)) S.view = view;
  if (view === "sources" || view === "collation") S.view = "info";   // the old Sources and Folio order tabs are sections of Info now
  const oid = RETIRED[order] || order;
  if (oid && ORDERS.has(oid)) S.order = oid;
  return view === "sources" ? "sources" : view === "collation" ? "quires" : at;
}

function fillOrderSelect() {
  const sel = $("#cx-order");
  sel.innerHTML = "";
  for (const o of ORDERS.values()) if (!o.mine) sel.append(h("option", { value: o.id }, o.title));
  const mine = [...ORDERS.values()].filter(o => o.mine);
  if (mine.length) sel.append(h("optgroup", { label: "Your orders" }, mine.map(o => h("option", { value: o.id }, o.title))));
  sel.value = S.order;
}

function setOrder(id, opts = {}) {   // opts reach the 3D morph: { ms, moved }
  if (!ORDERS.has(id)) return;
  S.order = id;
  store.set("order", id);
  $("#cx-order").value = id;
  const o = ORDERS.get(id);
  $("#cx-order").title = o.subtitle || "";   // the order's one-line description, on hover
  if (S.view === "read") Reader.open(o);
  if (S.view === "info") Collation.render();
  if (S.view === "three") View3D.open(o, opts);
  setHash();
}

function show(view) {
  S.view = view;
  for (const b of $$("#cx-tabs button")) b.setAttribute("aria-selected", String(b.dataset.view === view));
  for (const v of $$(".view")) v.hidden = v.id !== "v-" + view;
  if (view === "read") Reader.open(ORDERS.get(S.order), POS.by && POS.by !== "read" ? POS.page : undefined);
  if (view === "three") View3D.mount();
  if (view === "info") Info.render();
  setHash();
}

// ================================================================ READER
const R = { order: null, pages: null, spreads: null, at: 0, unfold: { L: false, R: false }, busy: false, newSet: null,
            zoom: 1, zx: 0, zy: 0, settleT: null, dir: 1, aheadT: null,   // the way you are reading (+1 on, -1 back)
            queue: [], moving: null, turning: null, gen: 0, fetchT: null,   // moves waiting for the one in progress; the leaf in the air; bumped when the book is reopened; the timer for fetching the pictures either side
            chain: false,   // the last leaf landed with more turns waiting: the next lifts at speed, so a run of turns reads as one riffle
            ref: null, refFor: null,   // the page width every plain opening is sized for (see refHalf)
            focus: null };   // the page asked for (Go to, a link, 3D) while its opening is shown; turning the page drops it

const PICS = new Map();   // picture url -> its decoded image, on its way or ready (Reader.pictures)
const Reader = {
  built: false,
  build() {
    const v = $("#v-read");
    v.innerHTML = "";
    v.append(
      h("div", { class: "rd-bar" },
        h("button", { id: "rd-prev", title: "Previous opening (←)", onclick: () => Reader.step(-1) }, "‹"),
        h("button", { id: "rd-next", title: "Next opening (→)", onclick: () => Reader.step(1) }, "›"),
        h("span", { class: "rd-where", id: "rd-where" }),
        h("span", { class: "rd-meta", id: "rd-meta" }),
        h("div", { class: "rd-tools" },
          h("button", { id: "rd-unfold", title: "Unfold / fold this opening (U)", onclick: () => Reader.toggleUnfold() }, "Unfold"),
          h("button", { id: "rd-labels", class: S.labels ? "on" : "", onclick: e => { S.labels = !S.labels; store.set("labels", S.labels); e.target.classList.toggle("on", S.labels); Reader.render(); } }, "Labels"),
          h("button", { id: "rd-scribes", class: S.scribes ? "on" : "", title: "Colour bar = Davis's scribe", onclick: e => { S.scribes = !S.scribes; store.set("scribes", S.scribes); e.target.classList.toggle("on", S.scribes); Reader.render(); } }, "Scribes"),
          h("button", { id: "rd-ghosts", class: S.ghosts ? "on" : "", title: "Show lost leaves as blank pages", onclick: e => { S.ghosts = !S.ghosts; store.set("ghosts", S.ghosts); e.target.classList.toggle("on", S.ghosts); Reader.open(R.order, Reader.nearestKept()); } }, "Lost leaves"),
          h("button", { title: "Go to a folio (G)", onclick: () => Reader.ask() }, "Go to…"),
          h("button", { id: "rd-bm", title: "Bookmark a page of this opening (B)", onclick: () => Bookmarks.here() }, "☆", h("span", { class: "txt" }, " Bookmark")),
          h("button", { id: "rd-gridbtn", title: "See every page at once, to jump anywhere (O)", onclick: () => Reader.toggleGrid() }, h("span", { class: "ico" }, "▦ "), "Grid"),
        )),
      h("div", { class: "rd-stage", id: "rd-stage" },
        h("div", { class: "rd-zoomer", id: "rd-zoomer" }),
        // zoomed in: whether the pages on screen are at full size yet (Sharp), over the corner of the pages, so the row
        // under them keeps still
        h("span", { class: "rd-sharp", id: "rd-sharp", role: "status" }),
        // fold or unfold this opening: over the foot of the pages, only where there is a foldout
        h("button", { class: "rd-fold", id: "rd-fold", hidden: true, onclick: () => Reader.toggleUnfold() }),
        h("button", { class: "rd-nav prev", "aria-label": "Previous opening", onclick: () => Reader.step(-1) }, "‹"),
        h("button", { class: "rd-nav next", "aria-label": "Next opening", onclick: () => Reader.step(1) }, "›")),
      // one slim row under the pages, the same height on every opening: zoom, then this opening's flags and note (two
      // lines at most; "more" opens the whole note in a panel over the foot of the stage, so nothing moves)
      h("div", { class: "rd-foot", id: "rd-foot" },
        h("div", { class: "rd-zoombar", title: "Pinch or ⌘-scroll to zoom · drag to move · double-click a spot" },
          h("button", { title: "Zoom out (−)", "aria-label": "Zoom out", onclick: () => Reader.zoomBy(1 / 1.5) }, "−"),
          h("button", { id: "rd-zoomlvl", title: "Back to the whole opening (0)", onclick: () => Reader.resetZoom() }, "100%"),
          h("button", { title: "Zoom in (+)", "aria-label": "Zoom in", onclick: () => Reader.zoomBy(1.5) }, "+")),
        h("div", { class: "rd-note", id: "rd-note" }),
        h("button", { class: "rd-more", id: "rd-more", hidden: true, "aria-expanded": "false", "aria-controls": "rd-notepop",
          onclick: () => Reader.toggleNote() }, "more"),
        h("div", { class: "rd-notepop", id: "rd-notepop", hidden: true, role: "region", "aria-label": "Note on this opening" })),
      h("div", { class: "strip", id: "rd-strip" }),
      h("div", { class: "rd-grid", id: "rd-grid", hidden: true }),
    );
    // a new size mid-animation is drawn when the animation ends: redrawing now would take the leaf out of the air
    new ResizeObserver(() => { const a = R.folding || R.turning; if (a) a.resized = true; else Reader.render(true); }).observe($("#rd-stage"));
    new ResizeObserver(() => Reader.toggleNote(R.noteOpen)).observe($("#rd-note"));   // a new width may cut the note, or not
    document.addEventListener("pointerdown", e => {
      if (R.noteOpen && !e.target.closest("#rd-notepop, #rd-more")) Reader.toggleNote(false);
    });
    this.wireZoom();
    this.built = true;
  },

  open(order, at) {
    if (!this.built) this.build();
    const keep = [at, curPage()].filter(Boolean);   // the page asked for, else the page we were on
    R.focus = null;
    R.gen++; R.queue = []; R.moving = null; R.busy = false; R.turning = null; R.chain = false;   // a turn or move under way belonged to the old book
    R.order = order;
    R.pages = linearize(order, { ghosts: S.ghosts, spine: true });
    R.spreads = [[null, R.pages[0]]];
    for (let i = 1; i < R.pages.length; i += 2) R.spreads.push([R.pages[i], R.pages[i + 1] || null]);
    R.newSet = order.id === "beinecke" ? new Set() : (() => {
      const base = openings(ORDERS.get("beinecke"), true);
      return new Set([...openings(order, true)].filter(x => !base.has(x)));
    })();
    R.at = 0;
    for (const name of keep) {
      const k = Reader.find(name);
      if (k >= 0) { R.at = k; R.focus = name; break; }
    }
    R.unfold = { L: false, R: false };
    this.renderStrip();
    this.render();
    this.report();
    this.prefetch();
    if (R.grid) this.renderGrid(true);
  },

  /* tell 3D where the reader is */
  report() {
    const p = curSide();
    if (p) setPos(p.shown.page, p.sheet, "read");
  },

  /* label of the current page, or of the nearest page that is not a lost leaf (used when hiding them) */
  nearestKept() {
    const sp = R.spreads && R.spreads[R.at];
    if (!sp) return null;
    const cur = sp[1] || sp[0];
    if (!cur.lost) return sideLabel(cur);
    const i = R.pages.indexOf(cur);
    for (let d = 1; d < R.pages.length; d++) {
      for (const j of [i + d, i - d]) if (R.pages[j] && !R.pages[j].lost) return sideLabel(R.pages[j]);
    }
    return null;
  },

  /* does page side p answer to this name ("78v", "f78v", "68r2", "[59r]" for the lost leaf 59r)? By the page it shows
     (a page cut in panels, like "f70v2 (1)", still answers to "70v2"), or, unless `shownOnly`, by a panel it unfolds to. */
  match(p, name, shownOnly = false) {
    const want = String(name).toLowerCase().replace(/[[\]]/g, "").replace(/^f?/, "f");
    if (sideLabel(p).toLowerCase() === want || p.shown.page.toLowerCase() === want) return true;
    return !shownOnly && !!this.panelNamed(p, name);
  },

  /* the panel of page side p that answers to this name, if it has one */
  panelNamed(p, name) {
    const want = String(name).toLowerCase().replace(/[[\]]/g, "").replace(/^f?/, "f");
    return p.segs.find(s => s.page.toLowerCase() === want || pageName(s).toLowerCase() === want);
  },

  find(name) {
    // the opening that shows the page, before one where it only appears when a foldout is opened
    for (const shownOnly of [true, false]) {
      const idx = R.spreads.findIndex(sp => sp.some(p => p && this.match(p, name, shownOnly)));
      if (idx >= 0) return idx;
    }
    const want = String(name).toLowerCase().replace(/[[\]]/g, "").replace(/^f?/, "f");
    // a bare folio number ("78") -> first page of that leaf
    const n = parseInt(want.slice(1), 10);
    return R.spreads.findIndex(sp => sp.some(p => p && p.leafNo === n));
  },

  async ask() {
    const v = await askText("Go to a folio", { placeholder: "e.g. 78v, 68r3, 105", ok: "Go" });
    if (!v) return;
    const k = this.find(v.trim());
    if (k < 0) toast(`No page ${v} in this order`); else this.go(k, 0, v.trim());
  },

  /* Moving between openings. Every move to another opening turns a leaf, whatever got you there (the arrows, the strip,
     Go to, the grid) and whatever state the opening was in: a zoomed-in view eases back and a foldout folds shut where it
     stands first, and the pictures are fetched before the leaf lifts, so it is never a blank card. A move asked for
     while another is under way waits its turn rather than being dropped. */

  /* the opening the reader is heading for: where the moves under way and waiting end */
  heading() { return R.queue.length ? R.queue[R.queue.length - 1].k : R.moving ?? R.at; },

  /* one opening on (+1) or back (-1) from where the reader is heading */
  step(d) { this.go(this.heading() + d, d); },

  /* dir is 1 or -1 for a step, 0 for a jump; a jump replaces the moves waiting, steps add to them. `still`: no turn,
     for the first sight of the book from a link */
  go(k, dir = 0, focus = null, still = false) {
    if (!R.spreads || k < 0 || k >= R.spreads.length) return;
    if (R.grid) this.toggleGrid(false);
    if (!R.busy) { this.travel(k, focus, still); return; }
    if (Math.abs(dir) === 1) { if (R.queue.length < 6) R.queue.push({ k, focus }); }
    else R.queue = [{ k, focus }];
    this.pictures(k);   // on their way while the leaf before is still in the air
  },

  /* the next move waiting, if the reader is free */
  drain() {
    if (R.busy) return;
    const m = R.queue.shift();
    if (m) this.travel(m.k, m.focus); else { R.chain = false; this.prefetch(); }
  },

  async travel(k, focus, still = false) {
    const from = R.at, gen = R.gen, stage = $("#rd-stage");
    const flip = !still && k !== from && !REDUCED && !document.hidden && !!stage && stage.clientWidth > 0;
    const same = () => gen === R.gen;   // false once the book has been reopened: this move is forgotten
    R.busy = true; R.moving = k;
    try {
      if (flip) {
        if (R.zoom > 1) { await this.easeZoom(); if (!same()) return; }
        if (R.unfold.L || R.unfold.R) { await this.setUnfold({ L: false, R: false }, { within: true, speed: .65 }); if (!same()) return; }
        await Promise.race([this.pictures(k), new Promise(r => setTimeout(r, 1200))]);
        if (!same()) return;
      }
      R.at = k;
      R.focus = focus;
      if (k !== from) R.dir = k > from ? 1 : -1;   // the way you are reading, which Sharp loads ahead along
      if (R.zoom > 1) { R.zoom = 1; R.zx = 0; R.zy = 0; }   // zoomed in on a spot: start the new opening whole; zoomed out stays out
      R.unfold = { L: false, R: false };
      this.markStrip();
      this.report();
      setHash();
      if (flip) {
        // A run of turns reads as one riffle: with more waiting, the leaf comes quicker and lands at speed, and the one
        // after it lifts at speed, so the leaves follow each other without stopping; the last one settles gently.
        const more = R.queue.length > 0, lifted = R.chain;
        R.chain = more;
        for (const d of [1, 2]) this.pictures(k + d * R.dir);   // the pages ahead, the way you are reading
        await this.turn(from, k, k > from ? 1 : -1, more || lifted ? 300 : 520,
          lifted ? (more ? "linear" : "cubic-bezier(.2,.6,.3,1)") : more ? "cubic-bezier(.5,0,.8,.5)" : "cubic-bezier(.4,0,.2,1)");
      } else { R.chain = false; this.render(); }
      if (focus) { await this.reveal(focus, still); if (!same()) return; setHash(); }
    } finally {
      if (same()) { R.busy = false; R.moving = null; this.drain(); }
    }
  },

  /* A page asked for (Go to, a bookmark, a link) that is inside a fold of its opening, like 70v2, is not on show folded:
     the page it folds into unfolds so that it is. */
  reveal(name, still = false) {
    const [l, r] = R.spreads[R.at];
    const inFold = p => !!p && !p.lost && p.segs.length > 1 && !p.grid && !this.match(p, name, true) && this.match(p, name);
    const next = { L: inFold(l), R: inFold(r) };
    if (!next.L && !next.R) return Promise.resolve();
    if (still) { R.unfold = next; this.render(); return Promise.resolve(); }
    return this.setUnfold(next, { within: true });
  },

  /* a zoomed-in view eases back to the whole opening */
  easeZoom() {
    const z = $("#rd-zoomer");
    z.style.transition = "transform .22s ease";
    R.zoom = 1; R.zx = 0; R.zy = 0;
    this.applyZoom();
    return new Promise(done => setTimeout(() => { z.style.transition = ""; done(); }, 240));
  },

  /* the pictures of opening k, decoded and ready (or failed): resolves when none is still on its way */
  pictures(k) {
    const urls = (R.spreads?.[k] || []).filter(p => p && !p.lost && p.shown && p.shown.img).map(p => imgUrl(p.shown.img, "l", p.shown.v));
    return Promise.all(urls.map(src => {
      // each picture is decoded once and held (the last few dozen), so a turn to a page already fetched starts at once
      if (!PICS.has(src)) {
        const im = new Image();
        im.src = src;
        PICS.set(src, (im.decode ? im.decode().catch(() => {}) : new Promise(r => { im.onload = im.onerror = r; })).then(() => im));
        if (PICS.size > 48) PICS.delete(PICS.keys().next().value);
      }
      return PICS.get(src);
    }));
  },

  /* once the reader has been still a moment, fetch the openings either side so the next turn finds them ready */
  prefetch() {
    clearTimeout(R.fetchT);
    R.fetchT = setTimeout(() => { for (const d of [1, -1]) if (R.spreads && R.spreads[R.at + d]) this.pictures(R.at + d); }, 350);
  },

  toggleUnfold() {
    const [l, r] = R.spreads[R.at];
    const can = p => p && !p.lost && (p.segs.length > 1 || p.grid);
    if (!can(l) && !can(r)) { toast("Nothing folded in this opening"); return; }
    if ((l && l.grid) || (r && r.grid)) { SheetView.open((l && l.grid ? l : r).sheet); return; }
    const on = !(R.unfold.L || R.unfold.R);
    this.setUnfold({ L: on && can(l), R: on && can(r) });
  },

  /* Fold or unfold. The opening moves and resizes in step with the paper that is open, from the plain opening with its
     gutter in the middle to the whole foldout in the middle of the stage, so nothing jumps, while the panels open one
     after another about their hinges, like a map (closing runs it backwards),
     each turning the way its fold goes (foldWay: toward you where it folds onto the face on show, away where it doesn't).
     Where the folded page is the hinge panel itself, the others are tucked behind it and come out from behind its
     edge. Where it isn't, the folded page lies over the front: it turns outward like a page, starting exactly where
     the folded view had it, and lands as the first panel (the photographs of the two states differ in size, so it
     shifts to the panel's size while it is edge-on). A panel folded more than square to the one it hangs from is
     inside the fold and not drawn. The book is drawn once, in the state with more panels; the motion is transforms.
     Returns a promise that resolves when it has finished. `within`: part of a move that already holds the reader
     (folding shut before a leaf turns), so it neither needs the reader free nor frees it; `speed` scales the time. */
  setUnfold(next, { within = false, speed = 1 } = {}) {
    const prev = R.unfold;
    if (R.busy && !within) return Promise.resolve();
    if (prev.L === next.L && prev.R === next.R) return Promise.resolve();
    if (REDUCED || document.hidden) { R.unfold = next; this.render(); return Promise.resolve(); }
    const a = this.layout(prev), b = this.layout(next);
    R.unfold = { L: prev.L || next.L, R: prev.R || next.R };
    this.render();
    const stage = $("#rd-stage"), sp = $(".spread", stage), gutter = $(".rd-gutter", sp);
    const ph = parseFloat($(".rd-page", sp).style.height) || this.layout().ph, lw = gutter.offsetLeft;
    // the spread's transform that puts the drawn gutter where state s has it, at state s's size
    const at = st => { const k = st.k * st.ph / ph; return { k, x: st.x + st.k * st.lw - k * lw, y: st.y }; };
    const A = at(a), B = at(b);
    const sides = [["L", -1], ["R", 1]].map(([side, dir]) => {
      if (prev[side] === next[side]) return null;
      const p = R.spreads[R.at][side === "L" ? 0 : 1];
      const page = $(`.rd-page.${side === "L" ? "left" : "right"}`, sp);
      const segs = [...page.children].filter(e => e.classList.contains("seg"));
      const m = segs.findIndex(e => !e.classList.contains("ext"));
      const panels = (dir > 0 ? segs.slice(m + 1) : segs.slice(0, m).reverse()).map(el => ({ el, w: el.offsetWidth }));
      const front = p.shown !== p.segs[p.hinge === "left" ? 0 : p.segs.length - 1];
      const hinge = segs[m], wh = hinge.offsetWidth, ws = Math.round(ph * aspect(p.shown));
      // which way each fold turns, from the hinge panel outward (data/folds.json)
      const key = el => el.querySelector("img")?.dataset.key;
      const chain = [hinge, ...panels.map(q => q.el)];
      panels.forEach((q, i) => { q.way = foldWay(p.sheet, key(chain[i]), key(chain[i + 1])); });
      // stacking: hinge panel 10; over it the first panel when it lies in front, and panels that turn toward you; else behind
      panels.forEach(({ el, way }, i) => { el.style.zIndex = front ? (i ? 11 + i : 20) : way > 0 ? 11 + i : 9 - i; });
      if (front && panels.length) panels[0].el.append(segEl(p.shown, ph, { labels: false, scribes: false, lazy: false, cls: "backface" }));
      page.classList.add("folding");
      return { page, panels, dir, front, hinge, wh, ws, opening: next[side] };
    }).filter(Boolean);
    const n = Math.max(1, ...sides.map(sd => sd.panels.length));
    const STAGGER = 0.45, span = 1 - (n - 1) * STAGGER;
    const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const clamp = v => Math.max(0, Math.min(1, v));
    const prog = (T, i) => ease(clamp((T - i * STAGGER) / span));   // panel i's own progress, 0 folded .. 1 open
    const totalW = sides.reduce((a, sd) => a + sd.panels.reduce((c, q) => c + q.w, 0), 0) || 1;
    sp.classList.add("folding");
    const frame = t => {
      // the opening's size follows how much paper is actually open, so it never outgrows the stage mid-way
      let open = 0;
      for (const sd of sides) sd.panels.forEach((q, i) => { open += q.w * prog(sd.opening ? t : 1 - t, i); });
      const f = sides[0].opening ? open / totalW : 1 - open / totalW, k = A.k + (B.k - A.k) * f;   // f: 0 at prev, 1 at next
      sp.style.transform = `translate(${A.x + (B.x - A.x) * f}px, ${A.y + (B.y - A.y) * f}px) scale(${k})`;
      for (const { panels, dir, front, hinge, wh, ws, opening } of sides) {
        const T = opening ? t : 1 - t;   // how open the side is: closing replays opening backwards
        let M = null, off = 0, turn = 0, hidden = false;
        panels.forEach(({ el, w, way }, i) => {
          const u = prog(T, i);
          const fold = 180 * (1 - u);                            // how far it is folded onto the one before
          if (!front && el.classList.contains("over")) el.style.zIndex = fold > 90 ? 9 : 11;   // over the strip of page edges once past square
          const d = -way * dir * fold;   // toward you (in) or away (out), about the panel it hangs from
          let sx = 1;
          if (i === 0) {
            // the front page starts where (and as wide as) the folded view shows it, then becomes the panel by 90°
            const g = front ? 1 - clamp(u * 2) : 0;
            M = new DOMMatrix().translate(dir * (ws - wh) * g, 0);
            if (front && fold > 90) sx = ws / w;
            if (front) hinge.style.clipPath = wh > ws && g > 0
              ? (dir > 0 ? `inset(0 ${(wh - ws) * g}px 0 0)` : `inset(0 0 0 ${(wh - ws) * g}px)`) : "";
          }
          M = M.rotate(0, d, 0); turn += d;
          hidden = hidden || (fold > 90 && !(front && i === 0));   // inside the fold
          // the panel's own box sits `off` from the hinge; place it where the chain of folds has carried it
          const E = dir > 0 ? new DOMMatrix().translate(-off, 0).multiply(M).scale(sx, 1)
                            : new DOMMatrix().translate(off + w, 0).multiply(M).scale(sx, 1).translate(-w, 0);
          el.style.transform = E.toString();
          el.style.visibility = hidden ? "hidden" : "";
          const c = Math.cos(turn * Math.PI / 180);
          el.classList.toggle("back", c < 0);       // facing away: the folded page (or plain vellum)
          el.style.filter = c > .999 ? "" : `brightness(${(.6 + .4 * Math.abs(c)).toFixed(3)})`;
          M = M.translate(dir * w, 0); off += w;
        });
      }
    };
    const DUR = (560 + 300 * (n - 1)) * speed, t0 = performance.now();
    R.busy = true; R.folding = { frame };   // `frame` is kept so a test can put the fold at an exact point without waiting on the browser's frames
    frame(0);
    return new Promise(done => {
      const finish = () => {
        const resized = R.folding && R.folding.resized;
        R.folding = null; R.unfold = next;
        if (!within) R.busy = false;
        // folded away (or the window changed meanwhile): draw the new state; opened: what's drawn already is it
        if (resized || sides.some(sd => !sd.opening)) this.render(true);
        else {
          sp.classList.remove("folding");
          for (const { page, panels, hinge } of sides) {
            page.classList.remove("folding");
            hinge.style.clipPath = "";
            for (const { el } of panels) {
              el.style.transform = el.style.filter = el.style.zIndex = el.style.visibility = ""; el.classList.remove("back");
              el.querySelector(":scope > .backface")?.remove();
            }
          }
          sp.style.transform = `translate(${b.x}px, ${b.y}px)` + (b.k < 1 ? ` scale(${b.k})` : "");
        }
        done();
        if (!within) this.drain();
      };
      const tick = now => {
        const t = Math.min(1, (now - t0) / DUR);
        frame(t);
        if (t < 1) requestAnimationFrame(tick); else finish();
      };
      requestAnimationFrame(tick);
    });
  },

  /* natural size of one page side at height 1 */
  pageParts(p, side, unfolded) {
    if (!p) return { segs: [], w: 0.68 };
    const segs = unfolded ? p.segs : [p.lost ? p.segs[p.hinge === "left" ? 0 : p.segs.length - 1] : p.shown];
    const m = unfolded && seamOf(p);
    const w = segs.reduce((a, s) => a + (s.missing ? 0.68 : aspect(s)), 0) - (m ? m.band * aspect(m.hinge) : 0);
    return { segs, w };
  },

  /* The page width, at height 1, that every opening is sized for: that of the book's wider pages (the 98th percentile),
     not of the opening's own. The photographs differ a little in width, and an opening sized by its own widest page
     would come out a little bigger or smaller than the one before, turn after turn, in any window narrower than the
     book is tall. The few pages wider than this are shrunk to fit about the gutter instead (see layout). */
  refHalf() {
    if (R.refFor !== R.pages) {
      const ws = R.pages.filter(p => p && !p.lost && p.shown).map(p => aspect(p.shown)).sort((a, b) => a - b);
      R.ref = ws.length ? ws[Math.floor(.98 * (ws.length - 1))] : 0.7;
      R.refFor = R.pages;
    }
    return Math.max(R.ref, 0.68);
  },

  /* page height and where the spread goes for an unfold state: translate (x, y) from the stage centre, scale k, and
     the width of the left page (lw), which puts the gutter at x + k·lw. A plain opening always has its gutter at the
     middle of the stage and its pages at the same height. A foldout opened out is as big as the stage lets the whole
     of it be (never taller than a plain page) and sits in the middle of the stage, so its gutter is off-centre. */
  layout(unfold = R.unfold, at = R.at) {
    const stage = $("#rd-stage");
    const [l, r] = R.spreads[at];
    const L = this.pageParts(l, "L", unfold.L), Rr = this.pageParts(r, "R", unfold.R);
    const plain = !unfold.L && !unfold.R;
    const half = this.refHalf();
    const W = stage.clientWidth - 130, H = stage.clientHeight - 28;
    const php = Math.max(80, Math.min(H, W / (2 * half + 0.02)));   // a plain page
    // opened out, its fold tab hangs off the outer edge: leave it room beside the arrows at the sides of the stage
    const TAB = 22;
    const ph = plain ? php : Math.max(80, Math.min(php, (W - 2 * TAB) / ((L.w || 0.68) + (Rr.w || 0.68) + 0.02)));
    // drawn widths, rounded per panel as segEl rounds them
    const pw = (p, parts, open) => p ? parts.segs.reduce((a, s) => a + Math.round(ph * (s.missing ? 0.68 : aspect(s))), 0) - (open ? seamPx(p, ph) : 0) : Math.round(ph * 0.68);
    const lw = pw(l, L, unfold.L), rw = pw(r, Rr, unfold.R);
    const avail = stage.clientWidth - 110;
    let k, x;
    if (plain) {   // gutter in the middle; a page wider than the rest shrinks the opening about the gutter rather than moving it
      k = Math.min(1, avail / 2 / (Math.max(lw, rw) + 1));
      x = -k * (lw + 1);
    } else {       // opened out: the whole of it in the middle of the stage, scaled down if it is still too wide
      const total = lw + rw + 2;
      k = Math.min(1, (avail - 2 * TAB) / total);
      x = -total * k / 2;
    }
    return { l, r, L, Rr, ph, half, lw, k, x, y: -ph * k / 2 };
  },

  render(resizeOnly) {
    if (!R.spreads) return;
    const stage = $("#rd-stage");
    $$(".spread, .turn", stage).forEach(e => e.remove());
    const { l, r, L, Rr, ph, k, x, y } = this.layout();
    const mk = (p, parts, side, unfolded) => {
      const el = h("div", { class: `rd-page ${side === "L" ? "left" : "right"}${p ? "" : " empty"}` });
      if (!p) { el.style.width = Math.round(ph * 0.68) + "px"; el.style.height = ph + "px"; return el; }
      el.style.height = ph + "px";
      const seam = unfolded && seamOf(p);
      parts.segs.forEach(seg => {
        const isExt = unfolded && seg !== (p.hinge === "left" ? p.segs[0] : p.segs[p.segs.length - 1]);
        const over = seam && seg === seam.flap;   // lies over the strip of page edges on the hinge panel
        const sg = segEl(seg, ph, { labels: S.labels, scribes: S.scribes, cls: (isExt ? "ext" : "") + (over ? " over" : ""), crop: !seg.missing, lazy: !unfolded });
        if (over) sg.style[p.hinge === "left" ? "marginLeft" : "marginRight"] = -seamPx(p, ph) + "px";
        if (seam && seg === seam.hinge && p.hinge === "right") sg.style.setProperty("--covered", seamPx(p, ph) + "px");   // its label clear of the flap
        el.append(sg);
      });
      if (!p.lost) {   // a star in the corner bookmarks exactly this page
        const pg = p.shown.page, b = Bookmarks.of(pg);
        el.append(h("button", { class: `rd-star${b ? " on" : ""}`, title: b ? `Bookmarked as “${b.name}”: click to remove` : `Bookmark ${short(pg)}`,
          "aria-label": b ? `Remove the bookmark on ${short(pg)}` : `Bookmark ${short(pg)}`,
          onpointerdown: e => e.stopPropagation(), onclick: e => { e.stopPropagation(); Bookmarks.toggle(pg); } }, b ? "★" : "☆"));
      }
      if (!p.lost && (p.segs.length > 1 || p.grid)) {
        const n = p.grid ? 0 : p.segs.length - 1;
        el.append(h("button", { class: "foldtab", title: p.grid ? "Open the whole sheet" : (unfolded ? "Fold" : "Unfold"),
          onclick: () => {
            if (p.grid) { SheetView.open(p.sheet); return; }
            this.setUnfold({ ...R.unfold, [side]: !R.unfold[side] });
          } }, p.grid ? "open sheet" : unfolded ? "fold" : `unfold +${n}`));
      }
      return el;
    };
    const sp = h("div", { class: "spread" },
      mk(l, L, "L", R.unfold.L), h("div", { class: "rd-gutter" }), mk(r, Rr, "R", R.unfold.R));
    $("#rd-zoomer").append(sp);
    sp.style.transform = `translate(${x}px, ${y}px)` + (k < 1 ? ` scale(${k})` : "");
    this.applyZoom();
    this.renderInfo();
  },

  /* The note row is two lines; when the note needs more, "more" shows all of it in a panel over the foot of the stage.
     Called with no argument it toggles; with false it closes and checks again whether the note is cut. */
  toggleNote(open = !R.noteOpen) {
    const n = $("#rd-note"), more = $("#rd-more"), pop = $("#rd-notepop");
    if (!n || !more) return;
    const t = n.firstElementChild, cut = !!t && t.scrollHeight > t.clientHeight + 1;
    R.noteOpen = !!open && (cut || R.noteOpen);
    pop.hidden = !R.noteOpen;
    if (R.noteOpen) pop.replaceChildren(t.cloneNode(true));
    more.hidden = !cut && !R.noteOpen;
    more.textContent = R.noteOpen ? "less" : "more";
    more.setAttribute("aria-expanded", String(R.noteOpen));
  },

  // ---- zoom: a layer over the opening, scaled about the pointer (in) or the centre of the stage (out) ----
  applyZoom() {
    const z = $("#rd-zoomer");
    if (!z) return;
    const st = $("#rd-stage");
    if (R.zoom < 1) {   // zoomed out: always centred, so it stays put when the window resizes
      R.zx = st.clientWidth / 2 * (1 - R.zoom); R.zy = st.clientHeight / 2 * (1 - R.zoom);
    }
    z.style.transform = R.zoom !== 1 ? `translate(${R.zx}px, ${R.zy}px) scale(${R.zoom})` : "";
    st.classList.toggle("zoomed", R.zoom > 1);
    // While you zoom or pan, the layer moves as one picture (will-change, in the CSS), drawn at the size it had when
    // you began; once you stop, it is drawn again at the size it has now, or zoomed pages would stay as blurry as at
    // the first step.
    st.classList.add("moving");
    clearTimeout(R.settleT);
    R.settleT = setTimeout(() => st.classList.remove("moving"), 200);
    $("#rd-zoomlvl").textContent = Math.round(R.zoom * 100) + "%";
    Sharp.check(st, R.zoom, $("#rd-sharp"));
    this.ahead();
  },

  /* When you stop on an opening for half a second, load ahead the full-size pages you are likely to zoom into next
     (Sharp.ahead): this opening as shown, then the next two openings in the direction you are reading, then the one
     behind. */
  ahead() {
    clearTimeout(R.aheadT);
    R.aheadT = setTimeout(() => {
      if (S.view !== "read" || R.grid || !R.spreads) return;
      const { ph } = this.layout();
      if (!Sharp.worth(ph)) { Sharp.ahead([]); return; }
      const segs = [];
      for (const o of [0, R.dir, 2 * R.dir, -R.dir]) {
        const sp = R.spreads[R.at + o];
        if (sp) sp.forEach((p, i) => {
          if (!p || p.lost) return;
          const side = i ? "R" : "L";
          segs.push(...(o === 0 ? this.pageParts(p, side, R.unfold[side]).segs : [p.shown]));
        });
      }
      Sharp.ahead(segs);
    }, 500);
  },

  zoomAt(f, cx, cy) {
    const r = $("#rd-stage").getBoundingClientRect();
    cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
    let z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, R.zoom * f));
    if (Math.abs(z1 - 1) < 0.03 || (R.zoom > 1) !== (z1 > 1) && R.zoom !== 1) z1 = 1;   // stop at 100% on the way through
    if (z1 === 1) { this.resetZoom(); return; }
    const z0 = R.zoom;
    R.zx = cx - (cx - R.zx) * (z1 / z0);
    R.zy = cy - (cy - R.zy) * (z1 / z0);
    R.zoom = z1;
    this.applyZoom();
  },

  zoomBy(f) { this.zoomAt(f); },

  resetZoom() { R.zoom = 1; R.zx = 0; R.zy = 0; this.applyZoom(); },

  wireZoom() {
    const stage = $("#rd-stage");
    let drag = null;
    stage.addEventListener("wheel", e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        this.zoomAt(Math.exp(-Math.max(-40, Math.min(40, e.deltaY)) * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else if (R.zoom > 1) {
        e.preventDefault();
        R.zx -= e.deltaX; R.zy -= e.deltaY;
        this.applyZoom();
      }
    }, { passive: false });
    stage.addEventListener("dblclick", e => {
      if (e.target.closest("button")) return;
      const r = stage.getBoundingClientRect();
      if (R.zoom !== 1) this.resetZoom(); else this.zoomAt(2.5, e.clientX - r.left, e.clientY - r.top);
    });
    stage.addEventListener("pointerdown", e => {
      if (R.zoom <= 1 || e.button !== 0 || e.target.closest("button")) return;
      drag = { x: e.clientX, y: e.clientY, zx: R.zx, zy: R.zy };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add("panning");
    });
    stage.addEventListener("pointermove", e => {
      if (!drag) return;
      R.zx = drag.zx + e.clientX - drag.x; R.zy = drag.zy + e.clientY - drag.y;
      this.applyZoom();
    });
    const end = () => { drag = null; stage.classList.remove("panning"); };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
  },

  /* The leaf turns about the gutter, from the page being left to the page being come to (dir 1: the old right page
     becomes the new left page; -1: the other way). A card with those two pages on its faces swings across. The new
     opening is drawn once, underneath, where the book always sits, and the old page on the far side is held over it
     until the leaf lands on it, so that page changes under the leaf and never before it (a far side with no page is
     held by a matte the colour of the table). Each face is the size of its own page: the leaf starts exactly over the
     page it lifts and lands exactly on the page it covers. Resolves when it has landed. */
  async turn(from, to, dir, ms = 520, easing = "cubic-bezier(.4,0,.2,1)") {
    const stage = $("#rd-stage"), gen = R.gen;
    const [ol, or] = R.spreads[from];
    const [nl, nr] = R.spreads[to];
    const { ph } = this.layout();
    const frontSide = dir > 0 ? or : ol, backSide = dir > 0 ? nl : nr;
    const under = dir > 0 ? ol : or;     // the old page on the far side, which the leaf is about to cover
    const segFor = p => p ? (p.lost ? p.segs[p.hinge === "left" ? 0 : p.segs.length - 1] : p.shown) : null;
    const f = segFor(frontSide), b = segFor(backSide), u = segFor(under);
    const wOf = s => Math.round(ph * (s ? (s.missing ? .68 : aspect(s)) : .68));
    // each face darkens as the leaf stands up and lightens as it lies down again (.shade), as a turning page does
    const face = (seg, cls) => h("div", { class: `side ${cls}`, style: { width: wOf(seg) + "px" } },
      seg ? segEl(seg, ph, { labels: S.labels, scribes: S.scribes, lazy: false }) : "", h("i", { class: "shade" }));
    const w = Math.max(wOf(f), wOf(b));
    const card = h("div", { class: `turn ${dir > 0 ? "fwd" : "rev"}`, style: { width: w + "px", height: ph + "px" } }, face(f, "front"), face(b, "back"));
    const held = u ? segEl(u, ph, { labels: S.labels, scribes: S.scribes, lazy: false }) : "";
    // The leaf's own pictures are in hand before anything is drawn, so it is never a blank card. They nearly always
    // are already (travel waits for the opening's pictures); a busy machine can still drop one between then and now.
    const late = [card, held].flatMap(el => el ? [...el.querySelectorAll("img")] : []).filter(im => !im.complete);
    if (late.length) {
      await Promise.race([Promise.all(late.map(im => im.decode ? im.decode().catch(() => {}) : new Promise(r => { im.onload = im.onerror = r; }))),
                          new Promise(r => setTimeout(r, 400))]);
      if (gen !== R.gen) return;   // the book was reopened meanwhile
    }
    this.render();
    const sp = $(".spread", stage);
    const pages = $$(".rd-page", sp);
    const gutter = $(".rd-gutter", sp);
    if (!pages.length || !gutter) return;
    card.style.left = (dir > 0 ? gutter.offsetLeft + 2 : gutter.offsetLeft - w) + "px";
    // the far side as it was, wide enough to hide the new far page whichever is wider
    const farEl = pages[dir > 0 ? 0 : 1];
    const hold = h("div", { class: `rd-page held ${dir > 0 ? "left" : "right"}`, style: { position: "absolute", top: "-1px", zIndex: 2,
      width: Math.max(u ? wOf(u) : 0, farEl.offsetWidth) + "px", height: (ph + 3) + "px", background: "var(--table)",   // a little over, to hide the page shadow beneath
      ...(dir > 0 ? { right: `calc(100% - ${gutter.offsetLeft}px)` } : { left: (gutter.offsetLeft + 2) + "px" }) } }, held);
    sp.classList.add("turning");
    sp.append(card, hold);
    R.turning = {};
    return new Promise(done => {
      let over = false;
      const land = () => {
        if (over) return;
        over = true;
        const resized = R.turning && R.turning.resized;
        R.turning = null;
        card.remove(); hold.remove(); sp.classList.remove("turning");
        if (resized) this.render(true);
        done();
      };
      if (!card.animate) { land(); return; }
      const swing = { duration: ms, easing };
      for (const sh of card.querySelectorAll(".shade")) sh.animate([{ opacity: 0 }, { opacity: .34, offset: .5 }, { opacity: 0 }], swing);
      // an opening wider than the rest is drawn smaller about the gutter (see layout): the book changes size with the leaf
      // rather than in the instant it lifts
      const ka = this.layout(R.unfold, from).k, kb = this.layout().k;
      if (Math.abs(ka - kb) > .002) {
        const at = k => `translate(${-k * (gutter.offsetLeft + 1)}px, ${-ph * k / 2}px) scale(${k})`;
        sp.animate([{ transform: at(ka) }, { transform: at(kb) }], swing);
      }
      card.animate([{ transform: "rotateY(0deg)" }, { transform: `rotateY(${dir > 0 ? -180 : 180}deg)` }],
        { ...swing, fill: "forwards" }).finished.then(land, land);
      setTimeout(land, ms + 1500);   // a document that is not being drawn must not hold the reader for ever
    });
  },

  /* The button over the foot of the pages that unfolds or folds the opening. It is there only at an opening with a
     foldout, says how much more there is to see, and draws the eye when you turn to one. */
  renderFoldBtn(foldable) {
    const el = $("#rd-fold"); if (!el) return;
    const [l, r] = R.spreads[R.at], open = R.unfold.L || R.unfold.R, grid = [l, r].some(p => p && p.grid);
    el.hidden = !foldable;
    if (!foldable) { el._at = null; return; }
    const more = [l, r].filter(p => p && !p.lost && !p.grid && p.segs.length > 1).reduce((a, p) => a + p.segs.length - 1, 0);
    const label = grid ? "Open the whole sheet" : open ? "Fold up" : "Unfold";
    el.replaceChildren(h("span", { class: "ico", "aria-hidden": "true" }, open ? "⇥⇤" : "⇤⇥"), label,
      !grid && !open && more ? h("small", {}, `${more} more panel${more === 1 ? "" : "s"}`) : "", h("kbd", {}, "U"));
    el.title = grid ? "Open the whole Rosettes sheet (U)" : open ? "Fold the foldout back up (U)" : "Unfold this opening's foldout (U)";
    if (el._at !== R.at) { el._at = R.at; el.classList.remove("arrive"); void el.offsetWidth; el.classList.add("arrive"); }   // turned to a foldout
  },

  renderInfo() {
    const [l, r] = R.spreads[R.at];
    $("#rd-where").textContent = [l, r].filter(Boolean).map(sideLabel).join("  |  ") || "—";
    const p = r || l;
    const g = R.order.gatherings[p.gi];
    const segs = [l, r].filter(Boolean).map(x => x.shown);
    const v = varsOf(segs);
    const bits = [qWord(p.quire), g.type === "singulions" ? `singulion ${p.bif}` : `bifolium ${p.bif}`];
    if (v.is.length) bits.push(v.is.join(", "));
    if (v.hs.length) bits.push(v.hs.map(x => SCRIBES[x]).join(" + "));
    if (v.ls.length) bits.push(v.ls.map(x => LANG[x]).join(" / "));
    $("#rd-meta").textContent = $("#rd-meta").title = bits.join(" · ") + `  ·  opening ${R.at + 1} of ${R.spreads.length}`;
    const flags = [];
    if (l && r && R.newSet.has(sideLabel(l) + "|" + sideLabel(r)))
      flags.push(h("span", { class: "flag new", title: "These two pages don't face each other in the book as it is bound today" }, "new pair"));
    if (l && r && l.sheet === r.sheet && l.face === r.face)
      flags.push(h("span", { class: "flag", title: `Both pages are halves of the same folded sheet, ${l.sheet}, facing each other across its fold` }, `two halves of sheet ${l.sheet}`));
    if ((l && l.lost) || (r && r.lost)) flags.push(h("span", { class: "flag lost" }, "lost leaf"));
    const foldable = [l, r].some(x => x && !x.lost && (x.segs.length > 1 || x.grid));
    $("#rd-unfold").disabled = !foldable;
    $("#rd-unfold").textContent = (R.unfold.L || R.unfold.R) ? "Fold" : "Unfold";
    this.renderFoldBtn(foldable);
    $("#rd-prev").disabled = R.at === 0;
    $("#rd-next").disabled = R.at === R.spreads.length - 1;
    const marked = [l, r].filter(p => p && !p.lost).map(p => Bookmarks.of(p.shown.page)).filter(Boolean);
    $("#rd-bm").replaceChildren(marked.length ? "★" : "☆", h("span", { class: "txt" }, marked.length ? ` Bookmarked${marked.length > 1 ? " (2)" : ""}` : " Bookmark"));
    $("#rd-bm").classList.toggle("on", marked.length > 0);
    $("#rd-bm").title = marked.length ? `Bookmarked: ${marked.map(b => `${short(b.page)} “${b.name}”`).join(", ")}. Click to change (B)` : "Bookmark a page of this opening (B)";
    const note = g.note || "";
    const ev = (D.orders.evidence || {})[p.bif];
    const nt = note || (ev ? ev[0].text : "");
    $("#rd-note").replaceChildren(h("span", { class: "rd-note-text" }, ...flags.flatMap(f => [f, " "]), nt));
    this.toggleNote(false);
  },

  renderStrip() {
    const strip = $("#rd-strip");
    strip.innerHTML = "";
    const base = ORDERS.get("beinecke");
    let idx = 0;
    R.order.gatherings.forEach((g, gi) => {
      const pages = R.pages.filter(p => p.gi === gi);
      const same = JSON.stringify(base.gatherings[gi] && { b: base.gatherings[gi].bifolia, t: base.gatherings[gi].type, s: base.gatherings[gi].sheets || null }) ===
                   JSON.stringify({ b: g.bifolia, t: g.type, s: g.sheets || null });
      const ticks = h("div", { class: "ticks" });
      for (const p of pages) {
        const i = R.pages.indexOf(p);
        const spread = i === 0 ? 0 : Math.ceil(i / 2);
        const bm = [p.shown, ...p.segs].map(x => Bookmarks.of(x.page)).find(Boolean);
        const fold = !p.lost && (p.segs.length > 1 || p.grid);   // a page that unfolds stands a little taller
        ticks.append(h("button", { class: `t${p.lost ? " lost" : ""}${same ? "" : " moved"}${bm ? " bm" : ""}${fold ? " fold" : ""}`, "data-i": i,
          title: `${bm ? `★ ${bm.name} · ` : ""}${sideLabel(p)} (${qTag(g.quire)})${fold ? " · foldout" : ""}`, onclick: () => Reader.go(spread, 0) }));
        idx++;
      }
      strip.append(h("div", { class: `g${g.type === "singulions" ? " sing" : ""}` },
        h("span", { class: "gl", style: same ? null : { color: "#f3c35c" } }, `${qTag(g.quire)}${same ? "" : " •"}`), ticks));
    });
    this.markStrip();
  },

  /* ---- the grid: every page at once, quire by quire, to jump anywhere ---- */
  toggleGrid(on = !R.grid) {
    R.grid = on;
    $("#rd-grid").hidden = !on;
    for (const id of ["#rd-stage", "#rd-foot", "#rd-strip"]) $(id).hidden = on;
    $("#rd-gridbtn").classList.toggle("on", on);
    if (on) this.renderGrid(true); else this.render(true);
  },
  renderGrid(scroll = false) {
    const g = $("#rd-grid");
    if (!g) return;
    const keep = scroll ? null : g.querySelector(".rg-body")?.scrollTop;
    g.innerHTML = "";
    const cur = new Set(R.at === 0 ? [0] : [2 * R.at - 1, 2 * R.at]);
    const toSpread = i => i === 0 ? 0 : Math.ceil(i / 2);
    const open = (i, page) => { this.toggleGrid(false); this.go(toSpread(i), 0, page); };
    const firstOf = new Map();   // section -> its first page, in reading order
    R.pages.forEach((p, i) => { if (!p.lost) for (const s of (p.shown.section || "").split("/").map(x => x.trim()).filter(Boolean)) if (!firstOf.has(s)) firstOf.set(s, i); });
    const H = 120;
    const body = h("div", { class: "rg-body" }, R.order.gatherings.map((gg, gi) => {
      const mine = R.pages.map((p, i) => [p, i]).filter(([p]) => p.gi === gi);
      const secs = [...new Set(mine.map(([p]) => (p.shown.section || "").trim()).filter(Boolean))];
      return h("section", { class: "rg-q" },
        h("h4", {}, qWord(gg.quire), secs.length ? h("span", {}, secs.join(" · ")) : "", gg.type === "singulions" ? h("span", {}, "separate sheets") : ""),
        h("div", { class: "rg-cells" }, mine.map(([p, i]) => {
          const s = p.shown, w = Math.round(H * (p.lost ? .68 : aspect(s)));
          const bm = [s, ...p.segs].map(x => Bookmarks.of(x.page)).find(Boolean);
          return h("button", { class: `rg-cell${cur.has(i) ? " cur" : ""}${p.lost ? " lost" : ""}`, "data-i": i,
            title: `${bm ? `★ ${bm.name} · ` : ""}${sideLabel(p)}${s.section ? " · " + s.section : ""}`, onclick: () => open(i, s.page) },
            p.lost ? h("span", { class: "rg-ghost", style: { width: w + "px", height: H + "px" } }, "lost")
              : h("img", { src: imgUrl(s.img, "s", s.v), alt: "", loading: "lazy", style: { width: w + "px", height: H + "px" } }),
            h("span", { class: "rg-lbl" }, short(sideLabel(p)).replace("[f", "[")),
            bm ? h("span", { class: "rg-star", title: bm.name }, "★") : "");
        })));
    }));
    const jump = i => { const c = $(`.rg-cell[data-i="${i}"]`, g); if (c) { c.scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" }); c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); } };
    g.append(
      h("div", { class: "rg-head" },
        h("span", { class: "rg-t" }, "Sections"),
        ...[...firstOf].map(([s, i]) => h("button", { class: "rg-chip", title: `Show the first ${s} page`, onclick: () => jump(i) }, s)),
        ...(Bookmarks.list.length ? [h("span", { class: "rg-t" }, "Bookmarks"),
          ...Bookmarks.sorted().map(b => h("button", { class: "rg-chip bm", title: `Open ${short(b.page)}`, onclick: () => { this.toggleGrid(false); goToPage(b.page); } }, `★ ${b.name}`))] : []),
        h("button", { class: "rg-close", title: "Back to the open book (O or Esc)", onclick: () => this.toggleGrid(false) }, "✕ Close grid")),
      body);
    if (scroll) requestAnimationFrame(() => $(".rg-cell.cur", g)?.scrollIntoView({ block: "center" }));
    else if (keep != null) body.scrollTop = keep;
  },

  markStrip() {
    const cur = new Set();
    const i0 = R.at === 0 ? 0 : 2 * R.at - 1;
    cur.add(i0); if (R.at > 0) cur.add(i0 + 1);
    for (const t of $$("#rd-strip .t")) t.classList.toggle("cur", cur.has(+t.dataset.i));
    const c = $("#rd-strip .t.cur"), strip = $("#rd-strip");
    if (c && strip) {
      const x = c.offsetLeft - strip.clientWidth / 2;
      if (c.offsetLeft < strip.scrollLeft + 40 || c.offsetLeft > strip.scrollLeft + strip.clientWidth - 40) strip.scrollLeft = x;
    }
  },

  key(e) {
    if (e.key === "o" || e.key === "O") { this.toggleGrid(); return; }
    if (e.key === "b" || e.key === "B") { Bookmarks.here(); return; }
    if (R.grid) { if (e.key === "Escape") this.toggleGrid(false); return; }
    if (e.key === "Escape" && R.noteOpen) { this.toggleNote(false); return; }
    // a held key turns one page after another as each lands; its repeats do not queue up turns ahead of the eye
    if (e.key === "ArrowRight" || e.key === "PageDown") { if (!(e.repeat && (R.busy || R.queue.length))) this.step(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { if (!(e.repeat && (R.busy || R.queue.length))) this.step(-1); e.preventDefault(); }
    else if (e.key === "Home") this.go(0, 0);
    else if (e.key === "End") this.go(R.spreads.length - 1, 0);
    else if (e.key === "u" || e.key === "U") this.toggleUnfold();
    else if (e.key === "+" || e.key === "=") this.zoomBy(1.5);
    else if (e.key === "-" || e.key === "_") this.zoomBy(1 / 1.5);
    else if (e.key === "0") this.resetZoom();
    else if (e.key === "g" || e.key === "G") this.ask();
    else if (e.key === "c" || e.key === "C") {
      const p = curSide();
      const sg = p && !p.lost && (p.shown.img ? p.shown : p.segs.find(x => !x.missing));
      if (sg) CropEditor.open(sg.img);
    }
  },
};

const MIN_ZOOM = 1 / 1.5 ** 3, MAX_ZOOM = 5;   // out: three 1.5x steps (30%); in: pages at full size from Yale (Sharp)

/* Sharper pages when zoomed in. The page images here are 1400 px tall; Yale's photographs give about 3,600 px for a
   page. When a page on screen is drawn bigger than its image, it is loaded at full size from Yale's image server and
   swapped in once it has arrived; until then, or if Yale cannot be reached, the page stays as it was. Yale's server
   cuts a crop that is an upright rectangle (almost every page); a slanted one is straightened in the browser, as the
   crop editor does (warp, in work.js), and so is one with a mask (another page showing past a torn edge, blacked
   out). The pages you are likely to zoom into next are loaded ahead (Sharp.ahead, fed by the Reader), so that zooming
   into them is sharp at once. */
const YALE_IIIF = "https://collections.library.yale.edu/iiif/2/";
const SHARP_SAY = { wait: "loading the full-size photograph from Yale", done: "full size, from Yale's photograph",
  fail: "Yale's photograph could not be loaded" };
const SHARP_KEEP = 20;   // full-size pages kept in memory (about 2 MB each): those loaded ahead, then the most recent
const SHARP_AT_ONCE = 2;   // pages loaded ahead at the same time
const loaded = src => new Promise((ok, no) => {   // an image, loaded (not yet decoded: that waits for a visible tab)
  const img = new Image();
  img.onload = () => ok(img); img.onerror = () => no(new Error("Yale's answer is not an image"));
  img.src = src;
});

/* An image from Yale's server, as a Blob. A page usually begins to arrive within 2 seconds, but about one request in five
   is held for some 30 seconds first, whatever is asked. So when nothing has begun to arrive after 6 seconds, ask once
   more (the same image: Yale ignores the "?again") and keep whichever answer comes first. `signal` cancels it all;
   `bytes` hears how much has arrived (Yale does not say how much is coming). */
function fromYale(url, signal, bytes) {
  return new Promise((ok, no) => {
    if (signal?.aborted) { no(new DOMException("no longer wanted", "AbortError")); return; }
    const asks = [];
    let left = 0, settled = false;
    const ask = u => {
      const c = new AbortController();
      asks.push(c); left++;
      fetch(u, { signal: c.signal }).then(r => {
        if (!r.ok) throw new Error(`Yale's server answered ${r.status}`);
        if (settled) return;
        settled = true; clearTimeout(again);
        for (const x of asks) if (x !== c) x.abort();
        return take(r).then(ok, no);
      }).catch(e => { if (--left === 0 && !settled) { settled = true; clearTimeout(again); no(e); } });
    };
    const take = async r => {
      const rd = r.body.getReader(), parts = [];
      for (let n = 0; ;) {
        const { done, value } = await rd.read();
        if (done) break;
        parts.push(value); n += value.length; bytes?.(n);
      }
      return new Blob(parts, { type: r.headers.get("content-type") || "image/jpeg" });
    };
    const again = setTimeout(() => ask(url + "?again"), 6000);
    signal?.addEventListener("abort", () => { clearTimeout(again); for (const x of asks) x.abort(); });
    ask(url);
  });
}

const Sharp = {
  seg: new WeakMap(),     // <img> -> the panel it shows (segEl)
  got: new Map(),         // crop -> Promise of the address (an object URL) of its full-size image
  ready: new Map(),       // crop -> that address, once it has arrived; oldest first
  timer: new WeakMap(),   // box -> its next look
  want: new Map(),        // crop -> panel, the pages to load ahead, most likely first
  busy: new Map(),        // crop -> AbortController, the pages being loaded ahead now
  needed: new Set(),      // crops a page on screen is waiting for: never cancelled
  bytes: new Map(),       // crop -> bytes arrived so far (once loaded, its size)
  boxes: new Map(),       // box -> where it says how its pages are doing, while zoomed in
  said: new WeakMap(),    // where it says it -> [what it said last, the timer that clears it]
  tickT: null,

  crop(seg) { return `${seg.iiif}/${seg.quad.flat().map(Math.round).join(",")}/${seg.rotate || 0}`; },

  /* The pages in `box` are drawn at zoom z: look again soon, and say in `out` how the full-size images are doing. */
  check(box, z, out) {
    cancelAnimationFrame(this.timer.get(box));
    if (z <= 1) {
      out.textContent = ""; box.classList.remove("sharpening"); this.boxes.delete(box);
      clearTimeout(this.said.get(out)?.[1]); this.said.delete(out);
      return;
    }
    this.boxes.set(box, out);
    this.timer.set(box, requestAnimationFrame(() => this.scan(box, out)));
  },

  scan(box, out) {
    if (!box.isConnected) return;
    const dpr = devicePixelRatio || 1, v = box.getBoundingClientRect();
    for (const img of box.querySelectorAll("img")) {
      const seg = this.seg.get(img);
      if (!seg || !seg.iiif || !seg.quad || img.dataset.sharp) continue;
      const r = img.getBoundingClientRect();
      if (r.right < v.left || r.left > v.right || r.bottom < v.top || r.top > v.bottom) continue;   // off screen
      if (r.height * dpr < (img.naturalHeight || 1400) * 1.15) continue;   // its image is still big enough
      const key = this.crop(seg);
      if (this.ready.has(key)) img.dataset.sharp = "swap";   // loaded ahead: no need to say it is loading
      else { img.dataset.sharp = img.dataset.waited = "wait"; this.needed.add(key); }
      this.load(seg, key)
        .then(url => this.swap(img, url))
        .then(() => { img.dataset.sharp = "done"; }, () => { img.dataset.sharp = "fail"; })
        .finally(() => { this.needed.delete(key); this.say(box, out); });
    }
    this.say(box, out);
  },

  /* Show the full-size image in `img` once it is decoded, so the page never goes blank while it is. */
  swap(img, url) {
    const pre = new Image();
    pre.src = url;
    return pre.decode().catch(() => {}).then(() => { img.src = url; });
  },

  /* Say how the pages on screen are doing: while one is loading, a spinner, how much of the pages you had to wait for
     has arrived, and a bar moving along the top of `box` (CSS .sharpening); then, once per zoom, that they are at full
     size (or could not be), for a moment, so nothing stays over the pages. */
  say(box, out) {
    const imgs = $$("img[data-sharp]", box), s = imgs.map(i => i.dataset.sharp);
    const now = ["wait", "fail", "done"].find(x => s.includes(x));
    box.classList.toggle("sharpening", now === "wait");
    const [was, t] = this.said.get(out) || [];
    if (now !== "wait") {
      if (now === was) return;   // said already, and perhaps gone again: not on every pan
      clearTimeout(t);
      out.textContent = SHARP_SAY[now] || "";
      this.said.set(out, [now, now && setTimeout(() => { out.textContent = ""; }, now === "fail" ? 5000 : 2500)]);
      return;
    }
    clearTimeout(t);
    this.said.set(out, ["wait"]);
    const waited = imgs.filter(i => i.dataset.waited);
    const mb = waited.reduce((a, i) => a + (this.bytes.get(this.crop(this.seg.get(i))) || 0), 0) / 1e6;
    out.replaceChildren(h("i", { class: "spin", "aria-hidden": "true" }),
      `${waited.length > 1 ? `loading ${waited.length} full-size photographs from Yale` : SHARP_SAY.wait}…${mb >= .1 ? ` ${mb.toFixed(1)} MB` : ""}`);
  },

  /* Some bytes arrived: say so where pages are waiting, at most four times a second. */
  tick() {
    if (this.tickT) return;
    this.tickT = setTimeout(() => {
      this.tickT = null;
      for (const [box, out] of this.boxes) if (box.isConnected) this.say(box, out); else this.boxes.delete(box);
    }, 250);
  },

  /* Is loading ahead worth it? Only where zooming in shows at least half as much again as the 1400 px images (pages
     drawn `ph` px tall at 100%: on many phones even 500% gains little), and not when the browser asks to save data.
     Zooming in still loads a page when it gains less. */
  worth(ph) {
    return !navigator.connection?.saveData && ph * MAX_ZOOM * (devicePixelRatio || 1) > 1400 * 1.5;
  },

  /* Load these panels' full-size images ahead, most likely first, a few at a time; stop loading any no longer listed. */
  ahead(segs) {
    this.want = new Map(segs.filter(s => s && s.iiif && s.quad && !s.missing).map(s => [this.crop(s), s]));
    for (const [key, c] of this.busy) if (!this.want.has(key) && !this.needed.has(key)) c.abort();
    this.pump();
  },

  pump() {
    for (const [key, seg] of this.want) {
      if (this.busy.size >= SHARP_AT_ONCE) return;
      if (this.got.has(key) || this.busy.has(key)) continue;
      const c = new AbortController();
      this.busy.set(key, c);
      this.load(seg, key, c.signal).catch(() => {}).finally(() => { this.busy.delete(key); this.pump(); });
    }
  },

  load(seg, key, signal) {
    if (!this.got.has(key)) {
      const p = this.fetch(seg.iiif, seg.quad.map(pt => pt.map(Math.round)), ((seg.rotate || 0) % 360 + 360) % 360, signal,
        n => { this.bytes.set(key, n); this.tick(); }, seg.mask);
      p.then(url => {
        this.ready.set(key, url);
        if (this.ready.size > SHARP_KEEP) {   // a page showing it keeps its image; it is only loaded again if drawn anew
          const old = [...this.ready.keys()].find(k => !this.want.has(k));
          if (old) { URL.revokeObjectURL(this.ready.get(old)); this.ready.delete(old); this.got.delete(old); }
        }
      }, e => {
        if (e.name === "AbortError") this.got.delete(key);   // no longer wanted: load it again whenever it is
        else setTimeout(() => this.got.delete(key), 60e3);   // ask Yale again in a minute
      });
      this.got.set(key, p);
    }
    return this.got.get(key);
  },

  async fetch(id, q, rot, signal, bytes, mask) {
    const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
    const upright = q[0][1] === q[1][1] && q[2][1] === q[3][1] && q[0][0] === q[3][0] && q[1][0] === q[2][0];
    const asIs = upright && !mask?.length;   // Yale's crop needs nothing more
    const blob = await fromYale(`${YALE_IIIF}${encodeURIComponent(id)}/${x0},${y0},${x1 - x0},${y1 - y0}/full/${asIs ? rot : 0}/default.jpg`, signal, bytes);
    const url = URL.createObjectURL(blob);
    if (asIs) {
      try { await loaded(url); return url; }
      catch (e) { URL.revokeObjectURL(url); throw e; }
    }
    try {
      const img = await loaded(url), at = ([x, y]) => [x - x0, y - y0];
      const cv = warp({ img, k: img.naturalHeight / (y1 - y0) }, q.map(at), Infinity, rot, mask?.map(poly => poly.map(at)));
      return URL.createObjectURL(await toJpeg(cv, .92));
    } finally { URL.revokeObjectURL(url); }
  },
};

/* Zoom and pan for a box (stage) holding a layer: pinch / ⌘-scroll zooms about the pointer, drag pans when
   zoomed, double-click toggles. Used by the full-sheet viewer; the reader has its own copy wired to R. */
function zoomable(stage, layer, onChange) {
  const st = { z: 1, x: 0, y: 0 };
  const apply = () => {
    layer.style.transformOrigin = "0 0";
    layer.style.transform = st.z > 1 ? `translate(${st.x}px, ${st.y}px) scale(${st.z})` : "";
    stage.classList.toggle("zoomed", st.z > 1);
    onChange && onChange(st);
  };
  const at = (f, cx, cy) => {
    const r = stage.getBoundingClientRect();
    cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
    const z1 = Math.max(1, Math.min(MAX_ZOOM, st.z * f));
    if (z1 === 1) { st.z = 1; st.x = st.y = 0; apply(); return; }
    st.x = cx - (cx - st.x) * (z1 / st.z); st.y = cy - (cy - st.y) * (z1 / st.z); st.z = z1;
    apply();
  };
  stage.addEventListener("wheel", e => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = stage.getBoundingClientRect(); at(Math.exp(-Math.max(-40, Math.min(40, e.deltaY)) * 0.01), e.clientX - r.left, e.clientY - r.top); }
    else if (st.z > 1) { e.preventDefault(); st.x -= e.deltaX; st.y -= e.deltaY; apply(); }
  }, { passive: false });
  stage.addEventListener("dblclick", e => {
    if (e.target.closest("button")) return;
    const r = stage.getBoundingClientRect();
    if (st.z > 1) at(1 / st.z); else at(2.5, e.clientX - r.left, e.clientY - r.top);
  });
  let drag = null;
  stage.addEventListener("pointerdown", e => {
    if (st.z <= 1 || e.button !== 0 || e.target.closest("button")) return;
    drag = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y };
    stage.setPointerCapture(e.pointerId); stage.classList.add("panning");
  });
  stage.addEventListener("pointermove", e => { if (!drag) return; st.x = drag.sx + e.clientX - drag.x; st.y = drag.sy + e.clientY - drag.y; apply(); });
  const end = () => { drag = null; stage.classList.remove("panning"); };
  stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
  return { st, at, reset: () => at(1 / st.z) };
}

// ================================================================ SHEET VIEW (a whole sheet, both faces)
const SheetView = {
  cur: null,
  refresh() {
    const d = $("#sheet-dlg");
    if (d && d.open && this.cur) this.open(this.cur.id, this.cur.face);
  },
  open(id, face = "inside") {
    const sh = SHEETS.get(id);
    this.cur = { id, face };
    let dlg = $("#sheet-dlg");
    if (!dlg) {
      dlg = h("dialog", { id: "sheet-dlg", style: { maxWidth: "96vw", background: "#2d2925", color: "#e9e3d8", borderColor: "#4a443d" } });
      document.body.append(dlg);
    }
    const draw = f => {
      this.cur = { id, face: f };
      dlg.innerHTML = "";
      const rows = sh[f];
      const ncol = rows[0].length;
      const colA = range(0, ncol).map(c => Math.max(...rows.map(r => r[c].missing ? .68 : aspect(r[c]))));
      const widest = colA.reduce((a, b) => a + b, 0);
      const maxH = Math.min((window.innerHeight * 0.8 - 70) / rows.length, 620);
      const ph = Math.min(maxH, (window.innerWidth * 0.92 - 50) / widest);
      const grid = h("div", { style: { display: "grid", justifyContent: "center",
        gridTemplateColumns: colA.map(a => Math.round(a * ph) + "px").join(" ") } });
      rows.forEach(r => r.forEach((s, c) => {
        const el = segEl(s, ph, { labels: true, scribes: S.scribes, size: "l", crop: !s.missing });
        el.style.width = Math.round(colA[c] * ph) + "px";
        grid.append(el);
      }));
      const svStage = h("div", { class: "sv-stage", style: { width: Math.round(widest * ph) + "px", height: Math.round(rows.length * ph) + "px" } }, grid);
      const zoom = zoomable(svStage, grid, st => { lvl.textContent = Math.round(st.z * 100) + "%"; Sharp.check(svStage, st.z, sharp); });
      const lvl = h("button", { title: "Back to the whole sheet", onclick: () => zoom.reset() }, "100%");
      const sharp = h("span", { class: "sv-sharp", role: "status" });
      dlg.append(
        h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px" } },
          h("b", {}, `Sheet ${id} — ${f === "inside" ? "inside face" : "outside face"}`),
          h("span", { style: { color: "#a69d8f" } }, f === "inside" ? "the face inside the fold as bound now" : "the face you see when it is turned over"),
          h("span", { class: "sv-zoom", style: { marginLeft: "auto" } },
            h("button", { "aria-label": "Zoom out", onclick: () => zoom.at(1 / 1.5) }, "−"), lvl,
            h("button", { "aria-label": "Zoom in", onclick: () => zoom.at(1.5) }, "+"), sharp),
          h("button", { onclick: () => draw(f === "inside" ? "outside" : "inside") }, "Turn over"),
          h("button", { onclick: () => dlg.close() }, "Close")),
        svStage,
        h("div", { style: { color: "#a69d8f", fontSize: "11px", marginTop: "6px" } }, "Pinch or ⌘-scroll to zoom · drag to move · double-click a spot"));
    };
    draw(face);
    if (!dlg.open) dlg.showModal();
  },
};

// ================================================================ 3D VIEW
/* The book block lives in view3d.js (WebGL, with three.js in ./vendor), loaded the first time the tab opens. It reads
   this file's globals (SHEETS, ORDERS, POS, sidesOf, handled, varsOf, h, ...) directly. */
const View3D = {
  mod: null, loading: null, pending: null,
  load() {
    this.loading ||= import(ASSETS + "view3d.js").then(m => (this.mod = m.default)).catch(e => {
      this.loading = null;
      $("#v-three").replaceChildren(h("p", { class: "v3-nogl" }, "The 3D view could not load: " + e.message));
      throw e;
    });
    return this.loading;
  },
  /* A view in the URL wins; otherwise go to where Read left off. */
  mount() {
    this.load().then(m => {
      const st = this.pending;
      m.mount(ORDERS.get(S.order), st);
      this.pending = null;
      if (!st && POS.by && POS.by !== "three") m.sync(POS);
    });
  },
  open(order, opts) { if (this.mod) this.mod.open(order, opts); else this.load().then(m => m.open(order, opts)); },   // at once when loaded: what follows sees the new book
  refresh(ids) { this.mod?.refresh(ids); },
  key(e) { this.mod?.key(e); },
  state() { return this.pending || (this.mod ? this.mod.state() : ""); },
  restore(st) { if (this.mod) this.mod.restore(st); else this.pending = st; },
};

// ================================================================ FOLIO ORDER (a section of Info)
/* Open Info at the Folio order section, and flash a sheet there. */
function showFolios(id) {
  Info.at = "quires";
  show("info");
  if (id) setTimeout(() => Collation.reveal(id), 450);
}

const Collation = {
  diffOnly: store.get("foliosDiffOnly", false),

  /* The Folio order section of Info: the order chosen at the top as Davis-style quire tables, next to another order. */
  render() {
    const v = $("#info-folio-body");
    if (!v) return;
    v.innerHTML = "";
    const left = ORDERS.get(S.compare) || ORDERS.get("beinecke"), right = ORDERS.get(S.order);
    const cmpSel = h("select", { "aria-label": "Compare with" }, [...ORDERS.values()].map(o => h("option", { value: o.id }, o.title)));
    cmpSel.value = left.id;
    cmpSel.addEventListener("change", () => { S.compare = cmpSel.value; this.render(); });
    const main = h("div", { class: "co-main" },
      h("div", { class: "co-head" },
        h("span", {}, "Showing ", h("b", {}, right.title), " (change it in the Order menu at the top)"),
        h("label", {}, "next to ", cmpSel),
        left.id === right.id ? "" : h("label", { class: "co-diffonly" }, h("input", { type: "checkbox", checked: this.diffOnly || null,
          onchange: e => { this.diffOnly = e.target.checked; store.set("foliosDiffOnly", this.diffOnly); this.render(); } }), " only quires that differ")),
      right.summary ? h("p", { class: "co-summary" }, right.summary) : "");
    if (left.id === right.id) {   // one order on its own: her diagrams, quire by quire
      main.append(h("div", { class: "info-quires" }, right.gatherings.map(g => h("div", { class: "info-q" },
        h("h4", {}, qWord(g.quire), g.type === "singulions" ? h("small", { class: "muted" }, " · separate sheets") : ""), this.cell(g, right, null, null, "")))));
      if (unplacedOf(right).length)
        main.append(h("p", { class: "muted" }, `Not placed in ${right.title}: ${unplacedOf(right).join(", ")} (${right.mine ? "set aside" : "lost; position unknown"}).`));
      v.append(main);
      requestAnimationFrame(() => $$("table.ft", v).forEach(t => t._arcs && t._arcs()));
      return;
    }
    main.append(h("p", { class: "co-src" }, "Rows in amber sit somewhere else in the left-hand order; page numbers in amber face a different page than before."));
    const grid = h("div", { class: "co-grid" },
      h("div", { class: "h" }, ""), h("div", { class: "h cur" }, left.title), h("div", { class: "h" }, right.title));
    const leftOpen = openings(left);
    // rows follow the right-hand order; a gathering pairs with the left one of the same name, unpaired ones come last
    const usedL = new Set(), rows = right.gatherings.map(gr => {
      const gl = left.gatherings.find(g => g.quire === gr.quire && !usedL.has(g));
      if (gl) usedL.add(gl);
      return [gl, gr, gr.quire];
    });
    for (const gl of left.gatherings) if (!usedL.has(gl)) rows.push([gl, null, gl.quire]);
    let shown = 0;
    for (const [gl, gr, q] of rows) {
      const same = JSON.stringify(gl && [gl.bifolia, gl.type, gl.sheets || null]) === JSON.stringify(gr && [gr.bifolia, gr.type, gr.sheets || null]);
      if (this.diffOnly && same) continue;
      shown++;
      const leftKeys = gl ? this.leaves(gl).map(L => L.key) : [];
      grid.append(h("div", { class: "co-q" }, qTag(q), gr && gr.type === "singulions" ? h("small", {}, "singulions") : ""),
        this.cell(gl, left, null, null, "cur"),
        this.cell(gr, right, same ? null : leftOpen, same ? null : leftKeys, same ? "" : "diff"));
    }
    if (!shown) grid.append(h("div", {}), h("p", { class: "muted" }, "These two orders are identical."), h("div", {}));
    if (unplacedOf(right).length)
      main.append(h("p", { class: "muted" }, `Not placed in ${right.title}: ${unplacedOf(right).join(", ")} (${right.mine ? "set aside" : "lost; position unknown"}).`));
    main.append(grid);
    v.append(main);
    requestAnimationFrame(() => $$("table.ft", v).forEach(t => t._arcs && t._arcs()));
  },

  /* Scroll to a sheet's two leaves in the order shown and flash them (the 3D view's "Folio order" link). */
  reveal(id) {
    const rows = $$(`.co-cell:not(.cur) tr[data-sheet="${CSS.escape(id)}"]`, $("#info-folio-body"));
    if (!rows.length) return;
    rows[0].scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" });
    for (const r of rows) { r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash"); }
  },

  /* Leaves of one gathering in reading order, with what Davis's table shows for each. */
  leaves(g) {
    const out = [];
    const ft = (D.folio_table || {}).folios || {};
    const leaf = (sh, k) => {
      const opts = (g.sheets || {})[sh.id] || {};
      const sides = sidesOf(sh, opts);
      const front = sides[k === 0 ? 0 : 2], back = sides[k === 0 ? 1 : 3];
      const plain = !opts.spine && !opts.inside_out && !opts.rot180;
      const n = sh.leaves[k];
      const row = ft[n];
      const lost = front.lost && back.lost;
      let label = String(n), note = "", scribe = row ? String(row[1]) : "", section = row ? row[0] : (front.segs[0].section || "");
      if (!plain) {   // a re-sewn or turned sheet: name the panels this leaf now carries
        const nums = [...new Set([...front.segs, ...back.segs].map(x => (x.page.match(/^f(\d+)/) || [])[1]).filter(Boolean))];
        label = nums.join(" + ");
        note = front.segs.map(x => short(pageName(x))).join("·") + " / " + back.segs.map(x => short(pageName(x))).join("·");
        const sc = side => [...new Set(side.segs.flatMap(x => x.scribes || []))].join("+");
        scribe = sc(front) === sc(back) ? sc(front) : `${sc(front)}/${sc(back)}`;
        section = front.segs[0].section || section;
      }
      if (lost) scribe = "[lacking]";
      return { key: `${sh.id}:${k}:${opts.spine ?? ""}:${opts.inside_out ? 1 : 0}`, label, note, scribe, section, lost, sh, k };
    };
    const sheets = g.bifolia.map(id => SHEETS.get(id));
    if (g.type === "singulions") sheets.forEach(sh => out.push(leaf(sh, 0), leaf(sh, 1)));
    else { sheets.forEach(sh => out.push(leaf(sh, 0))); sheets.slice().reverse().forEach(sh => out.push(leaf(sh, 1))); }
    return out;
  },

  cell(g, order, compareOpenings, compareKeys, cls) {
    const el = h("div", { class: "co-cell " + cls });
    if (!g) { el.append(h("span", { class: "muted" }, "—")); return el; }
    const L = this.leaves(g);
    const RH = 22;
    const tbl = h("table", { class: "ft" });
    tbl.append(h("colgroup", {}, h("col", { class: "c-sec" }), h("col", { class: "c-q" }), h("col", { class: "c-fol" }), h("col", { class: "c-scr" }), h("col", { class: "c-arc" })));
    tbl.append(h("thead", {}, h("tr", {}, ["Section", "Quire", "Folio", "Scribe", "Structure"].map(t => h("th", {}, t)))));
    const tb = h("tbody");
    L.forEach((leaf, i) => {
      const moved = compareKeys && compareKeys[i] !== leaf.key;
      const tr = h("tr", { class: `${leaf.lost ? "lost" : ""}${moved ? " moved" : ""}`, title: leaf.note || null, "data-sheet": leaf.sh.id },
        h("td", { class: "sec" }, leaf.section),
        i === 0 ? h("td", { class: "q", rowspan: L.length }, String(g.quire)) : "",
        h("td", { class: "fol" }, leaf.label, leaf.note ? h("small", {}, " " + leaf.note) : ""),
        h("td", { class: "scr" }, leaf.scribe));
      if (i === 0) tr.append(h("td", { class: "arc", rowspan: L.length }, this.arcs(g, L, L.map((_, k) => (k + .5) * RH), L.length * RH)));
      tb.append(tr);
    });
    tbl.append(tb);
    tbl._arcs = () => {   // after layout: put the arc ends exactly on the rows' centres
      const rows = [...tb.rows], top = rows[0].offsetTop;
      const ys = rows.map(r => r.offsetTop - top + r.offsetHeight / 2);
      const Hh = rows[rows.length - 1].offsetTop - top + rows[rows.length - 1].offsetHeight;
      $("td.arc", tbl).replaceChildren(this.arcs(g, L, ys, Hh));
    };
    el.append(tbl);
    // the reading sequence page by page, marking openings that are new relative to the other order
    const pages = linearize({ id: order.id, gatherings: [g] }, { ghosts: true });
    const seq = h("div", { class: "seq" });
    pages.forEach((p, i) => {
      const lab = short(sideLabel(p));
      let isNew = false;
      if (compareOpenings && i % 2 === 1 && pages[i + 1]) isNew = !compareOpenings.has(sideLabel(p) + "|" + sideLabel(pages[i + 1]));
      if (compareOpenings && i % 2 === 0 && i > 0) isNew = !compareOpenings.has(sideLabel(pages[i - 1]) + "|" + sideLabel(p));
      seq.append(h("span", { class: isNew ? "np" : "", title: isNew ? "faces a different page than before" : null }, lab), i % 2 === 0 ? "  " : " ");
    });
    el.append(h("div", { class: "seq-h" }, "Pages in reading order"), seq);
    if (g.note) el.append(h("div", { class: "note" }, g.note));
    return el;
  },

  /* Davis-style structure column: one arc per sheet joining its two leaves; outer sheets get wider arcs. */
  arcs(g, L, ys, H) {
    const NS = "http://www.w3.org/2000/svg";
    const m = L.length;
    const pairs = [];
    if (g.type === "singulions") for (let j = 0; j < m / 2; j++) pairs.push([2 * j, 2 * j + 1, 0, 1]);
    else for (let j = 0; j < m / 2; j++) pairs.push([j, m - 1 - j, j, m / 2]);
    const W = g.type === "singulions" ? 30 : 14 + (m / 2) * 10;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("aria-hidden", "true");
    for (const [a, b, depth, total] of pairs) {
      const ya = ys[a], yb = ys[b];
      const rx = g.type === "singulions" ? 14 : 8 + (total - depth) * 10;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", `M 1 ${ya} A ${rx} ${(yb - ya) / 2} 0 0 1 1 ${yb}`);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "#1f2328");
      p.setAttribute("stroke-width", "1.8");
      if (L[a].lost && L[b].lost) p.setAttribute("stroke-dasharray", "4 3");
      svg.append(p);
    }
    return svg;
  },
};

// ================================================================ INFO (guide, Davis's research, sources)
/* One tab for everything to read: who the images and the research belong to, a plain-language guide to the viewer
   (written for a reader of about 15), Lisa Fagin Davis's research (her 2025 post, her quire diagrams, her history of
   the book, the 2026 proposal), notes on single sheets, and the sources. */
const Info = {
  at: null,
  go(anchor) {
    this.at = anchor || null; setHash();
    const t = anchor && document.getElementById("info-" + anchor);
    if (t) t.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
    else $("#v-info").scrollTop = 0;
    for (const b of $$(".info-toc button")) b.classList.toggle("cur", b.dataset.id === anchor);
  },
  link(hash, text) { return h("a", { href: hash, class: "try" }, text); },
  sec(id, title, ...kids) { return h("section", { id: "info-" + id, class: "info-sec" }, h("h2", {}, title), ...kids); },
  fig(svg, cap) { const f = h("figure", { class: "info-fig" }); f.innerHTML = svg; if (cap) f.append(h("figcaption", {}, cap)); return f; },
  cite(k) {
    const s = D.orders.sources[k];
    if (!s) return k;
    const text = s.cite.replace(/\.$/, "");
    return s.url ? h("a", { href: s.url, target: "_blank", rel: "noopener" }, text) : h("span", {}, text);
  },
  render() {
    const v = $("#v-info");
    if (!v.dataset.done) { v.append(this.build()); v.dataset.done = "1"; }
    Collation.render();   // the Folio order section follows the order chosen at the top
    requestAnimationFrame(() => this.go(this.at));
  },

  /* The privacy notice. Settings (contact, host, Clarity id, Cloudflare token) live in privacy.js. */
  privacySec() {
    const P = Privacy, ext = (href, text) => h("a", { href, target: "_blank", rel: "noopener" }, text);
    const status = h("p", { class: "pv-status" });
    const update = () => {
      const c = P.choice();
      status.replaceChildren(h("b", {}, "Your choice: "),
        P.gpc() ? "your browser sends a Global Privacy Control signal, so analytics, including the visit counter, stay off." :
        c === "granted" ? "detailed analytics allowed." : c === "denied" ? "detailed analytics off." : "not made yet; detailed analytics stay off until you allow them.",
        P.local ? " (Analytics never run on a local copy of the site.)" : "");
    };
    update();
    document.addEventListener("vv:privacy", update);
    return this.sec("privacy", "Privacy and cookies",
      h("p", { class: "small muted" }, `Last updated ${P.UPDATED}.`),
      h("p", {}, h("b", {}, "Who runs this site. "), "Voynich Viewer (voynichviewer.com) is an independent, non-commercial project. There are no accounts and no advertising, and no data is sold.",
        P.CONTACT ? [" Questions about your data: ", /^https?:/.test(P.CONTACT) ? ext(P.CONTACT, P.CONTACT) : h("a", { href: "mailto:" + P.CONTACT }, P.CONTACT), "."] : ""),
      h("h3", {}, "Detailed analytics, only if you say yes"),
      h("p", {}, "If you click ", h("b", {}, "Accept"), " in the strip at the bottom of the page, the site loads ", h("b", {}, "Microsoft Clarity"),
        ". Clarity records how the viewer is used: clicks, scrolling and mouse movement, which views you open, your device, browser and screen size, and your approximate location from your IP address. It can replay a visit as a recording. It sets cookies (such as _clck and _clsk) to recognise a returning browser. Microsoft processes this data for the site and may store it outside your country, including in the United States (",
        ext("https://privacy.microsoft.com/privacystatement", "Microsoft privacy statement"), ", ", ext("https://clarity.microsoft.com/terms", "Clarity terms"),
        "). The site uses it only to see which parts of the viewer people use and to find problems."),
      h("p", {}, "The legal basis is your consent. If you click ", h("b", {}, "Reject"), " or close the strip, Clarity is never loaded and sets no cookies. If your browser sends a Global Privacy Control signal, that counts as no."),
      !!P.CF_TOKEN && h("h3", {}, "A visit counter, without cookies"),
      !!P.CF_TOKEN && h("p", {}, "To know roughly how many people use the site, it also counts visits with ", h("b", {}, "Cloudflare Web Analytics"),
        ", whatever you choose above. It sets no cookies and stores nothing in your browser. It records that a page was loaded, with timing figures and coarse details such as your country, browser and device type, and the page that sent you here. According to Cloudflare it does not track individual visitors across sites (",
        ext("https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/", "how it collects data"), ", ", ext("https://www.cloudflare.com/privacypolicy/", "Cloudflare privacy policy"),
        "). The legal basis is the site's legitimate interest in knowing how many people use it. If your browser sends a Global Privacy Control signal, the counter is switched off."),
      h("h3", {}, "Changing your mind"),
      h("p", {}, `Your choice is remembered in this browser for ${P.MONTHS} months, or until this notice changes; then you are asked again. You can change it here at any time, and from the “?” and 🐞 buttons at the top:`),
      status,
      h("div", { class: "pv-btns" },
        h("button", { onclick: () => P.choose("granted"), disabled: P.gpc() || null }, "Allow analytics"),
        h("button", { onclick: () => P.choose("denied") }, "Turn analytics off")),
      h("h3", {}, "What stays in your browser"),
      h("p", {}, "Your crops, your own orders, your view settings and your cookie choice are saved in your browser (localStorage and IndexedDB) so the viewer works the way you left it. They are needed for those features, are not sent to the site or to anyone else, and are not used for tracking. Delete them in ",
        h("button", { class: "linkish", onclick: () => Work.open() }, "Your work"), ", or by clearing this site's data in your browser."),
      h("h3", {}, "Other services your browser contacts"),
      h("p", {}, "The site is hosted on ", P.HOST.name, ", which may log visitors' IP addresses for security and to run the service (", ext(P.HOST.privacy, `${P.HOST.name} privacy`),
        "). The crop editor, and the Reader (which loads the pages around the one you are reading at full size, so that zooming in is sharp at once), load photographs straight from Yale University's image server, which sees your IP address like any website you visit."),
      h("h3", {}, "Your rights"),
      h("p", {}, "Depending on where you live (for example under the GDPR in the EU and UK), you can ask to see, correct or delete data about you, object to its use, withdraw your consent, and complain to your data protection authority. Detailed analytics data is held by Microsoft for the site; it can be deleted on request",
        P.CONTACT ? " (see the contact above)." : "."));
  },

  /* A quire seen from its bottom edge: one V per sheet, outermost first; `hi` is drawn in gold. */
  nest(title, sheets, hi) {
    const step = 22, apex = 50, base = 168;
    const vs = sheets.map((id, i) => {
      const x0 = 20 + i * step, x1 = 260 - i * step, y = apex + i * 14;
      const [a, b] = id.split("|"), gold = id === hi;
      return `<path d="M${x0},${base} L140,${y} L${x1},${base}" fill="none" stroke="${gold ? "#d99a00" : "#6b6255"}" stroke-width="${gold ? 4 : 2.5}"/>
        <text x="${x0}" y="${base + 18}" text-anchor="middle" font-size="11"${gold ? ' font-weight="700"' : ""}>${a}</text>
        <text x="${x1}" y="${base + 18}" text-anchor="middle" font-size="11"${gold ? ' font-weight="700"' : ""}>${b}</text>`;
    }).join("");
    return `<svg viewBox="0 0 280 200" role="img" aria-label="${esc(title)}: ${sheets.join(", ")}, outer to inner">
      <g fill="currentColor"><text x="140" y="22" text-anchor="middle" font-size="13" fill="#646b73">${esc(title)}</text>${vs}
      <text x="140" y="${base + 18}" text-anchor="middle" font-size="10" fill="#646b73">centre</text></g></svg>`;
  },

  /* Sheets read on their own: one small V per sheet, side by side; `hi` is drawn in gold. */
  singles(title, sheets, hi) {
    const n = sheets.length, w = 260 / n, apex = 92, base = 168;
    const vs = sheets.map((id, i) => {
      const x0 = 10 + i * w + 5, x1 = 10 + (i + 1) * w - 5, cx = (x0 + x1) / 2, gold = id === hi;
      return `<path d="M${x0},${base} L${cx},${apex} L${x1},${base}" fill="none" stroke="${gold ? "#d99a00" : "#6b6255"}" stroke-width="${gold ? 4 : 2.5}"/>
        <text x="${cx}" y="${base + 18}" text-anchor="middle" font-size="10.5"${gold ? ' font-weight="700"' : ""}>${id}</text>`;
    }).join("");
    return `<svg viewBox="0 0 280 200" role="img" aria-label="${esc(title)}: ${sheets.join(", ")}, each read on its own">
      <g fill="currentColor"><text x="140" y="22" text-anchor="middle" font-size="13" fill="#646b73">${esc(title)}</text>${vs}</g></svg>`;
  },

  /* The foldouts as Davis describes them (data/folds.json). A drawn leaf is its panels in hinge order, [label, from, to],
     with 0 the spine and 100 the fore-edge. `guess` folds every fold in, which is what the viewer assumed before. */
  foldWays(id, panels, guess) {
    const sh = SHEETS.get(id), f = D.folds?.sheets?.[id]?.folds || {};
    const img = label => sh.inside.flat().find(sg => pageName(sg) === label)?.img;
    return panels.map(([name], j) => {
      if (!j || guess) return 1;
      const prev = panels[j - 1][0], k = name === prev ? img(name) : `${img(prev)}|${img(name)}`;
      return (f[k] || f[k.split("|").reverse().join("|")]) === "out" ? -1 : 1;
    });
  },
  /* A sheet's folds in words: "72r1–72r2 in, 72r2–72r3 out and the crease in 72r3 in". */
  foldWords(id) {
    const sh = SHEETS.get(id);
    if (!sh) return "";   // a sheet the data no longer has: nothing to say, rather than no Info page
    const name = img => short(pageName(sh.inside.flat().find(sg => sg.img === img) || { page: img }));
    const w = Object.entries(D.folds?.sheets?.[id]?.folds || {}).map(([k, way]) =>
      (k.includes("|") ? k.split("|").map(name).join("–") : `the crease in ${name(k)}`) + " " + way);
    return w.length > 1 ? w.slice(0, -1).join(", ") + " and " + w.at(-1) : w[0] || "";
  },
  /* One folded leaf seen from the head of the book: the spine on the left, the panel at the spine at the bottom, each
     layer above it nearer the page it faces (dashed). A panel's dark edge is its inside face; a gold fold goes out. */
  foldSvg(title, panels, ways, facing) {
    const { layer, up } = foldStack(ways), top = Math.max(...layer) + 1;
    const X0 = 50, XS = 2.35, GAP = 24, W = 340, H = 56 + top * GAP, base = H - 14;
    const x = u => X0 + u * XS, y = z => base - z * GAP, mono = 'font-family="ui-monospace, Menlo, monospace"';
    let s = `<text x="${W / 2}" y="16" text-anchor="middle" font-size="12.5" fill="#646b73">${esc(title)}</text>
      <line x1="${x(0)}" y1="${y(top) - 6}" x2="${x(0)}" y2="${base + 8}" stroke="#b9ae98" stroke-width="2"/>
      <text x="${x(0) - 6}" y="${base + 4}" text-anchor="end" font-size="10.5" fill="#646b73">spine</text>
      <line x1="${x(0)}" y1="${y(top)}" x2="${x(100)}" y2="${y(top)}" stroke="#646b73" stroke-width="1.5" stroke-dasharray="5 4"/>
      <text x="${x(50)}" y="${y(top) - 7}" text-anchor="middle" font-size="11" ${mono}>${esc(facing)}</text>`;
    panels.slice(0, -1).forEach(([, from, to], i) => {   // the fold at the end of each panel, round to the next
      const fx = x(to), ya = y(layer[i]), yb = y(layer[i + 1]), r = Math.abs(ya - yb) / 2, out = ways[i + 1] < 0;
      const rx = to > from ? r : Math.min(r, Math.max(3, fx - x(0) - 2));   // a fold just off the spine is drawn narrow, clear of it
      s += `<path d="M${fx},${ya} A${rx},${r} 0 0 ${(to > from) === (ya > yb) ? 0 : 1} ${fx},${yb}" fill="none" stroke="${out ? "#d99a00" : "#8a7a5c"}" stroke-width="${out ? 4 : 2}"/>`;
    });
    panels.forEach(([name, from, to], i) => {
      const x1 = x(Math.min(from, to)), w = Math.abs(to - from) * XS, yy = y(layer[i]);
      const t = `${short(name)} ${up[i] ? "↑" : "↓"}`, tw = t.length * 6.7 + 10, lx = x1 + Math.min(w / 2, Math.max(tw / 2 + 4, w * .3));
      s += `<rect x="${x1}" y="${yy - 3}" width="${w}" height="6" fill="#f3ead6" stroke="#8a7a5c" stroke-width="1"/>
        <rect x="${x1}" y="${up[i] ? yy - 3 : yy + 1}" width="${w}" height="2" fill="#7a5a1e"/>
        <rect x="${lx - tw / 2}" y="${yy - 8}" width="${tw}" height="16" rx="3" fill="#fff" stroke="#d9d5cc"/>
        <text x="${lx}" y="${yy + 4}" text-anchor="middle" font-size="11" ${mono}>${esc(t)}</text>`;
    });
    const words = panels.slice(1).map(([name], j) => (name === panels[j][0] ? `the crease in ${short(name)}` : `${short(panels[j][0])}–${short(name)}`) + (ways[j + 1] < 0 ? " out" : " in"));
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${title}: ${words.join(", ")}`)}"><g fill="currentColor">${s}</g></svg>`;
  },
  /* A drawn leaf, folded every way in (as the viewer guessed) or as Davis describes it, under the page it faces today. */
  foldLeaf(id, leaf, guess) {
    const panels = D.folds?.sheets?.[id]?.drawn?.[leaf];
    if (!panels || !SHEETS.has(id)) return "";
    const pages = linearize(ORDERS.get("beinecke"), { ghosts: true });
    const i = pages.findIndex(p => p.sheet === id && p.face === "inside" && p.leafNo === +leaf), f = pages[i % 2 ? i + 1 : i - 1];
    return this.foldSvg(`leaf ${leaf}, ${guess ? "every fold in (the viewer's guess)" : "as Davis describes it"}`, panels,
      this.foldWays(id, panels, guess), f ? short(sideLabel(f)) : "cover");
  },

  build() {
    const toc = [
      ["Using the viewer", [["what", "What you are looking at"], ["book", "Folded sheets"], ["foldouts", "Foldouts"], ["orders", "The orders"],
        ["colours", "The colours"], ["views", "Three ways to look"], ["yours", "Make it your own"]]],
      ["Lisa Fagin Davis's research", [["blog", "“Voynich Codicology” in brief"], ["quires", "Folio order: her quire diagrams"], ["history", "Her history of the book"],
        ["singulions", "The 2026 proposal"], ["folds", "How the foldouts fold"]]],
      ["Reference", [["sure", "Known or guessed?"], ["notes", "Notes on single sheets"], ["words", "Words used here"], ["sources", "Sources"], ["privacy", "Privacy and cookies"]]]];
    const cite = k => this.cite(k);
    const blogUrl = D.orders.sources.LFD2025blog.url, yaleUrl = D.orders.sources.Yale.url;
    const sheetSvg = `<div class="fig-pair"><svg viewBox="0 0 280 200" role="img" aria-label="One sheet folded in half makes two leaves and four pages">
      <g font-size="13" fill="currentColor">
        <text x="140" y="22" text-anchor="middle" fill="#646b73">one sheet, outside face</text>
        <rect x="20" y="40" width="240" height="120" rx="4" fill="#f3ead6" stroke="#8a7a5c"/>
        <line x1="140" y1="40" x2="140" y2="160" stroke="#8a7a5c" stroke-dasharray="5 4"/>
        <text x="80" y="95" text-anchor="middle">leaf 8</text><text x="80" y="113" text-anchor="middle" fill="#646b73">back: 8v</text>
        <text x="200" y="95" text-anchor="middle">leaf 1</text><text x="200" y="113" text-anchor="middle" fill="#646b73">front: 1r</text>
        <text x="140" y="184" text-anchor="middle" fill="#646b73">fold on the dashed line; inside: 1v | 8r</text>
      </g></svg>
      <svg viewBox="0 0 280 200" role="img" aria-label="Quire 4: four sheets tucked inside each other; the second from the outside is Scribe 2's">
      <g font-size="13" fill="currentColor">
        <text x="140" y="22" text-anchor="middle" fill="#646b73">quire 4, seen from the bottom edge</text>
        <path d="M20,170 L140,50 L260,170" fill="none" stroke="#2f7fd1" stroke-width="3"/>
        <path d="M45,170 L140,72 L235,170" fill="none" stroke="#d1495b" stroke-width="3"/>
        <path d="M70,170 L140,94 L210,170" fill="none" stroke="#2f7fd1" stroke-width="3"/>
        <path d="M95,170 L140,116 L185,170" fill="none" stroke="#2f7fd1" stroke-width="3"/>
        <g font-size="11"><text x="12" y="190">25</text><text x="38" y="190">26</text><text x="63" y="190">27</text><text x="88" y="190">28</text>
        <text x="176" y="190">29</text><text x="201" y="190">30</text><text x="226" y="190">31</text><text x="251" y="190">32</text></g>
      </g></svg></div>`;
    const q9 = ["67v2", "67v1", "68r1", "68r2", "68r3"];
    const q9Svg = `<svg viewBox="0 0 440 170" role="img" aria-label="Quire 9 is one long sheet of five panels; today it is sewn between 67v1 and 68r1, Davis says first between 67v2 and 67v1">
      <g font-size="13" fill="currentColor">
        <text x="220" y="18" text-anchor="middle" fill="#646b73">quire 9: one long sheet, inside face, opened out flat</text>
        <text x="100" y="42" text-anchor="middle" font-size="12" fill="#a06f00" font-weight="700">first sewn here (Davis)</text>
        ${q9.map((p, i) => `<rect x="${20 + i * 80}" y="54" width="80" height="70" fill="#f3ead6" stroke="#8a7a5c"/><text x="${60 + i * 80}" y="94" text-anchor="middle">${p}</text>`).join("")}
        <line x1="100" y1="48" x2="100" y2="130" stroke="#d99a00" stroke-width="4" stroke-dasharray="7 5"/>
        <line x1="180" y1="48" x2="180" y2="130" stroke="#1f2328" stroke-width="4"/>
        <text x="180" y="150" text-anchor="middle" font-size="12">sewn here today</text>
      </g></svg>`;
    const q1Svg = `<div class="fig-pair">${this.nest("quire 1 as bound today", ["1|8", "2|7", "3|6", "4|5"])}${this.singles("quire 1, each sheet on its own", ["1|8", "2|7", "3|6", "4|5"])}</div>`;
    const q13Svg = `<div class="fig-pair">${this.nest("quire 13 as bound today", ["75|84", "76|83", "77|82", "78|81", "79|80"], "78|81")}${this.singles("quire 13, Davis's order", ["77|82", "78|81", "75|84", "76|83", "79|80"], "78|81")}</div>`;
    const chip = n => h("span", { class: "chip", style: { "--c": `var(--h${n})` } }, `Scribe ${n}`);
    const bind = ORDERS.get("beinecke");


    // notes on single sheets, in the order of the binding
    const ev = D.orders.evidence || {};
    const noteIds = bind.gatherings.flatMap(g => g.bifolia).filter(id => ev[id]);
    const notes = h("div", { class: "info-notes" }, noteIds.map(id => h("div", { class: "info-note" },
      h("div", { class: "nh" }, h("b", {}, `Sheet ${id}`), h("span", { class: "muted" }, ` · quire ${SHEETS.get(id).quire}`),
        h("a", { href: `#three/beinecke/s=${id.replace("|", "-")}&v=1&i=1`, class: "try small" }, "See it in 3D")),
      ev[id].map(e => h("p", {}, e.text, " ", h("span", { class: "src" }, "(", cite(e.src), ")"))))));

    const timeline = [
      ["Early 1400s", "The book is written, illustrated and bound in the right order, probably between wooden boards covered in leather."],
      ["Later 1400s", "Something, perhaps the spill that stained the top margins of the first seven quires, means the book has to be taken apart, dried and bound again. The sheets get mixed up, almost certainly by accident, and the quire numbers are written at the end of each quire."],
      ["Date unknown", "Quires 16 and 18 are taken out: their numbers are skipped."],
      ["Date unknown", "Quire 9 is re-sewn at the wrong fold. Why is not known."],
      ["1600s, Prague", "The folio numbers are added. Fourteen leaves go missing soon after."],
      ["1800s, Rome", "The book is bound in its present soft parchment covers, probably by the Jesuits who owned it then."],
      ["Late 1910s, New York", "Wilfrid Voynich puts a chemical on folio 1r to bring out faded writing, and does some repairs of his own."],
      ["1967, New York", "Hellmut Lehmann-Haupt, working for the dealer Hans P. Kraus, leaves notes about his repairs inside the back cover."],
      ["Early 2000s, New Haven", "Yale's conservators repair damage and strengthen the most fragile parts."]];

    const tocEl = h("nav", { class: "info-toc", "aria-label": "Contents" }, toc.map(([part, items]) => h("div", { class: "toc-part" },
      h("div", { class: "toc-h" }, part), items.map(([id, t]) => h("button", { class: "linkish", "data-id": id, onclick: () => this.go(id) }, t)))));

    const body = h("div", { class: "info-body" },
      h("h1", {}, "About this viewer"),
      h("p", { class: "lead" }, "What you see in Voynich Viewer, how to use it, and the research it rests on, in plain words. You do not need to know anything about old books to follow it."),

      // ---------------------------------------------------------------- using the viewer
      h("div", { class: "info-part" }, "Using the viewer"),
      this.sec("what", "What you are looking at",
        h("p", {}, "The Voynich Manuscript is a hand-written book from the early 1400s, full of drawings of plants, stars and women bathing in pools. It is kept at Yale University's Beinecke Library, where its shelf mark is ", h("b", {}, "MS 408"), ". Nobody has been able to read its writing."),
        h("p", {}, "Yale has photographed every page. This viewer cuts those photographs up so that each piece of parchment becomes a sheet you can hold: you can turn pages, unfold the fold-out pages, and see the whole book in 3D. You can also put the sheets in the order Lisa Fagin Davis thinks they were in before the book was rebound, or in any order you like.")),

      this.sec("book", "The book is a pile of folded sheets",
        this.fig(sheetSvg, "The first drawing is one sheet, flat. The second is quire 4 seen from its bottom edge: each “V” is one sheet, and the point of the V is the fold. The red sheet (26|31) is in Scribe 2's handwriting, the blue ones in Scribe 1's."),
        h("ul", {},
          h("li", {}, "Take one sheet of parchment (prepared animal skin) and fold it in half. You get two ", h("b", {}, "leaves"), ". Each leaf has a front (", h("i", {}, "recto"), ", written “r”) and a back (", h("i", {}, "verso"), ", “v”). So one folded sheet makes four pages."),
          h("li", {}, "A sheet is named after its two leaves: sheet ", h("b", {}, "1|8"), " is leaf 1 plus leaf 8."),
          h("li", {}, "Sheets are tucked inside each other in bundles called ", h("b", {}, "quires"), ", the way you make a booklet: 1|8 wraps 2|7, which wraps 3|6 and 4|5. That is why leaf 1 and leaf 8 are halves of the same sheet even though they are far apart when you read."),
          h("li", {}, "The quires are sewn together through their middle fold. The order the sheets are sewn in is the ", h("b", {}, "binding"), ". Some sheets have been lost over the centuries; the viewer shows them as dashed outlines."))),

      this.sec("foldouts", "Foldouts",
        h("p", {}, "Some sheets are much bigger than a page. They have extra panels that fold in, so the sheet fits inside the book and opens out like a map. The biggest is the Rosettes sheet (85|86), six panels in two rows. Quire 9 (sheet 67|68) is a strip of five panels."),
        h("p", {}, "In the Reader, a folded foldout is a leaf like any other: you see the panel at its spine on each face, and the panels inside the folds stay hidden until you unfold it. Wherever there is a foldout, a gold ", h("b", {}, "Unfold"), " button comes up over the foot of the pages (or press ", h("kbd", {}, "U"), "), and the strips along the bottom show foldouts as wider marks. In 3D the same button unfolds the sheet you have picked, fold by fold; to open one fold at a time, click a flap, or use the list of folds beside the sheet. Each fold turns the way Davis describes, in or out (see ", h("button", { class: "linkish", onclick: () => this.go("folds") }, "How the foldouts fold"), ")."),
        h("p", {}, "The Rosettes sheet opens as the real one does: its right-hand column swings out first, then the whole top half lifts in one piece. ", h("a", { href: "https://collections.library.yale.edu/catalog/2002046?child_oid=1006229", target: "_blank", rel: "noopener" }, "Yale's photograph of it half open"), " shows the top half lying folded down as a single strip.")),

      this.sec("orders", "The orders in the menu",
        h("p", {}, "The ", h("b", {}, "Order"), " menu at the top changes the order of the sheets everywhere at once: in 3D, in the Reader and in the Folio order tables."),
        h("ul", {},
          h("li", {}, h("b", {}, "Current binding. "), "The book exactly as it is sewn today."),
          h("li", {}, h("b", {}, "Davis: proposed order. "), "Everything Lisa Fagin Davis has proposed about the order of the book, in one sequence. It makes the three changes explained just below. Only quires 13 and 20 get a new order of sheets; in every other quire, quires 1–8 included, the sheets stay in today's sequence, which is not part of the proposal."),
          h("li", {}, h("b", {}, "Your own orders. "), "Any order you make with ", h("b", {}, "Rearrange"), " in 3D appears here too (see ", h("button", { class: "linkish", onclick: () => this.go("yours") }, "Make it your own"), ").")),
        h("h3", {}, "Change 1: every sheet is read on its own"),
        this.fig(q1Svg, "Quire 1 seen from its bottom edge; each V is one sheet. Left: today the sheets are tucked inside each other. Right: Davis's order reads each sheet on its own, one after another, here in today's sequence, which is not part of the proposal."),
        h("p", {}, "Today the sheets of a quire are tucked inside each other, so 1v faces 2r. Davis and Colin Layfield found that the two halves of one sheet have more in common than pages that face each other across sheets. So they think each sheet was written, and meant to be read, on its own: 1r, 1v, 8r, 8v, then the next sheet. A folded sheet read like this is called a ", h("b", {}, "singulion"), "."),
        h("h3", {}, "Change 2: quires 13 and 20 in a new order"),
        this.fig(q13Svg, "Quire 13 seen from its bottom edge. Left: as bound, five sheets tucked inside each other. Right: Davis's order, each sheet on its own, in the order that makes neighbouring pages most alike. Sheet 78|81 is gold."),
        h("p", {}, "For quires 13 and 20 they also worked out which order of the sheets makes neighbouring pages most alike (the numbers are under ", h("button", { class: "linkish", onclick: () => this.go("singulions") }, "The 2026 proposal"), "). Every other quire, quires 1–8 included, keeps today's order of sheets. That order is not part of the proposal, and Davis has no results for quires 1–8 yet."),
        h("p", {}, "Read on its own, sheet 78|81 opens at 78v | 81r. Page 78v has water pipes (\u201cwaterspouts\u201d) on it, and 81r women bathing in pools: facing each other, the spouts line up with the pools across the fold. In today's binding those two pages don't face each other at all. Nick Pelling spotted this first, and Davis points to it in her 2025 post."),
        this.link("#read/davis/81r", "See 78v and 81r side by side"),
        h("h3", {}, "Change 3: quire 9 was sewn at a different fold"),
        this.fig(q9Svg, "Quire 9 is one long sheet with five panels. Today it is sewn at the fold between 67v1 and 68r1 (black line). Davis found tiny old sewing holes in the fold between 67v2 and 67v1 (gold line), so that is where it was first sewn."),
        h("p", {}, "There is a second clue. Each quire has a small number written on it, the ", h("b", {}, "quire mark"), ", and quire marks sit on the last page of a quire. Sewn the old way, quire 9's mark (on 67r1) lands on its last page, where it belongs."),
        this.link("#three/davis/s=67-68&v=1&i=1", "See quire 9 in 3D")),

      this.sec("colours", "What the colours mean",
        h("ul", {},
          h("li", {}, h("b", {}, "Scribe. "), "Davis found five different handwritings, called Scribe 1 to 5: ", ...[1, 2, 3, 4, 5].map(chip),
            ". In the Reader, the ", h("b", {}, "Scribes"), " button puts a coloured bar on top of each page. In 3D, the ", h("b", {}, "Colour"), " menu paints the edges of the sheets."),
          h("li", {}, h("b", {}, "Section. "), "What the pages are about: plants, stars, zodiac, bathing, recipes and so on. The names are Davis's; she notes that they are conventions, not proven."),
          h("li", {}, h("b", {}, "Illustration. "), "What kind of picture is on each page, from the transliteration file's page labels."),
          h("li", {}, h("b", {}, "Currier language. "), "In the 1970s Prescott Currier noticed that the writing comes in two flavours, A and B, with different favourite words and spellings (a bit like British and American spelling, but stronger). Scribe 1 writes A; Scribes 2, 3 and 5 mostly write B."),
          h("li", {}, h("b", {}, "Moved from the binding. "), "With another order chosen, the sheets that sit somewhere else, or are sewn at another fold, light up."),
          h("li", {}, h("b", {}, "Quire. "), "Every other quire of the current binding gets a lighter colour, so you can see where each quire starts and ends."))),

      this.sec("views", "Ways to look",
        h("ul", {},
          h("li", {}, h("b", {}, "3D. "), "The whole book as a block of sheets. Drag to turn it, scroll to zoom, and press ", h("kbd", {}, "1"), "–", h("kbd", {}, "5"), " for ready-made views (", h("kbd", {}, "3"), " looks down on the top edge, where nested sheets show as Vs, like the drawings above). The ", h("b", {}, "Spread"), " slider fans the sheets apart. Click a sheet to pull it out: you can turn it over, unfold it and read its notes. ", h("b", {}, "Opening"), " opens the book flat at a page, as in the Reader, and ", h("b", {}, "Touching faces"), " lists which pages lay against each other when the book was closed."),
          h("li", {}, h("b", {}, "Reader. "), "Turn the pages like a book, two at a time: ", h("kbd", {}, "←"), " ", h("kbd", {}, "→"), " or the arrows. ", h("kbd", {}, "G"), " jumps to a page (try “78v”). Pinch or ⌘-scroll to zoom: as you read, the pages around the one you are on are loaded at full size from Yale's photographs, so zooming in is sharp at once (you need to be online for the finest detail). ", h("b", {}, "▦ Grid"), " (or ", h("kbd", {}, "O"), ") shows every page at once, quire by quire, with buttons to jump to each section and to your bookmarks: click any page to open it. The strip at the bottom is the whole book; amber quires are the ones the chosen order changes. Under the pages, “new pair” means those two pages don't face each other in today's binding, and “two halves of sheet 1|8” means you are looking into the fold of one sheet. In Davis's order you often see both together: reading each sheet on its own puts its two halves face to face."),
          h("li", {}, h("b", {}, "Folio order. "), "Further down this page (", h("button", { class: "linkish", onclick: () => this.go("quires") }, "Folio order"), "): the order as tables laid out like Davis's own quire diagrams, next to another order if you like. Each row is a leaf, and the arcs join the two leaves of one sheet.")),
        h("div", { class: "callout" }, h("b", {}, "3D and the Reader stay in step. "), "Go to a page in the Reader, then open 3D: the sheet that page is on is picked out in gold. Pick a sheet or an opening in 3D, then open the Reader: you are on that page. Double-click a sheet in 3D, or press ", h("kbd", {}, "Enter"), ", to read from there.")),

      this.sec("yours", "Make it your own",
        h("h3", {}, "Re-cut a page"),
        h("p", {}, "Every page picture is cut out of one of Yale's photographs, and some cuts are a little loose. To re-cut a page, hover over it in the Reader and click ", h("b", {}, "✂ Crop"), " (or press ", h("kbd", {}, "C"), "), or use ", h("b", {}, "✂ Crop a page"), " when you pull a sheet out in 3D. Drag the gold corners onto the edges of the page; ", h("b", {}, "Fit to the page edge"), " does it for you wherever the page meets the dark background. The editor loads the photograph straight from Yale, so you need to be online."),
        h("h3", {}, "Put the sheets in your own order"),
        h("p", {}, "In 3D, press ", h("b", {}, "✎ Rearrange"), " (or ", h("kbd", {}, "A"), "). The room darkens and the book comes apart on the table: each quire lies open as a pile, in the order of the book. A quire whose sheets are tucked inside each other is stacked the way it lies opened at its centre, the centre sheet on top; sheets read one by one are fanned out like cards. Point at a sheet and the panel at the top left shows where it is in its pile and the sheet from both sides; a stack opens out as you point at it."),
        h("p", {}, "It works like a drawing program. Click a sheet to select it, ", h("kbd", {}, "⇧"), "- or ", h("kbd", {}, "⌘"), "-click to add more, or drag across the table to select a box of them. Drag the selection onto a pile to put it there (the pile lights up and opens where it will go, and the panel shows the quire with your sheets in gold), or into the gap between two piles to make a new quire there. ", h("kbd", {}, "⌘G"), " makes a new quire of the selected sheets, or merges selected quires; ", h("kbd", {}, "⇧⌘G"), " splits a quire into single sheets; ", h("kbd", {}, "⌘]"), " and ", h("kbd", {}, "⌘["), " move a sheet toward the centre or outward (", h("kbd", {}, "⌥"), ": all the way); ", h("kbd", {}, "⌫"), " sets it aside; ", h("kbd", {}, "⌘X"), " and ", h("kbd", {}, "⌘V"), " cut and paste. Click a quire's name to select the quire, double-click it to rename it, drag it to move the quire. Right-click anything for its menu; ", h("b", {}, "⌨"), " lists every shortcut. The list button beside it opens Rearrange as it used to be: every quire and its sheets in a column, dragged by ", h("b", {}, "⠿"), "; a change made there plays out on the table, and the selection is shared. ", h("b", {}, "Done"), " (or ", h("kbd", {}, "Esc"), ") puts the book back together, and each change plays out in 3D; ", h("kbd", {}, "⌘Z"), " (", h("kbd", {}, "Ctrl Z"), ") undoes it. On a phone, Rearrange opens as a panel under the book instead."),
        h("p", {}, "A gold dot marks a quire or sheet you have changed; a sheet's menu has ", h("b", {}, "Put back"), " to return it to where it was. ", h("b", {}, "Hide lost sheets"), " (", h("kbd", {}, "L"), ") leaves the lost sheets out of the 3D book, in Rearrange or not."),
        h("p", {}, "Your order is saved as you change it, so there is nothing to save. Nothing is lost either: each time before you rearrange it, the order as it was is kept. ", h("b", {}, "Earlier versions"), " in Rearrange's ", h("b", {}, "⋯"), " (or ", h("b", {}, "Versions"), " in Your work) lists them, to restore one or open it as a copy."),
        h("p", {}, "The built-in orders never change: your first move makes your own copy, which appears in the Order menu, and the message that says so has an ", h("b", {}, "Undo"), ". The Reader and the Folio order tables follow your copy too."),
        h("h3", {}, "Hide gatherings like layers"),
        h("p", {}, "In Rearrange, right-click a quire's name and choose ", h("b", {}, "Hide in 3D"), ": it hides in 3D, so you can look at the rest of the book without it, the way you hide a layer in a drawing program. Nothing about the order changes, and the Reader still shows every page. ", h("b", {}, "Show every quire in 3D"), " in Rearrange's ", h("b", {}, "⋯"), " brings it back, and so does picking one of its sheets."),
        h("h3", {}, "Bookmarks"),
        h("p", {}, "In the Reader, click the ☆ in the corner of a page to bookmark exactly that page; in 3D, the ☆ next to a page when you pull a sheet out. ", h("kbd", {}, "B"), " or the ", h("b", {}, "☆ Bookmark"), " button lets you pick a page of the opening or sheet you are on. ", h("button", { class: "linkish", onclick: () => Bookmarks.open() }, "★"), " at the top lists your bookmarks: give each one a name (✎), and click one to go there. 3D and the Reader both go to it, and bookmarked pages carry a gold mark in the strip at the bottom and in the grid."),
        h("h3", {}, "Keeping your work"),
        h("p", {}, "Your crops, orders and bookmarks are saved in this browser as you go. ", h("button", { class: "linkish", onclick: () => Work.open() }, "Your work"), " (top right) exports them as a small progress file, and imports that file again, here or in another browser.")),

      // ---------------------------------------------------------------- Davis's research
      h("div", { class: "info-part" }, "Lisa Fagin Davis's research"),
      this.sec("blog", "“Voynich Codicology” (2025) in brief",
        h("p", {}, "Lisa Fagin Davis is a paleographer (she studies old handwriting) and a codicologist (she studies how books are physically made). In her post ", h("a", { href: blogUrl, target: "_blank", rel: "noopener" }, "“Voynich Codicology”"), " of 19 January 2025 she pulls together the physical evidence for the book's early history. What follows is a summary in our own words; read the post for her full argument and her pictures."),
        h("h3", {}, "Who wrote it"),
        h("p", {}, "In the 1970s Prescott Currier saw two hands in the plant section and linked them to his two “languages”, A and B. Davis finished that work and found five scribes. That suggests the book was made by a group of people working together, not by one person."),
        h("h3", {}, "The scribes change sheet by sheet"),
        h("p", {}, "Normally scribes write a quire page after page. Quires 1 to 3 are all Scribe 1, as you would expect. But in quire 4 the outermost sheet (25|32) is Scribe 1, the next (26|31) Scribe 2, and the last two Scribe 1 again. The work is organised by sheet, not by quire, and that recurs through the book. Davis has never seen this in a medieval manuscript."),
        h("p", {}, "She weighs the explanations: the scribes wrote on loose sheets first (unlikely, because a herbal arranges its plants on some system, so the order matters); the book is a modern forgery (she has found no compelling evidence for it: the parchment is radiocarbon-dated to the early 1400s, and the inks, pigments, thread, covers and the book's known history all fit); or the book was rebound and the sheets mixed up. She concludes the last is most likely, and four kinds of physical evidence support it."),
        h("h3", {}, "Folio numbers"),
        h("p", {}, "Each leaf has a number in the top right corner of its front, written in the 1600s. Leaf 11v faces 13r, and a stub in the gutter shows that leaf 12 was cut out. Fourteen numbers are skipped, so fourteen leaves went missing after the numbering. Whether any were lost before it cannot be known."),
        h("h3", {}, "Quire numbers"),
        h("p", {}, "Each quire has its number on its last page, to help the binder; for example “2us” (for ", h("i", {}, "secundus"), ") on 16v. Their style looks much older than the folio numbers. If the sheets were shuffled, the quire numbers were most likely added after the shuffle, which puts the rebinding early: within about a century of the writing."),
        h("h3", {}, "The stain"),
        h("p", {}, "A large stain, probably from water, runs along the top margin of the first several dozen leaves. Had the sheets been in today's order when it happened, the stain would grow or shrink smoothly from page to page. It doesn't: the stain on 32v is much smaller and narrower than on the facing 33r, so the spill came before the sheets were mixed up. The folio numbers are written over the stain, not smudged by it, so the spill also came before the 1600s. Wet parchment has to be taken apart to dry, and loose, unnumbered sheets are easy to rebind in the wrong order. Paint that rubbed off onto facing pages matches today's order, so the sheets were rebound before they were fully dry."),
        h("h3", {}, "Two early changes"),
        h("p", {}, "The waterspouts on 78v line up with the pools on 81r, so 78|81 was once the centre of its quire (Nick Pelling's observation, in ", h("i", {}, "The Curse of the Voynich"), "). And quire 9 was first sewn at another fold, which puts its quire number on its last page. The quire 9 change happened after the quire numbers were written and before the folio numbers. Both are built into ", h("button", { class: "linkish", onclick: () => this.go("orders") }, "“Davis: proposed order”"), ": quire 9 is re-sewn there, and because every sheet is read on its own, 78v faces 81r."),
        h("h3", {}, "Her caution"),
        h("p", {}, "Davis stresses that this is her interpretation, from several examinations of the manuscript in person; others may read the evidence differently, and more evidence (offsets, other stains, damage) is still to be studied. Why it matters: if the original order of the leaves can be recovered, we are a step closer to understanding the book."),
        h("p", { class: "small muted" }, "She credits Prescott Currier (the two hands), Nick Pelling (the waterspouts), Beinecke conservator Paula Zyatts (who observed that the book was rebound at least once; ", cite("Clemens2016"), ") and binding expert Vladimir Dulov (who has written about the binding on his blog).")),

      this.sec("quires", "Folio order: her quire diagrams",
        h("p", {}, "Davis draws each quire as a table. Read each one like this:"),
        h("ul", {},
          h("li", {}, h("b", {}, "Section"), ": what the pictures on that leaf show (the usual names, which she calls conventions)."),
          h("li", {}, h("b", {}, "Quire"), ": the quire's number, as written on its last page."),
          h("li", {}, h("b", {}, "Folio"), ": the leaf's number."),
          h("li", {}, h("b", {}, "Scribe"), ": who wrote that leaf."),
          h("li", {}, h("b", {}, "Structure"), ": each arc joins the two leaves of one sheet. The outermost sheet has the widest arc.")),
        h("p", {}, "Her whole collation fits in one line, the ", h("b", {}, "collation statement"), ". The big number is the quire, the small one how many leaves it has, and the brackets say which are lost:"),
        h("p", { class: "info-formula" }, "1⁸, 2⁸⁻¹ (−f12), 3–7⁸, 8¹⁰⁻⁶ (−59–64), 9–11², 12²⁻¹ (−74), 13¹⁰, 14¹, 15⁴, [16 lost: 91–92], 17⁴, [18 lost: 97–98], 19⁴, 20¹⁴⁻² (−109–110)"),
        h("p", { class: "small muted" }, "The tables are rebuilt from her diagrams and her list of scribes (she notes these correct some of her 2020 diagrams); with the current binding chosen, they are her diagrams. Lost leaves are in grey italics. Pick any order in the menu at the top to see it the same way, and choose a second order to compare it with."),
        h("div", { id: "info-folio-body", class: "info-folio" })),

      this.sec("history", "Her history of the book",
        h("p", {}, "Putting the evidence together, Davis sketches what happened to the book, as far as it can be traced:"),
        h("ol", { class: "info-timeline" }, timeline.map(([when, what]) => h("li", {}, h("b", {}, when), h("span", {}, what))))),

      this.sec("singulions", "The 2026 proposal, with Colin Layfield",
        h("p", {}, "In 2026 Colin Layfield and Lisa Fagin Davis went further (", cite("LD2026"), "). They compared the vocabulary of pages using latent semantic analysis (LSA), a way of measuring how alike two texts are. They found that the two halves of one sheet are more alike than pages that face each other in the binding (quire 1: 0.399 against 0.246), the reverse of two ordinary manuscripts they used as controls."),
        h("p", {}, "They read that as a sign that the book was written sheet by sheet, and meant to be read as a series of ", h("b", {}, "singulions"), ": single folded sheets, each read on its own (first leaf front, first leaf back, second leaf front, second leaf back), then the next sheet. Where the vocabulary allowed, they also worked out the best order of the sheets in quires 13 and 20:"),
        h("table", { class: "info-table" },
          h("tr", {}, h("th", {}, "Quire"), h("th", {}, "As bound (outer → inner)"), h("th", {}, "Proposed"), h("th", {}, "Basis")),
          h("tr", {}, h("td", {}, "9"), h("td", {}, "67|68, sewn between 67v1 and 68r1"), h("td", {}, "67|68, sewn between 67v2 and 67v1"), h("td", {}, "sewing holes; quire mark position (", cite("LFD2025blog"), ")")),
          h("tr", {}, h("td", {}, "13 (blog)"), h("td", {}, "78|81 second from the centre"), h("td", {}, "78|81 innermost, so 78v faces 81r"), h("td", {}, "the waterspouts run across the gutter (", cite("LFD2025blog"), ", after Pelling)")),
          h("tr", {}, h("td", {}, "all others"), h("td", {}, "nested quires (e.g. 1|8 wraps 2|7, 3|6, 4|5, so 1v faces 2r)"), h("td", {}, "each sheet read on its own, in today's sequence, not re-ordered (1r, 1v | 8r, 8v | 2r …)"), h("td", {}, "conjoint pages more alike than facing ones, e.g. quire 1: 0.399 vs 0.246 (", cite("LD2026"), ", table 8)")),
          h("tr", {}, h("td", {}, "13"), h("td", {}, "75|84, 76|83, 77|82, 78|81, 79|80 (nested)"), h("td", {}, "77|82, 78|81, 75|84, 76|83, 79|80 (singulions)"), h("td", {}, "LSA facing score 0.461 → 0.517 (", cite("LD2026"), ", table 14)")),
          h("tr", {}, h("td", {}, "13, runner-up"), h("td", {}, ""), h("td", {}, "76|83, 77|82, 79|80, 75|84, 78|81"), h("td", {}, "0.494 (table 15); it starts on 76r, which opens with an enlarged initial")),
          h("tr", {}, h("td", {}, "20"), h("td", {}, "103|116 … 108|111, [109|110] (nested)"), h("td", {}, "105|114, 104|115, 106|113, 107|112, 108|111, 103|116 (singulions); 109|110 unplaced"), h("td", {}, "LSA 0.438 → 0.526 (table 14); it opens on 105r, the only page of the section that starts with an oversize glyph, and ends on 116v, originally blank"))),
        h("p", {}, "They left the plant sheets in their current sequence, because each page is about a different plant, and they did not test the recipe (pharmaceutical) quires."),
        h("div", { class: "callout" }, h("b", {}, "How sure is this? "),
          "Davis and Layfield call it a hypothesis: until the text can be read, the order cannot be confirmed. They tested only quires 13 and 20. In her Toronto lecture (", cite("LFD2025talk"), ") Davis also described work in progress on using the shrinking waterstains in the early quires to recover their original nesting, with no firm results yet (", cite("Pelling2025"), "). Nick Pelling argues that LSA similarity is a prompt for codicology rather than codicological evidence."),
        h("p", {}, "The top sequences, with quire 9 re-sewn, are in the Order menu as ", h("b", {}, "Davis: proposed order"), ". To try the runner-up, choose that order, open ", h("button", { class: "linkish", onclick: () => this.go("yours") }, "Rearrange"), " in 3D and drag quire 13's sheets into the order 76|83, 77|82, 79|80, 75|84, 78|81.")),

      this.sec("folds", "How the foldouts fold (2026)",
        h("p", {}, "Folded inside the book, a foldout's extra panels lie on top of each other, and which way each fold goes decides which faces touch. The viewer used to guess that every fold goes in, onto the inside of the sheet. In October 2026, on the forum The Voynich Ninja, Davis went through every foldout as it is bound today: which way each fold goes, and which faces touch when the book is closed (", cite(D.folds?.src), "). She also pointed to the photographs that show where the extra creases are."),
        h("p", {}, "Most folds do go in. Three go out, so the outside faces meet there: the crease in 68r3, the fold between 72r2 and 72r3, and the crease in 102r2. 3D folds every sheet this way, with each extra crease where the photographs show it, and its ", h("b", {}, "Touching faces"), " (", h("kbd", {}, "K"), ") marks the faces she gives as “confirmed”."),
        h("table", { class: "info-table" },
          h("tr", {}, h("th", {}, "Quire"), h("th", {}, "Sheet"), h("th", {}, "Folds she gives"), h("th", {}, "What touches, against the viewer's guess")),
          ...[[9, "67|68", "", "The end of 68r3 lies face down on 68r1 and the two halves of 68v3 meet; 68r2 lies on 68r3 only."],
              [10, "69|70", "", "As the viewer had it; 70r1 also touches 70r2 where its second panel does not reach."],
              [11, "71|72", "", "72r2 lies on 72r1 and 72r3 on the back of 72r2; 71v touches 72r1, 72r3 and the back of the end of 72r3, not 72v2."],
              [14, "85|86", "none; folded as voynich.nu describes it", "Everything the viewer had, from voynich.nu's description, is right."],
              [15, "87|90, 88|89", "", "As the viewer had it; 88v also touches part of 89r1, and 89r1 part of 89r2."],
              [17, "94|95", "none; the viewer folds it in", "As the viewer had it; 94v also touches part of 95r1."],
              [19, "99|102, 100|101", "", "The end of 102r2 turns back on top, so 101v1 touches 102r1, 102r2 and 102v2; 100v also touches part of 101r."]]
            .map(([q, ids, none, what]) => h("tr", {}, h("td", {}, String(q)), h("td", {}, ids),
              h("td", {}, ids.split(", ").map(id => this.foldWords(id)).filter(Boolean).join("; ") || none), h("td", {}, what)))),
        h("p", {}, "The drawings show a folded leaf from its top edge, with the spine on the left. The panel at the spine is at the bottom, and each layer above it lies nearer the page the leaf faces, which is dashed. A panel's dark edge is its inside face (its r): ↑ means it looks toward the facing page, ↓ away from it. Gold folds go out. They are schematic, not to scale."),
        this.fig(`<div class="fig-pair">${this.foldLeaf("67|68", 68, true)}${this.foldLeaf("67|68", 68)}</div>`,
          "Quire 9. The crease in 68r3 folds out, not in, so the end of 68r3 tucks under the rest of it, against 68r1, back to back with it."),
        this.fig(`<div class="fig-pair">${this.foldLeaf("71|72", 72, true)}${this.foldLeaf("71|72", 72)}</div>`,
          "Quire 11. The folds alternate in, out, in. 72r2 now lies on 72r1, 72r3 lies on top, and the end of 72r3 folds back over it, so 71v meets three faces."),
        this.fig(`<div class="fig-pair">${this.foldLeaf("99|102", 102, true)}${this.foldLeaf("99|102", 102)}</div>`,
          "Quire 19. The crease in 102r2 folds out, so its end turns back on top of the leaf instead of tucking inside it, and 101v1 meets 102r1, 102r2 and 102v2."),
        this.fig(`<div class="fig-pair">${this.foldLeaf("69|70", 70)}${this.foldLeaf("88|89", 89)}</div>`,
          "Quires 10 and 15 fold in throughout, as the viewer had them. Davis adds the faces that touch only in part: 70r1 and 70r2, 88v and 89r1, 89r1 and 89r2."),
        this.fig(`<div class="fig-pair">${this.foldLeaf("94|95", 95)}${this.foldLeaf("100|101", 101)}</div>`,
          "Quires 17 and 19. Each flap leaves part of its leaf bare, so 94v also touches 95r1, and 100v also touches 101r."),
        h("p", { class: "small muted" }, "Quire 14, the Rosettes, folds in two directions and is not drawn here; Davis confirms every face the viewer has touching there. The panels in 3D are cut from Yale's photographs, whose widths are only roughly right, so 3D cannot show every face that touches in part; the list in Touching faces follows Davis.")),

      // ---------------------------------------------------------------- reference
      h("div", { class: "info-part" }, "Reference"),
      this.sec("sure", "Known or guessed?",
        h("ul", {},
          h("li", {}, h("b", {}, "Known: "), "which leaves belong to which sheet and quire, which leaves are lost, and the page photographs. Folio order, sections and scribes follow Davis's quire diagrams (", cite("LFD2025blog"), "); they agree with the transliteration file's page data except that 115r also has Scribe 2, and 116v, a later addition, has none of the five scribes."),
          h("li", {}, h("b", {}, "Foldouts: "), "the panels and their positions follow ", cite("VN"), ". Panel r1/v1 is always the one at the spine. The Rosettes sheet (quire 14) is 2 × 3 panels; folded it reads 84v | 85r1, 85r2 | 86v5, 86v3 | 87r."),
          h("li", {}, h("b", {}, "Davis's reading of the evidence: "), "the two changes in her order. They rest on real marks in the book, but they are her interpretation."),
          h("li", {}, h("b", {}, "Which way the foldouts fold: "), "as Lisa Fagin Davis gives them, with the faces that touch when the book is closed (", cite("LFD2026ninja"), "; see ", h("button", { class: "linkish", onclick: () => this.go("folds") }, "How the foldouts fold"), "). Most panels fold in, onto the inside of the sheet, so a folded opening shows the back of the second panel (e.g. 67r2 | 68v2 at the centre of quire 9), where the 1600s folio numbers were written; but the crease in 68r3, the fold between 72r2 and 72r3, and the crease in 102r2 fold out. 3D folds them so, and marks these contacts “confirmed”. The Reader is plainer: a folded foldout shows just the panel at the spine on each face (67r1, 67v1, 68r1, 68v1 for quire 9), and the panels inside the folds appear when you unfold it."),
          h("li", {}, h("b", {}, "Guessed by this viewer: "), "how a sheet folds when an order sews or turns it differently from the binding: its contacts are worked out from the folds and marked “inferred”. The extra creases in 68r3, 72r3, 89r2 and 102r2 are placed where the photographs Davis pointed to show them, at about 63%, 66%, 60% and 76% of the panel's width from the fold it hangs from. Sheets in 3D are drawn four times thicker than real parchment, so you can see how they nest."),
          h("li", {}, "Yale labels the photograph of 90v2 as “90r”; it is placed here as 90v2. The page pictures are cut from the photographs and may show slivers of the neighbouring leaves. A foldout's panel at the spine was photographed in the bound book, so it shows the stacked edges of the book block on the side its flaps hang; opened out, the flap lies over that strip."))),

      this.sec("notes", "Notes on single sheets",
        h("p", {}, "The same notes appear when you pull a sheet out in 3D; the Reader shows the first one under the pages."),
        notes),

      this.sec("words", "Words used here",
        h("dl", { class: "info-dl" },
          ...[["Sheet (bifolium)", "One folded piece of parchment: two leaves, four pages."], ["Leaf (folio)", "Half a sheet. The leaves are numbered 1 to 116."],
            ["Recto / verso", "The front (r) and back (v) of a leaf."], ["Opening", "Two pages you see side by side when the book lies open."],
            ["Gutter", "The fold in the middle of an opening."], ["Conjoint", "Two leaves that are halves of the same sheet."],
            ["Quire", "A bundle of sheets folded together, tucked inside each other."], ["Singulion", "A single folded sheet read on its own."],
            ["Quire mark", "A small number written on a quire so the binder put the quires in the right order."],
            ["Foliation", "The numbers written on the leaves (here in the 1600s)."], ["Binding", "How the quires are sewn together, and so the order of the pages."],
            ["Foldout", "A sheet with extra panels that fold in."], ["Collation", "A description of how a book's quires are made up."],
            ["Scribe, hand", "A handwriting. Davis finds five."], ["Currier A / B", "The two flavours of the writing, with different favourite words and spellings."],
            ["Paleography", "The study of old handwriting."], ["Codicology", "The study of how books are physically made."]].flatMap(([t, d]) => [h("dt", {}, t), h("dd", {}, d)]))),

      this.sec("sources", "Sources",
        h("ul", { class: "info-src" }, Object.keys(D.orders.sources).map(k => h("li", {}, cite(k)))),
        h("p", { class: "small muted" }, "Scribes and section names: Davis. Illustration type and Currier language: the page labels of Zandbergen's transliteration file; the viewer never uses the transliterated text. 3D drawing: three.js (MIT licence)."),
        h("p", { class: "small muted" }, `Voynich Viewer ${APP_VERSION} is an independent project. It is not made or endorsed by Yale University or by Lisa Fagin Davis.`)),

      this.privacySec());

    return h("div", { class: "info-wrap" },
      h("div", { class: "info-credits", role: "note", "aria-label": "Credits" },
        h("div", { class: "credit" }, h("span", { class: "ci", "aria-hidden": "true" }, "▣"),
          h("div", {}, h("b", {}, "Credit for the images belongs to Yale University."), " The photographs of the manuscript are by the Beinecke Rare Book & Manuscript Library, Yale University (MS 408). ",
            h("a", { href: yaleUrl, target: "_blank", rel: "noopener" }, "See the manuscript at Yale"))),
        h("div", { class: "credit" }, h("span", { class: "ci", "aria-hidden": "true" }, "✎"),
          h("div", {}, h("b", {}, "The research belongs to Lisa Fagin Davis."), " The collation, the five scribes, the section names and the reconstructions of the book's order shown here are her work. ",
            h("a", { href: blogUrl, target: "_blank", rel: "noopener" }, "Read “Voynich Codicology”")))),
      h("div", { class: "info-cols" }, tocEl, body));
  },
};

// ================================================================ boot
document.addEventListener("close", e => {   // a dialog closed: keep the message area on the page
  const t = e.target.querySelector?.("#cx-toast");
  if (t) document.body.append(t);
}, true);

/* What's new: data/changelog.json, shown under the version number. The badge takes the latest version from it, and
   carries a dot for someone who has been here before until they have seen that version's notes. */
const Changes = {
  rel: [],
  async init() {
    const btn = $("#cx-ver"), dlg = $("#cx-new-dlg");
    btn.addEventListener("click", () => this.open());
    dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });   // a click outside the box closes it
    try {
      const r = await fetch("data/changelog.json", { cache: "no-cache" });
      if (!r.ok) return;
      this.rel = (await r.json()).releases || [];
    } catch { return; }   // the badge keeps the version written in the page
    const latest = this.rel[0];
    if (!latest) return;
    btn.textContent = "v" + latest.version;
    btn.title = `Voynich Viewer ${latest.version}: what's new`;
    let seen = store.get("seenVersion", null);
    if (seen == null) {   // a first visit has nothing to catch up on; a returning visitor has settings stored already
      let returning = false;
      try { returning = Object.keys(localStorage).some(k => k.startsWith("vv:")); } catch { /* storage blocked */ }
      if (!returning) { store.set("seenVersion", latest.version); seen = latest.version; }
    }
    btn.classList.toggle("dot", seen !== latest.version);
  },
  date: iso => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z")),
  KINDS: { new: "New", improved: "Improved", fixed: "Fixed" },
  open() {
    const list = $("#cx-new-list"), dlg = $("#cx-new-dlg");
    list.replaceChildren(...(this.rel.length ? this.rel.map(r => h("section", { class: "rel" },
      h("h4", {}, h("span", { class: "rel-v" }, "v" + r.version), h("time", { datetime: r.date }, this.date(r.date))),
      h("ul", {}, ...r.changes.map(c => h("li", {}, h("span", { class: `kind ${c.kind}` }, this.KINDS[c.kind] || c.kind), " ", c.text)))))
      : [h("p", { class: "muted" }, "The list of changes could not be loaded.")]));
    if (!dlg.open) dlg.showModal();
    list.scrollTop = 0;
    if (this.rel[0]) { store.set("seenVersion", this.rel[0].version); $("#cx-ver").classList.remove("dot"); }
  },
};

async function boot() {
  try {
    const [codex, orders] = await Promise.all(["data/codex.json", "data/orders.json"].map(async u => {
      const r = await fetch(u, { cache: "no-cache" });
      if (!r.ok) throw new Error(`${u}: ${r.status}`);
      return r.json();
    }));
    D = { ...codex, orders };
    // where the paper starts on a foldout's hinge panel (tools/seams.py): an extra, so without the file a foldout just opens flat
    D.seams = await fetch("data/seams.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : { panels: {} }).catch(() => ({ panels: {} }));
    // how the foldouts fold and which faces touch, as Davis described them: without it every fold is inferred
    D.folds = await fetch("data/folds.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : { sheets: {} }).catch(() => ({ sheets: {} }));
  } catch (e) {
    $("#cx-main").replaceChildren(h("div", { style: { padding: "30px" } }, "The page data could not be loaded (", String(e.message), ")."));
    return;
  }
  for (const s of D.sheets) {
    SHEETS.set(s.id, s);
    for (const f of ["inside", "outside"]) for (const row of s[f]) for (const sg of row) PAGE_SHEET.set(sg.page, s.id);
  }
  await Work.init();   // your crops and orders, kept in this browser (work.js)
  resolveOrders();
  const at = readHash();
  if (at && S.view === "three") View3D.pending = at;
  if (S.view === "info") Info.at = at || null;
  S.order = RETIRED[S.order] || S.order;
  if (!ORDERS.has(S.order)) S.order = "beinecke";
  fillOrderSelect();
  $("#cx-order").addEventListener("change", e => setOrder(e.target.value));
  $("#cx-order").title = ORDERS.get(S.order).subtitle || "";
  for (const b of $$("#cx-tabs button")) b.addEventListener("click", () => show(b.dataset.view));
  $("#cx-help").addEventListener("click", () => $("#cx-help-dlg").showModal());
  Changes.init();   // not awaited: the page doesn't wait for the list of changes
  $("#cx-work").addEventListener("click", () => Work.open());
  $("#cx-bm").addEventListener("click", () => (Bookmarks.pop && !Bookmarks.pop.hidden ? Bookmarks.close() : Bookmarks.open()));
  Bookmarks.render();
  const bug = $("#cx-bug-dlg");
  $("#cx-bug").addEventListener("click", () => bug.showModal());
  bug.addEventListener("click", e => { if (e.target === bug) bug.close(); });   // a click outside the box closes it
  $("#cx-bug-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText("alinajafri4@gmail.com"); toast("Email address copied"); }
    catch { toast("Copy did not work: the address is alinajafri4@gmail.com"); }
  });
  document.addEventListener("keydown", e => {
    if (e.target.closest?.("input, select, textarea, dialog")) return;
    if ((e.key === "Enter" || e.key === " ") && e.target.closest?.(".v3-arrange, .ar-menu, .v3-arr-acts")) return;   // they press the Rearrange button in focus
    if (S.view === "three" && typeof Arrange !== "undefined" && Arrange.key(e)) { e.preventDefault(); return; }   // Rearrange's table keys (⌘G, ⌘], ⌫…)
    if ((e.metaKey || e.ctrlKey) && S.view === "three" && e.key.toLowerCase() === "z" && MyOrders.isMine(S.order)) {
      e.preventDefault(); e.shiftKey ? Arrange.redo() : Arrange.undo(); return;
    }
    if (e.metaKey || e.ctrlKey || (e.altKey && S.view !== "three")) return;
    if (e.key === "?") { $("#cx-help-dlg").showModal(); return; }
    if (S.view === "read") Reader.key(e);
    else if (S.view === "three") View3D.key(e);
  });
  window.addEventListener("hashchange", () => {
    const at2 = readHash();
    if (S.view === "three") View3D.pending = at2 || null;   // applied when the view mounts; the URL keeps it meanwhile
    if (S.view === "info") Info.at = at2 || null;
    $("#cx-order").value = S.order;
    $("#cx-order").title = ORDERS.get(S.order).subtitle || "";
    show(S.view);
    if (at2 && S.view === "read") { const k = Reader.find(at2); if (k >= 0) Reader.go(k, 0, at2); }
  });
  show(S.view);
  if (at && S.view === "read") { const k = Reader.find(at); if (k >= 0) Reader.go(k, 0, at, true); }
}
document.addEventListener("DOMContentLoaded", boot);   // after work.js and arrange.js have loaded
