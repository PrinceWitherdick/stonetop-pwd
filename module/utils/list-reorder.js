// The two primitives every drag-to-reorder in the system aims with.
//
// Pure and Foundry-free, and deliberately not in with any one feature's sheet: the GM toolkit's
// encounter rows, its bundle tabs and the relationship map's board strip all reorder the same way,
// and the one thing they must agree on is WHERE A DROP LANDS. The toolkit's own history is the
// argument for keeping them here -- its drag path used to re-implement the splice and the identity
// test inline, so a fix to `moveWithin` reached the keyboard nudge and not the drag.

/**
 * Move one element of `list` to `to`, clamped. Returns null for a no-op so an unchanged order
 * stays off the wire.
 *
 * Identity comparison is enough for the no-op test because nothing here rebuilds an element.
 */
export function moveWithin(list, from, to) {
	if (from < 0 || from >= list.length) return null;
	const next = [...list];
	const [moved] = next.splice(from, 1);
	next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
	return next.every((x, i) => x === list[i]) ? null : next;
}

/**
 * Where a drop lands: before the row it hit, or `fallback` when it named no neighbour.
 *
 * ALWAYS called against a list the dragged row has already been taken OUT of. That ordering is the
 * whole trick: aiming at the original list would count the row itself as one of the seats ahead of
 * the target, and every drop that moved a row FORWARDS would land one place short.
 */
export function insertionIndexIn(rows, beforeId, fallback) {
	if (!beforeId) return fallback;
	const i = rows.findIndex(r => r.id === beforeId);
	return i < 0 ? fallback : i;
}
