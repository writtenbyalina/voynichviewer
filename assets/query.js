/* Text's query language (docs/TEXT.md section 5): parse a query, say it back in words, and compile it to a regular
   expression over a line of text. Shared by the Text tab (search.js) and its worker (search-worker.js).

   A line is Eva with IVTFF's separators: "." a space, "," an uncertain space. Eva is lowercase, so capitals, brackets
   and symbols are free for the syntax:
     qokeedy        the whole word                 chol daiin     two words in a row
     qok*  *dy      any run of glyphs in a word     ch?dy          any one glyph
     [kt]eedy       either glyph                   <gallows>      a named class (gallows, bench, pedestal, loop, unread)
     dy-qo          joined, inside one word         dy_qo          across a word break
     dy~qo          joined or not                   ^qo*  *dy$     first / last word of a line
     A A            the same word twice in a row (a capital stands for a word; A:qok* says which)
     /qo[kt]e+dy/   a regular expression over the line
     scribe:2 lang:B section:balneo quire:13 in:label at:para-start page:f75r-f84v set:mine      filters */

export const CLASSES = {
  gallows: { re: "(?:k|t|p|f)", say: "a gallows (k t p f)" },
  bench: { re: "(?:ch|sh)", say: "a bench (ch sh)" },
  pedestal: { re: "(?:ckh|cth|cph|cfh)", say: "a pedestal gallows (ckh cth cph cfh)" },
  loop: { re: "(?:o|a|y)", say: "a loop (o a y)" },
  unread: { re: "\\?", say: "an unreadable glyph" },
};
/* Zandbergen's STA families: glyphs one stroke apart that transcribers often tell apart differently */
export const FAMILY = { o: "oay", a: "oay", y: "oay", d: "dlmg", l: "dlmg", m: "dlmg", g: "dlmg", r: "rs", s: "rs",
  k: "kt", t: "kt", p: "pf", f: "pf" };
export const QUALIFIERS = { scribe: "scribe", hand: "scribe", lang: "lang", language: "lang", section: "section",
  quire: "quire", in: "in", at: "at", page: "page", pages: "page", set: "set" };
const GLYPH = "(?:@\\d+;|c[ktpf]h|[cs]h|[a-z?])";   // one glyph: a bench or a pedestal is one, other Eva letters each one

export class QueryError extends Error {}

/* A query as { regex, terms: [{ kind: "seq", items: [...] }], filters: [[key, value], ...] } */
export function parse(q) {
  q = String(q || "").trim();
  const out = { regex: null, items: [], filters: [], text: q };
  if (!q) return out;
  let rest = q;
  const rx = q.match(/^\/(.+)\/([a-z]*)(\s|$)/);
  if (rx) {
    try { new RegExp(rx[1]); } catch (e) { throw new QueryError("That regular expression does not work: " + e.message); }
    out.regex = rx[1];
    rest = q.slice(rx[0].length);
  }
  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    const qm = tok.match(/^([a-z]+):(.+)$/);
    if (qm && QUALIFIERS[qm[1]]) { out.filters.push([QUALIFIERS[qm[1]], qm[2].toLowerCase()]); continue; }
    if (qm) throw new QueryError(`“${qm[1]}:” is not a filter. Filters: scribe:, lang:, section:, quire:, in:, at:, page:, set:`);
    if (out.regex) throw new QueryError("After a regular expression only filters can follow");
    out.items.push(token(tok));
  }
  return out;
}

/* one space-separated token: a variable (A, A:qok*) or parts joined by - _ ~ */
function token(tok) {
  const v = tok.match(/^([A-Z])(?::(.+))?$/);
  if (v) return { kind: "var", name: v[1], of: v[2] ? token(v[2]) : null };
  if (/[A-Z]/.test(tok)) throw new QueryError(`Capitals stand for whole words (A A finds a word twice in a row); “${tok}” mixes them with glyphs`);
  const parts = [], joins = [];
  let start = false, end = false, t = tok;
  if (t.startsWith("^")) { start = true; t = t.slice(1); }
  if (t.endsWith("$")) { end = true; t = t.slice(0, -1); }
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "[") { const j = t.indexOf("]", i); if (j < 0) throw new QueryError("A [ has no ]"); cur += t.slice(i, j + 1); i = j; continue; }
    if (ch === "<") { const j = t.indexOf(">", i); if (j < 0) throw new QueryError("A < has no >"); cur += t.slice(i, j + 1); i = j; continue; }
    if ("-_~".includes(ch)) { if (!cur) throw new QueryError(`“${ch}” joins two parts: put something before it`); parts.push(pieces(cur)); joins.push(ch); cur = ""; continue; }
    cur += ch;
  }
  if (!cur) throw new QueryError(`“${tok}” ends with a joiner: put something after it`);
  parts.push(pieces(cur));
  return { kind: "word", parts, joins, start, end, whole: joins.length === 0 };
}

