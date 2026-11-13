// Make a Monster, reopened after a reload where it was left, the way the character sheet is
// (utils/window-restore.js): the same section, every box ticked and every card written, at the same
// place on screen. A worksheet is a fair while of thought, and it lives only in its form.
//
// Its own small module so stonetop.js can register it at load WITHOUT importing the worksheet and the
// monster-builder tables behind it. That is also why the class is named here rather than passed:
// window-restore builds the hook names from it, and tests/dialogs/create-monster-restore.test.js holds
// this name and the class's own together, so a rename of the class can't quietly stop it being restored.
//
// Nothing waits on the worksheet's answer: it makes the stat block itself, so the one a reload brings
// back finishes exactly as the one it replaced would have.

import { registerRestorableWindow } from "../utils/window-restore.js";
import { openOrFocus } from "../utils/open-or-focus.js";

export const CREATE_MONSTER_RESTORE_KIND = "createMonster";
export const CREATE_MONSTER_WINDOW_CLASS = "CreateMonsterDialog";
/** The rest of the key. There is only ever one worksheet open (its fixed window id). */
export const NEW_MONSTER_KEY = "new";
const CREATE_MONSTER_WINDOW_ID = "stonetop-create-monster";

/** The worksheet a reload brings back, unrendered, or null for any other key or a non-GM. */
export async function reopenCreateMonster(key) {
	if (key !== `${CREATE_MONSTER_RESTORE_KIND}:${NEW_MONSTER_KEY}`) return null;
	if (!game.user?.isGM) return null;
	const { CreateMonsterDialog } = await import("./CreateMonsterDialog.js");
	return openOrFocus(CREATE_MONSTER_WINDOW_ID, () => new CreateMonsterDialog());
}

/** Registered once, at module scope in stonetop.js. */
export function registerCreateMonsterRestore() {
	registerRestorableWindow({ name: CREATE_MONSTER_WINDOW_CLASS }, CREATE_MONSTER_RESTORE_KIND, reopenCreateMonster);
}
