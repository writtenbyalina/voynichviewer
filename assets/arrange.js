/* Voynich Viewer: rearrange the book, from the 3D view.
   A panel beside the 3D book lists every gathering and its sheets. Drag a sheet by its handle (or use its buttons) to
   move it, start a new gathering, set it aside, read a gathering as separate sheets, turn a sheet inside out or upside
   down, or sew a foldout at another fold. Built-in orders are never changed: the first change makes your own copy
   (work.js MyOrders), which every view then shows. Each change animates in 3D and can be undone.
   Loaded after app.js and work.js; uses their globals. */
"use strict";

const EYE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const svgEl = markup => { const t = document.createElement("template"); t.innerHTML = markup; return t.content.firstChild; };

const Arrange = {
  on: false,
  sel: null,          // the sheet whose options are open
  hist: new Map(),    // order id -> { undo: [snapshot], redo: [snapshot] }

  // ---------------------------------------------------------------- opening
  async open() {
    if (S.view !== "three") show("three");
    const m = await View3D.load();
    this.on = true;
    this.sel = m.curSheet() || this.sel;
    m.setPanel(true);
    this.render();
    requestAnimationFrame(() => this.mark(this.sel, true));
  },
  close() { this.on = false; View3D.mod?.setPanel(false); this.render(); },
  toggle() { this.on ? this.close() : this.open(); },

  order() { return ORDERS.get(S.order); },
  aside: o => o.unplaced || unplacedOf(o),   // built-in orders list lost sheets per gathering, or not at all
  el() { return $("#v3-arrange"); },

  // ---------------------------------------------------------------- editing
  snap: o => JSON.stringify({ gatherings: o.gatherings, unplaced: o.unplaced, title: o.title }),

  /* Apply fn to a copy of the current order. A built-in order is first copied into an order of your own. `moved` names
     the sheets the change is about: only they lift in 3D, the others slide aside (null: let 3D decide). */
  edit(fn, { ms = 1000, moved = null } = {}) {
    let o = this.order(), started = null;
    if (!MyOrders.isMine(o.id)) { started = o.title; o = MyOrders.copyOf(o); }
    const before = this.snap(o);
    const next = JSON.parse(JSON.stringify(o));
    if (fn(next) === false) return;
    if (this.snap(next) === before && !started) return;
    const hst = this.histOf(next.id);
    hst.undo.push({ s: before, moved }); hst.redo = [];
    if (hst.undo.length > 100) hst.undo.shift();
    MyOrders.put(next, { ms, moved });
    if (started) toast(`Started your own order, “${next.title}”, from “${started}”. The original stays as it was.`, { label: "Rename", fn: () => this.rename() });
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
  /* One place up or down the list; at the end of a gathering it moves into the next one. */
  step(id, d) {
    const o = this.order(), { gi, i } = this.locate(o, id);
    if (gi < 0) return;
    const n = o.gatherings[gi].bifolia.length;
    if (i + d >= 0 && i + d < n) this.move(id, gi, d > 0 ? i + 2 : i - 1);
    else if (d < 0 && gi > 0) this.move(id, gi - 1, o.gatherings[gi - 1].bifolia.length);
    else if (d > 0 && gi < o.gatherings.length - 1) this.move(id, gi + 1, 0);
    else toast(d < 0 ? "This sheet is already first" : "This sheet is already last");
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
    const t = await askText("Name this gathering", { value: String(g.quire), ok: "Rename", placeholder: "e.g. 4, 13b, Herbal A" });
    if (!t) return;
    this.edit(o => { o.gatherings[gi].quire = /^\d+$/.test(t) ? +t : t; }, { ms: 300 });
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

  // ---------------------------------------------------------------- the panel
  render() {
    const el = this.el();
    if (!el) return;
    if (!this.on) { el.hidden = true; el.innerHTML = ""; return; }
    const o = this.order(), mine = MyOrders.isMine(o.id), hst = this.histOf(o.id);
    el.hidden = false;
    el.innerHTML = "";
    el.append(
      h("div", { class: "fx-nav" }, h("b", {}, "Rearrange"),
        h("button", { class: "fx-close", title: "Close (A)", "aria-label": "Close the rearrange panel", onclick: () => this.close() }, "✕")),
      h("div", { class: "ar-save" },
        h("span", { class: "ar-saved", title: "Your orders and crops are kept in this browser's storage" }, mine ? "✓ Saved in this browser" : "Changes are saved in this browser"),
        h("button", { title: "Download a progress file with your orders and crops", onclick: () => Work.exportFile(), disabled: !MyOrders.list.length && !Crops.mine.size || null }, "⬇ Export"),
        h("button", { title: "Load a progress file", onclick: () => Work.pickFile() }, "⬆ Import")),
      mine
        ? h("div", { class: "ar-name" },
            h("button", { class: "linkish ar-title", title: "Rename this order", onclick: () => this.rename() }, o.title, " ✎"),
            h("span", { class: "ar-tools" },
              h("button", { title: "Undo (⌘Z)", "aria-label": "Undo", disabled: !hst.undo.length || null, onclick: () => this.undo() }, "↶"),
              h("button", { title: "Redo (⇧⌘Z)", "aria-label": "Redo", disabled: !hst.redo.length || null, onclick: () => this.redo() }, "↷")))
        : h("div", { class: "ar-intro" },
            h("p", {}, "Put the sheets in any order you like. ", h("b", {}, o.title), " itself is never changed: your first move makes your own copy, saved in this browser."),
            h("button", { class: "primary", onclick: () => this.edit(() => {}, { ms: 0 }) }, "Make my own copy now")),
      h("p", { class: "ar-hint" }, "Drag a sheet or a whole gathering by ", h("span", { class: "ar-grip-demo" }, "⠿"), " to move it, or click a sheet for more. The eye hides a gathering in 3D, like a layer. The Reader and the Folio order tables follow your order too."),
      View3D.mod?.hiddenQuires().size ? h("div", { class: "ar-hidden" }, `${View3D.mod.hiddenQuires().size} hidden in 3D`,
        h("button", { onclick: () => View3D.mod.showAllQuires() }, "Show all")) : "",
      ...o.gatherings.map((g, gi) => this.gatheringEl(o, g, gi)),
      this.asideEl(o),
      mine ? h("div", { class: "ar-foot" },
        h("button", { onclick: () => Work.open() }, "All your work…"),
        h("button", { onclick: async () => { if (await askYes(`Delete “${o.title}”?`, "This cannot be undone, unless you exported it.", "Delete", true)) { MyOrders.remove(o.id); this.render(); } } }, "Delete this order")) : "");
  },

  gatheringEl(o, g, gi) {
    const sing = g.type === "singulions", hid = !!View3D.mod?.hiddenQuires().has(String(g.quire));
    return h("section", { class: `ar-g${sing ? " sing" : ""}${hid ? " hid" : ""}`, "data-gi": gi },
      h("div", { class: "ar-gh" },
        h("span", { class: "ar-grip", title: "Drag to move this whole gathering", "aria-hidden": "true", onpointerdown: e => this.dragGathering(e, gi) }, "⠿"),
        h("button", { class: `ar-eye${hid ? " off" : ""}`, "aria-pressed": hid ? "true" : "false",
          title: hid ? "Hidden in 3D: click to show it" : "Hide this gathering in 3D, like a layer (the order does not change)",
          "aria-label": hid ? `Show ${qWord(g.quire)} in 3D` : `Hide ${qWord(g.quire)} in 3D`,
          onclick: () => View3D.mod?.setHidden(g.quire, !hid) }, svgEl(hid ? EYE_OFF : EYE)),
        h("button", { class: "linkish ar-gname", title: "Rename this gathering", onclick: () => this.renameGathering(gi) }, qWord(g.quire)),
        h("span", { class: "ar-seg", role: "group", "aria-label": "How this gathering is put together" },
          h("button", { class: sing ? "" : "on", title: "A quire: the sheets are tucked inside each other and sewn through the middle", onclick: () => sing && this.setType(gi, "nested") }, "Quire"),
          h("button", { class: sing ? "on" : "", title: "Separate sheets (singulions): each sheet is read on its own, front to back", onclick: () => !sing && this.setType(gi, "singulions") }, "Separate")),
        h("button", { class: "ar-mini", title: "Move this gathering earlier", "aria-label": "Move gathering up", disabled: gi === 0 || null, onclick: () => this.moveGathering(gi, -1) }, "↑"),
        h("button", { class: "ar-mini", title: "Move this gathering later", "aria-label": "Move gathering down", disabled: gi === o.gatherings.length - 1 || null, onclick: () => this.moveGathering(gi, 1) }, "↓")),
      h("div", { class: "ar-rows", "data-gi": gi }, g.bifolia.map((id, i) => this.rowEl(o, id, gi, i, (g.sheets || {})[id] || {}))),
      sing ? "" : h("div", { class: "ar-note" }, "First sheet = outermost."));
  },

  asideEl(o) {
    return h("section", { class: "ar-g ar-aside", "data-gi": -1 },
      h("div", { class: "ar-gh" }, h("b", {}, "Set aside"), h("span", { class: "muted" }, " not in the book")),
      h("div", { class: "ar-rows", "data-gi": -1 }, this.aside(o).length ? this.aside(o).map((id, i) => this.rowEl(o, id, -1, i, {}))
        : h("div", { class: "ar-empty" }, "Drop a sheet here to take it out of the book.")));
  },

  rowEl(o, id, gi, i, opts) {
    const sh = SHEETS.get(id), lost = sh.missing.every(Boolean);
    const first = sidesOf(sh, opts)[0].shown;
    const v = varsOf([...sh.inside.flat(), ...sh.outside.flat()]);
    const tags = [opts.inside_out ? "inside out" : "", opts.rot180 ? "upside down" : "", opts.spine != null && opts.spine !== sh.spine ? "other fold" : ""].filter(Boolean);
    const open = this.sel === id;
    const row = h("div", { class: `ar-row${open ? " open" : ""}${lost ? " lost" : ""}`, "data-id": id, "data-gi": gi, "data-i": i },
      h("span", { class: "ar-grip", title: "Drag to move", "aria-hidden": "true", onpointerdown: e => this.dragStart(e, id) }, "⠿"),
      h("button", { class: "ar-main", title: "Find this sheet in the book", onclick: () => { this.sel = open ? null : id; View3D.mod?.focusSheet(id); this.render(); } },
        lost || first.missing ? h("span", { class: "ar-thumb ghost" }) : h("img", { class: "ar-thumb", src: imgUrl(first.img, "s", first.v), alt: "", loading: "lazy" }),
        h("span", { class: "ar-id" }, id),
        h("span", { class: "ar-sub" }, lost ? "lost" : [v.is[0] || "", v.hs.map(n => `S${n}`).join("+")].filter(Boolean).join(" · "),
          tags.length ? h("span", { class: "ar-tag" }, tags.join(", ")) : "")),
      h("span", { class: "ar-btns" },
        h("button", { class: "ar-mini", title: "Move up", "aria-label": `Move ${id} up`, onclick: () => gi < 0 ? this.move(id, -1, Math.max(0, i - 1)) : this.step(id, -1) }, "↑"),
        h("button", { class: "ar-mini", title: "Move down", "aria-label": `Move ${id} down`, onclick: () => gi < 0 ? this.move(id, -1, i + 2) : this.step(id, 1) }, "↓")));
    if (!open) return row;
    return h("div", { class: "ar-wrap" }, row, this.optionsEl(o, id, gi, opts));
  },

  optionsEl(o, id, gi, opts) {
    const sh = SHEETS.get(id), n = sh.inside[0].length;
    const to = h("select", { "aria-label": "Move this sheet to", onchange: e => {
      const v = e.target.value;
      if (v === "new") this.newGathering(id);
      else if (v === "aside") this.move(id, -1, this.aside(o).length);
      else if (v !== "") { const j = +v; this.move(id, j, o.gatherings[j].bifolia.length); }
    } },
      h("option", { value: "" }, "Move to…"),
      ...o.gatherings.map((g, j) => j === gi ? "" : h("option", { value: j }, `the end of ${qWord(g.quire)}`)),
      h("option", { value: "new" }, "a new gathering of its own"),
      gi < 0 ? "" : h("option", { value: "aside" }, "set it aside (out of the book)"));
    const row = sh.inside[sh.proper_row ?? (sh.inside.length - 1)];
    const folds = n > 2 ? h("label", { class: "ar-opt" }, "Sewn at ",
      h("select", { onchange: e => this.setOpt(id, "spine", +e.target.value === sh.spine ? null : +e.target.value) },
        Array.from({ length: n - 1 }, (_, k) => k + 1).map(k => h("option", { value: k, selected: (opts.spine ?? sh.spine) === k || null },
          `the fold between ${short(pageName(row[k - 1]))} and ${short(pageName(row[k]))}${k === sh.spine ? " (as bound)" : ""}`)))) : "";
    const segs = [...sh.inside.flat(), ...sh.outside.flat()].filter(s => s.img && !s.missing);
    return h("div", { class: "ar-opts" },
      to,
      gi < 0 ? "" : h("label", { class: "ar-opt", title: "Fold the sheet the other way, so its outside pages face each other in the middle" },
        h("input", { type: "checkbox", checked: !!opts.inside_out || null, onchange: e => this.setOpt(id, "inside_out", e.target.checked) }), " Inside out"),
      gi < 0 ? "" : h("label", { class: "ar-opt", title: "Turn the sheet round, so its first leaf becomes its last" },
        h("input", { type: "checkbox", checked: !!opts.rot180 || null, onchange: e => this.setOpt(id, "rot180", e.target.checked) }), " Upside down"),
      gi < 0 ? "" : folds,
      segs.length ? h("div", { class: "ar-crop" }, "✂ Crop: ", segs.map(s => h("button", { class: "linkish", onclick: () => CropEditor.open(s.img) }, short(pageName(s))))) : "");
  },

  /* Highlight the sheet the 3D view is on. */
  mark(id, scroll = false) {
    const el = this.el();
    if (!el || el.hidden) return;
    for (const r of el.querySelectorAll(".ar-row")) r.classList.toggle("cur", r.dataset.id === id);
    if (scroll) el.querySelector(`.ar-row[data-id="${CSS.escape(id || "")}"]`)?.scrollIntoView({ block: "nearest" });
  },

  // ---------------------------------------------------------------- drag and drop
  /* A whole gathering, by the handle in its header: drop it between two others. */
  dragGathering(e, gi) {
    if (e.button !== 0) return;
    e.preventDefault();
    const panel = this.el(), card = e.target.closest(".ar-g"), head = card.querySelector(".ar-gh");
    const r = head.getBoundingClientRect(), dy = e.clientY - r.top;
    const ghost = head.cloneNode(true);
    ghost.classList.add("ar-ghost", "ar-gghost");
    Object.assign(ghost.style, { width: r.width + "px", left: r.left + "px", top: r.top + "px" });
    document.body.append(ghost);
    card.classList.add("dragging");
    const bar = h("div", { class: "ar-drop ar-gdrop" });
    let to = null, scrollT = null;
    const cards = () => [...panel.querySelectorAll(".ar-g:not(.ar-aside)")];
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
      if (to != null && ev) this.moveGatheringTo(gi, to);
    };
    const cancel = () => { to = null; end(null); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", cancel);
  },

  dragStart(e, id) {
    if (e.button !== 0) return;
    e.preventDefault();
    const row = e.target.closest(".ar-row"), panel = this.el();
    const r = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add("ar-ghost");
    Object.assign(ghost.style, { width: r.width + "px", left: r.left + "px", top: r.top + "px" });
    document.body.append(ghost);
    row.classList.add("dragging");
    const bar = h("div", { class: "ar-drop" });
    let target = null, scrollT = null;
    const dy = e.clientY - r.top;
    const where = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      const rowEl = hit?.closest?.(".ar-row");
      if (rowEl && panel.contains(rowEl) && rowEl !== row) {
        const b = rowEl.getBoundingClientRect(), after = y > b.top + b.height / 2;
        return { gi: +rowEl.dataset.gi, i: +rowEl.dataset.i + (after ? 1 : 0), anchor: rowEl.closest(".ar-wrap") || rowEl, after };
      }
      const box = hit?.closest?.(".ar-g");
      if (box && panel.contains(box)) {
        return { gi: +box.dataset.gi, anchor: box.querySelector(".ar-rows"), end: true };   // anywhere else in a gathering: its end
      }
      return null;
    };
    const move = ev => {
      ghost.style.top = (ev.clientY - dy) + "px";
      target = where(ev.clientX, ev.clientY);
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
        const o = this.order(), len = target.gi < 0 ? this.aside(o).length : o.gatherings[target.gi].bifolia.length;
        this.move(id, target.gi, target.end ? len : target.i);
      }
    };
    const cancel = () => { target = null; end(); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", cancel);
  },
};
