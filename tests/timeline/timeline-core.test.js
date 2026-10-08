import { describe, it, expect } from "vitest";
import {
	TIMELINE_TRACK_STEADING, UNDATED_PERIOD_KEY,
	addEntry, addKills, foeSummary, foesToLines, groupByPeriod, isLeftover, killTotal, linesToFoes,
	entriesById, entriesDiff, moveEntry, normalizeEntry, patchEntry, periodKey, periodRank, readEntries,
	removeEntry, sortEntries,
	trackIdFromKey, trackKey, upsertByKey,
} from "../../module/timeline/timeline-core.js";
import { MIN_HISTORY_YEAR } from "../../module/seasons/campaign-year.js";

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

	// The old "Expedition: " prefix is taken off once, by migration/expedition-title-prefix.js: a
	// read never rewrites a title, so one a GM typed that way stays as typed.
	it("reads every title as stored, whatever its source", () => {
		expect(normalizeEntry({ source: "expedition", title: "Expedition: The Ford" }).title).toBe("Expedition: The Ford");
		expect(normalizeEntry({ source: "hand", title: "Expedition: The Ford" }).title).toBe("Expedition: The Ford");
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

	// A timeline holds the table's HISTORY: stored years below 1 are years before play began.
	it("keeps a year from before play, and reads an unreadable year as the first", () => {
		expect(normalizeEntry({ year: 0 }).year).toBe(0);
		expect(normalizeEntry({ year: -9 }).year).toBe(-9);
		expect(normalizeEntry({ year: "nonsense" }).year).toBe(1);
		expect(normalizeEntry({ year: -99999 }).year).toBe(MIN_HISTORY_YEAR);
	});

	// A blank season WITH yearOnly is "some time that year"; yearOnly is dropped once a season is set.
	it("carries yearOnly on a blank season only", () => {
		expect(normalizeEntry({ season: "", yearOnly: true }).yearOnly).toBe(true);
		expect(normalizeEntry({ season: "" }).yearOnly).toBe(false);
		expect(normalizeEntry({ season: "summer", yearOnly: true }).yearOnly).toBe(false);
	});
});

describe("readEntries", () => {
	// A roster drops a nameless row. A timeline entry with no title is still a dated thing that
	// happened, and its card renders the body instead.
	it("keeps an untitled entry", () => {
		expect(readEntries([entry({ title: "" })])).toHaveLength(1);
	});

	it("answers empty for anything that is neither a list nor a keyed object", () => {
		expect(readEntries(null)).toEqual([]);
		expect(readEntries("entries")).toEqual([]);
	});
});

