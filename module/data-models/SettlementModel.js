// System data model for the "settlement" Actor subtype: a steading that is NOT Stonetop.
//
// Marshedge, Gordin's Delve, Barrier Pass, a Hillfolk band, a homebrew city. Book I p.508 says
// what such a sheet is for: "Other steadings have stats and details similar to Stonetop's ... Use
// those stats should the PCs end up Trading & Bartering in another steading, Mustering or
// Deploying its people, or having them Pull Together ... only track Fortunes and Surplus for
// Stonetop". So the shape is Book II's sidebar (Size and headcount, Population, Prosperity,
// Defenses, Trade with, Resources, the Defenses list) plus what its People section names.
//
// NO FORTUNES, SURPLUS OR DEBILITIES. The book allows them for a place the party calls home for a
// few seasons; the user's table never moves house (2026-10-14), so Stonetop stays the only steading
// that keeps them.
//
// REAL SCHEMA FIELDS, not flags. Stonetop's own sheet keeps nearly everything under one flag
// object for historical reasons (the PbtA module it grew out of had no data models); a new type
// has no such history, and a schema validates every write.
//
// Standing with Stonetop is deliberately NOT here. It lives on Stonetop, in
// `system.relationships[slug]`, where the Other Settlements table already reads and writes it;
// this sheet shows and edits that one copy (actors/settlement/settlement-actor.js).
//
// Array fields are written whole on every edit (an ArrayField diffs by replacement), so every
// row carries an `id` the sheet addresses it by, never its index alone. Each list's columns are
// stated once, in actors/settlement/settlement-rows.js, and its schema is built from them here.
import { valueField } from "./fields.js";
import { STEADING_SIZES } from "../utils/improvement-def.js";
import { SETTLEMENT_LISTS } from "../actors/settlement/settlement-rows.js";

const fields = foundry.data.fields;

const text = (initial = "") => new fields.StringField({ required: true, blank: true, initial, trim: false });
const rowId = () => new fields.StringField({ required: true, blank: true, initial: () => foundry.utils.randomID() });

/** One list's ArrayField: its columns (settlement-rows.js), text or a tick, behind a minted id. */
const rowList = list => new fields.ArrayField(new fields.SchemaField({
	id: rowId(),
	...Object.fromEntries(Object.entries(SETTLEMENT_LISTS[list]).map(([column, blank]) => [column,
		typeof blank === "boolean" ? new fields.BooleanField({ required: true, initial: blank }) : text(blank)])),
}), { required: false, initial: [] });

export class SettlementModel extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {
			// What kind of place, in the book's words ("Mining town", "Hillfolk band"). Free text:
			// the Size tag below is the one the rules read.
			kind:       text(),
			size:       new fields.StringField({ required: true, blank: false, initial: "village", choices: STEADING_SIZES }),
			headcount:  text(),
			region:     text(),
			government: text(),
			stats: new fields.SchemaField({
				population: valueField(0),
				prosperity: valueField(0),
				defenses:   valueField(0),
			}),
			// A template's printed range for a stat ("-1 to +1"), shown beside the number. Keyed by
			// stat; absent for a stat the book states outright.
			statRanges: new fields.ObjectField({ required: false, initial: {} }),
			// Resources, the Defenses list, Trade with, and the People section's groups and leaders.
			...Object.fromEntries(Object.keys(SETTLEMENT_LISTS).map(list => [list, rowList(list)])),
			// Where it came from: a roster slug (data/settlements.js) for a named place, a template id
			// (data/settlement-stats.js) for one made from a typical block, blank for a blank sheet.
			// A roster slug is also the key of Stonetop's standing with this place.
			sourceSlug: text(),
			// The gazetteer entry in the merged journal pack, for "Read in the gazetteer".
			journalId:  text(),
			// Book page the stats are printed on ("Book II p.274").
			sourcePage: text(),
			// What the book asks the GM to pick when making one from a template. Shown until dismissed.
			setupNote:  text(),
			notes: new fields.HTMLField({ required: true, blank: true }),
		};
	}
}
