import { describe, it, expect } from "vitest";
import { SITE_PAIR_LISTS, keyedRows, pairKeys, shapePairList, someText } from "../../module/sites/site-schema.js";

// The one table four things read — the wizard, the shaper, the card view-model and the review
// tally — and the one rule for what a keyed row is worth keeping. These were three private copies
// before, and the copies had already drifted over which blank counts as blank.

describe("keyedRows", () => {
	it("trims every key and keeps a row that has text in any of them", () => {
		expect(keyedRows([{ a: "  x ", b: "" }], ["a", "b"])).toEqual([{ a: "x", b: "" }]);
		expect(keyedRows([{ a: "", b: " y" }], ["a", "b"])).toEqual([{ a: "", b: "y" }]);
	});

	it("drops a row whose every key is blank or whitespace", () => {
		expect(keyedRows([{ a: "", b: "   " }, { a: "keep", b: "" }], ["a", "b"]))
			.toEqual([{ a: "keep", b: "" }]);
	});

	it("fills a key the row never had, so every row is the same shape", () => {
		expect(keyedRows([{ a: "x" }], ["a", "b"])).toEqual([{ a: "x", b: "" }]);
	});

	it("leaves the keys named in `keep` exactly as typed", () => {
		// A textarea's interior line breaks and its indentation are the GM's own paragraphing.
		const [row] = keyedRows([{ a: " t ", b: "\nline1\n\n  line2\n" }], ["a", "b"], ["b"]);
		expect(row).toEqual({ a: "t", b: "\nline1\n\n  line2\n" });
	});

	it("still drops a row whose only content is untrimmed whitespace", () => {
		// `keep` says "do not rewrite this value", not "this counts as text".
		expect(keyedRows([{ a: "", b: "  \n  " }], ["a", "b"], ["b"])).toEqual([]);
	});

	it("survives a non-array, a null row and a non-string value", () => {
		expect(keyedRows(null, ["a"])).toEqual([]);
		expect(keyedRows(undefined, ["a"])).toEqual([]);
		expect(keyedRows([null, { a: 7 }], ["a"])).toEqual([{ a: "7" }]);
	});
});

describe("someText", () => {
	it("is false only when every key is blank", () => {
		expect(someText({ a: "", b: " " }, ["a", "b"])).toBe(false);
		expect(someText({ a: "", b: "x" }, ["a", "b"])).toBe(true);
		// A key the caller did not name cannot keep the row alive.
		expect(someText({ a: "", z: "x" }, ["a"])).toBe(false);
	});
});

describe("SITE_PAIR_LISTS", () => {
	it("names areas' four keys, not two", () => {
		// The list that broke the old fixed keyA/keyB renderer: it rendered the first two and
		// silently dropped the rest, which were still seeded, saved and shaped.
		expect(pairKeys("areas")).toEqual(["title", "description", "contents", "exits"]);
	});

	it("is null for a list that is not a paired one, which is how the wizard tells them apart", () => {
		expect(pairKeys("dangers")).toBeNull();
		expect(pairKeys("")).toBeNull();
		expect(pairKeys(undefined)).toBeNull();
	});

	it("declares every multiline key as one of that list's own keys", () => {
		for (const [list, spec] of Object.entries(SITE_PAIR_LISTS)) {
			for (const key of spec.multiline ?? []) {
				expect(spec.keys, `${list}.multiline names "${key}"`).toContain(key);
			}
		}
	});
});

describe("shapePairList", () => {
	it("keeps an area's textarea keys as typed and trims its single-line ones", () => {
		const [area] = shapePairList("areas", [{
			title: "  Entrance chamber (A) ",
			description: "Dimly lit.\n\nBeyond, the floor is filthy.\n",
			contents: "  a crinwin\n  a hoard  ",
			exits: "  north  ",
		}]);
		expect(area.title).toBe("Entrance chamber (A)");
		expect(area.exits).toBe("north");
		expect(area.description).toBe("Dimly lit.\n\nBeyond, the floor is filthy.\n");
		expect(area.contents).toBe("  a crinwin\n  a hoard  ");
	});

	it("trims both halves of a list with no multiline keys", () => {
		expect(shapePairList("questions", [{ prompt: " why? ", answer: " because " }]))
			.toEqual([{ prompt: "why?", answer: "because" }]);
	});

	it("is empty for a list that is not a paired one", () => {
		expect(shapePairList("dangers", [{ x: "y" }])).toEqual([]);
	});
});
