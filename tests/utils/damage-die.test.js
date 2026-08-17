import { describe, it, expect } from "vitest";
import { normalizeDamageDie, stepDie, maxDie } from "../../module/utils/damage-die.js";

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
