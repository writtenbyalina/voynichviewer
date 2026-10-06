"""
IVTFF 2.0 parser for Voynich MS transliteration files.

Spec: R. Zandbergen, "IVTFF - Intermediate Voynich MS Transliteration File Format",
      file format version 2.0.1, document issue 2.0.2, 08/07/2025.
      http://www.voynich.nu/software/ivtt/IVTFF_format.pdf
Data: http://www.voynich.nu/data/   (see data/PROVENANCE_transliterations.txt)

Design notes (explicit conventions -- these are CHOICES, recorded so results are reproducible):
  * `[a:b:c]`  uncertain reading -> primary = first option; all options preserved in
               Locus.uncertain as (char_index, [options]).
  * `{xyz}`    ligature -> the enclosed characters are kept in the character stream and
               the span is recorded in Locus.ligatures. NOTHING is silently dropped.
  * `@NNN;`    high-ascii (rare/extended glyph) -> kept as a single token '@NNN;'.
  * `?`        one unreadable character -> kept as token '?'. `???` -> token '???'.
  * `.`        certain word space; `,` uncertain word space;
    `<->`/`<~>` drawing-interrupted space (implies a word space per spec 6.7).
  * `<%>`/`<$>` paragraph start/end.
  * `<!...>`   free textual comment -> stripped from text, retained in Locus.comments.
  * `<@X=y>`   text tag -> applied to the current and following loci on the page.
  * `/`        line-continuation wrapping -> lines are joined before parsing.

No sound values are assigned anywhere. EVA characters are labels for shapes.
"""
import re, sys, os, json
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional

SPACE_CERTAIN   = '.'
SPACE_UNCERTAIN = ','
SPACE_DRAWING   = '-'   # from <-> and <~>

@dataclass
class Locus:
    page: str
    num: int
    locator: str              # @ + * = & ~ / !
    locus_type: str           # e.g. P0, Lp, Cc, Ri
    transcriber: Optional[str]
    text_raw: str             # the raw text field, comments included
    tokens: List[str]         # character-level tokens incl. space markers
    words: List[List[str]]    # words, each a list of character tokens
    word_seps: List[str]      # separator that FOLLOWS each word (len == len(words)-1 or same)
    pagevars: Dict[str, str]  # effective page variables + text tags at this locus
    comments: List[str] = field(default_factory=list)
    uncertain: List[Tuple[int, List[str]]] = field(default_factory=list)
    ligatures: List[Tuple[int, int]] = field(default_factory=list)
    para_start: bool = False
    para_end: bool = False
    line_no: int = 0          # source file line number

    @property
    def generic_type(self): return self.locus_type[0]
    @property
    def id(self): return f"{self.page}.{self.num},{self.locator}{self.locus_type}"

@dataclass
class Page:
    name: str
    pagevars: Dict[str, str]
    comments: List[str] = field(default_factory=list)
    loci: List[Locus] = field(default_factory=list)

PAGE_HDR_RE  = re.compile(r'^<(?P<page>[^.,>]+)>\s*(?:<!\s*(?P<vars>[^>]*)>)?\s*$')
LOCUS_RE     = re.compile(r'^<(?P<page>[^.,>]+)\.(?P<num>\d+),(?P<locator>[@+*=&~/!])(?P<type>[A-Z][a-z0-9])(?:;(?P<tr>.))?>(?P<text>.*)$')
VAR_RE       = re.compile(r'\$([A-Z])=(\S)')

class ParseError(Exception): pass

def _tokenize(text: str):
    """Split the transliterated text field into tokens, pulling out comments/tags.
    Returns (tokens, comments, uncertain, ligature_spans, para_start, para_end, tagsets)."""
    tokens, comments, uncertain, ligs, tagsets = [], [], [], [], []
    para_start = para_end = False
    i, n = 0, len(text)
    lig_open = None
    while i < n:
        c = text[i]
        if c == '<':
            j = text.find('>', i)
            if j < 0:
                raise ParseError(f"unclosed '<' in: {text!r}")
            body = text[i+1:j]
            if body.startswith('!'):
                comments.append(body[1:])
            elif body.startswith('@'):
                m = re.fullmatch(r'@([A-Z])=(.)', body)
                if m: tagsets.append((m.group(1), m.group(2)))
                else: comments.append(body)
            elif body == '%':
                para_start = True
            elif body == '$':
                para_end = True
            elif body in ('-', '~'):
                tokens.append(SPACE_DRAWING)
            else:
                comments.append(body)
            i = j + 1
        elif c == '@':
            m = re.match(r'@(\d{3});', text[i:])
            if not m:
                raise ParseError(f"bad high-ascii at {i} in {text!r}")
            tokens.append(m.group(0))
            i += m.end()
        elif c == '[':
            j = text.find(']', i)
            if j < 0: raise ParseError(f"unclosed '[' in {text!r}")
            opts = text[i+1:j].split(':')
            # primary = first option; it may itself be multi-character
            prim = opts[0]
            uncertain.append((len(tokens), opts))
            tokens.extend(_plain_tokens(prim))
            i = j + 1
        elif c == '{':
            j = text.find('}', i)
            if j < 0: raise ParseError(f"unclosed '{{' in {text!r}")
            inner = text[i+1:j]
            start = len(tokens)
            tokens.extend(_plain_tokens(inner))
            ligs.append((start, len(tokens)))
            i = j + 1
        elif c == '?':
            if text[i:i+3] == '???':
                tokens.append('???'); i += 3
            else:
                tokens.append('?'); i += 1
        elif c in '.,':
            tokens.append(c); i += 1
        elif c in ' \t':
            i += 1
        elif c == '!':
            # in some files '!' is a filler/null character inside text; keep as token
            tokens.append('!'); i += 1
        else:
            tokens.append(c); i += 1
    return tokens, comments, uncertain, ligs, para_start, para_end, tagsets

