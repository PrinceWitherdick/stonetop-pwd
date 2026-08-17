/**
 * The Heavy's Battle Joy — the state half their playbook is written against, and the only state on
 * this sheet that changes what marks already printed on it MEAN:
 *
 *   "When you spill blood — yours or another's — and lose yourself in battle, you ignore fear,
 *    pain, mind-control, and the effects of debilities AS LONG AS YOU KEEP FIGHTING. When the
 *    action stops, roll +CON: on a 10+ … regain 1d4 HP; on a 7-9 … winded; on a 6-, mark a
 *    debility but don't mark XP."
 *
 * Three things follow from that, and they are why this is a header glyph rather than a note:
 *
 *  1. It is switched ON in the fiction and stays on across rolls, scenes and (in a long fight)
 *     sessions — nothing on the sheet recorded it, so the icon does.
 *  2. Berserker reads it by name ("WHILE IN YOUR BATTLE JOY, add the area tag to your melee
 *     attacks"), the same way Luminous Shield reads a holy light.
 *  3. Its debility clause is enforceable: debilities are the sheet's own three tick boxes, and
 *     every roll they touch goes through StonetopCharacter#applyDebilityRollMode. So a raging
 *     Heavy stops taking disadvantage from them, the three boxes go grey, and both facts undo
 *     themselves the moment the Joy ends. See `ignoresDebilities` below.
 *
 * ONE FLAG, never a counter: you are in it or you are not. Contrast condemn.js, whose brand has to
 * be a list; the shape here is the Lightbearer's candle (holy-light.js), which is worth reading
 * beside this — the "shown while the state stands on a sheet that lost the move" rule is the same,
 * and for the same reason.
 *
 * Kept out of the sheet and the character model so the predicates can be tested without a Foundry
 * global in sight.
 */

import { ownsMoveNamed, ownsAnyMoveNamed } from "./owns-move.js";

// Re-exported so the sheet and this playbook's tests keep reaching the predicate through the
// feature module they already import.
export { ownsMoveNamed };

export const BATTLE_JOY_FLAG = "battleJoy";
export const BATTLE_JOY      = "Battle Joy";
export const BERSERKER       = "Berserker";

// The move that MAKES the state, and so the one that earns the glyph. Berserker merely READS it
// and needs no entry: its own requirement is Battle Joy, so nobody owns the reader without owning
// the maker. Exactly the reasoning holy-light.js's HOLY_LIGHT_MOVES note sets out.
//
// Known and accepted: a Would-Be Hero who took Battle Joy through Versatile gets the glyph, which
// is correct — they have the move, so they have the state.
const BATTLE_JOY_MOVES = [BATTLE_JOY];

export function canEnterBattleJoy(actor, owned = null) {
	return ownsAnyMoveNamed(actor, BATTLE_JOY_MOVES, owned);
}

/**
 * Whether to render the glyph at all. A RAGING sheet is always shown, even on one that no longer
 * owns the move — otherwise dropping a new playbook over a Heavy strands the state with nothing
 * left on the sheet that could end it, and (worse than the stranded candle) that stranded state
 * would go on silently cancelling their debilities.
 */
export function showBattleJoy({ owns, raging }) {
	return !!owns || !!raging;
}

/**
 * Whether this character is presently ignoring "the effects of debilities".
 *
 * A function of one boolean, which looks like ceremony and is not: it is the single named place
 * the rules clause is decided, so the roll path, the sheet's grey-out and the tests all answer the
 * same question rather than three call sites each testing a flag and one of them drifting.
 */
export function ignoresDebilities({ raging } = {}) {
	return !!raging;
}
