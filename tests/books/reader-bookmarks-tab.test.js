import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	mountBookmarksTab, BOOKMARKS_BUTTON_ID, BOOKMARKS_VIEW_ID, BOOKMARKS_STYLE_ID,
} from "../../module/books/reader-bookmarks-tab.js";
import { BOOKMARKS_SETTING, bookmarksFor } from "../../module/books/book-bookmarks.js";
import { viewerDocument, viewerApp, NATIVE_SIDEBAR_TABS } from "../fakes/frame-dom.js";

const BOOK = 1;

function withBookmarks(stored = {}) {
	const store = { [BOOKMARKS_SETTING]: structuredClone(stored) };
	game.settings = {
		get: (_scope, key) => store[key],
		set: vi.fn(async (_scope, key, value) => { store[key] = structuredClone(value); return value; }),
	};
	return store;
}

/** The whole thing stood up: a frame around a viewer document, and a tab mounted in it. */
function mounted({ doc = viewerDocument(), app = viewerApp() } = {}) {
	const tab = mountBookmarksTab({ contentDocument: doc }, { book: BOOK, app });
	return { doc, app, tab };
}

const button = doc => doc.getElementById(BOOKMARKS_BUTTON_ID);
const view = doc => doc.getElementById(BOOKMARKS_VIEW_ID);
const rows = doc => view(doc).byClass("stonetopBookmarkRow");
const addButton = doc => view(doc).byClass("stonetopBookmarkAdd")[0];

beforeEach(() => { withBookmarks(); });

describe("the bookmarks tab in the viewer's sidebar", () => {
	it("sits straight after the Document Outline", () => {
		const { doc } = mounted();
		const ids = doc.getElementById("sidebarViewButtons").children.map(el => el.id);
		expect(ids).toEqual(["viewThumbnail", "viewOutline", BOOKMARKS_BUTTON_ID, "viewAttachments", "viewLayers"]);
	});

	it("goes last when the viewer has no attachments button to sit in front of", () => {
		const doc = viewerDocument({ omit: ["viewAttachments"] });
		mountBookmarksTab({ contentDocument: doc }, { book: BOOK, app: viewerApp() });
		const ids = doc.getElementById("sidebarViewButtons").children.map(el => el.id);
		expect(ids[ids.length - 1]).toBe(BOOKMARKS_BUTTON_ID);
	});

	it("joins pdf.js's radio group rather than sitting beside it as a loose button", () => {
		const { doc } = mounted();
		expect(button(doc).getAttribute("role")).toBe("radio");
		expect(button(doc).getAttribute("aria-checked")).toBe("false");
		expect(button(doc).getAttribute("aria-controls")).toBe(BOOKMARKS_VIEW_ID);
		expect(button(doc).classes).toContain("toolbarButton");
		expect(button(doc).title).toBe("Your bookmarks");
	});

	it("puts its panel in the sidebar's own content, hidden until it is asked for", () => {
		const { doc } = mounted();
		expect(view(doc).parent.id).toBe("sidebarContent");
		expect(view(doc).classes).toContain("hidden");
		// The viewer's own tree styling, so the list reads as the outline's neighbour.
		expect(view(doc).classes).toContain("treeView");
	});

	it("writes its icon and its rules into the frame's own document, once", () => {
		const { doc, app } = mounted();
		const styles = doc.head.children.filter(el => el.id === BOOKMARKS_STYLE_ID);
		expect(styles).toHaveLength(1);
		expect(styles[0].textContent).toContain(`#${BOOKMARKS_BUTTON_ID}::before`);
		// A second mount into a frame that never reloaded must not double anything up.
		expect(mountBookmarksTab({ contentDocument: doc }, { book: BOOK, app })).toBeNull();
		expect(doc.head.children.filter(el => el.id === BOOKMARKS_STYLE_ID)).toHaveLength(1);
	});

	it("leaves the reader a working book when the sidebar is not the shape it expects", () => {
		for (const missing of ["sidebarViewButtons", "sidebarContent"]) {
			const doc = viewerDocument({ omit: [missing] });
			expect(mountBookmarksTab({ contentDocument: doc }, { book: BOOK, app: viewerApp() })).toBeNull();
		}
	});
});

