/* Voynich Viewer, 3D view: MS 408 as a book block you can turn in any direction.
   WebGL with three.js r184 (vendored in ./vendor, MIT). app.js loads this module the first time the 3D tab opens;
   it reads app.js's globals (D, SHEETS, ORDERS, S, POS, sidesOf, handled, varsOf, h, ...) directly.

   The model is physical. Every leaf is a hinged chain of panels, ported from the old CSS sheet3D(): spine index,
   inside-out, rot180, extra panels rolled onto the inside of the sheet, the Rose sheet's top half folded down.
   Leaves stand in the order they lie in the closed book, each pivoting at the spine, and a sheet's two leaves are
   joined by its fold at the back: the folds of a nested quire wrap one inside another, a singulion has its own.

   Book space: thickness along +x (front of the book on the left, so reading order runs left to right), head +y,
   fore-edge +z. A leaf's angle a is 0 when the book is closed, -90 lying open to the left, +90 to the right.
   Standing, book space is world space (the book stands on its tail); lying, it is turned onto the desk. */
import * as THREE from "./vendor/three.module.min.js";

const H = 100;                 // page height in world units
const T_REAL = 0.1;            // a vellum leaf at that scale (~0.25 mm on a ~235 mm page)
const DEG = Math.PI / 180;
const GOLD = 0xf3c35c;
const PARCH = 0xe2d4b6;        // face colour until its photograph arrives
const EDGE = [0xd9ccae, 0xd2c4a5, 0xddd1b5];   // page edges vary a little, so single leaves read at the fore-edge
const FOLD = 0xc4b48f;                          // the folds at the spine, a shade darker than the edges
const SPREAD_STOPS = [[0, "closed"], [0.12, "nearly closed"], [0.32, "fanned"], [0.58, "open fan"], [0.8, "pulled apart"], [0.97, "exploded"]];

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const spreadName = s => SPREAD_STOPS.reduce((n, [v, name]) => s >= v - 1e-6 ? name : n, "closed");

// ---------------------------------------------------------------- state
const V = {
  built: false, gl: true, order: null, model: null, layout: null,
  spread: store.get("3d:spread", 0.32), thick: store.get("3d:thick", 4), posture: store.get("3d:posture", "stand"),
  mode: "block", opening: 1, cur: 0, hover: null, preset: 1,
  inspect: false,      // the current sheet is pulled out and the inspector is open
  hand: { on: false, turned: false, open: [0, 0], flat: false, yaw: 0, pitch: 0, cam: null },   // lifted clear to look at; open: folds open per leaf
  unfoldOpening: false, slow: store.get("3d:slow", false), prevOrder: null, flash: null,
  overlay: store.get("3d:overlay", "none"),
  contact: { on: false, i: 0, newOnly: false, list: [] },
  arrange: false,      // Rearrange: the quires lie open on the table as piles (arrangeLayout)
  sel: new Set(), selQ: new Set(), selMain: null,   // there, the selected sheets (the main one) or quires (arrange.js)
  hoverPile: null,     // and the stack under the pointer, opened out
  hideLost: store.get("3d:hideLost", false),   // lost sheets left out of the 3D book
  objs: new Map(),     // current order: sheet id -> sheet object
  cache: new Map(),    // id + handling -> sheet object, reused across orders
};
const CUR = { poses: new Map(), sg: new Map(), t: T_REAL * V.thick, lie: V.posture === "lie" ? 1 : 0, beta: 0 };
let TW = { on: false };
const CAM = { target: new THREE.Vector3(0, H / 2, 0), yaw: 32, pitch: 22, dist: 480, fov: 32, k: 9, goal: null };
CAM.goal = { target: CAM.target.clone(), yaw: CAM.yaw, pitch: CAM.pitch, dist: CAM.dist, fov: CAM.fov };

let renderer, scene, camera, book, table, shadow, stage, labelsEl, tipEl;
let raf = 0, lastT = 0, appliedT = -1;
const pickables = [];
const M = {};          // shared materials

// ---------------------------------------------------------------- textures
const IMG = new Map(), TEX = new Map();
let ANISO = 4;
const imgLoad = url => {
  if (!IMG.has(url)) IMG.set(url, new Promise((res, rej) => {
    const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = rej; i.src = url;
  }));
  return IMG.get(url);
};
/* A texture for one panel at one size; rotated panels (seg.rot) get their own copy. Resolves when the image is in. */
const rotOf = seg => (((seg.rot || 0) % 360) + 360) % 360;
const texKey = (seg, size) => `${seg.img}|${size}|${seg.v || ""}|${rotOf(seg)}`;
function texFor(seg, size) {
  const rot = rotOf(seg), key = texKey(seg, size);
  if (!TEX.has(key)) TEX.set(key, imgLoad(imgUrl(seg.img, size, seg.v)).then(img => {
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO;
    if (rot) { t.center.set(.5, .5); t.rotation = rot * DEG; }
    t.needsUpdate = true;
    return t;
  }));
  return TEX.get(key);
}
function faceMat(seg) {
  if (seg.missing) return M.ghost;
  const m = new THREE.MeshLambertMaterial({ color: PARCH });
  m.userData = { seg, want: "s" };
  texFor(seg, "s").then(t => { if (m.userData.want !== "s") return; m.map = t; m.color.set(0xffffff); m.needsUpdate = true; wake(); }).catch(() => {});
  return m;
}
/* Large photographs (l) for the sheets being looked at closely, small ones (s) everywhere else. */
const DETAIL = new Set();
function updateDetail() {
  const want = new Set(), en = V.model?.all[V.cur];
  if (en && (V.inspect || V.hand.on)) want.add(V.objs.get(en.id));
  if (V.mode === "opening") for (const L of [V.model.leaves[V.opening - 1], V.model.leaves[V.opening]]) if (L) want.add(V.objs.get(L.e.id));
  for (const o of [...DETAIL]) if (!want.has(o)) { setSize(o, "s"); DETAIL.delete(o); }
  for (const o of want) if (o && !DETAIL.has(o)) { setSize(o, "l"); DETAIL.add(o); }
}
function setSize(o, size) {
  for (const mesh of o.panels) for (const mat of mesh.material.slice(0, 2)) {
    const seg = mat.userData?.seg;
    if (!seg || mat.userData.want === size) continue;
    mat.userData.want = size;
    texFor(seg, size).then(t => {
      if (mat.userData.want !== size) return;
      mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true; wake();
      if (size === "s") { const k = texKey(seg, "l"); TEX.get(k)?.then(x => x.dispose()); TEX.delete(k); }
    }).catch(() => {});
  }
}

/* A unit box with three material groups: 0 the front (+z, the inside face), 1 the back (-z, the outside face),
   2 the four edges. three.js maps the back so it reads correctly from behind, like the old card's rotateY(180deg). */
const BOX = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const ix = g.index.array, face = k => Array.from(ix.slice(k * 6, k * 6 + 6));   // order: +x -x +y -y +z -z
  g.setIndex([...face(4), ...face(5), ...face(0), ...face(1), ...face(2), ...face(3)]);
  g.clearGroups(); g.addGroup(0, 6, 0); g.addGroup(6, 6, 1); g.addGroup(12, 24, 2);
  return g;
})();
const RECT = new THREE.BufferGeometry().setFromPoints([[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5], [-.5, -.5]].map(([x, y]) => new THREE.Vector3(x, y, 0)));
const PAPER = .8;   // a leaf is drawn this much of a layer thick, so the layers of a stack do not touch
const NS = 16, NB = 10;   // steps along the curve of a fold at the spine, and of a fold between panels
/* A bent band of paper as four strips of quads along a curve of n steps: its two faces (0, 1), then its two edges
   (2, 3), each strip a ladder of vertex pairs. Group 0 is the faces, group 1 the edges. */
function bandGeo(n) {
  const g = new THREE.BufferGeometry(), idx = [];
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((n + 1) * 8 * 3), 3));
  for (let s = 0; s < 4; s++) for (let i = 0; i < n; i++) { const a = (s * (n + 1) + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setIndex(idx);
  g.addGroup(0, 12 * n, 0); g.addGroup(12 * n, 12 * n, 1);
  return g;
}
/* Fill a band from its cross-sections: at(i) gives step i's two faces' points at either end, [[p0, p1], [q0, q1]]. */
function fillBand(g, n, at) {
  const pos = g.attributes.position, put = (s, i, e, p) => pos.setXYZ((s * (n + 1) + i) * 2 + e, p[0], p[1], p[2]);
  for (let i = 0; i <= n; i++) {
    const [[p0, p1], [q0, q1]] = at(i);
    put(0, i, 0, p0); put(0, i, 1, p1); put(1, i, 0, q0); put(1, i, 1, q1);
    put(2, i, 0, p0); put(2, i, 1, q0); put(3, i, 0, p1); put(3, i, 1, q1);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}

function makeMaterials() {
  M.ghost = new THREE.MeshBasicMaterial({ color: 0xe9e3d8, transparent: true, opacity: .06, depthWrite: false });
  M.ghostEdge = new THREE.MeshBasicMaterial({ color: 0xe9e3d8, transparent: true, opacity: .16, depthWrite: false });
  M.ghostLine = new THREE.LineDashedMaterial({ color: 0xe9e3d8, transparent: true, opacity: .5, dashSize: .035, gapSize: .025 });
  M.thread = new THREE.LineDashedMaterial({ color: 0xb4452f, dashSize: 3, gapSize: 2 });
}

// ---------------------------------------------------------------- the order as gatherings and leaves
/* Sheets in reading order, gatherings as they are sewn (each singulion is its own), and leaves front to back. */
function modelOf(order) {
  const base = ORDERS.get("beinecke");
  const was = new Map();
  base.gatherings.forEach(g => g.bifolia.forEach((id, i) => was.set(id, { q: g.quire, i, o: JSON.stringify((g.sheets || {})[id] || {}) })));
  const sheets = [], gathers = [], leaves = [], quires = [];
  order.gatherings.forEach((g, qi) => {
    const es = g.bifolia.map((id, i) => {
      const opts = (g.sheets || {})[id] || {}, w = was.get(id);
      const moved = order.id !== "beinecke" && (!w || w.q !== g.quire || w.i !== i);
      return { id, sheet: SHEETS.get(id), opts, quire: g.quire, type: g.type, idx: i, count: g.bifolia.length, note: g.note, qi,
               moved, resewn: order.id !== "beinecke" && !moved && !!w && w.o !== JSON.stringify(opts) };
    }).filter(e => !(V.hideLost && e.sheet.missing.every(Boolean)));   // Hide lost sheets: the book without them
    if (!es.length) return;
    const qd = { qi, quire: g.quire, type: g.type, leaves: [] };   // qi stays the gathering's place in the order
    quires.push(qd);
    const groups = g.type === "singulions" ? es.map(e => [e]) : [es];
    for (const grp of groups) {
      const gi = gathers.length;
      const ls = [...grp.map(e => [e, 0]), ...grp.slice().reverse().map(e => [e, 1])];
      const ga = { gi, qi, quire: g.quire, leaves: [] };
      ls.forEach(([e, k], j) => {
        const L = { key: `${e.id}:${k}`, e, k, gi, qi, j, depth: g.type === "singulions" ? 0 : e.idx, n: leaves.length };
        ga.leaves.push(L); qd.leaves.push(L); leaves.push(L);
      });
      gathers.push(ga);
    }
    sheets.push(...es);
  });
  const unplaced = unplacedOf(order).filter(id => !(V.hideLost && SHEETS.get(id).missing.every(Boolean)))
    .map(id => ({ id, sheet: SHEETS.get(id), opts: {}, quire: SHEETS.get(id).quire, unplaced: true, type: "aside", idx: 0, count: 1 }));
  return { sheets, gathers, leaves, quires, unplaced, all: [...sheets, ...unplaced] };
}

// ---------------------------------------------------------------- one sheet as hinged panels
/* Port of the old CSS sheet3D(). Each leaf is a group whose origin is the foot of the spine fold; its proper panel
   starts there and further panels hang from hinges, each folding back over the last. A hinge is
   translateZ(g/2) rotate translateZ(-g/2): the fold line sits g/2 inside, so the folded panel lands g in front, on
   the inside of the sheet; a fold that goes out has g < 0 and turns the other way. The Rose sheet's top row hangs from
   the top edge of the bottom row and folds down. */
function makeSheet(entry) {
  const sh = entry.sheet, v = handled(sh, entry.opts);
  const n = v.n, s = v.spine, rows = v.inside.length, prow = v.proper;
  const colW = c => {
    let a = 0;
    for (let r = 0; r < rows; r++) {
      const fi = v.inside[r][c], bo = v.outside[r][n - 1 - c];
      a = Math.max(a, ((fi.missing ? .68 : aspect(fi)) + (bo.missing ? .68 : aspect(bo))) / 2);
    }
    return a * H;
  };
  const o = { id: entry.id, v, n, s, rows, group: new THREE.Group(), leaves: [], panels: [], creases: [], folds: [], lost: sh.missing.every(Boolean) };
  o.group.name = entry.id;
  const leafLost = k => sh.missing[k];
  /* Pieces of one leaf's panels in hinge order. Folded, each piece lies back over the last. A panel too wide to lie
     flat inside the leaf (68r3, 72r3, 89r2, 102r2) has an extra crease, and its remainder folds back. For the sheet as
     bound the crease is where Yale's photographs show it (data/folds.json, as a fraction of the panel's width from the
     fold it hangs from); otherwise it goes where the panel would reach past the spine or the fore-edge. */
  const MARGIN = 1.2;
  const marked = recordOf(sh.id, entry.opts)?.creases || {};
  const piecesOf = cols => {
    const out = [];
    if (!cols.length) return out;
    const w0 = colW(cols[0]);
    out.push({ c: cols[0], a: 0, b: w0, w: w0 });
    let end = w0, d = -1;   // folded: where the last piece ends, and which way the next one runs
    for (const c of cols.slice(1)) {
      const w = colW(c), at = marked[v.inside[prow][c].img];
      let a = 0;
      while (w - a > .01) {
        const room = d < 0 ? end - MARGIN : w0 - MARGIN - end;
        // a few units over is loose cropping, not a crease
        const take = at ? (a ? w - a : w * at) : w - a - room < 5 ? w - a : Math.min(w - a, Math.max(room, Math.min(w - a, 4)));
        if (a > 0) o.creases.push({ page: v.inside[prow][c].page, at: a / w });
        out.push({ c, a, b: a + take, w, cont: a > 0 });
        end += d * take; d = -d; a += take;
      }
    }
    return out;
  };
  const geoFor = (p0, p1) => {   // the box with its front and back faces showing only [p0, p1] of the panel's width
    if (p0 <= 0 && p1 >= 1) return BOX;
    const g = BOX.clone(), uv = g.attributes.uv;
    for (let i = 16; i < 20; i++) uv.setX(i, p0 + uv.getX(i) * (p1 - p0));               // front (+z)
    for (let i = 20; i < 24; i++) uv.setX(i, 1 - p1 + uv.getX(i) * (p1 - p0));           // back (-z): mirrored
    return g;
  };
  /* Which way a fold goes (data/folds.json): 1 in, the inside faces of the sheet coming together, or -1 out. The record
     names the sheet's own inside panels, so a sheet sewn inside out folds each one the other way. Unlisted folds go in. */
  const ways = D.folds?.sheets?.[sh.id]?.folds || {};
  const wayOf = colsAt => {
    const ids = row => colsAt.map(c => row === v.inside ? row[prow][c]?.img : row[prow][n - 1 - c]?.img);
    for (const [row, k] of [[v.inside, 1], [v.outside, -1]]) {
      const a = ids(row).join("|"), b = ids(row).reverse().join("|");
      const w = ways[a] || ways[b];
      if (w) return { way: (w === "out" ? -1 : 1) * k, given: true };
    }
    return { way: 1, given: false };
  };
  const buildLeaf = k => {
    const dir = k === 0 ? -1 : 1;
    const cols = k === 0 ? range(0, s).reverse() : range(s, n);
    const pieces = piecesOf(cols);
    const L = { k, group: new THREE.Group(), hinges: [], layers: rows * pieces.length, w: cols.length ? colW(cols[0]) : 0,
                edge: leafLost(k) ? M.ghostEdge : new THREE.MeshLambertMaterial({ color: EDGE[(sh.leaves[k] || 0) % 3] }) };
    L.base = L.edge.color ? L.edge.color.getHex() : null;
    // the paper round its folds is coloured like its edges, and seen from either side
    L.bendMat = leafLost(k) ? M.ghostEdge : new THREE.MeshLambertMaterial({ color: L.base, side: THREE.DoubleSide });
    /* Folded, the pieces stack as foldStack says (app.js). Every piece is a block of `rows` layers (the Rose's top row
       lies on its front); z is where its own panel lies. */
    const fw = pieces.map((p, j) => j ? wayOf(p.cont ? [p.c] : [pieces[j - 1].c, p.c]) : null);
    const fs = foldStack(fw.map(f => f ? f.way : 0));
    const zOf = j => fs.layer[j] * rows + (fs.up[j] ? 0 : rows - 1);
    pieces.forEach((p, j) => { if (j) o.folds.push({ k, crease: !!p.cont, way: fw[j].way, given: fw[j].given,
      pages: (p.cont ? [p.c] : [pieces[j - 1].c, p.c]).map(c => v.inside[prow][c]) }); });
    /* A hinge, and the paper bent round it (see bendHinge): along a column fold, the panel's own row and, on a sheet
       of two rows, the top row folded down in front of it, one layer on; along the top-row fold, the piece's width. */
    const hinge = (parent, x, y, gapU, axis, sign, len = 0) => {
      const outer = new THREE.Group(), inner = new THREE.Group();
      outer.position.set(x, y, 0); outer.add(inner); parent.add(outer);
      const bends = (axis === "y" ? range(0, rows) : [0]).map(at => {
        const m = new THREE.Mesh(bandGeo(NB), L.bendMat);
        m.position.set(x, y, 0); m.visible = false; m.frustumCulled = false;
        m.userData = { at, span: axis === "y" ? [0, H] : [0, dir * len] };
        parent.add(m);
        return m;
      });
      L.hinges.push({ outer, inner, gapU, axis, sign, bends, drawn: null });
      return inner;
    };
    const place = (parent, r, p) => {
      const front = v.inside[r][p.c], back = v.outside[r][n - 1 - p.c], len = p.b - p.a;
      // the piece's share of the panel, measured from the panel's left edge (for a left leaf the hinge is on the right)
      const [p0, p1] = dir > 0 ? [p.a / p.w, p.b / p.w] : [1 - p.b / p.w, 1 - p.a / p.w];
      const mesh = new THREE.Mesh(geoFor(p0, p1), [faceMat(front), faceMat(back), L.edge]);
      mesh.position.set(dir * len / 2, H / 2, 0);
      mesh.scale.set(len, H, 1);
      mesh.userData = { sheet: o, leaf: L, col: p.c, row: r, front, back, part: p.cont || p.b < p.w - .01 };
      if (front.missing && back.missing) {
        const line = new THREE.Line(RECT, M.ghostLine); line.computeLineDistances(); mesh.add(line);
      }
      parent.add(mesh); o.panels.push(mesh); pickables.push(mesh);
      return len;
    };
    let parent = L.group, prev = 0;
    // a fold's name: its two panels, or the crease inside one; on a sheet of several rows, by column
    const nameOf = c => rows > 1 ? `column ${c + 1}` : short(pageName(v.inside[prow][c]));
    pieces.forEach((p, j) => {
      let col = parent;
      // a signed gap: in, the piece lands that far in front of the last; out, behind it
      if (j > 0) {
        col = hinge(parent, dir * prev, 0, fw[j].way * Math.abs(zOf(j) - zOf(j - 1)), "y", -dir * fw[j].way);
        const a = pieces[j - 1].c;
        L.hinges.at(-1).info = { way: fw[j].way, label: p.cont ? `the crease in ${nameOf(p.c)}` : rows > 1 ? `columns ${a + 1}–${p.c + 1}` : `${nameOf(a)}–${nameOf(p.c)}` };
      }
      prev = place(col, prow, p);
      if (rows > 1) place(hinge(col, 0, H, 1, "x", 1, p.b - p.a), prow === 1 ? 0 : 1, p);   // the top row folds down onto the front of the bottom row
      parent = col;
    });
    o.group.add(L.group);
    return L;
  };
  o.leaves = [buildLeaf(0), buildLeaf(1)];
  /* The folds of each leaf as steps, in the order they open: along the strip from the spine, each fold carrying the
     folded rest with it. They close in reverse. A sheet of two rows (the Rose) folds as one thing (o.linked): its
     columns first, then the whole top half at once, across every column and both leaves. It is one strip: Yale's
     photograph of the sheet half open (85r2 · 86v4 · 86v6) shows it folded down in one piece over the lower half.
     A leaf with fewer column folds than the other waits its turn (a step with no hinge). */
  const colSteps = L => [...L.hinges.keys()].filter(hi => L.hinges[hi].axis === "y").map(hi => ({ hs: [hi], info: L.hinges[hi].info }));
  o.linked = rows > 1;
  if (o.linked) {
    const cs = o.leaves.map(colSteps), most = Math.max(...cs.map(c => c.length));
    o.leaves.forEach((L, k) => {
      L.steps = [...cs[k], ...range(cs[k].length, most).map(() => ({ hs: [], info: null })),
                 { hs: [...L.hinges.keys()].filter(hi => L.hinges[hi].axis === "x"), info: { way: 1, row: true, label: "the top half" } }];
    });
  } else for (const L of o.leaves) L.steps = colSteps(L);
  o.S = range(0, s).reduce((a, c) => a + colW(c), 0);                 // width left of the spine, opened flat
  o.leaves[0].full = o.S; o.leaves[1].full = range(s, n).reduce((a, c) => a + colW(c), 0);
  /* The fold at the back: a band of paper as thick as the leaves, joining their spine edges, reshaped every frame. Its
     faces are a shade darker than the edges; its head and tail are coloured like the leaves' edges, so from above a
     leaf, its fold and the other leaf read as one line. */
  o.foldMat = o.lost ? M.ghostEdge : new THREE.MeshLambertMaterial({ color: FOLD, side: THREE.DoubleSide });
  o.foldMats = o.lost ? o.foldMat : [o.foldMat, (o.leaves.find(L => L.base != null) || o.leaves[0]).bendMat];
  o.fold = new THREE.Mesh(bandGeo(NS), o.foldMats);
  o.fold.userData = { sheet: o, ns: NS };
  o.fold.frustumCulled = false;
  o.group.add(o.fold); pickables.push(o.fold);
  if (o.linked) {   // the top row's own fold at the spine (shapeFold)
    o.fold2 = new THREE.Mesh(bandGeo(NS), o.foldMats);
    o.fold2.userData = o.fold.userData; o.fold2.frustumCulled = false;
    o.group.add(o.fold2); pickables.push(o.fold2);
  }
  return o;
}

function objFor(entry, bind = true) {
  const key = entry.id + "#" + JSON.stringify(entry.opts || {});
  if (!V.cache.has(key)) V.cache.set(key, makeSheet(entry));
  const o = V.cache.get(key);
  if (bind) o.entry = entry;   // the order's entry, for picking; a lookup (bind = false) leaves it alone
  return o;
}

// ---------------------------------------------------------------- layout
const dirOf = a => [Math.sin(a * DEG), Math.cos(a * DEG)];      // where a leaf points from the spine (x, z)
const nrmOf = a => [Math.cos(a * DEG), -Math.sin(a * DEG)];     // the way later leaves stack on it (x, z)
const fanOf = m => Math.min(80, 20 + 6 * m);                   // one gathering's own fan when pulled apart

function postureMatrix(lie, beta) {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-90 * lie * DEG, beta * lie * DEG, 0, "XYZ"));
}

/* Book-space corners of every placed leaf (lift ignored), for centring and framing; `reach` keeps only the part of
   each leaf nearest the spine. */
function leafCorners(poses, model, t, only, reach = 1) {
  const pts = [], held = V.hand.on ? model.all[V.cur]?.id : null;
  for (const L of model.leaves) {
    if (only && !only.has(L.key)) continue;
    if (L.e.id === held && !only) continue;   // the sheet in hand is not part of the block
    const p = poses.get(L.key), o = V.objs.get(L.e.id); if (!p || !o) continue;
    const w = (p.f < .5 ? o.leaves[L.k].full : o.leaves[L.k].w) * reach, [dx, dz] = dirOf(p.a);   // unfolded, the leaf reaches further
    for (const y of [p.y, p.y + H]) pts.push(new THREE.Vector3(p.x, y, p.z), new THREE.Vector3(p.x + dx * w, y, p.z + dz * w));
  }
  return pts;
}

/* Where the book sits: turned for the posture, centred on the origin, resting on the table. */
function bookPlacement(poses, model, t, lie, beta) {
  const R = postureMatrix(lie, beta);
  const box = new THREE.Box3();
  for (const p of leafCorners(poses, model, t)) box.expandByPoint(p.applyMatrix4(R));
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
  const c = box.getCenter(new THREE.Vector3());
  const pos = new THREE.Vector3(-c.x, -box.min.y, -c.z);
  box.translate(pos);
  return { R, pos, box, matrix: new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z).multiply(R) };
}

/* Target poses for every leaf. Spread 0 is the closed book; up to 0.55 the whole block fans open; beyond that each
   gathering fans on its own, quires pull apart and the bifolia of a nested quire step up so each can be grabbed. */
