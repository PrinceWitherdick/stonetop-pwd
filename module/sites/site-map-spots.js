// Where one of the GM's own sites sits on the books' regional maps.
//
// WHY THIS IS A FLAG AND NOT A FIELD. Everything else a site knows about itself lives in
// `system`, shaped by `shapeSiteSystem` — and that shaper REPLACES the whole object every time
// the Create-a-Site walkthrough saves. A spot stored in there would be collected once, written
// once, and then silently dropped the first time the GM reopened the wizard to add an area. The
// spot is also not the wizard's business: it is not one of Book I's four phases, it is a mark
// the GM makes on a map long after the write-up is done, and it is set and cleared from an
// entirely different screen. So it rides beside the data rather than in it.
//
// WHAT IS STORED IS A FRACTION OF THE PRINTED CROP, never a pixel and never a percentage of the
// file. See `percentSpot` in data/travel-times.js: the poster scan and the two PDF renders are
// different crops of one drawing, so a spot recorded against whichever copy a world has today
// would walk across the map the day that world imports a sharper one. Recording the canonical
// fraction is what makes a site's pin land in the same valley on every copy of the map, which
// is exactly the contract the book's own eighteen places are held to.
//
// GM PREP, ON GM PREP. A site is never shared with players (see site-store.js), so nothing here
// has a visibility story to tell: the only surface that draws these pins is gated on `isGM`.
import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { listSitePages } from "./site-store.js";

/** The flag key one site's map spot is filed under, within the system's own scope. */
export const SITE_MAP_SPOT_FLAG = "mapSpot";

/**
 * A stored spot, normalized, or null when there is nothing usable there.
 *
 * PURE, so the round-trip through `spotPercent`/`percentSpot` can be checked without a document.
 * A spot is only a spot with all three of its parts: a tier naming which map it is on, and a
 * pair of fractions INSIDE that map. A fraction outside 0..1 is a pin off the edge of the paper,
 * which is not a placement anybody made and would draw at a negative percentage in the corner of
 * whichever surface rendered it.
 */
export function readMapSpot(raw) {
	const tier = String(raw?.tier ?? "").trim();
	const fx = Number(raw?.fx);
	const fy = Number(raw?.fy);
	if (!tier || !Number.isFinite(fx) || !Number.isFinite(fy)) return null;
	if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
	return { tier, fx, fy };
}

/**
 * The spot recorded on one site page, or null.
 *
 * Read through `getFlag` where the document has one and off the raw bag where it does not, which
 * is the same pair StonetopFlags uses: the tests build page stand-ins, and a reader that insisted
 * on the document API would answer null for every one of them.
 */
export function siteMapSpot(page) {
	if (!page) return null;
	const raw = page.getFlag?.(STONETOP_SCOPE, SITE_MAP_SPOT_FLAG)
		?? page.flags?.[STONETOP_SCOPE]?.[SITE_MAP_SPOT_FLAG];
	return readMapSpot(raw);
}

/**
 * Put a site on a map, or move the one already there.
 *
 * Normalized on the way IN as well as on the way out, so a caller that has done its arithmetic
 * wrong writes nothing rather than writing a pin nobody can see and nothing will clear.
 */
export async function setSiteMapSpot(page, spot) {
	const clean = readMapSpot(spot);
	if (!page || !clean) return null;
	await page.setFlag(STONETOP_SCOPE, SITE_MAP_SPOT_FLAG, clean);
	return clean;
}

/**
 * Take a site back off the map.
 *
 * The site itself is untouched: this is a pin being lifted, not prep being deleted, and the two
 * are reached from different places on purpose (deleting is `deleteGmPrepPage`, from the tab that
 * owns the write-up).
 */
export async function clearSiteMapSpot(page) {
	if (!page) return;
	await page.unsetFlag(STONETOP_SCOPE, SITE_MAP_SPOT_FLAG);
}

/**
 * Every site this steading has dropped on one map tier, as `{ page, spot }`.
 *
 * In the Sites tab's own order, which is the order the GM arranged their prep in — so two pins
 * that land on the same speck stack the same way here as their cards do over there.
 */
export function sitesOnMap(steading, tier) {
	if (!steading || !tier) return [];
	return listSitePages(steading)
		.map(page => ({ page, spot: siteMapSpot(page) }))
		.filter(({ spot }) => spot?.tier === tier);
}

/**
 * Which map a site is on, for a picker row that has to say so, or "" for one on no map at all.
 *
 * Its own function because the picker asks it of every site it lists, and a caller that reached
 * for `siteMapSpot(...)?.tier` would be spelling out the null case at each call.
 */
export function siteMapTier(page) {
	return siteMapSpot(page)?.tier ?? "";
}
