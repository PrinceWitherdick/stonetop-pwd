import { describe, expect, it } from "vitest";
import { damageRollFormula } from "../../module/utils/roll-engine.js";
import { dieResultsText, multiDieFaces } from "../../module/utils/chat.js";

// Advantage on damage is "roll damage twice and use the higher result" (Book I p.399), "roll their
// damage die twice and keep the best/worst roll" (p.21): two whole ROLLS, one kept.

describe("damageRollFormula", () => {
	it("rolls one die twice and keeps one, the modifier and the extra dice riding outside", () => {
		expect(damageRollFormula("d6", "dis")).toBe("2d6kl1");
		expect(damageRollFormula("d8+2", "adv")).toBe("2d8kh1+2");
		expect(damageRollFormula("1d10+1d6+1", "adv")).toBe("2d10kh1+1d6+1");
	});

	it("rolls SEVERAL dice twice as whole rolls and keeps the better or worse total", () => {
		// Not "4d4kl2": the two worst of four dice is not the worse of two 2d4 rolls.
		expect(damageRollFormula("2d4", "dis")).toBe("{2d4,2d4}kl");
		expect(damageRollFormula("2d8+1", "adv")).toBe("{2d8,2d8}kh+1");
		expect(damageRollFormula("2d4+1d6", "adv")).toBe("{2d4,2d4}kh+1d6");
	});

	it("leaves a straight roll and a dieless formula alone", () => {
		expect(damageRollFormula("2d4", "normal")).toBe("2d4");
		expect(damageRollFormula("5", "dis")).toBe("5");
	});
});

describe("the faces readout for a pool of two rolls", () => {
	const die = (...results) => ({ faces: 4, results: results.map(result => ({ result, active: true })) });

	it("adds each roll's faces up and puts the dropped roll in parentheses", () => {
		const pool = {
			rolls: [{ dice: [die(1, 3)] }, { dice: [die(2, 4)] }],
			results: [{ result: 4, active: true }, { result: 6, active: false, discarded: true }],
		};
		const roll = { terms: [pool, { operator: "+" }, die(5)], dice: [die(1, 3), die(2, 4), die(5)] };
		expect(dieResultsText(roll)).toBe("1+3, (2+4), 5");
		expect(multiDieFaces(roll)).toBe("1+3, (2+4), 5");
	});

	it("reads a roll with no pool die by die, as it always did", () => {
		const twoD6 = { faces: 6, results: [{ result: 2, active: true }, { result: 5, active: false, discarded: true }] };
		expect(dieResultsText({ terms: [twoD6], dice: [twoD6] })).toBe("2, (5)");
	});
});
