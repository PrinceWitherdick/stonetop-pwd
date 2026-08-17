import { describe, expect, it } from "vitest";
import {
	CURRENT_SEASON_KEY,
	CURRENT_YEAR_KEY,
	currentSeasonView,
	readCurrentSeason,
	readCurrentYear,
	recordCurrentSeason,
	seasonRank,
} from "../../module/seasons/current-season.js";

// A minimal stand-in for the steading actor: the two flags the clock lives in, through the
// same getFlag/update pair production uses. `updates` is what pins the ONE-write rule: the
// stamp and the picker's year are a pair, and a caller must not be able to land half of it.
function fakeSteading(stamped = undefined, pickerYear = undefined) {
	const scoped = {};
	if (stamped !== undefined) scoped[CURRENT_SEASON_KEY] = stamped;
	if (pickerYear !== undefined) scoped[CURRENT_YEAR_KEY] = pickerYear;
	const flags = { "stonetop-pwd": scoped };
	const updates = [];
	return {
		flags,
		updates,
		getFlag: (scope, key) => flags[scope]?.[key],
		update: async data => {
			updates.push(data);
			for (const [scope, values] of Object.entries(data?.flags ?? {})) {
				Object.assign(flags[scope] ??= {}, values);
			}
		},
	};
}

describe("readCurrentSeason", () => {
	it("reads back the stamped season and year", () => {
		expect(readCurrentSeason(fakeSteading({ season: "autumn", year: 3 })))
			.toEqual({ season: "autumn", year: 3 });
	});

	it("is null when nothing has been stamped", () => {
		expect(readCurrentSeason(fakeSteading())).toBeNull();
		expect(readCurrentSeason(null)).toBeNull();
	});

	it("rejects a season id that isn't one of the four", () => {
		expect(readCurrentSeason(fakeSteading({ season: "harvest", year: 1 }))).toBeNull();
	});

	it("floors a missing or nonsense year at 1", () => {
		expect(readCurrentSeason(fakeSteading({ season: "spring" })).year).toBe(1);
		expect(readCurrentSeason(fakeSteading({ season: "spring", year: 0 })).year).toBe(1);
		expect(readCurrentSeason(fakeSteading({ season: "spring", year: "not a year" })).year).toBe(1);
	});
});

describe("seasonRank", () => {
	it("orders the seasons within a year", () => {
		const ranks = ["spring", "summer", "autumn", "winter"].map(season => seasonRank({ season, year: 1 }));
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
		expect(new Set(ranks).size).toBe(4);
	});

	it("puts the first year's Winter below the second year's Spring", () => {
		expect(seasonRank({ season: "winter", year: 1 })).toBeLessThan(seasonRank({ season: "spring", year: 2 }));
	});

	it("ranks nothing-stamped below every real season", () => {
		expect(seasonRank(null)).toBeLessThan(seasonRank({ season: "spring", year: 1 }));
	});
});

