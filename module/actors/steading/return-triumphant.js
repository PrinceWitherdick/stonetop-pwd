import { sign } from "../../utils/roll-engine.js";
import { clearDebility, markedDebilities, openDebilityPicker } from "./steading-debilities.js";

// ── Return Triumphant (Book I p.339) ────────────────────────────────────────────
// No dice: the move clears one of the steading's marked debilities, or raises Fortunes
// by 1 when none are marked. A PLAYER makes it, but every effect lands on the steading —
// which is why the walkthrough lives here rather than on a character sheet.
//
// MODULE LEVEL, not a method, because two surfaces now reach for it: the steading sheet's
// own move card, and the last step of the Run an Expedition walkthrough, which is where a
// table actually is when the move comes up. One copy, so the two cannot come to disagree
// about what "triumphant" does to Fortunes.

const DIALOG_OPTIONS = { classes: ["dialog", "stonetop", "stonetop-disaster-move-dialog"] };

/**
 * Open the Return Triumphant walkthrough against a steading.
 *
 * @param {StonetopSteading} steading  The steading wrapper the writes land on.
 * @param {object}   [opts]
 * @param {Function} [opts.onApplied]  Called after a write lands, so the surface that opened
 *                                     this can repaint. Nothing is called when the window is
 *                                     closed without committing.
 */
export function openReturnTriumphant(steading, { onApplied } = {}) {
	if (!steading) return;
	const done = () => onApplied?.();

	const marked = markedDebilities(steading);

	// No debilities marked → the move raises Fortunes by 1 instead.
	if (marked.length === 0) {
		const fortunes    = steading.getStatValue("fortunes");
		const newFortunes = fortunes + 1;
		new Dialog({
			title: "Return Triumphant",
			content: `<div class="stonetop-disaster-dialog">
				<p><em>You return home in triumph, and the steading has no debilities marked.</em></p>
				<p>Fortunes: <strong>${sign(fortunes)}</strong> → <strong>${sign(newFortunes)}</strong></p>
			</div>`,
			buttons: {
				cancel: { label: "Cancel" },
				apply: {
					label: "Increase Fortunes",
					callback: async () => {
						// Attributed to the move, so the steading ledger reads "via Return Triumphant".
						await steading.setSystemValue("stats.fortunes.value", newFortunes, { stonetopMove: "Return Triumphant" });
						done();
					},
				},
			},
			default: "apply",
		}, DIALOG_OPTIONS).render(true);
		return;
	}

	// One or more debilities marked -> the GM clears 1. The window itself is the shared
	// debility picker (steading-debilities.js): the Inn's seasonal gathering asks the same
	// question the same way, and the accessibility details that make it work are documented
	// there rather than kept in step across two copies.
	openDebilityPicker({
		title: "Return Triumphant",
		introHtml: "<p><em>You return home in triumph.</em> Clear 1 of the steading's debilities:</p>",
		marked,
		onApply: async picked => {
			await clearDebility(steading, picked.id, "Return Triumphant");
			done();
		},
	});
}
