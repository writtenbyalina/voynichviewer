/* Voynich Viewer: your own work, kept in this browser.
   - Crops: re-cut any page from Yale's photograph (loaded from Yale's IIIF image server) with the crop editor.
     The corners and the cut images are kept in IndexedDB.
   - Your orders: copies of an order that you rearrange (arrange.js), kept in localStorage.
   - A progress file that exports both and imports them again, here or in another browser.
   Loaded after app.js; uses its globals (D, SHEETS, ORDERS, S, h, $, toast, imgUrl, ...). */
"use strict";

// ================================================================ storage
/* IndexedDB stores: "crops" (panel key -> your corners, rotation and size), "img" ("f1r_l" -> JPEG blob) and "work"
   ("orders" -> your own orders, also kept in localStorage). Without IndexedDB (some private windows) everything works
   in memory until the page is closed. */
const IDB = {
  db: null, mem: { crops: new Map(), img: new Map(), work: new Map() },
  async open() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open("voynich-viewer", 2);
        r.onupgradeneeded = () => { for (const n of ["crops", "img", "work"]) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    } catch { this.db = null; }
    return !!this.db;
  },
  run(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode), r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  get(store, k) { return this.db ? this.run(store, "readonly", s => s.get(k)) : Promise.resolve(this.mem[store].get(k)); },
  put(store, k, v) { if (this.db) return this.run(store, "readwrite", s => s.put(v, k)); this.mem[store].set(k, v); return Promise.resolve(); },
  del(store, k) { if (this.db) return this.run(store, "readwrite", s => s.delete(k)); this.mem[store].delete(k); return Promise.resolve(); },
  async entries(store) {
    if (!this.db) return [...this.mem[store]];
    const [keys, vals] = await Promise.all([this.run(store, "readonly", s => s.getAllKeys()), this.run(store, "readonly", s => s.getAll())]);
    return keys.map((k, i) => [k, vals[i]]);
  },
};

// ================================================================ Yale's photographs
const WORK_H = 2000;   // the photograph is loaded this tall (the originals are about 3,700 px); cuts are 1400 px tall
const Photo = {
  cache: new Map(),    // IIIF id -> Promise<{ img, k, px? }>, the last few only
  url: (id, h) => `https://collections.library.yale.edu/iiif/2/${encodeURIComponent(id)}/full/,${h}/0/default.jpg`,
  load(seg) {
    const id = seg.iiif;
    if (!id) return Promise.reject(new Error(`no photograph is known for ${pageName(seg)}`));
    if (!this.cache.has(id)) {
      if (this.cache.size >= 3) this.cache.delete(this.cache.keys().next().value);
      const H = seg.src_size[1], want = Math.min(H, WORK_H);
      this.cache.set(id, new Promise((res, rej) => {
        const img = new Image();
        img.crossOrigin = "anonymous";   // Yale's image server allows it, so the pixels can be read for cutting
        img.onload = () => res({ img, k: img.naturalHeight / H });
        img.onerror = () => { this.cache.delete(id); rej(new Error("Yale's photograph could not be loaded (are you online?)")); };
        img.src = this.url(id, want);
      }));
    }
    return this.cache.get(id);
  },
  pixels(p) {
    if (!p.px) {
      const c = document.createElement("canvas");
      c.width = p.img.naturalWidth; c.height = p.img.naturalHeight;
      const cx = c.getContext("2d", { willReadFrequently: true });
      cx.drawImage(p.img, 0, 0);
      p.px = cx.getImageData(0, 0, c.width, c.height);
    }
    return p.px;
  },
};

