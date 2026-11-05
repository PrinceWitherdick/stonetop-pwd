import { askWithButtons } from "../../utils/ask-with-buttons.js";
import { escHtml } from "../../utils/strings.js";
import { plural } from "../../utils/plural.js";
import { clampInt } from "../../utils/custom-move-data.js";

/**
 * Requisitioning from the Herd of Horses: how many horses go?
 *
 * The herd's row on the Assets list is not one asset to lend out whole. It stands for a dozen
 * horses or more, and the Herd's own rule turns on how many are taken ("When you Requisition half
 * the herd or less, treat a 6- as a 7-9"). So the table is asked (the user's ruling, 2026-10-03),
 * defaulting to 2, the pair of draft horses the herd replaced on the list, or to the count the
 * Requisition roll was made for when the window asked it first; never more than the herd's GROWN
 * horses (a yearling is untrained and a foal a foal). What is taken comes out of the tracked herd
 * (StonetopSteading#requisitionFromHerd), and goes back on its card by hand when it comes home.
 *
 * Used by both doors that take an asset: a character's Requisition window and the expedition
 * walkthrough's asset picker.
 *
 * @param {object} o
 * @param {number} o.cap       the herd's grown horses (StonetopSteading#herdRequisitionCap)
 * @param {number} [o.preset]  the count already asked for the roll, if any
 * @param {string} [o.who]     who is taking them, for the question
 * @returns {Promise<number>} how many to take; 0 for none (closed, declined, or no horses to take)
 */
export async function askHorsesFromHerd({ cap = 0, preset = 0, who = "" } = {}) {
	const max = Math.max(0, Math.trunc(Number(cap) || 0));
	if (!max) {
		globalThis.ui?.notifications?.warn?.("The herd has no grown horses to requisition.");
		return 0;
	}
	const asked = Math.trunc(Number(preset) || 0);
	const start = Math.min(max, asked > 0 ? asked : 2);
	const answer = await askWithButtons({
		title: "Horses from the herd",
		content: `<p>How many grown horses ${who ? `does ${escHtml(who)} take` : "are taken"} from the herd? It has <strong>${max}</strong> grown ${plural(max, "horse")}.</p>
			<label class="stonetop-homestead-field"><span>Horses</span><input type="number" name="horses" min="1" max="${max}" value="${start}"></label>
			<p>They leave the herd's count until they come home; add them back on the Herd of Horses card then.</p>`,
		buttons: [
			{ key: "take", label: "Take them from the herd", icon: "fa-horse",
				value: form => Math.trunc(Number(form?.elements?.namedItem?.("horses")?.value) || 0) },
			{ key: "none", label: "Take none", icon: "fa-xmark", value: 0 },
		],
	});
	return Math.min(max, Math.max(0, Math.trunc(Number(answer) || 0)));
}

/** What a requisition of `count` herd horses is called on an inventory or an expedition's list. */
export function herdHorsesLabel(count) {
	return count === 1 ? "A horse from the herd" : `${count} horses from the herd`;
}

/**
 * How many horses came home of `taken` that left the herd (Going home, ruling E2). Defaults to all of them.
 * @returns {Promise<number|null>} how many to put back (0 to taken), or null when the window was closed
 */
export async function askHorsesBack({ taken = 0 } = {}) {
	const max = Math.max(0, Math.trunc(Number(taken) || 0));
	if (!max) return 0;
	const answer = await askWithButtons({
		title: "Horses home",
		content: `<p>${escHtml(herdHorsesLabel(max))} went with them. How many came home?</p>
			<label class="stonetop-homestead-field"><span>Came home</span><input type="number" name="horses" min="0" max="${max}" value="${max}"></label>
			<p>Those put back in the herd's count. Any that didn't come home were lost on the trip.</p>`,
		buttons: [
			{ key: "back", label: "Count them home", icon: "fa-horse",
				value: form => Math.trunc(Number(form?.elements?.namedItem?.("horses")?.value)) },
			{ key: "cancel", label: "Not yet", icon: "fa-xmark", value: null },
		],
	});
	if (answer === null || answer === undefined || !Number.isFinite(Number(answer))) return null;
	return clampInt(answer, 0, max);
}

/**
 * How many herd horses a requisitioned line stands for, or 0 for any other line. A line written by
 * the expedition picker carries the count as `herd`; one written before that is read off its label.
 * A line already counted home (`home`, Going home) stands for none still out: it stays on the trip
 * only as the record the Chronicle prints.
 */
export function herdHorsesOnLine(line) {
	if (line?.home) return 0;
	const count = Math.trunc(Number(line?.herd) || 0);
	if (count > 0) return count;
	const name = String(line?.name ?? "");
	if (name === herdHorsesLabel(1)) return 1;
	return Math.trunc(Number(name.match(/^(\d+) horses from the herd$/)?.[1]) || 0);
}

/** The herd horses a list of requisitioned lines holds, all told. */
export function herdHorsesIn(lines = []) {
	return (Array.isArray(lines) ? lines : []).reduce((n, line) => n + herdHorsesOnLine(line), 0);
}
