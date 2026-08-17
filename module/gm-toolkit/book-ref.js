// "Book I, page 180" — where to go and read the whole entry.
//
// Its own module rather than a private line in either place that prints it, because the same
// citation is shown on two surfaces (the sheet's expanded entry and the whispered chat card) for
// the same move, and by more than one catalog (the moves, the core-loop diagrams). Written twice,
// it would be formatted two ways within a session of the same GM's reading.
//
// The page lives on the DATA (`gm-moves.js`, `gm-diagrams.js`), which is the only place that knows
// which page it came off. This module only knows how to say it.
import { format } from "../utils/i18n.js";

/**
 * How each book is NUMBERED in a citation.
 *
 * A table rather than a branch per book. This used to be `if (entry.book === 2)` picking a second
 * i18n string that differed from the first by one numeral, which meant every further book was
 * another branch, another key in `languages/en.json` and another sentence for a translator to
 * keep in step with the rest. `book: 3` is already a value this codebase uses — it is the free
 * GM playbook (module/book2-art/), which is the very page the Homefront and Core Loop tabs are
 * transcribed from — so the third case is a real one rather than a hypothetical.
 *
 * An unknown book falls back to its own digit, which is wrong in a way a reader can SEE
 * ("Book 4, page 12") rather than one that silently prints someone else's page as Book I's.
 */
const BOOK_NUMERALS = { 1: "I", 2: "II", 3: "III" };

/** The numeral for a citation's book. Book I unless the entry says otherwise. */
function bookNumeral(book) {
	return BOOK_NUMERALS[book ?? 1] ?? String(book);
}

/**
 * @param   {{page?: number, pageAlt?: number, book?: number}} entry  Anything transcribed out of
 *          the rulebooks. `book` is 1 unless it says otherwise — everything on this sheet came
 *          out of Book I until the Homefront tab, half of which is the village's own entry in
 *          Book II, and an unsaid default is what would print a Book II page as a Book I one.
 * @returns {string}  Empty for an entry with no page, so a caller can print it unconditionally.
 */
export function bookPageRef(entry) {
	if (!entry?.page) return "";
	const book = bookNumeral(entry.book);
	// A second printing, which only the exploration moves have: the sites chapter re-frames the
	// same seven for a dungeon rather than a journey, and a GM reading one wants to know the
	// other exists. It carries the book like the plain form does — those moves are Book I, but a
	// citation shape that only ever says one book is how a later one comes out mislabelled.
	return entry.pageAlt
		? format("stonetop.gmToolkit.moves.bookPageAlt", { book, page: entry.page, alt: entry.pageAlt })
		: format("stonetop.gmToolkit.moves.bookPage", { book, page: entry.page });
}
