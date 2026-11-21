import { describe, it, expect } from "vitest";
import { roadLegs, steppedProgress, tripProgress, tripStatus } from "../../module/utils/trip-progress.js";
import { journeyKey } from "../../module/utils/travel-route.js";

// A trip's place on its route (Running the journey's road panel). The count is stored with the key of
// the route it was counted on, so a route changed since reads as 0 and needs no reset.

const journey = { origin: "stonetop", destination: "marshedge" };
const leg = (fromName, toName, unit = "days", min = 2) => ({ fromName, toName, unit, min, max: min + 1, time: `${min}–${min + 1} ${unit}` });
const ROUTE = { legs: [leg("Stonetop", "Gordin's Delve", "hours", 4), leg("Gordin's Delve", "the Crossroads"), leg("the Crossroads", "Marshedge")] };
const trip = (reached, extra = {}) => ({ journey, progress: reached === undefined ? undefined : { reached, key: journeyKey(journey) }, ...extra });

describe("tripProgress", () => {
	it("reads 0 with no route, no progress, or a progress counted on another route", () => {
		expect(tripProgress(trip(2), null)).toEqual({ reached: 0, total: 0, started: false, arrived: false });
		expect(tripProgress(trip(undefined), ROUTE).reached).toBe(0);
		const moved = { ...trip(2), journey: { origin: "stonetop", destination: "the-steplands" } };
		expect(tripProgress(moved, ROUTE).reached).toBe(0);
	});

	it("clamps at both ends", () => {
		expect(tripProgress(trip(-3), ROUTE).reached).toBe(0);
		expect(tripProgress(trip(9), ROUTE)).toEqual({ reached: 3, total: 3, started: true, arrived: true });
		expect(tripProgress(trip("junk"), ROUTE).reached).toBe(0);
	});

	it("counts a leg travelled as started, and every leg as arrived", () => {
		expect(tripProgress(trip(1), ROUTE)).toEqual({ reached: 1, total: 3, started: true, arrived: false });
	});
});

describe("steppedProgress", () => {
	it("moves one leg either way, stamped with the route's key", () => {
		expect(steppedProgress(trip(1), ROUTE, 1)).toEqual({ reached: 2, key: journeyKey(journey) });
		expect(steppedProgress(trip(1), ROUTE, -1)).toEqual({ reached: 0, key: journeyKey(journey) });
	});

	it("answers null where nothing would change", () => {
		expect(steppedProgress(trip(0), ROUTE, -1)).toBeNull();
		expect(steppedProgress(trip(3), ROUTE, 1)).toBeNull();
		expect(steppedProgress(trip(0), null, 1)).toBeNull();
		expect(steppedProgress(trip(0), ROUTE, 0.5)).toBeNull();
	});
});

describe("roadLegs", () => {
	it("marks the legs behind, the one next, and those ahead", () => {
		expect(roadLegs(ROUTE, 1).map(row => row.state)).toEqual(["walked", "next", "ahead"]);
		expect(roadLegs(ROUTE, 3).map(row => row.state)).toEqual(["walked", "walked", "walked"]);
	});

	it("gives days only for a leg measured in days", () => {
		expect(roadLegs(ROUTE, 0).map(row => row.days)).toEqual([null, 2, 2]);
	});
});

describe("tripStatus", () => {
	it("reads each of the four states", () => {
		expect(tripStatus(trip(0), ROUTE)).toBe("planning");
		expect(tripStatus(trip(0, { setOut: { season: "summer", year: 1 } }), ROUTE)).toBe("road");
		expect(tripStatus(trip(1), ROUTE)).toBe("road");
		expect(tripStatus(trip(3), ROUTE)).toBe("arrived");
		expect(tripStatus(trip(3, { timelineRecorded: { season: "autumn", year: 1 } }), ROUTE)).toBe("home");
	});

	it("is on the road with no route at all once they have set out", () => {
		expect(tripStatus({ setOut: { season: "summer", year: 1 } }, null)).toBe("road");
	});
});
