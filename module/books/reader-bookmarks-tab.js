// A fifth tab in the viewer's own sidebar, just after the Document Outline: the
// reader's own bookmarks.
//
// WHY IT IS INSIDE THE FRAME rather than in our window's chrome, which would be the easier
// thing to build and to test. A reader looking for a list of places in the book looks in the
// sidebar, because that is where the book's OWN list of places is. A second panel of ours,
// outside the frame, would be a second sidebar sitting beside the first one, and the answer to
// "where are my bookmarks" would be "not with the outline". So this puts the tab where the
// question gets asked, and pays for it by reaching into a document we do not own.
//
// WHAT THAT COSTS, AND WHY IT IS SAFE ENOUGH. The viewer is same-origin (Foundry serves it), so
// the reach itself is allowed -- BookReaderWindow already writes a stylesheet into this document
// to hide the two always-empty sidebar tabs. What it depends on is the viewer's MARKUP: the ids
// `sidebarViewButtons`, `viewOutline` and `sidebarContent`, and the classes pdf.js toggles to
// show a view. Every one of those is checked before it is used and the whole mount answers null
// if any is missing, so a future pdf.js that renames them costs the tab and nothing else -- the
// book still opens, still reads, still searches.
//
// WHY IT DOES NOT CALL `switchView`. pdf.js's sidebar knows four views by number and its
// `switchView` logs an error and returns for anything else, so ours cannot be one of them.
// Toggling is two DOM operations (`toggled` plus `aria-checked` on the button, `hidden` on the
// view -- their own `toggleCheckedBtn`), so this does that for their four and for ours, and then
// parks their `active` at NONE. Parking it matters: `switchView` returns early when the view has
// not changed, so a sidebar still claiming OUTLINE while OUR panel is showing would answer a
// click on Outline by doing nothing at all.
import { localize } from "../utils/i18n.js";
import {
	bookmarksFor, addBookmark, renameBookmark, removeBookmark, pageNote, LABEL_MAX,
} from "./book-bookmarks.js";
import { outlineHeadings, headingAt } from "./outline-titles.js";

export const BOOKMARKS_BUTTON_ID = "stonetopViewBookmarks";
export const BOOKMARKS_VIEW_ID = "stonetopBookmarksView";
export const BOOKMARKS_STYLE_ID = "stonetop-bookmarks-tab";

/** The sidebar furniture we need, by the ids pdf.js gives it. */
const SIDEBAR_BUTTONS = "sidebarViewButtons";
const SIDEBAR_CONTENT = "sidebarContent";
const OUTLINE_BUTTON = "viewOutline";
/** What ours goes in front of: the first of the two tabs a rulebook never fills. */
const ATTACHMENTS_BUTTON = "viewAttachments";

/** pdf.js's own four, in the order they sit in the toolbar. */
const NATIVE_TABS = [
	{ button: "viewThumbnail", view: "thumbnailView" },
	{ button: OUTLINE_BUTTON, view: "outlineView" },
	{ button: ATTACHMENTS_BUTTON, view: "attachmentsView" },
	{ button: "viewLayers", view: "layersView" },
];

/** `SidebarView.NONE`, spelled out rather than read off a module we cannot import. */
const SIDEBAR_VIEW_NONE = 0;

/**
 * A bookmark ribbon, drawn to pdf.js's own icon spec: 16 by 16, a solid path, hollow at the
 * stroke weight their other sidebar icons use. Delivered as a mask because that is how every
 * toolbar button in the viewer is drawn -- `.toolbarButton::before` already sets the size, the
 * position and the colour, so the icon only has to supply the shape and inherits the toolbar's
 * hover and toggled inks for free.
 *
 * Percent-encoded by hand rather than base64 so the shape stays readable, and quoted with
 * apostrophes inside so the CSS `url("...")` around it needs no escaping of its own.
 */
const BOOKMARK_MASK =
	"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E" +
	"%3Cpath fill-rule='evenodd' d='M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5V15L8 11 2 15Z" +
	"M3.5 2.5v9.7L8 9.2l4.5 3V2.5Z'/%3E%3C/svg%3E\")";

/** A pencil and a cross for the row's two tools, drawn to the same spec. */
const RENAME_MASK =
	"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E" +
	"%3Cpath d='M10.7 1.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L5.6 14.4 1 15.5l1.1-4.6Z'/%3E%3C/svg%3E\")";
