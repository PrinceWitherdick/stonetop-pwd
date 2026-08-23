import { describe, it, expect } from "vitest";
import {
	solveTravel, formatTravelTime, atLeastPhrase, atLeastDays,
	stopsAlongTheWay, routeLine, routeLegLines, fillChartBlank, chartBlankValue,
	normalizeJourney, journeyRoute, journeyKey, routePhrase,
} from "../../module/utils/travel-route.js";
import { MARCH_HOURS, TRAVEL_LEGS, TRAVEL_PLACES } from "../../module/data/travel-times.js";

// The book is the oracle here. Stonetop's travel table prints legs, not journeys, so the whole
// value of this module is that composing those legs reproduces the distances the rulebooks state
// in prose elsewhere. Every expectation below is a sentence somebody can go and read.

const from = (origin = "stonetop") => solveTravel(origin);
const to = (routes, slug) => routes.get(slug);

describe("the routes the book shows its own work for", () => {
	const routes = from();

	it("walks to the Ruined Tower in a long day's march, by way of the Crossroads", () => {
		// Book II: "take the West Road 3-4 hours to the Crossroads... From there, it's 5-6 hours
		// southwest across the Flats", and the entry opens "A long day's march from Stonetop".
		const route = to(routes, "the-ruined-tower");
		expect(route.legs.map(l => l.to)).toEqual(["the-crossroads", "the-ruined-tower"]);
		expect(route.total.hours).toEqual({ min: 8, max: 10 });
		expect(route.total.days).toEqual({ min: 0, max: 0 });
		expect(formatTravelTime(route.total)).toBe("8–10 hours");
	});

	it("reaches Three Coven Lake through the Steplands, not through Marshedge", () => {
		// Book II: "travel to the Steplands, which will take at least 4 days", then "at least 3
		// days" on. Going by Marshedge is 10 + 4 = 14, so the solver has to prefer the shorter way.
		const route = to(routes, "three-coven-lake");
		expect(route.legs.map(l => l.to)).toEqual(["the-steplands", "three-coven-lake"]);
		expect(route.total.days).toEqual({ min: 7, max: 8 });
		expect(atLeastPhrase(route.total)).toBe("at least 7–8 days");
	});

	it("reaches Blackwater Lake in six to seven days", () => {
		// Book II, Blackwater Lake: the Steplands "at least 4 days", "From there... at least 2 days".
		const route = to(routes, "blackwater-lake");
		expect(route.legs.map(l => l.to)).toEqual(["the-steplands", "blackwater-lake"]);
		expect(route.total.days).toEqual({ min: 6, max: 7 });
	});

	it("climbs to Tor's Fist by the Foothills, not the Barrier Pass", () => {
		// The Foothills are 2 days out and 5 from there; Barrier Pass is 5 out and 6 from there.
		const route = to(routes, "tors-fist");
		expect(route.legs.map(l => l.to)).toEqual(["the-foothills", "tors-fist"]);
		expect(route.total.days).toEqual({ min: 7, max: 7 });
	});

	it("gets to Lygos in forty days, which is the season the book says it is", () => {
		// The table only prints Marshedge -> Lygos, 30 days. Marshedge is itself 10 days out, and
		// Book II calls the round trip "an entire season of travel (80-90 days), there and back".
		const route = to(routes, "lygos");
		expect(route.legs.map(l => l.to)).toEqual(["marshedge", "lygos"]);
		expect(route.total.days).toEqual({ min: 40, max: 40 });
		expect(atLeastDays(route.total) * 2).toBe(80);
		expect(atLeastPhrase(route.total)).toBe("at least 40 days");
	});

	it("keeps every printed leg reachable in one hop from the place that prints it", () => {
		for (const leg of TRAVEL_LEGS) {
			const route = to(from(leg.from), leg.to);
			expect(route.legs, `${leg.from} -> ${leg.to}`).toHaveLength(1);
		}
	});
});

describe("mixing the table's hours with its days", () => {
	it("keeps the two apart instead of rounding one into the other", () => {
		// Ruined Tower back to Marshedge: 8-10 hours to Stonetop, then 10 days on. Neither number
		// is rewritten in terms of the other.
		const route = to(from("the-ruined-tower"), "marshedge");
		expect(route.legs.map(l => l.to)).toEqual(["the-crossroads", "stonetop", "marshedge"]);
		expect(route.total).toEqual({ days: { min: 10, max: 10 }, hours: { min: 8, max: 10 } });
		expect(formatTravelTime(route.total)).toBe("10 days and 8–10 hours");
	});

	it("still answers the checklist's day count, rolling the part-day up", () => {
		const route = to(from("the-ruined-tower"), "marshedge");
		expect(atLeastDays(route.total)).toBe(11);
	});

	it("does not invent a day count for an afternoon's walk", () => {
		const route = to(from(), "the-red-grove");
		expect(route.total.days).toEqual({ min: 0, max: 0 });
		expect(formatTravelTime(route.total)).toBe("4–6 hours");
	});
});

