import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import {
	IMPROVEMENT_BUILDER_WINDOW_CLASS, CUSTOM_MOVE_WINDOW_CLASS, ADD_ITEM_WINDOW_CLASS,
	authoringRestoreKey, parseAuthoringKey, readFormFields, writeFormFields,
	reopenImprovementBuilder, reopenCustomMove, reopenAddInventoryItem,
} from "../../module/dialogs/authoring-restore.js";
import { ImprovementBuilderDialog, improvementCardSaver, improvementEditSaver, steadingImprovementSaver } from "../../module/dialogs/ImprovementBuilderDialog.js";
import { CustomMoveDialog, characterMoveSaver, worldMoveSaver } from "../../module/actors/character/dialogs/CustomMoveDialog.js";
import { AddInventoryItemDialog, characterInventoryItemSaver, worldInventoryItemSaver } from "../../module/actors/character/dialogs/AddInventoryItemDialog.js";
import { hasUnsavedWork } from "../../module/utils/close-guard.js";

// A reload brings the three authoring windows back with what was typed in them
// (dialogs/authoring-restore.js, by way of utils/window-restore.js): the Steading Improvement builder,
// the custom move author and the inventory item author. Each keeps its work only in its form until
// Save, and where it saves to is rebuilt from what its saver's factory stamped on it.

const roundTrip = (view) => JSON.parse(JSON.stringify(view));

// A character or steading whose sheet is open, for the savers that write onto one.
function ownedActor(uuid = "Actor.a", { isOwner = true } = {}) {
	const actor = { uuid, isOwner, sheet: { rendered: true, render: vi.fn() } };
	actor.typedActor = {
		_actor: actor,
		addCustomMove: vi.fn(async () => {}),
		createCustomInventoryItem: vi.fn(async () => {}),
		addCustomImprovement: vi.fn(async () => ({ ok: true, label: "Mill" })),
		improvementDef: slug => (slug === "mill" ? { slug, label: "Mill" } : null),
		customImprovements: [],
	};
	return actor;
}

beforeEach(() => {
	vi.stubGlobal("game", {
		user: { isGM: true, can: () => true },
		settings: { get: () => false },
		i18n: { localize: k => k, format: k => k },
		journal: [],
	});
});
afterEach(() => vi.unstubAllGlobals());

describe("the authoring windows across a reload", () => {
	it("are restored under the class names their hooks are built from", () => {
		expect(ImprovementBuilderDialog.name).toBe(IMPROVEMENT_BUILDER_WINDOW_CLASS);
		expect(CustomMoveDialog.name).toBe(CUSTOM_MOVE_WINDOW_CLASS);
		expect(AddInventoryItemDialog.name).toBe(ADD_ITEM_WINDOW_CLASS);
	});

	it("are keyed by where they save to and what they edit, a new one by its own id", () => {
		const actor = ownedActor();
		const move = new CustomMoveDialog(characterMoveSaver(actor.typedActor), { restoreId: "w1" });
		expect(move.restoreKey).toBe("customMove:characterMove|Actor.a|new-w1");
		expect(new CustomMoveDialog(worldMoveSaver(), { item: { uuid: "Item.m" } }).restoreKey).toBe("customMove:worldMove||Item.m");
		expect(new CustomMoveDialog(worldMoveSaver()).restoreKey).not.toBe(new CustomMoveDialog(worldMoveSaver()).restoreKey);
		expect(new AddInventoryItemDialog(worldInventoryItemSaver({ treasure: true }), { restoreId: "w2" }).restoreKey)
			.toBe("addInventoryItem:worldTreasure||new-w2");
		expect(new AddInventoryItemDialog(characterInventoryItemSaver(actor.typedActor), { restoreId: "w3" }).restoreKey)
			.toBe("addInventoryItem:characterInventoryItem|Actor.a|new-w3");
		expect(new ImprovementBuilderDialog(improvementEditSaver(actor.typedActor, "mill")).restoreKey)
			.toBe("improvementBuilder:improvementEdit|Actor.a|slug-mill");
		expect(parseAuthoringKey("improvementBuilder:improvementEdit|Actor.a|slug-mill", "improvementBuilder"))
			.toEqual({ saver: "improvementEdit", actor: "Actor.a", itemUuid: null, slug: "mill", windowId: null });
	});

	it("aren't tracked when their saver can't be rebuilt, like the Level Up window's", () => {
		const adHoc = { create: async () => {}, update: async () => {} };
		expect(new CustomMoveDialog(adHoc).restoreKey).toBeNull();
		expect(new AddInventoryItemDialog(adHoc).restoreKey).toBeNull();
		expect(authoringRestoreKey("customMove", adHoc, { windowId: "x" })).toBeNull();
	});
});

