import { describe, it, expect } from "vitest";
import {
	moveArmor, barkskinMarkedBy, barkskinMarks, wearsBarkskin, withBarkskinBase, followerArmorGate, armorGateWords,
	MOVE_ARMOR_BASE, CANDLE_AGAINST_THE_DARK,
} from "../../../module/actors/character/move-armor.js";
import { BARKSKIN, BLESSED_MARKS_FLAG } from "../../../module/actors/character/blessed-marks.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// The two moves that say a character HAS 2 armor, which is a worn base and not a bonus.

const character = (name, moves, flags = {}) => ({
	id: name, name, type: "character", uuid: `Actor.${name}`,
	items: moves.map(move => (typeof move === "string" ? { type: "move", name: move } : move)),
	getFlag: (scope, key) => (scope === SYSTEM_ID ? flags[key] : undefined),
});

describe("armor a move grants", () => {
	it("gives a Blessed with Barkskin 2 armor", () => {
		expect(moveArmor({ actor: character("Aerin", [BARKSKIN]) })).toEqual({ base: MOVE_ARMOR_BASE, source: BARKSKIN });
	});

	it("gives a Lightbearer 2 armor only while the holy light burns", () => {
		const sael = character("Sael", [CANDLE_AGAINST_THE_DARK]);
		expect(moveArmor({ actor: sael, holyLight: false }).base).toBe(0);
		expect(moveArmor({ actor: sael, holyLight: true })).toEqual({ base: MOVE_ARMOR_BASE, source: CANDLE_AGAINST_THE_DARK });
	});

	it("gives it to whoever wears a Blessed's mark, not just the Blessed", () => {
		expect(moveArmor({ actor: character("Pim", []), markedWithBarkskin: true }).base).toBe(MOVE_ARMOR_BASE);
	});

	it("gives nothing to a character without the moves, or one who switched them off", () => {
		expect(moveArmor({ actor: character("Pim", ["Undaunted"]) }).base).toBe(0);
		const off = character("Aerin", [{ type: "move", name: BARKSKIN, flags: { [SYSTEM_ID]: { learned: false } } }]);
		expect(moveArmor({ actor: off }).base).toBe(0);
	});
});

describe("who is wearing Barkskin", () => {
	const blessed = (rows, moves = [BARKSKIN]) => character("Aerin", moves, { [BLESSED_MARKS_FLAG]: rows });

	it("finds the mark on the Blessed's own roster, by the person it names", () => {
		const pim = character("Pim", []);
		const actors = [blessed([{ kind: "barkskin", uuid: "Actor.Pim", name: "Pim" }])];
		expect(barkskinMarkedBy(pim, actors)).toBe(true);
		expect(barkskinMarkedBy(character("Wren", []), actors)).toBe(false);
	});

	it("matches a row laid from a token against the same person's sheet", () => {
		const pim = character("Pim", []);
		const actors = [blessed([{ kind: "barkskin", uuid: "Scene.s1.Token.t1.Actor.Pim" }])];
		expect(barkskinMarkedBy(pim, actors)).toBe(true);
	});

	it("ignores the Blessed's other kinds of mark, and a Blessed who no longer has the move", () => {
		const pim = character("Pim", []);
		expect(barkskinMarkedBy(pim, [blessed([{ kind: "trackless", uuid: "Actor.Pim" }])])).toBe(false);
		expect(barkskinMarkedBy(pim, [blessed([{ kind: "barkskin", uuid: "Actor.Pim" }], ["Trackless Step"])])).toBe(false);
	});
});

