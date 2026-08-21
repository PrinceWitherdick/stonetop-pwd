// Turning the travel table into an answer: how long to get there, and by what legs.
//
// The table in module/data/travel-times.js is sparse on purpose — it prints the legs, not the
// journeys — so answering "how long to Lygos?" means composing legs, which is exactly the Chart a
// Course requirement "You must first travel to ___, and from there to your destination". This
// module does the composing and the phrasing, and nothing else; it touches no Foundry global, so
// the Chronicle compiler can print a route into a journal from the two stored slugs alone.
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
	MARCH_HOURS, TRAVEL_LEGS, TRAVEL_PLACES, travelPlace, homePlace,
} from "../data/travel-times.js";
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

/** Every leg of a solved route, as the display wants them: named, in travel order. */
function describeLegs(steps) {
	return steps.map(({ from, to, leg }) => ({
		from, to,
		fromName: travelPlace(from)?.name ?? from,
		toName:   travelPlace(to)?.name ?? to,
		min: leg.min, max: leg.max, unit: leg.unit, via: leg.via ?? null,
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
	return { origin, destination: destination === origin ? null : destination };
}

/**
 * The solved route a stored trip describes, or null when it does not describe one.
 *
 * Recomputed from the two slugs rather than read from a saved snapshot: the graph is frozen
 * compile-time data, so there is nothing to migrate and nothing that can go stale, and a
 * correction to the travel table reaches an old trip the next time anything asks.
 */
export function journeyRoute(journey) {
	const { origin, destination } = normalizeJourney(journey);
	if (!destination) return null;
	const route = solveTravel(origin).get(destination) ?? null;
	return route?.legs?.length ? route : null;
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
	return (route?.legs ?? []).slice(0, -1).map(leg => leg.toName);
}

/** "Stonetop to Marshedge to Lygos" — the route as one line, for a notes field. */
export function routeLine(route) {
	const legs = route?.legs ?? [];
	if (!legs.length) return route?.place?.name ?? "";
	return [legs[0].fromName, ...legs.map(l => l.toName)].join(" to ");
}

/** One line per leg, for the Chronicle: "Stonetop to Marshedge, 10 days (via the Roads)". */
export function routeLegLines(route) {
	return (route?.legs ?? []).map(leg =>
		`${leg.fromName} to ${leg.toName}, ${leg.time}${leg.via ? ` (via ${leg.via})` : ""}`);
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
