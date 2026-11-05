// ONE CLIENT TAKES EACH LEVEL.
//
// A level-up is checked on the client that applies it (StonetopCharacter#_applyLevelUpNow): the
// character must still be at the level the window was built for. That check reads the local copy,
// so a GM and a player pressing Apply on the same character within one round-trip both pass it,
// and both add a move for the one level gained. The XP lock (utils/xp.js) is per client and cannot
// see the other press.
//
// So before writing, a client asks the active GM's client to claim "this character, from this
// level" (utils/gm-claim.js, which also settles chat cards' payouts and once-only buttons). The GM's
// client answers in turn, so exactly one asker gets a yes. The GM's own presses claim on its own
// client through the same table. With no GM connected, or no answer in time, the claim is granted
// and the local check is all there is, as before.
//
// Unlike a card's claim, this one writes nothing on the GM's side: the level-up is written by the
// client that asked, so the GM's client remembers who holds each level for a while instead.

import { askGMClient, resolveSync } from "../../utils/foundry-compat.js";
import { verifiedAsker } from "../../utils/owner-ask.js";
import { defineGmClaim } from "../../utils/gm-claim.js";

/** The User query the GM's client answers. */
export const LEVEL_UP_CLAIM_QUERY = "stonetop.levelUpClaim";

/** How long a claim holds (ms). Long enough for the write that follows it. */
export const LEVEL_UP_CLAIM_TTL = 30000;

// "<actor uuid>|<from level>" -> { userId, at }, on the GM's client.
const _claims = new Map();

/** Forget every claim (tests). */
export function resetLevelUpClaims() {
	_claims.clear();
}

/**
 * The GM-side rule: the first user to claim a level holds it; anyone else asking for the same level
 * while it is held, or once the GM's copy of the character is past it, is refused. The holder asking
 * again (a retry) is granted.
 *
 * @param {object} actor  the GM's copy of the character
 * @param {number} fromLevel
 * @param {string} userId
 * @param {number} [now]
 * @returns {boolean}
 */
export function grantLevelUpClaim(actor, fromLevel, userId, now = Date.now()) {
	if (!actor || !Number.isFinite(Number(fromLevel))) return true;
	const level = Number(actor.system?.attributes?.level?.value ?? 1);
	if (level !== Number(fromLevel)) return false;
	for (const [key, claim] of _claims) if (now - claim.at > LEVEL_UP_CLAIM_TTL) _claims.delete(key);
	const key = `${actor.uuid ?? actor.id}|${Number(fromLevel)}`;
	const held = _claims.get(key);
	if (held && held.userId !== userId) return false;
	_claims.set(key, { userId, at: now });
	return true;
}

/**
 * The GM-side release: the holder gives a level back when its write did not happen (refused inside the
 * XP lock, or failed), so another client may take it at once rather than being told it was taken.
 * Only the holder can release, and a release for a claim it does not hold does nothing.
 *
 * @param {object} actor
 * @param {number} fromLevel
 * @param {string} userId
 */
export function releaseLevelUpClaim(actor, fromLevel, userId) {
	if (!actor || !Number.isFinite(Number(fromLevel))) return;
	const key = `${actor.uuid ?? actor.id}|${Number(fromLevel)}`;
	if (_claims.get(key)?.userId === userId) _claims.delete(key);
}

/**
 * "This character, from this level", decided on the GM's client (utils/gm-claim.js). Only an owner of the
 * character, or a GM, may claim its level.
 */
const levelUpClaim = defineGmClaim({
	query:   LEVEL_UP_CLAIM_QUERY,
	what:    "claim the level-up",
	subject: data => resolveSync(data?.actorUuid),
	key:     actor => actor.uuid ?? actor.id,
	may:     (actor, asker) => !!asker.isGM || !!actor.testUserPermission?.(asker, "OWNER"),
	grant:   (actor, data, asker) => grantLevelUpClaim(actor, data?.fromLevel, asker.id),
	release: (actor, data, asker) => releaseLevelUpClaim(actor, data?.fromLevel, asker.id),
});

/**
 * The query's handler on the GM's client (gm-claim.js#defineGmClaim's `handle`). An asker that cannot be
 * told, or a character that cannot be found, is granted without holding the level, as with no GM at all:
 * the claim never lets anyone write what they could not.
 *
 * @param {{actorUuid: string, fromLevel: number, userId?: string, askId?: string, release?: boolean}} data
 * @param {object} [context]
 * @param {{users?: object, me?: User, resolve?: (uuid: string) => object|null, verify?: Function}} [deps]
 */
export async function handleLevelUpClaimQuery(data, context = {}, { users, me, resolve = resolveSync, verify = verifiedAsker } = {}) {
	const answer = await levelUpClaim.handle(data, context, { users, me, verify, subject: d => resolve(d?.actorUuid) ?? null });
	return answer ?? true;
}

/**
 * Claim `fromLevel` for `actor` before applying it. True means go ahead.
 *
 * @param {object} actor
 * @param {number|null} fromLevel  null skips the claim (a caller with no level to pin)
 * @param {object} [deps]
 * @returns {Promise<boolean>}
 */
export async function claimLevelUp(actor, fromLevel, { game: g = globalThis.game, ask = askGMClient } = {}) {
	if (fromLevel == null || !actor) return true;
	const answer = await levelUpClaim.ask({ actorUuid: actor.uuid, fromLevel }, { game: g, ask, local: actor });
	return answer !== false;
}

/**
 * Give back a level this client claimed but did not write (see releaseLevelUpClaim). Never throws:
 * a release that goes unheard leaves the claim to lapse after LEVEL_UP_CLAIM_TTL, as before.
 *
 * @param {object} actor
 * @param {number|null} fromLevel
 * @param {object} [deps]
 */
export async function releaseLevelUp(actor, fromLevel, { game: g = globalThis.game, ask = askGMClient } = {}) {
	if (fromLevel == null || !actor) return;
	try {
		await levelUpClaim.release({ actorUuid: actor.uuid, fromLevel }, { game: g, ask, local: actor });
	} catch (err) {
		console.warn("Stonetop | Level Up: could not give back the level claim", err);
	}
}

/** Register the query (stonetop.js, at init). */
export function registerLevelUpClaimQuery(queries = globalThis.CONFIG?.queries) {
	levelUpClaim.register(queries);
}
