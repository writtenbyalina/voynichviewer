// Which way the foldouts fold, and which faces touch in the closed book: as Lisa Fagin Davis described them
// (data/folds.json). 3D folds the sheets by her fold directions, takes her touching faces for the sheets as bound today,
// and marks them confirmed; anything she did not mention, or a sheet sewn differently in another order, stays inferred.
const { test, expect, openSite, openThree, readerPicturesLoaded } = require("./fixtures");

/** The touching faces of the order in 3D that rest on a fold, as "a ↔ b [confirmed|inferred]". */
const foldContacts = page => page.evaluate(() => {
  const d = View3D.mod.debug;
  return d.contactsOf(d.V.order).filter(c => c.fold).map(c => `${c.a} ↔ ${c.b} [${c.fold}]`);
});

test("the current binding's foldouts touch where Davis says, and every contact that rests on a fold is confirmed", async ({ page }) => {
  await openThree(page);
  const got = await foldContacts(page);
  const want = [
    // quire 9: 67v1 against 67v2 confirmed; the crease in 68r3 folds out, so its two halves meet back to back
    "67v1 ↔ 67v2 [confirmed]", "67r2 ↔ 68v2 [confirmed]",
    "68r1 ↔ 68v3 (part) [confirmed]", "68r1 ↔ 68r3 (part) [confirmed]", "68r2 ↔ 68r3 (part) [confirmed]", "68v3 (part) ↔ 68v3 (part) [confirmed]",
    // quire 10: both folds in
    "69v ↔ 70v2 (1) [confirmed]",
    "70r1 (part) ↔ 70r2 (1) (part) [confirmed]", "70r1 ↔ 70v2 (2) [confirmed]", "70r2 (1) (part) ↔ 70r2 (2) [confirmed]",
    // quire 11: in, out, in, so 71v meets three faces
    "71v ↔ 72r1 [confirmed]", "71v ↔ 72r3 (part) [confirmed]", "71v ↔ 72v3 (part) [confirmed]",
    "72r1 ↔ 72r2 [confirmed]", "72v2 ↔ 72v3 (part) [confirmed]", "72r3 (part) ↔ 72r3 (part) [confirmed]",
    // quire 14: all of the Rose
    "84v ↔ 85r1 [confirmed]", "Ros 85v bottom ↔ Ros 85v top [confirmed]", "85r2 ↔ 86v5 [confirmed]",
    "Ros 86r bottom [bm] ↔ Ros 86r top [tm] [confirmed]", "86v4 ↔ 86v6 [confirmed]", "Ros 86r top [tr] ↔ Ros 86r bottom [br] [confirmed]",
    "86v3 ↔ 87r [confirmed]",
    // quire 15: every fold in
    "88v ↔ 89r1 (part) [confirmed]", "88v ↔ 89v2 (part) [confirmed]",
    "89r1 (part) ↔ 89r2 (part) [confirmed]", "89r1 ↔ 89v2 (part) [confirmed]", "89r2 (part) ↔ 89r2 (part) [confirmed]",
    "89v1 ↔ 90v2 [confirmed]", "90r1 ↔ 90r2 [confirmed]",
    // quire 17
    "94v ↔ 95r1 (part) [confirmed]", "94v ↔ 95v2 [confirmed]", "95r1 ↔ 95r2 [confirmed]",
    // quire 19: the crease in 102r2 folds out
    "100v ↔ 101r (1) (part) [confirmed]", "100v ↔ 101v (2) [confirmed]", "101r (1) ↔ 101r (2) [confirmed]",
    "101v (1) ↔ 102r1 (part) [confirmed]", "101v (1) ↔ 102r2 (part) [confirmed]", "101v (1) ↔ 102v2 (part) [confirmed]",
    "102r1 ↔ 102r2 (part) [confirmed]", "102v2 (part) ↔ 102v2 (part) [confirmed]",
  ];
  expect(got).toEqual(want);
});