const DELETE_MASK =
	"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E" +
	"%3Cpath d='M3.05 2 2 3.05 6.95 8 2 12.95 3.05 14 8 9.05 12.95 14 14 12.95 9.05 8 14 3.05 12.95 2 8 6.95Z'/%3E" +
	"%3C/svg%3E\")";

/**
 * Our own rules, written into the frame's document.
 *
 * Borrowing the viewer's tokens (`--treeitem-color` and friends) rather than picking colours,
 * so the panel is the same ink as the outline beside it in whichever theme the viewer is in --
 * pdf.js follows the browser's light and dark, and a hard-coded grey would be wrong in one of
 * them. The geometry of the view itself is copied from `#outlineView` for the same reason: it
 * has to sit in `#sidebarContent` exactly as its neighbours do.
 *
 * The two row tools are ALWAYS visible rather than appearing on hover. A control that exists
 * only under the pointer cannot be reached by anyone driving this by keyboard or magnifier, and
 * this system has a player at the table doing exactly that.
 */
const BOOKMARKS_CSS = `
#${BOOKMARKS_BUTTON_ID}::before {
	-webkit-mask-image: ${BOOKMARK_MASK};
	mask-image: ${BOOKMARK_MASK};
}
#${BOOKMARKS_VIEW_ID} {
	position: absolute;
	width: calc(100% - 8px);
	inset-block: 0;
	padding: 4px 4px 0;
	overflow: auto;
	user-select: none;
}
.stonetopBookmarkAdd {
	display: block;
	width: 100%;
	margin: 0 0 6px;
	padding: 5px 6px;
	border: 1px solid var(--treeitem-color, currentColor);
	border-radius: 3px;
	background: none;
	color: var(--treeitem-color, currentColor);
	font: message-box;
	font-size: 13px;
	text-align: start;
	cursor: pointer;
}
.stonetopBookmarkAdd:is(:hover, :focus-visible) {
	background-color: var(--treeitem-bg-color, rgb(255 255 255 / 0.1));
	color: var(--treeitem-hover-color, currentColor);
}
/* Held while the first mark in a book waits on the outline. Says so, rather than simply not
   answering: a button that ignores a press reads as broken. */
.stonetopBookmarkAdd:disabled {
	opacity: 0.55;
	cursor: default;
}
.stonetopBookmarkRow {
	display: flex;
	align-items: start;
	gap: 2px;
}
.stonetopBookmarkRow > a {
	flex: 1 1 auto;
	min-width: 0;
}
.stonetopBookmarkPage {
	display: block;
	font-size: 11px;
	opacity: 0.7;
}
.stonetopBookmarkTool {
	flex: 0 0 auto;
	width: 22px;
	height: 22px;
	margin-top: 1px;
	padding: 0;
	position: relative;
	border: none;
	border-radius: 2px;
	background: none;
	cursor: pointer;
}
.stonetopBookmarkTool::before {
	content: "";
	position: absolute;
	top: 50%;
	left: 50%;
	width: 12px;
	height: 12px;
	transform: translate(-50%, -50%);
	background-color: var(--treeitem-color, currentColor);
	mask-size: cover;
	-webkit-mask-size: cover;
}
.stonetopBookmarkTool:is(:hover, :focus-visible) {
	background-color: var(--treeitem-bg-color, rgb(255 255 255 / 0.1));
}
.stonetopBookmarkTool:is(:hover, :focus-visible)::before {
	background-color: var(--treeitem-hover-color, currentColor);
}
.stonetopBookmarkRename::before {
	-webkit-mask-image: ${RENAME_MASK};
	mask-image: ${RENAME_MASK};
}
.stonetopBookmarkDelete::before {
	-webkit-mask-image: ${DELETE_MASK};
	mask-image: ${DELETE_MASK};
}
.stonetopBookmarkInput {
	flex: 1 1 auto;
	min-width: 0;
	margin-bottom: 1px;
	padding: 2px 4px;
	border: 1px solid var(--treeitem-color, currentColor);
	border-radius: 2px;
	background: none;
	color: var(--treeitem-color, currentColor);
	font: message-box;
	font-size: 13px;
}
.stonetopBookmarkEmpty {
	margin: 0;
	padding: 4px;
	color: var(--treeitem-color, currentColor);
	font-size: 13px;
	line-height: 1.35;
	opacity: 0.85;
}
`;