describe("the graph is symmetric and total", () => {
	it("takes the same time in either direction", () => {
		for (const place of TRAVEL_PLACES) {
			const there = to(from(), place.slug);
			const back  = to(from(place.slug), "stonetop");
			expect(back.total, `${place.slug} home`).toEqual(there.total);
		}
	});

	it("reaches every place from home", () => {
		const routes = from();
		for (const place of TRAVEL_PLACES) {
			expect(routes.has(place.slug), `${place.slug} unreachable`).toBe(true);
		}
	});

	it("costs nothing to be where you already are", () => {
		const route = to(from(), "stonetop");
		expect(route.legs).toEqual([]);
		expect(route.total).toEqual({ days: { min: 0, max: 0 }, hours: { min: 0, max: 0 } });
		expect(formatTravelTime(route.total)).toBe("no time at all");
		expect(atLeastDays(route.total)).toBe(0);
	});

	it("returns nothing at all for a place the table never names", () => {
		expect(solveTravel("atlantis").size).toBe(0);
		expect(to(from(), "atlantis")).toBeUndefined();
	});

	it("picks the same route every time it is asked", () => {
		const once = to(from(), "three-coven-lake").legs.map(l => l.to);
		const twice = to(from(), "three-coven-lake").legs.map(l => l.to);
		expect(twice).toEqual(once);
	});
});

describe("the marching day only ever breaks a tie", () => {
	it("chooses the same routes at eight, nine and ten hours to the day", () => {
		// Every day-scale leg dwarfs every hour-scale one, so no figure in the band the book
		// implies can reorder a route. That is what licenses picking a number at all.
		const legs = TRAVEL_LEGS;
		const rescaled = hours => solveTravel("stonetop", {
			places: TRAVEL_PLACES,
			// Re-express day legs in hours at the trial rate, which is exactly what the internal
			// comparison does, so an ordering that survives this survives the choice of constant.
			legs: legs.map(l => l.unit === "days"
				? { ...l, min: l.min * hours, max: l.max * hours, unit: "hours" }
				: l),
		});
		const shape = routes => [...routes.keys()].sort()
			.map(k => `${k}:${routes.get(k).legs.map(l => l.to).join(">")}`);
		const baseline = shape(rescaled(MARCH_HOURS));
		expect(shape(rescaled(8))).toEqual(baseline);
		expect(shape(rescaled(10))).toEqual(baseline);
		expect(shape(rescaled(24))).toEqual(baseline);
	});
});

describe("phrasing a route", () => {
	const lygos = to(from(), "lygos");

	it("names the stops along the way, and only those", () => {
		expect(stopsAlongTheWay(lygos)).toEqual(["Marshedge"]);
		expect(stopsAlongTheWay(to(from(), "marshedge"))).toEqual([]);
	});

	it("writes the route as one line", () => {
		expect(routeLine(lygos)).toBe("Stonetop to Marshedge to Lygos");
		expect(routeLine(to(from(), "stonetop"))).toBe("Stonetop");
	});

	it("writes a line per leg, keeping the road the book credits", () => {
		expect(routeLegLines(lygos)).toEqual([
			"Stonetop to Marshedge, 10 days (via the Roads)",
			"Marshedge to Lygos, 30 days",
		]);
	});

	it("says days in the singular when there is only one", () => {
		expect(formatTravelTime({ days: { min: 1, max: 1 }, hours: { min: 0, max: 0 } })).toBe("1 day");
		expect(formatTravelTime({ days: { min: 1, max: 2 }, hours: { min: 0, max: 0 } })).toBe("1–2 days");
	});
});

// ONE definition of what a trip's stored pick means, because three callers need it and they have
// to agree: the walkthrough draws from it, the carry-forward onto Chart a Course ticks from it,
// and the Chronicle compiler prints from it.
// What a trip with nothing drawn on it reads back as. Every stored journey now carries the
// hand-drawn way alongside the two slugs, ticked on or not, because `journeyRoute` dispatches
// on it and four callers read the answer.
const NO_DRAWN_WAY = { on: false, tier: null, points: [] };

