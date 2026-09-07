import { describe, it, expect, beforeEach, vi } from "vitest";

// HOW A MAP COMES TO EXIST, from the two ends this module joins: the one the world is GIVEN during
// setup, and the one somebody ASKS FOR from an empty tab or the hotbar macro.
//
// The rules being asserted are all about restraint, and every one of them fails silently in the
// wrong direction:
//
//  • a world is given exactly one map, and a GM who deletes it never finds it back;
//  • an established world that already made its own map is not handed a second;
//  • a create that failed leaves the latch alone, so the next load tries again;
//  • the box the second map is named in opens EMPTY, because a reader who reaches it has just
//    deleted a map called "Stonetop" and handing that name back undoes their own decision.
//
// Everything this module touches is stubbed: the document layer is proved next door in
// relmap-doc.test.js, and what belongs here is only which of its calls are made, in what order,
// and under which guard.

const world = { maps: [], canCreate: true, made: { id: "made", name: "" }, createThrows: false };
vi.mock("../../module/relmap/relmap-doc.js", () => ({
	listRelationshipMaps: vi.fn(() => world.maps),
	canCreateRelationshipMap: vi.fn(() => world.canCreate),
	createRelationshipMap: vi.fn(name => {
		if (world.createThrows) return Promise.reject(new Error("no connection"));
		if (!world.canCreate) return Promise.resolve(null);
		world.made = { id: "made", name };
		return Promise.resolve(world.made);
	}),
}));

// What the reader puts in the box. `null` is the box dismissed, which is the one answer that must
// not become a map.
const box = { typed: "The Millers", asked: [] };
vi.mock("../../module/dialogs/content-picker.js", () => ({
	promptForText: vi.fn(args => {
		box.asked.push(args);
		return Promise.resolve(box.typed);
	}),
}));

const settings = { values: {}, writes: [] };
vi.mock("../../module/settings.js", () => ({
	getSetting: vi.fn(key => settings.values[key] ?? false),
	setSetting: vi.fn((key, value) => {
		settings.values[key] = value;
		settings.writes.push([key, value]);
		return Promise.resolve();
	}),
}));

const table = { primary: true };
vi.mock("../../module/utils/primary-gm.js", () => ({ isPrimaryGM: () => table.primary }));

// Silenced rather than asserted on: a failing seed logs, and a suite that let it through would
// print a stack per run for a case it is deliberately provoking.
vi.mock("../../module/utils/logger.js", () => ({ info: vi.fn(), error: vi.fn() }));

import { canCreateRelationshipMap, createRelationshipMap, listRelationshipMaps } from "../../module/relmap/relmap-doc.js";
import { promptForText } from "../../module/dialogs/content-picker.js";
import { getSetting, setSetting } from "../../module/settings.js";
import {
	RELMAP_SEED_SETTING, promptForNewRelationshipMap, seedRelationshipMapOnce,
} from "../../module/relmap/relmap-make.js";

beforeEach(() => {
	vi.clearAllMocks();
	world.maps = [];
	world.canCreate = true;
	world.made = { id: "made", name: "" };
	world.createThrows = false;
	box.typed = "The Millers";
	box.asked = [];
	settings.values = {};
	settings.writes = [];
	table.primary = true;
});

describe("the map a world comes with", () => {
	it("gives a fresh world one, named Stonetop", async () => {
		const made = await seedRelationshipMapOnce();
		expect(createRelationshipMap).toHaveBeenCalledWith("Stonetop");
		expect(made).toBe(world.made);
	});

	// ⚠ THE LATCH IS THE FEATURE. Without it the seed runs on every GM load, so a map the GM
	// deleted would be back before they finished reading the sidebar.
	it("latches, so the map is never given twice", async () => {
		await seedRelationshipMapOnce();
		expect(settings.writes).toEqual([[RELMAP_SEED_SETTING, true]]);

		vi.clearAllMocks();
		await seedRelationshipMapOnce();
		expect(createRelationshipMap).not.toHaveBeenCalled();
	});

	it("does not read the world at all once it is latched", async () => {
		settings.values[RELMAP_SEED_SETTING] = true;
		expect(await seedRelationshipMapOnce()).toBeNull();
		expect(listRelationshipMaps).not.toHaveBeenCalled();
		expect(setSetting).not.toHaveBeenCalled();
	});

	// Every world that existed before this shipped made its map from the invitation. Latching
	// without creating is what stops each of them being handed a second "Stonetop" beside it.
	it("latches a world that already has a map, without making another", async () => {
		world.maps = [{ id: "map1", name: "The Hillfolk" }];
		expect(await seedRelationshipMapOnce()).toBeNull();
		expect(createRelationshipMap).not.toHaveBeenCalled();
		expect(settings.writes).toEqual([[RELMAP_SEED_SETTING, true]]);
	});

	// A create can fail for reasons that pass. Latched on that, the world would never be offered
	// its map again by anything but the invitation this exists to spare it.
	it("leaves the latch alone when the map could not be made", async () => {
		world.canCreate = false;
		expect(await seedRelationshipMapOnce()).toBeNull();
		expect(settings.writes).toEqual([]);
	});

	it("swallows a create that throws, and still leaves the latch alone", async () => {
		world.createThrows = true;
		await expect(seedRelationshipMapOnce()).resolves.toBeNull();
		expect(settings.writes).toEqual([]);
	});

	// ⚠ ONE CLIENT. This is a world document plus a world setting, written unasked on load, so two
	// GMs loading in the same minute would each find no map and each make one.
	it("is the primary GM's alone", async () => {
		table.primary = false;
		expect(await seedRelationshipMapOnce()).toBeNull();
		expect(getSetting).not.toHaveBeenCalled();
		expect(createRelationshipMap).not.toHaveBeenCalled();
	});
});

describe("the map somebody asks for", () => {
	it("makes it under the name that was typed", async () => {
		const made = await promptForNewRelationshipMap();
		expect(createRelationshipMap).toHaveBeenCalledWith("The Millers");
		expect(made).toBe(world.made);
	});

	// ⚠ THE WHOLE POINT OF THE BOX. A reader who reaches it has deleted a map called "Stonetop",
	// and a field pre-filled with that name is the old behaviour wearing a dialog.
	it("opens the box empty, and never on the seeded name", async () => {
		await promptForNewRelationshipMap();
		expect(promptForText).toHaveBeenCalledTimes(1);
		const asked = box.asked[0];
		expect(asked.value ?? "").toBe("");
		expect(asked.placeholder).not.toBe("Stonetop");
		expect(asked.title).toBe("What is this map called?");
		expect(asked.buttonLabel).toBe("Make the map");
	});

	// Taken rather than refused, exactly as an empty board name is: the map is renameable from the
	// sidebar, and a dialog that rejects a save over a blank field has to explain itself.
	it("falls back to a plain name when nothing was typed, and not to Stonetop", async () => {
		box.typed = "";
		await promptForNewRelationshipMap();
		expect(createRelationshipMap).toHaveBeenCalledWith("Relationship Map");
	});

	it("makes nothing when the box is dismissed", async () => {
		box.typed = null;
		expect(await promptForNewRelationshipMap()).toBeNull();
		expect(createRelationshipMap).not.toHaveBeenCalled();
	});

	// Making a map and editing one are different rights. Asking somebody to name a map they may
	// not make is a dialog whose only outcome is a refusal.
	it("never asks somebody who may not make a map", async () => {
		world.canCreate = false;
		expect(await promptForNewRelationshipMap()).toBeNull();
		expect(canCreateRelationshipMap).toHaveBeenCalled();
		expect(promptForText).not.toHaveBeenCalled();
	});
});
