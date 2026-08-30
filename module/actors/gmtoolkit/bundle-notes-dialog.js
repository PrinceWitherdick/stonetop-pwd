// Pop-up rich-text editor for one gathered bundle's `notes`, opened from the GM Toolkit's
// Encounters and Expeditions tabs. The shell — the editor, both save paths and the unchanged-value
// guard — is shared with the Steading's NPC notes editor in module/dialogs/prose-notes-dialog.js,
// which is where the reasoning about `<prose-mirror>`, `change` and close-time saves now lives.
//
// What is left here is the only part that is about a bundle: the title, and keeping the row this
// dialog was opened from in step with what has been written.
//
// THE TAB IS PASSED IN, not assumed. Both tabs print the same card and open this same window, and
// the only thing that differs is what the title bar calls the thing being written about — so the
// i18n block is an argument rather than a constant. See gm-bundle-tab.js.
import { openProseNotesDialog } from "../../dialogs/prose-notes-dialog.js";
import { localize, format } from "../../utils/i18n.js";

/**
 * Open the rich-notes editor for one gathered bundle.
 *
 * @param {object} bundle  The card's row, as the tab's `list()` normalizes it.
 * @param {string} i18n  The language-file block naming the tab this was opened from, e.g.
 *   `"stonetop.gmToolkit.encounters"`. It supplies `notesTitle`, `notesDone` and the fallback
 *   name for a card the GM has not named.
 * @param {(html: string) => any} onSave  Called with the serialized HTML on every committed edit.
 *   Given the value rather than the id so this file never has to know how the list is stored; the
 *   caller closes over the id it already has.
 */
export async function openBundleNotesDialog(bundle, i18n, onSave) {
	if (!bundle) return;
	const title = bundle.name?.trim() || localize(`${i18n}.removeUnnamed`);

	return openProseNotesDialog({
		title: format(`${i18n}.notesTitle`, { name: title }),
		doneLabel: localize(`${i18n}.notesDone`),
		value: bundle.notes ?? "",
		// RETURNED, not fired and forgotten. `setField` goes through ActorListStore, whose chain
		// absorbs a failed write on purpose so one refusal cannot wedge the writes behind it — so
		// it answers `false` rather than rejecting, and the shell needs that answer to avoid
		// recording a refused edit as saved.
		//
		// The row handed in is NOT written back to: `ActorListStore.get` copies on read, so this
		// object is a snapshot nothing else is holding, and assigning to it only looked like
		// keeping something in step.
		onSave,
		// NO `name`: the value goes back to an ARRAY ELEMENT (`system.encounters[n].notes`), and
		// there is no field name that addresses one.
		width: 560,
		height: 480,
	});
}