function computeLayout() {
  const model = V.model, t = T_REAL * V.thick, sp = V.spread, open = V.mode === "opening";
  const leaves = model.leaves, N = leaves.length;
  const sc = Math.min(sp / 0.55, 1), F = 130 * (1 - Math.pow(1 - sc, 1.6));
  const e = open ? 0 : smooth(0.55, 1, sp);
  const cur = model.all[V.cur], al = new Array(N);
  /* Open at an opening and unfolded: its two leaves open out. A sheet of two rows opens only at its own centre, where
     both its leaves are the opening, since its top half is one piece across them. */
  const unfoldsHere = (L, i) => (i === V.opening - 1 || i === V.opening)
    && (!V.objs.get(L.e.id)?.linked || (leaves[V.opening - 1]?.e === L.e && leaves[V.opening]?.e === L.e));
  if (open) {
    // open at an opening: leaves before it in the left pile, the rest in the right; the opening faces you
    const o = clamp(V.opening, 0, N);
    leaves.forEach((L, i) => { al[i] = i < o ? -90 + 12 * (i + 1) / o : 78 + 12 * (i - o) / Math.max(1, N - o); });
  } else {
    let u = 0; const us = [];
    leaves.forEach((L, i) => { if (i && L.gi !== leaves[i - 1].gi) u += L.qi !== leaves[i - 1].qi ? 3 : 1; us.push(u); u += 1; });
    const uMax = Math.max(1, us[N - 1] || 1);
    leaves.forEach((L, i) => {
      const m = model.gathers[L.gi].leaves.length, f = fanOf(m);
      const local = m > 1 ? -f / 2 + f * L.j / (m - 1) : 0;
      al[i] = (1 - e) * (-F / 2 + F * us[i] / uMax) + e * local;
    });
    // the current sheet parts the fan, as a thumb would
    const mine = leaves.filter(L => L.e === cur).map(L => L.n);
    if (mine.length === 2 && sp > 0.01) {
      const d = 6 * Math.min(1, sp / 0.12) * (1 - e);
      for (let i = 0; i < N; i++) { if (i < mine[0]) al[i] -= d; else if (i > mine[1]) al[i] += d; }
    }
  }
  const hw = gi => {
    const g = model.gathers[gi];
    return Math.max(...g.leaves.map(L => V.objs.get(L.e.id).leaves[L.k].w)) * Math.sin(fanOf(g.leaves.length) / 2 * DEG);
  };
  const poses = new Map();
  let px = 0, pz = 0;
  leaves.forEach((L, i) => {
    if (i && L.gi !== leaves[i - 1].gi) {
      const sameQ = L.qi === leaves[i - 1].qi;
      let gap = open ? t * .6 : t * (sameQ ? .2 + 1.5 * sc : .5 + 6 * sc);
      if (e) gap += e * (hw(leaves[i - 1].gi) + hw(L.gi) + (sameQ ? 6 : 18));
      const [gx, gz] = nrmOf((al[i - 1] + al[i]) / 2);
      px += gx * gap; pz += gz * gap;
    }
    const lf = V.objs.get(L.e.id).leaves[L.k];
    const w = Math.max(1, lf.layers) * t, [nx, nz] = nrmOf(al[i]);
    // the proper panel lies on the outside of its leaf; the folded panels stack on the inside
    const off = L.k === 0 ? t / 2 : w - t / 2;
    // the current sheet stands a little proud; pulled out to inspect, a third of its height
    poses.set(L.key, { x: px + nx * off, y: e * .05 * H * L.depth, z: pz + nz * off, a: al[i],
                       f: open && V.unfoldOpening && unfoldsHere(L, i) ? 0 : 1,
                       lift: !open && L.e === cur ? (V.inspect ? .34 : .12) * H * (1 - .6 * e) : 0 });
    px += nx * w; pz += nz * w;
  });
  const lie = V.posture === "lie" ? 1 : 0;
  // lying, the book rests on its back cover, so it tips as it opens; open at an opening, both piles lie on the desk
  const beta = lie ? (open ? 0 : clamp((1 - e) * (90 - (al[N - 1] || 0)), 0, 90)) : 0;
  const place = bookPlacement(poses, model, t, lie, beta);
  // lost sheets this order cannot place lie flat on the table in front of their quire
  const sg = new Map(), inv = place.matrix.clone().invert();
  const qx = new Map();
  for (const q of model.quires) {
    const pts = leafCorners(poses, model, t, new Set(q.leaves.map(L => L.key)));
    if (pts.length) qx.set(q.quire, pts.reduce((a, p) => a + p.applyMatrix4(place.matrix).x, 0) / pts.length);
  }
  const perQ = new Map();
  for (const en of model.unplaced) {
    const k = perQ.get(en.quire) || 0; perQ.set(en.quire, k + 1);
    const x = (qx.get(en.quire) ?? place.box.max.x + H) + k * H * 1.6;
    const world = new THREE.Matrix4().makeTranslation(x, .3, place.box.max.z + 1.18 * H).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const m = inv.clone().multiply(world), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    sg.set(en.id, { p, q });
    poses.set(`${en.id}:0`, { x: 0, y: 0, z: 0, a: -90, f: 1, lift: 0 });
    poses.set(`${en.id}:1`, { x: 0, y: 0, z: 0, a: 90, f: 1, lift: 0 });
  }
  // the sheet in hand rises clear of the block above its slot, turned to face the camera
  if (V.hand.on && cur) {
    const a = poses.get(`${cur.id}:0`), b = poses.get(`${cur.id}:1`);
    const x = !cur.unplaced && a && b ? new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2).applyMatrix4(place.matrix).x : 0;
    const c = place.box.getCenter(new THREE.Vector3()), tilt = clamp(V.hand.pitch - 12, 0, 55);
    const world = new THREE.Matrix4().makeTranslation(x, place.box.max.y + .22 * H, c.z)
      .multiply(new THREE.Matrix4().makeRotationY((V.hand.yaw + (V.hand.turned ? 180 : 0)) * DEG))
      .multiply(new THREE.Matrix4().makeRotationX(-tilt * DEG));
    const m = inv.clone().multiply(world), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    sg.set(cur.id, { p, q });
    // how far each leaf is from lying flat; a sheet of two rows is held flat, so its top half lifts in one piece across the spine
    const phi = V.hand.flat || V.objs.get(cur.id)?.linked ? 0 : 20;
    const f = k => { const n = foldsOf(cur, k); return n ? 1 - Math.min(V.hand.open[k], n) / n : 1; };
    poses.set(`${cur.id}:0`, { x: 0, y: 0, z: 0, a: -(90 - phi), f: f(0), lift: 0 });
    poses.set(`${cur.id}:1`, { x: 0, y: 0, z: 0, a: 90 - phi, f: f(1), lift: 0 });
  }
  const worldBox = place.box.clone();
  if (model.unplaced.length) worldBox.max.z += 1.3 * H;
  const out = { poses, sg, t, lie, beta, place, box: worldBox, al };
  return V.arrange ? arrangeLayout(out) : out;
}

// ---------------------------------------------------------------- animation
/* Every change is a tween of keyframe tracks: each leaf's pose, each sheet's frame and the book's posture. A plain
   change has two keyframes; the order morph adds lifts, staggers and the flat swap of a re-sewn sheet. */
const IDENT = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
const mixPose = (a, b, q) => ({ x: lerp(a.x, b.x, q), y: lerp(a.y, b.y, q), z: lerp(a.z, b.z, q), a: lerp(a.a, b.a, q), f: lerp(a.f, b.f, q), lift: lerp(a.lift, b.lift, q) });
const mixSg = (a, b, q) => ({ p: a.p.clone().lerp(b.p, q), q: a.q.clone().slerp(b.q, q) });
const mixG = (a, b, q) => ({ t: lerp(a.t, b.t, q), lie: lerp(a.lie, b.lie, q), beta: lerp(a.beta, b.beta, q) });
/* A keyframe is [time, value] or [time, value, "even"]: the stretch that ends at it runs at an even pace instead of
   easing in and out, for folds, which ease one by one on their own (poseLeaf). */
function at(track, k, mix) {
  let i = 0;
  while (i < track.length - 2 && k > track[i + 1][0]) i++;
  const [k0, a] = track[i], [k1, b, pace] = track[i + 1];
  const x = clamp((k - k0) / Math.max(1e-6, k1 - k0));
  return mix(a, b, pace === "even" ? x : ease(x));
}
function finishSwaps() {
  for (const sw of TW.swaps || []) {
    sw.show.group.visible = !hiddenObj(sw.show);
    if (![...V.objs.values()].includes(sw.hide)) sw.hide.group.parent?.remove(sw.hide.group);
  }
}
function relayout(dur = 650, morph = null) {
  if (!V.model) return;
  if (TW.on) finishSwaps();
  if (TW.camAt) camHome();   // a camera move waiting for its moment: now
  const keys = ARR.plan?.keys;
  const L = V.layout = computeLayout();
  const replan = V.arrange && keys && ARR.plan?.keys !== keys;
  if (replan) setTimeout(keepFramed, 0);   // the table's plan changed: does it still fit?
  const poses = new Map(), sgs = new Map();
  for (const [key, b] of L.poses) poses.set(key, [[0, CUR.poses.get(key) || b], [1, b]]);
  for (const en of V.model.all) sgs.set(en.id, [[0, CUR.sg.get(en.id) || IDENT], [1, L.sg.get(en.id) || IDENT]]);
  const tw = { poses, sgs, g: [[0, { t: CUR.t, lie: CUR.lie, beta: CUR.beta }], [1, { t: L.t, lie: L.lie, beta: L.beta }]], swaps: [], leaving: [] };
  if (morph) morph(tw, L);
  TW = { ...tw, t0: performance.now(), dur: REDUCED ? 0 : dur, on: true, replan };
  renderFoldBtn();
  for (const sw of TW.swaps) sw.show.group.visible = false;
  updateDetail();
  if (!TW.dur) tweenStep(TW.t0); else wake();
}

function tweenStep(now) {
  if (!TW.on) return false;
  const k = TW.dur ? clamp((now - TW.t0) / TW.dur) : 1;
  const poses = new Map(), sg = new Map();
  for (const [key, tr] of TW.poses) poses.set(key, at(tr, k, mixPose));
  for (const [id, tr] of TW.sgs) sg.set(id, at(tr, k, mixSg));
  CUR.poses = poses; CUR.sg = sg;
  Object.assign(CUR, at(TW.g, k, mixG));
  if (ARR.grow) for (const id of ARR.grow) V.objs.get(id)?.group.scale.setScalar(.5 + .5 * ease(k));   // sheets let go, growing as they land
  if (TW.camAt && k >= TW.camAt.k) camHome();
  for (const sw of TW.swaps) { sw.hide.group.visible = k < sw.k && !hiddenObj(sw.hide); sw.show.group.visible = k >= sw.k && !hiddenObj(sw.show); }
  applyAll();
  if (k >= 1) {
    TW.on = false; finishSwaps(); TW.swaps = []; TW.leaving = [];
    if (ARR.grow) growDone();
    if (ARR.leaving) { ARR.leaving = false; applyAll(); }
    if (ARR.after && V.arrange) { ARR.after = false; setTimeout(() => relayout(REDUCED ? 0 : 160), 0); }
    if (ARR.recheck && V.arrange) {   // the sheets moved under a pointer that stayed still: what is under it now?
      const r = ARR.recheck; ARR.recheck = null;
      setTimeout(() => { if (V.arrange && !DRAG.on && !ARR.drag) pointAt(r, r.again); }, 0);
    }
  }
  return TW.on;
}

/* Stand one leaf of a sheet in a pose: where, at what angle, and how folded. p.f is how folded the leaf is (1 shut,
   0 open); its folds open one step after another (L.steps), and shut in reverse. Each fold eases in and out within
   its own turn, so a run of them reads as separate folds, not one long sweep. */
function poseLeaf(L, p) {
  L.group.position.set(p.x, p.y + p.lift, p.z);
  L.group.rotation.y = (L.k === 0 ? p.a + 90 : p.a - 90) * DEG;
  const u = (1 - p.f) * L.steps.length;
  L.steps.forEach((st, i) => {
    const f = 1 - ease(clamp(u - i));
    for (const hi of st.hs) { const hg = L.hinges[hi]; if (hg.axis === "y") hg.outer.rotation.y = hg.sign * Math.PI * f; else hg.outer.rotation.x = Math.PI * f; }
  });
}
/* The corners of every panel of a sheet, in the sheet's own frame, with its leaves in the given poses (key -> pose):
   the sheet is stood that way for the measurement and put back as it was. `leaf`: only that leaf's panels. */
function sheetCorners(o, id, poses, leaf = null) {
  const stand = from => { for (const L of o.leaves) { const p = from.get(`${id}:${L.k}`); if (p) poseLeaf(L, p); } o.group.updateMatrixWorld(true); };
  stand(poses);
  const inv = o.group.matrixWorld.clone().invert(), pts = [];
  for (const m of o.panels) if (leaf == null || m.userData.leaf.k === leaf) for (const [x, y] of [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]])
    pts.push(new THREE.Vector3(x, y, 0).applyMatrix4(m.matrixWorld).applyMatrix4(inv));
  stand(CUR.poses);
  return pts;
}

/* Put every object where CUR says. */
function applyAll() {
  const t = CUR.t;
  const thick = Math.abs(t - appliedT) > 1e-6;
  const items = V.model.all.map(en => [V.objs.get(en.id), en.id]).concat((TW.leaving || []).map(x => [x.o, "old:" + x.id]));
  for (const [o, id] of items) {
    if (!o) continue;
    const g = CUR.sg.get(id) || IDENT;
    o.group.position.copy(g.p); o.group.quaternion.copy(g.q);
    for (const L of o.leaves) {
      const p = CUR.poses.get(`${id}:${L.k}`); if (!p) continue;
      poseLeaf(L, p);
      if (thick || o.t !== t) for (const hg of L.hinges) { hg.outer.position.z = hg.gapU * t / 2; hg.inner.position.z = -hg.gapU * t / 2; }
      for (const hg of L.hinges) bendHinge(hg, t);
    }
    if (thick || o.t !== t) { for (const m of o.panels) m.scale.z = t * PAPER; o.t = t; }
    shapeFold(o, id);
  }
  appliedT = t;
  // on the table the sheets are placed in the room, so the book's frame holds still (and on the way back to the book)
  const place = (V.arrange || ARR.leaving) && V.layout?.place ? V.layout.place : bookPlacement(CUR.poses, V.model, t, CUR.lie, CUR.beta);
  shadow.visible = !V.arrange && !ARR.leaving;
  book.position.copy(place.pos);
  book.quaternion.setFromRotationMatrix(place.R);
  shadow.position.set((place.box.min.x + place.box.max.x) / 2, .05, (place.box.min.z + place.box.max.z) / 2);
  shadow.scale.set(place.box.max.x - place.box.min.x + 60, place.box.max.z - place.box.min.z + 60, 1);
}

/* The paper round a hinge: a band as thick as a leaf, bent round the hinge's axis through the angle the hinge has
   turned, so a flap stays joined to the panel it hangs from (a half circle when it lies folded, as in the Info page's
   fold diagrams). The axis sits half the gap in front of the panel; a bend's layer (userData.at, in layers in front of
   the panel) turns round it at its own radius. Redrawn only when the angle or the thickness changes. */
function bendHinge(hg, t) {
  const th = hg.axis === "y" ? hg.outer.rotation.y : hg.outer.rotation.x;
  if (hg.drawn && Math.abs(hg.drawn[0] - th) < 1e-5 && hg.drawn[1] === t) return;
  hg.drawn = [th, t];
  const c = hg.gapU * t / 2, h = t * PAPER / 2;
  for (const m of hg.bends) {
    const v = m.userData.at * t - c, R = Math.abs(v), [e0, e1] = m.userData.span;
    m.visible = Math.abs(th) > 1e-4 && R > h * .5;
    if (!m.visible) continue;
    const rs = [R + h, Math.max(0, R - h)];
    fillBand(m.geometry, NB, i => {
      const ph = th * i / NB, sn = Math.sign(v) * Math.sin(ph), cs = Math.sign(v) * Math.cos(ph);
      // turned about y the layer swings in x; about x (the Rose's top row) it swings in y, and spans the piece's width
      return rs.map(r => hg.axis === "y" ? [[sn * r, e0, c + cs * r], [sn * r, e1, c + cs * r]]
                                          : [[e0, -sn * r, c + cs * r], [e1, -sn * r, c + cs * r]]);
    });
  }
}

/* The fold at the back: from one leaf's spine edge, round behind the leaves it encloses, to the other's. Its centre
   line is a curve that leaves each leaf straight on; the band is that line thickened to a leaf's thickness either side.
   Nested folds lie a layer apart all the way round, like the arcs of the Info page's diagrams. */
function shapeFold(o, id) {
  const a = CUR.poses.get(`${id}:0`), b = CUR.poses.get(`${id}:1`);
  if (!a || !b || !o.leaves[0].layers || !o.leaves[1].layers) { o.fold.visible = false; if (o.fold2) o.fold2.visible = false; return; }
  const mid = bandAround(o.fold, a, b, 0, 0);
  if (o.thread?.visible && mid) {   // just outside the apex of the fold
    const [x, y, z] = mid, tp = o.thread.geometry.attributes.position, [cx, cz] = [(a.x + b.x) / 2, (a.z + b.z) / 2];
    const l = Math.hypot(x - cx, z - cz) || 1, k = CUR.t * (PAPER / 2 + .6) / l;
    tp.setXYZ(0, x + (x - cx) * k, y + H * .05, z + (z - cz) * k); tp.setXYZ(1, x + (x - cx) * k, y + H * .95, z + (z - cz) * k);
    tp.needsUpdate = true; o.thread.computeLineDistances();
  }
  /* The Rose's top row crosses the spine too. Folded down, it lies a layer inside each leaf, so its fold is a smaller
     band inside the first; opened up, it runs on above the first. Part way, it is turning about its own fold, and
     not drawn. */
  if (o.fold2) {
    const up = o.leaves.map(L => Math.abs(L.hinges.find(hg => hg.axis === "x")?.outer.rotation.x ?? 0) / Math.PI);
    const down = up.every(f => f > 1 - 1e-4), open = up.every(f => f < 1e-4);
    o.fold2.visible = down || open;
    if (o.fold2.visible) bandAround(o.fold2, a, b, down ? CUR.t : 0, open ? H : 0);
  }
}
/* Shape a fold's band between leaf poses a and b, `inset` inside both leaves and `rise` above them. Returns the centre
   of its apex, at its foot, or null when it is not drawn. */
function bandAround(mesh, a, b, inset, rise) {
  const [ax, az] = dirOf(a.a), [bx, bz] = dirOf(b.a), [anx, anz] = nrmOf(a.a), [bnx, bnz] = nrmOf(b.a), t = CUR.t;
  // each leaf's inside faces the other: leaf 0's along the way later leaves stack, leaf 1's against it
  const A = [a.x + anx * inset, a.z + anz * inset], B = [b.x - bnx * inset, b.z - bnz * inset];
  const d = Math.hypot(B[0] - A[0], B[1] - A[1]);
  // opened flat at the spine (held flat, or set aside on the table) the fold is flat paper: nothing to draw
  mesh.visible = !(d < t * .5 && ax * bx + az * bz < -.95);
  if (!mesh.visible) return null;
  const r = Math.max(d, t) * .62, h = t * PAPER / 2;
  const P = [A, [A[0] - ax * r, A[1] - az * r], [B[0] - bx * r, B[1] - bz * r], B];
  const ns = mesh.userData.ns, mid = [];
  fillBand(mesh.geometry, ns, i => {
    const s = i / ns, u = 1 - s;
    const w = [u * u * u, 3 * u * u * s, 3 * u * s * s, s * s * s], dw = [-3 * u * u, 3 * u * u - 6 * u * s, 6 * u * s - 3 * s * s, 3 * s * s];
    const x = w.reduce((m, k, j) => m + k * P[j][0], 0), z = w.reduce((m, k, j) => m + k * P[j][1], 0);
    let tx = dw.reduce((m, k, j) => m + k * P[j][0], 0), tz = dw.reduce((m, k, j) => m + k * P[j][1], 0);
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const y0 = lerp(a.y + a.lift, b.y + b.lift, s) + rise, y1 = y0 + H;
    if (i === ns / 2) mid.push(x, y0, z);
    return [1, -1].map(k => [[x - tz * h * k, y0, z + tx * h * k], [x - tz * h * k, y1, z + tx * h * k]]);
  });
  return mid;
}

// ---------------------------------------------------------------- camera
function camDir(yaw, pitch) {
  const cp = Math.cos(pitch * DEG);
  return new THREE.Vector3(cp * Math.sin(yaw * DEG), Math.sin(pitch * DEG), cp * Math.cos(yaw * DEG));
}
function placeCamera() {
  camera.position.copy(CAM.target).addScaledVector(camDir(CAM.yaw, CAM.pitch), CAM.dist);
  camera.lookAt(CAM.target);
  camera.fov = CAM.fov;
  camera.near = Math.max(.5, CAM.dist * .02); camera.far = CAM.dist * 12 + 6000;
  camera.updateProjectionMatrix();
  scene.fog.near = CAM.dist * 1.6; scene.fog.far = CAM.dist * 7 + 2000;
}
function camStep(dt) {
  const g = CAM.goal, a = 1 - Math.exp(-CAM.k * dt);
  CAM.yaw += (g.yaw - CAM.yaw) * a; CAM.pitch += (g.pitch - CAM.pitch) * a;
  CAM.dist += (g.dist - CAM.dist) * a; CAM.target.lerp(g.target, a); CAM.fov += (g.fov - CAM.fov) * a;
  const done = Math.abs(g.yaw - CAM.yaw) < .02 && Math.abs(g.pitch - CAM.pitch) < .02 && Math.abs(g.fov - CAM.fov) < .01
    && Math.abs(g.dist - CAM.dist) < CAM.dist * 1e-4 && CAM.target.distanceTo(g.target) < .02;
  if (done) { CAM.yaw = g.yaw; CAM.pitch = g.pitch; CAM.dist = g.dist; CAM.fov = g.fov; CAM.target.copy(g.target); }
  placeCamera();
  return !done;
}
const PITCH = [2, 89.5];
function setGoal({ yaw, pitch, dist, target, fov }, k = 10) {
  const g = CAM.goal;
  if (fov != null) g.fov = fov;
  if (yaw != null) g.yaw = yaw;
  if (pitch != null) g.pitch = clamp(pitch, ...PITCH);
  if (dist != null) g.dist = clamp(dist, H * .35, H * 160);
  if (target) g.target.copy(target);
  CAM.k = k;
  if (REDUCED && k < 10) { CAM.yaw = g.yaw; CAM.pitch = g.pitch; CAM.dist = g.dist; CAM.fov = g.fov; CAM.target.copy(g.target); }
  wake();
}
/* How far back the camera must stand, looking from (yaw, pitch), for every point to fit the view. */
function fitDist(points, center, yaw, pitch, margin = 1.1, fov = camera.fov, aspect = camera.aspect) {
  const f = camDir(yaw, pitch), right = new THREE.Vector3(0, 1, 0).cross(f).normalize(), up = f.clone().cross(right);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  const tv = Math.tan(fov / 2 * DEG), th = tv * aspect;
  let need = 0;
  for (const p of points) {
    const d = p.clone().sub(center);
    need = Math.max(need, d.dot(f) + Math.abs(d.dot(right)) / th, d.dot(f) + Math.abs(d.dot(up)) / tv);
  }
  return need * margin;
}
/* Where to look and how far back to stand, from (yaw, pitch), for the points to fill the view and sit in the middle of
   it. In perspective the middle of a thing is not the middle of its picture, so the target moves until it is. */
