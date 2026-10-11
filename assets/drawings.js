/* Drawings: every drawing in the book cut out of its photograph, what is known of each, and their outlines on the
   Reader's pages. Loaded on first use (DrawTab and DrawUI in app.js); uses app.js's helpers and globals.

   Data (data/drawings/): index.json lists every drawing (its panel, kind, name and box); paths/<img>.json holds a
   panel's outlines (SVG paths in thousandths of the panel's height, as the text's word shapes are), with each
   drawing's label words and paints; about.json what is said about each drawing, with its sources; similar.json the
   drawings most like each one. The outlines are made by tools/drawings/cut.py; about.json is written by hand.

   The address: #draw/<order>/all?k=plant&s=herbal&w=agreed&q=pansy (every drawing, filtered) or
   #draw/<order>/<id>[?on=page] (one drawing, cut out or on its page). */

const ROOT = "data/drawings/";
const get = async (f, opt = false) => {
  const r = await fetch(ROOT + f, { cache: "no-cache" });
  if (!r.ok) { if (opt) return null; throw new Error(`${f}: ${r.status}`); }
  return r.json();
};

/* the parts of the book, as the gallery groups them; each page goes by its section (Davis) and its kind of picture */
const PARTS = [
  { key: "herbal", name: "Herbal", say: "A plant on nearly every page." },
  { key: "astro", name: "Astronomical", say: "Round diagrams of suns, moons and stars." },
  { key: "zodiac", name: "Zodiac", say: "Signs of the zodiac, each ringed by women holding stars." },
  { key: "bathing", name: "Bathing", say: "Women in pools of water joined by pipes (the “balneological” pages)." },
  { key: "rosettes", name: "Rosettes", say: "The great foldout of nine rosettes, and the round diagrams beside it." },
  { key: "pharma", name: "Pharmaceutical", say: "Jars, with the roots and leaves drawn beside them." },
  { key: "stars", name: "Starred pages", say: "Stars in the margins, one beside each paragraph." },
];
function partOf(seg) {
  const s = seg?.section || "", i = seg?.vars?.I;
  if (s === "Botanical") return i === "C" ? "astro" : i === "S" ? "stars" : "herbal";
  if (s === "Astronomy/ Zodiac") return i === "Z" ? "zodiac" : "astro";
  return { Astronomy: "astro", Zodiac: "zodiac", Balneology: "bathing", Rose: "rosettes", Pharmaceutical: "pharma",
    "Starred paragraphs": "stars" }[s] || "herbal";
}
const KINDS = {
  plant: ["Plant", "Plants"], root: ["Root", "Roots"], leaf: ["Leaf", "Leaves"], jar: ["Jar", "Jars"],
  diagram: ["Diagram", "Diagrams"], emblem: ["Centre picture", "Centre pictures"], sun: ["Sun", "Suns"], moon: ["Moon", "Moons"],
  star: ["Star", "Stars"], woman: ["Woman", "Women"], person: ["Person", "People"], animal: ["Animal", "Animals"],
  pool: ["Pool", "Pools"], rosette: ["Rosette", "Rosettes"], building: ["Building", "Buildings"], other: ["Other", "Others"],
};
/* What is known: most agree what it is; people have had ideas; nobody knows (no idea found in the sources checked);
   not looked into yet (no sources checked for it here). */
const KNOWN = {
  agreed: { name: "Most agree", say: "Most people who have studied it agree what it is" },
  ideas: { name: "Ideas only", say: "People have had ideas, but they do not agree" },
  open: { name: "Nobody knows", say: "No one has said what it is, in the sources checked" },
  unchecked: { name: "Not looked into yet", say: "The sources have not been searched for this drawing yet" },
};
const STRENGTH = { strong: "Shown by the book itself", broad: "Most agree, not proven" };

// ---------------------------------------------------------------- data
const Data = {
  ready: null, list: [], byId: new Map(), groups: new Map(), about: null, similar: null, docs: new Map(), segs: new Map(),
  load() {
    return this.ready ||= Promise.all([get("index.json"), get("about.json", true), get("similar.json", true)]).then(([ix, about, sim]) => {
      for (const s of D.sheets) for (const f of ["inside", "outside"]) for (const row of s[f] || []) for (const sg of row)
        if (sg && !sg.missing && sg.img && !this.segs.has(sg.img)) this.segs.set(sg.img, sg);
      this.about = about || { sources: {}, drawings: {}, kinds: {}, general: [] };
      this.similar = (sim && sim.similar) || {};
      this.list = ix.drawings.map((d, i) => ({ ...d, i, part: partOf(this.segs.get(d.img)) }));
      for (const d of this.list) {
        this.byId.set(d.id, d);
        if (d.group) { if (!this.groups.has(d.group)) this.groups.set(d.group, []); this.groups.get(d.group).push(d); }
      }
      for (const d of this.list) { d.know = known(d); d.words = words(d); }
    }).catch(e => { this.ready = null; throw e; });
  },
  /* a panel's outlines and facts */
  doc(img) {
    if (!this.docs.has(img)) this.docs.set(img, get(`paths/${encodeURIComponent(img)}.json`).then(d => {
      d.p2 = new Map(Object.entries(d.paths).map(([k, v]) => [k, new Path2D(v)]));
      return d;
    }).catch(e => { this.docs.delete(img); throw e; }));
    return this.docs.get(img);
  },
};

/* What is said about a drawing: its own entry, else its group's (the women round one medallion), else its kind's
   (true of every such drawing). `whose` says which. */
