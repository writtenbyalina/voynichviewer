# The Text tab: a UX audit (10 Oct 2026)

Alina: "I feel like the compare function doesn't really work. God knows what else isn't working either." Audited by
using the tab as three people would on their first visit, at 1280, 750×553 and on a phone: a codicologist (where
does a word fall in the physical book: scribe, quire, section, kind of text), a cryptographer (counts, patterns,
positions, export) and a historian of medicine (the words of the bath pages and their labels, and the pages
themselves). Everything below was reproduced in the browser before it was changed.

## Compare: removed

What "Compare with another search" did: a button inside More options opened a second box on its own row; the second
search ran, and all that came of it was a 13 px blue sentence and half-width blue bars drawn over the first search's
bars in the strip. Nothing in the filters, nothing in the lines, nothing in a page's heading; the popover stayed open
over the strip after the click. A first version of this audit rebuilt it (the second search in every place the first
is: count, strip, filters, lines). Alina then asked for it to go altogether for now, so the tab has one search again:
the chip, the `cmp=` address parameter and the blue series are gone. Old links with `cmp=` open on the first search.

## What was wrong, and what was done

| # | What was wrong | Done |
|---|---|---|
| 1 | Pages was inside More options, and New page set asked two questions in turn (a name, then a line of pages) with the notation only hinted at in a placeholder: "I don't know how to select a page range." A set, once made, could only be deleted from Your work. | **Pages** is a chip of its own beside Reading and Spaces (filled when a set is chosen). New page set is one dialog: the name, a box for the pages, and under it what has been read, live: "23 pages: 1r, 2v-3r, 75r-84v · not a page: 999x". Pages and ranges can be written (75r-84v, f75r–f84v, with spaces or commas), or added from two menus (from 103r to 104v, Add), or a whole Section, Quire, Scribe or Language added from a menu. Save stays off until there is a name and a page. The set chosen can be edited or deleted from the same menu ("Edit set:bath…", "Delete set:bath…", after a question), and the dialog has a Delete button. |
| 2 | Choosing "New page set…" also ran a search on set:+new ("on set:+new, which this browser does not have"), two handlers answering the one menu. | One answers. |
| 3 | More options (320 px) ran off the right of a window narrower than about 1000 px; focusing a field inside it scrolled the whole view sideways, cutting off the left of the page. | Every popover stays inside the window: one that would run off hangs from its chip's right edge instead. |
| 4 | More options, the ?, the ⓘ and Export stayed open until clicked again; two could be open at once. | A click elsewhere or Esc closes them; opening one closes the others. |
| 5 | A page clicked in the strip said "No results on 116r" whenever its results were past the first 150 listed, which for a common word is most of the book. In a concordance sort it said so for every page. | The list opens out to that page and scrolls to it; in a concordance sort, to its first line. |
| 6 | Reading: any transcriber: a word written twice in one line (f26r line 8, qokeedy) counted once and only the first was marked, because matches were merged across transcribers by their text alone. | Matched by their turn in the line: 320 for qokeedy, not 275, both marked. |
| 7 | A search that found nothing still drew a strip of 204 empty bars and five empty filter headings. | Nothing found: no strip, no filters, the sentence and the suggestion. |
| 8 | Opening #text wrote #text/beinecke/#text into the address. | #text/beinecke/search. |
| 9 | On a phone the section names under the strip overlapped ("BalneologicHerbalRecipes"), measured against a 1200 px fallback before the strip had a width. | Measured against the view's width. |
| 10 | Reading: "RF1b, the Reader's t" was cut off in the chip under 760 px. | Room for the whole name. |
| 11 | Pointing at the strip while a search was still running threw an error in the console. | Guarded. |

Tests: `tests/text.spec.js` › the Text tab (the page-set dialog; the popovers; the strip past the first 150 and
nothing found; any transcriber twice in a line; #text alone). 49 of 49 text tests pass, desktop and mobile.

## Would each of the three be served?

- **Codicologist**: yes for where a word falls: Section open in book order, Scribe, Quire, Kind of text one click away,
  the strip in the chosen order, a page's thumbnail on every heading, and page sets by section, quire or scribe in
  two clicks. Still missing: a count by *bifolium* (Davis's unit), and the strip's bars cannot be read as "Scribe 2's
  pages" without hovering.
- **Cryptographer**: yes for counts, patterns (`*`, `?`, `[kt]`, classes, `/regex/`), positions (`^`, `$`, `at:`),
  near spellings, CSV and IVTFF. Still missing: two queries side by side (Compare, removed for now), and a count by
  word position inside the line beyond first/last.
- **Historian of medicine**: yes for `section:balneo`, a bath-pages set made from the Section menu, Kind of text:
  Labels, the thumbnails and one click to the page in the Reader with the word marked. Still missing: the Rosettes'
  and f116v's words have no boxes on the photograph (docs/text/REDESIGN.md 5), so a label found there is listed but
  cannot be pointed at on the page.
