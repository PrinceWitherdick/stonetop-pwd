// Inline-edit helpers shared by the two stat-block sheets (monster, NPC), which take the same
// whitelisted field/move updates. `sheet` is the AppV1 sheet instance (uses sheet.actor /
// sheet._editMode); the rich-text whitelist is passed per sheet. The header portrait all three
// sheets share is wired by `wirePortraitPopout` in utils/actor-portrait-picker.js.
import { confirmOutcome } from "./ask-with-buttons.js";
import { escHtml } from "./strings.js";

// The only fields an inline stat-block edit may write to a move item (monsterMove / npcMove):
// its name and its two schema fields, so a stray data-field can't write anywhere else.
const MOVE_EDITABLE_FIELDS = new Set(["name", "system.description", "system.rollFormula"]);

// Persist an inline edit to one of the actor's own system fields, whitelisted to `richTextFields`
// (an array of { key } entries) so a stray data-field can't write anywhere else.
export async function updateRichTextField(sheet, richTextFields, field, value) {
	if (!richTextFields.some(entry => entry.key === field)) return;
	await sheet.actor.update({ [`system.${field}`]: value ?? "" });
}

// Persist an inline edit to one of a move item's fields, whitelisted to MOVE_EDITABLE_FIELDS.
export async function updateMoveField(sheet, itemId, field, value) {
	if (!MOVE_EDITABLE_FIELDS.has(field)) return;
	const item = sheet.actor.items.get(itemId);
	if (!item) return;
	await item.update({ [field]: value ?? "" });
}

// The embedded item whose row (`[data-item-id]`) the event happened in, if any.
export function itemFromRow(sheet, ev) {
	return sheet.actor.items.get(ev.target.closest("[data-item-id]")?.dataset?.itemId);
}

// Ask before deleting a move. Resolves true only when the user confirms.
export function confirmDeleteMove(item) {
	return confirmOutcome({
		title:   "Delete Move",
		// Escaped: a move name is user text, and this is HTML.
		content: `<p>Delete <strong>${escHtml(item.name)}</strong>?</p>`,
		yes:     { label: "Delete the move", icon: "fa-trash" },
		no:      { label: "Keep it" },
	});
}

// The stat block's inline-edit change handler, with classes named `${prefix}-move-field` and
// `${prefix}-rich-editor`. Move fields (name, roll formula, description) persist straight to the
// item, edit mode only; they are checked first since the move description editor also carries the
// shared rich-editor class. Rich-text fields go through sheet._updateRichTextField: Notes stays
// editable in play mode, the others only in edit mode.
export function wireStatBlockInlineEdits(sheet, root, prefix) {
	root.addEventListener("change", async ev => {
		const moveField = ev.target.closest(`.${prefix}-move-field`);
		if (moveField) {
			if (!sheet._editMode) return;
			const li = ev.target.closest("[data-item-id]");
			await sheet._updateMoveField(li?.dataset?.itemId, moveField.dataset?.field, moveField.value);
			return;
		}

		const editor = ev.target.closest(`.${prefix}-rich-editor`);
		if (!editor) return;
		if (editor.dataset?.field === "notes" || sheet._editMode) {
			await sheet._updateRichTextField(editor.dataset?.field, editor.value);
		}
	});
}
