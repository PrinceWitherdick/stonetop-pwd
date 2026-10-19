// The playbook moves that reach BACK into a Know Things roll after it has landed:
//
//   NEVER AT A LOSS (the Seeker) — "When you Know Things and roll a 6-, you may choose to not
//     mark XP. If you don't mark XP, the worst that happens is that the GM tells you nothing
//     interesting or useful about the subject, but instead tells you how you could learn more."
//   LOGBOOK (the Seeker) — "You have a logbook (2 uses, slow)... When you (and only you) consult
//     your logbook and expend a use, you can ignore a Know Things roll you just made and treat
//     the result as a 10+. When the Seasons Change, reset your logbook to 2 uses."
//   BOOKS & SCROLLS (a Seeker or Lightbearer special possession) — "(○○○○○ uses): expend a use
//     to consult your collection and turn a Know Things roll you just made into a 10+." The
//     Logbook's rule, paid from a possession track instead of a move's (possession-tracks.js).
//
// All are decisions the player makes AFTER seeing the dice, so they live on the chat card
// rather than in a pre-roll prompt. This module holds the pure part: which moves apply, what a
// character has left to spend, and the card markup. The Foundry writes live in stonetop.js
// beside Burn Brightly, the existing post-roll card mutation.

import { ownsLearnedMoveNamed, ownedLearnedMove, ownedMoveNames } from "./owns-move.js";
import { SYSTEM_ID } from "../../system-id.js";

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
 * `left = max - spent`, and spending INCREMENTS. A possession track (books & scrolls, the sacred
 * pouch) counts the same way; Rites of the Land's Boon is the pool that counts the other.
 *
 * `max` comes off the owned move Item rather than a constant, so a homebrew or re-pointed Logbook
 * keeps working. Returns null when the character doesn't own the move, or keeps it switched off
 * (un-learned): a rule asks the learned move, so an un-learned Logbook offers no consult.
 */
export function logbookUses(actor, moveResourceMap = {}) {
	const item = ownedLearnedMove(actor, LOGBOOK);
	if (!item) return null;
	const max   = Number(item.system?.resource?.max) || 0;
	const spent = Math.max(0, Number(moveResourceMap[LOGBOOK]) || 0);
	return { max, spent, left: Math.max(0, max - spent) };
}

// "treat the result as a 10+" — the lowest total that reads as a strong hit. Padding to exactly
// this (rather than to the raw roll plus some bonus) keeps the card off the 12+ "critical" label
// that counted-tier.js totalTier would otherwise apply to a heavily padded roll.
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
 * Returns null for a character without Never at a Loss LEARNED, so the ordinary roll is untouched.
 *
 * `noXpOnMiss` is set only for Never at a Loss: suppressing the automatic mark is what lets the
 * player choose afterwards. Without the move, a miss marks XP the moment the dice land, as usual.
 */
export function knowThingsRollOptions(actor) {
	if (!ownsLearnedMoveNamed(actor, NEVER_AT_A_LOSS)) return null;
	return { noXpOnMiss: true, tierActions: neverAtALossActions() };
}

/**
 * The newest card spoken by `actorId` whose `move` stamp (StonetopItem#roll) is `matchName`, or
 * passes it when it is a function, or null. `rolled` passes over a card with no roll on it; a
 * message in `seen` (a Set of ids) ends the search, so nothing at or before it is answered.
 *
 * An array is scanned from the END and stopped at the first match, since the card asked about is
 * nearly always at the bottom. Any other iterable (game.messages itself) is walked forward in place
 * rather than copied, keeping the last match after the last `seen` message, which is the same card.
 * `speaker.actor` is the world Actor's id even for a token speaker (speaker-actor.js), so the
 * comparison needs no token.
 *
 * @param {Iterable<ChatMessage>|ChatMessage[]} messages  the log, oldest first
 * @param {string} actorId
 * @param {string|((moveName: string|undefined) => boolean)} matchName
 * @param {{seen?: Set<string>|null, rolled?: boolean}} [options]
 * @returns {ChatMessage|null}
 */
export function latestMoveCard(messages, actorId, matchName, { seen = null, rolled = false } = {}) {
	if (!actorId) return null;
	const named = typeof matchName === "function" ? matchName : name => name === matchName;
	const matches = m => m?.speaker?.actor === actorId && named(m.getFlag?.(SYSTEM_ID, "move")) && (!rolled || !!m.rolls?.length);
	// A stand-in for the log that is not iterable is read through its `contents`, as findPcAnswer reads it.
	const log = messages?.[Symbol.iterator] ? messages : messages?.contents ?? [];
	if (Array.isArray(log)) {
		for (let i = log.length - 1; i >= 0; i--) {
			const m = log[i];
			if (seen?.has(m?.id)) return null;
			if (matches(m)) return m;
		}
		return null;
	}
	let found = null;
	for (const m of log) {
		if (seen?.has(m?.id)) found = null;
		else if (matches(m)) found = m;
	}
	return found;
}

/**
 * The newest Know Things roll card spoken by `actorId`, or null. The Logbook and books & scrolls
 * turn "a Know Things roll you JUST made" into a 10+, so their buttons sit on this card only, not
 * on every old miss further up the log (stonetop.js#_wireLogbook). A card with no roll has nothing
 * to upgrade and is passed over.
 *
 * @param {Iterable<ChatMessage>|ChatMessage[]} messages  the log, oldest first (game.messages)
 * @param {string} actorId
 * @returns {ChatMessage|null}
 */
export function latestKnowThingsCard(messages, actorId) {
	return latestMoveCard(messages, actorId, isKnowThings, { rolled: true });
}
