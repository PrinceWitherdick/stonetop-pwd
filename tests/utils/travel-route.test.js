import { describe, it, expect } from "vitest";
import {
	solveFrom, solveTravel, formatTravelTime, atLeastPhrase, atLeastDays,
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
// And where it sets out from, which is a place OR a mark the GM put down: `origin` is the start's
// slug (null for a mark) and `start` is the whole of it. See utils/journey-start.js.
const HOME_START = { slug: "stonetop", tier: null, fx: null, fy: null };

describe("reading a stored journey", () => {
	it("defaults the origin to home and leaves an unset destination null", () => {
		const home = { origin: "stonetop", start: HOME_START, destination: null, custom: NO_DRAWN_WAY };
		expect(normalizeJourney(undefined)).toEqual(home);
		expect(normalizeJourney({})).toEqual(home);
	});

	it("drops a slug the table has never heard of, rather than passing it through", () => {
		expect(normalizeJourney({ origin: "atlantis", destination: "narnia" }))
			.toEqual({ origin: "stonetop", start: HOME_START, destination: null, custom: NO_DRAWN_WAY });
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
const drawnTrip = (points, { origin = "stonetop", tier = "worlds-end", destination = "lygos" } = {}) =>
	({ origin, destination, custom: { tier, points } });

describe("a route the GM drew", () => {
	it("is what the trip answers with as soon as there is a mark on the map", () => {
		const route = journeyRoute(drawnTrip([{ fx: 0.5, fy: 0.5 }]));
		expect(route.custom).toBe(true);
		expect(route.tier).toBe("worlds-end");
		expect(route.legs.map(l => l.fromName)).toEqual(["Stonetop"]);
		expect(route.legs.map(l => l.toName)).toEqual(["point 1"]);
	});

	// The destination is remembered while a way is drawn, and it is not what the line is about —
	// so taking the marks back is all it takes to have the table's answer again. The marks ARE the
	// mode (`normalizeCustom`): there is no flag to unset, and a stored one is ignored.
	it("leaves the table's own answer untouched underneath it", () => {
		const trip = drawnTrip([{ fx: 0.5, fy: 0.5 }]);
		expect(journeyRoute({ ...trip, custom: { ...trip.custom, points: [] } }).legs.map(l => l.to))
			.toEqual(["marshedge", "lygos"]);
		// And a stored `on` from the days of the checkbox does not resurrect a way with no marks.
		expect(journeyRoute({ origin: "stonetop", destination: "lygos", custom: { on: true, tier: "worlds-end", points: [] } })
			.legs.map(l => l.to)).toEqual(["marshedge", "lygos"]);
	});

	it("is no route at all with no marks and nowhere to go", () => {
		expect(journeyRoute(drawnTrip([], { destination: null }))).toBeNull();
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

	it("notices the last mark going back, and where they set out from", () => {
		const drawn = drawnTrip([{ fx: 0.5, fy: 0.5 }]);
		// The way is over when its marks are, so the key goes back to naming the table's own route.
		expect(journeyKey({ ...drawn, custom: { ...drawn.custom, points: [] } }))
			.toBe("table|stonetop|lygos");
		expect(journeyKey({ ...drawn, origin: "marshedge" })).not.toBe(journeyKey(drawn));
	});

	it("says nothing different about two trips bound the same way by the table", () => {
		expect(journeyKey({ origin: "stonetop", destination: "lygos" }))
			.toBe(journeyKey({ origin: "stonetop", destination: "lygos", custom: { tier: "worlds-end", points: [] } }));
	});
});

// ── Setting out from a point the GM put down ─────────────────────────────────
//
// The far end of a trip has always been able to be anywhere: a way laid out by hand ends wherever
// the GM last clicked, priced off the map where the book prices nothing. The near end could not,
// and a party camped in the Flats had to claim they were leaving Stonetop.
//
// WHAT THIS HAS TO PROTECT is that gaining that did not cost the travel table. A mark joins the
// book's own graph at the nearest few places its map draws and is solved from there, so an answer
// is one measured leg plus the roads Book II prints — not a ruler laid across the whole country.
describe("solving from a mark on the map", () => {
	// A point in the Vicinity's Bottomlands, south-west of Stonetop.
	const inTheFlats = { tier: "vicinity", fx: 0.36, fy: 0.62 };

	it("answers for every place the table can reach, which the table's own origin does not", () => {
		const fromHome = solveFrom("stonetop");
		const fromMark = solveFrom(inTheFlats);
		// Home is the one place with no route FROM home, so the mark answers for one more.
		expect(fromHome.get("stonetop").legs).toHaveLength(0);
		expect(fromMark.get("stonetop").legs.length).toBeGreaterThan(0);
		for (const place of TRAVEL_PLACES) {
			expect(fromMark.get(place.slug)?.legs?.length, place.name).toBeGreaterThan(0);
		}
	});

	// The whole point of joining the graph rather than measuring straight to everywhere: the book
	// printed ten days to Marshedge and this has no business second-guessing it with a ruler.
	it("keeps the book's printed legs, and estimates only the walk onto them", () => {
		const route = solveFrom(inTheFlats).get("marshedge");
		expect(route.legs[0].estimated).toBe(true);
		expect(route.legs.slice(1).every(leg => !leg.estimated)).toBe(true);
		const printed = route.legs.find(leg => leg.to === "marshedge");
		expect(printed.time).toBe("10 days");
		expect(printed.via).toBe("the Roads");
	});

	// A leg has to start SOMEWHERE the renderers can place, and a mark carries its own position —
	// the same bare-stop shape the far end of a hand-drawn way already has.
	it("starts on a bare stop carrying its own fraction, named for its map", () => {
		const first = solveFrom(inTheFlats).get("marshedge").legs[0];
		expect(first.from).toBeNull();
		expect(first.fromSpot).toEqual({ fx: 0.36, fy: 0.62 });
		expect(first.fromName).toBe("a point on The Vicinity");
	});

	// A fraction of the Vicinity means a different valley on the World's End, so the route belongs
	// to one map exactly as a hand-drawn way does. `custom` stays false: nobody drew this.
	it("pins the route to the mark's own map without calling it hand-drawn", () => {
		const route = journeyRoute({ origin: inTheFlats, destination: "marshedge" });
		expect(route.pinned).toBe(true);
		expect(route.tier).toBe("vicinity");
		expect(route.custom).toBeFalsy();
	});

	// Any guess at all makes the whole answer a guess, which is what turns "at least" into
	// "roughly" — the difference between a floor the book printed and a figure got with a ruler.
	it("words the total as an estimate, and says so on the route", () => {
		const route = journeyRoute({ origin: inTheFlats, destination: "marshedge" });
		expect(route.estimated).toBe(true);
		expect(routePhrase(route)).toMatch(/^roughly /);
	});

	// The virtual node the solve runs through is a convenience, not a place. Its slug appearing in
	// a leg, a readout or a Chronicle line would be a name nothing could resolve.
	it("never lets its own solving node out", () => {
		const routes = solveFrom(inTheFlats);
		for (const [slug, route] of routes) {
			expect(slug.startsWith("@")).toBe(false);
			for (const leg of route.legs) {
				expect(leg.from ?? "").not.toMatch(/^@/);
				expect(leg.to ?? "").not.toMatch(/^@/);
				expect(leg.fromName).not.toMatch(/^@/);
			}
		}
	});

	// "You must first travel to ___" is read out at the table, and "a point on The Vicinity" is not
	// a thing a GM can say into that blank.
	it("does not offer the mark as somewhere to travel to first", () => {
		const route = journeyRoute({ origin: inTheFlats, destination: "marshedge" });
		expect(stopsAlongTheWay(route)).not.toContain("a point on The Vicinity");
		expect(chartBlankValue("firstTravel", route)).toBe("the Crossroads");
	});

	// The Scene button compares journeys through this key. Every mark start shares one null slug,
	// so keying on that would leave a Scene certain it was showing a line the party had moved off.
	it("keys on the mark, so moving it moves the journey", () => {
		const a = journeyKey({ origin: inTheFlats, destination: "marshedge" });
		const b = journeyKey({ origin: { ...inTheFlats, fx: 0.5 }, destination: "marshedge" });
		const home = journeyKey({ origin: "stonetop", destination: "marshedge" });
		expect(a).not.toBe(b);
		expect(a).not.toBe(home);
		// And it is stable: the same mark read twice is the same journey.
		expect(a).toBe(journeyKey({ origin: { tier: "vicinity", fx: 0.36, fy: 0.62 }, destination: "marshedge" }));
	});

	// "10 days and 7-11 hours" is a printed road with a measured walk stapled to the end of it, and
	// eighteen of those down the destination list is a column of noise that squeezes out the place
	// names. Said in one unit it is an answer a GM can read at a glance.
	it("says a total in one unit when a measured walk would otherwise be stapled to printed days", () => {
		const route = journeyRoute({ origin: inTheFlats, destination: "marshedge" });
		expect(route.total.hours).toEqual({ min: 0, max: 0 });
		expect(formatTravelTime(route.total)).toBe("11–12 days");
		// And the Chart a Course blank counts from it exactly as it always did.
		expect(chartBlankValue("days", route)).toBe("11");
	});

	// AND ONLY THEN, which is where this parts company with a hand-drawn way on purpose. That one
	// piles up its own measured hour-legs until "roughly 13-22 hours" hides three days of marching,
	// so it is converted whole. A route setting out from a mark carries a short chain of hours —
	// exactly what Book II itself prints in hours — and re-saying "12-18 hours to the Maw" as
	// "2 days" would be less faithful than the book, not more.
	it("leaves a short chain of hours in hours, as the book prints them", () => {
		const route = journeyRoute({ origin: inTheFlats, destination: "the-maw" });
		expect(route.total.days).toEqual({ min: 0, max: 0 });
		expect(formatTravelTime(route.total)).toBe("12–18 hours");
		// Measured only in hours, so there is no day count for the blank to take.
		expect(chartBlankValue("days", route)).toBeNull();
	});

	// A way laid out by hand from a mark: the first leg is measured off the map like any other
	// unpriced one, and the stops are the marks the GM placed with the start ahead of them.
	it("lets a hand-drawn way set out from one too", () => {
		const route = journeyRoute({
			origin: inTheFlats,
			custom: { tier: "vicinity", points: [{ fx: 0.5, fy: 0.4 }, { slug: "gordins-delve" }] },
		});
		expect(route.legs[0].fromName).toBe("a point on The Vicinity");
		expect(route.legs[0].fromSpot).toEqual({ fx: 0.36, fy: 0.62 });
		expect(route.legs[0].toName).toBe("point 1");
		expect(route.stops[0].mark).toBeNull();
	});

	// THE PANEL NORMALIZES BEFORE IT HANDS THE PICK ON, and both `showRouteOnScene` and
	// `journeyKey` normalize what they are given — so the answer has to survive a second pass. It
	// did not: `origin` is the start's slug and therefore null for a mark, so reading it back
	// turned every hand-placed start into nowhere. The route then solved from nowhere and the
	// Scene stayed bare while the GM was told the line had been drawn on it.
	it("survives being read twice, mark and all", () => {
		const once = normalizeJourney({ origin: inTheFlats, destination: "marshedge" });
		expect(once.start).toEqual({ slug: null, tier: "vicinity", fx: 0.36, fy: 0.62 });
		expect(normalizeJourney(once)).toEqual(once);
		// Which is what the Scene painter and the button's own label actually depend on.
		expect(journeyRoute(once).legs.length).toBeGreaterThan(0);
	});

	// Two marks a long way apart are not the same journey, however many times the pick has been
	// read. Keying an already-read pick on the null slug made every one of them the empty string,
	// so the button reported the Scene in step after the GM moved where the party sets out from.
	it("keys a re-read pick on the mark, not on the null slug every mark shares", () => {
		const here = normalizeJourney({ origin: inTheFlats, destination: "marshedge" });
		const there = normalizeJourney({
			origin: { tier: "vicinity", fx: 0.7, fy: 0.2 }, destination: "marshedge",
		});
		expect(journeyKey(here)).not.toBe(journeyKey(there));
		// And a re-read pick keys the same as the stored trip it was read from.
		expect(journeyKey(here)).toBe(journeyKey({ origin: inTheFlats, destination: "marshedge" }));
	});

	// A start somebody deliberately peeled off must not come back as home on the second reading:
	// `storedStart` tells those two apart by an explicit null, and a normalized pick carries the
	// answer in `start` instead.
	it("keeps a start that was peeled off peeled off", () => {
		const nowhere = normalizeJourney({ origin: null, destination: "marshedge" });
		expect(nowhere.start).toEqual({ slug: null, tier: null, fx: null, fy: null });
		expect(normalizeJourney(nowhere)).toEqual(nowhere);
		expect(journeyKey(normalizeJourney(nowhere))).toBe(journeyKey(nowhere));
	});
});
