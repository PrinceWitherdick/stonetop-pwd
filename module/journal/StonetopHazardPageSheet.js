// Sheet for the "hazard" JournalEntryPage subtype (see gm-prep-page-sheet.js for the
// shared behaviour). Like the threat page sheet it renders ONLY the book-faithful card
// (view) with live doom-track checkboxes, a reveal toggle, and an owner Edit button.
//
// Editing opens the Make-a-Hazard walkthrough pre-filled (CreateHazardDialog in edit
// mode) rather than a separate editor dialog; the wizard IS the hazard editor.
import { buildHazardCardVM } from "../hazards/hazard-view.js";
import { CreateHazardDialog } from "../hazards/create-hazard-dialog.js";
import { createStonetopGmPrepPageSheetClass } from "./gm-prep-page-sheet.js";
import { gmPrepCardWiring } from "./gm-prep-page.js";

export function createStonetopHazardPageSheetClass(Base) {
	return createStonetopGmPrepPageSheetClass(Base, {
		template: "systems/stonetop-pwd/templates/journal/hazard-page.hbs",
		buildCardVM: buildHazardCardVM,
		editSelector: ".hazard-edit-start",
		openEditor: (document) => new CreateHazardDialog({ page: document }).promise(),
		// The damage line's Roll damage / Certain death (Book I p.383), from the same per-kind table the
		// GM Toolkit and the canvas board wire from, as the site sheet does its table rolls.
		wireExtras: (root, page) => gmPrepCardWiring("hazard")?.(root, () => page),
	});
}
