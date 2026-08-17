// Pop-up rich-text editor for an NPC's `system.notes`, opened from the Steading
// Residents/Neighbors "Notes" column. The NPC sheet's Notes section and this pop-up
// edit the SAME field, so a change in either place shows in the other (two-way) and
// both keep full rich text — formatting and @UUID links.
//
// A bare `<prose-mirror>` (no `toggled`) renders an editable editor as soon as it's in
// the DOM, exactly like the always-on editors in location.hbs / arcanum-sheet-edit.hbs.
// It fires a bubbling `change` carrying the serialized HTML on `.value`; we write that
// straight to the actor (auto-save on blur, matching how the sheets persist rich fields).
import { enrichHTML } from "../../utils/foundry-compat.js";
import { attachFrontOnOpen } from "../../utils/front-on-open.js";

/**
 * Open the rich-notes editor for an NPC actor.
 * @param {Actor} actor  an Actor of type "npc"
 */
export async function openNpcNotesDialog(actor) {
	if (actor?.type !== "npc") return;
	const source   = actor.system?.notes ?? "";
	const enriched = await enrichHTML(source);
	const valueAttr = foundry.utils.escapeHTML(source);

	const content = `<div class="stonetop-npc-notes-dialog-body">
		<prose-mirror class="stonetop-npc-notes-dialog-editor" name="system.notes" value="${valueAttr}">${enriched}</prose-mirror>
	</div>`;

	const dialog = new Dialog({
		title: `${actor.name}: Notes`,
		content,
		buttons: {
			done: { icon: '<i class="fas fa-check"></i>', label: "Done" },
		},
		default: "done",
		render: (html) => {
			const root = html[0] ?? html;
			const editor = root.querySelector?.("prose-mirror")
				?? html.find?.("prose-mirror")?.[0];
			// Persist on each committed edit (the element fires `change` on save/blur).
			// Writing to the actor re-renders both the NPC sheet and the steading roster,
			// which share this field — the two-way sync. Guard against a redundant write
			// (the initial value bubbling through) so we don't log a no-op ledger entry.
			// NPCs are GM-owned prep, so a player who reached this through the steading roster
			// gets a permission rejection here. Unhandled, that was silent: the editor showed
			// the text as saved and it was gone on the next open.
			editor?.addEventListener("change", (ev) => {
				const value = ev.target?.value ?? "";
				if (value === (actor.system?.notes ?? "")) return;
				actor.update({ "system.notes": value }).catch(err => {
					console.error("Stonetop | could not save the NPC's notes", err);
					ui.notifications?.warn("Those notes could not be saved: you don't own this NPC.");
				});
			});
		},
	}, {
		width: 520,
		height: 460,
		resizable: true,
		classes: ["dialog", "stonetop", "stonetop-npc-notes-window"],
	});
	attachFrontOnOpen(dialog);
	dialog.render(true);
}
