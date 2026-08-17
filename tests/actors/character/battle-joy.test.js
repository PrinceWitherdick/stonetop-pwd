import { describe, it, expect } from "vitest";
import {
	BATTLE_JOY_FLAG, BATTLE_JOY, BERSERKER,
	ownsMoveNamed, canEnterBattleJoy, showBattleJoy, ignoresDebilities,
} from "../../../module/actors/character/battle-joy.js";

const actorWith = (...items) => ({ items });
const move = name => ({ type: "move", name });

describe("who can enter a Battle Joy", () => {
	it("counts the move that makes the state", () => {
		expect(canEnterBattleJoy(actorWith(move(BATTLE_JOY)))).toBe(true);
	});

	// Berserker only READS the state ("while in your Battle Joy…") and its own requirement is
	// Battle Joy, so nobody owns the reader without the maker. Counting it here would have earned
	// the glyph to a sheet that cannot enter the state at all.
	it("does NOT count Berserker on its own", () => {
		expect(canEnterBattleJoy(actorWith(move(BERSERKER)))).toBe(false);
	});

	it("says no for a character with neither", () => {
		expect(canEnterBattleJoy(actorWith(move("Guardian"), move("Clash")))).toBe(false);
		expect(canEnterBattleJoy(actorWith())).toBe(false);
		expect(canEnterBattleJoy(null)).toBe(false);
	});

	// The type check is the point: an inventory item or an arcanum sharing a move's name must not
	// earn the glyph.
	it("only counts MOVES, not anything else named the same", () => {
		expect(canEnterBattleJoy(actorWith({ type: "item", name: BATTLE_JOY }))).toBe(false);
		expect(ownsMoveNamed(actorWith(move(BATTLE_JOY)), BATTLE_JOY)).toBe(true);
	});
});

describe("whether the glyph renders at all", () => {
	it("shows for anyone who owns the move", () => {
		expect(showBattleJoy({ owns: true, raging: false })).toBe(true);
	});

	// Worse than a stranded candle: a stranded rage goes on cancelling the character's debilities
	// with nothing left on the sheet that could switch it off.
	it("keeps showing a RAGING sheet that can no longer enter one", () => {
		expect(showBattleJoy({ owns: false, raging: true })).toBe(true);
	});

	it("stays off an ordinary sheet", () => {
		expect(showBattleJoy({ owns: false, raging: false })).toBe(false);
	});
});

describe("ignoring the effects of debilities", () => {
	it("is exactly 'are they raging'", () => {
		expect(ignoresDebilities({ raging: true })).toBe(true);
		expect(ignoresDebilities({ raging: false })).toBe(false);
	});

	// Called from the roll path with whatever the flag held, which validates nothing.
	it("survives being asked with nothing", () => {
		expect(ignoresDebilities()).toBe(false);
		expect(ignoresDebilities({})).toBe(false);
	});
});

// The gate is name-matched against the pack files, so a rename in either place silently stops
// showing the glyph. This is the guard for that.
describe("the names the gate matches on", () => {
	it("spells the moves exactly as the packs do", () => {
		expect(BATTLE_JOY).toBe("Battle Joy");
		expect(BERSERKER).toBe("Berserker");
	});

	it("keys the flag on battleJoy", () => {
		expect(BATTLE_JOY_FLAG).toBe("battleJoy");
	});
});
