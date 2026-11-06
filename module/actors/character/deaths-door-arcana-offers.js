import { backBoxChecked } from "./CharacterArcana.js";
import { unmarkedConsequences } from "./arcana-seeker-moves.js";
import { holdsArcanum, tickedBackBoxes } from "./deaths-door-arcana.js";

/**
 * Two arcana that OFFER something at Death's Door rather than dictate a fate (deaths-door-arcana.js has those):
 *
 *   Rune-laden Scales, PROOF AGAINST HARM (Book II p.563): "When you wear the Rune-laden Scales and find yourself
 *     at Death's Door, you may mark a consequence before you roll to automatically get a 10+." Offered on the roll
 *     step once the mystery is ticked, as a button beside the dice.
 *   Carvings in a cave, Shell Game of Souls (Book II p.510): "When you roll a 6- on Death's Door, you can release
 *     a bound soul to go through the Last Door in your place. If you do, you survive as if you rolled a 7-9."
 *     Offered on the 6- while the card's Souls track holds one.
 *
 * Both are the player's choice, so each is a button, never applied for them. A card still a lead is not in their
 * hands yet, so it offers nothing.
 */
export const RUNE_LADEN_SCALES  = "rune-laden-scales";
const PROOF_AGAINST_HARM        = "PROOF AGAINST HARM";
export const CARVINGS_IN_A_CAVE = "carvings-in-a-cave";

/**
 * Everything scalesTenPlusOffer reads off the character, as one string (the card's own text aside, which is the
 * pack's): held, its back boxes, and whether the inventory marks it worn. Synchronous, so a redraw for anything
 * else reuses the last answer.
 */
export function scalesOfferKey(character) {
	if (!holdsArcanum(character, RUNE_LADEN_SCALES)) return "";
	return JSON.stringify([
		tickedBackBoxes(character._arcana.boxStates, RUNE_LADEN_SCALES).sort(),
		!!character._inventory?.checked?.[RUNE_LADEN_SCALES],
	]);
}

/**
 * The Scales' 10+ for a Consequence, when it is on offer: the card held, PROOF AGAINST HARM ticked, and a
 * Consequence still to mark (the price; markArcanumConsequence picks which). `worn` is whether the inventory
 * marks the Scales carried: the move asks that you wear them, which is flagged (never blocked) when it doesn't.
 * Null when not on offer.
 *
 * @returns {Promise<{slug: string, name: string, worn: boolean, consequencesLeft: number}|null>}
 */
export async function scalesTenPlusOffer(character) {
	if (!holdsArcanum(character, RUNE_LADEN_SCALES)) return null;
	const card = await character._arcana.getArcanum?.(RUNE_LADEN_SCALES);
	const back = card?.back?.description ?? "";
	const boxes = character._arcana.boxStates ?? {};
	if (!back || !backBoxChecked(back, RUNE_LADEN_SCALES, PROOF_AGAINST_HARM, boxes)) return null;
	const consequencesLeft = unmarkedConsequences(back, boxes, RUNE_LADEN_SCALES).length;
	if (!consequencesLeft) return null;
	return {
		slug: RUNE_LADEN_SCALES,
		name: card.front?.title ?? "Rune-laden Scales",
		worn: !!character._inventory?.checked?.[RUNE_LADEN_SCALES],
		consequencesLeft,
	};
}

/**
 * The Shell Game of Souls' way out of a 6-, when it is on offer: the card held and at least one soul bound on its
 * Souls track (the card's back resource, `inventory.resources[slug]`). Null when not. Synchronous.
 *
 * @returns {{slug: string, souls: number}|null}
 */
export function boundSoulsOffer(character) {
	if (!holdsArcanum(character, CARVINGS_IN_A_CAVE)) return null;
	const souls = Math.trunc(Number(character._inventory?.resources?.[CARVINGS_IN_A_CAVE]) || 0);
	return souls > 0 ? { slug: CARVINGS_IN_A_CAVE, souls } : null;
}