describe("switching to it and away from it", () => {
	it("takes the sidebar off pdf.js's own view and opens it if it was shut", async () => {
		const { doc, app } = mounted();
		await button(doc).click();

		expect(app.pdfSidebar.open).toHaveBeenCalled();
		expect(button(doc).getAttribute("aria-checked")).toBe("true");
		expect(view(doc).classes).not.toContain("hidden");
		for (const [nativeButton, nativeView] of NATIVE_SIDEBAR_TABS) {
			expect(doc.getElementById(nativeButton).classes).not.toContain("toggled");
			expect(doc.getElementById(nativeView).classes).toContain("hidden");
		}
	});

	it("parks pdf.js's own view at NONE, so its next tab click still counts as a change", async () => {
		const { doc, app } = mounted();
		await button(doc).click();
		expect(app.pdfSidebar.active).toBe(0);
	});

	it("stops showing when the reader picks one of pdf.js's tabs", async () => {
		const { doc, app } = mounted();
		await button(doc).click();
		app.eventBus.dispatch("sidebarviewchanged", { view: 2 });
		expect(view(doc).classes).toContain("hidden");
		expect(button(doc).getAttribute("aria-checked")).toBe("false");
	});

	it("stays put when the sidebar is merely closed, so it is what comes back", async () => {
		const { doc, app } = mounted();
		await button(doc).click();
		app.eventBus.dispatch("sidebarviewchanged", { view: 0 });
		expect(view(doc).classes).not.toContain("hidden");
	});

	it("lets go of the frame's event bus when the window closes", async () => {
		const { app, tab } = mounted();
		expect(app.eventBus.listenerCount("sidebarviewchanged")).toBe(1);
		tab.destroy();
		expect(app.eventBus.listenerCount("sidebarviewchanged")).toBe(0);
	});
});

describe("the list itself", () => {
	it("says what the tab is for while it is empty", () => {
		const { doc } = mounted();
		expect(view(doc).byClass("stonetopBookmarkEmpty")[0].textContent).toContain("No bookmarks yet");
		expect(rows(doc)).toHaveLength(0);
	});

	it("lists what is stored, in reading order, named by their printed pages", () => {
		withBookmarks({ 1: [
			{ id: "b", label: "", page: 120, hash: "page=120" },
			{ id: "a", label: "", page: 91, hash: "page=91" },
		] });
		const { doc } = mounted();
		expect(rows(doc).map(row => row.text().trim())).toEqual(["pp. 180-181", "pp. 238-239"]);
	});

	it("prints the pages under a name rather than twice", () => {
		withBookmarks({ 1: [{ id: "a", label: "The Blessed's moves", page: 91, hash: "page=91" }] });
		const { doc } = mounted();
		const row = rows(doc)[0];
		expect(row.find(el => el.tagName === "A").textContent).toBe("The Blessed's moves");
		expect(row.byClass("stonetopBookmarkPage")[0].textContent).toBe("pp. 180-181");
	});

	it("goes back to the exact view a mark was made at", async () => {
		withBookmarks({ 1: [{ id: "a", label: "There", page: 91, hash: "page=91&zoom=100,0,412" }] });
		const { doc, app } = mounted();
		await rows(doc)[0].find(el => el.tagName === "A").click();
		expect(app.pdfLinkService.setHash).toHaveBeenCalledWith("page=91&zoom=100,0,412");
	});

	it("still lands on the page when the anchor is one an older build wrote", async () => {
		withBookmarks({ 1: [{ id: "a", label: "There", page: 91, hash: "" }] });
		const { doc, app } = mounted();
		await rows(doc)[0].find(el => el.tagName === "A").click();
		expect(app.pdfLinkService.setHash).not.toHaveBeenCalled();
		expect(app.page).toBe(91);
	});
});

