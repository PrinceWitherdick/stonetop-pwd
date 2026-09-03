import Handlebars from "handlebars";
import { describe, it, expect } from "vitest";
import { readRepo as read, readCss } from "../../fakes/css.js";
import { bookPageCites, bookPageRef } from "../../../module/gm-toolkit/book-ref.js";
import { gmMoveSections } from "../../../module/gm-toolkit/gm-moves.js";
import { GM_CORE_LOOP, GM_FLOW_OF_PLAY } from "../../../module/gm-toolkit/gm-loop-text.js";
import { localizedHomefrontSections } from "../../../module/gm-toolkit/homefront-view.js";
import { RULEBOOKS } from "../../../module/books/rulebooks.js";

// "Book I, page 180" is a CONTROL now: it opens the GM's own copy of that book at that page
// (templates/actor/partials/book-page-cite.hbs -> openBookPage). This file is about the three
// ways that quietly goes wrong.
//
// ONE: the wrong words become the control. A move with a second printing reads "Book I, page 180,
// and again on page 352 for a site", and a single control over that whole sentence takes a GM who
// pressed "page 352" to page 180. So a citation is a LIST of chips, one per page it names.
//
// TWO: the wrong BOOK. Half the Homefront tab is Book II, and a citation shape that only ever
// says one book opens the wrong volume at a page that exists in it.
//
// THREE: a book nothing can open. `book: 3` is the free GM playbook -- a real value in this
// codebase and one no reader has a file for.
//
// The fourth, turning a printed page number into a page of a PDF, is not here: that is the
// reader's arithmetic and it is checked against the art importer's measurements in
// tests/books/rulebooks.test.js.

const CITE_HBS  = read("templates/actor/partials/book-page-cite.hbs");
const CSS       = readCss();
const BOOTSTRAP = read("stonetop.js");

const TABS = {
	moves:     "templates/actor/partials/gm-toolkit-tab-moves.hbs",
	loop:      "templates/actor/partials/gm-toolkit-tab-loop.hbs",
	homefront: "templates/actor/partials/gm-toolkit-tab-homefront.hbs",
};

/**
 * Every chip the three citing tabs actually draw.
 *
 * Off the BUILT view-models where there is one, rather than re-deriving from the source tables:
 * the Homefront tab's sections carry their citation on the finished body object and nothing else
 * on it says which page it came off, so a sweep that re-derived would silently skip the seven
 * citations that surface prints -- which is most of the Book II ones.
 */
function everyCite() {
	const moves = gmMoveSections().flatMap(s => s.moves).flatMap(bookPageCites);
	const stages = [...GM_CORE_LOOP, ...GM_FLOW_OF_PLAY].flatMap(bookPageCites);
	const homefront = localizedHomefrontSections().flatMap(({ body }) => [
		...(body.pageCites ?? []),
		...(body.groups ?? []).flatMap(g => g.pageCites ?? []),
		...(body.steps ?? []).flatMap(step => step.pageCites ?? []),
	]);
	return [...moves, ...stages, ...homefront];
}

describe("a page citation, broken into the pages it names", () => {
	it("is one chip, carrying the printed page it opens at", () => {
		expect(bookPageCites({ page: 180 })).toEqual([
			{ text: "Book I, page 180", book: 1, page: 180, sep: "", tip: "Open Book I at page 180" },
		]);
	});

	// The book is a NUMBER on the chip and a NUMERAL in the sentence: the reader is keyed by one
	// and the prose is written in the other, and conflating them is how "Book II" opens Book I.
	it("says the numeral but carries the number", () => {
		const [cite] = bookPageCites({ book: 2, page: 16 });
		expect(cite.text).toBe("Book II, page 16");
		expect(cite.book).toBe(2);
	});

	// The whole reason this is a list. Both chips name the same book; each opens its own page.
	it("splits a second printing into a chip of its own", () => {
		const cites = bookPageCites({ page: 180, pageAlt: 352 });
		expect(cites.map(c => c.page)).toEqual([180, 352]);
		expect(cites.map(c => c.book)).toEqual([1, 1]);
		expect(cites[1].text).toBe("and again on page 352 for a site");
		// The separator rides on the chip it comes BEFORE, so a template never asks which one it
		// is on -- and the sentence reads exactly as it did when it was one run of text.
		expect(cites[0].sep).toBe("");
		expect(cites[1].sep).toBe(", ");
	});

	it("has nothing to say about an entry with no page", () => {
		// Empty rather than null: Handlebars' `#if` reads an empty array as false, so a template
		// can be handed it unguarded.
		expect(bookPageCites({ book: 2 })).toEqual([]);
		expect(bookPageCites(undefined)).toEqual([]);
	});

	// Wrong in a way a reader can SEE, rather than one that silently prints someone else's page
	// as Book I's.
	it("prints an unknown book as its own digit", () => {
		expect(bookPageCites({ book: 9, page: 1 })[0].text).toBe("Book 9, page 1");
	});

	// The chat card cannot hold controls (random-gm-move.js builds its body as an HTML string),
	// so it gets the same citation flattened. Composed from the chips rather than formatted a
	// second way, which is what stops the card and the sheet wording it differently.
	it("flattens to the same sentence for the chat card", () => {
		expect(bookPageRef({ page: 180 })).toBe("Book I, page 180");
		expect(bookPageRef({ page: 180, pageAlt: 352 }))
			.toBe("Book I, page 180, and again on page 352 for a site");
		expect(bookPageRef({ book: 2, page: 16 })).toBe("Book II, page 16");
		expect(bookPageRef({ book: 2 })).toBe("");
	});
});

