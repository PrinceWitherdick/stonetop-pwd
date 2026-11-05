import { describe, it, expect } from "vitest";
import {
	MARK_PRECISION, arrowOnly, arrowRemainder, customStops, customTierFor, estimateSpan, insideMap,
	markSpot, nearestPlace, normalizeCustom, placeSpot, pricedLeg, sameMark, seedMarks, spanOfHours,
	spotDistance, tierPace, withMark,
} from "../../module/utils/custom-route.js";
import { BOOK_LEGS, MARCH_HOURS, TRAVEL_MAPS, travelPlace } from "../../module/data/travel-times.js";
import { journeyRoute } from "../../module/utils/travel-route.js";

// The way they go when the GM draws it rather than letting the travel table pick the road.
//
// Two halves, and they fail in very different ways. The MARKS are bookkeeping — what a stored
// point means, what the three gestures do to a run of them — and a mistake there loses somebody's
// route. The PACE is a measurement, fitted to the book's own printed journeys, and a mistake there
// is worse than losing anything: it puts a plausible number in front of a GM who is about to tell
// the table "it'll take at least six days".

const drawn = (tier, points, on = true) => ({ on, tier, points });

describe("reading a stored path", () => {
	it("takes a tier and a run of marks", () => {
		expect(normalizeCustom(drawn("vicinity", [{ slug: "the-maw" }, { fx: 0.4, fy: 0.6 }])))
			.toEqual({ on: true, tier: "vicinity", points: [{ slug: "the-maw" }, { fx: 0.4, fy: 0.6 }] });
	});

	// A mark is a fraction of one particular picture. With no picture named there is nothing any of
	// them could mean, so the whole path goes rather than leaving marks floating.
	it("throws the marks away with the map they were on", () => {
		expect(normalizeCustom(drawn("narnia", [{ fx: 0.4, fy: 0.6 }])))
			.toEqual({ on: false, tier: null, points: [] });
		expect(normalizeCustom(undefined)).toEqual({ on: false, tier: null, points: [] });
	});

	it("drops a mark that is not a fraction of anything", () => {
		const path = normalizeCustom(drawn("vicinity", [
			{ fx: 0.4, fy: 0.6 }, { fx: 1.4, fy: 0.6 }, { fx: -1, fy: 0.2 },
			{ fx: "left", fy: 0.2 }, {}, null,
		]));
		expect(path.points).toEqual([{ fx: 0.4, fy: 0.6 }]);
	});

	// The comparison is what this is really for: the Scene button asks whether the map in front of
	// the table is already showing this path by matching the marks, and a float at full precision
	// through a JSON round trip is a mark that can stop matching itself.
	it("rounds a hand-placed fraction to a fixed precision", () => {
		const [mark] = normalizeCustom(drawn("vicinity", [{ fx: 0.123456789, fy: 0.5 }])).points;
		expect(mark.fx).toBe(Number((0.123456789).toFixed(MARK_PRECISION)));
	});

	// A named mark stores NO position, so a corrected coordinate in the table reaches a path drawn
	// last season. What it does have to do is name somewhere this map actually letters.
	it("keeps a named stop the map letters, and refuses one it does not", () => {
		expect(normalizeCustom(drawn("vicinity", [{ slug: "the-maw" }])).points).toEqual([{ slug: "the-maw" }]);
		// Marshedge is a World's End place; the Vicinity only has an arrow pointing that way, and
		// that arrow names two places so it names neither.
		expect(normalizeCustom(drawn("vicinity", [{ slug: "marshedge" }])).points).toEqual([]);
	});

	// Lygos is drawn on no map at all, and the corner of the World's End that says "To Lygos & the
	// South" is the only thing in the books that points at it. Leaving the arrows out would mean a
	// hand-drawn way could never end anywhere past the border.
	it("takes an edge arrow that names a place", () => {
		expect(markSpot("worlds-end", "lygos")).toBeTruthy();
		expect(normalizeCustom(drawn("worlds-end", [{ slug: "lygos" }])).points).toEqual([{ slug: "lygos" }]);
	});

	// An anchor is a position the route line may pass through and nothing a reader can click: the
	// Crossroads' spot on the continental map is a hint about which way to leave Stonetop, not a
	// claim about where the Crossroads is.
	it("refuses an anchor as somewhere to put a mark", () => {
		expect(placeSpot("worlds-end", "the-crossroads")).toBeNull();
		expect(markSpot("worlds-end", "the-crossroads")).toBeNull();
	});

	// But no click lays one: it arrives by `seedMarks`, standing for a stop on the table's own
	// route, and reading it back as nothing is what turned 2 + 5 days to Tor's Fist into a ruler's
	// "roughly 3-4 days".
	it("keeps an anchored stop the table seeded", () => {
		expect(normalizeCustom(drawn("worlds-end", [{ slug: "the-crossroads" }])).points)
			.toEqual([{ slug: "the-crossroads" }]);
		const stops = customStops("stonetop", drawn("worlds-end", [{ slug: "the-foothills" }, { slug: "tors-fist" }]));
		expect(stops[1].spot).toEqual(travelPlace("the-foothills").spots["worlds-end"]);
	});

	// Two clicks on the same pin made a leg from Marshedge to Marshedge.
	it("reads a stop repeated back to back as one stop", () => {
		expect(normalizeCustom(drawn("worlds-end", [
			{ slug: "marshedge" }, { slug: "marshedge" }, { fx: 0.5, fy: 0.5 }, { fx: 0.50001, fy: 0.5 },
		])).points).toEqual([{ slug: "marshedge" }, { fx: 0.5, fy: 0.5 }]);
	});
});