// ================================================================ cutting a panel out of a photograph
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function quadSize(q) {
  const d = (a, b) => Math.hypot(q[a][0] - q[b][0], q[a][1] - q[b][1]);
  return [Math.max(d(0, 1), d(3, 2)), Math.max(d(0, 3), d(1, 2))];
}
/* Coefficients mapping output points `dst` onto photograph points `src` (a perspective transform; four pairs). */
function perspective(dst, src) {
  const A = [], B = [];
  dst.forEach(([x, y], i) => {
    const [X, Y] = src[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); B.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); B.push(Y);
  });
  for (let c = 0; c < 8; c++) {   // Gaussian elimination with partial pivoting
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    for (let r = c + 1; r < 8; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  const x = new Array(8);
  for (let r = 7; r >= 0; r--) { let s = B[r]; for (let k = r + 1; k < 8; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
/* Cut `quad` (TL, TR, BR, BL in the full photograph's pixels) out of a loaded photograph, straighten it, scale it to at
   most outH tall and turn it `rotate` degrees clockwise. `mask` (a panel's polygons, also in the photograph's pixels)
   is painted over in the black of Yale's backdrop: another page that shows past a torn edge. Returns a canvas. */
function warp(photo, quad, outH, rotate = 0, mask = null) {
  const px = Photo.pixels(photo), k = photo.k;
  const q = quad.map(([x, y]) => [x * k, y * k]);
  const [w, hh] = quadSize(q);
  const s = Math.min(1, outH / hh), ow = Math.max(1, Math.round(w * s)), oh = Math.max(1, Math.round(hh * s));
  const [a, b, c, d, e, f, g, i] = perspective([[0, 0], [ow, 0], [ow, oh], [0, oh]], q);
  const cv = document.createElement("canvas"); cv.width = ow; cv.height = oh;
  const cx = cv.getContext("2d"), out = cx.createImageData(ow, oh), O = out.data, P = px.data, W = px.width, H = px.height;
  for (let y = 0; y < oh; y++) {
    const yy = y + .5;
    for (let x = 0; x < ow; x++) {
      const xx = x + .5, den = g * xx + i * yy + 1;
      let X = (a * xx + b * yy + c) / den - .5, Y = (d * xx + e * yy + f) / den - .5;
      X = X < 0 ? 0 : X > W - 1.001 ? W - 1.001 : X; Y = Y < 0 ? 0 : Y > H - 1.001 ? H - 1.001 : Y;
      const x0 = X | 0, y0 = Y | 0, fx = X - x0, fy = Y - y0;
      const p00 = (y0 * W + x0) * 4, p10 = p00 + 4, p01 = p00 + W * 4, p11 = p01 + 4, o = (y * ow + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = P[p00 + ch] + (P[p10 + ch] - P[p00 + ch]) * fx, bot = P[p01 + ch] + (P[p11 + ch] - P[p01 + ch]) * fx;
        O[o + ch] = top + (bot - top) * fy;
      }
      O[o + 3] = 255;
    }
  }
  cx.putImageData(out, 0, 0);
  if (mask?.length) {
    const [A, B, C, D, E, F, G, I] = perspective(q, [[0, 0], [ow, 0], [ow, oh], [0, oh]]);   // photograph -> cut
    cx.fillStyle = "#080609";
    cx.beginPath();
    for (const poly of mask) poly.forEach(([x, y], n) => {
      const X = x * k, Y = y * k, den = G * X + I * Y + 1;
      cx[n ? "lineTo" : "moveTo"]((A * X + B * Y + C) / den, (D * X + E * Y + F) / den);
    });
    cx.fill();
  }
  rotate = ((rotate % 360) + 360) % 360;
  if (!rotate) return cv;
  const r = document.createElement("canvas");
  [r.width, r.height] = rotate === 180 ? [ow, oh] : [oh, ow];
  const rx = r.getContext("2d");
  if (rotate === 90) rx.translate(oh, 0); else if (rotate === 180) rx.translate(ow, oh); else rx.translate(0, ow);
  rx.rotate(rotate * Math.PI / 180);
  rx.drawImage(cv, 0, 0);
  return r;
}
function shrink(cv, outH) {
  let src = cv;
  while (src.height / 2 >= outH) {   // halve first, so the small image stays sharp
    const t = document.createElement("canvas"); t.width = Math.round(src.width / 2); t.height = Math.round(src.height / 2);
    t.getContext("2d").drawImage(src, 0, 0, t.width, t.height); src = t;
  }
  const o = document.createElement("canvas"), s = outH / src.height;
  o.width = Math.max(1, Math.round(src.width * s)); o.height = outH;
  const cx = o.getContext("2d"); cx.imageSmoothingQuality = "high"; cx.drawImage(src, 0, 0, o.width, o.height);
  return o;
}
const toJpeg = (cv, q) => new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("could not encode the image")), "image/jpeg", q));

/* Snap the sides of `quad` that border the dark background onto the parchment edge, as straight lines; sides that run
   through parchment (a fold between two panels of one photograph) stay where they are. */
function fitParchment(photo, quad, src) {
  const px = Photo.pixels(photo), k = photo.k, W = px.width, H = px.height, P = px.data;
  const isP = (x, y) => { const o = (y * W + x) * 4; return P[o] * .299 + P[o + 1] * .587 + P[o + 2] * .114 > 70; };
  const q = quad.map(([x, y]) => [x * k, y * k]);
  const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const X0 = Math.max(0, Math.floor(x0 - .06 * (x1 - x0))), X1 = Math.min(W, Math.floor(x1 + .06 * (x1 - x0)));
  const Y0 = Math.max(0, Math.floor(y0 - .04 * (y1 - y0))), Y1 = Math.min(H, Math.floor(y1 + .04 * (y1 - y0)));
  const w = X1 - X0, h = Y1 - Y0;
  const steps = (a, b) => { const out = []; for (let t = Math.floor(a); t < Math.floor(b); t += 3) out.push(t); return out; };
  const rows = steps(h * .12, h * .88), cols = steps(w * .12, w * .88);
  const fitLine = (ts, vs) => {   // v = a t + b, dropping outliers twice
    let keep = ts.map(() => true), ab = null;
    const fit = () => {
      const T = ts.filter((_, i) => keep[i]), Vv = vs.filter((_, i) => keep[i]), n = T.length;
      const mt = T.reduce((s, x) => s + x, 0) / n, mv = Vv.reduce((s, x) => s + x, 0) / n;
      let sxy = 0, sxx = 0;
      T.forEach((t, i) => { sxy += (t - mt) * (Vv[i] - mv); sxx += (t - mt) ** 2; });
      const a = sxx ? sxy / sxx : 0;
      return [a, mv - a * mt];
    };
    for (let it = 0; it < 3; it++) {
      if (keep.filter(Boolean).length < 8) break;
      ab = fit();
      const r = ts.map((t, i) => Math.abs(vs[i] - (ab[0] * t + ab[1])));
      const kept = r.filter((_, i) => keep[i]).sort((a, b) => a - b);
      const mad = kept[kept.length >> 1] + 1;
      keep = r.map(x => x < 3 * mad);
    }
    return keep.filter(Boolean).length >= 2 ? fit() : null;
  };
  const lines = {};
  for (const side of ["L", "R"]) {
    const a = [], b = [];
    for (const r of rows) {
      const lim = Math.floor(w * .25);
      for (let i = 0; i < lim; i++) {
        const x = side === "L" ? X0 + i : X0 + w - 1 - i;
        if (isP(x, Y0 + r)) { if (i > 2) { a.push(r); b.push(side === "L" ? i : w - 1 - i); } break; }
      }
    }
    if (a.length > rows.length * .5) lines[side] = fitLine(a, b);   // x = m y + c
  }
  for (const side of ["T", "B"]) {
    const a = [], b = [];
    for (const c of cols) {
      const lim = Math.floor(h * .2);
      for (let i = 0; i < lim; i++) {
        const y = side === "T" ? Y0 + i : Y0 + h - 1 - i;
        if (isP(X0 + c, y)) { if (i > 2) { a.push(c); b.push(side === "T" ? i : h - 1 - i); } break; }
      }
    }
    if (a.length > cols.length * .5) lines[side] = fitLine(a, b);   // y = m x + c
  }
  const qs = q.map(([x, y]) => [x - X0, y - Y0]);
  const sideLine = (i, j, vertical) => {
    const [xa, ya] = qs[i], [xb, yb] = qs[j];
    if (vertical) { const m = (xb - xa) / ((yb - ya) || 1e-6); return [m, xa - m * ya]; }
    const m = (yb - ya) / ((xb - xa) || 1e-6); return [m, ya - m * xa];
  };
  const L = lines.L || sideLine(0, 3, true), R = lines.R || sideLine(1, 2, true), T = lines.T || sideLine(0, 1, false), B = lines.B || sideLine(3, 2, false);
  const meet = (v, hz) => { const y = (hz[0] * v[1] + hz[1]) / (1 - hz[0] * v[0]); return [v[0] * y + v[1], y]; };
  const [SW, SH] = src;
  return [meet(L, T), meet(R, T), meet(R, B), meet(L, B)].map(([x, y]) =>
    [Math.round(Math.min(SW, Math.max(0, (x + X0) / k))), Math.round(Math.min(SH, Math.max(0, (y + Y0) / k)))]);
}

// ================================================================ your crops
/* Panels a release has retired, so that crops people saved under their old key can be carried to the panels that replaced them
   (Crops.carry). A crop is four corners on Yale's photograph, saved under the panel's key; when a release splits a panel in two,
   that key stops existing and the crop would silently stop applying.
   `quad` and `rotate` are the panel's published crop in the release that retired it. `into` names each new panel and which of
   the old crop's edges ("L" left, "R" right) it still sits on: only the corners of the person's crop that they moved, on those
   edges, are carried, because a new panel is not the same piece of the photograph as the old one, and everything else about it is
   fitted by the published data.
   To retire another panel, add it here in the same release (and see tests/legacy/README.md). */
const RETIRED_PANELS = {
  // 1.1 split these two panels along the crease. f70r2's old crop ended mid-paragraph at x = 7775, inside f70r2-2, which now runs
  // to the page edge (x = 8752), so only its left edge is shared, with f70r2-1. f70v2 was cut in two, left half f70v2-2 (shares
  // the old left edge, x = 157) and right half f70v2-1 (shares the old right edge: 3550 then, 3522 now).
  f70r2: { quad: [[5331, 184], [7775, 184], [7775, 3704], [5331, 3704]], rotate: 0, into: { "f70r2-1": ["L"], "f70r2-2": [] } },
  f70v2: { quad: [[157, 96], [3550, 96], [3550, 3672], [157, 3672]], rotate: 0, into: { "f70v2-2": ["L"], "f70v2-1": ["R"] } },
};
const EDGE_CORNERS = { L: [0, 3], R: [1, 2] };   // corner order is TL, TR, BR, BL

const Crops = {
  base: new Map(),    // panel key -> the published crop { quad, rotate, w, h, v }
  mine: new Map(),    // panel key -> your crop { quad, rotate, w, h, v, updated }
  pending: new Set(), // keys whose images are being cut again (after an import, or a cleared cache)

  segs(key) {
    const out = [];
    for (const sh of D.sheets) for (const f of ["inside", "outside"]) for (const r of sh[f]) for (const sg of r) if (sg.img === key) out.push(sg);
    return out;
  },
  sheetOf(key) { return D.sheets.find(sh => ["inside", "outside"].some(f => sh[f].some(r => r.some(sg => sg.img === key)))); },

  async init() {
    for (const sh of D.sheets) for (const f of ["inside", "outside"]) for (const r of sh[f]) for (const sg of r)
      if (sg.img && !this.base.has(sg.img)) this.base.set(sg.img, { quad: sg.quad, rotate: sg.rotate || 0, w: sg.w, h: sg.h, v: sg.v });
    await IDB.open();
    let recs = [];
    try { recs = await IDB.entries("crops"); } catch { /* storage refused: start empty */ }
    recs = await this.carryRetired(recs);
    for (const [key, rec] of recs) if (this.base.has(key)) await this.use(key, rec, { quiet: true });
  },

  /* The crop a person saved for a retired panel (RETIRED_PANELS), as crops for the panels that replaced it: { newKey: record }.
     Only what is theirs is kept: a new panel gets the corners the person moved, on the edges it shares with the old crop, and its
     published corners for the rest; the turn they gave the page is added to the published turn. A panel where that leaves nothing different
     from the published crop gets no record, so it simply shows the published picture. Returns null, doing nothing, when the crop is
     malformed or the data no longer has the panels the table names (nothing is guessed). */
  carry(oldKey, rec) {
    const old = RETIRED_PANELS[oldKey];
    const quad = rec && rec.quad;
    if (!old || !Array.isArray(quad) || quad.length !== 4 || !quad.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return null;
    if (!Object.keys(old.into).every(k => this.base.has(k) && this.segs(k).length)) return null;
    const turn = ((((rec.rotate || 0) - old.rotate) % 360) + 360) % 360;
    const out = {};
    for (const [key, edges] of Object.entries(old.into)) {
      const pub = this.base.get(key), [W, H] = this.segs(key)[0].src_size;
      const q = pub.quad.map(p => [...p]);
      for (const e of edges) for (const i of EDGE_CORNERS[e]) {
        if (quad[i][0] === old.quad[i][0] && quad[i][1] === old.quad[i][1]) continue;   // not moved: the new published corner is the better one
        q[i] = [Math.min(W, Math.max(0, quad[i][0])), Math.min(H, Math.max(0, quad[i][1]))];
      }
      const rotate = ((pub.rotate || 0) + turn) % 360;
      if (rotate === (pub.rotate || 0) && q.every((p, i) => p[0] === pub.quad[i][0] && p[1] === pub.quad[i][1])) continue;   // nothing of theirs to keep
      let [w, h] = quadSize(q);
      if (rotate % 180) [w, h] = [h, w];
      out[key] = { quad: q, rotate, w: Math.round(w), h: Math.round(h), v: Date.now(), updated: rec.updated || new Date().toISOString() };
    }
    return out;
  },

  /* At start-up: carry each saved crop of a retired panel across, once. The old record is kept, marked with the panels it went to
     (`migratedTo`), so nothing is deleted, it is not carried again, and a crop the person later throws away does not come back.
     A panel the person has already cropped since is left as it is. Returns the records, with the new ones added. */
  async carryRetired(recs) {
    const have = new Set(recs.map(([k]) => k)), out = [...recs], done = [];
    for (const [key, rec] of recs) {
      if (this.base.has(key) || !RETIRED_PANELS[key] || !rec || rec.migratedTo) continue;
      const next = this.carry(key, rec);
      if (!next) continue;   // damaged, or the data has changed again: leave it exactly as it is
      const fresh = Object.entries(next).filter(([k]) => !have.has(k));
      try {
        for (const [k, r] of fresh) await IDB.put("crops", k, r);
        await IDB.put("crops", key, { ...rec, migratedTo: fresh.map(([k]) => k), migrated: new Date().toISOString() });
      } catch { continue; }   // could not save: leave everything as it was, and try again next time
      for (const [k, r] of fresh) { have.add(k); out.push([k, r]); }
      if (fresh.length) done.push([key, fresh.map(([k]) => k)]);
    }
    if (done.length) {
      const first = done[0][1][0];
      // a moment later, so it is not replaced by "could not cut ... again" when the photograph cannot be fetched right away
      setTimeout(() => toast(`Your crop of ${done.map(d => d[0]).join(" and ")} was carried over to the panel${done.some(d => d[1].length > 1) ? "s" : ""} it was split into in version 1.1: ${done.flatMap(d => d[1]).join(", ")}. Please check the edges.`,
        { label: "Check", fn: () => CropEditor.open(first) }), 1500);
    }
    return out;
  },

  /* Make a saved crop the one every view shows; cut its images again if they are not stored. */
  async use(key, rec, { quiet = false } = {}) {
    this.mine.set(key, rec);
    const [l, s] = await Promise.all([IDB.get("img", key + "_l"), IDB.get("img", key + "_s")]).catch(() => [null, null]);
    for (const sg of this.segs(key)) Object.assign(sg, { quad: rec.quad, rotate: rec.rotate, w: rec.w, h: rec.h, v: rec.v, custom: true });
    if (l && s) this.setUrls(key, l, s);
    else this.recut([key]);
    if (!quiet) afterCropChange(key);
  },

  setUrls(key, l, s) {
    for (const size of ["l", "s"]) { const old = CUSTOM_IMG.get(`${key}_${size}`); if (old) URL.revokeObjectURL(old); }
    CUSTOM_IMG.set(`${key}_l`, URL.createObjectURL(l));
    CUSTOM_IMG.set(`${key}_s`, URL.createObjectURL(s));
  },

  /* Cut both image sizes for a crop from Yale's photograph. */
  async cut(key, quad, rotate) {
    const sg = this.segs(key)[0];
    const photo = await Photo.load(sg);
    const big = warp(photo, quad, 1400, rotate, sg.mask);
    const [l, s] = await Promise.all([toJpeg(big, .86), toJpeg(shrink(big, 300), .82)]);
    let [w, hh] = quadSize(quad);
    if (rotate % 180) [w, hh] = [hh, w];
    return { l, s, w: Math.round(w), h: Math.round(hh) };
  },

  async save(key, quad, rotate) {
    const c = await this.cut(key, quad, rotate);
    const rec = { quad: quad.map(p => [...p]), rotate, w: c.w, h: c.h, v: Date.now(), updated: new Date().toISOString() };
    await Promise.all([IDB.put("img", key + "_l", c.l), IDB.put("img", key + "_s", c.s), IDB.put("crops", key, rec)]);
    this.setUrls(key, c.l, c.s);
    await this.use(key, rec);
    Work.changed();
  },

  async reset(key) {
    await Promise.all([IDB.del("crops", key), IDB.del("img", key + "_l"), IDB.del("img", key + "_s")]).catch(() => {});
    this.mine.delete(key);
    for (const size of ["l", "s"]) { const u = CUSTOM_IMG.get(`${key}_${size}`); if (u) URL.revokeObjectURL(u); CUSTOM_IMG.delete(`${key}_${size}`); }
    const b = this.base.get(key);
    for (const sg of this.segs(key)) { Object.assign(sg, { quad: b.quad, rotate: b.rotate, w: b.w, h: b.h, v: b.v }); delete sg.custom; }
    afterCropChange(key);
    Work.changed();
  },

  /* Cut the images of saved crops again, one after another (after an import, or when the browser dropped them). */
  async recut(keys) {
    const todo = keys.filter(k => !this.pending.has(k));
    todo.forEach(k => this.pending.add(k));
    Work.render();
    for (const key of todo) {
      const rec = this.mine.get(key);
      try {
        if (rec) {
          const c = await this.cut(key, rec.quad, rec.rotate);
          await Promise.all([IDB.put("img", key + "_l", c.l), IDB.put("img", key + "_s", c.s)]);
          this.setUrls(key, c.l, c.s);
          afterCropChange(key);
        }
      } catch (e) { toast(`Could not cut ${key} again: ${e.message}`); }
      this.pending.delete(key);
      Work.render();
    }
  },

  async resetAll() { for (const key of [...this.mine.keys()]) await this.reset(key); },
};

/* A panel's image or size changed: redraw whatever shows it. */
function afterCropChange(key) {
  if (R.order) {   // pages hold copies of the panels: rebuild them, keeping the place and the unfolding
    const u = { ...R.unfold }, at = R.at, focus = R.focus;
    Reader.open(R.order, curPage());
    R.at = at; R.unfold = u; R.focus = focus;
    if (S.view === "read") Reader.render(true);
  }
  SheetView.refresh();
  const sh = Crops.sheetOf(key);
  if (sh) View3D.refresh([sh.id]);
}

// ================================================================ the crop editor
/* Four draggable corners on Yale's photograph; the browser straightens the quad into the page image. */
const CE = { key: null, seg: null, quad: null, rotate: 0, zoom: 1, panX: 0, panY: 0, sel: null, dirty: false,
             photo: null, previewT: null, keys: null, token: 0 };

const CropEditor = {
  dlg: null,

  keys() {
    if (CE.keys) return CE.keys;
    const keys = [];
    for (const p of linearize(ORDERS.get("beinecke"))) for (const sg of p.segs) if (sg.img && !keys.includes(sg.img)) keys.push(sg.img);
    for (const sh of D.sheets) for (const f of ["inside", "outside"]) for (const r of sh[f]) for (const sg of r) if (sg.img && !keys.includes(sg.img)) keys.push(sg.img);
    return (CE.keys = keys);
  },

  build() {
    const d = h("dialog", { id: "crop-dlg", class: "crop-dlg" });
    d.append(
      h("div", { class: "ce-top" },
        h("button", { class: "ghost", title: "Previous page ([)", "aria-label": "Previous page", onclick: () => this.step(-1) }, "‹"),
        h("div", { class: "ce-title", id: "ce-title" }),
        h("button", { class: "ghost", title: "Next page (])", "aria-label": "Next page", onclick: () => this.step(1) }, "›"),
        h("span", { class: "ce-hint" }, "Drag the gold corners onto the edges of the page. Drag a side's square handle to move that side, or inside the frame to move it all. Hold Shift to keep a rectangle."),
        h("button", { onclick: () => this.close() }, "Close")),
      h("div", { class: "ce-body" },
        h("div", { class: "ce-stage", id: "ce-stage" },
          h("div", { class: "ce-world", id: "ce-world" },
            h("img", { id: "ce-img", alt: "", draggable: "false", crossorigin: "anonymous" }),
            document.createElementNS("http://www.w3.org/2000/svg", "svg")),
          h("canvas", { class: "ce-loupe", id: "ce-loupe", width: 200, height: 200 }),
          h("div", { class: "ce-zoom" },
            h("button", { title: "Zoom out (−)", "aria-label": "Zoom out", onclick: () => this.zoomBy(1 / 1.4) }, "−"),
            h("button", { title: "The whole photograph (0)", onclick: () => this.fitView() }, "Whole"),
            h("button", { title: "Zoom to the frame (Z)", onclick: () => this.fitView(true) }, "Frame"),
            h("button", { title: "Zoom in (+)", "aria-label": "Zoom in", onclick: () => this.zoomBy(1.4) }, "+")),
          h("div", { class: "ce-loading", id: "ce-loading" }, "Loading Yale's photograph…")),
        h("aside", { class: "ce-side" },
          h("h4", {}, "Result"),
          h("div", { class: "ce-prev", id: "ce-prev" }),
          h("div", { class: "muted small", id: "ce-size" }),
          h("div", { class: "ce-acts" },
            h("button", { title: "Snap the sides that touch the dark background onto the edge of the parchment", onclick: () => this.fit() }, "Fit to the page edge"),
            h("button", { title: "Turn the frame into an upright rectangle around it", onclick: () => this.square() }, "Square it up"),
            h("button", { title: "Turn the result anticlockwise (Shift R)", onclick: () => this.rot(-90) }, "↺ 90°"),
            h("button", { title: "Turn the result clockwise (R)", onclick: () => this.rot(90) }, "↻ 90°")),
          h("div", { class: "ce-acts" },
            h("button", { title: "Undo the changes since this page opened", onclick: () => this.revert() }, "Undo changes"),
            h("button", { id: "ce-reset", title: "Throw away your crop and go back to the published one", onclick: () => this.reset() }, "Back to the original crop")),
          h("div", { class: "ce-acts big" },
            h("button", { id: "ce-save", class: "primary", onclick: () => this.save(false) }, "Save"),
            h("button", { id: "ce-save-next", title: "Save and open the next page (Enter)", onclick: () => this.save(true) }, "Save & next ›")),
          h("p", { class: "muted small", id: "ce-status" }),
          h("p", { class: "muted small" }, "Your crops are kept in this browser. To keep a copy or carry on elsewhere, use ",
            h("button", { class: "linkish", onclick: () => Work.open() }, "Your work"), " to export them."),
          h("p", { class: "muted small" }, "Dashed outlines are the other pages cut from the same photograph. Photograph: Yale University, Beinecke MS 408."))));
    document.body.append(d);
    d.addEventListener("cancel", e => { e.preventDefault(); this.close(); });
    d.addEventListener("keydown", e => this.key(e));
    this.dlg = d;
    this.wire();
    new ResizeObserver(() => { if (d.open && CE.seg) this.applyView(); }).observe($("#ce-stage", d));
  },

  open(key) {
    if (!this.dlg) this.build();
    if (!this.dlg.open) this.dlg.showModal();
    this.load(key);
  },

  async load(key) {
    const segs = Crops.segs(key);
    if (!segs.length) { toast("No such page"); return; }
    const seg = segs[0], token = ++CE.token;
    Object.assign(CE, { key, seg, sheet: Crops.sheetOf(key), quad: seg.quad.map(p => [...p]), rotate: seg.rotate || 0, sel: null, dirty: false, photo: null });
    const [W, H] = seg.src_size;
    const img = $("#ce-img", this.dlg), svg = $("#ce-world svg", this.dlg), world = $("#ce-world", this.dlg);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", W); svg.setAttribute("height", H);
    Object.assign(img.style, { width: W + "px", height: H + "px" });
    world.style.width = W + "px"; world.style.height = H + "px";
    const i = this.keys().indexOf(key);
    $("#ce-title", this.dlg).replaceChildren(h("b", {}, `Crop ${pageName(seg)}`),
      h("span", { class: "muted" }, ` · sheet ${CE.sheet.id} · page ${i + 1} of ${this.keys().length}`));
    $("#ce-prev", this.dlg).replaceChildren();
    const loading = $("#ce-loading", this.dlg);
    loading.hidden = false; loading.textContent = "Loading Yale's photograph…";
    this.fitView(true);
    try {
      const photo = await Photo.load(seg);
      if (token !== CE.token) return;
      CE.photo = photo;
      img.src = photo.img.src;
      loading.hidden = true;
      this.render(); this.preview();
    } catch (e) {
      if (token === CE.token) loading.textContent = e.message;
    }
  },

  // ---- view ----
  stageRect() { return $("#ce-stage", this.dlg).getBoundingClientRect(); },
  applyView() { $("#ce-world", this.dlg).style.transform = `translate(${CE.panX}px, ${CE.panY}px) scale(${CE.zoom})`; this.render(); },
  fitView(toFrame) {
    const r = this.stageRect(), [W, H] = CE.seg.src_size;
    let x0 = 0, y0 = 0, x1 = W, y1 = H;
    if (toFrame) {
      const xs = CE.quad.map(p => p[0]), ys = CE.quad.map(p => p[1]);
      const pw = (Math.max(...xs) - Math.min(...xs)) * .08, ph = (Math.max(...ys) - Math.min(...ys)) * .06;
      x0 = Math.min(...xs) - pw; x1 = Math.max(...xs) + pw; y0 = Math.min(...ys) - ph; y1 = Math.max(...ys) + ph;
    }
    CE.zoom = Math.min((r.width - 20) / (x1 - x0), (r.height - 20) / (y1 - y0));
    CE.panX = (r.width - (x1 - x0) * CE.zoom) / 2 - x0 * CE.zoom;
    CE.panY = (r.height - (y1 - y0) * CE.zoom) / 2 - y0 * CE.zoom;
    this.applyView();
  },
  zoomBy(f, cx, cy) {
    const r = this.stageRect();
    cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
    const wx = (cx - CE.panX) / CE.zoom, wy = (cy - CE.panY) / CE.zoom;
    CE.zoom = Math.max(0.03, Math.min(6, CE.zoom * f));
    CE.panX = cx - wx * CE.zoom; CE.panY = cy - wy * CE.zoom;
    this.applyView();
  },
  toWorld(clientX, clientY) { const r = this.stageRect(); return [(clientX - r.left - CE.panX) / CE.zoom, (clientY - r.top - CE.panY) / CE.zoom]; },

  // ---- the frame ----
  render() {
    if (!CE.seg) return;
    const NS = "http://www.w3.org/2000/svg", svg = $("#ce-world svg", this.dlg);
    const [W, H] = CE.seg.src_size, z = CE.zoom, q = CE.quad;
    svg.innerHTML = "";
    const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); return e; };
    add("path", { d: `M0 0H${W}V${H}H0Z M${q.map(p => p.join(" ")).join(" L")} Z`, "fill-rule": "evenodd", fill: "rgba(10,10,10,.55)", "pointer-events": "none" });
    for (const sh of D.sheets) for (const f of ["inside", "outside"]) for (const r of sh[f]) for (const sg of r) {   // other pages from the same photograph
      if (!sg.img || sg.img === CE.key || sg.iiif !== CE.seg.iiif || !sg.quad) continue;
      add("polygon", { points: sg.quad.map(p => p.join(",")).join(" "), fill: "none", stroke: "#8fd3ff", "stroke-width": 1.5, "stroke-dasharray": "8 6", "vector-effect": "non-scaling-stroke", "pointer-events": "none" });
      add("text", { x: sg.quad[0][0] + 10 / z, y: sg.quad[0][1] + 22 / z, "font-size": 15 / z, fill: "#8fd3ff", "pointer-events": "none" }).textContent = pageName(sg);
    }
    add("polygon", { points: q.map(p => p.join(",")).join(" "), fill: "rgba(243,195,92,.04)", stroke: "#f3c35c", "stroke-width": 2, "vector-effect": "non-scaling-stroke", "data-h": "poly", style: "cursor: move" });
    for (const t of [1 / 3, 2 / 3]) {   // thirds guides help line the text up straight
      const a = lerp(q[0], q[3], t), b = lerp(q[1], q[2], t), c = lerp(q[0], q[1], t), d = lerp(q[3], q[2], t);
      for (const [p1, p2] of [[a, b], [c, d]]) add("line", { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: "rgba(243,195,92,.35)", "stroke-width": 1, "vector-effect": "non-scaling-stroke", "pointer-events": "none" });
    }
    const r = 10 / z;
    [[0, 1], [1, 2], [2, 3], [3, 0]].forEach(([a, b], i) => {
      const m = lerp(q[a], q[b], .5);
      add("rect", { x: m[0] - r * .8, y: m[1] - r * .8, width: r * 1.6, height: r * 1.6, fill: CE.sel === "e" + i ? "#f3c35c" : "#2d2925",
        stroke: "#f3c35c", "stroke-width": 2, "vector-effect": "non-scaling-stroke", "data-h": "e" + i, style: `cursor: ${i % 2 ? "ew-resize" : "ns-resize"}` });
    });
    q.forEach((p, i) => add("circle", { cx: p[0], cy: p[1], r, fill: CE.sel === i ? "#f3c35c" : "rgba(45,41,37,.85)",
      stroke: "#f3c35c", "stroke-width": 2.5, "vector-effect": "non-scaling-stroke", "data-h": String(i), style: "cursor: crosshair" }));
    const [w, hh] = quadSize(q), [ow, oh] = CE.rotate % 180 ? [hh, w] : [w, hh];
    $("#ce-size", this.dlg).textContent = `${Math.round(ow)} × ${Math.round(oh)} px of the photograph${CE.rotate ? ` · turned ${CE.rotate}°` : ""}`;
    $("#ce-status", this.dlg).textContent = (CE.dirty ? "Not saved yet. " : "") + (CE.seg.custom ? "This page uses your crop." : "This page uses the original crop.");
    $("#ce-reset", this.dlg).disabled = !CE.seg.custom && !CE.dirty;
  },

  wire() {
    const stage = $("#ce-stage", this.dlg);
    let drag = null;
    stage.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target.closest(".ce-zoom")) return;
      stage.setPointerCapture(e.pointerId);
      let hdl = e.target.getAttribute?.("data-h");
      const w = this.toWorld(e.clientX, e.clientY);
      const cands = [...CE.quad.map((p, i) => [String(i), p]), ...[[0, 1], [1, 2], [2, 3], [3, 0]].map(([a, b], i) => ["e" + i, lerp(CE.quad[a], CE.quad[b], .5)])];
      let best = null, bd = (e.pointerType === "touch" ? 34 : 22) / CE.zoom;   // the nearest handle within reach wins
      for (const [id, p] of cands) { const dd = Math.hypot(p[0] - w[0], p[1] - w[1]); if (dd < bd) { bd = dd; best = id; } }
      if (best != null) hdl = best;
      if (hdl == null) { drag = { kind: "pan", sx: e.clientX, sy: e.clientY, px: CE.panX, py: CE.panY }; stage.classList.add("panning"); return; }
      CE.sel = hdl === "poly" ? null : (/^\d$/.test(hdl) ? +hdl : hdl);
      drag = { kind: hdl, start: w, quad: CE.quad.map(p => [...p]) };
      this.render();
    });
    stage.addEventListener("pointermove", e => {
      if (!drag) return;
      if (drag.kind === "pan") { CE.panX = drag.px + e.clientX - drag.sx; CE.panY = drag.py + e.clientY - drag.sy; this.applyView(); return; }
      const w = this.toWorld(e.clientX, e.clientY), dx = w[0] - drag.start[0], dy = w[1] - drag.start[1];
      const q = drag.quad.map(p => [...p]);
      if (drag.kind === "poly") q.forEach(p => { p[0] += dx; p[1] += dy; });
      else if (drag.kind[0] === "e") {
        const i = +drag.kind[1], [a, b] = [[0, 1], [1, 2], [2, 3], [3, 0]][i];
        for (const k of [a, b]) { if (i % 2) q[k][0] += dx; else q[k][1] += dy; }
      } else {
        const i = +drag.kind;
        q[i] = [drag.quad[i][0] + dx, drag.quad[i][1] + dy];
        if (e.shiftKey) { q[[3, 2, 1, 0][i]][0] = q[i][0]; q[[1, 0, 3, 2][i]][1] = q[i][1]; }   // keep an upright rectangle
      }
      CE.quad = this.clamp(q); CE.dirty = true;
      this.render();
      this.loupe(drag.kind === "poly" ? null : this.focusPoint(drag.kind), e);
      this.preview();
    });
    const end = () => { if (!drag) return; drag = null; stage.classList.remove("panning"); this.loupe(null); };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("wheel", e => {
      e.preventDefault();
      const r = this.stageRect();
      if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(-Math.max(-40, Math.min(40, e.deltaY)) * 0.01), e.clientX - r.left, e.clientY - r.top);
      else { CE.panX -= e.deltaX; CE.panY -= e.deltaY; this.applyView(); }
    }, { passive: false });
  },
  focusPoint(kind) {
    if (typeof kind === "number" || /^\d$/.test(kind)) return CE.quad[+kind];
    const [a, b] = [[0, 1], [1, 2], [2, 3], [3, 0]][+String(kind)[1]];
    return lerp(CE.quad[a], CE.quad[b], .5);
  },
  clamp(q) { const [W, H] = CE.seg.src_size; return q.map(([x, y]) => [Math.round(Math.min(W, Math.max(0, x))), Math.round(Math.min(H, Math.max(0, y)))]); },

  /* magnifier: the photograph around the handle being dragged */
  loupe(p, e) {
    const c = $("#ce-loupe", this.dlg);
    if (!p || !CE.photo) { c.style.display = "none"; return; }
    const img = CE.photo.img, k = CE.photo.k, S = 200, span = Math.max(36, Math.min(260, S / Math.max(1.2, CE.zoom * 5)));
    const cx = c.getContext("2d");
    cx.fillStyle = "#111"; cx.fillRect(0, 0, S, S);
    cx.drawImage(img, (p[0] - span / 2) * k, (p[1] - span / 2) * k, span * k, span * k, 0, 0, S, S);
    const toL = ([x, y]) => [(x - p[0] + span / 2) * S / span, (y - p[1] + span / 2) * S / span];
    cx.strokeStyle = "#f3c35c"; cx.lineWidth = 1.5; cx.beginPath();
    CE.quad.forEach((pt, i) => { const [x, y] = toL(pt); i ? cx.lineTo(x, y) : cx.moveTo(x, y); });
    cx.closePath(); cx.stroke();
    cx.strokeStyle = "rgba(255,255,255,.7)"; cx.lineWidth = 1; cx.beginPath();
    cx.moveTo(S / 2, S / 2 - 12); cx.lineTo(S / 2, S / 2 + 12); cx.moveTo(S / 2 - 12, S / 2); cx.lineTo(S / 2 + 12, S / 2); cx.stroke();
    const r = this.stageRect(), left = e && (e.clientX - r.left) < r.width / 2;
    Object.assign(c.style, { display: "block", left: left ? "auto" : "12px", right: left ? "12px" : "auto" });
  },

  // ---- result ----
  preview() {
    clearTimeout(CE.previewT);
    CE.previewT = setTimeout(() => {
      if (!CE.photo) return;
      const box = $("#ce-prev", this.dlg);
      box.replaceChildren(warp(CE.photo, CE.quad, Math.min(560, Math.max(240, box.clientHeight * (devicePixelRatio || 1))), CE.rotate, CE.seg.mask));
    }, 90);
  },
  fit() {
    if (!CE.photo) { toast("The photograph is still loading"); return; }
    CE.quad = this.clamp(fitParchment(CE.photo, CE.quad, CE.seg.src_size)); CE.dirty = true; this.render(); this.preview();
  },
  square() {
    const xs = CE.quad.map(p => p[0]), ys = CE.quad.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    CE.quad = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; CE.dirty = true; this.render(); this.preview();
  },
  rot(d) { CE.rotate = ((CE.rotate + d) % 360 + 360) % 360; CE.dirty = true; this.render(); this.preview(); },
  revert() { CE.quad = CE.seg.quad.map(p => [...p]); CE.rotate = CE.seg.rotate || 0; CE.dirty = false; this.render(); this.preview(); },
  async reset() {
    if (!CE.seg.custom) { this.revert(); return; }
    if (!(await askYes("Go back to the original crop?", `Your crop of ${pageName(CE.seg)} will be thrown away.`, "Use the original"))) return;
    await Crops.reset(CE.key);
    toast(`${pageName(CE.seg)} is back to the original crop`);
    this.load(CE.key);
  },
  async save(next) {
    if (CE.saving) return;
    if (!CE.photo) { toast("The photograph is still loading"); return; }
    CE.saving = true;
    const b1 = $("#ce-save", this.dlg), b2 = $("#ce-save-next", this.dlg), label = [b1.textContent, b2.textContent];
    b1.disabled = b2.disabled = true; (next ? b2 : b1).textContent = "Saving…";
    try {
      await Crops.save(CE.key, CE.quad, CE.rotate);
      CE.dirty = false;
      const name = pageName(CE.seg);
      if (next) { await this.step(1, true); toast(`Saved ${name}`); }
      else { this.render(); $("#ce-status", this.dlg).textContent = `Saved. ${name} now uses your crop everywhere.`; toast(`Saved your crop of ${name}`); }
    } catch (e) {
      $("#ce-status", this.dlg).textContent = "Not saved: " + e.message;
      toast("Could not save: " + e.message);
    } finally {
      CE.saving = false; b1.disabled = b2.disabled = false; b1.textContent = label[0]; b2.textContent = label[1];
    }
  },
  async step(d, saved) {
    if (CE.dirty && !saved && !(await askYes("Leave this page?", "Your changes to this crop are not saved.", "Leave without saving", true))) return;
    const keys = this.keys(), i = keys.indexOf(CE.key);
    this.load(keys[(i + d + keys.length) % keys.length]);
  },
  async close() {
    if (CE.dirty && !(await askYes("Close the crop editor?", "Your changes to this crop are not saved.", "Close without saving", true))) return;
    this.loupe(null); CE.token++; this.dlg.close();
  },
  key(e) {
    if (e.target.closest("input, textarea, select")) return;
    const k = e.key;
    if (k === "Enter") { e.preventDefault(); this.save(true); }
    else if (k === "[") this.step(-1);
    else if (k === "]") this.step(1);
    else if (k === "+" || k === "=") this.zoomBy(1.4);
    else if (k === "-") this.zoomBy(1 / 1.4);
    else if (k === "0") this.fitView();
    else if (k === "z" || k === "Z") this.fitView(true);
    else if ((k === "r" || k === "R") && !e.metaKey && !e.ctrlKey) this.rot(e.shiftKey ? -90 : 90);
    else if (k.startsWith("Arrow")) {
      e.preventDefault();
      const st = e.shiftKey ? 10 : 1, dx = k === "ArrowLeft" ? -st : k === "ArrowRight" ? st : 0, dy = k === "ArrowUp" ? -st : k === "ArrowDown" ? st : 0;
      const q = CE.quad.map(p => [...p]), move = i => { q[i][0] += dx; q[i][1] += dy; };
      if (CE.sel == null) q.forEach((_, i) => move(i));
      else if (typeof CE.sel === "number") move(CE.sel);
      else { const [a, b] = [[0, 1], [1, 2], [2, 3], [3, 0]][+CE.sel[1]]; move(a); move(b); }
      CE.quad = this.clamp(q); CE.dirty = true; this.render(); this.preview();
      if (CE.sel != null) this.loupe(this.focusPoint(CE.sel));
    }
  },
};

