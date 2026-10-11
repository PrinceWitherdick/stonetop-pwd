// A book this server already holds, picked up by a world that has not been told about it.
//
// The pointer to a rulebook is a WORLD setting (rulebooks.js), but the copy it points at is not
// the world's: book-store.js puts it in the top-level `stonetop-books/` folder under a fixed name
// (`book-i.pdf`, `book-ii.pdf`), outside every world and system. So a GM who kept their books in
// one world and then made a second found the art there (reapply.js reads it off disk) and the
// GM Toolkit's book icons dimmed, with both files sitting right where the first world left them
// (user, 2026-10-11). This reads the folder the way reapply.js reads the art folder and records
// what it finds.
//
// Only for a book this world has NO answer for. A path already recorded is the GM's choice and
// is left alone, wherever it points; a book the GM Forgot here stays forgotten
// (`wasRulebookForgotten`), or Forget would be undone by the next reload.
//
// A world that Forgot a book BEFORE that marker existed has no marker, and is indistinguishable
// from one that never had the book. Seeding markers for every older world would stop exactly the
// worlds this is for from picking anything up, so instead the notice says how to send a book back:
// one Forget, which now sticks.
import { listDataDir } from "../book2-art/browse.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { format, localize } from "../utils/i18n.js";
import { RULEBOOKS, hasRulebook, wasRulebookForgotten, adoptRulebookPath } from "./rulebooks.js";
import { RULEBOOK_DIR, rulebookFileName } from "./book-store.js";

/** A browsed path's file name, lower-cased, with any query or hash and URL escaping taken off. */
function fileNameOf(path) {
	const last = String(path ?? "").split(/[?#]/)[0].split("/").pop() ?? "";
	try { return decodeURIComponent(last).toLowerCase(); }
	catch { return last.toLowerCase(); }
}

/**
 * Which of the books a listing of `stonetop-books/` holds, as `{ [book]: path }`.
 *
 * The path kept is the one the host LISTED, not one rebuilt from the folder name: off a
 * self-hosted Foundry (The Forge's Assets Library) a browse answers with the full served URL, and
 * that is what the reader has to fetch. Matched on the fixed file name the store writes, so a
 * stray PDF someone dropped in the folder is not taken for a rulebook.
 */
export function rulebooksInListing(files) {
	const found = {};
	for (const entry of RULEBOOKS) {
		const want = rulebookFileName(entry.book);
		const hit = (files ?? []).find(path => fileNameOf(path) === want);
		if (hit) found[entry.book] = hit;
	}
	return found;
}

/**
 * Record any kept book this world is missing, and say so. Answers the book numbers recorded.
 *
 * Primary GM only: the record is a world setting, so a player cannot write it and two GMs would
 * both try. Runs every load rather than once per world, because a world made before the books
 * were kept anywhere should still pick them up when they are; it costs one browse, and only
 * while a book is unanswered.
 */
export async function adoptStoredRulebooks() {
	if (!game.user?.isGM || !isPrimaryGM()) return [];
	const wanted = RULEBOOKS.filter(entry => !hasRulebook(entry.book) && !wasRulebookForgotten(entry.book));
	if (!wanted.length) return [];

	// Through browse.js rather than a bare browse, for the host that keeps uploads elsewhere and
	// answers "empty" about the data-relative folder (see `listDataDir`). A folder that is not
	// there at all answers null, which is the ordinary "never kept a book" case.
	const found = rulebooksInListing((await listDataDir(RULEBOOK_DIR))?.files);

	const adopted = [];
	for (const entry of wanted) {
		const path = found[entry.book];
		// Asked again as it is written (`adoptRulebookPath`): the GM may have answered for this
		// book while the browse was out.
		if (path && await adoptRulebookPath(entry.book, path)) adopted.push(entry);
	}
	if (adopted.length) {
		const books = new Intl.ListFormat(game.i18n?.lang || "en", { type: "conjunction" })
			.format(adopted.map(entry => localize(entry.labelKey)));
		ui.notifications?.info?.(format(adopted.length > 1 ? "stonetop.books.adoptedMany" : "stonetop.books.adopted", { books }));
	}
	return adopted.map(entry => entry.book);
}