function aboutOf(d) {
  const A = Data.about, own = A.drawings?.[d.id], grp = d.group && A.drawings?.[d.group], kind = A.kinds?.[d.kind];
  const e = own || grp || null;
  return { ...(kind || {}), ...(e || {}), whose: own ? "own" : grp ? "group" : kind ? "kind" : null, kindNote: !e && !!kind };
}
function known(d) {
  const a = aboutOf(d);
  if (a.agreed) return "agreed";
  if (a.ideas?.length) return "ideas";
  if (!a.whose || a.checked === false) return "unchecked";
  return "open";
}
/* what a drawing is called: what most agree it is, when they do (a few words), else its plain name */
const titleOf = d => aboutOf(d).short || d.name || KINDS[d.kind]?.[0] || "Drawing";
const pageOf = d => d.img.startsWith("fRos") ? "Rosettes" : short(d.page);
const panelSay = d => d.img.startsWith("fRos") ? `Rosettes, ${{ tl: "top left", tm: "top middle", tr: "top right", bl: "bottom left", bm: "bottom middle", br: "bottom right" }[d.img.slice(5)] || ""} panel`
  : d.img !== d.page ? `${short(d.page)}, ${d.img.endsWith("-1") ? "left" : d.img.endsWith("-2") ? "right" : ""} panel` : short(d.page);
/* the words a drawing is found by */
function words(d) {
  const a = aboutOf(d);
  return [d.name, d.kind, KINDS[d.kind]?.[1], d.looks, a.short, a.agreed, ...(a.ideas || []).map(x => `${x.what} ${x.who || ""}`), d.page, short(d.page),
    PARTS.find(p => p.key === d.part)?.name].filter(Boolean).join(" ").toLowerCase();
}

// ---------------------------------------------------------------- pictures, cut out
const Pics = {
  got: new Map(),
  get(url) {
    if (!this.got.has(url)) this.got.set(url, new Promise((ok, no) => {
      const im = new Image();
      im.decoding = "async";
      im.onload = () => ok(im);
      im.onerror = () => { this.got.delete(url); no(new Error("the page's picture did not load")); };
      im.src = url;
    }));
    return this.got.get(url);
  },
};
/* the panel's own picture, never your re-cut of it (the outlines were traced on this one) */
const panelUrl = (img, size) => { const sg = Data.segs.get(img); return `data/panels/${encodeURIComponent(img)}_${size}.jpg${sg?.v ? "?v=" + sg.v : ""}`; };

/* Draw drawing d cut out into canvas c, fitted into w x h CSS pixels (with `pad` of the box round it), on a
   transparent ground with a soft shadow. src: an image already loaded (Yale's full-size photograph), else the small
   or the large picture, whichever is enough. Returns the scale used (canvas pixels per unit). */
async function paint(c, d, { w, h: hh, pad = 0.06, src = null, shadow = true, outline = false } = {}) {
  const doc = await Data.doc(d.img), path = doc.p2.get(d.id);
  if (!path) return 0;
  const [bx, by, bw, bh] = d.box, dpr = devicePixelRatio || 1;
  const s = Math.min(w / (bw * (1 + 2 * pad)), hh / (bh * (1 + 2 * pad)));   // CSS px per unit
  const cw = Math.max(1, Math.round(bw * (1 + 2 * pad) * s)), ch = Math.max(1, Math.round(bh * (1 + 2 * pad) * s));
  const im = src || await Pics.get(panelUrl(d.img, bh * s * dpr <= bh * 0.3 * 1.05 ? "s" : "l"));
  c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
  c.style.width = cw + "px"; c.style.height = ch + "px";
  const x = c.getContext("2d"), k = s * dpr;
  x.setTransform(k, 0, 0, k, (-bx + bw * pad) * k, (-by + bh * pad) * k);
  x.clearRect(bx - bw, by - bh, bw * 3, bh * 3);
  if (shadow) {
    x.save();
    x.shadowColor = "rgba(0, 0, 0, .55)"; x.shadowBlur = 7 * dpr; x.shadowOffsetY = 2 * dpr;
    x.fillStyle = "#cbbd9f";
    x.fill(path, "evenodd");
    x.restore();
  }
  x.save();
  x.clip(path, "evenodd");
  x.drawImage(im, 0, 0, 1000 * doc.aspect, 1000);
  x.restore();
  if (outline) {
    x.lineWidth = 1.3 / s; x.strokeStyle = "rgba(255, 255, 255, .85)";
    x.stroke(path);
  }
  return k;
}

// ---------------------------------------------------------------- what is known, said
function srcLink(key) {
  const s = Data.about.sources?.[key];
  if (!s) return null;
  const text = [s.who, s.year && `(${s.year})`, s.title && `“${s.title}”`].filter(Boolean).join(" ");
  return s.url ? h("a", { href: s.url, target: "_blank", rel: "noopener" }, text) : h("span", {}, text);
}
function knownTag(d, big = false) {
  const k = d.know || known(d);
  return h("span", { class: `dw-known ${k}${big ? " big" : ""}`, title: KNOWN[k].say }, h("i", { "aria-hidden": "true" }), KNOWN[k].name);
}

