// The way they go when the GM draws it: a run of marks laid on one map by hand, plus what the
// book's own travel table says a way like that costs.
//
// WHY THIS EXISTS. `travel-route.js` answers "how long to Lygos?" by solving the printed table,
// and its answer is always the table's own shortest path — Stonetop to Marshedge by the Roads,
// ten days, every time. That is the right answer to the question it asks and the wrong one for a
// party that means to cut north through the Flats to avoid the toll, or to swing by a ruin that
// is not on anybody's road. Chart a Course asks the players how they mean to get there; this is
// where that answer can go on the map instead of only into a text field.
//
// WHAT IS STORED IS THE MARKS, NOT THE LINE. A custom path is a tier plus an ordered run of
// points, each of which is EITHER a place the table names or a bare fraction of that map. The
// geometry — the bows, the heads, the beads — is worked out from those by utils/route-path.js,
// the same module the solved route goes through, so a hand-drawn way is drawn by the same hand as
// a solved one on all three surfaces that draw either.
//
// ONE MAP, ALWAYS. A fraction like 0.44 means "44% of the way across the Vicinity" and means
// nothing whatever on the World's End, so a drawn path belongs to the tier it was drawn on and
// says so. That is not a limitation to be worked around; it is what a hand-drawn mark IS.
//
// PURE ON PURPOSE, like the two modules either side of it: no Foundry globals, so the Chronicle
// compiler can print a hand-drawn route into a journal from the stored marks alone.

import {
	MARCH_HOURS, TRAVEL_LEGS, TRAVEL_MAPS, exitsOnMap, isFraction, roundMark, travelMap, travelPlace,
} from "../data/travel-times.js";
// Re-offered, because a reader of a hand-drawn path asks this module what its marks are stored at.
export { MARK_PRECISION } from "../data/travel-times.js";
// "Can this map draw that place?" and "which map draws them all?" are asked by the solved route
// too, and the map ordering they turn on is stated once, over there.
import { tierDraws, tierDrawingEnds } from "./route-path.js";
// Where the party sets out from, which since it may be a mark of the GM's own is the same kind of
// thing as the points below rather than a slug the table happens to know. See utils/journey-start.js.
import { normalizeStart, startEnd, startName } from "./journey-start.js";

/** The fewest priced legs a map must draw before its pace is worth calibrating from. */
const PACE_MIN_SAMPLE = 3;

/**
 * Is this a mark the printed map can actually hold?
 *
 * The very test `normalizeMark` applies on the way back IN, offered to the writers as well, so the
 * two readings of "off the paper" cannot come to be two readings.
 *
 * IT IS A REACHABLE CLICK, not a defensive nicety. A map file is a WIDER rectangle than the page
 * printed on it: `MAP_FRAMES` insets each crop by three to seven percent, and every surface that
 * takes these clicks shows the whole file, margin band and all. A click in that band is an
 * ordinary aim at the edge of a valley, and `percentSpot` answers it with a NEGATIVE fraction.
 * Left to be normalized away downstream it costs the GM the mark they meant AND the mark it
 * replaced, because a plain click moves the far end of the way rather than extending it.
 */
export const insideMap = mark => isFraction(mark?.fx) && isFraction(mark?.fy);

/**
 * Where a place is DRAWN on one tier — its pin, and never an anchor.
 *
 * An `anchor` spot is a position the route line may pass through and nothing more (see `spots` in
 * data/travel-times.js). It letters nothing, so it is not somewhere a GM can have clicked and not
 * somewhere a stop of theirs can stand.
 */
export function placeSpot(tier, slug) {
	const spot = travelPlace(slug)?.spots?.[tier] ?? null;
	return spot && !spot.anchor ? spot : null;
}

/** The edge arrow on one map that names a place, or null. Carries `fx`/`fy`, so it IS a spot. */
const arrowSpot = (tier, slug) => (slug ? exitsOnMap(tier).find(exit => exit.node === slug) ?? null : null);

/**
 * Anywhere on this map a GM can put a stop ON: a lettered place, or the edge arrow that points at
 * one past the border.
 *
 * THE ARROWS COUNT, and Lygos is why. It is drawn on no map at all, and the corner of the World's
 * End that says "To Lygos & the South" is the only thing in the books that points at it — the same
 * fallback `routePath` has always made when it places a solved route's stops. Leaving them out
 * would mean a hand-drawn way could never end anywhere the party is actually going when they leave
 * the map, which is most of the interesting journeys.
 */
export function markSpot(tier, slug) {
	return placeSpot(tier, slug) ?? arrowSpot(tier, slug);
}