/* a part: glyphs, * runs, ? glyphs, [..] sets, <class> */
function pieces(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "*") out.push({ k: "run" });
    else if (ch === "?") out.push({ k: "any" });
    else if (ch === "[") {
      const j = s.indexOf("]", i), set = s.slice(i + 1, j);
      if (!/^[a-z?]+$/.test(set)) throw new QueryError(`[${set}] should list glyphs, like [kt]`);
      out.push({ k: "set", set }); i = j;
    } else if (ch === "<") {
      const j = s.indexOf(">", i), name = s.slice(i + 1, j).toLowerCase();
      if (!CLASSES[name]) throw new QueryError(`<${name}> is not a class. Classes: ${Object.keys(CLASSES).map(c => `<${c}>`).join(" ")}`);
      out.push({ k: "class", name }); i = j;
    } else if (ch === "@") {
      const m = s.slice(i).match(/^@\d+;/);
      if (!m) throw new QueryError("A rare glyph is written @ and its number and ;, like @169;");
      out.push({ k: "lit", s: m[0] }); i += m[0].length - 1;
    } else if (/[a-z]/.test(ch)) out.push({ k: "lit", s: ch });
    else throw new QueryError(`“${ch}” means nothing here. Eva is lowercase; * ? [ ] < > - _ ~ ^ $ have meanings`);
  }
  return out;
}

/* ---- compiling ---- */
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Settings: sp "either" (an uncertain space may or may not be one; the default), "space" (it is one), "none" (no
   spaces at all: one stream of glyphs); eq "eva" (exact) or "family" (STA families alike). */
export function compile(p, { sp = "either", eq = "eva" } = {}) {
  if (p.regex) return new RegExp(p.regex, "g");
  if (!p.items.length) return null;
  const S = {
    gs: sp === "either" ? ",?" : sp === "none" ? "[.,]?" : "",          // between glyphs of a word
    brk: sp === "none" ? "[.,]?" : "[.,]",                                // a word break
    join: sp === "either" ? ",?" : sp === "none" ? "[.,]?" : "",        // joined (-)
    either: "[.,]?",                                                    // either (~)
    run: sp === "space" ? "[^.,]*" : sp === "either" ? "[^.]*" : "[^]*?", // * in a word
    word: sp === "space" ? "[^.,]+" : sp === "either" ? "[^.]+?" : "[^.,]+",
    b0: sp === "none" ? "" : "(?<![^.,])", b1: sp === "none" ? "" : "(?![^.,])",
  };
  const lit = ch => eq === "family" && FAMILY[ch] ? `[${FAMILY[ch]}]` : esc(ch);
  const part = ps => ps.map(x => {
    if (x.k === "run") return S.run;
    if (x.k === "any") return GLYPH;
    if (x.k === "set") return "[" + [...new Set([...x.set].flatMap(c => eq === "family" && FAMILY[c] ? [...FAMILY[c]] : [c]))].map(c => c === "?" ? "\\?" : c).join("") + "]";
    if (x.k === "class") return CLASSES[x.name].re;
    return x.s.length > 1 ? esc(x.s) : lit(x.s);
  }).join(S.gs);
  const seen = new Set();
  const item = it => {
    if (it.kind === "var") {
      if (seen.has(it.name)) return `${S.b0}\\k<${it.name}>${S.b1}`;
      seen.add(it.name);
      return `${S.b0}(?<${it.name}>${it.of ? item({ ...it.of, start: false, end: false, bare: true }) : S.word})${S.b1}`;
    }
    let re = part(it.parts[0]);
    it.joins.forEach((j, k) => { re += (j === "-" ? S.join : j === "_" ? S.brk : S.either) + part(it.parts[k + 1]); });
    if (it.bare) return re;
    const open0 = !it.whole && !it.start, open1 = !it.whole && !it.end;
    return (it.start ? "^" : open0 ? "" : S.b0) + re + (it.end ? "$" : open1 ? "" : S.b1);
  };
  const re = p.items.map(item).join(S.brk);
  try { return new RegExp(re, "g"); } catch (e) { throw new QueryError("That query cannot be searched: " + e.message); }
}

