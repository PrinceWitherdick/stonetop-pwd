// A stat block's printed armor exceptions, read as the damage card asks about them.
//
// Book I p.397: "In parentheses after the armor rating, note the source(s) of the armor. Then list any
// variants or exceptions", with the worked example "Armor 5 (resilience, skill), 2 vs. iron". The shipped
// bestiary prints those exceptions in the stat block's special qualities: a Wretch is "Armor 4
// (resilience)" and "Armor 0 vs. bronze", a Wee Folk "Armor 6" and "Armor 2 vs. iron". p.412: "If your
// notes say that this monster is hurt only by bronze ... don't let them steamroll you".
//
// A LOWER ARMOR AGAINST ONE THING is carried exactly as a follower's "2 (0 vs. iron)" is
// (actors/character/move-armor.js#followerArmorGate): `armor.conditional` is how much of the armor that
// thing takes away, `armor.conditionalSource` names it ("vs. bronze"), both derived from the stat block's
// text on every prepare (MonsterModel#prepareDerivedData), never stored, and the damage card offers the
// armor back with a ticked box ("Not bronze") at the moment it matters (combat/attack-flow.js
// #wireConditionalArmor). Only the first such clause rides that box; the card holds one per row.
//
// EVERYTHING ELSE IS A REMINDER, never arithmetic (the user's ruling, 2026-10-23): a higher armor
// against one thing (the Gingkara's "Armor 4 vs. stabbing"), a second lower clause, "takes +1d4 damage
// from bronze", "half damage from smashing weapons", "harmed only by black iron", "fireproof". The damage
// card prints them on the monster's row for whoever applies the blow, who knows what it was struck with.
//
// PURE: plain values in, plain values out.

import { VERSUS_ARMOR_PREFIX } from "../actors/character/move-armor.js";
import { stripHtmlToText } from "../utils/strings.js";

/** "Armor 0 vs. bronze", "Armor 2 vs. bronze or fire (mail)", "Armor 0 against bare hands". */
const VERSUS_CLAUSE_RE = /\bArmor\s+(\d+)\s+(?:vs\.?|versus|against)\s+([^.;()\p{Pd}]+?)\s*(?:\(([^)]*)\))?\s*(?=[.;\p{Pd}]|$)/giu;

/** An armor SOURCE that is itself the exception: the Unliving Chimera's "Armor 4 (0 vs. bronze)". */
const VERSUS_SOURCE_RE = /^\s*(\d+)\s+(?:vs\.?|versus|against)\s+(.+?)\s*$/i;

/**
 * A quality that changes what a blow does to this monster, as the shipped stat blocks word it. Only what is
 * said about harm TAKEN: "deals damage with disadvantage" and "batters them with debris (d6 damage)" are
 * about harm dealt, and none of these patterns read them.
 */
const DAMAGE_NOTE_RE = new RegExp([
	String.raw`\b[a-z]+-proof\b`, String.raw`\bfireproof\b`,
	String.raw`\bimmune to (?!mental)`,
	String.raw`\bharmed (?:only )?by\b`, String.raw`\bburn(?:ed|t) by\b`, String.raw`\bunharmed by\b`,
	String.raw`\bhalf damage\b`, String.raw`\btakes? \+\d*d\d+ damage\b`, String.raw`\(\+\d*d\d+ damage\)`,
	String.raw`\bvulnerable to\b`, String.raw`\bdestroyed only by\b`, String.raw`\btoo big to hurt\b`,
	String.raw`\bchips or shatters the weapon\b`, String.raw`\bdivide damage taken\b`, String.raw`\bdodge or roll with\b`,
].join("|"), "i");

/** A stat block's qualities as plain text, enricher labels kept ("@UUID[...]{Fae nature}" reads "Fae nature"). */
function qualitiesText(system) {
	return stripHtmlToText(String(system?.qualities ?? "").replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1"));
}

/** Every "Armor N vs. X" a stat block prints, in order: its armor source first, then its qualities. */
function versusClauses(system) {
	const out = [];
	const source = VERSUS_SOURCE_RE.exec(String(system?.attributes?.armor?.source ?? ""));
	if (source) out.push({ armor: Number(source[1]), against: source[2].trim(), text: `Armor ${source[1]} vs. ${source[2].trim()}` });
	for (const hit of qualitiesText(system).matchAll(VERSUS_CLAUSE_RE)) {
		out.push({ armor: Number(hit[1]), against: hit[2].trim(), text: hit[0].trim() });
	}
	return out;
}

/** A stat block's armor rating as a whole number, never below 0. */
function armorValue(system) {
	return Math.max(0, Math.trunc(Number(system?.attributes?.armor?.value) || 0));
}

/** The one clause the damage card's box carries, out of `clauses`: the first that takes some of `armor` away, or null. */
function gateClause(clauses, armor) {
	return clauses.find(clause => clause.armor < armor && clause.against) ?? null;
}

/** A stat block's qualities cut into clauses: at a full stop or a semicolon, never at the stop in "vs.". */
const CLAUSE_SPLIT_RE = /(?<!\bvs)[.;]\s+|;\s*/i;

/**
 * A monster's printed armor exception, in the fields the damage card reads: how much of its armor the named
 * thing takes away, and what that thing is. `{conditional: 0, conditionalSource: ""}` for none.
 *
 * @param {object} system  a monster's `system` (or its plain data)
 * @returns {{conditional: number, conditionalSource: string}}
 */
export function monsterArmorGate(system) {
	const armor = armorValue(system);
	const clause = gateClause(versusClauses(system), armor);
	if (!clause) return { conditional: 0, conditionalSource: "" };
	return { conditional: armor - clause.armor, conditionalSource: `${VERSUS_ARMOR_PREFIX}${clause.against}` };
}

/**
 * What a damage card reminds whoever applies a blow to this monster, one line each: the armor exceptions the
 * box does not carry, and the qualities that change what a blow does (see the note at the top). [] for none.
 *
 * @param {object} system
 * @returns {string[]}
 */
export function monsterDamageNotes(system) {
	const clauses = versusClauses(system);
	const gate = gateClause(clauses, armorValue(system));
	const notes = clauses.filter(clause => clause !== gate).map(clause => clause.text);
	for (const raw of qualitiesText(system).split(CLAUSE_SPLIT_RE)) {
		// The part of a clause the armor box already says is not said again ("Armor 1 vs. black iron, and can be
		// truly destroyed only by black iron" keeps its second half).
		const rest = raw.replace(VERSUS_CLAUSE_RE, " ").replace(/^[\s,;:\p{Pd}]+|[\s,;:.\p{Pd}]+$/gu, "").trim();
		if (!rest || !DAMAGE_NOTE_RE.test(rest)) continue;
		notes.push(rest.replace(/^and\s+/i, ""));
	}
	return [...new Set(notes.map(note => note.charAt(0).toUpperCase() + note.slice(1)))];
}
