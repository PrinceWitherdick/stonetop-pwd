import Handlebars from "handlebars";
import { describe, it, expect, vi, afterEach } from "vitest";
import { readRepo as read, readCss, repoFileExists, stripComments, declarations } from "../../fakes/css.js";
import {
	HOMEFRONT_SECTIONS, LIFE_IN_STONETOP, HOMEFRONT_QUESTIONS, THE_YEARS_WORK,
	AFTERMATH, DOWNTIME, MAKE_A_PLAN, RELATIVE_VALUE,
} from "../../../module/gm-toolkit/homefront-text.js";
import { localizedHomefrontSections } from "../../../module/gm-toolkit/homefront-view.js";
import { bookPageRef } from "../../../module/gm-toolkit/book-ref.js";
import { SEASON_IDS } from "../../../module/seasons/seasons-change-reminders.js";
import { VALUE_TIER_WORTH } from "../../../module/data/value-tiers.js";

// The GM Toolkit's Homefront tab: the GM playbook's Homefront page, transcribed whole.
//
// Three halves, guarding three different kinds of failure.
//
// The WIRING half asserts on source text, the way the Core Loop and "I wonder..." tabs' tests do,
// because every leg of adding a tab fails SILENTLY: an unregistered partial renders nothing, a
// missing include leaves the rail button pointing at a panel that is not there, a `data-tab` with
// no icon row paints a solid block where the glyph should be, and a tab left out of the padding
// rule renders flush against the frame. None of those throw.
//
// The TRANSCRIPTION half pins the table against the page it came off. The failure mode here is a
// well-meant edit: this is somebody else's rules text, and a tidied bullet or a "fixed" typo is a
// change to what the book says with nothing to catch it.
//
// The VIEW half is about the seasons mark, which is the one thing on this tab that is not static.
// The frozen table must not learn which season is now, and the season keys must stay the same keys
// the steading's clock stores, or the mark silently never lands.

const CSS           = readCss();
const STONETOP_JS   = read("stonetop.js");
const SHEET_HBS     = read("templates/actor/gm-toolkit.hbs");
const HOMEFRONT_HBS = read("templates/actor/partials/gm-toolkit-tab-homefront.hbs");
const SHEET_JS      = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");
const EN_JSON       = JSON.parse(read("languages/en.json"));

// `game.i18n` is the ambient one from tests/setup.js, which is already backed by the REAL en.json
// rather than a key-echoing stub. That matters here: a citation is a FORMAT string, so a stub
// handing back the key would give `format("...bookPage", {book: "II", page: 16})` a template with no
// `{page}` in it to fill, and every page on the tab would come out as its own key — which looks
// exactly like the bug this file is meant to catch (a Book II page printed as a Book I one).
// This file used to install its own copy of that; setup.js's has the same semantics, and a local
// one that `delete`d the global afterwards took it away from every suite below it.

afterEach(() => { vi.restoreAllMocks(); });

/**
 * The REAL partial, with the REAL section-heading under it, so what the assertions below read is
 * the markup that ships rather than a description of it.
 *
 * Compiling it at all is half the point: a `{{#if (eq ...)}}` chain, a partial call and a helper
 * name are all things that pass every source-text check in this file and then throw the first time
 * a GM clicks the tab.
 *
 * @param {string} season  What the sheet puts on the context: a SEASON_IDS key, or "" for a world
 *        with no steading. Anything else marks nothing, which is the point of testing it.
 */
function renderTab(season = "") {
	const hb = Handlebars.create();
	hb.registerHelper("localize", key => key);
	hb.registerHelper("format", (key, options) => globalThis.game.i18n.format(String(key), options.hash));
	hb.registerHelper("eq", (a, b) => a === b);
	hb.registerPartial("stonetop.section-heading", read("templates/actor/partials/section-heading.hbs"));
	hb.registerPartial("stonetop.section-collapse", read("templates/actor/partials/section-collapse.hbs"));
	return hb.compile(HOMEFRONT_HBS)({
		stonetop: { homefrontSections: localizedHomefrontSections(), homefrontSeason: season },
	});
}

