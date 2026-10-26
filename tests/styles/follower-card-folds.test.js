import { describe, it, expect } from "vitest";
import { readCss, readRepo, declarations, ownRule, stripComments } from "../fakes/css.js";

/**
 * Splitting a follower card — particularly the Marshal's crew — so it stops eating the tab.
 *
 * Measured before this change, with a six-member crew on a 960px tab: the card stood 784px tall
 * with every section shut, and 1,535px with them open. The Followers grid holds two columns at
 * EVERY width (see `.stonetop-followers`), and the crew is the second card, so that height set
 * the height of the whole first row and left the Animal Companion beside it floating in dead
 * space. Only three things folded, and none of them was the part that was always on screen.
 *
 * The split is by WHEN A FIELD IS TOUCHED, not by what kind of field it is:
 *
 *   the vitals band  Armor, Damage, ammo, Loyalty, Readiness — what a fight reaches for. These
 *                    were five full-width rows; reading the card they flow as one wrapping band.
 *   the Details fold instinct, cost, moves, gear, notes — set once and read rarely. Folded shut.
 *   the card fold    the whole card down to its header strip plus the band, for a follower who
 *                    is not in this scene at all.
 *
 * Two rules make the folding worth doing rather than merely possible, and both are guarded here
 * because both are the kind of thing a later edit quietly undoes:
 *
 * A CLOSED SECTION MUST REPORT ITS OWN STATE. `5 ✓ · normal load`, `6 members · 23/36 HP · 1
 * down`. A fold that says nothing is a fold players leave open to read a number off, which is
 * how the card got tall in the first place — so the summary carries the number instead.
 *
 * AND THE PENCIL MUST NEVER OPEN ONTO A HIDDEN FIELD. Editing forces every fold open and drops
 * the band back to a stacked column, because under the pencil each of those rows grows an input.
 * That override is render-only: it must not reach the persisted set, or opening the pencil once
 * would wipe what the player chose to keep shut.
 *
 * After: 447px shut, 240px folded to the header, and at most one section open at a time unless
 * the player pins more.
 */

const CSS = readCss();
const TPL = readRepo("templates/actor/partials/tab-followers.hbs");
const SHEET = readRepo("module/actors/character/StonetopCharacterSheet.js");

const BAND = ".stonetop-follower-card:not(.is-editing) .stonetop-follower-vitals";

describe("the vitals band", () => {
	it("flows as one wrapping row while the card is being read", () => {
		const band = declarations(CSS, BAND);
		expect(band).toBeTruthy();
		expect(band).toMatch(/flex-direction:\s*row/);
		expect(band).toMatch(/flex-wrap:\s*wrap/);
	});

	it("is the same markup as the stacked column, switched by a class — not a second copy", () => {
		// One <div> carrying both classes. Two blocks of rows behind {{#if edit.card}} would
		// drift the moment either was touched, which is the trap this keeps shut.
		const bandDivs = TPL.match(/class="stonetop-follower-stats-section stonetop-follower-vitals"/g);
		expect(bandDivs).toHaveLength(1);
		// And the column layout it falls back to is the section's own, un-overridden.
		expect(declarations(CSS, ".stonetop-follower-stats-section")).toMatch(/flex-direction:\s*column/);
	});

	it("lets its rows shrink to their content instead of each claiming a line", () => {
		// .stonetop-follower-statline carries `flex: 1 1 130px; min-width: 120px` — enough on its
		// own to hold the band open at one chip per line on a narrow card.
		const rows = declarations(
			CSS,
			`${BAND} .stonetop-follower-statline`,
		);
		expect(rows).toMatch(/flex:\s*0 1 auto/);
		expect(rows).toMatch(/min-width:\s*0/);
	});

	it("drops the fill line under a chip, which would read as five invitations to type", () => {
		expect(declarations(CSS, `${BAND} .stonetop-follower-field-value`)).toMatch(/border-bottom:\s*none/);
	});

	it("gives the readiness gloss a line of its own — it is a sentence, not a value", () => {
		expect(declarations(CSS, `${BAND} > .stonetop-follower-readiness-note`)).toMatch(/flex-basis:\s*100%/);
	});

	it("holds no fold control, so nothing here can be pushed onto a line of its own", () => {
		// The card fold used to ride the end of this band and had to wrap whenever the
		// Readiness row filled the line it was on — which at the 20px root font this project's
		// own player runs is ALWAYS. That cost a folded card ~31px of empty space under its
		// last control, which is what put the control in the header instead. Measured folded at
		// a 620px tab and a 20px root: 306px tall before, 275px after, with the space below the
		// Readiness row down from 43px to the body's own 12px of padding.
		const band = TPL.slice(
			TPL.indexOf('class="stonetop-follower-stats-section stonetop-follower-vitals"'),
			TPL.indexOf("{{!-- /stonetop-follower-stats-section --}}"),
		);
		expect(band).toBeTruthy();
		expect(band).not.toContain("stonetop-follower-card-fold");
	});
});