/* ---- saying it back in words ---- */
function sayPart(ps) {
  const lits = ps.every(x => x.k === "lit");
  if (lits) return { strong: ps.map(x => x.s).join(""), plain: null };
  const bits = [];
  let run = "";
  const flush = () => { if (run) bits.push(["b", run]); run = ""; };
  for (const x of ps) {
    if (x.k === "lit") { run += x.s; continue; }
    flush();
    bits.push(["t", x.k === "run" ? "any glyphs" : x.k === "any" ? "any one glyph" : x.k === "set" ? `${[...x.set].join(" or ")}` : CLASSES[x.name].say]);
  }
  flush();
  return { bits };
}
/* parts of a sentence: [["t", text], ["b", bold], ...] */
export function describe(p) {
  if (p.regex) return [["t", "the regular expression "], ["b", "/" + p.regex + "/"], ["t", " over each line (a space is “.”, an uncertain space “,”)"]];
  const out = [];
  const add = (...xs) => out.push(...xs);
  p.items.forEach((it, i) => {
    if (i) add(["t", ", then "]);
    if (it.kind === "var") {
      if (p.items.slice(0, i).some(x => x.kind === "var" && x.name === it.name)) { add(["t", "the same word "], ["b", it.name], ["t", " again"]); return; }
      add(["t", "a word "], ["b", it.name]);
      if (it.of) { add(["t", " ("]); out.push(...describe({ items: [it.of] })); add(["t", ")"]); }
      return;
    }
    const ps = it.parts;
    if (it.whole) {
      const x = ps[0], first = x[0], last = x[x.length - 1];
      const lits = x.filter(y => y.k === "lit").map(y => y.s).join("");
      if (x.every(y => y.k === "lit")) add(["t", "the word "], ["b", lits]);
      else if (first.k === "run" && last.k === "run" && x.slice(1, -1).every(y => y.k === "lit")) add(["t", "words that "], ["b", "contain " + x.slice(1, -1).map(y => y.s).join("")]);
      else if (last.k === "run" && x.slice(0, -1).every(y => y.k === "lit")) add(["t", "words that "], ["b", "begin with " + x.slice(0, -1).map(y => y.s).join("")]);
      else if (first.k === "run" && x.slice(1).every(y => y.k === "lit")) add(["t", "words that "], ["b", "end with " + x.slice(1).map(y => y.s).join("")]);
      else { add(["t", "a word of "]); sayPart(x).bits.forEach((b, k) => add(...(k ? [["t", ", "]] : []), b)); }
    } else {
      ps.forEach((x, k) => {
        const s = sayPart(x);
        if (s.strong) add(["b", s.strong]); else s.bits.forEach((b, n) => add(...(n ? [["t", ", "]] : []), b));
        if (k > 0 && it.joins[k - 1] === "_") add(["t", " starting the next"]);
        if (k < it.joins.length) add(["t", it.joins[k] === "-" ? " joined to " : it.joins[k] === "_" ? " at a word's end, " : " then, joined or not, "]);
      });
    }
    if (it.start) add(["t", ", first in a line"]);
    if (it.end) add(["t", ", last in a line"]);
  });
  return out;
}

/* Near matches: a word within so many edits of another, where an edit inside an STA family (a/o, r/s, k/t) costs half */
export function nearCost(a, b) {
  const m = a.length, n = b.length;
  const D = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) D[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const x = a[i - 1], y = b[j - 1];
    const sub = x === y ? 0 : FAMILY[x] && FAMILY[x].includes(y) ? 0.5 : 1;
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + sub);
  }
  return D[m][n];
}
