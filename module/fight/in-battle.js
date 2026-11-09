// "Is this character in a fight", and what counts as a fight: a leaf module (system-id.js its one import),
// so the character rules that ask it (inspiration.js's "once battle is joined", unstoppable.js's "reduced
// to 0 HP in battle") reach it without fight-state.js, whose own imports lead back to them. fight-state.js
// re-exports isFight, countsAsFight and fightersOf, so the fight code asks them there.

import { SYSTEM_ID } from "../system-id.js";

/** A collection as an array; nothing for anything that cannot be walked. */
export const each = collection => (typeof collection?.[Symbol.iterator] === "function" ? [...collection] : []);

export const FIGHT_FLAG = "fight";

/** Whether a Combat was started (or claimed) as a Stonetop fight. */
export function isFight(combat) {
	return !!combat?.flags?.[SYSTEM_ID]?.[FIGHT_FLAG];
}

/**
 * Whether a combatant stands on a map. A fight is fought somewhere: a combatant added by actor alone (the old
 * Character Introductions' roster, or that window dropping the party into a running fight) is in nobody's fight.
 */
export const onMap = combatant => !!combatant?.tokenId;

// settings.js#isFightTabEnabled, read here because settings.js is no leaf. Read live on every ask: the GM
// can turn the tab on or off with the world running.
function fightTabOn() {
	try {
		return globalThis.game?.settings?.get?.(SYSTEM_ID, "fightTab") === true;
	} catch (_) {
		return false;
	}
}

/**
 * Whether a Combat is a fight. With the Fight tab on, the stamped ones (fight-boot.js#stampFight). With it off
 * nothing is stamped and a core Combat is the fight (the user's ruling, 2026-10-23), but only one with somebody
 * on a map: the old Introductions' tokenless roster Combat is never a fight. `leaving` is a combatant just taken
 * out of it, which core drops from the collection before the delete hooks run.
 */
export function countsAsFight(combat, { leaving = null } = {}) {
	if (!combat) return false;
	if (fightTabOn()) return isFight(combat);
	return onMap(leaving) || each(combat.combatants).some(onMap);
}

/** The combatants fighting in a Combat: none unless it is a fight (countsAsFight), and only those on a map. */
export function fightersOf(combat) {
	return countsAsFight(combat) ? each(combat.combatants).filter(onMap) : [];
}

/**
 * Whether this character stands in any Combat in the world, on a map. Read by actor id, as a linked token's
 * combatant carries it.
 *
 * STAMPED OR NOT, whatever the Fight tab. With the tab on every new Combat is stamped (fight-boot.js#stampFight),
 * so an unstamped one is a Combat already running when the tab was turned on: the characters in it are in battle
 * all the same (a Heavy dropped there fights on with Unstoppable, Inspiration's "once battle is joined" holds).
 *
 * ONLY A COMBATANT WITH A TOKEN. A world that ran the old Character Introductions still holds that window's
 * roster Combat: every player character added by actor alone, tokenless, and never deleted
 * (utils/introductions-order.js reads it once for the order). Counted, it had every character "in battle"
 * for good, so a Heavy dropped by a trap fought on at 0 HP on Unstoppable instead of facing Death's Door,
 * and Inspiration offered its "once battle is joined" spend outside any fight.
 */
export function inBattle(actor, combats = globalThis.game?.combats) {
	if (!actor?.id) return false;
	return each(combats).some(combat => each(combat?.combatants).some(c => onMap(c) && (c?.actor?.id ?? c?.actorId) === actor.id));
}

// ── DEATH'S DOOR'S LAST MOVE ─────────────────────────────────────────────────────────────────────────
// "Make one last move as if you rolled a 12+, then step through the Last Door" (Book I p.244-245). The
// character making it is at 0 HP, which the fight reads as out of it (fight-sides.js#bodiesFor), so a last
// Clash with nothing targeted found nobody to hit. While that move is being made on this client, they are a
// capable fighter again: the move's targets are worked out (and frozen on its card) inside it. Read through
// fight-state.js#fightStanding (`lastMove`), the one place that decides who is down.

/** The actor ids making their last move on this client, for as long as that move's roll takes. */
const lastMoves = new Set();

/** Whether `actor` is making Death's Door's last move on this client right now. */
export const makingLastMove = actor => !!actor?.id && lastMoves.has(actor.id);

/**
 * Run `make` (the last move's roll) with `actor` counted as fighting. Always lets go afterwards, whether the
 * move was made, backed out of, or threw.
 *
 * @template T
 * @param {Actor} actor
 * @param {() => Promise<T>|T} make
 * @returns {Promise<T>}
 */
export async function duringLastMove(actor, make) {
	const id = actor?.id;
	if (!id) return make();
	lastMoves.add(id);
	try {
		return await make();
	} finally {
		lastMoves.delete(id);
	}
}
