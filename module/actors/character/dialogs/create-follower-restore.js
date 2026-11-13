// Create a Follower, reopened after a reload where it was left, the way the character sheet is
// (utils/window-restore.js): the same step, every answer written so far, for the same character.
//
// Its own small module so stonetop.js can register it at load WITHOUT importing the walkthrough. That
// is also why the class is named here rather than passed: window-restore builds the hook names from
// it, and tests/actors/character/create-follower-restore.test.js holds this name and the class's own
// together, so a rename of the class can't quietly stop it being restored.
//
// The sheet that opened it is not waiting any more after a reload; the walkthrough stores the
// follower on the character itself (CreateFollowerDialog.js#applyCustomFollower).

import { registerRestorableWindow } from "../../../utils/window-restore.js";

export const CREATE_FOLLOWER_RESTORE_KIND = "createFollower";
export const CREATE_FOLLOWER_WINDOW_CLASS = "CreateFollowerDialog";

/**
 * The walkthrough a reload brings back, unrendered, from the key it was saved under
 * (CreateFollowerDialog#restoreKey), or null when it should stay shut: the character has gone, or
 * this user can no longer edit it.
 */
export async function reopenCreateFollower(key) {
	const at = String(key ?? "").indexOf(":");
	if (at < 0 || key.slice(0, at) !== CREATE_FOLLOWER_RESTORE_KIND) return null;
	const actor = await fromUuid(key.slice(at + 1)).catch(() => null);
	if (!actor || actor.documentName !== "Actor" || !actor.isOwner) return null;
	// The steading's people as name suggestions, as the sheet offers them. Best-effort: none is fine.
	let residentNames = [];
	try { residentNames = actor.sheet?._steadingResidentNames?.() ?? []; }
	catch (_err) { /* no steading to suggest from */ }
	const { CreateFollowerDialog } = await import("./CreateFollowerDialog.js");
	return new CreateFollowerDialog(actor, null, { residentNames });
}

/** Registered once, at module scope in stonetop.js. */
export function registerCreateFollowerRestore() {
	registerRestorableWindow({ name: CREATE_FOLLOWER_WINDOW_CLASS }, CREATE_FOLLOWER_RESTORE_KIND, reopenCreateFollower);
}
