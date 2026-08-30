// A book that was open when the page unloaded comes back open.
//
// The reader is a plain Application, and none of those survive a browser refresh: nothing calls
// `close()` on an unload, so a record left saying "open" is exactly the evidence that it was.
// That is the same trick, and deliberately the same SHAPE of record, as the GM walkthroughs
// (dialogs/walkthrough-resume.js): one client-scoped setting, nested by world id, written on
// render and cleared on close, replayed from `ready`.
//
// CLIENT-SCOPED, because "which windows did I have open" is this browser's business and not the
// world's: a GM reloading must not reopen a book on a player's screen. NESTED BY WORLD for the
// reason the walkthrough records are: a client blob would otherwise reopen a book in every world
// opened in this browser, including ones that have no copy of it.
//
// WHAT IS NOT STORED HERE: the page. pdf.js keeps its own view history in localStorage, keyed by
// the file, and its `viewOnLoad` default restores it. So a book reopened WITHOUT a page in its
// URL comes back at the exact scroll offset and zoom the reader left it at, which is more than a
// page number could say. Recording a page here as well would only override that with something
// coarser. This is why `reopenOpenBookReaders` opens with no page.
import { getSetting, setSetting, worldKey } from "../settings.js";
import { RULEBOOKS } from "./rulebooks.js";

const SETTING = "bookReaderResume";

/** The books this browser had open in THIS world, as an array of book numbers. */
export function openBookReaderRecord() {
	const stored = getSetting(SETTING)?.[worldKey()];
	return Array.isArray(stored) ? stored : [];
}

/** Rewrite this world's record, leaving every other world's alone. */
function writeRecord(books) {
	const all = { ...(getSetting(SETTING) ?? {}) };
	const wk  = worldKey();
	if (books.length) all[wk] = books;
	else delete all[wk];
	return setSetting(SETTING, all);
}

/**
 * Remember that a book is open.
 *
 * The write is SKIPPED when the record already says so, which is the whole reason this is a
 * function rather than a line in the window: it is called from `_render`, and an Application
 * re-renders for reasons that have nothing to do with a window appearing.
 */
export function markBookReaderOpen(book) {
	const books = openBookReaderRecord();
	const n = Number(book);
	if (!Number.isFinite(n) || books.includes(n)) return;
	return writeRecord([...books, n].sort((a, b) => a - b));
}

/** Forget it. Called from `close`, which a browser reload never runs, which is the point. */
export function markBookReaderClosed(book) {
	const books = openBookReaderRecord();
	const n = Number(book);
	if (!books.includes(n)) return;
	return writeRecord(books.filter(b => b !== n));
}

/**
 * Bring back every book that was open when this client last unloaded.
 *
 * In RULEBOOKS order rather than the order they were recorded in, so a reader who had both open
 * gets them back in a predictable arrangement rather than one that depends on which they opened
 * first three days ago. The LAST one opened lands frontmost (FrontOnOpen raises each once), so
 * Book I comes back under Book II, matching the order they sit in everywhere else.
 *
 * A book this world no longer has a copy of is DROPPED rather than retried: `openBookReader`
 * answers null for one with no file, and a record that cannot be honoured would otherwise sit
 * there being attempted on every single load.
 *
 * The window is imported HERE rather than at the top of the file, because it imports this module
 * back (it is what writes the record). A dynamic import inside the one function that needs it
 * keeps the two modules from forming a static cycle, which is the same answer, for the same
 * reason, that `BookReaderWindow._openSetup` gives for reaching the setup dialog.
 */
export async function reopenOpenBookReaders() {
	const wanted = openBookReaderRecord();
	if (!wanted.length) return;
	const { openBookReader } = await import("./BookReaderWindow.js");
	const opened = [];
	for (const entry of RULEBOOKS) {
		if (!wanted.includes(entry.book)) continue;
		if (openBookReader(entry.book)) opened.push(entry.book);
	}
	// Only rewrite when something actually fell away, so an ordinary load is not a settings write.
	if (opened.length !== wanted.length) await writeRecord(opened);
}
