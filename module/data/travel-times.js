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
 * A poster map this system knows label positions for WITHOUT it being a travel tier.
 *
 * The village map is the only one. Nothing about it belongs in TRAVEL_MAPS: you do not chart a
 * course to your own steading, and none of what it letters is a node with legs attached. But it is
 * the same picture printed twice, labelled in the book and bare on the poster, so it has the same
 * missing names to put back, and everything that puts them back should be one piece of code.
 *
 * `printedAspect` is here for the same reason it is on a tier, and it is the POSTER's own
 * proportions rather than a printed page's, because the village's fractions are measured against
 * the poster (see MAP_CAPTIONS). That still checks the thing worth checking: that the Scene a GM
 * has is the shape these numbers were measured against, rather than a scan of their own trimmed
 * some other way, in which case no pins beat a mapful in the wrong places.
 */
export const CAPTION_MAPS = Object.freeze({
	"stonetop-village": Object.freeze({ slug: "stonetop-village", printedAspect: 2100 / 1650 }),
});

/**
 * One map this system has label positions for, tier or not. The single gate on "does this poster
 * get markers", so every pass that lays a pin agrees about which posters have any.
 *
 * It gates on the map being DECLARED here, though, not on captions existing for it. A MAP_CAPTIONS
 * row naming a poster that is neither a travel tier nor a CAPTION_MAPS entry is ignored, because
 * what this returns is the aspect posterMapPins checks the Scene against, and a map whose shape
 * nothing declares cannot be checked. Giving a new poster captions means declaring it here too.
 */
