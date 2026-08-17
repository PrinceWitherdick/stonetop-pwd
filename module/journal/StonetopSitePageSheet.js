// Sheet for the "site" JournalEntryPage subtype (see gm-prep-page-sheet.js for the shared
// behaviour). Like the threat and hazard page sheets it renders ONLY the book-faithful
// card (view), with an owner Edit button; a site's own random tables are rollable right
// from the card, which is the point of writing them up as tables (Book I p. 369).
//
// Editing opens the Create-a-Site walkthrough pre-filled (CreateSiteDialog in edit mode)
// rather than a separate editor dialog; the wizard IS the site editor.
import { buildSiteCardVM } from "../sites/site-view.js";
import { openSiteWizard } from "../actors/gmtoolkit/gm-prep-actions.js";
import { gmPrepCardWiring } from "./gm-prep-page.js";
import { createStonetopGmPrepPageSheetClass } from "./gm-prep-page-sheet.js";

export function createStonetopSitePageSheetClass(Base) {
	return createStonetopGmPrepPageSheetClass(Base, {
		template: "systems/stonetop-pwd/templates/journal/site-page.hbs",
		buildCardVM: buildSiteCardVM,
		editSelector: ".site-edit-start",
		// Through the shared opener rather than standing the dialog up here: this is the THIRD
		// surface that opens the walkthrough (the Sites tab and the sidebar's Create Stonetop
		// Content picker are the other two), and gm-prep-actions.js exists because the first two
		// had already diverged. It keeps the click-time import too — the wizard drags in the whole
		// Create-a-Site book data (data/site-tables.js, the largest data module in the system),
		// and only a GM who opens the editor ever needs it. Viewing a site card does not.
		openEditor: (document) => openSiteWizard({ page: document }),
		// Read from the same per-kind table the multi-kind hosts wire from, so a site's card
		// controls are declared in exactly one place however the card is being drawn.
		wireExtras: (root, page) => gmPrepCardWiring("site")?.(root, () => page),
	});
}