describe("periodRank", () => {
	it("ranks seasons within a year, and years above each other", () => {
		expect(periodRank(entry({ year: 1, season: "spring" }))).toBeLessThan(periodRank(entry({ year: 1, season: "winter" })));
		expect(periodRank(entry({ year: 1, season: "winter" }))).toBeLessThan(periodRank(entry({ year: 2, season: "spring" })));
	});

	it("ranks an undated entry before every real season, history included", () => {
		const undated = periodRank(entry({ season: "" }));
		expect(undated).toBeLessThan(periodRank(entry({ year: 1, season: "spring" })));
		expect(undated).toBeLessThan(periodRank(entry({ year: MIN_HISTORY_YEAR, season: "", yearOnly: true })));
	});

	it("ranks history before play, and a year-only period ahead of that year's spring", () => {
		const yearOnly = periodRank(entry({ year: -9, season: "", yearOnly: true }));
		expect(yearOnly).toBeLessThan(periodRank(entry({ year: -9, season: "spring" })));
		expect(periodRank(entry({ year: -10, season: "winter" }))).toBeLessThan(yearOnly);
		expect(periodRank(entry({ year: 0, season: "winter" }))).toBeLessThan(periodRank(entry({ year: 1, season: "spring" })));
	});

	it("files a year-only entry under its own period, apart from the undated block", () => {
		expect(periodKey(entry({ year: -9, season: "", yearOnly: true }))).toBe("-9:year");
		expect(periodKey(entry({ year: 0, season: "autumn" }))).toBe("0:autumn");
		expect(periodKey(entry({ year: 3, season: "" }))).toBe(UNDATED_PERIOD_KEY);
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

describe("the milestone fields survive every write", () => {
	// ⚠ EVERY WRITE RE-NORMALISES THE ENTRIES IT TOUCHES (writeEntries), so a field normalizeEntry does
	// not emit is deleted from every row the next time anybody writes it.
	it("carries key and foes through normalisation", () => {
		const row = normalizeEntry({ ...entry(), source: "kills", key: " levelup:3 ", foes: ["Wolf", " ", "Crinwin "] });
		expect(row.key).toBe("levelup:3");
		expect(row.foes).toEqual(["Wolf", "Crinwin"]);
		expect(row.source).toBe("kills");
	});

	it("gives a typed row an empty key and no foes", () => {
		const row = normalizeEntry(entry());
		expect(row.key).toBe("");
		expect(row.foes).toEqual([]);
	});

	// A list is a new object on every normalise; compared by identity, an unedited kills row would
	// read as changed and write on every save.
	it("writes nothing when a kills row is re-saved unchanged", () => {
		const list = [entry({ source: "kills", foes: ["Wolf", "Wolf"] })];
		expect(patchEntry(list, "e1", { foes: ["Wolf", "Wolf"] }).changed).toBeNull();
		expect(patchEntry(list, "e1", { foes: ["Wolf"] }).changed).not.toBeNull();
	});
});

describe("upsertByKey", () => {
	const ids = () => { let n = 0; return () => "m" + (++n); };

	it("adds a milestone the track does not have yet", () => {
		const { entries, added } = upsertByKey([], { source: "levelup", key: "levelup:2", title: "Reached level 2" }, { makeId: ids() });
		expect(added.key).toBe("levelup:2");
		expect(entries).toHaveLength(1);
	});

	// The same event recorded twice is still one row.
	it("does not add a second row for the same key", () => {
		const first = upsertByKey([], { source: "levelup", key: "levelup:2", title: "Reached level 2" }, { makeId: ids() }).entries;
		const again = upsertByKey(first, { source: "levelup", key: "levelup:2", title: "Reached level 2" }, { makeId: ids() });
		expect(again.added).toBeNull();
		expect(again.changed).toBeNull();
		expect(again.entries).toHaveLength(1);
	});

	// A GM may have re-dated or retitled the row; only the fields named in `refresh` follow a
	// re-record.
	it("refreshes only the fields it is told to", () => {
		const first = upsertByKey([], { source: "expedition", key: "expedition:t1", title: "Expedition: Ford", body: "Set out." }, { makeId: ids() }).entries;
		const retitled = patchEntry(first, first[0].id, { title: "The long walk", season: "summer" }).entries;
		const { entries, changed } = upsertByKey(retitled, {
			source: "expedition", key: "expedition:t1", title: "Expedition: Ford", body: "Set out. Returned triumphant.", season: "spring",
		}, { refresh: ["body"] });
		expect(changed).not.toBeNull();
		expect(entries[0].title).toBe("The long walk");
		expect(entries[0].season).toBe("summer");
		expect(entries[0].body).toBe("Set out. Returned triumphant.");
	});

	it("simply adds an entry with no key", () => {
		const list = [entry({ id: "a" })];
		expect(upsertByKey(list, { title: "Another", season: "spring" }, { makeId: ids() }).entries).toHaveLength(2);
	});
});

describe("addKills", () => {
	const SUMMER = { season: "summer", year: 2 };

	it("opens one row for a season's kills and adds to it after", () => {
		const first = addKills([], SUMMER, ["Crinwin"], {}, () => "k1");
		expect(first.added.source).toBe("kills");
		const second = addKills(first.entries, SUMMER, ["Crinwin", "Bandit Chief"]);
		expect(second.entries).toHaveLength(1);
		expect(second.entries[0].foes).toEqual(["Crinwin", "Crinwin", "Bandit Chief"]);
	});

	it("opens a new row in a new season", () => {
		const first = addKills([], SUMMER, ["Wolf"], {}, () => "k1").entries;
		const next = addKills(first, { season: "autumn", year: 2 }, ["Wolf"], {}, () => "k2").entries;
		expect(sortEntries(next).map(e => e.season)).toEqual(["summer", "autumn"]);
	});

	// ⚠ FOUND BY ITS DATE. A row the GM moved to another season stops collecting for the season it
	// left; the next kill there opens a fresh row.
	it("stops adding to a row the GM re-dated", () => {
		const first = addKills([], SUMMER, ["Wolf"], {}, () => "k1").entries;
		const moved = patchEntry(first, "k1", { season: "spring" }).entries;
		const next = addKills(moved, SUMMER, ["Crinwin"], {}, () => "k2").entries;
		expect(next.find(e => e.id === "k1").foes).toEqual(["Wolf"]);
		expect(next.find(e => e.id === "k2").foes).toEqual(["Crinwin"]);
	});

	it("writes nothing for no names", () => {
		expect(addKills([], SUMMER, ["", "  "]).added).toBeNull();
	});

	it("totals every kill on a track", () => {
		const list = [
			entry({ id: "a", source: "kills", foes: ["Wolf", "Wolf"] }),
			entry({ id: "b", source: "kills", season: "summer", foes: ["Crinwin"] }),
			entry({ id: "c", source: "hand", foes: ["not a kill"] }),
		];
		expect(killTotal(list)).toBe(3);
	});
});

describe("the Slain field", () => {
	it("counts foes by name, in the order each first fell", () => {
		expect(foeSummary(["Crinwin", "Bandit Chief", "Crinwin"])).toEqual([
			{ name: "Crinwin", count: 2 }, { name: "Bandit Chief", count: 1 },
		]);
	});

	it("round-trips a list through the text a GM edits", () => {
		const foes = ["Crinwin", "Crinwin", "Crinwin", "Bandit Chief"];
		expect(foesToLines(foes)).toBe("Crinwin ×3\nBandit Chief");
		expect(linesToFoes(foesToLines(foes))).toEqual(foes);
	});

	it("reads x, X and × with or without a space", () => {
		expect(linesToFoes("Wolf x2\nBoar X 2\nHag×1")).toEqual(["Wolf", "Wolf", "Boar", "Boar", "Hag"]);
	});

	it("does not take the last letter of a name for a count", () => {
		expect(linesToFoes("Max 3\nLynx 2")).toEqual(["Max 3", "Lynx 2"]);
		expect(linesToFoes("Lynx x2")).toEqual(["Lynx", "Lynx"]);
	});

	// A typo must not mint ten thousand kills.
	it("caps one line's count", () => {
		expect(linesToFoes("Crinwin ×10000")).toHaveLength(99);
	});

	it("skips blank lines", () => {
		expect(linesToFoes("\n  \nWolf\n")).toEqual(["Wolf"]);
	});
});

describe("entries keyed by id", () => {
	it("reads a keyed page and a list the same way", () => {
		const keyed = entriesById([entry({ id: "a" }), entry({ id: "b", title: "B" })]);
		expect(Object.keys(keyed)).toEqual(["a", "b"]);
		expect(readEntries(keyed).map(e => e.title)).toEqual(["A thing", "B"]);
	});

	it("leaves out a row stored with no id of its own: the leftover of a patch onto a deleted row", () => {
		const keyed = { a: entry({ id: "a" }), gone: { foes: ["Wolf"] }, blank: { id: "", title: "" } };
		expect(readEntries(keyed).map(e => e.id)).toEqual(["a"]);
		expect(isLeftover(keyed.gone)).toBe(true);
		expect(isLeftover(keyed.a)).toBe(false);
	});

	it("diffs two lists entry by entry: added whole, changed by field, removed by id", () => {
		const diff = entriesDiff([entry({ id: "a" }), entry({ id: "b" })], [entry({ id: "a", title: "New" }), entry({ id: "c" })]);
		expect(Object.keys(diff.added)).toEqual(["c"]);
		expect(diff.changed).toEqual({ a: { title: "New" } });
		expect(diff.removed).toEqual(["b"]);
	});

	it("compares foes by value, and answers null when nothing moved", () => {
		const kills = entry({ id: "k", source: "kills", foes: ["Wolf"] });
		expect(entriesDiff([kills], [{ ...kills, foes: ["Wolf"] }])).toBeNull();
		expect(entriesDiff([kills], [{ ...kills, foes: ["Wolf", "Wolf"] }]).changed).toEqual({ k: { foes: ["Wolf", "Wolf"] } });
	});
});
