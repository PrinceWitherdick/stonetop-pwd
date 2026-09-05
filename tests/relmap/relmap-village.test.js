import { describe, it, expect, beforeEach, vi } from "vitest";

// The window is stubbed out for the same reason relmap-doc.test.js stubs it: nothing here paints.
vi.mock("../../module/dialogs/RelationshipMapWindow.js", () => ({ openRelationshipMap: vi.fn() }));

import { villageBoardPlan } from "../../module/relmap/relmap-village.js";
import {
	getPartyPage, getVillagePage, hadVillagePage, listMapPages, readGraph, syncPartyPage,
	syncVillagePage,
} from "../../module/relmap/relmap-doc.js";

// THE VILLAGE SEATS ITSELF, asked for as "for this Stonetop page, can we make all the residents of
// Stonetop appear automatically on that map".
//
// It is the party board's trick played on a board the map ALREADY HAS, and that difference is where
// every hazard in this file lives: the board being adopted may have people on it, may have been
// arranged, and belongs to the table rather than to this system. So the rules it keeps are the
// party board's three, plus a ledger the party board has no need of — thirty residents that come
// back every time you take one off is a board nobody can use.

const OWNER = 3;
let nextPageId = 0;

/** Apply one dotted leaf patch the way a real document does. Same reasoning as relmap-doc.test.js:
 * every write in this feature is a path to a leaf, and a fake that only recorded them could not
 * show that reading the flag back afterwards finds what was written. */
function applyDotted(doc, patch) {
	for (const [path, value] of Object.entries(patch ?? {})) {
		const parts = path.split(".");
		const leaf = parts.pop();
		let at = doc;
		for (const part of parts) {
			if (at[part] === null || typeof at[part] !== "object") at[part] = {};
			at = at[part];
		}
		if (leaf.startsWith("-=")) delete at[leaf.slice(2)];
		else at[leaf] = value;
	}
}

function pageDoc(name, graph, { sort = 0, parent = null, flags: extra = null } = {}) {
	const flags = extra ?? { "stonetop-pwd": { relationshipMap: graph } };
	const doc = {
		id: `page${++nextPageId}`,
		name, sort, parent, flags, updates: [],
		getFlag: (scope, key) => flags[scope]?.[key] ?? null,
		update(patch) {
			doc.updates.push(patch);
			if ("name" in patch) doc.name = patch.name;
			applyDotted(doc, patch);
			return Promise.resolve(doc);
		},
	};
	return doc;
}

const entry = (name, flags = {}) => {
	const pages = [];
	const doc = {
		id: "map", name, flags, isOwner: true, updates: [],
		pages: { get contents() { return pages; } },
		getFlag: (scope, key) => flags[scope]?.[key] ?? null,
		update(patch) { doc.updates.push(patch); applyDotted(doc, patch); return Promise.resolve(doc); },
		createEmbeddedDocuments(type, rows) {
			const made = rows.map(row => pageDoc(
				row.name, row.flags?.["stonetop-pwd"]?.relationshipMap ?? null,
				{ sort: row.sort, parent: doc, flags: row.flags ?? null },
			));
			pages.push(...made);
			return Promise.resolve(made);
		},
		deleteEmbeddedDocuments(type, ids) {
			const gone = pages.filter(p => ids.includes(p.id));
			for (const p of gone) pages.splice(pages.indexOf(p), 1);
			return Promise.resolve(gone);
		},
	};
	return doc;
};

/** A map with its home board already converted, as every map opened since pages arrived is. */
function mapped(name = "Stonetop", nodes = {}) {
	const map = entry(name, { "stonetop-pwd": { relationshipMap: { version: 2 } } });
	map.pages.contents.push(pageDoc(name, { nodes, edges: {} }, { sort: 0, parent: map }));
	return map;
}

const resident = name => ({ uuid: `Actor.${name.toLowerCase()}`, name, img: "" });
const VILLAGE = [resident("Quill"), resident("Maeve"), resident("Brakkos")];

/** The people on a board, by name, in whatever order the graph holds them. */
const namesOn = page => Object.values(readGraph(page).nodes).map(node => node.name).sort();

beforeEach(() => {
	nextPageId = 0;
	globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER, OBSERVER: 2 } };
	globalThis.game = { ...globalThis.game, user: { isGM: true } };
	globalThis.foundry = {
		...globalThis.foundry,
		utils: { ...globalThis.foundry?.utils, randomID: () => `id${++nextPageId}` },
	};
});

