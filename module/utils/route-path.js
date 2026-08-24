// The way they go, as geometry: the run of bowed legs a solved route draws across one map, the
// heads that say which way it is walked, and the beads that make it read as a dotted line.
//
// WHY IT IS ITS OWN MODULE. This began as six methods on ExpeditionDialog, which was the right
// place for it while the walkthrough's own panel and its "See the whole map" popout were the only
// two surfaces drawing the line. They are no longer: a route can now be laid onto the GM's Scene
// of the same poster map (utils/scene-route.js), where it is painted in PIXI rather than in SVG.
// That is a THIRD renderer of one curve, and a curve computed twice is a curve that drifts. The
// panel and the Scene would come to disagree about where the way runs, on two pictures of the
// same country, in front of the same table.
//
// So the arithmetic lives here and the renderers stay renderers. Everything below is pure and
// works in PERCENTAGES of whatever box is showing the map, which is what lets one set of numbers
// serve an SVG viewBox, a zoomable overlay and a Scene measured in pixels.
//
// The `aspect` threaded through nearly every function is that box's width over its height, and it
// is here because percentages are not a square space: a step of 1% across is a different number
// of pixels from a step of 1% down, so a bow, an angle and a bead spacing all have to be measured
// in the box's real proportions or they come out squashed along one axis.

import {
	TRAVEL_MAPS, exitsOnMap, roadBendsBetween, spotPercent, travelMap, travelPlace,
} from "../data/travel-times.js";

// How far a leg of the route bows off the straight line between its two stops: a share of the
// leg's own length, capped, both in the same percentage-of-the-picture units the stops are
// placed in. Small on purpose. The line is a schematic, and a deep arc would start to look
// like a claim about which way the road actually runs.
const ROUTE_BOW_SHARE = 0.06;
const ROUTE_BOW_MAX = 2.5;

// How finely `routeDots` walks a curve, in samples per bead. A quadratic's arc length has no
// closed form, so the walk is a sum of straight chords, and a chord always cuts the corner: too
// few samples and every bead creeps forward of where it belongs. Four is enough that the chord
// error over one gap is far below a bead's own width, and the interpolation below then places
// each bead exactly on its threshold rather than at whichever sample first passed it.
const DOT_SAMPLES_PER_GAP = 4;

// The box's width over its height, defaulted. Every function here that measures an angle, a bow
// or a spacing depends on this being the SAME rule, so it is written once rather than restated
// at the top of each of them.
const ratioOf = aspect => (Number(aspect) > 0 ? Number(aspect) : 1);

// A quadratic Bezier evaluated on one axis. The curve is defined by this formula in three
// places — the head's anchor, its slope, and the bead walk — and a curve spelled out three
// times is a curve that can be mistyped in one of them without anything disagreeing loudly.
const quadAt = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;

/**
 * Is `end` somewhere `tier` can draw — its own spot, or the edge arrow that points at it?
 *
 * TWO KINDS OF END, because a journey has two kinds. A slug names a place the books lettered, and
 * this is the lookup it always was. A `{ tier, fx, fy }` mark is a point the GM put down by hand
 * (utils/journey-start.js), and it is drawn on the map it was laid on and on no other: its
 * fractions are of that one picture, so the same numbers elsewhere would mean a different valley.
 * `startEnd` is what reduces a trip's start to whichever of the two it is, and every map question
 * below takes ends in that form.
 */
export function drawnOn(tier, end) {
	if (!end) return false;
	if (typeof end === "object") return !!end.tier && end.tier === tier;
	return !!travelPlace(end)?.spots?.[tier] || exitsOnMap(tier).some(e => e.node === end);
}

/**
 * Can `tier` draw every one of `ends`, and is it a map at all?
 *
 * The question a surface asks about the picture it is ALREADY showing, which is a different
 * question from "which map is best for this journey" below and wants a different answer. A GM
 * reading the World's End and picking the Red Grove off it is not asking to be taken anywhere:
 * the map in front of them letters both ends, so it can go on showing the trip, and the innermost
 * map being a closer view is beside the point. `customTierFor` in utils/custom-route.js has always
 * treated a showing map that way; this is the same rule, said once, for the panel to use too.
 *
 * A null end is nothing to draw rather than something undrawable, which is what makes it answer
 * for a trip with no destination picked yet.
 */
