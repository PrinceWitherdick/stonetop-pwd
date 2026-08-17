// CRUD for sites. Deliberately the same architecture as threats and hazards (see
// threat-store.js for the full rationale): every site is a `site` page of ONE hidden
// JournalEntry named "<Steading> Sites", pointed at by the steading flag
// `steading.sitesEntryId`. Sites are pure GM prep, never shared with players, so the
// entry stays NONE-owned and a single many-page journal leaks nothing.
//
// The entry/list/create/rename CRUD is shared with threats and hazards through
// makeGmPrepPageStore; the delete helper in threat-store (page + its scene pins, dropping
// an emptied journal) is page-shape generic, so sites reuse it directly.
import { makeGmPrepPageStore } from "../journal/gm-prep-page-store.js";
import { SITE_PAIR_LISTS, cleanLines, keyedRows, shapePairList } from "./site-schema.js";

/** Normalize a creator/editor payload into the site page's system data. */
export function shapeSiteSystem(seed = {}) {
	return {
		description: String(seed.description ?? ""),
		why: String(seed.why ?? "").trim(),
		manner: String(seed.manner ?? ""),
		mannerLabel: String(seed.mannerLabel ?? ""),
		// A pick with no result is nothing at all, so those rows go (unlike a question,
		// which is worth keeping unanswered). Not a wizard list — the manner's tables write it —
		// so it is the one keyed list named here rather than read off the schema.
		picks: keyedRows(seed.picks, ["key", "label", "value"]).filter(p => p.value),
		regionId: String(seed.regionId ?? ""),
		regionLabel: String(seed.regionLabel ?? ""),
		terrain: String(seed.terrain ?? "").trim(),
		connections: cleanLines(seed.connections),
		dangers: cleanLines(seed.dangers),
		discoveries: cleanLines(seed.discoveries),
		outside: cleanLines(seed.outside),
		inside: cleanLines(seed.inside),
		// Every paired list, shaped from the schema rather than named one by one. This is the
		// SAVE half of the round-trip the wizard's seeding is the read half of: a list added to
		// the schema and missed here used to be collected on screen and then written nowhere,
		// which loses the GM's typing outright rather than merely on re-open.
		...Object.fromEntries(Object.keys(SITE_PAIR_LISTS).map(list => [list, shapePairList(list, seed[list])])),
		plans: cleanLines(seed.plans),
		// A table with a caption but no rows is still worth keeping (it's a note to fill in);
		// one with neither is not.
		randomTables: (Array.isArray(seed.randomTables) ? seed.randomTables : [])
			.map(t => ({ caption: String(t?.caption ?? "").trim(), rows: cleanLines(t?.rows) }))
			.filter(t => t.caption || t.rows.length),
	};
}

const _store = makeGmPrepPageStore({
	pageType: "site",
	entryFlag: "site",
	entryFlagId: "sitesEntryId",
	entrySuffix: "Sites",
	defaultName: "New Site",
	shapeSystem: shapeSiteSystem,
});

/** The id of the steading's Sites journal, if one has been created. */
export const sitesEntryId = _store.entryId;
/** Resolve the steading's Sites journal, or null. Never creates. */
export const getSitesEntry = _store.getEntry;
/** Resolve a `site` page from an entry/page id pair (as a scene Note links it), or null. */
export const sitePageById = _store.pageById;
/** The steading's site pages, in order. */
export const listSitePages = _store.listPages;
/** Resolve the steading's Sites journal, creating it (GM-only) on first use. */
export const ensureSitesEntry = _store.ensureEntry;
/** Create a new site as a page on the steading's Sites journal. */
export const createSite = _store.create;
/** Rename a site everywhere its name is its identity: the page and its scene pins. */
export const setSiteName = _store.setName;

// No `deleteSite`. Deleting carries no site-specific logic — it removes a page, its scene pins
// and an emptied journal — so it is `deleteGmPrepPage` in gm-prep-page-store.js, which is where
// callers reach it. An alias here would be a second name for one behaviour, offered from the one
// module a caller with a site in hand would find first.
