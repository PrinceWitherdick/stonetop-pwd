// The love letter window, reopened after a reload where it was left, the way the character sheet is
// (utils/window-restore.js): the letter as typed, sent or not, at the same place on screen. A letter
// is a GM's paragraphs of prose, and until Send or Save as draft it lives only in the window.
//
// Registered by name from this small module (utils/window-restore.js#registerRestorableWindow says
// why); tests/dialogs/love-letter-restore.test.js holds this name and the class's own together.

import { readDocOrNewKey, registerRestorableWindow, restoreKeyRest } from "../utils/window-restore.js";

export const LOVE_LETTER_RESTORE_KIND = "loveLetter";
export const LOVE_LETTER_WINDOW_CLASS = "LoveLetterDialog";

/**
 * The love letter window a reload brings back, unrendered, or null for a player (letters are the
 * GM's). One whose letter has gone since comes back as a new letter with what was typed in it,
 * rather than losing that.
 */
export async function reopenLoveLetter(key) {
	const rest = restoreKeyRest(key, LOVE_LETTER_RESTORE_KIND);
	if (rest === null) return null;
	if (!game.user?.isGM) return null;
	const { doc, newId: letterId } = await readDocOrNewKey(rest);
	const item = doc?.documentName === "Item" ? doc : null;
	const { LoveLetterDialog } = await import("./LoveLetterDialog.js");
	return new LoveLetterDialog({ item, letterId });
}

/** Registered once, at module scope in stonetop.js. */
export function registerLoveLetterRestore() {
	registerRestorableWindow({ name: LOVE_LETTER_WINDOW_CLASS }, LOVE_LETTER_RESTORE_KIND, reopenLoveLetter);
}
