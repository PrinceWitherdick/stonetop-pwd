// The special possessions whose ○ uses a chat card spends: books & scrolls (the Seeker's and the
// Lightbearer's) turns a Know Things roll into a 10+, and holy relics (the Lightbearer's) stand in
// for an Invoke the Sun God consequence. Neither is ever preselected, so the `selected` flag is
// the whole answer to "does this character have it", and a chat handler holding a bare Actor can
// ask without the playbook.
//
// A possession track counts uses SPENT, like a move's: a fresh character has no flag, which must
// read as an untouched track. So `left = max - spent`, and spending INCREMENTS.

export const BOOKS_AND_SCROLLS = { slug: "books-and-scrolls", max: 5 };   // "(○○○○○ uses)"
export const HOLY_RELICS       = { slug: "holy-relics",       max: 3 };   // "(○○○ uses)"

/**
 * A possession track's uses, off the character's `possessions` flag bag ({ selected, uses }).
 * Null when the character doesn't hold the possession. Pure.
 */
export function possessionTrackUses(possessions = {}, { slug, max }) {
	if (!(possessions.selected ?? []).includes(slug)) return null;
	const spent = Math.max(0, Number(possessions.uses?.[slug]) || 0);
	return { max, spent, left: Math.max(0, max - spent) };
}
