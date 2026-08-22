// Pop-up rich-text editor for an NPC's `system.notes`, opened from the Steading
// Residents/Neighbors "Notes" column. The NPC sheet's Notes section and this pop-up edit the SAME
// field, so a change in either place shows in the other (two-way) and both keep full rich text —
// formatting and @UUID links.
//
// The shell — the editor, both save paths and the unchanged-value guard — is shared with the GM
// Toolkit's encounter notes editor in module/dialogs/prose-notes-dialog.js, which is where the
// reasoning about `<prose-mirror>`, `change` and close-time saves now lives. Sharing it is also
// what gave this dialog its save on close: dismissing it with Escape or the X used to lose the
// edit, because the only write was the one core makes from the save keybinding.
import { openProseNotesDialog } from "../../dialogs/prose-notes-dialog.js";
import { error } from "../../utils/logger.js";

/**
 * Open the rich-notes editor for an NPC actor.
 * @param {Actor} actor  an Actor of type "npc"
 */
export async function openNpcNotesDialog(actor) {
	if (actor?.type !== "npc") return;

	return openProseNotesDialog({
		title: `${actor.name}: Notes`,
		doneLabel: "Done",
		value: actor.system?.notes ?? "",
		// Writing to the actor re-renders both the NPC sheet and the steading roster, which share
		// this field — the two-way sync. NPCs are GM-owned prep, so a player who reached this
		// through the steading roster gets a permission rejection here. Unhandled, that was
		// silent: the editor showed the text as saved and it was gone on the next open.
		//
		// RE-THROWN after it is reported, which the toast alone does not cover. The shell tracks
		// what it has written so it can drop a duplicate commit, and a rejection swallowed here
		// looked to it like a write that landed: the same text would never be sent again, so the
		// GM granting ownership a moment later did not help and pressing Done wrote nothing.
		onSave: (value) => actor.update({ "system.notes": value }).catch(err => {
			error("could not save the NPC's notes", err);
			ui.notifications?.warn("Those notes could not be saved: you don't own this NPC.");
			throw err;
		}),
		name: "system.notes",
		windowClass: "stonetop-npc-notes-window",
		width: 520,
		height: 460,
	});
}