/**
 * Put the tab in the sidebar of one loaded viewer.
 *
 * @param {HTMLIFrameElement} frame  the frame the viewer is in
 * @param {object} config
 * @param {number} config.book       which book this window is showing
 * @param {object} config.app        the frame's `PDFViewerApplication`
 * @returns {object|null} a controller with `destroy()`, or null when the sidebar is not the
 *                        shape this expects (see the header: that is a degrade, not an error).
 */
export function mountBookmarksTab(frame, { book, app } = {}) {
	const doc = frame?.contentDocument;
	if (!doc?.getElementById || !app) return null;
	// A frame that did not reload still has the tab from last time, and a second copy would be
	// a second button answering the same list.
	if (doc.getElementById(BOOKMARKS_BUTTON_ID)) return null;
	const buttons = doc.getElementById(SIDEBAR_BUTTONS);
	const content = doc.getElementById(SIDEBAR_CONTENT);
	if (!buttons || !content) return null;

	const tab = new BookmarksTab(doc, { book, app, buttons, content });
	tab.mount();
	return tab;
}

class BookmarksTab {
	constructor(doc, { book, app, buttons, content }) {
		this._doc = doc;
		this._book = Number(book);
		this._app = app;
		this._buttons = buttons;
		this._content = content;
		// Resolved once, the first time a mark needs naming. Null means "not asked yet", which is
		// a different thing from an empty table (a book with no outline), and only the first is
		// worth asking again.
		this._headings = null;
		// While our own activation is toggling things, so the sidebar event it provokes is not
		// read as the reader switching away from us.
		this._activating = false;
		// Which row the panel is currently showing an input for, "" for none. This is the panel's
		// claim on itself: the text in that input is nowhere else yet, so anything that finishes
		// later and would repaint has to ask whether the panel it is repainting is still its own.
		this._editing = "";
		// The add button, and whether it is already busy making a mark.
		this._addButton = null;
		this._adding = false;
		this._onSidebarView = (evt) => this._sidebarViewChanged(evt);
	}

	mount() {
		this._injectStyle();
		this._button = this._makeButton();
		this._view = this._makeView();
		// STRAIGHT AFTER the Outline, which is where a reader's own list of places belongs: the
		// two lists of places in the book, in order, the book's own first. Attachments and Layers
		// are what it goes in front of, and BookReaderWindow hides both of those for a rulebook
		// (neither book has either), so in practice ours is the last tab a reader sees.
		// `insertBefore` with a missing reference node appends, so a viewer that has dropped the
		// attachments button still gets the tab, just last of all.
		this._buttons.insertBefore(this._button, this._doc.getElementById(ATTACHMENTS_BUTTON));
		this._content.append(this._view);
		this._app.eventBus?.on?.("sidebarviewchanged", this._onSidebarView);
		this.refresh();
	}

	destroy() {
		try { this._app.eventBus?.off?.("sidebarviewchanged", this._onSidebarView); } catch (_) { /* gone */ }
		try { this._button?.remove?.(); this._view?.remove?.(); } catch (_) { /* gone with the frame */ }
		this._button = null;
		this._view = null;
	}

	_injectStyle() {
		if (this._doc.getElementById(BOOKMARKS_STYLE_ID)) return;
		const style = this._doc.createElement("style");
		style.id = BOOKMARKS_STYLE_ID;
		style.textContent = BOOKMARKS_CSS;
		this._doc.head?.append?.(style);
	}

	_makeButton() {
		const button = this._doc.createElement("button");
		button.id = BOOKMARKS_BUTTON_ID;
		button.className = "toolbarButton";
		button.type = "button";
		button.title = localize("stonetop.books.bookmarks.tab");
		// The same three attributes pdf.js's own four carry, because they are what makes the
		// group a radio group to a screen reader rather than four unrelated buttons.
		button.setAttribute("role", "radio");
		button.setAttribute("aria-checked", "false");
		button.setAttribute("aria-controls", BOOKMARKS_VIEW_ID);
		// Their buttons take an explicit tab order (2 to 5) and an element without one would sort
		// AFTER every element that has one. Sharing the outline's number puts ours where it sits.
		button.setAttribute("tabindex", "3");
		const label = this._doc.createElement("span");
		label.textContent = localize("stonetop.books.bookmarks.tab");
		button.append(label);
		button.addEventListener("click", () => this.activate());
		return button;
	}

