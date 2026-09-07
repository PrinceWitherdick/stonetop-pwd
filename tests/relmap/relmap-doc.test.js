import { describe, it, expect, beforeEach, vi } from "vitest";

// The window itself is proved by tests/dialogs/relationship-map-window.test.js. What matters here
// is only that the bouncer reaches for it and never paints, so it is stubbed out.
vi.mock("../../module/dialogs/RelationshipMapWindow.js", () => ({
	openRelationshipMap: vi.fn(),
}));

import { openRelationshipMap } from "../../module/dialogs/RelationshipMapWindow.js";
import {
	RELMAP_FOLDER_NAME, RELMAP_PAGE_NAME_MAX, RELMAP_SHEET_CLASS, canCreateRelationshipMap,
	canHideMapPages, canSeeMapPage, createMapPage, createRelationshipMap, deleteMapPage,
	ensureFirstMapPage, ensureRelationshipMapFolder, findRelationshipMapFolder, getMapPage,
	getRelationshipMap, getPartyPage, hadPartyPage, isMapPageHidden, listMapPages,
	listRelationshipMaps, listVisibleMapPages, mapBoardDoc, mapPageName,
	readGraph, renameMapPage, setMapPageHidden, syncPartyPage,
} from "../../module/relmap/relmap-doc.js";
import { RELMAP_VERSION } from "../../module/relmap/relmap-store.js";
import { createRelationshipMapEntrySheetClass } from "../../module/journal/RelationshipMapEntrySheet.js";

// Where a relationship map lives, and the two permission facts the whole feature is shaped around:
// EDITING one needs only OWNER (so every player can), while CREATING one needs the journal-create
// right (so a plain player cannot).

const OWNER = 3;
// The two ends of "may the players look at this board": INHERIT takes the map's own ownership,
// which on a map is OWNER for everybody at the table, and NONE is the GM keeping a board back.
const INHERIT = -1;
const NONE = 0;

/** The real English table, kept from before the suite's `beforeEach` replaces `globalThis.game`,
 * so a page named by the code under test is asserted against the words a player would see. */
const TABLE = globalThis.game.i18n;

let nextPageId = 0;

/**
 * Apply one dotted leaf patch the way a real document does.
 *
 * ⚠ THE FAKE USED TO ONLY RECORD PATCHES, and that is exactly the kind of shortcut that certifies
 * code the real thing never runs correctly: every write in this feature is a DOTTED PATH TO A LEAF
 * (relmap-store.js explains why at length), so a fake that never walks one cannot show that reading
 * the flag back afterwards finds what was written. Two tests wanted precisely that round trip --
 * "the mark survives" and "a newcomer appears on the board" -- and both would have passed against a
 * function that wrote nothing at all.
 *
 * Handles the `-=key` deletion spelling too, which is what `deletionEntry` produces.
 */
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

/**
 * A JournalEntryPage stand-in: ONE BOARD of a map.
 *
 * `graph` of null makes a page that is NOT one of ours — a page of ordinary prose somebody filed
 * on the same entry, which the strip must not offer as a board.
 */
function pageDoc(name, graph, {
	id = null, sort = 0, parent = null, flags: extraFlags = null, ownership = null,
} = {}) {
	const flags = extraFlags ?? (graph === null ? {} : { "stonetop-pwd": { relationshipMap: graph } });
	const doc = {
		id: id ?? `page${++nextPageId}`,
		name,
		sort,
		parent,
		updates: [],
		flags,
		// A board the table can see inherits the map's own ownership, which on a map is OWNER for
		// everybody; one the GM has kept back carries NONE. See relmap/relmap-doc.js.
		ownership: ownership ?? { default: INHERIT },
		getFlag: (scope, key) => flags[scope]?.[key] ?? null,
		// Core's rule, near enough for this: a GM is OWNER over everything, an explicit level for
		// this user beats the default, and INHERIT defers to the parent entry.
		testUserPermission(user, permission) {
			if (user?.isGM) return true;
			const level = doc.ownership?.[user?.id] ?? doc.ownership?.default ?? INHERIT;
			if (level === INHERIT) return !!doc.parent?.isOwner;
			return level >= (permission === "OWNER" ? OWNER : 2);
		},
		// ⚠ DERIVED AND NOT SET, exactly as core derives it: `isOwner` is
		// `testUserPermission(game.user, "OWNER")`. A fake carrying it as a flag of its own would
		// certify a caller asking the wrong document, because both would say yes.
		get isOwner() { return doc.testUserPermission(game?.user, "OWNER"); },
		update(patch) {
			doc.updates.push(patch);
			if ("name" in patch) doc.name = patch.name;
			if (patch.ownership) Object.assign(doc.ownership, patch.ownership);
			applyDotted(doc, patch);
			return Promise.resolve(doc);
		},
	};
	return doc;
}

