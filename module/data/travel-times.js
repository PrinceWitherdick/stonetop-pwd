// The book's travel times, as a graph you can actually walk.
//
// The free GM playbook prints a "Travel times" table — a two-column Journey/Time list, broken
// into blocks by where the journey STARTS ("From Stonetop via the Roads to…", "From Marshedge
// to…"). This system already ships that table as prose, twice: collapsed inside the Chart a
// Course move's description (packs/src/stonetop-items/expedition-moves/chart-a-course.json) and
// as the Setting Overview's "Travel Times" page. Prose is all it has ever been, so the Chart a
// Course requirement the GM ticks is still a literal blank — "It'll take at least ___ days".
//
// This module is the same nineteen rows with the blank filled in: named nodes, weighted edges,
// and — because the point is to TAP A PLACE — where each node sits on the two regional maps.
//
// WHY A GRAPH AND NOT A LOOKUP. The table is deliberately sparse. It never prints Stonetop ->
// Lygos; it prints Marshedge -> Lygos, 30 days, and leaves you to notice that Marshedge is
// itself 10 days away. That is not an omission, it is the Chart a Course requirement "You must
// first travel to ___, and from there to your destination". Composing the legs reproduces the
// book's own arithmetic everywhere it shows its work:
//
//   the Ruined Tower   3-4 h + 5-6 h  = "a long day's march"   (Book II, the Ruined Tower)
//   Three Coven Lake   4 d   + 3-4 d  via the Steplands, which beats 10 + 4 via Marshedge
//   Blackwater Lake    4 d   + 2-3 d  via the Steplands        (Book II, Blackwater Lake)
//   Tor's Fist         2 d   + 5 d    via the Foothills, which beats 5 + 6 via Barrier Pass
//   Lygos              10 d  + 30 d   = 40 days, and Book II calls the round trip
//                                       "an entire season of travel (80-90 days)"
//
// So the shortest path IS the book's answer. See module/utils/travel-route.js for the solve.
//
// PURE ON PURPOSE. No Foundry globals, so the Chronicle compiler (utils/chronicle-core.js) can
// import it to print a route into a journal, exactly as it already imports expedition-data.js.
// The times are duplicated out of the pack source because nothing at runtime can read a pack's
// source; tests/data/travel-times.test.js parses that HTML table and fails if the two ever
// drift, the same guard module/data/village-places.js lives under.

/**
 * Hours in one day's march. NOT 24 — a "day" in this table is a day spent walking, not a
 * revolution of the earth, and the book fixes the rate itself: Stonetop to the Ruined Tower is
 * 3-4 hours to the Crossroads plus 5-6 hours on, and Book II calls that "a long day's march".
 *
 * Used for exactly two things: ordering candidate routes when one mixes the table's hour rows with
 * its day rows, and rolling a leftover part-day of hours up into whole days to fill the "at least
 * ___ days" blank. Never displayed, and never used to rewrite a printed time. Both uses are
 * insensitive to the exact figure anywhere in the 8-10 band — every day-scale leg dwarfs every
 * hour-scale one — which is what licenses picking a number at all.
 */
export const MARCH_HOURS = 9;

/**
 * The two regional maps, outermost last. A tier is a picture plus the manifest row that knows
 * where to find the sharpest copy of it on disk.
 *
 * `manifestSlug` indexes `BOOK2_ART_APPLY_MANIFEST.settingOverviewMaps`, whose `prefer` chain is
 * already ordered sharpest-first (the GM playbook's 300 dpi render, then Book II's smaller crop,
 * then the poster scan). Reusing it means this screen and the Setting Overview journal always
 * show the same copy of the same map.
 */
