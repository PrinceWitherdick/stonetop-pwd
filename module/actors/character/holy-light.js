/**
 * The Lightbearer's holy light — the fictional state half their playbook is written against
 * ("when you wield a holy light but go otherwise unarmed…", "an Invocation's range is equal
 * to that of its light source", "it will end immediately if your holy light is
 * extinguished"). Nothing on the sheet tracked whether one was actually burning, so the
 * header candle does.
 *
 * ONE SLOT, never a counter: Consecrated Flame lasts "until the flame goes out or until you
 * consecrate another flame, whichever comes first", so consecrating a second flame replaces
 * the first rather than adding to it. That is why the state is a plain boolean.
 *
 * Kept out of the sheet and the character model so the predicates can be tested without a
 * Foundry global in sight.
 */

import { ownsMoveNamed, ownsAnyMoveNamed } from "./owns-move.js";

// Re-exported so the sheet and this playbook's tests keep reaching the predicate through the
// feature module they already import.
export { ownsMoveNamed };

export const HOLY_LIGHT_FLAG       = "holyLight";
export const CONSECRATED_FLAME     = "Consecrated Flame";
export const INVOKE_THE_SUN_GOD    = "Invoke the Sun God";
export const EMPOWERED_INVOCATIONS = "Empowered Invocations";
const WIELDER_OF_THE_WHITE_FLAME   = "Wielder of the White Flame";

// The moves that MAKE a holy light, and so the ones that earn the candle. The moves that
// merely READ one (A Candle Against the Dark, Purifying Flames, Hungry Flames, Luminous
// Shield) need no entry: each is either 6th level or requires a starting move, so nobody
// owns one without owning a maker too.
//
// Known and accepted: a non-Lightbearer wielding a holy light from somewhere else (an
// arcanum, say) gets no candle. Widening that is one line here.
const HOLY_LIGHT_MOVES = [CONSECRATED_FLAME, INVOKE_THE_SUN_GOD, WIELDER_OF_THE_WHITE_FLAME];

// `owned` is the character sheet's one-pass Set — see ownsAnyMoveNamed. Omitted, this answers
// for itself exactly as it always did.
export function canWieldHolyLight(actor, owned = null) {
	return ownsAnyMoveNamed(actor, HOLY_LIGHT_MOVES, owned);
}

/**
 * Whether to render the candle at all. A LIT light is always shown, even on a sheet that no
 * longer owns any of the moves — otherwise dropping a new playbook over a Lightbearer strands
 * a burning light with nothing left on the sheet that could snuff it.
 */
export function showHolyLight({ owns, lit }) {
	return !!owns || !!lit;
}