export function tierDraws(tier, ends) {
	if (!travelMap(tier)) return false;
	return (ends ?? []).filter(Boolean).every(end => drawnOn(tier, end));
}

/**
 * The innermost map that draws EVERY one of `ends`, or null when no single map draws them all.
 *
 * Innermost first, because TRAVEL_MAPS is ordered outermost LAST and the closer map is the one
 * drawn at the scale the journey actually happens on. That ordering is the load-bearing fact
 * here, and it is stated once, in this function, rather than in each of the places that used to
 * ask this question for themselves.
 *
 * `except` skips a map the caller has already ruled out — what `offMapNote` needs to name the
 * OTHER map, the one that would draw what the one on screen cannot.
 */
export function tierDrawingEnds(ends, { except = null } = {}) {
	if (!ends?.length) return null;
	return TRAVEL_MAPS.map(m => m.slug)
		.find(slug => slug !== except && ends.every(end => drawnOn(slug, end))) ?? null;
}

/**
 * The innermost map that draws both ends of `route`, or null.
 *
 * Both ends, not just the far one: Stonetop is the only place drawn on both maps, so asking
 * about the destination alone sends a walk from the Red Grove out to the map of the whole
 * continent, where the Red Grove has no pin at all.
 */
export function tierDrawing(route, opts) {
	if (!route?.legs?.length) return null;
	// A ROUTE PINNED TO ONE MAP HAS ONLY ONE ANSWER, and it is not up for negotiation. Two kinds of
	// route are: a way drawn by hand, whose bare marks are fractions of one particular picture, and
	// one setting out from a mark the GM put down, whose first leg starts at such a fraction. Either
	// way the map it was laid on is the map it can be drawn on. Asking `tierDrawingEnds` about one
	// would answer for its two ENDS, which on a path from Stonetop to a bend in the Flats are one
	// place and a null — and it would happily nominate the other map, on which every mark in the
	// middle means somewhere else entirely.
	if (route.pinned) return route.tier ?? null;
	return tierDrawingEnds([route.legs[0].from, route.legs.at(-1).to], opts);
}

/**
 * The route drawn as a run of curved legs on ONE map, or null when it cannot be.
 *
 * Two things make this more than "join the pins". A stop can be missing from the map being
 * shown — the Foothills are drawn on the Vicinity but not on the World's End, so Stonetop to
 * Tor's Fist has a stop with nowhere to put it — and the line BRIDGES those rather than
 * breaking, which is honest for a schematic: it says "the way runs from here to there", never
 * that it follows this road. And a stop past the map's edge is drawn at the arrow that points
 * to it, which is what lets the line to Lygos run off the corner of the World's End instead of
 * stopping at Marshedge with nothing to say.
 *
 * Percentages, like every other position here, so the curve rides a `0 0 100 100` viewBox
 * and rescales with the picture without measuring anything.
 *
 * `legs` comes back alongside the SVG string because the Scene renderer cannot use that string:
 * PIXI has no path parser, and it wants the same quadratics as three points each. Handing back
 * the working rather than only the write-up is what keeps the canvas off a second solve.
 */