export const TRAVEL_MAPS = Object.freeze([
	Object.freeze({
		slug: "vicinity", name: "The Vicinity", manifestSlug: "book2-vicinity",
		scale: "hours and days",
		// Width over height of the PRINTED crop every `fx`/`fy` below is measured against, taken
		// from the crop rectangle itself (584 x 422 points). See MAP_FRAMES for what it is for.
		printedAspect: 584 / 422,
	}),
	Object.freeze({
		slug: "worlds-end", name: "The World's End", manifestSlug: "book2-worlds-end",
		scale: "days",
		printedAspect: 586 / 479,
	}),
]);

/** The off-map tier: destinations the maps only point at from their edge. */
export const BEYOND_TIER = "beyond";

/**
 * Where a canonical map fraction lands inside one particular image file.
 *
 * Every `fx`/`fy` below is measured against the PRINTED PAGE crop — the framing shared by the GM
 * playbook render and Book II's, which agree to within about a percent. The poster scan is a
 * DIFFERENT crop of the same artwork (the printed maps are 1.384 and 1.223 wide-to-tall, the
 * posters both 1.273), so a fraction that is right on one is wrong on the other, and a hotspot
 * would sit in the wrong valley.
 *
 * The insets below were measured by registering the printed crop inside the poster scan
 * (normalised cross-correlation over gradient images; both peaks sharp and unimodal). A file with
 * no entry here uses the whole image, which is the correct answer for the two printed renders.
 *
 * A GM's own scan of the same poster could be trimmed differently, so this is a best effort for
 * that case — but `prefer` puts both deterministic PDF renders ahead of the poster, so a world
 * that imported from the books never relies on it.
 */
export const MAP_FRAMES = Object.freeze({
	"assets/maps/map-vicinity.webp":   Object.freeze({ x0: 0.030, y0: 0.072, x1: 0.970, y1: 0.936 }),
	"assets/maps/map-worlds-end.webp": Object.freeze({ x0: 0.060, y0: 0.038, x1: 0.930, y1: 0.941 }),
});

/** The whole image — what a file with no MAP_FRAMES entry gets. */
export const FULL_FRAME = Object.freeze({ x0: 0, y0: 0, x1: 1, y1: 1 });

/**
 * Every place the travel table names, with the map positions that make it tappable.
 *
 * `name` is the table's own wording, lowercase article and all ("the cave bears' den"), because
 * that is what the GM is reading off the move. `tableName` is only set where the table spells the
 * same place a second way, so the drift guard can match both rows.
 *
 * `spots` maps a TRAVEL_MAPS slug to the label's centre on that map, as a fraction of the printed
 * crop. Those numbers are not eyeballed: the regional maps' labels are live text in the PDF, so
 * every centre was read out of the page and normalised against the crop rectangle the art
 * toolchain already records for that render (vicinity [104,97,688,519], world's end
 * [104,68,690,547] in points on the 792x612 spread). A place with no spot on a map simply is not
 * drawn there; a place with no spots at all lives past the map's edge (`beyond`).
 *
 * `journalId` is the gazetteer entry in the merged `stonetop-journal` pack, so a destination can
 * open the book's own write-up. Taken from the @UUID links already on the Setting Overview
 * "Travel Times" page, and pinned against the locations pack by the test. The Crossroads and
 * Tor's Fist have no gazetteer entry of their own, and the cave bears' den points at the
 * creature rather than a place.
 */
