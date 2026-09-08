import { describe, it, expect } from "vitest";
import { readCss, declarations } from "../fakes/css.js";

// The ticks on "Who goes on the map?", which are the system's spiral checkbox and not the
// browser's.
//
// ⚠ WHY THIS FILE EXISTS AT ALL, AND WHY THE MARKUP TEST NEXT DOOR IS NOT ENOUGH. Foundry v13's
// core stylesheet styles `body.game .app input[type=checkbox]` at specificity (0,3,2), so a
// checkbox that is not explicitly skinned does not fall back to nothing -- it renders as a native
// browser box, in the middle of a window whose every other control is drawn. There is no error and
// no missing rule to notice: the window simply ships with one control that belongs to a different
// system. The skin lives in the shared master block near the top of styles/stonetop.css, whose
// whole job is that one list of class names, and a class left off it is exactly this bug.
//
// tests/dialogs/person-picker.test.js holds the other half of the pair: that the template puts
// `.stonetop-person-picker-check` on every checkbox it draws (and on no radio). This one holds
// that the class is on the block, so the two together are the guarantee.

const CSS = readCss();

const CHECK = declarations(CSS, ".stonetop-person-picker-check");
const CHECKED = declarations(CSS, ".stonetop-person-picker-check:checked");
const PART_WAY = declarations(CSS, ".stonetop-person-picker-all-check:indeterminate");
const MASTER = declarations(CSS, ".stonetop-check");

describe("the person picker's checkbox", () => {
	it("is on the master block, not on a rule of its own", () => {
		expect(CHECK, ".stonetop-person-picker-check reaches no rule at all").toBeTruthy();
		// The same body as `.stonetop-check`, which is what "it joined the list" means: a
		// look-alike rule copied next to the block would drift from it the next time the art or
		// the sizing moved.
		expect(CHECK).toBe(MASTER);
	});

	// The art, both ways round. Through the variables and not the file names: those tokens swap to
	// the light-ink artwork under a dark theme, and a literal URL here would be a black spiral on a
	// black bed for anyone reading in one.
	it("wears the spiral art empty and ticked", () => {
		expect(CHECK).toMatch(/background:\s*var\(--stonetop-checkbox-icon\)/);
		expect(CHECKED, ":checked reaches no rule").toBeTruthy();
		expect(CHECKED).toMatch(/background:\s*var\(--stonetop-checkbox-checked-icon\)/);
	});

	// ⚠ `appearance: none` HIDES THE BROWSER'S OWN DASH, so a box the dialog sets `indeterminate`
	// on would read as empty -- "Select all" saying nobody is, over a list with four names
	// ticked. The bar is painted here instead, layered over the empty spiral.
	it("paints its own part-way bar, since the native one is gone", () => {
		expect(CHECK).toMatch(/appearance:\s*none/);
		expect(PART_WAY, ".stonetop-person-picker-all-check:indeterminate reaches no rule").toBeTruthy();
		expect(PART_WAY).toMatch(/linear-gradient\(currentColor, currentColor\)/);
		expect(PART_WAY).toMatch(/var\(--stonetop-checkbox-icon\)/);
	});

	// The radio on the one-answer question is a real radio and keeps its own pinning; what must
	// not come back is the `input[type="checkbox"]` half of that selector, which said the picker
	// skinned its checkboxes with an accent colour.
	it("leaves no accent-colour rule claiming the checkboxes", () => {
		const pinned = declarations(CSS, '.stonetop-person-picker-row input[type="radio"]');
		expect(pinned, "the radio pinning is gone").toBeTruthy();
		expect(pinned).toMatch(/accent-color:\s*slategrey/);
		expect(declarations(CSS, '.stonetop-person-picker-row input[type="checkbox"]')).toBe(null);
	});
});

describe('the "Select all" row', () => {
	const ROW = declarations(CSS, ".stonetop-person-picker-all");

	it("finds its rule, so the checks below mean something", () => {
		expect(ROW, ".stonetop-person-picker-all").toBeTruthy();
	});

	// ⚠ THE BUG THIS EXISTS TO HOLD SHUT, because it is the one a tidy-minded reader of the CSS
	// would put back. The names below each start one 26px portrait in, so lining the label up with
	// them looks obviously right in the stylesheet -- and on screen it reads as a checkbox whose
	// label has come adrift, with an empty circle's worth of nothing between the two. This row has
	// no portrait and owes that column nothing: its words sit beside its own tick, on the row's own
	// 0.6em gap, and no rule may push them off it.
	it("keeps its label beside its own tick, not out at the portrait column", () => {
		expect(ROW).toMatch(/gap:\s*0\.6em/);
		expect(declarations(CSS, ".stonetop-person-picker-all-text"),
			"an indent rule on the label is the gap this row was reported for").toBe(null);
		expect(ROW, "and it must not be indented as a whole either")
			.not.toMatch(/padding-left:\s*calc|text-indent:/);
	});

	// The hairline under it follows the ink rather than being a black line, so it does not stay
	// black on the dark theme's bed. Same reasoning as the row hover beside it.
	it("rules itself off from the names in ink, not in black", () => {
		expect(ROW).toMatch(/border-bottom:[^;]*color-mix\(in srgb, currentColor/);
	});

	// Italic is the voice the notes under each name are written in -- an aside about a person.
	// This row is a control the reader presses; it is held quiet by ink and size instead.
	it("sets its label upright", () => {
		expect(ROW).not.toMatch(/font-style:\s*italic/);
		expect(ROW).toMatch(/color:\s*var\(--st-quiet-ink\)/);
	});
});
