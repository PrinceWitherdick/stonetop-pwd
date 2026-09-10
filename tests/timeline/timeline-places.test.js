import { describe, it, expect } from "vitest";
import { mergePlaceNames } from "../../module/timeline/timeline-places.js";

// Where an entry happened is FREE TEXT with a datalist behind it, not a picker: a party names
// places the book never did, and a list of known locations would refuse every one of them. What is
// worth pinning is the offered list itself, since a duplicate or a blank in it is the kind of thing
// that only shows up as a scruffy dropdown nobody reports.

describe("mergePlaceNames", () => {
	it("keeps the sources in the order they were given, so the steading's own places lead", () => {
		expect(mergePlaceNames(["The Stone", "The Granary"], ["Marshedge", "Gordin's Delve"]))
			.toEqual(["The Stone", "The Granary", "Marshedge", "Gordin's Delve"]);
	});

	// The steading's lettered places and the settlements roster overlap: Stonetop itself is on
	// both, and a GM may well have named a lettered slot after somewhere on the gazetteer.
	it("drops a repeat, whatever case it was typed in", () => {
		expect(mergePlaceNames(["Marshedge"], ["marshedge", "MARSHEDGE", "Marshedge"]))
			.toEqual(["Marshedge"]);
	});

	it("keeps the first spelling of a repeat, not the last", () => {
		expect(mergePlaceNames(["Marshedge"], ["marshedge"])).toEqual(["Marshedge"]);
	});

	// A blank lettered slot on the steading sheet is an empty slot, not a place.
	it("drops the blanks a half-filled steading sheet hands it", () => {
		expect(mergePlaceNames(["The Stone", "", "   ", null, undefined])).toEqual(["The Stone"]);
	});

	it("trims, so a stray space cannot make a second entry for one place", () => {
		expect(mergePlaceNames([" The Stone "], ["The Stone"])).toEqual(["The Stone"]);
	});

	it("copes with a source that is missing entirely", () => {
		expect(mergePlaceNames(undefined, ["Marshedge"], null)).toEqual(["Marshedge"]);
		expect(mergePlaceNames()).toEqual([]);
	});
});
