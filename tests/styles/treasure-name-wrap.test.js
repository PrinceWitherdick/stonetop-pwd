import { describe, expect, it } from "vitest";
import { beats, declarations, readCss, specificity } from "../fakes/css.js";

/**
 * A long inventory name wraps BESIDE its load markers instead of dropping below them, on every row
 * that wraps: a Book II treasure, and an artifact write-in carrying a hint, lead or write-up.
 *
 * Those rows are wrapping flex rows (their extra lines stack beneath the name), and a wrapping flex
 * row breaks its lines on each item's one-line width before anything shrinks. The name was sized to
 * its own text (`flex: 0 1 auto`), so a name a word too long to fit beside the ◇s moved whole onto
 * the next line: "A shield of makerglass, etched with Aratis's symbol" under two stranded marks.
 *
 * The tag note takes a line of its own on both kinds. Left beside a write-in's name it competed for
 * the markers' line: a long note squeezed the name to a narrow column four lines deep, or pushed the
 * icons onto a line by themselves.
 *
 * Measured offline against Foundry 14's stylesheet and the shipped partials, at 16px and 20px roots,
 * font scale 1 and 1.25, across four column widths: with these rules the name shares the markers'
 * line at every width, the markers and icons sit on its first line, and a one-line row stays put.
 */

const CSS = readCss();
const ARTIFACT_LINES = [".stonetop-inv-artifact-hint", ".stonetop-inv-artifact-lead", ".stonetop-inv-artifact-lore"];
const WRAPS = `:is(.stonetop-inv-treasure, :has(${ARTIFACT_LINES.join(", ")}))`;
const ROW = `.stonetop-inv-item${WRAPS}`;
const SMALL_ROW = `.stonetop-inv-item.stonetop-inv-small${WRAPS}`;
// The fake specificity counter reads every class inside `:is()`; the cascade takes only its most
// specific argument, one class. So ranks are argued with the treasure spelling, which scores the same.
const AS_TREASURE = ".stonetop-inv-item.stonetop-inv-treasure";

describe("the rows these rules cover are exactly the rows that wrap", () => {
	it("names the same artifact lines as the rule that makes a write-in wrap", () => {
		expect(declarations(CSS, `.stonetop-inv-item:has(${ARTIFACT_LINES.join(", ")})`)).toMatch(/flex-wrap:\s*wrap/);
		expect(declarations(CSS, AS_TREASURE)).toMatch(/flex-wrap:\s*wrap/);
	});
});

describe("the tag note keeps off the name's line", () => {
	const note = declarations(CSS, `${ROW} .stonetop-inv-note`);

	it("claims a whole line after everything on the name's line", () => {
		expect(note).toMatch(/order:\s*1/);
		expect(note).toMatch(/flex-basis:\s*100%/);
	});

	it("hangs by the same calc as the artifact lines stacked with it", () => {
		expect(note).toMatch(/padding-left:\s*calc\(14px \* var\(--stonetop-font-scale, 1\) \+ 4px\)/);
		expect(declarations(CSS, ".stonetop-inv-item .stonetop-inv-artifact-lore"))
			.toMatch(/padding-left:\s*calc\(14px \* var\(--stonetop-font-scale, 1\) \+ 4px\)/);
	});
});

describe("the name joins its markers' line", () => {
	const name = declarations(CSS, `${ROW} .stonetop-inv-label`);

	it("starts from a zero basis, so the line break can never push it off the markers' line", () => {
		expect(name).toMatch(/flex:\s*1 1 0\s*;/);
	});

	it("grows back to its own text and no further, so a short name still ends where its words do", () => {
		expect(name).toMatch(/max-width:\s*max-content/);
	});

	it("outranks the shared name rule that sizes a name to its text", () => {
		expect(declarations(CSS, ".stonetop-inv-label")).toMatch(/flex:\s*0 1 auto/);
		expect(beats(specificity(`${AS_TREASURE} .stonetop-inv-label`), specificity(".stonetop-inv-label"))).toBe(true);
	});

	it("may wrap in the small column, over the rule that holds small gear to one line", () => {
		expect(declarations(CSS, `${SMALL_ROW} .stonetop-inv-label`)).toMatch(/white-space:\s*normal/);
		expect(declarations(CSS, ".stonetop-inv-item.stonetop-inv-small .stonetop-inv-label")).toMatch(/white-space:\s*nowrap/);
		expect(beats(specificity(`${AS_TREASURE}.stonetop-inv-small .stonetop-inv-label`),
			specificity(".stonetop-inv-item.stonetop-inv-small .stonetop-inv-label"))).toBe(true);
	});
});

describe("everything on the name's line is pinned to its first line", () => {
	it("aligns the row to its top rather than centring it against a wrapped name", () => {
		expect(declarations(CSS, ROW)).toMatch(/align-items:\s*flex-start/);
		expect(beats(specificity(AS_TREASURE), specificity(".stonetop-inv-item"))).toBe(true);
	});

	it("gives the ◇ markers a box one line tall to centre in", () => {
		expect(declarations(CSS, `${ROW} .stonetop-inv-diamonds`)).toMatch(/min-height:\s*1lh/);
	});

	it("drops the small column's checkbox to that line's middle, through the size the checkbox is drawn at", () => {
		expect(declarations(CSS, `${SMALL_ROW} .stonetop-inventory-item-check`))
			.toMatch(/margin-top:\s*calc\(\(1lh - var\(--st-check-size\)\) \/ 2\)/);
		// The offset is only centred while the box is the size the shared checkbox skin draws it:
		// both read the one token.
		expect(declarations(CSS, ".stonetop-onboarding-check"))
			.toMatch(/height:\s*var\(--st-check-size\) !important/);
	});

	for (const icon of [".stonetop-inv-artifact-chip", ".stonetop-inv-lore-toggle", ".stonetop-inv-artifact-identify",
		".stonetop-inv-artifact-gm", ".stonetop-inv-delete", ".stonetop-inv-remove-special"]) {
		it(`${icon} takes one full row line, whatever its own font size`, () => {
			expect(declarations(CSS, `${ROW} ${icon}`)).toMatch(/line-height:\s*1lh/);
		});
	}
});