function fitView(points, yaw, pitch, margin = 1.1, fov = camera.fov) {
  const f = camDir(yaw, pitch), right = new THREE.Vector3(0, 1, 0).cross(f).normalize(), up = f.clone().cross(right);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  const tv = Math.tan(fov / 2 * DEG), th = tv * camera.aspect;
  const target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  let dist = fitDist(points, target, yaw, pitch, margin, fov);
  for (let i = 0; i < 8; i++) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of points) {
      const d = p.clone().sub(target), z = Math.max(1e-3, dist - d.dot(f));
      const x = d.dot(right) / (z * th), y = d.dot(up) / (z * tv);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    target.addScaledVector(right, (x0 + x1) / 2 * th * dist).addScaledVector(up, (y0 + y1) / 2 * tv * dist);
    dist *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) * margin;
  }
  return { target, dist };
}
const boxPoints = b => [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
const nearestYaw = y => { const c = CAM.yaw; return y + 360 * Math.round((c - y) / 360); };

/* Named views. Each is given in book terms and turned with the posture, so "spine" is always the spine. */
const PRESETS = [
  null,
  { name: "Front ¾", key: "1" },
  { name: "Spine", key: "2" },
  { name: "Head", key: "3" },
  { name: "Fore-edge", key: "4" },
  { name: "Reader's eye", key: "5" },
];
function presetAngles(n, lay) {
  if (lay.lie < .5) return [null, [32, 22], [200, 14], [0, 89.5], [0, 5], [0, 12]][n];
  // lying: turn the book-space direction of that edge onto the desk and look at it from a little above
  const R = postureMatrix(1, lay.beta);
  const yawOf = v => { const w = v.applyMatrix4(R); return Math.atan2(w.x, w.z) / DEG; };
  if (n === 1) return [28, 45];
  if (n === 2) return [yawOf(new THREE.Vector3(0, 0, -1)), 16];
  if (n === 3) return [180, 28];
  if (n === 4) return [yawOf(new THREE.Vector3(0, 0, 1)), 12];
  return [0, 78];
}
/* The corners of the two leaves at the opening, in book space, as the layout will have them (folded or unfolded). */
function openingCorners(lay) {
  return [V.model.leaves[V.opening - 1], V.model.leaves[V.opening]].filter(Boolean)
    .flatMap(L => sheetCorners(V.objs.get(L.e.id), L.e.id, lay.poses, L.k));
}
/* The opening from wherever you are looking: after unfolding it at an angle of your own, bring all of it into view. */
function frameOpening() {
  const lay = V.layout, g = CAM.goal;
  const pts = openingCorners(lay).map(p => p.applyMatrix4(lay.place.matrix));
  if (pts.length) setGoal({ ...fitView(pts, g.yaw, g.pitch, 1.1, g.fov), fov: g.fov }, 4.5);
}
function preset(n, { instant = false } = {}) {
  if (!V.layout) return;
  if (n === 5 && V.mode !== "opening") { setMode("opening", { view: false }); }
  V.preset = n;
  const lay = V.layout;
  const [yaw, pitch] = presetAngles(n, lay);
  let pts = boxPoints(lay.box);
  // the spine and head views frame the region by the spine, where folds and nesting show
  if (n === 2 || n === 3) pts = leafCorners(lay.poses, V.model, lay.t, null, n === 2 ? .3 : .42);
  if (n === 5) pts = openingCorners(lay);
  if (n !== 1 && n !== 4) pts = pts.map(p => p.applyMatrix4(lay.place.matrix));
  const center = n === 1 || n === 4 ? lay.box.getCenter(new THREE.Vector3()) : new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
  // the edge views use a long lens, so they read almost like a plan (the quire diagram) rather than a close-up
  const fov = n === 3 ? 6 : n === 2 || n === 4 ? 10 : 32;
  // the opening sits in the middle of the view, whatever is unfolded; the other views are centred on the block
  const fit = n === 5 ? fitView(pts, yaw, pitch, V.contact.on ? 1.24 : 1.1, fov) : { target: center, dist: fitDist(pts, center, yaw, pitch, 1.12, fov) };
  setGoal({ ...fit, yaw: nearestYaw(yaw), pitch, fov }, instant ? 100 : 4.5);
  renderViews();
  renderNote();
  pushHash();
}

// ---------------------------------------------------------------- frame loop
function active() { return V.built && V.gl && !$("#v-three").hidden && stage.clientWidth > 0; }
function wake() { if (!raf && active()) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0;
  const dt = lastT ? Math.min(.05, (now - lastT) / 1000) : 1 / 60;
  lastT = now;
  const moving = camStep(dt) | shade(dt);
  const anim = tweenStep(now);
  renderer.render(scene, camera);
  drawLabels();
  if (moving || anim || DRAG.on) raf = requestAnimationFrame(frame); else lastT = 0;
}
/* Take the stage's size as it is now. Something beside it may just have opened (the inspector), and a view framed before
   the ResizeObserver reports it would be framed for the old shape. True if the size changed. */
function fitStage() {
  const w = stage.clientWidth, h2 = stage.clientHeight;
  if (!V.gl || !w || !h2) return false;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x === w && size.y === h2) return false;
  renderer.setSize(w, h2, false);
  camera.aspect = w / h2; camera.updateProjectionMatrix();
  return true;
}
function resize() {
  if (!V.gl || !stage.clientWidth) return;
  if (fitStage() && V.model) renderer.render(scene, camera);
  // still at a named view (not turned, panned or zoomed since), or holding a sheet: keep it framed as the stage changes size
  clearTimeout(resize.t);
  resize.pending = true;
  resize.t = setTimeout(() => {
    resize.pending = false;
    if (!V.layout) return;
    if (V.arrange) frameTable();   // Rearrange's table: fitted to the stage again (even while a sheet is moving: it frames the plan)
    else if (TW.camAt) { /* leaving the table: the camera goes home with the book (setArrange), fitted then */ }
    else if (V.hand.on) frameHand(); else if (V.preset) preset(V.preset, { instant: REDUCED });
  }, 120);
  wake();
}

// ---------------------------------------------------------------- labels (screen space, always upright)
const LBL = new Map();
function lbl(key, cls) {
  let el = LBL.get(key);
  if (!el) { el = h("div", { class: "v3-lbl " + cls }); labelsEl.append(el); LBL.set(key, el); el._w = 0; }
  return el;
}
const _v = new THREE.Vector3();
let SW = 1, SH = 1;   // the stage's size, read once per frame: reading it between label writes would force a layout each time
function project(p, obj) {
  _v.copy(p).applyMatrix4(obj.matrixWorld).project(camera);
  if (_v.z > 1 || _v.z < -1) return null;
  return [(_v.x + 1) / 2 * SW, (1 - _v.y) / 2 * SH];
}
/* How high a sheet stands (or one leaf of it): a page, plus the Rose's top row as far as it is folded up. */
const topOf = (o, k = null) => H + Math.max(0, ...o.leaves.filter(L => k == null || L.k === k)
  .flatMap(L => L.hinges.filter(hg => hg.axis === "x").map(hg => H * Math.cos(hg.outer.rotation.x))));
function sheetAnchor(id) {
  const o = V.objs.get(id), a = CUR.poses.get(`${id}:0`), b = CUR.poses.get(`${id}:1`);
  if (!o || !a || !b) return null;
  const [dx, dz] = dirOf(a.a), w = o.leaves[0].w || o.leaves[1].w;
  return { obj: o.group, p: new THREE.Vector3((a.x + b.x) / 2 + dx * w * .2, Math.max(a.y + a.lift, b.y + b.lift) + topOf(o) + 2, (a.z + b.z) / 2 + dz * w * .2) };
}
function drawLabels() {
  if (!V.model) return;
  SW = stage.clientWidth; SH = stage.clientHeight;
  book.updateMatrixWorld();
  if (V.arrange || ARR.leaving) {   // on the table the piles are named instead (placePiles)
    for (const el of LBL.values()) if (el.style.display !== "none") el.style.display = "none";
    placePiles();
    return;
  }
  placePiles();
  const want = [];
  const lay = V.layout, e = V.mode === "opening" ? 0 : smooth(.55, 1, V.spread);
  const curEn = V.model.all[V.cur];
  const sheetText = en => en.id + (en.moved ? " •" : en.resewn ? " ○" : "");
  // quire names above the head of each quire
  for (const q of V.model.quires) {
    // open at an opening, the other quires lie under the pages: name only the one in view
    if (V.mode === "opening" && q.quire !== curEn?.quire) continue;
    if (hiddenQuires().has(String(q.quire))) continue;
    const mid = q.leaves[Math.floor(q.leaves.length / 2)], p = CUR.poses.get(mid?.key), o = mid && V.objs.get(mid.e.id);
    if (!p || !o) continue;
    // by the spine in the spine and head views, mid-leaf otherwise
    const [dx, dz] = dirOf(p.a), w = o.leaves[mid.k].w * (V.preset === 2 ? -.05 : V.preset === 3 ? .12 : 1);
    const sec = (D.quires.find(x => x.q === q.quire) || {}).section || "";
    want.push({ key: "q" + q.qi, cls: "q", pri: 1, obj: o.group, p: new THREE.Vector3(p.x + dx * w * .5, p.y + topOf(o, mid.k) + 6, p.z + dz * w * .5),
                html: `${qTag(q.quire)}${e > .35 || V.preset === 3 ? `<small>${esc(sec)}${q.type === "singulions" ? " · singulions" : ""}</small>` : ""}` });
  }
  for (const en of V.model.all) {
    const isCur = en === curEn;
    const show = (isCur || en.unplaced || e > .4 || (en.moved && V.spread > .45)) && !isHidden(en);
    if (!show) continue;
    const an = sheetAnchor(en.id); if (!an) continue;
    const lost = en.sheet.missing.every(Boolean);
    want.push({ key: "s" + en.id, sheet: V.objs.get(en.id), cls: isCur ? "cur" : lost ? "lost" : en.moved ? "moved" : "",
                pri: isCur ? 0 : en.unplaced ? 1.2 : en.moved ? 1.5 : 2, ...an,
                html: esc(sheetText(en)) + (en.unplaced ? (lost ? " <small>lost · place unknown</small>" : " <small>set aside</small>") : lost && (isCur || e > .4) ? " <small>lost</small>" : "") });
  }
  want.sort((a, b) => a.pri - b.pri);
  // a label hides behind the sheets in front of it (checked at most every 150 ms, so orbiting stays smooth)
  const now = performance.now();
  if (now - OCC.t > 150) { OCC.t = now; OCC.hid = new Set(want.filter(L => occluded(L.p, L.obj, L.sheet || null)).map(L => L.key)); }
  const placed = [], seen = new Set();
  const W = SW, Hh = SH;
  for (const L of want) {
    const xy = project(L.p, L.obj);
    const el = lbl(L.key, "");
    seen.add(L.key);
    if (el._html !== L.html) { el.innerHTML = L.html; el._html = L.html; el._w = 0; }
    const cls = "v3-lbl " + L.cls + (OCC.hid.has(L.key) ? " behind" : "");
    if (el.className !== cls) el.className = cls;
    if (!xy || xy[0] < -40 || xy[0] > W + 40 || xy[1] < 0 || xy[1] > Hh + 20) { el.style.display = "none"; continue; }
    if (OCC.hid.has(L.key) && L.cls !== "cur") { el.style.display = "none"; continue; }
    if (!el._w) { el.style.display = ""; el._w = el.offsetWidth; el._h = el.offsetHeight; }
    const r = [xy[0] - el._w / 2 - 3, xy[1] - el._h - 3, xy[0] + el._w / 2 + 3, xy[1] + 1];
    if (L.pri > 0 && placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) { el.style.display = "none"; continue; }
    placed.push(r);
    if (el.style.display) el.style.display = "";
    const tr = `translate(${Math.round(xy[0])}px, ${Math.round(xy[1])}px) translate(-50%, -100%)`;
    if (el._tr !== tr) { el.style.transform = tr; el._tr = tr; }
  }
  for (const [k, el] of LBL) if (!seen.has(k) && el.style.display !== "none") el.style.display = "none";
}

// ---------------------------------------------------------------- colour overlays
/* Colour the sheet edges and the folds by a field the data already has, so the fore-edge and spine views read as a
   continuity chart. Categorical colours in a fixed order, checked for colour-blind separation on this dark scene
   (dataviz validator): the scribe hues are the viewer's own, stepped for the dark background; the others take the
   reference palette in the order the values first appear in the book. Faces stay photographic. */
const SECTION_ORDER = ["Botanical", "Astronomy", "Zodiac", "Balneology", "Rose", "Pharmaceutical", "Starred paragraphs"];
const SLOTS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const OVERLAYS = {
  none: { name: "None" },
  scribe: { name: "Scribe", src: "Davis's scribes (2025)",
    cats: [["1", "Scribe 1", "#2a6fc4"], ["2", "Scribe 2", "#d1495b"], ["3", "Scribe 3", "#c48612"], ["4", "Scribe 4", "#2a9d8f"], ["5", "Scribe 5", "#a47ce2"]],
    of: seg => (seg.scribes || []).filter(n => SCRIBES[n]).map(String) },
  section: { name: "Section", src: "Davis's section names (2025)",
    cats: SECTION_ORDER.map((x, i) => [x, x, SLOTS[i]]),
    of: seg => String(seg.section || "").split("/").map(x => x.trim()).filter(x => SECTION_ORDER.includes(x)) },
  illus: { name: "Illustration", src: "IVTFF illustration type ($I)",
    cats: ["H", "A", "Z", "B", "C", "P", "S", "T"].map((x, i) => [x, SECTION[x], SLOTS[i]]),
    of: seg => seg.vars?.I && SECTION[seg.vars.I] ? [seg.vars.I] : [] },
  lang: { name: "Currier language", src: "IVTFF Currier language ($L)",
    cats: [["A", "Currier A", SLOTS[0]], ["B", "Currier B", SLOTS[1]]],
    of: seg => seg.vars?.L && LANG[seg.vars.L] ? [seg.vars.L] : [] },
  moved: { name: "Moved from the binding", src: "this order against the current binding",
    cats: [["moved", "moved to another place", "#f3c35c"], ["resewn", "sewn or folded differently", "#d95926"], ["same", "where it is bound today", "#5e574d"]],
    sheet: en => [en.moved ? "moved" : en.resewn ? "resewn" : "same"] },
  quire: { name: "Quire (current binding)", src: "alternate quires of the current binding, so a sheet keeps its colour when it moves",
    cats: [["odd", "odd-numbered quire", "#cdbb92"], ["even", "even-numbered quire", "#6f604a"]],
    sheet: en => [SHEETS.get(en.id).quire % 2 ? "odd" : "even"] },
};
const OVERLAY_KEYS = Object.keys(OVERLAYS);
/* The values one leaf carries for an overlay: both faces of every panel of that leaf. */
function leafValues(ov, en, k) {
  if (!ov.of && !ov.sheet) return [];
  if (en.sheet.missing[k]) return [];
  if (ov.sheet) return ov.sheet(en);
  const sides = sidesOf(en.sheet, en.opts);
  const segs = [...sides[2 * k].segs, ...sides[2 * k + 1].segs];
  return [...new Set(segs.filter(x => !x.missing).flatMap(ov.of))].sort((a, b) => ov.cats.findIndex(c => c[0] === a) - ov.cats.findIndex(c => c[0] === b));
}
const OVM = new Map();
/* One material per colour (or striped combination), unlit so the colours read exactly as the legend shows them. */
function overlayMat(colors, double = false) {
  const key = colors.join("+") + (double ? "|2" : "");
  if (OVM.has(key)) return OVM.get(key);
  let m;
  if (colors.length === 1) m = new THREE.MeshBasicMaterial({ color: colors[0], side: double ? THREE.DoubleSide : THREE.FrontSide });
  else {   // a leaf with two hands (or sections): diagonal stripes, so every edge shows both
    const cv = document.createElement("canvas"); cv.width = cv.height = 32;
    const cx = cv.getContext("2d");
    for (let i = -32; i < 64; i += 8) colors.forEach((c, j) => {
      cx.fillStyle = c; cx.beginPath();
      const x = i + j * 8 / colors.length;
      cx.moveTo(x, 0); cx.lineTo(x + 8 / colors.length, 0); cx.lineTo(x + 8 / colors.length + 32, 32); cx.lineTo(x + 32, 32); cx.fill();
    });
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4);
    m = new THREE.MeshBasicMaterial({ map: t, side: double ? THREE.DoubleSide : THREE.FrontSide });
  }
  OVM.set(key, m);
  return m;
}
const colorsOf = (ov, vals) => vals.map(v => ov.cats.find(c => c[0] === v)?.[2]).filter(Boolean);
/* How often the value changes from one leaf to the next, front to back (lost leaves skipped). A plain count. */
function changesIn(order, ov) {
  const m = order === V.order ? V.model : modelOf(order);
  let n = 0, last = null;
  for (const L of m.leaves) {
    if (L.e.sheet.missing[L.k]) continue;
    const key = leafValues(ov, L.e, L.k).join("+") || "—";
    if (last !== null && key !== last) n++;
    last = key;
  }
  return n;
}
function renderLegend() {
  const el = $("#v3-legend"); if (!el || !V.model) return;
  const ov = OVERLAYS[V.overlay];
  if (!ov.cats) { el.hidden = true; return; }
  const counts = new Map();
  for (const L of V.model.leaves) for (const v of leafValues(ov, L.e, L.k)) counts.set(v, (counts.get(v) || 0) + 1);
  el.hidden = false; el.innerHTML = "";
  el.append(h("b", {}, ov.name), h("div", { class: "src" }, ov.src),
    h("div", { class: "rows" }, ov.cats.filter(c => counts.get(c[0])).map(c => h("span", { class: "row" }, h("i", { style: { background: c[2] } }), c[1], h("small", {}, ` ${counts.get(c[0])}`)))));
  if (ov.of) {
    const here = changesIn(V.order, ov), base = V.order.id === "beinecke" ? null : changesIn(ORDERS.get("beinecke"), ov);
    el.append(h("div", { class: "cont", title: "Counted along the leaves in the order they lie in the closed book; lost leaves are skipped." },
      `Changes from leaf to leaf: ${here}`, base != null ? h("span", {}, ` (current binding: ${base})`) : ""));
  } else if (V.overlay === "moved") {
    const m = V.model.all.filter(e => e.moved).length, r = V.model.all.filter(e => e.resewn).length;
    el.append(h("div", { class: "cont" }, `${m} sheet${m === 1 ? "" : "s"} moved, ${r} sewn or folded differently`));
  }
  el.append(h("div", { class: "src" }, "Colours are on the sheet edges and folds: try the fore-edge (4) and spine (2) views."));
}
function setOverlay(k) {
  V.overlay = OVERLAYS[k] ? k : "none"; store.set("3d:overlay", V.overlay);
  const sel = $("#v3-overlay"); if (sel) sel.value = V.overlay;
  tint(); renderLegend(); pushHash();
}

const OCC = { t: 0, hid: new Set() };
function occluded(p, obj, sheetObj) {
  const w = p.clone().applyMatrix4(obj.matrixWorld), d = w.sub(camera.position), dist = d.length();
  ray.set(camera.position, d.normalize()); ray.far = dist - 1;
  const see = m => m === M.ghostEdge || (Array.isArray(m) && m[0] === M.ghost && m[1] === M.ghost);   // lost leaves are see-through
  const hit = ray.intersectObjects(live, false).find(x => x.object.userData.sheet !== sheetObj && !see(x.object.material) && shown(x.object));
  ray.far = Infinity;
  return !!hit;
}

// ---------------------------------------------------------------- highlighting
function tint() {
  if (!V.model) return;
  const curEn = V.model.all[V.cur], ov = OVERLAYS[V.overlay];
  for (const en of V.model.all) {
    const o = V.objs.get(en.id); if (!o) continue;
    const picked = V.arrange ? V.sel.has(en.id) : en === curEn;
    const hi = picked || V.flash?.has(en.id) ? GOLD : en === V.hover ? 0xf7dc9a : null;
    const sheetCols = [];
    for (const L of o.leaves) {
      if (L.base == null) continue;   // a lost leaf stays a ghost
      const cols = ov.cats ? colorsOf(ov, leafValues(ov, en, L.k)) : [];
      sheetCols.push(...cols);
      // the current sheet's edges turn gold; with an overlay they keep its colours and the label marks it
      L.edge.color.setHex(hi ?? L.base); L.bendMat.color.setHex(hi ?? L.base);
      for (const m of o.panels) if (m.userData.leaf === L) m.material[2] = ov.cats && cols.length ? overlayMat(cols) : L.edge;
      for (const hg of L.hinges) for (const m of hg.bends) m.material = ov.cats && cols.length ? overlayMat(cols, true) : L.bendMat;
    }
    if (o.foldMat !== M.ghostEdge) {
      const fc = [...new Set(sheetCols)];
      o.fold.material = ov.cats && fc.length ? overlayMat(fc, true) : o.foldMats;
      if (o.fold2) o.fold2.material = o.fold.material;
      o.foldMat.color.setHex(hi ?? FOLD);
    }
    const glow = V.arrange && V.sel.has(en.id) ? 0x3d2c08 : en === V.hover ? 0x1c150a : 0;
    for (const m of o.panels) for (const mat of m.material.slice(0, 2)) if (mat.emissive) mat.emissive.setHex(glow);
  }
  wake();
}

// ---------------------------------------------------------------- sheet facts (tooltip)
function info(en) {
  const sides = sidesOf(en.sheet, en.opts);
  const plain = !(en.opts.spine || en.opts.inside_out || en.opts.rot180);
  const names = sd => sd.lost ? `[${short(sd.shown.page)}]`
    : en.sheet.read && plain ? short(pageName(sd.shown)) : sd.segs.map(x => short(pageName(x))).join("·");
  const v = varsOf([...en.sheet.inside.flat(), ...en.sheet.outside.flat()]);
  const pos = en.unplaced ? (en.sheet.missing.every(Boolean) ? "lost, position unknown" : "set aside, not in the book") : en.type === "singulions" ? `singulion ${en.idx + 1} of ${en.count}` : `bifolium ${en.idx + 1} of ${en.count} from the outside`;
  return { sides, names, v, pos, title: `Sheet ${en.id}`, sub: en.unplaced ? `Not placed · ${pos}` : `${qWord(en.quire)} · ${pos}` };
}
function tip(en, e, mesh = null) {
  if (V.arrange) { tipEl.hidden = true; return hud(en); }   // on the table: in the panel, which stays put
  if (!en) { tipEl.hidden = true; return; }
  const { sides, names, v, sub, title } = info(en);
  // over a flap of the sheet in hand: what a click on it does
  const fold = V.hand.on && en === V.model.all[V.cur] ? foldOf(mesh) : null, st = fold && mesh.userData.leaf.steps[fold.i];
  const flapOpen = fold && fold.i < Math.min(V.hand.open[fold.k], mesh.userData.leaf.steps.length);
  tipEl.innerHTML = "";
  tipEl.append(h("b", {}, title), h("div", {}, sub),
    st?.info ? h("div", { class: "moved" }, `Click to ${flapOpen ? "fold" : "unfold"} ${st.info.label}`) : "",
    h("div", { class: "pages" }, `${names(sides[0])}, ${names(sides[1])} | ${names(sides[2])}, ${names(sides[3])}`),
    v.is.length || v.hs.length ? h("div", { class: "muted" }, [v.is.join(", "), v.hs.map(x => SCRIBES[x]).join(" + ")].filter(Boolean).join(" · ")) : "",
    en.moved ? h("div", { class: "moved" }, "• placed differently from the current binding") : "",
    en.resewn ? h("div", { class: "moved" }, "○ sewn or folded differently from the current binding") : "");
  const r = stage.getBoundingClientRect();
  tipEl.hidden = false;
  tipEl.style.left = Math.min(r.width - 280, e.clientX - r.left + 16) + "px";
  tipEl.style.top = Math.max(8, Math.min(r.height - 120, e.clientY - r.top + 12)) + "px";
}

function readSheet(en) {
  if (!en || en.unplaced) { toast(en?.sheet.missing.every(Boolean) ? "This sheet is lost and has no place in the order" : "This sheet is set aside: put it back in a gathering to read it in place"); return; }
  setPos(sidesOf(en.sheet, en.opts)[0].shown.page, en.id, "three");
  show("read");
}
function readOpening() {
  const p = openingPage();
  if (!p || p.lost) { readSheet(V.model.all[V.cur]); return; }
  setPos(p.shown.page, p.sheet, "three");
  show("read");
}

// ---------------------------------------------------------------- keeping in step with Read (POS in app.js)
/* The page side on the right of the current opening (the left one at the back cover). */
function openingPage(o = V.opening) {
  const pages = linearize(V.order, { ghosts: true });
  return pages[2 * o] || pages[2 * o - 1];
}
/* Tell Read where 3D is. In the block, a sheet that already holds the shared page keeps it, so looking at a sheet
   in 3D does not move Read off the page it was on. */
function report() {
  const en = V.model?.all[V.cur];
  if (!en || en.unplaced) return;
  if (V.mode === "opening") { const p = openingPage(); if (p) setPos(p.shown.page, p.sheet, "three"); return; }
  if (POS.sheet === en.id) return;
  setPos(sidesOf(en.sheet, en.opts)[0].shown.page, en.id, "three");
}
/* Which opening shows a page: opening k shows page sides 2k-1 | 2k. */
function openingOf(page) {
  const pages = linearize(V.order, { ghosts: true });
  const j = pages.findIndex(p => p.shown.page === page || p.segs.some(x => x.page === page));
  return j < 0 ? -1 : Math.floor((j + 1) / 2);
}
/* Go to where Read is: its opening in Opening mode, its sheet in the block. */
function sync(pos, { open = false } = {}) {
  if (!V.model || !pos?.sheet) return;
  if (open && V.mode !== "opening") {   // a bookmark: pull the sheet out, so its pages are listed
    const j = V.model.all.findIndex(en => en.id === pos.sheet);
    if (j >= 0) { if (isHidden(V.model.all[j])) setHidden(V.model.all[j].quire, false); selectSheet(j); }
    return;
  }
  const i = V.model.all.findIndex(en => en.id === pos.sheet);
  if (i < 0) return;
  if (V.mode === "opening") {
    const o = openingOf(pos.page);
    if (o >= 0 && o !== V.opening) setOpening(o);
  } else if (i !== V.cur) setCur(i);
}

