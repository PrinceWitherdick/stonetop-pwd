// HP and Armor on a Fight tab row: "HP 7/10 · Armor 2", and a character's Defend Readiness while they
// hold any ("· Readiness 2", p.216). And for a group follower, how many of its roster are still standing
// ("4 of 6 standing").
//
// READ FROM THE STORED FIELDS, the same ones the token bar and the damage button read. A character's
// sheet mirrors its derived max HP and armor into them (derived vitals are otherwise sheet-only).
//
// WHO SEES THEM. Everyone sees a hero's. A foe's numbers are the GM's, or a player's who can at least
// observe that actor: a player learning a monster's HP from the tab would be learning it from nowhere
// else at the table.

import { SYSTEM_ID } from "../system-id.js";
import { heldReadiness } from "../combat/defend-readiness.js";
import { groupFollowerStanding } from "../utils/crew.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { reminderChips, chipLine } from "../actors/character/gear-reminders.js";

/** A number, or null for anything that is not one. */
const numberOr = value => (value === "" || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));

/**
 * The HP and armor a combatant's actor carries, and a character's held Readiness (0 for anyone else).
 * @returns {{hp: number|null, hpMax: number|null, armor: number|null, readiness: number}}
 */
export function combatantVitals(combatant) {
	const actor = combatant?.actor;
	const attributes = actor?.system?.attributes ?? {};
	return {
		hp: numberOr(attributes.hp?.value),
		hpMax: numberOr(attributes.hp?.max),
		armor: numberOr(attributes.armor?.value),
		readiness: heldReadiness(actor),
	};
}

/**
 * How many of a group follower (the crew, a custom group) are still standing, from the roster on the
 * character they follow. The token's own HP is the group's abstracted pool, one member's worth; the
 * roster is who is actually still up. Null for anyone else, or when the character cannot be found.
 *
 * @returns {{standing: number, size: number}|null}
 */
export function followerRoster(combatant, { resolve = globalThis.fromUuidSync } = {}) {
	const origin = combatant?.actor?.flags?.[SYSTEM_ID]?.followerOrigin;
	if (!origin?.characterUuid || !origin.ftype || typeof resolve !== "function") return null;
	let character = null;
	// Not strict: a character in a compendium or a deleted one must read as missing, not throw.
	try { character = resolve(origin.characterUuid, { strict: false }); } catch { return null; }
	if (!character) return null;
	return groupFollowerStanding(readableFlags(character), origin);
}

/**
 * What the table should keep in mind about a character in the fight: the wearer tags on their gear
 * and their typed reminders, off the stored fields (actors/character/gear-reminders.js). Empty for
 * anyone who is not a character. A hero's, so every reader sees them, as they see a hero's HP.
 */
export function combatantReminders(combatant) {
	return reminderChips(combatant?.actor);
}

/** Whether `user` may read this combatant's numbers when it is a foe. */
export function canReadFoeVitals(combatant, user = globalThis.game?.user) {
	if (user?.isGM) return true;
	const actor = combatant?.actor;
	return !!actor?.testUserPermission?.(user, "OBSERVER");
}

/**
 * The line a row shows. PURE. Empty when the actor carries no HP (a combatant with no actor).
 *
 * @param {{hp: number|null, hpMax: number|null, armor: number|null, readiness?: number}} vitals
 * @param {(key: string, data?: object) => string} format
 */
export function vitalsLine({ hp = null, hpMax = null, armor = null, readiness = 0 } = {}, format) {
	if (hp === null) return "";
	const hpText = hpMax === null
		? format("stonetop.fight.readout.hp", { hp })
		: format("stonetop.fight.readout.hpOf", { hp, max: hpMax });
	const line = armor === null ? hpText : format("stonetop.fight.readout.vitals", { hp: hpText, armor });
	return readiness > 0 ? format("stonetop.fight.readout.readiness", { line, readiness }) : line;
}

/**
 * Every combatant's numbers as one string, so a redraw can be skipped when neither the engagements
 * nor anyone's HP, armor, group roster or reminders changed (fight-boot.js#refreshFightTab).
 */
export function fightVitalsKey(combat, options) {
	return [...(combat?.combatants ?? [])]
		.map(combatant => {
			const { hp, hpMax, armor, readiness } = combatantVitals(combatant);
			const roster = followerRoster(combatant, options);
			const reminders = combatantReminders(combatant).map(chipLine).join(";");
			return `${combatant.id}:${hp}/${hpMax}/${armor}/${readiness}/${roster ? `${roster.standing}of${roster.size}` : ""}/${reminders}`;
		})
		.join("|");
}
