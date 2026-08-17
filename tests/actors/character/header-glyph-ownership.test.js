import { describe, it, expect } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { CONSECRATED_FLAME } from "../../../module/actors/character/holy-light.js";
import { CONDEMN } from "../../../module/actors/character/condemn.js";
import { BINDING_ARBITRATION } from "../../../module/actors/character/oaths.js";
import { BATTLE_JOY } from "../../../module/actors/character/battle-joy.js";
import { BARKSKIN } from "../../../module/actors/character/blessed-marks.js";

// Which of the five header glyphs a character has EARNED, all from one walk of the items.
//
// The mapping is five keys to five different predicates, and the character sheet's own tests reach
// it through a mock that re-implements the same five keys — so swapping two of them in the real
// getter (`blessed: canBindOaths(...)`) leaves the whole suite green while a Blessed shows the
// Judge's scales in production. These tests are the ones that would not.

const move = (name) => ({ type: "move", name });
const charFrom = (items) => new TestCharacterBuilder(new FakeActorBuilder().withItems(items).build()).build();
const charWith = (...items) => charFrom(items);

// The move that earns each glyph, and the key it must light.
const GLYPHS = [
	["holyLight", CONSECRATED_FLAME],
	["condemn",   CONDEMN],
	["oaths",     BINDING_ARBITRATION],
	["battleJoy", BATTLE_JOY],
	["blessed",   BARKSKIN],
];

describe("headerGlyphOwnership", () => {
	it("answers all five keys, and only those", () => {
		expect(Object.keys(charWith().headerGlyphOwnership()).sort())
			.toEqual(["battleJoy", "blessed", "condemn", "holyLight", "oaths"]);
	});

	it("lights nothing for a character owning none of the moves", () => {
		expect(Object.values(charWith(move("Guardian")).headerGlyphOwnership())).toEqual([false, false, false, false, false]);
	});

	// The one that matters: each move lights ITS key and no other. A swapped pair passes every
	// "does the glyph appear" assertion on the sheet and fails right here.
	for (const [key, moveName] of GLYPHS) {
		it(`lights only ${key} for "${moveName}"`, () => {
			const owns = charWith(move(moveName)).headerGlyphOwnership();
			expect(owns[key], key).toBe(true);
			for (const [other] of GLYPHS) {
				if (other !== key) expect(owns[other], `${moveName} must not light ${other}`).toBe(false);
			}
		});
	}

	it("counts every move at once", () => {
		const owns = charWith(...GLYPHS.map(([, name]) => move(name))).headerGlyphOwnership();
		expect(Object.values(owns)).toEqual([true, true, true, true, true]);
	});

	// The type check the whole owns-move module exists for: an inventory item named after a move
	// grants nothing. Asserted through this path because it is the path that takes a prebuilt Set,
	// and a Set built from unfiltered items would sail past every per-predicate guard.
	it("counts MOVES only, whatever else shares the name", () => {
		const items = GLYPHS.map(([, name]) => ({ type: "item", name }));
		expect(Object.values(charFrom(items).headerGlyphOwnership()))
			.toEqual([false, false, false, false, false]);
	});

	// The sheet hands in the Set it already built for its own questions; called bare, the method
	// has to build one. Both must give the same answer, or the header disagrees with itself
	// depending on which caller got there first.
	it("agrees whether it is handed the owned-move Set or builds its own", () => {
		const char = charWith(move(CONDEMN), move(BARKSKIN));
		const names = new Set([CONDEMN, BARKSKIN]);
		expect(char.headerGlyphOwnership(names)).toEqual(char.headerGlyphOwnership());
	});

	// A falsy non-Set is "no Set was passed", not a Set to call `.has` on. The five predicates
	// used to spell this guard three ways, so `[a, b].map(oneOfThem)` threw at index 0 and
	// `[a, b].map(anotherOfThem)` at index 1.
	it("falls back to its own walk when handed a falsy non-Set", () => {
		const char = charWith(move(CONDEMN));
		for (const notASet of [null, undefined, 0, "", false]) {
			expect(char.headerGlyphOwnership(notASet).condemn, String(notASet)).toBe(true);
		}
	});
});