/** A JournalEntry stand-in, with the embedded collection and the two calls the page layer makes. */
const entry = (name, flags = {}, extra = {}) => {
	const pages = [];
	const doc = {
		id: name.toLowerCase().replace(/\W+/g, ""),
		name,
		flags,
		isOwner: true,
		updates: [],
		// The shape `listMapPages` reads: core's EmbeddedCollection exposes `.contents`.
		pages: { get contents() { return pages; } },
		getFlag: (scope, key) => flags[scope]?.[key] ?? null,
		update(patch) {
			doc.updates.push(patch);
			applyDotted(doc, patch);
			return Promise.resolve(doc);
		},
		createEmbeddedDocuments(type, rows) {
			// ⚠ THE WHOLE FLAG OBJECT, not just the graph. The party board is told apart from every
			// other page by a SECOND flag beside it, and a fake that dropped it would certify a
			// lookup that can never find anything.
			const made = rows.map(row => pageDoc(row.name, row.flags?.["stonetop-pwd"]?.relationshipMap ?? null,
				{
					sort: row.sort, parent: doc, flags: row.flags ?? null,
					// ⚠ CARRIED THROUGH, like the flags beside it. Whether a new board arrives hidden
					// from the players is written in the create, and a fake that dropped it would
					// certify the defaulting no matter which way round it was spelt.
					ownership: row.ownership ?? null,
				}));
			pages.push(...made);
			return Promise.resolve(made);
		},
		deleteEmbeddedDocuments(type, ids) {
			const gone = pages.filter(p => ids.includes(p.id));
			for (const p of gone) pages.splice(pages.indexOf(p), 1);
			return Promise.resolve(gone);
		},
		...extra,
	};
	return doc;
};

/** A map with the boards named, in the order given. Sorted apart so the strip's own ordering is
 * the thing under test rather than the order they happened to be pushed in. */
function mapWith(name, boards) {
	const map = entry(name, { "stonetop-pwd": { relationshipMap: { version: 2 } } });
	boards.forEach((board, i) => map.pages.contents.push(
		pageDoc(board.name, board.graph ?? { nodes: {}, edges: {} },
			{
				id: board.id, sort: board.sort ?? i * 100000, parent: map,
				// `hidden: true` is a board the GM has kept back from the table.
				ownership: board.hidden ? { default: NONE } : null,
			}),
	));
	return map;
}

let created;
let folders;
let journals;
let canCreateJournal;
let canCreateFolder;

beforeEach(() => {
	created = [];
	folders = [];
	journals = [];
	nextPageId = 0;
	canCreateJournal = true;
	canCreateFolder = true;
	globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { INHERIT, NONE, LIMITED: 1, OBSERVER: 2, OWNER } };
	globalThis.game = {
		user: { id: "u1" },
		i18n: TABLE,
		folders: { get contents() { return folders; } },
		journal: {
			get contents() { return journals; },
			get: id => journals.find(j => j.id === id) ?? null,
		},
	};
	globalThis.JournalEntry = {
		canUserCreate: () => canCreateJournal,
		create: data => { created.push(data); const made = entry(data.name, data.flags); folders.push; journals.push(made); return Promise.resolve(made); },
	};
	globalThis.Folder = {
		canUserCreate: () => canCreateFolder,
		create: data => { const made = { id: "f1", ...data }; folders.push(made); return Promise.resolve(made); },
	};
});

describe("the folder maps are filed in", () => {
	it("finds nothing, and creates nothing, in a world that has none", () => {
		expect(findRelationshipMapFolder()).toBeNull();
		expect(folders).toEqual([]);
	});

	it("creates it once and finds it thereafter", async () => {
		const made = await ensureRelationshipMapFolder();
		expect(made.name).toBe(RELMAP_FOLDER_NAME);
		expect(made.type).toBe("JournalEntry");
		expect(await ensureRelationshipMapFolder()).toBe(made);
		expect(folders).toHaveLength(1);
	});

	// Creating a Folder is its own role-gated right. A player who may edit every map in the world
	// still may not make a folder, and this must hand back null for the caller to file at the root
	// rather than throwing in the middle of "add a map".
	it("hands back null rather than throwing when this user may not create folders", async () => {
		canCreateFolder = false;
		expect(await ensureRelationshipMapFolder()).toBeNull();
	});

	// The read-only lookup is separate precisely so a player opening a map never conjures a folder
	// just by asking.
	it("has a lookup that creates nothing", () => {
		findRelationshipMapFolder();
		expect(folders).toEqual([]);
	});
});

describe("finding the maps in a world", () => {
	// By the FLAG, not by folder membership: a GM who files a map beside the front it belongs to,
	// or renames the folder, has not stopped it being a map.
	it("finds a map wherever it has been filed", () => {
		journals = [
			entry("A map", { "stonetop-pwd": { relationshipMap: { nodes: {} } } }),
			entry("Session notes", {}),
			entry("Another map", { "stonetop-pwd": { relationshipMap: { nodes: {} } } }),
		];
		expect(listRelationshipMaps().map(m => m.name)).toEqual(["A map", "Another map"]);
	});

	it("does not mistake an ordinary journal for one", () => {
		journals = [entry("Session notes", {})];
		expect(listRelationshipMaps()).toEqual([]);
		expect(getRelationshipMap("sessionnotes")).toBeNull();
	});

	it("reads a stored graph back through the normalizer", () => {
		const map = entry("A map", {
			"stonetop-pwd": { relationshipMap: { nodes: { "bad.id": { x: 1, y: 1 } } } },
		});
		expect(readGraph(map).nodes).toEqual({});
	});
});

