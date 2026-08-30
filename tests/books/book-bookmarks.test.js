import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	BOOKMARKS_SETTING, bookmarksFor, addBookmark, renameBookmark, removeBookmark,
	cleanLabel, pageNote, LABEL_MAX,
} from "../../module/books/book-bookmarks.js";

// The one setting these live in, standing in for the world's database. `set` REPLACES rather
// than merging, the way `game.settings.set` does, because half of what is worth testing here is
// that one book's list is rewritten without disturbing the other's.
function withBookmarks(stored = {}) {
	const store = { [BOOKMARKS_SETTING]: structuredClone(stored) };
	game.settings = {
		get: (_scope, key) => store[key],
		set: vi.fn(async (_scope, key, value) => { store[key] = structuredClone(value); return value; }),
	};
	return store;
}

beforeEach(() => { withBookmarks(); });

describe("a reader's bookmarks in one book", () => {
	it("keeps them in reading order, whatever order they were made in", async () => {
		await addBookmark(1, { label: "Later", page: 120, hash: "page=120" });
		await addBookmark(1, { label: "Earlier", page: 30, hash: "page=30" });
		expect(bookmarksFor(1).map(row => row.label)).toEqual(["Earlier", "Later"]);
	});

	it("holds two marks on one spread in the order they were made", async () => {
		const first = await addBookmark(1, { label: "First", page: 91, hash: "page=91" });
		const second = await addBookmark(1, { label: "Second", page: 91, hash: "page=91" });
		// Minted a moment apart, or in the same millisecond: either way the tie-break has to hold.
		expect(second.created).toBeGreaterThanOrEqual(first.created);
		expect(bookmarksFor(1).map(row => row.label)).toEqual(["First", "Second"]);
	});

	it("keeps each book's marks to itself", async () => {
		await addBookmark(1, { label: "In Book I", page: 10, hash: "page=10" });
		await addBookmark(2, { label: "In Book II", page: 10, hash: "page=10" });
		expect(bookmarksFor(1).map(row => row.label)).toEqual(["In Book I"]);
		expect(bookmarksFor(2).map(row => row.label)).toEqual(["In Book II"]);
	});

	it("stores the whole view, not just the page", async () => {
		await addBookmark(1, { label: "Here", page: 91, hash: "page=91&zoom=100,0,412" });
		expect(bookmarksFor(1)[0]).toMatchObject({ page: 91, hash: "page=91&zoom=100,0,412" });
	});

	it("answers with nothing when the setting has never been written", () => {
		game.settings = { get: () => undefined };
		expect(bookmarksFor(1)).toEqual([]);
	});

	it("ignores a stored row that cannot be gone to", () => {
		withBookmarks({ 1: [{ id: "a", label: "Nowhere" }, { id: "b", label: "Somewhere", page: 12 }] });
		expect(bookmarksFor(1).map(row => row.id)).toEqual(["b"]);
	});

	it("drops the book's key rather than leaving an empty list behind", async () => {
		const store = withBookmarks({ 1: [{ id: "a", label: "Only one", page: 12 }] });
		await removeBookmark(1, "a");
		expect(store[BOOKMARKS_SETTING]).toEqual({});
	});

	it("renames one mark and leaves its place alone", async () => {
		const row = await addBookmark(1, { label: "Untitled", page: 91, hash: "page=91&zoom=100,0,412" });
		await renameBookmark(1, row.id, "The Blessed's moves");
		expect(bookmarksFor(1)[0]).toMatchObject({
			label: "The Blessed's moves", page: 91, hash: "page=91&zoom=100,0,412",
		});
	});

	it("says nothing was removed when the mark is not there", async () => {
		await addBookmark(1, { label: "Kept", page: 91, hash: "page=91" });
		expect(await removeBookmark(1, "no-such-id")).toBe(false);
		expect(bookmarksFor(1)).toHaveLength(1);
	});

	it("does not report a mark that could not be saved", async () => {
		game.settings = { get: () => ({}), set: vi.fn(async () => { throw new Error("refused"); }) };
		const warn = vi.fn();
		global.ui = { notifications: { warn } };
		expect(await addBookmark(1, { label: "Lost", page: 91, hash: "page=91" })).toBeNull();
		expect(warn).toHaveBeenCalled();
	});
});

describe("what a bookmark is called", () => {
	it("collapses a pasted passage onto one line and cuts it to a length a row can show", () => {
		const label = cleanLabel(`  Steadings\n\tand   Seasons ${"x".repeat(200)}  `);
		expect(label.startsWith("Steadings and Seasons ")).toBe(true);
		expect(label).toHaveLength(LABEL_MAX);
	});

	it("names both printed pages of a spread, not the sheet of the file", () => {
		// Book I's spreads edition is 308 sheets; sheet 91 prints pages 180 and 181.
		expect(pageNote(1, 91, 308)).toBe("pp. 180-181");
	});

	it("names one page on the first spread, since nothing is printed page zero", () => {
		expect(pageNote(1, 1, 308)).toBe("p. 1");
	});

	it("falls back to the sheet number when the file is not the spreads edition", () => {
		expect(pageNote(1, 91, 617)).toBe("Sheet 91 of the file");
	});

	it("has nothing to say about a page that is not one", () => {
		expect(pageNote(1, 0, 308)).toBe("");
	});
});
