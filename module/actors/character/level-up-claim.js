// ONE CLIENT TAKES EACH LEVEL.
//
// A level-up is checked on the client that applies it (StonetopCharacter#_applyLevelUpNow): the
// character must still be at the level the window was built for. That check reads the local copy,
// so a GM and a player pressing Apply on the same character within one round-trip both pass it,
// and both add a move for the one level gained. The XP lock (utils/xp.js) is per client and cannot
// see the other press.
//
// So before writing, a client asks the active GM's client to claim "this character, from this
// level". The GM's client answers in turn, so exactly one asker gets a yes. The GM's own presses
// claim on its own client through the same table. With no GM connected, or no answer in time, the
// claim is granted and the local check is all there is, as before.

import { askGMClient, resolveSync } from "../../utils/foundry-compat.js";
import { sendVerifiable, verifiedAsker } from "../../utils/owner-ask.js";

/** The User query the GM's client answers. */
export const LEVEL_UP_CLAIM_QUERY = "stonetop.levelUpClaim";

/** How long the GM's client checks back with a second GM who claims (ms), inside the claimer's 5s wait. */
const CLAIM_VERIFY_MS = 4000;

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
 * The query's handler on the GM's client: only an owner of the character may claim its level. A second GM claims
 * too, but on v13 a payload's GM id is the sender's own word, so it counts only once that GM's client says it
 * sent the claim (owner-ask.js#verifiedAsker). An asker that cannot be told is granted without holding the
 * level, as with no GM at all: the claim never lets anyone write what they could not.
 *
 * @param {{actorUuid: string, fromLevel: number, userId?: string, askId?: string}} data
 * @param {object} [context]
 * @param {object} [deps]
 */
export async function handleLevelUpClaimQuery(data, context = {}, { users = globalThis.game?.users, resolve = resolveSync, verify = verifiedAsker } = {}) {
	const asker = await verify(data, context, users, { timeout: CLAIM_VERIFY_MS });
	const actor = resolve(data?.actorUuid) ?? null;
	if (!asker || !actor) return true;
	if (data?.release) { releaseLevelUpClaim(actor, data?.fromLevel, asker.id); return true; }
	if (!asker.isGM && !actor.testUserPermission?.(asker, "OWNER")) return false;
	return grantLevelUpClaim(actor, data?.fromLevel, asker.id);
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
	const me = g?.user ?? null;
	const gm = g?.users?.activeGM ?? null;
	if (!gm || !me) return true;
	if (gm.id === me.id) return grantLevelUpClaim(actor, fromLevel, me.id);
	// Verifiable, so a second GM's claim is taken as theirs on v13 (handleLevelUpClaimQuery).
	const answer = await sendVerifiable(askId => ask(gm, LEVEL_UP_CLAIM_QUERY,
		{ actorUuid: actor.uuid, fromLevel, userId: me.id, askId },
		{ fallback: true, what: "claim the level-up", timeout: 5000 }));
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
	const me = g?.user ?? null;
	const gm = g?.users?.activeGM ?? null;
	if (!gm || !me) return;
	if (gm.id === me.id) { releaseLevelUpClaim(actor, fromLevel, me.id); return; }
	try {
		await sendVerifiable(askId => ask(gm, LEVEL_UP_CLAIM_QUERY,
			{ actorUuid: actor.uuid, fromLevel, userId: me.id, askId, release: true },
			{ fallback: true, what: "release the level-up", timeout: 5000 }));
	} catch (err) {
		console.warn("Stonetop | Level Up: could not give back the level claim", err);
	}
}

/** Register the query (stonetop.js, at init). */
export function registerLevelUpClaimQuery(queries = globalThis.CONFIG?.queries) {
	if (!queries) return;
	queries[LEVEL_UP_CLAIM_QUERY] = (data, context) => handleLevelUpClaimQuery(data, context);
}