describe("the run of stops a path describes", () => {
	it("starts at the origin, which is not one of the stored marks", () => {
		const stops = customStops("stonetop", drawn("vicinity", [{ fx: 0.4, fy: 0.6 }]));
		expect(stops.map(s => s.name)).toEqual(["Stonetop", "point 1"]);
		expect(stops[0].slug).toBe("stonetop");
	});

	// The numeral is what the readout's leg list calls the stop, and it is what the map badges it
	// with, so a line in the list and a dot on the picture are visibly the same thing. Counted over
	// the MARKS the GM placed, so a way passing through a lettered place leaves no gap.
	it("numbers the bare marks, and lets the lettered ones keep their names", () => {
		const stops = customStops("stonetop", drawn("vicinity", [
			{ fx: 0.4, fy: 0.6 }, { slug: "the-maw" }, { fx: 0.5, fy: 0.2 },
		]));
		expect(stops.map(s => s.name)).toEqual(["Stonetop", "point 1", "the Maw", "point 2"]);
		expect(stops.map(s => s.mark)).toEqual([null, 1, null, 2]);
	});

	it("resolves every stop to somewhere on the map", () => {
		const stops = customStops("stonetop", drawn("vicinity", [{ slug: "the-maw" }, { fx: 0.4, fy: 0.6 }]));
		expect(stops.every(s => s.spot)).toBe(true);
		expect(stops.at(-1).spot).toEqual({ fx: 0.4, fy: 0.6 });
	});

	// The origin is laxer by exactly one thing. A journey setting out from the Crossroads has to
	// start SOMEWHERE on the continental map, and the anchor is where the table itself draws it —
	// refusing it would leave the first leg unplaced and the whole line refused.
	it("lets the origin stand on an anchor, which no mark may", () => {
		const stops = customStops("the-crossroads", drawn("worlds-end", [{ slug: "marshedge" }]));
		expect(stops[0].spot).toBeTruthy();
	});

	it("has nothing to say about a path with no map", () => {
		expect(customStops("stonetop", drawn("narnia", [{ fx: 0.4, fy: 0.6 }]))).toEqual([]);
	});
});