	_makeView() {
		const view = this._doc.createElement("div");
		view.id = BOOKMARKS_VIEW_ID;
		view.className = "treeView hidden";
		return view;
	}

	/**
	 * Show our panel and take the sidebar off whichever of theirs was showing.
	 *
	 * `open()` FIRST, because opening a closed sidebar is the one thing here only pdf.js can do,
	 * and it dispatches the event our own listener reads -- so it has to happen while the
	 * re-entrancy guard is up and before we have anything to lose.
	 */
	activate() {
		this._activating = true;
		try {
			const sidebar = this._app.pdfSidebar;
			if (sidebar && !sidebar.isOpen) sidebar.open?.();
			for (const { button, view } of NATIVE_TABS) this._toggle(button, view, false);
			this._toggle(BOOKMARKS_BUTTON_ID, BOOKMARKS_VIEW_ID, true);
			// See the header: parked at NONE so their next click always counts as a change.
			if (sidebar) sidebar.active = SIDEBAR_VIEW_NONE;
			this.refresh();
		} finally {
			this._activating = false;
		}
	}

	/** Hand the sidebar back, without choosing a view: pdf.js is already showing the one asked for. */
	deactivate() {
		this._toggle(BOOKMARKS_BUTTON_ID, BOOKMARKS_VIEW_ID, false);
	}

	/**
	 * pdf.js's own `toggleCheckedBtn`, done from out here.
	 *
	 * By id rather than by held references, because these are their elements: a viewer that
	 * rebuilt one would leave us holding a node no longer in the document, and a missing one is
	 * simply nothing to toggle.
	 */
	_toggle(buttonId, viewId, on) {
		const button = this._doc.getElementById(buttonId);
		const view = this._doc.getElementById(viewId);
		button?.classList?.toggle("toggled", on);
		button?.setAttribute?.("aria-checked", String(on));
		view?.classList?.toggle("hidden", !on);
	}

	/**
	 * The reader picked one of pdf.js's own tabs, so ours stops showing.
	 *
	 * Only for a view that is actually one of THEIRS. The same event fires with NONE when the
	 * sidebar is closed, and closing the sidebar while our panel is up must leave it up: it is
	 * what comes back when they open it again.
	 */
	_sidebarViewChanged(evt) {
		if (this._activating) return;
		const view = Number(evt?.view);
		if (view > SIDEBAR_VIEW_NONE) this.deactivate();
	}

	// ── The list ────────────────────────────────────────────────────────────────

	/** Repaint the panel from the stored list. Cheap, and the only way anything gets in here. */
	refresh({ editing = "" } = {}) {
		if (!this._view) return;
		// BEFORE the panel is torn down, not after it is rebuilt. Emptying the view blurs whatever
		// input was in it, and a blur commits -- so the commit that is about to run has to already
		// be able to see that the panel has changed hands.
		this._editing = editing;
		this._view.replaceChildren();
		this._view.append(this._makeAddButton());
		const rows = bookmarksFor(this._book);
		if (!rows.length) {
			this._view.append(this._makeEmptyNote());
			return;
		}
		for (const row of rows) this._view.append(this._makeRow(row, row.id === editing));
		// AFTER the row is in the document, not while it is being built. Focusing an element that
		// is still detached does nothing at all -- silently, and only in a real browser, which is
		// how a mark made and immediately named swallowed every keystroke.
		const input = this._view.querySelector?.(".stonetopBookmarkInput");
		input?.focus?.();
		input?.select?.();
	}

	_makeAddButton() {
		const button = this._doc.createElement("button");
		button.className = "stonetopBookmarkAdd";
		button.type = "button";
		button.textContent = localize("stonetop.books.bookmarks.add");
		button.title = localize("stonetop.books.bookmarks.addTip");
		// Held so `_addHere` can put it out of reach while it is working. A repaint replaces the
		// element, so this is reassigned every time rather than looked up once.
		button.disabled = this._adding;
		button.addEventListener("click", () => this._addHere());
		this._addButton = button;
		return button;
	}

	/**
	 * Repaint, unless the reader is in the middle of naming something.
	 *
	 * For the writes that finish on their own time. A repaint that lands while a row is being
	 * renamed throws away the text typed into that input, which exists nowhere else -- and the
	 * list it would have drawn gets drawn anyway the moment the rename ends, which is the next
	 * thing that happens.
	 */
	_refreshUnlessNaming() {
		if (!this._editing) this.refresh();
	}

