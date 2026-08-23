// Turning the travel table into an answer: how long to get there, and by what legs.
//
// The table in module/data/travel-times.js is sparse on purpose — it prints the legs, not the
// journeys — so answering "how long to Lygos?" means composing legs, which is exactly the Chart a
// Course requirement "You must first travel to ___, and from there to your destination". This
// module does the composing and the phrasing, and nothing else; it touches no Foundry global, so
// the Chronicle compiler can print a route into a journal from the two stored slugs alone.
//
// IT IS ALSO WHERE THE TWO KINDS OF ROUTE MEET. A trip either follows the table or follows a way
// the GM drew on the map by hand (utils/custom-route.js), and `journeyRoute` answers with whichever
// one the trip is about, in one shape. Four readers depend on that — the walkthrough's readout, the
// Chart a Course carry-forward, the Scene painter and the Chronicle — and dispatching once here is
// what stops them disagreeing about which way the party is going.
//
// ON MIXING HOURS AND DAYS. A leg is printed in whichever unit the book used, and the two are
// never converted for display: a "day" in this table is a day's march, not 24 hours of walking,
// so re-expressing "5-7 hours" as a fraction of a day would invent precision nobody wrote down.
// Totals therefore carry days and hours as two separate running sums. The single number used to
// COMPARE two routes scores a day as one day of march (MARCH_HOURS) — but it is only ever used
// to pick a winner, never shown. As it happens the table's hour-legs all hang off Stonetop and never
// chain into a day-leg, so no route the book can express actually mixes the two; the arithmetic
// is written to survive the table growing anyway.
//
// ON RANGES. "2-3 days" is a range, so a total has a low and a high end. The ROUTE is chosen on
// the low end, matching the book's own "It'll take at least ___ days".

import {
	MARCH_HOURS, TRAVEL_LEGS, TRAVEL_PLACES, travelMap, travelPlace, homePlace,
} from "../data/travel-times.js";
import {
	customStops, estimateSpan, normalizeCustom, pricedLeg, spotDistance, tierPace,
} from "./custom-route.js";
import { hasFillBlank, fillBlank } from "./fill-blanks.js";

/** An en dash for printed ranges, as the book's own table sets them. */
const RANGE_DASH = "–";

/** What one leg costs on the single scale used to compare routes. Never displayed. */
function legCost(leg) {
	return leg.min * (leg.unit === "days" ? MARCH_HOURS : 1);
}

/** Adjacency both ways: the table prints each leg once, but a road runs in both directions. */
function adjacency(legs) {
	const out = new Map();
	const link = (from, to, leg) => {
		if (!out.has(from)) out.set(from, []);
		out.get(from).push({ to, leg });
	};
	for (const leg of legs) {
		link(leg.from, leg.to, leg);
		link(leg.to, leg.from, leg);
	}
	return out;
}

/** A zeroed total, which is also the honest answer for "how far to where you already are". */
function emptyTotal() {
	return { days: { min: 0, max: 0 }, hours: { min: 0, max: 0 } };
}

/** `total` plus one more leg, keeping the two units apart. */
function addLeg(total, leg) {
	const key = leg.unit === "days" ? "days" : "hours";
	const next = { days: { ...total.days }, hours: { ...total.hours } };
	next[key].min += leg.min;
	next[key].max += leg.max;
	return next;
}

/**
 * Every leg of a solved route, as the display wants them: named, in travel order.
 *
 * `estimated: false` is not filler. A hand-drawn way builds legs of this same shape and marks the
 * ones it measured off the map rather than read off the table, and the readout draws BOTH from one
 * template — so a solved leg has to answer the question rather than leave it undefined, or the
 * partial is reading a field that exists on one kind of route and not the other.
 */
function describeLegs(steps) {
	return steps.map(({ from, to, leg }) => ({
		from, to,
		fromName: travelPlace(from)?.name ?? from,
		toName:   travelPlace(to)?.name ?? to,
		min: leg.min, max: leg.max, unit: leg.unit, via: leg.via ?? null,
		estimated: false,
		time: formatSpan(leg.min, leg.max, leg.unit),
	}));
}