def _plain_tokens(s: str):
    out, i = [], 0
    while i < len(s):
        m = re.match(r'@(\d{3});', s[i:])
        if m:
            out.append(m.group(0)); i += m.end()
        elif s[i] in '{}':
            i += 1
        else:
            out.append(s[i]); i += 1
    return out

SPACERS = {SPACE_CERTAIN, SPACE_UNCERTAIN, SPACE_DRAWING}

def _split_words(tokens):
    words, seps, cur = [], [], []
    for t in tokens:
        if t in SPACERS:
            if cur: words.append(cur); seps.append(t); cur = []
            elif words: seps[-1] = t      # collapse doubled separators
        else:
            cur.append(t)
    if cur: words.append(cur); seps.append('')
    if seps and len(seps) == len(words): seps[-1] = ''
    return words, seps

def parse(path: str, strict=False) -> List[Page]:
    pages, cur_page = [], None
    tags: Dict[str, str] = {}
    pending_comments: List[str] = []
    with open(path, 'r', encoding='latin-1') as fh:
        raw_lines = fh.read().split('\n')
    # join continuation lines ending in '/'
    lines, buf, bufno = [], None, 0
    for ln, line in enumerate(raw_lines, 1):
        line = line.rstrip('\r\n')
        if buf is not None:
            if line.startswith('/'):
                buf += line[1:].rstrip()
                if buf.endswith('/'):
                    buf = buf[:-1]
                else:
                    lines.append((bufno, buf)); buf = None
                continue
            else:
                lines.append((bufno, buf)); buf = None
        if line.endswith('/') and line.startswith('<') and not line.startswith('#'):
            buf, bufno = line[:-1], ln; continue
        lines.append((ln, line))
    if buf is not None: lines.append((bufno, buf))

    header = None
    for ln, line in lines:
        if not line.strip():
            continue
        if line.startswith('#='):
            header = line; continue
        if line.startswith('#'):
            pending_comments.append(line[1:].strip()); continue
        m = PAGE_HDR_RE.match(line)
        if m:
            pv = dict(VAR_RE.findall(m.group('vars') or ''))
            cur_page = Page(name=m.group('page'), pagevars=pv, comments=pending_comments)
            pending_comments = []
            tags = {}
            pages.append(cur_page)
            continue
        m = LOCUS_RE.match(line)
        if m:
            if cur_page is None:
                raise ParseError(f"locus before page header at line {ln}")
            try:
                toks, cmts, unc, ligs, ps, pe, tagsets = _tokenize(m.group('text'))
            except ParseError as e:
                if strict: raise
                sys.stderr.write(f"[warn] line {ln}: {e}\n"); continue
            for k, v in tagsets: tags[k] = v
            eff = dict(cur_page.pagevars); eff.update(tags)
            words, seps = _split_words(toks)
            loc = Locus(page=m.group('page'), num=int(m.group('num')),
                        locator=m.group('locator'), locus_type=m.group('type'),
                        transcriber=m.group('tr'), text_raw=m.group('text'),
                        tokens=toks, words=words, word_seps=seps, pagevars=eff,
                        comments=cmts + pending_comments, uncertain=unc, ligatures=ligs,
                        para_start=ps, para_end=pe, line_no=ln)
            pending_comments = []
            cur_page.loci.append(loc)
            continue
        if strict:
            raise ParseError(f"unrecognised line {ln}: {line!r}")
        sys.stderr.write(f"[warn] unrecognised line {ln}: {line[:70]!r}\n")
    return pages

def word_str(w): return ''.join(w)

if __name__ == '__main__':
    p = parse(sys.argv[1])
    nloci = sum(len(pg.loci) for pg in p)
    nwords = sum(len(l.words) for pg in p for l in pg.loci)
    ntok = sum(len(l.tokens) for pg in p for l in pg.loci)
    print(f"{os.path.basename(sys.argv[1])}: pages={len(p)} loci={nloci} words={nwords} tokens={ntok}")