describe("the three gestures", () => {
	const a = { fx: 0.1, fy: 0.1 };
	const b = { fx: 0.2, fy: 0.2 };
	const c = { fx: 0.3, fy: 0.3 };

	it("moves the far end on a plain click", () => {
		expect(withMark([a, b], c)).toEqual([a, c]);
	});

	it("adds a leg on a shift-click", () => {
		expect(withMark([a, b], c, { append: true })).toEqual([a, b, c]);
	});

	it("takes the last leg back on a right-click", () => {
		expect(withMark([a, b], null, { undo: true })).toEqual([a]);
	});

	// The plain click is the one a reader tries first, and on an empty path there is no far end to
	// move. Without this it would do nothing at all on the very first click.
	it("lays the first mark down however it was pressed", () => {
		expect(withMark([], c)).toEqual([c]);
		expect(withMark([], c, { append: true })).toEqual([c]);
	});

	// The same array back means "nothing happened", which is what lets a caller skip a world-setting
	// write, a re-render and a sweep of every open map window for a right-click on an empty map.
	it("answers with the very same run when nothing would change", () => {
		const empty = [];
		expect(withMark(empty, null, { undo: true })).toBe(empty);
		expect(withMark(empty, null)).toBe(empty);
	});

	it("never mutates what it was handed", () => {
		const run = [a, b];
		withMark(run, c);
		withMark(run, c, { append: true });
		withMark(run, null, { undo: true });
		expect(run).toEqual([a, b]);
	});

	// The same stop pressed twice adds nothing, and says so with the same array so no write is made.
	it("does nothing when the press lands on the stop already at the end", () => {
		const run = [a, { slug: "marshedge" }];
		expect(withMark(run, { slug: "marshedge" }, { append: true })).toBe(run);
		expect(withMark(run, { slug: "marshedge" })).toBe(run);
		expect(withMark([a], { fx: 0.1, fy: 0.1 }, { append: true })).toEqual([a]);
		expect(sameMark({ slug: "marshedge" }, { fx: 0.1, fy: 0.1 })).toBe(false);
	});
});

describe("what the box hands you to start from", () => {
	// Ticking it should not empty the map: the way they were going is nearly always the way they
	// are still going plus a detour, so the honest first state is the route already drawn.
	it("seeds the solved route's stops, origin excluded", () => {
		const route = journeyRoute({ origin: "stonetop", destination: "lygos" });
		expect(seedMarks(route, "worlds-end")).toEqual([{ slug: "marshedge" }, { slug: "lygos" }]);
	});

	// A way to Tor's Fist seeded onto the Vicinity comes back as far as the Foothills, which is
	// exactly as far as that picture can honestly draw it. The rest is the GM's to lay in.
	it("stops where the map does", () => {
		const route = journeyRoute({ origin: "stonetop", destination: "tors-fist" });
		expect(route.legs.map(l => l.to)).toEqual(["the-foothills", "tors-fist"]);
		expect(seedMarks(route, "vicinity")).toEqual([{ slug: "the-foothills" }]);
	});

	it("has nothing to seed from a trip with no destination", () => {
		expect(seedMarks(null, "vicinity")).toEqual([]);
	});

	// The World's End draws the Foothills only as an anchor. Seeding without it made the way one
	// ruler-measured leg from Stonetop to Tor's Fist, "roughly 3-4 days" against the book's 2 + 5.
	it("keeps a stop in the middle that this map draws only as an anchor", () => {
		const route = journeyRoute({ origin: "stonetop", destination: "tors-fist" });
		const points = seedMarks(route, "worlds-end");
		expect(points).toEqual([{ slug: "the-foothills" }, { slug: "tors-fist" }]);
		const seeded = journeyRoute({
			origin: "stonetop", destination: "tors-fist", custom: { tier: "worlds-end", points },
		});
		expect(seeded.total.days).toEqual({ min: 7, max: 7 });
		expect(seeded.estimated).toBe(false);
	});

	// And a destination that map draws only as an anchor is no longer dropped from the way.
	it("keeps a destination this map draws only as an anchor", () => {
		const route = journeyRoute({ origin: "stonetop", destination: "the-ruined-tower" });
		expect(seedMarks(route, "worlds-end")).toEqual([{ slug: "the-crossroads" }, { slug: "the-ruined-tower" }]);
	});
});