	_makeEmptyNote() {
		const note = this._doc.createElement("p");
		note.className = "stonetopBookmarkEmpty";
		note.textContent = localize("stonetop.books.bookmarks.empty");
		return note;
	}

	/**
	 * One row: the place, and the two things that can be done to it.
	 *
	 * `.treeItem` and an anchor inside it, because that is what the outline's rows are: the
	 * viewer's own stylesheet then gives this row the same ink, the same hover and the same
	 * spacing as the list a reader was just looking at.
	 */
	_makeRow(row, editing) {
		const item = this._doc.createElement("div");
		item.className = "treeItem stonetopBookmarkRow";
		item.dataset.bookmarkId = row.id;

		if (editing) {
			item.append(this._makeLabelInput(row));
		} else {
			const note = pageNote(this._book, row.page, this._pageCount());
			const link = this._doc.createElement("a");
			link.href = "#";
			link.title = localize("stonetop.books.bookmarks.goTip");
			// The pages are the SECOND line only when there is a name above them. A mark nobody
			// named is called by its pages, and printing them twice in one row would be the same
			// answer to two different questions.
			link.textContent = row.label || note;
			if (row.label) {
				const pages = this._doc.createElement("span");
				pages.className = "stonetopBookmarkPage";
				pages.textContent = note;
				link.append(pages);
			}
			link.addEventListener("click", (evt) => {
				evt.preventDefault();
				this._goTo(row);
			});
			item.append(link);
		}

		item.append(this._makeTool("stonetopBookmarkRename", "stonetop.books.bookmarks.rename",
			() => this.refresh({ editing: row.id })));
		item.append(this._makeTool("stonetopBookmarkDelete", "stonetop.books.bookmarks.remove",
			async () => { await removeBookmark(this._book, row.id); this._refreshUnlessNaming(); }));
		return item;
	}

	_makeTool(cls, titleKey, onClick) {
		const button = this._doc.createElement("button");
		button.className = `stonetopBookmarkTool ${cls}`;
		button.type = "button";
		button.title = localize(titleKey);
		// A masked button has no text of its own, so the name a screen reader says has to be
		// said here as well as in the tooltip.
		button.setAttribute("aria-label", localize(titleKey));
		// The handler's promise is RETURNED rather than dropped. A real listener ignores it, but
		// removing a bookmark is a write followed by a repaint, and a caller that cannot wait for
		// the pair can only test that the write started.
		button.addEventListener("click", (evt) => { evt.preventDefault(); return onClick(); });
		return button;
	}

	/**
	 * The row, mid-rename.
	 *
	 * Selected rather than merely focused (`refresh` does it, once the row is in the document), so
	 * the suggested name can be replaced by typing over it rather than cleared first.
	 *
	 * Enter and blur both COMMIT, escape abandons. Blur committing is the point: a reader who
	 * names a mark and then clicks back into the book has finished naming it, and a name lost to
	 * clicking away is the most annoying way to lose one.
	 *
	 * Keystrokes stop here rather than reaching the document, because pdf.js binds single letters
	 * as viewer shortcuts and a bookmark called "Next page" should not turn the page while it is
	 * being typed.
	 */
	_makeLabelInput(row) {
		const input = this._doc.createElement("input");
		input.className = "stonetopBookmarkInput";
		input.type = "text";
		input.maxLength = LABEL_MAX;
		// The pages are the PLACEHOLDER, never the value. Seeding them as text meant a reader who
		// liked the suggestion and pressed Enter stored "pp. 180-181" as the mark's NAME, and the
		// row then printed the same phrase twice: once as what it is called, once as where it is.
		// As a placeholder, pressing Enter leaves the mark unnamed, which is what it looked like
		// they were agreeing to.
		input.value = row.label;
		input.placeholder = pageNote(this._book, row.page, this._pageCount());
		let done = false;
		const commit = async (save) => {
			if (done) return;
			done = true;
			if (save) await renameBookmark(this._book, row.id, input.value);
			// The repaint is OURS to make only while the panel is still showing our input. The way
			// it stops being ours is the reader clicking the pencil on another row: that click
			// repaints with the other row's input in it, which blurs this one, which commits -- and
			// the repaint that used to happen here landed after the write and wiped the input they
			// had already started typing into, keystrokes and all. The row's new name goes unshown
			// until that rename ends, which repaints from the stored list and shows both.
			if (this._editing === row.id) this.refresh();
		};
		input.addEventListener("keydown", (evt) => {
			evt.stopPropagation();
			if (evt.key === "Enter") commit(true);
			else if (evt.key === "Escape") commit(false);
		});
		input.addEventListener("blur", () => commit(true));
		return input;
	}

