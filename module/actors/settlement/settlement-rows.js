// The lists on a settlement sheet, and the columns of each: the one statement of a row's shape.
//
// The data model builds each list's schema from it (data-models/SettlementModel.js), the sheet adds
// a blank row from it (StonetopSettlementSheet.js), and a stat block is copied in through it
// (settlement-actor.js#settlementSystemFrom); so a new column is one line here. Pure, with no
// Foundry in it, so the code that fills a settlement in can be tested without the model.
//
// Each value is the column's blank: a string column is text, a boolean column a tick. The row's
// `id` is not listed: the model mints one for every row (ArrayFields are written whole, so the
// sheet addresses rows by id, never by index).

export const SETTLEMENT_LISTS = Object.freeze({
	// A Resources or Defenses entry: the book's name, its parenthetical, and Book I's "lacking" tick.
	resources:      Object.freeze({ name: "", detail: "", lacking: false }),
	fortifications: Object.freeze({ name: "", detail: "", lacking: false }),
	// `slug` is a roster slug (data/settlements.js) when the partner is one, so its name opens that
	// partner's sheet. Blank for anyone else.
	tradeWith:      Object.freeze({ partner: "", goods: "", slug: "" }),
	// The People section's factions, with the book's headcounts ("~40").
	groups:         Object.freeze({ name: "", count: "", notes: "" }),
	// Who runs things, with their Instinct when the book gives one. `uuid` links an NPC actor once
	// the GM has made or dropped one; the row keeps its own name either way.
	leaders:        Object.freeze({ name: "", role: "", instinct: "", uuid: "" }),
});

/** Is `list` one of the settlement's lists? */
export function isSettlementList(list) {
	return Object.hasOwn(SETTLEMENT_LISTS, list);
}

/**
 * A row for `list` with `from`'s values for the columns it shares, every other column blank. A
 * stat block's row carries no tick and no link, so those start blank.
 */
export function settlementRow(list, from = {}) {
	return Object.fromEntries(Object.entries(SETTLEMENT_LISTS[list]).map(([column, blank]) => [column, from?.[column] ?? blank]));
}