describe("which map a new path begins on", () => {
	it("stays on the one the reader is looking at", () => {
		expect(customTierFor("stonetop", "worlds-end")).toBe("worlds-end");
		expect(customTierFor("stonetop", "vicinity")).toBe("vicinity");
	});

	// A path whose first stop has nowhere to stand is a path `routePath` refuses outright, so it
	// would come up blank rather than short.
	it("moves to the map that draws the origin when this one cannot", () => {
		expect(customTierFor("marshedge", "vicinity")).toBe("worlds-end");
	});
});

describe("how long a drawn leg takes", () => {
	// A hand-drawn leg has no printed time, so the answer is measured against the ones that do:
	// every priced leg whose ends are both drawn on a tier says what a day's march is worth in
	// inches of paper, and the fit is what they agree on.
	it("fits a band to every map the table draws enough of", () => {
		for (const map of TRAVEL_MAPS) {
			const pace = tierPace(map.slug);
			expect(pace, map.slug).toBeTruthy();
			expect(pace.low).toBeGreaterThan(0);
			expect(pace.high).toBeGreaterThan(pace.low);
		}
	});

	// THE CORRECTION THAT MAKES THE CONTINENTAL NUMBERS MEAN ANYTHING. The Crossroads' anchor sits
	// 4% of the World's End from Stonetop for what the table prices at three hours: read as a
	// measurement that is a pace twenty-eight times too slow, and there are five more like it.
	it("leaves the anchored spots out of the fit", () => {
		// Eleven of the World's End's eighteen priced legs, not all eighteen: the seven it drops
		// are the ones with an anchor at one end. The Maw is the plainest case — it HAS a spot on
		// that map, and that spot is a hint rather than a measurement.
		expect(travelPlace("the-maw").spots["worlds-end"]).toBeTruthy();
		expect(placeSpot("worlds-end", "the-maw")).toBeNull();
		expect(tierPace("worlds-end").n).toBe(11);
		expect(tierPace("vicinity").n).toBe(6);
	});

	// The measurement is only worth having if it reproduces the book. Replayed through the band,
	// the printed time lands inside it for ten of the seventeen legs the fit is made from and within
	// one rounding step for fourteen. It was twelve inside while estimates rounded to the nearest;
	// rounding UP (user ruling, 2026-10-02) lifts the low end of a band by up to a step, so a few
	// quick legs now sit one step under it. The three it misses by two are Marshedge's quick going
	// to the Dread River and Three Coven Lake, and the mountain crossing from Barrier Pass.
	it("reproduces the table's own printed times", () => {
		let inside = 0, near = 0, total = 0;
		for (const map of TRAVEL_MAPS) {
			const pace = tierPace(map.slug);
			// The book's rows: a `ruling` leg is not a measurement to replay.
			for (const leg of BOOK_LEGS) {
				const from = placeSpot(map.slug, leg.from);
				const to = placeSpot(map.slug, leg.to);
				if (!from || !to) continue;
				total++;
				const span = estimateSpan(spotDistance(from, to, map.printedAspect), pace);
				const hours = s => (s === "days" ? MARCH_HOURS : 1);
				const step = hours(span.unit);
				const printed = leg.min * hours(leg.unit);
				const low = span.min * step;
				const high = span.max * step;
				const off = printed < low ? (low - printed) / step : printed > high ? (printed - high) / step : 0;
				if (off === 0) inside++;
				if (off <= 1) near++;
			}
		}
		expect(total).toBe(17);
		expect(inside).toBe(10);
		expect(near).toBe(14);
	});

	// User ruling 2026-10-02: estimates round UP, as `oneUnit` and `atLeastDays` already did.
	// Thirteen hours of march is two days, not one, and splitting a line in two cannot change that.
	it("rounds a measured time up, never to the nearest", () => {
		expect(spanOfHours(13, 17)).toEqual({ min: 2, max: 2, unit: "days" });
		expect(spanOfHours(3.2, 4.1)).toEqual({ min: 4, max: 5, unit: "hours" });
		// Float dust on a whole day is not another day.
		expect(spanOfHours(27.0000000001, 27.0000000001)).toEqual({ min: 3, max: 3, unit: "days" });
		expect(estimateSpan(13, { low: 1, high: 1 })).toEqual({ min: 2, max: 2, unit: "days" });
	});

	// The pace fit is the book's rows only: the ruling legs out of the Crossroads would add a
	// Vicinity sample (the Crossroads to the Foothills) that nobody measured.
	it("fits the pace on the book's printed rows, not the rulings", () => {
		expect(BOOK_LEGS.every(leg => !leg.ruling)).toBe(true);
		expect(tierPace("vicinity").n).toBe(6);
	});

	it("measures a leg in the picture's real proportions, not in raw percentages", () => {
		// The same step across and down a map half again as wide as it is tall is not the same
		// walk. Across is the longer of the two, because the vertical is divided by the aspect.
		const across = spotDistance({ fx: 0, fy: 0 }, { fx: 0.1, fy: 0 }, 1.4);
		const down = spotDistance({ fx: 0, fy: 0 }, { fx: 0, fy: 0.1 }, 1.4);
		expect(across).toBeCloseTo(10, 6);
		expect(down).toBeCloseTo(10 / 1.4, 6);
	});

	it("speaks in whole days once a leg is a day's march, and whole hours below that", () => {
		const pace = { low: 1, high: 1 };
		expect(estimateSpan(MARCH_HOURS, pace).unit).toBe("days");
		expect(estimateSpan(MARCH_HOURS - 1, pace).unit).toBe("hours");
	});

	// A leg drawn at all is a leg somebody walks. "0 hours" is not a thing to tell a GM about a
	// line they can see on the map.
	it("never reports a leg as taking no time", () => {
		const span = estimateSpan(0.0001, { low: 0.1, high: 0.2 });
		expect(span).toEqual({ min: 1, max: 1, unit: "hours" });
	});

	it("has no answer for a leg with an end it cannot place", () => {
		expect(estimateSpan(null, tierPace("vicinity"))).toBeNull();
		expect(estimateSpan(10, null)).toBeNull();
	});
});