describe("marking the page you are on", () => {
	it("keeps the whole view, not the page the book opened at", async () => {
		const { doc } = mounted();
		await addButton(doc).click();
		expect(bookmarksFor(BOOK)[0]).toMatchObject({ page: 91, hash: "page=91&zoom=100,0,412" });
	});

	it("names it after the book's own heading for that page", async () => {
		const { doc } = mounted({ app: viewerApp({ outline: fakeOutline() }) });
		await addButton(doc).click();
		expect(bookmarksFor(BOOK)[0].label).toBe("Steadings & Seasons");
	});

	it("leaves it unnamed, to be called by its pages, when the book has no outline", async () => {
		const { doc, tab } = mounted();
		await addButton(doc).click();
		expect(bookmarksFor(BOOK)[0].label).toBe("");
		// Out of the rename the mark was born into, which is where the list is read from.
		tab.refresh();
		expect(rows(doc)[0].text().trim()).toBe("pp. 180-181");
	});

	it("opens the new mark for naming, with the suggested name selected", async () => {
		const { doc } = mounted({ app: viewerApp({ outline: fakeOutline() }) });
		await addButton(doc).click();
		const input = rows(doc)[0].byClass("stonetopBookmarkInput")[0];
		expect(input.value).toBe("Steadings & Seasons");
		expect(input.focused).toBe(true);
		expect(input.selected).toBe(true);
	});

	it("offers the pages as a placeholder, so agreeing to them leaves the mark unnamed", async () => {
		const { doc, tab } = mounted();
		await addButton(doc).click();
		const input = rows(doc)[0].byClass("stonetopBookmarkInput")[0];
		expect(input.value).toBe("");
		expect(input.placeholder).toBe("pp. 180-181");
		await input.emit("keydown", { key: "Enter" });
		expect(bookmarksFor(BOOK)[0].label).toBe("");
		tab.refresh();
		// Named by its pages, and printed once rather than as both the name and the note.
		expect(rows(doc)[0].text().trim()).toBe("pp. 180-181");
	});

	it("says so rather than marking page one when the viewer has not settled yet", async () => {
		const warn = vi.fn();
		global.ui = { notifications: { warn } };
		const app = viewerApp({ params: null });
		app.page = 0;
		const { doc } = mounted({ app });
		await addButton(doc).click();
		expect(warn).toHaveBeenCalled();
		expect(bookmarksFor(BOOK)).toHaveLength(0);
	});

	it("falls back to the page alone when the viewer has not scrolled yet", async () => {
		const { doc } = mounted({ app: viewerApp({ params: null }) });
		await addButton(doc).click();
		expect(bookmarksFor(BOOK)[0]).toMatchObject({ page: 91, hash: "page=91" });
	});

	// pdf.js answers `page` 1 in a viewer holding no document, so the count is what tells a book
	// still parsing apart from a reader on the first sheet. Asking `page` marked page 1 of a book
	// nobody had read a word of yet.
	it("says so rather than marking page one of a book that is still opening", async () => {
		const warn = vi.fn();
		global.ui = { notifications: { warn } };
		const { doc } = mounted({ app: viewerApp({ page: 1, params: null, pagesCount: 0 }) });
		await addButton(doc).click();
		expect(warn).toHaveBeenCalled();
		expect(bookmarksFor(BOOK)).toHaveLength(0);
	});

	// The first mark in a book waits on the document's outline, which is a promise per heading:
	// long enough on a rulebook to press the button again, and every press used to make another
	// mark on the same page.
	it("makes one mark however many times the button is pressed while it is working", async () => {
		const { doc } = mounted({ app: viewerApp({ outline: fakeOutline() }) });
		const first = addButton(doc).click();
		expect(addButton(doc).disabled).toBe(true);
		const second = addButton(doc).click();
		await Promise.all([first, second]);
		expect(bookmarksFor(BOOK)).toHaveLength(1);
		// And it is offered again once the mark is on the list.
		expect(addButton(doc).disabled).toBe(false);
	});
});

