// Create a Site, reopened after a reload where it was left, the way the character sheet is
// (utils/window-restore.js): the same step, every answer written so far, at the same place on screen.
//
// Its own small module so stonetop.js can register it at load WITHOUT importing the walkthrough,
// which drags in the whole Create-a-Site book data (gm-prep-actions.js#openSiteWizard says why that
// waits for a GM who opens it). That is also why the class is named here rather than passed:
// window-restore builds the hook names from it, and tests/sites/create-site-dialog.test.js holds this
// name and the class's own together, so a rename of the class can't quietly stop it being restored.
//
// A walkthrough that was MAKING a site comes back without whoever opened it: the reload dropped the
// caller waiting on its answer. That loses nothing, since the window files the site itself when it
// finishes (CreateSiteDialog#_finish), and this one also says where it went.

import { registerRestorableWindow } from "../utils/window-restore.js";
import { openOrFocus } from "../utils/open-or-focus.js";

export const CREATE_SITE_RESTORE_KIND = "createSite";
export const CREATE_SITE_WINDOW_CLASS = "CreateSiteDialog";
/** The rest of the key for a site not made yet. An edit's is the page's uuid, which this can't be. */
export const NEW_SITE_KEY = "new";

/** The window ids CreateSiteDialog takes: one for making a site, one per page being edited. */
export const createSiteWindowId = (page) => (page ? `stonetop-create-site-${page.id}` : "stonetop-create-site");

/**
 * The Create a Site window a reload brings back, unrendered, from the key it was saved under
 * (CreateSiteDialog#restoreKey), or null when it should stay shut: this user isn't a GM (sites are
 * GM prep), or the site being edited has gone or can no longer be edited by them.
 */
export async function reopenCreateSite(key) {
	const at = String(key ?? "").indexOf(":");
	if (at < 0 || key.slice(0, at) !== CREATE_SITE_RESTORE_KIND) return null;
	if (!game.user?.isGM) return null;
	const rest = key.slice(at + 1);
	let page = null;
	if (rest !== NEW_SITE_KEY) {
		page = await fromUuid(rest).catch(() => null);
		if (!page?.canUserModify?.(game.user, "update")) return null;
	}
	const { CreateSiteDialog } = await import("./create-site-dialog.js");
	// A new site files itself when it finishes; announce, since the toolkit may not be open.
	return openOrFocus(createSiteWindowId(page), () => new CreateSiteDialog(page ? { page } : { announce: true }));
}

/** Registered once, at module scope in stonetop.js. */
export function registerCreateSiteRestore() {
	registerRestorableWindow({ name: CREATE_SITE_WINDOW_CLASS }, CREATE_SITE_RESTORE_KIND, reopenCreateSite);
}
