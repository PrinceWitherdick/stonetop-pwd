// The pop-up rich-text editor, once, for every field that needs one and has nowhere to put it.
//
// TWO CALLERS, one problem. An NPC's `system.notes`, reached from the Steading Residents column,
// and one encounter's `notes` on the GM Toolkit's Encounters tab. Neither field has a permanent
// home on a sheet: the first belongs to a document whose sheet is somewhere else, the second to a
// ROW IN A LIST, which has no field name that addresses it at all.
//
// A POP-UP RATHER THAN AN INLINE EDITOR, and on the toolkit that is not a preference. That sheet
// re-renders on every threat, hazard and site write anywhere in the WORLD (see `_wirePrepPageSync`),
// a redraw no blur precedes, so an always-live ProseMirror on the tab would be torn out from under
// a GM mid-sentence by another client ticking a grim portent. A Dialog is a separate Application,
// so the sheet's redraw cannot reach into it.
//
// A bare `<prose-mirror>` (no `toggled`) renders an editable editor as soon as it is in the DOM,
// exactly like the always-on editors in location.hbs. It fires a bubbling `change` carrying the
// serialized HTML on `.value`.
//
// WHEN that change fires is worth knowing, because it is NOT on blur. For an always-on editor core
// calls `save()` from the ProseMirror save keybinding and from `disconnectedCallback` — so the two
// writes a GM can count on are Ctrl+S and the dialog closing. The close path leans on the element
// still being connected while the dialog tears its DOM down, so the same save is ALSO made from the
// dialog's own `close` callback, which AppV1 runs BEFORE removing the element
// (appv1/api/dialog-v1.mjs). Saving twice costs nothing: `commit` drops an unchanged value before it
// reaches the caller. That close-time save used to exist on ONE of these two dialogs, which meant
// dismissing the other with Escape or the X silently lost the edit; sharing the shell gives both
// the better of the two behaviours rather than leaving them to drift.
import { enrichHTML } from "../utils/foundry-compat.js";
import { attachFrontOnOpen } from "../utils/front-on-open.js";

/**
 * Open a rich-notes editor over one string, and call back with every committed edit.
 *
 * @param {object}   opts
 * @param {string}   opts.title        The window title, already localized.
 * @param {string}   opts.doneLabel    The confirm button's label, already localized.
 * @param {string}   [opts.value]      The prose to open with.
 * @param {(html: string) => any} opts.onSave  Called with the serialized HTML on each committed
 *   edit. Given the VALUE rather than any identity, so this file never learns where the prose is
 *   stored; the caller closes over whatever it needs to write it.
 * @param {string}   [opts.name]       `name` for the editor element. Core reads it only to build a
 *   collaborative editor's `fieldName` (applications/elements/prosemirror-editor.mjs), and these
 *   are not collaborative, so it is optional: a value going back to an array element has no field
 *   name that addresses it, and leaving it off costs nothing.
 * @param {string}   [opts.windowClass]  An EXTRA class on the window, for anything this caller
 *   wants sized differently. The layout itself rides on `stonetop-prose-notes-window`, which every
 *   one of these gets, so a caller only needs this when it really does differ.
 * @param {number}   [opts.width]
 * @param {number}   [opts.height]
 * @returns {Promise<Dialog>} The open dialog, for a caller that wants to close it itself.
 */
export async function openProseNotesDialog({
	title, doneLabel, value = "", onSave, name = "",
	windowClass = "", width = 540, height = 470,
}) {
	const source = value ?? "";
	const enriched = await enrichHTML(source);
	const nameAttr = name ? ` name="${name}"` : "";

	const content = `<div class="stonetop-prose-notes-body">
		<prose-mirror class="stonetop-prose-notes-editor"${nameAttr} value="${foundry.utils.escapeHTML(source)}">${enriched}</prose-mirror>
	</div>`;

	// Held from `render` so `close` can read the editor without going back through jQuery on an
	// element that is about to be removed.
	let live = null;
	// What was last written. Held HERE rather than re-read from the document, because a write can
	// still be in flight: comparing against the document would let a second commit through as a
	// duplicate. It is what stops the initial value bubbling straight back through as a write,
	// which would re-render the caller's sheet under someone who has not typed anything yet, and
	// what makes the belt-and-braces save on close free.
	let saved = source;

	// A write that did NOT land must not be remembered as one. Rolled back only while `saved` is
	// still the value that failed: anything typed since is newer and has a write of its own in
	// flight, and putting the old text back over it would lose that instead.
	const unsay = (attempted, previous) => {
		if (saved === attempted) saved = previous;
	};

	/**
	 * Commit one edit, unless it is the value already written.
	 *
	 * `saved` advances BEFORE the write goes out, so a second `change` carrying the same text
	 * while the first is still in flight is dropped rather than sent twice — but it is put back if
	 * the write is refused, and THAT is the half that was missing. An NPC's notes are GM-owned
	 * prep, so a player reaching this from the Steading roster gets a rejection; recording the
	 * rejected text as saved meant neither a repeat edit nor the save on close would ever try
	 * again, and the note was lost with the editor still showing it.
	 *
	 * A caller signals a refusal by REJECTING or by resolving `false`. The second is for a caller
	 * whose write path swallows at the tail on purpose (ActorListStore does, so one failed write
	 * cannot wedge the ones queued behind it) and so has no rejection left to hand back.
	 */
	const commit = (next) => {
		if (next == null || next === saved) return;
		const previous = saved;
		saved = next;
		Promise.resolve(onSave(next))
			.then(ok => { if (ok === false) unsay(next, previous); })
			.catch(() => unsay(next, previous));
	};

	const dialog = new Dialog({
		title,
		content,
		buttons: { done: { icon: '<i class="fas fa-check"></i>', label: doneLabel } },
		default: "done",
		close: () => commit(live?.value),
		render: (html) => {
			const root = html[0] ?? html;
			live = root.querySelector?.("prose-mirror") ?? html.find?.("prose-mirror")?.[0] ?? null;
			live?.addEventListener("change", (ev) => commit(ev.target?.value ?? ""));
		},
	}, {
		width,
		height,
		resizable: true,
		classes: ["dialog", "stonetop", "stonetop-prose-notes-window", windowClass].filter(Boolean),
	});
	attachFrontOnOpen(dialog);
	dialog.render(true);
	return dialog;
}
