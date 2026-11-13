// Make a Hazard, reopened after a reload where it was left, the way Create a Site is
// (sites/create-site-restore.js, by way of utils/window-restore.js): the same step, every answer
// written so far, at the same place on screen. "Save for now" keeps a half-made hazard, but only if
// it was pressed before the reload; this keeps the rest.
//
// Its own small module so stonetop.js can register it at load WITHOUT importing the walkthrough. That
// is also why the class is named here rather than passed: window-restore builds the hook names from
// it, and tests/hazards/create-hazard-restore.test.js holds this name and the class's own together,
// so a rename of the class can't quietly stop it being restored.
//
// A walkthrough that was MAKING a hazard comes back without the Threats & Dangers tab that awaited
// its answer, so it files the hazard itself when it finishes (CreateHazardDialog#_finish).

import { registerRestorableWindow } from "../utils/window-restore.js";
import { openOrFocus } from "../utils/open-or-focus.js";

export const CREATE_HAZARD_RESTORE_KIND = "createHazard";
export const CREATE_HAZARD_WINDOW_CLASS = "CreateHazardDialog";
/** The rest of the key for a hazard not made yet. An edit's is the page's uuid, which this can't be. */
export const NEW_HAZARD_KEY = "new";

/** The window ids CreateHazardDialog takes: one for making a hazard, one per page being edited. */
const createHazardWindowId = (page) => (page ? `stonetop-create-hazard-${page.id}` : "stonetop-create-hazard");

/**
 * The Make a Hazard window a reload brings back, unrendered, from the key it was saved under
 * (CreateHazardDialog#restoreKey), or null when it should stay shut: this user isn't a GM (hazards are
 * GM prep), or the hazard being edited has gone or can no longer be edited by them.
 */
export async function reopenCreateHazard(key) {
	const at = String(key ?? "").indexOf(":");
	if (at < 0 || key.slice(0, at) !== CREATE_HAZARD_RESTORE_KIND) return null;
	if (!game.user?.isGM) return null;
	const rest = key.slice(at + 1);
	let page = null;
	if (rest !== NEW_HAZARD_KEY) {
		page = await fromUuid(rest).catch(() => null);
		if (!page?.canUserModify?.(game.user, "update")) return null;
	}
	const { CreateHazardDialog } = await import("./create-hazard-dialog.js");
	return openOrFocus(createHazardWindowId(page), () => new CreateHazardDialog(page ? { page } : {}));
}

/** Registered once, at module scope in stonetop.js. */
export function registerCreateHazardRestore() {
	registerRestorableWindow({ name: CREATE_HAZARD_WINDOW_CLASS }, CREATE_HAZARD_RESTORE_KIND, reopenCreateHazard);
}