export const TRAVEL_PLACES = Object.freeze([
	Object.freeze({
		slug: "stonetop", name: "Stonetop", home: true, journalId: "6yScslDfqrcCQ6CJ",
		spots: Object.freeze({ vicinity: { fx: 0.709, fy: 0.468 }, "worlds-end": { fx: 0.319, fy: 0.335 } }),
	}),
	Object.freeze({
		slug: "the-crossroads", name: "the Crossroads",
		spots: Object.freeze({ vicinity: { fx: 0.556, fy: 0.661 } }),
	}),
	Object.freeze({
		slug: "the-maw", name: "the Maw", journalId: "vwP9YSr3qrc4Tq7k",
		spots: Object.freeze({ vicinity: { fx: 0.723, fy: 0.380 } }),
	}),
	Object.freeze({
		slug: "the-red-grove", name: "the Red Grove", journalId: "o7qpevFfrKXuVlGo",
		spots: Object.freeze({ vicinity: { fx: 0.894, fy: 0.573 } }),
	}),
	Object.freeze({
		slug: "cave-bears-den", name: "the cave bears' den", journalId: "VJf1tzQZ3nGxBNsC",
		spots: Object.freeze({ vicinity: { fx: 0.785, fy: 0.769 } }),
	}),
	Object.freeze({
		slug: "the-ruined-tower", name: "the Ruined Tower", journalId: "iYSktNtms4NQat8F",
		spots: Object.freeze({ vicinity: { fx: 0.453, fy: 0.804 } }),
	}),
	Object.freeze({
		slug: "the-foothills", name: "the Foothills", journalId: "61j2hjMjANZcniEQ",
		spots: Object.freeze({ vicinity: { fx: 0.253, fy: 0.174 } }),
	}),
	Object.freeze({
		slug: "titan-bones", name: "Titan Bones", journalId: "fc9yqAlxCCgZVckC",
		spots: Object.freeze({ "worlds-end": { fx: 0.298, fy: 0.421 } }),
	}),
	Object.freeze({
		slug: "gordins-delve", name: "Gordin's Delve", journalId: "HesP5wBhjA0l9Ffk",
		spots: Object.freeze({ "worlds-end": { fx: 0.077, fy: 0.332 } }),
	}),
	Object.freeze({
		// The table names this node twice: as a destination ("the Steplands") and as the origin of
		// its own block ("From the north edge of the Steplands to…"). One place, two wordings.
		slug: "the-steplands", name: "the Steplands", tableName: "the north edge of the Steplands",
		journalId: "No8UN1MJEb2mrLXo",
		spots: Object.freeze({ "worlds-end": { fx: 0.387, fy: 0.554 } }),
	}),
	Object.freeze({
		slug: "barrier-pass", name: "Barrier Pass", journalId: "VZ3YkXn70E1C7TEO",
		spots: Object.freeze({ "worlds-end": { fx: 0.121, fy: 0.148 } }),
	}),
	Object.freeze({
		slug: "marshedge", name: "Marshedge", journalId: "uXlyry9CpXUz4ooR",
		spots: Object.freeze({ "worlds-end": { fx: 0.715, fy: 0.612 } }),
	}),
	Object.freeze({
		slug: "blackwater-lake", name: "Blackwater Lake", journalId: "25HD51CKompWLFvB",
		spots: Object.freeze({ "worlds-end": { fx: 0.320, fy: 0.669 } }),
	}),
	Object.freeze({
		// Hyphenated in the Marshedge block, unhyphenated in the Steplands block.
		slug: "three-coven-lake", name: "Three Coven Lake", tableName: "Three-Coven Lake",
		journalId: "zUeBMA1XS4Lq3KdK",
		spots: Object.freeze({ "worlds-end": { fx: 0.457, fy: 0.754 } }),
	}),
	Object.freeze({
		slug: "dread-river-ruins", name: "the ruins on the Dread River", journalId: "lGNIQWIn8CPHuM7E",
		spots: Object.freeze({ "worlds-end": { fx: 0.954, fy: 0.755 } }),
	}),
	Object.freeze({
		slug: "north-manmarch", name: "the northern Manmarch", journalId: "NERZ6p7FNc1pxNWL",
		spots: Object.freeze({ "worlds-end": { fx: 0.891, fy: 0.380 } }),
	}),
	Object.freeze({
		slug: "tors-fist", name: "Tor's Fist",
		spots: Object.freeze({ "worlds-end": { fx: 0.264, fy: 0.070 } }),
	}),
	Object.freeze({
		// Off both maps. The World's End map only points at it: "to Lygos and other points south".
		slug: "lygos", name: "Lygos", beyond: true, journalId: "DPUvs6Ss8UHXEsCJ",
		spots: Object.freeze({}),
	}),
]);

