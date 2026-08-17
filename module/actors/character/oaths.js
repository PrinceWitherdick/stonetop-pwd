/**
 * The Judge's oaths — Binding Arbitration, the second Judge move that leaves something standing
 * after the scene ends:
 *
 *   "When you bear witness to someone's promise or oath, HENCEFORTH you may ask their player if
 *    they have kept their word. They must answer honestly. The character need not be present. If
 *    they have broken their word, you gain advantage on ALL rolls against them UNTIL they admit
 *    their wrong and suffer an appropriate consequence (your call)."
 *
 * "Henceforth", "need not be present", "until they admit their wrong": three clauses that each say
 * this outlives the table's memory of it. A Judge who witnessed an oath in session four and cannot
 * remember whose it was has lost the move, and nothing on any sheet wrote it down.
 *
 * SAME SHAPE AS THE BRAND, DELIBERATELY, and stored beside it rather than in its own window: both
 * are lists of people the Judge is holding something over, both end only when the Judge says so,
 * and a second header glyph for the second list would have said "the Judge has two kinds of
 * paperwork" rather than "here is what you are keeping". They share the scales. See condemn.js for
 * the brand and marked-people.js for the list algebra both use.
 *
 * ONE EXTRA FIELD over a brand: `broken`. It is not decoration — it is the whole mechanical half
 * of the move (advantage on all rolls against an oathbreaker), and it is a state the Judge learns
 * by ASKING, at a moment that has nothing to do with the roll it later affects. Ticking it is how
 * the answer survives to the roll.
 *
 * Kept Foundry-free so the predicates can be tested without a world in sight.
 */

import { ownsMoveNamed, ownsAnyMoveNamed } from "./owns-move.js";
import { createRoster, showStandingList } from "./marked-people.js";

// Re-exported so the dialog and this move's tests keep reaching the predicate through the feature
// module they already import.
export { ownsMoveNamed };

export const OATHS_FLAG          = "oaths";
export const BINDING_ARBITRATION = "Binding Arbitration";

const roster = createRoster({
	prefix: "oath",
	// Coerced to a hard boolean rather than kept as stored: this drives an advantage claim, and a
	// hand-edited world holding the string "false" must not read as "they broke it".
	fields: { broken: raw => !!raw },
});

/**
 * Whether this character can hold anyone to an oath. ONLY Binding Arbitration.
 *
 * Truth or Consequences is its requirement and is a different move entirely — it makes somebody
 * answer honestly ONCE, on the spot, and leaves nothing behind. Binding Arbitration is the one
 * that turns a promise into a standing question the Judge may ask forever, so it is the only one
 * that earns a row. Exactly the Censure/Condemn split in condemn.js.
 */
export function canBindOaths(actor, owned = null) {
	return ownsAnyMoveNamed(actor, [BINDING_ARBITRATION], owned);
}

/**
 * Whether the oaths half of the window renders at all.
 *
 * Sworn oaths are always shown, even on a sheet that no longer owns the move — otherwise dropping
 * a new playbook over a Judge strands them with no way to release anyone. Literally the brand's
 * rule, so it is literally the brand's function; this is the oath's name for it.
 */
export const showOaths = showStandingList;

// ── The stored list ─────────────────────────────────────────────────────────────
// Named re-exports of the shared roster, so every call site reads as this move's own vocabulary.

export const readOaths   = roster.readList;
export const addOath     = roster.add;
export const removeOath  = roster.remove;
export const oathIndex   = roster.buildIndex;
export const isSwornBy   = roster.isOnIndex;

/** Re-word what somebody swore. `{ entries, changed }`, `changed` null when nothing moved. */
export function noteOath(list, id, note) {
	return roster.patch(list, id, { note });
}

/**
 * Record that an oath has been kept or broken. The tick that turns a remembered promise into the
 * advantage the move grants; un-ticking it is the release, for when they finally admit the wrong
 * and suffer an appropriate consequence.
 */
export function setOathBroken(list, id, broken) {
	return roster.patch(list, id, { broken: !!broken });
}

/** How many of these oaths are currently broken — what the window's heading counts. */
export function brokenCount(list) {
	return readOaths(list).filter(o => o.broken).length;
}
