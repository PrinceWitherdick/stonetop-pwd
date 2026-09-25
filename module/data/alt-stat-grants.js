import { tookBackground } from "../actors/character/took-background.js";

// Playbook moves that let a character roll a different stat for a basic move. When the actor
// owns `ownsMove` (and has it LEARNED: a move switched off on the sheet grants nothing), the basic
// move named `whenMove` (or, for blanket grants, any move whose default stat is `whenDefaultStat`)
// offers `altStat` as an extra choice in the roll's stat picker. Mind Over Magic (arcanum rolls)
// is not covered here — arcana roll through a separate path.
//
// A row can name a BACKGROUND in place of a move (`background: { playbook, slug, label }`): the
// Fox's The Natural, "When you Seek Insight, you may roll +INT instead of +WIS". It applies to a
// character of that playbook who took that background, and to no one else.
//
// Data rather than sheet code, because the attack flow needs the same answer: a move that turns
// something into a weapon (Purifying Flames' holy light) is picked up by choosing the stat this
// table grants, so the weapon prompt pre-selects it. Both sides read this one row, or they drift
// and nothing says so.
/** The Fox's The Natural, as a background row names it (move-pick-bonuses.js names it the same way). */
export const THE_NATURAL = { playbook: "The Fox", slug: "the-natural", label: "The Natural" };

export const ALT_STAT_GRANTS = [
	{ whenMove: "Clash",               ownsMove: "Skill at Arms",    altStat: "dex" },
	{ whenMove: "Clash",               ownsMove: "Purifying Flames", altStat: "wis" },
	{ whenMove: "Know Things",         ownsMove: "Well-Read",        altStat: "wis" },
	{ whenMove: "Persuade (vs. NPCs)", ownsMove: "Wild Speech",      altStat: "wis" },
	{ whenDefaultStat: "con",          ownsMove: "Laugh at Danger",  altStat: "cha" },
	{ whenMove: "Seek Insight",        background: THE_NATURAL, altStat: "int" },
];

/**
 * The whole grant a move makes, or null when it makes none. `whenMove` is the half the attack
 * flow needs: it says which move the alternate stat is FOR, which is also the move a granted
 * weapon rides on (Purifying Flames' holy light is a Clash), so clicking the granting move can
 * roll that attack rather than only offering an extra stat once the player finds it.
 */
export function altStatGrantForMove(moveName) {
	if (!moveName) return null;   // a background row names no move, and must not answer for "none"
	return ALT_STAT_GRANTS.find(g => g.ownsMove === moveName) ?? null;
}

/**
 * The rows that give a roll of `moveName` (default stat `defaultStat`) an alternate stat, for a
 * character with these LEARNED moves and this background. At most one row per stat, never the
 * default, in table order. THE one reading of the table's matching, for the inline stat picker and
 * the identify picker (actors/character/arcana-identify.js) both.
 *
 * @param {{moveName?: string, defaultStat?: string}} roll
 * @param {{learnedMoveNames?: Iterable<string>, playbook?: string|null, background?: string|null}} who
 *   `background` is the selected background's slug.
 * @returns {object[]} The matching ALT_STAT_GRANTS rows.
 */
export function altStatGrantsFor({ moveName = null, defaultStat = null } = {},
	{ learnedMoveNames = [], playbook = null, background = null } = {}) {
	const learned = new Set(learnedMoveNames);
	const rows = [];
	for (const g of ALT_STAT_GRANTS) {
		const matches = (g.whenMove && g.whenMove === moveName)
			|| (g.whenDefaultStat && g.whenDefaultStat === defaultStat);
		if (!matches || g.altStat === defaultStat || rows.some(r => r.altStat === g.altStat)) continue;
		const earned = g.background ? tookBackground({ playbook, background }, g.background) : learned.has(g.ownsMove);
		if (earned) rows.push(g);
	}
	return rows;
}
