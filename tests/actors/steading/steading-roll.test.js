import { describe, expect, it, vi } from "vitest";
import { settleSteadingRoll } from "../../../module/actors/steading/steading-roll.js";
import { STEADING_MOVE } from "../../../module/actors/steading/improvement-rolls.js";

// Every door to a steading roll settles its terms here: the sheet's rolls, the Seasons Change
// hand-off, the walkthrough's Requisition, a character's Requisition window. The rules each
// improvement adds are improvement-rolls.test.js's; this is the netting and the held promise.

function steading({ built = [], diminished = false, held = null, clearFails = false } = {}) {
	const s = {
		held,
		improvementCompleted: slug => built.includes(slug),
		getSystemValue: path => (path.includes("diminished") ? diminished : false),
		fortunesAdvantage: () => s.held,
		clearFortunesAdvantage: vi.fn(async () => {
			if (clearFails) throw new Error("refused");
			s.held = null;
		}),
	};
	return s;
}

const RITES = { source: "A sacrifice at the sacred rites" };

describe("settling a steading roll", () => {
	it("nets every rule's advantage and disadvantage against the chosen mode", async () => {
		const township = steading({ built: ["township"] });
		expect((await settleSteadingRoll(township, { moveName: STEADING_MOVE.MUSTER, statKey: "population" })).rollMode).toBe("adv");
		const both = await settleSteadingRoll(steading({ built: ["township"], diminished: true }), {
			moveName: STEADING_MOVE.MUSTER, statKey: "population",
		});
		expect(both.rollMode).toBe("normal");
		expect((await settleSteadingRoll(township, { moveName: STEADING_MOVE.MUSTER, statKey: "population", chosenMode: "dis" })).rollMode).toBe("normal");
	});

	it("applies a held advantage to a +Fortunes roll, names it, and spends it when told", async () => {
		const s = steading({ held: RITES });
		const terms = await settleSteadingRoll(s, { moveName: STEADING_MOVE.REQUISITION, statKey: "fortunes" });
		expect(terms.rollMode).toBe("adv");
		expect(terms.held).toEqual(RITES);
		expect(terms.conditionNotes).toEqual(["A sacrifice at the sacred rites: advantage"]);
		// Still held until the roll is made: anything failing before the dice keeps the promise.
		expect(s.held).toEqual(RITES);
		await terms.spend();
		expect(s.held).toBeNull();
	});

	// Advantage and disadvantage cancel (Book I): the hold outranks the sticky selector as a SOURCE
	// of advantage, but never beats a disadvantage. It is still spent, because this was its roll.
	it("nets the held advantage against a chosen disadvantage, and still spends it", async () => {
		const s = steading({ held: RITES });
		const terms = await settleSteadingRoll(s, { moveName: "Seasons Change", statKey: "fortunes", chosenMode: "dis" });
		expect(terms.rollMode).toBe("normal");
		await terms.spend();
		expect(s.held).toBeNull();
	});

	it("leaves the hold alone on a roll that is not +Fortunes", async () => {
		const s = steading({ held: RITES });
		const terms = await settleSteadingRoll(s, { moveName: STEADING_MOVE.MUSTER, statKey: "population" });
		expect(terms.held).toBeNull();
		await terms.spend();
		expect(s.clearFortunesAdvantage).not.toHaveBeenCalled();
	});

	// A player who cannot write the steading could not clear it, and would leave the promise to
	// be spent again by the next roll. It waits for someone who can.
	it("neither applies nor spends the hold for someone who cannot write the steading", async () => {
		const s = steading({ held: RITES });
		const terms = await settleSteadingRoll(s, { moveName: STEADING_MOVE.REQUISITION, statKey: "fortunes", canSpend: false });
		expect(terms.rollMode).toBe("normal");
		await terms.spend();
		expect(s.clearFortunesAdvantage).not.toHaveBeenCalled();
		expect(s.held).toEqual(RITES);
	});

	it("still rolls when the spend cannot be written", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const terms = await settleSteadingRoll(steading({ held: RITES, clearFails: true }), {
			moveName: STEADING_MOVE.REQUISITION, statKey: "fortunes",
		});
		expect(terms.rollMode).toBe("adv");
		await expect(terms.spend()).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("passes the herd's Requisition rule through", async () => {
		const terms = await settleSteadingRoll(steading({ built: ["herdOfHorses"] }), {
			moveName: STEADING_MOVE.REQUISITION, statKey: "fortunes", answers: { herdShare: true },
		});
		expect(terms.missAsPartial).toMatch(/half the herd/i);
	});
});
