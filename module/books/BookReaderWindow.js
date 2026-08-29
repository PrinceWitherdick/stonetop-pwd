// One rulebook, open in a window, in Foundry's own PDF reader.
//
// Thin ON PURPOSE. Everything a reader does in here belongs to the pdf.js viewer in the iframe
// (see the head of rulebooks.js for what that buys and why we do not reimplement it), so this
// class only has to do the things a viewer in an iframe cannot do for itself: be a window, be
// two windows when both books are open, and answer for the two gestures that have to leave the
// frame.
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
	 * Two ways out of the frame, and both are things the viewer inside it cannot offer.
	 *
	 * "Open in a new tab" is the one request a window like this always gets: a GM with a second
	 * monitor wants the book over there, not docked in the same 80% of the same screen as the
	 * game. Same URL, so the browser's own PDF chrome and pdf.js agree about which page.
	 *
	 * "Your rulebooks" is the way back to the setup when the file has moved. A PDF that no
	 * longer exists at the recorded path fails inside the iframe, where pdf.js says so in its
	 * own words and offers nothing to do about it, so the way to fix it has to be out here.
	 */
	_getHeaderButtons() {
		const buttons = super._getHeaderButtons();
		buttons.unshift({
			label:   localize("stonetop.books.popOut"),
			class:   "stonetop-book-pop-out",
			icon:    "fas fa-arrow-up-right-from-square",
			onclick: () => this._popOut(),
		}, {
			label:   localize("stonetop.books.settings"),
			class:   "stonetop-book-settings",
			icon:    "fas fa-folder-open",
			onclick: () => this._openSetup(),
		});
		return buttons;
	}

	_popOut() {
		if (this._src) globalThis.window?.open?.(this._src, "_blank", "noopener");
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
		try {
			const app = frame.contentWindow?.PDFViewerApplication;
			if (!app) return;
			this._viewerApp = app;
			if (app.pdfLinkService) app.pdfLinkService.externalLinkTarget = LINK_TARGET_BLANK;
			app.initializedPromise?.then?.(() => this._checkEdition(app));
		} catch (err) {
			console.warn("Stonetop | Could not configure the PDF viewer frame.", err);
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
		this._viewerApp = null;
		return super.close(options);
	}
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
