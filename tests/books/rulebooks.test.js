import { describe, it, expect, afterEach } from "vitest";
import { readRepo as read } from "../fakes/css.js";
import {
	RULEBOOKS, RULEBOOKS_SETTING, rulebook, rulebookPaths, rulebookPath, hasRulebook,
	saveRulebookPath, rulebookViewerUrl, isSpreadsEdition, spreadPageFor,
} from "../../module/books/rulebooks.js";
import { BASIC_GM_MOVES, EXPLORATION_GM_MOVES, HOMEFRONT_GM_MOVES } from "../../module/gm-toolkit/gm-moves.js";

// Your own copy of the rulebooks: the POINTER, and the URL that hands it to Foundry's own
// bundled pdf.js reader. Nothing here reads a PDF, and the tests that matter most are about the
// two things that fail silently: a URL that loses half a path with a space in it, and page
// arithmetic that lands sixty pages away and reads as a bad citation rather than bad maths.

/** A stand-in for `game.settings` over one in-memory record. */
function withSettings(initial = {}) {
	const store = new Map([[RULEBOOKS_SETTING, initial]]);
	game.settings = {
		get: (_scope, key) => store.get(key),
		set: (_scope, key, value) => { store.set(key, value); return Promise.resolve(value); },
	};
	return store;
}

describe("the rulebooks a world can be pointed at", () => {
	afterEach(() => { delete game.settings; });

	it("offers Book I and Book II, numbered the way citations cite them", () => {
		expect(RULEBOOKS.map(b => b.book)).toEqual([1, 2]);
		expect(RULEBOOKS.map(b => b.numeral)).toEqual(["I", "II"]);
	});

	// The whole point of numbering the table the way `bookPageRef` does is that a page citation
	// on the GM Toolkit and a file on disk can be talked about in the same terms. If the moves
	// ever cite a book this table has no row for, a page link would have nowhere to go.
	it("has a row for every book the GM moves cite", () => {
		const cited = new Set([...BASIC_GM_MOVES, ...EXPLORATION_GM_MOVES, ...HOMEFRONT_GM_MOVES]
			.filter(move => move.page)
			.map(move => move.book ?? 1));
		const known = new Set(RULEBOOKS.map(b => b.book));
		// Book 3 is the free GM playbook, which is art rather than a book anyone reads here.
		for (const book of cited) if (book !== 3) expect(known.has(book)).toBe(true);
	});

	it("gives each book a distinct glyph", () => {
		const icons = RULEBOOKS.map(b => b.icon);
		expect(new Set(icons).size).toBe(icons.length);
	});

	it("answers nothing at all when the setting is not registered", () => {
		expect(rulebookPaths()).toEqual({});
		expect(rulebookPath(1)).toBe("");
		expect(hasRulebook(1)).toBe(false);
	});

	it("reads back a recorded path", () => {
		withSettings({ 1: "stonetop-books/book-one.pdf" });
		expect(rulebookPath(1)).toBe("stonetop-books/book-one.pdf");
		expect(hasRulebook(1)).toBe(true);
		expect(hasRulebook(2)).toBe(false);
	});

	it("records one book without disturbing the other", async () => {
		const store = withSettings({ 1: "a.pdf" });
		await saveRulebookPath(2, "b.pdf");
		expect(store.get(RULEBOOKS_SETTING)).toEqual({ 1: "a.pdf", 2: "b.pdf" });
	});

	// A forgotten book has to leave no row behind. An empty string left in place is a second
	// kind of "no book", and only one of the two dims the header icon.
	it("removes the row when a book is forgotten rather than blanking it", async () => {
		const store = withSettings({ 1: "a.pdf", 2: "b.pdf" });
		await saveRulebookPath(2, "");
		expect(store.get(RULEBOOKS_SETTING)).toEqual({ 1: "a.pdf" });
		expect(hasRulebook(2)).toBe(false);
	});

	it("does not treat a whitespace path as a book", async () => {
		const store = withSettings({});
		await saveRulebookPath(1, "   ");
		expect(store.get(RULEBOOKS_SETTING)).toEqual({});
	});

	it("looks a book up by its number, and answers null for one it has no row for", () => {
		expect(rulebook(2)?.numeral).toBe("II");
		expect(rulebook(9)).toBe(null);
	});
});