	// ── Where the reader is, and getting back there ─────────────────────────────

	_pageCount() {
		return Number(this._app.pagesCount) || 0;
	}

	/**
	 * The exact place on screen, as pdf.js itself would write it into a link.
	 *
	 * `_location` is the viewer's own record of where the view is, and its `pdfOpenParams` is
	 * the page, the zoom and the offset down the page -- the same string its "Current Page"
	 * menu item builds a URL out of. So a bookmark returns a reader to the paragraph, not to
	 * the top of the sheet.
	 *
	 * The fallback is the page alone, which is what a viewer that has not scrolled yet can
	 * honestly say.
	 */
	_here() {
		// Nothing to mark until the document is actually there. `page` answers 1 in a viewer that
		// has not loaded one, so asking it alone would mark page 1 of a book still parsing; the
		// count is 0 until then, and is the honest form of the question.
		if (!this._pageCount()) return null;
		const location = this._app.pdfViewer?._location;
		const page = Math.trunc(Number(location?.pageNumber ?? this._app.page));
		if (!Number.isFinite(page) || page < 1) return null;
		const params = String(location?.pdfOpenParams ?? "");
		return { page, hash: params.startsWith("#") ? params.slice(1) : `page=${page}` };
	}

	/**
	 * Mark where the reader is.
	 *
	 * HELD WHILE IT WORKS, because the first mark in a book is slow: naming it means resolving the
	 * document's outline, which is a promise per heading and on a book this size is comfortably
	 * long enough to press the button again. Every press during that wait made ANOTHER mark on the
	 * same page, and the panel then repainted once per press, so the reader ended up with three
	 * identical rows and an input on whichever won. The button is out of reach until the first one
	 * is on the list; the repaint that ends this replaces it with a fresh, enabled one.
	 */
	async _addHere() {
		if (this._adding) return;
		this._adding = true;
		if (this._addButton) this._addButton.disabled = true;
		try {
			const here = this._here();
			if (!here) {
				ui.notifications?.warn?.(localize("stonetop.books.stillOpening"));
				return;
			}
			const row = await addBookmark(this._book, { ...here, label: await this._suggestLabel(here.page) });
			// Straight into rename, with the suggestion selected: marking a place and saying what
			// it is are one gesture, and a reader who likes the suggested name just presses Enter.
			this.refresh({ editing: row?.id ?? "" });
		} finally {
			this._adding = false;
			// The button here is the one the repaint above just made, when there was one; on the
			// paths that returned early it is still the one that was pressed.
			if (this._addButton) this._addButton.disabled = false;
		}
	}

	/**
	 * What to call a new mark: the book's own heading for that page.
	 *
	 * Resolved on the FIRST bookmark rather than at load, because a document's outline costs a
	 * promise per heading to turn into page numbers and most windows never make a bookmark at
	 * all. Asked once and remembered, because the second bookmark should be instant.
	 *
	 * Answers "" for a page with no heading above it (a title page, the contents), which is not a
	 * failure: an unnamed mark is shown, and offered for rename, by its printed pages instead.
	 */
	async _suggestLabel(page) {
		if (!this._headings) {
			try { this._headings = await outlineHeadings(this._app.pdfDocument); }
			catch (_) { this._headings = []; }
		}
		return headingAt(this._headings, page);
	}

	/**
	 * Back to a mark.
	 *
	 * Through the link service, because that is the one thing in the viewer that understands the
	 * whole anchor -- page, zoom and offset. A row from an older build with only a page, or a
	 * link service that refuses the string, still lands on the right sheet.
	 */
	_goTo(row) {
		try {
			if (row.hash && this._app.pdfLinkService?.setHash) this._app.pdfLinkService.setHash(row.hash);
			else this._app.page = row.page;
		} catch (err) {
			console.warn("Stonetop | Could not go to that bookmark.", err);
			try { this._app.page = row.page; } catch (_) { /* the frame is gone */ }
		}
	}
}