describe("making a new map", () => {
	// The asymmetry the whole feature is shaped around, asserted directly.
	it("is refused when this user may not create journals", async () => {
		canCreateJournal = false;
		expect(canCreateRelationshipMap()).toBe(false);
		expect(await createRelationshipMap("Mine")).toBeNull();
		expect(created).toEqual([]);
	});

	it("is owned by everybody, so the whole table can edit it", async () => {
		await createRelationshipMap("The people of Stonetop");
		expect(created[0].ownership).toEqual({ default: OWNER });
	});

	// The entry's own flag is the MARK that says "this is a map", not a graph: the graph lives on
	// the page below. What matters is that it stays TRUTHY, because `listRelationshipMaps` finds
	// every map in the world by exactly that.
	it("carries the mark and its sheet class from the very first write", async () => {
		await createRelationshipMap("The people of Stonetop");
		expect(created[0].flags.core.sheetClass).toBe(RELMAP_SHEET_CLASS);
		expect(created[0].flags["stonetop-pwd"].relationshipMap).toEqual({ version: RELMAP_VERSION });
		expect(created[0].flags["stonetop-pwd"].relationshipMap).toBeTruthy();
	});

	// A map that arrives with no board at all is a window that sits blank until the first person
	// who may edit it clicks something — which for a player watching a GM's screen share is a
	// feature that looks broken.
	it("arrives with its first board already on it, named after the map", async () => {
		await createRelationshipMap("The people of Stonetop");
		const [first] = created[0].pages;
		expect(first.name).toBe("The people of Stonetop");
		expect(first.sort).toBe(0);
		expect(first.flags["stonetop-pwd"].relationshipMap).toMatchObject({ nodes: {}, edges: {} });
	});

	it("files it in the folder", async () => {
		await createRelationshipMap("Mine");
		expect(created[0].folder).toBe("f1");
	});

	it("still makes the map when there is no folder to file it in", async () => {
		canCreateFolder = false;
		await createRelationshipMap("Mine");
		expect(created[0].folder).toBeNull();
	});
});

// ── The pages a map is made of ──────────────────────────────────────────────────────────────────
//
// One map is several NAMED BOARDS, each a JournalEntryPage carrying its own graph. The permission
// story is the reason to store them this way: a page's create, update and delete are all gated on
// the PARENT entry's ownership, so a plain player who cannot make a new map can make as many boards
// on this one as the table needs.

describe("the boards a map is made of", () => {
	it("lists them in strip order, by sort and then by name", () => {
		const map = mapWith("A map", [
			{ name: "Marshedge", sort: 200000 },
			{ name: "Stonetop", sort: 0 },
			{ name: "The Millers", sort: 100000 },
		]);
		expect(listMapPages(map).map(p => p.name)).toEqual(["Stonetop", "The Millers", "Marshedge"]);
	});

	// The tie-break is not decoration. `sort` is only unique because this file keeps it so, and two
	// people at opposite ends of the table adding a page in the same second land on the same
	// number — after which object order differs per client, and two readers talking to each other
	// about "the third tab" are looking at different boards.
	it("breaks a tie on sort by name, so every client sees the same order", () => {
		const map = mapWith("A map", [
			{ name: "Zither", sort: 0 },
			{ name: "Anvil", sort: 0 },
		]);
		expect(listMapPages(map).map(p => p.name)).toEqual(["Anvil", "Zither"]);
	});

	// A GM is entitled to file a page of ordinary prose on a map. A strip that drew a tab for it
	// would offer a board that is not one.
	it("ignores a page of prose filed on the same entry", () => {
		const map = mapWith("A map", [{ name: "Stonetop" }]);
		map.pages.contents.push(pageDoc("Notes for tonight", null, { parent: map }));
		expect(listMapPages(map).map(p => p.name)).toEqual(["Stonetop"]);
	});

	// Handed a name it does not know, this must never quietly hand back a different board: a write
	// meant for one page landing on another is the worst failure this layer has.
	it("hands back nothing at all for a page id it does not know", () => {
		const map = mapWith("A map", [{ name: "Stonetop", id: "p1" }]);
		expect(getMapPage(map, "p1").name).toBe("Stonetop");
		expect(getMapPage(map, "nope")).toBeNull();
	});
});

describe("the document a board is read from and written to", () => {
	it("is the page that was asked for", () => {
		const map = mapWith("A map", [{ name: "Stonetop", id: "p1" }, { name: "Marshedge", id: "p2" }]);
		expect(mapBoardDoc(map, "p2").name).toBe("Marshedge");
	});

	// Somebody at the far end of the table can rub out the board this reader is standing on.
	it("falls through to the first board when that page has gone", () => {
		const map = mapWith("A map", [{ name: "Stonetop", id: "p1" }, { name: "Marshedge", id: "p2" }]);
		expect(mapBoardDoc(map, "gone").name).toBe("Stonetop");
	});

	// ⚠ THE WHOLE OF THE VERSION 1 STORY, from the window's point of view. A map written before
	// pages existed keeps its graph on the entry, and the flag is the same shape there — so the
	// window reads and writes through one handle and needs no second code path anywhere.
	it("is the ENTRY itself on a map that still has no pages", () => {
		const legacy = entry("Old map", {
			"stonetop-pwd": { relationshipMap: { version: 1, nodes: { a: { x: 5, y: 5 } } } },
		});
		expect(mapBoardDoc(legacy, null)).toBe(legacy);
		expect(Object.keys(readGraph(mapBoardDoc(legacy, null)).nodes)).toEqual(["a"]);
	});
});

