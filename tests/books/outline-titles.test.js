import { describe, it, expect } from "vitest";
import { outlineHeadings, headingAt } from "../../module/books/outline-titles.js";

/**
 * A document proxy with an outline, spelled the two ways a PDF spells a destination: a NAMED one
 * the document resolves for us, and an EXPLICIT array whose first element is a reference to a
 * page object. Both are ordinary in a real book, and only the second can be read without asking
 * the document a second question.
 */
function book(over = {}) {
	return {
		getOutline: async () => [
			{
				title: "  Chapter 5:\n Home  ",
				dest: "chapter5",
				items: [
					{ title: "Steadings & Seasons", dest: [{ num: 91 }, {}] },
					{ title: "The Seasons Change", dest: [{ num: 96 }, {}] },
				],
			},
			{ title: "Chapter 6: Away", dest: [{ num: 200 }, {}] },
		],
		getDestination: async name => (name === "chapter5" ? [{ num: 80 }, {}] : null),
		getPageIndex: async ref => ref.num - 1,
		...over,
	};
}

describe("the book's headings, as a table of pages", () => {
	it("flattens chapters and their sections onto one ruler, in page order", async () => {
		expect(await outlineHeadings(book())).toEqual([
			{ page: 80, title: "Chapter 5: Home" },
			{ page: 91, title: "Steadings & Seasons" },
			{ page: 96, title: "The Seasons Change" },
			{ page: 200, title: "Chapter 6: Away" },
		]);
	});

	it("takes a page index given as a plain number rather than a reference", async () => {
		const flat = { getOutline: async () => [{ title: "Straight to it", dest: [12, {}] }] };
		expect(await outlineHeadings(flat)).toEqual([{ page: 13, title: "Straight to it" }]);
	});

	it("drops a heading whose destination goes nowhere, and keeps the rest", async () => {
		const broken = book({ getPageIndex: async ref => { if (ref.num === 91) throw new Error("bad ref"); return ref.num - 1; } });
		expect((await outlineHeadings(broken)).map(h => h.title))
			.toEqual(["Chapter 5: Home", "The Seasons Change", "Chapter 6: Away"]);
	});

	it("answers with nothing for a book that has no outline at all", async () => {
		expect(await outlineHeadings({ getOutline: async () => null })).toEqual([]);
		expect(await outlineHeadings({ getOutline: async () => { throw new Error("no"); } })).toEqual([]);
		expect(await outlineHeadings(null)).toEqual([]);
	});
});

describe("which heading a page falls under", () => {
	const headings = [
		{ page: 80, title: "Chapter 5: Home" },
		{ page: 91, title: "Steadings & Seasons" },
		{ page: 96, title: "The Seasons Change" },
	];

	it("takes the last heading at or before the page, not the nearest", () => {
		expect(headingAt(headings, 95)).toBe("Steadings & Seasons");
		expect(headingAt(headings, 91)).toBe("Steadings & Seasons");
		expect(headingAt(headings, 200)).toBe("The Seasons Change");
	});

	it("has nothing to call a page before the first heading", () => {
		expect(headingAt(headings, 3)).toBe("");
		expect(headingAt([], 3)).toBe("");
	});
});
