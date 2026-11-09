// Readiness held by the Defend basic move (Book I, Combat & Boons p.216).
//
// When you Defend (roll +CON), on a 10+ you hold 3 Readiness (4 if you bear a shield);
// on a 7-9 you hold 1 (2 with a shield). A borne shield's "+1 Readiness on a 7+" only
// applies to a hit, never a miss. The Heavy's Guardian move holds 1 extra at every tier
// and — uniquely — holds 1 even on a 6-. That extra circle lives on Defend's own track,
// so Guardian itself carries no resource track.
//
// You spend Readiness to suffer an attack's damage/effects for a ward, halve it, draw
// all attention to yourself, or strike back. You lose ALL held Readiness the moment you
// go on the offense (Clash / Let Fly), cease focusing on defense, or the threat passes.
//
// This module is deliberately Foundry-free (pure functions) so the hold/cap arithmetic
// can be unit-tested; StonetopCharacter wires it to the actor's flags and roll flow, and
// the sheet renders the pips.

import { SYSTEM_ID } from "../system-id.js";

export const DEFEND_MOVE = "Defend";

// Where a character's held Readiness lives: a flag on the actor.
export const READINESS_FLAG = "readiness";

/** Readiness as it is held: a whole number, never below none. */
export const readinessCount = value => Math.max(0, Math.trunc(Number(value) || 0));

/** A character's held Readiness, read off its flags; anyone else holds none. */
export function heldReadiness(actor) {
	if (actor?.type !== "character") return 0;
	return readinessCount(actor.flags?.[SYSTEM_ID]?.[READINESS_FLAG]);
}

// The base cap without a shield or Guardian: a 10+ Defend holds 3.
export const DEFEND_READINESS_BASE_CAP = 3;

/**
 * Readiness held for a Defend roll's PbtA tier.
 * @param {"success"|"partial"|"failure"} tier - from classifyResult(total).key
 * @param {{hasShield?: boolean, hasGuardian?: boolean}} [opts]
 * @returns {number}
 */
export function defendReadinessHold(tier, { hasShield = false, hasGuardian = false } = {}) {
	const guardian = hasGuardian ? 1 : 0;
	// A shield's +1 rides a 7+ hit only; on a miss the only source is Guardian's "hold 1".
	const shield = hasShield ? 1 : 0;
	if (tier === "success") return DEFEND_READINESS_BASE_CAP + shield + guardian;
	if (tier === "partial") return 1 + shield + guardian;
	return guardian;
}

/**
 * A Defend's Readiness for its tier, the roll's own or the tier its card was moved to afterwards (a GM's
 * Shift, a +1 pressed on it: actors/character/tier-effects.js). The roll raised the pool from `prior` to
 * `set`, never lowering it; the tier's `hold` would have raised it to max(prior, hold) instead, and the
 * difference lands on what is held NOW, so Readiness spent since stays spent. At the roll itself `set` and
 * `current` are both `prior`. Never below none. PURE.
 *
 * NEVER PAST WHAT THE TIER HOLDS, or what is held already: a Defend "holds 3" on a 10+ (p.216), it never stacks on
 * itself. Two rewrites of one card landing together (a GM's Shift and a relayed +1, each read on its own client
 * against the card's old record) each added the same difference, and a 7-9 shifted to a 10+ came out at 5.
 *
 * @returns {{next: number, set: number}}  what to hold now, and what this tier raised the pool to
 */
export function readinessForTier({ prior, set = prior, current = prior, hold }) {
	const target = Math.max(readinessCount(prior), readinessCount(hold));
	const moved = readinessCount(readinessCount(current) + target - readinessCount(set));
	return { next: Math.min(moved, Math.max(readinessCount(current), target)), set: target };
}

/**
 * Highest Readiness a Defend can leave the character holding — the number of circles
 * to render. A borne shield adds +1, the Guardian move another +1.
 * @param {{hasShield?: boolean, hasGuardian?: boolean}} [opts]
 * @returns {number}
 */
export function defendReadinessCap({ hasShield = false, hasGuardian = false } = {}) {
	return DEFEND_READINESS_BASE_CAP + (hasShield ? 1 : 0) + (hasGuardian ? 1 : 0);
}