describe("giving a version 1 map its first page", () => {
	const legacyMap = () => entry("The people of Stonetop", {
		"stonetop-pwd": {
			relationshipMap: {
				version: 1,
				shape: "clusters",
				nodes: { a: { name: "Ordga", x: 10, y: 20 } },
				edges: {},
			},
		},
	});

	it("moves the whole board onto a page named after the map", async () => {
		const map = legacyMap();
		const page = await ensureFirstMapPage(map);
		expect(page.name).toBe("The people of Stonetop");
		const moved = readGraph(page);
		expect(moved.nodes.a).toMatchObject({ name: "Ordga", x: 10, y: 20 });
	});

	// The entry keeps the MARK and loses the graph. Both halves matter: a second copy of the board
	// left on the entry is a second truth waiting to be read by something that has not heard about
	// pages, and an entry with no flag at all stops being a map the moment it becomes one.
	it("strips the graph off the entry and leaves the mark behind", async () => {
		const map = legacyMap();
		await ensureFirstMapPage(map);
		expect(map.updates[0]).toEqual({
			"flags.stonetop-pwd.relationshipMap.version": RELMAP_VERSION,
			"flags.stonetop-pwd.relationshipMap.-=nodes": null,
			"flags.stonetop-pwd.relationshipMap.-=edges": null,
			"flags.stonetop-pwd.relationshipMap.-=shape": null,
		});
	});

	// Every window on the map runs this. A second one that made a second page would open the map
	// with its board duplicated across two tabs.
	it("does nothing at all the second time", async () => {
		const map = legacyMap();
		const first = await ensureFirstMapPage(map);
		const again = await ensureFirstMapPage(map);
		expect(again).toBe(first);
		expect(listMapPages(map)).toHaveLength(1);
		expect(map.updates).toHaveLength(1);
	});

	// A reader who may only look must not rewrite somebody else's map by opening it. They see the
	// entry's own graph instead, which is exactly what they had before.
	it("writes nothing for a reader who may not edit", async () => {
		const map = legacyMap();
		map.isOwner = false;
		expect(await ensureFirstMapPage(map)).toBeNull();
		expect(listMapPages(map)).toEqual([]);
		expect(map.updates).toEqual([]);
	});
});

describe("adding, renaming and rubbing out a board", () => {
	it("adds one after the last, so it lands where the reader pressed the button", async () => {
		const map = mapWith("A map", [{ name: "Stonetop", sort: 0 }, { name: "Marshedge", sort: 100000 }]);
		const made = await createMapPage(map, "The Millers");
		expect(made.sort).toBeGreaterThan(100000);
		expect(listMapPages(map).map(p => p.name))
			.toEqual(["Stonetop", "Marshedge", "The Millers"]);
		expect(readGraph(made)).toMatchObject({ nodes: {}, edges: {} });
	});

	it("is refused for a reader who may not edit the map", async () => {
		const map = mapWith("A map", [{ name: "Stonetop" }]);
		map.isOwner = false;
		expect(await createMapPage(map, "Nope")).toBeNull();
		expect(listMapPages(map)).toHaveLength(1);
	});

	// Core's `name` refuses a blank outright, so a reader who saves the box without typing would
	// throw rather than be told no.
	it("names an unnamed board rather than refusing it", async () => {
		const map = mapWith("A map", [{ name: "Stonetop" }]);
		const made = await createMapPage(map, "   ");
		expect(made.name).toBe(TABLE.localize("stonetop.relmap.pages.untitled"));
	});

	it("shortens a name too long for the strip rather than refusing it", () => {
		expect(mapPageName("x".repeat(200))).toHaveLength(RELMAP_PAGE_NAME_MAX);
	});

	it("renames a board", async () => {
		const map = mapWith("A map", [{ name: "Stonetop" }]);
		const [page] = listMapPages(map);
		expect(await renameMapPage(page, "  The people of Stonetop  ")).toBe(true);
		expect(page.updates[0]).toEqual({ name: "The people of Stonetop" });
	});

	// A reader who opens the rename box and saves without typing must not broadcast a change to
	// every other client at the table.
	it("writes nothing for a name that came back the same", async () => {
		const map = mapWith("A map", [{ name: "Stonetop" }]);
		const [page] = listMapPages(map);
		expect(await renameMapPage(page, "Stonetop")).toBe(false);
		expect(page.updates).toEqual([]);
	});

	it("rubs one out", async () => {
		const map = mapWith("A map", [{ name: "Stonetop", id: "p1" }, { name: "Marshedge", id: "p2" }]);
		expect(await deleteMapPage(getMapPage(map, "p2"))).toBe(true);
		expect(listMapPages(map).map(p => p.name)).toEqual(["Stonetop"]);
	});

	// ⚠ NEVER THE LAST ONE. A map with no pages is one whose next opener silently converts it from
	// its own long-dead entry graph, which is empty — so this would read as the map emptying itself.
	it("refuses to rub out the last board", async () => {
		const map = mapWith("A map", [{ name: "Stonetop", id: "p1" }]);
		expect(await deleteMapPage(getMapPage(map, "p1"))).toBe(false);
		expect(listMapPages(map)).toHaveLength(1);
	});

	it("refuses to rub one out for a reader who may not edit the map", async () => {
		const map = mapWith("A map", [{ name: "Stonetop", id: "p1" }, { name: "Marshedge", id: "p2" }]);
		map.isOwner = false;
		expect(await deleteMapPage(getMapPage(map, "p2"))).toBe(false);
		expect(listMapPages(map)).toHaveLength(2);
	});
});

