import { describe, it, expect } from "vitest";
import {
	TIMELINE_TRACK_STEADING, UNDATED_PERIOD_KEY,
	addEntry, groupByPeriod, moveEntry, normalizeEntry, patchEntry, periodKey, periodRank,
	readEntries, removeEntry, sortEntries, trackIdFromKey, trackKey,
} from "../../module/timeline/timeline-core.js";

// The timeline's pure half: dates, ordering and the list algebra. Nothing here touches a document,
// so the sort order a reader sees is pinned without a Foundry global in sight.

/** A minimal entry, so each test names only the fields it is actually about. */
function entry(over = {}) {
	return { id: "e1", year: 1, season: "spring", order: 0, title: "A thing", ...over };
}

describe("trackKey", () => {
	it("prefixes a track id so the Chronicle's other page keys cannot collide", () => {
		expect(trackKey(TIMELINE_TRACK_STEADING)).toBe("timeline:steading");
		expect(trackKey("abc123")).toBe("timeline:abc123");
	});

	it("round-trips back to the track id", () => {
		expect(trackIdFromKey(trackKey("abc123"))).toBe("abc123");
	});

	// The Chronicle folder holds five journals keying pages into one namespace. A place page or a
	// PC's introduction page must never be mistaken for a track.
	it("does not claim another Chronicle key", () => {
		expect(trackIdFromKey("place:d")).toBe("");
		expect(trackIdFromKey("__spring__")).toBe("");
	});
});

describe("normalizeEntry", () => {
	it("defends every field against a hand-edited page", () => {
		const e = normalizeEntry({});
		expect(e).toMatchObject({ year: 1, season: "", order: 0, title: "", place: "", body: "", source: "hand" });
	});

	it("refuses a season the clock does not have", () => {
		expect(normalizeEntry({ season: "harvest" }).season).toBe("");
		expect(normalizeEntry({ season: "autumn" }).season).toBe("autumn");
	});

	// Ids reach dotted update paths and getProperty elsewhere in this system; one carrying a dot
	// addresses a nested object instead of a key.
	it("strips dots out of an id", () => {
		expect(normalizeEntry({ id: "a.b.c" }).id).toBe("abc");
	});

	it("falls back to a positional id, so two blank ids cannot collide", () => {
		expect(normalizeEntry({}, 0).id).toBe("entry-0");
		expect(normalizeEntry({}, 3).id).toBe("entry-3");
	});

	it("never lets a year fall below one", () => {
		expect(normalizeEntry({ year: 0 }).year).toBe(1);
		expect(normalizeEntry({ year: -4 }).year).toBe(1);
		expect(normalizeEntry({ year: "nonsense" }).year).toBe(1);
	});
});

describe("readEntries", () => {
	// A roster drops a nameless row. A timeline entry with no title is still a dated thing that
	// happened, and its card renders the body instead.
	it("keeps an untitled entry", () => {
		expect(readEntries([entry({ title: "" })])).toHaveLength(1);
	});

	it("answers empty for anything that is not a list", () => {
		expect(readEntries(null)).toEqual([]);
		expect(readEntries({ 0: entry() })).toEqual([]);
	});
});

describe("periodRank", () => {
	it("ranks seasons within a year, and years above each other", () => {
		expect(periodRank(entry({ year: 1, season: "spring" }))).toBeLessThan(periodRank(entry({ year: 1, season: "winter" })));
		expect(periodRank(entry({ year: 1, season: "winter" }))).toBeLessThan(periodRank(entry({ year: 2, season: "spring" })));
	});

	it("ranks an undated entry before every real season", () => {
		expect(periodRank(entry({ season: "" }))).toBe(-1);
	});
});