/**
 * Where a stop stands when it is the ORIGIN, which is laxer by exactly one thing: anchors.
 *
 * An anchor is a position the route line may pass through and nothing a GM can click (see
 * `placeSpot`), so it is no place to put a mark. But the Crossroads' anchor on the continental map
 * exists precisely so a way leaving Stonetop leaves it in the right direction, and a journey
 * setting out from there has to start SOMEWHERE. Refusing it would leave the first leg unplaced
 * and `routePath` refusing the whole line — which is a great deal worse than a first stop drawn
 * where the table itself draws it.
 */
const originSpot = (tier, slug) => travelPlace(slug)?.spots?.[tier] ?? arrowSpot(tier, slug);

/**
 * Where the journey's START stands on one map, whichever kind of start it is, or null.
 *
 * A place is looked up exactly as it always was, anchors and edge arrows included. A mark the GM
 * put down carries its own fraction and stands there — but ONLY on its own map: the same pair of
 * numbers on the other tier is a different valley, and drawing the first leg from it would be this
 * module inventing a position nobody chose.
 */
export function startSpot(tier, start) {
	const at = normalizeStart(start);
	if (at.slug) return originSpot(tier, at.slug);
	return at.tier === tier ? { fx: at.fx, fy: at.fy } : null;
}

/**
 * One stored point read back, or null.
 *
 * Two shapes, and exactly one of them per point: `{ slug }` names a place the travel table knows,
 * and `{ fx, fy }` is a bare mark on the map. The slug form stores NO position, deliberately — the
 * place's own `spots` entry is looked up at draw time, so a correction to the table's coordinates
 * reaches a path drawn last season. That is the same choice `journeyRoute` makes about the trip as
 * a whole, and for the same reason.
 */
function normalizeMark(point, tier) {
	if (!point) return null;
	const place = travelPlace(point.slug);
	if (place) return markSpot(tier, place.slug) ? { slug: place.slug } : null;
	if (!isFraction(point.fx) || !isFraction(point.fy)) return null;
	return { fx: roundMark(point.fx), fy: roundMark(point.fy) };
}

/**
 * A stored custom path read back as something the rest of the system can trust.
 *
 * ONE definition, for the same reason `normalizeJourney` is one: the walkthrough draws from it,
 * the Scene paints from it and the Chronicle prints from it, and three readings of "is this path
 * on, and what is in it?" would come apart at the first malformed point.
 *
 * A path with no tier is not a path — every mark in it is a fraction of one particular picture —
 * so an unknown tier takes the whole thing down rather than leaving marks floating.
 */
export function normalizeCustom(custom) {
	const tier = travelMap(custom?.tier)?.slug ?? null;
	if (!tier) return { on: false, tier: null, points: [] };
	const points = (Array.isArray(custom?.points) ? custom.points : [])
		.map(point => normalizeMark(point, tier))
		.filter(Boolean);
	// THE MARKS ARE THE MODE. There is no box to tick: a way is laid out by hand exactly when there
	// are marks on the map, and it is over the moment the last of them is taken back. `on` is kept
	// as a field because three surfaces ask this question and "are there points?" is the wrong
	// sentence to write in all of them, but it is DERIVED — a stored flag from the days of the
	// checkbox is ignored rather than honoured, so an old trip whose box was unticked with its
	// marks kept now reads as the way it plainly draws.
	return { on: points.length > 0, tier, points };
}

/**
 * The whole run of stops a custom path describes, origin first.
 *
 * `spot` is the position to draw at, resolved here so nothing downstream has to know which of the
 * two shapes a stored point had. `name` is what the readout and the Chronicle call it: a place's
 * own name where it has one, else "point N" counting the marks the GM placed by hand — which is
 * the same numeral the map badges that mark with, so the line in the list and the dot on the
 * picture are visibly the same thing.
 *
 * THE ORIGIN IS NOT STORED AMONG THE POINTS. A journey starts where the trip says it starts, and
 * copying that into the marks would let the two disagree the moment a GM changed "setting out
 * from" — leaving a path that sets out from somewhere the trip no longer does. That holds all the
 * harder now the start may itself be a mark: two copies of one fraction is one of them going stale.
 *
 * AND SO THE FIRST STOP IS NEVER NUMBERED. `mark` counts the points the GM laid on the way, which
 * is what the readout's "point 2" and the numeral on the picture both read; the start wears its own
 * pin and its own name (see `startName`), so numbering it as well would make the first leg run from
 * point 1 to point 1.
 */
export function customStops(start, custom) {
	const { tier, points } = normalizeCustom(custom);
	if (!tier) return [];
	const from = normalizeStart(start);
	const stops = [{
		slug: from.slug,
		name: startName(from),
		spot: startSpot(tier, from),
		mark: null,
	}];
	let placed = 0;
	for (const point of points) {
		if (point.slug) {
			const place = travelPlace(point.slug);
			stops.push({ slug: place.slug, name: place.name, spot: markSpot(tier, place.slug), mark: null });
			continue;
		}
		placed += 1;
		stops.push({ slug: null, name: `point ${placed}`, spot: { fx: point.fx, fy: point.fy }, mark: placed });
	}
	return stops;
}

