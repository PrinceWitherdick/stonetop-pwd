import { describe, it, expect, afterEach, vi } from "vitest";
import { readRepo as read, readCss, repoFileExists } from "../fakes/css.js";
import { RulebooksDialog } from "../../module/books/RulebooksDialog.js";
import { BookReaderWindow, bookReaderWindowId, zoomStepTarget } from "../../module/books/BookReaderWindow.js";
import { RULEBOOKS_SETTING } from "../../module/books/rulebooks.js";
import { BOOK_SOCKET, SHOW_BOOK } from "../../module/books/book-broadcast.js";

const READER_HBS = "templates/dialogs/book-reader.hbs";
const SETUP_HBS  = "templates/dialogs/rulebooks.hbs";
const CSS = readCss();

function withBooks(paths = {}) {
	game.settings = { get: (_scope, key) => (key === RULEBOOKS_SETTING ? paths : undefined) };
}

// A viewer stood in for the pdf.js one in the frame: the handful of members our window drives,
// and no more. `_accumulateTicks` is pdf.js's own running total, copied because the whole point
// of the wheel arithmetic is that it matches theirs.
function fakeViewer({ scale = 1, presentation = false, page = 91, pagesCount = 308 } = {}) {
	return {
		page,
		pagesCount,
		pdfViewer: { currentScale: scale, isInPresentationMode: presentation },
		_wheelUnusedTicks: 0,
		_accumulateTicks(ticks, prop) {
			this[prop] += ticks;
			const whole = Math.trunc(this[prop]);
			this[prop] -= whole;
			return whole;
		},
		zoomIn: vi.fn(),
		zoomOut: vi.fn(),
		_centerAtPos: vi.fn(),
	};
}

// The frame's own DOCUMENT, which is a different reach than its window. Enough of one to be
// handed a stylesheet and asked whether it already has one.
function fakeDoc() {
	const head = { children: [], append(node) { this.children.push(node); } };
	return {
		head,
		createElement: () => ({ id: "", textContent: "" }),
		getElementById: (id) => head.children.find(node => node.id === id) ?? null,
	};
}

// A frame stand-in: the viewer inside it, plus the listener members our wheel binding reaches
// for on the frame's own window.
function fakeFrame(app) {
	return {
		contentDocument: fakeDoc(),
		contentWindow: {
			PDFViewerApplication: app,
			addEventListener: vi.fn(), removeEventListener: vi.fn(),
		},
	};
}

function wheel(over = {}) {
	return {
		ctrlKey: false, metaKey: false, deltaY: 0, deltaMode: 0, clientX: 40, clientY: 60,
		preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over,
	};
}

