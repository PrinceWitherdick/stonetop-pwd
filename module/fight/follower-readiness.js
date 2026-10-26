// A follower's Defend Readiness, read and spent from the token that stands for them in a fight.
//
// "When a PC Orders Followers to Defend and gets a 7+, the follower holds Readiness but the player decides
// when and how they spend it" (Book I p.469), on Defend's own terms (p.216): suffer an attack for a ward,
// halve one, draw all attention, or strike back. The pool is the leader's to keep, on the follower's card
// (follower-roster.js#FOLLOWER_FLAGS `readiness`, written by the sheet's Order), not on the NPC the token
// wears, so the card and the fight read one number. A character's own Readiness is its own flag
// (combat/defend-readiness.js); everyone else holds none.
//
// Who may write it: the follower's NPC is owned by whoever owns their character (follower-actors.js), so the
// same owner who could spend a character's Readiness on a card can spend a follower's.

import { heldReadiness, readinessCount, READINESS_FLAG } from "../combat/defend-readiness.js";
import { followerCardFor } from "../actors/character/follower-masters.js";
import { FOLLOWER_FLAGS, fillFollowerSlug } from "../actors/character/follower-roster.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { SYSTEM_ID } from "../system-id.js";
import { inSpenderTurn } from "../utils/spender-queue.js";

/**
 * Where one follower card keeps its Readiness: the character and the flag path on it, or null for a card
 * type with no Readiness track. THE ONE place the path is worked out.
 *
 * @param {Actor} character  whose follower
 * @param {string} ftype
 * @param {string} [slug]
 * @returns {{character: Actor, path: string}|null}
 */
export function cardReadinessRef(character, ftype, slug = "") {
	const path = fillFollowerSlug(FOLLOWER_FLAGS[ftype]?.readiness, slug);
	return path ? { character, path } : null;
}

/** The Readiness a card holds (cardReadinessRef), or none for no ref. */
export function readinessOnCard(ref) {
	if (!ref) return 0;
	return readinessCount(foundry.utils.getProperty(readableFlags(ref.character), ref.path));
}

/**
 * Where a follower token's Readiness lives: their character and the flag path on it, or null for anyone who
 * is not a follower with a Readiness track.
 *
 * @param {Actor} actor  the token's actor
 * @returns {{character: Actor, path: string}|null}
 */
export function followerReadinessRef(actor, { cardFor = followerCardFor } = {}) {
	if (actor?.type !== "npc") return null;
	const card = cardFor(actor);
	return card ? cardReadinessRef(card.character, card.ftype, card.slug) : null;
}

/** The Readiness anyone in a fight holds: a character's own, a follower's off their card, else none. */
export function readinessHeldBy(actor, options = {}) {
	if (actor?.type === "character") return heldReadiness(actor);
	return readinessOnCard(followerReadinessRef(actor, options));
}

/**
 * Take `cost` Readiness off whoever holds it: a character's flag, or a follower's card on their character.
 * Read and written in the spending turn of the character it is written on (utils/spender-queue.js). Answers
 * true when spent, or null when nothing was: no track, or less than `cost` held.
 */
export function spendHeldReadiness(actor, cost = 1, options = {}) {
	const ref = actor?.type === "character" ? null : followerReadinessRef(actor, options);
	if (actor?.type !== "character" && !ref) return Promise.resolve(null);
	return inSpenderTurn(ref?.character ?? actor, async () => {
		const held = readinessHeldBy(actor, options);
		if (held < Math.max(1, cost)) return null;
		const next = held - cost;
		if (!ref) await actor.setFlag(SYSTEM_ID, READINESS_FLAG, next);
		else await ref.character.update({ [`flags.${SYSTEM_ID}.${ref.path}`]: next }, { stonetopMove: "Spend Readiness" });
		return true;
	});
}

/**
 * Clear a follower token's Readiness, as a character's is cleared when the fight ends or they fall (p.216:
 * "the threat passes"). Answers whether anything was cleared.
 */
export async function clearFollowerReadiness(actor, options = {}) {
	const ref = followerReadinessRef(actor, options);
	if (!ref || readinessHeldBy(actor, options) <= 0) return false;
	await ref.character.update({ [`flags.${SYSTEM_ID}.${ref.path}`]: 0 }, { stonetopLedger: true });
	return true;
}
