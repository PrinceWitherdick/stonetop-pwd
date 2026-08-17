import { describe, it, expect } from "vitest";
import { readRepo as read, readCss, declarations, ownRule, stripComments } from "../../fakes/css.js";
import { SEASON_IDS } from "../../../module/seasons/seasons-change-reminders.js";

// The steading header's clock — the season Stonetop is in and the campaign year, beside
// the title. What it SAYS is decided by module/seasons/current-season.js (covered by
// tests/seasons/current-season.test.js); these guard the wiring around it, which is the
// part that breaks silently: a partial that was never registered renders as nothing, and
// a readout mounted inside a layout guard vanishes for half the users.

// The comments explain the very wiring being asserted, so they have to come out first or
// a guard passes on its own rationale rather than on the markup.
const STEADING_HBS = stripComments(read("templates/actor/steading.hbs"));
const SEASON_HBS   = stripComments(read("templates/actor/partials/steading-header-season.hbs"));
const STONETOP_JS  = read("stonetop.js");
const SHEET_JS     = read("module/actors/steading/StonetopSteadingSheet.js");
const SPRING_JS    = read("module/dialogs/SpringBurstDialog.js");
const CSS          = readCss();

/**
 * One `<div …>` block, from its opening tag to the `</div>` that closes IT — found by
 * counting nesting rather than taking the first close, so the header's inner name block
 * doesn't end the slice early. Cut to its own boundaries, not to "everything above the
 * tabs", so the layout-guard assertion below is about the header and not about the stat
 * band and nav that follow it.
 */
function divBlock(html, openTag) {
	const start = html.indexOf(openTag);
	expect(start, openTag).toBeGreaterThan(-1);
	const re = /<div\b|<\/div>/g;
	re.lastIndex = start;
	for (let depth = 0, m; (m = re.exec(html)); ) {
		depth += m[0] === "</div>" ? -1 : 1;
		if (depth === 0) return html.slice(start, re.lastIndex);
	}
	throw new Error(`unclosed ${openTag}`);
}

/** The sheet's constant top: the title and the clock beside it, shown on every tab. */
const header = divBlock(STEADING_HBS, '<div class="steading-header">');

