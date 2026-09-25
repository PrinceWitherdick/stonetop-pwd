/**
 * Moves whose fictional trigger needs a light(er) load: the Fox's Catlike ("When you carry a light
 * load and act with care, you move silently") and Free Running, the Ranger's Stalker, the Heavy's
 * Uncanny Reflexes. The heaviest load a move tolerates is its own data (`system.maxLoad`, see
 * MoveDefinition); this is what the sheet and the expedition readout SAY about it.
 *
 * NOT THE WHOLE MOVE, ALWAYS. Catlike prints two triggers, and only the first is about load:
 * "When you hide in shadows or darkness, you remain unseen..." holds under any load. So which
 * clause is gated is read off the move's own text, the trigger that names a load, rather than
 * retyped beside it: a move with one trigger is gated whole (Free Running, Uncanny Reflexes), a
 * move with more is gated only in the clause that names the load (Catlike, Stalker).
 *
 * Display only. Nothing here switches a move off: the fiction is the table's to judge.
 */

import { stripHtmlToText } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

/** Load tiers lightest to heaviest. Nothing carried ranks as light. */
export const LOAD_RANK = { light: 0, normal: 1, heavy: 2, overloaded: 3 };

/** The triggers a move's text prints in bold italics, in order, as plain text. */
function triggers(description) {
	return [...String(description ?? "").matchAll(/<strong>\s*<em>([\s\S]*?)<\/em>\s*<\/strong>/gi)]
		.map(m => stripHtmlToText(m[1]).trim())
		.filter(Boolean);
}

/**
 * Which part of a load-gated move the load gates: `{ partial: false }` for the whole move, or
 * `{ partial: true, clause }` naming the gated trigger with its load condition taken off ("act with
 * care"), when the move prints other triggers the load does not touch.
 */
export function loadGatedClause(description) {
	const all   = triggers(description);
	const gated = all.find(t => /\bload\b/i.test(t));
	if (!gated || all.length < 2) return { partial: false, clause: null };
	const clause = gated.replace(/^.*?\bload\b[\s,]*(?:and\s+)?/i, "").trim();
	return clause ? { partial: true, clause } : { partial: false, clause: null };
}

/** Whether `loadTier` (the sheet's derived load) is heavier than `maxLoad` allows. */
export function overLoadGate(maxLoad, loadTier) {
	if (!maxLoad || !(maxLoad in LOAD_RANK)) return false;
	return (LOAD_RANK[loadTier] ?? 0) > LOAD_RANK[maxLoad];
}

/**
 * The tag a move card wears while the character's CURRENT load is heavier than the move allows,
 * or null: "needs a light load", or for a move gated in one clause only, that clause
 * ("act with care: needs a light load").
 */
export function loadGateNote(move, loadTier) {
	if (!move?.owned || !overLoadGate(move.maxLoad, loadTier)) return null;
	const load = localize(`stonetop.loadGate.load.${move.maxLoad}`);
	const { partial, clause } = loadGatedClause(move.description);
	return partial
		? format("stonetop.loadGate.clause", { clause, load })
		: format("stonetop.loadGate.whole", { load });
}

/**
 * Tag every owned, load-gated move in a snapshot's categories that `loadTier` switches off
 * (`loadGateNote`). In place, on the snapshots the Moves tab renders.
 */
export function tagLoadGatedMoves(categories, loadTier) {
	for (const move of (categories ?? []).flatMap(c => c?.moves ?? [])) {
		const note = loadGateNote(move, loadTier);
		if (note) move.loadGateNote = note;
	}
	return categories;
}
