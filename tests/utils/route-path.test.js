import { describe, it, expect } from "vitest";
import { routeDots, routeLegs } from "../../module/utils/route-path.js";

// The beads that make the route read as a dotted line on a Scene.
//
// The rest of route-path.js is proven in tests/dialogs/expedition-journey.test.js, which has
// covered that geometry since it was six methods on the walkthrough. This file covers the one
// function that only the canvas renderer needs: in the dialog the browser walks the curve and
// lays the dashes, and on a Scene nothing does, so `routeDots` is the walk written out.

/** Distances between consecutive beads, measured the way the eye measures them. */
function gaps(dots, aspect) {
	return dots.slice(1).map((dot, i) => {
		const previous = dots[i];
		return Math.hypot(dot.left - previous.left, (dot.top - previous.top) / aspect);
	});
}

describe("beading the route line", () => {
	it("starts on the first stop, so the line begins where the party does", () => {
		const legs = routeLegs([{ left: 10, top: 50 }, { left: 90, top: 50 }], 1.4);
		const [first] = routeDots(legs, 1.4, 4);
		expect(first.left).toBeCloseTo(10, 6);
		expect(first.top).toBeCloseTo(50, 6);
	});

	it("spaces every bead the same distance apart", () => {
		const legs = routeLegs([{ left: 5, top: 20 }, { left: 80, top: 70 }], 1.4);
		const spread = gaps(routeDots(legs, 1.4, 3), 1.4);
		expect(spread.length).toBeGreaterThan(5);
		for (const gap of spread) expect(gap).toBeCloseTo(3, 2);
	});

	// The whole reason the walk happens in the box's real proportions. On a map half again as
	// wide as it is tall, stepping the raw percentages would bunch the beads up on a leg running
	// north and string them out on one running east, and the same line would look like two
	// different dot patterns depending on which way the party happened to be walking.
	it("spaces them evenly TO THE EYE, on a box wider than it is tall", () => {
		const aspect = 1.4;
		const east = routeDots(routeLegs([{ left: 20, top: 50 }, { left: 80, top: 50 }], aspect), aspect, 3);
		const south = routeDots(routeLegs([{ left: 50, top: 8 }, { left: 50, top: 92 }], aspect), aspect, 3);
		// Same span on screen, so the same number of beads: 60 across and 84/1.4 = 60 down.
		expect(south.length).toBe(east.length);
		for (const gap of gaps(south, aspect)) expect(gap).toBeCloseTo(3, 2);
	});

	// Carried across legs rather than restarted at each stop. A leg whose length is not a whole
	// number of gaps would otherwise crowd two beads together at every stop between the ends,
	// and a run of short legs would read as a string of separate dotted lines that happen to meet.
	it("carries the spacing across a stop instead of restarting at it", () => {
		const legs = routeLegs(
			[{ left: 0, top: 50 }, { left: 17, top: 50 }, { left: 40, top: 50 }, { left: 71, top: 50 }], 1.4);
		const spread = gaps(routeDots(legs, 1.4, 2.5), 1.4);
		for (const gap of spread) expect(gap).toBeCloseTo(2.5, 2);
	});

	it("follows the bow rather than the chord", () => {
		// Every bead of a bowed leg but the two ends stands off the straight line between them.
		const legs = routeLegs([{ left: 10, top: 50 }, { left: 90, top: 50 }], 1.4);
		const dots = routeDots(legs, 1.4, 4);
		const middle = dots[Math.floor(dots.length / 2)];
		expect(Math.abs(middle.top - 50)).toBeGreaterThan(0.5);
	});

	it("answers nothing for a line with no legs, no spacing, or no arguments at all", () => {
		expect(routeDots([], 1.4, 4)).toEqual([]);
		expect(routeDots(null, 1.4, 4)).toEqual([]);
		expect(routeDots(routeLegs([{ left: 0, top: 0 }, { left: 9, top: 9 }], 1.4), 1.4, 0)).toEqual([]);
	});

	// Two stops drawn on one spot is a real case (the travel graph has legs whose ends share a
	// spot on the outer map), and a walk with nowhere to walk must not spin.
	it("terminates on a leg of no length", () => {
		const legs = routeLegs([{ left: 30, top: 30 }, { left: 30, top: 30 }], 1.4);
		expect(routeDots(legs, 1.4, 2)).toHaveLength(1);
	});
});
