import { tookBackground } from "../actors/character/took-background.js";
import { localize } from "../utils/i18n.js";

// Playbook moves that let a character roll a different stat for a basic move. When the actor
// owns `ownsMove` (and has it LEARNED: a move switched off on the sheet grants nothing), the basic
// move named `whenMove` (or, for blanket grants, any move whose default stat is `whenDefaultStat`)
// offers `altStat` as an extra choice in the roll's stat picker. Mind Over Magic (arcanum rolls)
// is not a row here: arcana roll through their own path, so its +INT is offered there
// (actors/character/arcana-seeker-moves.js#mindOverMagicRoll): on the dialog of every arcanum
// move that rolls a stat, a back mystery, a condensed move or a roll printed on a card's front or
// in its unlock text, and on the Ring of Daagon's Send Them Back. The Know Things roll that
// identifies a card is +INT as printed, so it has nothing to swap.
//
// A blanket row (`whenDefaultStat`) asks nothing of the move, so it reaches every roll of that
// stat: a move's, an arcanum mystery's (arcana-seeker-moves.js#arcanumAltRolls, beside Mind Over
// Magic's +INT) and the stat block's bare roll (StonetopCharacterSheet#_bareStatAltChoice). The
// Fox's Laugh at Danger is "When you are about to roll +CON", whatever the roll is for.
//
// A row can name a BACKGROUND in place of a move (`background: { playbook, slug, label }`): the
// Fox's The Natural, "When you Seek Insight, you may roll +INT instead of +WIS". It applies to a
// character of that playbook who took that background, and to no one else.
//
// A row can carry a `noteKey` (a language-file key): what rolling with its stat sets in motion, said
// on the roll's card (altStatNotes). Penitent's "the GM will ask you who you wronged back then".
//
// Data rather than sheet code, because the attack flow needs the same answer: a move that turns
// something into a weapon (Purifying Flames' holy light) is picked up by choosing the stat this
// table grants, so the weapon prompt pre-selects it. Both sides read this one row, or they drift
// and nothing says so.
/** The Fox's The Natural, as a background row names it (move-pick-bonuses.js names it the same way). */
export const THE_NATURAL = { playbook: "The Fox", slug: "the-natural", label: "The Natural" };

/**
 * The Heavy's Blood-Soaked Past: "When you Persuade using violence or threats against someone who
 * knows your black reputation, you can roll +STR instead of +CHA. Also, if you take the Formidable
 * move, you can choose to roll +CON instead of +CHA." The fictional half (violence or threats, a
 * target who knows) is the player's call, quoted beside the stat in the picker.
 */
export const BLOOD_SOAKED_PAST = { playbook: "The Heavy", slug: "blood-soaked-past", label: "Blood-Soaked Past" };

/**
 * The Marshal's Penitent: "When you draw on your bloody past to Know Things, you may roll +STR
 * instead of +INT. If you do, the GM will ask you who you wronged back then or who might still
 * hold a grudge. Answer them now." Drawing on that past is the player's call, and the picker quotes
 * the paragraph beside the stat; the GM's question is the row's `noteKey`, on the card of a roll
 * made with it.
 */
export const PENITENT = { playbook: "The Marshal", slug: "penitent", label: "Penitent" };

/**
 * The Ranger's Wide Wanderer: "When you Know Things about the wider world, you can roll +WIS
 * instead of +INT." Whether the question is about the wider world is the player's call, quoted
 * beside the stat in the picker (and in the arcana identify picker, which reads this table too).
 */
export const WIDE_WANDERER = { playbook: "The Ranger", slug: "wide-wanderer", label: "Wide Wanderer" };

export const ALT_STAT_GRANTS = [
	{ whenMove: "Clash",               ownsMove: "Skill at Arms",    altStat: "dex" },
	{ whenMove: "Clash",               ownsMove: "Purifying Flames", altStat: "wis" },
	{ whenMove: "Know Things",         ownsMove: "Well-Read",        altStat: "wis" },
	{ whenMove: "Persuade (vs. NPCs)", ownsMove: "Wild Speech",      altStat: "wis" },
	{ whenDefaultStat: "con",          ownsMove: "Laugh at Danger",  altStat: "cha" },
	{ whenMove: "Seek Insight",        background: THE_NATURAL, altStat: "int" },
	{ whenMove: "Persuade (vs. NPCs)", background: BLOOD_SOAKED_PAST, altStat: "str" },
	{ whenMove: "Persuade (vs. PCs)",  background: BLOOD_SOAKED_PAST, altStat: "str" },
	{ whenMove: "Formidable",          background: BLOOD_SOAKED_PAST, altStat: "con" },
	{ whenMove: "Know Things",         background: PENITENT,          altStat: "str", noteKey: "stonetop.altStat.penitentNote" },
	{ whenMove: "Know Things",         background: WIDE_WANDERER,     altStat: "wis" },
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

/**
 * The card lines a roll made with `stat` owes, out of the rows altStatGrantsFor matched: the `noteKey`
 * of the row that granted that stat, localized, as the roll's `conditionNotes`. Empty for the default
 * stat, a stat no row granted, or a row with nothing to say.
 *
 * @param {object[]} rows  altStatGrantsFor's answer for this roll
 * @param {string} stat    the stat the roll was made with
 * @returns {string[]}
 */
export function altStatNotes(rows, stat) {
	const row = (rows ?? []).find(g => g.altStat === stat);
	return row?.noteKey ? [localize(row.noteKey)] : [];
}
