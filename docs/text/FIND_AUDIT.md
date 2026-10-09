# Find: a UX audit of the panel's search (10 Oct 2026)

Alina: "The search doesn't work the way a search should." Audited by using it as a reader would, against what every
search people know does (a browser's find bar, Spotlight, a library catalogue): results as you type, a query that
stays put, results that are the things themselves, and a way back that is obvious.

| # | What was wrong | What a search does | Done |
|---|---|---|---|
| 1 | Typing showed candidate *words* as chips; the places came only after Enter or a click. Two steps for one question. | Results appear as you type, no Enter. | The bar lives in the panel's frame; every keystroke (80 ms) redraws the results below it, and the caret never moves. |
| 2 | Enter opened "the first match", which for `qok*` was whichever word is most frequent: a choice the reader did not make. | The exact word first; otherwise the most frequent; and the list of all matches stays in view. | Exact word first, then by count. The list of words stays above the places; the word picked is marked. |
| 3 | Only the exact word matched unless you knew `*`. `cho` found only the word *cho*. | Prefix matching by default, as in every autocomplete. | Begins with (default) · whole word · contains, as chips; `*` and `?` still work as a pattern. The match is underlined in each word. |
| 4 | Back (or Esc) threw the query away; the query had to be typed again to change it. | The query stays until it is cleared. | The box keeps its text while results show; × or Esc clears it and the page text returns. Any other view (a word chosen) ends the search. |
| 5 | The results view re-drew the bar each time, so the box lost focus on Enter. | Focus stays in the box. | One bar, made once, outside the redrawn body. |
| 6 | No count: no idea whether 3 or 3,000 places matched. | A summary line. | "75 words · 512 places · 163 pages", live. |
| 7 | Nothing found said only "No word in the book matches." | Say what was tried, offer the nearest. | "No word begins with *qokq*", then words one glyph away as chips, or a nudge to *contains*. |
| 8 | The glyphs picked in a word jumped to the Text tab; the panel's own Find was a second, different search. | One search, in one place. | Picked glyphs open Find in the panel (whole word, begins with, ends with, anywhere). |
| 9 | Keyboard: ↓ did nothing; Esc in an empty box did nothing. | ↓ moves into the results; Esc clears, then leaves. | Done. |
| 10 | The placeholder was a sentence, cut off at panel width. | A short placeholder. | "Find a word (Eva, or the glyph keys)". |
| 11 | The glyph keys were drawn before the glyph data had loaded, so the panel could fail to appear at all. | — | Keys drawn once the glyphs are known. |
| 12 | The open word's 364 places pushed the other words off screen. | A list to scan, a detail below. | Eight words, "Show 30 more", the picked word's places under the list. |

Left as it was: the Text tab's search (/), which is the power search over patterns, joins and every transcriber. The
panel's Find is for a word you have in mind while reading; its ? says where the Text tab is for the rest.
