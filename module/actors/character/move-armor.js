/**
 * The two moves that say a character HAS armor, rather than adding to what they wear:
 *
 *   BARKSKIN (Blessed)                "When you are touching the earth, you have 2 armor. When you mark
 *                                      another with 1 Stock, they gain this benefit so long as the mark
 *                                      remains."
 *   A CANDLE AGAINST THE DARK (Lightbearer)  "When you wield a holy light but go otherwise unarmed, you
 *                                      have 2 Armor."
 *
 * "YOU HAVE 2 ARMOR" IS A WORN BASE, not a bonus, which is the whole reason this is not a `moveBonuses`
 * entry: bases do not stack (the best one wins) and a shield still adds on top of one
 * (CharacterInventory#calculateArmor). A Blessed in mail keeps the mail's 3; a Blessed with a shield and
 * bark for skin has 2 + 1.
 *
 * WHAT IS ASSUMED, AND WHY IT IS SAFE TO ASSUME: the clause on each move is a piece of fiction the sheet
 * cannot read — whether she is touching the earth, whether he is otherwise unarmed. Each is the ordinary
 * case for the character who took the move (a Blessed stands on the ground; a Lightbearer who lit a holy
 * light is holding it), and the exception has a home already: the armor box is editable, and a hand-set
 * total banks the difference (StonetopCharacter#setArmor). Guessing the ordinary case wrong costs one
 * edit; not applying it at all costs the move.
 *
 * Kept Foundry-free so the rule can be tested with plain objects, like holy-light.js and condemn.js.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import { BARKSKIN, BLESSED_MARKS_FLAG } from "./blessed-marks.js";
import { actorMatchKeys, normalizeName, trailingActorId } from "./marked-people.js";

export const CANDLE_AGAINST_THE_DARK = "A Candle Against the Dark";

/** Both moves grant the same number, and the book states it as a total rather than a bonus. */
export const MOVE_ARMOR_BASE = 2;

/**
 * Which `stonetop.fight.heroMoves.armorGate.<key>` each move's words live under. Here beside the rule,
 * so a third armor-granting move adds a line here and the damage card needs no edit at all
 * (combat/attack-flow.js#wireConditionalArmor).
 */
const ARMOR_GATE_KEYS = Object.freeze({
	[BARKSKIN]: "barkskin",
	[CANDLE_AGAINST_THE_DARK]: "candle",
});

/**
 * A PRINTED armor clause: Afon's "Armor 2 (0 vs. iron)" (Initiates of Danu, Book I p.145). The same
 * kind of fact as Barkskin's "while touching the earth", a condition only the fiction can answer, so it
 * is carried the same way: the armor applies by default, and the damage card offers it back with a
 * ticked box ("Not iron") at the moment it matters. Stored as `conditionalSource` with this prefix, so
 * the card knows which words to ask with.
 */
export const VERSUS_ARMOR_PREFIX = "vs. ";

/** "2 (0 vs. iron)": the armor, then in brackets what is left of it against one thing. */
const VERSUS_ARMOR_RE = /^\s*(\d+)\b[^(]*\(\s*(\d+)\s+(?:vs\.?|versus|against)\s+([^)]+?)\s*\)/i;

/**
 * A follower's printed armor clause, read off their armor text: how much of it `against` takes away.
 * Zero and "" for armor with no such clause, or a clause that takes nothing away. A hand-typed number
 * (a stat override) has no clause, so the override is what applies.
 *
 * @param {string|number} armor  the card's armor ("2 (0 vs. iron)", "1 (shield)", 2)
 * @returns {{conditional: number, conditionalSource: string}}
 */
export function followerArmorGate(armor) {
	const hit = typeof armor === "string" ? VERSUS_ARMOR_RE.exec(armor) : null;
	const lost = hit ? Math.max(0, Number(hit[1]) - Number(hit[2])) : 0;
	return lost > 0
		? { conditional: lost, conditionalSource: `${VERSUS_ARMOR_PREFIX}${hit[3].trim()}` }
		: { conditional: 0, conditionalSource: "" };
}

/**
 * What the damage card says about a row's gated armor: its box's words (`stonetop.fight.heroMoves.
 * armorGate.<key>`), the note Apply prints when the box was unticked (`…armorGate.<noteKey>`), and
 * anything those words need besides the armor. Null when the source is unknown here (a world written by
 * a later build), which has no words to ask with.
 */
export function armorGateWords(source) {
	const text = String(source ?? "");
	if (ARMOR_GATE_KEYS[text]) return { key: ARMOR_GATE_KEYS[text], noteKey: "note", params: { move: text } };
	if (text.startsWith(VERSUS_ARMOR_PREFIX) && text.length > VERSUS_ARMOR_PREFIX.length) {
		return { key: "versus", noteKey: "versusNote", params: { against: text.slice(VERSUS_ARMOR_PREFIX.length) } };
	}
	return null;
}

/**
 * The worn-armor base a character's own moves give them, and which move gives it. 0 and null when none
 * do, which is nearly every character.
 *
 * @param {object} p
 * @param {Actor} p.actor
 * @param {boolean} [p.holyLight]  is this character's holy light burning (holy-light.js)
 * @param {boolean|(() => boolean)} [p.markedWithBarkskin]  has a Blessed put Barkskin on them (see
 *   `barkskinMarkedBy`). A FUNCTION is only called when the answer could matter: the scan behind it
 *   walks the world, and a character with Barkskin of their own is already at the base it would find.
 * @returns {{base: number, source: string|null}}
 */
