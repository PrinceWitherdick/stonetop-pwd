/**
 * "Does this character own move X?" — the one answer, for every playbook feature that asks.
 *
 * The `type === "move"` check is the whole point, and it is the reason this is shared rather
 * than re-typed per feature: an inventory item, an arcanum, or a follower's gear may legally
 * carry the same name as a move, and none of them grant it. A feature that forgets the type
 * check lights its icon for the wrong sheet, and it fails quietly — nobody notices until a
 * player names a sword after a move.
 *
 * Pure: no Foundry global is touched, so every caller stays testable with a plain object.
 */

/** Does this actor own a MOVE by that exact name? */
export function ownsMoveNamed(actor, name) {
	return !!actor?.items?.some(i => i.type === "move" && i.name === name);
}

/**
 * The owned move Item itself, or undefined. For callers that need something off the document —
 * a resource `max`, a description — rather than just whether it is there.
 */
export function ownedMove(actor, name) {
	return (actor?.items ?? []).find(i => i.type === "move" && i.name === name);
}

/** Every move name this character owns, as a Set, for callers testing several names at once. */
export function ownedMoveNames(actor) {
	return new Set((actor?.items ?? []).filter(i => i.type === "move").map(i => i.name));
}

/**
 * The caller's pre-built Set, or one built now — for the features that need the Set itself rather
 * than a yes/no (they filter a table by it). Same truthy guard as `ownsAnyMoveNamed` below, and
 * here so that guard is written once for both shapes of caller.
 */
export function ownedNamesOr(actor, owned = null) {
	return owned || ownedMoveNames(actor);
}

/**
 * Does this actor own ANY of `names`?
 *
 * `owned` is an optional pre-built Set from `ownedMoveNames` — and from THAT function, not from
 * any other walk of the items: this branch trusts the Set to have applied the type check above,
 * because re-testing each hit against the collection is the work the Set exists to skip. A Set
 * built from unfiltered items would light a playbook feature for a sword named after a move,
 * which is the failure this whole module is here to prevent.
 *
 * It is for callers resolving several of these in one go: the character sheet's getData asks
 * five separate ownership questions per render, and each one answering for itself walks the
 * whole item collection again.
 *
 * Without a Set this stays the short-circuiting `some(ownsMoveNamed)` it was, deliberately —
 * building a Set to test one or two names costs more than the scan it would replace.
 *
 * THE guard for `owned` across every feature that takes one. Truthy rather than nullish, so a
 * falsy non-Set falls back to the scan and answers correctly instead of throwing — which matters
 * because these predicates read as siblings, and three of them spelling the guard three ways
 * meant `[a, b].map(oneOfThem)` threw at index 0 and `[a, b].map(anotherOfThem)` at index 1.
 * Every caller goes through here rather than re-writing the ternary.
 */
export function ownsAnyMoveNamed(actor, names, owned = null) {
	const has = owned ? (name) => owned.has(name) : (name) => ownsMoveNamed(actor, name);
	return names.some(name => has(name));
}
