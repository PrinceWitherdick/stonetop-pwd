// Code review of 1.8.4: uses paid on someone's behalf out of several purses say what EACH has left.
import { describe, it, expect } from "vitest";
import { behalfSpendRow } from "../../../module/actors/character/supply-payer.js";

describe("the row for supplies paid on someone's behalf", () => {
	it("gives one purse's count, or each purse's when the spend was spread", () => {
		expect(behalfSpendRow("Gwynn", { label: "Supplies", spent: 1, left: 2 }, "Bram").value)
			.toBe("Expended 1 use on Bram's behalf (2 left)");
		const spread = { label: "Supplies & More supplies", spent: 2, left: 1,
			parts: [{ label: "Supplies", left: 0 }, { label: "More supplies", left: 1 }] };
		expect(behalfSpendRow("Gwynn", spread, "Bram").value)
			.toBe("Expended 2 uses on Bram's behalf (Supplies 0 left, More supplies 1 left)");
	});
});
