import { describe, it, expect } from "vitest";
import {
	SEASON_LOG_MAX, appendSeasonLog, readSeasonLog, seasonForTimestamp, seasonLogUpdate, SEASON_LOG_KEY,
} from "../../module/timeline/timeline-seasons.js";
import { STONETOP_SCOPE } from "../../module/actors/character/StonetopFlags.js";

// WHEN EACH SEASON BEGAN, IN REAL TIME. The timeline's auto rows come from the change ledger, which
// carries a wall-clock timestamp and no in-game date; this log is what turns one into the other.
// Every assertion here is about a way of getting that mapping subtly wrong, because a row filed in
// the wrong season looks exactly like a row filed in the right one.

/** A row as the log stores them. */
function turning(key, at) {
	const [year, season] = key.split(":");
	return { key, year: Number(year), season, at };
}

const SPRING_1 = turning("1:spring", 1_000);
const SUMMER_1 = turning("1:summer", 2_000);
const WINTER_2 = turning("2:winter", 3_000);

describe("appendSeasonLog", () => {
	it("adds a turning the log does not have", () => {
		const log = appendSeasonLog([SPRING_1], { season: "summer", year: 1, at: 2_000 });
		expect(log.map(r => r.key)).toEqual(["1:spring", "1:summer"]);
	});

	// ⚠ FIRST WINS. The question the log answers is when a season BEGAN. A GM re-recording a
	// Seasons Change three weeks later to fix its journal entry has not moved when that season
	// started, and taking the later timestamp would push every ledger entry from those three weeks
	// back into the previous season.
	it("leaves a season it already has alone, however much later it is re-recorded", () => {
		const log = appendSeasonLog([SPRING_1], { season: "spring", year: 1, at: 9_999 });
		expect(log[0].at).toBe(1_000);
	});

	// And it answers the SAME ARRAY, which is what lets the clock's writer skip a document write
	// that would re-render every open sheet to no effect.
	it("answers the very same array when nothing was added", () => {
		const before = [SPRING_1];
		expect(appendSeasonLog(before, { season: "spring", year: 1, at: 9_999 })).toBe(before);
	});

	it("keeps the log in real-time order however it was appended to", () => {
		const log = appendSeasonLog([SUMMER_1], { season: "spring", year: 1, at: 1_000 });
		expect(log.map(r => r.key)).toEqual(["1:spring", "1:summer"]);
	});

	it("refuses a season the clock does not have, and a timestamp that is not one", () => {
		expect(appendSeasonLog([SPRING_1], { season: "harvest", year: 1, at: 5 })).toEqual([SPRING_1]);
		expect(appendSeasonLog([SPRING_1], { season: "summer", year: 1, at: "soon" })).toEqual([SPRING_1]);
	});

	// This rides on a flag on the steading, which is written constantly. The cap is fifteen years
	// of play, and dropping the oldest costs nothing: an entry older than the oldest row falls into
	// that row's season, which is the answer it would have had anyway.
	it("trims to the cap, oldest first", () => {
		let log = [];
		for (let i = 0; i < SEASON_LOG_MAX + 5; i++) {
			log = appendSeasonLog(log, { season: "spring", year: i + 1, at: i * 100 });
		}
		expect(log).toHaveLength(SEASON_LOG_MAX);
		expect(log[0].year).toBe(6);
	});
});

describe("seasonForTimestamp", () => {
	const LOG = [SPRING_1, SUMMER_1, WINTER_2];

	it("answers the last season that had begun by then", () => {
		expect(seasonForTimestamp(LOG, 2_500)).toEqual({ year: 1, season: "summer" });
		expect(seasonForTimestamp(LOG, 3_000)).toEqual({ year: 2, season: "winter" });
		expect(seasonForTimestamp(LOG, 999_999)).toEqual({ year: 2, season: "winter" });
	});

	it("counts the instant a season began as being in it", () => {
		expect(seasonForTimestamp(LOG, 1_000)).toEqual({ year: 1, season: "spring" });
	});

	// ⚠ THE HONEST ANSWER, not a shortcoming. Every world in play before this shipped has a ledger
	// going back further than its log does, and filing those under the first recorded season would
	// invent a date for them. The timeline gathers them into "Before the record" instead.
	it("answers null for a moment before the log begins", () => {
		expect(seasonForTimestamp(LOG, 500)).toBeNull();
	});

	it("answers null for an empty log and for a timestamp that is not one", () => {
		expect(seasonForTimestamp([], 5_000)).toBeNull();
		expect(seasonForTimestamp(LOG, undefined)).toBeNull();
		expect(seasonForTimestamp(null, 5_000)).toBeNull();
	});
});

describe("readSeasonLog", () => {
	const actor = (rows) => ({ getFlag: (scope, key) => (scope === STONETOP_SCOPE && key === SEASON_LOG_KEY ? rows : undefined) });

	it("reads the log off the steading, oldest first", () => {
		expect(readSeasonLog(actor([WINTER_2, SPRING_1])).map(r => r.key)).toEqual(["1:spring", "2:winter"]);
	});

	it("drops a row a hand-edited flag left broken", () => {
		expect(readSeasonLog(actor([SPRING_1, { season: "harvest", at: 5 }, { season: "summer" }])))
			.toHaveLength(1);
	});

	it("answers empty for a steading that has never turned a season, and for no steading", () => {
		expect(readSeasonLog(actor(undefined))).toEqual([]);
		expect(readSeasonLog(null)).toEqual([]);
	});
});

describe("seasonLogUpdate", () => {
	const actor = (rows) => ({ getFlag: (scope, key) => (scope === STONETOP_SCOPE && key === SEASON_LOG_KEY ? rows : undefined) });

	it("hands back a fragment the clock's own write can fold in", () => {
		const update = seasonLogUpdate(actor([SPRING_1]), { season: "summer", year: 1, at: 2_000 });
		expect(update[SEASON_LOG_KEY].map(r => r.key)).toEqual(["1:spring", "1:summer"]);
	});

	// Null rather than an unchanged fragment, so `recordCurrentSeason` can still skip the write
	// entirely when neither half of the clock has moved.
	it("answers null for a season the log already has", () => {
		expect(seasonLogUpdate(actor([SPRING_1]), { season: "spring", year: 1, at: 9_999 })).toBeNull();
	});
});
