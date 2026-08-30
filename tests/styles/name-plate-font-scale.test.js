import { describe, it, expect } from "vitest";
import { readCss, declarations } from "../fakes/css.js";

// The character sheet's name plate is SPLIT on the sheetFontScale setting: the name is exempt,
// the "I am called..." label above it is not. This file keeps both halves where they are, because
// each of them fails silently in the opposite direction.
//
// Why the name is exempt: it is the one thing on the sheet that is already far bigger than it has
// to be to be read (40px against a body text of ~14). A reader turning the slider up is asking for
// the text they are struggling with to grow; the name growing too only costs them header. At 1.4
// it reached 56px, pushed the rest of the header down, and outgrew the fixed-50px glyphs standing
// beside it in its own row.
//
// Why the label is NOT: none of that reasoning reaches it. At 0.65rem it is ~10px, the smallest
// text on the sheet. Freezing it — which is the natural thing to do when the exemption is
// remembered as belonging to "the name plate" rather than to the name — made it the one piece of
// sheet text the slider could not reach, so it shrank relative to everything around it the further
// the setting was turned up, for the reader the setting exists for.
//
// Why either needs a test: both are the ABSENCE or PRESENCE of one multiplier in one declaration,
// nothing throws either way, and the symptom in each direction is something a person would be
// looking straight at and calling correct — a header that grows, or a caption that looks
// deliberately small.

const CSS = readCss();

/** Everything an exact selector declares, across every rule that names it. */
const block = selector => declarations(CSS, selector);

const LABEL = ".stonetop-name-called-label";
const NAME  = ".stonetop-name-called-box .stonetop-name-field";

describe("the name does not take the font-scale setting", () => {
	it("sizes the name at a flat 40px, with no scale variable in it", () => {
		const rule = block(NAME);
		expect(rule, `${NAME}'s rule is gone`).toBeTruthy();
		expect(rule).toMatch(/font-size:\s*40px\s*!important\s*;/);
		expect(rule, `${NAME} is reading --stonetop-font-scale again`)
			.not.toMatch(/--stonetop-font-scale/);
	});

	// `em` is the back door, and it is wide open: the setting is applied by scaling the font-size
	// of `.stonetop .window-content`, so every em below it is already multiplied and an em-based
	// size on the name would track the slider with no mention of the variable anywhere.
	it("states that size in a unit the window-content scale cannot reach", () => {
		expect(block(NAME), `${NAME} sizes itself in em, which the scale reaches`)
			.not.toMatch(/font-size:[^;]*\bem\b/);
		// The anchor the paragraph above is about. If this ever stops being how the setting is
		// applied, the `px` reasoning has to be re-checked rather than assumed.
		expect(block(".stonetop .window-content"))
			.toMatch(/font-size:\s*calc\(1em \* var\(--stonetop-font-scale/);
	});

	// The name shares its row with the Lightbearer's candle and the Judge's scales, which are a
	// flat 50px. That they do not scale either is what makes the row hold together at every
	// setting — and it is half the reason the name stopped scaling.
	it("keeps the name in step with the fixed-height glyphs beside it", () => {
		expect(block(".stonetop-holy-light-icon")).toMatch(/height:\s*50px/);
		expect(block(".stonetop-holy-light-icon")).not.toMatch(/--stonetop-font-scale/);
	});
});

describe("the label above it still does", () => {
	it("multiplies its own size by the setting", () => {
		const rule = block(LABEL);
		expect(rule, `${LABEL}'s rule is gone`).toBeTruthy();
		expect(rule, `${LABEL} has been frozen along with the name below it`)
			.toMatch(/font-size:\s*calc\(0\.65rem \* var\(--stonetop-font-scale, 1\)\)\s*;/);
	});

	// The label is the smaller of the two by a wide margin, which is the whole reason it is not
	// swept in with the name. If it ever grows to a size where the header argument would apply to
	// it as well, that is a decision to make deliberately rather than to inherit from this file.
	it("is the small half of the plate, which is why the two are treated differently", () => {
		expect(block(LABEL)).toMatch(/font-size:\s*calc\(0\.65rem/);
		expect(block(NAME)).toMatch(/font-size:\s*40px/);
	});
});
