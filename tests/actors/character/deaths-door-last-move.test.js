// Death's Door, 6-: "Make one last move as if you rolled a 12+, then step through the Last Door" (Book I
// p.75, p.245). "They can make one last move, but after that they're dead ... They can't use that last move
// to avoid death." The move is picked from their own moves that roll and its card posted at 12+; then the Door.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { LAST_MOVE_TOTAL, lastMoveChoices, makeLastMove, DEATHS_DOOR_STATE } from "../../../module/actors/character/deaths-door.js";
import { DeathsDoorDialog } from "../../../module/actors/character/dialogs/DeathsDoorDialog.js";

const move = (id, name, rollType = "str", extra = {}) => ({ id, name, type: "move", system: { rollType }, ...extra });

describe("which moves can be the last", () => {
	it("lists their own learned moves that roll, by name, once each, never a 0-HP move", () => {
		const items = [
			move("m1", "Clash"),
			move("m2", "Defy Danger", "ask"),
			move("m3", "Herbalism", ""),
			move("m4", "Burn Twice as Bright", "wis", { flags: { "stonetop-pwd": { learned: false } } }),
			move("m5", "Clash"),
			move("m6", "Death's Door", "none"),
			{ id: "i1", name: "Spear", type: "inventory", system: { rollType: "str" } },
		];
		expect(lastMoveChoices(items)).toEqual([{ id: "m1", name: "Clash" }, { id: "m2", name: "Defy Danger" }]);
	});
});

describe("making it", () => {
	it("goes through the character's own roll path, at a given 12, named on the card", async () => {
		const character = { onRoll: vi.fn(async () => true) };
		const rollable = {};
		expect(await makeLastMove(character, move("m1", "Clash"), { rollable, note: "One last move" })).toBe(true);
		expect(character.onRoll).toHaveBeenCalledWith({ currentTarget: rollable }, {
			asIfTotal: LAST_MOVE_TOTAL, rollMode: "normal", conditionNotes: ["One last move"],
		});
		expect(LAST_MOVE_TOTAL).toBe(12);
	});

	it("says no move was made when its prompts were backed out of", async () => {
		const character = { onRoll: vi.fn(async () => "cancel") };
		expect(await makeLastMove(character, move("m1", "Clash"), { rollable: {} })).toBe(false);
	});
});

describe("the walkthrough's 6-", () => {
	let savedChat, savedDocument;
	beforeEach(() => {
		savedChat = global.ChatMessage;
		savedDocument = globalThis.document;
		global.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
		// Enough of a DOM for the move's detached stand-in row (utils/move-rollable.js).
		globalThis.document = { createElement: tag => {
			const el = { tag, dataset: {}, className: "", textContent: "", kids: [] };
			el.append = (...k) => { for (const c of k) { c.parent = el; el.kids.push(c); } };
			return el;
		} };
	});
	afterEach(() => { global.ChatMessage = savedChat; globalThis.document = savedDocument; });

	function atTheDoor(items) {
		const actor = {
			id: "a1", name: "Caradoc",
			items: Object.assign([...items], { get: id => items.find(i => i.id === id) }),
		};
		const character = {
			_actor: actor,
			state: DEATHS_DOOR_STATE.FATE_PENDING,
			get deathsDoorState() { return this.state; },
			setDeathsDoorState: vi.fn(async function (state) { character.state = state; }),
			onRoll: vi.fn(async () => true),
		};
		const dialog = new DeathsDoorDialog(character, () => {});
		dialog.render = vi.fn();
		dialog.renderIfOpen = vi.fn();
		return { dialog, character, actor };
	}

	it("asks for the last move before the Door, and writes nothing yet", async () => {
		const { dialog, character } = atTheDoor([move("m1", "Clash")]);
		await dialog._onChooseFate("last-door");
		expect(dialog._step).toBe("lastMove");
		expect(dialog.getData()).toMatchObject({ isLastMove: true, lastMoves: [{ id: "m1", name: "Clash" }] });
		expect(character.setDeathsDoorState).not.toHaveBeenCalled();
	});

	it("posts the move at 12+, then steps through, with nothing of the sheet's", async () => {
		const { dialog, character } = atTheDoor([move("m1", "Clash")]);
		await dialog._onChooseFate("last-door");
		await dialog._onMakeLastMove("m1");
		const rollable = character.onRoll.mock.calls[0][0].currentTarget;
		expect(rollable).toMatchObject({ className: "rollable move-rollable", dataset: { roll: "str" } });
		expect(rollable.parent.dataset.itemId).toBe("m1");
		expect(character.onRoll).toHaveBeenCalledWith({ currentTarget: rollable }, expect.objectContaining({ asIfTotal: 12 }));
		expect(character.setDeathsDoorState).toHaveBeenCalledWith(DEATHS_DOOR_STATE.DEAD);
		expect(character.onRoll.mock.invocationCallOrder[0]).toBeLessThan(character.setDeathsDoorState.mock.invocationCallOrder[0]);
	});

	it("keeps the fate open when the move was backed out of", async () => {
		const { dialog, character } = atTheDoor([move("m1", "Clash")]);
		character.onRoll.mockImplementation(async () => "cancel");
		await dialog._onChooseFate("last-door");
		await dialog._onMakeLastMove("m1");
		expect(character.setDeathsDoorState).not.toHaveBeenCalled();
	});

	it("steps through without a card when asked, or when nothing they have rolls", async () => {
		const picked = atTheDoor([move("m1", "Clash")]);
		await picked.dialog._onChooseFate("last-door");
		await picked.dialog._onStepThrough();
		expect(picked.character.onRoll).not.toHaveBeenCalled();
		expect(picked.character.setDeathsDoorState).toHaveBeenCalledWith(DEATHS_DOOR_STATE.DEAD);

		const none = atTheDoor([move("m3", "Herbalism", "")]);
		await none.dialog._onChooseFate("last-door");
		expect(none.character.setDeathsDoorState).toHaveBeenCalledWith(DEATHS_DOOR_STATE.DEAD);
	});
});
