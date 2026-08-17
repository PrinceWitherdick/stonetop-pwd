// GM-prep flows that more than one surface runs.
//
// "Create a site" is reachable from two places — the GM Toolkit's Sites tab and the sidebar's
// Create Stonetop Content picker — and they are the same action: run the walkthrough, file the
// result under the steading. They were written twice and had already diverged in ways nobody
// chose (only one opened the new card expanded).
//
// What deliberately stays with the CALLER is the notice. Creating from the tab shows you the
// card appearing, so a toast is noise; creating from the sidebar may leave the sheet closed
// entirely, so that path says where the site went.
import { createSite } from "../../sites/site-store.js";

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
 * Run the walkthrough and file the result under `steading`.
 * @returns {Promise<JournalEntryPage|null>} The new page, or null if cancelled.
 */
export async function createSiteFlow(steading) {
	if (!steading) return null;
	const seed = await openSiteWizard();
	if (!seed) return null;
	return createSite(steading, seed);
}
