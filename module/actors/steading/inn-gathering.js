import { escHtml } from "../../utils/strings.js";
import { DEBILITIES, debilityPath, markedDebilities, openDebilityPicker } from "./steading-debilities.js";

// ── The Inn: bringing folks together (Book I, the Inn improvement) ───────────────
// "Once per season, when you expend 1 Surplus and bring folks together at the inn (to talk,
//  to celebrate, to recuperate), clear one of the steading's debilities."
//
// NOT a Seasons Change step, and that is the whole reason it lives on the improvement card
// rather than in the seasonal flow: the trigger is a thing the table DOES at some point during
// a season, whenever the fiction reaches for it. Parking it in the Seasons Change window would
// make it a chore you do at the boundary, and would put it out of reach for the rest of the
// season. What IS seasonal is the cap, so the once-per-season marker is the same steading-side
// ledger every other seasonal step writes to (StonetopSteading#setSeasonStepApplied).
//
// Two costs, both of which can independently make the move unavailable: a Surplus to spend and
// a debility to clear. The window says which one is missing rather than showing a dead button.

export const INN_MOVE = "Inn";
/** Which season's gathering has been held. Keyed alongside the Seasons Change steps. */
export const INN_SEASON_STEP = "innGathering";

/**
 * What the window can offer, given what the steading actually has.
 *
 * Pure, so the awkward combinations — no Surplus, nothing to clear, already gathered this
 * season — are testable without a world.
 *
 * @param {object} state
 * @param {number} state.surplus       the steading's Surplus
 * @param {boolean} state.done         has the gathering already been held this season
 * @param {string[]} state.debilities  ids of the steading's marked debilities
 */
export function innGatheringState({ surplus = 0, done = false, debilities = [] } = {}) {
	const marked = DEBILITIES.filter(d => debilities.includes(d.id));
	// First blocker wins, in the order the window explains them: a season already spent is
	// the answer even when the steading is also broke, because it is the one that will still
	// be true after they go and find a Surplus.
	const reason = done ? "done" : surplus < 1 ? "surplus" : !marked.length ? "healthy" : "";
	return { done, surplus, marked, reason, canGather: !reason, hint: GATHERING_HINT[reason || "ready"] };
}

/**
 * What each state says to the player, in one sentence.
 *
 * ONE table, and the state decides which line applies — not the surfaces. The improvement
 * card used to re-derive these four cases from `done`/`canGather`/`canAfford` in Handlebars
 * with its own wording, which is the same rule written twice in two languages: the card and
 * the window could disagree about the same steading, and a rule change had to find both.
 */
export const GATHERING_HINT = {
	ready:   "Folks gather to talk, to celebrate, to recuperate. Once per season.",
	done:    "Already gathered this season. The inn hosts one such gathering per season.",
	surplus: "No Surplus to spend on a gathering.",
	healthy: "No debilities are marked, so a gathering has nothing to clear.",
};

const DIALOG_OPTIONS = { classes: ["dialog", "stonetop", "stonetop-inn-dialog"] };

// The window's chrome around those same sentences. Only `done` is worded for itself: the
// window knows WHICH season was spent and can name it, where the card has room only to say
// that one was.
const BLOCKED_COPY = {
	done:    seasonLine => `<p class="stonetop-inn-done"><i class="fas fa-check"></i> Folks already gathered in ${seasonLine}. The inn hosts one such gathering per season.</p>`,
	surplus: () => `<p class="stonetop-inn-warn">The steading has <strong>no Surplus</strong> to spend on a gathering.</p>`,
	healthy: () => `<p class="stonetop-inn-note">${GATHERING_HINT.healthy} Save the Surplus.</p>`,
};

/**
 * Open the Inn's seasonal gathering walkthrough.
 *
 * @param {object} deps
 * @param {object} deps.steading    StonetopSteading. Every write lands here.
 * @param {number} deps.year        campaign year, for the once-per-season marker
 * @param {string} deps.seasonId    current season id, likewise
 * @param {Function} [deps.onApplied]
 */
export function openInnGathering({ steading, year = 1, seasonId = "", onApplied } = {}) {
	if (!steading) return;
	const state = innGatheringState({
		surplus: steading.getStatValue("surplus") ?? 0,
		done: !!(seasonId && steading.seasonStepApplied(INN_SEASON_STEP, year, seasonId)),
		debilities: markedDebilities(steading).map(d => d.id),
	});

	const seasonLine = seasonId
		? `${escHtml(seasonId[0].toUpperCase() + seasonId.slice(1))}, year ${year}`
		: "this season";

	const trigger = `<p class="stonetop-inn-trigger"><em>Once per season (${seasonLine}). Folks gather at the inn to talk, to celebrate, to recuperate.</em></p>`;

	// Blocked: no picker at all, because a window whose sole control is permanently dead reads
	// as a bug rather than as "not this season". It says WHICH cost is missing.
	if (!state.canGather) {
		new Dialog({
			title: "Bring Folks Together",
			content: `<div class="stonetop-disaster-dialog stonetop-inn-dialog-body">
		${trigger}
		${BLOCKED_COPY[state.reason](seasonLine)}
	</div>`,
			buttons: { close: { label: "Close" } },
			default: "close",
		}, DIALOG_OPTIONS).render(true);
		return;
	}

	// The same picker Return Triumphant puts the same question in (steading-debilities.js);
	// only the cost named on the footer button differs, because this one spends a Surplus.
	openDebilityPicker({
		title: "Bring Folks Together",
		// Both halves of the price, because only one of them is a number: the Surplus, and the
		// season's single gathering. A window that named only the Surplus made the second look
		// free, and it is the half that cannot be got back.
		introHtml: `${trigger}
		<p>Spend <strong>1 Surplus</strong> (of ${state.surplus}) and clear one of the steading's debilities. There is no roll, and it uses up the inn's one gathering for ${seasonLine}.</p>
		<p class="stonetop-season-note">Pick the debility it clears:</p>`,
		marked: state.marked,
		applyLabelFor: d => `Spend 1 Surplus, clear ${d.label}`,
		bodyClass: "stonetop-inn-dialog-body",
		buttons: { cancel: { label: "Not now" } },
		dialogOptions: DIALOG_OPTIONS,
		onApply: async picked => {
			await _holdGathering({ steading, year, seasonId, picked });
			onApplied?.();
		},
	});
}

/** Spend the Surplus, clear the debility, and mark the season's gathering held. */
async function _holdGathering({ steading, year, seasonId, picked }) {
	// Spent, cleared and marked in ONE update — three halves of a single move, and a write
	// apiece would append the Inn to the ledger three times and card the Surplus and the
	// debility separately. `spendSurplus` owns the live re-read and the "can't afford" answer,
	// which the watch's and the weapons' upkeep need in exactly the same words. The debility's
	// path still comes from the shared table, so WHERE a debility lives is written down once.
	const left = await steading.spendSurplus(1, {
		stonetopMove: INN_MOVE,
		step: INN_SEASON_STEP, year, seasonId,
		also: { [debilityPath(picked.id)]: false },
	});
	if (left === null) {
		globalThis.ui?.notifications?.warn?.("The steading has no Surplus left to spend.");
		return;
	}
	globalThis.ui?.notifications?.info?.(
		`Folks gathered at the inn: ${picked.label} cleared, 1 Surplus spent (${left} left).`);
}
