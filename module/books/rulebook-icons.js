// The Book I / Book II icons that sit beside a sheet's own title.
//
// ON THE SHEET'S TITLE ROW, not in the window header (user, 2026-08-29). The same call the
// steading's hold glyphs answer: these belong to what the sheet IS, so they go in the banner the
// sheet draws, beside the name, rather than among the window controls Foundry paints next to
// Close. The GM Toolkit is a transcription of the GM playbook and every move on it cites the
// page it came off, so the books are part of the page furniture, not chrome.
//
// Its own module rather than inline in the one sheet that shows them, for the reason
// `stonetopSteadingHeaderButton` lives in utils/world.js: this is exactly the kind of shortcut
// that gets offered from a second surface later, and a row built by hand at each call site is
// how two of them come to disagree about the label, the glyph, or what a click does when the
// world has no copy of that book.
//
// WHAT A CLICK DOES DEPENDS ON WHETHER THERE IS A BOOK, and that is deliberate rather than a
// missing guard. An icon that does nothing is indistinguishable from one that is broken, so an
// unset book opens the window that sets it. It is drawn dimmed while unset, the same way and
// with the same 0.4 as the steading shortcut with no steading to jump to, so the row still says
// which of the two states it is in before it is clicked.
import { RULEBOOKS, rulebook, bookTitle, hasRulebook } from "./rulebooks.js";
import { openBookReader } from "./BookReaderWindow.js";
import { openRulebooksDialog } from "./RulebooksDialog.js";
import { localize, format } from "../utils/i18n.js";

/**
 * One view row per book, in RULEBOOKS order, for a sheet's banner to draw.
 *
 * Built fresh on each call rather than held as a constant: this runs per render, and whether a
 * book is set is exactly the thing that changes between one render and the next.
 *
 * The tooltip says which of the two things a click will do, because the dimming alone says
 * "there is nothing here" without saying that pressing it is how you fix that.
 *
 * @returns {Array<{book: number, icon: string, label: string, have: boolean, tooltip: string}>}
 */
export function rulebookIconRows() {
	return RULEBOOKS.map(iconRow);
}

/** One book's row. Shared so the two surfaces cannot come to draw the same book differently. */
function iconRow(entry) {
	const title = localize(entry.titleKey);
	const have  = hasRulebook(entry.book);
	return {
		book:    entry.book,
		icon:    entry.icon,
		label:   localize(entry.labelKey),
		have,
		tooltip: format(have ? "stonetop.books.openTip" : "stonetop.books.setTip", { title }),
	};
}

/**
 * One book's row, but ONLY if this world actually has a copy. Null otherwise.
 *
 * For the surfaces a PLAYER reads, the character sheet above all. The GM Toolkit draws an unset
 * book dimmed because the person looking at it is the person who can fix that; a player is not,
 * and a dim icon that opens a window full of controls their account cannot use is worse than no
 * icon at all. So this answers null and the sheet draws nothing, and the icon appears for the
 * whole table the moment the GM points at a file.
 *
 * @param {number} book
 * @returns {?{book: number, icon: string, label: string, have: boolean, tooltip: string}}
 */
export function readyRulebookIcon(book) {
	const entry = rulebook(book);
	if (!entry || !hasRulebook(entry.book)) return null;
	return iconRow(entry);
}

/**
 * What a click on one of those icons does.
 *
 * `hasRulebook` is asked again HERE rather than read off the row the template drew, because the
 * two are separated by however long the sheet has been open: a GM who sets Book I in the window
 * this opens comes back to a banner that still says unset, and the next click on it has to open
 * the book rather than the setup again.
 */
export function openRulebook(book) {
	if (hasRulebook(book)) openBookReader(book);
	else openRulebooksDialog();
}

/**
 * The same click for someone who cannot do anything about a missing book.
 *
 * The difference from `openRulebook` is what happens when there is no file: opening the setup
 * would show a player a window whose every control their account refuses, so they are told in
 * one line instead, and told whose job it is. Reachable at all only through a race — the icon is
 * drawn from `readyRulebookIcon`, so it was there when the sheet last rendered — but a GM
 * forgetting a book while a player has the sheet open is an ordinary evening, and a click that
 * does nothing at all is the one outcome with no explanation in it.
 */
export function openSharedRulebook(book) {
	if (hasRulebook(book)) return openBookReader(book);
	ui.notifications?.warn?.(format("stonetop.books.notShared", { title: bookTitle(book) }));
	return null;
}

/**
 * A page CITATION, followed: the book open at the page the sheet was pointing at.
 *
 * Same three-way answer as `openRulebook` above, and for the same reasons -- a book this world
 * has opens, a book it has not opens the setup rather than doing nothing -- with one case those
 * icons cannot reach: a citation may name a book the reader knows nothing about. `book: 3` is
 * the free GM playbook, a real value elsewhere in this codebase (gm-toolkit/book-ref.js cites
 * it), and it has no row in RULEBOOKS because nothing can open it. Handing that number to the
 * setup would show a window listing two books, neither of them the one that was clicked.
 *
 * The page goes down as `printedPage`, never as a page of the file. The two differ by the whole
 * of the spreads mapping and only the reader, holding the loaded document, can tell whether that
 * mapping applies -- see `goToPrintedPage`.
 *
 * @param {number} book     the book a citation names
 * @param {number} printed  the page number PRINTED in that book's corner
 */
export function openBookPage(book, printed) {
	if (!rulebook(book)) return null;
	if (!hasRulebook(book)) {
		openRulebooksDialog();
		return null;
	}
	return openBookReader(book, { printedPage: printed });
}
/**
 * Follow a click on a `stonetop.book-page-cite` chip, if that is what was clicked.
 *
 * WHERE THE PARTIAL'S BEHAVIOUR LIVES. The chip is a globally precached partial styled at system
 * scope, so any surface may print one — and a run of citation chips that look pressable and do
 * nothing is what a caller gets if the only thing that makes them work is a branch inside one
 * sheet's own click handler.
 *
 * The PRINTED page goes down, never a page of the file: the two differ by the spreads mapping, and
 * only the reader (holding the loaded document) can tell whether that mapping applies to the
 * edition this GM owns.
 *
 * Answers whether it handled the click, so a host with one delegated listener and a chain of
 * `closest` checks can ask this as one link in that chain rather than adding a second listener.
 *
 * @param {EventTarget} target  the event's target.
 * @returns {boolean}  true when a citation was found and followed.
 */
export function followBookCite(target) {
	const cite = target?.closest?.(".stonetop-book-cite");
	if (!cite) return false;
	openBookPage(Number(cite.dataset.book), Number(cite.dataset.page));
	return true;
}

/** Make every citation chip under `root` work, for a surface that has no click chain of its own. */
export function wireBookCites(root) {
	root?.addEventListener?.("click", ev => {
		if (followBookCite(ev.target)) ev.preventDefault();
	});
}
