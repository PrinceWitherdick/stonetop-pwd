// The playbook moves that reach BACK into a Know Things roll after it has landed:
//
//   NEVER AT A LOSS (the Seeker) — "When you Know Things and roll a 6-, you may choose to not
//     mark XP. If you don't mark XP, the worst that happens is that the GM tells you nothing
//     interesting or useful about the subject, but instead tells you how you could learn more."
//   LOGBOOK (the Seeker) — "You have a logbook (2 uses, slow)... When you (and only you) consult
//     your logbook and expend a use, you can ignore a Know Things roll you just made and treat
//     the result as a 10+. When the Seasons Change, reset your logbook to 2 uses."
//
// Both are decisions the player makes AFTER seeing the dice, so both live on the chat card
// rather than in a pre-roll prompt. This module holds the pure part: which moves apply, what a
// character has left to spend, and the card markup. The Foundry writes live in stonetop.js
// beside Burn Brightly, the existing post-roll card mutation.

import { ownsMoveNamed, ownedMove, ownedMoveNames } from "./owns-move.js";

// Re-exported so this module's tests keep reaching the helper through the feature module.
export { ownedMoveNames };

export const KNOW_THINGS     = "Know Things";
export const NEVER_AT_A_LOSS = "Never at a Loss";
export const LOGBOOK         = "Logbook";

// A Know Things card's move name can carry the stat it was rolled with ("Know Things with WIS",
// from Well-Read), so the message flag stores the BASE name and this compares against that.
export function isKnowThings(moveName) {
	return moveName === KNOW_THINGS;
}

/**
 * The Logbook's remaining uses.
 *
 * The stored number is how many pips are FILLED, and for a move track a filled pip means a use
 * SPENT (module/model/Resource.js documents `current` as "checks used", and a fresh character has
 * no flag at all, which must read as an untouched logbook rather than an exhausted one). So
 * `left = max - spent`, and spending INCREMENTS. Do not copy this to the possession tracks, which
 * count the other way.
 *
 * `max` comes off the owned move Item rather than a constant, so a homebrew or re-pointed Logbook
 * keeps working. Returns null when the character doesn't own the move at all.
 */
export function logbookUses(actor, moveResourceMap = {}) {
	const item = ownedMove(actor, LOGBOOK);
	if (!item) return null;
	const max   = Number(item.system?.resource?.max) || 0;
	const spent = Math.max(0, Number(moveResourceMap[LOGBOOK]) || 0);
	return { max, spent, left: Math.max(0, max - spent) };
}

// "treat the result as a 10+" — the lowest total that reads as a strong hit. Padding to exactly
// this (rather than to the raw roll plus some bonus) keeps the card off the 12+ "critical" label
// that _classifyShiftedTotal would otherwise apply to a heavily padded roll.
export const STRONG_HIT_TOTAL = 10;

/**
 * The failure-tier action row for Never at a Loss: the miss XP is suppressed at roll time and the
 * player chooses here instead, which is what the move actually says. Both buttons are emitted for
 * the failure tier only; a GM Shift Up hides the whole row, exactly like every other tier action.
 */
export function neverAtALossActions() {
	return {
		failure:
			`<button type="button" class="stonetop-know-things-xp" data-choice="mark">`
			+ `<i class="fas fa-star"></i> Mark XP</button>`
			+ `<button type="button" class="stonetop-know-things-xp" data-choice="decline">`
			+ `<i class="fas fa-book-open-reader"></i> Never at a Loss: no XP, tell me how to learn more</button>`,
	};
}

/**
 * Extra roll options for a Know Things roll, folded into whatever the caller already passes.
 * Returns null for a character who owns neither move, so the ordinary roll is untouched.
 *
 * `noXpOnMiss` is set only for Never at a Loss: suppressing the automatic mark is what lets the
 * player choose afterwards. Without the move, a miss marks XP the moment the dice land, as usual.
 */
export function knowThingsRollOptions(actor) {
	if (!ownsMoveNamed(actor, NEVER_AT_A_LOSS)) return null;
	return { noXpOnMiss: true, tierActions: neverAtALossActions() };
}
