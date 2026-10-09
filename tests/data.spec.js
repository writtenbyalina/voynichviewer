// Data checks: no browser needed, they read the JSON files and the page images straight from disk.
// These catch the quiet failures: a sheet that points at a page image that is not there, an order that lists a sheet
// twice, a typo in a source key, a changelog entry with a bad date. After a refresh from Voynich Scout
// (tools/import_from_scout.py) or an edit of orders.json, this is what tells you whether you broke something.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const codex = read("data/codex.json");
const orders = read("data/orders.json");
const changelog = read("data/changelog.json");

const sheetIds = new Set(codex.sheets.map(s => s.id));
const segments = [];   // every page panel of every sheet, with where it sits
for (const s of codex.sheets) for (const face of ["inside", "outside"]) for (const row of s[face]) for (const seg of row) segments.push({ sheet: s.id, face, seg });

test.describe("data files", () => {
  test("codex.json, orders.json and changelog.json are valid and have the shape the viewer expects", () => {
    expect(Array.isArray(codex.sheets) && codex.sheets.length, "codex.sheets").toBeGreaterThan(0);
    expect(Array.isArray(codex.quires) && codex.quires.length, "codex.quires").toBeGreaterThan(0);
    expect(codex.folio_table?.folios, "codex.folio_table.folios").toBeTruthy();
    expect(Array.isArray(orders.orders) && orders.orders.length, "orders.orders").toBeGreaterThan(0);
    expect(orders.sources && typeof orders.sources === "object", "orders.sources").toBeTruthy();
    expect(orders.evidence && typeof orders.evidence === "object", "orders.evidence").toBeTruthy();
    expect(Array.isArray(changelog.releases) && changelog.releases.length, "changelog.releases").toBeGreaterThan(0);
  });
});

test.describe("sheets and pages (codex.json)", () => {
  test("sheet ids are unique and agree with the leaves they name", () => {
    const seen = new Set();
    for (const s of codex.sheets) {
      expect(seen.has(s.id), `duplicate sheet ${s.id}`).toBe(false);
      seen.add(s.id);
      expect(s.leaves, `sheet ${s.id}: leaves`).toEqual(s.id.split("|").map(Number));
    }
  });

  test("every sheet belongs to a quire that exists", () => {
    const quires = new Set(codex.quires.map(q => q.q));
    for (const s of codex.sheets) expect(quires.has(s.quire), `sheet ${s.id} is in quire ${s.quire}`).toBe(true);
  });

  test("each sheet's inside and outside have the same shape, and the spine falls inside the sheet", () => {
    for (const s of codex.sheets) {
      const n = s.inside[0].length;
      for (const face of ["inside", "outside"]) for (const row of s[face]) expect(row.length, `sheet ${s.id} ${face}: ragged row`).toBe(n);
      expect(s.outside.length, `sheet ${s.id}: inside and outside rows`).toBe(s.inside.length);
      expect(Number.isInteger(s.spine) && s.spine >= 1 && s.spine < n, `sheet ${s.id}: spine ${s.spine} of ${n} panels`).toBe(true);
      if (s.proper_row != null) expect(s.proper_row >= 0 && s.proper_row < s.inside.length, `sheet ${s.id}: proper_row`).toBe(true);
    }
  });

  test("every present panel has what the viewer needs to draw it", () => {
    for (const { sheet, seg } of segments) {
      expect(seg.page, `sheet ${sheet}: a panel has no page name`).toBeTruthy();
      if (seg.missing) continue;   // a lost leaf is drawn as a blank "lost" page
      const at = `${seg.page} (sheet ${sheet})`;
      expect(seg.img, `${at}: img`).toBeTruthy();
      expect(seg.w > 0 && seg.h > 0, `${at}: width and height`).toBe(true);
      expect(seg.iiif, `${at}: Yale image id (needed by the crop tool)`).toBeTruthy();
      expect(seg.quad?.length, `${at}: crop corners`).toBe(4);
      for (const [x, y] of seg.quad) {
        expect(x >= 0 && y >= 0 && x <= seg.src_size[0] && y <= seg.src_size[1], `${at}: crop corner (${x}, ${y}) is outside Yale's ${seg.src_size} photograph`).toBe(true);
      }
    }
  });
});