// ---------------------------------------------------------------- moving through the book
function setCur(i, { follow = true } = {}) {
  const all = V.model.all;
  i = clamp(i, 0, all.length - 1);
  if (i === V.cur && V.layout) return;
  if (V.hand.on) putBack({ silent: true });
  V.cur = i;
  if (isHidden(all[i])) setHidden(all[i].quire, false);   // asked for a sheet in a hidden quire: show the quire again
  tint(); renderStrip(); renderInspector(); pushHash(); report(); Arrange.mark(curSheet(), true);
  if (V.mode === "block") relayout(420);
  if (follow) followCur();
}
/* In a wide (exploded) layout, keep the current sheet on screen. */
function followCur() {
  if (V.arrange) return;
  const an = sheetAnchor(V.model.all[V.cur]?.id); if (!an || !V.layout) return;
  const lp = V.layout.poses.get(`${V.model.all[V.cur].id}:0`); if (!lp) return;
  book.updateMatrixWorld();
  const p = new THREE.Vector3(lp.x, H / 2, lp.z).applyMatrix4(V.layout.place.matrix);
  const xy = project(new THREE.Vector3(lp.x, H / 2, lp.z), book);
  if (xy && xy[0] > stage.clientWidth * .15 && xy[0] < stage.clientWidth * .85) return;
  const t = CAM.goal.target.clone(); t.x = p.x; t.z = p.z;
  setGoal({ target: t }, 5);
}
function step(d, byQuire = false) {
  const all = V.model.all;
  if (!byQuire) {
    let i = V.cur + d;
    while (i > 0 && i < all.length - 1 && isHidden(all[i])) i += d;   // hidden quires are skipped
    if (!isHidden(all[i])) setCur(i);
    return;
  }
  const q = all[V.cur].quire;
  let i = V.cur;
  if (d > 0) { while (i < all.length - 1 && all[i].quire === q) i++; }
  else { while (i > 0 && all[i - 1].quire === q) i--; if (i === V.cur && i > 0) { const q2 = all[i - 1].quire; i--; while (i > 0 && all[i - 1].quire === q2) i--; } }
  setCur(i);
}
function setOpening(o) {
  const N = V.model.leaves.length;
  V.opening = clamp(o, 0, N);
  V.unfoldOpening = false;
  const L = V.model.leaves[Math.min(N - 1, V.opening)] || V.model.leaves[V.opening - 1];
  if (L) { V.cur = V.model.all.indexOf(L.e); tint(); renderStrip(); Arrange.mark(curSheet(), true); }
  renderOpening(); pushHash(); report();
  relayout(520);
  if (V.preset === 5) setTimeout(() => preset(5), 0);
}
function setMode(m, { view = true } = {}) {
  if (m === V.mode) return;
  V.mode = m;
  if (m === "opening") {   // open where Read is, if that is on this sheet; else the back of its first leaf faces the next page
    const en = V.model.all[V.cur], o = POS.sheet === en?.id ? openingOf(POS.page) : -1;
    const L0 = V.model.leaves.find(L => L.e === en && L.k === 0);
    V.opening = o >= 0 ? o : L0 ? L0.n + 1 : 1;
  }
  renderBar(); renderOpening(); pushHash(); report();
  relayout(800);
  if (view) setTimeout(() => preset(m === "opening" ? 5 : (V.preset === 5 ? 1 : V.preset || 1)), 0);
}
function setPosture(p) {
  if (p === V.posture) return;
  V.posture = p; store.set("3d:posture", p); pushHash();
  renderBar();
  relayout(900);
  setTimeout(() => preset(V.preset || 1), 0);
}
function setSpread(s, dur = 260) {
  V.spread = clamp(s); store.set("3d:spread", V.spread); pushHash();
  const r = $("#v3-spread"); if (r && +r.value !== Math.round(V.spread * 100)) r.value = Math.round(V.spread * 100);
  $("#v3-spread-name") && ($("#v3-spread-name").textContent = spreadName(V.spread));
  if (V.mode === "opening") { V.mode = "block"; renderBar(); renderOpening(); }
  relayout(dur);
}
function setThick(x) {
  V.thick = x; store.set("3d:thick", x); pushHash();
  relayout(500);
}

// ---------------------------------------------------------------- Rearrange: the book taken apart on the table
/* In Rearrange (arrange.js) the book comes apart on the table, the background darkens, and every quire lies open as a
   pile of open sheets, in the order of the book, row by row from the back. A quire whose sheets are tucked inside each
   other is stacked the way it lies opened at its centre: the centre sheet on top, each sheet further out a little
   lower and further forward, so its edge shows. Sheets read one by one are fanned left to right like cards, the first
   on the left. Set-aside sheets lie in a last pile.
   It works like a drawing program: click a sheet to select it, ⇧- or ⌘-click to add more, drag across the table to
   select a box of them; drag the selection onto a pile (it opens where they will go) or into the gap between two piles
   (a new quire there). The book's frame (posture, place) holds still while the sheets are on the table. */
const ARR = { leaving: false, drag: null, gap: null, gapKey: "", cam: null, dk: 0, goal: 0, sig: "", tray: null, hl: null, ins: null,
              qsel: [], plan: null, box: null, space: false, hudT: 0 };
const ARR_UP = 7, ARR_FWD = 10, ARR_FAN = .42, ARR_LIFT = 46;
const ARR_UP_OPEN = 12, ARR_FWD_OPEN = 22;   // a stack under the pointer opens out, so each of its sheets is easy to point at
const BG = new THREE.Color(0x221e1a), BG_DARK = new THREE.Color(0x100e0c), TBL = new THREE.Color(0x3a3129), TBL_DARK = new THREE.Color(0x1f1a16);
const TABLE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const nth = k => ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"][k] || `${k + 1}th`;
/* where a sheet is, in words (for screen readers): "the third sheet from the outside" */
function whereText(en) {
  if (en.unplaced) return en.sheet.missing.every(Boolean) ? "lost, and given no place" : "set aside, out of the book";
  if (en.count === 1) return "the only sheet";
  if (en.type === "singulions") return `the ${nth(en.idx)} of ${en.count}, read one by one`;
  return en.idx === en.count - 1 ? "the centre sheet" : en.idx === 0 ? "the outermost sheet" : `the ${nth(en.idx)} sheet from the outside`;
}
const sheetWidth = id => { const o = V.objs.get(id); return o ? (o.leaves[0].w || o.leaves[1].w) + (o.leaves[1].w || o.leaves[0].w) : H * 1.4; };
const GX = H * .38, CAP = H * .72;   // the gap between piles, and the room in front of a row for its names (enough in a small window)

function arrangeLayout(base) {
  const model = V.model, place = base.place, inv = place.matrix.clone().invert(), hid = hiddenQuires();
  const lifted = new Set(ARR.drag?.ids || []), gap = ARR.gap;
  const poses = new Map(), sg = new Map(), centers = new Map(), picks = new Map();
  const W0 = H * 1.45;   // an empty pile's room (set aside)
  const piles = model.quires.filter(q => !hid.has(String(q.quire))).map(q => ({ key: String(q.quire), gi: q.qi, quire: q.quire, type: q.type,
    ens: model.sheets.filter(en => en.qi === q.qi) }));
  piles.push({ key: "aside", gi: -1, quire: null, type: "aside", ens: model.unplaced });
  for (const p of piles) {
    p.ids = p.ens.map(en => en.id).filter(id => !lifted.has(id));       // what stays in it while sheets are dragged
    p.slots = p.ids.slice();
    if (gap?.kind === "into" && gap.key === p.key) p.slots.splice(gap.index, 0, ...[...lifted].map(() => null));   // room for them
    p.fan = p.type !== "nested";
    p.sw = Math.max(...p.ens.map(en => sheetWidth(en.id)), p.ens.length ? 0 : W0);   // its widest sheet, lying open
    const open = !p.fan && (p.key === V.hoverPile || (gap?.kind === "into" && gap.key === p.key));
    p.fwd = open ? ARR_FWD_OPEN : ARR_FWD; p.up = open ? ARR_UP_OPEN : ARR_UP;
    const n = Math.max(1, p.slots.length);
    p.d = H + (p.fan ? 0 : p.fwd * (n - 1));
  }
  /* The plan of the table: each quire has a room of its own, sized for what it holds and one sheet more, at a fixed
     place. It is made when the book comes apart (or another order is chosen). Moving sheets about never changes it:
     a pile grows back into the space behind it and nothing else moves. A quire made, merged or split changes only its
     own row; a quire moved keeps every row as long as it was. Its shape doesn't depend on the window. */
  const kind = p => p.fan ? "f" : "n";
  const room = p => p.fan ? p.sw * (1 + ARR_FAN * Math.max(p.ens.length, p.key === "aside" ? 2 : 0)) : p.sw;   // a fan: room for one card more (set aside: three)
  const reach = p => p.fan ? H * 1.16 : H + (ARR_FWD_OPEN + ARR_UP_OPEN / 1.6) * p.ens.length;   // a fan: room for a card drawn out; a stack: open (its rise looks like depth from above), one sheet deeper
  const keys = piles.map(p => `${p.key}:${kind(p)}`).join("|");
  const depthOf = row => Math.max(...row.map(reach)) + CAP;
  const place2 = rows => {   // x for every pile, each row centred; rows keep the depth they had (new ones after)
    const at = new Map(), old = ARR.plan;
    let z = -rows.reduce((a, row) => a + depthOf(row), 0) / 2;
    const rowZ = rows.map((row, j) => old?.rowZ[j] ?? (z += depthOf(row), z - CAP));
    if (old) for (let j = old.rowZ.length; j < rows.length; j++) rowZ[j] = rowZ[j - 1] + depthOf(rows[j]);
    rows.forEach((row, j) => {
      const w = p => { const a = old?.at.get(p.key); return a && a.kind === kind(p) ? a.w : room(p); };
      // a row that only lost piles (a quire merged away, hidden or emptied) keeps the others where they were: a gap is
      // left rather than the rest sliding over. Anything new in it, or in another order, and it is centred again
      const was = row.map(p => old?.at.get(p.key));
      const keep = was.every((a, i) => a && a.kind === kind(row[i]) && a.row === j && (i === 0 || a.x0 > was[i - 1].x0));
      let x = -row.reduce((a, p) => a + w(p) + GX, -GX) / 2;
      row.forEach((p, i) => { at.set(p.key, { x0: keep ? was[i].x0 : x, w: w(p), row: j, z1: rowZ[j], kind: kind(p), r: reach(p) }); x += w(p) + GX; });
    });
    const base = old?.base ?? Math.max(...rows.map(row => row.reduce((a, p) => a + room(p) + GX, -GX)));   // the widest row, laid out afresh
    return { keys, counts: rows.map(r => r.length), at, rowZ, base, order: V.order?.id };
  };
  if (!ARR.plan || ARR.plan.keys !== keys) {
    let rows = null;
    if (ARR.plan && ARR.plan.counts.reduce((a, c) => a + c, 0) === piles.length) {          // a quire moved: the rows as they were
      let i = 0; rows = ARR.plan.counts.map(c => piles.slice(i, i += c));
    } else if (ARR.plan) {   // quires made, merged or split: each stays in its row, a new one goes into the row before it
      let r = 0;
      const rowOf = piles.map(p => (r = Math.max(r, ARR.plan.at.get(p.key)?.row ?? r)));
      rows = []; piles.forEach((p, i) => (rows[rowOf[i]] ||= []).push(p));
      rows = rows.filter(Boolean);
      // unless a row has grown a third wider than the widest was when the table was laid out (step by step or at once)
      const width = row => row.reduce((a, p) => a + room(p) + GX, -GX);
      if (Math.max(...rows.map(width)) > ARR.plan.base * 1.34) { ARR.plan = null; rows = null; }
    }
    if (!rows) {   // a fresh table: as many rows as make it closest to 7 by 4 (the camera then fits it to the window)
      const total = piles.reduce((a, p) => a + room(p) + GX, -GX), aspect = 1.75, slant = .88;
      const pack = limit => { const out = [[]]; let x = 0;
        for (const p of piles) { if (x > 0 && x + room(p) > limit) { out.push([]); x = 0; } out.at(-1).push(p); x += room(p) + GX; }
        return out; };
      let best = Infinity;
      for (let n = 1; n <= 9; n++) {
        const cand = pack(Math.max(...piles.map(room), total / n + 1));
        const fit = Math.max(Math.max(...cand.map(row => row.reduce((a, p) => a + room(p) + GX, -GX))) / aspect, cand.reduce((a, row) => a + depthOf(row), 0) * slant);
        if (fit < best - 1e-6) { best = fit; rows = cand; }
      }
    }
    ARR.plan = place2(rows);
  }
  for (const p of piles) {
    Object.assign(p, ARR.plan.at.get(p.key));
    p.z0 = p.z1 - p.d;
    // a fan's cards sit in the middle of its room, closing up if more come than the room was made for
    const fan = n => n > 1 ? Math.max(p.sw * .08, Math.min(ARR_FAN * p.sw, (p.w - p.sw) / (n - 1))) : 0;
    p.step = fan(p.slots.length); p.fx = p.x0 + (p.w - p.sw - p.step * Math.max(0, p.slots.length - 1)) / 2 + p.sw / 2;
    p.step0 = fan(p.ids.length); p.fx0 = p.x0 + (p.w - p.sw - p.step0 * Math.max(0, p.ids.length - 1)) / 2 + p.sw / 2;
  }
  const flat = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const put = (en, wx, wy, wz) => {
    const o = V.objs.get(en.id), wl = o?.leaves[0].w || 0, wr = o?.leaves[1].w || 0;
    const world = new THREE.Matrix4().makeTranslation(wx + (wl - wr) / 2, wy, wz).multiply(flat);   // spine placed so the sheet is centred
    const m = inv.clone().multiply(world), pp = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    m.decompose(pp, q, sc);
    sg.set(en.id, { p: pp, q });
    poses.set(`${en.id}:0`, { x: 0, y: 0, z: 0, a: -90, f: 1, lift: 0 });
    poses.set(`${en.id}:1`, { x: 0, y: 0, z: 0, a: 90, f: 1, lift: 0 });
  };
  const byId = new Map(model.all.map(en => [en.id, en]));
  for (const p of piles) {
    p.anchors = [];
    p.slots.forEach((id, j) => {
      const cx = p.fan ? p.fx + j * p.step : p.x0 + p.w / 2;
      const y = 1 + (p.fan ? j * 1.6 : j * p.up), z = p.fan ? p.z1 : p.z1 - j * p.fwd;
      if (id == null) return;
      // selected sheets are drawn a little out of their pile (the main one more); the one pointed at, less. Out of a stack
      // toward you; a card out of a fan away from you, up into the room kept behind it, clear of the name in front
      const pull = (V.sel.has(id) ? H * (id === V.selMain ? .16 : .1) : id === V.hover?.id ? H * .07 : 0) * (p.fan ? -1 : 1);
      put(byId.get(id), cx, y + (pull ? .6 : 0), z + pull);
      centers.set(id, new THREE.Vector3(cx, y, z + pull - H / 2));
      // a point on the part of it that shows: the strip in front of the sheet above, or (a fan) its own uncovered side
      const top = j === p.slots.length - 1;
      picks.set(id, new THREE.Vector3(p.fan && !top ? cx - p.sw / 2 + Math.max(4, p.step / 2) : cx, y, top ? z + pull - H / 2 : p.fan ? z + pull - H / 2 : z + pull - Math.min(p.fwd, H) / 2));
    });
    // where a dragged sheet would land, slot by slot, measured without the room made for it (so the room doesn't move them)
    for (let j = 0; j <= p.ids.length; j++) {
      const cx = p.fan ? p.fx0 + (j - .5) * (p.step0 || ARR_FAN * p.sw) : p.x0 + p.w / 2;
      p.anchors.push(new THREE.Vector3(cx, 1 + (p.fan ? 0 : (j - .5) * p.up), p.fan ? p.z1 : p.z1 - Math.max(0, j - .5) * p.fwd));
    }
    p.label = new THREE.Vector3(p.x0 + p.w / 2, 0, p.z1 + 6);   // its name is a caption, just in front of it
  }
  // sheets of hidden quires stay where they were; the ones in hand follow the pointer
  for (const en of model.all) if (!sg.has(en.id)) { sg.set(en.id, CUR.sg.get(en.id) || IDENT); poses.set(`${en.id}:0`, CUR.poses.get(`${en.id}:0`) || base.poses.get(`${en.id}:0`)); poses.set(`${en.id}:1`, CUR.poses.get(`${en.id}:1`) || base.poses.get(`${en.id}:1`)); }
  for (const id of lifted) {
    const g = ARR.drag.gs?.get(id); if (!g) continue;
    sg.set(id, g); poses.set(`${id}:0`, { x: 0, y: 0, z: 0, a: -90, f: 1, lift: 0 }); poses.set(`${id}:1`, { x: 0, y: 0, z: 0, a: 90, f: 1, lift: 0 });
  }
  const box = new THREE.Box3();
  for (const p of piles) { box.expandByPoint(new THREE.Vector3(p.x0, 0, p.z0 - H * .05)); box.expandByPoint(new THREE.Vector3(p.x0 + p.w, 30, p.z1 + CAP * .8)); }
  // what the camera frames: the plan's rooms (a stack's room has space for it open), so pointing at a stack, opening
  // it or dragging over it never moves the camera
  const frame = new THREE.Box3();
  for (const a of ARR.plan.at.values()) { frame.expandByPoint(new THREE.Vector3(a.x0, 0, a.z1 - (a.r ?? H))); frame.expandByPoint(new THREE.Vector3(a.x0 + a.w, 30, a.z1 + CAP * .8)); }
  return { ...base, poses, sg, place, box, frame, piles, centers, picks, W0 };
}
const rowsOf = piles => { const rows = []; for (const p of piles) (rows[p.row] ||= []).push(p); return rows.filter(Boolean); };