test("each confirmed contact is drawn on two panel faces that look at each other in the folded sheet", async ({ page }) => {
  await openThree(page);
  const wrong = await page.evaluate(() => {
    const d = View3D.mod.debug, bad = [];
    for (const c of d.contactsOf(d.V.order).filter(c => c.kind === "fold")) {
      const lay = d.closedLay(d.V.objs.get(c.sheet)), a = lay.get(c.ma), b = lay.get(c.mb);
      const looksUp = (l, face) => (face === 1) === l.up;
      const [lo, flo, hi, fhi] = a.z < b.z ? [a, c.faceA, b, c.faceB] : [b, c.faceB, a, c.faceA];
      if (a.L !== b.L || !looksUp(lo, flo) || looksUp(hi, fhi)) bad.push(`${c.a} ↔ ${c.b}`);
    }
    return bad;
  });
  expect(wrong).toEqual([]);
});

test("quire 11 folds in, out, in: folded, its leaf stacks 72r1, 72r2 face down, 72r3 face up, then the end of 72r3 back over it", async ({ page }) => {
  await openThree(page);
  const stack = await page.evaluate(() => {
    const d = View3D.mod.debug, o = d.V.objs.get("71|72"), lay = d.closedLay(o);
    return [...lay.values()].filter(l => l.L.k === 1).sort((a, b) => a.z - b.z)
      .map(l => `${l.up ? l.m.userData.front.page : l.m.userData.back.page} ${l.up ? "up" : "down"}`);
  });
  // what faces up is the face that looks toward 71v
  expect(stack).toEqual(["f72r1 up", "f72v2 down", "f72r3 up", "f72v3 down"]);
  await page.evaluate(() => { const d = View3D.mod.debug; d.setMode("opening"); d.setOpening(71); });
  await expect(page.locator("#v3-open-lbl")).toHaveText("71v | 72r1 · 72r3 · 72v3");
});

test("a sheet another order sews on a different fold works its contacts out, and marks them inferred", async ({ page }) => {
  await openThree(page, "#three/davis");
  const got = await foldContacts(page);
  const q9 = got.filter(c => /6[78]/.test(c));
  expect(q9.length).toBeGreaterThan(2);
  expect(q9.filter(c => !c.endsWith("[inferred]")), "67|68 is sewn between 67v2 and 67v1 in this order").toEqual([]);
  // quire 11 is folded as bound, so Davis's faces still hold
  expect(got).toContain("71v ↔ 72r3 (part) [confirmed]");
});

test("the inspector gives Davis's folds, and her crease positions are the ones the photographs show", async ({ page }) => {
  await openThree(page);
  const insp = page.locator("#v3-insp");
  const pull = id => page.evaluate(id => { const d = View3D.mod.debug; d.selectSheet(d.V.model.all.findIndex(en => en.id === id)); d.act("turn"); }, id);
  await pull("67|68");
  await expect(insp).toContainText("Folded 67v1–67v2 in, 68r1–68r2 in, 68r2–68r3 in and the crease in 68r3 out");
  await expect(insp).not.toContainText("Its other folds go in");
  await pull("85|86");   // the Rose: she confirms the faces that touch without giving fold directions
  await expect(insp).toContainText("Lisa Fagin Davis confirms the faces that touch");
  // each extra crease, as a fraction of its panel's width from the fold it hangs from
  const creases = await page.evaluate(() => Object.fromEntries([...View3D.mod.debug.V.objs.values()]
    .flatMap(o => o.creases.map(c => [c.page, Math.round(c.at * 100)]))));
  expect(creases).toEqual({ f68r3: 63, f72r3: 66, f89r2: 60, f102r2: 76 });
});

test("the inspector says which way a sheet's folds go and that Davis gave them", async ({ page }) => {
  await openThree(page);
  await page.evaluate(() => { const d = View3D.mod.debug; d.selectSheet(d.V.model.all.findIndex(en => en.id === "99|102")); d.act("turn"); });
  const insp = page.locator("#v3-insp");
  await expect(insp).toContainText("102r1–102r2 in and the crease in 102r2 out");
  await expect(insp).toContainText("as Lisa Fagin Davis gives them");
  await expect(insp.locator(".confirmed").first()).toBeVisible();
});