// ---------------------------------------------------------------- the tab
const DEFAULTS = { q: "", s: "", k: "", w: "" };
const T = {
  built: false, el: null, f: { ...DEFAULTS }, at: null, on: "cut", obs: null, view: null, yale: new Map(),

  /* the address, after #draw/<order>/ */
  state() {
    if (this.at) return encodeURIComponent(this.at) + (this.on === "page" ? "?on=page" : "");
    const q = new URLSearchParams(Object.entries(this.f).filter(([k, v]) => v && v !== DEFAULTS[k])).toString();
    return "all" + (q ? "?" + q : "");
  },
  fromHash() {
    const m = location.hash.match(/^#\/?draw(?:\/[^/]*)?(?:\/(.*))?$/);
    const [what, query = ""] = String((m && m[1]) || "all").split("?");
    const p = new URLSearchParams(query);
    let id = null;
    try { id = decodeURIComponent(what); } catch { id = what; }
    if (id && id !== "all") { this.at = id; this.on = p.get("on") === "page" ? "page" : "cut"; }   // checked once the list is here (show)
    else {
      this.at = null;
      this.f = { ...DEFAULTS };
      for (const k of Object.keys(DEFAULTS)) if (p.get(k)) this.f[k] = p.get(k);
    }
  },

  async mount() {
    const v = $("#v-draw");
    this.fromHash();   // at once: show() writes the address back from state() before the drawings have loaded
    if (!this.built) {
      v.replaceChildren(h("p", { class: "dw-wait" }, "Loading the drawings…"));
      try { await Data.load(); } catch (e) { v.replaceChildren(h("p", { class: "dw-fail" }, "The drawings could not load: " + e.message)); return; }
      this.build();
    }
    if (S.view !== "draw") return;
    this.show();
    setHash();
  },

  build() {
    const v = $("#v-draw");
    this.grid = h("div", { class: "dw-scroll", id: "dw-scroll" });
    this.count = h("p", { class: "dw-count", role: "status" });
    const box = h("input", { type: "search", id: "dw-q", class: "dw-q", placeholder: "Find a drawing: pansy, jar, Pisces, 68r…", "aria-label": "Find a drawing",
      autocomplete: "off", spellcheck: "false", value: this.f.q,
      oninput: e => { clearTimeout(this.qT); this.qT = setTimeout(() => this.set({ q: e.target.value.trim() }), 120); },
      onkeydown: e => { if (e.key === "Escape" && e.target.value) { e.target.value = ""; this.set({ q: "" }); e.stopPropagation(); } } });
    const chips = (key, items, label) => h("div", { class: "dw-chips", role: "group", "aria-label": label },
      [["", "All"], ...items].map(([val, name, title]) => h("button", { class: "dw-chip", "data-key": key, "data-val": val, title: title || null,
        "aria-pressed": "false", onclick: () => this.set({ [key]: this.f[key] === val ? "" : val }) }, name)));
    const kinds = h("select", { class: "dw-kind", "aria-label": "Kind of drawing", onchange: e => this.set({ k: e.target.value }) },
      h("option", { value: "" }, "Every kind"),
      ...Object.entries(KINDS).filter(([k]) => Data.list.some(d => d.kind === k)).map(([k, [, many]]) => h("option", { value: k }, many)));
    this.top = h("div", { class: "dw-top" },
      h("div", { class: "dw-row" }, h("div", { class: "dw-qbox" }, box), this.count),
      h("div", { class: "dw-opts" },
        chips("s", PARTS.filter(p => Data.list.some(d => d.part === p.key)).map(p => [p.key, p.name, p.say]), "Part of the book"),
        h("span", { class: "dw-sep", "aria-hidden": "true" }),
        chips("w", Object.entries(KNOWN).filter(([k]) => Data.list.some(d => d.know === k)).map(([k, x]) => [k, x.name, x.say]), "What is known"),
        kinds));
    this.kindSel = kinds;
    this.gallery = h("div", { class: "dw-gallery" }, this.top, this.grid);
    this.detail = h("div", { class: "dw-view", hidden: true });
    v.replaceChildren(this.gallery, this.detail);
    this.obs = new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting) { this.obs.unobserve(e.target); this.thumb(e.target); }
    }, { root: this.grid, rootMargin: "400px 0px" });
    this.grid.addEventListener("click", e => {
      const c = e.target.closest(".dw-card");
      if (c) this.open(c.dataset.id);
    });
    this.built = true;
    this.renderGallery();
  },

  set(ch) {
    Object.assign(this.f, ch);
    if (ch.q === undefined && this.f.q) $("#dw-q").value = this.f.q;
    this.renderGallery();
    setHash();
  },

  /* the drawings that pass the filters; a group (the women round one medallion) is one card, unless the filters pick
     out some of its members only */
  filtered() {
    const words_ = this.f.q.toLowerCase().split(/\s+/).filter(Boolean);
    return Data.list.filter(d => (!this.f.s || d.part === this.f.s) && (!this.f.k || d.kind === this.f.k) && (!this.f.w || d.know === this.f.w)
      && words_.every(x => d.words.includes(x) || (x.replace(/^f/, "") === short(d.page))));
  },

  renderGallery() {
    if (!this.grid) return;
    for (const b of $$(".dw-chip", this.top)) b.setAttribute("aria-pressed", String(this.f[b.dataset.key] === b.dataset.val));
    this.kindSel.value = this.f.k;
    const got = this.filtered();
    const shown = [], seen = new Set();
    for (const d of got) {
      if (!d.group) { shown.push(d); continue; }
      if (seen.has(d.group)) continue;
      seen.add(d.group);
      shown.push({ group: d.group, members: got.filter(x => x.group === d.group), first: d });
    }
    const pages = new Set(got.map(d => d.page)).size;
    this.count.textContent = got.length ? `${got.length.toLocaleString("en")} drawing${got.length === 1 ? "" : "s"} on ${pages} page${pages === 1 ? "" : "s"}`
      : "No drawing matches";
    this.grid.replaceChildren();
    if (!got.length) {
      this.grid.append(h("div", { class: "dw-none" }, h("p", {}, "No drawing matches."), h("button", { onclick: () => { $("#dw-q").value = ""; this.set({ ...DEFAULTS }); } }, "Show every drawing")));
      return;
    }
    if (!this.f.s && !this.f.q && !this.f.k && !this.f.w) this.grid.append(this.intro());
    for (const part of PARTS) {
      const mine = shown.filter(x => (x.first || x).part === part.key);
      if (!mine.length) continue;
      const n = mine.reduce((a, x) => a + (x.members ? x.members.length : 1), 0);
      this.grid.append(h("section", { class: "dw-part" },
        h("h2", {}, part.name, h("span", { class: "n" }, ` ${n.toLocaleString("en")}`)),
        h("p", { class: "dw-part-say" }, part.say),
        h("div", { class: "dw-cards" }, mine.map(x => this.card(x)))));
    }
  },

  intro() {
    const g = Data.about.general || [];
    return h("div", { class: "dw-intro" },
      h("p", {}, h("b", {}, "Every drawing in the book, cut out of Yale's photographs. "),
        "Click one to see it alone, with what people agree it is, the ideas they have had, and what nobody knows. In the Reader, ",
        h("kbd", {}, "D"), " outlines the drawings on the page."),
      g.length ? h("details", { class: "dw-general" }, h("summary", {}, "What is known of the pictures as a whole"),
        h("ul", {}, g.map(x => h("li", {}, x.fact, x.src ? [" ", h("span", { class: "dw-src" }, "(", srcLink(x.src), ")")] : ""))))
        : "",
      h("p", { class: "dw-how muted" }, "The outlines were traced by a computer from the colours of the ink and paint, page by page, and checked by eye; ",
        "a faint stroke may be missing. “What it shows” is written from the photograph by Claude (Anthropic's AI model)."));
  },

  card(x) {
    const d = x.first || x, n = x.members ? x.members.length : 0;
    const name = n ? (aboutOf(d).short || d.name || KINDS[d.kind][0]) : titleOf(d);
    const el = h("button", { class: `dw-card${n ? " grp" : ""}`, "data-id": d.id, "data-n": n || null,
      "aria-label": `${name}${n > 1 ? `, ${n} of them` : ""}, page ${pageOf(d)}: ${KNOWN[d.know].name.toLowerCase()}` },
      h("span", { class: "dw-pic" }, h("canvas", { "aria-hidden": "true" })),
      h("span", { class: "dw-cap" }, h("b", {}, name), h("span", { class: "pg" }, pageOf(d), n > 1 ? ` · ${n}` : "")),
      h("i", { class: `dot ${d.know}`, title: KNOWN[d.know].name, "aria-hidden": "true" }));
    this.obs.observe(el);
    return el;
  },

  thumb(el) {
    const d = Data.byId.get(el.dataset.id), c = $("canvas", el);
    paint(c, d, { w: 156, h: 156, pad: 0.05 }).then(() => el.classList.add("ready")).catch(() => el.classList.add("failed"));
  },

  /* ---- one drawing ---- */
  open(id, on) {
    const d = Data.byId.get(id);
    if (!d) return;
    Privacy.event("drawing_opened");
    this.at = id;
    if (on) this.on = on;
    this.show();
    setHash();
  },
  back() {
    this.at = null;
    this.show();
    setHash();
    const c = this.lastCard && $(`.dw-card[data-id="${CSS.escape(this.lastCard)}"]`, this.grid);
    if (c) { c.scrollIntoView({ block: "nearest" }); c.focus({ preventScroll: true }); }
  },
  show() {
    if (!this.built) return;
    const d = this.at && Data.byId.get(this.at);
    if (this.at && !d) this.at = null;   // an address naming no drawing: all of them
    this.gallery.hidden = !!d;
    this.detail.hidden = !d;
    if (!d) { this.view = null; this.renderGallery(); return; }
    this.lastCard = d.group ? (Data.groups.get(d.group)?.[0]?.id || d.id) : d.id;
    this.renderView(d);
  },
  /* the drawings stepped through with ← →: those the gallery shows, in the book's order */
  around(d) {
    const list = this.filtered();
    const at = list.indexOf(d);
    return at < 0 ? [null, null] : [list[at - 1] || null, list[at + 1] || null];
  },

  async renderView(d) {
    const v = this.detail, gen = (this.gen = (this.gen || 0) + 1);
    const a = aboutOf(d), seg = Data.segs.get(d.img);
    const [prev, next] = this.around(d);
    const stage = h("div", { class: "dw-stage", id: "dw-stage" });
    const layer = h("div", { class: "dw-layer" });
    stage.append(layer);
    const sharp = h("span", { class: "dw-sharp", role: "status" });
    const modeBtn = on => h("button", { class: this.on === on ? "on" : "", "aria-pressed": String(this.on === on),
      onclick: () => { this.on = on; this.renderView(d); setHash(); } }, on === "cut" ? "Cut out" : ["On", h("span", { class: "txt" }, " its"), " page"]);
    const bar = h("div", { class: "dw-stagebar" },
      h("button", { class: "dw-back", onclick: () => this.back(), title: "Back to every drawing (Esc)" }, "‹ All", h("span", { class: "txt" }, " drawings")),
      h("div", { class: "dw-seg", role: "group", "aria-label": "Show the drawing" }, modeBtn("cut"), modeBtn("page")),
      h("span", { class: "grow" }),
      h("button", { title: "Save the drawing, cut out, as a picture with a see-through background", onclick: () => this.save(d) }, "Save", h("span", { class: "txt" }, " picture")));
    const navBtn = (x, dir) => h("button", { class: `dw-nav ${dir}`, disabled: !x, "aria-label": x ? `${dir === "prev" ? "Previous" : "Next"} drawing: ${titleOf(x)}, page ${pageOf(x)}` : null,
      title: x ? `${titleOf(x)} · ${pageOf(x)} (${dir === "prev" ? "←" : "→"})` : null, onclick: () => x && this.open(x.id) }, dir === "prev" ? "‹" : "›");
    stage.append(navBtn(prev, "prev"), navBtn(next, "next"), sharp);
    const info = this.info(d, a, seg);
    v.replaceChildren(h("div", { class: "dw-main" }, bar, stage), info);
    this.view = { d, stage, layer };
    // the picture: cut out on the table, or the whole page with the drawing lit
    const draw = async src => {
      if (gen !== this.gen) return;
      const r = stage.getBoundingClientRect();
      const W = Math.max(200, r.width - 96), H = Math.max(200, r.height - 40);
      if (this.on === "cut") {
        const c = $("canvas.dw-big", layer) || h("canvas", { class: "dw-big", role: "img", "aria-label": `${titleOf(d)}, cut out of page ${pageOf(d)}` });
        await paint(c, d, { w: W, h: H, pad: 0.04, src });
        if (!c.isConnected) layer.replaceChildren(c);
      } else {
        await this.onPage(d, layer, W, H, src);
      }
    };
    await draw(null).catch(() => layer.replaceChildren(h("p", { class: "dw-fail" }, "The picture could not load.")));
    this.zoom = zoomable(stage, layer, st => { layer.style.setProperty("--iz", 1 / st.z); if (st.z > 1.6) this.sharpen(d, draw, sharp); });
    this.ro?.disconnect();
    this.ro = new ResizeObserver(() => { if (this.view?.stage === stage && !stage.classList.contains("zoomed")) draw(this.yale.get(d.img)?.im || null); });
    this.ro.observe(stage);
    // full size from Yale once it is here, if it was loaded before or the drawing is small on its page
    if (this.yale.get(d.img)?.im) draw(this.yale.get(d.img).im);
    else if (d.box[3] < 330 && !navigator.connection?.saveData) this.sharpen(d, draw, sharp);
  },

  /* Yale's full-size photograph of the drawing's page (about 3,600 px tall, against the 1,400 px picture here), for
     a sharper picture zoomed in and a bigger saved picture */
  sharpen(d, draw, out) {
    const seg = Data.segs.get(d.img);
    if (!seg?.iiif || !seg.quad) return Promise.resolve(null);
    let y = this.yale.get(d.img);
    if (!y) {
      y = { p: Sharp.load(seg, Sharp.crop(seg)).then(loaded).then(im => (y.im = im)) };
      this.yale.set(d.img, y);
      y.p.catch(() => this.yale.delete(d.img));
    }
    if (!y.im && out) { out.textContent = "loading the full-size photograph from Yale…"; }
    return y.p.then(im => {
      if (out) { out.textContent = "full size, from Yale's photograph"; setTimeout(() => { out.textContent = ""; }, 2500); }
      if (draw && this.view?.d === d) draw(im);
      return im;
    }, () => { if (out) { out.textContent = "Yale's photograph could not be loaded"; setTimeout(() => { out.textContent = ""; }, 5000); } return null; });
  },

  /* the whole page, the drawing lit and the rest dimmed: where it is */
  async onPage(d, layer, W, H, src) {
    const doc = await Data.doc(d.img);
    const s = Math.min(W / (1000 * doc.aspect), H / 1000);
    const w = Math.round(1000 * doc.aspect * s), hh = Math.round(1000 * s);
    const im = src || await Pics.get(panelUrl(d.img, "l"));
    let box = $(".dw-pagebox", layer);
    if (!box) {
      box = h("div", { class: "dw-pagebox" });
      layer.replaceChildren(box);
    }
    box.style.width = w + "px"; box.style.height = hh + "px";
    const pic = h("canvas", { role: "img", "aria-label": `Page ${pageOf(d)}, with the drawing lit up` });
    const dpr = devicePixelRatio || 1;
    pic.width = Math.round(w * dpr); pic.height = Math.round(hh * dpr);
    pic.getContext("2d").drawImage(im, 0, 0, pic.width, pic.height);
    const svg = svgEl("svg", { viewBox: `0 0 ${(1000 * doc.aspect).toFixed(1)} 1000`, preserveAspectRatio: "none", class: "dw-lit" });
    const p = doc.paths[d.id];
    svg.append(svgEl("path", { class: "dim", d: `M0 0H${1000 * doc.aspect}V1000H0Z${p}`, "fill-rule": "evenodd" }),
      svgEl("path", { class: "edge u", d: p }), svgEl("path", { class: "edge", d: p }));
    box.replaceChildren(pic, svg);
  },

  info(d, a, seg) {
    const doc = Data.docs.get(d.img);
    const part = PARTS.find(p => p.key === d.part);
    const grp = d.group ? Data.groups.get(d.group) : null;
    const sec = (title, ...kids) => h("section", { class: "dw-sec" }, h("h3", {}, title), ...kids);
    const el = h("aside", { class: "dw-info", "aria-label": "About this drawing" },
      h("h2", { class: "dw-title" }, titleOf(d)),
      h("p", { class: "dw-where" },
        h("span", {}, `Page ${panelSay(d)}`), " · ", h("span", {}, part?.name || ""),
        grp ? [" · ", h("span", {}, `${d.n} of ${grp.length} on the page`)] : "",
        " · ", h("a", { href: "#", class: "dw-read", onclick: e => { e.preventDefault(); this.toReader(d); } }, "Open in the Reader")),
      knownTag(d, true));
    // what it is
    if (a.agreed) el.append(sec("What most agree it is", h("p", { class: "dw-agreed" }, a.agreed),
      a.strength ? h("p", { class: "dw-strength muted" }, STRENGTH[a.strength] || "", a.proof ? `: ${a.proof}` : "") : "",
      a.agreedSrc ? h("p", { class: "dw-src" }, "Sources: ", ...[].concat(a.agreedSrc).flatMap((k, i) => [i ? "; " : "", srcLink(k)])) : ""));
    else el.append(sec("What it is", h("p", { class: "dw-agreed none" },
      d.know === "unchecked" ? "Not looked into yet. The sources have not been searched for this drawing here, so there may be ideas about it that are not listed."
        : "Nobody knows. No one has shown what it is, and the sources checked agree on nothing.")));
    if (a.ideas?.length) el.append(sec(`Ideas people have had (${a.ideas.length})`,
      h("ul", { class: "dw-ideas" }, a.ideas.map(x => h("li", {},
        h("b", {}, x.what),
        x.who ? h("span", { class: "who" }, ` — ${x.who}${x.year ? `, ${x.year}` : ""}`) : "",
        x.note ? h("span", { class: "note" }, x.note) : "",
        x.src && srcLink(x.src) ? h("span", { class: "dw-src" }, srcLink(x.src)) : "")))));
    if (a.unknown) el.append(sec("What nobody knows", h("p", {}, a.unknown)));
    if (a.kindNote) el.append(h("p", { class: "dw-kindnote muted" }, `This is said of every ${(KINDS[d.kind]?.[0] || "drawing").toLowerCase()} in the book, not of this one alone.`));
    if (a.whose === "group") el.append(h("p", { class: "dw-kindnote muted" }, `Said of all ${grp?.length || ""} on this page together.`));
    if (a.facts?.length) el.append(sec("Worth knowing", h("ul", { class: "dw-facts" }, a.facts.map(f => h("li", {}, typeof f === "string" ? f : [f.fact, f.src && srcLink(f.src) ? [" ", h("span", { class: "dw-src" }, "(", srcLink(f.src), ")")] : ""])))));
    // what it shows
    const looks = d.looks || (d.group && Data.byId.get(d.group + "-1")?.looks) || "";
    if (looks) el.append(sec("What it shows", h("p", {}, looks), h("p", { class: "dw-by muted" }, "Described from the photograph by Claude (Anthropic's AI model).")));
    // the facts worked out from the photograph, once the panel's outlines are here
    const more = h("div", { class: "dw-more" });
    el.append(more);
    Data.doc(d.img).then(doc2 => {
      const f = doc2.facts[d.id] || {};
      if (f.labels?.length) more.append(sec(`Written beside it`,
        h("ul", { class: "dw-labels" }, f.labels.map(([loc, eva, gl]) => h("li", {},
          h("a", { href: `#read/${encodeURIComponent(S.order)}/${short(d.page)}/text?l=${encodeURIComponent(loc)}`, title: `Read ${loc} in the Reader's text` },
            h("span", { class: "gl", "aria-hidden": "true" }, gl), h("span", { class: "eva" }, eva))))),
        h("p", { class: "muted small" }, "The label words nearest it, in the book's glyphs and in Eva (RF1b). Nobody can read them yet.")));
      if (f.colours?.length) more.append(sec("Painted with",
        h("ul", { class: "dw-paints" }, f.colours.map(([name, share, hex]) => h("li", {},
          h("i", { style: { background: hex }, "aria-hidden": "true" }), name, h("span", { class: "muted" }, ` ${Math.round(share * 100)}%`)))),
        h("p", { class: "muted small" }, "How much of the drawing each paint covers, measured on the photograph.")));
      if (grp && grp.length > 1) more.append(sec(`All ${grp.length} on this page`, this.strip(grp, d)));
      const sim = (Data.similar[d.id] || []).map(([id]) => Data.byId.get(id)).filter(Boolean);
      if (sim.length) more.append(sec("Drawn alike", this.strip(sim, d),
        h("p", { class: "muted small" }, "Drawings of a like outline and colouring, found by computer: not a claim they show the same thing.")));
      const seen = (a.see || []).map(id => Data.byId.get(id)).filter(Boolean);
      if (seen.length) more.append(sec("Seen elsewhere in the book", this.strip(seen, d), a.seeNote ? h("p", { class: "muted small" }, a.seeNote) : ""));
    }).catch(() => {});
    el.append(h("p", { class: "dw-credit muted small" }, "Photograph: Beinecke Rare Book and Manuscript Library, Yale University, MS 408."));
    return el;
  },

  /* a row of small cut-outs, each opening its drawing */
  strip(list, cur) {
    const row = h("div", { class: "dw-strip" });
    for (const x of list) {
      const b = h("button", { class: `dw-mini${x === cur ? " cur" : ""}`, title: `${titleOf(x)} · ${pageOf(x)}`, "aria-label": `${titleOf(x)}, page ${pageOf(x)}`,
        "aria-current": x === cur ? "true" : null, onclick: () => x !== cur && this.open(x.id) }, h("canvas", { "aria-hidden": "true" }));
      row.append(b);
      paint($("canvas", b), x, { w: 64, h: 64, pad: 0.04, shadow: false }).catch(() => {});
    }
    return row;
  },

  toReader(d) {
    const sheet = PAGE_SHEET.get(d.page);
    if (!sheet) return;
    Lit.want = d.id;
    if (!DrawUI.open) DrawUI.toggle(true);
    setPos(d.page, sheet, "draw");
    show("read");   // the Reader opens where POS is, and lights the drawing up once its outlines are drawn
  },

  /* the drawing as a PNG with a see-through background, from Yale's full-size photograph if it can be had */
  async save(d) {
    Privacy.event("drawing_saved");
    toast("Cutting out the drawing from Yale's full-size photograph…");
    const im = (await Promise.race([this.sharpen(d, null, null), new Promise(ok => setTimeout(() => ok(null), 20000))])) || await Pics.get(panelUrl(d.img, "l"));
    const doc = await Data.doc(d.img);
    const k = im.naturalHeight / 1000;
    const c = document.createElement("canvas");
    const [bx, by, bw, bh] = d.box;
    c.width = Math.round(bw * k); c.height = Math.round(bh * k);
    const x = c.getContext("2d");
    x.setTransform(k, 0, 0, k, -bx * k, -by * k);
    x.clip(doc.p2.get(d.id), "evenodd");
    x.drawImage(im, 0, 0, 1000 * doc.aspect, 1000);
    const name = `voynich-${d.id.replace(/\./g, "-")}.png`;
    c.toBlob(b => {
      if (!b) { toast("The picture could not be made"); return; }
      const a = h("a", { href: URL.createObjectURL(b), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`Saved ${name} (${c.width} × ${c.height} px${k < 2 ? ", from the smaller picture: Yale's could not be loaded" : ""})`);
    }, "image/png");
  },

  key(e) {
    if (!this.built) return;
    if (e.target.closest?.("input, select, textarea")) return;
    const d = this.at && Data.byId.get(this.at);
    if (!d) return;
    if (e.key === "Escape") { e.preventDefault(); this.back(); return; }
    const [prev, next] = this.around(d);
    if (e.key === "ArrowLeft" && prev) { e.preventDefault(); this.open(prev.id); }
    else if (e.key === "ArrowRight" && next) { e.preventDefault(); this.open(next.id); }
    else if (e.key === "f" || e.key === "F") { this.on = this.on === "cut" ? "page" : "cut"; this.renderView(d); setHash(); }
    else if (e.key === "+" || e.key === "=") this.zoom?.at(1.5);
    else if (e.key === "-" || e.key === "_") this.zoom?.at(1 / 1.5);
    else if (e.key === "0") this.zoom?.reset();
  },
};
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
};