/* Lost sheets in or out of the 3D book (the order keeps them; the Reader still shows where they were). */
function setHideLost(on) {
  V.hideLost = on; store.set("3d:hideLost", on);
  const b = $("#v3-lost"); if (b) { b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
  if (V.order) open(V.order, { ms: 600 });
  toast(on ? "Lost sheets are hidden in 3D" : "Lost sheets are shown again");
  Arrange.render();
}

/* Darken the room for Rearrange, and light it again after. */
function shade(dt) {
  if (ARR.dk === ARR.goal) return false;
  ARR.dk = REDUCED ? ARR.goal : clamp(ARR.dk + Math.sign(ARR.goal - ARR.dk) * dt * 2.2);
  scene.background.lerpColors(BG, BG_DARK, ARR.dk); scene.fog.color.copy(scene.background);
  table.material.color.lerpColors(TBL, TBL_DARK, ARR.dk);
  return ARR.dk !== ARR.goal;
}

/* Taking the book apart, and putting it back, one sheet after another in reading order. The book stands in the middle of
   the table, where piles will lie, so it first glides to the far side of the table, behind the first row; then each
   sheet rises straight up out of it, arcs over everything, and comes straight down onto its pile, its leaves opening on
   the way. Putting it back is the same backwards: each sheet arcs from its pile into the book at the far side, closing as
   it goes, and once they are all in, the book glides home. Nothing passes through anything. */
const TABLE_MS = 2000;
function tableMorph(tw, L) {
  const all = V.model.all, n = Math.max(1, all.length - 1), coming = V.arrange;
  const inv = new THREE.Quaternion().setFromRotationMatrix(L.place.matrix).invert();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(inv);   // the room's up, in the book's frame
  if (coming) {   // where the book goes first (in the book's frame): kept for putting it back
    const box = new THREE.Box3();
    book.updateMatrixWorld(true);
    for (const en of all) { const o = V.objs.get(en.id); if (o?.group.visible) box.expandByObject(o.group); }
    const back = Math.min(...L.piles.filter(p => p.row === 0).map(p => p.z0)), f = L.frame;
    ARR.away = box.isEmpty() ? new THREE.Vector3()
      : new THREE.Vector3((f.min.x + f.max.x) / 2 - (box.min.x + box.max.x) / 2, 0, Math.min(0, back - H * .2 - box.max.z)).applyQuaternion(inv);
  }
  const D = ARR.away || new THREE.Vector3(), GLIDE = .14, FLY = .56, SPREAD = .3, HIGH = H * 2.1;
  const away = s => ({ p: s.p.clone().add(D), q: s.q.clone() });
  // from one place to the other on a curve that leaves straight up and lands straight down, eased along its length
  const arc = (from, to, t0, t1) => {
    const P1 = from.p.clone().addScaledVector(up, HIGH), P2 = to.p.clone().addScaledVector(up, HIGH), out = [];
    for (let j = 1; j <= 10; j++) {
      const u = ease(j / 10), v = 1 - u;
      const p = from.p.clone().multiplyScalar(v * v * v).addScaledVector(P1, 3 * v * v * u).addScaledVector(P2, 3 * v * u * u).addScaledVector(to.p, u * u * u);
      out.push([t0 + (t1 - t0) * j / 10, { p, q: from.q.clone().slerp(to.q, ease(clamp((u - .1) / .7))) }, "even"]);
    }
    return out;
  };
  all.forEach((en, i) => {
    const sgt = tw.sgs.get(en.id); if (!sgt) return;
    const a = sgt[0][1], b = sgt.at(-1)[1], st = (coming ? GLIDE : 0) + SPREAD * i / n;
    tw.sgs.set(en.id, coming
      ? [[0, a], [GLIDE, away(a)], [st, away(a)], ...arc(away(a), b, st, st + FLY), [1, b]]
      : [[0, a], [st, a], ...arc(a, away(b), st, st + FLY), [1 - GLIDE, away(b)], [1, b]]);
    for (const key of [`${en.id}:0`, `${en.id}:1`]) {   // the leaves open in the air, and close in the air
      const tr = tw.poses.get(key); if (!tr) continue;
      const pa = tr[0][1], pb = tr.at(-1)[1];
      tw.poses.set(key, coming ? [[0, pa], [st + FLY * .25, pa], [st + FLY * .8, pb], [1, pb]] : [[0, pa], [st + FLY * .15, pa], [st + FLY * .7, pb], [1, pb]]);
    }
  });
}

/* The camera onto the table, which is fitted to the stage beside the panel on the left (#v3-hud). `pts`: fit those
   instead (zoom to the selection). */
function frameTable(instant = false, pts = null) {
  const b = V.layout?.frame; if (!b || b.isEmpty()) return;
  const pitch = 58;
  if (!pts) {
    pts = boxPoints(b);
    pts.push(new THREE.Vector3(b.getCenter(new THREE.Vector3()).x, 0, b.max.z + H * .9));   // room in front for the selection's bar
    ARR.box = b.clone();
  }
  const c = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
  const W = stage.clientWidth || 1, Hs = stage.clientHeight || 1, side = stage.contains($("#v3-hud")) ? hudW() : 0;   // (with the list open, the panel is over the list)
  stage.classList.toggle("hudcol", side > 0);   // the selection's bar and the messages keep out of the column (style.css)
  if (stage.classList.contains("tsmall") !== W - side < 900) {   // a small table: smaller names under its piles (measured again)
    stage.classList.toggle("tsmall", W - side < 900);
    for (const el of $$(".v3-pile")) el._fullW = null;
  }
  document.documentElement.style.setProperty("--hud-col", side + "px");
  const dist = fitDist(pts, c, 0, pitch, 1.07, 32, (W - side) / Hs);
  c.x -= side / 2 * (2 * Math.tan(16 * DEG) * dist / Hs);   // half the panel's column, in world units at the table
  setGoal({ yaw: nearestYaw(0), pitch, target: c, fov: 32, dist }, instant ? 100 : 3.6);
  V.preset = null; renderViews();
}
/* After the plan changed (a quire made, merged, split): frame the table again only if it no longer fits. */
function keepFramed() {
  const b = V.layout?.frame, was = ARR.box;
  if (!b || !was) return;
  const grow = (b.max.x - b.min.x) > (was.max.x - was.min.x) * 1.02 || (b.max.z - b.min.z) > (was.max.z - was.min.z) * 1.02
    || b.min.x < was.min.x - 1 || b.max.x > was.max.x + 1;
  if (grow) frameTable();
}

function setArrange(on) {
  if (!V.model || on === V.arrange) return;
  if (on) {
    if (TW.camAt) TW.camAt = null;   // back onto the table before the camera went home: it stays on the table
    if (V.hand.on) putBack({ silent: true });
    if (V.inspect) { V.inspect = false; renderInspector(); pushHash(); }
    if (V.contact.on) setContactView(false);
    if (V.mode === "opening") setMode("block", { view: false });
    ARR.cam = { yaw: CAM.goal.yaw, pitch: CAM.goal.pitch, dist: CAM.goal.dist, fov: CAM.goal.fov, target: CAM.goal.target.clone(), preset: V.preset };
  }
  V.arrange = on; ARR.leaving = !on; ARR.goal = on ? 1 : 0;
  ARR.drag = ARR.gap = null; ARR.gapKey = "";
  if (on) ARR.plan = null; else { V.sel = new Set(); V.selQ = new Set(); V.selMain = null; }
  $("#v-three").classList.toggle("table", on);
  tip(null);
  relayout(REDUCED ? 0 : TABLE_MS, tableMorph);
  TW.long = true;   // a hover doesn't cut this move short (see wire)
  if (on) frameTable();
  else if (ARR.cam) {   // the camera holds the table while the book comes together at its far side, then goes home with it
    TW.camAt = { k: .7, cam: ARR.cam };   // (tweenStep: on the movement's own clock)
    if (!TW.on || !TW.dur) camHome();
    V.preset = ARR.cam.preset; renderViews();
  }
  ARR.sig = ""; placePiles(); hud(null); tint(); wake();
}

/* Off the table: the camera back to where it was, a named view fitted to the stage as it is now. */
function camHome() {
  const c = TW.camAt?.cam; TW.camAt = null;
  if (!c || V.arrange) return;
  if (c.preset) preset(c.preset, { instant: REDUCED }); else setGoal(c, 3);
}

/* The selection, from arrange.js: sheets (the main one is the current sheet) or whole quires. */
function setSelection(ids, quires, main) {
  V.sel = new Set(ids); V.selQ = new Set(quires.map(String)); V.selMain = main ?? null;
  const i = main ? V.model?.all.findIndex(en => en.id === main) : -1;
  if (i >= 0 && i !== V.cur) { V.cur = i; renderStrip(); pushHash(); report(); }
  tint();
  // selected sheets come a little out of their piles: now, or, while sheets are still moving, once they have landed
  if (V.arrange) { if (TW.on) ARR.after = true; else relayout(REDUCED ? 0 : 160); }
  placePiles();
}

/* The piles' names (from arrange.js) under each pile, the gold marks on the table, and the panel. */
function placePiles() {
  const host = $("#v3-piles"); if (!host) return;
  const piles = V.arrange && V.layout?.piles;
  if (!piles) {
    if (host.childElementCount) host.replaceChildren();
    for (const m of [ARR.tray, ARR.hl, ARR.ins, ...ARR.qsel, ...(ARR.ssel || [])]) if (m) m.visible = false;
    return;
  }
  const sig = piles.map(p => `${p.key}:${p.ens.map(en => en.id).join(",")}`).join("|") + "#" + V.order?.id + "#" + [...(Arrange.ch?.booklets || [])].join(",");
  if (sig !== ARR.sig) {   // the same element for the same quire, its contents renewed: a name being pointed at stays put
    ARR.sig = sig;
    const had = new Map([...host.children].map(e => [e.dataset.key, e]));
    host.replaceChildren(...piles.map(p => {
      const fresh = Arrange.pileLabel(p), el = had.get(p.key);
      if (!el || el.querySelector("input")) return el || fresh;   // a name being typed stays as it is
      el.className = fresh.className; el.title = fresh.title; el.dataset.gi = fresh.dataset.gi; el._fullW = null;
      el.setAttribute("aria-pressed", fresh.getAttribute("aria-pressed"));
      el.replaceChildren(...fresh.childNodes);
      return el;
    }));
  }
  const settling = TW.on && !!(TW.long || TW.replan);   // the book coming apart, or the table laid out again
  host.classList.toggle("moving", TW.on && !!TW.long);   // the names come once the sheets have landed (and the marks below)
  const t = ARR.drag && ARR.gap;   // where dragged sheets would go
  // each name may be as wide as its share of its row: halfway to the names beside it (to the edge, at either end)
  const at = new Map(piles.map(p => [p.key, project(p.label, scene)]));
  const share = new Map();
  for (const row of rowsOf(piles)) {
    const xs = row.map(p => at.get(p.key)?.[0]).filter(x => x != null).sort((x, y) => x - y);
    for (const p of row) {
      const x = at.get(p.key)?.[0]; if (x == null) continue;
      const i = xs.indexOf(x), l = i > 0 ? (x - xs[i - 1]) / 2 : x, r = i < xs.length - 1 ? (xs[i + 1] - x) / 2 : stage.clientWidth - x;
      share.set(p.key, 2 * Math.min(l, r) - 6);
    }
  }
  for (const el of host.children) {
    const p = piles.find(x => x.key === el.dataset.key); if (!p) continue;
    el.classList.toggle("target", !!t && t.kind === "into" && t.key === p.key);
    const on = V.selQ.has(p.key);
    if (el.classList.contains("sel") !== on) { el.classList.toggle("sel", on); el.setAttribute("aria-pressed", String(on)); }
    const xy = at.get(p.key);
    if (!xy) { el.style.display = "none"; continue; }
    el.style.display = "";
    const tf = `translate(${Math.round(xy[0])}px, ${Math.round(xy[1])}px) translate(-50%, 0)`;
    // the table laid out again: a name whose pile moves waits until it has landed; the others stay where they are
    el._moving = settling && (el._moving || (!!el._tf && el._tf !== tf));
    el.classList.toggle("moving", el._moving);
    if (el._tf !== tf) { el._tf = tf; el.style.transform = tf; }
    // a name that doesn't fit its share leaves out the sections' icons, then (a small window) the count: only the quire
    // shows; the rest is always in its tooltip
    if (!el._fullW && !el.classList.contains("target")) {
      el.classList.remove("mid", "tight");
      el._fullW = el.offsetWidth; el._icW = (el.querySelector(".pl-ics")?.offsetWidth || 0) + 5;
    }
    const room = share.get(p.key) ?? Infinity;
    el.classList.toggle("mid", el._fullW > room && el._fullW - el._icW <= room);
    el.classList.toggle("tight", el._fullW - el._icW > room);
  }
  const flatGold = (fill, line) => {   // a gold mark lying on the table: a wash and/or an outline
    const g = new THREE.Group();
    if (fill) g.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: fill, depthWrite: false })));
    if (line) g.add(new THREE.Line(RECT, new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: line })));
    g.rotation.x = -Math.PI / 2; scene.add(g); return g;
  };
  // an empty set-aside pile is a dashed place on the table
  const aside = piles.find(p => p.key === "aside");
  if (!ARR.tray) {
    ARR.tray = new THREE.Line(RECT, new THREE.LineDashedMaterial({ color: 0x8f877a, dashSize: .025, gapSize: .018 }));
    ARR.tray.rotation.x = -Math.PI / 2; scene.add(ARR.tray);
  }
  ARR.tray.visible = !aside.ids.length && !settling;
  ARR.tray.position.set(aside.x0 + aside.w / 2, .5, aside.z1 - H / 2);   // in the middle of its room, under its name
  ARR.tray.scale.set(aside.sw, H, 1); ARR.tray.computeLineDistances();
  // selected quires: an outline under each
  const sel = piles.filter(p => V.selQ.has(p.key));
  while (ARR.qsel.length < sel.length) ARR.qsel.push(flatGold(.08, .9));
  ARR.qsel.forEach((m, i) => {
    const p = sel[i]; m.visible = !!p && !settling; if (!p) return;
    m.position.set(p.x0 + p.w / 2, .3, (p.z0 + p.z1) / 2); m.scale.set(p.w + 14, p.d + 14, 1);
  });
  // selected sheets: a gold outline round each (the parts under other sheets stay hidden, as the sheets do)
  ARR.ssel ||= [];
  const ids = V.arrange ? [...V.sel].filter(id => V.layout.centers.has(id) && !ARR.drag?.ids.includes(id)) : [];
  while (ARR.ssel.length < ids.length) { const l = new THREE.Line(RECT, new THREE.LineBasicMaterial({ color: GOLD })); l.rotation.x = -Math.PI / 2; scene.add(l); ARR.ssel.push(l); }
  ARR.ssel.forEach((l, i) => {
    const id = ids[i]; l.visible = !!id && !settling; if (!id) return;
    const c = V.layout.centers.get(id);
    l.position.set(c.x, c.y + 1.4, c.z); l.scale.set(sheetWidth(id) + 3, H + 3, 1);
  });
  // dragging: a gold wash under the pile they would go into, or a gold bar in the gap a new quire would fill
  ARR.hl ||= flatGold(.2, 1);
  ARR.ins ||= flatGold(.85, 0);
  const tp = t?.kind === "into" && piles.find(x => x.key === t.key);
  ARR.hl.visible = !!tp;
  if (tp) { ARR.hl.position.set(tp.x0 + tp.w / 2, .4, (tp.z0 + tp.z1) / 2); ARR.hl.scale.set(tp.w + 18, tp.d + 18, 1); }
  ARR.ins.visible = t?.kind === "new";
  if (t?.kind === "new") { ARR.ins.position.set(t.x, .5, t.z); ARR.ins.scale.set(5, t.depth, 1); }
  if (ARR.drag) hud(null, t || null);
  // these marks are set after the frame was drawn: if one changed, draw another, or it shows only when something moves
  const r = m => m ? `${+m.visible}${m.position.x.toFixed(1)},${m.position.z.toFixed(1)},${m.scale.x.toFixed(1)}` : "";
  const drawn = [ARR.tray, ARR.hl, ARR.ins, ...ARR.qsel, ...(ARR.ssel || [])].map(r).join("|");
  if (drawn !== ARR.drawn) { ARR.drawn = drawn; wake(); }
}

/* A pile drawn small at the table's slant, for the panel and the selection's bar: a stack of layers (the outermost at
   the bottom) or a row of cards, the sheets in `hi` in gold. `labels`: name each layer (in a fan, only the gold ones). */
function glyph(ids, { fan = false, hi = new Set(), labels = false, size = "s" } = {}) {
  const NS = "http://www.w3.org/2000/svg", el = (tag, at) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); return e; };
  const pair = x => x.replace("|", "+");
  const [W, D, S, G] = size === "s" ? [30, 7, 9, 6] : [54, 14, 16, 12];
  const svg = el("svg", { "aria-hidden": "true", class: `glyph ${size}` });
  const card = (x0, y, gold) => el("polygon", { points: `${x0},${y} ${x0 + W},${y} ${x0 + W + S},${y - D} ${x0 + S},${y - D}`, class: gold ? "g-hi" : "g-sh" });
  const text = (x, y, s, gold) => { const t = el("text", { x, y, class: gold ? "g-thi" : "g-t" }); t.textContent = s; return t; };
  const lw = labels ? 10 + 6.4 * Math.max(0, ...ids.map(x => pair(x).length)) : 0;
  if (fan || ids.length <= 1) {
    const step = ids.length > 1 ? Math.min(size === "s" ? 9 : 20, (size === "s" ? 70 : 190) / (ids.length - 1)) : 0;
    const lift = size === "s" ? 5 : 9, w = W + S + step * Math.max(0, ids.length - 1) + 4, hh = D + lift + 4 + (labels ? 16 : 0);
    svg.setAttribute("width", w); svg.setAttribute("height", hh); svg.setAttribute("viewBox", `0 0 ${w} ${hh}`);
    ids.forEach((x, j) => svg.append(card(2 + j * step, D + lift + 2 - (hi.has(x) ? lift : 0), hi.has(x))));
    if (labels) ids.forEach((x, j) => hi.has(x) && svg.append(text(2 + j * step, hh - 2, pair(x), true)));
  } else {
    const n = ids.length, g = Math.min(G, (size === "s" ? 26 : 120) / (n - 1)), w = W + S + 4 + lw, shift = size === "s" ? 5 : 9, hh = D + g * (n - 1) + 4;
    svg.setAttribute("width", w + shift); svg.setAttribute("height", hh); svg.setAttribute("viewBox", `0 0 ${w + shift} ${hh}`);
    ids.forEach((x, j) => {   // bottom (outermost) first, so each layer lies over the one under it
      const y = hh - 2 - j * g, gold = hi.has(x);
      svg.append(card(2 + (gold ? shift : 0), y, gold));
      if (labels && (gold || g >= 10)) svg.append(text(W + S + 10 + shift, y - D / 2 + 3.5, pair(x), gold));
    });
  }
  return svg;
}

/* On the table, one panel in a fixed place (top left, a column of its own): the sheet pointed at (its place in its
   pile, and both its sides in one piece), or, while sheets are dragged, where they would land. Hidden otherwise. */
const HUD_W = 300;
const hudW = () => (stage.clientWidth > 1000 ? HUD_W : 220);   // a narrower panel (and column) in a small window
function hud(en, drop) {
  const el = $("#v3-hud"); if (!el) return;
  if (!V.arrange) { clearTimeout(ARR.hudT); ARR.hudT = 0; el.hidden = true; el._k = ""; return; }
  const show = (k, kids) => { clearTimeout(ARR.hudT); ARR.hudT = 0; el.hidden = false; el.style.maxWidth = stage.contains(el) ? hudW() + "px" : "";
    if (el._k !== k) { el._k = k; el.replaceChildren(...kids); } };
  // after a moment (sliding from one sheet to the next doesn't flicker); a hide on its way isn't put off by more calls
  const hide = () => { if (!ARR.hudT && !el.hidden) ARR.hudT = setTimeout(() => { ARR.hudT = 0; el.hidden = true; el._k = ""; }, 140); };
  const name = (key, q) => key === "aside" ? "Set aside" : qTag(q);
  if (ARR.drag) {
    if (!drop) return hide();
    const moving = ARR.drag.ids, set = new Set(moving);
    const froms = new Set(moving.map(id => { const x = V.model.all.find(en => en.id === id); return x?.unplaced ? "aside" : String(x?.quire); }));
    const from = V.model.all.find(x => x.id === ARR.drag.id), fromKey = froms.size === 1 ? [...froms][0] : null;
    const src = fromKey ? h("b", {}, name(fromKey, from?.quire)) : `${moving.length} sheets`;
    if (drop.kind === "new")
      return show(`new:${drop.after}:${moving}`, [h("div", { class: "hud-head" }, src, " → ", h("b", {}, "new quire")),
        glyph(moving, { hi: set, labels: true, size: "m" })]);
    const p = V.layout.piles.find(x => x.key === drop.key), ids = p.ids.slice();
    ids.splice(drop.index, 0, ...moving);
    return show(`into:${drop.key}:${drop.index}:${moving}`, [
      fromKey !== drop.key ? h("div", { class: "hud-head" }, src, " → ", h("b", {}, name(drop.key, p.quire))) : "",
      glyph(ids, { fan: p.fan, hi: set, labels: true, size: "m" })].filter(Boolean));
  }
  if (!en) return hide();
  const p = V.layout?.piles.find(x => x.key === (en.unplaced ? "aside" : String(en.quire)));
  const ids = p ? p.ens.map(x => x.id) : [en.id];
  show(`sheet:${en.id}:${JSON.stringify(en.opts)}:${ids}`, [
    h("div", { class: "hud-where", role: "img", "aria-label": `${en.unplaced ? "" : qWord(en.quire) + ", "}${whereText(en)}` },
      glyph(ids, { fan: p?.fan, hi: new Set([en.id]) }), h("span", {}, en.unplaced ? "Set aside" : qTag(en.quire))),
    h("div", { class: "hud-id" }, en.id.replace("|", " + ")),
    h("div", { class: "hud-faces" }, sheetFaces(en.id, en.opts, 110, (stage.contains(el) ? hudW() : HUD_W) - 30, 150, { side: true }))]);
}

/* The sheet under the pointer (`e`: anything with clientX, clientY). On the table it slides a little out of its pile and the
   stack it is in opens out, which moves the sheets under a pointer that stays still: once they have moved, look again
   (up to `again` times), so the sheet the panel shows is always the one a click would take. */
function pointAt(e, again = 0) {
  const hit = pick(e);
  const en = hit?.en || null;
  if (en !== V.hover) {
    V.hover = en; tint(); stage.style.cursor = en ? (V.arrange ? "grab" : "pointer") : "";
    const pile = en ? (en.unplaced ? "aside" : String(en.quire)) : null;
    if (V.arrange && pile !== V.hoverPile && (pile || !hoverNear(e))) V.hoverPile = pile;   // leaving a stack's edge for the table: close it
    if (V.arrange && !(TW.on && TW.long)) {
      if (again > 0) ARR.recheck = { clientX: e.clientX, clientY: e.clientY, again: again - 1 };
      relayout(REDUCED ? 0 : 160);   // the sheet pointed at slides a little out of its pile
    }
  } else if (V.arrange && !en && V.hoverPile && !hoverNear(e)) { V.hoverPile = null; relayout(REDUCED ? 0 : 160); }
  tip(en, e, hit?.mesh);
}

/* Whether the pointer is still over the open stack's room (between its sheets' edges the table shows through). */
function hoverNear(e) {
  const p = V.layout?.piles?.find(x => x.key === V.hoverPile); if (!p) return false;
  const r = stage.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const P = ray.ray.intersectPlane(TABLE, new THREE.Vector3());
  return !!P && P.x > p.x0 - 4 && P.x < p.x0 + p.w + 4 && P.z > p.z0 - 4 && P.z < p.z1 + 4;
}

/* Sheets taken from the table follow the pointer above it, fanned a little if there are several; the pile under them
   opens where they would go, or the gap between two piles shows a gold bar for a new quire. */
function dragSheet(e, en) {
  if (!ARR.drag) {
    const ids = Arrange.dragSet(en.id);   // the selection, if this sheet is in it; else this sheet alone (now selected)
    ARR.drag = { id: en.id, ids, gs: new Map() }; V.hover = null; tip(null); stage.classList.add("lifting");
    if (ARR.grow) growDone();   // the last ones let go are full size at once
    for (const id of ids) V.objs.get(id)?.group.scale.setScalar(.5);   // small in the hand, so they don't hide where they go
  }
  const r = stage.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const P = ray.ray.intersectPlane(TABLE, new THREE.Vector3()); if (!P) return;
  const inv = V.layout.place.matrix.clone().invert(), flat = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  ARR.drag.ids.forEach((id, j) => {
    const o = V.objs.get(id), wl = o.leaves[0].w || 0, wr = o.leaves[1].w || 0;
    const world = new THREE.Matrix4().makeTranslation(P.x + (wl - wr) / 4 + j * 5, ARR_LIFT + j * 2, P.z + H / 4 - j * 4).multiply(flat);
    const m = inv.clone().multiply(world), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    m.decompose(p, q, sc);
    ARR.drag.gs.set(id, { p, q });
  });
  const t = dropTarget(P, e), k = t ? `${t.kind}:${t.key ?? t.after}:${t.index ?? ""}` : "";
  if (k !== ARR.gapKey) { ARR.gap = t; ARR.gapKey = k; relayout(REDUCED ? 0 : 180); }
  for (const [id, g] of ARR.drag.gs) { CUR.sg.set(id, g); V.layout.sg.set(id, g); if (TW.on) TW.sgs.set(id, [[0, g], [1, g]]); }
  applyAll(); placePiles(); wake();
}
/* Where dragged sheets would go: the gap between two piles of a row (or past either end of it) makes a new quire
   there; over a pile, into it: for a stack, at the height of the pointer against its sheets' edges, for a fan, as far
   along as the pointer. */
function dropTarget(P, e) {
  const piles = V.layout?.piles; if (!piles) return null;
  const order = piles.filter(p => p.key !== "aside");
  const EDGE = H * .12, END = H * 1.1;
  for (const row of rowsOf(piles)) {
    const z0 = Math.min(...row.map(p => p.z0)) - H * .15, z1 = Math.max(...row.map(p => p.z1)) + H * .2;
    if (P.z < z0 || P.z > z1) continue;
    for (let j = 0; j <= row.length; j++) {
      const a = row[j - 1], b = row[j];
      const left = a ? a.x0 + a.w - EDGE : b.x0 - END, right = b ? b.x0 + EDGE : a.x0 + a.w + END;
      if (P.x <= left || P.x >= right) continue;
      // the new quire comes after the quire on the left (or, at the start of a row, after the one before it)
      const prev = a?.key === "aside" ? order.at(-1) : a || order[order.indexOf(b) - 1] || (b?.key === "aside" ? order.at(-1) : null);
      const x = a && b ? (a.x0 + a.w + b.x0) / 2 : a ? a.x0 + a.w + GX / 2 : b.x0 - GX / 2;
      return { kind: "new", after: prev ? prev.key : null, x, z: (z0 + z1) / 2, depth: z1 - z0 };
    }
  }
  const m = H * .3;
  const p = piles.find(q => P.x > q.x0 - m && P.x < q.x0 + q.w + m && P.z > q.z0 - m * 2 && P.z < q.z1 + m);
  if (!p) return null;
  let index;
  if (p.fan) index = p.anchors.filter(a => a.x < P.x).length - 1;
  else {
    const r = stage.getBoundingClientRect(), y = e.clientY - r.top;
    index = p.anchors.filter(a => { const xy = project(a, scene); return xy && xy[1] > y; }).length - 1;
  }
  return { kind: "into", key: p.key, gi: p.gi, index: clamp(index, 0, p.ids.length), ids: p.ids };
}
function dropSheet(cancel = false) {
  const d = ARR.drag, t = ARR.gap;
  ARR.drag = ARR.gap = null; ARR.gapKey = "";
  stage.classList.remove("lifting");
  placePiles(); hud(null);
  if (!d) return;
  const done = !cancel && t && (t.kind === "new" ? Arrange.newQuireAt(d.ids, t.after) : Arrange.dropAt(d.ids, t.key, t.ids, t.index));
  if (!done) relayout(REDUCED ? 0 : 380);   // nowhere, or where they were: back they go
  // they grow back to their size as they land (tweenStep), not all at once
  if (TW.on && TW.dur) ARR.grow = d.ids; else growDone(d.ids);
}
function growDone(ids = ARR.grow || []) {
  const held = new Set(ARR.drag?.ids || []);
  for (const id of ids) if (!held.has(id)) V.objs.get(id)?.group.scale.setScalar(1);
  ARR.grow = null;
}

/* Drag across empty table: a box, and every sheet whose middle is in it is selected (with ⇧, ⌘ or Ctrl, added). */
function marquee(e, end = false) {
  const box = $("#v3-marquee"), r = stage.getBoundingClientRect();
  const x0 = DRAG.downAt.x - r.left, y0 = DRAG.downAt.y - r.top, x1 = e.clientX - r.left, y1 = e.clientY - r.top;
  const [l, t, rr, b] = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
  Object.assign(box.style, { left: l + "px", top: t + "px", width: rr - l + "px", height: b - t + "px" });
  box.hidden = end;
  const ids = [];
  for (const [id, c] of V.layout?.centers || []) { const xy = project(c, scene); if (xy && xy[0] >= l && xy[0] <= rr && xy[1] >= t && xy[1] <= b) ids.push(id); }
  Arrange.marquee(ids, DRAG.add, end);
}

// ---------------------------------------------------------------- input
const DRAG = { on: false, id: null, x: 0, y: 0, moved: false, mode: "orbit", pts: new Map(), pinch: 0 };
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let live = [];   // the pickable meshes of the sheets in this order
function pick(e) {
  const r = stage.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera); ray.far = Infinity;
  const hit = ray.intersectObjects(live.filter(shown), false)[0];
  return hit ? { en: hit.object.userData.sheet.entry, point: hit.point, mesh: hit.object } : null;
}
function isLive(m) { let o = m; while (o && o !== book) o = o.parent; return !!o; }
function shown(m) { let o = m; while (o && o !== book) { if (!o.visible) return false; o = o.parent; } return !!o; }
function pixelWorld() { return 2 * Math.tan(camera.fov / 2 * DEG) * CAM.dist / stage.clientHeight; }
function orbitBy(dx, dy) { setGoal({ yaw: CAM.goal.yaw - dx * .32, pitch: CAM.goal.pitch + dy * .26 }, 14); V.preset = null; renderViews(); }
function panBy(dx, dy) {
  const f = camDir(CAM.yaw, CAM.pitch), right = new THREE.Vector3(0, 1, 0).cross(f).normalize(), up = f.clone().cross(right);
  const k = pixelWorld();
  const t = CAM.goal.target.clone().addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
  setGoal({ target: t }, 14); V.preset = null; renderViews();
}
function zoomBy(f, e) {
  const nd = clamp(CAM.goal.dist * f, H * .35, H * 160);
  let t = null;
  if (e) {   // toward the point under the pointer
    const hit = pick(e);
    let p = hit?.point;
    if (!p) { const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CAM.goal.target.y); p = ray.ray.intersectPlane(pl, new THREE.Vector3()); }
    if (p && p.distanceTo(CAM.goal.target) < CAM.goal.dist * 4) t = CAM.goal.target.clone().lerp(p, 1 - nd / CAM.goal.dist);
  }
  setGoal({ dist: nd, target: t }, 12);
  if (V.preset) { V.preset = null; renderViews(); }
}