export function routePath(route, tier, frame, aspect) {
	if (!route?.legs?.length) return null;
	// A route with a bare mark at either end belongs to ONE map (see `tierDrawing`), so on any other
	// it has no line and not a wrong one. `offMapNote` says so in words, and names the map it is on.
	if (route.pinned && route.tier !== tier) return null;
	const arrows = new Map(exitsOnMap(tier).filter(e => e.node).map(e => [e.node, e]));
	// A stop is either a place, which this map looks up for itself, or a bare mark the GM put down,
	// which arrives carrying its own fraction. Both end up in the same percentage space, which is
	// what lets one curve builder serve a solved route and a drawn one.
	const at = ({ slug, spot }) => {
		const at2 = spot ?? travelPlace(slug)?.spots?.[tier] ?? arrows.get(slug) ?? null;
		return at2 ? spotPercent(at2, frame) : null;
	};
	const stops = bendStops([
		{ slug: route.legs[0].from, spot: route.legs[0].fromSpot ?? null },
		...route.legs.map(leg => ({ slug: leg.to, spot: leg.toSpot ?? null })),
	], tier, route);
	const placed = stops.map(at);
	// THE ENDS ARE NOT BRIDGEABLE. Dropping a missing stop from the MIDDLE is the honest
	// schematic described above; dropping a missing one from either END silently shortens the
	// journey to somewhere it merely passes through. Tor's Fist drawn on the Vicinity tab is
	// the case: its own spot is on the other map, so the line stopped at the Foothills and
	// planted the destination arrowhead on an unlabelled dot the party is only walking past.
	// A journey with an end this map cannot show has no honest line, so it gets none.
	if (!placed[0] || !placed.at(-1)) return null;
	const points = placed.filter(Boolean);
	// One point is a dot, not a path, and drawing it would just double the pin already there.
	if (points.length < 2) return null;
	const legs = routeLegs(points, aspect);
	return {
		d: routeCurve(legs),
		arrows: routeArrows(legs, aspect),
		// The head's own shape, published ONCE per path rather than per arrow: the partial draws
		// the same triangle for every one of them and would otherwise have to spell it out itself.
		headD: ROUTE_HEAD_PATH,
		legs,
	};
}

/**
 * The same run of stops with the road's own corners spliced into it.
 *
 * WHY A LINE NEEDS CORNERS THE TABLE DOES NOT HAVE. The travel table prints journeys, so one row
 * covers a road that turns: "Stonetop to the Foothills, 2 days via the Roads" is a single leg, and
 * a single leg drawn pin to pin cuts straight across the Vicinity's Bottomlands. The road goes
 * south-west to the Crossroads first and turns north there, and ROAD_BENDS (data/travel-times.js)
 * is where that is written down, per map, for the handful of legs it is true of.
 *
 * A BEND IS NOT A STOP. It arrives here with no time, no name in the readout and no row in the
 * Chronicle, because it changes nothing about the journey: it is a point the line passes over on
 * its way, and splicing it in HERE, where the pins are placed, is what keeps it out of everything
 * that reads `route.legs` for an answer about how long the walk takes.
 *
 * NOT ON A WAY THE GM DREW. Those marks are the GM's own account of which way the party goes, and
 * bending them toward a junction they deliberately drew around would be this module overruling
 * the person holding the pen.
 *
 * A bend the map cannot place is dropped by the caller's own lookup, exactly as a stop it cannot
 * place is, so a bend can never be the reason a line goes missing.
 */
function bendStops(stops, tier, route) {
	if (route.custom) return stops;
	return stops.flatMap((stop, i) => {
		if (i === 0) return [stop];
		// Between two stops the map places for itself: a bare mark carries a spot and no slug, and
		// there is no road row for a point somebody put down by hand.
		const through = roadBendsBetween(tier, stops[i - 1].slug, stop.slug)
			.map(slug => ({ slug, spot: null }));
		return [...through, stop];
	});
}

/**
 * The stops turned into curved legs: one quadratic per pair of them, bowed off the straight
 * line between the two.
 *
 * WHY IT BENDS AT ALL. A ruled line from pin to pin reads as measured. It says the way runs
 * exactly there, which is the one thing a schematic laid over a hand-drawn map cannot know. A
 * leg that bows says what the dots have always said — the way goes from here to there — in a
 * shape a road could plausibly take.
 *
 * WHY THE SIDES ALTERNATE. A quadratic leaves its first stop turned toward its control point
 * and reaches its second turned as far the other way. Bow every leg to the same side and the
 * line arrives at a middle stop heading one way and leaves it heading another, so a run of
 * stops standing in a line kinks at every pin between the ends. Alternating makes each
 * departure match the arrival before it exactly wherever two chords are in line: the legs join
 * into one winding line, and the only corners left in it are the turns the journey really makes.
 *
 * The bow is measured in the box's real proportions, the same correction the arrowheads' angle
 * needs, so a leg running north bows as deeply as one running east instead of being flattened
 * by the stretch. Its depth is a share of the leg, capped: a short hop stays near enough
 * straight, and a long one does not balloon.
 */