test.describe("page images (data/panels)", () => {
  const keys = [...new Set(segments.filter(({ seg }) => !seg.missing).map(({ seg }) => seg.img))];

  test("every panel has both its large (_l) and small (_s) picture", () => {
    const missing = [];
    for (const k of keys) for (const size of ["l", "s"]) if (!fs.existsSync(path.join(ROOT, "data/panels", `${k}_${size}.jpg`))) missing.push(`${k}_${size}.jpg`);
    expect(missing, "pictures the codex asks for that are not in data/panels").toEqual([]);
  });

  test("every picture is a complete JPEG, not empty or cut short", () => {
    const bad = [];
    for (const f of fs.readdirSync(path.join(ROOT, "data/panels"))) {
      if (!f.endsWith(".jpg")) { bad.push(`${f}: not a .jpg`); continue; }
      const b = fs.readFileSync(path.join(ROOT, "data/panels", f));
      const starts = b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
      const ends = b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;   // a JPEG that was cut short loses its end marker
      if (!starts || !ends) bad.push(`${f}: ${b.length} bytes, ${!starts ? "does not start like a JPEG" : "ends too early"}`);
    }
    expect(bad).toEqual([]);
  });

  test("no picture is left over for a panel that no longer exists", () => {
    // by panel, whatever sizes there are (_l and _s today, others may be added): a leftover is a picture whose panel is gone
    const used = new Set(keys);
    const extra = fs.readdirSync(path.join(ROOT, "data/panels")).filter(f => !used.has(f.replace(/_[a-z]+\.jpg$/, "")));
    expect(extra, "files in data/panels that codex.json has no panel for (delete them, or they bloat the site)").toEqual([]);
  });
});

