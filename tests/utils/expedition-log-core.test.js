import { describe, expect, it } from "vitest";
import {
	normalizeLog,
	currentExpedition,
	ensureCurrent,
	addExpedition,
	selectExpedition,
	deleteExpedition,
	mergeLogs,
	sameLog,
} from "../../module/utils/expedition-log-core.js";

// Pure list ops for the growing expedition log. The dialog supplies randomID/Date.now
// and persists the result; these assert the structure (normalization, selection,
// add/delete) and that each op leaves its input untouched.

const trip = (id, title = "") => ({ id, title, createdAt: 0 });

describe("normalizeLog", () => {
	it("treats a missing/empty blob as an empty log", () => {
		expect(normalizeLog(undefined)).toEqual({ currentId: null, list: [] });
		expect(normalizeLog({})).toEqual({ currentId: null, list: [] });
		expect(normalizeLog({ list: "nope" })).toEqual({ currentId: null, list: [] });
	});

	it("keeps a valid currentId", () => {
		const log = normalizeLog({ currentId: "a", list: [trip("a"), trip("b")] });
		expect(log.currentId).toBe("a");
	});

	it("falls back to the most recent trip when currentId is missing or stale", () => {
		expect(normalizeLog({ list: [trip("a"), trip("b")] }).currentId).toBe("b");
		expect(normalizeLog({ currentId: "gone", list: [trip("a"), trip("b")] }).currentId).toBe("b");
	});
});

describe("currentExpedition", () => {
	it("returns the selected trip, or null when empty", () => {
		expect(currentExpedition({ currentId: "a", list: [trip("a")] })).toEqual(trip("a"));
		expect(currentExpedition({ currentId: null, list: [] })).toBeNull();
	});
});

describe("ensureCurrent", () => {
	it("returns the existing current trip without touching the input", () => {
		const log = { currentId: "a", list: [trip("a", "X")] };
		const { log: out, entry } = ensureCurrent(log, () => trip("z"));
		entry.title = "Y";
		expect(entry.id).toBe("a");
		expect(out.list[0].title).toBe("Y"); // mutation lands on the copy
		expect(log.list[0].title).toBe("X"); // input is untouched
	});

	it("creates and selects a trip when the log is empty", () => {
		const { log, entry } = ensureCurrent({ currentId: null, list: [] }, () => trip("new"));
		expect(entry.id).toBe("new");
		expect(log.currentId).toBe("new");
		expect(log.list).toHaveLength(1);
	});
});

describe("addExpedition", () => {
	it("appends the new trip and selects it, leaving the input list intact", () => {
		const log = { currentId: "a", list: [trip("a")] };
		const out = addExpedition(log, trip("b"));
		expect(out.currentId).toBe("b");
		expect(out.list.map(e => e.id)).toEqual(["a", "b"]);
		expect(log.list).toHaveLength(1);
	});
});

describe("selectExpedition", () => {
	it("switches the current trip", () => {
		const log = { currentId: "a", list: [trip("a"), trip("b")] };
		expect(selectExpedition(log, "b").currentId).toBe("b");
	});

	it("is a no-op for an unknown id", () => {
		const log = { currentId: "a", list: [trip("a")] };
		expect(selectExpedition(log, "ghost")).toBe(log);
	});
});

describe("deleteExpedition", () => {
	it("removes a trip and re-selects the most recent when the current one goes", () => {
		const log = { currentId: "b", list: [trip("a"), trip("b"), trip("c")] };
		const out = deleteExpedition(log, "b");
		expect(out.list.map(e => e.id)).toEqual(["a", "c"]);
		expect(out.currentId).toBe("c");
	});

	it("keeps the current selection when deleting a different trip", () => {
		const log = { currentId: "a", list: [trip("a"), trip("b")] };
		expect(deleteExpedition(log, "b").currentId).toBe("a");
	});

	it("empties the log cleanly when the last trip is removed", () => {
		const log = { currentId: "a", list: [trip("a")] };
		expect(deleteExpedition(log, "a")).toEqual({ currentId: null, list: [] });
	});
});

// Two GMs on one trip: each window's copy, merged with the other's write against what the world
// held when the copy was taken.
describe("mergeLogs", () => {
	const base = { currentId: "a", list: [{ ...trip("a", "The Long Walk"), chart: { route: "", rows: [{ id: "r1", text: "Rope" }] } }] };
	const edit = (log, fn) => { const next = structuredClone(log); fn(next); return next; };

	it("keeps a change made on either side", () => {
		const mine   = edit(base, l => { l.list[0].chart.route = "Over the pass"; });
		const theirs = edit(base, l => { l.list[0].title = "Renamed"; });
		const merged = mergeLogs(base, mine, theirs);
		expect(merged.list[0]).toMatchObject({ title: "Renamed", chart: { route: "Over the pass" } });
	});

	it("takes theirs where both changed the same answer", () => {
		const mine   = edit(base, l => { l.list[0].title = "Mine"; });
		const theirs = edit(base, l => { l.list[0].title = "Theirs"; });
		expect(mergeLogs(base, mine, theirs).list[0].title).toBe("Theirs");
	});

	it("merges rows by id, so a row added on each side is kept", () => {
		const mine   = edit(base, l => { l.list[0].chart.rows.push({ id: "r2", text: "Lantern" }); });
		const theirs = edit(base, l => { l.list[0].chart.rows.push({ id: "r3", text: "Salt" }); });
		expect(mergeLogs(base, mine, theirs).list[0].chart.rows.map(r => r.id)).toEqual(["r1", "r3", "r2"]);
	});

	it("keeps a row or a trip deleted on either side deleted", () => {
		const mine   = edit(base, l => { l.list[0].chart.rows = []; });
		const theirs = edit(base, l => { l.list.push(trip("b")); });
		const merged = mergeLogs(base, mine, theirs);
		expect(merged.list[0].chart.rows).toEqual([]);
		expect(merged.list.map(e => e.id)).toEqual(["a", "b"]);
		expect(mergeLogs(base, edit(base, l => { l.list[0].title = "Edited"; }), { currentId: null, list: [] }).list).toEqual([]);
	});

	it("keeps this window on its own trip, unless that trip is gone", () => {
		const two    = { currentId: "a", list: [trip("a"), trip("b")] };
		const theirs = { currentId: "b", list: [trip("a"), trip("b"), trip("c")] };
		expect(mergeLogs(two, two, theirs).currentId).toBe("a");
		expect(mergeLogs(two, two, { currentId: "b", list: [trip("b")] }).currentId).toBe("b");
	});

	it("leaves its inputs untouched", () => {
		const mine   = edit(base, l => { l.list[0].chart.route = "Over the pass"; });
		const theirs = edit(base, l => { l.list[0].title = "Renamed"; });
		const before = structuredClone([base, mine, theirs]);
		mergeLogs(base, mine, theirs);
		expect([base, mine, theirs]).toEqual(before);
	});
});

describe("sameLog", () => {
	it("ignores key order and a key left undefined, as a JSON round trip does", () => {
		expect(sameLog({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1, d: undefined })).toBe(true);
		expect(sameLog({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
	});
});
