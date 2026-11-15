// Required-move prerequisites for a move. Stored on `system.requirement` as two lists:
//   - `moves`: ALL of these are required (Second Intent: "Parry & Riposte, and Ambush").
//   - `anyMoves`: ANY ONE of these is enough (Alpha: "Wild Speech or Spirit Tongue").
// Every reader of a move's required moves asks here, so an any-of list can't be read as
// all-of by one caller and either-or by another.

import { statRequirementLabel } from "./stat-requirement.js";
import { escapeRegExp } from "../../utils/strings.js";

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

// A requirement of marks on another move (`req.marks`: the Would-be Hero's Superior Stat, "Requires
// all 6 marks in Potential for Greatness", is { move: "Potential for Greatness", count: 6 }) as the
// book prints it; null when there is none.
export function marksRequirementLabel(req) {
	const marks = req?.marks;
	if (!marks?.move) return null;
	return `All ${marks.count} marks in ${marks.move}`;
}

// True when a marks requirement isn't met. `hasMove(name)` answers whether the character counts as
// having that move (LEARNED: marks on a move switched off open nothing) and `filledMarks(name)` how
// many of its marks are filled (pfg-marks.js#filledMarkCount). False when there is no such requirement.
export function marksRequirementUnmet(req, hasMove, filledMarks) {
	const marks = req?.marks;
	if (!marks?.move) return false;
	return !hasMove(marks.move) || (filledMarks?.(marks.move) ?? 0) < (Number(marks.count) || 0);
}

// The any-of list as the book prints it ("Wild Speech or Spirit Tongue"); null when empty.
export function anyMovesLabel(req) {
	const anyOf = req?.anyMoves ?? [];
	return anyOf.length ? anyOf.join(" or ") : null;
}

// A move's prerequisites as the book prints them, joined by "; ": the moves it needs, the any-of
// list, a stat minimum (Musclebound's STR +2), marks on another move (Superior Stat's "All 6 marks
// in Potential for Greatness"), a freeform note, "level N+" when `level` is given, and last, as the
// book does, the move it replaces ("level 6+; replaces Bulwark"). The replaced move is named once,
// there, not also as a required move. The note is display-only: the engine can't check "Sheriff
// background" off it, so it never locks anything. Null when there is nothing to show.
//
// A note that already says what the moves and level say (a homebrew playbook's printed "(Requires level
// 6+ and Otherkin)") is the line: the parts it names are not said again beside it, and its own
// "Requires" goes, since every place this is shown says that first.
export function requirementLabel(req, { replaces = null, level = null } = {}) {
	const parts = [];
	const note = String(req?.note ?? "").trim().replace(/^\((.*)\)$/, "$1").replace(/^\s*requires?\s*:?\s*/i, "").trim();
	// Said as a whole name ("Wild" is not said by "Wildborn"), and the level as the same number.
	const noteSays = text => !!note && new RegExp(String.raw`(?<![\w'’])${escapeRegExp(String(text).trim())}(?![\w'’])`, "i").test(note);
	const moves = (req?.moves ?? []).filter(m => m !== replaces);
	const notedMoves = moves.length && moves.every(noteSays);
	const notedLevel = !!note && level != null && new RegExp(String.raw`\blevel\s*${Number(level)}(?!\d)`, "i").test(note);
	if (moves.length && !notedMoves) parts.push(moves.join(", "));
	const anyOf = anyMovesLabel(req);
	if (anyOf)        parts.push(anyOf);
	const stats = statRequirementLabel(req?.stats);
	if (stats)        parts.push(stats);
	const marks = marksRequirementLabel(req);
	if (marks)        parts.push(marks);
	if (note)         parts.push(note);
	if (level && !notedLevel) parts.push(`level ${level}+`);
	if (replaces)     parts.push(`replaces ${replaces}`);
	return parts.length ? parts.join("; ") : null;
}