describe("Homefront tab — rendered", () => {
	it("renders every section, each heading inside its own box", () => {
		const html = renderTab();

		// The fold walk claims a heading's FOLLOWING SIBLINGS up to the next heading, so a heading
		// that escapes its box swallows every section below it — and the tab still renders
		// perfectly until someone clicks a caret. Split on the box opening: anything before the
		// FIRST box is a heading that got out.
		const chunks = html.split(/<div class="stonetop-move-group stonetop-gm-homefront-section">/);
		expect(chunks).toHaveLength(HOMEFRONT_SECTIONS.length + 1);
		expect(chunks[0]).not.toContain("stonetop-move-group-title");
		for (const chunk of chunks.slice(1)) {
			expect(chunk.match(/stonetop-move-group-title/g) ?? []).toHaveLength(1);
		}
	});

	it("renders a body for every section, so no kind falls through the chain", () => {
		const html = renderTab();
		// One `{{#if (eq kind ...)}}` arm unmatched is a heading with nothing under it, which is
		// exactly what a folded section looks like. Count the bodies instead.
		for (const text of [
			"Home &amp; hearth",                       // groups
			"What&#x27;s cooking on the hearthfire?",  // questions
			"Always",                                  // seasons
			"Determine what&#x27;s happened",          // steps (aftermath)
			"Downtime ends when",                      // steps (downtime), and its end condition
			"You must travel to ___",                  // plan
			"A purse of copper coins",                 // value
		]) expect(html, text).toContain(text);
		// The two bodies that share the "steps" renderer must both be there: one table rendered
		// twice would pass every other check in this file.
		expect(html).toContain("Take care of logistics");
	});

	it("cites both books, resolved rather than left as raw keys", () => {
		const html = renderTab();
		expect(html).toContain("Book II, page 16");
		expect(html).toContain("Book I, page 490");
		expect(html).not.toContain("stonetop.gmToolkit.moves.book");
	});

	// The mark is a comparison against the steading's clock, so it lands on exactly one block or
	// on none. Rendered rather than reasoned about: a mismatched key does not throw, it simply
	// never marks anything, and every source-text check in this file would still pass.
	it("marks the season the campaign is in, and only that one", () => {
		const marked = season => (renderTab(season).match(/stonetop-gm-homefront-season--now/g) ?? []).length;
		for (const id of SEASON_IDS) expect(marked(id), id).toBe(1);
		// No steading, no clock: nothing is marked and the five blocks stand as reference.
		expect(marked("")).toBe(0);
		// And "Always" is never marked, because the only values the sheet can put on the context
		// are a SEASON_IDS key or the empty string — which the view-model block asserts, and which
		// is the whole reason its key is not one of the four.
		expect(SEASON_IDS).not.toContain("always");
	});
});

