// One rulebook, open in a window, in Foundry's own PDF reader.
//
// Thin ON PURPOSE. Everything a reader does in here belongs to the pdf.js viewer in the iframe
// (see the head of rulebooks.js for what that buys and why we do not reimplement it), so this
// class only has to do the things a viewer in an iframe cannot do for itself: be a window, be
// two windows when both books are open, answer for the gestures that have to leave the frame,
// and fix the one the viewer answers badly (see `_bindWheelZoom`).
//
// TWO WINDOWS. The id is per BOOK, through `perDocumentOptions`, because reading Book II with
// Book I open beside it is the ordinary case for a GM and a shared id would paint the second
// book's content into the first book's frame (AppV1 resolves `element` by id, so both windows
// would be the same window and neither would work).
//
// WHY IT MUST NOT RE-RENDER. An AppV1 re-render replaces the window's HTML, which replaces the
// iframe, which reloads the PDF and throws away the page the reader was on. So this window has
// no state that changes and nothing subscribes it to anything: everything it needs is settled
// at construction. Anything added later that wants to update the window has to drive the frame
// (`_viewerApp`) rather than call `render`.
import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { openingSize } from "../utils/opening-size.js";
import { localize, format } from "../utils/i18n.js";
import { rulebook, rulebookPath, rulebookViewerUrl, isSpreadsEdition } from "./rulebooks.js";
import { showBookToPlayers } from "./book-broadcast.js";
import { markBookReaderOpen, markBookReaderClosed } from "./reader-resume.js";
import { mountBookmarksTab } from "./reader-bookmarks-tab.js";

const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/book-reader.hbs";

const READER_ID_PREFIX = "stonetop-book-reader";

/**
 * The window id for one book, spelled ONCE.
 *
 * Two things have to name the same window and they are in different places: the constructor,
 * which registers it, and `openBookReader`, which looks for one already open. Written out
 * twice, the day one of them gains a prefix is the day clicking Book I opens a second Book I
 * every time, and nothing throws.
 */
export function bookReaderWindowId(book) {
	return StonetopDialog.perDocumentOptions(READER_ID_PREFIX, book).id;
}

// A spread is two portrait pages side by side, so the page this window shows is landscape at
// roughly 1.4:1 and it opens shaped like the thing it is showing. (The poster maps ask the same
// question of `openingSize` and answer 1.2, which is why that number is a parameter and not a
// constant in there.) Wider than the page itself, slightly, to leave room for the viewer's own
// sidebar without the page having to shrink the moment a reader opens the chapter list.
const PAGE_ASPECT = 1.45;

/**
 * pdf.js opens an external http link in the same frame by default, which inside our iframe
 * means the book navigates AWAY and the window is left showing a web page with no way back to
 * the reader but closing it. 2 is pdf.js's `LinkTarget.BLANK`. Applied to the link service
 * after load rather than through the viewer's own options, because those are not reachable
 * from a URL. In-document links (a move to its definition, a cross-reference to a page) are
 * untouched by this: they never leave the frame in the first place.
 */
const LINK_TARGET_BLANK = 2;

/**
 * pdf.js's `CursorTool.HAND`: left-drag grabs the page and moves it, in both axes, the way a
 * sheet of paper on a table moves. Its own tool, not ours -- it already knows to keep its hands
 * off a link (`GrabToPan#ignoreTarget`), so the book's internal cross-references still click
 * through, and the viewer's own `>>` menu offers the Text Selection Tool back for a reader who
 * wants to copy a passage instead.
 *
 * Set per load rather than once, because pdf.js does not remember the choice: it reads
 * `cursorToolOnLoad` at startup and nothing writes it back. So a reader who switches to text
 * selection keeps that for as long as the window is open, and the next book opens grabbable
 * again.
 */
const CURSOR_TOOL_HAND = 1;