/**
 * The best route from `origin` to every place the table can reach, in one pass.
 *
 * Dijkstra rather than a lookup because the table is sparse and its shortest paths are the book's
 * own answers — Three Coven Lake really is quicker via the Steplands (4 + 3) than via Marshedge
 * (10 + 4), and Book II says so. A plain array scan for the next nearest node: nineteen edges do
 * not want a heap, and the flat loop is the version a reader can check.
 *
 * @param {string} originSlug where the party is now; defaults to home.
 * @returns {Map<string, {slug, place, legs, total, cost}>} keyed by destination slug. The origin
 *   maps to a zero-length route; a place the table cannot reach is simply absent.
 */
export function solveTravel(originSlug = homePlace().slug, { legs = TRAVEL_LEGS, places = TRAVEL_PLACES } = {}) {
	const known = new Set(places.map(p => p.slug));
	const routes = new Map();
	if (!known.has(originSlug)) return routes;

	const links = adjacency(legs);
	const cost = new Map([[originSlug, 0]]);
	const prev = new Map();          // slug -> { from, leg }
	const settled = new Set();

	for (;;) {
		// The nearest node not yet settled. `null` means everything reachable has been reached.
		let next = null;
		for (const [slug, c] of cost) {
			if (settled.has(slug)) continue;
			if (next === null || c < cost.get(next)) next = slug;
		}
		if (next === null) break;
		settled.add(next);

		for (const { to, leg } of links.get(next) ?? []) {
			if (settled.has(to) || !known.has(to)) continue;
			const through = cost.get(next) + legCost(leg);
			if (!cost.has(to) || through < cost.get(to)) {
				cost.set(to, through);
				prev.set(to, { from: next, leg });
			}
		}
	}

	for (const slug of settled) {
		const steps = [];
		for (let at = slug; prev.has(at); at = prev.get(at).from) {
			const { from, leg } = prev.get(at);
			steps.unshift({ from, to: at, leg });
		}
		routes.set(slug, {
			slug,
			place: travelPlace(slug),
			legs:  describeLegs(steps),
			total: steps.reduce((t, s) => addLeg(t, s.leg), emptyTotal()),
			cost:  cost.get(slug),
		});
	}
	return routes;
}

/**
 * A stored `{ origin, destination }` read back as two slugs the rest of the system can trust.
 *
 * ONE definition of what a trip's pick means, because three callers need it and they must agree:
 * the walkthrough draws from it, the carry-forward onto Chart a Course ticks from it, and the
 * Chronicle compiler prints from it. Written out three times it drifted — an unknown slug is
 * `null` in one place and the raw string in another, and a trip bound for where it already is is
 * a journey in one and not in the others.
 *
 * An unrecognised slug becomes null rather than being passed through: the graph cannot answer for
 * it, and a destination the map has never heard of is a destination nobody picked. Going nowhere
 * is likewise not a journey — it would solve to a route with no legs.
 */
export function normalizeJourney(journey) {
	const origin = travelPlace(journey?.origin)?.slug ?? homePlace().slug;
	const destination = travelPlace(journey?.destination)?.slug ?? null;
	return {
		origin,
		destination: destination === origin ? null : destination,
		// The way the GM drew, whether or not it is the one being shown. It is read back on every
		// call rather than only when it is switched on, because the panel has to keep offering the
		// marks back to a reader who ticked the box off to compare and means to tick it on again.
		custom: normalizeCustom(journey?.custom),
	};
}

/**
 * The route a stored trip describes, or null when it does not describe one.
 *
 * TWO KINDS OF ANSWER THROUGH ONE DOOR, and that is the whole point of dispatching here rather
 * than at each of the four call sites. The trip either follows the table — the solve below — or
 * follows a way the GM drew by hand, and every reader of a route (the walkthrough's readout, the
 * Chart a Course carry-forward, the Scene painter, the Chronicle) wants whichever one the trip is
 * actually about. Asking this one function is what keeps them from disagreeing about which.
 *
 * Recomputed rather than read from a saved snapshot, both ways: the graph is frozen compile-time
 * data and a hand-drawn path stores its marks and not its geometry, so there is nothing to migrate
 * and nothing that can go stale, and a correction to the travel table reaches an old trip the next
 * time anything asks.
 *
 * `routes` hands in a table already solved from this trip's own origin, which the walkthrough has
 * in hand anyway to time every OTHER place on the map. The solve is a Dijkstra that then describes
 * a route to all eighteen, and the panel rebuilds on every destination pick, tier tab and drawn
 * mark, so solving it twice per build is the one cost here worth not paying twice.
 */