describe("reading a stored journey", () => {
	it("defaults the origin to home and leaves an unset destination null", () => {
		expect(normalizeJourney(undefined)).toEqual({ origin: "stonetop", destination: null, custom: NO_DRAWN_WAY });
		expect(normalizeJourney({})).toEqual({ origin: "stonetop", destination: null, custom: NO_DRAWN_WAY });
	});

	it("drops a slug the table has never heard of, rather than passing it through", () => {
		expect(normalizeJourney({ origin: "atlantis", destination: "narnia" }))
			.toEqual({ origin: "stonetop", destination: null, custom: NO_DRAWN_WAY });
	});

	it("treats a place you are already standing in as no destination", () => {
		expect(normalizeJourney({ origin: "marshedge", destination: "marshedge" }).destination).toBeNull();
		expect(journeyRoute({ origin: "marshedge", destination: "marshedge" })).toBeNull();
	});

	it("solves the stored pick, and only when it is a journey", () => {
		expect(routeLine(journeyRoute({ origin: "stonetop", destination: "lygos" })))
			.toBe("Stonetop to Marshedge to Lygos");
		expect(journeyRoute(null)).toBeNull();
	});
});

describe("filling the Chart a Course blanks", () => {
	const DAYS = "It'll take at least ___ days (and a corresponding amount of supplies)";
	const FIRST = "First travel to ___, and from there to your destination";
	const lygos = to(from(), "lygos");

	it("fills the day count from the route", () => {
		expect(fillChartBlank(DAYS, "days", lygos))
			.toBe("It'll take at least 40 days (and a corresponding amount of supplies)");
	});

	it("names the place you must reach first", () => {
		expect(fillChartBlank(FIRST, "firstTravel", lygos))
			.toBe("First travel to Marshedge, and from there to your destination");
	});

	it("leaves the blank alone when the route cannot answer it", () => {
		const marshedge = to(from(), "marshedge");           // one leg, no stop on the way
		expect(fillChartBlank(FIRST, "firstTravel", marshedge)).toBe(FIRST);

		const grove = to(from(), "the-red-grove");            // hours only, so no day count
		expect(fillChartBlank(DAYS, "days", grove)).toBe(DAYS);
	});

	it("leaves every other requirement untouched", () => {
		const other = "Watch out for ___";
		expect(fillChartBlank(other, "watchOut", lygos)).toBe(other);
		expect(fillChartBlank(DAYS, "days", null)).toBe(DAYS);
	});

	// The tick and the fill ask ONE question, because a box ticked over a requirement still
	// reading "at least ___ days" tells the GM the answer was worked out and then declines to say
	// what it is. Five of the eighteen destinations from Stonetop are measured only in hours.
	it("answers the tick and the text from the same predicate, for every destination", () => {
		const routes = from();
		const hourly = [];
		for (const [slug, route] of routes) {
			if (!route.legs.length) continue;
			for (const [key, text] of [["days", DAYS], ["firstTravel", FIRST]]) {
				const value = chartBlankValue(key, route);
				const filled = fillChartBlank(text, key, route);
				// Either both happen or neither does. Never a tick over an unfilled blank.
				expect(value === null, `${slug}.${key}`).toBe(filled === text);
			}
			if (chartBlankValue("days", route) === null) hourly.push(slug);
		}
		expect(hourly.sort()).toEqual([
			"cave-bears-den", "the-crossroads", "the-maw", "the-red-grove", "the-ruined-tower",
		]);
	});
});

// ── A way the GM drew, rather than the one the table would have taken ────────
//
// `journeyRoute` answers with either, in one shape, and that is the whole reason it dispatches in
// one place: four readers depend on it — the walkthrough's readout, the Chart a Course
// carry-forward, the Scene painter and the Chronicle — and none of them should have to ask which
// sort of route it is holding.

/** A trip with a way drawn on one map. */
const drawnTrip = (points, { origin = "stonetop", tier = "worlds-end" } = {}) =>
	({ origin, destination: "lygos", custom: { on: true, tier, points } });