export function routeLegs(points, aspect) {
	const ratio = ratioOf(aspect);
	return points.slice(1).map((to, i) => {
		const from = points[i];
		const dx = to.left - from.left;
		const dy = (to.top - from.top) / ratio;
		const len = Math.hypot(dx, dy);
		// Twice the depth wanted, because a quadratic only travels half way to its control
		// point. Even legs bow one way, odd legs the other.
		const reach = Math.min(len * ROUTE_BOW_SHARE, ROUTE_BOW_MAX) * 2 * (i % 2 ? -1 : 1);
		return {
			from,
			to,
			// The midpoint pushed along the leg's perpendicular, then back out of
			// pixel-proportional space so the result is a percentage like everything else
			// here. Two stops drawn on the same spot have no perpendicular and no curve.
			control: {
				left: (from.left + to.left) / 2 + (len ? (dy / len) * reach : 0),
				top:  (from.top + to.top) / 2 - (len ? (dx / len) * reach * ratio : 0),
			},
		};
	});
}

/** The legs as one SVG path: a move to the first stop, then a quadratic into each one after. */
function routeCurve(legs) {
	const at = p => `${p.left.toFixed(2)},${p.top.toFixed(2)}`;
	const bends = legs.map(leg => `Q ${at(leg.control)} ${at(leg.to)}`).join(" ");
	return `M ${at(legs[0].from)} ${bends}`;
}

/**
 * A head per leg of the drawn line, each pointing INTO the stop it arrives at.
 *
 * One head on the far end says where the journey ENDS. It does not say which way the party is
 * walking through everything before it, and on a line of evenly spaced dots that doubles back
 * on itself there is nothing else to say it: Stonetop out to the Steplands and on to Three
 * Coven Lake reads the same forwards as backwards through its middle. A head short of every
 * arrival puts the direction on each leg instead of only on the last one.
 *
 * The waypoint heads are flagged rather than left to be told apart by position, so the CSS can
 * draw them smaller: the destination stays the loudest mark on the line instead of becoming
 * one of a row of identical chevrons.
 */
function routeArrows(legs, aspect) {
	const last = legs.length - 1;
	return legs
		.map((leg, i) => {
			const head = routeArrow(leg, aspect);
			// A leg between two stops drawn on the same spot has no direction to show.
			return head && { ...head, waypoint: i < last };
		})
		.filter(Boolean);
}

/**
 * THE SHAPE OF ONE ARROWHEAD, written down once for the two renderers that draw it.
 *
 * A triangle read off its own centre, so a size and an angle are the whole of what a caller has
 * to supply: the Scene painter scales these straight into Scene pixels, and the walkthrough gets
 * the same points as an SVG `d` on a `0 0 10 10` box. It was authored twice — normalized points
 * in the canvas painter and a hand-written `M1 1.2 L9 5 L1 8.8 Z` in the partial — which is the
 * duplication this module exists to end for the curve the head rides on; a reshaped head reached
 * one surface and left the other pointing the old way, on the same journey in front of the same
 * table.
 *
 * `EDGE` is the cream halo as a share of the head's size; the stylesheet draws it as
 * `stroke-width: 1.4` on that same 10-unit box, which is this number times `VIEWBOX`.
 */
export const ROUTE_HEAD_POINTS = Object.freeze([[-0.4, -0.38], [0.4, 0], [-0.4, 0.38]]);
export const ROUTE_HEAD_EDGE = 0.14;
export const ROUTE_HEAD_VIEWBOX = 10;

/**
 * The same triangle as an SVG path over `viewBox="0 0 10 10"`.
 *
 * Rounded before it is printed, because the centring arithmetic lands on values like
 * 0.9999999999999998 and a `d` full of those is unreadable in the DOM inspector for no gain.
 */
export const ROUTE_HEAD_PATH = `M${ROUTE_HEAD_POINTS
	.map(([x, y]) => `${_headUnit(x)} ${_headUnit(y)}`)
	.join(" L")} Z`;

function _headUnit(v) {
	return String(Number((((v + 0.5) * ROUTE_HEAD_VIEWBOX)).toFixed(4)));
}

