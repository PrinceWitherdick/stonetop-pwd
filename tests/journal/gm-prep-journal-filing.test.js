import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { unfiledGmPrepJournals, fileGmPrepJournalsInChronicle } from "../../module/journal/gm-prep-page.js";
import { STONETOP_SCOPE } from "../../module/actors/character/StonetopFlags.js";
import { CHRONICLE_FOLDER_NAME } from "../../module/utils/chronicle-core.js";

// A GM-prep journal ("<Steading> Threats" / "Hazards" / "Sites") is marked by a boolean flag
// named for its kind. Everything below turns on that flag and on whether the entry sits in a
// folder, so the fake needs nothing else.
function journal(name, { kind = null, folder = null, id = name } = {}) {
	return {
		id,
		name,
		folder,
		getFlag: (scope, key) => (scope === STONETOP_SCOPE && key === kind ? true : undefined),
	};
}

describe("unfiledGmPrepJournals", () => {
	it("finds every prep kind that is still loose at the sidebar root", () => {
		const stray = unfiledGmPrepJournals([
			journal("Stonetop Threats", { kind: "threat" }),
			journal("Stonetop Hazards", { kind: "hazard" }),
			journal("Stonetop Sites", { kind: "site" }),
			journal("Player Introductions"),
		]);
		expect(stray.map(j => j.name)).toEqual(["Stonetop Threats", "Stonetop Hazards", "Stonetop Sites"]);
	});

	it("leaves a prep journal the GM has already filed somewhere alone", () => {
		const stray = unfiledGmPrepJournals([
			journal("Stonetop Threats", { kind: "threat", folder: { id: "mine", name: "My Prep" } }),
			journal("Stonetop Sites", { kind: "site" }),
		]);
		expect(stray.map(j => j.name)).toEqual(["Stonetop Sites"]);
	});

	it("ignores a journal that is not ours, however it is filed", () => {
		expect(unfiledGmPrepJournals([journal("Setting Overview")])).toEqual([]);
	});
});

describe("fileGmPrepJournalsInChronicle", () => {
	let updates;

	beforeEach(() => {
		updates = [];
		global.game = { user: { isGM: true }, journal: { contents: [] }, folders: { contents: [] } };
		global.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2 } };
		global.Folder = {
			create: vi.fn(async (data) => {
				const f = { id: "chronicle-folder", ...data };
				game.folders.contents.push(f);
				return f;
			}),
		};
		global.JournalEntry = { updateDocuments: vi.fn(async (u) => { updates = u; }) };
	});

	afterEach(() => {
		delete global.game; delete global.CONST; delete global.Folder; delete global.JournalEntry;
	});

	it("moves the loose prep journals into The Chronicle, creating the folder once", async () => {
		game.journal.contents = [
			journal("Stonetop Threats", { kind: "threat", id: "t1" }),
			journal("Stonetop Sites", { kind: "site", id: "s1" }),
		];
		const moved = await fileGmPrepJournalsInChronicle();
		expect(moved).toBe(2);
		expect(Folder.create).toHaveBeenCalledTimes(1);
		expect(Folder.create.mock.calls[0][0]).toMatchObject({ name: CHRONICLE_FOLDER_NAME, type: "JournalEntry" });
		expect(updates).toEqual([
			{ _id: "t1", folder: "chronicle-folder" },
			{ _id: "s1", folder: "chronicle-folder" },
		]);
	});

	it("reuses the Chronicle folder the world already has", async () => {
		game.folders.contents = [{ id: "existing", type: "JournalEntry", name: CHRONICLE_FOLDER_NAME }];
		game.journal.contents = [journal("Stonetop Threats", { kind: "threat", id: "t1" })];
		await fileGmPrepJournalsInChronicle();
		expect(Folder.create).not.toHaveBeenCalled();
		expect(updates).toEqual([{ _id: "t1", folder: "existing" }]);
	});

	it("conjures no folder in a world with nothing loose to file", async () => {
		game.journal.contents = [journal("Setting Overview")];
		expect(await fileGmPrepJournalsInChronicle()).toBe(0);
		expect(Folder.create).not.toHaveBeenCalled();
		expect(JournalEntry.updateDocuments).not.toHaveBeenCalled();
	});

	it("does nothing for a player, who may neither create a folder nor move a journal", async () => {
		game.user.isGM = false;
		game.journal.contents = [journal("Stonetop Threats", { kind: "threat", id: "t1" })];
		expect(await fileGmPrepJournalsInChronicle()).toBe(0);
		expect(JournalEntry.updateDocuments).not.toHaveBeenCalled();
	});
});