export function journeyRoute(journey, { routes = null } = {}) {
	const { origin, destination, custom } = normalizeJourney(journey);
	if (custom.on) return customRoute(journey);
	if (!destination) return null;
	const route = (routes ?? solveTravel(origin)).get(destination) ?? null;
	return route?.legs?.length ? route : null;
}

/**
 * The same answer for a way the GM drew: the marks joined into legs, priced where the book prices
 * them and estimated off the map where it does not.
 *
 * THE SHAPE IS A SOLVED ROUTE'S SHAPE, deliberately and to the letter — `legs` with `fromName`,
 * `toName`, `min`, `max`, `unit` and `time`, and a two-bucket `total` — because everything
 * downstream of `journeyRoute` was written against that shape and none of it should have to learn
 * a second one. What a custom route adds is additive and ignorable: `custom` and `tier` say which
 * map the marks belong to, `fromSpot`/`toSpot` carry the bare fractions for the two renderers that
 * draw the line, and `estimated` says the number came off the map rather than out of the table.
 *
 * A LEG THE TABLE ALREADY PRICES KEEPS THE PRINTED TIME. If the GM drew one straight leg from
 * Stonetop to Marshedge, the book has measured that journey and this has no business second-
 * guessing it with a ruler; the estimate is for the legs the book never printed, which is every
 * leg that touches a bare mark. So the common case — the usual route with one detour bent into it
 * — comes out as the table's own times plus an estimate for the detour, which is exactly the
 * answer a GM wants and could not otherwise get.
 *
 * A leg whose ends this map cannot both place gets no time at all rather than a made-up one. That
 * is the ordinary state of a path whose origin has been changed to somewhere the map does not
 * draw, and `offMapNote` is what tells the reader so.
 */
export function customRoute(journey) {
	const { origin, custom } = normalizeJourney(journey);
	if (!custom.on || !custom.points.length) return null;
	const aspect = travelMap(custom.tier)?.printedAspect;
	const pace = tierPace(custom.tier);
	const stops = customStops(origin, custom);

	const legs = stops.slice(1).map((to, i) => {
		const from = stops[i];
		const priced = from.slug && to.slug ? pricedLeg(from.slug, to.slug) : null;
		const span = priced
			? { min: priced.min, max: priced.max, unit: priced.unit }
			: estimateSpan(spotDistance(from.spot, to.spot, aspect), pace);
		return {
			from: from.slug, to: to.slug,
			fromName: from.name, toName: to.name,
			// ONLY FOR A BARE MARK. A stop that names a place stores no position, so that the map
			// looks it up fresh and a corrected coordinate reaches a path drawn last season.
			fromSpot: from.slug ? null : from.spot,
			toSpot: to.slug ? null : to.spot,
			min: span?.min ?? 0, max: span?.max ?? 0, unit: span?.unit ?? "hours",
			via: priced?.via ?? null,
			estimated: !priced,
			time: span ? formatSpan(span.min, span.max, span.unit) : null,
		};
	});

	// Any estimate at all makes the whole answer an estimate, which is what `routePhrase` turns
	// into the word "roughly": a total is only as sure as its least sure part.
	const estimated = legs.some(leg => leg.estimated);
	const total = legs.reduce((running, leg) => addLeg(running, leg), emptyTotal());
	return {
		custom: true,
		tier: custom.tier,
		stops,
		legs,
		total: estimated ? oneUnit(total) : total,
		estimated,
	};
}

