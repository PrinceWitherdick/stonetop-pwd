// Pop-up rich-text editor for one encounter's `notes`, opened from the GM Toolkit's Encounters
// tab. The shell — the editor, both save paths and the unchanged-value guard — is shared with the
// Steading's NPC notes editor in module/dialogs/prose-notes-dialog.js, which is where the reasoning
// about `<prose-mirror>`, `change` and close-time saves now lives.
//
// What is left here is the only part that is about encounters: the title, and keeping the row this
// dialog was opened from in step with what has been written.
import { openProseNotesDialog } from "../../dialogs/prose-notes-dialog.js";
import { localize, format } from "../../utils/i18n.js";

/**
 * Open the rich-notes editor for one encounter.
 *
 * @param {object} encounter  The encounter row, as `_encounterList()` normalizes it.
 * @param {(html: string) => any} onSave  Called with the serialized HTML on every committed edit.
 *   Given the value rather than the id so this file never has to know how the list is stored; the
 *   caller closes over the id it already has.
 */
export async function openEncounterNotesDialog(encounter, onSave) {
	if (!encounter) return;
	const title = encounter.name?.trim() || localize("stonetop.gmToolkit.encounters.removeUnnamed");

	return openProseNotesDialog({
		title: format("stonetop.gmToolkit.encounters.notesTitle", { name: title }),
		doneLabel: localize("stonetop.gmToolkit.encounters.notesDone"),
		value: encounter.notes ?? "",
		// RETURNED, not fired and forgotten. `_setEncounterField` goes through ActorListStore,
		// whose chain absorbs a failed write on purpose so one refusal cannot wedge the writes
		// behind it — so it answers `false` rather than rejecting, and the shell needs that answer
		// to avoid recording a refused edit as saved.
		//
		// The row handed in is NOT written back to: `ActorListStore.get` copies on read, so this
		// object is a snapshot nothing else is holding, and assigning to it only looked like
		// keeping something in step.
		onSave: (value) => onSave(value),
		// NO `name`: the value goes back to an ARRAY ELEMENT (`system.encounters[n].notes`), and
		// there is no field name that addresses one.
		width: 560,
		height: 480,
	});
}
