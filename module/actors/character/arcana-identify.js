// Which of a character's own moves bend the Know Things roll that identifies an arcanum
// (Book I, Discoveries p.440). Pure and Foundry-free so the table and the netting rules are
// unit-testable on their own; the sheet does the DOM and the document writes.
//
// Nothing here ENFORCES a trigger. Every one of these moves fires on fiction the system can't
// see ("any script, text, runes or symbols that you encounter", "the source in which you read
// about the matter at hand"), so the dialog quotes the move and lets the player decide — the
// same contract the inline stat picker already keeps for alt-stat grants.

import { altStatGrantsFor, altStatNotes } from "../../data/alt-stat-grants.js";
import { layModes } from "../../utils/roll-mode.js";

/** Know Things is +INT (Book I p.220); alt stats are grants layered on top. */
export const KNOW_THINGS_STAT = "int";

// Moves whose text reads "…you have advantage" on a Know Things roll. Kept here rather than in
// ALT_STAT_GRANTS because that table is shared with the attack flow, which asks a different
// question (which stat, and therefore which weapon) and would be confused by an advantage row.
export const KNOW_THINGS_ADVANTAGE_MOVES = ["Polyglot", "Naturalist"];

/**
 * The stat options and advantage grants a character brings to an identifying Know Things roll.
 * `ownedMoveNames` is a plain iterable of move names, so callers pass names rather than Items,
 * and it is the LEARNED ones a caller passes: a move switched off on the sheet grants nothing.
 * `playbook` and `background` (the selected background's slug) answer an ALT_STAT_GRANTS row that
 * names a background rather than a move.
 *
 * `stats` always leads with +INT and never repeats a stat. `advantageMoves` is the subset of
 * KNOW_THINGS_ADVANTAGE_MOVES the character actually owns. `hasChoice` is false for a character
 * with none of these moves, which is most of them — the sheet skips the dialog entirely then, so
 * the ordinary case stays a single click.
 */
export function knowThingsRollChoices(ownedMoveNames = [], { playbook = null, background = null } = {}) {
	const owned = new Set(ownedMoveNames);
	// The inline picker's matching, from the one reader of the table: a grant keyed to this move by
	// name, or a blanket grant keyed to the stat the move rolls by default.
	const rows = altStatGrantsFor({ moveName: "Know Things", defaultStat: KNOW_THINGS_STAT },
		{ learnedMoveNames: owned, playbook, background });
	const stats = [KNOW_THINGS_STAT, ...rows.map(g => g.altStat)];
	// A background row is quoted by its label, and `grantBackgrounds` carries the row itself so the
	// sheet can quote the background's own sentence about the move under that label.
	const statGrants = rows.map(g => g.ownsMove ?? g.background.label);
	const advantageMoves = KNOW_THINGS_ADVANTAGE_MOVES.filter(name => owned.has(name));
	return { stats, statGrants, grantBackgrounds: _grantBackgrounds(rows), statNotes: _statNotes(rows), advantageMoves,
		hasChoice: stats.length > 1 || advantageMoves.length > 0 };
}

/** Seek Insight is +WIS; alt stats are grants layered on top. */
export const SEEK_INSIGHT_STAT = "wis";

/**
 * The stat options a character brings to a Seek Insight rolled about one thing (an artifact, p.430),
 * in the shape knowThingsRollChoices hands the same picker: the Fox's The Natural ("When you Seek
 * Insight, you may roll +INT instead of +WIS"), and any blanket grant keyed to +WIS, read from the
 * one reader of ALT_STAT_GRANTS. No move grants advantage on it, so `advantageMoves` is always empty
 * and `hasChoice` is false for everyone but a character with a grant.
 */
export function seekInsightRollChoices(ownedMoveNames = [], { playbook = null, background = null } = {}) {
	const rows = altStatGrantsFor({ moveName: "Seek Insight", defaultStat: SEEK_INSIGHT_STAT },
		{ learnedMoveNames: new Set(ownedMoveNames), playbook, background });
	const stats = [SEEK_INSIGHT_STAT, ...rows.map(g => g.altStat)];
	return { stats, statGrants: rows.map(g => g.ownsMove ?? g.background.label),
		grantBackgrounds: _grantBackgrounds(rows), statNotes: _statNotes(rows), advantageMoves: [], hasChoice: stats.length > 1 };
}