/**
 * The two sidebar tabs a rulebook never has anything to put in.
 *
 * pdf.js offers four ways into a document from its sidebar: thumbnails, the outline, file
 * attachments and optional-content layers. A book has the first two. Neither of ours carries an
 * attachment or a layer, so those two buttons sit there greyed out for the whole life of the
 * window, and a control that answers nothing when pressed reads as broken rather than as empty.
 *
 * Hidden on the DISABLED state rather than outright, because that state is the viewer's own
 * answer to "is there anything in here": pdf.js sets it from the count the moment the document
 * loads, and it sets it whether the count is zero or not (`attachmentsloaded`, `layersloaded`,
 * both dispatched even for an empty tree). So this takes them away for a book that has neither
 * and hands them straight back for a PDF that has some, without this file having to know which
 * kind of file a GM pointed at.
 *
 * Written into the frame's OWN document, because that is the only way to reach it: the viewer is
 * a separate document with its own stylesheet and nothing in styles/stonetop.css crosses that
 * line.
 */
const EMPTY_SIDEBAR_TABS_STYLE = "stonetop-empty-sidebar-tabs";
const EMPTY_SIDEBAR_TABS_CSS = "#viewAttachments[disabled], #viewLayers[disabled] { display: none; }";

/**
 * `WheelEvent.DOM_DELTA_PIXEL`, spelled out.
 *
 * Written as the number rather than read off the global, because this class is constructed in
 * the unit tests, where there is no `WheelEvent` to read it from and a boot-time crash would be
 * a strange price to pay for a named zero.
 */
const DELTA_MODE_PIXEL = 0;

/**
 * Pixels of wheel travel that count as one notch, which is pdf.js's own number. Only used to
 * decide WHETHER the wheel moved, not how far: see `_wheelZoom` for why the two are separate.
 */
const WHEEL_PIXELS_PER_NOTCH = 30;

/**
 * One notch of the wheel, in scale: ten percentage points, flat.
 *
 * Not pdf.js's own step, which multiplies by 1.1 and then rounds UP onto a tenth. That
 * compounds -- 100%, 110%, 130%, 150%, 170% -- and a mouse reports a notch as roughly a
 * hundred pixels, which their arithmetic reads as three steps at once. The two together are
 * how one flick of the wheel went from 100% to 170%. Ten points at a time, one notch at a
 * time, is what a reader nudging a page of text a little larger is asking for.
 */
const ZOOM_STEP = 0.1;

