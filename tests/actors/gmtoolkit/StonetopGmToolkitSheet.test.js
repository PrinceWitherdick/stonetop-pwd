import Handlebars from "handlebars";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readRepo as read, readCss, repoFileExists } from "../../fakes/css.js";
import { createStonetopGmToolkitSheetClass } from "../../../module/actors/gmtoolkit/StonetopGmToolkitSheet.js";
import { BASIC_GM_MOVES, EXPLORATION_GM_MOVES, HOMEFRONT_GM_MOVES, gmMoveSections } from "../../../module/gm-toolkit/gm-moves.js";
import { actorOptionsFor } from "../../../module/dialogs/create-actor-dialog.js";
import { FLASH_CLASS, FLASH_MS, SPIN_CLASS } from "../../../module/utils/flash-highlight.js";
import { postGmMove } from "../../../module/gm-toolkit/random-gm-move.js";
import { moveBlurb } from "../../../module/gm-toolkit/gm-move-blurb.js";
import { escHtml } from "../../../module/utils/strings.js";

// The GM Toolkit: the GM's own actor sheet, the screen-side companion to the GM playbook.
//
// Most of what can go wrong here goes wrong SILENTLY, which is why so much of this file
// asserts on source text rather than on behaviour. A missing registration leg renders a blank
// sheet; a renamed header class moves the tab rail to a fallback position that looks nearly
// right; a `data-tab` key with no icon mapping paints a solid block where the glyph should be.
// None of those throw, and none show up in a render test that only checks the moves are there.


const SHEET_JS      = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");
// The draw/walk/whisper sequence itself lives here, shared with the expedition rail, so the
// guards below that are about the ORDER of those beats read this file and the ones about how
// this sheet WIRES it read the sheet.
const DRAWER_JS     = read("module/gm-toolkit/gm-move-drawer.js");
const STONETOP_JS   = read("stonetop.js");
const SYSTEM_JSON   = read("system.json");
const SHEET_HBS     = read("templates/actor/gm-toolkit.hbs");
const MOVES_HBS     = read("templates/actor/partials/gm-toolkit-tab-moves.hbs");
const EXPEDITION_JS = read("module/dialogs/ExpeditionDialog.js");
const CSS           = readCss();

// Both files discuss at length the very things being forbidden below, so the prose has to come
// out first or a guard fails on its own rationale.
const stripComments = src => src
	.replace(/\{\{!--[\s\S]*?--\}\}/g, "")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/\/\/[^\n]*/g, "");

/**
 * The sheet, over a five-line stand-in for Foundry's ActorSheet. `options` and `position` are
 * what withSheetSizeMemory writes a restored size into on construction.
 */
function makeSheet(actor = { id: "toolkit1", name: "GM Toolkit", system: {} }) {
	const Base = class {
		options  = {};
		position = {};
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		static get defaultOptions() { return { classes: [], resizable: false }; }
		async getData() { return {}; }
		activateListeners() {}
		// What core's Application hands the sheet: the gear, the token link, Close.
		_getHeaderButtons() {
			return [
				{ label: "Sheet",     class: "configure-sheet", icon: "fas fa-cog" },
				{ label: "Prototype", class: "configure-token", icon: "fas fa-user-circle" },
				{ label: "Close",     class: "close",           icon: "fas fa-times" },
			];
		}
	};
	const Sheet = createStonetopGmToolkitSheetClass(Base);
	return new Sheet();
}

