import { describe, it, expect } from "vitest";
import { seasonEntryBody, seasonShortfallKey } from "../../module/timeline/timeline-season-entry.js";

// The one LINE a Seasons Change puts on Stonetop's thread, beside what the table wrote down
// themselves. The full record is the season's page in the Seasons Change journal; this is the part
// a reader scanning the campaign should see, so what is worth pinning is that it stays short and
// that it says nothing when there is nothing to say.

describe("seasonEntryBody", () => {
	it("names the seasonal gains the steading chose", () => {
		expect(seasonEntryBody({ gainNames: ["Bountiful harvest"] }))
			.toContain("<strong>Seasonal gain:</strong> Bountiful harvest");
	});

	// The GM's notes are plain text, escaped as the Seasons Change journal's own block escapes them.
	it("escapes the notes and the gains' names, keeping line breaks", () => {
		const body = seasonEntryBody({ gainNames: ["Salt & smoke"], notes: "A <wolf> came\nand went" });
		expect(body).toContain("Salt &amp; smoke");
		expect(body).toContain("<p>A &lt;wolf&gt; came<br>and went</p>");
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

	// User, 2026-10-10: the roll's TIER is on the line (a 6- is the season that went badly), never
	// its dice, and first, before what the tier let the steading pick.
	it("leads with how the Fortunes roll went, as its tier", () => {
		const body = seasonEntryBody({ gainNames: ["A"], fortunesTier: "partial" });
		expect(body.startsWith("<p><strong>Fortunes roll:</strong> 7-9</p>")).toBe(true);
		expect(seasonEntryBody({ fortunesTier: "failure" })).toContain("6-");
	});

	it("says nothing of a roll whose card was never found", () => {
		expect(seasonEntryBody({ gainNames: ["A"], surplusChange: 1, notes: "x" })).not.toContain("Fortunes");
		expect(seasonEntryBody({ fortunesTier: null })).toBe("");
	});
});

describe("seasonShortfallKey", () => {
	// One note per season, each thing suffered a line on it; and keyed, so the season's own row
	// (found keyless) is never mistaken for it.
	it("is one key per season and year", () => {
		expect(seasonShortfallKey("winter", 3)).toBe("shortfall:3:winter");
		expect(seasonShortfallKey("winter", 3)).not.toBe(seasonShortfallKey("winter", 4));
	});
});