test("Info draws how the foldouts fold: a row per quire, and Davis's three outward folds in gold", async ({ page }) => {
  await openSite(page, "#info/beinecke/folds");
  const sec = page.locator("#info-folds");
  await expect(sec).toBeVisible();
  await expect(sec.locator("table tr")).toHaveCount(8);   // the header and quires 9, 10, 11, 14, 15, 17, 19
  await expect(sec.locator("table")).toContainText("72r1–72r2 in, 72r2–72r3 out and the crease in 72r3 in");
  // before and after for leaves 68, 72 and 102; her folds alone for 70, 89, 95 and 101
  await expect(sec.locator(".info-fig svg")).toHaveCount(10);
  const labels = await sec.locator(".info-fig svg").evaluateAll(s => s.map(x => x.getAttribute("aria-label")));
  expect(labels.filter(l => l.includes("as Davis describes it")).flatMap(l => l.match(/[^,:]+ out/g) || []).map(s => s.trim()))
    .toEqual(["the crease in 68r3 out", "72r2–72r3 out", "the crease in 102r2 out"]);
  expect(labels.filter(l => l.includes("the viewer's guess")).join(" ")).not.toContain(" out");
  await expect(sec).toContainText("The Voynich Ninja");
});

/** Each fold of a sheet's leaves, in the order it opens, as "label:degrees folded" (a step that moves several hinges
    at once, the Rose's top half, gives each of them). */
const foldAngles = (page, id) => page.evaluate(id => {
  const o = View3D.mod.debug.V.objs.get(id);
  return o.leaves.flatMap(L => L.steps.filter(st => st.info).map(st => `${st.info.label}:` + st.hs.map(hi => {
    const hg = L.hinges[hi], r = hg.axis === "y" ? hg.outer.rotation.y : hg.outer.rotation.x;
    return Math.round(Math.abs(r) * 180 / Math.PI);
  }).join("/")));
}, id);
const pullOut = (page, id) => page.evaluate(id => { const d = View3D.mod.debug; d.selectSheet(d.V.model.all.findIndex(en => en.id === id)); d.act("turn"); d.act("turn"); }, id);


test("a click on a flap folds or unfolds the fold it hangs from", async ({ page }) => {
  await openThree(page);
  await pullOut(page, "67|68");
  // the end of 68r3, beyond its crease, hangs from the crease: the third fold of leaf 68
  const fold = await page.evaluate(() => {
    const d = View3D.mod.debug, o = d.V.objs.get("67|68");
    const spine = o.panels.find(m => m.userData.front.page === "f68r1");
    // the pieces of 68r3 in the order they were built: the last is its end
    return { end: d.foldOf(o.panels.filter(m => m.userData.front.page === "f68r3").at(-1)), spine: d.foldOf(spine) };
  });
  expect(fold).toEqual({ end: { k: 1, i: 2 }, spine: null });
  await page.evaluate(f => View3D.mod.debug.toggleFold(f.k, f.i), fold.end);
  await expect.poll(() => foldAngles(page, "67|68")).toEqual(["67v1–67v2:180", "68r1–68r2:0", "68r2–68r3:0", "the crease in 68r3:0"]);
});

test("the Rosettes open as the sheet does: the right-hand column out, then the whole top half up in one piece", async ({ page }) => {
  await openThree(page);
  await pullOut(page, "85|86");
  // the top half is one step for the whole sheet: one hinge on leaf 85, two on leaf 86, moving together
  expect(await foldAngles(page, "85|86")).toEqual(["the top half:180", "columns 2–3:180", "the top half:180/180"]);
  const rows = page.locator("#v3-insp .fold-row");
  await expect(rows).toHaveCount(2);   // listed once, for the whole sheet
  await expect(page.locator("#v3-insp .fold-ctl")).toContainText("The whole sheet");
  // lifting the top half opens the column first
  await rows.filter({ hasText: "the top half" }).getByRole("button").click();
  await expect.poll(() => foldAngles(page, "85|86")).toEqual(["the top half:0", "columns 2–3:0", "the top half:0/0"]);
  // folding the column back in first folds the top half down, on both leaves
  await rows.filter({ hasText: "columns 2–3" }).getByRole("button").click();
  await expect.poll(() => foldAngles(page, "85|86")).toEqual(["the top half:180", "columns 2–3:180", "the top half:180/180"]);
});


