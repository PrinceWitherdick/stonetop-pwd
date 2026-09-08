import { afterEach, describe, expect, it } from "vitest";
import {
	hideRelationshipMapRows, isJournalDirectory, isRelationshipMapEntry, isRelationshipMapFolder,
} from "../../module/hooks/journal-directory-maps.js";
import { RELMAP_FOLDER_NAME } from "../../module/relmap/relmap-doc.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// The pass takes relationship-map rows out of the Journal sidebar. The test env is node, so the
// DOM surface it touches is faked: a tree of <li>s and the two selectors it asks for.

class El {
	constructor(tag, className = "") {
		this.tag = tag;
		this.className = className;
		this.children = [];
		this.parent = null;
		this.dataset = {};
	}
	append(kid) { kid.parent = this; this.children.push(kid); return kid; }
	remove() {
		if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
		this.parent = null;
	}
	_descendants(out = []) { for (const c of this.children) { out.push(c); c._descendants(out); } return out; }
	_is(sel) {
		if (sel.includes(".folder")) return this.className.includes("folder") && !!this.dataset.folderId;
		return this.className.includes("document") && !!this.dataset.entryId;
	}
	querySelectorAll(sel) { return this._descendants().filter(n => n.tag === "li" && n._is(sel)); }
}

const mapFlag = { [SYSTEM_ID]: { relationshipMap: { version: 2 } } };

/** One journal entry, real enough for the flag read under test. */
function entryDoc(id, name, { map = false, folder = null } = {}) {
	const flags = map ? mapFlag : {};
	return {
		id, name, folder,
		getFlag: (scope, key) => flags[scope]?.[key],
	};
}

/** A rendered Journal directory: one <li> per row, drawn the way core's partials draw them. */
function directory({ entries = [], folders = [] } = {}) {
	const root = new El("div");
	for (const folder of folders) {
		const li = root.append(new El("li", "directory-item folder flexcol"));
		li.dataset.folderId = folder.id;
	}
	for (const entry of entries) {
		const li = root.append(new El("li", "directory-item entry document flexrow"));
		li.dataset.entryId = entry.id;
	}
	const app = {
		collection: {
			documentName: "JournalEntry",
			get: id => entries.find(e => e.id === id) ?? null,
		},
	};
	return { app, root };
}

const rowIds = root => root.querySelectorAll("li.directory-item.document[data-entry-id]")
	.map(li => li.dataset.entryId);
const folderIds = root => root.querySelectorAll("li.directory-item.folder[data-folder-id]")
	.map(li => li.dataset.folderId);

afterEach(() => { delete globalThis.game; });

describe("isJournalDirectory", () => {
	it("takes a world Journal directory", () => {
		expect(isJournalDirectory({ collection: { documentName: "JournalEntry", get: () => null } })).toBe(true);
	});

	it("refuses every other sidebar tab, and a compendium's index view", () => {
		expect(isJournalDirectory({ collection: { documentName: "Actor", get: () => null } })).toBe(false);
		// `index` is what tells a CompendiumCollection from a world one.
		expect(isJournalDirectory({ collection: { documentName: "JournalEntry", get: () => null, index: new Map() } }))
			.toBe(false);
		expect(isJournalDirectory(null)).toBe(false);
	});
});

describe("isRelationshipMapEntry", () => {
	it("goes by the flag and not by the name", () => {
		expect(isRelationshipMapEntry(entryDoc("a", "Stonetop", { map: true }))).toBe(true);
		// A prose entry a GM happened to call the same thing is not a map.
		expect(isRelationshipMapEntry(entryDoc("b", "Stonetop"))).toBe(false);
		expect(isRelationshipMapEntry(null)).toBe(false);
	});
});

describe("isRelationshipMapFolder", () => {
	const folder = (over = {}) => ({
		id: "f1", name: RELMAP_FOLDER_NAME, contents: [], getSubfolders: () => [], ...over,
	});

	it("goes when everything in it is a map", () => {
		expect(isRelationshipMapFolder(folder({ contents: [entryDoc("a", "Stonetop", { map: true })] }))).toBe(true);
	});

	it("stays when a GM has filed anything else beside them", () => {
		expect(isRelationshipMapFolder(folder({
			contents: [entryDoc("a", "Stonetop", { map: true }), entryDoc("b", "Notes on the village")],
		}))).toBe(false);
	});

	it("stays when it holds a subfolder", () => {
		expect(isRelationshipMapFolder(folder({ getSubfolders: () => [{ id: "f2" }] }))).toBe(false);
	});

	it("goes when empty and still called what we called it, and stays when renamed", () => {
		expect(isRelationshipMapFolder(folder())).toBe(true);
		expect(isRelationshipMapFolder(folder({ name: "Webs and Ties" }))).toBe(false);
	});
});

describe("hideRelationshipMapRows", () => {
	it("takes the map rows out and leaves every other journal alone", () => {
		const maps = entryDoc("map", "Stonetop", { map: true });
		const lore = entryDoc("lore", "The Gods of Stonetop");
		const { app, root } = directory({ entries: [maps, lore] });
		globalThis.game = { folders: { get: () => null } };

		hideRelationshipMapRows(app, root);
		expect(rowIds(root)).toEqual(["lore"]);
	});

	it("takes the folder with them when nothing else is in it", () => {
		const map = entryDoc("map", "Stonetop", { map: true });
		const folder = { id: "f1", name: RELMAP_FOLDER_NAME, contents: [map], getSubfolders: () => [] };
		const { app, root } = directory({ entries: [map], folders: [folder] });
		globalThis.game = { folders: { get: id => (id === "f1" ? folder : null) } };

		hideRelationshipMapRows(app, root);
		expect(rowIds(root)).toEqual([]);
		expect(folderIds(root)).toEqual([]);
	});

	it("leaves a folder holding anything else, even with its map row gone", () => {
		const map = entryDoc("map", "Stonetop", { map: true });
		const notes = entryDoc("notes", "Village notes");
		const folder = { id: "f1", name: RELMAP_FOLDER_NAME, contents: [map, notes], getSubfolders: () => [] };
		const { app, root } = directory({ entries: [map, notes], folders: [folder] });
		globalThis.game = { folders: { get: id => (id === "f1" ? folder : null) } };

		hideRelationshipMapRows(app, root);
		expect(rowIds(root)).toEqual(["notes"]);
		expect(folderIds(root)).toEqual(["f1"]);
	});

	it("touches nothing on another sidebar tab", () => {
		const map = entryDoc("map", "Stonetop", { map: true });
		const { root } = directory({ entries: [map] });
		const actors = { collection: { documentName: "Actor", get: () => map } };
		globalThis.game = { folders: { get: () => null } };

		hideRelationshipMapRows(actors, root);
		expect(rowIds(root)).toEqual(["map"]);
	});

	it("survives a render with no element to walk", () => {
		const app = { collection: { documentName: "JournalEntry", get: () => null } };
		expect(() => hideRelationshipMapRows(app, null)).not.toThrow();
	});
});