describe("the Details fold", () => {
	it("holds the reference half of the stat block and nothing that changes in a fight", () => {
		const body = TPL.slice(
			TPL.indexOf('<div class="stonetop-follower-details-body">'),
			TPL.indexOf("</details>", TPL.indexOf('<div class="stonetop-follower-details-body">')),
		);
		expect(body).toBeTruthy();
		for (const label of ["Instinct", "Cost", "Moves", "Gear", "Notes"])
			expect(body).toContain(`>${label}</span>`);
		// Armor / Damage / Loyalty / Readiness stay out in the open: a fight reaches for them.
		for (const label of ["Armor", "Damage", "Loyalty", "Readiness"])
			expect(body).not.toContain(`>${label}</span>`);
	});

	it("reuses the crew sections' fold machinery rather than growing a second kind", () => {
		// One toggle handler, one persisted set, one accordion — `stonetop-crew-collapsible` is
		// what the sheet binds and what the accordion queries for siblings.
		const fold = TPL.match(/<details class="[^"]*stonetop-follower-details-fold[^"]*"[^>]*>/)?.[0];
		expect(fold).toBeTruthy();
		expect(fold).toContain("stonetop-crew-collapsible");
		expect(fold).toMatch(/data-section="details:\{\{this\.foldId\}\}"/);
	});

	it("is not drawn at all on a card with none of those fields", () => {
		expect(SHEET).toMatch(/card\.hasDetails\s*=\s*editing\s*\|\|\s*hasReference/);
		expect(TPL).toContain("{{#if hasDetails}}");
	});
});

describe("a closed section reports its own state", () => {
	it("gives every fold a state line in its summary", () => {
		// Inventory, the crew's Roster and Group Fight, and the custom group's pair.
		expect(TPL).toContain('<span class="stonetop-follower-section-state">{{this.inventorySummary}}</span>');
		expect(TPL.match(/\{\{this\.rosterSummary\}\}/g)).toHaveLength(2);
		expect(TPL.match(/\{\{this\.groupFightSummary\}\}/g)).toHaveLength(2);
	});

	it("except Details, whose summary is the word and the caret on one row", () => {
		// The user's call: a list of which reference fields are filled in ("instinct · cost ·
		// 2 moves · 3 gear · notes") was not worth reading shut, and it wrapped, dragging the
		// caret down onto a second line under the heading.
		const summary = TPL.match(/<summary[^>]*>Details[\s\S]*?<\/summary>/)?.[0];
		expect(summary).toBeTruthy();
		expect(summary).not.toContain("stonetop-follower-section-state");
		expect(summary).toContain('<i class="fas fa-caret-down stonetop-follower-section-caret"></i>');
		expect(SHEET).not.toContain("detailsSummary");
	});

	it("counts the load in filled pips, so a 2-weight item tells the truth", () => {
		expect(SHEET).toMatch(
			/const crewLoad = crew\.gear\.reduce\(\(n, g\) => n \+ g\.pips\.filter\(pip => pip\.filled\)\.length, 0\);/,
		);
		// The ladder the Inventory subtitle prints: <=3 light, 4-6 normal, 7+ heavy. The
		// cutoffs are READ FROM the shared load caps rather than written out again here, so
		// the crew's subtitle cannot disagree with the character's own load readout.
		expect(SHEET).toMatch(/crewLoad <= LOAD_LEVEL_LIMITS\.light\s+\? "light"/);
		expect(SHEET).toMatch(/crewLoad <= LOAD_LEVEL_LIMITS\.normal \? "normal"/);
		expect(SHEET).toMatch(/from "\.\.\/\.\.\/utils\/load\.js"/);
	});

	it("hides the instructional subtitle while shut, since it explains the open section", () => {
		const shut = declarations(
			CSS,
			"details.stonetop-crew-collapsible:not([open]) > .stonetop-follower-section-summary > .stonetop-follower-section-subtitle",
		);
		expect(shut).toMatch(/display:\s*none/);
		// The state line is NOT the subtitle, or hiding one would hide the other.
		expect(ownRule(CSS, ".stonetop-follower-section-state")).toBeTruthy();
	});
});