function wire() {
  const cv = renderer.domElement;
  cv.addEventListener("contextmenu", e => {
    e.preventDefault();
    if (V.arrange) { const hit = pick(e); Arrange.context(e.clientX, e.clientY, hit?.en.id || null); }
  });
  // Space held: drag pans the table (as in drawing programs)
  addEventListener("keydown", e => { if (V.arrange && e.key === " " && !e.target.closest?.("input, textarea, button, select")) { ARR.space = true; stage.classList.add("panning"); e.preventDefault(); } });
  addEventListener("keyup", e => { if (e.key === " ") { ARR.space = false; stage.classList.remove("panning"); } });
  cv.addEventListener("pointerdown", e => {
    DRAG.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { cv.setPointerCapture(e.pointerId); } catch { /* gone */ }
    if (DRAG.pts.size === 2) { DRAG.mode = "pinch"; DRAG.pinch = 0; return; }
    DRAG.on = true; DRAG.moved = false; DRAG.x = e.clientX; DRAG.y = e.clientY; DRAG.downAt = { x: e.clientX, y: e.clientY };
    DRAG.mode = e.button === 2 || e.button === 1 || e.shiftKey ? "pan" : "orbit";
    if (V.arrange) {   // on the table: a sheet is taken, empty table draws a box; the middle button or Space+drag pans
      if (e.button === 2) { DRAG.on = false; return; }   // the context menu (below)
      const hit = e.button === 0 && !ARR.space ? pick(e) : null;
      DRAG.en = hit?.en || null; DRAG.add = e.shiftKey || e.metaKey || e.ctrlKey;
      DRAG.mode = e.button === 1 || ARR.space ? "pan" : DRAG.en ? "sheet" : "marquee";
    }
    tip(null);
    stage.classList.add("dragging");
  });
  cv.addEventListener("pointermove", e => {
    if (DRAG.pts.has(e.pointerId)) DRAG.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (DRAG.mode === "pinch" && DRAG.pts.size === 2) {
      const [a, b] = [...DRAG.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (DRAG.pinch) { zoomBy(DRAG.pinch / d); panBy(cx - DRAG.cx, cy - DRAG.cy); }
      DRAG.pinch = d; DRAG.cx = cx; DRAG.cy = cy; DRAG.moved = true;
      return;
    }
    if (DRAG.on) {
      const dx = e.clientX - DRAG.x, dy = e.clientY - DRAG.y;
      DRAG.x = e.clientX; DRAG.y = e.clientY;
      if (Math.hypot(e.clientX - DRAG.downAt.x, e.clientY - DRAG.downAt.y) > 4) DRAG.moved = true;
      if (!DRAG.moved) return;
      if (DRAG.mode === "sheet") dragSheet(e, DRAG.en);
      else if (DRAG.mode === "marquee") marquee(e);
      else if (DRAG.mode === "pan") panBy(dx, dy); else orbitBy(dx, dy);
      return;
    }
    ARR.recheck = null;
    pointAt(e, 2);
  });
  const up = e => {
    DRAG.pts.delete(e.pointerId);
    if (DRAG.mode === "pinch") { if (!DRAG.pts.size) DRAG.mode = "orbit"; DRAG.on = false; stage.classList.remove("dragging"); return; }
    if (!DRAG.on) return;
    DRAG.on = false; stage.classList.remove("dragging");
    if (DRAG.mode === "sheet" && DRAG.moved) { dropSheet(e.type === "pointercancel"); return; }
    if (DRAG.mode === "marquee" && DRAG.moved) { marquee(e, true); return; }
    if (DRAG.moved) return;
    const hit = pick(e);
    if (V.arrange) { Arrange.click(hit?.en.id || null, e); return; }   // on the table: select (no inspector)
    if (!hit) return;
    clearTimeout(DRAG.click);
    const i = V.model.all.indexOf(hit.en);
    const fold = V.hand.on && i === V.cur ? foldOf(hit.mesh) : null;   // a flap of the sheet in hand: fold or unfold it
    DRAG.click = setTimeout(() => fold ? toggleFold(fold.k, fold.i) : selectSheet(i), 230);
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("pointerleave", () => { ARR.recheck = null; if (!DRAG.on && (V.hover || V.hoverPile)) { V.hover = null; V.hoverPile = null; tint(); if (V.arrange) relayout(160); } tip(null); });
  cv.addEventListener("dblclick", e => {
    if (V.arrange) return;   // on the table a double click is two clicks
    clearTimeout(DRAG.click);
    const hit = pick(e);
    if (hit) readSheet(hit.en);
  });
  cv.addEventListener("wheel", e => {
    e.preventDefault();
    if (V.arrange && !e.ctrlKey && !e.metaKey) {   // on the table, as in drawing programs: scroll pans, pinch or ⌘ zooms
      const k = e.deltaMode === 1 ? 16 : 1;
      panBy(-e.deltaX * k, -e.deltaY * k); tip(null); return;
    }
    const d = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    zoomBy(Math.exp(d * (e.ctrlKey ? .012 : .0022)), e);
    tip(null);
  }, { passive: false });
  new ResizeObserver(resize).observe(stage);
}

// ---------------------------------------------------------------- page furniture
function renderBar() {
  const rp = $("#v3-replay"); if (rp) rp.disabled = !V.prevOrder;
  $("#v3-contacts")?.classList.toggle("on", V.contact.on);
  for (const b of $$("#v3-posture button")) b.classList.toggle("on", b.dataset.v === V.posture);
  for (const b of $$("#v3-mode button")) b.classList.toggle("on", b.dataset.v === V.mode);
  $("#v3-spread-wrap").classList.toggle("dim", V.mode === "opening");
  $("#v3-opening").hidden = V.mode !== "opening";
}
function renderViews() {
  for (const b of $$("#v3-views button[data-n]")) b.classList.toggle("on", +b.dataset.n === V.preset);
}
function renderNote() {
  const n = $("#v3-note");
  if (V.preset === 3) {
    n.hidden = false; n.innerHTML = "";
    n.append(V.posture === "stand" ? "Head edge: nested sheets read as nested chevrons, fold at the top. This is the quire diagram in 3D. "
      : "Head edge, seen across the desk. ", h("button", { onclick: () => showFolios() }, "Open Folio order →"));
  } else if (V.preset === 2) {
    n.hidden = false; n.innerHTML = "";
    n.append("Spine: one rounded fold per gathering. A nested quire wraps its sheets in one fold; each singulion has its own. The dashed red line marks where each gathering is sewn, through its centre fold (schematic: no sewing stations are recorded).");
  } else n.hidden = true;
  showThreads(V.preset === 2);
}
function renderOpening() {
  const el = $("#v3-opening"); if (!el || V.mode !== "opening" || !V.order) return;
  const pages = linearize(V.order, { ghosts: true });
  const L = pages[2 * V.opening - 1], R = pages[2 * V.opening];
  const lbl = p => p ? facesOf(p, V.order).map(f => f.label.replace(PART, "")).join(" · ") : "cover";   // a folded foldout can show several faces
  $("#v3-open-lbl").textContent = `${lbl(L)} | ${lbl(R)}`;
}
function renderStrip() {
  const el = $("#v3-strip"); if (!el || !V.model) return;
  if (el._order !== V.order.id) {
    el._order = V.order.id; el.innerHTML = "";
    let q = null, grp = null;
    V.model.all.forEach((en, i) => {
      const qk = en.unplaced ? "aside" : en.quire;
      if (qk !== q) {
        q = qk;
        grp = h("div", { class: "v3-sq" }, h("button", { class: "v3-qb", "data-q": en.unplaced ? "" : String(en.quire), title: en.unplaced ? "Sheets this order leaves out of the book" : qWord(en.quire),
          onclick: () => { if (V.mode === "opening") setMode("block", { view: false }); setCur(i); } }, en.unplaced ? (V.order.mine ? "aside" : "lost") : qTag(en.quire)));
        el.append(grp);
      }
      const lost = en.sheet.missing.every(Boolean), fold = !lost && (en.sheet.inside[0].length > 2 || en.sheet.inside.length > 1);   // a foldout stands taller
      grp.append(h("button", { class: `v3-tick${lost ? " lost" : ""}${en.moved ? " moved" : ""}${en.resewn ? " resewn" : ""}${fold ? " fold" : ""}`, "data-i": i,
        title: `${en.id}${en.moved ? " • moved" : en.resewn ? " ○ re-sewn" : ""}${lost ? " (lost)" : ""}${fold ? " · foldout" : ""}`, "aria-label": `Sheet ${en.id}${fold ? ", a foldout" : ""}`,
        onclick: () => { if (V.mode === "opening") setMode("block", { view: false }); setCur(i); } }));
    });
  }
  for (const b of $$(".v3-tick", el)) b.classList.toggle("cur", +b.dataset.i === V.cur);
  const c = $(`.v3-tick[data-i="${V.cur}"]`, el);
  c?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  $("#v3-title").textContent = V.order.title;
  marks();
}

/* Where each gathering is sewn: through the fold of its innermost sheet, and out across the spine. The line runs
   along the outermost fold (shapeFold keeps it on the apex). Schematic: no sewing stations are recorded. */
function showThreads(on) {
  V.threads = on;
  // drawn on the outside of each gathering's outermost fold, where it shows from behind
  const inner = new Set(on && V.model ? V.model.gathers.map(g => g.leaves[0].e.id) : []);
  for (const o of V.cache.values()) {
    const want = inner.has(o.id) && V.objs.get(o.id) === o;
    if (want && !o.thread) {
      o.thread = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, H, 0)]), M.thread);
      o.thread.frustumCulled = false;
      o.group.add(o.thread);
    }
    if (o.thread) o.thread.visible = want;
    if (want) shapeFold(o, o.id);
  }
  wake();
}

function build() {
  const v = $("#v-three");
  v.innerHTML = "";
  const seg = (id, label, items, on) => h("div", { class: "v3-seg", id, role: "group", "aria-label": label },
    items.map(([val, text, title]) => h("button", { "data-v": val, title, onclick: () => on(val) }, text)));
  v.append(
    h("div", { class: "v3-bar" },
      h("span", { class: "v3-title", id: "v3-title" }),
      h("span", { class: "v3-morph" },
        h("button", { id: "v3-replay", title: "Replay the change from the last order to this one (R)", onclick: () => replay() }, "↻ Replay"),
        h("button", { id: "v3-slow", class: V.slow ? "on" : "", title: "Play order changes in slow motion",
          onclick: e => { V.slow = !V.slow; store.set("3d:slow", V.slow); e.currentTarget.classList.toggle("on", V.slow); } }, "Slow")),
      seg("v3-posture", "Posture", [["stand", "Standing", "The book stands on its tail, fore-edge toward you (P)"], ["lie", "Lying", "The book lies on the desk (P)"]], setPosture),
      seg("v3-mode", "Mode", [["block", "Block", "The book block; use Spread to open it (M)"], ["opening", "Opening", "Open the book at an opening, as in the Reader (M)"]], m => setMode(m)),
      h("label", { class: "v3-spread", id: "v3-spread-wrap", title: "Spread: from the closed book to every sheet pulled apart ([ ])" }, "Spread",
        h("input", { type: "range", id: "v3-spread", min: 0, max: 100, step: 1, value: Math.round(V.spread * 100), "aria-label": "Spread",
          oninput: e => setSpread(+e.target.value / 100) }),
        h("span", { class: "v3-sn", id: "v3-spread-name" }, spreadName(V.spread))),
      h("span", { class: "v3-opening", id: "v3-opening", hidden: true },
        h("button", { "aria-label": "Previous opening", title: "Previous opening (←)", onclick: () => setOpening(V.opening - 1) }, "‹"),
        h("span", { id: "v3-open-lbl" }),
        h("button", { "aria-label": "Next opening", title: "Next opening (→)", onclick: () => setOpening(V.opening + 1) }, "›")),
      h("label", { class: "v3-colour", title: "Colour the sheet edges and folds (V)" }, "Colour",
        (() => { const s2 = h("select", { id: "v3-overlay", "aria-label": "Colour the edges by", onchange: e => setOverlay(e.target.value) },
          OVERLAY_KEYS.map(k2 => h("option", { value: k2 }, OVERLAYS[k2].name))); s2.value = V.overlay; return s2; })()),
      h("button", { id: "v3-contacts", title: "Faces that lay against each other when the book was closed (K)", onclick: () => setContactView(!V.contact.on) }, "Touching faces"),
      h("button", { id: "v3-lost", class: V.hideLost ? "on" : "", "aria-pressed": String(V.hideLost), title: "Leave the lost sheets out of the 3D book (L)", onclick: () => setHideLost(!V.hideLost) }, "Hide lost sheets"),
      h("button", { id: "v3-arr-btn", class: `v3-arr-btn${Arrange.on ? " on" : ""}`, title: "Put the sheets in your own order (A)", onclick: () => Arrange.toggle() }, "✎ Rearrange"),
      h("label", { class: "v3-thick", title: "Sheet thickness. Real vellum is too thin to see the structure, so it is exaggerated." }, "Thickness",
        (() => { const s = h("select", { "aria-label": "Sheet thickness", onchange: e => setThick(+e.target.value) },
          [1, 2, 4, 8].map(x => h("option", { value: x }, x === 1 ? "true (×1)" : `×${x}`))); s.value = V.thick; return s; })()),
      h("div", { class: "v3-views", id: "v3-views", role: "group", "aria-label": "Views" },
        PRESETS.slice(1).map((p, i) => h("button", { "data-n": i + 1, title: `${p.name} (${p.key})`, onclick: () => preset(i + 1) }, h("kbd", {}, p.key), h("span", { class: "vn" }, " " + p.name))),
        h("button", { title: "Reset view (0)", "aria-label": "Reset view", onclick: () => preset(1) }, "⟲"))),
    h("div", { class: "v3-body" },
    stage = h("div", { class: "v3-stage", id: "v3-stage" },
      labelsEl = h("div", { class: "v3-labels", "aria-hidden": "true" }),
      h("div", { class: "v3-piles", id: "v3-piles", "aria-label": "Quires on the table" }),   // Rearrange: the piles' names
      h("div", { class: "v3-arr-acts", id: "v3-arr-acts", hidden: true }),                  // and the picked sheet's buttons
      h("div", { class: "v3-hud", id: "v3-hud", hidden: true }),                              // and a panel: the sheet pointed at, or where dragged ones would go
      h("div", { class: "v3-marquee", id: "v3-marquee", hidden: true }),                      // and the box drawn to select sheets
      tipEl = h("div", { class: "v3-tip", hidden: true }),
      h("div", { class: "v3-note", id: "v3-note", hidden: true }),
      h("div", { class: "v3-legend", id: "v3-legend", hidden: true }),
      h("div", { class: "v3-contact", id: "v3-contact", hidden: true, role: "group", "aria-label": "Touching faces" }),
      store.get("3d:hinted", false) ? "" : h("div", { class: "v3-hint", id: "v3-hint" },
        h("span", {}, "Drag to turn the book · ⇧-drag to pan · scroll to zoom · ", h("kbd", {}, "1"), "–", h("kbd", {}, "5"), " views · ", h("kbd", {}, "←"), h("kbd", {}, "→"), " thumb through · double-click to read"),
        h("button", { onclick: () => { store.set("3d:hinted", true); $("#v3-hint").remove(); } }, "Got it")),
      // after the hint, so that it can stand clear of it (style.css)
      h("button", { class: "v3-fold", id: "v3-fold", hidden: true, onclick: () => unfoldHere() })),
      h("aside", { class: "v3-insp", id: "v3-insp", hidden: true, "aria-label": "Sheet inspector" }),
      h("aside", { class: "v3-list", id: "v3-list", hidden: true, "aria-label": "Quires and their sheets, as a list" })),   // Rearrange's list (arrange.js)
    h("section", { class: "v3-arrange", id: "v3-arrange", hidden: true, "aria-label": "Rearrange the sheets" }),
    h("div", { class: "v3-strip", id: "v3-strip", title: "Every sheet in reading order. Scroll here to thumb through the book.",
      onwheel: e => { e.preventDefault(); const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; STRIP.acc += d;
        if (Math.abs(STRIP.acc) > 40) { if (V.mode === "opening") setOpening(V.opening + Math.sign(STRIP.acc)); else step(Math.sign(STRIP.acc)); STRIP.acc = 0; } } }));
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  } catch (err) {
    V.gl = false;
    stage.append(h("div", { class: "v3-nogl" }, "This browser cannot draw WebGL, which the 3D book needs. ",
      h("button", { onclick: () => show("read") }, "Reader"), " and ", h("button", { onclick: () => showFolios() }, "Folio order (in Info)"), " show the same sheets."));
    V.built = true;
    return;
  }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  stage.prepend(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x221e1a);
  scene.fog = new THREE.Fog(0x221e1a, 800, 4000);
  camera = new THREE.PerspectiveCamera(32, 1, 1, 10000);
  // light intensities are physical (a Lambert face lit at intensity π shows its full colour)
  scene.add(new THREE.HemisphereLight(0xfff3df, 0x4a3c30, 2.7));
  const sun = new THREE.DirectionalLight(0xfff1e0, 2.3); sun.position.set(-0.5, 1.4, 1.1); scene.add(sun);
  const back = new THREE.DirectionalLight(0xe8e0ff, .8); back.position.set(.6, .4, -1); scene.add(back);
  table = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshLambertMaterial({ color: 0x3a3129 }));
  table.rotation.x = -Math.PI / 2; scene.add(table);
  // a soft contact shadow under the book
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const cx = cv.getContext("2d"), gr = cx.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, "rgba(0,0,0,.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  book = new THREE.Group(); scene.add(book);
  makeMaterials();
  wire();
  V.built = true;
  resize();
}
const STRIP = { acc: 0 };

// ---------------------------------------------------------------- the view in the URL
/* #three/<order>/s=77-82&m=o&o=34&v=3&sp=32&c=scribe&p=l&th=8&i=1&k=1, so a view can be bookmarked or sent. */
function state() {
  if (!V.model) return "";
  const en = V.model.all[V.cur], q = new URLSearchParams();
  if (en) q.set("s", en.id.replace("|", "-"));
  if (V.mode === "opening") { q.set("m", "o"); q.set("o", V.opening); }
  if (V.preset) q.set("v", V.preset);
  q.set("sp", Math.round(V.spread * 100));
  if (V.overlay !== "none") q.set("c", V.overlay);
  if (V.posture === "lie") q.set("p", "l");
  if (V.thick !== 4) q.set("th", V.thick);
  if (V.inspect) q.set("i", 1);
  if (V.contact.on) q.set("k", 1);
  return q.toString();
}
let hashTimer;
function pushHash() { clearTimeout(hashTimer); hashTimer = setTimeout(() => { if (S.view === "three") setHash(); }, 250); }
function restore(str) {
  if (!V.model || !str) return;
  const q = new URLSearchParams(str);
  if (q.has("sp")) V.spread = clamp(+q.get("sp") / 100 || 0);
  if (q.has("th") && [1, 2, 4, 8].includes(+q.get("th"))) V.thick = +q.get("th");
  if (q.has("p")) V.posture = q.get("p") === "l" ? "lie" : "stand";
  if (q.has("c") && OVERLAYS[q.get("c")]) V.overlay = q.get("c");
  if (q.has("s")) { const i = V.model.all.findIndex(e => e.id === q.get("s").replace("-", "|")); if (i >= 0) V.cur = i; }
  V.mode = q.get("m") === "o" ? "opening" : "block";
  if (q.has("o")) V.opening = clamp(+q.get("o") || 0, 0, V.model.leaves.length);
  V.inspect = q.get("i") === "1";
  if (q.has("v")) V.preset = clamp(+q.get("v") || 1, 1, 5);
  const r = $("#v3-spread"); if (r) r.value = Math.round(V.spread * 100);
  $("#v3-spread-name").textContent = spreadName(V.spread);
  $("#v3-overlay").value = V.overlay;
  $(".v3-thick select").value = V.thick;
  renderBar(); renderOpening(); renderStrip(); renderInspector(); renderLegend();
  relayout(0);
  preset(V.preset || 1, { instant: true });
  tint();
  if (q.get("k") === "1") setContactView(true); else if (V.contact.on) setContactView(false);
  report();
}

// ---------------------------------------------------------------- order morph
/* When the order changes, every sheet goes from its old slot to its new one. Sheets that change slot lift, travel
   over the block and drop in, in the reading order of where they land. Sheets whose leaves only regroup (nested
   quire to singulions) rise a little, quire by quire. A sheet sewn or folded differently rises, changes its folding
   at the top and settles. */
/* `focus` (a rearranging step): only the sheets named lift and travel; every other sheet slides into its new place. */
function morphFrom(prev, focus) {
  const F = focus ? new Set(focus) : null;
  return (tw, L) => {
    const model = V.model;
    const oldN = new Map(prev.model.leaves.map(x => [x.key, x.n])), newN = new Map(model.leaves.map(x => [x.key, x.n]));
    const was = new Map(prev.model.all.map(e => [e.id, e]));
    const slot = en => { const p = was.get(en.id); return !p || !!p.unplaced !== !!en.unplaced || p.quire !== en.quire || p.idx !== en.idx; };
    const movers = F ? model.all.filter(en => F.has(en.id)) : model.all.filter(slot);
    const Q = Math.max(1, model.quires.length - 1);
    book.updateMatrixWorld();
    for (const en of model.all) {
      const keys = [`${en.id}:0`, `${en.id}:1`];
      const oldObj = prev.objs.get(en.id), newObj = V.objs.get(en.id);
      if (oldObj && oldObj !== newObj) {
        /* The same sheet sewn or folded another way. It rises a little, still folded, takes its new folding at the top
           and settles into its place. (Opening it flat in the air first looked chaotic for the big foldouts.) */
        const a0 = CUR.poses.get(keys[0]), a1 = CUR.poses.get(keys[1]);
        const b0 = L.poses.get(keys[0]), b1 = L.poses.get(keys[1]);
        if (!a0 || !a1 || !b0 || !b1) continue;
        const up = p => ({ ...p, lift: p.lift + .45 * H });
        const sg0 = CUR.sg.get(en.id) || IDENT, sg1 = L.sg.get(en.id) || IDENT;
        tw.poses.set("old:" + keys[0], [[0, a0], [.42, up(a0)], [1, up(a0)]]);
        tw.poses.set("old:" + keys[1], [[0, a1], [.42, up(a1)], [1, up(a1)]]);
        tw.sgs.set("old:" + en.id, [[0, sg0], [1, sg0]]);
        tw.poses.set(keys[0], [[0, up(b0)], [.5, up(b0)], [1, b0]]);
        tw.poses.set(keys[1], [[0, up(b1)], [.5, up(b1)], [1, b1]]);
        tw.sgs.set(en.id, [[0, sg1], [1, sg1]]);
        tw.swaps.push({ k: .46, hide: oldObj, show: newObj });
        tw.leaving.push({ o: oldObj, id: en.id });
        book.add(oldObj.group);
        continue;
      }
      const rank = movers.indexOf(en);
      const dn = Math.max(...keys.map(k => Math.abs((oldN.get(k) ?? newN.get(k) ?? 0) - (newN.get(k) ?? oldN.get(k) ?? 0))));
      let st = 0, w = 1, lift = 0;
      if (rank >= 0) { st = .32 * rank / Math.max(1, movers.length - 1); w = .62; lift = (F ? .8 : 1.15) * H; }
      else if (dn > 0 && !F) { st = .3 * en.qi / Q; w = .64; lift = (.22 + .5 * clamp(dn / 10)) * H; }
      if (!lift) continue;
      for (const k of keys) {
        const tr = tw.poses.get(k); if (!tr) continue;
        const a = tr[0][1], b = tr[1][1], up = p => ({ ...p, lift: p.lift + lift });
        tw.poses.set(k, [[0, a], [st, a], [st + w * .25, up(a)], [st + w * .75, up(b)], [st + w, b], [1, b]]);
      }
      const sgt = tw.sgs.get(en.id);
      tw.sgs.set(en.id, [[0, sgt[0][1]], [st + w * .25, sgt[0][1]], [st + w * .75, sgt[1][1]], [1, sgt[1][1]]]);
    }
  };
}
const morphMs = () => (V.slow ? 7000 : 2200);
function replay() {
  if (!V.prevOrder || !ORDERS.has(V.prevOrder)) { toast("Change the order first; Replay shows that change again"); return; }
  const to = V.order;
  open(ORDERS.get(V.prevOrder), { instant: true });
  open(to);
}

// ---------------------------------------------------------------- opening an order
/* Show an order. A different order, or a new version of the same one (your own order after a change), moves every
   sheet from its old place to its new one, over `ms` milliseconds. */
function open(order, { instant = false, ms, moved } = {}) {
  if (!V.built) build();
  if (!V.gl) return;
  const keep = V.model?.all[V.cur]?.id;
  const first = !V.model;
  const prev = !first && V.order !== order ? { model: V.model, objs: V.objs } : null;
  const other = V.order && order.id !== V.order.id && !(order.mine && order.from === V.order.title);
  if (V.arrange && other) ARR.plan = null;   // another order on the table: its own plan (and the camera follows, below)
  if (prev && V.order.id !== order.id) V.prevOrder = V.order.id;
  if (ms === 0) instant = true;
  if (V.hand.on) Object.assign(V.hand, { on: false, turned: false, open: [0, 0], flat: false });
  V.order = order;
  V.model = modelOf(order);
  const used = new Set();
  V.objs = new Map();
  for (const en of V.model.all) { const o = objFor(en); V.objs.set(en.id, o); used.add(o); if (o.group.parent !== book) book.add(o.group); o.group.visible = !isHidden(en); }
  for (const o of V.cache.values()) if (!used.has(o) && o.group.parent) o.group.parent.remove(o.group);
  live = pickables.filter(isLive);
  const k = keep ? V.model.all.findIndex(en => en.id === keep) : -1;
  V.cur = k >= 0 ? k : 0;
  if (k < 0) V.inspect = false;
  if (V.mode === "opening") V.opening = clamp(V.opening, 0, V.model.leaves.length);
  renderBar(); renderStrip(); renderOpening(); renderInspector();
  relayout(first || instant ? 0 : V.arrange ? Math.min(ms ?? 700, 700) : ms ?? morphMs(), prev && !instant && !V.arrange ? morphFrom(prev, moved) : null);
  if (first) preset(V.preset || 1, { instant: true });
  if (prev && !instant && REDUCED) {   // no motion: flash what moved instead
    V.flash = new Set(V.model.all.filter(en => en.moved || en.resewn || prev.objs.get(en.id) !== V.objs.get(en.id)).map(en => en.id));
    setTimeout(() => { V.flash = null; tint(); }, 2000);
  }
  tint(); renderLegend();
  if (V.contact.on) { V.contact.list = contactsOf(order); V.contact.i = 0; renderContact(); }
  if (V.preset === 2) setTimeout(() => showThreads(true), first ? 0 : morphMs() + 50);
  Arrange.mark(curSheet());
  marks();
  if (V.arrange && other) frameTable();
}