/**
 * A total said in ONE unit, for an answer that was measured rather than printed.
 *
 * WHY ONLY ESTIMATES. The two-bucket total exists because the table's own days and hours must never
 * be converted into one another: a "day" in that table is a day spent walking, not a revolution of
 * the earth, so re-expressing "5-7 hours" as a fraction of a day would invent precision nobody
 * wrote down. That argument is about the BOOK's numbers, and it has no purchase on a figure this
 * system got with a ruler — which is already approximate, and is about to be read aloud.
 *
 * WHAT IT FIXES. The table's hour-legs all hang off Stonetop and never chain, so a solved route
 * never carries more than one of them. A hand-drawn way chains them freely: four bare marks across
 * the Vicinity summed to "roughly 13-22 hours", which a GM reads as one long day and is really the
 * better part of three days of marching. Saying "roughly 2-3 days" is the same measurement, in the
 * unit the answer is actually in.
 *
 * ROUNDED UP, both ends, which is the argument `atLeastDays` already makes about supplies: a
 * part-day of walking still costs you a day of them.
 */
function oneUnit(total) {
	const hours = total.days.min * MARCH_HOURS + total.hours.min;
	const most = total.days.max * MARCH_HOURS + total.hours.max;
	if (most < MARCH_HOURS) return total;
	const min = Math.ceil(hours / MARCH_HOURS);
	return { days: { min, max: Math.max(min, Math.ceil(most / MARCH_HOURS)) }, hours: { min: 0, max: 0 } };
}

/**
 * A stable string for the way a trip is drawn, and nothing else about the trip.
 *
 * WHAT IS DRAWN, not what is stored: with a hand-drawn path showing, the trip's `destination` is
 * remembered but not on the map, so changing it must not make the Scene in front of the table look
 * like it has fallen out of step. This is what `sceneShowsJourney` compares, and getting that
 * wrong turns the Scene button into one that offers to draw a line already there.
 */
export function journeyKey(journey) {
	const { origin, destination, custom } = normalizeJourney(journey);
	if (!custom.on) return `table|${origin}|${destination ?? ""}`;
	const marks = custom.points.map(p => p.slug ?? `${p.fx},${p.fy}`).join(" ");
	return `drawn|${origin}|${custom.tier}|${marks}`;
}

/** "2 days", "3-4 hours" — one span, in the unit it was printed in. */
function formatSpan(min, max, unit) {
	const noun = unit === "days" ? "day" : "hour";
	const count = min === max ? `${min}` : `${min}${RANGE_DASH}${max}`;
	return `${count} ${max === 1 ? noun : `${noun}s`}`;
}

/**
 * A whole total, in words: "40 days", "7-8 days", "3-4 hours", "2 days and 5 hours".
 *
 * Both halves appear when a route really does mix units, which keeps the number honest instead of
 * rounding a morning's walk into or out of a day.
 */
export function formatTravelTime(total) {
	const parts = [];
	if (total.days.max  > 0) parts.push(formatSpan(total.days.min,  total.days.max,  "days"));
	if (total.hours.max > 0) parts.push(formatSpan(total.hours.min, total.hours.max, "hours"));
	if (!parts.length) return "no time at all";
	return parts.join(" and ");
}

/** The book's own framing for a journey it will not promise the end of. */
export function atLeastPhrase(total) {
	if (!total || (!total.days.max && !total.hours.max)) return "no travel at all";
	return `at least ${formatTravelTime(total)}`;
}

/**
 * The headline time for a route, in the words that particular route has earned.
 *
 * "At least" is the book's own framing and it is a promise about the FLOOR: the table printed
 * these times, so the journey cannot be quicker. A way measured off the map with a ruler has made
 * no such promise — it could as easily come out short as long — so it says "roughly" instead, and
 * the difference between those two words is the difference between a printed fact and a good
 * guess. One function so that the walkthrough's readout and the Chronicle's paragraph cannot come
 * to word the same route two ways.
 */
export function routePhrase(route) {
	const total = route?.total;
	if (!total || (!total.days.max && !total.hours.max)) return atLeastPhrase(total);
	return route.estimated ? `roughly ${formatTravelTime(total)}` : atLeastPhrase(total);
}

