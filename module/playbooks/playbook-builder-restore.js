// The Playbook Builder, reopened after a reload where it was left, the way the character sheet is
// (utils/window-restore.js): the same panel, every field typed so far, saved or not, at the same place
// on screen. A playbook is an evening's typing, and a reload (a setting that asks for one, a dropped
// connection) used to throw all of it away.
//
// Its own small module so stonetop.js can register it at load WITHOUT importing the builder and the
// bundle code behind it. That is also why the class is named here rather than passed: window-restore
// builds the hook names from it, and tests/playbooks/playbook-builder.test.js holds this name and the
// class's own together, so a rename of the class can't quietly stop it being restored.

import { registerRestorableWindow } from "../utils/window-restore.js";

export const PLAYBOOK_BUILDER_RESTORE_KIND = "playbookBuilder";
export const PLAYBOOK_BUILDER_WINDOW_CLASS = "PlaybookBuilderDialog";
/**
 * The rest of the key for a playbook not saved yet: "new-" and the window's own draft id, so two new
 * playbooks open at once are kept apart. A saved one's is its Item's uuid, which can't start so.
 */
export const NEW_PLAYBOOK_PREFIX = "new-";

// "Check the imported playbook" (PlaybookImportReview) comes back too: every move, split, join and
// answer, on the page it was left on. It is keyed by an id of its own, and remembers the builder it
// came from so it can hand what it finishes with to that window (the builder awaiting it is gone).
export const IMPORT_REVIEW_RESTORE_KIND = "playbookImportReview";
export const IMPORT_REVIEW_WINDOW_CLASS = "PlaybookImportReview";

/**
 * The Playbook Builder a reload brings back, unrendered, from the key it was saved under
 * (PlaybookBuilderDialog#restoreKey), or null when it should stay shut: this user isn't a GM
 * (homebrew playbooks are GM work). One whose Item has gone since comes back as a new playbook with
 * what was typed in it, rather than losing that.
 */
export async function reopenPlaybookBuilder(key) {
	const at = String(key ?? "").indexOf(":");
	if (at < 0 || key.slice(0, at) !== PLAYBOOK_BUILDER_RESTORE_KIND) return null;
	if (!game.user?.isGM) return null;
	const rest = key.slice(at + 1);
	let item = null;
	let draftId = null;
	if (rest.startsWith(NEW_PLAYBOOK_PREFIX)) draftId = rest.slice(NEW_PLAYBOOK_PREFIX.length) || null;
	else item = await fromUuid(rest).catch(() => null);
	const { PlaybookBuilderDialog } = await import("./PlaybookBuilderDialog.js");
	return new PlaybookBuilderDialog({ item, draftId });
}

/**
 * The import review a reload brings back, unrendered, or null for a non-GM. Its draft rides in the
 * saved view (PlaybookImportReview#restoreView) and goes on at its first draw.
 */
export async function reopenImportReview(key) {
	const at = String(key ?? "").indexOf(":");
	if (at < 0 || key.slice(0, at) !== IMPORT_REVIEW_RESTORE_KIND) return null;
	if (!game.user?.isGM) return null;
	const reviewId = key.slice(at + 1);
	if (!reviewId) return null;
	const { PlaybookImportReview } = await import("./PlaybookImportReview.js");
	return new PlaybookImportReview({ reviewId });
}

/** Registered once, at module scope in stonetop.js: the builder and its import review. */
export function registerPlaybookBuilderRestore() {
	registerRestorableWindow({ name: PLAYBOOK_BUILDER_WINDOW_CLASS }, PLAYBOOK_BUILDER_RESTORE_KIND, reopenPlaybookBuilder);
	registerRestorableWindow({ name: IMPORT_REVIEW_WINDOW_CLASS }, IMPORT_REVIEW_RESTORE_KIND, reopenImportReview);
}
