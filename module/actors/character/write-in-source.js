import { askWithButtons } from "../../utils/ask-with-buttons.js";
import { format, localize } from "../../utils/i18n.js";
import { escHtml } from "../../utils/strings.js";

/**
 * WHERE A WRITTEN-IN ITEM CAME FROM, asked when one is marked in the field.
 *
 * A write-in on the Inventory insert is one of two things, and the book treats them differently:
 *
 *   · Something you had all along: Have What You Need turns an undefined mark into "any common,
 *     mundane item ... something you could have had with you all along" (Book I p.78, p.88; the
 *     chalk in the book's own example). The mark MOVES, so the load stays the same.
 *   · Something new: "If you acquire a new small item on an expedition, add it to your Inventory in
 *     one of the blanks" (p.88; the makerglass shard). Nothing comes out of the undefined marks,
 *     and a ◆ item adds to the load (p.326, "Loot, load, and inventory").
 *
 * The sheet can't tell them apart from the tick, so it asks, and only while there is an undefined
 * mark the first answer could use: with none left, Have What You Need has nothing to move and the
 * item can only be new.
 */
export const WRITE_IN_SOURCE = Object.freeze({
	HAD:   "had",
	FOUND: "found",
});

/**
 * Ask which it was. Resolves to WRITE_IN_SOURCE.HAD, WRITE_IN_SOURCE.FOUND, or null when the window
 * was closed without an answer (the item stays unmarked).
 *
 * @param {object} o
 * @param {string}  o.name    the item, as the row names it
 * @param {boolean} o.small   a small item (□) rather than a ◆ one
 * @param {number}  o.weight  its ◆ (ignored for a small item)
 * @param {number}  o.pool    the undefined marks left in the matching pool
 * @returns {Promise<string|null>}
 */
export function askWriteInSource({ name, small = false, weight = 1, pool = 0 }) {
	const key = k => `stonetop.inventory.writeInSource.${k}`;
	const cost = Math.min(Math.max(0, weight), pool);
	const had = small
		? format(key("hadSmall"), { pool })
		: cost < weight
			? format(key("hadRegularPartly"), { pool, rest: weight - cost })
			: format(key("hadRegularCovered"), { cost, pool });
	const found = small ? localize(key("foundSmall")) : format(key("foundRegular"), { weight });
	const content = format(key("intro"), { name: escHtml(name || "this") })
		+ `<ul>${had}${found}</ul>`
		+ localize(key("closeNote"));
	return askWithButtons({
		title: localize(key("title")),
		content,
		buttons: [
			{ key: WRITE_IN_SOURCE.HAD,   label: localize(key("had")),   icon: "fa-box-open",    value: WRITE_IN_SOURCE.HAD },
			{ key: WRITE_IN_SOURCE.FOUND, label: localize(key("found")), icon: "fa-hand-holding", value: WRITE_IN_SOURCE.FOUND },
		],
	});
}