// ================================================================ your orders
/* An order of your own: a full order (no base) with id "my-…", kept in localStorage under "mine". Every sheet is in
   it exactly once: in a gathering, or set aside in `unplaced`. */
/* Names the built-in orders had before they were renamed, so that copies made under an old name still know their source. */
const FORMER_TITLES = { "Davis: complete proposed order": "davis" };

const MyOrders = {
  list: [],
  load() {
    const raw = store.get("mine", []);
    this.list = (Array.isArray(raw) ? raw : []).map(o => this.clean(o)).filter(Boolean);
    return this.list;
  },
  /* Saved twice: in localStorage, read at start-up, and in IndexedDB next to your crops, in case either is cleared. */
  persist() { store.set("mine", this.list); IDB.put("work", "orders", this.list).catch(() => {}); Work.changed(); },
  /* At start-up: bring back orders that only one of the two stores still has. */
  async restore() {
    let saved = null;
    try { saved = await IDB.get("work", "orders"); } catch { /* no IndexedDB */ }
    const local = store.get("mine", null);
    const newest = l => Array.isArray(l) && l.length ? Math.max(...l.map(o => Date.parse(o.updated || 0) || 0)) : -1;
    if (Array.isArray(saved) && newest(saved) > newest(local)) store.set("mine", saved);
    else if (Array.isArray(local) && local.length && newest(local) > newest(saved)) IDB.put("work", "orders", local).catch(() => {});
  },
  isMine: id => typeof id === "string" && id.startsWith("my-"),
  get(id) { return this.list.find(o => o.id === id); },

  /* A sound order from anything that looks like one: known sheets only, each once, the rest set aside. */
  clean(o) {
    if (!o || typeof o !== "object" || !Array.isArray(o.gatherings)) return null;
    const seen = new Set();
    const gatherings = o.gatherings.map(g => {
      const bifolia = (Array.isArray(g.bifolia) ? g.bifolia : []).filter(id => SHEETS.has(id) && !seen.has(id) && seen.add(id));
      const sheets = {};
      for (const id of bifolia) {
        const opt = (g.sheets || {})[id];
        if (opt && typeof opt === "object") {
          const n = SHEETS.get(id).inside[0].length, keep = {};
          if (Number.isInteger(opt.spine) && opt.spine >= 1 && opt.spine < n) keep.spine = opt.spine;
          if (opt.inside_out) keep.inside_out = true;
          if (opt.rot180) keep.rot180 = true;
          if (Object.keys(keep).length) sheets[id] = keep;
        }
      }
      const q = typeof g.quire === "number" || (typeof g.quire === "string" && g.quire.trim()) ? g.quire : "?";
      return { quire: q, type: g.type === "singulions" ? "singulions" : "nested", bifolia, ...(Object.keys(sheets).length ? { sheets } : {}) };
    }).filter(g => g.bifolia.length);
    const unplaced = (Array.isArray(o.unplaced) ? o.unplaced : []).filter(id => SHEETS.has(id) && !seen.has(id) && seen.add(id));
    for (const id of SHEETS.keys()) if (!seen.has(id)) unplaced.push(id);   // nothing goes missing
    const id = this.isMine(o.id) ? o.id : this.newId();
    const title = String(o.title || "My order").slice(0, 80);
    // the built-in order it was started from: by its id, or (files from before ids were kept) by its title, then or now
    const builtIn = x => x && !this.isMine(x) && ORDERS.has(RETIRED[x] || x) ? RETIRED[x] || x : null;
    const fromId = builtIn(o.fromId) || builtIn([...ORDERS.values()].find(x => !x.mine && x.title === o.from)?.id) || builtIn(FORMER_TITLES[o.from]);
    const from = String(o.from || ""), now = fromId ? ORDERS.get(fromId).title : from;   // kept as written; shown by its name now
    return { id, title, mine: true, from, ...(fromId ? { fromId } : {}), gatherings, unplaced,
             subtitle: `Your own order${now ? `, started from “${now}”` : ""}. Saved in this browser.`, updated: o.updated || null };
  },
  newId: () => "my-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  freeTitle(base = "My order") {
    const names = new Set(this.list.map(o => o.title));
    if (!names.has(base)) return base;
    for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
  },

  /* A copy of any order to rearrange. */
  copyOf(order, title) {
    return this.clean({ id: this.newId(), title: title || this.freeTitle(), from: order.title, fromId: order.id,
      gatherings: order.gatherings.map(g => ({ quire: g.quire, type: g.type, bifolia: [...g.bifolia], sheets: JSON.parse(JSON.stringify(g.sheets || {})) })),
      unplaced: unplacedOf(order) });
  },

  /* Store an order (new or changed) and show it everywhere. */
  put(o, { show = true, ms, moved } = {}) {
    o = this.clean({ ...o, updated: new Date().toISOString() });
    const i = this.list.findIndex(x => x.id === o.id);
    if (i >= 0) this.list[i] = o; else this.list.push(o);
    ORDERS.set(o.id, o);   // before persist(), which redraws Your work and Rearrange from ORDERS
    this.persist();
    fillOrderSelect();
    if (!show && S.order === o.id) {   // renamed from Your work, say: the views showing it take the new version quietly
      $("#cx-order").title = o.subtitle || "";
      if (S.view === "three" && View3D.mod) View3D.open(o, { instant: true });
    }
    if (show) {
      if (S.order !== o.id) setOrder(o.id, { ms, moved });
      else {
        $("#cx-order").title = o.subtitle;
        if (S.view === "three") View3D.open(o, { ms, moved });
        if (S.view === "info") Collation.render();
      }
    }
    return o;
  },

  remove(id) {
    const from = ORDERS.get(id)?.fromId;
    this.list = this.list.filter(o => o.id !== id);
    ORDERS.delete(id);
    if (typeof Arrange !== "undefined") Arrange.hist.delete(id);   // its undo steps, versions and the quires it hid in 3D go with it
    Versions.drop(id);
    View3D.mod?.dropHidden(id);
    this.persist();
    if (S.order === id) setOrder(ORDERS.has(from) && !this.isMine(from) ? from : "beinecke");   // back to the order it was made from
    fillOrderSelect();
  },
};