// The join nothing else checks, and whose failure is silent: core stores the sheet id as
// `scope.ClassName`, every map carries that string in its own flag, and a class rename would drop
// every existing map onto Foundry's generic prose sheet with no error anywhere.
describe("the sheet the sidebar row opens", () => {
	class FakeBase {
		constructor(doc) { this.document = doc; }
		static get defaultOptions() { return {}; }
	}

	it("has the exact class name the stored sheet id names", () => {
		const cls = createRelationshipMapEntrySheetClass(FakeBase);
		expect(`stonetop-pwd.${cls.name}`).toBe(RELMAP_SHEET_CLASS);
	});

	it("opens the board instead of painting itself", async () => {
		const cls = createRelationshipMapEntrySheetClass(FakeBase);
		const doc = entry("A map", { "stonetop-pwd": { relationshipMap: { nodes: {} } } });
		const sheet = new cls(doc);
		sheet.close = vi.fn().mockResolvedValue(undefined);
		// The bouncer must never call up into the base render, or the blank prose window it exists
		// to prevent flashes up anyway.
		const painted = vi.fn();
		FakeBase.prototype._render = painted;
		await sheet._render(true, {});
		await new Promise(r => setTimeout(r, 0));
		expect(openRelationshipMap).toHaveBeenCalledWith(doc, {});
		expect(painted).not.toHaveBeenCalled();
		expect(sheet.close).toHaveBeenCalled();
	});

	// utils/window-restore.js reopens a saved window by rendering `doc.sheet` at the geometry it was
	// left in, and for a map `doc.sheet` is the bouncer. A bouncer that swallowed its options would
	// put every restored board back in the middle of the screen at its default size.
	it("forwards the geometry it was rendered at to the board", async () => {
		const cls = createRelationshipMapEntrySheetClass(FakeBase);
		const doc = entry("A map", { "stonetop-pwd": { relationshipMap: { nodes: {} } } });
		const sheet = new cls(doc);
		sheet.close = vi.fn().mockResolvedValue(undefined);
		const where = { left: 10, top: 20, width: 900, height: 700 };
		await sheet._render(true, where);
		expect(openRelationshipMap).toHaveBeenCalledWith(doc, where);
	});

	// Window restore minimizes the sheet it rendered the instant it renders it. Here that sheet
	// painted nothing and is about to close, and `Application#minimize` does nothing at all for a
	// window that is not on screen yet — so a board left minimized would come back full size.
	it("hands a minimize on to the board, which holds it until it has rendered", async () => {
		const board = { openMinimized: vi.fn() };
		openRelationshipMap.mockReturnValueOnce(board);
		const cls = createRelationshipMapEntrySheetClass(FakeBase);
		const doc = entry("A map", { "stonetop-pwd": { relationshipMap: { nodes: {} } } });
		const sheet = new cls(doc);
		sheet.close = vi.fn().mockResolvedValue(undefined);
		await sheet._render(true, {});
		await sheet.minimize();
		expect(board.openMinimized).toHaveBeenCalled();
	});
});

// ⚠ THE FIRST BOARD BEFORE THE SECOND. A map still on version 1 has its whole board on the entry
// and no page at all. Adding a second board to it without moving the first onto a page would leave
// the board document resolving to the new EMPTY page: pressing "New page" would look exactly like
// sweeping everybody off the map.
describe("adding a board to a map that has never had one", () => {
	const legacyMap = () => entry("The people of Stonetop", {
		"stonetop-pwd": {
			relationshipMap: { version: 1, nodes: { a: { name: "Ordga", x: 10, y: 20 } }, edges: {} },
		},
	});

	it("moves the existing board onto a page first", async () => {
		const map = legacyMap();
		await createMapPage(map, "Marshedge");
		const names = listMapPages(map).map(p => p.name);
		expect(names).toEqual(["The people of Stonetop", "Marshedge"]);
	});

	it("leaves the people where they were rather than on the new board", async () => {
		const map = legacyMap();
		const made = await createMapPage(map, "Marshedge");
		const [first] = listMapPages(map);
		expect(Object.keys(readGraph(first).nodes)).toEqual(["a"]);
		expect(Object.keys(readGraph(made).nodes)).toEqual([]);
		// And the board the window would open on is the one with everybody on it.
		expect(mapBoardDoc(map, null).name).toBe("The people of Stonetop");
	});
});

// ── The party's own board ───────────────────────────────────────────────────────────────────────
//
// Asked for as "I don't want to have to manually add the party members. I want them to
// automatically be on their own sheet named The Party." So it makes itself on open. Everything
// below is about the three ways that could go wrong: making it twice, making it again after
// somebody deliberately deleted it, and rearranging a board the table has arranged.