describe("an edge arrow is not the place it points at", () => {
	it("knows which places a map shows only by their arrow", () => {
		expect(arrowOnly("worlds-end", "lygos")).toBe(true);
		expect(arrowOnly("vicinity", "gordins-delve")).toBe(true);
		expect(arrowOnly("worlds-end", "gordins-delve")).toBe(false);   // lettered there
		expect(arrowOnly("worlds-end", "the-foothills")).toBe(false);   // an anchor, not an arrow
	});

	// Lygos is thirty days past Marshedge, and the World's End shows only the first few of them.
	it("leaves most of the thirty days to Lygos past the World's End's edge", () => {
		const rest = arrowRemainder("worlds-end", "lygos");
		expect(rest.low).toBeGreaterThan(20 * MARCH_HOURS);
		expect(rest.high).toBeLessThan(30 * MARCH_HOURS);
		expect(rest.high).toBeGreaterThanOrEqual(rest.low);
	});

	it("has no remainder for a place the map letters", () => {
		expect(arrowRemainder("worlds-end", "marshedge")).toBeNull();
	});
});

describe("the table's own row for a pair of places", () => {
	it("finds it either way round", () => {
		expect(pricedLeg("stonetop", "marshedge")?.min).toBe(10);
		expect(pricedLeg("marshedge", "stonetop")?.min).toBe(10);
	});

	it("has none for a pair the table never prints", () => {
		expect(pricedLeg("stonetop", "lygos")).toBeNull();
		expect(pricedLeg("stonetop", null)).toBeNull();
	});
});