// ================================================================ earlier versions of your orders
/* Your orders are saved as you change them, so that nothing has to be remembered to save. So that no version is lost
   either, the order as it was is kept here: before the first change each time you rearrange it, before a progress file is
   imported over it, and before an earlier version is brought back (so that going back loses nothing either). Up to 20 for
   each order, the oldest going first. Kept in this browser, beside the orders. */
const Versions = {
  MAX: 20,
  all: (() => { const v = store.get("versions", {}); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; })(),
  WHY: { before: "before you rearranged it", import: "before a file was imported over it", restore: "before an earlier version was restored" },
  list(id) { return Array.isArray(this.all[id]) ? this.all[id] : []; },
  key: o => JSON.stringify({ g: o.gatherings, u: o.unplaced || [] }),
  /* Keep `o` as it is now (nothing if the newest kept version is the same). */
  keep(o, why) {
    if (!o || !MyOrders.isMine(o.id)) return;
    const list = this.list(o.id);
    if (list.length && this.key(list.at(-1)) === this.key(o)) return;
    list.push({ at: new Date().toISOString(), why, title: o.title, gatherings: JSON.parse(JSON.stringify(o.gatherings)), unplaced: [...(o.unplaced || [])] });
    while (list.length > this.MAX) list.shift();
    this.all[o.id] = list;
    store.set("versions", this.all);
  },
  drop(id) { if (this.all[id]) { delete this.all[id]; store.set("versions", this.all); } },
  /* How a version differs from the order now, in a few words: how many sheets were moved (in another quire, out of step
     with the sheets around them, or folded another way: not the ones a move only pushed along, as Rearrange's gold dots). */
  diff(v, o) {
    const was = new Map();
    v.gatherings.forEach(g => g.bifolia.forEach((id, i) => was.set(id, { q: String(g.quire), i, o: JSON.stringify((g.sheets || {})[id] || {}) })));
    (v.unplaced || []).forEach((id, i) => was.set(id, { q: "\u0000aside", i, o: "{}" }));
    let n = 0;
    const count = (q, ids, opts) => {
      const mine = ids.map((id, i) => [id, i]).filter(([id]) => was.get(id)?.q === q);
      const stays = new Set(mine.filter((_, j) => keptOrder(mine.map(([id]) => was.get(id).i)).has(j)).map(([id]) => id));
      for (const id of ids) if (!stays.has(id) || was.get(id).o !== JSON.stringify(opts[id] || {})) n++;
    };
    o.gatherings.forEach(g => count(String(g.quire), g.bifolia, g.sheets || {}));
    count("\u0000aside", o.unplaced || [], {});
    return n ? `${n} sheet${n === 1 ? "" : "s"} moved since` : "the same as now";
  },
  /* Make a kept version the order again; the order as it is now is kept first. */
  restore(id, v) {
    const o = ORDERS.get(id); if (!o) return;
    this.keep(o, "restore");
    if (typeof Arrange !== "undefined" && S.order === id) { const hst = Arrange.histOf(id); hst.undo.push({ s: Arrange.snap(o), moved: null }); hst.redo = []; }
    MyOrders.put({ ...o, gatherings: JSON.parse(JSON.stringify(v.gatherings)), unplaced: [...v.unplaced] }, { ms: 900 });
    if (S.order !== id) setOrder(id);
    toast(`Restored the version of ${this.when(v.at)}. The order as it was is kept too.`);
  },
  /* A kept version as an order of its own, beside the order as it is now. */
  copy(id, v) {
    const o = ORDERS.get(id); if (!o) return;
    const c = MyOrders.put(MyOrders.clean({ id: MyOrders.newId(), title: MyOrders.freeTitle(`${o.title}, ${this.when(v.at)}`), from: o.from, fromId: o.fromId,
      gatherings: JSON.parse(JSON.stringify(v.gatherings)), unplaced: [...v.unplaced] }), { show: false });
    setOrder(c.id);
    toast(`Opened the version of ${this.when(v.at)} as “${c.title}”`);
  },
  when(at) {
    const d = new Date(at), now = new Date(), t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const day = (x, y) => x.toDateString() === y.toDateString();
    if (day(d, now)) return `today, ${t}`;
    if (day(d, new Date(now - 864e5))) return `yesterday, ${t}`;
    return `${d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" })}, ${t}`;
  },
  /* The list, newest first: when, why, how it differs from now; Restore or open it as a copy. */
  open(id) {
    const o = ORDERS.get(id); if (!o) return;
    const list = this.list(id).slice().reverse();
    // closed and gone at once: a closed dialog keeps the focus on its button until it is removed, and keys sent there are lost
    const done = () => { d.close(); d.remove(); };
    const d = h("dialog", { class: "ask versions-dlg" },
      h("h3", {}, `Earlier versions of “${o.title}”`),
      h("p", {}, "Your order is saved as you change it. Each time before you rearrange it, the order as it was is kept here."),
      list.length ? h("ul", { class: "work-list" }, list.map(v => h("li", {},
        h("span", {}, h("b", {}, this.when(v.at).replace(/^./, c => c.toUpperCase())), h("span", { class: "muted" }, ` ${this.WHY[v.why] || ""} · ${this.diff(v, o)}`)),
        h("span", { class: "work-row-acts" },
          h("button", { onclick: () => { done(); this.restore(id, v); } }, "Restore"),
          h("button", { onclick: () => { done(); this.copy(id, v); } }, "Open as a copy")))))
        : h("p", { class: "muted" }, "None yet: the first is kept when you next rearrange it."),
      h("div", { class: "ask-acts" }, h("button", { class: "primary", onclick: () => d.close() }, "Close")));
    const top = [...document.querySelectorAll("dialog[open]")].pop();
    (top || document.body).append(d);
    d.addEventListener("close", () => d.remove());
    d.showModal();
  },
};