/** Where the sheet in hand (or the two leaves at the opening) lands on the canvas once everything has come to rest:
    the room left on each side, in pixels. */
const roomAround = (page, opening = false) => page.evaluate(opening => {
  const d = View3D.mod.debug; d.settle();
  const r = document.querySelector("#v-three canvas").getBoundingClientRect();
  const panels = opening
    ? [d.V.model.leaves[d.V.opening - 1], d.V.model.leaves[d.V.opening]].filter(Boolean).flatMap(L => d.V.objs.get(L.e.id).panels.filter(m => m.userData.leaf.k === L.k))
    : d.V.objs.get(d.V.model.all[d.V.cur].id).panels;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const m of panels) {
    m.updateWorldMatrix(true, false);
    for (const [cx, cy] of [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]]) {
      const v = m.localToWorld(new m.position.constructor(cx, cy, 0)).project(d.camera);
      const x = (v.x + 1) / 2 * r.width, y = (1 - v.y) / 2 * r.height;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return { left: Math.round(x0), right: Math.round(r.width - x1), top: Math.round(y0), bottom: Math.round(r.height - y1) };
}, opening);
const centred = (room, what) => {
  expect(Math.min(room.left, room.right, room.top, room.bottom), `${what}: all of it is on the canvas ${JSON.stringify(room)}`).toBeGreaterThan(0);
  expect(Math.abs(room.left - room.right), `${what}: as much room left as right ${JSON.stringify(room)}`).toBeLessThanOrEqual(3);
  expect(Math.abs(room.top - room.bottom), `${what}: as much room above as below ${JSON.stringify(room)}`).toBeLessThanOrEqual(3);
};

test("a sheet you unfold lands in the middle of the view, however many folds are open, and with the inspector opening beside it", async ({ page }) => {
  await openThree(page);
  for (const id of ["71|72", "67|68", "85|86", "99|102"]) {
    // as a visitor does it: the sheet picked with the inspector closed, then U, which opens the inspector too
    await page.evaluate(id => { const d = View3D.mod.debug; d.putBack({ silent: true }); d.closeInspector(); d.setCur(d.V.model.all.findIndex(en => en.id === id)); }, id);
    await page.keyboard.press("u");
    await expect(page.locator("#v3-insp")).toBeVisible();
    centred(await roomAround(page), `${id} unfolded`);
    await page.keyboard.press("u");
    centred(await roomAround(page), `${id} folded up`);
    await page.evaluate(() => View3D.mod.debug.toggleFold(1, 0));
    centred(await roomAround(page), `${id} with one fold open`);
    await page.keyboard.press("t");
    centred(await roomAround(page), `${id} turned over`);
  }
});

test("the book opened at a foldout stays in the middle when it is unfolded, the Rosettes too", async ({ page }) => {
  await openThree(page);
  await page.evaluate(() => View3D.mod.debug.setMode("opening"));
  for (const o of [67, 71, 85, 86, 101]) {
    await page.evaluate(o => View3D.mod.debug.setOpening(o), o);
    await page.waitForTimeout(80);   // the view follows the opening on the next tick
    centred(await roomAround(page, true), `opening ${o}`);
    await page.keyboard.press("u");
    await page.waitForTimeout(80);
    centred(await roomAround(page, true), `opening ${o} unfolded`);
  }
});