/**
 * One head, sitting ON its leg and pointing the way that leg is walked.
 *
 * ITS ANGLE IS NOT THE ANGLE BETWEEN THE TWO STOPS, for two reasons. The leg is curved, so by
 * the time it reaches the far end it is already turning back toward the chord, and a head that
 * ignored that would sit askew on the line it belongs to. And both coordinates are percentages
 * of a box that is wider than it is tall, so a step of 1% across is a different number of
 * pixels from a step of 1% down, and the direction a reader SEES is not the direction the
 * numbers describe. Dividing the vertical component by the box's aspect converts into the
 * pixel space the eye is actually in. (That distortion is also what rules out an SVG
 * `orient="auto"` marker here: it would take its angle from the unstretched user space and
 * point visibly wide on a diagonal.)
 *
 * The head is backed off from the stop so it points AT the pin instead of sitting under it,
 * capped at a share of the leg so a short hop cannot push it back past the stop it set out
 * from. That back-off is stepped along the CHORD rather than measured along the curve, which
 * runs a few per cent longer: a few per cent of a 3% back-off is not a distance anyone can see.
 */
export function routeArrow(leg, aspect) {
	const ratio = ratioOf(aspect);
	// Into pixel-proportional space: x stays as-is, y shrinks by the box's width-to-height.
	const dx = leg.to.left - leg.from.left;
	const dy = (leg.to.top - leg.from.top) / ratio;
	const len = Math.hypot(dx, dy);
	if (!len) return null;
	// How far along the leg the head sits, and the curve and its slope where it sits.
	const t = 1 - Math.min(3, len * 0.4) / len;
	const at = (a, b, c) => quadAt(a, b, c, t);
	const slope = (a, b, c) => 2 * (1 - t) * (b - a) + 2 * t * (c - b);
	const alongX = slope(leg.from.left, leg.control.left, leg.to.left);
	const alongY = slope(leg.from.top, leg.control.top, leg.to.top) / ratio;
	return {
		left:  Number(at(leg.from.left, leg.control.left, leg.to.left).toFixed(2)),
		top:   Number(at(leg.from.top, leg.control.top, leg.to.top).toFixed(2)),
		angle: Number((Math.atan2(alongY, alongX) * 180 / Math.PI).toFixed(2)),
	};
}

/**
 * The line's beads: a point every `spacing` along the whole run of legs, first stop included.
 *
 * WHAT THIS IS FOR. In the walkthrough the dotted line is one SVG stroke wearing a dash pattern,
 * and the browser does the walking. On a Scene there is no stroke to dash — PIXI draws a line or
 * it does not — so the dots have to be placed one at a time, and something has to walk the curve
 * to place them. Same curve, same look, two very different renderers.
 *
 * EVENLY SPACED MEANS EVENLY SPACED TO THE EYE, so the walk happens in the box's real proportions
 * and the answers are converted back to percentages on the way out. Stepping the raw percentages
 * instead would bunch the beads up on a leg running north and string them out on one running east,
 * on a map half again as wide as it is tall.
 *
 * The distance is carried ACROSS legs rather than restarted at each stop, so the run reads as one
 * dotted line rather than as a string of separate ones that happen to meet: a leg whose length is
 * not a whole number of gaps would otherwise crowd two beads together at every stop between the
 * ends.
 */
export function routeDots(legs, aspect, spacing) {
	const ratio = ratioOf(aspect);
	if (!Array.isArray(legs) || !legs.length || !(spacing > 0)) return [];

	const flat = p => ({ left: p.left, top: p.top / ratio });
	const back = p => ({ left: p.left, top: p.top * ratio });
	const span = (a, b) => Math.hypot(b.left - a.left, b.top - a.top);
	const between = (a, b, f) => ({ left: a.left + (b.left - a.left) * f, top: a.top + (b.top - a.top) * f });

	const beads = [];
	let previous = flat(legs[0].from);
	// Zero rather than `spacing`, so the very first threshold is met at once and the run starts
	// with a bead ON the first stop instead of one gap short of it.
	let toGo = 0;

	for (const leg of legs) {
		const a = flat(leg.from), b = flat(leg.control), c = flat(leg.to);
		// The control polygon, which is never shorter than the arc inside it: erring long here
		// only samples more finely than needed, while erring short would sample too coarsely.
		const rough = span(a, b) + span(b, c);
		const steps = Math.max(2, Math.ceil((rough / spacing) * DOT_SAMPLES_PER_GAP));
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			const point = {
				left: quadAt(a.left, b.left, c.left, t),
				top: quadAt(a.top, b.top, c.top, t),
			};
			// One sample can straddle more than one threshold on a coarse curve, so this drops
			// every bead the step passes rather than the first of them.
			let step = span(previous, point);
			while (step >= toGo) {
				const bead = between(previous, point, step ? toGo / step : 0);
				beads.push(back(bead));
				previous = bead;
				step -= toGo;
				toGo = spacing;
			}
			toGo -= step;
			previous = point;
		}
	}
	return beads;
}