export class BookReaderWindow extends StonetopDialog {
	/**
	 * @param {object} config
	 * @param {number} config.book    which book, numbered as `bookPageRef` cites them
	 * @param {number} [config.page]  page of the FILE to open at; see `spreadPageFor` for
	 *                                turning a printed page number into one of these
	 */
	constructor({ book, page } = {}, options = {}) {
		const size = openingSize({ maxAspect: PAGE_ASPECT });
		super(StonetopDialog.perDocumentOptions(READER_ID_PREFIX, book, { ...size, ...options }));
		this._book = Number(book);
		this._entry = rulebook(this._book);
		this._src = rulebookViewerUrl(rulebookPath(this._book), { page });
		// The viewer's own application object, once the frame has loaded. Same origin, so it is
		// reachable; null until then and null again after a close.
		this._viewerApp = null;
		// So the edition warning below is said once per window rather than once per load event.
		this._editionChecked = false;
		// The frame's own window, while we have a wheel listener on it, and the listener: both
		// so a reload can unbind the old one and a close can unbind the last one. Bound once
		// here rather than per load, because `removeEventListener` needs the same function
		// object back and a fresh arrow every time would leave listeners piling up on a frame
		// that reloaded.
		this._zoomWindow = null;
		this._onWheelZoom = (evt) => this._wheelZoom(evt);
		// The reader's own bookmarks tab, once it is in the frame's sidebar. Held so a reload can
		// take the old one down and a close can unsubscribe the last one.
		this._bookmarksTab = null;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["stonetop", "stonetop-book-reader-window"],
			template: TEMPLATE,
			resizable: true,
		});
	}

	get title() {
		return this._entry ? localize(this._entry.titleKey) : localize("stonetop.books.title");
	}

	getData() {
		return { src: this._src, frameTitle: this.title };
	}

	/**
	 * Two things the viewer inside the frame cannot offer, because neither is about this copy
	 * of the book.
	 *
	 * "Show Players" is the reason a GM reads a rulebook at the table at all: to put a page in
	 * front of everybody. GM-only, because it opens a window on other people's screens.
	 *
	 * "Your rulebooks" is the way back to the setup when the file has moved. A PDF that no
	 * longer exists at the recorded path fails inside the iframe, where pdf.js says so in its
	 * own words and offers nothing to do about it, so the way to fix it has to be out here.
	 */
	_getHeaderButtons() {
		const buttons = super._getHeaderButtons();
		// Ours go ahead of core's, and Show Players goes first of ours: it is the one a GM
		// reaches for mid-session, and the setup is the one they touched once and are done with.
		buttons.unshift({
			label:   localize("stonetop.books.settings"),
			class:   "stonetop-book-settings",
			icon:    "fas fa-folder-open",
			onclick: () => this._openSetup(),
		});
		if (globalThis.game?.user?.isGM) buttons.unshift({
			label:   localize("stonetop.books.showPlayers"),
			class:   "stonetop-book-show-players",
			icon:    "fas fa-eye",
			onclick: () => this._showPlayers(),
		});
		return buttons;
	}

	/**
	 * Put the page this window is showing on every other screen at the table.
	 *
	 * The page comes off the LOADED viewer rather than off the URL this window opened at,
	 * because by the time a GM presses this they have read their way to somewhere else: the URL
	 * is where the book started, not where it is. A frame that has not finished loading has no
	 * page to send yet, and says so rather than sending page one.
	 */
	_showPlayers() {
		const page = Number(this._viewerApp?.page);
		if (!Number.isFinite(page) || page < 1) {
			ui.notifications?.warn?.(localize("stonetop.books.stillOpening"));
			return;
		}
		if (!showBookToPlayers(this._book, page)) return;
		ui.notifications?.info?.(format("stonetop.books.shownPlayers", {
			title: this.title, page,
		}));
	}

	async _openSetup() {
		// Imported here rather than at the top of the file: the setup dialog opens this window
		// back, and a static cycle between the two modules is the kind of thing that resolves
		// fine until the day one of them grows a top-level constant that reads the other.
		const { openRulebooksDialog } = await import("./RulebooksDialog.js");
		openRulebooksDialog();
	}

	activateListeners(html) {
		super.activateListeners(html);
		// Remember that this book is open, so a browser reload brings it back (reader-resume.js).
		// Recorded HERE rather than in the constructor because this is the point at which the
		// window is actually on the page; the write no-ops when the record already says so, which
		// is what makes it safe on a surface that runs per render.
		markBookReaderOpen(this._book);
		const frame = html[0]?.querySelector?.(".stonetop-book-reader-frame");
		if (!frame) return;
		frame.addEventListener("load", () => this._onFrameLoad(frame));
	}

	/**
	 * Reach into the loaded viewer for the two things that cannot be said in a URL.
	 *
	 * Same-origin (it is served by this Foundry), so this is allowed; wrapped anyway, because
	 * the shape of `PDFViewerApplication` belongs to whichever pdf.js the core happens to bundle
	 * and a reader whose links open oddly is a far better outcome than a window that throws
	 * during load and shows nothing.
	 */
	_onFrameLoad(frame) {
		// FIRST, and in its own `try` for the same reason the wheel binding has one: this reaches
		// for the frame's DOCUMENT rather than for the viewer object, so it fails on a different
		// day than the block below does, and of the things this hook does it is the cheapest to
		// lose.
		try { this._hideEmptySidebarTabs(frame); }
		catch (err) { console.warn("Stonetop | Could not tidy the book's sidebar.", err); }
		try {
			const app = frame.contentWindow?.PDFViewerApplication;
			if (!app) return;
			this._viewerApp = app;
			if (app.pdfLinkService) app.pdfLinkService.externalLinkTarget = LINK_TARGET_BLANK;
			app.initializedPromise?.then?.(() => {
				this._useHandTool(app);
				this._checkEdition(app);
				this._addBookmarksTab(frame, app);
			});
		} catch (err) {
			console.warn("Stonetop | Could not configure the PDF viewer frame.", err);
		}
		// LAST, and caught apart from the rest: this one reaches for a member of the frame's
		// window rather than of the viewer, so it fails on a different day than the block above
		// does. Sharing a `try` would mean a wheel that cannot be bound also costs the reader
		// the link fix, the hand tool and the edition warning, and of the four this is the one
		// worth least.
		try { this._bindWheelZoom(frame.contentWindow); }
		catch (err) { console.warn("Stonetop | Could not bind zoom to the book's wheel.", err); }
	}

	/**
	 * Ctrl (or Cmd) and the wheel zooms the page.
	 *
	 * pdf.js has its own handler for this and it is nearly right, but it goes DEAF for a full
	 * second after every ordinary scroll (its `zoomDisabledTimeout`, meant for a page that
	 * scrolls under a pinch gesture). Scroll down the book, then hold Ctrl and turn the wheel,
	 * and nothing happens -- which is exactly the order a reader does those two things in, so
	 * the feature reads as missing rather than as delayed.
	 *
	 * So this listens on the CAPTURE phase of the frame's own window, which runs before the
	 * viewer's listener and stops the event reaching it. One handler answers the notch, and it
	 * is this one; the viewer's is simply never asked. Not passive, because the whole point is
	 * to take the default action away: Ctrl and the wheel is the BROWSER's page zoom otherwise,
	 * and that scales the whole game window rather than the page of the book.
	 */
	_bindWheelZoom(frameWindow) {
		if (!frameWindow || frameWindow === this._zoomWindow) return;
		this._unbindWheelZoom();
		frameWindow.addEventListener("wheel", this._onWheelZoom, { capture: true, passive: false });
		this._zoomWindow = frameWindow;
	}

	_unbindWheelZoom() {
		try { this._zoomWindow?.removeEventListener?.("wheel", this._onWheelZoom, { capture: true }); }
		catch (_) { /* the frame is already gone, which is the same outcome */ }
		this._zoomWindow = null;
	}

	/**
	 * One wheel notch, held under Ctrl, as one ten-point step of zoom around the cursor.
	 *
	 * TWO SEPARATE QUESTIONS, and running them together is what made this feel wild. Whether
	 * the wheel moved at all is pdf.js's arithmetic, because it is the part that is genuinely
	 * hard: a trackpad arrives as a stream of deltas far too small to be a notch each, and
	 * without `_accumulateTicks`'s running total every one of them rounds away to nothing. How
	 * FAR to zoom is ours, and it is one step, whatever the notch measured -- a mouse reports
	 * about a hundred pixels for one flick of the wheel, and reading that as three steps is
	 * half of how 100% became 170%. See ZOOM_STEP for the other half.
	 */
	_wheelZoom(evt) {
		if (!evt.ctrlKey && !evt.metaKey) return;
		// Taken away whether or not we can answer it: browser page zoom over a book is never
		// what was meant, and leaving it as the fallback for a frame still loading would zoom
		// the game out from under the reader.
		evt.preventDefault();
		evt.stopPropagation();
		const app = this._viewerApp;
		const viewer = app?.pdfViewer;
		if (!viewer || viewer.isInPresentationMode) return;
		// Wheel down is deltaY positive and means zoom OUT, so the sign flips here.
		const delta = -evt.deltaY;
		const accumulate = (d) => app._accumulateTicks?.(d, "_wheelUnusedTicks") ?? Math.trunc(d);
		let ticks;
		if (evt.deltaMode === DELTA_MODE_PIXEL) ticks = accumulate(delta / WHEEL_PIXELS_PER_NOTCH);
		// A wheel reporting in LINES already counts in notches, so a whole one is a whole notch.
		else ticks = Math.abs(delta) >= 1 ? Math.sign(delta) : accumulate(delta);
		const direction = Math.sign(ticks);
		if (!direction) return;

		const before = viewer.currentScale;
		const target = zoomStepTarget(before, direction);
		try {
			// Driven by FACTOR rather than by steps, because pdf.js's steps are its own
			// compounding ladder and the whole point here is to land on `target` exactly. Its
			// scaleFactor branch is a single multiply-and-round, which does land there, and it
			// still clamps to the viewer's own limits at either end.
			const factor = target / before;
			if (direction > 0) app.zoomIn(null, factor);
			else app.zoomOut(null, factor);
			// What was under the pointer stays under the pointer. Without this the page zooms
			// about its own top-left and the paragraph being read slides off the screen.
			app._centerAtPos?.(before, evt.clientX, evt.clientY);
		} catch (err) {
			console.warn("Stonetop | Could not zoom the book.", err);
		}
	}

	/**
	 * Take the two always-empty sidebar tabs out of the frame's own chrome.
	 *
	 * Off the DOCUMENT rather than the viewer, so it does not wait on `initializedPromise`: the
	 * buttons are in viewer.html from the start and the rule above is written against a state
	 * pdf.js reaches later, so the stylesheet can go in as soon as there is a head to put it in.
	 * Guarded on the id because a frame that reloads gets a fresh document to write into, and one
	 * that somehow does not must not collect a second copy of the same rule.
	 */
	_hideEmptySidebarTabs(frame) {
		const doc = frame?.contentDocument;
		if (!doc?.head || doc.getElementById(EMPTY_SIDEBAR_TABS_STYLE)) return;
		const style = doc.createElement("style");
		style.id = EMPTY_SIDEBAR_TABS_STYLE;
		style.textContent = EMPTY_SIDEBAR_TABS_CSS;
		doc.head.append(style);
	}

	/**
	 * Hand the reader the page itself: left-click and drag moves it around, up down left right.
	 *
	 * Wrapped on its own rather than folded in with the rest of the frame setup, because it
	 * runs after `initializedPromise` alongside the edition check and a viewer whose cursor
	 * tools are shaped differently than we expect must not take that check down with it. A book
	 * that pans the old way is a small loss; a book that never says it is the wrong edition
	 * sends page citations 60 pages wide with nothing to explain it.
	 */
	_useHandTool(app) {
		try { app?.pdfCursorTools?.switchTool?.(CURSOR_TOOL_HAND); }
		catch (err) { console.warn("Stonetop | Could not hand the reader the page to drag.", err); }
	}

	/**
	 * Put the reader's own bookmarks in the viewer's sidebar, beside the book's own outline.
	 *
	 * Wrapped on its own, like the hand tool beside it, because it is the most elaborate of the
	 * things this window writes into the frame and therefore the likeliest to be the one a future
	 * pdf.js breaks. A book with no bookmarks tab is still a book; a book that threw on the way
	 * to installing one would lose the edition check as well.
	 *
	 * The old tab comes down FIRST, because a frame that reloaded (a GM re-pointing the setting
	 * at another file) leaves this holding a controller subscribed to an event bus that is gone.
	 */
	_addBookmarksTab(frame, app) {
		try {
			this._bookmarksTab?.destroy?.();
			this._bookmarksTab = mountBookmarksTab(frame, { book: this._book, app });
		} catch (err) {
			console.warn("Stonetop | Could not add the bookmarks tab to the book's sidebar.", err);
			this._bookmarksTab = null;
		}
	}

	/**
	 * Say once, quietly, when the file that opened is not the edition our page numbers assume.
	 *
	 * Nothing here is broken by a 1-up edition: it reads perfectly, its outline and search and
	 * internal links all work. What does not work is anything that JUMPS to a printed page, so
	 * the notice is worth exactly one line and no more, and the book stays open either way.
	 */
	_checkEdition(app) {
		if (this._editionChecked || !this._entry) return;
		const pages = Number(app?.pagesCount);
		if (!pages) return;
		this._editionChecked = true;
		if (isSpreadsEdition(this._book, pages)) return;
		console.info(format("stonetop.books.otherEdition", {
			book: this._entry.numeral, pages, expected: this._entry.spreadPages,
		}));
	}

	/**
	 * Turn an ALREADY OPEN book to a page of the file.
	 *
	 * Driving the loaded viewer rather than re-rendering, for the reason at the head of this
	 * class: a re-render would reload the PDF, which on a 60 MB book is a visible stall and
	 * loses the reader's place on the way to a page they asked for. A window that has not
	 * finished loading yet is left alone deliberately, because it is already opening at the
	 * page its URL named.
	 */
	goToPage(page) {
		const n = Number(page);
		if (!this._viewerApp || !Number.isFinite(n) || n < 1) return;
		try { this._viewerApp.page = Math.trunc(n); }
		catch (err) { console.warn("Stonetop | Could not turn the book to that page.", err); }
	}

	async close(options) {
		this._unbindWheelZoom();
		this._bookmarksTab?.destroy?.();
		this._bookmarksTab = null;
		this._viewerApp = null;
		// A book the reader actually CLOSED does not come back on the next load. This is the
		// whole mechanism: a browser reload never reaches here, so a record still standing is
		// the evidence that the window was open when the page went away.
		markBookReaderClosed(this._book);
		return super.close(options);
	}
}