// ---------------------------------------------------------------- the drawings on the Reader's pages
/* Over each panel on show, an SVG of its drawings' outlines, inside the page so it zooms, pans and turns with it (as
   the words' shapes are, text.js). The outlines are faint until pointed at; a click lights the drawing up, dims the
   rest of the page and says what it is. A panel shown in your own re-cut is left alone: the outlines would not fit. */
const Lit = {
  sel: null, hov: null, want: null, wired: false,
  async decorate() {
    try { await Data.load(); } catch { return; }
    if (!DrawUI.open || S.view !== "read") return;
    this.wire();
    const segEls = SheetView?.inReader ? $$("#rd-stage .sv-over .seg[data-page]") : $$("#rd-zoomer .spread .seg[data-page]");
    for (const el of segEls) {
      const img = $("img", el)?.dataset.key;
      const mine = img && !CUSTOM_IMG.has(`${img}_l`) ? Data.list.filter(d => d.img === img) : [];
      if (!mine.length) { $(".seg-draws", el)?.remove(); continue; }
      let layer = $(".seg-draws", el);
      if (layer && layer.dataset.img === img) continue;
      layer?.remove();
      const doc = await Data.doc(img).catch(() => null);
      if (!doc || !el.isConnected || $(".seg-draws", el)) continue;
      layer = svgEl("svg", { class: "seg-draws", viewBox: `0 0 ${(1000 * doc.aspect).toFixed(1)} 1000`, preserveAspectRatio: "none", "aria-hidden": "true" });
      layer.dataset.img = img;
      const dim = svgEl("path", { class: "dim", "fill-rule": "evenodd" });
      layer.append(dim);
      // the biggest first, so a small drawing inside a big one (a woman in a pool) is on top and can be pointed at
      for (const d of mine.slice().sort((a, b) => b.area - a.area)) {
        const p = svgEl("path", { class: `dp ${d.know}`, d: doc.paths[d.id], "fill-rule": "evenodd" });
        p.dataset.id = d.id;
        layer.append(p);
      }
      layer.append(svgEl("g", { class: "marks" }));
      const rot = ((Number(($("img", el).style.transform.match(/rotate\((-?\d+)deg\)/) || [])[1]) || 0) % 360 + 360) % 360;
      layer.style.transform = rot ? `rotate(${rot}deg)` : "";
      el.append(layer);
    }
    if (this.want) {
      const id = this.want;
      if ($(`#rd-stage .dp[data-id="${CSS.escape(id)}"]`)) { this.want = null; this.pick(id, true); }
    }
    this.marks();
  },
  undecorate() {
    $$("#rd-stage .seg-draws").forEach(l => l.remove());
    $$("#rd-stage .dw-lit-seg").forEach(e => e.classList.remove("dw-lit-seg"));
    $("#rd-stage")?.classList.remove("dw-has-sel");
    $("#dw-tip")?.remove();
    $("#dw-pop")?.remove();
    this.sel = this.hov = null;
  },
  wire() {
    const st = $("#rd-stage");
    if (!st || st.dataset.draws) return;
    st.dataset.draws = "1";
    let down = null;
    const at = (x, y) => {
      if (TextUI.open && document.elementsFromPoint(x, y).some(el => el.classList?.contains("wb"))) return null;   // a word is under it: the text has it
      const hit = document.elementsFromPoint(x, y).find(el => el.classList?.contains("dp"));
      return hit ? hit.dataset.id : null;
    };
    st.addEventListener("pointermove", e => {
      if (!DrawUI.open || e.pointerType !== "mouse" || e.buttons) return;
      const id = at(e.clientX, e.clientY);
      if (id !== this.hov) { this.hov = id; this.marks(); this.tip(id); }
    });
    st.addEventListener("pointerleave", () => { if (this.hov) { this.hov = null; this.marks(); this.tip(null); } });
    st.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    st.addEventListener("pointerup", e => {
      if (!DrawUI.open || !down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), long = Date.now() - down.t;
      down = null;
      if (moved > 5 || long > 700 || e.target.closest("button, a, .dw-pop, .tx-peek")) return;
      const id = at(e.clientX, e.clientY);
      if (id) this.pick(id === this.sel ? null : id);
      else if (this.sel && document.elementsFromPoint(e.clientX, e.clientY).some(x => x.classList?.contains("seg"))) this.pick(null);
    });
  },
  pick(id, arrived = false) {
    this.sel = id;
    if (id) Privacy.event("drawing_lit");
    this.tip(null);
    this.marks();
    this.pop();
    if (arrived && id) requestAnimationFrame(() => $$("#rd-stage .seg-draws .out.sel").forEach(o => { o.classList.remove("flash"); void o.getBBox(); o.classList.add("flash"); }));
  },
  marks() {
    let any = false;
    for (const layer of $$("#rd-stage .seg-draws")) {
      const marks = $(".marks", layer), dim = $(".dim", layer), vb = layer.viewBox.baseVal;
      marks.replaceChildren();
      const out = (p, cls) => marks.append(svgEl("path", { d: p.getAttribute("d"), class: `out u ${cls}` }), svgEl("path", { d: p.getAttribute("d"), class: `out ${cls}` }));
      const sel = this.sel && $(`.dp[data-id="${CSS.escape(this.sel)}"]`, layer);
      if (sel) { dim.setAttribute("d", `M0 0H${vb.width}V1000H0Z` + sel.getAttribute("d")); out(sel, "sel"); any = true; }
      else dim.removeAttribute("d");
      const hp = this.hov && this.hov !== this.sel && $(`.dp[data-id="${CSS.escape(this.hov)}"]`, layer);
      if (hp) out(hp, "hov");
      layer.closest(".seg")?.classList.toggle("dw-lit-seg", !!sel);
    }
    $("#rd-stage")?.classList.toggle("dw-has-sel", any);
  },
  /* pointing at a drawing says in a line what it is */
  tip(id) {
    const t0 = $("#dw-tip");
    const d = id && Data.byId.get(id), p = d && $(`#rd-stage .dp[data-id="${CSS.escape(id)}"]`);
    if (!d || !p || id === this.sel) { t0?.remove(); return; }
    const st = $("#rd-stage"), r = p.getBoundingClientRect(), sr = st.getBoundingClientRect();
    const t = t0 || h("div", { id: "dw-tip", class: "dw-tip", role: "status" });
    t.replaceChildren(h("b", {}, titleOf(d)), " ", knownTag(d));
    if (!t.isConnected) st.append(t);
    t.style.left = Math.max(90, Math.min(sr.width - 90, r.left - sr.left + r.width / 2)) + "px";
    t.style.top = Math.max(40, r.top - sr.top) + "px";
  },
  /* a drawing lit up: a card beside the page says what it is, and opens it */
  pop() {
    $("#dw-pop")?.remove();
    const d = this.sel && Data.byId.get(this.sel);
    if (!d) return;
    const a = aboutOf(d);
    const looks = d.looks || (d.group && Data.byId.get(d.group + "-1")?.looks) || "";
    const line = a.agreed || (a.ideas?.length ? `Ideas: ${a.ideas.slice(0, 3).map(x => x.what).join("; ")}${a.ideas.length > 3 ? "…" : ""}` : looks || KNOWN[d.know].say + ".");
    const pop = h("div", { id: "dw-pop", class: "dw-pop", role: "dialog", "aria-label": titleOf(d) },
      h("div", { class: "dw-pop-pic" }, h("canvas", { "aria-hidden": "true" })),
      h("div", { class: "dw-pop-txt" },
        h("b", {}, titleOf(d)), " ", knownTag(d),
        h("p", {}, line),
        h("div", { class: "dw-pop-acts" },
          h("button", { class: "primary", onclick: () => { location.hash = `#draw/${encodeURIComponent(S.order)}/${encodeURIComponent(d.id)}`; } }, "See it alone"),
          h("button", { onclick: () => this.pick(null), "aria-label": "Close" }, "×"))));
    $("#rd-stage").append(pop);
    paint($("canvas", pop), d, { w: 72, h: 72, pad: 0.04, shadow: false }).catch(() => {});
  },
  key(e) {
    if (e.key === "Escape" && this.sel) { this.pick(null); return true; }
    return false;
  },
};

export default {
  mount: () => T.mount(),
  state: () => T.state(),
  key: e => T.key(e),
  decorate: () => Lit.decorate(),
  undecorate: () => Lit.undecorate(),
  readerKey: e => Lit.key(e),
};