/**
 * Why a map that CAN be drawn is showing no route line, in words the reader can act on.
 *
 * `routePath` refuses to bridge a missing END, for the reason set out over it: a line that
 * drops one silently shortens the journey to somewhere it merely passes through. That refusal
 * is right and it was also SILENT, which is the part that was wrong. Six places are lettered
 * on the Vicinity alone, so choosing one and then opening the World’s End took the whole route
 * line away with nothing on screen saying so, and the map read as having forgotten the trip
 * rather than as being unable to show it.
 *
 * Names the END that is missing rather than the map, because that is the fact the reader can
 * do something with, and names the map that draws the whole way where one does. Returns null
 * when the line is drawable, which is the ordinary case and the one that must cost nothing.
 */
export function offMapNote(tier, route) {
	if (!route?.legs?.length) return null;
	if (route.pinned) return pinnedOffMapNote(tier, route);
	// The ends alone. A missing stop in the MIDDLE is bridged rather than refused, so it is
	// not why there is no line and saying so would send the reader after the wrong map.
	const ends = [...new Set([route.legs[0].from, route.legs.at(-1).to])];
	const undrawn = ends.filter(slug => !drawnOn(tier, slug));
	if (!undrawn.length) return null;
	const names = undrawn.map(slug => travelPlace(slug)?.name ?? slug);
	const other = tierDrawingEnds(ends, { except: tier });
	return {
		// AN ARRAY, not a sentence. Joining these with "and" would be grammar, and this module
		// does quadratics. `offMapNames` in utils/scene-route.js turns it into words, through
		// `joinNames` — the system's one list-joiner — for whichever surface is asking.
		//
		// Two undrawn ends means a journey between two maps’ worth of country, which no single
		// map draws, so `other` is null and the pair reads as the pair it is.
		names,
		other,
		otherName: other ? travelMap(other)?.name ?? null : null,
	};
}

/**
 * The same question for a route pinned to one map, which has two ways of not being drawable and
 * they want different sentences.
 *
 * WRONG MAP is the common one and it is not a fault: a bare mark is a fraction of one picture, so
 * opening the other tab takes the line away exactly as it should. The reader needs to be told which
 * map it is on and given the button back to it — `elsewhere` is what says the note is about the
 * PICTURE rather than about a place, so the readout does not word it as though somewhere had gone
 * missing. `drawn` then says WHICH pinning it is, because "you drew this on the Vicinity" and "they
 * set out from a point on the Vicinity" are two different facts and only one of them is true of any
 * given trip.
 *
 * WRONG END is the rare one: the trip now sets out from Marshedge and the way was drawn on the
 * Vicinity, which letters no Marshedge. That really is a missing end, it reads exactly like the
 * solved-route case above, and there is no other map to offer — the marks in the middle only mean
 * anything on this one.
 *
 * A BARE MARK IS NEVER MISSING. It carries its own position, so the `spot` test has to come first;
 * asking `drawnOn` about its null slug would report the far end of every hand-drawn path, and the
 * near end of every hand-placed start, as undrawable — putting a refusal under a line the reader
 * can plainly see.
 */
function pinnedOffMapNote(tier, route) {
	const other = route.tier ?? null;
	if (other !== tier) {
		return {
			names: [], other, otherName: travelMap(other)?.name ?? null,
			elsewhere: true, drawn: !!route.custom,
		};
	}
	const first = route.legs[0];
	const last = route.legs.at(-1);
	const ends = [{ slug: first.from, spot: first.fromSpot }, { slug: last.to, spot: last.toSpot }];
	const names = [...new Set(ends
		.filter(end => !end.spot && !drawnOn(tier, end.slug))
		.map(end => travelPlace(end.slug)?.name ?? end.slug)
		.filter(Boolean))];
	return names.length ? { names, other: null, otherName: null, elsewhere: false } : null;
}