/**
 * The nineteen rows of the table, as undirected edges.
 *
 * `min`/`max` are the printed range in `unit` — "3-4 hours" is `{ min: 3, max: 4, unit: "hours" }`
 * and a flat "2 days" is `{ min: 2, max: 2 }`. Hours and days are kept as they were printed and
 * never folded into one another: a day here is a day's march, not 24 hours of walking, so
 * rewriting "5-7 hours" as a fraction of a day would invent precision the book never gave.
 *
 * `via` records the block's own wording where it names a route, which is worth keeping because it
 * is the reason a leg is as quick as it is.
 */
export const TRAVEL_LEGS = Object.freeze([
	// From Stonetop via the Roads to…
	Object.freeze({ from: "stonetop", to: "the-crossroads", min: 3,  max: 4,  unit: "hours", via: "the Roads" }),
	Object.freeze({ from: "stonetop", to: "the-foothills",  min: 2,  max: 2,  unit: "days",  via: "the Roads" }),
	Object.freeze({ from: "stonetop", to: "titan-bones",    min: 2,  max: 2,  unit: "days",  via: "the Roads" }),
	Object.freeze({ from: "stonetop", to: "gordins-delve",  min: 4,  max: 4,  unit: "days",  via: "the Roads" }),
	Object.freeze({ from: "stonetop", to: "the-steplands",  min: 4,  max: 4,  unit: "days",  via: "the Roads" }),
	Object.freeze({ from: "stonetop", to: "barrier-pass",   min: 5,  max: 5,  unit: "days",  via: "the Roads" }),
	Object.freeze({ from: "stonetop", to: "marshedge",      min: 10, max: 10, unit: "days",  via: "the Roads" }),
	// From Stonetop to…
	Object.freeze({ from: "stonetop", to: "cave-bears-den", min: 3,  max: 4,  unit: "hours" }),
	Object.freeze({ from: "stonetop", to: "the-red-grove",  min: 4,  max: 6,  unit: "hours" }),
	Object.freeze({ from: "stonetop", to: "the-maw",        min: 5,  max: 7,  unit: "hours" }),
	// From the Crossroads to…
	Object.freeze({ from: "the-crossroads", to: "the-ruined-tower", min: 5, max: 6, unit: "hours" }),
	// From the north edge of the Steplands to…
	Object.freeze({ from: "the-steplands", to: "blackwater-lake",  min: 2, max: 3, unit: "days" }),
	Object.freeze({ from: "the-steplands", to: "three-coven-lake", min: 3, max: 4, unit: "days" }),
	// From Marshedge to…
	Object.freeze({ from: "marshedge", to: "dread-river-ruins", min: 2,  max: 2,  unit: "days" }),
	Object.freeze({ from: "marshedge", to: "north-manmarch",    min: 4,  max: 4,  unit: "days" }),
	Object.freeze({ from: "marshedge", to: "three-coven-lake",  min: 4,  max: 4,  unit: "days" }),
	Object.freeze({ from: "marshedge", to: "lygos",             min: 30, max: 30, unit: "days" }),
	// To Tor's Fist from…
	Object.freeze({ from: "the-foothills", to: "tors-fist", min: 5, max: 5, unit: "days" }),
	Object.freeze({ from: "barrier-pass",  to: "tors-fist", min: 6, max: 6, unit: "days" }),
]);

/**
 * The maps' edge-of-page arrows — the captions that say "the road goes on" instead of naming
 * somewhere you have arrived.
 *
 * They do double duty, because that is what they mean. Each one moves out a tier (`to`), and the
 * three that name a single place also PICK that place (`node`), so a GM reading the Vicinity map
 * can send the party to Marshedge without hunting for the right tab first. "Steplands &
 * Marshedge" names two, so it can only zoom — guessing which one the GM meant would be worse than
 * asking. The Lygos arrow is load-bearing: Lygos is drawn on no map, and this corner of the
 * World's End is the only thing in the books that points at it.
 *
 * Coordinates measured the same way as `spots`, off the arrows' own captions.
 */
