import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readRepo as read } from "../fakes/css.js";

vi.mock("../../module/books/BookReaderWindow.js", () => ({ openBookReader: vi.fn(() => ({})) }));

import {
	markBookReaderClosed, markBookReaderOpen, openBookReaderRecord, reopenOpenBookReaders,
} from "../../module/books/reader-resume.js";
import { openBookReader } from "../../module/books/BookReaderWindow.js";

const SETTING = "bookReaderResume";
const WORLD = "stonetop-world";

// A book left open when the browser reloads comes back. The evidence is the record itself: a
// reload never runs an Application's `close`, so anything still listed was open when the page
// went away. Same shape and same reasoning as the GM walkthroughs' resume record.

let store;

beforeEach(() => {
	store = {};
	game.world = { id: WORLD };
	game.settings = {
		get: (_scope, key) => (key === SETTING ? store : undefined),
		set: (_scope, key, value) => { if (key === SETTING) store = value; return Promise.resolve(value); },
	};
	vi.clearAllMocks();
	// clearAllMocks drops recorded CALLS but keeps implementations, so a test that makes the
	// opener refuse a book has to be undone here or the next one inherits it.
	openBookReader.mockImplementation(() => ({}));
});

afterEach(() => { delete game.settings; delete game.world; });

describe("what the record holds", () => {
	it("starts empty and reads back what was written", async () => {
		expect(openBookReaderRecord()).toEqual([]);
		await markBookReaderOpen(1);
		expect(openBookReaderRecord()).toEqual([1]);
	});

	it("keeps the books in a stable order however they were opened", async () => {
		await markBookReaderOpen(2);
		await markBookReaderOpen(1);
		expect(openBookReaderRecord()).toEqual([1, 2]);
	});

	// Called from `activateListeners`, which runs on every render, and an Application re-renders
	// for reasons that have nothing to do with a window appearing.
	it("does not write again for a book already recorded", async () => {
		await markBookReaderOpen(1);
		const setting = game.settings.set;
		game.settings.set = vi.fn(setting);
		markBookReaderOpen(1);
		expect(game.settings.set).not.toHaveBeenCalled();
		game.settings.set = setting;
	});

	// THE WHOLE MECHANISM: a reader who actually closes a book does not get it back, and a
	// browser reload never reaches `close`, so the two states are distinguishable.
	it("forgets a book that was closed", async () => {
		await markBookReaderOpen(1);
		await markBookReaderOpen(2);
		await markBookReaderClosed(1);
		expect(openBookReaderRecord()).toEqual([2]);
	});

	it("leaves nothing behind once the last book is closed", async () => {
		await markBookReaderOpen(1);
		await markBookReaderClosed(1);
		expect(store[WORLD]).toBeUndefined();
	});

	// The setting is CLIENT-scoped, so one blob follows this browser into every world it opens.
	// Without the world key a book left open in one campaign would open in an unrelated one.
	it("keeps each world's windows to itself", async () => {
		await markBookReaderOpen(1);
		game.world = { id: "another-world" };
		expect(openBookReaderRecord()).toEqual([]);
		await markBookReaderOpen(2);
		expect(store[WORLD]).toEqual([1]);
		expect(store["another-world"]).toEqual([2]);
	});
});

describe("bringing them back", () => {
	it("does nothing at all when nothing was open", async () => {
		await reopenOpenBookReaders();
		expect(openBookReader).not.toHaveBeenCalled();
	});

	// No page: pdf.js keeps its own view history and restores the exact scroll and zoom the
	// reader left, which is more than a page number could say. Passing one would override it.
	it("reopens each recorded book, at no page in particular", async () => {
		await markBookReaderOpen(1);
		await markBookReaderOpen(2);
		await reopenOpenBookReaders();
		expect(openBookReader.mock.calls).toEqual([[1], [2]]);
	});

	it("brings back only what was open", async () => {
		await markBookReaderOpen(2);
		await reopenOpenBookReaders();
		expect(openBookReader.mock.calls).toEqual([[2]]);
	});

	// A record that cannot be honoured would otherwise be attempted on every single load.
	it("drops a book this world no longer has a copy of", async () => {
		await markBookReaderOpen(1);
		await markBookReaderOpen(2);
		openBookReader.mockImplementation(book => (book === 2 ? {} : null));
		await reopenOpenBookReaders();
		expect(openBookReaderRecord()).toEqual([2]);
	});

	// An ordinary load, where everything came back, must not also be a settings write.
	it("does not rewrite the record when every book came back", async () => {
		await markBookReaderOpen(1);
		const setting = game.settings.set;
		game.settings.set = vi.fn(setting);
		await reopenOpenBookReaders();
		expect(game.settings.set).not.toHaveBeenCalled();
		game.settings.set = setting;
	});
});

describe("how it is wired", () => {
	const WINDOW_JS = read("module/books/BookReaderWindow.js");

	it("records on render and forgets on close", () => {
		expect(WINDOW_JS).toMatch(/activateListeners\(html\)[\s\S]{0,400}markBookReaderOpen\(this\._book\)/);
		expect(WINDOW_JS).toMatch(/async close\(options\)[\s\S]{0,400}markBookReaderClosed\(this\._book\)/);
	});

	it("is replayed from the ready hook", () => {
		const ready = read("module/hooks/Ready.js");
		expect(ready).toContain("reopenOpenBookReaders");
		expect(ready).toContain('from "../books/reader-resume.js"');
	});

	it("registers the client-scoped setting it stores in", () => {
		const settings = read("module/settings.js");
		expect(settings).toMatch(/"bookReaderResume",\s*\{[\s\S]{0,120}scope: "client"/);
	});

	// The window writes the record and the record reopens the window, so one direction has to be
	// a dynamic import or the two form a static cycle.
	it("reaches the window without a static cycle", () => {
		const resume = read("module/books/reader-resume.js");
		expect(resume).not.toMatch(/^import .*BookReaderWindow/m);
		expect(resume).toContain('await import("./BookReaderWindow.js")');
	});
});
