// A foe's last hit point: marking a monster out of the fight when it runs out.
//
// THE OTHER SIDE OF DEATH'S DOOR. A PC reduced to 0 HP is dying and faces their 0-HP move
// (hooks/DeathsDoorPrompt.js). A monster reduced to 0 HP has no such move: it is dead, routed or
// otherwise done, and everything that counts capable attackers already reads it that way
// (fight-sides.js#bodiesFor). The one thing that did not follow was the mark, which the GM had to
// click for every foe that dropped — and a foe nobody remembered to click kept a healthy-looking
// token on the map and a live row in the tab.
//
// THE MARK IS CORE'S, not ours: `defeated` on the combatant, plus core's defeated status effect as
// an overlay on the token, written in the order its own tracker writes them
// (CombatTracker#_onToggleDefeatedStatus). So a world running core's tracker in place of the Fight
// tab gets exactly what clicking the skull there gives it, and ours reads the same thing back —
// `combatant.isDefeated` is either half.
//
// WHOSE HIT POINTS COUNT. Monsters only. A follower or a plain NPC is an `npc` actor, and a group
// follower at 0 HP is routed rather than marked: its character's roster is what says how many are
// still standing (fight-vitals.js#followerRoster). A character's 0 is Death's Door's business.
//
// AND WHOSE ACTOR. `updateActor` fires for a token's own actor as well as for a sidebar one, and a
// monster token is unlinked, so the ordinary case is the token's. A bestiary entry whose hit points
// someone edited on the sheet is NOT a foe that has just dropped, and an effect written there would
// ride every token stamped out of it afterwards — so a sidebar actor is marked only when it stands
// in a fight through a linked token.
//
// ONE DIRECTION. Hit points appearing on a marked foe do not take the mark off again; the GM
// un-clicks it, as they always could. A monster back on its feet is a decision at the table (it was
// playing dead, the blow was not a killing one, the number was a typo), and all three look
// identical from here — which is why the character side asks rather than assumes
// (DeathsDoorPrompt.js#promptRaiseFromDead), and why this side leaves it alone.

import { each } from "./fight-state.js";
import { isPrimaryGM } from "../utils/primary-gm.js";

/** Core's defeated status, which a world may have re-pointed; "dead" is core's own default. */
export const defeatedStatusId = (config = globalThis.CONFIG) => config?.specialStatusEffects?.DEFEATED ?? "dead";

/**
 * The hit points a committed diff wrote, or null when it did not touch them. Both spellings: a
 * sheet writes the dotted path, code building an update object writes the nested one. PURE.
 */
export function writtenHp(changes = {}) {
	const nested = changes?.system?.attributes?.hp;
	const raw = nested && typeof nested === "object" && "value" in nested
		? nested.value
		: changes?.["system.attributes.hp.value"];
	if (raw === undefined || raw === null || raw === "") return null;
	const hp = Number(raw);
	return Number.isFinite(hp) ? hp : null;
}

/**
 * Whether this committed actor update has just put a monster on 0 hit points or fewer. PURE.
 *
 * ASKED OF THE UPDATE, not of the sheet: a foe already down and hit again writes no HP change at
 * all (core diffs an unchanged value away), so nothing here re-fires for it, and the mark is not
 * re-applied over a GM who has just taken it off.
 *
 * AN HP MAXIMUM IS REQUIRED, the way `bodiesFor` requires one. A monster with no hit points
 * recorded sits at 0 because nobody filled the sheet in, not because something killed it, and the
 * two have to agree about that or a token would be marked out while the tab still counts it in.
 */
export function droppedOutOfTheFight(actor, changes = {}) {
	if (actor?.type !== "monster") return false;
	const written = writtenHp(changes);
	if (written === null || written > 0) return false;
	return Math.trunc(Number(actor.system?.attributes?.hp?.max) || 0) > 0;
}

/**
 * Every combatant, in every combat in the world, that is this actor.
 *
 * BY UUID, not by id: an unlinked token's actor carries the id of the bestiary entry it was stamped
 * from, so four rats off one sheet are four combatants sharing one actor id. The UUID is the
 * token's own.
 */
export function combatantsFor(actor, combats = globalThis.game?.combats) {
	const uuid = actor?.uuid;
	if (!uuid) return [];
	return each(combats).flatMap(combat => each(combat?.combatants).filter(c => c.actor?.uuid === uuid));
}

/**
 * Mark this foe out of the fight. Each half is written only when it is missing, so this is safe to
 * reach twice and never rewrites what is already there.
 *
 * @returns {Promise<boolean>} whether anything was written
 */
export async function markOutOfTheFight(actor, { combats = globalThis.game?.combats, config = globalThis.CONFIG } = {}) {
	const combatants = combatantsFor(actor, combats);
	// See the head of this file: a bestiary entry nobody has put on a map is not a foe that dropped.
	if (!actor?.isToken && !combatants.length) return false;

	const status = defeatedStatusId(config);
	const marked = !!actor?.statuses?.has?.(status);
	const unmarked = combatants.filter(c => !c.defeated);
	if (marked && !unmarked.length) return false;

	// Core's own order: the combatant's record first, then the overlay the map shows.
	for (const combatant of unmarked) await combatant.update({ defeated: true });
	if (!marked) await actor.toggleStatusEffect?.(status, { overlay: true, active: true });
	return true;
}

/**
 * Watch for foes dropping.
 *
 * The primary GM's client alone writes, like every other shared write a fight makes: `updateActor`
 * fires on every connected client, and two GMs marking the same combatant is one race run twice. A
 * player could not write it in any case — a monster is not theirs to update.
 *
 * @returns {() => void} stops watching
 */
export function installOutOfTheFight({ hooks = globalThis.Hooks } = {}) {
	const id = hooks.on("updateActor", (actor, changes) => {
		if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return;
		if (!droppedOutOfTheFight(actor, changes)) return;
		Promise.resolve(markOutOfTheFight(actor))
			.catch(err => console.error("Stonetop | marking a foe out of the fight failed", err));
	});
	return () => hooks.off("updateActor", id);
}