describe("the form, as plain values", () => {
	function form() {
		const window = new Window();
		window.document.body.innerHTML = `
			<input name="name" value="">
			<textarea name="description"></textarea>
			<select name="rollType"><option value="">None</option><option value="str">STR</option></select>
			<input type="checkbox" name="noXpOnMiss">
			<input type="file" name="upload">`;
		return window.document.body;
	}

	it("reads what was typed, and writes it back over a fresh form", () => {
		const a = form();
		a.querySelector("[name=name]").value = "Shove";
		a.querySelector("[name=description]").value = "When you shove...";
		a.querySelector("[name=rollType]").value = "str";
		a.querySelector("[name=noXpOnMiss]").checked = true;
		const fields = roundTrip(readFormFields(a));
		expect(fields).toEqual({ name: "Shove", description: "When you shove...", rollType: "str", noXpOnMiss: true });

		const b = form();
		writeFormFields(b, fields);
		expect(readFormFields(b)).toEqual(fields);
	});

	it("puts back only what fits each field", () => {
		const b = form();
		writeFormFields(b, { name: 7, rollType: "nonsense", noXpOnMiss: "yes", description: "kept" });
		expect(readFormFields(b)).toEqual({ name: "", description: "kept", rollType: "", noXpOnMiss: false });
	});
});

describe("the custom move author", () => {
	it("comes back with its fields and panel, saving to the same character, whose sheet it refreshes", async () => {
		const actor = ownedActor();
		vi.stubGlobal("fromUuid", async uuid => (uuid === "Actor.a" ? actor : null));
		const left = new CustomMoveDialog(characterMoveSaver(actor.typedActor), { restoreId: "w1" });
		left._liveFields = { name: "Shove", description: "When you shove..." };
		left._activeTab = "roll";

		const back = await reopenCustomMove(left.restoreKey);
		expect(back).toBeInstanceOf(CustomMoveDialog);
		expect(back.restoreKey).toBe(left.restoreKey);
		back._takeRestoredView(roundTrip(left.restoreView));
		expect(back._restoredFields).toEqual({ name: "Shove", description: "When you shove..." });
		expect(back._activeTab).toBe("roll");

		await back._saver.create({ name: "Shove" });
		expect(actor.typedActor.addCustomMove).toHaveBeenCalled();
		back._onSaved();
		expect(actor.sheet.render).toHaveBeenCalledWith(false);
	});

	it("ignores a saved view that doesn't read", async () => {
		const back = await reopenCustomMove("customMove:worldMove||new-w1");
		back._takeRestoredView({ fields: "nonsense", tab: "nowhere" });
		expect(back._restoredFields).toBeNull();
		expect(back._activeTab).toBe("move");
	});

	it("stays shut for someone who may no longer write there", async () => {
		expect(await reopenCustomMove("improvementBuilder:worldMove||new-w1")).toBeNull();
		vi.stubGlobal("fromUuid", async () => ownedActor("Actor.a", { isOwner: false }));
		expect(await reopenCustomMove("customMove:characterMove|Actor.a|new-w1")).toBeNull();
		vi.stubGlobal("fromUuid", async () => null);
		expect(await reopenCustomMove("customMove:worldMove||Item.gone")).toBeNull();
		// Custom moves turned GM-only since.
		game.user.isGM = false;
		game.settings.get = () => true;
		expect(await reopenCustomMove("customMove:worldMove||new-w1")).toBeNull();
	});
});

describe("the inventory item author", () => {
	it("comes back opened the same way, the write-up's text handed to its editor", async () => {
		const left = new AddInventoryItemDialog(worldInventoryItemSaver({ treasure: true }), {
			allowColumnChoice: true, allowImage: true, titleKey: "stonetop.inventory.createTreasure", restoreId: "w2",
		});
		// Opened as a treasure (the test frame has no window position for the constructor to size).
		left._treasure = true;
		left._liveFields = { name: "The Lantern", lore: "<p>It hums.</p>", startsHidden: true };
		left._activeTab = "writeup";

		const back = await reopenAddInventoryItem(left.restoreKey);
		expect(back).toBeInstanceOf(AddInventoryItemDialog);
		back._takeRestoredView(roundTrip(left.restoreView));
		expect(back._treasure).toBe(true);
		expect(back._allowColumnChoice).toBe(true);
		expect(back._allowImage).toBe(true);
		expect(back._titleKey).toBe("stonetop.inventory.createTreasure");
		expect(back._values.artifact.lore).toBe("<p>It hums.</p>");
		expect(back._restoredFields.name).toBe("The Lantern");
		expect(back._activeTab).toBe("writeup");
	});

	it("ignores a saved view that doesn't read", async () => {
		const back = await reopenAddInventoryItem("addInventoryItem:worldInventoryItem||new-w2");
		back._takeRestoredView({ fields: ["x"], tab: "writeup", opened: { column: "attic", titleKey: "<b>", treasure: "yes" } });
		expect(back._restoredFields).toBeNull();
		expect(back._column).toBe("regular");
		expect(back._titleKey).toBeNull();
		expect(back._treasure).toBe(false);
		// Not a treasure, so there is no write-up page to land on.
		expect(back._activeTab).toBe("item");
	});

	it("stays shut for someone who may no longer write there", async () => {
		expect(await reopenAddInventoryItem("customMove:worldInventoryItem||new-w2")).toBeNull();
		vi.stubGlobal("fromUuid", async () => ownedActor("Actor.a", { isOwner: false }));
		expect(await reopenAddInventoryItem("addInventoryItem:characterInventoryItem|Actor.a|new-w3")).toBeNull();
		// A treasure is GM work.
		game.user.isGM = false;
		expect(await reopenAddInventoryItem("addInventoryItem:worldTreasure||new-w2")).toBeNull();
	});
});