describe("Homefront tab — wiring", () => {
	it("registers the partial", () => {
		expect(STONETOP_JS).toContain('"stonetop.gm-toolkit-tab-homefront"');
		expect(STONETOP_JS).toContain("templates/actor/partials/gm-toolkit-tab-homefront.hbs");
		expect(repoFileExists("templates/actor/partials/gm-toolkit-tab-homefront.hbs")).toBe(true);
	});

	it("renders the panel and gives it a rail button", () => {
		expect(SHEET_HBS).toContain('{{> "stonetop.gm-toolkit-tab-homefront"}}');
		expect(SHEET_HBS).toContain('tab="homefront"');
		expect(HOMEFRONT_HBS).toContain('data-tab="homefront"');
	});

	// The user asked for it above the moves, and the rail paints in source order. A silent
	// reorder — someone adding a tab to the end of the list and tidying the rest — is the way
	// this comes undone.
	it("puts Homefront at the head of the rail, above the moves", () => {
		const rail = SHEET_HBS.slice(SHEET_HBS.indexOf("stonetop-tab-rail"));
		expect(rail.indexOf('tab="homefront"')).toBeGreaterThan(-1);
		expect(rail.indexOf('tab="homefront"')).toBeLessThan(rail.indexOf('tab="moves"'));
	});

	// The tab that OPENS is still the moves: the Homefront page is where you go when the party
	// gets home, and the moves are what the sheet is open for mid-sentence.
	it("leaves the moves tab as the one the sheet opens on", () => {
		expect(SHEET_JS).toContain('initial: "moves"');
	});

	// The glyph is still per-tab and has to be asserted as one. The gutter is not: it reaches
	// every panel through the bare `> .tab`, so there is nothing this tab has to be remembered
	// in. It used to be an `:is()` naming all six, which is how four separate test files each
	// came to check that their own tab was in the list.
	it("has a rail glyph, and gets its padding from the shared tab rule", () => {
		expect(CSS).toMatch(/\.stonetop-tab-rail \.item\[data-tab="homefront"\][^}]*--st-tab-icon/);
		expect(declarations(CSS, ".stonetop-gm-toolkit-sheet .sheet-body > .tab")).toMatch(/padding:/);
	});

	// "Questions to ask" is a whole section of them, and the partial says in prose that they get
	// the question-spiral. They only do if the swap is re-asserted INSIDE this list: the global
	// `li.question-bullet::before` weighs the same as the list's own spiral default and loses to
	// it on source order, so the tagged items would quietly draw as ordinary prose — a bullet
	// that is the wrong picture and nothing else, which no render error would report.
	it("lets the question-spiral swap reach its tagged items", () => {
		expect(declarations(CSS, ".stonetop-gm-homefront-items > li.question-bullet::before"))
			.toContain("question-spiral.svg");
		// Every one of them ends in "?", which is what markQuestionBullets tags on.
		for (const item of HOMEFRONT_QUESTIONS.items) expect(item.trim().endsWith("?"), item).toBe(true);
	});

	it("localizes every heading it renders", () => {
		const gm = EN_JSON.stonetop.gmToolkit;
		expect(gm.tabs.homefront).toBeTruthy();
		for (const section of HOMEFRONT_SECTIONS) {
			for (const key of [section.titleKey, section.noteKey]) {
				const value = key.split(".").reduce((node, part) => node?.[part], { stonetop: EN_JSON.stonetop });
				expect(value, key).toBeTruthy();
			}
		}
		expect(gm.homefront.intro).toBeTruthy();
		expect(gm.homefront.now).toBeTruthy();
		expect(gm.homefront.valueTier).toContain("{value}");
		// The citation takes its BOOK as a placeholder, which this tab is the first to need — it
		// is half Book II. One string for every book rather than one per book: without `{book}`
		// the Book II pages here would print as Book I's, which is a wrong page number that
		// still reads like a right one.
		expect(gm.moves.bookPage).toContain("{book}");
		expect(gm.moves.bookPage).toContain("{page}");
	});

	// Seven headings in one flat run would let the first fold caret swallow the six below it —
	// the fold walk claims a heading's FOLLOWING SIBLINGS until the next heading. Each section
	// is boxed, which is the same thing the Moves tab does and for the same reason.
	it("boxes each section so the fold carets cannot swallow each other", () => {
		expect(HOMEFRONT_HBS).toContain('class="stonetop-move-group stonetop-gm-homefront-section"');
		expect(HOMEFRONT_HBS).toContain('{{> "stonetop.section-heading"');
		for (const section of HOMEFRONT_SECTIONS) expect(section.collapseId).toMatch(/^gmHomefront/);
		expect(new Set(HOMEFRONT_SECTIONS.map(s => s.collapseId)).size).toBe(HOMEFRONT_SECTIONS.length);
	});

	// Reference only, like the rest of this sheet. An input or a name attribute here would put
	// transcribed book text into the form's submit data.
	it("stores nothing", () => {
		const markup = stripComments(HOMEFRONT_HBS);
		expect(markup).not.toMatch(/<input|<textarea|<select|name=/);
	});
});