export function markedMap(slug) {
	return travelMap(slug) ?? CAPTION_MAPS[slug] ?? null;
}

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
 * `spots` maps a TRAVEL_MAPS slug to where the place sits on that map, as a fraction of the printed
 * crop. Those numbers are not eyeballed: the regional maps' labels are live text in the PDF, so
 * every centre was read out of the page and normalised against the crop rectangle the art
 * toolchain already records for that render (vicinity [104,97,688,519], world's end
 * [104,68,690,547] in points on the 792x612 spread). A place with no spot on a map simply is not
 * drawn there; a place with no spots at all lives past the map's edge (`beyond`).
 *
 * A SPOT MARKED `anchor` IS A POSITION WITHOUT A PIN, and it exists because those two things were
 * never the same question. The Vicinity letters six places the World's End does not — the
 * Crossroads, the Maw, the Red Grove, the cave bears' den, the Ruined Tower and the Foothills —
 * so a trip to one of them had no line at all on the outer map: `routePath` (utils/route-path.js) will not bridge a
 * missing END, and one of the ends was missing. But "the World's End does not LETTER the Red
 * Grove" and "the Red Grove is nowhere on the World's End" are different claims, and only the
 * first is true. The country is drawn; the cartographer just had no room for the name.
 *
 * So an anchor records where the place stands and says nothing else. `placesOnMap` leaves it out,
 * which keeps it off the hotspot layer and out of the poster-map pins, so the outer map gains no
 * clutter and the GM's Scene gains no Notes. The route line and `drawnOn` read `spots` directly
 * and so pick it up, which is the whole of what it is for: the way to the Red Grove now draws on
 * the World's End as the short leg it really is, instead of vanishing.
 *
 * WHERE THE SIX NUMBERS CAME FROM, since they are the only ones here nobody read off a page. They
 * are one similarity transform of the Vicinity's own spots, fitted on the two things both maps
 * show: Stonetop, which is measured on each, and the Crossroads, which is not lettered on the
 * World's End but is DRAWN on it — it is the junction where the Highway coming down from Barrier
 * Pass meets the West Road running out to Gordin's Delve, and a crossing of two roads is a point
 * whether or not anyone captioned it. Rotation is held at zero because both maps are north-up.
 * The fit was then checked against things it was not fitted to: the Vicinity's "The Highway" and
 * "The West Road" captions land on those same two roads on the World's End, the Foothills onto
 * hill hatching, the Maw and the Red Grove into the Great Wood.
 *
 * Read them as good to about a percent of the map near Stonetop and worse toward the edges of the
 * Vicinity's footprint, which is a hundredth of the country the outer map draws and far inside
 * what a line between two of them is claiming. They are NOT a measurement, and they are not
 * `placed` either: nothing compares them against a pin, because they never become one.
 *
 * A FEW ARE THE FEATURE RATHER THAN THE LABEL, and the difference is worth knowing about. What the
 * text layer gives back is where the printed WORDS were set, which is not always over the thing
 * they name: a cartographer moves a caption off a crowded ridge or leans it into open paper, and
 * the reader's eye follows the line back. A pin has no line back. So where the printed label sits
 * somewhere that would put the mark on nothing, the spot is nudged onto the feature itself and
 * marked below. That moves the Run an Expedition walkthrough's hotspot with it, which is the
 * point: one number, and it should be on the place.
 *
 * THOSE ARE FLAGGED `placed` AND CARRY A FOURTH DECIMAL, and the extra digit is doing a job rather
 * than pretending to precision. A measured spot is worth three: it comes from a label's centre on
 * a scanned page and the last digit is already inside the disagreement between the two printings.
 * A placed one is worth as many as it takes to land back on the pixel it was placed on, because
 * the poster-map pass compares the two. At three decimals the round trip misses by a pixel or two,
 * the pin reads as one somebody has since dragged away from the table, and every later change to
 * that place is refused on its behalf. A fourth decimal is a twentieth of a pixel here, so the
 * trip is exact and the pin stays part of the design.
 *
 * The flag says so rather than the digit count implying it, because a placed value can land on a
 * three-decimal boundary by luck (`to-the-old-wall-nw` is exactly 0.116), and a guard that infers
 * "placed" from the digits would quietly stop checking the one spot that got there by accident.
 *
 * `mapLabel` is the place's name as a LABEL PRINTED ON THE MAP, which is a different job from
 * `name` and needs a different string. `name` is the travel table's own wording, and it is that
 * because the GM is reading it off a move ("it'll take at least 4 days to reach the cave bears'
 * den") — a mid-sentence phrase, article and all, in the case the sentence puts it in. A label
 * standing on its own over a drawing of a forest is not in any sentence, and "the cave bears'
 * den" set in the middle of one reads like a caption that lost its verb.
 *
 * So the label is the wording the map ITSELF prints wherever the map prints one, taken off the GM
 * playbook's labelled render of the same artwork ("CAVE BEARS", "RED GROVE", "STEPLANDS"), and the
 * gazetteer entry's own name where it does not. That rule is worth more than it looks: the poster
 * scans these pins are laid on are the UNLABELLED printing of exactly this artwork, so a table
 * that owns both is looking at one map with the names put back, not at a second cartographer's
 * opinion of what the places are called. Only places with a `spots` entry carry one.
 *
 * `marker` overrides the DRAWING a place's pin wears, and is set only where the default would be
 * wrong. The default is the teardrop, which is the right mark for a settlement or a ruin: it
 * asserts a point, and that is what those are. Tor's Fist and Barrier Pass are points too, but
 * they are points made of mountain, standing on the same ranges the map letters names across, so
 * they take the same terrain symbol those ranges do. Nothing else about them moves: the position,
 * the label and above all the pin's identity are still the place's, which is what lets the drawing
 * change under a pin a table already has on their map.
 *
 * `journalId` is the gazetteer entry in the merged `stonetop-journal` pack, so a destination can
 * open the book's own write-up. Mostly taken from the @UUID links already on the Setting Overview
 * "Travel Times" page, and pinned against the locations pack by the test.
 *
 * Three of them are not that. The cave bears' den points at the CREATURE rather than a place. The
 * Crossroads borrows The Makers' Roads, which is where the books describe it and is the road it is
 * the crossing of. And Tor's Fist points at nothing at all, because nothing in the gazetteer
 * describes it: a pin that opens the wrong entry is worse than one that opens none.
 */
export const TRAVEL_PLACES = Object.freeze([
	Object.freeze({
		slug: "stonetop", name: "Stonetop", home: true, journalId: "6yScslDfqrcCQ6CJ",
		mapLabel: "Stonetop",
		spots: Object.freeze({ vicinity: { fx: 0.708, fy: 0.5202, placed: true }, "worlds-end": { fx: 0.3178, fy: 0.3242, placed: true } }),
	}),
	Object.freeze({
		// It BORROWS the road's entry, which is the one that describes it: The Makers' Roads carries
		// a section headed "The Crossroads", the West Road's crossing of the Highway. A crossing has
		// no write-up apart from the roads it is a crossing of.
		slug: "the-crossroads", name: "the Crossroads", journalId: "ezquwGFbne6uxzJK",
		mapLabel: "The Crossroads",
		spots: Object.freeze({ vicinity: { fx: 0.5677, fy: 0.6415, placed: true }, "worlds-end": { fx: 0.2822, fy: 0.3514, anchor: true } }),
	}),
	Object.freeze({
		slug: "the-maw", name: "the Maw", journalId: "vwP9YSr3qrc4Tq7k",
		mapLabel: "The Maw",
		spots: Object.freeze({ vicinity: { fx: 0.723, fy: 0.380 }, "worlds-end": { fx: 0.3216, fy: 0.2928, anchor: true } }),
	}),
	Object.freeze({
		slug: "the-red-grove", name: "the Red Grove", journalId: "o7qpevFfrKXuVlGo",
		mapLabel: "Red Grove",
		spots: Object.freeze({ vicinity: { fx: 0.894, fy: 0.573 }, "worlds-end": { fx: 0.365, fy: 0.336, anchor: true } }),
	}),
	Object.freeze({
		slug: "cave-bears-den", name: "the cave bears' den", journalId: "VJf1tzQZ3nGxBNsC",
		mapLabel: "Cave Bears",
		spots: Object.freeze({ vicinity: { fx: 0.785, fy: 0.769 }, "worlds-end": { fx: 0.3373, fy: 0.38, anchor: true } }),
	}),
	Object.freeze({
		slug: "the-ruined-tower", name: "the Ruined Tower", journalId: "iYSktNtms4NQat8F",
		mapLabel: "The Ruined Tower",
		spots: Object.freeze({ vicinity: { fx: 0.4603, fy: 0.8659, placed: true }, "worlds-end": { fx: 0.255, fy: 0.4017, anchor: true } }),
	}),
	Object.freeze({
		slug: "the-foothills", name: "the Foothills", journalId: "61j2hjMjANZcniEQ",
		mapLabel: "The Foothills",
		spots: Object.freeze({ vicinity: { fx: 0.2332, fy: 0.2174, placed: true }, "worlds-end": { fx: 0.1974, fy: 0.2563, anchor: true } }),
	}),
	Object.freeze({
		slug: "titan-bones", name: "Titan Bones", journalId: "fc9yqAlxCCgZVckC",
		mapLabel: "Titan Bones",
		spots: Object.freeze({ "worlds-end": { fx: 0.298, fy: 0.421 } }),
	}),
	Object.freeze({
		slug: "gordins-delve", name: "Gordin's Delve", journalId: "HesP5wBhjA0l9Ffk",
		mapLabel: "Gordin's Delve",
		spots: Object.freeze({ "worlds-end": { fx: 0.077, fy: 0.332 } }),
	}),
	Object.freeze({
		// The table names this node twice: as a destination ("the Steplands") and as the origin of
		// its own block ("From the north edge of the Steplands to…"). One place, two wordings.
		slug: "the-steplands", name: "the Steplands", tableName: "the north edge of the Steplands",
		journalId: "No8UN1MJEb2mrLXo",
		mapLabel: "Steplands",
		spots: Object.freeze({ "worlds-end": { fx: 0.387, fy: 0.554 } }),
	}),
	Object.freeze({
		slug: "barrier-pass", name: "Barrier Pass", journalId: "VZ3YkXn70E1C7TEO",
		mapLabel: "Barrier Pass", marker: "peak",
		spots: Object.freeze({ "worlds-end": { fx: 0.1138, fy: 0.152, placed: true } }),
	}),
	Object.freeze({
		slug: "marshedge", name: "Marshedge", journalId: "uXlyry9CpXUz4ooR",
		mapLabel: "Marshedge",
		spots: Object.freeze({ "worlds-end": { fx: 0.7138, fy: 0.5936, placed: true } }),
	}),
	Object.freeze({
		slug: "blackwater-lake", name: "Blackwater Lake", journalId: "25HD51CKompWLFvB",
		mapLabel: "Blackwater Lake",
		spots: Object.freeze({ "worlds-end": { fx: 0.3199, fy: 0.6399, placed: true } }),
	}),
	Object.freeze({
		// Hyphenated in the Marshedge block, unhyphenated in the Steplands block.
		slug: "three-coven-lake", name: "Three Coven Lake", tableName: "Three-Coven Lake",
		journalId: "zUeBMA1XS4Lq3KdK",
		mapLabel: "Three Coven Lake",
		spots: Object.freeze({ "worlds-end": { fx: 0.4565, fy: 0.72, placed: true } }),
	}),
	Object.freeze({
		slug: "dread-river-ruins", name: "the ruins on the Dread River", journalId: "lGNIQWIn8CPHuM7E",
		mapLabel: "The Dread River",
		spots: Object.freeze({ "worlds-end": { fx: 0.8883, fy: 0.739, placed: true } }),
	}),
	Object.freeze({
		// Placed, not measured. The printed "North Manmarch" is lettered along the map's right
		// edge, past the country it names and half over the Dread River; the spot is pulled back
		// west and south into the Manmarch proper.
		slug: "north-manmarch", name: "the northern Manmarch", journalId: "NERZ6p7FNc1pxNWL",
		mapLabel: "North Manmarch",
		spots: Object.freeze({ "worlds-end": { fx: 0.8688, fy: 0.4801, placed: true } }),
	}),
	Object.freeze({
		// Placed, not measured. The printed label floats in open parchment above the range, with
		// nothing under it: the spot is dropped onto the peak the name belongs to.
		slug: "tors-fist", name: "Tor's Fist",
		mapLabel: "Tor's Fist", marker: "peak",
		spots: Object.freeze({ "worlds-end": { fx: 0.2659, fy: 0.1264, placed: true } }),
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
 * Coordinates measured the same way as `spots`, off the arrows' own captions, and carrying the
 * same `placed` flag when one has since been put somewhere by hand instead. An arrow is the
 * likeliest of the three kinds to need it: its caption is set beside the arrowhead with room
 * for the drawing, so the words sit further off the point they mean than a place name does.
 *
 * `slug` is an identity for the arrow itself, which it needs because a map pin standing on one
 * has to be recognisable next load and `label` is display text somebody may reword. `mapLabel`
 * is that pin's caption, and it keeps the leading "To" the printed maps set in italics: on the
 * page the arrow's own shape says "onwards" and the caption only has to name the destination,
 * while a pin has no arrow, so the word is what carries the difference between "you are here"
 * and "this way out".
 */
export const TRAVEL_EXITS = Object.freeze([
	Object.freeze({ slug: "to-barrier-pass",  mapLabel: "To Barrier Pass",        map: "vicinity",   to: "worlds-end", label: "Barrier Pass",          node: "barrier-pass",  fx: 0.121, fy: 0.104 }),
	Object.freeze({ slug: "to-gordins-delve", mapLabel: "To Gordin's Delve",      map: "vicinity",   to: "worlds-end", label: "Gordin's Delve",        node: "gordins-delve", fx: 0.127, fy: 0.635 }),
	Object.freeze({ slug: "to-steplands",     mapLabel: "To Steplands & Marshedge", map: "vicinity", to: "worlds-end", label: "Steplands & Marshedge", node: null,            fx: 0.6954, fy: 0.9719, placed: true }),
	Object.freeze({ slug: "to-lygos",         mapLabel: "To Lygos & the South",   map: "worlds-end", to: BEYOND_TIER,  label: "Lygos & points south",  node: "lygos",         fx: 0.852, fy: 0.965 }),
]);

/**
 * The captions that name COUNTRY rather than a destination: the regions the maps letter across
 * their hills and forests, and the roads they letter along.
 *
 * A third list beside the places and the arrows because they are a third kind of thing, and the
 * travel graph is the wrong home for them. A place is somewhere you can set out for and arrive
 * at, which is what makes it a node with legs attached; the Great Wood is somewhere you are IN
 * for four days of a journey to somewhere else, and the Highway is how you get there. Putting
 * them in TRAVEL_PLACES would mean nodes no leg ever touches, which the graph's own reachability
 * test would rightly refuse.
 *
 * WHICH RECTANGLE THE FRACTIONS ARE AGAINST DEPENDS ON THE MAP, and the village is the odd one.
 * A tier's fractions are against the PRINTED CROP, because that is the rectangle the art
 * toolchain records for the render the labels were read out of, and MAP_FRAMES then insets that
 * into the poster. No such rectangle was ever recorded for the village map, so its eight lettered
 * discs were positioned against the POSTER directly, and its captions are solved into that same
 * space to sit with them. The identity frame `frameFor` hands back for a file with no MAP_FRAMES
 * entry is exactly right for that, so the arithmetic downstream needs no special case.
 *
 * Solving it was worth writing down, and so is how the first answer went wrong. Fitting the printed
 * page to the four captions whose discs are already recorded gave a vertical relation good to 0.005
 * and a horizontal one 16 percent out, which cannot both be true of one undistorted crop: a caption
 * sits over or under its building but BESIDE it by however far the cartographer pushed it. Taking
 * the scale from the vertical fit and the horizontal offset from the median of the four brought
 * three of them within 0.004 of their captions, which looked like enough.
 *
 * IT WAS NOT, and the six placements below are what proved it. Every caption laid down from that
 * fit had to be dragged outward, all four roads toward the ends they name. Refitting against where
 * they ended up gives a transform whose two axes agree on scale to 1.3 percent, where the original
 * disagreed by 16, and which predicts all four signposts to within 0.0075 of the poster. So the
 * first fit was wrong in the way a two-anchor solve usually is: the anchors were not measuring what
 * they were assumed to measure. What the refit is good for is the captions nobody has placed yet,
 * which is where The Ringwall's and The Fields' spots came from. Both have since been seen on the
 * map, and they disagree about it usefully: the wall was left exactly where the refit put it, the
 * fields were moved 0.019 down. So treat a refit spot as a good first guess to be looked at, not
 * as a measurement.
 *
 * The wood and the stream are deliberately NOT on their captions and were kept out of that refit:
 * the printed "The Stream" is arced up the bank well above the ford, and the pin belongs on the
 * water. Their being outliers against the transform is the transform working.
 *
 * They carry no `spots` map, and are keyed by `slug` AND `map` instead. The Great Wood and the
 * Flats are both lettered on both tiers, and they are not one caption drawn twice: the Vicinity
 * shows a few days' walk of wood while the World's End shows the whole of it, so the two are in
 * different places, at different sizes, saying different things about how much of it there is.
 * Two rows is the honest shape for that. The pin key that comes out carries no tier, which is
 * safe because keys are only ever compared within one Scene, exactly as Stonetop's is on the two
 * maps that both draw it.
 *
 * Coordinates measured exactly as the places' were, off the same page's text layer and against
 * the same crop rectangle, and checked against the spots already recorded from that page rather
 * than trusted: the Vicinity's four reproduce their page's seven to within 0.016 of the map, and
 * the World's End's two reproduce its ten to within 0.006. Huffel Peaks has since been placed by
 * hand instead, for the reason set out over `spots` in TRAVEL_PLACES: an arced caption's centre is
 * where the WORDS were set, and on a long shallow arc that can be well off the ridge itself.
 *
 * BOTH of those agreements have since been overtaken, and by the same thing: most of what they
 * were measured against has been placed by hand. Three of the Vicinity's four captions and four
 * of the seven places they were checked against; three of the World's End's six captions and
 * eight of the eleven places on it. So read the 0.016 and the 0.006 as what the measurement was worth on the day rather than
 * as standing claims about these maps. They stay written down because that check is still the one
 * to redo if these numbers are ever remeasured.
 *
 * What the moves are worth knowing for is their SIZE. The Vicinity's five ran 104 to 264 pixels
 * on a 6000-wide Scene, which is 1.7 to 4.4 percent, the 0.016 the measurement reported and no
 * worse. The World's End's are mostly smaller still, apart from the Dread River at 350. And more
 * than half of them are places rather than captions, so this is not the arced-caption problem
 * above; it is measurements landing where measurements of that quality land.
 *
 * `kind` is the DRAWING, and a caption with none is lettered onto the map bare. Bare is still what
 * a caption gets for asking for nothing, it is what every row below started as, and NOTHING uses
 * it any more: all seventeen have since been given a drawing, a tier at a time, as each map came
 * up at the table.
 *
 * That is worth writing down rather than tidying away, because the argument for bare is a good one
 * and it lost anyway. It says a pin asserts a point and little of what these maps letter is at
 * one, which is true: a teardrop on the Great Wood says "here" about four days of country, and
 * there is no point in it that is true of. What beat it is that a bare name on a map covered in
 * marks does not read as "this is a region". It reads as a pin that failed to draw. The default
 * stays bare so a caption added tomorrow gets nothing until somebody decides what it is, but
 * expect to decide.
 *
 * The mountain ranges, on what the mark CLAIMS rather than on how big the thing is: a terrain
 * symbol says "mountains", which is true of the Whitefang Mountains along the whole arc their name
 * is lettered on, where a teardrop would say "here", which is true nowhere on it. The Great Wood
 * would take a symbol on the same terms and wears a teardrop instead, which is the argument
 * conceded rather than answered: nobody has drawn a wood symbol, and a wood is not different in
 * kind from a range. Draw one and it should have it.
 *
 * And South Manmarch, which takes the plain teardrop, on a different argument entirely: WHAT ITS
 * NEIGHBOUR SAYS. The Manmarch is one country the map splits in two, and the northern half is a
 * travel destination, so it is a TRAVEL_PLACES row wearing a pin. Leaving the southern half bare
 * would have the map draw the two halves of one march differently, which reads as a claim about
 * the ground and is really a fact about which of them the book's travel table happens to price. A
 * map that says that is less true than one teardrop sitting on country.
 *
 * And then all three tiers in turn, which is South Manmarch's argument run over whole maps rather
 * than one caption: the village first, then the Vicinity, then the World's End's own three, each
 * asked for once the map had been looked at with the others already pinned. Set out on the blocks
 * below, next to the neighbours they turn on.
 *
 * `journalId` where the gazetteer writes the place up, which all of these now carry. The two
 * roads were the last to get one and they SHARE it: The Makers' Roads is one entry covering the
 * Highway and the West Road together, because the books describe them together, as one work of
 * the Makers that the second road is a branch of. It is the same entry the village map's "To the
 * Crossroads" signpost opens, one tier in, which is the crossing of these two.
 */
export const MAP_CAPTIONS = Object.freeze([
	// The Vicinity, in reading order down the page, all four wearing the plain teardrop. That is
	// South Manmarch's argument run over a tier: the seven travel places lettered on this same
	// map all have a pin, so four bare captions among them draw the wood and the roads as a
	// lesser sort of thing than what surrounds them, when the only difference is which of them
	// the travel table happens to price. The roads take the teardrop and not the signpost, which
	// is the one glyph here that means a road: the signpost means the way OUT toward somewhere
	// off the page, and these two are the roads themselves, drawn end to end on the map they are
	// lettered on.
	Object.freeze({ slug: "the-great-wood", mapLabel: "The Great Wood", map: "vicinity", kind: "place", fx: 0.757, fy: 0.299, journalId: "6kt1b8ozEREDCi4k" }),
	Object.freeze({ slug: "the-highway",    mapLabel: "The Highway",    map: "vicinity", kind: "place", fx: 0.3567, fy: 0.5482, placed: true, journalId: "ezquwGFbne6uxzJK" }),
	Object.freeze({ slug: "the-west-road",  mapLabel: "The West Road",  map: "vicinity", kind: "place", fx: 0.2929, fy: 0.6164, placed: true, journalId: "ezquwGFbne6uxzJK" }),
	Object.freeze({ slug: "the-flats",      mapLabel: "The Flats",      map: "vicinity", kind: "place", fx: 0.1995, fy: 0.8696, placed: true, journalId: "nBvsH19B1bG2d4Di" }),
	// And the World's End, in reading order down the page. Whitefang Mountains keeps the map's own
	// wording rather than the gazetteer's "The Whitefang Mountains", which is the same rule every
	// mapLabel above follows: the poster is the unlabelled printing of this exact artwork, so what
	// goes back on it is what the labelled printing set, article and all. The two ranges wear the
	// terrain symbol and the other four a teardrop, which is this tier conceding last what the
	// other two conceded first: see `kind` above for the argument and how it went.
	Object.freeze({ slug: "whitefang-mountains", mapLabel: "Whitefang Mountains", map: "worlds-end", kind: "peak", fx: 0.555, fy: 0.111, journalId: "5vFbBIn18TKtCF91" }),
	Object.freeze({ slug: "the-great-wood",      mapLabel: "The Great Wood",      map: "worlds-end", kind: "place", fx: 0.572, fy: 0.334, journalId: "6kt1b8ozEREDCi4k" }),
	Object.freeze({ slug: "the-flats",           mapLabel: "The Flats",           map: "worlds-end", kind: "place", fx: 0.267, fy: 0.473, journalId: "nBvsH19B1bG2d4Di" }),
	Object.freeze({ slug: "ferriers-fen",        mapLabel: "Ferrier's Fen",       map: "worlds-end", kind: "place", fx: 0.6397, fy: 0.5311, placed: true, journalId: "UstvXnD6EA9IBBO3" }),
	Object.freeze({ slug: "huffel-peaks",        mapLabel: "Huffel Peaks",        map: "worlds-end", kind: "peak", fx: 0.0954, fy: 0.5426, placed: true, journalId: "RxUdCkI2lL6gE5IH" }),
	// Placed, not measured, and the one caption wearing a teardrop. See `kind` above: it is drawn
	// to match the northern half, which is a travel destination and has always had one.
	Object.freeze({ slug: "south-manmarch",      mapLabel: "South Manmarch",      map: "worlds-end", kind: "place", fx: 0.7186, fy: 0.7473, placed: true, journalId: "apczJSWiu0M5dFrF" }),

	// And the village, whose own map letters eight names its eight lettered discs do not cover: the
	// wood and the water it sits between, the fields and the wall that wraps them, and the four
	// roads out. Fractions against the POSTER here, not a printed crop; see above.
	//
	// The four roads take the signpost, which is what they are: none of them names anywhere on
	// this paper, they say the way out and where it goes. Three say the same thing because there
	// are three gates onto the Old Wall, which is why they are slugged by the compass rather than
	// by their label, exactly as the three Watchtowers discs are keyed apart.
	//
	// All four still open a write-up, and each BORROWS one, the way an edge arrow on a regional
	// map borrows the write-up of the place it names. Neither the Old Wall nor the Crossroads has
	// a gazetteer entry of its own, and neither needs one: the wall is described in The Village of
	// Stonetop, under the fields it wraps ("about a mile from the Stone itself and at the end of
	// the West Road"), and the Crossroads has a section to itself inside The Makers' Roads, which
	// is the road it is the crossing of. Pointing at those beats pointing at nothing, and beats a
	// stub entry saying what the real one already says.
	//
	// The wood and the stream take the plain pin, and the wood earns one here on its own before any
	// argument about its neighbours: the two maps are at different scales and the same words mean
	// different things on them. Across the Vicinity the Great Wood is four days of country nobody
	// is at a point in, while here it is the treeline at the bottom of the bluff, somewhere you
	// walk to in an afternoon. The Vicinity's copy has since been given a pin too, for the tier
	// reason set out on that block, so the two maps now agree by coincidence rather than because
	// this one was following that one.
	Object.freeze({ slug: "to-the-old-wall-nw", mapLabel: "To the Old Wall",   map: "stonetop-village", kind: "exit",  fx: 0.1160, fy: 0.2225, placed: true, journalId: "6yScslDfqrcCQ6CJ" }),
	// Measured rather than placed, and off a BETTER transform than the six around it started
	// from: see the note over MAP_CAPTIONS. It borrows the village's own write-up, which is
	// where the books describe the wall, the way an edge arrow borrows the write-up of the
	// place it names.
	Object.freeze({ slug: "the-ringwall",       mapLabel: "The Ringwall",      map: "stonetop-village", kind: "place", fx: 0.257,  fy: 0.265,  journalId: "6yScslDfqrcCQ6CJ" }),
	Object.freeze({ slug: "the-great-wood",     mapLabel: "The Great Wood",    map: "stonetop-village", kind: "place", fx: 0.7867, fy: 0.3216, placed: true, journalId: "6kt1b8ozEREDCi4k" }),
	Object.freeze({ slug: "to-the-crossroads",  mapLabel: "To the Crossroads", map: "stonetop-village", kind: "exit",  fx: 0.0758, fy: 0.4951, placed: true, journalId: "ezquwGFbne6uxzJK" }),
	// Solved off the refit like The Ringwall, then placed, which is the pair of them between them
	// telling you what the refit is worth: the wall was accepted where it landed and the fields
	// were dragged 0.019 of the map down, against a fit whose worst signpost sat at 0.0075. Good
	// enough to put a caption within sight of where it goes, not good enough to be left alone.
	//
	// It borrows the same entry as the wall, which is not a shrug: the village's own write-up is
	// where the books describe its fields, and describes the wall there as the thing that wraps
	// them, so the two captions are two halves of one paragraph.
	//
	// Checked as being ON the map before the solve was trusted, because this page carries prose as
	// well as artwork and "the fields" is a phrase that could as easily have been found in a column
	// beside the picture. It solved to page 312, 388, inside the box the four signposts bound.
	Object.freeze({ slug: "the-fields",         mapLabel: "The Fields",        map: "stonetop-village", kind: "place", fx: 0.3252, fy: 0.6648, placed: true, journalId: "6yScslDfqrcCQ6CJ" }),
	Object.freeze({ slug: "to-the-old-wall-sw", mapLabel: "To the Old Wall",   map: "stonetop-village", kind: "exit",  fx: 0.1017, fy: 0.6472, placed: true, journalId: "6yScslDfqrcCQ6CJ" }),
	// Placed, not measured: the printed caption is arced up the bank well above the ford, and
	// the pin belongs on the water.
	Object.freeze({ slug: "the-stream",         mapLabel: "The Stream",        map: "stonetop-village", kind: "place", fx: 0.9003, fy: 0.6566, placed: true, journalId: "KJUzuYlurcjPxHd7" }),
	Object.freeze({ slug: "to-the-old-wall-se", mapLabel: "To the Old Wall",   map: "stonetop-village", kind: "exit",  fx: 0.6382, fy: 0.7647, placed: true, journalId: "6yScslDfqrcCQ6CJ" }),
]);

/** The region and road captions one map tier letters across itself, in reading order. */
export function captionsOnMap(mapSlug) {
	return MAP_CAPTIONS.filter(c => c.map === mapSlug);
}

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

/**
 * How a place is named when it is a label standing on the map rather than a phrase in a sentence.
 * Falls back to the table's wording, which is what a place with no map to stand on has.
 */
export function placeMapLabel(place) {
	return place?.mapLabel ?? place?.name ?? "";
}

/**
 * The places one map tier DRAWS, in reading order down the page. Everything that gets a pin: the
 * walkthrough's hotspots and the poster-map Scene's Notes both come from here.
 *
 * Anchors are not among them, by design. An `anchor` spot is a position the route line may use and
 * nothing more (see `spots` above), so counting it here would put six unlettered pins in a knot on
 * top of Stonetop's own, on the map and on every GM's Scene alike.
 */
export function placesOnMap(mapSlug) {
	return TRAVEL_PLACES
		.filter(p => p.spots?.[mapSlug] && !p.spots[mapSlug].anchor)
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
