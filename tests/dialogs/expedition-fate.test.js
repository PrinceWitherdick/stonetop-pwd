import { describe, it, expect, vi } from "vitest";

// The Die of Fate buttons in the Run an Expedition walkthrough. Two steps reach for the die, and
// each asks a different question: how perilous the leg is, and whether the night stays quiet. This
// pins the button to the table printed above it: the step must NAME a table (a bare `true` used to
// roll the generic oracle, which answered a question the GM hadn't asked), and the list on the page
// must be rendered from that table rather than retyped.
//
// A third step used to ask whether they got the weather they hoped for. It is gone from the
// walkthrough (see the header comment in ExpeditionDialog.js); FATE_TABLES.weather stays, because
// the roller takes any table by name and the oracle is still the book's answer to that question.

// The route step browses the art folder on render; nothing here renders, but the module is imported.
vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { FATE_TABLES, fateRowText, fateRangeLabel } = await import("../../module/data/fate-tables.js");

const steps     = Object.create(ExpeditionDialog.prototype)._steps;
const fateSteps = steps.filter(s => s.fate);

describe("the walkthrough's Die of Fate steps", () => {
	it("are the two the rules hang a table off", () => {
		expect(fateSteps.map(s => s.key)).toEqual(["running", "playermoves"]);
	});

	it("each name a real table instead of just asking for a die", () => {
		for (const step of fateSteps) {
			expect(typeof step.fate, step.key).toBe("string");
			expect(FATE_TABLES[step.fate], step.key).toBeTruthy();
		}
	});

	it("name a different one each", () => {
		expect(new Set(fateSteps.map(s => s.fate)).size).toBe(fateSteps.length);
	});

	it("still offer the button, and nothing else asks for a second one", () => {
		const data = step => ({ showFate: !!step.fate });
		expect(fateSteps.map(s => data(s).showFate)).toEqual([true, true]);
		// The weather step carried a `weather: true` flag for a second button beside the die
		// (it opened the seasonal picker). Both are gone; the picker has its own macro.
		expect(steps.filter(s => s.weather)).toEqual([]);
	});

	it("print every row of the table they name, from the table itself", () => {
		for (const step of fateSteps) {
			const table = FATE_TABLES[step.fate];
			for (const row of table.rows) {
				const printed = step.body.includes(fateRowText(row)) || step.body.includes(row.label);
				expect(printed, `${step.key} ${fateRangeLabel(row)}`).toBe(true);
				expect(step.body, step.key).toContain(fateRangeLabel(row));
			}
		}
	});

	it("leave no step printing a d6 table it doesn't roll", () => {
		for (const step of steps) {
			if (step.body?.includes("stonetop-exp-fatetable")) expect(step.fate, step.key).toBeTruthy();
		}
	});
});
