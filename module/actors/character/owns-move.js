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

import { SYSTEM_ID, LEGACY_FLAG_SCOPES, isCutOver } from "../../system-id.js";

/** Does this actor own a MOVE by that exact name? */
export function ownsMoveNamed(actor, name) {
	return !!actor?.items?.some(i => i.type === "move" && i.name === name);
}

/**
 * Is a move LEARNED — active — rather than kept on the sheet switched off?
 *
 * A player can un-learn any owned move (StonetopCharacter#setMoveLearned): it stays listed, greyed,
 * and its HP and armor bonuses stop counting. An absent flag means learned, so a fresh move needs
 * nothing written to be on.
 */
export function isMoveLearned(item) {
	return moveLearnedIn(item, item?.parent?.items);
}

/**
 * The cross-playbook move that granted `item` (Versatile, Initiate of the Secret Arts, ...), found
 * among `items` by the `grantedBy.instanceId` it was stamped with; null when it has none or the
 * granter is no longer there.
 */
export function granterOf(item, items) {
	const id = item?.flags?.[SYSTEM_ID]?.grantedBy?.instanceId;
	if (!id || !items) return null;
	return items.get?.(id) ?? [...items].find(i => (i?._id ?? i?.id) === id) ?? null;
}

/**
 * `isMoveLearned`, read against the actor's own `items`, for a caller holding the actor (a test's
 * plain item has no `parent`). A move a switched-off cross move GRANTED is switched off with it
 * (the user's ruling): the grant stays on the sheet with its own flag untouched, so re-learning
 * the granter brings it straight back. Its own toggle still counts on its own: a learned granter
 * with the grant switched off reads as off.
 */
export function moveLearnedIn(item, items) {
	return item?.flags?.[SYSTEM_ID]?.learned !== false && !switchedOffGranter(item, items);
}

/** The switched-off move whose grant keeps `item` off, or null (see moveLearnedIn). */
export function switchedOffGranter(item, items) {
	const seen = new Set([item]);
	for (let granter = granterOf(item, items); granter && !seen.has(granter); granter = granterOf(granter, items)) {
		if (granter.flags?.[SYSTEM_ID]?.learned === false) return granter;
		seen.add(granter);
	}
	return null;
}

/**
 * Does this actor have move `name` AND still have it switched on?
 *
 * What a RULE should ask. `ownsMoveNamed` answers "is it on the sheet", which is the right question
 * for a panel, a glyph or a roster the move opens — a Blessed whose Barkskin is off still has marks
 * to look after. It is the wrong question for a move that changes a number in a fight: an un-learned
 * Dangerous must not sharpen a damage roll.
 */
export function ownsLearnedMoveNamed(actor, name) {
	return !!actor?.items?.some(i => i.type === "move" && i.name === name && moveLearnedIn(i, actor.items));
}

/** The characters out of any list of actors who have move `name` learned (ownsLearnedMoveNamed). */
export function learnedHolders(actors, name) {
	return [...(actors ?? [])].filter(a => a?.type === "character" && ownsLearnedMoveNamed(a, name));
}

/**
 * The names of every character in the world with move `name` learned: for a steading window, which
 * cannot tell which character is behind its roll (Logistics, Pathfinder).
 */
export function worldLearnedHolderNames(name) {
	const actors = globalThis.game?.actors;
	return learnedHolders(actors?.contents ?? actors ?? [], name).map(a => a.name);
}

/**
 * Did a PLAYER write this move, in the custom-move dialog, rather than a book print it?
 *
 * The custom-move flag is the answer (utils/custom-move-data.js#buildCustomMoveData stamps it), and
 * `moveType "other"` is NOT: a GM who drops another playbook's move on a sheet lands it as "other"
 * too (StonetopCharacter#onDropMove), and a dropped Ambush is still the book's Ambush. A rule that
 * lets a player's own move "act as itself" asks this, so the foreign move keeps working.
 *
 * Read through the older scopes too until the item is cut over (system-id.js#isCutOver): a custom
 * move written before the rename carries its flag under `stonetop_pwd`, and must not start
 * answering as the book's move of that name just because the migration hasn't reached it yet.
 */
export function isPlayerAuthoredMove(item) {
	const flags = item?.flags;
	if (flags?.[SYSTEM_ID]?.custom) return true;
	if (!flags || isCutOver(item)) return false;
	return LEGACY_FLAG_SCOPES.some(scope => !!flags[scope]?.custom);
}

/**
 * The name a table keyed by the BOOK's moves looks this move up by (MOVE_ROLL_INSTEAD, the guided moves,
 * ATTACK_MOVES, PC_ASKS, the pick bonuses and roll options, a move's use and roll effects...), or null
 * for a move a player wrote (isPlayerAuthoredMove): a homebrew "Know Things" acts as itself and borrows
 * none of the book's behaviour. THE one guard for every such lookup, so none can forget it.
 *
 * `name` is the name the caller reads the move by, the item's own unless given: a sheet row read by
 * its text may have no item at all (an un-owned playbook row), and that row is the book's.
 */
export function bookMoveName(item, name = item?.name) {
	return isPlayerAuthoredMove(item) ? null : (name ?? null);
}

/**
 * `ownedLearnedMove`, for a rule that means the BOOK's move of that name: a player's own move that
 * happens to share the name is not it (bookMoveName). A move-granted weapon asks this, for the move's
 * own resource track.
 */
export function ownedLearnedBookMove(actor, name) {
	return (actor?.items ?? []).find(i => i.type === "move" && bookMoveName(i) === name && moveLearnedIn(i, actor.items));
}

/** `ownedLearnedBookMove` as a yes/no, which is all Cheap Shot needs. */
export function ownsLearnedBookMoveNamed(actor, name) {
	return !!ownedLearnedBookMove(actor, name);
}

/**
 * The owned move Item itself, or undefined. For callers that need something off the document —
 * a resource `max`, a description — rather than just whether it is there.
 */
export function ownedMove(actor, name) {
	return (actor?.items ?? []).find(i => i.type === "move" && i.name === name);
}

/**
 * `ownedMove`, for a RULE: the owned move Item only while it is still learned. Rites of the
 * Land's Boon track is read off the move for its `max`, and an un-learned Rites must not keep
 * offering a Boon purse (see ownsLearnedMoveNamed for why the two questions differ).
 */
export function ownedLearnedMove(actor, name) {
	return (actor?.items ?? []).find(i => i.type === "move" && i.name === name && moveLearnedIn(i, actor.items));
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