describe("seating the village", () => {
	it("puts every resident on the map's own board and marks it", async () => {
		const map = mapped();
		const said = await syncVillagePage(map, VILLAGE);
		expect(said.addedPeople).toBe(3);
		expect(namesOn(getVillagePage(map))).toEqual(["Brakkos", "Maeve", "Quill"]);
		expect(hadVillagePage(map)).toBe(true);
		// One board, not two: it adopted the one that was there rather than making its own.
		expect(listMapPages(map)).toHaveLength(1);
	});

	// ⚠ THE BOARD IT ADOPTS IS THE MAP'S OWN, AND THE PARTY'S IS NOT IT. The party board sorts to
	// the FRONT of the strip, so "the first page" stopped meaning "the map's own board" the day it
	// did; adopting by position would seat the whole village on the board meant to hold six people.
	it("never adopts the party's board, which now sorts ahead of it", async () => {
		const map = mapped();
		await syncPartyPage(map, [{ id: "pim", uuid: "Actor.pim", name: "Pim", img: "" }], new Map());
		expect(listMapPages(map)[0]).toBe(getPartyPage(map));

		await syncVillagePage(map, VILLAGE);
		expect(getVillagePage(map)).not.toBe(getPartyPage(map));
		expect(namesOn(getPartyPage(map))).toEqual(["Pim"]);
		expect(namesOn(getVillagePage(map))).toEqual(["Brakkos", "Maeve", "Quill"]);
	});

	// It only ever ADDS: whoever the table has already put on this board is left exactly where they
	// were put, and a resident already there is not seated a second time.
	it("joins whoever is already on the board without moving them", async () => {
		const map = mapped("Stonetop", {
			n1: { uuid: "Actor.quill", name: "Quill", x: 12, y: 34 },
			n2: { uuid: null, name: "A stranger", x: 80, y: 80 },
		});
		const said = await syncVillagePage(map, VILLAGE);
		expect(said.addedPeople).toBe(2);
		const graph = readGraph(getVillagePage(map));
		expect(graph.nodes.n1).toMatchObject({ x: 12, y: 34 });
		expect(graph.nodes.n2).toMatchObject({ name: "A stranger" });
		expect(namesOn(getVillagePage(map))).toEqual(["A stranger", "Brakkos", "Maeve", "Quill"]);
	});

	it("writes nothing on the next open when nothing has changed", async () => {
		const map = mapped();
		await syncVillagePage(map, VILLAGE);
		const page = getVillagePage(map);
		const writes = page.updates.length;
		expect(await syncVillagePage(map, VILLAGE)).toBe(null);
		expect(page.updates.length).toBe(writes);
	});

	// A resident added to the steading in the spring appears without anybody adding them.
	it("brings a newcomer onto the board it has already seated", async () => {
		const map = mapped();
		await syncVillagePage(map, VILLAGE);
		const said = await syncVillagePage(map, [...VILLAGE, resident("Tovia")]);
		expect(said.addedPeople).toBe(1);
		expect(namesOn(getVillagePage(map))).toContain("Tovia");
	});
});

describe("the ledger, which is what makes a removal stick", () => {
	// ⚠ THE ONE THE PARTY BOARD HAS NO NEED OF. A party is four people and losing one is an
	// accident; a village is thirty, and a GM who takes the miller off this board means it. Without
	// this, the next open puts him straight back and the only way to be rid of him is to delete the
	// whole board.
	it("does not put back somebody taken off the board", async () => {
		const map = mapped();
		await syncVillagePage(map, VILLAGE);
		const page = getVillagePage(map);
		const quill = Object.entries(readGraph(page).nodes).find(([, n]) => n.name === "Quill")[0];
		delete page.flags["stonetop-pwd"].relationshipMap.nodes[quill];
		expect(namesOn(page)).toEqual(["Brakkos", "Maeve"]);

		expect(await syncVillagePage(map, VILLAGE)).toBe(null);
		expect(namesOn(page)).toEqual(["Brakkos", "Maeve"]);
	});

	// And the way back: pressing the button asks for the whole roster again, ledger and all, so a
	// removal is recoverable rather than permanent.
	it("brings them back when the reader asks outright", async () => {
		const map = mapped();
		await syncVillagePage(map, VILLAGE);
		const page = getVillagePage(map);
		const quill = Object.entries(readGraph(page).nodes).find(([, n]) => n.name === "Quill")[0];
		delete page.flags["stonetop-pwd"].relationshipMap.nodes[quill];

		const said = await syncVillagePage(map, VILLAGE, { asked: true });
		expect(said.addedPeople).toBe(1);
		expect(namesOn(page)).toEqual(["Brakkos", "Maeve", "Quill"]);
	});

	// A resident the TABLE put on the board by hand is accounted for too, so taking them off later
	// is as final as taking off one this board seated. Nobody is added by that pass, so the write
	// it makes is the ledger alone.
	it("accounts for a resident somebody had already added by hand", async () => {
		const map = mapped("Stonetop", { n1: { uuid: "Actor.quill", name: "Quill", x: 12, y: 34 } });
		await syncVillagePage(map, [resident("Quill")]);
		const page = getVillagePage(map);
		delete page.flags["stonetop-pwd"].relationshipMap.nodes.n1;
		expect(await syncVillagePage(map, [resident("Quill")])).toBe(null);
		expect(namesOn(page)).toEqual([]);
	});

	// ⚠ AND IT SAYS NOTHING WHILE IT DOES SO. That pass seats nobody -- everyone it would have
	// offered is already on the board -- so what it writes is the ledger alone, which is
	// bookkeeping. Reported, it reached the reader as an unprompted "0 people seated" toast on a
	// map they had only opened, which is a change announcing itself that never happened.
	it("reports nothing on the pass where only the ledger grew, and still writes it", async () => {
		const map = mapped("Stonetop", { n1: { uuid: "Actor.quill", name: "Quill", x: 12, y: 34 } });
		expect(await syncVillagePage(map, [resident("Quill")])).toBe(null);
		const page = getVillagePage(map);
		// The ledger landed all the same, which is the whole point of the write: the resident is
		// accounted for, so taking them off the board later sticks.
		expect(page.getFlag("stonetop-pwd", "relationshipVillageBoard")?.seated)
			.toEqual(["Actor.quill"]);
	});
});

