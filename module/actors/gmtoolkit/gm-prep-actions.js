// GM-prep flows that more than one surface runs.
//
// "Create a site" is reachable from two places — the GM Toolkit's Sites tab and the sidebar's
// Create Stonetop Content picker — and they are the same action: run the walkthrough, file the
// result under the steading. They were written twice and had already diverged in ways nobody
// chose (only one opened the new card expanded). The walkthrough files the site itself
// (sites/create-site-dialog.js#_finish), so a reload mid-walkthrough files it the same way.
//
// What deliberately stays with the CALLER is the notice. Creating from the tab shows you the
// card appearing, so a toast is noise; creating from the sidebar may leave the sheet closed
// entirely, so that path passes `announce: true` and the walkthrough says where the site went.

/**
 * Open the Create-a-Site walkthrough, resolving to its seed (or null if cancelled).
 *
 * Imported at CALL time rather than at load: it drags in the whole Create-a-Site book data
 * (data/site-tables.js, the largest data module in the system), and only a GM who opens the
 * walkthrough ever needs it.
 *
 * @param {object} [options]  Passed to the dialog; `{ page }` reopens it pre-filled for an edit.
 */
export async function openSiteWizard(options) {
	const { CreateSiteDialog } = await import("../../sites/create-site-dialog.js");
	return new CreateSiteDialog(options).promise();
}

/**
 * Run the walkthrough, which files the result under `steading`.
 * @param {object} [wizardOptions]  Passed to the dialog: `{ announce: true }` for a caller that
 *   may leave the GM Toolkit closed, so the walkthrough says where the site went.
 * @returns {Promise<JournalEntryPage|null>} The new page, or null if cancelled.
 */
export async function createSiteFlow(steading, wizardOptions = {}) {
	if (!steading) return null;
	return openSiteWizard({ ...wizardOptions, steading });
}

/**
 * Say where a site went, for a path that may leave the GM Toolkit closed: the sidebar's picker, and
 * a walkthrough reopened after a reload (sites/create-site-restore.js). The Sites tab's own button
 * shows the card appearing instead.
 * @param {JournalEntryPage} page
 */
export function announceSiteAdded(page) {
	ui.notifications?.info?.(`Added site: ${page.name}. It's at the foot of the GM Toolkit's Expeditions tab.`);
}
