import { describe, it, expect } from "vitest";
import { buildPlacePages, placePageKey, steadingPlaces } from "../../module/utils/places-chronicle.js";
import { STEADING_DEFAULTS } from "../../module/actors/steading/StonetopSteading.js";

// The "Places of Interest" journal in The Chronicle folder — a page per named place on the
// steading's lettered list, which is what a village map pin opens. These cover the pure
// compiler and the steading read; creating the journal itself needs Foundry.

const VILLAGE_LINK = "<p>More about the village: <strong>@UUID[JournalEntry.abc]{The Village of Stonetop}</strong></p>";

describe("placePageKey", () => {
	it("keys a page by its map letter, case-folded", () => {
		expect(placePageKey("D")).toBe("place:d");
		expect(placePageKey("d")).toBe("place:d");
		expect(placePageKey(" f ")).toBe("place:f");
	});
});

describe("buildPlacePages", () => {
	it("makes one page per named place, in the sheet's order", () => {
		const pages = buildPlacePages([
			{ letter: "A", name: "The Stone" },
			{ letter: "B", name: "The Granary" },
		]);

		expect(pages.map(p => p.name)).toEqual(["The Stone", "The Granary"]);
		expect(pages.map(p => p.key)).toEqual(["place:a", "place:b"]);
	});

	// A blank letter is an empty slot on the steading sheet, not a place. Seeding one would
	// put twelve untitled entries in a journal the players read.
	it("skips the letters nobody has named", () => {
		const pages = buildPlacePages([
			{ letter: "A", name: "The Stone" },
			{ letter: "G", name: "" },
			{ letter: "H", name: "   " },
		]);

		expect(pages).toHaveLength(1);
	});

	it("gives a printed landmark the book's own paragraph and the way to the village entry", () => {
		const [page] = buildPlacePages([{ letter: "d", name: "Cistern" }], { villageLink: VILLAGE_LINK });
		const [section] = page.sections;

		expect(section.heading).toBe("Overview");
		expect(section.body).toContain("The Cistern is an underground vault");
		expect(section.body).toContain(VILLAGE_LINK);
	});

	// The pin already wears the letter; the page does not repeat it.
	it("says nothing of the map letter", () => {
		const [page] = buildPlacePages([{ letter: "d", name: "Cistern" }], { villageLink: VILLAGE_LINK });

		expect(page.sections[0].body).not.toMatch(/Marked|village map/);
		expect(page.sections[0].body.startsWith("<p>The Cistern")).toBe(true);
	});

	// A place the GM invented has nothing to read in the village entry, so pointing them at
	// it would be a dead end dressed up as a lead. Its page is still made, for the pin to open
	// and the GM to write into.
	it("gives a place the book says nothing about an empty Overview", () => {
		const pages = buildPlacePages([{ letter: "g", name: "Bethany's smithy" }], { villageLink: VILLAGE_LINK });

		expect(pages).toHaveLength(1);
		expect(pages[0].sections).toEqual([expect.objectContaining({ kind: "prose", heading: "Overview", body: "" })]);
	});

	// The key is the SLOT, not the name — so renaming a place keeps its page and everything
	// written on it, and the pin pointing at that page keeps working.
	it("keys on the letter, so a rename lands on the same page", () => {
		const before = buildPlacePages([{ letter: "c", name: "Public House & Stables" }]);
		const after  = buildPlacePages([{ letter: "c", name: "The Broken Barrel" }]);

		expect(after[0].key).toBe(before[0].key);
		expect(after[0].name).toBe("The Broken Barrel");
	});

	it("is empty for a steading with nothing named", () => {
		expect(buildPlacePages([])).toEqual([]);
		expect(buildPlacePages()).toEqual([]);
	});
});

describe("steadingPlaces", () => {
	it("reads the steading's own list when it has one", () => {
		const steading = { flags: { "stonetop-pwd": { steading: { places: [{ letter: "A", name: "The Stone" }] } } } };

		expect(steadingPlaces(steading)).toEqual([{ letter: "A", name: "The Stone" }]);
	});

	// A fresh steading has never written the flag — the sheet is showing the printed
	// defaults — so the pages have to be built from those or a new world gets none.
	it("falls back to the printed defaults for a steading that has never been edited", () => {
		expect(steadingPlaces({ flags: {} })).toEqual(STEADING_DEFAULTS.places);
		expect(steadingPlaces(null)).toEqual(STEADING_DEFAULTS.places);
	});

	it("trims what it reads and drops a row with no letter", () => {
		const steading = { flags: { "stonetop-pwd": { steading: { places: [
			{ letter: " A ", name: " The Stone " },
			{ letter: "", name: "Homeless" },
		] } } } };

		expect(steadingPlaces(steading)).toEqual([{ letter: "A", name: "The Stone" }]);
	});
});

describe("the printed defaults", () => {
	// The six defaults are the six the book describes, and they are what the poster map's
	// lettered pins point at. If a default were renamed without the alias following it, the
	// pages would quietly lose their prose.
	it("every named default page carries the book's paragraph", () => {
		const pages = buildPlacePages(STEADING_DEFAULTS.places);

		expect(pages).toHaveLength(6);
		for (const page of pages) {
			expect(page.sections[0].body.length, `${page.name} has no paragraph`).toBeGreaterThan(40);
		}
	});
});