describe("a route the GM drew", () => {
	it("is what the trip answers with once the box is ticked", () => {
		const route = journeyRoute(drawnTrip([{ fx: 0.5, fy: 0.5 }]));
		expect(route.custom).toBe(true);
		expect(route.tier).toBe("worlds-end");
		expect(route.legs.map(l => l.fromName)).toEqual(["Stonetop"]);
		expect(route.legs.map(l => l.toName)).toEqual(["point 1"]);
	});

	// The destination is remembered while the box is ticked, and it is not what the line is about.
	it("leaves the table's own answer untouched underneath it", () => {
		const trip = drawnTrip([{ fx: 0.5, fy: 0.5 }]);
		expect(journeyRoute({ ...trip, custom: { ...trip.custom, on: false } }).legs.map(l => l.to))
			.toEqual(["marshedge", "lygos"]);
	});

	it("is no route at all until a mark is put down", () => {
		expect(journeyRoute(drawnTrip([]))).toBeNull();
	});

	// A LEG THE TABLE ALREADY PRICES KEEPS THE PRINTED TIME. If the GM drew one straight leg from
	// Stonetop to Marshedge, the book has measured that journey and a ruler has no business
	// second-guessing it. The estimate is for the legs the book never printed.
	it("keeps the book's own time for a leg the book prices", () => {
		const [leg] = journeyRoute(drawnTrip([{ slug: "marshedge" }])).legs;
		expect(leg.time).toBe("10 days");
		expect(leg.via).toBe("the Roads");
		expect(leg.estimated).toBe(false);
	});

	it("estimates a leg that touches a mark of the GM's own", () => {
		const [leg] = journeyRoute(drawnTrip([{ fx: 0.62, fy: 0.66 }])).legs;
		expect(leg.estimated).toBe(true);
		expect(leg.via).toBeNull();
		expect(leg.time).toMatch(/\d+(–\d+)? days?/);
	});

	// The usual road with a detour bent into it: the common case, and the one a GM cannot get any
	// other way. The printed leg keeps its ten days; the two drawn ones are measured.
	it("adds the printed and the measured together", () => {
		const route = journeyRoute(drawnTrip([
			{ slug: "marshedge" }, { fx: 0.75, fy: 0.8 }, { slug: "lygos" },
		]));
		expect(route.legs.map(l => l.estimated)).toEqual([false, true, true]);
		expect(route.estimated).toBe(true);
		expect(route.total.days.min).toBeGreaterThan(10);
	});

	// A leg whose ends this map cannot both place gets no time rather than a made-up one — the
	// ordinary state of a way whose origin has been moved somewhere the picture does not letter.
	it("gives no time to a leg it cannot measure", () => {
		const [leg] = journeyRoute(drawnTrip([{ fx: 0.5, fy: 0.5 }], { origin: "tors-fist", tier: "vicinity" })).legs;
		expect(leg.time).toBeNull();
		expect(leg.min).toBe(0);
		expect(routeLegLines({ legs: [leg] })).toEqual(["Tor's Fist to point 1"]);
	});

	// Chart a Course's blank reads "you must first travel to ___", and filling it with "point 2"
	// would hand the GM a requirement they cannot say out loud.
	it("names only the lettered stops as places to travel to first", () => {
		const route = journeyRoute(drawnTrip([
			{ fx: 0.5, fy: 0.5 }, { slug: "marshedge" }, { slug: "lygos" },
		]));
		expect(stopsAlongTheWay(route)).toEqual(["Marshedge"]);
		expect(chartBlankValue("firstTravel", route)).toBe("Marshedge");
	});
});

// "At least" is a promise about the FLOOR: the table printed these times, so the journey cannot be
// quicker. A way measured off the map with a ruler has made no such promise.
describe("what the headline time promises", () => {
	it("says at least, for a route the book priced", () => {
		expect(routePhrase(journeyRoute({ origin: "stonetop", destination: "lygos" })))
			.toBe("at least 40 days");
	});

	it("says roughly, the moment any leg of it was measured", () => {
		expect(routePhrase(journeyRoute(drawnTrip([{ fx: 0.62, fy: 0.66 }])))).toMatch(/^roughly /);
	});

	// A drawn way that happens to follow priced legs is not an estimate, and should not read as one.
	it("says at least again for a drawn way the table prices every leg of", () => {
		expect(routePhrase(journeyRoute(drawnTrip([{ slug: "marshedge" }])))).toBe("at least 10 days");
	});

	it("has nothing to promise about no journey", () => {
		expect(routePhrase(null)).toBe("no travel at all");
	});
});

// What `sceneShowsJourney` compares: whether the map in front of the table is showing THIS way.
describe("telling one way from another", () => {
	it("ignores a destination the drawn way is not about", () => {
		const a = drawnTrip([{ fx: 0.5, fy: 0.5 }]);
		expect(journeyKey({ ...a, destination: "marshedge" })).toBe(journeyKey(a));
	});

	it("notices a mark moved, added or taken back", () => {
		const one = journeyKey(drawnTrip([{ fx: 0.5, fy: 0.5 }]));
		expect(journeyKey(drawnTrip([{ fx: 0.5, fy: 0.6 }]))).not.toBe(one);
		expect(journeyKey(drawnTrip([{ fx: 0.5, fy: 0.5 }, { fx: 0.6, fy: 0.6 }]))).not.toBe(one);
		expect(journeyKey(drawnTrip([]))).not.toBe(one);
	});

	it("notices the box being ticked off, and where they set out from", () => {
		const drawn = drawnTrip([{ fx: 0.5, fy: 0.5 }]);
		expect(journeyKey({ ...drawn, custom: { ...drawn.custom, on: false } })).not.toBe(journeyKey(drawn));
		expect(journeyKey({ ...drawn, origin: "marshedge" })).not.toBe(journeyKey(drawn));
	});

	it("says nothing different about two trips bound the same way by the table", () => {
		expect(journeyKey({ origin: "stonetop", destination: "lygos" }))
			.toBe(journeyKey({ origin: "stonetop", destination: "lygos", custom: { on: false } }));
	});
});
