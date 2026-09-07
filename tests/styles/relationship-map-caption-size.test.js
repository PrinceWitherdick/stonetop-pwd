import { describe, it, expect } from "vitest";
import { readCss, readRepo, declarations, stripComments } from "../fakes/css.js";
import { RELMAP_CAPTION_PX } from "../../module/utils/relmap-geometry.js";
import { RELMAP_SIZES, RELMAP_SIZE_MAX, RELMAP_SIZE_MIN } from "../../module/relmap/relmap-store.js";

// How big the writing on a line is set, where the stylesheet and the arithmetic have to agree.
//
// WHAT IS ACTUALLY AT STAKE. The window MEASURES a caption to decide where its sentence is cut and
// how wide a hole to open in the stroke underneath it, and every one of those sums is done in board
// pixels against `RELMAP_CAPTION_PX`. The sheet is what actually paints the type. Drift between the
// two is not a wrong-looking caption: it is a sentence cut for one size and drawn at another, in a
// gap cut for a third, and nothing anywhere would report it.
//
// ⚠ AND THE SIZE HAS TO REACH THE PAINT AS A CUSTOM PROPERTY. Two rules must be able to win over a
// line's own size: the held caption blown up while the board is zoomed too far out to read
// anything, and whatever the accessibility skin has to say about type. An inline `font-size` is the
// top of the cascade and would beat both of them.

const CSS = readCss();
const BOARD = stripComments(readRepo("templates/dialogs/partials/relationship-map-board.hbs"));

const CAPTION = declarations(CSS, ".stonetop-relmap-label-text");
const HELD = declarations(
	CSS,
	".stonetop-relmap.captions-tiny .stonetop-relmap-label.is-picked .stonetop-relmap-label-text",
);

describe("the size the writing on a line is set in", () => {
	it("finds the rules it measures, so the checks below mean something", () => {
		expect(CAPTION, ".stonetop-relmap-label-text").toBeTruthy();
		expect(HELD, "the held caption while the board is zoomed out").toBeTruthy();
	});

	// The join nothing else would notice breaking.
	it("paints the ordinary caption at the size the arithmetic measures it at", () => {
		const said = /font-size:\s*var\(\s*--relmap-caption-px\s*,\s*([\d.]+)px\s*\)/.exec(CAPTION);
		expect(said, "font-size: var(--relmap-caption-px, <base>px)").toBeTruthy();
		expect(Number(said[1])).toBe(RELMAP_CAPTION_PX);
	});

	// ⚠ A PROPERTY AND NOT A `font-size`, so the two rules that have to out-rank a line's own size
	// still can. See the head of this file.
	it("hands a chosen size to the sheet as a property rather than as type", () => {
		expect(BOARD).toMatch(/--relmap-caption-px:\s*\{\{px\}\}px/);
		expect(BOARD).not.toMatch(/style="font-size/);
	});

	// The held line's caption is the only place a reader's typing shows while the board is zoomed
	// out, so it is blown up to stay readable -- and that has to beat a line set in eight pixels.
	it("still blows the held caption up over whatever size that line was set in", () => {
		expect(HELD).toMatch(/font-size:\s*var\(\s*--relmap-say-px/);
	});

	// The steps a reader is offered have to be steps a reader can be given: the floor is the size
	// below which the board draws no captions at all, so a step under it would be one nobody ever
	// sees, and the ceiling is what `readSize` will actually store.
	it("offers only sizes the store will keep", () => {
		expect(RELMAP_SIZES.length).toBeGreaterThan(1);
		for (const { key, px } of RELMAP_SIZES) {
			expect(px, key).toBeGreaterThanOrEqual(RELMAP_SIZE_MIN);
			expect(px, key).toBeLessThanOrEqual(RELMAP_SIZE_MAX);
		}
		// One of them IS the ordinary size, because "put it back" has to be on the list.
		expect(RELMAP_SIZES.some(step => step.px === RELMAP_CAPTION_PX)).toBe(true);
	});
});
