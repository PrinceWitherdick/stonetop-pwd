// Identity + lookup for the seeded "Import Book Art" bring-your-own-book macro,
// shared by the Ready-hook seeder (_ensureBook2ArtMacro) and the Welcome guide's
// launch button (WelcomeDialog._runImportBookArt) so the pack id, macro id, name,
// and legacy names live in exactly one place and can never drift between them.
// The shipped compendium doc is the single source of truth for the macro's
// command/img.
import { BOOK2_ART_APPLY_MANIFEST } from "./manifest.js";
import { MACROS_PACK } from "../system-id.js";

export const BOOK2_ART_MACRO_PACK = MACROS_PACK;
export const BOOK2_ART_MACRO_ID   = "stMacroBook2Art1";
export const BOOK2_ART_MACRO_NAME = "Import Book Art";
// Worlds seeded before the rename carry the old name; callers rename in place.
export const BOOK2_ART_MACRO_LEGACY_NAMES = ["Import Book II Art"];

/**
 * The world's copy of the macro — matched by its current name, else by a
 * pre-rename legacy name — or undefined if the world has none.
 */
export function findBook2ArtWorldMacro() {
	return game.macros.find(m => m.name === BOOK2_ART_MACRO_NAME)
		?? game.macros.find(m => BOOK2_ART_MACRO_LEGACY_NAMES.includes(m.name));
}

/**
 * The shipped compendium copy of the macro (the source of truth for command/img),
 * or undefined if the pack is unavailable. Never throws.
 */
export async function loadBook2ArtMacroSource() {
	try { return await game.packs.get(BOOK2_ART_MACRO_PACK)?.getDocument(BOOK2_ART_MACRO_ID); }
	catch { return undefined; }
}

/**
 * Which edition of a book the import needs, said the way the macro itself says it.
 *
 * There is only one right answer and it is not the obvious one. Every page number and rect the
 * importer works from was measured against the "spreads" edition, the landscape sheet carrying two
 * printed pages side by side. Hand it the 1-up file instead, one printed page per sheet, and every
 * one of those numbers points at a different page of the book: the macro REFUSES a 1-up rulebook
 * rather than attempt it, because a run that half-works would fill the world with the wrong
 * pictures, which is worse than a run that does not start. (The free GM playbook is the exception,
 * and it is not on offer here.)
 *
 * So any surface asking for a book has to name the edition, and name it with the page count, which
 * is the one thing a GM can check against their own file in five seconds. The count is read off the
 * shipped manifest rather than written out here, because it is the same number the macro validates
 * against: two copies of "308" can only be kept in step by attention, and the copy that drifts is
 * the one telling a GM their correct file is the wrong one.
 */
const editionNote = (book) => {
	const pages = BOOK2_ART_APPLY_MANIFEST.expectedPdfPages?.[book];
	return `the ${pages ? `${pages}-page ` : ""}"spreads" edition, two printed pages side by side`;
};

/**
 * The rulebooks a surface may ask for on the macro's behalf, in book order.
 *
 * The macro has a table of its own with the same two volumes in it (plus the free GM playbook,
 * which nothing outside that window asks for). This is not a second copy of that table: it is the
 * short list a surface OTHER than the importer offers, and a book's NUMBER is the whole contract
 * between the two, since that is what the handoff below is keyed by. The notes say what each book
 * is worth to the People gallery specifically, which is the surface making the offer: the faces
 * are drawn almost entirely in Book I, and a GM who owns only Book II should be able to see that
 * before spending a minute on an import that brings back a handful of them.
 */
export const IMPORT_BOOKS = [
	{ book: 1, title: "Book I: Stonetop", note: "nearly every face", edition: editionNote(1) },
	{ book: 2, title: "Book II: The Wider World", note: "a handful more, plus the monsters", edition: editionNote(2) },
];

/**
 * Launch the bring-your-own-book "Import Book Art" macro: prefer the world's seeded
 * copy in the Macro Directory, else run the shipped compendium copy directly. GM-only
 * (the macro browses and writes files), so callers must gate on isGM. Warns and no-ops
 * if neither copy is available. Shared by the Welcome guide's "Import Book Art" button
 * and the post-startup art-import chat reminder so the launch path lives in one place.
 *
 * `picks` hands the macro its answers instead of letting it ask for them. Given
 * `{ books: [{ book, file }] }` the macro skips its setup window entirely and runs on those
 * files, which is what lets the People gallery take a PDF in its own empty state and go:
 * `Macro#execute(scope)` turns each key of the scope into a variable inside the command, and the
 * command reads `scope.stonetopPicks`. Omit it (every caller with nothing to hand over) and the
 * macro opens its window exactly as it always did.
 *
 * The shape is the macro's own, `{ books, force, maps }`, with anything left out defaulted there.
 * Only `books` has a door out here, because only `books` has a surface asking for it; a caller
 * that wants the poster maps or the GM playbook opens the window.
 */
export async function runImportBookArtMacro(picks = null) {
	let macro = findBook2ArtWorldMacro();
	if (!macro) {
		const src = await loadBook2ArtMacroSource();
		if (src?.command) macro = new Macro({ name: BOOK2_ART_MACRO_NAME, type: "script", img: src.img, command: src.command, scope: "global" });
	}
	if (!macro) { ui.notifications.warn("The Import Book Art macro isn't set up in this world yet."); return; }
	// An empty scope rather than a null pick: a world still holding a macro copy from before the
	// handoff existed simply has no `scope.stonetopPicks` to read, and handing over the key
	// regardless would compile one more argument name into a command that never names it.
	return macro.execute(picks ? { stonetopPicks: picks } : {});
}
