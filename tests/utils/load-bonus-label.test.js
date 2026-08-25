import { describe, it, expect } from "vitest";
import { loadBonusLabel } from "../../module/utils/load.js";
import { joinNames } from "../../module/utils/strings.js";

// The caption under a raised load cap names the move that raised it. It sits on the Outfit
// readout beside three other lists the system writes, so it is joined by the same joiner they
// are: it used to say "A and B" while every one of its neighbours said "A & B".
describe("naming the move that raised the load cap", () => {
	it("says nothing when no move granted one", () => {
		expect(loadBonusLabel()).toBe("");
		expect(loadBonusLabel([])).toBe("");
		expect(loadBonusLabel([" ", null])).toBe("");
	});

	it("names one move plainly", () => {
		expect(loadBonusLabel(["Pack Horse"])).toBe("Pack Horse");
	});

	it("joins the way every other list in the system joins", () => {
		expect(loadBonusLabel(["Pack Horse", "Beast of Burden"])).toBe("Pack Horse & Beast of Burden");
		expect(loadBonusLabel(["A", "B", "C"])).toBe("A, B & C");
		// Not a second joiner: the same answer the shared one gives.
		expect(loadBonusLabel(["A", "B", "C"])).toBe(joinNames(["A", "B", "C"]));
	});

	// A move name is authored text and may arrive padded, so the trim has to stay.
	it("trims authored names and drops the blanks between them", () => {
		expect(loadBonusLabel(["  Pack Horse  ", "", "Beast of Burden"]))
			.toBe("Pack Horse & Beast of Burden");
	});
});
