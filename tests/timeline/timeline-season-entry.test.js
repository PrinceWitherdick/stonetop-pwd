import { describe, it, expect } from "vitest";
import { seasonEntryBody } from "../../module/timeline/timeline-season-entry.js";

// The one LINE a Seasons Change puts on Stonetop's thread, beside what the table wrote down
// themselves. The full record is the season's page in the Seasons Change journal; this is the part
// a reader scanning the campaign should see, so what is worth pinning is that it stays short and
// that it says nothing when there is nothing to say.

describe("seasonEntryBody", () => {
	it("names the seasonal gains the steading chose", () => {
		expect(seasonEntryBody({ gainNames: ["Bountiful harvest"] }))
			.toContain("<strong>Seasonal gain:</strong> Bountiful harvest");
	});

	it("pluralises when there was more than one", () => {
		expect(seasonEntryBody({ gainNames: ["A", "B"] })).toContain("<strong>Seasonal gains:</strong> A, B");
	});

	it("shows which way the stores went, signed", () => {
		expect(seasonEntryBody({ surplusChange: 2 })).toContain("+2");
		expect(seasonEntryBody({ surplusChange: -3 })).toContain("-3");
	});

	// Nothing to say about the stores is not the same as saying they did not move, and a line
	// reading "Surplus: 0" is noise in a record meant to be scanned.
	it("says nothing about a season the stores did not move in", () => {
		expect(seasonEntryBody({ surplusChange: 0 })).toBe("");
	});

	it("carries the GM's own notes through, with their line breaks", () => {
		expect(seasonEntryBody({ notes: "The Forge lit.\nNobody saw who." }))
			.toContain("The Forge lit.<br>Nobody saw who.");
	});

	// A Seasons Change with nothing recorded against it is still a season that turned; the entry's
	// TITLE carries that, and an empty body is what lets the card print as one clean line.
	it("is empty for a season nothing was recorded against", () => {
		expect(seasonEntryBody()).toBe("");
		expect(seasonEntryBody({ gainNames: [], surplusChange: 0, notes: "   " })).toBe("");
	});

	// The Fortunes roll is left out on purpose: it is a die result rather than a thing that
	// happened, and the season's own page has it.
	it("leaves the Fortunes roll to the season page", () => {
		expect(seasonEntryBody({ gainNames: ["A"], surplusChange: 1, notes: "x" }))
			.not.toContain("Fortunes");
	});
});
