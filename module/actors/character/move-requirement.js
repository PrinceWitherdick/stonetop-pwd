// Required-move prerequisites for a move. Stored on `system.requirement` as two lists:
//   - `moves`: ALL of these are required (Second Intent: "Parry & Riposte, and Ambush").
//   - `anyMoves`: ANY ONE of these is enough (Alpha: "Wild Speech or Spirit Tongue").
// Every reader of a move's required moves asks here, so an any-of list can't be read as
// all-of by one caller and either-or by another.

import { statRequirementLabel } from "./stat-requirement.js";

// The moves a requirement needs ALL of, with the move a move replaces folded in. Book I p.529:
// "If a move replaces a different move, then it requires the one it replaces." The data spells
// it out for A Mighty Rampart but not for the Would-be Hero's four.
export function effectiveRequiredMoves(req, replaces = null) {
	return [...new Set([...(req?.moves ?? []), ...(replaces ? [replaces] : [])])];
}

// True when the requirement's required moves aren't met. `hasMove(name)` answers whether
// the character counts as having that move.
export function requiredMovesUnmet(req, hasMove) {
	if ((req?.moves ?? []).some(m => !hasMove(m))) return true;
	const anyOf = req?.anyMoves ?? [];
	return anyOf.length > 0 && !anyOf.some(m => hasMove(m));
}

// The any-of list as the book prints it ("Wild Speech or Spirit Tongue"); null when empty.
export function anyMovesLabel(req) {
	const anyOf = req?.anyMoves ?? [];
	return anyOf.length ? anyOf.join(" or ") : null;
}

// A move's prerequisites as the book prints them, joined by "; ": the moves it needs, the any-of
// list, a stat minimum (Musclebound's STR +2), a freeform note, "level N+" when `level` is given,
// and last, as the book does, the move it replaces ("level 6+; replaces Bulwark"). The replaced
// move is named once, there, not also as a required move. The note is display-only: the engine
// can't check "All 6 marks in Potential for Greatness", so it never locks anything. Null when
// there is nothing to show.
export function requirementLabel(req, { replaces = null, level = null } = {}) {
	const parts = [];
	const moves = (req?.moves ?? []).filter(m => m !== replaces);
	if (moves.length) parts.push(moves.join(", "));
	const anyOf = anyMovesLabel(req);
	if (anyOf)        parts.push(anyOf);
	const stats = statRequirementLabel(req?.stats);
	if (stats)        parts.push(stats);
	if (req?.note)    parts.push(req.note);
	if (level)        parts.push(`level ${level}+`);
	if (replaces)     parts.push(`replaces ${replaces}`);
	return parts.length ? parts.join("; ") : null;
}
