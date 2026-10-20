// The four homefront moves Book I p.508 says another steading's stats are for: Trade & Barter,
// Muster, Deploy and Pull Together, rolled off a settlement's own Population / Prosperity /
// Defenses.
//
// The SAME CARD Stonetop prints. The tier text, legend and pick lists come off Stonetop's own move
// flows (homesteadMoveCard), and every rule about advantage comes through settleSteadingRoll, the
// one door every steading roll goes through: so a town's Muster is at advantage and a hamlet's at
// disadvantage (Book I p.509) by the same code that says it for Stonetop, and a winter Trade &
// Barter is at disadvantage the same way.
//
// WHAT IS LEFT OFF, and why:
//  • Stonetop's improvements, Tor's blessing, the herd and the held +Fortunes advantage. They are
//    Stonetop's, and the subject handed to settleSteadingRoll simply has none of them.
//  • Every card button but "Mark XP" on a miss. The others (Pull Together's Fortunes cost, Deploy's
//    Diminished, Muster's raise) are wired to write to the card's speaker as a Stonetop steading,
//    and refuse any other actor. A miss's XP belongs to whoever made the move, so that button stays.
//  • Muster's "reduce Fortunes by 1" before the roll, and the Diminished debility. A settlement
//    has no Fortunes and no debility boxes (data-models/SettlementModel.js).

import { homesteadMoveCard, homesteadMoveFlow, steadingMoveNoXpOnMiss } from "../steading/homestead-moves.js";
import { settleSteadingRoll } from "../steading/steading-roll.js";
import { withSteadingMissXp } from "../steading/steading-miss-xp.js";
import { applyLacking } from "../steading/steading-debilities.js";
import { rollStat } from "../../utils/roll-engine.js";

/** The moves a settlement sheet offers, by flow slug, in the book's order. */
export const SETTLEMENT_MOVES = ["tradeBarter", "muster", "deploy", "pullTogether"];

/**
 * Is this settlement Lacking? Book I p.510: a steading that loses access to a resource for a
 * season or more is lacking. A settlement has no debility box, so a ticked resource is what says so.
 */
export function settlementIsLacking(system) {
	return (system?.resources ?? []).some(r => r?.lacking);
}

/**
 * A stat as its roll reads it (Population, Prosperity or Defenses), with `bonus` added and Lacking
 * applied: `{statValue}` plus, when Lacking bites, the card's debility chip. The sheet's move chip
 * and the roll both read this, so the two can never disagree.
 */
export function settlementRolledStat(system, statKey, bonus = 0) {
	const options = { statValue: (system?.stats?.[statKey]?.value ?? 0) + bonus };
	return settlementIsLacking(system) ? applyLacking(options, statKey) : options;
}

/**
 * The roll options for one move, before the dice. Pure apart from settleSteadingRoll, which only
 * reads the subject; split from the roll itself so a test can see what the card will say.
 *
 * @param {object} system   the settlement's `system`
 * @param {string} slug     a SETTLEMENT_MOVES entry
 * @param {object} [o]
 * @param {string} [o.rollMode]     the roller's own mode, from the roll prompt
 * @param {number} [o.situational]  the roll prompt's one-off modifier
 * @param {number} [o.value]        Trade & Barter's item Value, subtracted
 * @param {boolean} [o.winter]      Trade & Barter in winter: a source of disadvantage
 * @returns {Promise<{statKey: string, options: object}|null>}
 */
export async function settlementRollOptions(system, slug, { rollMode = "normal", situational = 0, value = 0, winter = false } = {}) {
	const flow = SETTLEMENT_MOVES.includes(slug) ? homesteadMoveFlow(slug) : null;
	if (!flow) return null;
	const moveName = flow.label;
	const statKey = flow.stat;
	// What settleSteadingRoll reads, duck-typed on purpose (steading-roll.js reads every source with
	// `?.`), so a source a settlement lacks (improvements, the herd, Tor's blessing, a held
	// advantage, Diminished) is simply absent rather than stubbed to look present.
	const subject = { steadingSize: () => system?.size ?? "" };
	const adjusted = await settleSteadingRoll(subject, {
		moveName, statKey, chosenMode: rollMode, winter: !!(flow.rollFields && winter), canSpend: false,
	});
	const options = {
		// The card Stonetop prints, less Stonetop's own buttons, which homesteadMoveCard never carries (above).
		...homesteadMoveCard(moveName),
		moveName,
		rollMode: adjusted.rollMode,
		modifier: situational - Math.max(0, Number(value) || 0) + (adjusted.bonus ?? 0),
		...settlementRolledStat(system, statKey, adjusted.statBonus ?? 0),
	};
	if (adjusted.conditionNotes?.length) options.conditionNotes = adjusted.conditionNotes;
	const tiers = withSteadingMissXp(null, { noXpOnMiss: steadingMoveNoXpOnMiss(moveName) });
	if (tiers) options.tierActions = tiers;
	return { statKey, options };
}

/** Roll one of the four moves for a settlement actor and post its card. */
export async function rollSettlementMove(actor, slug, prompt = {}) {
	const built = await settlementRollOptions(actor?.system, slug, prompt);
	if (!built) return null;
	return rollStat(built.statKey, actor, built.options);
}
