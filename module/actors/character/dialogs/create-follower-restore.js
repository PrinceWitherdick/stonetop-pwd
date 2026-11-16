// Create a Follower, reopened after a reload where it was left, the way the character sheet is
// (utils/window-restore.js): the same step, every answer written so far, for the same character.
//
// Registered by name from this small module (utils/window-restore.js#registerRestorableWindow says
// why); tests/actors/character/create-follower-restore.test.js holds this name and the class's own together.
//
// The sheet that opened it is not waiting any more after a reload; the walkthrough stores the
// follower on the character itself (CreateFollowerDialog.js#applyCustomFollower).

import { registerRestorableWindow, restoreKeyRest } from "../../../utils/window-restore.js";

export const CREATE_FOLLOWER_RESTORE_KIND = "createFollower";
export const CREATE_FOLLOWER_WINDOW_CLASS = "CreateFollowerDialog";

/**
 * The walkthrough a reload brings back, unrendered, from the key it was saved under
 * (CreateFollowerDialog#restoreKey), or null when it should stay shut: the character has gone, or
 * this user can no longer edit it.
 */
export async function reopenCreateFollower(key) {
	const rest = restoreKeyRest(key, CREATE_FOLLOWER_RESTORE_KIND);
	if (rest === null) return null;
	const actor = await fromUuid(rest).catch(() => null);
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