describe("the party board", () => {
	const pc = (id, name) => ({ id, uuid: `Actor.${id}`, name, img: "", slug: "the-fox" });
	const PARTY = [pc("pim", "Pim"), pc("sela", "Sela")];
	const said = new Map([["Actor.pim", new Map([["Actor.sela", [
		{ label: "closest kin", said: "Who is your closest kin? Sela.", ink: "green" },
	]]])]]);

	/** A map with its first board already converted, as every map opened since pages arrived is. */
	const mapped = () => mapWith("The people of Stonetop", [{ name: "The people of Stonetop" }]);

	it("makes a board called The Party, seats the party, and draws what they answered", async () => {
		const map = mapped();
		const made = await syncPartyPage(map, PARTY, said);
		expect(made.addedPeople).toBe(2);
		expect(made.addedLines).toBe(1);
		const page = getPartyPage(map);
		expect(page.name).toBe("The Party");
		const graph = readGraph(page);
		expect(Object.values(graph.nodes).map(n => n.name).sort()).toEqual(["Pim", "Sela"]);
		expect(Object.values(graph.edges)[0]).toMatchObject({ label: "closest kin", dir: "a-b", src: "intros" });
	});

	// Every other board is somewhere the table went; this one is who the table IS, so it opens the
	// strip. A board created on the END would be the tab furthest from the eye on the map whose
	// whole point is the people at the table.
	it("puts it at the front of the strip, in front of the board that was already there", async () => {
		const map = mapped();
		await syncPartyPage(map, PARTY, said);
		expect(listMapPages(map).map(page => page.name)).toEqual(["The Party", "The people of Stonetop"]);
	});

	// ⚠ AND THE MAPS THAT ALREADY HAD ONE. The board used to be created on the end of the strip, so
	// "the party board is the first tab" would otherwise be true of new maps only -- and false for
	// every table that has been using this since before it was decided.
	it("brings a party board that was made on the end round to the front", async () => {
		const map = mapped();
		await syncPartyPage(map, PARTY, said);
		const page = getPartyPage(map);
		// Put it back where an older map has it.
		await page.update({ sort: 200000 });
		expect(listMapPages(map)[0].name).toBe("The people of Stonetop");

		await syncPartyPage(map, PARTY, said);
		expect(listMapPages(map)[0]).toBe(page);
	});

	// A new board still belongs on the END of the strip, which is where the button that made it
	// sits. The party board being in front of everything must not put it in front of that too.
	it("leaves a board added afterwards on the end", async () => {
		const map = mapped();
		await syncPartyPage(map, PARTY, said);
		await createMapPage(map, "The Millers");
		expect(listMapPages(map).map(page => page.name))
			.toEqual(["The Party", "The people of Stonetop", "The Millers"]);
	});

	// ⚠ FOUND BY A FLAG AND NOT BY ITS NAME, because the page is renameable like any other and a
	// table that calls it "Us" must not get a second one on the next open.
	it("still knows its own board after it has been renamed", async () => {
		const map = mapped();
		await syncPartyPage(map, PARTY, said);
		await renameMapPage(getPartyPage(map), "Us");
		expect(getPartyPage(map)?.name).toBe("Us");
		await syncPartyPage(map, PARTY, said);
		expect(listMapPages(map)).toHaveLength(2);
	});

	it("adds nothing on the next open when nothing has changed", async () => {
		const map = mapped();
		await syncPartyPage(map, PARTY, said);
		const page = getPartyPage(map);
		const writes = page.updates.length;
		expect(await syncPartyPage(map, PARTY, said)).toBe(null);
		expect(page.updates.length).toBe(writes);
	});

	// ⚠ ADOPTION IS A WRITE THAT REPORTS NOTHING. A board seeded before the lines carried the key of
	// the answer they came from is matched to its answers ONCE and marked, so it is never guessed
	// about again — but nobody was seated and no line was drawn, so there is nothing to announce.
	// Reported, it reaches the reader as "0 people, 0 lines" on a map they had only opened.
	it("writes the answer's key onto a line that had none, and says nothing about it", async () => {
		const map = mapped();
		const keyed = new Map([["Actor.pim", new Map([["Actor.sela", [
			{ key: "pim::step4::0", label: "closest kin", said: "Who is your closest kin? Sela.", ink: "green" },
		]]])]]);
		// Seeded by the version that stamped no keys: the board is right, the line is unnamed.
		await syncPartyPage(map, PARTY, said);
		const page = getPartyPage(map);
		const [edgeId] = Object.keys(readGraph(page).edges);
		expect(readGraph(page).edges[edgeId].origin).toBe("");

		expect(await syncPartyPage(map, PARTY, keyed)).toBe(null);
		expect(readGraph(page).edges[edgeId].origin).toBe("pim::step4::0");
		// And nothing was drawn beside it, which is the failure that would double every board in
		// the world on the first open after the change.
		expect(Object.keys(readGraph(page).edges)).toEqual([edgeId]);
	});

	// Once adopted, the answer is recognised by its key wherever it lands in the list -- so an older
	// answer that has just been matched to a person is DRAWN, rather than the board writing a second
	// copy of the line it already had and dropping the new one. See relmap-party.js.
	it("draws an answer matched to a person after the board was already seeded", async () => {
		const map = mapped();
		const first = new Map([["Actor.pim", new Map([["Actor.sela", [
			{ key: "pim::step6::0", label: "stayed my hand", said: "Which one of you has stayed my hand? Sela.", ink: "indigo" },
		]]])]]);
		await syncPartyPage(map, PARTY, first);
		const page = getPartyPage(map);

		// "Match answers to people" points an old Bonds & ties answer at Sela: it lands in FRONT of
		// the step-6 line already drawn, because `introRegards` groups a pair's answers by step.
		const both = new Map([["Actor.pim", new Map([["Actor.sela", [
			{ key: "pim::step4::0", label: "closest kin", said: "Who is your closest kin? Sela.", ink: "green" },
			{ key: "pim::step6::0", label: "stayed my hand", said: "Which one of you has stayed my hand? Sela.", ink: "indigo" },
		]]])]]);
		const made = await syncPartyPage(map, PARTY, both);
		expect(made.addedLines).toBe(1);
		expect(Object.values(readGraph(page).edges).map(edge => edge.label).sort())
			.toEqual(["closest kin", "stayed my hand"]);
	});

	// A player who joins in the spring appears on the board without anybody adding them.
	it("brings a newcomer onto the board it already made", async () => {
		const map = mapped();
		await syncPartyPage(map, PARTY, said);
		const made = await syncPartyPage(map, [...PARTY, pc("marrec", "Marrec")], said);
		expect(made.addedPeople).toBe(1);
		expect(Object.values(readGraph(getPartyPage(map)).nodes).map(n => n.name).sort())
			.toEqual(["Marrec", "Pim", "Sela"]);
	});

	// ⚠ THE ONE THAT WOULD BE UNFORGIVABLE. Deleting the board is an answer, and a board that came
	// back on the next open is a board nobody can be rid of. The mark that says "this map has had
	// its party board" lives on the ENTRY, so it outlives the page it describes.
	it("never makes it again once it has been rubbed out", async () => {
		const map = mapped();
		await syncPartyPage(map, PARTY, said);
		expect(hadPartyPage(map)).toBe(true);
		await deleteMapPage(getPartyPage(map));
		expect(getPartyPage(map)).toBe(null);
		expect(await syncPartyPage(map, PARTY, said)).toBe(null);
		expect(getPartyPage(map)).toBe(null);
	});

	// An empty tab on a world where nobody has made a character yet is chrome answering a question
	// nobody asked. It arrives the first time the map is opened after there IS a party.
	it("waits until there is somebody to put on it", async () => {
		const map = mapped();
		expect(await syncPartyPage(map, [], new Map())).toBe(null);
		expect(listMapPages(map)).toHaveLength(1);
		expect(hadPartyPage(map)).toBe(false);
		await syncPartyPage(map, PARTY, said);
		expect(getPartyPage(map)).toBeTruthy();
	});

	// Every write in this file is gated on OWNER, and this one runs unasked on somebody else's map.
	it("writes nothing for a reader who may only look", async () => {
		const map = mapped();
		map.isOwner = false;
		expect(await syncPartyPage(map, PARTY, said)).toBe(null);
		expect(listMapPages(map)).toHaveLength(1);
	});

	// A map still on version 1 keeps its whole board on the ENTRY. Adding a page to it before
	// converting would leave `mapBoardDoc` resolving to the new one, and the map would look as
	// though opening it had swept everybody off.
	it("converts a version 1 map before adding a board to it", async () => {
		const legacy = entry("The old map", {
			"stonetop-pwd": {
				relationshipMap: {
					version: 1,
					nodes: { old1: { uuid: null, name: "Ordga", x: 30, y: 30 } },
					edges: {},
				},
			},
		});
		await syncPartyPage(legacy, PARTY, said);
		const pages = listMapPages(legacy);
		expect(pages).toHaveLength(2);
		// The party board opens the strip; the board behind it carries what the entry was holding,
		// which is the thing that must not be swept away by the conversion.
		expect(getPartyPage(legacy)).toBe(pages[0]);
		expect(Object.values(readGraph(pages[1]).nodes).map(n => n.name)).toEqual(["Ordga"]);
	});
});

