// Playbook moves that let a character roll a different stat for a basic move. When the actor
// owns `ownsMove`, the basic move named `whenMove` (or, for blanket grants, any move whose
// default stat is `whenDefaultStat`) offers `altStat` as an extra choice in the roll's stat
// picker. Mind Over Magic (arcanum rolls) is not covered here — arcana roll through a separate
// path.
//
// Data rather than sheet code, because the attack flow needs the same answer: a move that turns
// something into a weapon (Purifying Flames' holy light) is picked up by choosing the stat this
// table grants, so the weapon prompt pre-selects it. Both sides read this one row, or they drift
// and nothing says so.
export const ALT_STAT_GRANTS = [
	{ whenMove: "Clash",               ownsMove: "Skill at Arms",    altStat: "dex" },
	{ whenMove: "Clash",               ownsMove: "Purifying Flames", altStat: "wis" },
	{ whenMove: "Know Things",         ownsMove: "Well-Read",        altStat: "wis" },
	{ whenMove: "Persuade (vs. NPCs)", ownsMove: "Wild Speech",      altStat: "wis" },
	{ whenDefaultStat: "con",          ownsMove: "Laugh at Danger",  altStat: "cha" },
];

/**
 * The whole grant a move makes, or null when it makes none. `whenMove` is the half the attack
 * flow needs: it says which move the alternate stat is FOR, which is also the move a granted
 * weapon rides on (Purifying Flames' holy light is a Clash), so clicking the granting move can
 * roll that attack rather than only offering an extra stat once the player finds it.
 */
export function altStatGrantForMove(moveName) {
	return ALT_STAT_GRANTS.find(g => g.ownsMove === moveName) ?? null;
}
