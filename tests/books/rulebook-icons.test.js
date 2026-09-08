import Handlebars from "handlebars";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readRepo as read, readCss } from "../fakes/css.js";

// The two windows a click leads to are stubbed: what is under test is WHICH of them a click
// leads to, which is the whole behaviour of these icons.
vi.mock("../../module/books/BookReaderWindow.js", () => ({ openBookReader: vi.fn() }));
vi.mock("../../module/books/RulebooksDialog.js", () => ({ openRulebooksDialog: vi.fn() }));

import { rulebookIconRows, openRulebook, openBookPage } from "../../module/books/rulebook-icons.js";
import { openBookReader } from "../../module/books/BookReaderWindow.js";
import { openRulebooksDialog } from "../../module/books/RulebooksDialog.js";
import { RULEBOOKS_SETTING } from "../../module/books/rulebooks.js";
import { createStonetopGmToolkitSheetClass } from "../../module/actors/gmtoolkit/StonetopGmToolkitSheet.js";

const TOOLKIT_HBS = "templates/actor/gm-toolkit.hbs";
const SHEET_JS    = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");
const ICONS_JS    = read("module/books/rulebook-icons.js");
const CSS         = readCss();

function withBooks(paths = {}) {
	game.settings = { get: (_scope, key) => (key === RULEBOOKS_SETTING ? paths : undefined) };
}

/** The GM Toolkit sheet over a stand-in for core's ActorSheet, as its own suite builds it. */
function makeSheet() {
	const Base = class {
		options  = {};
		position = {};
		get actor() { return { id: "toolkit1", name: "GM Toolkit", system: {} }; }
		get isEditable() { return true; }
		static get defaultOptions() { return { classes: [], resizable: false }; }
		async getData() { return {}; }
		activateListeners() {}
		_getHeaderButtons() {
			return [
				{ label: "Sheet",     class: "configure-sheet", icon: "fas fa-cog" },
				{ label: "Prototype", class: "configure-token", icon: "fas fa-user-circle" },
				{ label: "Close",     class: "close",           icon: "fas fa-times" },
			];
		}
	};
	return new (createStonetopGmToolkitSheetClass(Base))();
}

describe("the Book I and Book II icons", () => {
	beforeEach(() => { vi.clearAllMocks(); });
	afterEach(() => { delete game.settings; });

	it("offers one row per book, labelled and glyphed from the table", () => {
		withBooks({});
		const [one, two] = rulebookIconRows();
		expect(one.label).toBe("Book I");
		expect(two.label).toBe("Book II");
		expect(one.icon).toBe("fas fa-book");
		expect(two.icon).toBe("fas fa-book-atlas");
	});

	// The dimming says "nothing here" without saying that pressing it is how you fix that, so
	// the tooltip names the outcome instead: which of the two windows the click will open.
	it("says in its tooltip which of the two things a click will do", () => {
		withBooks({ 1: "books/one.pdf" });
		const [one, two] = rulebookIconRows();
		expect(one.have).toBe(true);
		expect(one.tooltip).toBe("Open Book I: Stonetop");
		expect(two.have).toBe(false);
		expect(two.tooltip).toBe("Point at your copy of Book II: The Wider World and Other Wonders");
	});

	it("opens the book this world has a copy of", () => {
		withBooks({ 2: "books/two.pdf" });
		openRulebook(2);
		expect(openBookReader).toHaveBeenCalledWith(2);
		expect(openRulebooksDialog).not.toHaveBeenCalled();
	});

	// A dead icon is indistinguishable from a broken one, so a book with no file opens the
	// window that gives it one rather than doing nothing.
	it("opens the setup for a book this world has no copy of", () => {
		withBooks({ 2: "books/two.pdf" });
		openRulebook(1);
		expect(openRulebooksDialog).toHaveBeenCalled();
		expect(openBookReader).not.toHaveBeenCalled();
	});

	// The row the template drew and the click on it are separated by however long the sheet has
	// been open. A GM who sets Book I in the window this opens comes back to a banner that still
	// says unset, and the next click has to open the book rather than the setup again.
	it("re-reads the setting at click time rather than trusting the drawn row", () => {
		withBooks({});
		const [one] = rulebookIconRows();
		expect(one.have).toBe(false);
		withBooks({ 1: "books/one.pdf" });
		openRulebook(1);
		expect(openBookReader).toHaveBeenCalledWith(1);
		expect(openRulebooksDialog).not.toHaveBeenCalled();
	});
});