describe("the Steading Improvement builder", () => {
	it("comes back with the improvement as typed, which still counts as unsaved", async () => {
		const left = new ImprovementBuilderDialog(improvementCardSaver(), { restoreId: "w4" });
		left._liveDef = { name: "Windmill", sections: [], grants: null };
		left._activeTab = "effect";

		const back = await reopenImprovementBuilder(left.restoreKey);
		expect(back).toBeInstanceOf(ImprovementBuilderDialog);
		expect(back.restoreKey).toBe("improvementBuilder:improvementCard||new-w4");
		back._takeRestoredView(roundTrip(left.restoreView));
		expect(back._activeTab).toBe("effect");

		// The form as it would have opened is the close-guard's baseline; the reload's goes over it.
		const window = new Window();
		let typed = "";
		back._addGroup = vi.fn();
		back._fillFrom = vi.fn((_root, def) => { typed = def.name; });
		back._readDef = () => ({ name: typed });
		// The test frame's Application has no listeners of its own to call up to.
		Application.prototype.activateListeners = () => {};
		try { back.activateListeners([window.document.body]); }
		finally { delete Application.prototype.activateListeners; }
		expect(back._fillFrom).toHaveBeenCalledWith(window.document.body, { name: "Windmill", sections: [], grants: null });
		expect(back._pristineWork).toBe(JSON.stringify({ name: "" }));
		back.rendered = true;
		expect(hasUnsavedWork(back)).toBe(true);
		expect(back.restoreView.def).toEqual({ name: "Windmill" });
	});

	it("ignores a saved definition that doesn't read", async () => {
		const back = await reopenImprovementBuilder("improvementBuilder:improvementCard||new-w4");
		back._takeRestoredView({ def: { name: "x", sections: "nope" }, tab: "nowhere" });
		expect(back._restoredDef).toBeNull();
		expect(back._activeTab).toBe("improvement");
	});

	it("saves to the same steading, and refreshes its sheet", async () => {
		const actor = ownedActor("Actor.s");
		vi.stubGlobal("fromUuid", async () => actor);
		const key = new ImprovementBuilderDialog(steadingImprovementSaver(actor.typedActor), { restoreId: "w5" }).restoreKey;
		expect(key).toBe("improvementBuilder:steadingImprovement|Actor.s|new-w5");
		vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn: vi.fn() } });
		const back = await reopenImprovementBuilder(key);
		await back._saver.create({ name: "Mill" });
		expect(actor.typedActor.addCustomImprovement).toHaveBeenCalled();
		expect(actor.sheet.render).toHaveBeenCalledWith(false);
	});

	it("stays shut when the improvement it was rewriting has gone, or the steading isn't theirs", async () => {
		expect(await reopenImprovementBuilder("customMove:improvementCard||new-w4")).toBeNull();
		vi.stubGlobal("fromUuid", async () => ownedActor("Actor.s"));
		expect(await reopenImprovementBuilder("improvementBuilder:improvementEdit|Actor.s|slug-gone")).toBeNull();
		expect(await reopenImprovementBuilder("improvementBuilder:improvementEdit|Actor.s|slug-mill")).toBeInstanceOf(ImprovementBuilderDialog);
		vi.stubGlobal("fromUuid", async () => ownedActor("Actor.s", { isOwner: false }));
		expect(await reopenImprovementBuilder("improvementBuilder:steadingImprovement|Actor.s|new-w5")).toBeNull();
		game.user.isGM = false;
		game.user.can = () => false;
		expect(await reopenImprovementBuilder("improvementBuilder:improvementCard||new-w4")).toBeNull();
	});
});