/**
 * The scale one notch away from where the page is now, on a flat grid of tenths.
 *
 * SNAPPED to the grid before stepping, not just stepped, because the scale a book is sitting
 * at is usually not a round number: "fit page" on a spread lands somewhere like 0.63, and
 * adding a tenth to that gives 0.73 and then 0.83, a grid of its own that no other control in
 * the viewer shares. Rounding toward the direction of travel means the first notch tidies the
 * number up (0.63 becomes 0.7 going in, 0.6 going out) and every notch after it is a clean ten
 * points. Rounded to the hundredth on the way out because a tenth is not exactly representable
 * and 0.7000000000000001 is a percentage the toolbar would have to show.
 *
 * @param {number} scale      the viewer's current scale
 * @param {number} direction  +1 to zoom in, -1 to zoom out
 */
export function zoomStepTarget(scale, direction) {
	const tenths = scale * 10;
	// A hair of tolerance, so a scale already sitting ON a grid point is not nudged off it by
	// its own floating-point dust: 1.3 is stored as 1.3000000000000003 and floor(13.000...03)
	// is 13, but 0.7 is stored a hair LOW and would floor to 6.
	const grid = (direction > 0 ? Math.floor(tenths + 1e-6) : Math.ceil(tenths - 1e-6)) / 10;
	return Math.round((grid + direction * ZOOM_STEP) * 100) / 100;
}

/**
 * Open one book, or bring the copy already open to the front.
 *
 * `openOrFocus` rather than a fresh window each time, and the id it guards is the per-book one:
 * clicking Book I twice brings the reader you already had (still on the page you were reading)
 * rather than opening a second copy scrolled back to the cover.
 *
 * Answers null when the world has no copy of that book recorded, so the caller decides what to
 * do about it. The header buttons open the setup instead; a future page citation would want to
 * do the same, and neither should have to learn that from a thrown error.
 */
export function openBookReader(book, { page } = {}) {
	if (!rulebookPath(book)) return null;
	const win = openOrFocus(bookReaderWindowId(book), () => {
		const opened = new BookReaderWindow({ book, page });
		opened.render(true);
		return opened;
	});
	// A window that was ALREADY open opened at whatever page it was left on, so a caller that
	// named one has to be answered here. A window this call just minted is already going there
	// (the page is in its URL) and `goToPage` no-ops on it, which is why this can be
	// unconditional rather than branching on which of the two happened.
	if (page) win?.goToPage?.(page);
	return win;
}
