// "Book I, page 180" — where to go and read the whole entry.
//
// Its own module rather than a private line in either place that prints it, because the same
// citation is shown on two surfaces (the sheet's expanded entry and the chat card) for
// the same move, and by more than one catalog (the moves, the core-loop diagrams). Written twice,
// it would be formatted two ways within a session of the same GM's reading.
//
// The page lives on the DATA (`gm-moves.js`, `gm-diagrams.js`), which is the only place that knows
// which page it came off. This module only knows how to say it.
import { format, localize } from "../utils/i18n.js";

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
 * A citation, broken into the CHIPS that can each be clicked.
 *
 * One object per page a reader might want to be taken to, in the order the sentence names them,
 * each carrying the number it goes to alongside the words that name it. That split is the whole
 * reason this exists: a move with a second printing reads "Book I, page 180, and again on page
 * 300 for a site", and a single control over that whole sentence would take a GM who pressed the
 * words "page 300" to page 180. Two chips, two destinations, one sentence.
 *
 * `sep` is what goes BEFORE a chip rather than between two of them, so a template can print the
 * list without ever asking which chip it is on. Empty on the first.
 *
 * `page` is the PRINTED page, the number the book itself puts in its corner. Turning that into a
 * page of a PDF is the reader's job and depends on which edition the GM owns -- see
 * `spreadPageFor` and `isSpreadsEdition` in books/rulebooks.js -- so nothing here does arithmetic
 * on it.
 *
 * @param   {{page?: number, pageAlt?: number, book?: number}} entry
 * @returns {Array<{text: string, book: number, page: number, sep: string, tip: string}>}
 *          Empty for an entry with no page, which is falsy to Handlebars' `#if` and so can be
 *          handed straight to a template.
 */
export function bookPageCites(entry) {
	if (!entry?.page) return [];
	// The book, as a NUMBER, because that is what the reader is keyed by; the numeral is for the
	// sentence only. `book` is 1 unless the entry says otherwise -- everything on this sheet came
	// out of Book I until the Homefront tab, half of which is the village's own entry in Book II,
	// and an unsaid default is what would print (and open) a Book II page as a Book I one.
	const book = Number(entry.book ?? 1);
	const numeral = bookNumeral(entry.book);
	const cites = [cite({
		key: "stonetop.gmToolkit.moves.bookPage",
		data: { book: numeral, page: entry.page },
		book, page: entry.page, sep: "",
	})];
	// A second printing, which only the exploration moves have: the sites chapter re-frames the
	// same seven for a dungeon rather than a journey, and a GM reading one wants to know the
	// other exists.
	if (entry.pageAlt) cites.push(cite({
		key: "stonetop.gmToolkit.moves.bookPageAlt",
		data: { alt: entry.pageAlt },
		book, page: entry.pageAlt,
		sep: localize("stonetop.gmToolkit.moves.bookPageJoin"),
	}));
	return cites;
}

/** One chip, with the tooltip that says what pressing it does. */
function cite({ key, data, book, page, sep }) {
	return {
		text: format(key, data),
		book, page, sep,
		tip: format("stonetop.gmToolkit.moves.bookPageOpen", { book: bookNumeral(book), page }),
	};
}

/**
 * The same citation as one flat sentence, for a surface that cannot hold controls.
 *
 * The chat card is the one that cannot (module/gm-toolkit/random-gm-move.js builds its body as
 * an HTML string, and a button in the chat log would need a listener of its own on a message
 * that outlives the sheet it came from). Composed from `bookPageCites` rather than formatted a
 * second way, so the card and the sheet can never come to word the same citation differently.
 *
 * @returns {string}  Empty for an entry with no page, so a caller can print it unconditionally.
 */
export function bookPageRef(entry) {
	return bookPageCites(entry).map(c => `${c.sep}${c.text}`).join("");
}