describe("the steading header's season clock", () => {
	it("sits in the header beside the title", () => {
		expect(header).toContain('<h1 class="steading-title">Stonetop</h1>');
		expect(header).toContain("steading-header-season");
		// After the name block, so it reads to the RIGHT of "Stonetop".
		expect(header.indexOf("steading-header-season")).toBeGreaterThan(header.indexOf("steading-title"));
	});

	it("shows in both layouts", () => {
		// The classic/modern split is what moves blocks around this sheet; the clock is part
		// of the constant top, so it must not be caught inside either guard.
		expect(header).not.toContain("classicLayout");
	});

	it("registers the partial it mounts", () => {
		expect(STEADING_HBS).toContain('{{> "stonetop.steading-header-season"');
		expect(STONETOP_JS).toContain(
			'"stonetop.steading-header-season":    "systems/stonetop-pwd/templates/actor/partials/steading-header-season.hbs"');
	});

	// A GM gets a button (it opens the setter); everyone else gets a plain div. Two
	// wrappers, ONE readout — the partial is what keeps them from drifting apart, so both
	// branches have to mount it and neither may inline the markup.
	it("gives the GM a button and everyone else plain text, over the same partial", () => {
		expect(header).toContain('{{#if stonetop.isGM}}');
		expect(header).toContain('{{#unless stonetop.isGM}}');
		expect(header.match(/\{\{> "stonetop\.steading-header-season"/g)).toHaveLength(2);
		expect(header).toContain('data-action="set-current-season"');
		// Counted by its own action rather than by tallying every `<button ` in the header: the
		// weather glyph beside it is a GM button too (steading-header-weather.test.js), and a
		// header-wide count would make this assertion about how many controls happen to be up
		// here rather than about the clock having exactly one.
		expect(header.match(/data-action="set-current-season"/g), "GM button").toHaveLength(1);
	});

	it("paints a whole clock unconditionally, fallback and all", () => {
		// Both halves come out of currentSeasonView already resolved — an un-stamped world
		// gets Spring of the First Year there, not here. So the partial holds NO branch: a
		// guard on `season.season` would be a second place deciding what shows, and the one
		// that used to live here is what left the sheet reading a bare year.
		expect(SEASON_HBS).toContain("{{season.label}}");
		expect(SEASON_HBS).toContain("{{season.yearLabel}}");
		expect(SEASON_HBS).not.toContain("{{#if");
	});

	// Season over year, centred on each other and parked at the header's right edge.
	it("stacks the season over the year, centred, against the right edge", () => {
		const wrapper = ownRule(CSS, ".steading-header .steading-header-season");
		expect(wrapper).toMatch(/flex-direction:\s*column\s*;/);
		expect(wrapper).toMatch(/align-items:\s*center\s*;/);
		expect(wrapper).toMatch(/margin:\s*0 0 0 auto\s*;/);
		// Name first, year second — the stack's order is the markup's.
		expect(SEASON_HBS.indexOf("season.label")).toBeLessThan(SEASON_HBS.indexOf("season.yearLabel"));
	});

	// Only the YEAR is boxed. The wrapper is a <button> for the GM, so every piece of the
	// chrome core hands a button has to be stripped by name or the stack wears two boxes.
	it("boxes the year alone and leaves the wrapper bare", () => {
		const wrapper = ownRule(CSS, ".steading-header .steading-header-season");
		for (const prop of ["border", "background", "box-shadow", "height", "padding"]) {
			expect(wrapper, prop).toMatch(new RegExp(`${prop}:\\s*(none|auto|0)`));
		}
		// The box comes from `.stonetop-year-chip`, the one class all three surfaces that show a
		// year wear (here, the picker's readout, the Seasons Change banner) — so the assertion is
		// that the markup asks for it and that the class still draws a stadium.
		expect(SEASON_HBS).toContain("stonetop-year-chip");
		const chip = declarations(CSS, ".stonetop-year-chip");
		expect(chip).toMatch(/border:\s*1px solid/);
		expect(chip).toMatch(/border-radius:\s*999px/);

		// ...so the GM's hover has to warm the chip, not the surface-less wrapper.
		expect(declarations(CSS, ".steading-header .steading-header-season--set:hover .steading-header-season-year"))
			.toBeTruthy();
	});

	// The season name takes its season's ink. The modifier is interpolated from the
	// SEASON_IDS key, so every id has to have a token behind it or a season silently falls
	// back to neutral body ink.
	it("inks the season name per season, for every season there is", () => {
		expect(SEASON_HBS).toContain("steading-header-season-name--{{season.season}}");
		for (const id of SEASON_IDS) {
			expect(CSS, id).toContain(
				`.steading-header .steading-header-season-name--${id} { color: var(--stonetop-season-${id}-ink); }`);
			expect(CSS, `${id} token`).toMatch(new RegExp(`--stonetop-season-${id}-ink:\\s*hsl\\(`));
		}
		// The neutral stays the fallback, so an unrecognised season is plain rather than blank.
		const name = ownRule(CSS, ".steading-header .steading-header-season-name");
		expect(name).toContain("var(--st-text-body)");
		// Bold and stepped up: with the glyph gone the name is the only thing naming the
		// season, and the size is what puts it in WCAG's large-text bracket — which is the
		// bar the inks above are pitched at, so the two have to move together.
		expect(name).toMatch(/font-weight:\s*700\s*;/);
		expect(name).toMatch(/font-size:\s*1\.[23]\d*em\s*;/);
		// 700 is the heaviest face this family ships, so there is nowhere above it to go:
		// a higher number matches the same Bold file and reads identically, and faking the
		// difference with a stroke was tried and rejected.
		expect(name).not.toMatch(/font-weight:\s*[89]00/);
		expect(name).not.toContain("text-stroke");
	});

	// And nowhere else. The inks have spread three times — to the season picker's labels, to
	// the marked card's ring, to the Seasons Change banner — and been pulled back every time.
	// The reason is not taste: a colour means something because ONE thing wears it, and each
	// surface that borrows these turns the header's coloured season into decoration. So the
	// four tokens may be READ by exactly the four rules above, and this counts them.
	//
	// Counted over the whole stylesheet rather than over a list of suspects, because the next
	// place they creep to is by definition one nobody thought to list.
	it("spends the season inks on the clock and on nothing else", () => {
		// One pass over the stylesheet tallying every ink read, rather than a scan per season:
		// the tally also catches an ink for a season SEASON_IDS doesn't list, which a per-season
		// loop cannot see.
		const uses = {};
		for (const [, id] of CSS.matchAll(/var\(--stonetop-season-(\w+)-ink/g)) uses[id] = (uses[id] ?? 0) + 1;
		expect(Object.keys(uses).sort()).toEqual([...SEASON_IDS].sort());
		for (const id of SEASON_IDS) {
			expect(uses[id], `${id} is read outside the header's clock`).toBe(1);
		}
		// The variable those rules used to be routed through is gone with them; a live one is
		// an open door back, since anything can set it from anywhere.
		expect(CSS).not.toContain("--stonetop-season-ink");
	});

	// The glyph is gone — the season carries itself on weight and ink alone. Nothing may
	// reintroduce it by halves: a leftover <img> with no rule behind it would take core's
	// black 1px image border, and a leftover rule would be dead weight nobody could see.
	it("carries no season glyph at all", () => {
		expect(SEASON_HBS).not.toContain("<img");
		expect(SEASON_HBS).not.toContain("iconSrc");
		expect(CSS).not.toContain("steading-header-season-icon");
		// And the view stops handing one out, so there is nothing left to render.
		expect(read("module/seasons/current-season.js")).not.toContain("seasonIconSrc");
	});

	// The clock runs the MOVE — the same thing the hotbar macro and the move card run. It used
	// to open the correct-the-clock window, which wrote a flag and made no move: the most
	// obvious control on the sheet doing the once-a-campaign action instead of the
	// four-times-a-year one. The correction is now a door inside the move's picker.
	it("wires the GM's click to the Seasons Change move, not to the clock setter", () => {
		expect(SHEET_JS).toContain(`html.find("[data-action='set-current-season']").on("click", () => this._onSeasonsChange());`);
		// The setter is still there, still GM-gated — reached one click further in.
		expect(SHEET_JS).toMatch(/async _onSetCurrentSeason\(openOn\)\s*\{\s*\n\s*if \(!game\.user\?\.isGM\) return;/);
		expect(SHEET_JS).toContain("onRun: (year) => this._onSetCurrentSeason(year),");
	});

	// The setter only writes the flag. Applying seasonal gains, resetting Fortunes and
	// writing the journal entry belong to the move; a GM correcting the header wants none
	// of them.
	it("keeps the setter clear of the move's own effects", () => {
		const from = SHEET_JS.indexOf("async _onSetCurrentSeason(");
		const to   = SHEET_JS.indexOf("async _onSeasonsChange()");
		// Both anchors must actually be found and be in this order, or `slice` hands back an
		// empty string and every assertion below passes on nothing. That is not hypothetical:
		// the old anchor spelled the setter with empty parentheses, and giving it a parameter
		// silently emptied this slice.
		expect(from, "setter").toBeGreaterThan(-1);
		expect(to, "move").toBeGreaterThan(from);
		const setter = SHEET_JS.slice(from, to);
		expect(setter).not.toContain("recordSeasonsChange");
		expect(setter).not.toContain("setSystemValues");
		expect(setter).not.toContain("postSeasonsChangeReminder");
	});

	// Both places that complete a Seasons Change record the clock, or the header goes stale
	// the moment the table plays past the season it was last set to. `recordCurrentSeason` is
	// the ONE writer for both halves (the stamp and the picker's year), so a caller cannot
	// land one without the other the way the session-zero spring used to.
	it("is recorded by the move and by session zero's opening spring", () => {
		expect(SHEET_JS).toContain("await recordCurrentSeason(this.actor, seasonId, year, {");
		expect(SHEET_JS).toContain('pickerYear:  seasonId === "winter" ? year + 1 : year,');
		expect(SPRING_JS).toContain('recordCurrentSeason(getStonetopSteadingActor(), "spring", 1, { advanceOnly: true })');
	});

	// Nothing may write half the clock. Both partial writers are gone, and the sheet reaches
	// the flags only through the one function that writes them together.
	it("has no way left to write half the clock", () => {
		for (const js of [SHEET_JS, SPRING_JS]) {
			expect(js).not.toContain("stampCurrentSeason");
			expect(js).not.toContain("advanceCurrentYear");
		}
	});

	// The clock is the header's second flex item and parks itself against the right edge
	// with an auto left margin, which only has slack while the name block leaves the row.
	it("leaves room for itself in the header row", () => {
		expect(ownRule(CSS, ".steading-header-name")).not.toMatch(/flex:\s*1\s*;/);
	});
});
