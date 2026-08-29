import { escHtml } from "../../utils/strings.js";
import { openDebilityPicker } from "./steading-debilities.js";

// ── Winter's second bite (Book I, "Seasons Change": winter) ──────────────────────
// "7-9: the steading must consume 1d4+Population more Surplus before winter ends, or suffer
//  the consequences again.  6-: as 7-9, plus threats abound."
//
// EVERY other seasonal obligation is derivable: the watch's upkeep is "built, and not stamped
// for this season", and the tray works it out from state that was already there. This one is
// not. It is created by a die roll, its amount is another die roll, and until now nothing in
// the system remembered either — the 7-9 was said once in a chat card and the table carried it
// in their heads across however many sessions winter took.
//
// So this is the one hold with storage of its own (StonetopSteading#winterDebt), and the one
// with a settle control of its own. The others are all closed out inside the Seasons Change
// window; this one comes due AFTER that window is shut, which is exactly why the header glyph
// is the right place for it and why the glyph has to lead somewhere.
//
// THE DEADLINE IS THE STAMP. The debt is recorded against the "<year>:<season>" it was rolled
// in, so it expires by ceasing to match the clock, the way Tor's blessing does. Nothing sweeps
// it up, and nothing charges for it on the way out either: "suffer the consequences again" is
// a ruling the GM makes at the table, and a system that quietly took a Population off a
// steading during a session nobody was running would be inventing one.

export const WINTER_DEBT_MOVE = "Seasons Change";

// Wider than core's 400px default: the four consequences are each a label over a sentence, and
// at 400 every one of those sentences ran to three lines, which turned a list you scan into a
// wall you read. 480 rather than the season flow's 560 because this window asks ONE question.
const DIALOG_OPTIONS = { width: 480, classes: ["dialog", "stonetop", "stonetop-winter-debt-dialog"] };

/**
 * What a steading that cannot feed itself through winter loses. ONE table, because two
 * different moments ask the same question with the same four answers: the first consumption
 * inside the Seasons Change window, and this debt settled some sessions later. They used to be
 * one list of hand-written <li>s in the season dialog, which is the shape a second copy starts
 * from.
 *
 * `population` is the only one with a mechanical effect; the other three are the GM's to
 * narrate, and are listed rather than automated because what a lost cistern costs is a
 * conversation, not a number.
 */
export const WINTER_CONSEQUENCES = [
	{
		id: "population",
		label: "Population loss",
		detail: "Reduce Population by 1 (min -1) due to death, decrepitude, and departure.",
	},
	{
		id: "resource",
		label: "Important resource lost or damaged",
		detail: "A horse, the cistern, etc.: lost or not maintained (narrative).",
	},
	{
		id: "npc",
		label: "Important NPC dies",
		detail: "Their role unfilled: a narrative consequence.",
	},
	{
		id: "pc",
		label: "A PC dies, leaves, or retires",
		detail: "A narrative consequence for the group to resolve.",
	},
];

/** The four choices as the markup both windows click on. Same classes and the same
 *  `data-consequence` hook, so one stylesheet rule and one listener shape serve both. */
export function winterConsequencesHtml() {
	return `<ol class="stonetop-disaster-choices">
		${WINTER_CONSEQUENCES.map(c => `<li class="stonetop-disaster-choice" data-consequence="${c.id}">
			<span class="stonetop-disaster-choice-label">${escHtml(c.label)}</span>
			<span class="stonetop-disaster-choice-detail">${escHtml(c.detail)}</span>
		</li>`).join("")}
	</ol>`;
}

/**
 * The shortfall write: Surplus to 0, Fortunes down 1, and Population down 1 if that is the
 * consequence picked. Shared by both moments for the same reason the table above is.
 *
 * Does NOT stamp a season step. The first consumption closes `consumption` for the season and
 * the debt clears its own flag; which of those happened is the caller's business, and folding
 * it in here would make one of the two callers pass a marker it does not own.
 *
 * @returns {{fortunes: number, population: number|null}} what it wrote, for the notification
 */
export async function applyWinterShortfall(steading, consequenceId, { stonetopMove = WINTER_DEBT_MOVE } = {}) {
	const fortunes = Math.max(steading.getStatValue("fortunes") - 1, -1);
	const population = consequenceId === "population"
		? Math.max(steading.getStatValue("population") - 1, -1)
		: null;
	await steading.setSystemValues({
		"attributes.surplus.value": 0,
		"stats.fortunes.value": fortunes,
		...(population === null ? {} : { "attributes.population.value": population }),
	}, { stonetopMove });
	return { fortunes, population };
}

/**
 * What the settle window can offer, given what the steading actually has.
 *
 * Pure, so the awkward cases are testable without a world: a debt already settled, a steading
 * that can pay exactly, and one that cannot pay at all and must take the consequences instead.
 *
 * @param {object} state
 * @param {number} state.amount   what winter still wants
 * @param {number} state.surplus  the steading's Surplus
 * @returns {{owed: number, surplus: number, canPay: boolean}}  a settled debt is `owed` 0, and
 *          the shortfall is `owed - surplus`; neither is stored, so neither can disagree.
 */