describe("every citation the toolkit prints", () => {
	// A citation into a book no reader knows about is a control that can do nothing when pressed.
	// Book III is the case: the free GM playbook, cited elsewhere in this codebase, with no file
	// behind it. Nothing on these three tabs may cite it without a reader to open it.
	it("names a book the reader has a row for", () => {
		const known = RULEBOOKS.map(b => b.book);
		const cites = everyCite();
		// A guard on the sweep: a view-model that stopped carrying its citations would leave
		// this passing on an empty list.
		expect(cites.length).toBeGreaterThan(40);
		const cited = [...new Set(cites.map(c => c.book))];
		expect(cited.length).toBeGreaterThan(1);
		expect(cited.filter(b => !known.includes(b))).toEqual([]);
	});

	// A page of 0, or one past the end of the book, is a jump into nothing. The spreads editions
	// are 308 and 302 sheets, which is twice that many printed pages.
	it("names a page that is inside the book it names", () => {
		for (const cite of everyCite()) {
			const entry = RULEBOOKS.find(b => b.book === cite.book);
			expect(cite.page, cite.text).toBeGreaterThan(0);
			expect(cite.page, cite.text).toBeLessThan(entry.spreadPages * 2);
		}
	});
});

describe("the citation partial", () => {
	const render = (cites) => {
		const hb = Handlebars.create();
		hb.registerPartial("stonetop.book-page-cite", CITE_HBS);
		return hb.compile("<p>{{> \"stonetop.book-page-cite\" cites=cites}}</p>")({ cites });
	};

	// A real <button>: Enter and Space reach it with no keydown handler of ours, and a <span>
	// with a click handler is mouse-only in a way nothing on screen shows.
	it("draws a button per chip, carrying the book and the printed page", () => {
		const html = render(bookPageCites({ page: 180, pageAlt: 352 }));
		const buttons = html.match(/<button [^>]*class="stonetop-book-cite"[^>]*>/g) ?? [];
		expect(buttons).toHaveLength(2);
		expect(buttons[0]).toContain("type=\"button\"");
		expect(buttons[0]).toContain("data-book=\"1\"");
		expect(buttons[0]).toContain("data-page=\"180\"");
		expect(buttons[1]).toContain("data-page=\"352\"");
		// Nothing on the row says what pressing it does, so the tooltip is the only place it is.
		expect(buttons[0]).toContain("data-tooltip=\"Open Book I at page 180\"");
	});

	// It replaces a run of text mid-sentence, so a stray newline out of the partial is a stray
	// space in the prose around it.
	it("emits no whitespace of its own", () => {
		expect(render(bookPageCites({ page: 180 }))).toBe(
			"<p><button type=\"button\" class=\"stonetop-book-cite\" data-book=\"1\" data-page=\"180\""
			+ " data-tooltip=\"Open Book I at page 180\">Book I, page 180</button></p>");
		expect(render([])).toBe("<p></p>");
	});

	it("is registered under the name the tabs call it by", () => {
		expect(BOOTSTRAP).toContain("\"stonetop.book-page-cite\":");
		expect(BOOTSTRAP).toContain("templates/actor/partials/book-page-cite.hbs");
	});

	// Four places print a citation and every one of them has to go through the partial. A tab
	// left printing the flat string renders perfectly and is simply not clickable, which is the
	// kind of thing nobody notices until they try it.
	it("is what every citing surface uses, with no flat string left behind", () => {
		for (const [tab, path] of Object.entries(TABS)) {
			const hbs = read(path);
			expect(hbs, tab).toContain("{{> \"stonetop.book-page-cite\"");
			expect(hbs, tab).not.toMatch(/\{\{ *\w*\.?pageRef *\}\}/);
		}
		// Homefront cites in three shapes -- a group, a step, and the section's own line -- and
		// each is its own branch of the template.
		expect(read(TABS.homefront).match(/\{\{> "stonetop\.book-page-cite"/g)).toHaveLength(3);
	});
});

describe("how a citation is drawn", () => {
	const rule = (selector) => {
		const at = CSS.indexOf(selector);
		expect(at, selector).toBeGreaterThan(-1);
		return CSS.slice(at, CSS.indexOf("}", at));
	};

	// Core anchors a BUTTON's font-size in pixels while the prose around it is set in em off the
	// reader's own text scale, so a citation that did not inherit would drift a size away from
	// its own sentence at every setting but the default. Core also gives buttons a block box and
	// a full-width stretch, either of which breaks it out of the line it belongs to.
	it("takes its type and its box from the sentence it sits in", () => {
		const base = rule(".stonetop .stonetop-book-cite {");
		expect(base).toContain("font: inherit");
		expect(base).toContain("color: inherit");
		expect(base).toContain("display: inline");
		expect(base).toContain("width: auto");
		expect(base).toContain("background: none");
		expect(base).toContain("cursor: pointer");
	});

	// Core paints a background on button hover, which over a run of text inside a paragraph reads
	// as a highlighter mark.
	it("answers the pointer with ink and an underline, not with a filled box", () => {
		expect(rule(".stonetop .stonetop-book-cite:hover,")).toContain("background: none");
		const hover = rule(".stonetop .stonetop-book-cite:hover {");
		expect(hover).toContain("color: var(--st-text)");
		expect(hover).toContain("text-decoration: underline solid");
	});

	// It is reachable by keyboard, so it has to be visible when it is reached.
	it("shows a focus ring", () => {
		expect(rule(".stonetop .stonetop-book-cite:focus-visible {")).toContain("outline: 2px solid");
	});
});