// ================================================================ bookmarks
/* Pages you mark, each with a name you choose. Kept like your orders (localStorage, a copy in IndexedDB, and the
   progress file). Going to one moves the view you are in; the other view follows when you open it (POS in app.js). */
const Bookmarks = {
  list: [],
  pop: null,

  load() {
    const raw = store.get("bookmarks", []);
    this.list = (Array.isArray(raw) ? raw : []).map(b => this.clean(b)).filter(Boolean);
  },
  clean(b) {
    if (!b || typeof b !== "object" || !PAGE_SHEET.has(b.page)) return null;
    return { id: typeof b.id === "string" && b.id ? b.id : "bm-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
             page: b.page, name: String(b.name || "").trim().slice(0, 80) || short(b.page), at: b.at || new Date().toISOString() };
  },
  persist() {
    store.set("bookmarks", this.list);
    IDB.put("work", "bookmarks", this.list).catch(() => {});
    Work.changed();
    this.changed();
  },
  async restore() {   // bring back bookmarks that only one of the two stores still has
    let saved = null;
    try { saved = await IDB.get("work", "bookmarks"); } catch { /* no IndexedDB */ }
    const local = store.get("bookmarks", null);
    if (Array.isArray(saved) && saved.length && !(Array.isArray(local) && local.length)) store.set("bookmarks", saved);
    else if (Array.isArray(local) && local.length) IDB.put("work", "bookmarks", local).catch(() => {});
    this.load();
  },

  of(page) { return this.list.find(b => b.page === page); },
  onSheet(id) { return this.list.some(b => PAGE_SHEET.get(b.page) === id); },
  add(page, name) {
    if (!PAGE_SHEET.has(page) || this.of(page)) return;
    const b = this.clean({ page, name });
    this.list.push(b);
    this.persist();
    toast(`Bookmarked ${short(page)}`, { label: "Name it", fn: () => this.rename(b.id) });
  },
  remove(id) { this.list = this.list.filter(b => b.id !== id); this.persist(); },
  async rename(id) {
    const b = this.list.find(x => x.id === id);
    if (!b) return;
    const t = await askText("Name this bookmark", { value: b.name, ok: "Save", placeholder: "e.g. Waterspouts" });
    if (t == null) return;
    b.name = t.trim().slice(0, 80) || short(b.page);
    this.persist();
  },
  toggle(page) {
    if (!page) { toast("Pick a page first"); return; }
    const b = this.of(page);
    if (b) { this.remove(b.id); toast(`Removed the bookmark on ${short(page)}`); } else this.add(page);
  },
  go(b) { this.close(); goToPage(b.page, { open: true }); },
  /* B, or the Reader's button: one page in view is bookmarked at once; with more, the list opens to choose. */
  here() {
    const pages = herePages();
    if (pages.length === 1) this.toggle(pages[0]);
    else if (!pages.length) toast("Pick a page first");
    else this.open();
  },

  /* in reading order of the order shown; pages it leaves out come last */
  sorted() {
    const pos = new Map();
    linearize(ORDERS.get(S.order), { ghosts: true }).forEach((p, i) => { for (const s of p.segs) if (!pos.has(s.page)) pos.set(s.page, i); });
    return [...this.list].sort((a, b) => (pos.get(a.page) ?? 1e9) - (pos.get(b.page) ?? 1e9));
  },

  /* everything that shows bookmarks, redrawn after a change */
  changed() {
    if (R.order) { Reader.renderStrip(); if (S.view === "read" && !R.grid) Reader.render(true); else Reader.renderInfo(); }
    if (R.grid) Reader.renderGrid();
    View3D.mod?.marks();
    this.render();
  },

  // ---- the list, opened from ★ in the header ----
  open() {
    if (!this.pop) {
      this.pop = h("div", { id: "bm-pop", class: "bm-pop", role: "dialog", "aria-label": "Bookmarks", hidden: true });
      document.body.append(this.pop);
      document.addEventListener("pointerdown", e => { if (this.pop && !this.pop.hidden && !e.target.closest("#bm-pop, #cx-bm, dialog")) this.close(); });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && this.pop && !this.pop.hidden) { this.close(); e.stopPropagation(); } }, true);
    }
    this.pop.hidden = false;
    $("#cx-bm")?.setAttribute("aria-expanded", "true");
    this.render();
  },
  close() { if (this.pop) this.pop.hidden = true; $("#cx-bm")?.setAttribute("aria-expanded", "false"); },
  render() {
    $("#cx-bm")?.classList.toggle("has", this.list.length > 0);
    const el = this.pop;
    if (!el || el.hidden) return;
    const pages = herePages(), here = herePage();
    el.innerHTML = "";
    el.append(
      h("div", { class: "bm-head" }, h("b", {}, "Bookmarks"), h("button", { class: "ghost", "aria-label": "Close", onclick: () => this.close() }, "✕")),
      pages.length ? h("div", { class: "bm-here" },
        h("span", {}, pages.length > 1 ? "Bookmark a page you are looking at:" : "Bookmark the page you are looking at:"),
        h("div", { class: "bm-pages" }, pages.map(pg => { const b = this.of(pg);
          return h("button", { class: b ? "on" : "", "aria-pressed": b ? "true" : "false", title: b ? `Bookmarked as “${b.name}”: click to remove` : `Bookmark ${short(pg)}`,
            onclick: () => this.toggle(pg) }, `${b ? "★" : "☆"} ${short(pg)}`); }))) : "",
      this.list.length ? h("ul", { class: "bm-list" }, this.sorted().map(b => h("li", { class: b.page === here ? "cur" : "" },
        h("button", { class: "bm-go", title: `Go to ${short(b.page)}`, onclick: () => this.go(b) },
          h("span", { class: "bm-name" }, b.name), b.name === short(b.page) ? "" : h("span", { class: "bm-page" }, short(b.page))),
        h("button", { class: "ghost bm-mini", title: "Rename", "aria-label": `Rename ${b.name}`, onclick: () => this.rename(b.id) }, "✎"),
        h("button", { class: "ghost bm-mini", title: "Delete", "aria-label": `Delete ${b.name}`, onclick: () => this.remove(b.id) }, "✕"))))
        : h("p", { class: "muted small" }, "No bookmarks yet. Press ", h("kbd", {}, "B"), " on any page, in 3D or in the Reader, to mark it."),
      h("p", { class: "muted small" }, "Saved in this browser, and in your progress file (Your work)."));
  },
};

