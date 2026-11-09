import { describe, it, expect } from "vitest";
import { normalizeDamageDie, stepDie, maxDie, ownHpChangeRe, OWN_HARM_RE } from "../../module/utils/damage-die.js";

describe("normalizeDamageDie", () => {
	it("passes a well-formed die through", () => {
		expect(normalizeDamageDie("d8")).toBe("d8");
		expect(normalizeDamageDie("d12")).toBe("d12");
	});

	it("tidies the spellings a player actually types", () => {
		expect(normalizeDamageDie("8")).toBe("d8");
		expect(normalizeDamageDie("D8")).toBe("d8");
		expect(normalizeDamageDie("  d8  ")).toBe("d8");
		expect(normalizeDamageDie("1d8")).toBe("d8");
		expect(normalizeDamageDie("d 8")).toBe("d8");
	});

	it("refuses anything that isn't a single die", () => {
		expect(normalizeDamageDie("2d6")).toBeNull();
		expect(normalizeDamageDie("d8 (forceful)")).toBeNull();
		expect(normalizeDamageDie("d6+1")).toBeNull();
		expect(normalizeDamageDie("big")).toBeNull();
		expect(normalizeDamageDie("d1")).toBeNull();
		expect(normalizeDamageDie("d")).toBeNull();
	});

	// The leading "1" is a multiplier only when a "d" follows it. `(?:1\s*)?d?` read the 1 of a
	// bare two-digit die as the multiplier and, the match having succeeded, never gave it back.
	it("reads a bare two- or three-digit die as the whole number", () => {
		expect(normalizeDamageDie("12")).toBe("d12");
		expect(normalizeDamageDie("10")).toBe("d10");
		expect(normalizeDamageDie("20")).toBe("d20");
		expect(normalizeDamageDie("100")).toBe("d100");
	});

	it("still reads the 1 of a 1d-form as the multiplier", () => {
		expect(normalizeDamageDie("1d12")).toBe("d12");
		expect(normalizeDamageDie("1d10")).toBe("d10");
		expect(normalizeDamageDie("1 d 8")).toBe("d8");
		expect(normalizeDamageDie("1d")).toBeNull();
	});

	it("treats blank and missing input as no die", () => {
		expect(normalizeDamageDie("")).toBeNull();
		expect(normalizeDamageDie("   ")).toBeNull();
		expect(normalizeDamageDie(null)).toBeNull();
		expect(normalizeDamageDie(undefined)).toBeNull();
	});
});

describe("stepDie", () => {
	it("steps up and down the polyhedral ladder", () => {
		expect(stepDie("d6", 1)).toBe("d8");
		expect(stepDie("d6", -1)).toBe("d4");
	});

	it("clamps at both ends and at an explicit cap", () => {
		expect(stepDie("d12", 1)).toBe("d12");
		expect(stepDie("d4", -1)).toBe("d4");
		expect(stepDie("d6", 3, "d8")).toBe("d8");
	});

	it("passes unknown dice through untouched", () => {
		expect(stepDie("d20", 1)).toBe("d20");
	});
});

describe("maxDie", () => {
	it("returns the larger die", () => {
		expect(maxDie("d6", "d10")).toBe("d10");
		expect(maxDie("d10", "d6")).toBe("d10");
	});

	it("defers to whichever die it recognises", () => {
		expect(maxDie(null, "d8")).toBe("d8");
		expect(maxDie("d8", null)).toBe("d8");
	});
});

// One grammar for "HP lost or paid by the line's own speaker", shared by a PC's move options (utils/damage.js
// readOptionDamage), a monster's self-costs (withoutSelfHpCosts) and an arcanum's roller harm (arcana-move-damage.js).
describe("ownHpChangeRe: the speaker's own HP", () => {
	const amount = (re, text) => re.exec(text)?.groups.amount ?? null;

	it("reads a PC's loss, a flat count included, and never someone else's", () => {
		const pc = ownHpChangeRe({ speaker: "pc", verbs: "loss", count: true });
		expect(amount(pc, "They do it, but it costs you, lose 2d4 HP")).toBe("2d4");
		expect(amount(pc, "Mark a debility, lose 1 HP")).toBe("1");
		expect(amount(pc, "you lose 1d6 HP")).toBe("1d6");
		for (const who of ["They", "It", "The target", "The foe", "The victim", "The enemy"]) {
			expect(amount(pc, `${who} loses 1d4 HP`)).toBeNull();
		}
		// Somebody else losing something else in the same line does not take the reader's loss away.
		expect(amount(pc, "Lose 1d8 HP. It loses 1 Charge.")).toBe("1d8");
		expect(amount(pc, "gain 1d4 HP")).toBeNull();
	});

	it("reads a monster's price or gain, where \"you\" is the PC it is aimed at", () => {
		const monster = ownHpChangeRe({ speaker: "monster", verbs: "cost" });
		expect(amount(monster, "ignores armor; costs 1d4 HP")).toBe("1d4");
		expect(amount(monster, "but lose 1d4 HP")).toBe("1d4");
		expect(amount(monster, "gaining 1d4 HP")).toBe("1d4");
		expect(amount(monster, "you lose 1d4 HP")).toBeNull();
		expect(amount(monster, "they lose 1d6 HP")).toBeNull();
		// A die only: a flat count is not a monster's self-cost.
		expect(amount(monster, "costs 2 HP")).toBeNull();
	});

	it("reads damage a PC's move does its own roller", () => {
		expect(OWN_HARM_RE.test("you take 2d4 damage (ignores armor)")).toBe(true);
		expect(OWN_HARM_RE.test("you suffer 2d6+4 messy damage yourself")).toBe(true);
		expect(OWN_HARM_RE.test("deal 1d10 damage but choose one: the ring eats at your life-force")).toBe(false);
		expect(OWN_HARM_RE.test("the Scepter deals 2d4 damage")).toBe(false);
	});
});
