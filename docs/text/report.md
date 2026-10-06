# Text data: the consensus against voynichese.com and RF1

Built by `tools/text/build.py` (method 1) from the pinned inputs in `tools/text/inputs.json`. Everything is compared at Zandbergen's nearest-basic-Eva grain, from his STA files. A word differs when its glyphs differ or its word breaks fall elsewhere. Unless said otherwise, the consensus's uncertain spaces count as spaces.

**These are differences, not errors.** Which reading is right is for the gold set (docs/TEXT.md 8.1) to show, against the photographs. What this report can say is how far each source is from the consensus, where, and in which direction.

## What was built

- **5,385 loci** on 227 pages: every locus in ZL, the Rosettes included.
- **Voters per locus**: 1: 5, 2: 54, 3: 55, 4: 1,142, 5: 2,554, 6: 1,465, 7: 110.
- **Columns**: unan 144,189 (92.1%), maj 10,729 (6.9%), tie 1,010 (0.6%), plur 499 (0.3%), single 82 (0.1%), none 29 (0.0%).
- **Gaps between columns**: none 113,922 (75.4%), all 29,614 (19.6%), most 2,521 (1.7%), doubt 1,898 (1.3%), unc 1,878 (1.2%), few 1,318 (0.9%).
- **Voters**: ZL René Zandbergen & Gabriel Landini (5,385 loci); GC Glen Claston (5,366 loci); IT Takeshi Takahashi (5,214 loci); FG First Study Group (Friedman) (4,060 loci); CD Prescott Currier & Mary D'Imperio (2,196 loci); LU Jorge Stolfi (1,989 loci); LV John Grove (1,918 loci); LT John Tiltman (566 loci); LL Don Latham (205 loci); LP Theodore Petersen (via Karl Kluge) (209 loci); LR Mike Roe (31 loci); LX Denis Mardle (37 loci).
- **Words in the consensus**: 39,393 with uncertain spaces as spaces, 37,519 without, about 38,456 counting them half.

## Against every transcription

| | voynichese.com (VT0e) | RF1 | ZL | GC | IT |
|---|---|---|---|---|---|
| loci it lacks | 179 | 0 | 0 | 19 | 171 |
| lines identical | 60.2% | 52.2% | 68.1% | 52.3% | 60.1% |
| words that differ | 4,159 (10.7%) | 5,374 (13.6%) | 3,077 (7.8%) | 4,450 (11.3%) | 4,179 (10.8%) |
| … if uncertain spaces are no space | 3,051 (8.3%) | 3,900 (10.4%) | 4,257 (11.3%) | 3,863 (10.3%) | 3,066 (8.3%) |
| lines with the same glyphs, spaces aside | 70.8% | 65.3% | 80.8% | 70.1% | 70.6% |
| glyphs that match, spaces aside | 98.6% | 98.5% | 99.2% | 98.7% | 98.5% |

The consensus is closest to ZL, as it should be: ZL covers everything and is one of the most careful voters. It is no transcription's copy: every one of them differs from it somewhere.

## voynichese.com (VT0e)

- It lacks **179 loci** (588 consensus words). f102r2, f102v1, f106r, f116v, f11v, f17r, f2r, f49v, f66r, f67v2, fRos
- On the 5,206 loci it has, **4,159 of 38,805 words differ (10.7%)**, and 60.2% of lines are identical (60.9% if uncertain spaces are read as no space).
- **What kind of difference**, in consensus words:
  - different glyphs: 2,422
  - voynichese.com (VT0e) joins consensus words: 1,571
  - voynichese.com (VT0e) breaks a consensus word in two or more: 102
  - voynichese.com (VT0e) has nothing for it: 49
  - voynichese.com (VT0e) has words the consensus lacks: 15
  - same glyphs, breaks moved: 15
- **Commonest glyph differences** (voynichese.com (VT0e) reads → consensus reads):
  `or`→`ar` 12, `qokain`→`qokaiin` 10, `dor`→`dar` 8, `aiin`→`ain` 7, `csedy`→`shedy` 6, `doiin`→`daiin` 6, `otol`→`otal` 5, `okol`→`okal` 5, `dain`→`daiin` 5, `cheor`→`chear` 4, `saiin`→`sain` 4, `ar`→`or` 4, `qokor`→`qokar` 4, `das`→`dar` 4