// ── Which boards the players may look at ────────────────────────────────────────────────────────
//
// A board is hidden or shown one page at a time, and it is core's own ownership that says which:
// NONE for a board the GM is keeping back, INHERIT for one the table can see, which on a map owned
// by everybody is a board they may also edit. Every new board starts hidden.
describe("hiding a board from the players", () => {
	const asGM = () => { globalThis.game.user = { id: "gm1", isGM: true }; };
	const asPlayer = () => { globalThis.game.user = { id: "u1", isGM: false }; };

	// THE DEFAULT, AND THE WHOLE REASON THE FEATURE HAS ONE. A board is a picture the GM is still
	// working out, and one that arrived shared would give it away the moment it had a face on it.
	it("makes every new board hidden from the players", async () => {
		const map = mapWith("Stonetop", [{ name: "Stonetop" }]);
		const page = await createMapPage(map, "Marshedge");
		expect(page.ownership.default).toBe(NONE);
		expect(isMapPageHidden(page)).toBe(true);
	});

	// ⚠ AND THE MAKER KEEPS THEIRS. Core's server adds this to a document it is handed on its own,
	// but not to a page created inside its parent's create, which is how a map's first board
	// arrives: without it a trusted player making a map would be handed one they cannot see.
	it("leaves the board with whoever made it", async () => {
		asPlayer();
		const map = mapWith("Stonetop", [{ name: "Stonetop" }]);
		const page = await createMapPage(map, "Marshedge");
		expect(page.ownership.u1).toBe(OWNER);
		expect(page.testUserPermission({ id: "u1" }, "OWNER")).toBe(true);
		expect(page.testUserPermission({ id: "u2" }, "OBSERVER")).toBe(false);
	});

	// A map is made with its first board on it, and that board is new like any other.
	it("makes a new map's own first board hidden too", async () => {
		await createRelationshipMap("Stonetop");
		expect(created[0].pages[0].ownership.default).toBe(NONE);
	});

	// ⚠ THE ONE EXCEPTION, and it is not a new board at all: the version 1 conversion is carrying a
	// board the whole table has been looking at onto a page underneath them. Made hidden it would
	// read as the conversion having stolen the map, and by whoever happened to open it first.
	it("leaves a converted version 1 board shown, because it always was", async () => {
		const legacy = entry("Old map", {
			"stonetop-pwd": { relationshipMap: { nodes: { a: { name: "Jaspar" } }, edges: {} } },
		});
		const page = await ensureFirstMapPage(legacy);
		expect(page.ownership.default).toBe(INHERIT);
		expect(isMapPageHidden(page)).toBe(false);
	});

	// WHAT THE READER SEES AND WHAT THE DOCUMENT LAYER REASONS ABOUT ARE TWO LISTS, and this is the
	// split the whole feature rests on.
	it("keeps a hidden board out of the visible strip and in the whole one", () => {
		asPlayer();
		const map = mapWith("Stonetop", [
			{ id: "p1", name: "Stonetop" },
			{ id: "p2", name: "Marshedge", hidden: true },
		]);
		expect(listMapPages(map).map(p => p.id)).toEqual(["p1", "p2"]);
		expect(listVisibleMapPages(map).map(p => p.id)).toEqual(["p1"]);
		asGM();
		expect(listVisibleMapPages(map).map(p => p.id)).toEqual(["p1", "p2"]);
	});

	// A reader's handle never resolves to a board that is not theirs: it falls through to the next
	// one they may see, exactly as it would if the board had been deleted.
	it("never hands a reader a board they may not look at", () => {
		asPlayer();
		const map = mapWith("Stonetop", [
			{ id: "p1", name: "Stonetop" },
			{ id: "p2", name: "Marshedge", hidden: true },
		]);
		expect(getMapPage(map, "p2")).toBeNull();
		expect(mapBoardDoc(map, "p2").id).toBe("p1");
		asGM();
		expect(getMapPage(map, "p2").name).toBe("Marshedge");
		expect(mapBoardDoc(map, "p2").id).toBe("p2");
	});

	// A GM tests as OWNER over everything in the world, so the eye cannot ask the permission
	// question: it would report every board visible and the GM would have no way to tell.
	it("reads the recorded ownership rather than asking what the GM may do", () => {
		asGM();
		const map = mapWith("Stonetop", [{ id: "p1", name: "Stonetop", hidden: true }]);
		const [page] = listMapPages(map);
		expect(canSeeMapPage(page)).toBe(true);
		expect(isMapPageHidden(page)).toBe(true);
	});

	it("hides and shows a board for a GM", async () => {
		asGM();
		const map = mapWith("Stonetop", [{ id: "p1", name: "Stonetop" }]);
		const [page] = listMapPages(map);
		expect(await setMapPageHidden(page, true)).toBe(true);
		expect(page.updates).toEqual([{ ownership: { default: NONE } }]);
		expect(await setMapPageHidden(page, false)).toBe(true);
		expect(page.ownership.default).toBe(INHERIT);
	});

	// Nothing is written for a board that is already the way it is being asked for, so a GM pressing
	// the eye twice does not broadcast the same state to the whole table twice over.
	it("writes nothing when the board is already that way", async () => {
		asGM();
		const map = mapWith("Stonetop", [{ id: "p1", name: "Stonetop", hidden: true }]);
		const [page] = listMapPages(map);
		expect(await setMapPageHidden(page, true)).toBe(false);
		expect(page.updates).toEqual([]);
	});

	// Core's own sanitizer refuses an ownership change from anybody but a GM, so this is a rail
	// under a button that is not offered rather than a second opinion about it.
	it("refuses a player, however much of the map they own", async () => {
		asPlayer();
		expect(canHideMapPages()).toBe(false);
		const map = mapWith("Stonetop", [{ id: "p1", name: "Stonetop" }]);
		const [page] = listMapPages(map);
		expect(await setMapPageHidden(page, true)).toBe(false);
		expect(page.updates).toEqual([]);
	});

	// ⚠ THE TWO PLACES THAT MUST NOT ASK THE VISIBLE LIST. A conversion that found no pages on a map
	// whose every board is hidden would helpfully make a fresh one and sweep the entry's flags past
	// it; a delete rail that counted only what this reader can see would let the last board go.
	it("reasons about every board, and not only the ones in front of the reader", async () => {
		asPlayer();
		const map = mapWith("Stonetop", [
			{ id: "p1", name: "Stonetop", hidden: true },
			{ id: "p2", name: "Marshedge", hidden: true },
		]);
		expect(await ensureFirstMapPage(map)).toBe(listMapPages(map)[0]);
		expect(listMapPages(map)).toHaveLength(2);

		const one = mapWith("Marshedge", [
			{ id: "q1", name: "Marshedge" },
			{ id: "q2", name: "Gordin's Delve", hidden: true },
		]);
		expect(await deleteMapPage(listMapPages(one)[0])).toBe(true);
		expect(await deleteMapPage(listMapPages(one)[0])).toBe(false);
	});
});
