// The sheet hands the roll window the lines the character could spend on this roll
// (StonetopCharacter#rollOffers: a skin of fine whisky on a Persuade), off the move being rolled.
// The rules and the window each have their own tests (fine-whisky.test.js); this is the wire between.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { promptRoll } from "../../../module/dialogs/RollDialog.js";

vi.mock("../../../module/dialogs/RollDialog.js", () => ({
	DEFAULT_ROLL_MODE: "normal",
	promptRoll: vi.fn(async () => ({ situational: 0 })),
}));

const PERSUADE = { _id: "p1", type: "move", name: "Persuade (vs. NPCs)", system: { moveType: "basic", rollType: "cha" } };
const WHISKY = { key: "fine-whisky", label: "Share a skin of fine whisky (spend 1 use): advantage", applied: true };

function sheetWith(offers) {
	const actor = new FakeActorBuilder().withItems([PERSUADE]).build();
	actor.items.get = id => actor.items.find(i => i._id === id) ?? null;
	actor.typedActor = { rollOffers: vi.fn(async () => offers) };
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	sheet._stonetopCharacter = actor.typedActor;
	return sheet;
}
const rollable = { closest: sel => (sel === ".item" ? { dataset: { itemId: "p1" } } : null), dataset: { roll: "cha" } };

beforeEach(() => promptRoll.mockClear());

describe("the sheet's roll window", () => {
	it("carries the character's offered lines for the move it rolls", async () => {
		await sheetWith([WHISKY])._promptRollOptions({ rollable });
		expect(promptRoll.mock.calls[0][0].offers).toEqual([WHISKY]);
	});

	it("carries them for a move whose stat was picked first (moveItem)", async () => {
		await sheetWith([WHISKY])._promptRollOptions({ title: "Persuade (vs. NPCs)", moveItem: PERSUADE });
		expect(promptRoll.mock.calls[0][0].offers).toEqual([WHISKY]);
	});

	it("passes no offers at all when there are none, or no move behind the roll", async () => {
		await sheetWith([])._promptRollOptions({ rollable });
		await sheetWith([WHISKY])._promptRollOptions({ title: "Roll +CHA" });
		expect(promptRoll.mock.calls.map(c => "offers" in c[0])).toEqual([false, false]);
	});
});