- **By section** (Davis), words that differ: Botanical 9.3%; Starred paragraphs 9.0%; Balneology 7.2%; Pharmaceutical 15.8%; Rose 11.5%; Astronomy 24.8%; Zodiac 27.2%; Astronomy/ Zodiac 24.2%
- **Examples**:
  - `f1r.3` glyphs: consensus `sy`, voynichese.com (VT0e) `sa`
  - `f1v.1` glyphs: consensus `chodaiin`, voynichese.com (VT0e) `chadaiin`
  - `f6v.1` split: consensus `koary`, voynichese.com (VT0e) `koar y`
  - `f11v.6` joined: consensus `qot chor`, voynichese.com (VT0e) `qotchor`
  - `f16r.7` joined: consensus `s aiin`, voynichese.com (VT0e) `saiin`
  - `f41r.10` split: consensus `sshok`, voynichese.com (VT0e) `s shok`
  - `f66r.67` extra: consensus `∅`, voynichese.com (VT0e) `shody`
  - `f76r.29` extra: consensus `∅`, voynichese.com (VT0e) `ylaiin`
  - `f101r.10` missing: consensus `od or dor chees ykeeol chol dol kor acthy ol chso sha`, voynichese.com (VT0e) `∅`
  - `f101v.22` missing: consensus `?`, voynichese.com (VT0e) `∅`

## RF1

- It lacks **0 loci** (0 consensus words).
- On the 5,385 loci it has, **5,374 of 39,393 words differ (13.6%)**, and 52.2% of lines are identical (53.6% if uncertain spaces are read as no space).
- **What kind of difference**, in consensus words:
  - RF1 joins consensus words: 1,945
  - different glyphs: 1,623
  - RF1 writes v101's in-between glyph (@221; or @222;), where the consensus says a, o or y: 1,439
  - RF1 breaks a consensus word in two or more: 316
  - same glyphs, breaks moved: 35
  - RF1 has nothing for it: 16
  - RF1 has words the consensus lacks: 13
- **Commonest glyph differences** (RF1 reads → consensus reads):
  `cthhy`→`cthey` 5, `cheal`→`cheol` 5, `qotal`→`qokal` 5, `oteedy`→`okeedy` 5, `das`→`dar` 4, `deiin`→`dain` 4, `dag`→`dam` 4, `qotaiin`→`qokaiin` 4, `al`→`ol` 4, `lar`→`lor` 3, `chal`→`chol` 3, `dor`→`dar` 3, `ar`→`or` 3, `otain`→`okain` 3
- **By section** (Davis), words that differ: Botanical 12.5%; Starred paragraphs 13.0%; Balneology 11.7%; Pharmaceutical 17.6%; Rose 12.6%; Astronomy 19.4%; Zodiac 23.1%; Astronomy/ Zodiac 26.9%
- **Examples**:
  - `f1r.1` inbetween: consensus `ataiin`, RF1 `@221;taiin`
  - `f1v.3` glyphs: consensus `da`, RF1 `do`
  - `f6v.1` joined: consensus `koary sar`, RF1 `koarysar`
  - `f11v.2` glyphs: consensus `ykchy`, RF1 `ytchy`
  - `f16r.3` joined: consensus `qoy koiin`, RF1 `qoykoiin`
  - `f21r.1` split: consensus `oeeockhy`, RF1 `o eeockhy`
  - `f26r.2` inbetween: consensus `adeeody ykecthey`, RF1 `@221;deeody ykecthhy`
  - `f31r.7` split: consensus `saiin`, RF1 `s aiin`
  - `f41r.3` extra: consensus `∅`, RF1 `@222;chdykchdy`
  - `f46r.11` rebroken: consensus `opdar shdy sa`, RF1 `opdarshdy s a`
  - `f46v.7` missing: consensus `chedy`, RF1 `∅`
  - `f101r.10` extra: consensus `∅`, RF1 `@221;l chso sh@221;`

## Checks against published numbers

- ZL against IT. The research repo's exp01 measured 97.86% of glyphs agreeing, 61.03% of lines with the same glyphs (spaces aside) and 86% of word tokens matching. Here, at STA grain: 98.0% of glyphs, 61.8% of lines with the same glyphs, 85.6% of ZL's words (its uncertain spaces as spaces). Counting word breaks too, only 48.2% of lines are identical.
- Loci by type (Zandbergen: P 4,130, L 1,029, C 84, R 142): C 84, L 1,029, P 4,130, R 142.
- Word tokens: about 38,000 expected; see 'Words in the consensus' above.
- Loci only ZL covers: f2r.15, f11v.5, f17r.13, f67v2.21, fRos.1.

