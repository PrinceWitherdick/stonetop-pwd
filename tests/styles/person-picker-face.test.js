import { describe, it, expect } from "vitest";
import { readCss, declarations } from "../fakes/css.js";

// How big the placeholder head in the person picker's circle is set.
//
// WHAT THIS GUARDS, AND WHY NOTHING ELSE WOULD CATCH IT. The circle is a FIXED 26px box that
// centres its contents with `place-items: center`, and that centring is exact -- the icon's box
// and the circle's box measure equal in the DOM, so every layout assertion anybody could write
// passes while the artwork sits visibly off centre. A glyph is painted from its BASELINE, and the
// rasteriser snaps a baseline to the pixel grid differently at every fractional font size.
//
// Sized from `--st-fs-xs` (0.92em) the glyph landed on a different fractional size at every UI
// scale -- 11.27, 12.88, 14.49, 16.1, 19.32px -- and scanned off the real paint against the real
// Pro webfont its ink missed the circle's middle by 0.25, -1.25, -0.75, 0.38 and 0.00px at roots
// 14/16/18/20/24. Worst at the DEFAULT root of 16, which is the one that got reported. A whole
// 14px reads 0.25, 0.38, -0.50, 0.13, -0.13: half a pixel, which is the quantisation itself.
//
// The em also grew the head from 11.3px to 19.3px across those scales inside a circle that never
// moved, so the same face pressed on its own ring for a reader who had turned the UI font up.
//
// Probes: z:/tmp/foundry-verify/picker-face-nudge.mjs and picker-face-size.mjs.

const CSS = readCss();

const FACE = declarations(CSS, ".stonetop-person-picker-face");
const REL_EMPTY = declarations(CSS, ".stonetop-rel-portrait--empty i");

describe("the placeholder head in the person picker's circle", () => {
	it("finds the rules it measures, so the checks below mean something", () => {
		expect(FACE, ".stonetop-person-picker-face").toBeTruthy();
		expect(REL_EMPTY, ".stonetop-rel-portrait--empty i").toBeTruthy();
	});

	// ⚠ A WHOLE PIXEL. See the head of this file: a fractional size is what put the ink off centre.
	it("sets the glyph in whole pixels rather than in ems of the reader's UI font", () => {
		const said = /font-size:\s*([\d.]+)px\s*;/.exec(FACE);
		expect(said, "font-size: <n>px on .stonetop-person-picker-face").toBeTruthy();
		expect(Number.isInteger(Number(said[1])), `font-size: ${said[1]}px is not a whole pixel`).toBe(true);
		expect(FACE, "an em size is the bug this rule exists to hold shut").not.toMatch(/font-size:\s*var\(--st-fs/);
	});

	// The two surfaces show the same village. The picker's own comment promises they read as one
	// set of portraits, and for the faces with no art that promise IS this number.
	it("sets it to the same size as the character sheet's own empty face", () => {
		const here = /font-size:\s*([\d.]+)px/.exec(FACE);
		const there = /font-size:\s*([\d.]+)px/.exec(REL_EMPTY);
		expect(there, "font-size on .stonetop-rel-portrait--empty i").toBeTruthy();
		expect(here[1]).toBe(there[1]);
	});

	// ⚠ THE RESIDUAL CHANGES SIGN between one root size and the next, so a nudge that improves one
	// scale spoils another -- a sweep from 0.02em to 0.12em made the worst case worse at every
	// value. A `transform` or a `top` appearing here would be that mistake being made again.
	it("carries no optical nudge, because no single one is right at every UI scale", () => {
		expect(FACE, "translateY on the face").not.toMatch(/transform:\s*translate/);
		const glyph = declarations(CSS, ".stonetop-person-picker-face > i")
			?? declarations(CSS, ".stonetop-person-picker-face i");
		if (glyph) {
			expect(glyph, "a nudge on the glyph inside the face").not.toMatch(/transform:\s*translate|top:\s*[\d.]/);
		}
	});
});