test("in 3D a visible Unfold button comes up over the stage at a foldout, and only there", async ({ page }) => {
  await openThree(page);
  const btn = page.locator("#v3-fold");
  const pick = id => page.evaluate(id => { const d = View3D.mod.debug; d.putBack({ silent: true }); d.closeInspector(); d.setCur(d.V.model.all.findIndex(en => en.id === id)); }, id);
  await pick("1|8");
  await expect(btn).toBeHidden();
  await pick("71|72");
  await expect(btn).toBeVisible();
  await expect(btn).toContainText("Unfold");
  await btn.click();
  await page.evaluate(() => View3D.mod.debug.settle());
  expect(await foldAngles(page, "71|72")).toEqual(["72r1–72r2:0", "72r2–72r3:0", "the crease in 72r3:0"]);
  await expect(btn).toContainText("Fold up");
  await btn.click();
  await page.evaluate(() => View3D.mod.debug.settle());
  expect(await foldAngles(page, "71|72")).toEqual(["72r1–72r2:180", "72r2–72r3:180", "the crease in 72r3:180"]);
  // with the book open at a page: there at a foldout's opening, not at a plain one, and not where only half the Rose is
  await page.evaluate(() => { const d = View3D.mod.debug; d.putBack({ silent: true }); d.closeInspector(); d.setMode("opening"); d.setOpening(5); });
  await expect(btn).toBeHidden();
  await page.evaluate(() => View3D.mod.debug.setOpening(84));   // 84v | 85r1: the Rose is under leaf 85, not open here
  await expect(btn).toBeHidden();
  await page.evaluate(() => View3D.mod.debug.setOpening(85));   // 85r2 | 86v5: its centre
  await expect(btn).toBeVisible();
  await btn.click();
  await page.evaluate(() => View3D.mod.debug.settle());
  expect(await foldAngles(page, "85|86")).toEqual(["the top half:0", "columns 2–3:0", "the top half:0/0"]);
});

/** The paper round the folds, checked against the panels it joins, at each of the given points of the move under way
    (or as things stand): how many cross-section corners were checked, the worst gap between a corner and the panel end
    it should meet (a leaf is 0.4 thick), and how many folds were part-way open. Every hinge's bend must meet the ends
    of the panel it leaves and the flap it carries, and every sheet's band at the spine the spine edges of its leaves.
    `action` (a debug.act name) starts the move; it is started and read in the same breath, since it runs on its own. */
const foldJoins = (page, ks = [1], action = null) => page.evaluate(([ks, action]) => {
  if (action) { View3D.mod.debug.settle(); View3D.mod.debug.act(action); }
  return ks.map(k => {
    const d = View3D.mod.debug, t = d.CUR.t, h = t * .4, V3 = d.CAM.target.constructor, H = 100;
    d.settle(k);
    let worst = 0, n = 0, partWay = 0;
    const meet = (got, wants) => { n++; worst = Math.max(worst, Math.min(...wants.map(w => got.distanceTo(w)))); };
    const corner = (m, i, s, e, nb) => new V3().fromBufferAttribute(m.geometry.attributes.position, (s * (nb + 1) + i) * 2 + e).applyMatrix4(m.matrixWorld);
    for (const o of d.V.objs.values()) {
      let r = o.group; while (r.parent) r = r.parent; r.updateMatrixWorld(true);
      for (const L of o.leaves) for (const hg of L.hinges) for (const m of hg.bends) {
        if (!m.visible) continue;
        const a = Math.abs(hg.axis === "y" ? hg.outer.rotation.y : hg.outer.rotation.x);
        if (a > .2 && a < Math.PI - .2) partWay++;
        const nb = m.geometry.attributes.position.count / 8 - 1, z = m.userData.at * t, span = m.userData.span;
        // it leaves the panel at the hinge (in the panel's frame) and arrives at the flap's start (in the flap's)
        for (const [i, frame, from] of [[0, m.parent.matrixWorld, m.position], [nb, hg.inner.matrixWorld, new V3()]])
          for (const s of [0, 1]) for (const e of [0, 1])
            meet(corner(m, i, s, e, nb), [1, -1].map(side => (hg.axis === "y" ? new V3(from.x, span[e], z + side * h)
                                                                               : new V3(span[e], from.y, z + side * h)).applyMatrix4(frame)));
      }
      for (const f of [o.fold, o.fold2]) {
        if (!f?.visible) continue;
        // the Rose's top row: folded down, a layer inside each leaf; opened up, above it
        const x = f === o.fold2 ? Math.abs(o.leaves[0].hinges.find(hg => hg.axis === "x").outer.rotation.x) : 0;
        const z = x > 3 ? t : 0, y = f === o.fold2 && x < .1 ? H : 0, ns = f.userData.ns;
        for (const [i, L] of [[0, o.leaves[0]], [ns, o.leaves[1]]]) for (const s of [0, 1]) for (const e of [0, 1])
          meet(corner(f, i, s, e, ns), [1, -1].map(side => new V3(0, y + e * H, z + side * h).applyMatrix4(L.group.matrixWorld)));
      }
    }
    return { n, worst, partWay };
  });
}, [ks, action]);