describe("the viewer URL", () => {
	it("is empty for a book that has no file, so a caller can build it unconditionally", () => {
		expect(rulebookViewerUrl("")).toBe("");
		expect(rulebookViewerUrl(null)).toBe("");
	});

	it("points at the pdf.js viewer Foundry bundles", () => {
		expect(rulebookViewerUrl("books/a.pdf")).toContain("scripts/pdfjs/web/viewer.html");
	});

	// The failure this exists to prevent: a book saved under its shop filename has spaces and an
	// ampersand in it, and an unescaped one truncates the parameter. The viewer then opens
	// empty, with no error naming the path as the cause.
	it("escapes a path with spaces and an ampersand in it", () => {
		const url = rulebookViewerUrl("books/Book I & II (spreads).pdf");
		expect(url).not.toMatch(/file=[^&#]*\s/);
		expect(url.split("?")[1].split("#")[0]).toBe(
			"file=%2Fbooks%2FBook+I+%26+II+%28spreads%29.pdf");
	});

	it("leaves an absolute URL alone rather than resolving it as a data path", () => {
		const url = rulebookViewerUrl("https://example.test/book.pdf");
		expect(url).toContain(encodeURIComponent("https://example.test/book.pdf"));
	});

	// Query and hash are not interchangeable: the query says what to LOAD, the hash says what to
	// do once loaded. A page put in the query is ignored, silently.
	it("puts an opening page in the hash, not the query", () => {
		const url = rulebookViewerUrl("books/a.pdf", { page: 91 });
		expect(url).toMatch(/#page=91$/);
	});

	it("ignores a page that is not one", () => {
		expect(rulebookViewerUrl("books/a.pdf", { page: 0 })).not.toContain("#");
		expect(rulebookViewerUrl("books/a.pdf", { page: "later" })).not.toContain("#");
	});

	// `phrase=true` matters on a book this size: without it a two-word search matches every page
	// carrying both words anywhere, which on 300 pages is most of them.
	it("runs a search as a phrase", () => {
		const url = rulebookViewerUrl("books/a.pdf", { search: "defy danger" });
		expect(url).toContain("search=defy%20danger");
		expect(url).toContain("phrase=true");
	});
});

describe("printed pages and pages of the file", () => {
	// A spread prints 2p-2 on the left and 2p-1 on the right, so a printed page and its facing
	// page share one sheet and the next even page starts the next one. Same mapping the art
	// importer's manifest was measured with.
	it("puts a printed page and the one facing it on the same spread", () => {
		expect(spreadPageFor(180)).toBe(91);
		expect(spreadPageFor(181)).toBe(91);
		expect(spreadPageFor(182)).toBe(92);
	});

	it("agrees with the page the art manifest was measured at", () => {
		expect(spreadPageFor(412)).toBe(207);
	});

	// THE ARITHMETIC, CHECKED AGAINST MEASUREMENT RATHER THAN AGAINST ITSELF.
	//
	// Every example above is a number this file chose, which means all four of them would still
	// pass if the mapping were off by a constant. The shipped art importer carries the only
	// independent record of the answer there is: 348 illustrations, each one cut out of a page of
	// a real spreads PDF by hand, each row naming BOTH the sheet it was cut from (`pdfPage`) and
	// the page number printed on it (`printed`). Somebody looked at both of those, for every row,
	// on both books.
	//
	// So this is the test that would catch a page citation quietly landing on the wrong sheet,
	// which is a failure with nothing to see: the book opens, a page appears, and it is simply
	// not the page that was cited.
	it("lands on the sheet the art importer measured, for every illustration in the manifest", () => {
		const macro = JSON.parse(read("packs/src/stonetop-macros/import-book2-art.json")).command;
		// Off the shipped macro's own source, because that is where the measured table lives; a
		// copy of it here would be a copy of the thing under test.
		const rows = [...macro.matchAll(/\{[^{}]*?"pdfPage"[^{}]*?\}/g)]
			.map(m => m[0])
			.map(row => ({
				pdf:     Number(row.match(/"pdfPage":(\d+)/)?.[1]),
				printed: Number(row.match(/"printed":(\d+)/)?.[1]),
				// The rows say `book` only when it is not Book I, exactly as a citation does.
				book:    Number(row.match(/"book":(\d+)/)?.[1] ?? 1),
			}))
			.filter(row => row.pdf > 0 && row.printed > 0);

		// A guard on the reading, not on the mapping: a regex that stopped matching would leave
		// this suite passing on nothing at all.
		expect(rows.length).toBeGreaterThan(300);
		expect(rows.some(r => r.book === 2)).toBe(true);

		const wrong = rows.filter(r => spreadPageFor(r.printed) !== r.pdf);
		expect(wrong).toEqual([]);
	});

	it("has no answer for something that is not a page", () => {
		expect(spreadPageFor(0)).toBe(null);
		expect(spreadPageFor("front")).toBe(null);
	});

	// Only a file with the spreads edition's own page count licenses that arithmetic. A GM who
	// owns the 1-up edition reads perfectly well; it is only a JUMP that would land wrong.
	it("recognises the spreads edition by its page count, per book", () => {
		expect(isSpreadsEdition(1, 308)).toBe(true);
		expect(isSpreadsEdition(2, 302)).toBe(true);
		expect(isSpreadsEdition(1, 302)).toBe(false);
		expect(isSpreadsEdition(1, 160)).toBe(false);
		expect(isSpreadsEdition(9, 308)).toBe(false);
	});
});