describe("sortEntries", () => {
	it("reads oldest first, and by order within a season", () => {
		const sorted = sortEntries([
			entry({ id: "c", year: 2, season: "spring", order: 0 }),
			entry({ id: "b", year: 1, season: "autumn", order: 1 }),
			entry({ id: "a", year: 1, season: "autumn", order: 0 }),
		]);
		expect(sorted.map(e => e.id)).toEqual(["a", "b", "c"]);
	});

	// Without a total order, two entries added in one click swap places on every repaint.
	it("breaks a tie on createdAt and then on id, so a repaint never shuffles", () => {
		const tied = [
			entry({ id: "z", order: 0, createdAt: 5 }),
			entry({ id: "a", order: 0, createdAt: 5 }),
			entry({ id: "m", order: 0, createdAt: 1 }),
		];
		expect(sortEntries(tied).map(e => e.id)).toEqual(["m", "a", "z"]);
		expect(sortEntries([...tied].reverse()).map(e => e.id)).toEqual(["m", "a", "z"]);
	});
});

describe("groupByPeriod", () => {
	it("gathers one block per season that has anything in it, oldest first", () => {
		const periods = groupByPeriod([
			entry({ id: "b", year: 2, season: "summer" }),
			entry({ id: "a", year: 1, season: "spring" }),
			entry({ id: "c", year: 2, season: "summer" }),
		]);
		expect(periods.map(p => p.key)).toEqual(["1:spring", "2:summer"]);
		expect(periods[1].entries.map(e => e.id)).toEqual(["b", "c"]);
	});

	// A campaign that played one autumn and then skipped a year should read as two blocks, not as
	// six with four of them blank.
	it("does not invent the seasons nothing happened in", () => {
		const periods = groupByPeriod([
			entry({ id: "a", year: 1, season: "spring" }),
			entry({ id: "b", year: 3, season: "winter" }),
		]);
		expect(periods).toHaveLength(2);
	});

	it("puts undated entries in their own block at the head", () => {
		const periods = groupByPeriod([
			entry({ id: "a", year: 1, season: "spring" }),
			entry({ id: "u", season: "" }),
		]);
		expect(periods.map(p => p.key)).toEqual([UNDATED_PERIOD_KEY, "1:spring"]);
	});
});

describe("addEntry", () => {
	it("appends to the end of its own season", () => {
		const first = addEntry([], entry({ id: "a" }));
		const second = addEntry(first.entries, entry({ id: "b" }));
		expect(second.entries.map(e => [e.id, e.order])).toEqual([["a", 0], ["b", 1]]);
	});

	it("starts a season it is the first entry in at zero", () => {
		const { entries } = addEntry([entry({ id: "a", year: 1, season: "spring", order: 4 })], entry({ id: "b", year: 2, season: "summer" }));
		expect(entries.find(e => e.id === "b").order).toBe(0);
	});

	it("takes its id from the injected maker, so nothing reaches for a Foundry global", () => {
		const { added } = addEntry([], { title: "A thing", season: "spring", year: 1 }, () => "made-id");
		expect(added.id).toBe("made-id");
	});

	it("refuses a duplicate id and reports it as no change", () => {
		const { entries, added } = addEntry([entry({ id: "a" })], entry({ id: "a", title: "Another" }));
		expect(added).toBeNull();
		expect(entries).toHaveLength(1);
	});

	// The roster this borrows its contract from refuses a duplicate NAME. Two entries in one season
	// sharing a title is ordinary; the party fought the same thing twice.
	it("allows two entries with the same title in one season", () => {
		const { added } = addEntry([entry({ id: "a", title: "Raid" })], entry({ id: "b", title: "Raid" }));
		expect(added).not.toBeNull();
	});
});

