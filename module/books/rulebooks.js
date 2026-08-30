// Your own copy of the rulebooks, opened inside the game.
//
// WHAT THIS DOES NOT DO: read a PDF, draw a page, or ship one. The books are not ours to
// distribute (the same standing rule the art importer works under, module/book2-art/macro.js),
// so all that is kept here is a POINTER to a file the GM already owns, plus the one URL that
// hands that file to a reader.
//
// THE READER IS FOUNDRY'S OWN, WHOLE AND UNALTERED, and that is the entire trick. Foundry
// bundles the complete pdf.js web viewer and serves it at `scripts/pdfjs/web/viewer.html`
// (core's own `pdf` journal page type points an iframe at exactly this URL). Everything a
// reader wants from a rulebook already belongs to that viewer:
//   - the sidebar's Document Outline, which is the book's chapters, clickable;
//   - the find bar, which is full-text search across all 300 pages;
//   - the annotation layer, which is what makes the books' OWN internal links work, so the
//     cross-reference from a move to its definition still goes there.
// Build a bespoke canvas reader and every one of those is something we would have to write and
// then keep working. So this module builds a URL and gets out of the way.
//
// WHERE THE FILE HAS TO BE. The viewer fetches by URL, so the PDF has to be somewhere this
// Foundry server will serve: inside the user data directory, which is what a FilePicker upload
// gives you. Note what that means and say so in the copy that asks for it (see
// RulebooksDialog): a book uploaded there is fetchable by anyone logged into the world who
// knows the path. That is the GM's call to make about their own table, not a surprise to
// discover.
import { SYSTEM_ID } from "../system-id.js";
import { localize } from "../utils/i18n.js";

/**
 * Where the paths live: ONE world setting holding a record keyed by book number.
 *
 * One Object rather than a String setting per book, because the set is open. `book: 3` is
 * already a number this codebase uses (module/gm-toolkit/book-ref.js cites it: the free GM
 * playbook), so "add the third book" should be a row in the table below and nothing else. A
 * settings key per book would make it an edit to settings.js as well, which is how the second
 * one ends up registered and the third one forgotten.
 */
export const RULEBOOKS_SETTING = "rulebookPdfs";

/**
 * The books a GM can point at, in the order they are offered.
 *
 * `book` matches the numbering `bookPageRef` cites (gm-toolkit/book-ref.js) rather than being a
 * separate id, so a citation and a file can be talked about in the same terms.
 *
 * `spreadPages` is the page count of the SPREADS edition, the landscape file carrying two
 * printed pages side by side. It is the edition the art importer measured its geometry against
 * and the one most people bought, but it is not the only one printed, so it is recorded as a
 * fact to CHECK rather than assumed: `isSpreadsEdition` compares it against what the viewer
 * actually opened, and only a match licenses `spreadPageFor` to convert a printed page number
 * into a page of the file.
 */
export const RULEBOOKS = Object.freeze([
	Object.freeze({
		book: 1,
		key: "book1",
		numeral: "I",
		icon: "fas fa-book",
		labelKey: "stonetop.books.book1.label",
		titleKey: "stonetop.books.book1.title",
		spreadPages: 308,
	}),
	Object.freeze({
		book: 2,
		key: "book2",
		numeral: "II",
		// The Wider World is the gazetteer, so it gets the atlas rather than a second closed
		// book: two identical glyphs side by side in a window header are one control as far as
		// a reader is concerned, whatever their tooltips say.
		icon: "fas fa-book-atlas",
		labelKey: "stonetop.books.book2.label",
		titleKey: "stonetop.books.book2.title",
		spreadPages: 302,
	}),
]);

/** One book's descriptor by its number, or null. */
export function rulebook(book) {
	return RULEBOOKS.find(b => b.book === Number(book)) ?? null;
}

/**
 * One book's own title, or the generic one when the number names no book.
 *
 * The fallback is the point: three surfaces wrote `localize(rulebook(book)?.titleKey ??
 * "stonetop.books.title")` out longhand and one of them reached past `rulebook()` to re-find
 * the entry itself, so the generic title was spelled three times and could drift.
 */
export function bookTitle(book) {
	return localize(rulebook(book)?.titleKey ?? "stonetop.books.title");
}

/**
 * The stored record of paths, `{ [book]: path }`.
 *
 * Tolerant of a setting that is not registered, for the same two reasons art-root.js is: this
 * is unit-tested outside Foundry, and a world still loading has no settings yet. Both answers
 * are "no books", which is the correct empty state rather than a thrown error on a sheet
 * header that renders before `ready`.
 */
