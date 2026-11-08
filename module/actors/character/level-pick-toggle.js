// The Moves tab's "Taken as a level pick" toggle (the user's ruling C4, 2026-11-06).
//
// Book I p.528, Level Up step 3: "Choose a new move from your class playbook, or an insert class that
// you've unlocked." A move put on the sheet by hand from outside the playbook's own list (another
// playbook's, a custom one, one from an insert the GM gave) can be a level's pick, but nothing said so,
// and the level move budget kept asking for a move already taken. In edit mode such a move's card offers
// this toggle, which sets or clears LEVEL_PICK_FLAG (StonetopCharacter#setLevelPick), the flag the
// budget counts. A copy granted through a cross-playbook move is never one: the cross move was the pick.

import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { LEVEL_PICK_FLAG } from "./StonetopCharacter.js";

/** Whether `item` is stamped as a level's pick. */
export const isLevelPick = item => !!item?.flags?.[STONETOP_SCOPE]?.[LEVEL_PICK_FLAG];

/**
 * The toggle for one Moves-tab card, `{ itemId, on }`, or null when the card has no copy that can be a
 * level pick. `ownedIds`: the card's copies. The copy already stamped answers for the card; else its first.
 *
 * @param {Iterable<Item>|{get: Function}} items  the actor's items
 * @param {string[]} ownedIds
 */
export function levelPickToggleFor(items, ownedIds = []) {
	const byId = id => (typeof items?.get === "function" ? items.get(id) : [...(items ?? [])].find(i => (i?._id ?? i?.id) === id));
	const copies = (ownedIds ?? []).map(byId)
		.filter(i => i?.type === "move" && !i.flags?.[STONETOP_SCOPE]?.grantedBy);
	if (!copies.length) return null;
	const stamped = copies.find(isLevelPick);
	const item = stamped ?? copies[0];
	return { itemId: item._id ?? item.id, on: !!stamped };
}

/**
 * Put the toggle on every Learned and Other Moves card of `movelist`, for someone who may write the sheet
 * while its moves are in edit mode; cleared otherwise. Mutates the cards (render data).
 *
 * @param {object} movelist  the sheet context's movelist (learnedMoves, otherMoves)
 * @param {Iterable<Item>|{get: Function}} items
 * @param {boolean} show
 */
export function attachLevelPickToggles(movelist, items, show) {
	for (const card of [...(movelist?.learnedMoves ?? []), ...(movelist?.otherMoves ?? [])]) {
		if (!card || typeof card !== "object") continue;
		const ids = card.ownedIds?.length ? card.ownedIds : (card.ownedId ? [card.ownedId] : []);
		card.levelPickToggle = show ? levelPickToggleFor(items, ids) : null;
	}
}