describe("where the icons sit", () => {
	beforeEach(() => { vi.clearAllMocks(); withBooks({ 1: "books/one.pdf" }); });
	afterEach(() => { delete game.settings; });

	// The BANNER out of the sheet template, compiled on its own. Rendering the whole file would
	// pull in every tab partial for the sake of two icons in its first six lines, and the
	// fragment is exactly the thing under test.
	const drawHeader = () => {
		const markup = read(TOOLKIT_HBS);
		const fragment = markup.slice(markup.indexOf("<header"), markup.indexOf("</header>") + 9);
		return Handlebars.compile(fragment)({
			actor: { name: "GM Toolkit" },
			stonetop: { books: rulebookIconRows() },
		});
	};

	// The user asked for them on the sheet's own title row, NOT among the window controls next
	// to Close. Both halves are pinned: one is where they went, the other is where they left.
	it("is the sheet's banner and not the window header", async () => {
		const classes = makeSheet()._getHeaderButtons().map(b => b.class);
		expect(classes.join(" ")).not.toContain("book");
		expect(classes[0]).toContain("stonetop-open-steading");

		const header = drawHeader();
		expect(header).toContain("stonetop-gm-toolkit-name");
		expect(header).toContain('data-book="1"');
		expect(header).toContain('data-book="2"');
	});

	it("hands the sheet a row per book to draw", async () => {
		const context = await makeSheet().getData();
		expect(context.stonetop.books.map(b => b.book)).toEqual([1, 2]);
	});

	it("marks an unset book so it can be drawn dimmed, by a rule that exists", () => {
		const header = drawHeader();
		expect(header).toContain("stonetop-gm-toolkit-book--unset");
		expect(CSS).toContain(".stonetop-gm-toolkit-book--unset");
	});

	// Held to the RIGHT edge of the banner, and that takes both halves of the same pair the
	// steading's season clock uses. The auto margin does the pushing, but it only has slack to
	// push with while the title leaves the row unclaimed: put `flex: 1` back on the h1 and the
	// icons quietly slide back against the title with the margin still declared.
	it("parks the icons against the right edge of the banner", () => {
		const books = CSS.indexOf(".stonetop-gm-toolkit-books {");
		expect(books).toBeGreaterThan(-1);
		expect(CSS.slice(books, CSS.indexOf("}", books))).toContain("margin-left: auto");

		const name = CSS.indexOf(".stonetop-gm-toolkit-name {\n\tflex:");
		expect(name).toBeGreaterThan(-1);
		expect(CSS.slice(name, name + 90)).toContain("flex: 0 1 auto");
	});

	// Light grey at rest, slate on hover (user, 2026-08-29), the same pair the character sheet's
	// own Book I icon wears. `--st-text-muted` rather than a literal or `--st-text-faint`: faint
	// is the DISABLED token, and muted is the one re-pointed in every mode this system paints.
	it("is drawn in the light grey, not the body's near-black", () => {
		const at = CSS.indexOf(".stonetop-gm-toolkit-book {");
		const rule = CSS.slice(at, CSS.indexOf("}", at));
		expect(rule).toContain("color: var(--st-text-muted)");
		expect(rule).not.toContain("--st-text-body");
		expect(rule).not.toContain("--st-text-faint");

		const hover = CSS.indexOf(".stonetop-gm-toolkit-book:hover {");
		expect(CSS.slice(hover, CSS.indexOf("}", hover))).toContain("color: var(--st-btn-primary-bg)");
	});

	// The icon class goes on a child <i>, never on the <button>: `.vtt .stonetop button` sets a
	// font-family, and an FA class on the button itself loses its glyph to that and paints the
	// raw codepoint instead.
	it("puts the Font Awesome class on a child element, not on the button", () => {
		const header = drawHeader();
		const at = header.indexOf('class="stonetop-gm-toolkit-book');
		const button = header.slice(at, header.indexOf("</button>", at));
		expect(button).toMatch(/<i class="fas fa-book/);
		expect(button.slice(0, button.indexOf(">"))).not.toContain("fa-");
	});

	it("is wired on the sheet's own delegated click handler", () => {
		expect(SHEET_JS).toContain('closest(".stonetop-gm-toolkit-book")');
		expect(SHEET_JS).toContain("openRulebook(Number(bookIcon.dataset.book))");
	});
});

// FOLLOWING A CITATION. Every reference surface on the GM Toolkit prints the page it was
// transcribed from ("Book I, page 180"), and until this those were words. Now they are the way
// into the GM's own copy of that book, at that page.
//
// What has to hold is the PAGE, and it is the half with nothing to see when it is wrong: a
// citation cites the number printed in the book's corner, the spreads PDF puts two printed pages
// on every sheet, and handing the printed number straight to the viewer opens a real page of a
// real book 89 sheets past the one that was cited. So the printed number goes down as
// `printedPage` and the conversion happens against the loaded document -- see
// `goToPrintedPage` in BookReaderWindow.js, and the manifest-wide check in rulebooks.test.js.
describe("following a page citation", () => {
	beforeEach(() => { vi.clearAllMocks(); });
	afterEach(() => { delete game.settings; });

	it("opens the cited book at the PRINTED page, leaving the sheet arithmetic to the reader", () => {
		withBooks({ 1: "books/one.pdf" });
		openBookPage(1, 180);
		expect(openBookReader).toHaveBeenCalledWith(1, { printedPage: 180 });
		// Never a page of the file: this side cannot know which edition the GM owns.
		expect(openBookReader).not.toHaveBeenCalledWith(1, { page: 91 });
	});

	// Same answer the banner icons give, and for the same reason: a control that does nothing is
	// indistinguishable from a broken one, so a citation into a book this world has not been
	// pointed at opens the window that points it.
	it("opens the setup for a citation into a book this world has no copy of", () => {
		withBooks({ 2: "books/two.pdf" });
		openBookPage(1, 180);
		expect(openRulebooksDialog).toHaveBeenCalled();
		expect(openBookReader).not.toHaveBeenCalled();
	});

	// The one case the banner icons cannot reach. `book: 3` is the free GM playbook, a real value
	// elsewhere in this codebase, and no reader opens it -- so the setup would show a window
	// listing two books, neither of them the one that was clicked.
	it("does nothing at all for a book no reader knows about", () => {
		withBooks({ 1: "books/one.pdf" });
		expect(openBookPage(3, 4)).toBe(null);
		expect(openBookReader).not.toHaveBeenCalled();
		expect(openRulebooksDialog).not.toHaveBeenCalled();
	});

	// THE BEHAVIOUR LIVES WITH THE PARTIAL, not with one of its callers. The chip is precached
	// globally and styled at system scope, so any surface may print one; while the only thing that
	// made it work was a branch inside the GM Toolkit sheet, the next surface to print a row of
	// citations got chips that look pressable and do nothing, with no error to say why.
	it("reads the chip's own data, beside the opener it calls", () => {
		expect(ICONS_JS).toContain('".stonetop-book-cite"');
		expect(ICONS_JS).toContain("openBookPage(Number(cite.dataset.book), Number(cite.dataset.page))");
	});

	// One delegated listener on the sheet, not one per control: the sheet's handler asks this as a
	// link in its `closest` chain, which is why `followBookCite` answers whether it handled the
	// click rather than wiring a listener of its own.
	it("is asked for by the sheet's own delegated click handler", () => {
		expect(SHEET_JS).toContain("followBookCite(ev.target)");
	});

	// And a surface with no click chain of its own gets it in one call.
	it("offers a one-call wiring for a surface that has no chain to add it to", () => {
		expect(ICONS_JS).toContain("export function wireBookCites(root)");
	});
});