test.describe("reading orders (orders.json)", () => {
  const byId = new Map(orders.orders.map(o => [o.id, o]));

  test("order ids are unique and each order has a title", () => {
    expect(byId.size, "duplicate order ids").toBe(orders.orders.length);
    for (const o of orders.orders) expect(o.title, `order ${o.id}: title`).toBeTruthy();
  });

  // Resolve an order the way the viewer does: `base` copies another order, `replace` swaps in gatherings by quire.
  function resolve(o, trail = []) {
    expect(trail.includes(o.id), `order ${o.id}: base chain loops (${[...trail, o.id].join(" → ")})`).toBe(false);
    if (!o.base) return o.gatherings;
    const base = byId.get(o.base);
    expect(base, `order ${o.id}: base "${o.base}" does not exist`).toBeTruthy();
    const gs = resolve(base, [...trail, o.id]);
    const quires = new Set(gs.map(g => g.quire));
    for (const r of o.replace || []) expect(quires.has(r.quire), `order ${o.id}: replaces quire ${r.quire}, which its base does not have`).toBe(true);
    const rep = new Map((o.replace || []).map(g => [g.quire, g]));
    return gs.map(g => rep.get(g.quire) || g);
  }

  for (const o of orders.orders) {
    test(`order "${o.id}": every gathering is well formed, every sheet exists and none is used twice`, () => {
      const gatherings = resolve(o);
      expect(gatherings.length, "gatherings").toBeGreaterThan(0);
      const seen = new Map();
      for (const g of gatherings) {
        expect(["nested", "singulions"], `quire ${g.quire}: type "${g.type}"`).toContain(g.type);
        expect(g.bifolia.length, `quire ${g.quire}: sheets`).toBeGreaterThan(0);
        for (const id of g.bifolia) {
          expect(sheetIds.has(id), `quire ${g.quire}: sheet "${id}" is not in codex.json`).toBe(true);
          expect(seen.has(id), `sheet ${id} is in quire ${seen.get(id)} and again in quire ${g.quire}`).toBe(false);
          seen.set(id, g.quire);
        }
        for (const [id, opt] of Object.entries(g.sheets || {})) {
          expect(g.bifolia.includes(id), `quire ${g.quire}: options for ${id}, which is not in that gathering`).toBe(true);
          const n = codex.sheets.find(s => s.id === id).inside[0].length;
          for (const k of Object.keys(opt)) expect(["spine", "inside_out", "rot180"], `sheet ${id}: unknown option "${k}"`).toContain(k);
          if (opt.spine != null) expect(Number.isInteger(opt.spine) && opt.spine >= 1 && opt.spine < n, `sheet ${id}: spine ${opt.spine} of ${n} panels`).toBe(true);
        }
      }
      for (const id of o.unplaced || []) expect(sheetIds.has(id), `unplaced sheet "${id}" is not in codex.json`).toBe(true);
    });
  }

  test("evidence notes name real sheets and cite real sources", () => {
    for (const [sheet, notes] of Object.entries(orders.evidence)) {
      expect(sheetIds.has(sheet), `evidence is for sheet "${sheet}", which is not in codex.json`).toBe(true);
      for (const n of notes) {
        expect(orders.sources[n.src], `evidence for ${sheet} cites source "${n.src}", which is not in "sources"`).toBeTruthy();
        expect(n.text, `evidence for ${sheet}: empty text`).toBeTruthy();
      }
    }
  });

  test("every source an order lists exists, and every source has a citation", () => {
    for (const o of orders.orders) for (const k of o.sources || []) expect(orders.sources[k], `order ${o.id} lists source "${k}"`).toBeTruthy();
    for (const [k, s] of Object.entries(orders.sources)) {
      expect(s.cite, `source ${k}: cite`).toBeTruthy();
      if (s.url) expect(s.url, `source ${k}: url`).toMatch(/^https?:\/\//);
    }
  });
});

test.describe("what's new (changelog.json)", () => {
  const vnum = v => v.split(".").map(Number);
  const newer = (a, b) => { const [x, y] = [vnum(a), vnum(b)]; for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

  test("releases are newest first, with real versions and dates", () => {
    const { releases } = changelog;
    releases.forEach((r, i) => {
      expect(r.version, `release ${i}: version`).toMatch(/^\d+\.\d+(\.\d+)?$/);
      // from 1.5.1 on, each change is one short line (older notes were written before that rule)
      if (r.date >= "2026-10-10") for (const c of r.changes) expect(c.text.length, `release ${r.version}: "${c.text}" is more than a line`).toBeLessThanOrEqual(110);
      expect(r.date, `release ${r.version}: date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(r.date + "T00:00:00Z").toISOString().slice(0, 10), `release ${r.version}: ${r.date} is not a real date`).toBe(r.date);
      if (i > 0) {
        expect(newer(releases[i - 1].version, r.version), `${releases[i - 1].version} should come before ${r.version} (newest first)`).toBe(true);
        expect(releases[i - 1].date >= r.date, `${releases[i - 1].version} is dated before the older ${r.version}`).toBe(true);
      }
    });
  });

  test("every change has a known kind and some text", () => {
    for (const r of changelog.releases) {
      expect(r.changes.length, `release ${r.version}: no changes listed`).toBeGreaterThan(0);
      for (const c of r.changes) {
        expect(["new", "improved", "fixed"], `release ${r.version}: kind "${c.kind}"`).toContain(c.kind);
        expect(c.text?.trim().length, `release ${r.version}: a change has no text`).toBeGreaterThan(0);
      }
    }
  });

  test("the version is the same everywhere: changelog, the badge in index.html, and APP_VERSION in app.js", () => {
    const latest = changelog.releases[0].version;
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const js = fs.readFileSync(path.join(ROOT, "assets/app.js"), "utf8");
    const badge = html.match(/id="cx-ver"[^>]*>\s*v([\d.]+)\s*</)?.[1];
    const app = js.match(/const APP_VERSION = "([\d.]+)"/)?.[1];
    expect({ changelog: latest, badge: badge, APP_VERSION: app }, "a release bumps all three together").toEqual({ changelog: latest, badge: latest, APP_VERSION: latest });
  });
});
