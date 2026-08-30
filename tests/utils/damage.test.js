import { describe, it, expect } from "vitest";
import { mitigateDamage, dieFromDamage, normalizeDamageBonusDice, composeDamageFormula } from "../../module/utils/damage.js";

describe("mitigateDamage", () => {
	it("returns raw damage when the target has no armor", () => {
		expect(mitigateDamage(6, { armor: 0 })).toBe(6);
	});

	it("subtracts armor from raw damage", () => {
		expect(mitigateDamage(6, { armor: 2 })).toBe(4);
	});

	it("lets piercing ignore that many points of armor", () => {
		expect(mitigateDamage(6, { armor: 2, piercing: 1 })).toBe(5);
	});

	it("never lets piercing ADD damage past raw (armor floors at 0)", () => {
		expect(mitigateDamage(6, { armor: 1, piercing: 5 })).toBe(6);
	});

	it("bypasses armor entirely when the weapon ignores armor", () => {
		expect(mitigateDamage(8, { armor: 3, ignoresArmor: true })).toBe(8);
	});

	it("clamps the result at 0 when armor meets or exceeds the damage", () => {
		expect(mitigateDamage(2, { armor: 5 })).toBe(0);
	});

	it("rounds and floors odd inputs safely", () => {
		expect(mitigateDamage(NaN, { armor: 2 })).toBe(0);
		expect(mitigateDamage(-3, {})).toBe(0);
	});
});

describe("dieFromDamage (existing grammar, unchanged)", () => {
	it("pulls the first die expression out of a damage string", () => {
		expect(dieFromDamage("d8 (forceful)")).toBe("d8");
		expect(dieFromDamage("2d6+1")).toBe("2d6+1");
		expect(dieFromDamage("special")).toBeNull();
	});
});

// The one-off damage adjustment (the pre-roll damage window, RollDialog.js#promptDamage) —
// the Storm Markings' "+1 damage while you roil with anger", a spent Fury's "+1d6", a
// Blood-Soaked Past's "+1d4". The dice half is FREE TEXT typed by a player and it reaches an
// evaluated Roll, so what it accepts and what it silently drops is the whole safety story.
describe("normalizeDamageBonusDice", () => {
	it("takes a die expression however a player writes it", () => {
		expect(normalizeDamageBonusDice("1d6")).toBe("1d6");
		expect(normalizeDamageBonusDice("+1d6")).toBe("1d6");
		expect(normalizeDamageBonusDice(" d4 ")).toBe("d4");
		expect(normalizeDamageBonusDice("2d6 + 1")).toBe("2d6+1");
	});

	it("keeps a leading minus, since the sign is part of the term", () => {
		expect(normalizeDamageBonusDice("-1d4")).toBe("-1d4");
		expect(normalizeDamageBonusDice("- 1d4")).toBe("-1d4");
	});

	it("drops anything that is not one die expression", () => {
		// Half-typed, prose, a bare number, two terms at once. Each would either throw inside
		// Roll or quietly roll something nobody asked for; "" is what the composer skips.
		for (const junk of ["", "   ", "1d", "d", "lots", "3", "1d6+1d6", "d6; drop table"]) {
			expect(normalizeDamageBonusDice(junk), junk).toBe("");
		}
		expect(normalizeDamageBonusDice(null)).toBe("");
		expect(normalizeDamageBonusDice(undefined)).toBe("");
	});
});

describe("composeDamageFormula", () => {
	it("leaves an unadjusted formula exactly as it was", () => {
		expect(composeDamageFormula("d10+2")).toBe("d10+2");
		expect(composeDamageFormula("d10+2", { bonus: 0, extraDice: "" })).toBe("d10+2");
	});

	it("adds a flat bonus and extra dice on top of the weapon's own +N", () => {
		expect(composeDamageFormula("d10+2", { bonus: 1 })).toBe("d10+2+1");
		expect(composeDamageFormula("d10", { extraDice: "1d6" })).toBe("d10+1d6");
		expect(composeDamageFormula("d10", { bonus: 1, extraDice: "1d6" })).toBe("d10+1d6+1");
	});

	it("subtracts a negative bonus rather than writing +-1", () => {
		expect(composeDamageFormula("d6", { bonus: -1 })).toBe("d6-1");
		expect(composeDamageFormula("d6", { extraDice: "-1d4" })).toBe("d6-1d4");
	});

	it("stacks several dice terms, so a move's extra dice and the player's own both land", () => {
		// Clash's strike-hard already contributes 1d6 before the player spends Fury for another.
		expect(composeDamageFormula("d10", { extraDice: ["1d6", "1d6"] })).toBe("d10+1d6+1d6");
	});

	it("keeps the base die FIRST, because advantage doubles the formula's first dice term", () => {
		expect(composeDamageFormula("d10", { extraDice: "1d6", bonus: 2 }).startsWith("d10")).toBe(true);
	});

	it("drops unparseable dice instead of letting them reach the roll", () => {
		expect(composeDamageFormula("d10", { extraDice: "1d" })).toBe("d10");
		expect(composeDamageFormula("d10", { extraDice: ["1d6", "nonsense"] })).toBe("d10+1d6");
	});

	it("never leaves a formula starting with a sign, and never returns nothing", () => {
		expect(composeDamageFormula("", { extraDice: "1d6" })).toBe("1d6");
		expect(composeDamageFormula("", { bonus: 3 })).toBe("3");
		expect(composeDamageFormula("")).toBe("0");
	});
});
