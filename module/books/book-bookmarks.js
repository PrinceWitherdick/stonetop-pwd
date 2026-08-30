// A reader's own bookmarks in a rulebook: their places, kept, and listed back to them.
//
// WHY THIS IS NOT THE OUTLINE. The viewer's Document Outline is the BOOK's own headings, the
// same for everybody, and it is already excellent. What it cannot answer is "where was that
// table about supply I keep looking up", which is a question about one reader and not about the
// book. So this is a second list beside that one (reader-bookmarks-tab.js puts it in the
// sidebar just after the Outline) holding the places one person marked.
//
// USER-SCOPED, which is the whole point and is not the scope the reader's other record uses.
// `bookReaderResume` is CLIENT-scoped because "which windows did this browser have open" is a
// fact about the browser. A bookmark is a fact about the PERSON: a player who marked their
// playbook's page should find it again from the laptop they play on next week, and a GM's marks
// must not appear in a player's list. Foundry v13's `user` scope is exactly that -- stored in
// the world's settings database, keyed by user -- so unlike the client-scoped records here it
// needs no nesting by world id: a user setting already belongs to one world.
//
// WHAT IS STORED IS THE VIEW, NOT THE PAGE. `hash` is pdf.js's own `pdfOpenParams`
// (`page=91&zoom=100,0,412`), which is the page, the zoom AND the scroll offset within it, and
// `pdfLinkService.setHash` puts a reader back exactly there. The page is kept alongside it
// because it is the part we can SAY (a label reads "pp. 180-181"), and because it is what still
// works if a future viewer spells its anchors differently.
import { SYSTEM_ID } from "../system-id.js";
import { getObjectSetting } from "../settings.js";
import { isSpreadsEdition } from "./rulebooks.js";
import { format, localize } from "../utils/i18n.js";

export const BOOKMARKS_SETTING = "bookBookmarks";

/**
 * How long a label may be.
 *
 * Not a nicety: this setting is a document in the world database that is written on every
 * rename, and a bookmark list is one place a reader could paste a whole paragraph into. Cut
 * rather than refused, because a bookmark named by its first eighty characters is still the
 * bookmark they meant, and a rename that silently does nothing is not.
 */
export const LABEL_MAX = 80;

/** Every bookmark this user has in one book, in reading order. */
export function bookmarksFor(book) {
	const stored = getObjectSetting(BOOKMARKS_SETTING)[String(book)];
	return Array.isArray(stored) ? stored.filter(isBookmark).sort(byPage) : [];
}

/**
 * A row is only a bookmark if it can still be gone to.
 *
 * Filtered on READ rather than trusted, because this setting is a plain Object a world could
 * carry from an older build, and a row with no page is a line in the list that does nothing
 * when it is clicked.
 */
function isBookmark(row) {
	return !!row && typeof row === "object" && Number.isFinite(Number(row.page)) && Number(row.page) > 0;
}

/**
 * Reading order, and STABLE within a page: two marks on the same spread keep the order they
 * were made in rather than swapping places on the next render, which is what a sort with no
 * tie-break does to a list a reader is looking at.
 */
function byPage(a, b) {
	return (Number(a.page) - Number(b.page)) || (Number(a.created ?? 0) - Number(b.created ?? 0));
}

/**
 * Rewrite one book's list, leaving the other book's alone.
 *
 * SAYS SO WHEN IT FAILS rather than rejecting. A user-scoped setting is a document in the
 * world's database, and a write can be refused for reasons that have nothing to do with the
 * bookmark: a world whose permissions have been tightened, a connection that dropped. The
 * caller is a click in a sidebar, and a rejected promise there is an unhandled error in the
 * console and a list that silently did not change.
 *
 * @returns {Promise<boolean>} whether it was written.
 */
async function writeBook(book, rows) {
	const all = { ...getObjectSetting(BOOKMARKS_SETTING) };
	if (rows.length) all[String(book)] = rows;
	// Dropped rather than left as an empty array, for the reason `saveRulebookPath` gives about
	// its own record: "no bookmarks" and "a book with an empty list" must not be two states.
	else delete all[String(book)];
	try {
		await globalThis.game?.settings?.set?.(SYSTEM_ID, BOOKMARKS_SETTING, all);
		return true;
	} catch (err) {
		console.warn("Stonetop | Could not save your rulebook bookmarks.", err);
		ui.notifications?.warn?.(localize("stonetop.books.bookmarks.saveFailed"));
		return false;
	}
}

/**
 * A label, trimmed to something a list can show.
 *
 * Newlines collapse to spaces rather than being stripped: a label pasted out of the book's own
 * text arrives with the line breaks of the column it was set in, and a row is one line.
 */
export function cleanLabel(label) {
	return String(label ?? "").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
}

/**
 * Mark a place.
 *
 * The id is minted here rather than by the caller so that nothing else has to know what makes
 * two bookmarks different. `created` is what makes the sort stable and is the only reason it is
 * stored.
 *
 * @returns {Promise<object>} the row that was added, so the caller can put it straight into
 *                            rename (a mark made and then named is one gesture).
 */
export async function addBookmark(book, { label, page, hash } = {}) {
	const row = {
		id: globalThis.foundry?.utils?.randomID?.() ?? String(Date.now()),
		label: cleanLabel(label),
		page: Math.trunc(Number(page)),
		hash: String(hash ?? ""),
		created: Date.now(),
	};
	if (!isBookmark(row)) return null;
	if (!await writeBook(book, [...bookmarksFor(book), row])) return null;
	return row;
}

export async function renameBookmark(book, id, label) {
	const rows = bookmarksFor(book);
	const at = rows.findIndex(row => row.id === id);
	if (at < 0) return null;
	const next = rows.map((row, i) => (i === at ? { ...row, label: cleanLabel(label) } : row));
	await writeBook(book, next);
	return next[at];
}

export async function removeBookmark(book, id) {
	const rows = bookmarksFor(book);
	const next = rows.filter(row => row.id !== id);
	if (next.length === rows.length) return false;
	await writeBook(book, next);
	return true;
}

/**
 * The printed page (or pages) a sheet of the file shows, as a reader would say it.
 *
 * PRINTED numbers, not the file's, because the printed one is the number in the citation they
 * are chasing and the only one they can say out loud to the table. A spread carries two of them
 * (spread `p` prints `2p-2` and `2p-1`, the mapping `spreadPageFor` inverts), so this names
 * both -- and the very first spread prints only one, since there is no page 0.
 *
 * Falls back to the sheet number for a book that is NOT the spreads edition, because there the
 * arithmetic above is simply untrue and a confidently wrong page number is worse than a plain
 * one. Same judgement, and the same test, as `_checkEdition`.
 *
 * Says nothing about WHICH book, deliberately: this is only ever read inside that book's own
 * reader, where a numeral on every row would be the one word every row shares.
 */
export function pageNote(book, page, pageCount) {
	const n = Math.trunc(Number(page));
	if (!Number.isFinite(n) || n < 1) return "";
	if (!isSpreadsEdition(book, pageCount)) {
		return format("stonetop.books.bookmarks.sheetPage", { page: n });
	}
	const left = 2 * n - 2;
	if (left < 1) return format("stonetop.books.bookmarks.printedPage", { page: 2 * n - 1 });
	return format("stonetop.books.bookmarks.printedPages", { from: left, to: 2 * n - 1 });
}
