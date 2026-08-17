import { describe, it, expect } from "vitest";
import { readRepo } from "../fakes/css.js";
import { cardinalWord, yearLabel, mergeSeasonBlock } from "../../module/seasons/seasons-chronicle.js";

// Minimal stand-ins for the wrapped blocks recordSeasonsChange writes — only the
// `<section data-season>` marker matters to the merge.
const block = (season, body = "") => `<section class="stonetop-season-block" data-season="${season}"><h2>${season}</h2>${body}</section>`;

describe("cardinalWord", () => {
	it("spells out the small numbers", () => {
		expect(cardinalWord(1)).toBe("One");
		expect(cardinalWord(2)).toBe("Two");
		expect(cardinalWord(3)).toBe("Three");
		expect(cardinalWord(10)).toBe("Ten");
		expect(cardinalWord(20)).toBe("Twenty");
	});

	// Twenty is where the words stop earning their keep — past it they are longer to read
	// than the digits, and the counting is the point.
	it("falls back to the numeral past twenty", () => {
		expect(cardinalWord(21)).toBe("21");
		expect(cardinalWord(22)).toBe("22");
		expect(cardinalWord(100)).toBe("100");
	});
});

describe("yearLabel", () => {
	// "Year One", not "First Year". The count leads: the header's clock and the picker's chip
	// are both a season beside a NUMBER, and the journal sidebar is a column of years to scan
	// down — an ordinal buries the digit behind a word that changes shape every entry.
	it("puts the count after the constant word", () => {
		expect(yearLabel(1)).toBe("Year One");
		expect(yearLabel(2)).toBe("Year Two");
		expect(yearLabel(20)).toBe("Year Twenty");
	});

	// ...which is also what survives the fall-off past twenty. "Year 21" still reads as one of
	// these; "21st Year" would read as a different naming scheme starting halfway through.
	it("keeps its shape past twenty", () => {
		expect(yearLabel(21)).toBe("Year 21");
		expect(yearLabel(100)).toBe("Year 100");
	});

	// The ordinal spellers are gone from the live code — nothing spells a year that way any
	// more, and a leftover exported one is a second naming scheme sitting there to be reached
	// for. Recognising the OLD names is the migration's job and lives there alone.
	it("leaves no ordinal speller behind in the module", () => {
		const source = readRepo("module/seasons/seasons-chronicle.js");
		expect(source).not.toContain("_ORDINAL_WORDS");
		expect(source).not.toMatch(/export function ordinal/);
		// ...and no surface builds the string by hand instead of calling yearLabel.
		expect(source).not.toMatch(/`\$\{[^}]+\} Year`/);
	});
});

describe("mergeSeasonBlock", () => {
	it("appends a season that isn't on the page yet", () => {
		const merged = mergeSeasonBlock(block("spring"), "summer", block("summer", "<p>warm</p>"));
		expect(merged).toBe(block("spring") + block("summer", "<p>warm</p>"));
	});

	it("replaces an earlier block for the same season instead of duplicating it", () => {
		const existing = block("spring", "<p>old</p>");
		const merged   = mergeSeasonBlock(existing, "spring", block("spring", "<p>new</p>"));
		expect(merged).toBe(block("spring", "<p>new</p>"));
		expect(merged).not.toContain("old");
		// Exactly one Spring block remains.
		expect(merged.match(/data-season="spring"/g)).toHaveLength(1);
	});

	it("re-emits blocks in canonical season order regardless of insertion order", () => {
		let html = "";
		html = mergeSeasonBlock(html, "winter", block("winter"));
		html = mergeSeasonBlock(html, "spring", block("spring"));
		html = mergeSeasonBlock(html, "autumn", block("autumn"));
		html = mergeSeasonBlock(html, "summer", block("summer"));
		expect(html).toBe(block("spring") + block("summer") + block("autumn") + block("winter"));
	});

	it("starts a fresh page from empty content", () => {
		expect(mergeSeasonBlock("", "spring", block("spring"))).toBe(block("spring"));
	});
});