describe("recordCurrentSeason", () => {
	it("writes the season and the year it belongs to", async () => {
		const actor = fakeSteading();
		await recordCurrentSeason(actor, "summer", 2);
		expect(readCurrentSeason(actor)).toEqual({ season: "summer", year: 2 });
	});

	it("ignores a season id that isn't one of the four", async () => {
		const actor = fakeSteading();
		await recordCurrentSeason(actor, "harvest", 2);
		expect(readCurrentSeason(actor)).toBeNull();
	});

	it("survives no actor at all", async () => {
		await expect(recordCurrentSeason(null, "spring", 1)).resolves.toBeUndefined();
	});

	it("moves the clock backwards when asked to plainly, which is the GM correcting it", async () => {
		const actor = fakeSteading({ season: "winter", year: 2 });
		await recordCurrentSeason(actor, "spring", 1);
		expect(readCurrentSeason(actor)).toEqual({ season: "spring", year: 1 });
	});

	it("refuses to rewind under advanceOnly, so re-recording an old season keeps the clock", async () => {
		const actor = fakeSteading({ season: "winter", year: 2 });
		await recordCurrentSeason(actor, "summer", 1, { advanceOnly: true });
		expect(readCurrentSeason(actor)).toEqual({ season: "winter", year: 2 });
	});

	it("still advances under advanceOnly", async () => {
		const actor = fakeSteading({ season: "winter", year: 1 });
		await recordCurrentSeason(actor, "spring", 2, { advanceOnly: true });
		expect(readCurrentSeason(actor)).toEqual({ season: "spring", year: 2 });
	});

	it("stamps an un-clocked steading under advanceOnly", async () => {
		const actor = fakeSteading();
		await recordCurrentSeason(actor, "spring", 1, { advanceOnly: true });
		expect(readCurrentSeason(actor)).toEqual({ season: "spring", year: 1 });
	});

	// The half that used to be a second call every caller had to remember. Both halves land
	// in ONE update, so there is no way to write a stamp without its picker year.
	it("carries the picker's year in the same write as the stamp", async () => {
		const actor = fakeSteading();
		await recordCurrentSeason(actor, "summer", 3);
		expect(actor.updates).toHaveLength(1);
		expect(readCurrentSeason(actor)).toEqual({ season: "summer", year: 3 });
		expect(readCurrentYear(actor)).toBe(3);
	});

	// A completed Winter hands the picker the NEXT year: it has closed this one out.
	it("takes an explicit pickerYear, which a completed Winter uses", async () => {
		const actor = fakeSteading();
		await recordCurrentSeason(actor, "winter", 1, { pickerYear: 2 });
		expect(readCurrentSeason(actor)).toEqual({ season: "winter", year: 1 });
		expect(readCurrentYear(actor)).toBe(2);
	});

	it("never walks the picker's year backwards", async () => {
		const actor = fakeSteading({ season: "winter", year: 3 }, 4);
		await recordCurrentSeason(actor, "spring", 1);
		expect(readCurrentYear(actor)).toBe(4);
	});

	it("writes nothing at all when neither half would move", async () => {
		const actor = fakeSteading({ season: "winter", year: 2 }, 3);
		await recordCurrentSeason(actor, "summer", 1, { advanceOnly: true });
		expect(actor.updates).toHaveLength(0);
	});
});

describe("currentSeasonView", () => {
	it("names the season and the year once stamped", () => {
		const view = currentSeasonView({ season: "autumn", year: 2 }, 2);
		expect(view.season).toBe("autumn");
		expect(view.label).toBe("Autumn");
		expect(view.yearLabel).toBe("Year Two");
	});

	it("keeps the stamped year even when the picker's year has moved on", () => {
		// Completing a Winter advances seasonsCurrentYear to the NEXT year, so the fallback
		// disagrees with the stamp by design. The stamp wins: it is still that Winter.
		const view = currentSeasonView({ season: "winter", year: 1 }, 2);
		expect(view.yearLabel).toBe("Year One");
		expect(view.label).toBe("Winter");
	});

	it("falls back to Spring before any season has been stamped", () => {
		// A world that has never turned a season is in the one it opened in — session zero's
		// walkthrough stamps exactly this — so the header names a whole clock, not half of one.
		const view = currentSeasonView(null, 3);
		expect(view.season).toBe("spring");
		expect(view.label).toBe("Spring");
		expect(view.yearLabel).toBe("Year Three");
	});

	it("falls back to Spring of the first year when there is no year either", () => {
		const view = currentSeasonView(null);
		expect(view.label).toBe("Spring");
		expect(view.yearLabel).toBe("Year One");
	});

	// The fallback is what the header SAYS. It must not read back as a recorded season, or
	// the first real Seasons Change would rank at-or-below it and `advanceOnly` would drop it.
	it("marks the fallback as unstamped, and leaves the stored clock alone", () => {
		expect(currentSeasonView(null, 3).stamped).toBe(false);
		expect(currentSeasonView({ season: "spring", year: 1 }, 1).stamped).toBe(true);
		expect(readCurrentSeason(fakeSteading())).toBeNull();
	});
});
