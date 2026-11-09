// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readRepo } from "../../fakes/css.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { stubAsk, fakeForm } from "../../fakes/confirm.js";

// The Inventory tab's Reset Inventory (Book I p.89). It is a play action, so it shows outside the wrench
// whenever there is something to set down, and it offers the character's followers and crew with something
// marked, ticked, so one press unpacks the household in one update.

const TAB = readRepo("templates/actor/partials/tab-equipment.hbs");

function sheetFor(flags, followers = []) {
	const builder = new FakeActorBuilder();
	for (const [key, value] of Object.entries(flags)) builder.withFlag(key, value);
	const actor = builder.build();
	actor.name = "Aria";
	const char = {
		resetInventorySelections: vi.fn(async () => {}),
		resetForHomecoming: vi.fn(async () => true),
	};
	actor.typedActor = char;
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	sheet._inventoryResetFollowers = followers;
	return { sheet, char };
}

beforeEach(() => {
	global.game.settings ??= {};
	global.game.settings.get = () => false;
	global.game.user = { isGM: false };
});

describe("the Inventory tab's Reset Inventory", () => {
	// The GM resets the party on Going home; this is the backup, under the wrench.
	it("is shown under the wrench, and only when there is something to clear", () => {
		expect(TAB).toContain("{{#if (and stonetop.editMode stonetop.inventoryReset.show)}}");
	});

	it("asks the plain question when no follower has anything marked", async () => {
		const { sheet, char } = sheetFor({ "inventory.checked": { rope: true } });
		const wait = stubAsk("yes");
		await sheet._onInventoryReset();
		expect(wait.mock.calls[0][0].content).toContain("empty your supplies");
		expect(char.resetInventorySelections).toHaveBeenCalledOnce();
		expect(char.resetForHomecoming).not.toHaveBeenCalled();
	});

	it("offers each follower with something marked, and resets only who stays ticked", async () => {
		const { sheet, char } = sheetFor({
			"inventory.checked": { rope: true },
			"customFollowers": { f1: { name: "Wren", gear: [{ label: "Spear", checked: true }] } },
			"crew": { name: "The Wolves", gear: { spears: 1 } },
		}, [
			{ ftype: "custom", slug: "f1", name: "Wren" },
			{ ftype: "crew", slug: "", name: "The Wolves" },
		]);
		const wait = stubAsk("yes", fakeForm({ self: { checked: true }, "follower-0": { checked: false }, "follower-1": { checked: true } }));
		await sheet._onInventoryReset();
		const html = wait.mock.calls[0][0].content.innerHTML ?? String(wait.mock.calls[0][0].content);
		// Who each one is, beside their name.
		expect(html).toContain("Aria <span class=\"stonetop-ask-check-sub\">(your character)</span>");
		expect(html).toContain("Wren <span class=\"stonetop-ask-check-sub\">(follower)</span>");
		expect(html).toContain("The Wolves <span class=\"stonetop-ask-check-sub\">(crew)</span>");
		// One answer: the ticks are the choice, and the window's X keeps everything. Enter presses nothing.
		const config = wait.mock.calls[0][0];
		expect(config.buttons.map(b => b.action)).toEqual(["yes"]);
		expect(config.buttons[0].default).toBe(false);
		expect(char.resetForHomecoming).toHaveBeenCalledWith({ pc: true, followers: [{ ftype: "crew", slug: "" }] });
	});

	it("leaves out a follower who was unpacked since the sheet drew", async () => {
		const { sheet, char } = sheetFor({
			"customFollowers": { f1: { name: "Wren", gear: [{ label: "Spear", checked: false }] } },
			"inventory.checked": { rope: true },
		}, [{ ftype: "custom", slug: "f1", name: "Wren" }]);
		stubAsk("yes");
		await sheet._onInventoryReset();
		expect(char.resetInventorySelections).toHaveBeenCalledOnce();
	});

	it("writes nothing when the window is closed", async () => {
		const { sheet, char } = sheetFor({
			"customFollowers": { f1: { gear: [{ label: "Spear", checked: true }] } },
		}, [{ ftype: "custom", slug: "f1", name: "Wren" }]);
		stubAsk(null);
		await sheet._onInventoryReset();
		expect(char.resetForHomecoming).not.toHaveBeenCalled();
	});
});

// Core paints its own orange glyph over every checkbox outside an AppV1 window, and this confirm is a
// DialogV2: the shared skin has to put it out itself, or the glyph sits over the box and below the label.
describe("the who-to-clear ticks in a DialogV2 window", () => {
	it("draw only the shared skin, not core's glyph", () => {
		const css = readRepo("styles/stonetop.css");
		expect(css).toMatch(/\.stonetop-check::before,\s*\.stonetop-check::after\s*{\s*content: none !important;/);
	});
});
