import { netRollMode, rollAdjustments, rollConditionNotes } from "./improvement-rolls.js";

/**
 * Everything the rules decide about a roll the steading is about to make, settled before the
 * dice: each source of advantage and disadvantage (improvement-rolls.js) netted against the mode
 * the roller chose, since the two cancel (Book I), and the pills that name them.
 *
 * An advantage the steading is HOLDING over its next +Fortunes roll (Rites of the Land) is one of
 * those sources, and is spent on this roll, because it is the roll it was promised to. Only by
 * someone who can write the steading: a player who cannot would roll at advantage and leave the
 * promise standing for the roll after, so for them it stays held for whoever can spend it.
 *
 * THE CALLER SPENDS IT, through the `spend` handed back, as the roll is made. Spent here, anything
 * that went wrong between the settle and the dice (building the card, posting a prompt) lost the
 * promise with no roll made on it. A failed spend is warned and the roll goes on; a roll thrown
 * away over a flag write is the worse outcome.
 *
 * Every door to a steading roll comes through here (the sheet's own rolls, the Seasons Change
 * hand-off, the expedition walkthrough's Requisition, a character's Requisition window), so they
 * agree on what a roll is owed. Kept out of improvement-rolls.js, which is pure.
 *
 * @param {object} steading  the StonetopSteading wrapper, or anything with its improvementCompleted,
 *   getSystemValue, fortunesAdvantage and clearFortunesAdvantage
 * @param {object} o
 * @param {string} o.moveName
 * @param {string} o.statKey
 * @param {string} [o.chosenMode]  the roller's own mode: "adv", "dis", or anything else for normal
 * @param {object} [o.answers]     what the move's window asked about the improvements
 * @param {Array}  [o.tactics]     the militia's trained tactics
 * @param {boolean} [o.winter]
 * @param {boolean} [o.canSpend]   whether this user may write the steading (its owner, or the GM)
 * @returns {Promise<object>} rollAdjustments' answer, plus `held` (the promise applied, or null),
 *   `rollMode` (netted), `conditionNotes`, and `spend()`, which clears `held` off the steading
 */
export async function settleSteadingRoll(steading, {
	moveName, statKey, chosenMode = "normal", answers = {}, tactics = [], winter = false, canSpend = true,
}) {
	const held = statKey === "fortunes" && canSpend ? steading.fortunesAdvantage?.() ?? null : null;
	const adjusted = rollAdjustments({
		moveName, statKey,
		has: slug => !!steading.improvementCompleted?.(slug),
		answers, tactics, winter,
		diminished: !!steading.getSystemValue?.("attributes.debilities.options.diminished.value", false),
		held: held?.source ?? "",
	});
	return {
		...adjusted,
		held,
		rollMode: netRollMode(chosenMode, adjusted.adv, adjusted.dis),
		conditionNotes: rollConditionNotes(adjusted),
		spend: () => spendHeld(steading, held),
	};
}

async function spendHeld(steading, held) {
	if (!held) return;
	try {
		await steading.clearFortunesAdvantage();
	} catch (err) {
		console.warn("Stonetop | Could not spend the steading's held advantage:", err);
	}
}