describe("Barkskin on somebody who is not a character", () => {
	const blessed = (rows, moves = [BARKSKIN]) => character("Aerin", moves, { [BLESSED_MARKS_FLAG]: rows });
	const npc = (name, uuid) => ({ id: uuid.split(".").pop(), uuid, name, type: "npc" });

	it("finds a follower marked by their NPC, or by the name on their card", () => {
		const enfys = npc("Enfys", "Actor.enfysNpc");
		expect(barkskinMarkedBy(enfys, [blessed([{ kind: "barkskin", uuid: "Actor.enfysNpc", name: "Enfys" }])])).toBe(true);
		// A row laid on a name alone: the roster knows her by it, so her NPC does too, when asked by name.
		const byName = [blessed([{ kind: "barkskin", name: "  enfys " }])];
		expect(barkskinMarkedBy(enfys, byName, { byName: true })).toBe(true);
		expect(barkskinMarkedBy(enfys, byName)).toBe(false);
		// A row naming a DOCUMENT names that document, not whoever shares its spelling.
		expect(barkskinMarkedBy(enfys, [blessed([{ kind: "barkskin", uuid: "Actor.other", name: "Enfys" }])], { byName: true })).toBe(false);
	});

	it("indexes the marks once for a sheet with several followers to ask about", () => {
		const marks = barkskinMarks([blessed([{ kind: "barkskin", uuid: "Actor.a" }, { kind: "barkskin", name: "Olwin" }, { kind: "charm", name: "Seren" }])]);
		expect(wearsBarkskin(marks, { uuid: "Scene.s.Token.t.Actor.a" })).toBe(true);
		expect(wearsBarkskin(marks, { name: "Olwin" }, { byName: true })).toBe(true);
		expect(wearsBarkskin(marks, { name: "Seren" }, { byName: true })).toBe(false);
		// Only a Blessed who still has the move learned grants it.
		expect(barkskinMarks([blessed([{ kind: "barkskin", name: "Olwin" }], [])]).names.size).toBe(0);
	});

	it("is a 2-armor BASE: the better of it and their own, never the two added", () => {
		const bare = { armor: 0, unpierceable: 0, conditional: 0, conditionalSource: "" };
		expect(withBarkskinBase(bare, true)).toMatchObject({ armor: 2, conditional: 2, conditionalSource: BARKSKIN });
		expect(withBarkskinBase({ ...bare, armor: 1 }, true)).toMatchObject({ armor: 2, conditional: 1, conditionalSource: BARKSKIN });
		expect(withBarkskinBase({ ...bare, armor: 3 }, true)).toMatchObject({ armor: 3, conditional: 0 });
		expect(withBarkskinBase({ ...bare, armor: 1 }, false)).toEqual({ ...bare, armor: 1 });
	});

	it("settles a printed clause with the bark taken as met, one box for the row", () => {
		// Afon, 2 (0 vs. iron), with bark: iron cannot take him below the bark's 2, so nothing is left to ask.
		const afon = { armor: 2, unpierceable: 0, ...followerArmorGate("2 (0 vs. iron)") };
		expect(withBarkskinBase(afon, true)).toMatchObject({ armor: 2, conditional: 0 });
		// 4 (1 vs. silver) with bark: silver still takes the 2 the bark does not cover.
		const warded = { armor: 4, unpierceable: 0, ...followerArmorGate("4 (1 vs. silver)") };
		expect(withBarkskinBase(warded, true)).toMatchObject({ armor: 4, conditional: 2, conditionalSource: "vs. silver" });
	});
});

describe("a follower's printed armor clause", () => {
	it("reads what the clause takes away, and what takes it", () => {
		expect(followerArmorGate("2 (0 vs. iron)")).toEqual({ conditional: 2, conditionalSource: "vs. iron" });
		expect(followerArmorGate("3 (1 vs silver)")).toEqual({ conditional: 2, conditionalSource: "vs. silver" });
		expect(followerArmorGate("1 (shield)")).toEqual({ conditional: 0, conditionalSource: "" });
		expect(followerArmorGate(2)).toEqual({ conditional: 0, conditionalSource: "" });
		expect(followerArmorGate("-")).toEqual({ conditional: 0, conditionalSource: "" });
	});

	it("has words for the damage card's box and its note, and none for a source it does not know", () => {
		expect(armorGateWords("vs. iron")).toEqual({ key: "versus", noteKey: "versusNote", params: { against: "iron" } });
		expect(armorGateWords(BARKSKIN)).toMatchObject({ key: "barkskin", noteKey: "note" });
		expect(armorGateWords("Something Newer")).toBe(null);
		expect(armorGateWords("")).toBe(null);
	});
});
