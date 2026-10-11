// "Is this character in a fight": a leaf module with no imports, so the character rules that ask it
// (inspiration.js's "once battle is joined", unstoppable.js's "reduced to 0 HP in battle") reach it
// without fight-state.js, whose own imports lead back to them.

/** A collection as an array; nothing for anything that cannot be walked. */
export const each = collection => (typeof collection?.[Symbol.iterator] === "function" ? [...collection] : []);

/**
 * Whether this character stands in any combat in the world. Read by actor id, as a linked token's
 * combatant carries it, and whether or not the Fight tab made the combat.
 */
export function inBattle(actor, combats = globalThis.game?.combats) {
	if (!actor?.id) return false;
	return each(combats).some(combat => each(combat?.combatants)
		.some(c => (c?.actor?.id ?? c?.actorId) === actor.id));
}
