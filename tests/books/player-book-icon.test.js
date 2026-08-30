import Handlebars from "handlebars";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readRepo as read, readCss } from "../fakes/css.js";

// The reader is stubbed: what is under test is WHETHER the icon is drawn and what a click on it
// reaches for, not the window at the end of it.
vi.mock("../../module/books/BookReaderWindow.js", () => ({ openBookReader: vi.fn(() => ({})) }));
vi.mock("../../module/books/RulebooksDialog.js", () => ({ openRulebooksDialog: vi.fn() }));

import { readyRulebookIcon, openSharedRulebook } from "../../module/books/rulebook-icons.js";
import { openBookReader } from "../../module/books/BookReaderWindow.js";
import { openRulebooksDialog } from "../../module/books/RulebooksDialog.js";
import { RULEBOOKS_SETTING } from "../../module/books/rulebooks.js";

const HEADER_HBS = "templates/actor/partials/actor-header.hbs";
const SHEET_JS   = read("module/actors/character/StonetopCharacterSheet.js");
const CSS        = readCss();

function withBooks(paths = {}) {
	game.settings = { get: (_scope, key) => (key === RULEBOOKS_SETTING ? paths : undefined) };
}

// The PLAYBOOK ROW out of the header partial, compiled on its own. The partial as a whole pulls
// in the portrait pip and the condemned tag; this is the row the icon was asked to sit at the end
// of, and it is the whole of what is under test.
function drawPlaybookRow(book) {
	const markup = read(HEADER_HBS);
	const open = markup.indexOf('<div class="stonetop-playbook-row">');
	const fragment = markup.slice(open, markup.indexOf("</div>", markup.indexOf("{{#if stonetop.book}}")) + 6);
	return Handlebars.compile(fragment)({ stonetop: { playbook: { name: "The Blessed" }, book } });
}

describe("Book I on a player's own sheet", () => {
	beforeEach(() => { vi.clearAllMocks(); });
	afterEach(() => { delete game.settings; });

	// The whole condition the user set: the GM has to hook the PDF up first. A player cannot,
	// so the dimmed "press me to fix this" state the GM Toolkit wears would be an icon offering
	// them a window their own account refuses.
	it("is not offered at all until this world has a copy", () => {
		withBooks({});
		expect(readyRulebookIcon(1)).toBe(null);
		expect(drawPlaybookRow(null)).not.toContain("stonetop-open-book");
	});

	it("appears for the whole table the moment the GM sets one", () => {
		withBooks({ 1: "stonetop-books/book-i.pdf" });
		const row = readyRulebookIcon(1);
		expect(row).toMatchObject({ book: 1, icon: "fas fa-book", label: "Book I", have: true });
		expect(row.tooltip).toBe("Open Book I: Stonetop");
		expect(drawPlaybookRow(row)).toContain("stonetop-open-book");
	});

	// Book I is the rules a player plays by. Book II is the gazetteer, which stays on the GM's
	// side of the screen even in a world that has both.
	it("is Book I only, whatever else the world has", () => {
		withBooks({ 1: "books/one.pdf", 2: "books/two.pdf" });
		const row = drawPlaybookRow(readyRulebookIcon(1));
		expect(row).toContain("fas fa-book");
		expect(row).not.toContain("fa-book-atlas");
		expect(SHEET_JS).toMatch(/const PLAYER_BOOK = 1;/);
	});

	it("opens the reader", () => {
		withBooks({ 1: "books/one.pdf" });
		openSharedRulebook(1);
		expect(openBookReader).toHaveBeenCalledWith(1);
	});

	// A GM who forgets a book while a player has the sheet open is an ordinary evening. Opening
	// the setup would show that player a window whose every control their account refuses, so
	// they are told in a line instead, and told whose job it is.
	it("says whose job it is rather than opening a setup a player cannot use", () => {
		withBooks({});
		const warn = vi.fn();
		const before = global.ui.notifications;
		global.ui.notifications = { ...before, warn };
		try { expect(openSharedRulebook(1)).toBe(null); }
		finally { global.ui.notifications = before; }
		expect(openRulebooksDialog).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalled();
		expect(warn.mock.calls[0][0]).toContain("Your GM adds one");
	});
});

describe("where it sits on the sheet", () => {
	afterEach(() => { delete game.settings; });

	it("is the last thing in the playbook row, held to the far end", () => {
		withBooks({ 1: "books/one.pdf" });
		const row = drawPlaybookRow(readyRulebookIcon(1));
		// After the playbook name, not before it.
		expect(row.indexOf("stonetop-open-book"))
			.toBeGreaterThan(row.indexOf("stonetop-playbook-drop-zone"));
		// `margin-left: auto` is what does the placing; the row's other items are content-width.
		const at = CSS.indexOf(".stonetop-open-book {");
		expect(at).toBeGreaterThan(-1);
		expect(CSS.slice(at, CSS.indexOf("}", at))).toContain("margin-left: auto");
	});

	// Light grey at rest, slate on hover (user, 2026-08-29). `--st-text-muted` rather than a
	// literal or `--st-text-faint`: faint is the DISABLED token, and muted is the one re-pointed
	// in every mode, so it stays light on dark paper and legible under high contrast.
	it("is drawn in the light grey, not the body's near-black", () => {
		const at = CSS.indexOf(".stonetop-open-book {");
		const rule = CSS.slice(at, CSS.indexOf("}", at));
		expect(rule).toContain("color: var(--st-text-muted)");
		expect(rule).not.toContain("--st-text-body");
		expect(rule).not.toContain("--st-text-faint");

		const hover = CSS.indexOf(".stonetop-open-book:hover {");
		expect(CSS.slice(hover, CSS.indexOf("}", hover))).toContain("color: var(--st-btn-primary-bg)");
	});

	// The icon class goes on a child <i>, never on the <button>: `.vtt .stonetop button` sets a
	// font-family, and an FA class on the button itself loses its glyph to that and paints the
	// raw codepoint instead.
	it("puts the Font Awesome class on a child element, not on the button", () => {
		withBooks({ 1: "books/one.pdf" });
		const row = drawPlaybookRow(readyRulebookIcon(1));
		const at = row.indexOf('class="stonetop-open-book"');
		const button = row.slice(at, row.indexOf("</button>", at));
		expect(button).toMatch(/<i class="fas fa-book"/);
		expect(button.slice(0, button.indexOf(">"))).not.toContain("fa-");
	});

	// Wired for READERS as well as owners, like the header's scales and unlike its candle:
	// opening the rules is looking, not writing, so it is not behind an editable guard.
	it("is wired without an editable guard", () => {
		expect(SHEET_JS).toContain('html.find(".stonetop-open-book").on("click"');
		expect(SHEET_JS).toContain("openSharedRulebook(PLAYER_BOOK)");
		expect(read(HEADER_HBS)).not.toMatch(/\{\{#if editable\}\}[\s\S]{0,200}stonetop-open-book/);
	});
});