describe("GM Toolkit move lists", () => {
	// The counts the GM playbook's first spread prints. A move quietly dropped in an edit is
	// otherwise invisible: the tab still renders, just missing one line out of thirty.
	it("carries every move the playbook prints, in its three sections", () => {
		expect(BASIC_GM_MOVES).toHaveLength(13);
		expect(EXPLORATION_GM_MOVES).toHaveLength(7);
		expect(HOMEFRONT_GM_MOVES).toHaveLength(10);
	});

	it("keeps the playbook's order rather than sorting", () => {
		expect(BASIC_GM_MOVES[0].name).toBe("Announce trouble (future or offscreen)");
		expect(BASIC_GM_MOVES.at(-1).name).toBe("Advance towards impending doom");
		expect(EXPLORATION_GM_MOVES[0].name).toBe("Provide a choice of paths");
		expect(EXPLORATION_GM_MOVES.at(-1).name).toBe("Bar the way");
		expect(HOMEFRONT_GM_MOVES[0].name).toBe("Introduce someone interesting");
		expect(HOMEFRONT_GM_MOVES.at(-1).name).toBe("Play them against each other");
	});

	it("gives every move a gloss", () => {
		for (const move of [...BASIC_GM_MOVES, ...EXPLORATION_GM_MOVES, ...HOMEFRONT_GM_MOVES]) {
			expect(move.gloss, move.name).toBeTruthy();
		}
	});

	// The GM playbook's Homefront list is the GM's moves for at-home play. The steading sheet's
	// "Homefront Moves" tab is the PLAYERS' homefront moves (Bolster, Muster, Seasons Change...).
	// Two different things with one name, in one world, sometimes on screen together. This pins
	// the fact that they share no entries, so a later edit cannot merge them by accident.
	it("does not overlap the steading's player-facing Homefront moves", () => {
		const players = ["Bolster", "Convalesce", "Deploy", "Make a Plan", "Meet with Disaster",
			"Muster", "Pull Together", "Seasons Change", "Trade and Barter"];
		const gm = HOMEFRONT_GM_MOVES.map(m => m.name);
		for (const name of players) expect(gm).not.toContain(name);
	});

	// The Expedition walkthrough teaches these same seven, and a GM meets both surfaces in the
	// same session. It READS this table instead of restating it, so "same move, same words"
	// holds by construction. What is pinned is that it still does: the failure mode this
	// replaces is somebody pasting the list back in as literal prose, after which the two
	// screens are free to drift with nothing to say so.
	//
	// The walkthrough shows them in a right-hand rail now rather than in a step of their own,
	// so what carries the list is EXPLORATION_SIDEBAR_MOVES, a mapped array, and the assertion
	// on its CONTENT is in tests/dialogs/expedition-moves-rail.test.js, where the array itself
	// can be read. What is left here is the half this file is for: that no second copy of the
	// words has appeared in that file's source.
	it("hands the Expedition walkthrough the same list rather than a second copy", () => {
		expect(EXPEDITION_JS).toContain('import { EXPLORATION_GM_MOVES } from "../gm-toolkit/gm-moves.js"');
		expect(EXPEDITION_JS).toMatch(/EXPLORATION_SIDEBAR_MOVES\s*=\s*EXPLORATION_GM_MOVES\.map\(/);

		// No literal move survives anywhere in the walkthrough's own prose. The step bodies
		// are the risk: they are template literals of authored HTML, which is exactly where a
		// paste-back would land. Comments are stripped first — this file's own header
		// discusses the moves by name, and so does the one being read.
		const prose = stripComments(EXPEDITION_JS);
		for (const move of EXPLORATION_GM_MOVES) {
			expect(prose, `${move.name} is written out again`).not.toContain(move.name);
			expect(prose, `${move.name}'s gloss is written out again`).not.toContain(move.gloss);
		}
	});
});

// What Book I prints UNDER each move: its description, the soft/hard line, its examples of play,
// and the page. Transcribed in gm-moves.js and shown in two places (the sheet's expanded entry,
// the whispered card), so what these guard is the transcription itself: a move that lost its
// examples still renders, still reads, and is simply missing the half a GM came for.
describe("the book's own text, per move", () => {
	const ALL_MOVES = [...BASIC_GM_MOVES, ...EXPLORATION_GM_MOVES, ...HOMEFRONT_GM_MOVES];

	it("gives every move at least one example of play, in the book's words", () => {
		for (const move of ALL_MOVES) {
			expect(move.examples, `${move.name} has no examples`).toBeInstanceOf(Array);
			expect(move.examples.length, `${move.name} has no examples`).toBeGreaterThan(0);
			for (const example of move.examples) {
				expect(example.length, `${move.name} has a stub example`).toBeGreaterThan(40);
			}
		}
	});

	// The renderers add the quotation marks, so an example that brought its own would print
	// doubled ones on the card and in the sheet's expanded entry.
	it("leaves the outer quotation marks off the examples", () => {
		for (const move of ALL_MOVES) {
			for (const example of move.examples) {
				expect(example.startsWith('"'), `${move.name} quotes its own example`).toBe(false);
				expect(example.endsWith('"'), `${move.name} quotes its own example`).toBe(false);
			}
		}
	});

	// Either the book's description or (for Capture someone, whose whole entry IS its soft/hard
	// guidance) that guidance. One or the other, never neither: an entry that expands to nothing
	// but a page number is a disclosure that wasted the click.
	it("gives every move something to expand to", () => {
		for (const move of ALL_MOVES) {
			const has = (move.detail?.length ?? 0) > 0 || !!move.hardness;
			expect(has, `${move.name} expands to nothing`).toBe(true);
		}
	});

	it("cites the page every move was transcribed from", () => {
		for (const move of ALL_MOVES) {
			expect(move.page, `${move.name} has no page`).toBeGreaterThan(0);
		}
		// The three lists come out of three different chapters, and a page from the wrong one is
		// the kind of thing that is only ever found by a GM who turns to it.
		for (const move of BASIC_GM_MOVES)       expect(move.page).toBeGreaterThanOrEqual(180);
		for (const move of BASIC_GM_MOVES)       expect(move.page).toBeLessThanOrEqual(188);
		for (const move of EXPLORATION_GM_MOVES) expect(move.page).toBeGreaterThanOrEqual(317);
		for (const move of EXPLORATION_GM_MOVES) expect(move.page).toBeLessThanOrEqual(321);
		for (const move of HOMEFRONT_GM_MOVES)   expect(move.page).toBeGreaterThanOrEqual(502);
		for (const move of HOMEFRONT_GM_MOVES)   expect(move.page).toBeLessThanOrEqual(507);
	});

	// The exploration moves are printed twice, once for expeditions and again for sites. What is
	// transcribed is the expedition printing (the fuller of the two, and the only one carrying the
	// hard-move notes), so the citation has to name the other or a GM reading a site will not find
	// the entry where they are looking.
	it("names both printings of the exploration moves, and only those", () => {
		for (const move of EXPLORATION_GM_MOVES) {
			expect(move.pageAlt, `${move.name} does not cite the sites printing`).toBeGreaterThan(340);
		}
		for (const move of [...BASIC_GM_MOVES, ...HOMEFRONT_GM_MOVES]) {
			expect(move.pageAlt, `${move.name} is only printed once`).toBeUndefined();
		}
	});

	// The soft/hard line is the operative one when the die is clicked right after a 6-. The book
	// gives one for twelve of the thirty and is silent on the other eighteen, and the silence is
	// KEPT: an invented "as a hard move" would be house rules wearing the book's voice. The count
	// is pinned exactly, because both ways of getting it wrong are silent, and an entry that
	// quietly grew a line nobody wrote in Book I is the worse of the two.
	it("carries the book's soft/hard line for the twelve that have one, and no invented ones", () => {
		const withGuidance = ALL_MOVES.filter(m => m.hardness);
		expect(withGuidance).toHaveLength(12);
		for (const move of withGuidance) {
			expect(move.hardness, `${move.name} has guidance that says neither soft nor hard`)
				.toMatch(/\b(hard|soft)\b/);
		}
	});

	// The gloss is OURS and the detail is the BOOK'S, and the two must not become one thing: the
	// gloss is what the Expedition walkthrough renders, in the house voice, one line long.
	it("keeps our one-line gloss separate from the book's description", () => {
		for (const move of ALL_MOVES) {
			expect(move.gloss.length, `${move.name} has a gloss the size of a paragraph`).toBeLessThan(120);
			expect(move.detail).not.toContain(move.gloss);
		}
	});
});

describe("gmMoveSections", () => {
	it("boxes each section under its own fold id", () => {
		const ids = gmMoveSections().map(s => s.collapseId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("names every section through the localization table", () => {
		for (const section of gmMoveSections()) {
			// A missing key localizes to itself, so this catches a typo the sheet would
			// otherwise render as a raw dotted path in place of the heading.
			expect(game.i18n.localize(section.titleKey)).not.toBe(section.titleKey);
			expect(game.i18n.localize(section.noteKey)).not.toBe(section.noteKey);
		}
	});
});

describe("StonetopGmToolkitSheet", () => {
	it("publishes the three move sections, localized, in playbook order", async () => {
		const data = await makeSheet().getData();
		const sections = data.stonetop.moveSections;

		expect(sections.map(s => s.key)).toEqual(["basic", "exploration", "homefront"]);
		expect(sections.map(s => s.title)).toEqual(["GM Moves", "Exploration", "Homefront"]);
		expect(sections.map(s => s.moves.length)).toEqual([13, 7, 10]);
		expect(sections[1].note).toBe("On an expedition, or inside a site");
	});

	it("opens on the moves tab, wired to the nav and body the template renders", async () => {
		const { tabs } = makeSheet().constructor.defaultOptions;
		expect(tabs).toEqual([
			{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "moves" },
		]);
		// A mismatch between any of these three and the markup renders a blank body.
		expect(SHEET_HBS).toContain('class="sheet-tabs tabs stonetop-tab-rail"');
		expect(SHEET_HBS).toContain('<section class="sheet-body">');
		expect(MOVES_HBS).toContain('data-tab="moves"');
	});

	// Foundry's Tabs binds a nav and its panels by `data-group`. Mismatch them and the controller
	// binds a group nothing answers to: the rail renders, the button highlights, and the body
	// never activates.
	it("uses one tab group across the nav and the panel", () => {
		expect(SHEET_HBS).toMatch(/<nav[^>]*data-group="primary"/s);
		expect(MOVES_HBS).toMatch(/<div class="tab moves"[^>]*data-group="primary"/);
	});

	// The sheet template is the thing Foundry renders. Everything else in this file reads the
	// PARTIAL off disk, which holds whether or not the sheet includes it, so without these two
	// the suite is green on a sheet with an empty body and a rail with no buttons.
	it("actually mounts its tab and its only rail button", () => {
		expect(SHEET_HBS).toContain('{{> "stonetop.gm-toolkit-tab-moves"}}');
		expect(SHEET_HBS).toMatch(/\{\{>\s*"stonetop\.tab-rail-item"\s+tab="moves"/);
	});

	// Nothing on this sheet is a drop target: ActorSheet's default entry has no dropSelector, so
	// the whole window-content accepts drops and the inherited handler attaches the dropped Item
	// to an actor that renders no item list and offers no way to delete it.
	it("accepts no document drops", () => {
		expect(makeSheet().constructor.defaultOptions.dragDrop).toEqual([]);
	});

	// Without "stonetop" the frame loses the parchment skin, the rail's button colours, and
	// the `overflow: visible` that stops the window clipping a rail hung outside it. Without
	// "gm-toolkit" the height floor and the whole sheet block in stonetop.css stop matching.
	it("wears the frame classes its CSS is written against", () => {
		const { classes } = makeSheet().constructor.defaultOptions;
		expect(classes).toEqual(["stonetop", "sheet", "actor", "gm-toolkit"]);
	});

	// The gear offers a choice of sheet class, and `gmToolkit` has exactly one — so it only ever
	// offers the sheet already on screen. In its place, the same steading shortcut the character
	// sheet's header carries: this sheet's Threats and Sites tabs read their storage OFF the
	// steading, so the jump is the one link this header owes.
	describe("the header", () => {
		const withActors = (actors, fn) => {
			const before = game.actors;
			game.actors = actors;
			try { return fn(); } finally { game.actors = before; }
		};

		it("drops the sheet-configuration gear", () => {
			const buttons = withActors([], () => makeSheet()._getHeaderButtons());
			expect(buttons.some(b => b.class === "configure-sheet")).toBe(false);
			// Only the gear goes — the rest of core's header is untouched.
			expect(buttons.map(b => b.class)).toContain("configure-token");
			expect(buttons.map(b => b.class)).toContain("close");
		});

		it("leads with a Stonetop button that opens the steading, named for it", () => {
			const sheet = { render: vi.fn() };
			const steading = { type: "stonetop", name: "Stonetop", sheet };
			const [first] = withActors([steading], () => makeSheet()._getHeaderButtons());

			expect(first.class).toBe("stonetop-open-steading");
			expect(first.label).toBe("Stonetop");
			expect(first.icon).toBe("fas fa-map-marker-alt");

			withActors([steading], () => first.onclick());
			expect(sheet.render).toHaveBeenCalledWith(true, { focus: true });
		});

		// No steading in the world yet: the button still draws, wearing the unset-state class,
		// and says so rather than throwing on a null sheet.
		it("marks itself unset when the world has no steading", () => {
			const warn = vi.fn();
			global.ui = { ...(global.ui ?? {}), notifications: { warn } };
			const [first] = withActors([], () => makeSheet()._getHeaderButtons());

			expect(first.class).toContain("stonetop-open-steading--unset");
			expect(() => withActors([], () => first.onclick())).not.toThrow();
			expect(warn).toHaveBeenCalled();
		});
	});

	// A `get template()` pointing at a file that is not there fails only when someone opens
	// the sheet, and one dropped hyphen does it. Resolve the path the way Foundry does and
	// look on disk.
	it("names a template that actually exists", () => {
		const declared = makeSheet().template;
		expect(declared).toMatch(/^systems\/stonetop-pwd\/templates\//);
		expect(repoFileExists(declared.replace("systems/stonetop-pwd/", "")), `${declared} does not exist`).toBe(true);
	});
});

// Render the REAL partial with the REAL section-heading, so the assertions below are about the
// markup that ships rather than about a description of it.
function renderMovesTab(stonetop) {
	const hb = Handlebars.create();
	hb.registerHelper("localize", k => k);
	hb.registerPartial("stonetop.section-heading", read("templates/actor/partials/section-heading.hbs"));
	hb.registerPartial("stonetop.section-collapse", read("templates/actor/partials/section-collapse.hbs"));
	hb.registerPartial("stonetop.section-randomize", read("templates/actor/partials/section-randomize.hbs"));
	return hb.compile(MOVES_HBS)({ stonetop });
}

describe("the rendered moves tab", () => {
	it("puts every heading INSIDE its own move-group box", async () => {
		const html = renderMovesTab((await makeSheet().getData()).stonetop);

		// The fold walk claims a heading's FOLLOWING SIBLINGS up to the next heading. A heading
		// that escapes its box therefore swallows every section below it, and the sheet still
		// renders perfectly until someone clicks a caret. Split on the box opening: anything
		// before the FIRST box, or between a box's close and the next box's open, is a heading
		// that got out.
		const chunks = html.split(/<div class="stonetop-move-group"/);
		expect(chunks).toHaveLength(4);   // preamble + 3 move sections
		expect(chunks[0]).not.toContain("stonetop-move-group-title");
		for (const chunk of chunks.slice(1)) {
			expect((chunk.match(/stonetop-move-group-title/g) ?? [])).toHaveLength(1);
			// Exactly one list per box.
			expect((chunk.match(/<ol /g) ?? [])).toHaveLength(1);
			// The heading must come FIRST inside the box, ahead of the list it folds.
			expect(chunk.indexOf("stonetop-move-group-title")).toBeLessThan(chunk.indexOf("<ol"));
		}
	});

	it("gives each heading a caret named for its own section", async () => {
		const html = renderMovesTab((await makeSheet().getData()).stonetop);
		const ids = [...html.matchAll(/class="stonetop-section-collapse" data-section="([^"]+)"/g)].map(m => m[1]);
		expect(ids).toEqual(["gmMovesBasic", "gmMovesExploration", "gmMovesHomefront"]);
	});

	// The book's text, sat under each entry behind a disclosure. Every leg of this is silent: a
	// panel that renders open turns a scannable list into a chapter, a button with no
	// `aria-expanded` is a control a screen reader cannot report, and a missing panel is a caret
	// that promises something the row does not have.
	it("hides the book's text behind a disclosure on every entry", async () => {
		const html = renderMovesTab((await makeSheet().getData()).stonetop);

		expect((html.match(/class="stonetop-gm-move-toggle" aria-expanded="false"/g) ?? []))
			.toHaveLength(30);
		expect((html.match(/class="stonetop-gm-move-book" hidden/g) ?? [])).toHaveLength(30);
		// The panel is the button's own NEXT-ISH sibling inside the entry, which is what lets the
		// handler find it without an id per entry (see utils/disclosure.js).
		expect(html).toMatch(/<button[^>]*stonetop-gm-move-toggle[\s\S]{0,400}?stonetop-gm-move-book/);
	});

	// The row is ONE blurb: the book's first sentence is the visible label, and the rest of that
	// same paragraph is revealed inline after it, inside the button, so the words already on
	// screen do not move when the entry opens.
	it("leads with the book's own first sentence and grows the rest in place", async () => {
		const html = renderMovesTab((await makeSheet().getData()).stonetop);
		const { lead, rest } = moveBlurb(BASIC_GM_MOVES[0]);

		expect(lead).toBe("This is one of your most versatile moves.");
		expect(html).toContain(`<span class="stonetop-gm-move-lead">${lead}</span>`);
		// The remainder sits INSIDE the button, hidden, immediately after the lead: that is what
		// makes the sentence continue rather than a second block appear under it.
		expect(html).toContain(`<span class="stonetop-gm-move-rest" hidden> ${rest}</span>`);
		expect(html).toMatch(/stonetop-gm-move-lead[^<]*<\/span><span class="stonetop-gm-move-rest"/);
		// Our gloss is NOT what the row shows any more. It stays in the data (the Expedition
		// walkthrough renders it, the whispered card leads with it), just not here, where it would
		// have to be read and then replaced by the book saying the same thing again.
		expect(html).not.toContain(BASIC_GM_MOVES[0].gloss);
	});

	it("prints the book's description, examples and page inside that panel", async () => {
		const html = renderMovesTab((await makeSheet().getData()).stonetop);
		const first = BASIC_GM_MOVES[0];

		expect(html).toContain(first.hardness.slice(0, 40));
		// Every example of every move, not just the one the card quotes: the card is read under
		// pressure and takes one, the sheet is where you go to read the rest.
		const examples = [...BASIC_GM_MOVES, ...EXPLORATION_GM_MOVES, ...HOMEFRONT_GM_MOVES]
			.flatMap(m => m.examples);
		expect((html.match(/class="stonetop-gm-move-example"/g) ?? [])).toHaveLength(examples.length);
		// Localized at the boundary, so the template prints a finished string rather than
		// assembling "Book I, page" + a number itself.
		expect(html).toContain("Book I, page 180");
		expect(html).toContain("and again on page 352 for a site");
	});

	it("renders every move, name and blurb", async () => {
		const html = renderMovesTab((await makeSheet().getData()).stonetop);
		expect(html.match(/stonetop-gm-move"/g)).toHaveLength(30);
		expect(html).toContain("Announce trouble (future or offscreen)");
		expect(html).toContain("Bar the way");
		expect(html).toContain("Play them against each other");
		// Every entry leads with something, including the one whose whole book entry is its
		// soft/hard line and so has no description to lead with.
		expect((html.match(/class="stonetop-gm-move-lead"/g) ?? [])).toHaveLength(30);
		// The book's text carries apostrophes and quoted speech, which Handlebars escapes. That is
		// correct and must not be "fixed" into a triple-stache.
		expect(html).toContain("&#x27;If you do that, you realize that ___, right?&#x27;");
	});
});

// The entries are deliberately NOT the bordered card the rest of the system sets a move in:
// they are a two-column reference list, each entry a name with its gloss on the line below.
// The panel still wears `.tab.moves`, so the card chrome comes with it and has to be undone
// rule for rule at the foot of stonetop.css.
//
// Every failure here is SILENT: the moves still render and still read, they just quietly turn
// back into a variable number of columns of boxes, or start handing an entry's gloss to the
// top of the next column where it reads as belonging to a different move.
describe("the Moves tab is a two-column reference list, not a card list", () => {
	const bodyOf = selector => {
		const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return CSS.match(new RegExp(`\\n${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
	};

	// The shared rule sets a column WIDTH (240px) as well as a count, and when both are
	// declared the used count is the SMALLER of the two. Override only the count and the list
	// still reads as two columns at the default width, then silently collapses to one as soon
	// as the frame is narrowed past 2×240px.
	it("fixes the list at two columns, at every width", () => {
		const list = bodyOf(".stonetop-gm-toolkit-moves .stonetop-move-group .items-list");
		expect(list, "no override for the shared column layout").toMatch(/column-count:\s*2/);
		expect(list, "the shared 240px column-width would cap the count on a narrow frame")
			.toMatch(/column-width:\s*initial/);
	});

	// One line down the middle, drawn by the container. Painted per-entry instead it would stop
	// and restart at every hairline.
	it("divides the two columns with a column rule", () => {
		expect(bodyOf(".stonetop-gm-toolkit-moves .stonetop-move-group .items-list"))
			.toMatch(/column-rule:\s*1px/);
	});

	// An entry wears its OWN classes, not the shared move card's with the chrome unset again.
	// Wearing `stonetop-item` cost thirteen declarations of `border: none` / `background: none`
	// / `display: block` to arrive at two lines of text, and left every future edit to the
	// shared card free to leak a border or a fill in here with nothing failing.
	it("dresses an entry as a reference line, not as an un-carded card", () => {
		expect(MOVES_HBS).toContain('<li class="stonetop-gm-move" data-move="{{name}}">');
		expect(MOVES_HBS).toContain('class="stonetop-gm-move-name"');
		// Asserted against the emitted CLASS ATTRIBUTES, not the file text: the header comment
		// above names the classes this tab used to wear, and a plain substring search would
		// read the explanation as the thing it explains.
		const worn = [...MOVES_HBS.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/));
		for (const cardClass of ["stonetop-item", "stonetop-item-header", "stonetop-item-name",
			"stonetop-item-description"]) {
			expect(worn, `entries still wear ${cardClass}`).not.toContain(cardClass);
		}
		// ...and with the classes gone, so is every declaration that existed to undo them.
		const entry = bodyOf(".stonetop-gm-toolkit-moves .stonetop-gm-move");
		expect(entry).not.toMatch(/border:\s*none/);
		expect(entry).not.toMatch(/background:\s*none/);
		expect(entry).not.toMatch(/max-width:\s*none/);
	});

	it("rules between entries", () => {
		expect(bodyOf(".stonetop-gm-toolkit-moves .stonetop-gm-move")).toMatch(/border-bottom:\s*1px/);
	});

	// A name and its blurb are one entry. Let the column break fall inside one and the blurb
	// lands at the top of the RIGHT column, under a different move's name, reading as that
	// move's blurb. Nothing about that looks broken enough to notice.
	it("keeps a move's name and its blurb together at the column break", () => {
		expect(bodyOf(".stonetop-gm-toolkit-moves .stonetop-gm-move"))
			.toMatch(/break-inside:\s*avoid/);
	});

	// Only the DOM-last entry is `:last-child`, and it sits at the foot of the RIGHT column —
	// so an exception there would close one column with a hairline and the other without, at
	// the same height, side by side.
	it("rules every entry, with no :last-child exception", () => {
		expect(CSS).not.toContain(".stonetop-gm-toolkit-moves .stonetop-gm-move:last-child");
	});

	// These entries are not a character's move cards, but they are the same voice on the same
	// screen, so they take the sheet's own face rather than whatever Foundry hands a bare <li>.
	it("keeps the name on the system font", () => {
		expect(CSS).toMatch(
			/\.stonetop-gm-move-name,[\s\S]{0,240}?font-family:\s*var\(--font-stonetop\)/);
	});
});

// The die beside each heading's note. What it DOES is tested in random-gm-move.test.js; this
// is the wiring, every leg of which fails silently: a button with no section key draws from
// nothing, an unregistered partial throws only on first render, and a heading control that
// forgets `stonetop-section-heading-control` is left hanging on a folded section.
describe("the move randomizer", () => {
	const RANDOMIZE_HBS = read("templates/actor/partials/section-randomize.hbs");
	const HEADING_HBS   = read("templates/actor/partials/section-heading.hbs");

	it("puts one on each of the three headings, keyed to its own section", async () => {
		const html = renderMovesTab((await makeSheet().getData()).stonetop);
		// Whitespace-tolerant: the partial breaks its attributes across two lines, and a negated
		// character class spans that newline where a literal space would not.
		const keys = [...html.matchAll(/<button[^>]*stonetop-section-randomize[^>]*data-section="([^"]+)"/g)].map(m => m[1]);
		expect(keys).toEqual(["basic", "exploration", "homefront"]);
	});

	// The button sits after the note and before the fold caret, which is what "beside the
	// description" means on this line. The caret is absolutely positioned at the heading's
	// right edge, so it is not competing for the space.
	it("sits right after the heading's note", async () => {
		const html = renderMovesTab((await makeSheet().getData()).stonetop);
		const note = html.indexOf("Any time you owe the table a move");
		const die  = html.indexOf("stonetop-section-randomize");
		const caret = html.indexOf("stonetop-section-collapse");
		expect(note).toBeLessThan(die);
		expect(die).toBeLessThan(caret);
	});

	// section-editing.js finds heading-resident controls by this ONE class and hides them with
	// the section. A control that forgets it stays visible on a collapsed heading.
	it("folds away with its section", () => {
		expect(RANDOMIZE_HBS).toContain("stonetop-section-heading-control");
	});

	// Optional, so the dozens of other callers of the shared heading partial are untouched.
	it("is emitted only when a caller asks for it", () => {
		expect(HEADING_HBS).toMatch(/\{\{#if randomize\}\}/);
		const rendered = (() => {
			const hb = Handlebars.create();
			hb.registerPartial("stonetop.section-randomize", RANDOMIZE_HBS);
			return hb.compile(HEADING_HBS)({ title: "Plain", note: "no die here" });
		})();
		expect(rendered).not.toContain("stonetop-section-randomize");
	});

	// A partial with no map entry throws "partial could not be found" on the first render of
	// every sheet that heads a section, not just this one.
	it("registers its partial, at a path that exists", () => {
		const entry = STONETOP_JS.match(/"stonetop\.section-randomize":\s*"([^"]+)"/);
		expect(entry, "no preload entry for the randomize partial").toBeTruthy();
		expect(repoFileExists(entry[1].replace("systems/stonetop-pwd/", "")), `${entry[1]} does not exist`).toBe(true);
	});

	// A real <button>, so Enter and Space fire it with no keydown handler of our own. An <a> or
	// a <span> here would be mouse-only, and nothing about that shows up on screen.
	it("is a button, not an anchor", () => {
		expect(RANDOMIZE_HBS).toMatch(/<button type="button"/);
	});

	// Being a real <button> costs something: a click focuses it and the focus OUTLIVES the
	// click, and core's V1-compat sheet paints every focused button a halo through a plain
	// `:focus` that outranks this selector. So the die a GM has drawn from sits lit until they
	// click elsewhere, which reads as a hover that will not let go. Both halves matter — a lit
	// rule on `:focus` rather than `:focus-visible` would put the hover CHIP there too, and
	// dropping the `:not(:focus-visible)` from the undo would take the keyboard ring with it.
	it("does not stay lit after the click that drew a move", () => {
		// A bare `:focus` — one followed by neither `-visible` nor the `:not(…)` below.
		expect(CSS).not.toMatch(/\.stonetop-section-randomize:focus(?![-\w:])/);
		const undo = CSS.match(
			/\n\.stonetop-section-randomize:focus:not\(:focus-visible\)\s*\{([^}]*)\}/)?.[1];
		expect(undo, "nothing clears core's focus glow off the randomizer").toBeTruthy();
		expect(undo).toMatch(/box-shadow:\s*none/);
		expect(undo).toMatch(/outline:\s*none/);
	});

	it("hands the sheet the click, and holds the draw to exclude next time", () => {
		const src = stripComments(SHEET_JS);
		expect(src).toContain("_wireToolkitButtons(html[0])");
		expect(src).toMatch(/closest\("\.stonetop-section-randomize"\)/);
		expect(src).toMatch(/this\._moveDrawer\.draw\(button,/);
		// The no-repeat only works if the drawn move is kept and passed back as `exclude`, and it
		// is kept PER SECTION — one memory for all three lists would have a draw from Basic
		// suppressing the same-named move in Homefront.
		const drawer = stripComments(DRAWER_JS);
		expect(drawer).toMatch(/exclude:\s*this\._last\[key\]/);
		expect(drawer).toMatch(/this\._last\[key\]\s*=\s*move\.name/);
	});

	// The draw is remembered BEFORE the walk, not after the card posts. A second click that
	// supersedes the first drops out without posting, so a draw recorded after the post would be
	// no draw at all — and the interrupting click would be free to land on the same move again.
	it("remembers the draw before the walk that reveals it", () => {
		const drawer = stripComments(DRAWER_JS);
		expect(drawer.indexOf("this._last[key] = move.name"))
			.toBeLessThan(drawer.indexOf("this.spinTo(button, move.name)"));
	});

	// The whisper says WHICH move; the light says where in the list it came from — and gets there
	// by running down the section's entries and slowing onto the one drawn. Every leg fails
	// silently: a row with no `data-move` is never found, a class the stylesheet does not know is
	// a class nobody can see, and a card posted at the click instead of at the landing simply
	// spoils the answer with nothing anywhere to say so.
	describe("lights the row it drew", () => {
		// The declarations of the first rule whose prelude IS this selector. Takes a regex rather
		// than a string because two of these preludes carry `:is(…)`, brackets and all.
		const ruleBody = selector =>
			CSS.match(new RegExp(`\\n${selector.source}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

		it("stamps every entry with the name the handler matches on", async () => {
			const html = renderMovesTab((await makeSheet().getData()).stonetop);
			const stamped = [...html.matchAll(/<li class="stonetop-gm-move" data-move="([^"]+)"/g)]
				.map(m => m[1]);
			expect(stamped).toHaveLength(30);
			// Handlebars escapes the attribute, so what the DOM hands back as `dataset.move` is the
			// move's own name and matches the object the randomizer returned.
			expect(stamped[0]).toBe("Announce trouble (future or offscreen)");
			expect(stamped.at(-1)).toBe("Play them against each other");
		});

		it("walks the light to that row, then flashes it", () => {
			const drawer = stripComments(DRAWER_JS);
			expect(drawer).toContain('import { flashHighlight, spinHighlight } from "../utils/flash-highlight.js"');
			expect(drawer).toMatch(/this\.spinTo\(button,\s*move\.name\)/);
			// Compared as a dataset value, NOT interpolated into an attribute selector: the names
			// carry brackets and a slash, which a selector would need CSS.escape to survive.
			expect(drawer).toMatch(/li\.dataset\.move === name/);
			expect(drawer).not.toMatch(/\[data-move=/);
			expect(drawer).toMatch(/spinHighlight\(rows,\s*target,\s*\{\s*scope\s*\}\)/);
			expect(drawer).toMatch(/flashHighlight\(rows\[target\],\s*\{\s*scope\s*\}\)/);
		});

		// The walk belongs to the list that was drawn from — a light crossing Homefront's entries
		// off a click on the Basic die would be showing moves that were never in the draw. The
		// DOUSING is tab-wide, so the previous draw's fade cannot still be burning two sections up.
		it("walks one section but douses the whole tab", () => {
			// The two are separate selectors on the drawer, and this sheet is the reason they are:
			// it hands it a narrower `group` for the rows than the `scope` it douses.
			const src = stripComments(SHEET_JS);
			expect(src).toMatch(/scope:\s*"\.stonetop-gm-toolkit-moves"/);
			expect(src).toMatch(/group:\s*"\.stonetop-move-group"/);
			expect(src).toMatch(/row:\s*"\.stonetop-gm-move"/);
			const drawer = stripComments(DRAWER_JS);
			expect(drawer).toMatch(/rows\s*=\s*\[\.\.\.\(button\.closest\(this\._groupSel\)/);
			expect(drawer).toMatch(/scope\s*=\s*button\.closest\(this\._scopeSel\)/);
		});

		// One landing, one card. A click that is superseded mid-walk resolves false and must post
		// nothing, or a GM drumming on the die ends up with a pile of cards for moves whose light
		// never arrived.
		it("abandons a walk in flight and posts only for the one that lands", () => {
			const drawer = stripComments(DRAWER_JS);
			expect(drawer).toMatch(/this\._spin\?\.cancel\(\)/);
			expect(drawer).toMatch(/if \(!await spin\.done\) return false/);
			expect(drawer).toMatch(/if \(!await this\.spinTo\(button, move\.name\)\) return null;/);
			// The card goes out AFTER the walk, which is the whole point of splitting the draw
			// from the whisper: `postGmMove` takes a move rather than drawing one.
			expect(drawer.indexOf("this.spinTo(button, move.name)"))
				.toBeLessThan(drawer.indexOf("postGmMove(key, move,"));
		});

		// The classes are put on and taken off by JS; how they LOOK is entirely CSS. A stylesheet
		// that has never heard of them is a randomizer that silently highlights nothing.
		it("styles the flash where the entries are styled", () => {
			const rule = ruleBody(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move\.stonetop-flash/);
			expect(rule, "no flash rule for a drawn move").toBeTruthy();
			expect(rule).toMatch(/animation:\s*stonetop-gm-move-flash/);
			expect(CSS).toMatch(/@keyframes stonetop-gm-move-flash\s*\{/);
		});

		// The two classes swap on the landing row inside one task. Any geometry that differed
		// between them would jump at exactly the moment being watched, which is why the band is
		// declared once for both — and it must not shift the TEXT either: this is a two-column
		// list, and a highlight that changed the content box would reflow the column under it.
		it("gives the passing light and the landing the same band", () => {
			const rule = ruleBody(
				/\.stonetop-gm-toolkit-moves \.stonetop-gm-move:is\(\.stonetop-spin, \.stonetop-flash\)/);
			expect(rule, "the two classes no longer share one geometry rule").toBeTruthy();
			expect(rule).toMatch(/margin-inline:\s*-6px/);
			expect(rule).toMatch(/padding-inline:\s*6px/);
		});

		// A step that looked like the answer would make the last three steps look like three
		// answers. It is the same wash, weakened.
		it("paints a passing step weaker than the landing", () => {
			const rule = ruleBody(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move\.stonetop-spin/);
			expect(rule, "no rule for the light passing over a row").toBeTruthy();
			expect(rule).toMatch(/color-mix\([^)]*--st-warm-hover-bg[^)]*\)/);
			// No transition of its own: a step is on screen for 40ms at the start of the walk, and
			// anything easing in would still be arriving when it was time to leave.
			expect(rule).not.toMatch(/transition|animation/);
		});

		// The animation and the timer that removes the class have to agree. Too short an animation
		// leaves a faded-out row still classed; too long a one is cut off mid-fade.
		it("fades for exactly as long as the class is on", () => {
			const rule = ruleBody(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move\.stonetop-flash/);
			const seconds = rule.match(/animation:\s*stonetop-gm-move-flash\s+([\d.]+)s/)?.[1];
			expect(seconds, "the animation names no duration").toBeTruthy();
			expect(Number(seconds) * 1000).toBe(FLASH_MS);
		});

		// The class names are the one contract between the two files, and neither errors if they
		// disagree — the row simply never lights.
		it("uses the classes the stylesheet is written against", () => {
			expect(FLASH_CLASS).toBe("stonetop-flash");
			expect(SPIN_CLASS).toBe("stonetop-spin");
		});
	});

	// The whispered card. What it carries beyond the name is what makes it worth reading rather
	// than glancing at: a line of the book's own GM speech, the soft/hard note, and the page.
	describe("the whispered card", () => {
		const posted = [];
		beforeEach(() => {
			posted.length = 0;
			globalThis.ChatMessage = {
				create: data => { posted.push(data); return Promise.resolve(data); },
				getWhisperRecipients: () => [{ id: "gm1" }],
				getSpeaker: () => ({ alias: "GM Toolkit" }),
			};
		});
		afterEach(() => { delete globalThis.ChatMessage; });

		it("quotes ONE of the move's examples, not all of them", async () => {
			const move = BASIC_GM_MOVES[0];
			await postGmMove("basic", move, { rng: () => 0 });

			const quoted = move.examples.filter(e => posted[0].content.includes(escHtml(e)));
			expect(quoted, "the card is a page of examples, not a line").toHaveLength(1);
			expect(quoted[0]).toBe(move.examples[0]);
		});

		// A different one next time, so a GM who draws the same move twice in a campaign is not
		// handed the same sentence twice.
		it("takes a different example on a different roll", async () => {
			const move = BASIC_GM_MOVES[0];
			await postGmMove("basic", move, { rng: () => 0.99 });
			expect(posted[0].content).toContain(escHtml(move.examples.at(-1)));
		});

		it("carries the soft/hard line and the page, and skips what the book doesn't give", async () => {
			await postGmMove("basic", BASIC_GM_MOVES[0], { rng: () => 0 });
			expect(posted[0].content).toContain(escHtml(BASIC_GM_MOVES[0].hardness));
			expect(posted[0].content).toContain("Book I, page 180");

			// "Ask a provocative question" has no soft/hard line in the book, so the card has no
			// empty element where one would go.
			const silent = BASIC_GM_MOVES.find(m => !m.hardness);
			posted.length = 0;
			await postGmMove("basic", silent, { rng: () => 0 });
			expect(posted[0].content).not.toContain("stonetop-gm-move-card-hardness");
		});

		// The examples carry apostrophes and quoted speech, and `moveChatCard` renders its
		// description RAW because its usual caller passes text escaped at storage.
		it("escapes the book's text on the way in", async () => {
			const quoted = HOMEFRONT_GM_MOVES.find(m => m.examples.some(e => e.includes("'")));
			await postGmMove("homefront", quoted, { rng: () => 0 });
			expect(posted[0].content).not.toMatch(/<blockquote[^>]*>[^<]*'/);
			expect(posted[0].content).toContain("&#x27;");
		});
	});
});

describe("the GM Toolkit is registered on all three legs", () => {
	it("declares the actor subtype in the manifest", () => {
		expect(JSON.parse(SYSTEM_JSON).documentTypes.Actor).toHaveProperty("gmToolkit");
	});

	// Whitespace-tolerant: that assignment block is COLUMN-ALIGNED in stonetop.js, so adding any
	// Actor subtype with a longer key re-pads this line. Pinning the exact spacing would fail on
	// a change that is purely cosmetic.
	it("binds a data model, so actor.system is validated rather than a raw object", () => {
		expect(STONETOP_JS).toMatch(/CONFIG\.Actor\.dataModels\.gmToolkit\s*=\s*GmToolkitModel;/);
		// And the model is a real TypeDataModel, which is the claim the line above only implies.
		// Read as source: importing it would evaluate `extends foundry.abstract.TypeDataModel`
		// at module load, and tests/setup.js provides no `foundry.abstract`.
		const model = read("module/data-models/GmToolkitModel.js");
		expect(model).toMatch(/export class GmToolkitModel extends foundry\.abstract\.TypeDataModel/);
		expect(model).toMatch(/static defineSchema\(\)/);
	});

	// `makeDefault: false` is the silent one: the type still exists, still opens, and gets core's
	// base ActorSheet instead. No rail, no moves, no error.
	it("binds the sheet to the subtype, as the default sheet for it", () => {
		expect(STONETOP_JS).toMatch(/Actors\.registerSheet\(SYSTEM_ID, StonetopGmToolkitSheet, \{[^}]*types:\s*\["gmToolkit"\]/);
		expect(STONETOP_JS).toMatch(/Actors\.registerSheet\(SYSTEM_ID, StonetopGmToolkitSheet, \{[^}]*makeDefault:\s*true/);
	});

	// A partial with no map entry throws "partial could not be found" on first render. A partial
	// with a map entry pointing at a file that is not there throws identically, and is the more
	// likely typo, so check the VALUE and not just the key.
	it("preloads the moves partial, from a path that exists", () => {
		const entry = STONETOP_JS.match(/"stonetop\.gm-toolkit-tab-moves":\s*"([^"]+)"/);
		expect(entry, "no preload entry for the moves partial").toBeTruthy();
		expect(repoFileExists(entry[1].replace("systems/stonetop-pwd/", "")), `${entry[1]} does not exist`).toBe(true);
		// Both halves of the handshake: the map key and the name the sheet actually invokes.
		expect(SHEET_HBS).toContain('"stonetop.gm-toolkit-tab-moves"');
	});

	// Absent, the type dropdown and sheet-config show the raw key.
	it("has a display label", () => {
		expect(game.i18n.localize("TYPES.Actor.gmToolkit")).toBe("GM Toolkit");
	});

	// The sidebar's Create Actor is hijacked into our own picker (StonetopActor.createDialog),
	// so a type missing from ACTOR_OPTIONS cannot be made from the UI at all.
	it("is offered to the GM, and only to the GM", () => {
		expect(actorOptionsFor(true).map(o => o.id)).toContain("gmToolkit");
		expect(actorOptionsFor(false).map(o => o.id)).not.toContain("gmToolkit");
	});
});

describe("things that break silently", () => {
	// The rail IS this sheet's only nav, so a guarded call deletes the tabs outright. It is
	// also the cleanup path that sweeps stale rails off the frame between renders.
	it("mounts the tab rail unconditionally", () => {
		const call = SHEET_JS.indexOf("mountTabRail(this, html)");
		expect(call).toBeGreaterThan(-1);
		expect(stripComments(SHEET_JS.slice(call - 160, call))).not.toMatch(/isClassicLayout|classicLayout/);
	});

	// This sheet scrolls as ONE unit — the banner goes up with the tab under it — so there is no
	// pinned header for the frosted seam to soften text against, and no tab that scrolls for it
	// to read. Mounting it would bind a scroll listener that can never fire and gate a band that
	// can never paint. Asserted rather than left implicit because the character and steading
	// sheets both mount it and this is the sheet a copy-paste would land on.
	it("does not mount the scroll frost, having nothing pinned to frost against", () => {
		const src = stripComments(SHEET_JS);
		expect(src).not.toContain("mountScrollFrost");
		expect(src).not.toContain("scroll-frost.js");
	});

	// The scrollport has to resolve from INSIDE the form: AppV1 hands _restoreScrollPositions the
	// freshly rendered inner form, and jQuery's `.find()` searches descendants only — so
	// `.window-content`, an ancestor of it, saves fine and then restores nothing at all. Silent,
	// and this sheet re-renders on every prep write, so the symptom is a GM thrown to the top of
	// the Threats list between two ticks of one grim portent.
	it("saves the scroll on the container, which is inside the form", () => {
		const scrollY = SHEET_JS.match(/scrollY:\s*\[([^\]]*)\]/)?.[1];
		expect(scrollY, "no scrollY entry — the sheet loses its place on every prep write").toBeTruthy();
		expect(scrollY).toContain(".stonetop-gm-toolkit-container");
		expect(scrollY).not.toContain(".window-content");
		// ...and the class it names is the one the template puts on that element.
		expect(SHEET_HBS).toContain("stonetop-gm-toolkit-container");
	});

	// Modern only. There is no classic variant of this sheet and no `classicLayoutGmToolkit`
	// setting; a branch added here would read a key that is never registered and always answer
	// "modern", which is a dead code path that looks like a working toggle.
	it("carries no classic-layout branch", () => {
		const src = stripComments(SHEET_JS);
		expect(src).not.toMatch(/layoutClasses|stampLayoutClass|isClassicLayout/);
		expect(stripComments(SHEET_HBS)).not.toContain("classicLayout");
		expect(stripComments(MOVES_HBS)).not.toContain("classicLayout");
	});

	// tab-rail.js measures `.stonetop-sheet-header, .steading-header` inside the form to place
	// the rail, and bails silently if neither is found, dropping it to a flat 150px fallback.
	it("renders the header block the rail measures itself against", () => {
		expect(SHEET_HBS).toContain("stonetop-sheet-header");
	});

	// AppV1 hands activateListeners the form root; a second top-level element makes html[0]
	// the wrong node.
	//
	// Checked as the document's opening and closing tag rather than by counting lines that
	// START with `<`. That line-based count was wrong in both directions: a stray sibling
	// indented under `</form>` still counted as one root and passed, while merely indenting
	// `<form>` itself counted as zero and failed on a change that runs fine.
	it("has exactly one top-level element", () => {
		const body = stripComments(SHEET_HBS).trim();
		expect(body.startsWith("<form")).toBe(true);
		expect(body.endsWith("</form>")).toBe(true);
	});

	// `.tab.moves` + `.stonetop-move-group` is what earns this panel its tab padding, the 14px
	// gap between move groups and the fold caret's box — all three written against that pair.
	// (The card chrome the same pair brings is undone deliberately; see the glossary block
	// below.) `data-tab="moves"` is a separate mechanism that happens to share the word: it is
	// what earns the rail's move glyph from the flat icon table in stonetop.css.
	it("is a .tab.moves panel, so the tab padding and group rules reach it", () => {
		expect(MOVES_HBS).toContain('<div class="tab moves"');
		expect(MOVES_HBS).toContain('class="stonetop-move-group"');
	});

	// An unlayered `display` on the `.tab` element itself beats core's layered
	// `.tab { display: none }`, and the panel then shows on every tab at once.
	it("keeps its layout class off the .tab element", () => {
		expect(MOVES_HBS).toMatch(/<section class="sheet-tab stonetop-gm-toolkit-moves">/);
		expect(MOVES_HBS).not.toMatch(/<div class="tab[^"]*stonetop-gm-toolkit-moves/);
	});

	// The fold walk claims a heading's FOLLOWING SIBLINGS until the next heading, so three
	// headings in one flat run would let the first caret swallow the two below it.
	it("boxes each move section in its own group wrapper", () => {
		// ONE wrapper in the source, inside the {{#each}}, which is what makes it one box per
		// move section rather than one box around all three.
		const groups = MOVES_HBS.match(/class="stonetop-move-group"/g) ?? [];
		expect(groups).toHaveLength(1);
		expect(MOVES_HBS.indexOf("{{#each stonetop.moveSections}}"))
			.toBeLessThan(MOVES_HBS.indexOf('class="stonetop-move-group"'));
	});
});