/**
 * Whole days to allow for, which is what the Chart a Course requirement asks for: it says
 * "at least ___ days", so a part-day of walking still costs you a day of supplies.
 *
 * Counts from the LOW end of every range, because "at least" already says which end it means.
 */
export function atLeastDays(total) {
	if (!total) return 0;
	const spare = total.hours?.min ? Math.ceil(total.hours.min / MARCH_HOURS) : 0;
	return (total.days?.min ?? 0) + spare;
}

/**
 * The places a route passes THROUGH — every stop but the destination itself.
 *
 * This is what makes the "First travel to ___" requirement answerable: a journey with no
 * intermediate stop does not need it, and one with several names the first.
 */
export function stopsAlongTheWay(route) {
	return (route?.legs ?? []).slice(0, -1)
		// NAMED STOPS ONLY, which is a no-op on a solved route (every stop of one is a place) and
		// load-bearing on a hand-drawn one. Chart a Course's blank reads "you must first travel to
		// ___", and filling it with "point 2" would hand the GM a requirement they cannot say out
		// loud. A bend in the way is a thing the line shows and not a thing to travel to first.
		.filter(leg => !!leg.to)
		.map(leg => leg.toName);
}

/** "Stonetop to Marshedge to Lygos" — the route as one line, for a notes field. */
export function routeLine(route) {
	const legs = route?.legs ?? [];
	if (!legs.length) return route?.place?.name ?? "";
	return [legs[0].fromName, ...legs.map(l => l.toName)].join(" to ");
}

/**
 * One line per leg, for the Chronicle: "Stonetop to Marshedge, 10 days (via the Roads)".
 *
 * A leg with no time at all is a leg this map could not measure — a hand-drawn way whose origin
 * the map does not letter — and it still names both its ends, because where the way runs is worth
 * recording even where how long it takes is not.
 */
export function routeLegLines(route) {
	return (route?.legs ?? []).map(leg => {
		const where = `${leg.fromName} to ${leg.toName}`;
		if (!leg.time) return where;
		return `${where}, ${leg.time}${leg.via ? ` (via ${leg.via})` : ""}`;
	});
}

/**
 * What a solved route has to say about one Chart a Course blank, or null when it has nothing.
 *
 * THE TICK AND THE FILL ASK THIS SAME QUESTION. A requirement whose box is ticked but whose text
 * still reads "at least ___ days" is worse than either state on its own — it tells the GM the
 * answer has been worked out and then declines to say what it is — and that is exactly what a
 * separate "does it have legs?" test for the tick produced: five of the eighteen destinations
 * from Stonetop (the Crossroads, the Maw, the Red Grove, the cave bears' den and the Ruined
 * Tower) are measured only in hours, so they have legs and no day count. So there is one
 * predicate, `!== null`, and both sides read it.
 */
export function chartBlankValue(key, route) {
	if (!route) return null;
	if (key === "days") {
		// A trip measured only in hours has no day count worth printing, and "at least 1 days" for
		// a morning's walk would read worse than the blank does.
		if (!route.total?.days?.max) return null;
		return String(atLeastDays(route.total));
	}
	// A single-leg journey has nowhere to travel to first.
	if (key === "firstTravel") return stopsAlongTheWay(route)[0] ?? null;
	return null;
}

/**
 * Fill the blank in one Chart a Course requirement from a solved route.
 *
 * The authored prompts in dialogs/expedition-data.js keep their literal `___`, because they are
 * still the right words when no journey has been plotted. This substitutes at render time, and
 * BOTH the dialog's checklist and the Chronicle's copy of it go through here, so the tick box a
 * GM reads and the journal that records it can never disagree.
 *
 * Through the system's own blank helpers rather than a local `"___"` literal: the book's blanks
 * are a run of two or more underscores wherever else they appear, and the value is spliced in
 * escaped and replacement-pattern-safe (a `$` in a place name would otherwise be read as `$&`).
 *
 * Returns `text` unchanged when the route cannot answer that particular blank.
 */
export function fillChartBlank(text, key, route) {
	if (!hasFillBlank(text)) return text;
	const value = chartBlankValue(key, route);
	return value === null ? text : fillBlank(text, value);
}