describe("when it does nothing at all", () => {
	// A world whose steading lists nobody yet gets no mark and no write: it gets its village the
	// first open after there IS one, rather than being marked as done while empty.
	it("waits until the steading has residents", async () => {
		const map = mapped();
		expect(await syncVillagePage(map, [])).toBe(null);
		expect(hadVillagePage(map)).toBe(false);
		await syncVillagePage(map, VILLAGE);
		expect(getVillagePage(map)).toBeTruthy();
	});

	// ⚠ DELETING THE BOARD IS AN ANSWER. The mark is on the ENTRY, so it outlives the page and a
	// village that came back on the next open would be a village nobody could be rid of.
	it("never seats again once the board has been rubbed out", async () => {
		const map = mapped();
		await syncVillagePage(map, VILLAGE);
		const page = getVillagePage(map);
		await map.deleteEmbeddedDocuments("JournalEntryPage", [page.id]);
		expect(getVillagePage(map)).toBe(null);
		expect(await syncVillagePage(map, VILLAGE)).toBe(null);
		expect(listMapPages(map)).toHaveLength(0);
	});

	// Every write in this file is gated on OWNER, and this one runs unasked on somebody else's map.
	it("writes nothing for a reader who may only look", async () => {
		const map = mapped();
		map.isOwner = false;
		expect(await syncVillagePage(map, VILLAGE)).toBe(null);
		expect(namesOn(listMapPages(map)[0])).toEqual([]);
	});
});

describe("the plan itself", () => {
	const id = (() => { let n = 0; return () => `v${++n}`; })();

	// A ring only on an EMPTY board. On a board somebody has arranged, seating the ring again would
	// move every person they placed, which is the one thing this must never do.
	it("seats a ring on an empty board and drops newcomers into the gaps otherwise", () => {
		const ring = villageBoardPlan({ nodes: {}, edges: {} }, VILLAGE, {}, id);
		const spots = Object.values(ring.nodes).map(node => `${node.x},${node.y}`);
		expect(new Set(spots).size).toBe(3);

		const busy = villageBoardPlan(
			{ nodes: { a: { uuid: "Actor.someone", name: "Someone", x: 50, y: 50 } }, edges: {} },
			VILLAGE, {}, id);
		expect(busy.addedPeople).toBe(3);
	});

	it("hands back the ledger it wants remembered", () => {
		const plan = villageBoardPlan({ nodes: {}, edges: {} }, VILLAGE, { seated: ["Actor.gone"] }, id);
		expect(plan.seated).toEqual(expect.arrayContaining(
			["Actor.gone", "Actor.quill", "Actor.maeve", "Actor.brakkos"]));
	});

	it("offers nobody it has been given before", () => {
		const plan = villageBoardPlan({ nodes: {}, edges: {} }, VILLAGE,
			{ seated: ["Actor.quill", "Actor.maeve", "Actor.brakkos"] }, id);
		expect(plan.addedPeople).toBe(0);
		expect(plan.nodes).toEqual({});
	});
});