// ---------------------------------------------------------------- quires hidden like layers (3D only; the order is not changed)
const HID = store.get("3d:hidden", {});   // order id -> names of the quires hidden in 3D
const hiddenQuires = () => new Set((V.order && HID[V.order.id]) || []);
const isHidden = en => !!en && !en.unplaced && hiddenQuires().has(String(en.quire));
const hiddenObj = o => !!o?.entry && V.objs.get(o.entry.id) === o && isHidden(o.entry);
function setHidden(quire, hide, { quiet = false } = {}) {
  if (!V.order) return;
  const set = hiddenQuires(), key = String(quire);
  if (hide) set.add(key); else set.delete(key);
  if (set.size) HID[V.order.id] = [...set]; else delete HID[V.order.id];
  store.set("3d:hidden", HID);
  for (const en of V.model.all) { const o = V.objs.get(en.id); if (o) o.group.visible = !isHidden(en); }
  if (hide && isHidden(V.model.all[V.cur])) {   // the current sheet went with it: move to the nearest one still shown
    const vis = V.model.all.map((en, i) => [en, i]).filter(([en]) => !isHidden(en)).sort((a, b) => Math.abs(a[1] - V.cur) - Math.abs(b[1] - V.cur));
    if (vis.length) { if (V.inspect) closeInspector(); V.cur = vis[0][1]; renderInspector(); pushHash(); }
  }
  if (!quiet) toast(hide ? `${qWord(quire)} hidden in 3D` : `${qWord(quire)} shown again`);
  if (V.arrange) relayout(REDUCED ? 0 : 400);   // on the table the other piles close up (or make room)
  tint(); marks(); wake(); Arrange.render();
}
/* Your order changed (arrange.js edit): its hidden quires go along with it. A copy starts with the ones hidden in the order it
   was made from, a renamed quire stays hidden under its new name, and a name the order no longer has is forgotten (so a
   quire merged away, or one put back later under that name, isn't hidden by mistake). */
function keepHidden(order, { from = null, renamed = null } = {}) {
  const names = new Set(HID[order.id] || (from && HID[from]) || []);
  if (renamed && names.delete(String(renamed[0]))) names.add(String(renamed[1]));
  const have = new Set(order.gatherings.map(g => String(g.quire)));
  const keep = [...names].filter(n => have.has(n));
  if (keep.length) HID[order.id] = keep; else delete HID[order.id];
  store.set("3d:hidden", HID);
}
function dropHidden(id) { if (HID[id]) { delete HID[id]; store.set("3d:hidden", HID); } }
function showAllQuires() { for (const q of hiddenQuires()) setHidden(q, false, { quiet: true }); toast("Every quire is shown"); }
/* Strip ticks: the current sheet, hidden quires, bookmarked sheets. */
function marks() {
  const el = $("#v3-strip"); if (!el || !V.model) return;
  const hid = hiddenQuires();
  for (const b of $$(".v3-tick", el)) {
    const en = V.model.all[+b.dataset.i];
    if (!en) continue;
    b.classList.toggle("hid", !en.unplaced && hid.has(String(en.quire)));
    b.classList.toggle("bm", Bookmarks.onSheet(en.id));
  }
  for (const b of $$(".v3-qb", el)) b.classList.toggle("hid", hid.has(b.dataset.q));
  if (V.inspect) renderInspector();
}

// ---------------------------------------------------------------- your own orders and crops (arrange.js, work.js)
const NARROW = () => matchMedia("(max-width: 760px)").matches;   // phones: the rearrange panel and the inspector take turns
function setPanel(on) {
  if (on && NARROW() && V.inspect) closeInspector();
  $("#v3-arr-btn")?.classList.toggle("on", on);
  $("#v-three")?.classList.toggle("arranging", on);   // the dock takes the place of the strip of sheets
  setTimeout(resize, 0);
}
const curSheet = () => V.model?.all[V.cur]?.id || null;
/* the pages in view that can be bookmarked: the opening shown, or the four pages of the picked sheet */
function herePages() {
  if (!V.model) return [];
  if (V.mode === "opening") {
    const pages = linearize(V.order, { ghosts: true });
    return [pages[2 * V.opening - 1], pages[2 * V.opening]].filter(p => p && !p.lost).map(p => p.shown.page);
  }
  const en = V.model.all[V.cur];
  return en ? sidesOf(en.sheet, en.opts).filter(sd => !sd.lost).map(sd => sd.shown.page) : [];
}
function focusSheet(id) {
  const i = V.model ? V.model.all.findIndex(en => en.id === id) : -1;
  if (i < 0) return;
  if (V.mode === "opening") setMode("block", { view: false });
  setCur(i);
}
/* Pages re-cut in the crop editor: rebuild their sheets, which take the new image and shape. */
function refresh(ids) {
  if (!V.built || !V.gl || !V.model) return;
  for (const [k, o] of [...V.cache]) if (ids.includes(o.id)) { o.group.parent?.remove(o.group); DETAIL.delete(o); V.cache.delete(k); }
  open(V.order, { instant: true });
}

// ---------------------------------------------------------------- what touched what
/* Faces that lay against each other in the closed book. Between leaves they are Read's openings: pages that face
   each other, across quire boundaries too, with the first and last pages on the covers. Inside a folded foldout they
   come from the hinge chain at the closed state (which panel faces lie on which). Whatever rests on which way a fold
   goes is marked: confirmed where Lisa Fagin Davis described the sheet as it is bound today (data/folds.json, whose
   faces are used as she gave them), inferred where it is worked out here. */
const PART = / \(part\)$/;
const pairKey = (a, b) => [a, b].map(x => x.replace(PART, "")).sort().join(" ↔ ");
const pageLbl = p => short(sideLabel(p)).replace("[f", "[");
const optsIn = (order, id) => (order.gatherings.find(g => g.bifolia.includes(id))?.sheets || {})[id] || {};
/* Davis's account of a sheet, if it is sewn and folded as it is bound today. */
function recordOf(id, opts = {}) {
  const r = D.folds?.sheets?.[id], was = bindingOf(id);
  return r && was && JSON.stringify(opts) === JSON.stringify(was.opts || {}) ? r : null;
}
/* What one side of a closed leaf shows the page it faces: the faces Davis gave for a folded leaf, else the page sidesOf
   names. `fold` is whether that rests on a fold, and how we know: "confirmed", "inferred" or "". */
function facesOf(p, order) {
  const rec = p.lost ? null : recordOf(p.sheet, optsIn(order, p.sheet));
  const given = p.face === "inside" ? rec?.shows?.[p.leafNo] : null;
  if (given) return given.map(f => ({ name: f.replace(PART, ""), label: short(f), fold: "confirmed" }));
  const spine = p.segs[p.hinge === "left" ? 0 : p.segs.length - 1];
  const onFold = !p.lost && (p.grid || p.segs.length > 1 && p.shown.page !== spine.page);   // a flap's back, or the Rose's reading
  return [{ name: pageName(p.shown), label: pageLbl(p), fold: onFold ? (rec?.touch === "all" ? "confirmed" : "inferred") : "" }];
}
const worst = (...fs) => fs.includes("inferred") ? "inferred" : fs.includes("confirmed") ? "confirmed" : "";
function facingPairs(order) {
  const pages = linearize(order, { ghosts: true }), out = [];
  for (let i = 0; i <= pages.length / 2; i++) {
    const a = pages[2 * i - 1] || null, b = pages[2 * i] || null;
    if (!a && !b) continue;
    const fa = a ? facesOf(a, order) : [{ label: "front cover", fold: "" }], fb = b ? facesOf(b, order) : [{ label: "back cover", fold: "" }];
    for (const x of fa) for (const y of fb)
      out.push({ kind: "facing", opening: i, pa: a, pb: b, fa: x, fb: y, a: x.label, b: y.label, fold: worst(x.fold, y.fold), pos: i });
  }
  return out;
}
/* A face's name; panels that share a label (the Rosettes' "Ros 86r top" is two panels) add their image id. */
const segLabel = (seg, part, shared) => seg.missing ? `[${short(seg.page)}]`
  : short(pageName(seg)) + (shared?.has(pageName(seg)) && seg.img ? ` [${seg.img.replace(/^f?Ros-/, "")}]` : "") + (part ? " (part)" : "");
/* A sheet folded shut: where each panel of each leaf lies in its leaf's frame, which way its front faces, and its extent. */
function closedLay(o) {
  const lay = new Map();
  for (const L of o.leaves) {
    const ps = o.panels.filter(m => m.userData.leaf === L);
    // closed: every hinge of the leaf at 180 degrees
    const saved = L.hinges.map(hg => [hg.outer.rotation.x, hg.outer.rotation.y]);
    for (const hg of L.hinges) { if (hg.axis === "y") hg.outer.rotation.y = hg.sign * Math.PI; else hg.outer.rotation.x = Math.PI; }
    L.group.updateMatrixWorld(true);
    const inv = L.group.matrixWorld.clone().invert();
    for (const m of ps) {
      const mm = inv.clone().multiply(m.matrixWorld), c = new THREE.Vector3().setFromMatrixPosition(mm);
      const up = new THREE.Vector3(0, 0, 1).transformDirection(mm).z > 0, half = m.scale.x / 2;
      lay.set(m, { m, L, z: c.z, up, x0: c.x - half, x1: c.x + half, y0: c.y - H / 2, y1: c.y + H / 2 });
    }
    L.hinges.forEach((hg, i) => { hg.outer.rotation.x = saved[i][0]; hg.outer.rotation.y = saved[i][1]; });
    L.group.updateMatrixWorld(true);
  }
  return lay;
}
const overlaps = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1;
const facesUp = (l, face) => (face === 1) === l.up;   // that face of the panel looks along +z, toward the inside of the leaf
/* The panel faces of a sheet that answer to a name ("f72r3", "f70r2 (1)"): by label, else by page. */
function facesNamed(o, name) {
  const all = o.panels.flatMap(m => [[m, 1, m.userData.front], [m, -1, m.userData.back]]).filter(([, , s]) => !s.missing);
  const hit = all.filter(([, , s]) => pageName(s) === name);
  return (hit.length ? hit : all.filter(([, , s]) => s.page === name)).map(([m, face]) => ({ m, face }));
}
function foldContacts(o) {
  const out = [], seen = new Map(), lay = closedLay(o);
  for (const m of o.panels) for (const x of [m.userData.front, m.userData.back]) if (!x.missing) seen.set(pageName(x), (seen.get(pageName(x)) || new Set()).add(x.img));
  const shared = new Set([...seen].filter(([, imgs]) => imgs.size > 1).map(([k]) => k));
  for (const L of o.leaves) {
    const ls = [...lay.values()].filter(l => l.L === L);
    if (ls.length < 2) continue;
    for (const a of ls) {
      // the nearest layer above it that it lies against
      const b = ls.filter(x => x.z > a.z + 1e-4 && overlaps(a, x)).sort((x, y) => x.z - y.z)[0];
      if (!b) continue;
      const fa = a.up ? a.m.userData.front : a.m.userData.back, fb = b.up ? b.m.userData.back : b.m.userData.front;
      out.push({ kind: "fold", sheet: o.id, k: L.k, ma: a.m, mb: b.m, faceA: a.up ? 1 : -1, faceB: b.up ? -1 : 1,
                 a: segLabel(fa, a.m.userData.part, shared), b: segLabel(fb, b.m.userData.part, shared) });
    }
  }
  return out;
}
/* A sheet's contacts inside its folds. Where Davis gave them, hers (each placed on the two panel faces that lie against
   each other), and anything else the folding gives is still inferred; elsewhere all are worked out, and inferred. */
function sheetContacts(o, opts) {
  const rec = recordOf(o.id, opts), found = foldContacts(o);
  if (!rec || rec.touch === "all") return found.map(c => ({ ...c, fold: rec ? "confirmed" : "inferred" }));
  const lay = closedLay(o), out = [];
  for (const [A, B] of rec.touch || []) {
    const ca = facesNamed(o, A.replace(PART, "")), cb = facesNamed(o, B.replace(PART, ""));
    let best = null;
    for (const x of ca) for (const y of cb) {
      const lx = lay.get(x.m), ly = lay.get(y.m);
      if (x.m === y.m || lx.L !== ly.L || !overlaps(lx, ly)) continue;
      const [lo, hi] = lx.z < ly.z ? [[lx, x], [ly, y]] : [[ly, y], [lx, x]];
      if (!facesUp(lo[0], lo[1].face) || facesUp(hi[0], hi[1].face)) continue;   // they must look at each other
      const d = hi[0].z - lo[0].z;
      if (!best || d < best.d) best = { d, x, y, k: lx.L.k };
    }
    if (!best && ca.length && cb.length) best = { x: ca[0], y: cb[0], k: lay.get(ca[0].m).L.k };
    if (best) out.push({ kind: "fold", sheet: o.id, k: best.k, ma: best.x.m, mb: best.y.m, faceA: best.x.face, faceB: best.y.face,
                         a: short(A), b: short(B), fold: "confirmed" });
  }
  const face = (m, f) => `${o.panels.indexOf(m)}:${f}`, said = new Set(out.map(c => [face(c.ma, c.faceA), face(c.mb, c.faceB)].sort().join()));
  for (const c of found) if (!said.has([face(c.ma, c.faceA), face(c.mb, c.faceB)].sort().join())) out.push({ ...c, fold: "inferred" });
  return out.sort((a, b) => a.k - b.k);
}
/* Every contact of the order, front to back, each marked new if the current binding does not have it. */
function contactsOf(order) {
  const base = ORDERS.get("beinecke");
  const baseFacing = new Set(facingPairs(base).map(c => pairKey(c.a, c.b)));
  const list = facingPairs(order).map(c => ({ ...c, isNew: !baseFacing.has(pairKey(c.a, c.b)) }));
  for (const L of V.model.leaves.filter(x => x.k === 0)) {
    const en = L.e, o = V.objs.get(en.id);
    if (!o.leaves.some(lf => lf.hinges.length)) continue;
    const was = bindingOf(en.id);
    const baseObj = was ? objFor({ ...en, opts: was.opts }, false) : null;
    const baseSet = new Set(baseObj ? sheetContacts(baseObj, was.opts).map(c => pairKey(c.a, c.b)) : []);
    for (const c of sheetContacts(o, en.opts)) {
      const n = V.model.leaves.find(x => x.e === en && x.k === c.k).n;
      list.push({ ...c, pos: n + .5, isNew: !baseSet.has(pairKey(c.a, c.b)) });
    }
  }
  return list.sort((a, b) => a.pos - b.pos);
}
let outlines = [];
const OUTLINE = new THREE.LineBasicMaterial({ color: GOLD });
function outline(meshes) {
  for (const l of outlines) l.parent?.remove(l);
  outlines = meshes.map(([m, face]) => {
    const l = new THREE.Line(RECT, OUTLINE);
    l.position.z = face * .56; l.scale.set(1.01, 1.01, 1);
    m.add(l);
    return l;
  });
  wake();
}
/* The panel meshes showing one page side of a leaf, and which face of each; with a face Davis named (`f`), the panel
   that shows it to the facing page, the outermost on that side of the leaf. */
function meshesFor(side, f) {
  if (!side) return [];
  const o = V.objs.get(side.sheet); if (!o) return [];
  if (f?.name) {
    const lay = closedLay(o), inside = side.face === "inside";
    const hits = facesNamed(o, f.name).filter(({ m, face }) => facesUp(lay.get(m), face) === inside)
      .sort((a, b) => (lay.get(b.m).z - lay.get(a.m).z) * (inside ? 1 : -1));
    if (hits.length) return [[hits[0].m, hits[0].face]];
  }
  const want = new Set(side.segs.map(x => x.page));
  const shown = side.shown?.page;
  const out = [];
  for (const m of o.panels) {
    const { front, back } = m.userData;
    if (front.page === shown || back.page === shown) out.push([m, front.page === shown ? 1 : -1]);
  }
  return out.length ? out : o.panels.filter(m => want.has(m.userData.front.page)).map(m => [m, 1]);
}
function showContact(i) {
  const C = V.contact;
  const list = C.newOnly ? C.list.filter(c => c.isNew) : C.list;
  if (!list.length) { renderContact(); toast(C.newOnly ? "This order creates no new contacts" : "No contacts"); return; }
  C.i = (i + list.length) % list.length;
  const c = list[C.i];
  if (c.kind === "facing") {
    if (V.hand.on) putBack({ silent: true });
    if (V.mode !== "opening") { V.mode = "opening"; renderBar(); }
    setOpening(c.opening);
    preset(5);
    outline([...meshesFor(c.pa, c.fa), ...meshesFor(c.pb, c.fb)]);
  } else {
    selectSheet(V.model.all.findIndex(en => en.id === c.sheet));
    const en = V.model.all[V.cur], entering = !V.hand.on, was = entering ? [0, 0] : V.hand.open;
    enterHand(); V.hand.open = [0, 1].map(k => foldsOf(en, k)); V.hand.flat = true;
    renderInspector(); relayHand(en, Math.max(...[0, 1].map(k => V.hand.open[k] - Math.min(was[k], V.hand.open[k]))), entering); frameHand();
    outline([[c.ma, c.faceA], [c.mb, c.faceB]]);
  }
  renderContact();
}
function setContactView(on) {
  const C = V.contact;
  C.on = on;
  if (on) {   // start at the opening in view, if it is one
    C.list = contactsOf(V.order);
    const list = C.newOnly ? C.list.filter(c => c.isNew) : C.list;
    const here = V.mode === "opening" ? list.findIndex(c => c.kind === "facing" && c.opening === V.opening) : -1;
    showContact(here >= 0 ? here : C.i || 0);
  }
  else { outline([]); renderContact(); }
  pushHash();
}
/* "confirmed" or "inferred", for a contact that rests on which way a fold goes */
const FOLD_TIP = {
  confirmed: () => `As Lisa Fagin Davis gives it: ${(D.orders.sources[D.folds?.src] || {}).cite || "personal communication"}`,
  inferred: () => "Rests on which way the folds go, which is worked out here, not documented",
};
const foldTag = (c, prefix = "") => c?.fold ? h("span", { class: c.fold, title: FOLD_TIP[c.fold]() }, prefix + c.fold) : "";
function renderContact() {
  const el = $("#v3-contact"); if (!el) return;
  const C = V.contact;
  if (!C.on) { el.hidden = true; return; }
  const list = C.newOnly ? C.list.filter(c => c.isNew) : C.list, c = list[C.i];
  el.hidden = false; el.innerHTML = "";
  el.append(
    h("b", {}, "Touching faces"),
    h("button", { "aria-label": "Previous contact", title: "Previous contact (←)", onclick: () => showContact(C.i - 1) }, "‹"),
    h("span", { class: "pair" }, c ? `${c.a} ↔ ${c.b}` : "none"),
    h("button", { "aria-label": "Next contact", title: "Next contact (→)", onclick: () => showContact(C.i + 1) }, "›"),
    h("span", { class: "n" }, c ? `${C.i + 1} of ${list.length}` : ""),
    c ? h("span", { class: "kind" }, c.kind === "facing" ? "facing pages" : `inside the fold of ${c.sheet}`) : "",
    foldTag(c),
    c?.isNew ? h("span", { class: "new", title: "These faces do not touch in the current binding" }, "new") : "",
    h("label", { class: "only" }, h("input", { type: "checkbox", checked: C.newOnly || null,
      onchange: e => { C.newOnly = e.target.checked; C.i = 0; showContact(0); } }), " new only"),
    h("button", { class: "x", "aria-label": "Close the contact view", title: "Close (K)", onclick: () => setContactView(false) }, "✕"));
}

// ---------------------------------------------------------------- the inspector
const bindingOf = id => {
  for (const g of ORDERS.get("beinecke").gatherings) {
    const i = g.bifolia.indexOf(id);
    if (i >= 0) return { quire: g.quire, idx: i, count: g.bifolia.length, type: g.type, opts: (g.sheets || {})[id] || {} };
  }
  return null;
};
const posText = (type, idx, count) => type === "singulions" ? `singulion ${idx + 1} of ${count}` : `bifolium ${idx + 1} of ${count} from the outside`;
const spineText = (sheet, opts) => {
  const v = handled(sheet, opts), row = v.inside[v.proper];
  return row[v.spine - 1] && row[v.spine] ? `${short(pageName(row[v.spine - 1]))} and ${short(pageName(row[v.spine]))}` : "the edge";
};
function readPage(page, sheet) { setPos(page, sheet, "three"); show("read"); }
const cropSegs = sh => [...sh.inside.flat(), ...sh.outside.flat()].filter(s => s.img && !s.missing);
function toFolios(id) { showFolios(id); }

