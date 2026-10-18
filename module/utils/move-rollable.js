// A STAND-IN FOR A MOVE'S ROW, for rolling a move that is not being clicked on the sheet.
//
// StonetopCharacter#onRoll reads the move it rolls off the row that was clicked: an ancestor
// `.item.stonetop-item` carrying the item id, a `.stonetop-item-name`, and the stat on the rollable's
// data-roll. The hotbar's move macros (StonetopCharacterSheet#rollMoveById), a love letter, a granted
// weapon's attack and Death's Door's one last move (DeathsDoorDialog#_onMakeLastMove) roll a move with no
// row on screen, so they build this detached one instead. A real (unattached) element means the roll's
// helpers need no DOM-vs-object special-casing: they closest()/querySelector() over it exactly as on the
// sheet. Here rather than on the sheet, so a window that rolls a move needs nothing private of the sheet's.

import { normalizeRollType } from "./roll-types.js";

/**
 * The rollable stand-in for `item`'s row, or null for a move with no rollType (nothing to roll).
 *
 * @param {Item} item
 * @param {Document} [doc]  the document to build it in (injectable for tests)
 * @returns {HTMLElement|null}
 */
export function moveRollable(item, doc = globalThis.document) {
	const stat = normalizeRollType(item?.system?.rollType);
	if (!stat) return null;
	const li = doc.createElement("li");
	li.className = "item stonetop-item";
	li.dataset.itemId = item.id;
	const name = doc.createElement("strong");
	name.className = "stonetop-item-name";
	name.textContent = item.name;
	const rollable = doc.createElement("span");
	rollable.className = "rollable move-rollable";
	rollable.dataset.roll = stat;
	li.append(name, rollable);
	return rollable;
}