describe("removeEntry", () => {
	it("closes the gap it leaves behind", () => {
		const list = [entry({ id: "a", order: 0 }), entry({ id: "b", order: 1 }), entry({ id: "c", order: 2 })];
		const { entries } = removeEntry(list, "b");
		expect(entries.map(e => [e.id, e.order])).toEqual([["a", 0], ["c", 1]]);
	});

	it("reports no change for an id that matched nothing", () => {
		const { entries, removed } = removeEntry([entry()], "nope");
		expect(removed).toBeNull();
		expect(entries).toHaveLength(1);
	});

	// A hand-edited page can hold two entries spelling the same id, and a filter would take both
	// off for a single click.
	it("cuts one entry even when the page holds two with the same id", () => {
		const { entries } = removeEntry([entry({ id: "dup" }), entry({ id: "dup" })], "dup");
		expect(entries).toHaveLength(1);
	});
});

describe("patchEntry", () => {
	it("reports no change when nothing actually moved", () => {
		const { changed } = patchEntry([entry({ id: "a", title: "A thing" })], "a", { title: "A thing" });
		expect(changed).toBeNull();
	});

	it("keeps an entry where it sits when the date does not change", () => {
		const list = [entry({ id: "a", order: 0 }), entry({ id: "b", order: 1 })];
		const { entries } = patchEntry(list, "a", { title: "Renamed" });
		expect(entries.map(e => [e.id, e.order])).toEqual([["a", 0], ["b", 1]]);
	});

	// Keeping the old order would drop it into the middle of a season it has never been in, at a
	// position that means nothing there.
	it("moves a re-dated entry to the end of its new season and closes the old gap", () => {
		const list = [
			entry({ id: "a", year: 1, season: "spring", order: 0 }),
			entry({ id: "b", year: 1, season: "spring", order: 1 }),
			entry({ id: "c", year: 1, season: "summer", order: 0 }),
		];
		const { entries, changed } = patchEntry(list, "a", { season: "summer" });
		expect(changed.order).toBe(1);
		const byId = Object.fromEntries(entries.map(e => [e.id, e.order]));
		expect(byId).toEqual({ a: 1, b: 0, c: 0 });
	});

	it("will not let a patch rewrite the id", () => {
		const { entries } = patchEntry([entry({ id: "a" })], "a", { id: "b", title: "Renamed" });
		expect(entries[0].id).toBe("a");
	});
});

describe("moveEntry", () => {
	it("swaps an entry with its neighbour in the same season", () => {
		const list = [entry({ id: "a", order: 0 }), entry({ id: "b", order: 1 })];
		const { entries } = moveEntry(list, "b", -1);
		expect(sortEntries(entries).map(e => e.id)).toEqual(["b", "a"]);
	});

	it("reports no change at either end, so the buttons disable off the same answer", () => {
		const list = [entry({ id: "a", order: 0 }), entry({ id: "b", order: 1 })];
		expect(moveEntry(list, "a", -1).moved).toBeNull();
		expect(moveEntry(list, "b", 1).moved).toBeNull();
	});

	// Crossing into another season is a re-dating, which is what patchEntry is for. A move that
	// counted entries in other seasons would silently change an entry's date.
	it("never crosses into another season", () => {
		const list = [
			entry({ id: "a", year: 1, season: "spring", order: 0 }),
			entry({ id: "b", year: 1, season: "summer", order: 0 }),
		];
		expect(moveEntry(list, "b", -1).moved).toBeNull();
		expect(moveEntry(list, "a", 1).moved).toBeNull();
	});

	it("leaves the other seasons untouched", () => {
		const list = [
			entry({ id: "a", year: 1, season: "spring", order: 0 }),
			entry({ id: "b", year: 1, season: "spring", order: 1 }),
			entry({ id: "c", year: 2, season: "summer", order: 0 }),
		];
		const { entries } = moveEntry(list, "b", -1);
		expect(entries.find(e => e.id === "c").order).toBe(0);
	});
});

describe("periodKey", () => {
	it("uses the stamp shape the rest of the system files seasons under", () => {
		expect(periodKey(entry({ year: 2, season: "winter" }))).toBe("2:winter");
		expect(periodKey(entry({ season: "" }))).toBe(UNDATED_PERIOD_KEY);
	});
});