// ================================================================ your searches and page sets (the Text tab)
/* A saved search is the Text tab's address, named; a page set is a named list of pages that searches can keep to
   (Pages, or set:name in a query). Both are kept like bookmarks: in this browser twice over, and in the progress file. */
const Saved = {
  searches: [], sets: [], places: [],
  load() {
    const raw = store.get("text:searches", []), sets = store.get("text:sets", []), places = store.get("text:places", []);
    this.searches = (Array.isArray(raw) ? raw : []).map(x => this.cleanSearch(x)).filter(Boolean);
    this.sets = (Array.isArray(sets) ? sets : []).map(x => this.cleanSet(x)).filter(Boolean);
    this.places = (Array.isArray(places) ? places : []).map(x => this.cleanPlace(x)).filter(Boolean);
  },
  /* a note on a place: the words' address in the Reader, what they read, and what you make of them */
  cleanPlace(x) {
    if (!x || typeof x !== "object" || typeof x.hash !== "string" || !/^#read\/[^/]*\/[^/]+\/text\?w=/.test(x.hash)) return null;
    return { id: typeof x.id === "string" && x.id ? x.id : this.id("n-"), hash: x.hash.slice(0, 2000), label: String(x.label || "").trim().slice(0, 120),
             note: String(x.note || "").trim().slice(0, 2000), created: x.created || new Date().toISOString() };
  },
  addPlace(hash, label, note) {
    const x = this.cleanPlace({ hash, label, note });
    if (!x || !x.note) return null;
    this.places.push(x);
    this.persist();
    return x;
  },
  removePlace(id) { this.places = this.places.filter(x => x.id !== id); this.persist(); },
  /* the notes on a place: the same words (w= and n=) on the same page */
  placesAt(hash) {
    const key = h => { const m = h.match(/^(#read\/[^/]*\/[^/]+)\/text\?(?:.*&)?w=([^&]+)(?:&n=(\d+))?/); return m ? `${m[1]}|${m[2]}|${m[3] || 1}` : null; };
    const k = key(hash);
    return k ? this.places.filter(x => key(x.hash) === k) : [];
  },
  id: p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  cleanSearch(x) {
    if (!x || typeof x !== "object" || typeof x.hash !== "string" || !/^#text\/[^/]*\/search/.test(x.hash)) return null;
    return { id: typeof x.id === "string" && x.id ? x.id : this.id("s-"), name: String(x.name || "").trim().slice(0, 80) || "Search",
             hash: x.hash.slice(0, 2000), created: x.created || new Date().toISOString() };
  },
  cleanSet(x) {
    if (!x || typeof x !== "object" || !Array.isArray(x.pages)) return null;
    const pages = [...new Set(x.pages.filter(p => PAGE_SHEET.has(p)))];
    const name = String(x.name || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!pages.length || !name) return null;
    return { id: typeof x.id === "string" && x.id ? x.id : this.id("p-"), name, pages, created: x.created || new Date().toISOString() };
  },
  persist() {
    store.set("text:searches", this.searches);
    store.set("text:sets", this.sets);
    store.set("text:places", this.places);
    IDB.put("work", "searches", this.searches).catch(() => {});
    IDB.put("work", "pagesets", this.sets).catch(() => {});
    IDB.put("work", "places", this.places).catch(() => {});
    Work.changed();
    if (TextTab.mod) TextTab.mod.savedChanged();
  },
  async restore() {
    let a = null, b = null, c = null;
    try { [a, b, c] = await Promise.all([IDB.get("work", "searches"), IDB.get("work", "pagesets"), IDB.get("work", "places")]); } catch { /* no IndexedDB */ }
    if (Array.isArray(a) && a.length && !store.get("text:searches", []).length) store.set("text:searches", a);
    if (Array.isArray(b) && b.length && !store.get("text:sets", []).length) store.set("text:sets", b);
    if (Array.isArray(c) && c.length && !store.get("text:places", []).length) store.set("text:places", c);
    this.load();
  },
  addSearch(name, hash) {
    const x = this.cleanSearch({ name, hash });
    if (!x) return null;
    this.searches.push(x);
    this.persist();
    return x;
  },
  removeSearch(id) { this.searches = this.searches.filter(x => x.id !== id); this.persist(); },
  setNamed(name) { return this.sets.find(x => x.name === String(name).toLowerCase()); },
  putSet(name, pages) {
    const x = this.cleanSet({ name, pages, id: this.setNamed(name)?.id });
    if (!x) return null;
    this.sets = this.sets.filter(y => y.name !== x.name).concat(x);
    this.persist();
    return x;
  },
  removeSet(id) { this.sets = this.sets.filter(x => x.id !== id); this.persist(); },
};

// ================================================================ your work: export and import
const Work = {
  dlg: null, asked: false,
  async init() { await Crops.init(); await MyOrders.restore(); await Bookmarks.restore(); await Saved.restore(); },
  changed() {
    store.set("workChanged", Date.now());
    this.keep();
    this.render();
    if (typeof Arrange !== "undefined" && Arrange.on) Arrange.render();
  },
  /* Ask the browser to keep this site's storage rather than clear it when space runs low. */
  async keep() {
    if (this.asked || !navigator.storage?.persist) return;
    this.asked = true;
    try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* not offered */ }
  },
  pickFile() {
    const f = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: e => { this.importFile(e.target.files[0]); f.remove(); } });
    document.body.append(f); f.click();
  },

  open() {
    if (!this.dlg) {
      this.dlg = h("dialog", { id: "work-dlg", class: "work-dlg" });
      this.dlg.addEventListener("click", e => { if (e.target === this.dlg) this.dlg.close(); });
      document.body.append(this.dlg);
    }
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
  },

  render() {
    const d = this.dlg;
    if (!d) return;
    d.innerHTML = "";
    const crops = [...Crops.mine.keys()].sort((a, b) => CropEditor.keys().indexOf(a) - CropEditor.keys().indexOf(b));
    const orders = MyOrders.list;
    const file = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: e => this.importFile(e.target.files[0]) });
    d.append(
      h("div", { class: "work-head" }, h("h3", {}, "Your work"), h("button", { class: "ghost", "aria-label": "Close", onclick: () => d.close() }, "✕")),
      h("p", {}, "Your crops, your own orders, your bookmarks and your searches are saved in this browser as you go. They stay on this computer only, and clearing the browser's data deletes them. ",
        h("b", {}, "Export"), " a progress file to keep a copy, or to carry on in another browser; ", h("b", {}, "import"), " it there."),
      IDB.db ? "" : h("p", { class: "warn" }, "This browser is not letting the viewer store data (a private window?). Your work lasts until you close the page, so export it before you go."),
      h("div", { class: "work-acts" },
        h("button", { class: "primary", onclick: () => this.exportFile(), disabled: !crops.length && !orders.length && !Bookmarks.list.length && !Saved.searches.length && !Saved.sets.length && !Saved.places.length || null }, "⬇ Export progress file"),
        h("button", { onclick: () => file.click() }, "⬆ Import a progress file…"), file),
      h("h4", {}, `Your orders (${orders.length})`),
      orders.length ? h("ul", { class: "work-list" }, orders.map(o => h("li", {},
        h("button", { class: "linkish", title: "Show this order", onclick: () => { setOrder(o.id); d.close(); } }, o.title),
        h("span", { class: "muted" }, ` ${o.gatherings.length} gatherings${o.unplaced.length ? ` · ${o.unplaced.length} set aside` : ""}${o.from ? ` · from ${o.from}` : ""}`),
        h("span", { class: "work-row-acts" },
          h("button", { onclick: () => { setOrder(o.id); show("three"); Arrange.open(); d.close(); } }, "Rearrange"),
          h("button", { onclick: async () => { const t = await askText("Rename this order", { value: o.title, ok: "Rename" }); if (t) MyOrders.put({ ...o, title: t }, { show: false }); } }, "Rename"),
          Versions.list(o.id).length ? h("button", { title: "The order as it was before each time you rearranged it", onclick: () => Versions.open(o.id) }, `Versions (${Versions.list(o.id).length})`) : "",
          h("button", { onclick: async () => { if (await askYes(`Delete “${o.title}”?`, "This cannot be undone, unless you exported it.", "Delete", true)) MyOrders.remove(o.id); } }, "Delete")))))
        : h("p", { class: "muted" }, "None yet. In 3D, press ", h("b", {}, "Rearrange"), " to make your own order of the sheets."),
      h("h4", {}, `Your bookmarks (${Bookmarks.list.length})`),
      Bookmarks.list.length ? h("div", { class: "work-chips" }, Bookmarks.sorted().map(b => h("button", { title: `Go to ${short(b.page)}`, onclick: () => { d.close(); Bookmarks.go(b); } }, `★ ${b.name}`)))
        : h("p", { class: "muted" }, "None yet. Press B on any page, or use ★ at the top."),
      h("h4", {}, `Your searches (${Saved.searches.length})`),
      Saved.searches.length ? h("ul", { class: "work-list" }, Saved.searches.map(x => h("li", {},
        h("a", { class: "linkish", href: x.hash, onclick: () => d.close() }, x.name),
        h("span", { class: "work-row-acts" },
          h("button", { onclick: async () => { const t = await askText("Rename this search", { value: x.name, ok: "Rename" }); if (t) { x.name = t.slice(0, 80); Saved.persist(); } } }, "Rename"),
          h("button", { onclick: () => Saved.removeSearch(x.id) }, "Delete")))))
        : h("p", { class: "muted" }, "None yet. In the Text tab, search, then press Save."),
      h("h4", {}, `Your notes on places (${Saved.places.length})`),
      Saved.places.length ? h("ul", { class: "work-list" }, Saved.places.map(x => h("li", {},
        h("a", { class: "linkish", href: x.hash, onclick: () => d.close() }, x.label || "a place"), " ", h("span", { class: "muted" }, x.note),
        h("span", { class: "work-row-acts" },
          h("button", { onclick: async () => { const t = await askText("The note", { value: x.note, ok: "Save" }); if (t) { x.note = t.slice(0, 2000); Saved.persist(); } } }, "Edit"),
          h("button", { onclick: () => Saved.removePlace(x.id) }, "Delete")))))
        : h("p", { class: "muted" }, "None yet. Choose a word in the Reader's text and press ✎ to note what you make of it."),
      h("h4", {}, `Your page sets (${Saved.sets.length})`),
      Saved.sets.length ? h("ul", { class: "work-list" }, Saved.sets.map(x => h("li", {},
        h("span", { class: "mono" }, `set:${x.name}`), h("span", { class: "muted" }, ` ${x.pages.length} page${x.pages.length === 1 ? "" : "s"}`),
        h("span", { class: "work-row-acts" }, h("button", { onclick: async () => { if (await askYes(`Delete the page set “${x.name}”?`, "Searches that use it will search the whole book.", "Delete", true)) Saved.removeSet(x.id); } }, "Delete")))))
        : h("p", { class: "muted" }, "None yet. In the Text tab, Pages → New page set, to keep searches to pages you choose."),
      h("h4", {}, `Your crops (${crops.length})`),
      crops.length ? h("div", { class: "work-chips" }, crops.map(k => h("button", { class: Crops.pending.has(k) ? "busy" : "", title: Crops.pending.has(k) ? "Being cut from Yale's photograph…" : "Open in the crop editor",
        onclick: () => { d.close(); CropEditor.open(k); } }, short(pageName(Crops.segs(k)[0]))))) : h("p", { class: "muted" }, "None yet. Hover over a page in the Reader and click ✂ Crop, or use the ✂ buttons in 3D."),
      Crops.pending.size ? h("p", { class: "muted" }, `Cutting ${Crops.pending.size} page${Crops.pending.size === 1 ? "" : "s"} from Yale's photographs…`) : "",
      crops.length ? h("div", { class: "work-acts" }, h("button", { onclick: async () => { if (await askYes("Throw away all your crops?", "Every page goes back to the original crop.", "Throw them away", true)) await Crops.resetAll(); } }, "Throw away all crops")) : "",
      h("p", { class: "muted small" }, "A progress file holds only the corners of your crops and the order of your sheets, so it is small. The page images are cut again from Yale's photographs when you import it."));
  },

  exportFile() {
    // version 2 adds searches and page sets, version 3 notes on places; older files still import as they always did
    const data = { app: "voynich-viewer", version: 3, exported: new Date().toISOString(),
      crops: Object.fromEntries([...Crops.mine].map(([k, r]) => [k, { quad: r.quad, rotate: r.rotate }])),
      orders: MyOrders.list.map(({ id, title, from, fromId, gatherings, unplaced, updated }) => ({ id, title, from, fromId, gatherings, unplaced, updated })),
      bookmarks: Bookmarks.list.map(({ id, page, name, at }) => ({ id, page, name, at })),
      searches: Saved.searches.map(({ id, name, hash, created }) => ({ id, name, hash, created })),
      pagesets: Saved.sets.map(({ id, name, pages, created }) => ({ id, name, pages, created })),
      places: Saved.places.map(({ id, hash, label, note, created }) => ({ id, hash, label, note, created })), viewer: APP_VERSION };
    const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })),
      download: `voynich-viewer-progress-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Progress file saved to your downloads");
  },

  async importFile(f) {
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { toast("That file is not a progress file (it is not JSON)"); return; }
    if (!data || data.app !== "voynich-viewer") { toast("That file is not a Voynich Viewer progress file"); return; }
    let nOrders = 0, current = false;
    for (const o of Array.isArray(data.orders) ? data.orders : []) {
      const c = MyOrders.clean(o);
      if (c) { const was = ORDERS.get(c.id); if (was && MyOrders.isMine(was.id) && Versions.key(was) !== Versions.key(c)) Versions.keep(was, "import");
        MyOrders.put(c, { show: false }); nOrders++; current ||= c.id === S.order; if (typeof Arrange !== "undefined") Arrange.hist.delete(c.id); }   // its undo steps were for the version it replaced
    }
    if (current) setOrder(S.order);   // the order on screen came in again: every view shows the imported version
    const keys = [];
    const crops = { ...(data.crops || {}) };
    for (const [oldKey, r] of Object.entries(data.crops || {})) {   // a file from before a panel was split: carry its crop to the new panels
      if (Crops.base.has(oldKey) || !RETIRED_PANELS[oldKey]) continue;
      for (const [k, rec] of Object.entries(Crops.carry(oldKey, r) || {})) if (!(k in crops)) crops[k] = { quad: rec.quad, rotate: rec.rotate };
    }
    for (const [key, r] of Object.entries(crops)) {
      if (!Crops.base.has(key) || !Array.isArray(r?.quad) || r.quad.length !== 4) continue;
      const sg = Crops.segs(key)[0], [W, H] = sg.src_size;
      const quad = r.quad.map(p => [Math.min(W, Math.max(0, +p[0] || 0)), Math.min(H, Math.max(0, +p[1] || 0))]);
      const rotate = [0, 90, 180, 270].includes(r.rotate) ? r.rotate : 0;
      let [w, hh] = quadSize(quad); if (rotate % 180) [w, hh] = [hh, w];
      const rec = { quad, rotate, w: Math.round(w), h: Math.round(hh), v: Date.now(), updated: new Date().toISOString() };
      await IDB.put("crops", key, rec).catch(() => {});
      await Promise.all([IDB.del("img", key + "_l"), IDB.del("img", key + "_s")]).catch(() => {});
      this.mineSet(key, rec);
      keys.push(key);
    }
    let nBm = 0;
    for (const raw of Array.isArray(data.bookmarks) ? data.bookmarks : []) {
      const b = Bookmarks.clean(raw);
      if (!b || Bookmarks.of(b.page)) continue;
      Bookmarks.list.push(b); nBm++;
    }
    if (nBm) Bookmarks.persist();
    let nS = 0;   // version 2: searches and page sets
    for (const raw of Array.isArray(data.searches) ? data.searches : []) {
      const x = Saved.cleanSearch(raw);
      if (!x || Saved.searches.some(y => y.id === x.id || y.hash === x.hash)) continue;
      Saved.searches.push(x); nS++;
    }
    for (const raw of Array.isArray(data.pagesets) ? data.pagesets : []) {
      const x = Saved.cleanSet(raw);
      if (!x || Saved.setNamed(x.name)) continue;
      Saved.sets.push(x); nS++;
    }
    for (const raw of Array.isArray(data.places) ? data.places : []) {   // version 3: notes on places
      const x = Saved.cleanPlace(raw);
      if (!x || !x.note || Saved.places.some(y => y.id === x.id)) continue;
      Saved.places.push(x); nS++;
    }
    if (nS) Saved.persist();
    const said = [`${nOrders} order${nOrders === 1 ? "" : "s"}`, `${keys.length} crop${keys.length === 1 ? "" : "s"}`, `${nBm} bookmark${nBm === 1 ? "" : "s"}`];
    if (nS) said.push(`${nS} search${nS === 1 ? "" : "es"}, page set${nS === 1 ? "" : "s"} and note${nS === 1 ? "" : "s"}`);
    toast(`Imported ${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}`);
    this.render();
    if (keys.length) Crops.recut(keys);
  },
  mineSet(key, rec) {
    Crops.mine.set(key, rec);
    for (const sg of Crops.segs(key)) Object.assign(sg, { quad: rec.quad, rotate: rec.rotate, w: rec.w, h: rec.h, v: rec.v, custom: true });
  },
};
