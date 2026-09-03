import { describe, it, expect } from "vitest";
import { NUDGE_FINE, NUDGE_STEP, dragTranslation } from "../../module/utils/relmap-drag.js";
import { isCommittedDrop, isLiftedDrag } from "../../module/utils/relationship-board.js";

// The arithmetic behind moving a portrait, and the thresholds that decide whether a press was a
// drag at all. The listener plumbing itself needs a DOM and is exercised through the window suite;
// what is provable here is the part that gets silently wrong.

describe("moving a portrait under the cursor", () => {
	// THE BUG THIS EXISTS TO CATCH. The board is scaled as a whole, so a hundred pixels of cursor
	// is a hundred pixels of BOARD only at 1:1. Miss the division and the portrait slides away from
	// the pointer faster the further in the reader has zoomed, which reads as the map fighting them.
	it("converts cursor travel into board travel at the current zoom", () => {
		expect(dragTranslation({ dx: 100, dy: 50, scale: 1 })).toEqual({ x: 100, y: 50 });
		expect(dragTranslation({ dx: 100, dy: 50, scale: 2 })).toEqual({ x: 50, y: 25 });
		expect(dragTranslation({ dx: 100, dy: 50, scale: 0.5 })).toEqual({ x: 200, y: 100 });
	});

	it("treats a missing or nonsense scale as 1:1 rather than dividing by zero", () => {
		for (const scale of [0, -2, NaN, null, undefined, "x"]) {
			expect(dragTranslation({ dx: 10, dy: 10, scale })).toEqual({ x: 10, y: 10 });
		}
		expect(dragTranslation()).toEqual({ x: 0, y: 0 });
	});
});

describe("the thresholds a press has to cross", () => {
	// Borrowed from the standings board rather than restated, so "how far is a drag" has one answer
	// across the system. This is the assertion that the borrowing is real.
	it("does not become a drag until the press has travelled", () => {
		expect(isLiftedDrag(0, 0)).toBe(false);
		expect(isLiftedDrag(2, 2)).toBe(false);
		expect(isLiftedDrag(0, 12)).toBe(true);
	});

	// The map deliberately does NOT use the commit distance. It exists on the standings board
	// because a card straddles two drop zones and a small twitch could rewrite a rating nobody
	// aimed at; this board has no zones, so a small deliberate nudge is a real edit and refusing it
	// would be the bug. The invariant is only that lifting stays the cheaper of the two.
	it("lifts before it would ever commit, which is what makes the map's choice safe", () => {
		expect(isLiftedDrag(5, 0)).toBe(true);
		expect(isCommittedDrop(5, 0)).toBe(false);
	});
});

describe("nudging from the keyboard", () => {
	// Every gesture needs a route that is not a drag, or the board is unusable to anyone who does
	// not or cannot drag one.
	it("offers a coarse step and a finer one, both small enough to aim with", () => {
		expect(NUDGE_STEP).toBeGreaterThan(NUDGE_FINE);
		expect(NUDGE_FINE).toBeGreaterThan(0);
		expect(NUDGE_STEP).toBeLessThanOrEqual(2);
	});
});
