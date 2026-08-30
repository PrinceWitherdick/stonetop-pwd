// Taking a book off the GM's own computer and putting it where the reader can fetch it.
//
// WHY THIS EXISTS AT ALL, since the Import Book Art macro asks for the very same PDFs and needs
// none of it. The two are doing genuinely different things with the file:
//
//   The IMPORTER reads the book ONCE, in the browser, to pull illustrations out of it, and then
//   never wants it again. So it takes a plain `<input type="file">`, calls `arrayBuffer()`, and
//   is done. Nothing is copied anywhere, which is exactly right for a 60 MB file nobody needs
//   twice, and it is why that flow can open the Windows file dialog and stop there.
//
//   The READER needs the book to still be there NEXT SESSION, and it fetches by URL: pdf.js
//   takes `?file=<url>`. A File chosen through an `<input>` only ever yields a `blob:` URL that
//   dies with the page. It cannot be written into a setting, cannot survive a reload, and cannot
//   be reopened tomorrow. So for a book to be one click away for good, a copy has to live
//   somewhere this Foundry serves.
//
// WHICH IS WHY THE PICKER LOOKED WRONG. Foundry's FilePicker browses the SERVER, and the first
// version of this offered only that (user, 2026-08-29: "I was expecting to see the windows file
// system open"). The fix is not to abandon the copy, which is what makes the feature persist; it
// is to ask for the file the way the importer does, with the OS dialog, and do the copying
// afterwards without making the GM find the folder themselves. The FilePicker stays as the
// second door, for a book already on the server, which is the whole story on a hosted setup.
import { ensureDataDir, uploadFile } from "../utils/foundry-compat.js";
import { rulebook, bookTitle, saveRulebookPath } from "./rulebooks.js";
import { format } from "../utils/i18n.js";

/**
 * Where a copied book lands: a TOP-LEVEL data folder, outside `systems/`.
 *
 * The same choice, for the same reason, as the imported art's folder (book2-art/art-root.js):
 * anything under the system directory is at the mercy of the next system update or reinstall,
 * and a GM should not have to find their rulebook again because they took a patch.
 */
export const RULEBOOK_DIR = "stonetop-books";

/** May this user copy a file in at all? Writing one needs FILES_UPLOAD, which most worlds keep
 *  to the GM. Browsing for one already on the server is a separate right, asked separately. */
export function canStoreRulebook() {
	return !!(game.user?.isGM || game.user?.can?.("FILES_UPLOAD"));
}

/** May this user browse the server for a book already there? */
export function canBrowseRulebooks() {
	return !!(game.user?.isGM || game.user?.can?.("FILES_BROWSE"));
}

/**
 * A stable filename per book, rather than whatever the GM's copy happens to be called.
 *
 * DETERMINISTIC on purpose: a GM who re-picks a different file overwrites the one copy instead
 * of leaving a 60 MB orphan behind under its old shop filename, and nobody has to go and find
 * that to delete it. It also means the path in the setting never has to be repaired if the
 * source file is renamed on their disk.
 */
export function rulebookFileName(book) {
	const entry = rulebook(book);
	return `book-${(entry?.numeral ?? String(book)).toLowerCase()}.pdf`;
}

/**
 * Copy one chosen file into the world's data and answer with the path it can be fetched from,
 * or null if it was not written.
 *
 * Null rather than a thrown error, because a refused upload does not throw: Foundry answers
 * false and The Forge answers false on every failure path it has (a quota, a bad response, an
 * asset the API refused). See `uploadFile`, which is where that is turned into an answer a
 * caller cannot mistake for success. Recording a path to a file nobody wrote is how a book icon
 * comes to open a reader that shows nothing, with no error naming the upload as the cause.
 */
export async function storeRulebookFile(book, file) {
	if (!file) return null;
	await ensureDataDir(RULEBOOK_DIR);
	// Renamed on the way in, so the copy is `book-i.pdf` whatever it was called on their disk.
	const named = new File([file], rulebookFileName(book), { type: "application/pdf" });
	return uploadFile("data", RULEBOOK_DIR, named);
}

/**
 * The whole gesture, with something said at each end of it.
 *
 * A 36 MB book and a 60 MB one take a visible moment to copy and Foundry shows nothing while
 * they do (our `uploadFile` passes `notify: false` so that batch jobs are not a wall of toasts;
 * this is a single deliberate file, so it is the one place that silence is wrong). Saying so
 * before and after is the difference between a slow copy and a button that appears to have done
 * nothing.
 *
 * @returns {Promise<string|null>} the stored path, or null if it was refused.
 */
export async function storeRulebookWithNotice(book, file) {
	const title = bookTitle(book);
	ui.notifications?.info?.(format("stonetop.books.copying", { title }));
	let path = null;
	try {
		path = await storeRulebookFile(book, file);
	} catch (err) {
		console.error("Stonetop | Could not copy a rulebook into the world.", err);
	}
	if (path) ui.notifications?.info?.(format("stonetop.books.copied", { title }));
	else ui.notifications?.error?.(format("stonetop.books.copyFailed", { title }));
	return path;
}

/**
 * Copy a book in AND write down where it landed: the whole "keep this book" gesture.
 *
 * Two callers, and the second is why this is a function rather than two lines in a dialog. The
 * rulebooks window does it because keeping the book IS its errand. The Import Book Art macro
 * does it because a GM has already handed it the very same 60 MB file to pull illustrations out
 * of, and asking for that file a second time, through a different window, to put it somewhere
 * else, is a chore we were imposing for no reason a GM can see.
 *
 * The ORDER is the load-bearing part and it is the same one RulebooksDialog always used: nothing
 * is recorded until there is a path. A refused upload does not throw (see storeRulebookFile), so
 * writing the path first, or writing it unconditionally, is how a world comes to hold a pointer
 * to a file nobody wrote, and the only symptom is a book icon that opens an empty reader.
 *
 * @returns {Promise<string|null>} the stored path, or null if nothing was written.
 */
export async function keepRulebook(book, file) {
	const stored = await storeRulebookWithNotice(book, file);
	if (!stored) return null;
	await saveRulebookPath(book, stored);
	return stored;
}
