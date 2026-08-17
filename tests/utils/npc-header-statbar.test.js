import { describe, it, expect } from "vitest";
import { readCss, declarations } from "../fakes/css.js";

// The NPC header's Hit Points + Armor bar stacks Armor UNDER Hit Points once the window is too
// narrow to hold both beside the name. The header wants portrait (120) + gap + name column
// (200px floor) + gap + both cells (132 + 6 + 92), about 570px of content, against a sheet whose
// own minimum is 520px — so without this the last cell was cut off by .window-content's
// `overflow-x: hidden`, and cut off SILENTLY: no scrollbar, no overflow, just a missing Armor box.
//
// Two declarations carry it, and each looks like a tidy-up candidate on its own:
//   - the bar must be allowed to shrink at all, and to wrap when it does;
//   - the name column must claim NO width up front, or the row is in overflow at every size and
//     the bar wraps even on a wide sheet (measured: it stacked at 760px).
// Layout itself is verified in a browser; these guard the declarations behind it.

const CSS = readCss();

/**
 * Every declaration block whose selector list contains `selector` as a whole comma-separated
 * entry, joined. ALL of them, not the first: these selectors are shared with the monster header
 * (`.stonetop-monster-statbar .cell--…, .stonetop-npc-statbar .cell--…`), so the behaviour comes
 * from the cascade of two rules and a first-match lookup would read only half of it. See
 * fakes/css.js.
 */
const block = (selector) => declarations(CSS, selector);

/** Nesting depth at a byte offset: 0 is top level, 1 is inside an @media block. */
function depthAt(offset) {
	let depth = 0;
	for (let i = 0; i < offset; i++) {
		if (CSS[i] === "{") depth++;
		else if (CSS[i] === "}") depth--;
	}
	return depth;
}

describe("the NPC header stat bar on a narrow sheet", () => {
	it("lets the bar shrink instead of overflowing the window", () => {
		const b = block(".stonetop-npc-statbar");
		expect(b, "the stat bar rule is gone").toBeTruthy();
		// flex-shrink must not be 0. `flex: 0 0 auto` was the original, and is the bug.
		expect(b).toMatch(/flex:\s*0\s+1\s+auto/);
		// NO `min-width: 0`: the flex floor has to stay at min-content, which for a wrapping row
		// is the widest cell (132px). That floor is what makes it stop at one column of cells
		// rather than shrinking on until a cell is clipped in half.
		expect(b).not.toMatch(/min-width:\s*0/);
	});

	it("wraps the cells, left-aligned, rather than squeezing them", () => {
		const b = block(".stonetop-npc-statbar .cell--attributes-top");
		expect(b, "the wrap rule is gone").toBeTruthy();
		expect(b).toMatch(/flex-wrap:\s*wrap/);
		// Cross-axis, so the two rows sit together at the top instead of being spread down a
		// header that is usually taller than they are (the name column is floored to the portrait).
		expect(b).toMatch(/align-content:\s*flex-start/);
	});

	it("keeps the cells at their own widths when they wrap", () => {
		// If these ever grow, a stacked Armor would no longer line up under Hit Points.
		expect(block(".stonetop-npc-statbar .cell--attributes-top .cell")).toMatch(/flex:\s*0\s+0\s+auto/);
	});

	it("gives the name column a zero flex-basis, so the row is not always in overflow", () => {
		// With `auto` the base size is the name's max-content width in a large display face,
		// which is wider than the column ever gets — so the row was permanently negative and the
		// bar wrapped at every window size, not just narrow ones.
		const b = block(".stonetop-npc-header-text");
		expect(b, "the name column rule is gone").toBeTruthy();
		expect(b).toMatch(/flex:\s*1\s+1\s+0/);
		// The floor that decides WHEN the bar stacks: the row only goes negative once the name
		// column is already down on this.
		expect(b).toMatch(/min-width:\s*200px/);
	});

	it("does not rely on the viewport-width media query that could never fire", () => {
		// There is a `@media (max-width: 720px)` block that wraps this same row for the monster
		// header. A media query measures the VIEWPORT, so on any normal monitor it never fires
		// however narrow the WINDOW is dragged — which is why the clipping showed up despite it.
		// The rules that carry the fix have to sit at top level, where the sheet's own width is
		// what decides. Nesting depth is read directly rather than inferred from the text.
		const wrapAt = CSS.lastIndexOf("flex-wrap: wrap",
			CSS.indexOf("align-content: flex-start", CSS.indexOf(".stonetop-npc-statbar .cell--attributes-top")));
		expect(wrapAt).toBeGreaterThan(-1);
		expect(depthAt(wrapAt), "the wrap rule has been moved inside an @media block").toBe(1);

		const basisAt = CSS.indexOf("flex: 1 1 0", CSS.indexOf(".stonetop-npc-header-text"));
		expect(basisAt).toBeGreaterThan(-1);
		expect(depthAt(basisAt), "the name column's basis has been moved inside an @media block").toBe(1);
	});
});