export const TRAVEL_EXITS = Object.freeze([
	Object.freeze({ map: "vicinity",   to: "worlds-end", label: "Barrier Pass",          node: "barrier-pass",  fx: 0.121, fy: 0.104 }),
	Object.freeze({ map: "vicinity",   to: "worlds-end", label: "Gordin's Delve",        node: "gordins-delve", fx: 0.127, fy: 0.635 }),
	Object.freeze({ map: "vicinity",   to: "worlds-end", label: "Steplands & Marshedge", node: null,            fx: 0.733, fy: 0.959 }),
	Object.freeze({ map: "worlds-end", to: BEYOND_TIER,  label: "Lygos & points south",  node: "lygos",         fx: 0.852, fy: 0.965 }),
]);

/** One place, or null. */
export function travelPlace(slug) {
	return TRAVEL_PLACES.find(p => p.slug === slug) ?? null;
}

/** One map tier's descriptor, by slug. The counterpart of `travelPlace` for the maps. */
export function travelMap(slug) {
	return TRAVEL_MAPS.find(m => m.slug === slug) ?? null;
}

/** Where the party starts out unless a GM says otherwise. */
export function homePlace() {
	return TRAVEL_PLACES.find(p => p.home) ?? TRAVEL_PLACES[0];
}

/** The places drawn on one map tier, in reading order down the page. */
export function placesOnMap(mapSlug) {
	return TRAVEL_PLACES
		.filter(p => p.spots?.[mapSlug])
		.sort((a, b) => a.spots[mapSlug].fy - b.spots[mapSlug].fy);
}

/** The places no map draws — reachable, but off the edge. */
export function placesBeyond() {
	return TRAVEL_PLACES.filter(p => p.beyond);
}

/** The arrows on one map tier. */
export function exitsOnMap(mapSlug) {
	return TRAVEL_EXITS.filter(e => e.map === mapSlug);
}

/**
 * Where a canonical fraction lands inside a file with `frame`, as a 0-100 percentage pair — ready
 * to drop straight into `left`/`top`, so nothing has to measure the rendered image.
 */
export function spotPercent({ fx, fy }, frame = FULL_FRAME) {
	return {
		left: (frame.x0 + fx * (frame.x1 - frame.x0)) * 100,
		top:  (frame.y0 + fy * (frame.y1 - frame.y0)) * 100,
	};
}

/** The registration recorded for one file, or the whole image when none is. */
export function frameFor(out) {
	return MAP_FRAMES[out] ?? FULL_FRAME;
}

/**
 * Does `frame` actually describe `fileAspect`?
 *
 * A frame claims "the printed page occupies this rectangle of this file", which is a checkable
 * claim: crop the stated rectangle out of an image of that shape and you must get back the printed
 * page's own proportions. So `fileAspect x frameWidth / frameHeight` should land on the tier's
 * `printedAspect`, and if it does not, the file is not the picture the frame was measured against
 * — a GM's own differently-trimmed scan saved over one of the names we know.
 *
 * One check covers both cases: for the identity frame it reduces to "is this file the printed
 * crop?", which is exactly the right question for the two PDF renders.
 */
export function frameFitsImage(frame = FULL_FRAME, fileAspect, printedAspect, tolerance = 0.04) {
	if (!(fileAspect > 0) || !(printedAspect > 0)) return true;   // nothing measured, nothing to doubt
	const implied = fileAspect * ((frame.x1 - frame.x0) / (frame.y1 - frame.y0));
	return Math.abs(implied - printedAspect) / printedAspect <= tolerance;
}
