import { describe, it, expect, beforeEach } from "vitest";
import {
	RELMAP_LAST_SETTING, defaultBoard, getLastBoard, rememberBoard,
} from "../../module/relmap/relmap-last.js";
import { RELMAP_FLAG } from "../../module/relmap/relmap-store.js";
import { RELMAP_PARTY_FLAG } from "../../module/relmap/relmap-party.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// Where the hotbar macro lands when nobody said which map.
//
// The rule it replaced was a picker, so what this suite is really holding is that the macro NEVER
// asks: every branch below hands back a board, and the only null is a world with no maps in it at
// all (which is the one case that has something else to offer, in hooks/Ready.js).

let stored;     // setting key -> value, standing in for this browser's localStorage
let journals;   // the world's JournalEntry list
let sets;       // every game.settings.set call, to catch a write per repaint

/** One board of a map. `party` marks it as the self-seating party board, by the flag the real
 * thing goes by (the page is renameable, so the name proves nothing). */
function page(id, name, { party = false, sort = 0 } = {}) {
	return {
		id,
		name,
		sort,
		getFlag(ns, key) {
			if (ns !== SYSTEM_ID) return undefined;
			if (key === RELMAP_FLAG) return { v: 2 };
			if (key === RELMAP_PARTY_FLAG) return party || undefined;
			return undefined;
		},
	};
}

/** One map: a JournalEntry carrying the mark, with its boards as pages. */
function map(id, name, pages = []) {
	return {
		id,
		name,
		pages: { contents: pages },
		getFlag: (ns, key) => (ns === SYSTEM_ID && key === RELMAP_FLAG ? { v: 2 } : undefined),
	};
}

beforeEach(() => {
	stored = {};
	journals = [];
	sets = [];
	globalThis.game = {
		world: { id: "world-a" },
		journal: { get contents() { return journals; } },
		settings: {
			get: (ns, key) => stored[key],
			set: (ns, key, value) => { sets.push([key, value]); stored[key] = value; return Promise.resolve(value); },
		},
	};
});

describe("remembering where a reader was", () => {
	it("records the map and the page, under this world", () => {
		rememberBoard("mapA", "pageB");
		expect(stored[RELMAP_LAST_SETTING]).toEqual({ "world-a": { entryId: "mapA", pageId: "pageB" } });
		expect(getLastBoard()).toEqual({ entryId: "mapA", pageId: "pageB" });
	});

	// A board re-renders for reasons that have nothing to do with the reader going anywhere: a
	// portrait dropped, a name rewritten, a page added at the far end of the table. Each of those
	// would otherwise be a localStorage write plus an onChange.
	it("writes nothing when the reader has not moved", () => {
		rememberBoard("mapA", "pageB");
		rememberBoard("mapA", "pageB");
		rememberBoard("mapA", "pageB");
		expect(sets).toHaveLength(1);
	});

	it("writes again the moment they switch page", () => {
		rememberBoard("mapA", "pageB");
		rememberBoard("mapA", "pageC");
		expect(sets).toHaveLength(2);
		expect(getLastBoard()).toEqual({ entryId: "mapA", pageId: "pageC" });
	});

	// Client settings have no world in their localStorage key, so the record has to nest itself.
	it("leaves another world's record alone", () => {
		stored[RELMAP_LAST_SETTING] = { "world-b": { entryId: "otherMap", pageId: "otherPage" } };
		rememberBoard("mapA", "pageB");
		expect(stored[RELMAP_LAST_SETTING]).toEqual({
			"world-b": { entryId: "otherMap", pageId: "otherPage" },
			"world-a": { entryId: "mapA", pageId: "pageB" },
		});
	});

	it("does not read another world's record as its own", () => {
		stored[RELMAP_LAST_SETTING] = { "world-b": { entryId: "otherMap", pageId: "otherPage" } };
		expect(getLastBoard()).toBeNull();
	});

	it("keeps nothing when it is handed no map", () => {
		rememberBoard("", "pageB");
		rememberBoard(null, "pageB");
		expect(sets).toHaveLength(0);
		expect(getLastBoard()).toBeNull();
	});
});

describe("which board an unasked open lands on", () => {
	it("goes back to the map and the page this client was last on", () => {
		const millers = map("m1", "The Millers", [page("p1", "At home"), page("p2", "Debts")]);
		journals = [millers, map("m2", "Marshedge", [page("p3", "The docks")])];
		rememberBoard("m1", "p2");
		expect(defaultBoard()).toEqual({ entry: millers, pageId: "p2" });
	});

	// Anyone at the table can delete a page under an open window, so a remembered id that names
	// nothing is ordinary. The MAP is still the right answer; only the page falls back.
	it("keeps the map when the page it remembers is gone", () => {
		const millers = map("m1", "The Millers", [page("p1", "At home")]);
		journals = [millers];
		rememberBoard("m1", "p2");
		expect(defaultBoard()).toEqual({ entry: millers, pageId: null });
	});

	it("falls through to the party board when the map it remembers is gone", () => {
		const marshedge = map("m2", "Marshedge", [page("p3", "The docks")]);
		const stonetop = map("m3", "Stonetop", [page("p4", "The village"), page("p5", "The Party", { party: true, sort: 1 })]);
		journals = [marshedge, stonetop];
		rememberBoard("m1", "p2");
		expect(defaultBoard()).toEqual({ entry: stonetop, pageId: "p5" });
	});

	it("opens the party board on a client that has never opened one", () => {
		const stonetop = map("m3", "Stonetop", [page("p4", "The village"), page("p5", "The Party", { party: true, sort: 1 })]);
		journals = [stonetop];
		expect(defaultBoard()).toEqual({ entry: stonetop, pageId: "p5" });
	});

	// Alphabetical, because that is the order `listRelationshipMaps` hands them over in and the
	// order the sidebar shows.
	it("opens the first map, on its first page, when no map has a party board", () => {
		const marshedge = map("m2", "Marshedge", [page("p3", "The docks")]);
		const stonetop = map("m3", "Stonetop", [page("p4", "The village")]);
		journals = [stonetop, marshedge];
		expect(defaultBoard()).toEqual({ entry: marshedge, pageId: null });
	});

	it("has nothing to offer in a world with no maps", () => {
		expect(defaultBoard()).toBeNull();
	});
});