export function winterDebtState({ amount = 0, surplus = 0 } = {}) {
	const owed = Math.max(0, Math.trunc(Number(amount) || 0));
	const have = Math.max(0, Math.trunc(Number(surplus) || 0));
	return { owed, surplus: have, canPay: owed > 0 && have >= owed };
}

/**
 * The window's markup, from the state alone. Separated from the window for the same reason
 * `winterDebtState` is separated from both: the two cases it has to get right (a steading that
 * can pay, and one that cannot) are then renderable and readable without a world.
 *
 * The affordable case still shows the consequence list, and it is still clickable: a steading
 * CAN choose to keep its Surplus and take the hit, and the book does not say it may not.
 * Hiding the choice would be making a ruling on the table's behalf. What it must NOT do is
 * offer that choice quietly: refusing to pay is not "keep the Surplus", it is Surplus to 0 AND
 * Fortunes down 1 AND one of the four, which is strictly worse than paying whenever paying is
 * possible. The affordable branch used to read "if the steading would rather keep it", which
 * describes an option nobody has.
 */
export function winterDebtDialogHtml(state) {
	return `<p class="stonetop-inn-trigger"><em>Winter is not done with the steading. It must consume ${state.owed} more Surplus before winter ends, or suffer the consequences again.</em></p>
		<p class="stonetop-season-note">Winter still wants <strong>${state.owed} Surplus</strong>. The steading has <strong>${state.surplus}</strong>.</p>
		${state.canPay
			? `<div class="stonetop-season-actions">
				<button type="button" class="stonetop-season-btn" data-action="pay-winter-debt">
					<i class="fas fa-wheat-awn"></i> Consume ${state.owed} Surplus, and winter is done
				</button>
			</div>
			<p class="stonetop-season-note"><em>Or refuse, and take the consequences instead. That costs more, not less: Surplus still drops to <strong>0</strong>, Fortunes drops by <strong>1</strong>, and one of these happens on top. Pick the one the steading suffers.</em></p>`
			: `<p>⚠️ <strong>Not enough Surplus</strong> (${state.surplus} of ${state.owed}), so the debt cannot be paid. Surplus drops to <strong>0</strong>, Fortunes drops by <strong>1</strong>, and one of these happens on top. Pick the one the steading suffers.</p>`}
		<p class="stonetop-rites-note">Of these, only the first is written for you; the other three are the GM's to narrate.</p>`;
}

/**
 * The window the header glyph opens. Two ways out and no third: pay it, or take the
 * consequences. There is deliberately no "not now" that resolves anything — closing the window
 * leaves the debt standing and the glyph lit, which is the true state of a steading that has
 * not dealt with it.
 *
 * Built on the shared consequence picker (openDebilityPicker), which is what makes the second
 * way out survivable: the four consequences are keyboard-reachable, and picking one ARMS the
 * footer rather than firing. Refusing to pay costs Surplus, a Fortune and one of the four at
 * once, and a single mis-click on a list is no way to spend that.
 */
export function openWinterDebtDialog(steading, { onApplied } = {}) {
	const held = steading.winterDebt();
	if (!held) {
		globalThis.ui?.notifications?.info?.("Winter is not owed anything.");
		return;
	}
	const state = winterDebtState(held);

	// `const`, though the pay handler below refers to it: that runs on a click, long after this
	// statement has completed. Same reasoning as the picker's own dialog binding.
	const dialog = openDebilityPicker({
		title: "Winter Is Not Done",
		introHtml: winterDebtDialogHtml(state),
		marked: WINTER_CONSEQUENCES,
		bodyClass: "stonetop-winter-debt-body",
		choicesLabel: "Consequence the steading suffers",
		applyLabel: "Take the consequences",
		applyLabelFor: c => `Suffer: ${c.label}`,
		// Not "Close": the debt survives this window, and the label is the only place that says
		// so. The glyph stays lit, which is the sheet agreeing with the button.
		buttons: { close: { label: "Leave it standing for now" } },
		dialogOptions: DIALOG_OPTIONS,
		// Paying is not one of the four choices, it is the way out that avoids them, so it sits
		// in the body under the sentence naming the bill rather than in the picker's list.
		onRender: root => {
			root.querySelector("[data-action='pay-winter-debt']")?.addEventListener("click", async () => {
				// Spent and cleared in ONE update, the way the Inn's gathering is: two writes
				// would append Seasons Change to the ledger twice for a single act.
				const left = await steading.spendSurplus(state.owed, {
					stonetopMove: WINTER_DEBT_MOVE,
					alsoFlags: { winterDebt: null },
				});
				if (left === null) {
					globalThis.ui?.notifications?.warn?.("The steading no longer has the Surplus to pay it.");
					return;
				}
				globalThis.ui?.notifications?.info?.(`Winter consumed ${state.owed} more Surplus. Remaining: ${left}.`);
				onApplied?.();
				dialog.close();
			});
		},
		onApply: async consequence => {
			const { fortunes, population } = await applyWinterShortfall(steading, consequence.id);
			await steading.clearWinterDebt();
			globalThis.ui?.notifications?.info?.(population === null
				? `Shortfall: Surplus to 0, Fortunes to ${fortunes}. Apply the narrative consequence.`
				: `Shortfall: Surplus to 0, Fortunes to ${fortunes}, Population to ${population}.`);
			onApplied?.();
		},
	});
	return dialog;
}
