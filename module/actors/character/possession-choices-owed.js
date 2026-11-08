/**
 * The words for a possession pick still owed (StonetopCharacter#possessionChoicesOwed). Big Magic:
 * "Each time you take this move, choose an additional remarkable trait for your sacred pouch"
 * (Book I p.106). The move card's hand and the pouch row's chip both say it, as Veteran Crew's
 * owed tags do (utils/crew.js#crewTagsOwed).
 */
import { format } from "../../utils/i18n.js";

/**
 * `owed` with a spoken line on each move (`label`) and on each possession (`bySlugView[slug]`):
 * `{ byMove: {name: {slug, count, label}}, bySlug: {slug: {count, label, tooltip}} }`.
 */
export function possessionChoicesOwedView(owed) {
	const byMove = {};
	for (const [move, o] of Object.entries(owed?.byMove ?? {})) {
		const key = o.count === 1 ? "possessionChoiceOwedOne" : "possessionChoiceOwedMany";
		byMove[move] = { ...o, label: format(`stonetop.character.moves.${key}`, { move, count: o.count }) };
	}
	const bySlug = {};
	for (const [slug, count] of Object.entries(owed?.bySlug ?? {})) {
		bySlug[slug] = {
			count,
			label: count === 1
				? format("stonetop.character.gear.choicesOwed.labelOne", {})
				: format("stonetop.character.gear.choicesOwed.label", { count }),
			tooltip: format("stonetop.character.gear.choicesOwed.tooltip", {}),
		};
	}
	return { byMove, bySlug };
}

/**
 * Put `view`'s owed picks on the rows that show them, beside their sibling cues (statChoiceNeeded and
 * the rest): `possessionChoiceOwed` on each move card, `choicesOwed` on each possession row; null where
 * nothing is owed. Mutates the rows (render data).
 *
 * @param {Iterable<object>} moves        every move card on the sheet
 * @param {Iterable<object>} possessions  the special possession rows
 * @param {ReturnType<typeof possessionChoicesOwedView>} view
 */
export function attachPossessionChoicesOwed(moves, possessions, view) {
	for (const m of moves ?? []) if (m && typeof m === "object") m.possessionChoiceOwed = view?.byMove?.[m.name] ?? null;
	for (const p of possessions ?? []) if (p && typeof p === "object") p.choicesOwed = view?.bySlug?.[p.slug] ?? null;
}
