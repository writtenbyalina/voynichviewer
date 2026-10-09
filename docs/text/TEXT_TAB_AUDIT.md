# The Text tab: a UX audit (10 Oct 2026)

Alina: "I feel like the compare function doesn't really work. God knows what else isn't working either." Audited by
using the tab as three people would on their first visit, at 1280, 750×553 and on a phone: a codicologist (where
does a word fall in the physical book: scribe, quire, section, kind of text), a cryptographer (counts, patterns,
positions, two spellings against each other, export) and a historian of medicine (the words of the bath pages and
their labels, and the pages themselves). Everything below was reproduced in the browser before it was changed.

## Compare

What "Compare with another search" did: a button inside More options opened a second box on its own row; the second
search ran, and all that came of it was a 13 px blue sentence ("Compared with "chol" (blue): 364 times") and half-width
blue bars drawn over the first search's bars in the strip. Nothing in the filters, nothing in the lines, nothing in a
page's heading. The popover stayed open over the strip after the click. So the comparison, the one thing each of the
three would do with two spellings or two words, had nowhere to be read.

| # | What was wrong | What a comparison needs | Done |
|---|---|---|---|
| 1 | Compare was a button inside More options; after it the popover stayed open, over the strip. | A setting in the row with the others, that says what it is set to. | A **Compare** chip beside More options. Set, it reads **Compared with qokedy**, in the second search's blue; it opens a small popover with the box, Compare and Remove. |
| 2 | The second count was a 13 px aside. | Two counts, the same size, told apart by colour. | Two sentences: "■ qokeedy appears 306 times on 56 of 227 pages." and, in blue, "■ qokedy appears 270 times on 63 of 227 pages." The i adds "41 lines hold both". |
| 3 | The strip drew the second search's bars over the first's, half-width and translucent. | Two bars a page, side by side. | Ink at the left, blue at the right, on every page; a page with neither gets two hairlines. The hover card gives both counts. |
| 4 | The filters counted only the first search. | Both counts in every row: this is where "Scribe 2 writes qokedy, Scribe 3 qokeedy" is read. | Each row reads "(133 · 60)", the second in blue; rows the first search has nothing on still appear, "(0 · 1)". A key above the rows names the two. |
| 5 | The lines showed only the first search's matches. | Both, told apart. | In book order the lines of both searches are listed, the first's marks underlined in ink and the second's in blue, and a page's heading gives "■ 3 · ■ 6". A line only the second search found opens in the Reader on its word. The concordance sorts stay the first search's. |
| 6 | The second query's own filters (scribe:, section:…) were ignored; the first's were applied to it. | Each query keeps its filters; the steps narrow both. | Done; an unreadable second query is said back as "The second search (Compare): …". |
| 7 | Esc in the second box emptied it (a search box does), and the emptied box came back empty. | The box shows what is compared. | It is filled with the current second search whenever it opens. |

## The rest of the tab

| # | What was wrong | Done |
|---|---|---|
| 8 | More options (320 px) ran off the right of a window narrower than about 1000 px; focusing a field inside it scrolled the whole view sideways, cutting off the left of the page. | Every popover stays inside the window: one that would run off hangs from its chip's right edge instead. |
| 9 | More options, the ?, the i and Export stayed open until clicked again; two could be open at once. | A click elsewhere or Esc closes them; opening one closes the others. |
| 10 | A page clicked in the strip said "No results on 116r" whenever its results were past the first 150 listed, which for a common word is most of the book. In a concordance sort it said so for every page. | The list opens out to that page and scrolls to it; in a concordance sort, to its first line. |
| 11 | Reading: any transcriber: a word written twice in one line (f26r line 8, qokeedy) counted once and only the first was marked, because matches were merged across transcribers by their text alone. | Matched by their turn in the line: 320 for qokeedy, not 275, both marked. |
| 12 | A search that found nothing still drew a strip of 204 empty bars and five empty filter headings. | Nothing found: no strip, no filters, the sentence and the suggestion. |
| 13 | Opening #text wrote #text/beinecke/#text into the address. | #text/beinecke/search. |
| 14 | On a phone the section names under the strip overlapped ("BalneologicHerbalRecipes"), measured against a 1200 px fallback before the strip had a width. | Measured against the view's width. |
| 15 | Reading: "RF1b, the Reader's t" was cut off in the chip under 760 px. | Room for the whole name. |
| 16 | Under 553 px of height the box, chips, compare row, count and strip left two lines of results. | The compare row is gone (into its chip), the count sits closer; about one more line. The strip and chips are the spec's sizes and stay. |

Tests: `tests/text.spec.js` › the Text tab (Compare; the popovers; the strip past the first 150 and nothing found;
any transcriber twice in a line; #text alone). 49 of 49 text tests pass, desktop and mobile.

## Would each of the three be served?

- **Codicologist**: yes for where a word falls: Section open in book order, Scribe, Quire, Kind of text one click away,
  the strip in the chosen order, a page's thumbnail on every heading, and now two words against each other in every
  one of those. Still missing: a count by *page side* or by *bifolium* (Davis's unit), and the strip's bars cannot be
  read as "Scribe 2's pages" without hovering.
- **Cryptographer**: yes for counts, patterns (`*`, `?`, `[kt]`, classes, `/regex/`), positions (`^`, `$`, `at:`),
  near spellings, CSV and IVTFF, and now two queries side by side with the lines that hold both counted. Still missing:
  a third query (two is the limit), a ratio column in the filters, and a count by word position inside the line
  beyond first/last.
- **Historian of medicine**: yes for `section:balneo`, Kind of text: Labels, the thumbnails and one click to the page in
  the Reader with the word marked. Still missing: the Rosettes' and f116v's words have no boxes on the photograph
  (docs/text/REDESIGN.md 5), so a label found there is listed but cannot be pointed at on the page.
