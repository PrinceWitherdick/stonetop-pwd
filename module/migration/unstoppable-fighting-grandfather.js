// A Heavy fights on at 0 HP on Unstoppable only when the HP write that dropped them was in battle, and
// that write now stamps UNSTOPPABLE_FIGHTING_FLAG (actors/character/unstoppable.js#keepsFightingAtZero):
// "When you are reduced to 0 HP in battle, you can keep fighting" (Book I p.114).
//
// The stamp is new, though. A Heavy already down and dying on Unstoppable when the release lands was
// dropped before anything wrote it, and the old rule read them as fighting on. Without the stamp they would
// stop counting as a body in the fight, regain HP instead of clearing a mark, and never be handed the Door
// when the fight ends (combat/battle-joy-offer.js#actionStops). So each one is stamped, as the old rule read
// them, ONCE PER WORLD (the creation-finished-grandfather.js pattern): a later version's run would reach a
// Heavy dropped out of battle under the new code, and stamp them fighting when they are not.

import { STONETOP_SCOPE, resolvedFlagProperty } from "../actors/character/StonetopFlags.js";
import { UNSTOPPABLE_FIGHTING_FLAG } from "../actors/character/deaths-door.js";
import { downOnUnstoppable } from "../actors/character/unstoppable.js";
import { sweepVersion } from "./once-per-version.js";

export const UNSTOPPABLE_FIGHTING_SWEEP = "unstoppableFightingGrandfather";

/** The characters to stamp: down and dying on Unstoppable, with no stamp either way. PURE apart from reading them. */
export function unstampedFightingHeavies(actors) {
	return Array.from(actors ?? []).filter(a =>
		downOnUnstoppable(a) && resolvedFlagProperty(a, UNSTOPPABLE_FIGHTING_FLAG) == null);
}

/**
 * Stamp every Heavy already fighting on at 0 HP under the old rule (see above). Does nothing in a world that
 * has run it before, under any version.
 *
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @returns {Promise<number>} how many characters were written to
 */
export async function grandfatherUnstoppableFighting({ actors = globalThis.game?.actors ?? [] } = {}) {
	if (sweepVersion(UNSTOPPABLE_FIGHTING_SWEEP)) return 0;
	let written = 0;
	for (const actor of unstampedFightingHeavies(actors)) {
		// Quiet in the ledger: nothing happened to them, the old reading was written down.
		await actor.update({ [`flags.${STONETOP_SCOPE}.${UNSTOPPABLE_FIGHTING_FLAG}`]: true }, { stonetopLedger: true });
		written += 1;
	}
	return written;
}