describe("the reader window", () => {
	afterEach(() => {
		delete game.settings; delete global.user;
		delete game.user; delete game.users; delete game.socket;
	});

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

	// The reader is a window inside the game, and a control that navigates the browser away
	// from it is a control that loses the game. There is no way back from it but the header.
	it("offers nothing that leaves this window", () => {
		withBooks({ 1: "books/one.pdf" });
		game.user = { isGM: true };
		const classes = new BookReaderWindow({ book: 1 })._getHeaderButtons().map(b => b.class);
		expect(classes).not.toContain("stonetop-book-pop-out");
		expect(read("module/books/BookReaderWindow.js")).not.toContain("window?.open");
	});

	// Show Players opens a window on other people's screens, which is a GM's move to make.
	it("offers Show Players to a GM and not to a player", () => {
		withBooks({ 1: "books/one.pdf" });
		const classesFor = (isGM) => {
			game.user = { isGM };
			return new BookReaderWindow({ book: 1 })._getHeaderButtons().map(b => b.class);
		};
		// First of ours: it is the one a GM reaches for mid-session.
		expect(classesFor(true)[0]).toBe("stonetop-book-show-players");
		expect(classesFor(false)).not.toContain("stonetop-book-show-players");
		// The way back to the setup is everyone's, book or no book.
		expect(classesFor(false)).toContain("stonetop-book-settings");
	});

	// By the time a GM presses this they have read their way somewhere else, so the page has to
	// come off the LOADED viewer. Off the URL it would always be the page the book opened at.
	it("shows players the page being read, not the page the book opened at", () => {
		withBooks({ 1: "books/one.pdf" });
		game.user = { isGM: true, id: "gm" };
		game.socket = { emit: vi.fn() };
		const win = new BookReaderWindow({ book: 1, page: 5 });
		win._viewerApp = fakeViewer();
		win._showPlayers();
		expect(game.socket.emit).toHaveBeenCalledWith(BOOK_SOCKET, {
			action: SHOW_BOOK, book: 1, page: 91, userId: "gm",
		});
	});

	// A frame still loading has no page to send, and page one is not a good guess at one.
	it("says so rather than sending a page the book is not on yet", () => {
		withBooks({ 1: "books/one.pdf" });
		game.user = { isGM: true, id: "gm" };
		game.socket = { emit: vi.fn() };
		const warn = vi.fn();
		const notifications = global.ui.notifications;
		global.ui.notifications = { ...notifications, warn };
		try { new BookReaderWindow({ book: 1 })._showPlayers(); }
		finally { global.ui.notifications = notifications; }
		expect(game.socket.emit).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalled();
	});

	// A viewer object that exists but holds no document yet answers `page` 1, so asking it alone
	// could not tell that state from a reader on the first sheet -- and this is exactly the wait a
	// GM presses the button during. `pagesCount` is what knows.
	it("says so rather than sending page one out of a book that is still parsing", () => {
		withBooks({ 1: "books/one.pdf" });
		game.user = { isGM: true, id: "gm" };
		game.socket = { emit: vi.fn() };
		const warn = vi.fn();
		const notifications = global.ui.notifications;
		global.ui.notifications = { ...notifications, warn };
		const win = new BookReaderWindow({ book: 1 });
		win._viewerApp = fakeViewer({ page: 1, pagesCount: 0 });
		try { win._showPlayers(); }
		finally { global.ui.notifications = notifications; }
		expect(game.socket.emit).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalled();
	});

	// pdf.js has its own ctrl+wheel handler and it goes deaf for a second after every ordinary
	// scroll, which is exactly the order a reader does those two things in. Ours answers the
	// notch instead, and has to stop the event before the viewer's handler can answer it too.
	it("zooms on ctrl and the wheel, and keeps the event from the viewer's own handler", () => {
		withBooks({ 1: "books/one.pdf" });
		const win = new BookReaderWindow({ book: 1 });
		win._viewerApp = fakeViewer();

		const inward = wheel({ ctrlKey: true, deltaY: -120 });
		win._wheelZoom(inward);
		expect(inward.preventDefault).toHaveBeenCalled();
		expect(inward.stopPropagation).toHaveBeenCalled();
		// 100% to 110%: driven by factor, because pdf.js's own steps are a compounding ladder.
		expect(win._viewerApp.zoomIn).toHaveBeenCalledWith(null, 1.1);
		// What was under the pointer stays under it, or the paragraph being read slides away.
		expect(win._viewerApp._centerAtPos).toHaveBeenCalledWith(1, 40, 60);

		win._wheelZoom(wheel({ metaKey: true, deltaY: 120 }));
		expect(win._viewerApp.zoomOut).toHaveBeenCalledWith(null, 0.9);
	});

	// A mouse reports about a hundred pixels for one flick of the wheel, which pdf.js's own
	// arithmetic reads as three notches. Three steps a flick is how 100% became 170%.
	it("is one step a notch however far the notch measured", () => {
		withBooks({ 1: "books/one.pdf" });
		const win = new BookReaderWindow({ book: 1 });
		win._viewerApp = fakeViewer();
		for (const deltaY of [-40, -100, -240]) {
			win._viewerApp.pdfViewer.currentScale = 1;
			win._viewerApp.zoomIn.mockClear();
			win._wheelZoom(wheel({ ctrlKey: true, deltaY }));
			expect(win._viewerApp.zoomIn).toHaveBeenCalledWith(null, 1.1);
		}
	});

	// Scrolling the book is the ordinary gesture and it has to reach the viewer untouched.
	it("leaves a plain scroll entirely alone", () => {
		withBooks({ 1: "books/one.pdf" });
		const win = new BookReaderWindow({ book: 1 });
		win._viewerApp = fakeViewer();
		const evt = wheel({ deltaY: -120 });
		win._wheelZoom(evt);
		expect(evt.preventDefault).not.toHaveBeenCalled();
		expect(evt.stopPropagation).not.toHaveBeenCalled();
		expect(win._viewerApp.zoomIn).not.toHaveBeenCalled();
	});

	// A trackpad arrives as a stream of deltas far too small to be a notch each; without the
	// running total every one of them rounds away to nothing and the gesture does nothing.
	it("adds up a trackpad's small deltas into whole notches", () => {
		withBooks({ 1: "books/one.pdf" });
		const win = new BookReaderWindow({ book: 1 });
		win._viewerApp = fakeViewer();
		for (let i = 0; i < 3; i++) win._wheelZoom(wheel({ ctrlKey: true, deltaY: -10 }));
		expect(win._viewerApp.zoomIn).toHaveBeenCalledTimes(1);
		expect(win._viewerApp.zoomIn).toHaveBeenCalledWith(null, 1.1);
	});

	// The ladder a reader actually sees in the toolbar. pdf.js's own is 100, 110, 130, 150,
	// 170 -- it multiplies by 1.1 and then rounds UP onto a tenth, so it compounds away.
	it("climbs and falls in flat tens", () => {
		const ladder = (direction) => {
			let scale = 1;
			return Array.from({ length: 4 }, () => (scale = zoomStepTarget(scale, direction)));
		};
		expect(ladder(1)).toEqual([1.1, 1.2, 1.3, 1.4]);
		expect(ladder(-1)).toEqual([0.9, 0.8, 0.7, 0.6]);
	});

	// A book sitting at "fit page" is at some number like 0.63, and stepping from there would
	// make a grid of its own (0.73, 0.83) that no other control in the viewer shares.
	it("tidies an odd scale onto the grid on the way past", () => {
		expect(zoomStepTarget(0.63, 1)).toBe(0.7);
		expect(zoomStepTarget(0.63, -1)).toBe(0.6);
		// And a scale already ON the grid is not nudged off it by its own floating-point dust.
		expect(zoomStepTarget(1.3, 1)).toBe(1.4);
		expect(zoomStepTarget(0.7, -1)).toBe(0.6);
	});

	// The listener lives on the frame's window, so a reload (a new window object) must not
	// leave the old one bound and a close must leave nothing behind at all.
	it("binds the wheel to one frame window at a time and lets go on close", async () => {
		withBooks({ 1: "books/one.pdf" });
		const win = new BookReaderWindow({ book: 1 });
		const frameWindow = () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() });
		const first = frameWindow();
		win._bindWheelZoom(first);
		expect(first.addEventListener).toHaveBeenCalledWith("wheel", expect.any(Function),
			{ capture: true, passive: false });
		// Bound again with the same window: no second listener on it.
		win._bindWheelZoom(first);
		expect(first.addEventListener).toHaveBeenCalledTimes(1);

		const second = frameWindow();
		win._bindWheelZoom(second);
		expect(first.removeEventListener).toHaveBeenCalled();

		await win.close();
		expect(second.removeEventListener).toHaveBeenCalled();
	});

	// Left-drag moves the page. pdf.js's own hand tool, so a link in the book still clicks
	// through (GrabToPan leaves an `a[href]` alone) and the viewer's own menu offers text
	// selection back.
	it("hands the reader the page to drag once the viewer is up", async () => {
		withBooks({ 1: "books/one.pdf" });
		const win = new BookReaderWindow({ book: 1 });
		const switchTool = vi.fn();
		const app = {
			pdfCursorTools: { switchTool },
			pdfLinkService: {},
			pagesCount: 308,
			initializedPromise: Promise.resolve(),
		};
		win._onFrameLoad(fakeFrame(app));
		await app.initializedPromise;
		await Promise.resolve();
		// 1 is pdf.js's CursorTool.HAND.
		expect(switchTool).toHaveBeenCalledWith(1);
	});

	// The edition check runs off the same promise, and a viewer whose cursor tools are shaped
	// differently than we expect must not take it down: a book that pans the old way is a small
	// loss, a page citation landing 60 pages out with nothing to explain it is not.
	it("still checks the edition when the hand tool cannot be reached", async () => {
		withBooks({ 1: "books/one.pdf" });
		const win = new BookReaderWindow({ book: 1 });
		const app = {
			pdfCursorTools: { switchTool: () => { throw new Error("no such tool"); } },
			pagesCount: 12,
			initializedPromise: Promise.resolve(),
		};
		win._onFrameLoad(fakeFrame(app));
		await app.initializedPromise;
		await Promise.resolve();
		expect(win._editionChecked).toBe(true);
	});

	// A frame window with no listeners to bind is a stand-in for any day the wheel binding
	// throws. It must not cost the reader the other three things this hook does.
	it("still sets up the viewer when the wheel cannot be bound", async () => {
		withBooks({ 1: "books/one.pdf" });
		const win = new BookReaderWindow({ book: 1 });
		const switchTool = vi.fn();
		const app = {
			pdfCursorTools: { switchTool },
			pdfLinkService: {},
			pagesCount: 308,
			initializedPromise: Promise.resolve(),
		};
		win._onFrameLoad({ contentWindow: { PDFViewerApplication: app } });
		await app.initializedPromise;
		await Promise.resolve();
		expect(app.pdfLinkService.externalLinkTarget).toBe(2);
		expect(switchTool).toHaveBeenCalledWith(1);
		expect(win._editionChecked).toBe(true);
	});

	// Neither rulebook carries a file attachment or an optional-content layer, so pdf.js's
	// Attachments and Layers tabs are dead controls for the whole life of the window. Written
	// against the viewer's OWN disabled state rather than against the ids outright, so a PDF that
	// does have either gets its tab back without this file having to know.
	it("takes the always-empty sidebar tabs out of the viewer's chrome", () => {
		withBooks({ 1: "books/one.pdf" });
		const win = new BookReaderWindow({ book: 1 });
		const frame = fakeFrame({});
		win._onFrameLoad(frame);
		const [style] = frame.contentDocument.head.children;
		expect(style.textContent).toContain("#viewAttachments[disabled]");
		expect(style.textContent).toContain("#viewLayers[disabled]");
		expect(style.textContent).toContain("display: none");
		// Thumbnails and the outline are the two a book actually fills, and they stay.
		expect(style.textContent).not.toContain("#viewThumbnail");
		expect(style.textContent).not.toContain("#viewOutline");
	});

	// A window renders more than once and its frame fires `load` each time, so the rule has to be
	// written idempotently or a long session stacks up copies of it.
	it("writes that rule once however often the frame loads", () => {
		withBooks({ 1: "books/one.pdf" });
		const win = new BookReaderWindow({ book: 1 });
		const frame = fakeFrame({});
		win._onFrameLoad(frame);
		win._onFrameLoad(frame);
		expect(frame.contentDocument.head.children).toHaveLength(1);
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