export function moveArmor({ actor, holyLight = false, markedWithBarkskin = false }) {
	if (actor?.type !== "character") return { base: 0, source: null };
	const marked = () => (typeof markedWithBarkskin === "function" ? markedWithBarkskin() : markedWithBarkskin);
	if (ownsLearnedMoveNamed(actor, BARKSKIN) || marked()) return { base: MOVE_ARMOR_BASE, source: BARKSKIN };
	if (holyLight && ownsLearnedMoveNamed(actor, CANDLE_AGAINST_THE_DARK)) {
		return { base: MOVE_ARMOR_BASE, source: CANDLE_AGAINST_THE_DARK };
	}
	return { base: 0, source: null };
}

/**
 * Everyone wearing a Blessed's Barkskin, as the marks name them: the actor ids of rows laid on a
 * document, and the case-folded names of rows laid on a name alone. Built once and asked many times
 * (`wearsBarkskin`), for a sheet with several followers to ask about.
 *
 * Only a Blessed who still has Barkskin LEARNED grants it (owns-move.js#ownsLearnedMoveNamed).
 *
 * @param {Iterable<Actor>} actors  the world's actors
 * @param {object} [opts]
 * @param {Actor|null} [opts.except]  an actor whose own marks do not count (nobody marks themselves)
 */
export function barkskinMarks(actors = [], { except = null } = {}) {
	const ids = new Set();
	const names = new Set();
	for (const blessed of actors ?? []) {
		if (!blessed || blessed === except) continue;
		// The flag read FIRST: it is one property lookup and nearly every actor in the world fails it,
		// where `ownsLearnedMoveNamed` walks that actor's whole item list to answer.
		//
		// RAW, not `readMarks`: that is the roster's reader for SHOWING a list, and it drops rows with no
		// name because there is nothing to render and nothing to dismiss. Here the uuid IS the answer — it
		// names the person whether or not the row carries their name — so a nameless row still grants bark.
		const rows = blessed.getFlag?.(SYSTEM_ID, BLESSED_MARKS_FLAG);
		if (!Array.isArray(rows) || !rows.length) continue;
		if (!ownsLearnedMoveNamed(blessed, BARKSKIN)) continue;
		for (const row of rows) {
			if (row?.kind !== "barkskin") continue;
			if (row.uuid) ids.add(trailingActorId(row.uuid));
			else if (normalizeName(row.name)) names.add(normalizeName(row.name));
		}
	}
	return { ids, names };
}

/**
 * Is `who` on those marks?
 *
 * By document first, folded onto the trailing actor id exactly as the mark rosters and their sheet tags
 * fold (marked-people.js#actorMatchKeys), so a row laid by dropping a token and a row laid from the
 * sidebar are the same person here too.
 *
 * `byName` also takes a row laid on a NAME ALONE, the way the roster itself recognises the people on it
 * (marked-people.js#isOnIndex). Only a name-only row, though: a row naming a document names that
 * document, and a follower who merely shares its spelling is somebody else. It is for followers, who are
 * often marked by the name on their card; a character's sheet is marked through its document.
 *
 * @param {{ids: Set<string>, names: Set<string>}} marks  barkskinMarks' answer
 * @param {{uuid?: string, id?: string, name?: string}} who
 * @param {{byName?: boolean}} [opts]
 */
export function wearsBarkskin(marks, who, { byName = false } = {}) {
	for (const key of actorMatchKeys(who)) if (marks?.ids?.has(key)) return true;
	const name = normalizeName(who?.name);
	return byName && !!name && !!marks?.names?.has(name);
}

/**
 * Is this actor wearing a Blessed's Barkskin — a mark on somebody ELSE's sheet?
 *
 * @param {Actor} actor
 * @param {Iterable<Actor>} actors  the world's actors
 * @param {{byName?: boolean}} [opts]  see `wearsBarkskin`
 */
export function barkskinMarkedBy(actor, actors = [], { byName = false } = {}) {
	if (!actorMatchKeys(actor).size && !(byName && normalizeName(actor?.name))) return false;
	return wearsBarkskin(barkskinMarks(actors, { except: actor }), actor, { byName });
}

/**
 * The armor somebody who is NOT a character is taken against, with a Blessed's Barkskin on them: "they
 * gain this benefit", 2 armor while touching the earth. A BASE, like the move's own (see the top of
 * this file): the better of it and what they already have, never the two added.
 *
 * A character's stored armor already carries it (StonetopCharacter#_armorFrom); a follower's NPC keeps
 * only its card's numbers, so this is how a mark on one reaches the damage row.
 *
 * The part the bark bought is the part the card offers back ("while touching the earth"). One box per
 * row, so where the NPC has a printed clause of its own (Afon's "0 vs. iron") the two are settled
 * together, taking the bark as met: iron still strips what the bark does not cover, and a clause the
 * bark covers entirely leaves nothing to ask about.
 *
 * @param {{armor: number, unpierceable: number, conditional: number, conditionalSource: string}} worn
 *   the stored armor (combat/attack-flow.js#wornArmor)
 * @param {boolean} marked  wearing a Blessed's Barkskin
 */
export function withBarkskinBase(worn, marked) {
	if (!marked) return worn;
	const printed = Math.max(0, Number(worn?.armor) || 0);
	const total = Math.max(printed, MOVE_ARMOR_BASE);
	const clause = Math.max(0, Number(worn?.conditional) || 0);
	// What the printed clause still takes away once the bark is under it.
	const versus = clause > 0 ? Math.max(0, total - Math.max(printed - clause, MOVE_ARMOR_BASE)) : 0;
	if (versus > 0) return { ...worn, armor: total, conditional: versus };
	const bark = total - printed;
	return { ...worn, armor: total, conditional: bark, conditionalSource: bark > 0 ? BARKSKIN : "" };
}
