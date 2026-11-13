// The love letter window, reopened after a reload where it was left, the way the character sheet is
// (utils/window-restore.js): the letter as typed, sent or not, at the same place on screen. A letter
// is a GM's paragraphs of prose, and until Send or Save as draft it lives only in the window.
//
// Its own small module so stonetop.js can register it at load WITHOUT importing the dialog. That is
// also why the class is named here rather than passed: window-restore builds the hook names from it,
// and tests/dialogs/love-letter-restore.test.js holds this name and the class's own together.

import { registerRestorableWindow } from "../utils/window-restore.js";

export const LOVE_LETTER_RESTORE_KIND = "loveLetter";
export const LOVE_LETTER_WINDOW_CLASS = "LoveLetterDialog";
/** The rest of the key for a letter not saved yet; a saved one's is its Item's uuid, which can't start so. */
export const NEW_LETTER_PREFIX = "new-";

/**
 * The love letter window a reload brings back, unrendered, or null for a player (letters are the
 * GM's). One whose letter has gone since comes back as a new letter with what was typed in it,
 * rather than losing that.
 */
export async function reopenLoveLetter(key) {
	const at = String(key ?? "").indexOf(":");
	if (at < 0 || key.slice(0, at) !== LOVE_LETTER_RESTORE_KIND) return null;
	if (!game.user?.isGM) return null;
	const rest = key.slice(at + 1);
	let item = null;
	let letterId = null;
	if (rest.startsWith(NEW_LETTER_PREFIX)) letterId = rest.slice(NEW_LETTER_PREFIX.length) || null;
	else item = await fromUuid(rest).catch(() => null);
	if (item && item.documentName !== "Item") item = null;
	const { LoveLetterDialog } = await import("./LoveLetterDialog.js");
	return new LoveLetterDialog({ item, letterId });
}

/** Registered once, at module scope in stonetop.js. */
export function registerLoveLetterRestore() {
	registerRestorableWindow({ name: LOVE_LETTER_WINDOW_CLASS }, LOVE_LETTER_RESTORE_KIND, reopenLoveLetter);
}
