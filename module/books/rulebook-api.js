// The one door between the Import Book Art macro and the reader's side of a book.
//
// WHY A FACADE AND NOT AN IMPORT. The importer is a shipped MACRO: a string of JavaScript stored
// in a compendium, seeded into the world's Macro Directory, and run from there. It is deliberately
// self-contained — it imports nothing but Foundry's own bundled pdf.js, which is what lets it run
// on a world whose system scripts failed to start, and what keeps it honest about shipping no
// system internals. Reaching into `module/books/*` by path from that string would tie a document
// stored in a world's database to a file layout it cannot see, and the failure would be a macro
// that throws on a world one version behind.
//
// `game.stonetop` is the seam this system already uses for exactly that (hooks/HotbarDrop.js
// writes `game.stonetop?.rollMoveMacro?.(...)` into every move macro it mints). So the macro asks
// `game.stonetop?.rulebooks` for what it needs, gets null on a world where the system never ran,
// and offers nothing rather than breaking.
//
// WHAT IT IS FOR. A GM importing the book art has just handed us the whole 60 MB PDF. The reader
// (books/rulebooks.js) wants a copy of that same file, and before this existed the only way to
// give it one was to open a second window and pick the same book off disk again. That is the
// same file, asked for twice, for two features that each already know what they want with it.
import { rulebook, hasRulebook, bookTitle } from "./rulebooks.js";
import { canStoreRulebook, keepRulebook } from "./book-store.js";

/**
 * The macro-facing view of the rulebooks, as a plain object of small questions.
 *
 * Every method takes a BOOK NUMBER, which is the entire contract between the two sides: the
 * macro's own table of books is keyed by it, `RULEBOOKS` is keyed by it, and the GM Toolkit's
 * page citations cite it (gm-toolkit/book-ref.js). Nothing else crosses.
 */
export function rulebookMacroApi() {
	return {
		/**
		 * May this run offer to keep this particular book?
		 *
		 * Two questions, and BOTH have to be asked. The user needs the right to write a file at
		 * all, and the reader has to know what this book is: the macro also reads the free GM
		 * playbook (`book: 3`), which no reader icon opens, so keeping a copy of it would upload
		 * a file this world has no way to show anyone.
		 */
		canKeep: book => !!rulebook(book) && canStoreRulebook(),
		/** Has this world already got a copy of this book to read? */
		has: book => hasRulebook(book),
		/** The book's own title, so the macro's copy and the reader's agree on its name. */
		title: book => bookTitle(book),
		/**
		 * Keep the file the macro was handed, and answer with where it landed (null if refused).
		 *
		 * Re-checked here rather than trusted from the caller. The macro decides what to OFFER
		 * from `canKeep` at the moment it draws its window, and a run started then can finish
		 * minutes later; this is the check that actually gates the write.
		 */
		keep: async (book, file) => {
			if (!rulebook(book) || !canStoreRulebook() || !file) return null;
			return keepRulebook(book, file);
		},
	};
}