describe("a mark the printed map can hold", () => {
	// A map FILE is wider than the page printed on it: MAP_FRAMES insets each crop by a few percent
	// and every surface that takes these clicks shows the whole file. So the margin band is on
	// screen, it is clickable, and `percentSpot` answers a click there with a NEGATIVE fraction.
	// This is the one predicate that says so, offered to the writers as well as read on the way in,
	// so a click refused at the door and a point dropped on the way back cannot come apart.

	it("takes a fraction anywhere on the printed page, edges included", () => {
		expect(insideMap({ fx: 0.5, fy: 0.5 })).toBe(true);
		expect(insideMap({ fx: 0, fy: 0 })).toBe(true);
		expect(insideMap({ fx: 1, fy: 1 })).toBe(true);
	});

	it("refuses the file's margin, which is where the printed page is not", () => {
		expect(insideMap({ fx: -0.03, fy: 0.5 })).toBe(false);
		expect(insideMap({ fx: 0.5, fy: -0.07 })).toBe(false);
		expect(insideMap({ fx: 1.02, fy: 0.5 })).toBe(false);
		expect(insideMap({ fx: 0.5, fy: 1.04 })).toBe(false);
	});

	it("refuses a mark that is not a pair of numbers at all", () => {
		expect(insideMap(null)).toBe(false);
		expect(insideMap(undefined)).toBe(false);
		expect(insideMap({})).toBe(false);
		expect(insideMap({ fx: 0.5 })).toBe(false);
		expect(insideMap({ fx: Number.NaN, fy: 0.5 })).toBe(false);
		// A named place is a mark too, but it carries no fraction: whether the map letters it is a
		// different question, asked by `markSpot`.
		expect(insideMap({ slug: "stonetop" })).toBe(false);
	});

	it("agrees exactly with what normalizeCustom keeps, which is the whole point", () => {
		const marks = [
			{ fx: 0.5, fy: 0.5 }, { fx: 0, fy: 1 }, { fx: -0.03, fy: 0.5 }, { fx: 0.5, fy: 1.04 },
		];
		const kept = normalizeCustom({ on: true, tier: TRAVEL_MAPS[0].slug, points: marks }).points;
		expect(kept).toEqual(marks.filter(insideMap));
	});
});

// Audit ruling E17: a stop laid on one of the GM's sites keeps the site, for the GM; what the
// players hear is a separate `label`, and a bare mark is "near" the nearest lettered place.
describe("what a bare mark is called", () => {
	it("keeps a site's uuid and name, and the players' label, through the round trip", () => {
		const custom = normalizeCustom({ tier: "vicinity", points: [
			{ fx: 0.88, fy: 0.6, siteUuid: "s1", name: "The Sunken Barrow", label: "the shrine", stray: 1 },
			{ fx: 0.3, fy: 0.3, name: "a name with no site" },
		] });
		expect(custom.points).toEqual([
			{ fx: 0.88, fy: 0.6, siteUuid: "s1", name: "The Sunken Barrow", label: "the shrine" },
			{ fx: 0.3, fy: 0.3 },
		]);
		expect(normalizeCustom(custom).points).toEqual(custom.points);
	});

	it("names the stop for its site on the GM's side, and keeps the numeral", () => {
		const stops = customStops("stonetop", { tier: "vicinity", points: [
			{ fx: 0.88, fy: 0.6, siteUuid: "s1", name: "The Sunken Barrow" }, { fx: 0.3, fy: 0.3 },
		] });
		expect(stops.slice(1).map(s => [s.name, s.mark, s.siteUuid])).toEqual([
			["The Sunken Barrow", 1, "s1"], ["point 2", 2, null],
		]);
	});

	it("finds the nearest place a map letters, never an anchor", () => {
		expect(nearestPlace("vicinity", { fx: 0.88, fy: 0.6 })?.slug).toBe("the-red-grove");
		// The World's End draws the Red Grove only as an anchor, so it is never the answer there.
		expect(nearestPlace("worlds-end", { fx: 0.365, fy: 0.336 })?.slug).not.toBe("the-red-grove");
		expect(nearestPlace("nowhere", { fx: 0.5, fy: 0.5 })).toBeNull();
	});
});