/** The background rows among `rows`, by label: what the picker quotes a background grant from. */
function _grantBackgrounds(rows) {
	return rows.filter(g => !g.ownsMove && g.background).map(g => g.background);
}

/**
 * The card lines each granted stat owes (alt-stat-grants.js#altStatNotes: Penitent's "the GM asks who you
 * wronged"), by stat, for the stats that owe any: the roll passes `statNotes[picked]` as its conditionNotes.
 */
function _statNotes(rows) {
	const out = {};
	for (const g of rows) {
		const notes = altStatNotes(rows, g.altStat);
		if (notes.length) out[g.altStat] = notes;
	}
	return out;
}

/**
 * Fold a claimed advantage into the roll mode the character already carries, as a roll's options.
 *
 * Book I p.230: "When you make a roll with both advantage and disadvantage, they cancel each
 * other out" and "Advantage/disadvantage don't 'stack.' They're binary." So advantage on top of
 * disadvantage is a normal roll, and advantage on top of advantage is still just advantage,
 * never a second die. Not claiming it leaves the character's own roll mode untouched.
 *
 * The mode it folds to, AND the sides that spoke (`modeBase`, `modeSources`: roll-mode.js#layModes), for
 * StonetopCharacter#onDirectStatRoll. With the sides kept, a Disadvantage cancelled by Polyglot stays
 * cancelled when a debility is laid on after it (Dazed on +INT): one side each way, however many of each
 * (p.230), where the netted "normal" alone would have been tipped back to disadvantage.
 */
export function advantageRollOptions(rollMode, claimed) {
	return layModes({ rollMode }, claimed ? ["adv"] : []);
}

// -- What an identifying roll writes ------------------------------------------------------------------

/**
 * What identifying an arcanum at `tier` writes, given what the character already has (Book I p.440:
 * "on a 10+, give them the card and have them read both sides; on a 7-9, have them read the front, and
 * show them the back when they have some time to study it or learn more"):
 *  - "reveal": front and back, any back debt settled (10+);
 *  - "owed": the front, with the back owed (7-9);
 *  - "front": the front only, for a 7-9 on a card whose back the character can read already (a GM reveal,
 *    or a Shift that lifted the same card to a 10+ while its dice were still rolling): no debt to owe;
 *  - null: nothing to write, which is also the answer for a card the character no longer holds (removed
 *    since the roll), so an old card's Shift cannot hand back a card nobody has.
 * UPGRADES ONLY: a tier never takes back what a higher one already gave.
 *
 * @param {string} tier  "critical" | "success" | "partial" | "failure"
 * @param {{owned: boolean, identified: boolean, revealed: boolean, backOwed: boolean}} state
 * @returns {"reveal"|"owed"|"front"|null}
 */
export function arcanumIdentifyWrite(tier, { owned = false, identified = false, revealed = false, backOwed = false } = {}) {
	if (!owned) return null;
	if (tier === "success" || tier === "critical") return identified && revealed && !backOwed ? null : "reveal";
	if (tier !== "partial" || identified) return null;
	return revealed ? "front" : "owed";
}

/** The state arcanumIdentifyWrite reads, off a character (StonetopCharacter's arcana getters). */
export function arcanumIdentifyState(character, slug) {
	const has = set => !!set?.has?.(slug);
	return {
		owned:      has(character?.ownedArcanaSlugs),
		identified: has(character?.identifiedArcanaSlugs),
		revealed:   has(character?.revealedArcanaSlugs),
		backOwed:   has(character?.backOwedArcanaSlugs),
	};
}

/** Make arcanumIdentifyWrite's write. Answers whether anything was written. */
export async function applyArcanumIdentifyWrite(character, slug, write, options) {
	if (write === "reveal") await character.identifyAndRevealArcanum(slug, options);
	else if (write === "owed") await character.identifyFrontOwedArcanum(slug, options);
	else if (write === "front") await character.identifyArcanum(slug, options);
	else return false;
	return true;
}

/** Identify `slug` at `tier`: read the state, work out the write, make it. Answers whether anything was written. */
export function identifyArcanumAtTier(character, slug, tier, options) {
	return applyArcanumIdentifyWrite(character, slug, arcanumIdentifyWrite(tier, arcanumIdentifyState(character, slug)), options);
}
