import { describe, it, expect, beforeEach, vi } from "vitest";

// The window itself is proved by tests/dialogs/relationship-map-window.test.js. What matters here
// is only that the bouncer reaches for it and never paints, so it is stubbed out.
vi.mock("../../module/dialogs/RelationshipMapWindow.js", () => ({
	openRelationshipMap: vi.fn(),
}));

import { openRelationshipMap } from "../../module/dialogs/RelationshipMapWindow.js";
import {
	RELMAP_FOLDER_NAME, RELMAP_SHEET_CLASS, canCreateRelationshipMap, createRelationshipMap,
	ensureRelationshipMapFolder, findRelationshipMapFolder, getRelationshipMap, listRelationshipMaps,
	readGraph,
} from "../../module/relmap/relmap-doc.js";
import { createRelationshipMapEntrySheetClass } from "../../module/journal/RelationshipMapEntrySheet.js";

// Where a relationship map lives, and the two permission facts the whole feature is shaped around:
// EDITING one needs only OWNER (so every player can), while CREATING one needs the journal-create
// right (so a plain player cannot).

const OWNER = 3;

/** A JournalEntry stand-in. */
const entry = (name, flags = {}, extra = {}) => ({
	id: name.toLowerCase().replace(/\W+/g, ""),
	name,
	flags,
	getFlag: (scope, key) => flags[scope]?.[key] ?? null,
	...extra,
});

let created;
let folders;
let journals;
let canCreateJournal;
let canCreateFolder;

beforeEach(() => {
	created = [];
	folders = [];
	journals = [];
	canCreateJournal = true;
	canCreateFolder = true;
	globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER, OBSERVER: 2 } };
	globalThis.game = {
		user: { id: "u1" },
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

	it("carries its graph and its sheet class from the very first write", async () => {
		await createRelationshipMap("The people of Stonetop");
		expect(created[0].flags.core.sheetClass).toBe(RELMAP_SHEET_CLASS);
		expect(created[0].flags["stonetop-pwd"].relationshipMap).toMatchObject({ nodes: {}, edges: {} });
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
		expect(openRelationshipMap).toHaveBeenCalledWith(doc);
		expect(painted).not.toHaveBeenCalled();
		expect(sheet.close).toHaveBeenCalled();
	});
});