describe("naming and unnaming", () => {
	it("saves a new name on Enter", async () => {
		withBookmarks({ 1: [{ id: "a", label: "", page: 91, hash: "page=91" }] });
		const { doc } = mounted();
		await rows(doc)[0].byClass("stonetopBookmarkRename")[0].click();
		const input = rows(doc)[0].byClass("stonetopBookmarkInput")[0];
		input.value = "Where the goats are";
		await input.emit("keydown", { key: "Enter" });
		expect(bookmarksFor(BOOK)[0].label).toBe("Where the goats are");
	});

	it("saves it when the reader clicks back into the book instead of pressing Enter", async () => {
		withBookmarks({ 1: [{ id: "a", label: "", page: 91, hash: "page=91" }] });
		const { doc } = mounted();
		await rows(doc)[0].byClass("stonetopBookmarkRename")[0].click();
		const input = rows(doc)[0].byClass("stonetopBookmarkInput")[0];
		input.value = "Named on the way out";
		await input.emit("blur");
		expect(bookmarksFor(BOOK)[0].label).toBe("Named on the way out");
	});

	it("abandons it on Escape, and does not then save it on the way out", async () => {
		withBookmarks({ 1: [{ id: "a", label: "Kept", page: 91, hash: "page=91" }] });
		const { doc } = mounted();
		await rows(doc)[0].byClass("stonetopBookmarkRename")[0].click();
		const input = rows(doc)[0].byClass("stonetopBookmarkInput")[0];
		input.value = "Typed and thought better of";
		await input.emit("keydown", { key: "Escape" });
		await input.emit("blur");
		expect(bookmarksFor(BOOK)[0].label).toBe("Kept");
	});

	it("keeps a typed letter out of the viewer's own keyboard shortcuts", async () => {
		withBookmarks({ 1: [{ id: "a", label: "", page: 91, hash: "page=91" }] });
		const { doc } = mounted();
		await rows(doc)[0].byClass("stonetopBookmarkRename")[0].click();
		const typed = await rows(doc)[0].byClass("stonetopBookmarkInput")[0].emit("keydown", { key: "n" });
		expect(typed.propagationStopped).toBe(true);
	});

	// Blur commits, and one way to blur an input is to start renaming a DIFFERENT row: that click
	// has already repainted the panel with the other row's input in it. The commit's own repaint
	// then landed on top of a session that had been typed into, and the text in an input is
	// nowhere else yet.
	it("does not repaint over a rename the reader has already started on another row", async () => {
		withBookmarks({ 1: [
			{ id: "a", label: "", page: 91, hash: "page=91" },
			{ id: "b", label: "", page: 120, hash: "page=120" },
		] });
		const { doc } = mounted();
		await rows(doc)[0].byClass("stonetopBookmarkRename")[0].click();
		const first = rows(doc)[0].byClass("stonetopBookmarkInput")[0];
		first.value = "Named on the way past";
		// The pencil on the other row: this is the repaint that blurs the input above.
		await rows(doc)[1].byClass("stonetopBookmarkRename")[0].click();
		const second = rows(doc)[1].byClass("stonetopBookmarkInput")[0];
		second.value = "Being typed right now";
		await first.emit("blur");
		// The first row's name was still saved...
		expect(bookmarksFor(BOOK)[0].label).toBe("Named on the way past");
		// ...and the session that was open when it landed is the same input, still holding what
		// had been typed into it.
		expect(rows(doc)[1].byClass("stonetopBookmarkInput")[0]).toBe(second);
		expect(second.value).toBe("Being typed right now");
	});

	// Same hazard from the other side: a removal is a write, and its repaint has to wait too.
	it("does not repaint over a rename when another row is removed under it", async () => {
		withBookmarks({ 1: [
			{ id: "a", label: "Staying", page: 91, hash: "page=91" },
			{ id: "b", label: "Going", page: 120, hash: "page=120" },
		] });
		const { doc } = mounted();
		await rows(doc)[0].byClass("stonetopBookmarkRename")[0].click();
		const input = rows(doc)[0].byClass("stonetopBookmarkInput")[0];
		input.value = "Half typed";
		await rows(doc)[1].byClass("stonetopBookmarkDelete")[0].click();
		expect(bookmarksFor(BOOK).map(row => row.id)).toEqual(["a"]);
		expect(rows(doc)[0].byClass("stonetopBookmarkInput")[0]).toBe(input);
		expect(input.value).toBe("Half typed");
	});

	it("removes one mark and repaints without it", async () => {
		withBookmarks({ 1: [
			{ id: "a", label: "Going", page: 91, hash: "page=91" },
			{ id: "b", label: "Staying", page: 120, hash: "page=120" },
		] });
		const { doc } = mounted();
		await rows(doc)[0].byClass("stonetopBookmarkDelete")[0].click();
		expect(bookmarksFor(BOOK).map(row => row.label)).toEqual(["Staying"]);
		expect(rows(doc).map(row => row.find(el => el.tagName === "A").textContent)).toEqual(["Staying"]);
	});
});

/**
 * A document proxy with an outline, spelled the two ways a PDF spells a destination: a named one
 * the document resolves, and an explicit array whose first element is a page reference.
 */
function fakeOutline() {
	return {
		getOutline: async () => [
			{ title: "Chapter 5: Home", dest: "chapter5", items: [{ title: "Steadings & Seasons", dest: [{ num: 91 }, {}] }] },
			{ title: "Chapter 6: Away", dest: [{ num: 200 }, {}] },
		],
		getDestination: async name => (name === "chapter5" ? [{ num: 80 }, {}] : null),
		getPageIndex: async ref => ref.num - 1,
	};
}