export function rulebookPaths() {
	try {
		const stored = globalThis.game?.settings?.get?.(SYSTEM_ID, RULEBOOKS_SETTING);
		return (stored && typeof stored === "object") ? stored : {};
	} catch (_) { /* setting not registered in this world */ }
	return {};
}

/** The path this world has recorded for one book, or "" when it has none. */
export function rulebookPath(book) {
	const path = rulebookPaths()[String(book)];
	return typeof path === "string" ? path.trim() : "";
}

/** Has this world been pointed at a copy of this book? */
export function hasRulebook(book) {
	return !!rulebookPath(book);
}

/**
 * Record (or, with an empty path, forget) where one book lives.
 *
 * The whole record is rewritten rather than a dotted sub-key written, because a dotted write
 * into an ObjectField is how a key that should have been DROPPED survives as an empty string
 * instead (see the flag rules this system already lives by). Forgetting a book has to actually
 * remove its row, or "no book" and "a book at nowhere" become two different empty states and
 * only one of them dims the header icon.
 */
export async function saveRulebookPath(book, path) {
	const next = { ...rulebookPaths() };
	const trimmed = String(path ?? "").trim();
	if (trimmed) next[String(book)] = trimmed;
	else delete next[String(book)];
	return globalThis.game?.settings?.set?.(SYSTEM_ID, RULEBOOKS_SETTING, next);
}

/** Foundry's bundled pdf.js viewer, as a path relative to the game route. */
const VIEWER_PATH = "scripts/pdfjs/web/viewer.html";

/** Resolve a data path against this server's route prefix, tolerating a headless test. */
function routed(path) {
	const clean = String(path ?? "").replace(/^\/+/, "");
	return globalThis.foundry?.utils?.getRoute?.(clean) ?? `/${clean}`;
}

/**
 * The URL that opens one PDF in Foundry's viewer.
 *
 * @param {string} path              a data-relative path, or an absolute URL
 * @param {object} [opts]
 * @param {number} [opts.page]       page of the FILE to open at (not a printed page number,
 *                                   see spreadPageFor)
 * @param {string} [opts.search]     text to run the find bar over on open
 * @returns {string} empty when there is no path, so a caller can build it unconditionally
 *
 * The query half is what the viewer loads; the hash half is what it does once loaded, and the
 * two are not interchangeable. `file` goes through URLSearchParams because a data path may hold
 * spaces and an ampersand (a book saved under its shop filename usually does), and an
 * unescaped one truncates the parameter and shows an empty viewer with no error worth reading.
 */
export function rulebookViewerUrl(path, { page, search } = {}) {
	const src = String(path ?? "").trim();
	if (!src) return "";
	const params = new URLSearchParams();
	// Already a URL (a book served from somewhere else) goes through untouched; a data path is
	// resolved against the route prefix first, exactly as core's own PDF page does it.
	params.append("file", /^[a-z]+:\/\//i.test(src) ? src : routed(src));

	const hash = [];
	if (Number.isFinite(Number(page)) && Number(page) > 0) hash.push(`page=${Math.trunc(page)}`);
	// `phrase=true` so a multi-word search looks for the phrase rather than for pages holding
	// all of the words somewhere, which on a 300 page book is most of them.
	if (search) hash.push(`search=${encodeURIComponent(search)}`, "phrase=true");

	return `${routed(VIEWER_PATH)}?${params}${hash.length ? `#${hash.join("&")}` : ""}`;
}

/**
 * Does the file that opened look like the spreads edition of this book?
 *
 * Asked of the OPENED document rather than assumed, because a GM may own the 1-up edition (one
 * printed page per sheet) and its page numbering does not line up with anything below. Getting
 * this wrong is not visibly wrong: a jump lands 60 pages off and reads as the citation being
 * bad rather than the arithmetic.
 */
export function isSpreadsEdition(book, pageCount) {
	const entry = rulebook(book);
	return !!entry && Number(pageCount) === entry.spreadPages;
}

/**
 * The page of a SPREADS file that shows a given printed page number.
 *
 * Spread `p` prints `2p-2` on the left and `2p-1` on the right, so printed page `n` is on
 * spread `floor(n / 2) + 1`: printed 180 and 181 share spread 91, printed 182 opens spread 92.
 * The same mapping the art importer's manifest was measured with, stated once here so a page
 * citation and an illustration cannot come to disagree about which sheet a page is on.
 */
export function spreadPageFor(printed) {
	const n = Number(printed);
	if (!Number.isFinite(n) || n < 1) return null;
	return Math.floor(n / 2) + 1;
}
