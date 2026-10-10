import { sign } from "../../utils/roll-engine.js";
import { clearDebility, markedDebilities, openDebilityPicker } from "./steading-debilities.js";
import { warn } from "../../utils/logger.js";
import { STEADING_STAT_MAX } from "./StonetopSteading.js";

// ── Return Triumphant (Book I p.339) ────────────────────────────────────────────
// No dice: the move clears one of the steading's marked debilities, or raises Fortunes
// by 1 when none are marked. A PLAYER makes it, but every effect lands on the steading —
// which is why the walkthrough lives here rather than on a character sheet.
//
// MODULE LEVEL, not a method, because two surfaces now reach for it: the steading sheet's
// own move card, and the last step of the Run an Expedition walkthrough, which is where a
// table actually is when the move comes up. One copy, so the two cannot come to disagree
// about what "triumphant" does to Fortunes.
//
// THE TRIP IS CREDITED HERE TOO, for the same reason. Once the move has been made, the current
// expedition's timeline row says they came home in triumph (timeline/timeline-expedition-record.js,
// GM-only like every write of the trip's). It used to be the walkthrough's callback that did it, so
// the move made from the steading sheet never reached the row; in here, both doors credit it. The
// steading sheet's door credits only a trip that came home this season (`cameHomeNow`), since it
// cannot see which trip is meant.

const DIALOG_OPTIONS = { classes: ["dialog", "stonetop", "stonetop-disaster-move-dialog"] };

/**
 * Mark the current trip as having Returned Triumphant, on its timeline row.
 *
 * Call-time import: the steading sheet loads this module whether or not a triumph is ever made, and
 * has no business pulling the timeline's writers in with it. A failure is a footnote, never the
 * move's: the steading write has already landed.
 */
async function creditTheTrip({ fromWalkthrough = false } = {}) {
	try {
		const { recordTrip } = await import("../../timeline/timeline-expedition-record.js");
		await recordTrip(fromWalkthrough ? { triumphant: true } : { triumphant: true, homeOnly: true });
	} catch (err) {
		warn("could not mark the trip triumphant on the timeline", err);
	}
}

/**
 * Open the Return Triumphant walkthrough against a steading.
 *
 * @param {StonetopSteading} steading  The steading wrapper the writes land on.
 * @param {object}   [opts]
 * @param {Function} [opts.onApplied]  Called after a write lands, so the surface that opened
 *                                     this can repaint. Nothing is called when the window is
 *                                     closed without committing.
 * @param {boolean}  [opts.fromWalkthrough]  Opened from the Expedition walkthrough's homecoming,
 *                                     so the trip in hand is the one to credit. Any other door
 *                                     credits only a trip that came home this season.
 */
export function openReturnTriumphant(steading, { onApplied, fromWalkthrough = false } = {}) {
	if (!steading) return;
	const done = async () => {
		onApplied?.();
		await creditTheTrip({ fromWalkthrough });
	};

	const marked = markedDebilities(steading);

	// No debilities marked → the move raises Fortunes by 1 instead, never past +3: Fortunes "can
	// range from -1 to +3" (Book I p.508), and the sheet's track draws no box above it.
	if (marked.length === 0) {
		const fortunes    = steading.getStatValue("fortunes");
		if (fortunes >= STEADING_STAT_MAX) {
			globalThis.ui?.notifications?.info?.(`You return home in triumph, but the steading has no debilities marked and Fortunes is already ${sign(fortunes)}, the most it can be.`);
			done().catch(err => warn("could not credit the triumph", err));
			return;
		}
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
						await done();
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
			await done();
		},
	});
}