// These look at the folding while it moves, so they let it move (the suite otherwise runs with reduced motion).
test.describe("while folding", () => {
  test.use({ reducedMotion: "no-preference" });

  test("in 3D the folds open one after another, and one fold opens with only the folds it needs", async ({ page }) => {
    await openThree(page);
    await pullOut(page, "71|72");
    await page.evaluate(() => View3D.mod.debug.settle());
    expect(await foldAngles(page, "71|72")).toEqual(["72r1–72r2:180", "72r2–72r3:180", "the crease in 72r3:180"]);
    // the list of folds beside the sheet: open the second, and the first opens with it
    const rows = page.locator("#v3-insp .fold-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText("out");
    await rows.nth(1).getByRole("button", { name: "Unfold" }).click();
    await page.evaluate(() => View3D.mod.debug.settle());
    expect(await foldAngles(page, "71|72")).toEqual(["72r1–72r2:0", "72r2–72r3:0", "the crease in 72r3:180"]);
    await expect(rows.nth(2).getByRole("button")).toHaveText("Unfold");
    // the folds half-way through a move, read in the same breath as stopping it there (the animation is running)
    const halfWay = () => page.evaluate(() => {
      const d = View3D.mod.debug, L = d.V.objs.get("71|72").leaves[1]; d.act("unfold"); d.settle(.5);
      const now = L.steps.map(st => Math.round(Math.abs(L.hinges[st.hs[0]].outer.rotation.y) * 180 / Math.PI));
      d.settle(); return now;
    });
    // Fold up closes the last-opened fold first
    expect(await halfWay()).toEqual([0, 180, 180]);
    // Unfold opens from the spine outward
    expect(await halfWay()).toEqual([0, 90, 180]);
  });

  test("a sheet rises clear of the block before it unfolds, and folds up before it goes back", async ({ page }) => {
    await openThree(page);
    await page.evaluate(() => { const d = View3D.mod.debug; d.setCur(d.V.model.all.findIndex(en => en.id === "71|72")); });
    /* The sheet part-way through its move: how high it is, how folded. The key goes in and the move is stopped in one
       go, since it is running: on a busy machine it could otherwise be over before it is looked at. */
    const at = (k, key = null) => page.evaluate(([k, key]) => {
      if (key) document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      const d = View3D.mod.debug, o = d.V.objs.get("71|72"); d.settle(k);
      return { y: Math.round(o.group.position.y), folds: o.leaves[1].steps.map(st => Math.round(Math.abs(o.leaves[1].hinges[st.hs[0]].outer.rotation.y) * 180 / Math.PI)) };
    }, [k, key]);
    const low = (await at(1)).y;
    const early = await at(.22, "u");
    expect(early.folds, "still folded while it rises").toEqual([180, 180, 180]);
    const up = await at(1);
    expect(early.y, "and by then nearly at its full height").toBeGreaterThan(low + .8 * (up.y - low));
    expect(up.folds).toEqual([0, 0, 0]);
    const late = await at(.74, "Escape");   // just before it starts down: the folds have had their share of the time
    expect(late.y, "going back, it has not started down").toBe(up.y);
    expect(late.folds, "but is folded up again").toEqual([180, 180, 180]);
  });

  test("the Rose's top half lifts in one piece: part-way up, its three panels are at one angle and the column is already out", async ({ page }) => {
    await openThree(page);
    await pullOut(page, "85|86");
    const mid = await page.evaluate(() => {
      const d = View3D.mod.debug, o = d.V.objs.get("85|86"); d.settle(); d.act("unfold"); d.settle(.8);
      const deg = r => Math.round(Math.abs(r) * 180 / Math.PI);
      return { rows: o.leaves.flatMap(L => L.hinges.filter(hg => hg.axis === "x").map(hg => deg(hg.outer.rotation.x))),
               cols: o.leaves.flatMap(L => L.hinges.filter(hg => hg.axis === "y").map(hg => deg(hg.outer.rotation.y))),
               flat: o.leaves.map(L => Math.round(L.group.rotation.y * 180 / Math.PI)) };
    });
    expect(new Set(mid.rows).size, `top panels at ${mid.rows}`).toBe(1);
    expect(mid.rows[0]).toBeGreaterThan(0); expect(mid.rows[0]).toBeLessThan(180);
    expect(mid.cols, "the column is fully out before the top half moves").toEqual([0]);
    expect(mid.flat, "and the sheet is held flat, so the strip is unbroken at the spine").toEqual([0, 0]);
  });

  test("the paper round every fold meets the panels on either side of it, folded, part-way and open", async ({ page }) => {
    await openThree(page);
    const [shut] = await foldJoins(page);
    expect(shut.n, "every sheet's fold at the spine and every folded flap's bend is drawn").toBeGreaterThan(600);
    expect(shut.worst).toBeLessThan(1e-3);
    for (const id of ["71|72", "67|68", "85|86"]) {
      await pullOut(page, id);
      const moving = await foldJoins(page, [.25, .5, .75, .9, 1], "unfold");
      expect(moving.map(m => m.worst).every(w => w < 1e-3), `${id}: worst gaps ${moving.map(m => m.worst)}`).toBe(true);
      expect(moving.some(m => m.partWay), `${id} was caught part-way`).toBe(true);
      await page.evaluate(() => { const d = View3D.mod.debug; d.settle(); d.putBack({ silent: true }); d.settle(); });
    }
  });

  test("in the Reader each flap swings the way it folds: 72r2 toward you, 72r3 back away from it", async ({ page }) => {
    await openSite(page, "#read/beinecke/72r1");
    await page.waitForFunction(() => typeof R !== "undefined" && R.spreads && document.querySelector("#rd-zoomer .spread"));
    await readerPicturesLoaded(page);   // the opening is drawn and will not be drawn again under the animation
    expect(await page.evaluate(() => [foldWay("71|72", "f72r1", "f72r2"), foldWay("71|72", "f72r2", "f72r3"), foldWay("71|72", "f72v1", "f72v2")]))
      .toEqual([1, -1, -1]);   // seen from the outside face, the fold that goes in turns away
    const z = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 200 && (R.busy || R.queue.length); i++) await wait(30);   // the Reader is free
      const done = Reader.setUnfold({ L: false, R: true }, { speed: 6 });
      // how far each flap's free edge has come toward you (+) or gone away (-) from the edge it hangs on
      const lift = () => Object.fromEntries([...document.querySelectorAll(".rd-page.right .seg.ext")].map(el => {
        const t = getComputedStyle(el).transform, m = new DOMMatrix(t === "none" ? undefined : t);
        return [el.title, m.transformPoint(new DOMPoint(el.offsetWidth, 0, 0)).z - m.transformPoint(new DOMPoint(0, 0, 0)).z];
      }));
      let seen = null;
      for (let i = 0; i < 160 && R.busy; i++) {   // a frame where 72r2 is plainly turning
        const now = lift(), w = document.querySelector('.rd-page.right .seg.ext[title="f72r2"]').offsetWidth;
        if (Math.abs(now["f72r2"]) > .3 * w) { seen = now; break; }
        await wait(25);
      }
      await done;
      return seen;
    });
    expect(z, "the unfolding was seen under way").not.toBeNull();
    expect(z["f72r2"], "72r2's free edge comes toward you").toBeGreaterThan(0);
    expect(z["f72r3"], "72r3's free edge goes back from 72r2's").toBeLessThan(0);
  });
});