/**
 * How far apart two spots are on one tier, as a percentage of the map's width.
 *
 * IN THE PICTURE'S REAL PROPORTIONS, which is the whole of the arithmetic worth writing down: a
 * step of 1% across a map half again as wide as it is tall is a longer walk than a step of 1% down
 * it, so the vertical component is divided by the map's own aspect before the two are put
 * together. Measured in the CANONICAL fraction space of the printed crop rather than in any
 * particular file's pixels, so one distance serves the panel, the popout and the Scene alike.
 */
export function spotDistance(a, b, aspect) {
	if (!a || !b) return null;
	const ratio = Number(aspect) > 0 ? Number(aspect) : 1;
	return Math.hypot((b.fx - a.fx) * 100, ((b.fy - a.fy) * 100) / ratio);
}

/** The table's own row for a pair of places, either way round, or null. */
export function pricedLeg(from, to) {
	if (!from || !to) return null;
	return TRAVEL_LEGS.find(leg =>
		(leg.from === from && leg.to === to) || (leg.from === to && leg.to === from)) ?? null;
}

/** What one printed leg costs on the single scale everything here compares in: hours of march. */
const legHours = leg => leg.min * (leg.unit === "days" ? MARCH_HOURS : 1);

/** A percentile of an already-sorted run, interpolated between the two values it falls between. */
function quantile(sorted, q) {
	const at = (sorted.length - 1) * q;
	const low = Math.floor(at);
	const high = Math.ceil(at);
	return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

// Memoized because the inputs are frozen compile-time data, so the answer cannot change within a
// session, while the fit is a pass and a sort over every leg the map draws. Asked once per leg of
// every path drawn, on every render of the route step.
const PACE_CACHE = new Map();

/**
 * HOW LONG A DRAWN LEG TAKES, calibrated against the book rather than invented.
 *
 * A hand-drawn leg has no printed time, because the table prices journeys between places and this
 * one runs to a bend in a river. But the table has already answered the question implicitly, on
 * this very map, seventeen times over: it prints how long Stonetop to Marshedge takes AND the map
 * draws both ends, so the two together say what a day's march is worth in inches of paper. Every
 * priced leg whose ends are both drawn on a tier is one such measurement, and this is what they
 * agree on.
 *
 * NOT A SINGLE NUMBER, because they do not agree exactly and pretending otherwise would be the
 * dishonest part. The paces run from 0.85 to 3.5 hours per percent on the World's End: Marshedge
 * to the Dread River Ruins is easy going and Barrier Pass to Tor's Fist is a mountain crossing,
 * and that spread IS the difference between good country and bad. So the answer is a BAND — the
 * middle half of the table's own paces — and it comes out of the readout as "roughly 3-4 days"
 * rather than as a figure with a decimal point on it.
 *
 * THE QUARTILES RATHER THAN THE EXTREMES, because the extremes are measuring something else. The
 * Maw is five to seven hours away and a tenth of the Vicinity wide, which prices a climb down a
 * chasm as though it were a walk; Tor's Fist is over a mountain range. Both are true facts about
 * those journeys and useless as a scale, and a band drawn wide enough to hold them would say
 * nothing. Replaying the table's own legs back through the middle-half band lands the printed time
 * INSIDE it for twelve of the seventeen legs it is fitted to, and within one rounding step for
 * fourteen. The three it misses are the three that are not walks: the Maw is a climb into a chasm,
 * Barrier Pass to Tor's Fist is a mountain crossing, and Marshedge to the Dread River Ruins is
 * quick going the fit reads as slow. tests/utils/custom-route.test.js holds those counts, so a
 * change to the fit or to a measured spot has to face what it did to the book's own answers.
 *
 * ANCHORS ARE EXCLUDED, and that is the correction which makes the World's End numbers mean
 * anything at all. The Crossroads' spot on the continental map is an `anchor` — a hint about which
 * way the line should leave Stonetop, not a claim about where the Crossroads is — and it sits 4%
 * of the map from Stonetop for what the table prices at three hours. Read as a measurement that is
 * a pace twenty-eight times too slow, and there are five more like it.
 *
 * @returns {{low: number, high: number, n: number}|null} hours per percent-of-map-width, or null
 *   for a tier the table does not draw enough of for a fit to be worth anything.
 */
export function tierPace(tier) {
	if (PACE_CACHE.has(tier)) return PACE_CACHE.get(tier);
	const pace = measurePace(tier);
	PACE_CACHE.set(tier, pace);
	return pace;
}

function measurePace(tier) {
	const map = travelMap(tier);
	if (!map) return null;
	const paces = [];
	for (const leg of TRAVEL_LEGS) {
		const from = placeSpot(tier, leg.from);
		const to = placeSpot(tier, leg.to);
		if (!from || !to) continue;
		const distance = spotDistance(from, to, map.printedAspect);
		if (!(distance > 0)) continue;
		paces.push(legHours(leg) / distance);
	}
	if (paces.length < PACE_MIN_SAMPLE) return null;
	paces.sort((a, b) => a - b);
	return { low: quantile(paces, 0.25), high: quantile(paces, 0.75), n: paces.length };
}

/**
 * One drawn leg's time, in the unit it is worth printing in.
 *
 * Whole days once the slow end of the estimate reaches a day's march, whole hours below that, and
 * never zero: a leg drawn at all is a leg somebody walks, and "0 hours" is not a thing to tell a
 * GM about a line they can see on the map.
 *
 * The same shape a printed leg carries (`min`, `max`, `unit`), so a path that mixes the two adds
 * up through the very same arithmetic and needs no second kind of total.
 */
export function estimateSpan(distance, pace) {
	if (!(distance > 0) || !pace) return null;
	const low = distance * pace.low;
	const high = distance * pace.high;
	if (high >= MARCH_HOURS) {
		const min = Math.max(1, Math.round(low / MARCH_HOURS));
		return { min, max: Math.max(min, Math.round(high / MARCH_HOURS)), unit: "days" };
	}
	const min = Math.max(1, Math.round(low));
	return { min, max: Math.max(min, Math.round(high)), unit: "hours" };
}

/**
 * A custom path's marks with one appended, one moved, or the last taken back.
 *
 * PURE, and it is the whole of what the three gestures MEAN. The dialogs own the pointer events
 * and the Scene owns the paint; what a shift-click is lives here, where it can be checked without
 * either. Returns the same array when nothing would change, so a caller can skip a write.
 *
 * @param {object[]} points        the marks as stored
 * @param {object}   mark          `{ slug }` or `{ fx, fy }`; ignored when undoing
 * @param {object}   how
 * @param {boolean}  how.append    extend the path rather than moving its far end
 * @param {boolean}  how.undo      take the last mark back
 */
export function withMark(points, mark, { append = false, undo = false } = {}) {
	const run = Array.isArray(points) ? points : [];
	if (undo) return run.length ? run.slice(0, -1) : run;
	if (!mark) return run;
	// An empty path has no far end to move, so the first mark goes down however it was pressed.
	// The gesture that STARTS a way is the shift-click (the dialogs refuse a plain one on a bare
	// map, since it has nothing to move), and this is what makes that first press lay a mark
	// rather than replace the nothing that was there.
	if (append || !run.length) return [...run, mark];
	return [...run.slice(0, -1), mark];
}

/**
 * Which map a hand-drawn path should start on, given where the party is setting out from.
 *
 * The tier the reader is looking at, unless that map cannot draw the start — in which case the
 * path would begin at a stop with nowhere to stand, and `routePath` would rightly refuse to draw
 * any of it rather than silently shorten the journey. The innermost map that DOES draw the start
 * is the honest answer, and it is the same one `_activeTier` reaches for with no destination yet.
 *
 * A HAND-PLACED START ANSWERS ITS OWN MAP AND ONLY ITS OWN, which falls out of `startEnd` rather
 * than being tested here: a mark is drawn on the tier it was laid on, so both questions below can
 * name exactly one map and the way is laid out on the picture the party is standing on.
 */
export function customTierFor(start, showing) {
	const end = startEnd(start);
	if (tierDraws(showing, [end])) return showing;
	return tierDrawingEnds([end]) ?? travelMap(showing)?.slug ?? TRAVEL_MAPS[0].slug;
}

/**
 * A solved route turned into marks, which is what the first shift-click starts from.
 *
 * THE FIRST MARK SHOULD NOT EMPTY THE MAP. The way they were going is very nearly always the way
 * they are still going, plus a detour — so the honest first state of "draw it yourself" is the
 * route that was already drawn, in marks the GM can now move, extend and take back. Starting from
 * a blank map would make the commonest use of this feature (the usual road, but swinging by the
 * barrow) a job of re-clicking every stop the system had already worked out.
 *
 * ONLY THE STOPS THIS MAP CAN PLACE, and the truncation is deliberate rather than tolerated: a way
 * to Tor's Fist seeded onto the Vicinity comes back as far as the Foothills, which is exactly as
 * far as this picture can honestly draw it, and the rest is the GM's to lay in by hand.
 */
export function seedMarks(route, tier) {
	if (!route?.legs?.length || !travelMap(tier)) return [];
	return route.legs
		.map(leg => leg.to)
		.filter(slug => markSpot(tier, slug))
		.map(slug => ({ slug }));
}