function renderInspector() {
  const el = $("#v3-insp");
  if (!el) return;
  renderFoldBtn();
  const en = V.model?.all[V.cur];
  if (!V.inspect || !en) { el.hidden = true; el.innerHTML = ""; return; }
  const o = V.objs.get(en.id), { sides, names, v, sub, title } = info(en);
  const ev = (D.orders.evidence || {})[en.id] || [], src = D.orders.sources || {};
  const was = bindingOf(en.id), foldable = o.leaves.some(L => L.hinges.length);
  const cite = k => !src[k] ? k : src[k].url ? h("a", { href: src[k].url, target: "_blank", rel: "noopener" }, src[k].cite) : src[k].cite.replace(/\.$/, "");
  // only the folds whose direction Davis gives are credited to her; any other fold goes in, as the viewer assumes
  const rec = recordOf(en.id, en.opts), said = o.folds.filter(f => f.given), given = said.length > 0;
  const ways = said.map(f => (f.crease ? `the crease in ${short(pageName(f.pages[0]))}` : f.pages.map(x => short(pageName(x))).join("–"))
    + (f.way > 0 ? " in" : " out"));
  const waysText = ways.length > 1 ? ways.slice(0, -1).join(", ") + " and " + ways.at(-1) : ways[0];
  const star = pg => { const b = Bookmarks.of(pg);
    return h("button", { class: `bm-star${b ? " on" : ""}`, title: b ? `Bookmarked as “${b.name}”: click to remove` : `Bookmark ${short(pg)}`,
      "aria-label": b ? `Remove the bookmark on ${short(pg)}` : `Bookmark ${short(pg)}`, onclick: () => Bookmarks.toggle(pg) }, b ? "★" : "☆"); };
  const page = (sd, label) => sd.lost ? h("span", { class: "muted" }, label + " (lost)")
    : h("span", { class: "pg" }, h("button", { class: "linkish", title: "Read this page", onclick: () => readPage(sd.shown.page, en.id) }, label), star(sd.shown.page));
  const hd = V.hand;
  el.hidden = false; el.innerHTML = "";
  const parts = [
    h("div", { class: "fx-nav" },
      h("button", { title: "Previous sheet (←)", "aria-label": "Previous sheet", onclick: () => stepSel(-1), disabled: V.cur === 0 || null }, "‹"),
      h("b", {}, title),
      h("button", { title: "Next sheet (→)", "aria-label": "Next sheet", onclick: () => stepSel(1), disabled: V.cur === V.model.all.length - 1 || null }, "›"),
      h("button", { class: "fx-close", title: "Put it back (Esc)", "aria-label": "Close the inspector", onclick: () => closeInspector() }, "✕")),
    h("div", { class: "muted" }, sub),
    en.moved && was ? h("div", { class: "where" }, `• Moved. In the current binding it is in quire ${was.quire}, ${posText(was.type, was.idx, was.count)}.`) : "",
    en.resewn && was ? h("div", { class: "where" }, `○ Sewn on another fold: today between ${spineText(en.sheet, was.opts)}, in this order between ${spineText(en.sheet, en.opts)}.`) : "",
    en.unplaced ? h("div", { class: "where" }, en.sheet.missing.every(Boolean) ? "Lost, and this order gives it no place, so it lies on the table in front of its quire."
      : "Set aside: this order leaves it out of the book, so it lies on the table in front of its quire.") : "",
    h("div", { class: "fx-acts" },
      h("button", { onclick: () => act("turn") }, hd.on && hd.turned ? "Turn back" : "Turn over", " ", h("kbd", {}, "T")),
      foldable ? h("button", { onclick: () => act("unfold") }, hd.on && anyOpen() ? "Fold up" : "Unfold", " ", h("kbd", {}, "U")) : "",
      o.linked ? "" : h("button", { onclick: () => act("flat") }, hd.on && hd.flat ? "Half-open" : "Open flat", " ", h("kbd", {}, "O")),
      hd.on ? h("button", { onclick: () => putBack() }, "Put back ", h("kbd", {}, "Esc")) : "",
      h("button", { class: "primary", onclick: () => readSheet(en) }, "Read from here ", h("kbd", {}, "↵"))),
    h("div", { class: "links" }, "Same sheet in ",
      h("button", { class: "linkish", onclick: () => readSheet(en) }, "Reader"), " · ",
      h("button", { class: "linkish", onclick: () => toFolios(en.id) }, "Folio order")),
    h("div", { class: "fx-arr" },
      h("span", { class: "muted" }, "Move it: "),
      en.unplaced ? "" : h("button", { title: "One place earlier in the list (in a quire: further out)", onclick: () => Arrange.step(en.id, -1) }, "‹ Earlier"),
      en.unplaced ? "" : h("button", { title: "One place later in the list (in a quire: further in)", onclick: () => Arrange.step(en.id, 1) }, "Later ›"),
      h("button", { title: "Move it anywhere, fold it another way (A)", onclick: () => { Arrange.sel = en.id; Arrange.open(); } }, "More…")),
    cropSegs(en.sheet).length ? h("div", { class: "links" }, "✂ Crop a page: ",
      cropSegs(en.sheet).flatMap((sg, i) => [i ? " · " : "", h("button", { class: "linkish", title: `Re-cut ${pageName(sg)} from Yale's photograph`, onclick: () => CropEditor.open(sg.img) }, short(pageName(sg)))])) : "",
    h("h4", {}, "Pages, as read"),
    h("div", { class: "faces" }, ["1st leaf, front", "1st leaf, back", "2nd leaf, front", "2nd leaf, back"].flatMap((t, i) => [h("span", {}, t), page(sides[i], names(sides[i]))])),
    ...touchesOf(en),
    v.is.length || v.hs.length || v.ls.length ? [h("h4", {}, "Section · hands · language"),
      h("div", { class: "hands" }, v.is.join(", "), v.hs.map(n => h("span", { class: "chip", style: { "--c": `var(--h${n})` } }, SCRIBES[n])), v.ls.map(x => LANG[x]).join(", "))] : "",
    foldable || o.rows > 1 ? [h("h4", {}, "Folds ", foldTag({ fold: rec ? "confirmed" : "inferred" })),
      // every fold, in the order it opens: fold or unfold each one (or click a flap of the sheet)
      foldable ? h("div", { class: "fold-ctl" }, foldGroups(o).flatMap(([title, k, steps]) => [
        h("div", { class: "lf" }, title),
        ...steps.map(([i, info]) => {
          const isOpen = hd.on && i < Math.min(hd.open[k], o.leaves[k].steps.length);
          return h("div", { class: "fold-row" },
            h("button", { onclick: () => toggleFold(k, i), "aria-pressed": isOpen ? "true" : "false",
              title: isOpen ? "Fold it back (and the folds that close before it)" : "Open it (and the folds that open before it)" }, isOpen ? "Fold" : "Unfold"),
            h("span", { class: "nm" }, info.label),
            h("span", { class: `way${info.way < 0 ? " out" : ""}`, title: info.row ? "Folds down over the lower half, in one piece"
              : info.way < 0 ? "The outside faces of the sheet come together" : "The inside faces of the sheet come together" }, info.row ? "down" : info.way < 0 ? "out" : "in"));
        })]), h("div", { class: "small muted" }, "Or click a flap of the sheet to fold or unfold it.")) : "",
      o.rows > 1 ? h("p", { class: "small" }, "The top half folds down over the lower half in one piece, and the right-hand column then folds in over the middle. The sheet is sewn at its first crease, in the lower half only (", cite("VN"), "). ",
        h("a", { href: "https://collections.library.yale.edu/catalog/2002046?child_oid=1006229", target: "_blank", rel: "noopener" }, "Yale's photograph of it half open"),
        " shows the top half lying folded down as one strip: 85r2, 86v4, 86v6.") : "",
      // a fold "in" brings the inside faces of the sheet together, "out" the outside faces
      foldable && given ? h("p", { class: "small" }, "Folded ", waysText, " (in: the inside faces of the sheet come together; out: the outside faces)",
        rec ? [". These folds and the faces that touch are as Lisa Fagin Davis gives them: ", cite(D.folds.src), "."]
          : [". Davis gives these folds for the sheet as it is bound today (", cite(D.folds.src), "); sewn differently here, which faces touch is worked out."],
        o.folds.length > said.length ? " Its other folds go in, as the viewer assumes." : "") : "",
      foldable && !given ? h("p", { class: "small" }, "Extra panels roll-fold onto the inside of the sheet, so folded you see the back of the second panel. voynich.nu infers this from where the folio numbers were written.") : "",
      rec && !given ? h("p", { class: "small" }, "Lisa Fagin Davis confirms the faces that touch: ", cite(D.folds.src), ".") : "",
      o.creases.length ? h("p", { class: "small" }, o.creases.map(c => short(c.page)).join(", "), o.creases.length > 1 ? " are" : " is",
        " wider than the leaf it folds onto, so it has one more crease, at ", o.creases.map(c => Math.round(c.at * 100) + "%").join(", "), " of its width",
        rec?.creases ? ": where Yale's photograph shows it." : ", drawn where it would reach out of the book; where the crease really lies is not recorded.") : ""] : "",
    en.note ? [h("h4", {}, "In this order"), h("div", { class: "ev" }, en.note)] : "",
    ev.length ? [h("h4", {}, "Evidence"), ...ev.map(e => h("div", { class: "ev" }, e.text, src[e.src] ? h("span", { class: "src" }, cite(e.src)) : ""))] : ""];
  el.append(...parts.flat(2).filter(x => x !== "" && x != null));
}

/* The inspector's list of what this sheet's faces lay against in this order. The pairs stand plain: how each is known
   is on its tooltip, a pair new to this order gets a small dot, and anything worth a caveat is said once, under the
   list, instead of a badge on every line. */
const TOUCH_TIP = { confirmed: "It rests on a fold, as Lisa Fagin Davis gives it.", inferred: "It rests on a fold, worked out here, not confirmed." };
function touchesOf(en) {
  if (en.unplaced) return [];
  const all = contactsOf(V.order);
  const L0 = V.model.leaves.find(x => x.e === en && x.k === 0), L1 = V.model.leaves.find(x => x.e === en && x.k === 1);
  const openings = new Set([L0.n, L0.n + 1, L1.n, L1.n + 1]);
  const mine = all.filter(c => c.kind === "facing" ? openings.has(c.opening) : c.sheet === en.id);
  const go = c => { const C = V.contact; C.list = all; C.on = true; C.newOnly = false; showContact(all.indexOf(c)); pushHash(); };
  const tip = c => ["Show these two faces.", c.kind === "fold" ? "They meet inside the sheet's folds." : "", TOUCH_TIP[c.fold] || "",
    c.isNew ? "New: they do not touch as the book is bound today." : ""].filter(Boolean).join(" ");
  const anyNew = mine.some(c => c.isNew), guessed = mine.some(c => c.fold === "inferred");
  return [h("h4", {}, "Touches when closed"),
    h("div", { class: "touch" }, mine.map(c => h("button", { class: "linkish", title: tip(c), onclick: () => go(c) },
      `${c.a} ↔ ${c.b}`, c.isNew ? h("span", { class: "dot", "aria-label": "new in this order" }) : ""))),
    anyNew || guessed ? h("p", { class: "touch-note small muted" },
      anyNew ? [h("span", { class: "dot", "aria-hidden": "true" }), " New in this order."] : "",
      anyNew && guessed ? " " : "", guessed ? "Pairs that rest on a fold are worked out here, not confirmed." : "") : ""];
}
function openInspector() { if (V.inspect) return; if (NARROW() && Arrange.on) Arrange.close(); V.inspect = true; relayout(520); renderInspector(); pushHash(); }
function closeInspector() {
  if (!V.inspect) return;
  if (V.hand.on) putBack({ silent: true });
  V.inspect = false; relayout(520); renderInspector(); pushHash();
}
function enterHand() {
  if (V.hand.on) return;
  const g = CAM.goal;
  Object.assign(V.hand, { on: true, yaw: g.yaw, pitch: g.pitch, cam: { target: g.target.clone(), yaw: g.yaw, pitch: g.pitch, dist: g.dist, fov: g.fov } });
}
/* A sheet that both moves between the block and the hand and folds or unfolds does one after the other, so its flaps
   never swing through the leaves beside it: leaving the block it rises first, going back it folds up first. `part` is
   the share of the time the move takes. */
const RISE = 650;
const handMorph = (id, part, rising) => tw => {
  const hold = rising ? part : 1 - part;
  for (const k of [0, 1]) {
    const key = `${id}:${k}`, tr = tw.poses.get(key); if (!tr) continue;
    const a = tr[0][1], b = tr[1][1];
    tw.poses.set(key, rising ? [[0, a], [hold, { ...b, f: a.f }], [1, b, "even"]] : [[0, a], [hold, { ...a, f: b.f }, "even"], [1, b]]);
  }
  const sg = tw.sgs.get(id);
  if (sg) tw.sgs.set(id, [[0, sg[0][1]], [hold, rising ? sg[1][1] : sg[0][1]], [1, sg[1][1]]]);
};
/* Lay the sheet in hand out again after `steps` of its folds changed. `entering`: it is only now leaving the block. */
function relayHand(en, steps, entering, plain = 900) {
  const ft = foldTime(steps);
  if (entering && steps) relayout(RISE + ft, handMorph(en.id, RISE / (RISE + ft), true));
  else if (steps) relayout(ft, evenFor([`${en.id}:0`, `${en.id}:1`]));
  else relayout(plain);
}
/* A change of layout in which these leaves only fold or unfold: their folds take equal turns. */
const evenFor = keys => tw => { for (const key of keys) { const tr = tw.poses.get(key); if (tr) tw.poses.set(key, [[0, tr[0][1]], [1, tr[1][1], "even"]]); } };
/* The two leaves the book is open at, and whether U would unfold anything there. */
const openingLeaves = () => V.mode === "opening" ? [V.model.leaves[V.opening - 1], V.model.leaves[V.opening]].filter(Boolean) : [];
function openingFolds() {
  const ls = openingLeaves();
  return Math.max(0, ...ls.map(L => {
    const o = V.objs.get(L.e.id);
    if (o.linked && !(ls.length === 2 && ls[0].e === ls[1].e)) return 0;   // a sheet of two rows opens only at its own centre
    return o.leaves[L.k].steps.length;
  }));
}
/* U, or the Unfold button on the stage: the opening the book is open at, or the sheet picked. */
function unfoldHere() {
  if (V.mode === "opening" && !V.inspect) {
    const steps = openingFolds();
    if (!steps) { toast("Nothing folded in this opening"); return; }
    V.unfoldOpening = !V.unfoldOpening;
    relayout(foldTime(steps), evenFor(openingLeaves().map(L => L.key)));
    if (V.preset === 5) preset(5); else frameOpening();
    renderFoldBtn();
  } else act("unfold");
}
/* The button over the foot of the stage that folds or unfolds what is in view. It is there only when there is something
   to unfold, and draws the eye when you arrive at one. */
function renderFoldBtn() {
  const el = $("#v3-fold"); if (!el || !V.model) return;
  const opening = V.mode === "opening" && !V.inspect, en = V.model.all[V.cur];
  const can = !V.arrange && (opening ? openingFolds() > 0 : !!en && V.objs.get(en.id)?.leaves.some(L => L.steps.length));   // not over Rearrange's table
  const isOpen = opening ? V.unfoldOpening : V.hand.on && anyOpen();
  const key = can ? (opening ? `o${V.opening}` : `s${en.id}`) : "";
  el.hidden = !can;
  if (!can) { el._key = ""; return; }
  const label = isOpen ? "Fold up" : "Unfold";
  if (el._label !== label) { el._label = label; el.replaceChildren(h("span", { class: "ico", "aria-hidden": "true" }, isOpen ? "⇥⇤" : "⇤⇥"), label, " ", h("kbd", {}, "U")); }
  el.title = isOpen ? "Fold it back up (U)" : opening ? "Unfold the foldout at this opening (U)" : "Unfold this sheet, fold by fold (U)";
  if (el._key !== key) { el._key = key; el.classList.remove("arrive"); void el.offsetWidth; el.classList.add("arrive"); }   // a new foldout came into view
}
/* Turn over, unfold or open flat: the sheet rises clear of the block first. */
function act(kind) {
  if (!V.model) return;
  if (!V.inspect) { V.inspect = true; }
  const entering = !V.hand.on;
  enterHand();
  if (kind === "turn") V.hand.turned = !V.hand.turned;
  let steps = 0;
  if (kind === "unfold") {   // everything opens, one fold after another, or everything folds back up in reverse
    const en = V.model.all[V.cur], was = V.hand.open.slice();
    V.hand.open = anyOpen() ? [0, 0] : [0, 1].map(k => foldsOf(en, k));
    steps = Math.max(...[0, 1].map(k => Math.abs(V.hand.open[k] - Math.min(was[k], foldsOf(en, k)))));
  }
  if (kind === "flat") V.hand.flat = !V.hand.flat;
  renderInspector();   // first: it takes its room from the stage, and the sheet is framed in what is left
  relayHand(V.model.all[V.cur], steps, entering, kind === "turn" ? 1000 : 900);
  frameHand();
  tint();
}
/* The folds to list beside a sheet: [title, leaf, [[step, info]…]] for each leaf that has any; a sheet of two rows is one
   list, since its folds open in one sequence. */
function foldGroups(o) {
  const real = L => L.steps.map((st, i) => [i, st.info]).filter(([, info]) => info);
  if (!o.linked) return o.leaves.filter(L => L.steps.length).map(L => [L.k ? "2nd leaf" : "1st leaf", L.k, real(L)]);
  // each stage once, named by whichever leaf folds in it
  const n = o.leaves[0].steps.length;
  return [["The whole sheet", 1, range(0, n).map(i => [i, o.leaves[1].steps[i].info || o.leaves[0].steps[i].info]).filter(([, info]) => info)]];
}
/* The folds of one leaf of a sheet, as steps in the order they open (L.steps), and how many of the sheet in hand's are open. */
function foldsOf(en, k) { return (en && V.objs.get(en.id)?.leaves[k]?.steps.length) || 0; }
function anyOpen() { const en = V.model?.all[V.cur]; return [0, 1].some(k => Math.min(V.hand.open[k], foldsOf(en, k)) > 0); }
const foldTime = steps => 300 + 520 * steps;   // each fold takes its turn
/* Fold or unfold one fold of the sheet in hand (step i of its leaf's L.steps). Opening it opens the folds that open
   before it, so the rest of the strip comes out with it; closing it first closes those that close before it. A sheet of
   two rows is one sequence for both its leaves. */
function toggleFold(k, i) {
  const en = V.model?.all[V.cur];
  if (!en || i >= foldsOf(en, k)) return;
  if (!V.inspect) V.inspect = true;
  const entering = !V.hand.on;
  enterHand();
  const was = Math.min(V.hand.open[k], foldsOf(en, k)), next = i < was ? i : i + 1;
  V.hand.open = V.objs.get(en.id).linked ? [next, next] : V.hand.open.map((x, j) => j === k ? next : Math.min(x, foldsOf(en, j)));
  renderInspector();
  relayHand(en, Math.abs(next - was), entering);
  frameHand();
  tint();
}
/* The fold a panel of the sheet in hand hangs from: { k, i } in its leaf's L.steps, or null for a panel at the spine. */
function foldOf(mesh) {
  const L = mesh?.userData.leaf;
  if (!L?.steps) return null;
  for (let o = mesh.parent; o && o !== L.group; o = o.parent) {
    const hi = L.hinges.findIndex(hg => hg.inner === o);
    if (hi >= 0) return { k: L.k, i: L.steps.findIndex(st => st.hs.includes(hi)) };
  }
  return null;
}
function putBack({ silent = false } = {}) {
  if (!V.hand.on) return;
  const cam = V.hand.cam, en = V.model.all[V.cur];
  const steps = Math.max(...[0, 1].map(k => Math.min(V.hand.open[k], foldsOf(en, k))));   // folds to close on the way
  Object.assign(V.hand, { on: false, turned: false, open: [0, 0], flat: false });
  if (!silent) { if (steps) { const ft = foldTime(steps); relayout(ft + RISE, handMorph(en.id, RISE / (ft + RISE), false)); } else relayout(900); }
  if (cam) setGoal(cam, 4.5);
  renderInspector(); tint();
}
/* Frame the sheet in hand as it will be, with whichever of its folds are open, in the middle of the view. */
function frameHand() {
  const en = V.model.all[V.cur], o = V.objs.get(en.id), L = V.layout, g = L.sg.get(en.id);
  if (!g) return;
  fitStage();   // the inspector may just have taken its room
  const m = L.place.matrix.clone().multiply(new THREE.Matrix4().compose(g.p, g.q, new THREE.Vector3(1, 1, 1)));
  const pts = sheetCorners(o, en.id, L.poses).map(p => p.applyMatrix4(m));
  const yaw = V.hand.yaw, pitch = clamp(V.hand.pitch, 4, 40);
  // with the touching-faces bar across the top of the stage, stand a little further back so it does not cover the sheet
  setGoal({ ...fitView(pts, yaw, pitch, V.contact.on ? 1.34 : 1.18, 32), yaw: nearestYaw(yaw), pitch, fov: 32 }, 4.5);
  V.preset = null; renderViews();
}
function selectSheet(i) {
  if (V.arrange) { setCur(i); Arrange.mark(curSheet(), true); return; }   // on the table (a bookmark): the sheet is selected there; no inspector
  if (V.mode === "opening") setMode("block", { view: false });
  if (V.hand.on) putBack({ silent: true });
  V.cur = clamp(i, 0, V.model.all.length - 1);
  if (NARROW() && Arrange.on) Arrange.close();
  V.inspect = true;
  tint(); renderStrip(); renderInspector(); pushHash(); report(); Arrange.mark(curSheet(), true);
  relayout(520);
}
function stepSel(d) {
  if (V.hand.on) putBack({ silent: true });
  setCur(V.cur + d);
  renderInspector();
}

function key(e) {
  const k = e.key;
  if (!V.model) return;
  if (V.arrange && !["ArrowLeft", "ArrowRight", "Home", "End", "a", "A", "l", "L", "+", "=", "-", "_", "Escape"].includes(k)) return;   // the book's own keys rest (A puts it back together)
  if (e.altKey) {
    const big = e.shiftKey;
    if (k === "ArrowLeft") big ? panBy(60, 0) : orbitBy(-30, 0);
    else if (k === "ArrowRight") big ? panBy(-60, 0) : orbitBy(30, 0);
    else if (k === "ArrowUp") big ? panBy(0, 60) : orbitBy(0, 30);
    else if (k === "ArrowDown") big ? panBy(0, -60) : orbitBy(0, -30);
    else return;
    e.preventDefault(); return;
  }
  if ((k === "ArrowRight" || k === "ArrowLeft") && V.contact.on) { showContact(V.contact.i + (k === "ArrowRight" ? 1 : -1)); e.preventDefault(); }
  else if (k === "ArrowRight" || k === "ArrowLeft") {
    const d = k === "ArrowRight" ? 1 : -1;
    if (V.mode === "opening") setOpening(V.opening + d); else step(d, e.shiftKey);
    e.preventDefault();
  }
  else if (k === "k" || k === "K") setContactView(!V.contact.on);
  else if (k === "a" || k === "A") Arrange.toggle();
  else if (k === "b" || k === "B") Bookmarks.here();
  else if (k === "v" || k === "V") setOverlay(OVERLAY_KEYS[(OVERLAY_KEYS.indexOf(V.overlay) + (e.shiftKey ? -1 : 1) + OVERLAY_KEYS.length) % OVERLAY_KEYS.length]);
  else if (k === " ") { V.inspect ? closeInspector() : (V.mode === "opening" ? selectSheet(V.cur) : openInspector()); e.preventDefault(); }
  else if (k === "t" || k === "T") act("turn");
  else if (k === "u" || k === "U") unfoldHere();
  else if (k === "o" || k === "O") act("flat");
  else if (k === "r" || k === "R") replay();
  else if (k === "Home") V.mode === "opening" ? setOpening(0) : setCur(0);
  else if (k === "End") V.mode === "opening" ? setOpening(V.model.leaves.length) : setCur(V.model.all.length - 1);
  else if (k >= "1" && k <= "5") preset(+k);
  else if (k === "0") preset(1);
  else if (k === "[") setSpread(V.spread - .08, 400);
  else if (k === "]") setSpread(V.spread + .08, 400);
  else if (k === "+" || k === "=") zoomBy(1 / 1.25);
  else if (k === "-" || k === "_") zoomBy(1.25);
  else if (k === "p" || k === "P") setPosture(V.posture === "stand" ? "lie" : "stand");
  else if (k === "m" || k === "M") setMode(V.mode === "block" ? "opening" : "block");
  else if (k === "Enter") { V.mode === "opening" && !V.inspect ? readOpening() : readSheet(V.model.all[V.cur]); e.preventDefault(); }
  else if (k === "Escape" && V.arrange) { if (ARR.drag) { DRAG.on = false; dropSheet(true); } else Arrange.close(); }
  else if (k === "l" || k === "L") setHideLost(!V.hideLost);
  else if (k === "Escape") {
    if (V.contact.on) setContactView(false);
    else if (V.hand.on) putBack();
    else if (V.inspect) closeInspector();
    else if (V.mode === "opening") setMode("block");
  }
}

/* Milliseconds per frame, GPU included (readPixels waits for it), while orbiting and while the spread changes
   (a full re-layout of every leaf each frame). Independent of requestAnimationFrame, which a hidden tab throttles. */
function cost(n = 60) {
  const gl = renderer.getContext(), px = new Uint8Array(4);
  const run = fn => {
    fn(0); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 1; i <= n; i++) { fn(i); renderer.render(scene, camera); drawLabels(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return +((performance.now() - t0) / n).toFixed(2);
  };
  const y0 = CAM.yaw, s0 = V.spread;
  const orbit = run(i => { CAM.yaw = y0 + i * 3; placeCamera(); });
  CAM.yaw = y0; placeCamera();
  const spread = run(i => {
    V.spread = .05 + .9 * i / n;
    const L = V.layout = computeLayout();
    Object.assign(CUR, { poses: L.poses, sg: L.sg, t: L.t, lie: L.lie, beta: L.beta });
    applyAll();
  });
  V.spread = s0; relayout(0);
  return { orbitMs: orbit, spreadMs: spread, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
           canvas: [renderer.domElement.width, renderer.domElement.height] };
}

export default {
  mount(order, st) { open(order || ORDERS.get(S.order)); if (st) restore(st); resize(); },
  open,
  key,
  state,
  restore,
  sync,
  marks,
  herePages,
  setHidden,
  showAllQuires,
  hiddenQuires,
  keepHidden,
  dropHidden,
  curSheet,
  focusSheet,
  setPanel,
  setArrange,
  setHideLost,
  setSelection,
  glyph,
  frameTable(sel) {   // ⇧1: the whole table; ⇧2: the selection
    if (!sel) return frameTable();
    const pts = [];
    for (const id of sel) { const c = V.layout?.centers.get(id); if (c) pts.push(c.clone().add(new THREE.Vector3(-H * .8, 0, -H * .6)), c.clone().add(new THREE.Vector3(H * .8, 30, H * .6))); }
    if (pts.length) frameTable(false, pts);
  },
  cancelDrag() {   // Esc: sheets in hand go back; a box being drawn goes, with the selection as it was
    if (ARR.drag) { DRAG.on = false; dropSheet(true); return true; }
    if (DRAG.on && DRAG.mode === "marquee") { DRAG.on = false; stage.classList.remove("dragging"); $("#v3-marquee").hidden = true; Arrange.marqueeCancel(); return true; }
    return false;
  },
  get dragging() { return !!ARR.drag || (DRAG.on && DRAG.moved && DRAG.mode === "marquee"); },
  get hideLost() { return V.hideLost; },
  get arranging() { return V.arrange; },
  whereOf(id) { const en = V.model?.all.find(x => x.id === id); return en ? whereText(en) : ""; },
  relayout() { relayout(REDUCED ? 0 : 200); },
  refresh,
  // for checking in the browser: (await import("./assets/view3d.js")).default.debug
  debug: {
    V, CUR, CAM, cost, preset, setSpread, setPosture, setMode, setOpening, setCur, setGoal, wake,
    selectSheet, act, putBack, closeInspector, replay, setOverlay, setContactView, showContact, contactsOf, closedLay, toggleFold, foldOf,
    seek(k) { if (!TW.on) return; TW.t0 = performance.now() - k * TW.dur; tweenStep(performance.now()); renderer.render(scene, camera); drawLabels(); },
    get renderer() { return renderer; },
    get camera() { return camera; },
    get tray() { return ARR.tray; },   // the set-aside pile's dashed place on the table
    pickAt(x, y) { return pick({ clientX: x, clientY: y })?.en.id ?? null; },
    /* true while anything is still moving or about to: a tween, the camera on its way, a resize not yet fitted */
    get busy() {
      const g = CAM.goal, size = renderer.getSize(new THREE.Vector2());
      return TW.on || !!resize.pending || size.x !== stage.clientWidth || size.y !== stage.clientHeight
        || Math.abs(CAM.dist - g.dist) > g.dist * 1e-3 || CAM.target.distanceTo(g.target) > .05 || Math.abs(CAM.yaw - g.yaw) > .05 || Math.abs(CAM.pitch - g.pitch) > .05;
    },
    /* jump to the end of whatever is moving (the folds, the camera) and draw it: for checks that look at a still view.
       k < 1 stops the folds that far through, with the camera already where it is going. */
    settle(k = 1) {
      if (TW.on) { TW.t0 = performance.now() - (k >= 1 ? TW.dur + 1 : k * TW.dur); tweenStep(performance.now()); }
      const g = CAM.goal; CAM.yaw = g.yaw; CAM.pitch = g.pitch; CAM.dist = g.dist; CAM.fov = g.fov; CAM.target.copy(g.target);
      placeCamera(); camera.updateMatrixWorld(true); renderer.render(scene, camera); drawLabels();
    },
  },
};
