import { describe, it, expect, afterEach } from "vitest";
import { readRepo as read, readCss, repoFileExists } from "../fakes/css.js";
import { RulebooksDialog } from "../../module/books/RulebooksDialog.js";
import { BookReaderWindow, bookReaderWindowId } from "../../module/books/BookReaderWindow.js";
import { RULEBOOKS_SETTING } from "../../module/books/rulebooks.js";

const READER_HBS = "templates/dialogs/book-reader.hbs";
const SETUP_HBS  = "templates/dialogs/rulebooks.hbs";
const CSS = readCss();

function withBooks(paths = {}) {
	game.settings = { get: (_scope, key) => (key === RULEBOOKS_SETTING ? paths : undefined) };
}

describe("the reader window", () => {
	afterEach(() => { delete game.settings; delete global.user; });

	it("names a template that is actually there", () => {
		expect(repoFileExists(READER_HBS)).toBe(true);
	});

	// A window with no "stonetop" class keeps its own rules and loses the system's CHROME, which
	// reads as half-styled rather than unstyled and so gets lived with.
	it("wears the system's chrome and can be resized", () => {
		const options = BookReaderWindow.defaultOptions;
		expect(options.classes).toContain("stonetop");
		expect(options.resizable).toBe(true);
	});

	// Reading Book II beside Book I is the ordinary case, and a shared id would paint the second
	// into the first's frame (AppV1 resolves `element` by id), so the id is per book.
	it("has a window id per book, so both books can be read at once", () => {
		expect(bookReaderWindowId(1)).not.toBe(bookReaderWindowId(2));
	});

	// Two places name that window: the constructor registers it and `openBookReader` looks for
	// one already open. If they ever spell it differently, clicking Book I opens a second Book I
	// every time and nothing throws, so the spelling is pinned to the one function.
	it("looks for an open book by the same id it registers", () => {
		const src = read("module/books/BookReaderWindow.js");
		expect(src).toContain("openOrFocus(bookReaderWindowId(book)");
		expect(src.match(/"stonetop-book-reader"/g)).toHaveLength(1);
	});

	it("titles itself with the book it is showing", () => {
		withBooks({ 1: "books/one.pdf" });
		expect(new BookReaderWindow({ book: 1 }).title).toBe("Book I: Stonetop");
	});

	it("hands the frame the viewer URL for this world's copy, at the page asked for", () => {
		withBooks({ 1: "books/one.pdf" });
		const { src } = new BookReaderWindow({ book: 1, page: 91 }).getData();
		expect(src).toContain("scripts/pdfjs/web/viewer.html");
		expect(src).toMatch(/#page=91$/);
	});

	// The frame is the window. Anything that stops it filling the content box shows as the
	// viewer's own grey mat framed in parchment, which reads as a rendering fault.
	it("is drawn as a single frame filling the window", () => {
		const markup = read(READER_HBS).replace(/\{\{!--[\s\S]*?--\}\}/g, "").trim();
		expect(markup.match(/<div/g)).toHaveLength(1);
		expect(markup).toContain("stonetop-book-reader-frame");
		expect(CSS).toContain(".stonetop.stonetop-book-reader-window .window-content");
		expect(CSS).toContain(".stonetop-book-reader-frame");
	});
});

describe("the rulebooks window", () => {
	afterEach(() => { delete game.settings; delete global.game.user; });

	it("names a template that is actually there, and wears the system's chrome", () => {
		expect(repoFileExists(SETUP_HBS)).toBe(true);
		expect(RulebooksDialog.defaultOptions.classes).toContain("stonetop");
		expect(RulebooksDialog.defaultOptions.resizable).toBe(true);
	});

	it("offers a row per book, showing the file when there is one", () => {
		withBooks({ 1: "stonetop-books/one.pdf" });
		global.game.user = { isGM: true };
		const { rows, canBrowse } = new RulebooksDialog().getData();
		expect(canBrowse).toBe(true);
		expect(rows.map(r => r.book)).toEqual([1, 2]);
		expect(rows[0].path).toBe("stonetop-books/one.pdf");
		expect(rows[0].title).toBe("Book I: Stonetop");
		expect(rows[1].path).toBe("");
		// A book with no file still says what to look for, rather than showing a blank line.
		expect(rows[1].hint).toContain("302");
	});

	it("cannot browse for an account that has no file permission", () => {
		withBooks({});
		global.game.user = { isGM: false, can: () => false };
		expect(new RulebooksDialog().getData().canBrowse).toBe(false);
	});

	it("draws Read and Forget only for a book it actually has", async () => {
		const html = await renderTemplate(`systems/stonetop-pwd/${SETUP_HBS}`, {
			canBrowse: true,
			rows: [
				{ book: 1, icon: "fas fa-book", title: "Book I", path: "books/one.pdf", hint: "" },
				{ book: 2, icon: "fas fa-book-atlas", title: "Book II", path: "", hint: "Find it" },
			],
		});
		expect(html).toContain('data-action="read" data-book="1"');
		expect(html).not.toContain('data-action="read" data-book="2"');
		expect(html).not.toContain('data-action="forget" data-book="2"');
		// Both books can always be pointed at something, set or not.
		expect(html).toContain('data-action="browse" data-book="1"');
		expect(html).toContain('data-action="browse" data-book="2"');
		// The unset row is marked so it can read as an empty slot.
		expect(html).toContain("stonetop-rulebook--unset");
	});

	it("disables browsing rather than hiding it when the account cannot", async () => {
		const html = await renderTemplate(`systems/stonetop-pwd/${SETUP_HBS}`, {
			canBrowse: false,
			rows: [{ book: 1, icon: "fas fa-book", title: "Book I", path: "", hint: "Find it" }],
		});
		expect(html).toContain('data-action="browse"');
		expect(html).toContain("disabled");
	});

	// The lone action button in a modal footer runs full width with a centred label.
	it("gives its one button the full width", () => {
		expect(CSS).toContain(".stonetop-rulebooks-dialog .stonetop-rulebooks-done");
	});

	// Copying a book into the world's data is what makes it fetchable, and that is worth saying
	// where it is being asked for rather than leaving to be discovered.
	it("says what copying a book into the world means", () => {
		// Whitespace-flattened: the copy is prose in a template and wraps wherever it wraps.
		const markup = read(SETUP_HBS).replace(/\s+/g, " ");
		expect(markup).toMatch(/copies it into this world/i);
		expect(markup).toMatch(/anyone signed in to this world who knows its address/i);
	});

	// The two doors, and which is which. The OS dialog is the ordinary one; the FilePicker is
	// for a book already on the server. A row that offered only the second is what prompted this.
	it("offers the computer's own file dialog as well as a browse of this world", async () => {
		const html = await renderTemplate(`systems/stonetop-pwd/${SETUP_HBS}`, {
			canStore: true, canBrowse: true, dir: "stonetop-books",
			rows: [{ book: 1, icon: "fas fa-book", title: "Book I", path: "", hint: "Find it" }],
		});
		expect(html).toContain('data-action="choose" data-book="1"');
		expect(html).toContain('data-action="browse" data-book="1"');
		// The input the choose button clicks: only that element can open the OS dialog.
		expect(html).toMatch(/<input type="file"[^>]*accept="application\/pdf/);
	});

	// Separate rights, asked separately: a world can grant one without the other.
	it("disables the two doors independently", async () => {
		const draw = (perms) => renderTemplate(`systems/stonetop-pwd/${SETUP_HBS}`, {
			...perms, dir: "stonetop-books",
			rows: [{ book: 1, icon: "fas fa-book", title: "Book I", path: "", hint: "Find it" }],
		});
		const noStore = await draw({ canStore: false, canBrowse: true });
		expect(noStore).toMatch(/stonetop-rulebook-choose[\s\S]{0,120}disabled/);
		expect(noStore).not.toMatch(/data-action="browse"[\s\S]{0,120}disabled/);

		const noBrowse = await draw({ canStore: true, canBrowse: false });
		expect(noBrowse).toMatch(/data-action="browse"[\s\S]{0,120}disabled/);
		expect(noBrowse).not.toMatch(/stonetop-rulebook-choose[\s\S]{0,120}disabled/);
	});
});