describe("Homefront tab — transcription", () => {
	it("carries all four columns of the playbook's page", () => {
		expect(HOMEFRONT_SECTIONS.map(s => s.key))
			.toEqual(["life", "questions", "year", "aftermath", "downtime", "plan", "value"]);
	});

	it("keeps the village's facts in the playbook's four groups", () => {
		expect(LIFE_IN_STONETOP.map(g => g.name))
			.toEqual(["People", "Home & hearth", "Trade & commerce", "Protection & governance"]);
		expect(LIFE_IN_STONETOP[0].items[0]).toBe("~300 people live in Stonetop (~50 families)");
		// Each group cites its OWN Book II spread, not the entry's first page.
		expect(LIFE_IN_STONETOP.map(g => g.page)).toEqual([16, 17, 18, 19]);
		expect(LIFE_IN_STONETOP.every(g => g.book === 2)).toBe(true);
	});

	it("keeps the twelve questions, every one still a question", () => {
		expect(HOMEFRONT_QUESTIONS.items).toHaveLength(12);
		expect(HOMEFRONT_QUESTIONS.items.every(q => q.endsWith("?"))).toBe(true);
	});

	it("keeps the year's work as four seasons plus Always", () => {
		expect(THE_YEARS_WORK.seasons.map(s => s.name))
			.toEqual(["Spring", "Summer", "Autumn", "Winter", "Always"]);
		expect(THE_YEARS_WORK.seasons.every(s => s.items.length > 0)).toBe(true);
		expect(THE_YEARS_WORK.seasons.find(s => s.key === "winter").items)
			.toContain("Distilling & aging whisky");
	});

	it("keeps Aftermath numbered and Downtime not", () => {
		expect(AFTERMATH.steps).toHaveLength(3);
		expect(AFTERMATH.page).toBe(490);
		expect(DOWNTIME.steps).toHaveLength(5);
		expect(DOWNTIME.page).toBe(496);
		expect(DOWNTIME.ends).toMatch(/^Downtime ends when/);
		// The one step that is a move with its own chapter, so it carries its own page.
		expect(DOWNTIME.steps.at(-1).page).toBe(516);
	});

	it("keeps Make a Plan's trigger with the requirements it is answered from", () => {
		expect(MAKE_A_PLAN.trigger).toMatch(/^When you wish to accomplish some project/);
		expect(MAKE_A_PLAN.requirements).toHaveLength(11);
		// Every one is a blank the GM fills in; a requirement with no blank has been reworded.
		expect(MAKE_A_PLAN.requirements.every(r => r.includes("___"))).toBe(true);
	});

	// RELATIVE_VALUE and module/data/value-tiers.js are the same table said two ways for two jobs
	// (the playbook's bullet column, and the journals' hover tooltip). Neither is derived from the
	// other, so the one thing that can drift is which TIERS exist — a fifth tier added to one and
	// not the other is a page that stops at Value 3 beside tooltips that do not.
	it("names the same Value tiers the journal tooltips do", () => {
		expect(RELATIVE_VALUE.tiers.map(t => t.value)).toEqual([0, 1, 2, 3, 4]);
		expect(RELATIVE_VALUE.tiers.map(t => String(t.value)))
			.toEqual(Object.keys(VALUE_TIER_WORTH));
		expect(RELATIVE_VALUE.tiers.every(t => t.items.length > 0)).toBe(true);
		// The asterisk two entries carry is answered by the first note; drop the note and the
		// mark points at nothing.
		const starred = RELATIVE_VALUE.tiers.flatMap(t => t.items).filter(i => i.includes("*"));
		expect(starred).toHaveLength(2);
		expect(RELATIVE_VALUE.notes[0]).toMatch(/^\*Exotic trade goods/);
	});

	// This one section is transcribed off TWO pages, and both readings are deliberate: the intro
	// and the notes are the GM playbook's Homefront column word for word, and the lead is Book I
	// p.542, which the playbook's condensation drops. Both look like typos to anyone holding the
	// other book — the playbook prints "not standard" where Book I prints "anything but standard"
	// — so they are pinned here rather than left to be helpfully corrected.
	it("keeps the playbook's wording and Book I's tier warning, which is only in Book I", () => {
		expect(RELATIVE_VALUE.intro).toBe("Exchange rates are not standard, but...");
		expect(RELATIVE_VALUE.notes.at(-1)).toMatch(/barter, debts, and honor/);

		// The warning is the whole reason the lead is carried at all: a tier is not a rung on a
		// scale, and BOTH halves of that say so. Losing the second half leaves the multiplication
		// ("a dozen") without the thing it is there to forbid (adding tiers up).
		expect(RELATIVE_VALUE.lead).toMatch(/they are tiers/);
		expect(RELATIVE_VALUE.lead).toMatch(/a dozen Value 1 items/);
		expect(RELATIVE_VALUE.lead).toMatch(/don't add up to Value 3/);
	});
});

describe("Homefront tab — the view-model", () => {
	it("resolves a citation for every section, and Book II for the village's", () => {
		const sections = localizedHomefrontSections();
		expect(sections.map(s => s.key)).toEqual(HOMEFRONT_SECTIONS.map(s => s.key));

		const life = sections.find(s => s.key === "life");
		expect(life.body.groups[0].pageRef).toBe("Book II, page 16");
		// The whole reason `book` exists on these entries: without it, a Book II page prints as a
		// Book I one, which is a citation that sends a GM to the wrong book and looks right.
		expect(bookPageRef({ book: 2, page: 16 })).not.toBe(bookPageRef({ page: 16 }));
		// One string with the numeral filled in, rather than a branch and a key per book. Book III
		// is the free GM playbook, which is the page these tabs are transcribed FROM, so it is the
		// next real case rather than a hypothetical one.
		expect(bookPageRef({ page: 16 })).toBe("Book I, page 16");
		expect(bookPageRef({ book: 3, page: 4 })).toBe("Book III, page 4");
		// The alt form carries the book too. Those moves are Book I today; a citation shape that
		// can only ever say one book is how a later one comes out mislabelled.
		expect(bookPageRef({ page: 180, pageAlt: 300 })).toContain("Book I, page 180");
		expect(bookPageRef({ book: 2, page: 180, pageAlt: 300 })).toContain("Book II, page 180");
		// An unknown book says its own digit — wrong in a way a reader can see, rather than
		// silently printing someone else's page as Book I's.
		expect(bookPageRef({ book: 9, page: 1 })).toBe("Book 9, page 1");
		// No page, no citation, so a caller can print it unconditionally.
		expect(bookPageRef({ book: 2 })).toBe("");

		for (const section of sections) {
			const refs = section.body.pageRef ? [section.body.pageRef] : section.body.groups.map(g => g.pageRef);
			expect(refs.every(Boolean), section.key).toBe(true);
		}
	});

	// A pass-through, and pass-throughs are exactly what goes missing quietly: drop the line in the
	// view and the tab still renders, minus the one paragraph that says the tiers are not a scale.
	it("carries Book I's tier warning through to the tab", () => {
		const value = localizedHomefrontSections().find(s => s.key === "value");
		expect(value.body.lead).toBe(RELATIVE_VALUE.lead);
		expect(HOMEFRONT_HBS).toContain("body.lead");
	});

	it("numbers Aftermath's steps and not Downtime's", () => {
		const sections = localizedHomefrontSections();
		expect(sections.find(s => s.key === "aftermath").body.numbered).toBe(true);
		expect(sections.find(s => s.key === "downtime").body.numbered).toBeUndefined();
		expect(sections.find(s => s.key === "downtime").body.ends).toBe(DOWNTIME.ends);
	});

	// The mark is a comparison against the steading's clock, which stores a SEASON_IDS key. Rename
	// a key here and nothing throws: the tab simply stops ever marking a season.
	it("keys its four seasons the way the steading's clock does", () => {
		const seasonKeys = THE_YEARS_WORK.seasons.map(s => s.key).filter(k => k !== "always");
		expect(seasonKeys).toEqual(SEASON_IDS);
		// "Always" must NOT be a season key, or it would light up alongside the real one.
		expect(SEASON_IDS).not.toContain("always");
	});

	it("does not bake the current season into the frozen table", () => {
		const sections = localizedHomefrontSections();
		const year = sections.find(s => s.key === "year");
		expect(year.body.seasons.some(s => "isNow" in s)).toBe(false);
		expect(Object.isFrozen(year.body.seasons)).toBe(true);
		// The template reads the live value off the context instead.
		expect(HOMEFRONT_HBS).toContain("@root.stonetop.homefrontSeason");
		expect(SHEET_JS).toContain("context.stonetop.homefrontSeason");
	});

	// A GM who runs Seasons Change with the toolkit open must not be left reading the season that
	// just ended. The sheet is not the steading, so it is not told about the write without this.
	it("re-renders when the steading's clock moves, and drops the hook on close", () => {
		expect(SHEET_JS).toContain("_wireSeasonSync");
		expect(SHEET_JS).toContain("_unwireSeasonSync");
		expect(SHEET_JS).toMatch(/Hooks\.on\("updateActor"/);
		expect(SHEET_JS).toMatch(/Hooks\.off\("updateActor"/);
		// The flag path is tested before the steading is resolved: every actor update in the world
		// arrives at that hook, and resolving the steading is an unindexed scan of `game.actors`.
		const wire = SHEET_JS.slice(SHEET_JS.indexOf("_wireSeasonSync()"));
		expect(wire.indexOf("CURRENT_SEASON_KEY")).toBeLessThan(wire.indexOf("getStonetopSteadingActor()"));
	});
});
