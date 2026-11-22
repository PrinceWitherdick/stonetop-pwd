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

import { ownsMoveNamed, ownsAnyMoveNamed, ownsLearnedMoveNamed } from "./owns-move.js";
import { DEATHS_DOOR_FLAG, DEATHS_DOOR_STATE } from "./deaths-door.js";
import { resolvedFlagProperty } from "./StonetopFlags.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

// Re-exported so the sheet and this playbook's tests keep reaching the predicate through the
// feature module they already import.
export { ownsMoveNamed };

export const BATTLE_JOY_FLAG = "battleJoy";

/**
 * Document-update option stamped by the write that drops a raging Heavy to 0 HP and so ends their
 * Battle Joy (hooks/DeathsDoorPrompt.js decides it, in the preUpdate that makes them dying), so the
 * committed half can say so in chat (combat/battle-joy-offer.js).
 */
export const BATTLE_JOY_DROPPED_OPTION = "stonetopBattleJoyDropped";
export const BATTLE_JOY      = "Battle Joy";
export const BERSERKER       = "Berserker";

// The move that MAKES the state, and so the one that earns the glyph. Berserker merely READS it
// and needs no entry: its own requirement is Battle Joy, so nobody owns the reader without owning
// the maker. Exactly the reasoning holy-light.js's HOLY_LIGHT_MOVES note sets out.
//
// Known and accepted: a Would-Be Hero who took Battle Joy through Versatile gets the glyph, which
// is correct — they have the move, so they have the state.
const BATTLE_JOY_MOVES = [BATTLE_JOY];

/**
 * Whether this character can lose themselves in battle: the move owned AND learned. A Battle Joy
 * kept on the sheet switched off enters nothing, so it earns no glyph either (a raging sheet still
 * shows one; see showBattleJoy).
 *
 * `owned` answers the ownership half (a playbook change asks it of the names it is leaving behind);
 * whether the move is switched on can only be read off the item itself.
 */
export function canEnterBattleJoy(actor, owned = null) {
	return ownsAnyMoveNamed(actor, BATTLE_JOY_MOVES, owned)
		&& BATTLE_JOY_MOVES.some(name => ownsLearnedMoveNamed(actor, name));
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
 * A function of two booleans, which looks like ceremony and is not: it is the single named place
 * the rules clause is decided, so the roll path, the sheet's grey-out and the tests all answer the
 * same question rather than three call sites each testing a flag and one of them drifting.
 *
 * `learned` is whether the move is still switched on: a rage stranded on a sheet whose Battle Joy
 * was un-learned (or dropped with a playbook) keeps its glyph so it can be ended, and ignores nothing.
 */
export function ignoresDebilities({ raging, learned } = {}) {
	return !!raging && !!learned;
}

/**
 * Whether the action has stopped for this character by their going down: at 0 HP, or with Death's
 * Door dying, owed or behind them. Their Battle Joy then ends with NO roll (the user's ruling): the
 * +CON roll is for a Heavy still standing when the fight is over, and one who dropped has stopped
 * fighting already. PURE apart from reading the actor.
 */
export function battleJoyEndsUnrolled(actor) {
	if ((Number(actor?.system?.attributes?.hp?.value) || 0) <= 0) return true;
	const state = resolvedFlagProperty(actor, DEATHS_DOOR_FLAG) ?? null;
	return [DEATHS_DOOR_STATE.DYING, DEATHS_DOOR_STATE.FATE_PENDING, DEATHS_DOOR_STATE.DEAD].includes(state);
}

// -- The roll card (the action stops, roll +CON) ------------------------------------

/** The 10+'s "regain 1d4 HP", as a formula. */
export const BATTLE_JOY_REGAIN = "1d4";

/** The value a spent 10+ button latches on the card; a 6- latches the debility's key. */
export const BATTLE_JOY_REGAIN_CHOICE = "regain";

/**
 * The buttons a Battle Joy roll card carries, keyed by tier (roll-engine's tierActions): the 10+'s
 * "regain 1d4 HP", and the 6-'s "mark a debility", one button per debility not already marked. The
 * 7-9 has nothing to do on the sheet. Wired, and latched on the message, by
 * combat/battle-joy-offer.js#wireBattleJoyResult.
 *
 * @param {{key: string, name: string, marked?: boolean}[]} debilities  StonetopCharacter#debilityChoices
 */
export function battleJoyTierActions(debilities = []) {
	const button = (choice, icon, label) =>
		`<button type="button" class="stonetop-battle-joy-result" data-choice="${escHtml(choice)}">`
		+ `<i class="fas ${icon}" aria-hidden="true"></i> ${escHtml(label)}</button>`;
	return {
		success: button(BATTLE_JOY_REGAIN_CHOICE, "fa-heart", localize("stonetop.battleJoy.regainButton")),
		failure: debilities.filter(d => d?.key && !d.marked)
			.map(d => button(d.key, "fa-heart-crack", format("stonetop.battleJoy.debilityButton", { debility: d.name ?? d.key })))
			.join(""),
	};
}

/**
 * What a Battle Joy roll adds to its roll options, at the seam every move roll takes
 * (item/StonetopItem.js#roll). "On a 6-, mark a debility but don't mark XP": the no-XP is asked of
 * the move's NAME as well as its data, because a copy owned before the pack carried `noXpOnMiss`
 * keeps its old data (nothing re-syncs an owned move).
 *
 * @param {{key: string, name: string, marked?: boolean}[]} debilities  as battleJoyTierActions
 */
export function battleJoyRollOptions(debilities = []) {
	return { noXpOnMiss: true, tierActions: battleJoyTierActions(debilities) };
}