describe("folding the whole card", () => {
	it("keeps the header and the band, and clamps everything else away", () => {
		const rule = declarations(
			CSS,
			".stonetop-follower-card.is-collapsed > .stonetop-follower-body > :not(.stonetop-follower-vitals)",
		);
		expect(rule).toMatch(/display:\s*none/);
		// The hover pencil survives: a folded card is still editable, and the pencil unfolds it.
		const outer = ownRule(
			CSS,
			".stonetop-follower-card.is-collapsed > :not(.stonetop-follower-header):not(.stonetop-follower-body):not(.stonetop-follower-edit):not(.stonetop-follower-done)",
		);
		expect(outer).toBeTruthy();
	});

	it("lives in the header's tags row, where it costs no height at all", () => {
		// The row exists either way and has room to spare at its right. It is also the part of
		// the card that never folds, which is where the control that UNFOLDS it belongs.
		const header = TPL.slice(
			TPL.indexOf('<div class="stonetop-follower-tags-row">'),
			TPL.indexOf('<div class="stonetop-follower-body"'),
		);
		expect(header).toContain("stonetop-follower-card-fold");
	});

	it("sits on the chips' bottom line rather than the row's centre", () => {
		// Centred, the caret's INK ended 6.5px above the chips' at a 16px root, 8px at 20px,
		// and 22px once the tags wrapped to two rows. Measured from real pixels, the glyph's
		// remaining slack under flex-end was 4.5px at 16px and 6px at 20px: 0.3em both times.
		const fold = declarations(CSS, ".stonetop-follower-card-fold");
		expect(fold).toMatch(/align-self:\s*flex-end/);
		expect(fold).toMatch(/position:\s*relative/);
		// In em, so it holds at every UI font size; `top`, so it never grows the row.
		expect(fold).toMatch(/top:\s*0\.3em/);
		expect(fold).not.toMatch(/align-self:\s*center/);
	});

	it("carries a hit area that grows neither the row nor the gutter", () => {
		const fold = declarations(CSS, ".stonetop-follower-card-fold");
		// Top padding stays inside the tags row's own height; no bottom padding, which under
		// flex-end would lift the glyph off the chips' line by a px amount the em nudge
		// cannot track.
		expect(fold).toMatch(/padding:\s*2px 6px 0/);
		// And the horizontal padding is spent on the header's 12px gutter, so nothing shifts.
		expect(fold).toMatch(/margin-right:\s*-6px/);
	});

	it("is remembered per card, per actor, and defaults to open", () => {
		expect(readRepo("module/settings.js")).toMatch(/register\(SYSTEM_ID, "followerCardsCollapsed"/);
		expect(SHEET).toMatch(/_collapsedFollowerCards = new Set\(getFollowerCardsCollapsed\(this\.actor\?\.id\)\)/);
		// The Set holds the FOLDED ids — absence means the card opens, which is the default.
		expect(SHEET).toMatch(/card\.cardFolded\s*=\s*!editing && this\._collapsedFollowerCards\.has\(cardId\)/);
	});
});

describe("every fold on the card opens from the same edge", () => {
	it("gives each section summary its own caret, on the RIGHT", () => {
		// Details, Inventory, the crew's Roster and Group Fight, and the custom group's pair.
		expect(TPL.match(/<i class="fas fa-caret-down stonetop-follower-section-caret"><\/i>/g)).toHaveLength(6);
		expect(declarations(CSS, ".stonetop-follower-section-caret")).toMatch(/margin-left:\s*auto/);
		// And the arrow that used to sit at the HEAD of the heading is gone, or the fold would
		// carry two.
		expect(ownRule(CSS, ".stonetop-follower-section-summary::before")).toBeFalsy();
	});

	it("orders the subtitle after the caret so the caret keeps the heading's line", () => {
		// The subtitle is flex-basis:100%. Left in source order it would push the caret, which
		// comes after it in the markup, onto a second line.
		expect(declarations(CSS, ".stonetop-follower-section-heading > .stonetop-follower-section-subtitle"))
			.toMatch(/order:\s*1/);
	});

	it("draws the card fold with the same caret, sized through the same chain", () => {
		const anchor = TPL.match(/<a class="stonetop-follower-card-fold"[\s\S]*?<\/a>/)?.[0];
		expect(anchor).toContain('<i class="fas fa-caret-down">');
		// 0.9em of --st-fs-sm in both places: read off the band's own font-size instead, the
		// glyph came out ~3px wider than the four below it.
		expect(declarations(CSS, ".stonetop-follower-card-fold")).toMatch(/font-size:\s*var\(--st-fs-sm\)/);
		expect(declarations(CSS, ".stonetop-follower-card-fold > i")).toMatch(/font-size:\s*0\.9em/);
		expect(declarations(CSS, ".stonetop-follower-section-caret")).toMatch(/font-size:\s*0\.9em/);
	});

	it("is a real <i> everywhere, never a Font Awesome pseudo-element", () => {
		// `content: "\\f0d7"` needs the FA family set in CSS, and setting font-family on an FA
		// icon here is what turns glyphs into codepoint boxes. A child <i> carries its own
		// .fas rule safely.
		expect(CSS).not.toMatch(/\.stonetop-follower-(card-fold|section-caret)::(before|after)\s*\{[^}]*content/);
	});

	it("turns the same way: down while open, right while shut", () => {
		expect(declarations(CSS, ".stonetop-follower-card.is-collapsed .stonetop-follower-card-fold > i"))
			.toMatch(/transform:\s*rotate\(-90deg\)/);
		expect(declarations(
			CSS,
			"details.stonetop-crew-collapsible:not([open]) > .stonetop-follower-section-summary > .stonetop-follower-section-caret",
		)).toMatch(/transform:\s*rotate\(-90deg\)/);
	});

	it("keeps one top padding open or shut, so a toggled heading never jumps", () => {
		// Shut-only trimming moved the heading text 3px on every toggle (9.5px under the rule
		// open, 6px shut). Top is shared; only the bottom differs.
		expect(declarations(CSS, "details.stonetop-crew-collapsible")).toMatch(/padding-top:\s*5px/);
		const shut = declarations(CSS, "details.stonetop-crew-collapsible:not([open])");
		expect(shut).toMatch(/padding-bottom:\s*5px/);
		expect(shut).not.toMatch(/padding(-top|-block)?:/);
	});

	it("gives Details the same 12px of whitespace the Armor line has under the header", () => {
		// Measured ink-to-ink: 12px above "Armor" at 16px and 20px roots. Shut, the shared
		// 5px fold padding left Details 8.3/7.8px under its rule and 7.8/9.2px above the card
		// edge; 9px top and 8px bottom land within ~1px of 12 at both sizes.
		const rule = declarations(CSS, "details.stonetop-follower-details-fold.stonetop-crew-collapsible");
		expect(rule).toMatch(/padding-top:\s*9px/);
		expect(rule).toMatch(/padding-bottom:\s*8px/);
		// Must out-rank the generic shut rule, which carries :not([open]) at (0,2,1), and follow it.
		expect(CSS.indexOf("details.stonetop-follower-details-fold.stonetop-crew-collapsible {"))
			.toBeGreaterThan(CSS.indexOf("details.stonetop-crew-collapsible:not([open]) {"));
		// Open, the contents start 12px under the heading rather than 6px.
		expect(declarations(CSS, ".stonetop-follower-details-body")).toMatch(/padding-top:\s*6px/);
	});

	it("cancels the body's bottom padding under Details, so shut it is balanced like the rest", () => {
		// Shut, Details had 6px above its heading and 17px below; the crew's sections, which
		// are card children with nothing under them, have 5-6px either side.
		expect(declarations(CSS, ".stonetop-follower-body")).toMatch(/padding:\s*9px 12px 11px/);
		expect(declarations(CSS, ".stonetop-follower-details-fold")).toMatch(/margin-bottom:\s*-11px/);
	});

	it("pulls the Details fold out of the body's gutter so all four line up", () => {
		// Details lives inside .stonetop-follower-body (12px gutter) while the crew's three
		// sections are children of the card, so it was inset twice: its heading, caret and rule
		// all sat 12px further in than the folds directly beneath it. Measured 26.5px vs 14.5px
		// from the card edge before this, 14.5 for all four after.
		expect(declarations(CSS, ".stonetop-follower-details-fold")).toMatch(/margin-inline:\s*-12px/);
	});
});

describe("the accordion", () => {
	it("shuts a card's other folds when one opens, and a modifier pins instead", () => {
		const code = stripComments(SHEET);
		expect(code).toMatch(/pinFold = ev\.shiftKey \|\| ev\.ctrlKey \|\| ev\.metaKey/);
		expect(code).toMatch(/if \(fold\.open && !pinFold\)/);
		// Scoped to the card, or opening the crew's Roster would shut the dog's Details.
		expect(code).toMatch(/fold\.closest\("\.stonetop-follower-card"\)/);
	});
});

describe("editing overrides the folds without overwriting them", () => {
	it("forces the Details fold and the card open under the pencil", () => {
		expect(SHEET).toMatch(/card\.detailsOpen\s*=\s*editing \|\| this\._openCrewSections\.has\(`details:\$\{cardId\}`\)/);
		expect(SHEET).toMatch(/card\.cardFolded\s*=\s*!editing &&/);
	});

	it("never writes that override back to the persisted set", () => {
		// The only writers are the <details> toggle handler and _wireCollapsible, both driven by
		// a real click. withFolds only READS the sets.
		const withFolds = SHEET.slice(SHEET.indexOf("const withFolds = (card) =>"), SHEET.indexOf("const finalize = (card) =>"));
		expect(withFolds).toBeTruthy();
		expect(withFolds).not.toMatch(/\.add\(|\.delete\(|_persist/);
	});

	// ...and the toggle handler must not write it back either. A fold rendered open fires `toggle`
	// as it is parsed, and a Details fold the pencil opened is not in the set, so the handler used
	// to record it and let the accordion shut the card's other folds: the Roster holding the group
	// size field included, which is the very field the pencil was opened to reach.
	it("marks a fold only the pencil holds open, and the toggle handler leaves it alone", () => {
		expect(SHEET).toMatch(/card\.detailsForced\s*=\s*editing && !this\._openCrewSections\.has\(`details:\$\{cardId\}`\)/);
		const fold = TPL.match(/<details class="[^"]*stonetop-follower-details-fold[^"]*"[^>]*>/)?.[0];
		expect(fold).toContain("{{#if detailsForced}} data-forced-open{{/if}}");
		const code = stripComments(SHEET);
		const handler = code.slice(code.indexOf('.stonetop-crew-collapsible").on("toggle"'));
		const guard = handler.indexOf('if (fold.open && "forcedOpen" in fold.dataset) return;');
		expect(guard).toBeGreaterThan(-1);
		// Before anything is recorded or shut.
		expect(guard).toBeLessThan(handler.indexOf("this._openCrewSections.add(id)"));
	});

	it("marks the card so the band can fall back to a column", () => {
		// Every card variant carries it; the band's CSS keys off :not(.is-editing).
		const cards = TPL.match(/class="stonetop-follower-card[^"]*\{\{#if edit\.card\}\} is-editing\{\{\/if\}\}/g);
		expect(cards).toHaveLength(5);
	});
});
