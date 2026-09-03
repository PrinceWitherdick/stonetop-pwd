import { describe, it, expect } from "vitest";
import {
	RELMAP_BOARD_ASPECT, clampPct, edgeArrowheads, edgeCurve, edgeLabelAnchor, fanBow, freeSpot,
	nodeRadiusPct, ringLayout, ringsLayout,
} from "../../module/utils/relmap-geometry.js";

// The relationship map's arithmetic, which three renderers share: the stretched SVG that strokes
// the lines, the HTML labels riding on top of it, and the fixed-pixel arrowhead SVGs. They agree
// only because they all ask this file, so what is proven here is what keeps a label on its own
// stroke.

const ASPECT = 1.25;

/** The distance the EYE sees between two percentage points, which is not the distance the numbers
 * describe: a step of 1% down is a different number of pixels from a step of 1% across. */
const seen = (a, b, aspect = ASPECT) => Math.hypot(b.left - a.left, (b.top - a.top) / aspect);

/** A point on the curve a `d` describes, at `t`. */
function pointOn(curve, t) {
	const q = (a, b, c) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
	return {
		left: q(curve.from.left, curve.control.left, curve.to.left),
		top: q(curve.from.top, curve.control.top, curve.to.top),
	};
}

describe("fanning the links between one pair of people", () => {
	// The stability rule, and the reason the fan is not symmetric. A symmetric spread looks tidier
	// the moment it is drawn and is wrong the moment anyone edits it: adding a second link would
	// swing the first off the line it had been sitting on, and deleting one would swing the
	// survivor back. Somebody watching the board would see a line they did not touch move.
	it("leaves the first link straight, whatever is added beside it later", () => {
		expect(fanBow(0)).toBe(0);
		expect(fanBow(0)).toBe(0);
	});

	it("spreads later links to alternating sides, widening as it goes", () => {
		expect([1, 2, 3, 4].map(fanBow)).toEqual([1, -1, 2, -2]);
	});

	it("gives every link in a fan its own bow, so none lies on another", () => {
		const bows = [0, 1, 2, 3, 4, 5].map(fanBow);
		expect(new Set(bows).size).toBe(bows.length);
	});

	it("treats rubbish as the straight first link rather than bowing off to NaN", () => {
		for (const bad of [null, undefined, "x", -3, NaN]) expect(fanBow(bad)).toBe(0);
	});
});

describe("the curve between two portraits", () => {
	const r = nodeRadiusPct(72, 1200); // 3% of the board's width

	it("starts and ends ON the rims, not at the centres", () => {
		const from = { left: 20, top: 50 };
		const to = { left: 80, top: 50 };
		const curve = edgeCurve({ from, to, aspect: ASPECT, r });
		expect(seen(from, curve.from)).toBeCloseTo(r, 2);
		expect(seen(to, curve.to)).toBeCloseTo(r, 2);
	});

	// The same test on a line running down the board. This is what the flat-space correction buys:
	// the rim is a CIRCLE of fixed pixels, so in percentages it is an ellipse, and a trim that
	// forgot the aspect would cut a vertical line back by 3% of the HEIGHT instead of the width.
	it("trims to the same visible distance whichever way the link runs", () => {
		const down = edgeCurve({
			from: { left: 50, top: 15 }, to: { left: 50, top: 85 }, aspect: ASPECT, r,
		});
		expect(seen({ left: 50, top: 15 }, down.from)).toBeCloseTo(r, 2);
		expect(seen({ left: 50, top: 85 }, down.to)).toBeCloseTo(r, 2);
	});

	it("bows off the straight line, and further the higher the fan index", () => {
		const ends = { from: { left: 20, top: 50 }, to: { left: 80, top: 50 } };
		const straight = edgeCurve({ ...ends, bow: 0, aspect: ASPECT, r });
		const first = edgeCurve({ ...ends, bow: fanBow(1), aspect: ASPECT, r });
		const second = edgeCurve({ ...ends, bow: fanBow(3), aspect: ASPECT, r });
		const off = curve => Math.abs(pointOn(curve, 0.5).top - 50);
		expect(off(straight)).toBeCloseTo(0, 6);
		expect(off(first)).toBeGreaterThan(1);
		expect(off(second)).toBeGreaterThan(off(first));
	});

	// Opposite sides, so a fan spreads rather than stacking on one flank.
	it("bows the alternating links to opposite sides", () => {
		const ends = { from: { left: 20, top: 50 }, to: { left: 80, top: 50 } };
		const up = pointOn(edgeCurve({ ...ends, bow: fanBow(1), aspect: ASPECT, r }), 0.5).top;
		const down = pointOn(edgeCurve({ ...ends, bow: fanBow(2), aspect: ASPECT, r }), 0.5).top;
		expect(Math.sign(up - 50)).toBe(-Math.sign(down - 50));
	});

	// A bow measured in raw percentages would be flattened along one axis, so the same link would
	// bow visibly deeper running east than running north on a landscape board.
	it("bows as deeply to the EYE whichever way the link runs", () => {
		const across = edgeCurve({
			from: { left: 20, top: 50 }, to: { left: 80, top: 50 }, bow: 1, aspect: ASPECT, r,
		});
		// The same span on screen: 60 across, and 60 * 1.25 = 75 down.
		const down = edgeCurve({
			from: { left: 50, top: 12.5 }, to: { left: 50, top: 87.5 }, bow: 1, aspect: ASPECT, r,
		});
		const depthAcross = seen(pointOn(across, 0.5), { left: 50, top: 50 });
		const depthDown = seen(pointOn(down, 0.5), { left: 50, top: 50 });
		expect(depthDown).toBeCloseTo(depthAcross, 1);
	});

	it("draws nothing between two portraits sitting on the same spot", () => {
		expect(edgeCurve({
			from: { left: 40, top: 40 }, to: { left: 40, top: 40 }, aspect: ASPECT, r,
		})).toBeNull();
	});

	// Two portraits closer together than their own diameters: the whole line is inside them, so
	// there is no stroke, no head and no label to place. Null rather than a curve running backwards.
	it("draws nothing when the portraits swallow the whole link", () => {
		expect(edgeCurve({
			from: { left: 50, top: 50 }, to: { left: 52, top: 50 }, aspect: ASPECT, r,
		})).toBeNull();
	});

	it("answers null rather than NaN for missing ends or a nonsense aspect", () => {
		expect(edgeCurve({ from: null, to: { left: 1, top: 1 } })).toBeNull();
		expect(edgeCurve({})).toBeNull();
		const zero = edgeCurve({
			from: { left: 20, top: 50 }, to: { left: 80, top: 50 }, aspect: 0, r,
		});
		expect(Number.isFinite(zero.from.left)).toBe(true);
		expect(zero.d).not.toMatch(/NaN/);
	});
});

describe("where a link's label rides", () => {
	const r = nodeRadiusPct(72, 1200);

	it("sits ON the curve at its halfway mark, not on the chord between the ends", () => {
		const curve = edgeCurve({
			from: { left: 20, top: 50 }, to: { left: 80, top: 50 }, bow: 2, aspect: ASPECT, r,
		});
		const anchor = edgeLabelAnchor(curve, ASPECT);
		const middle = pointOn(curve, 0.5);
		expect(anchor.left).toBeCloseTo(middle.left, 1);
		expect(anchor.top).toBeCloseTo(middle.top, 1);
		// And that really is off the chord, or the test above would pass on a straight line too.
		expect(Math.abs(anchor.top - 50)).toBeGreaterThan(1);
	});

	// The angle the reader SEES. A label set to the raw percentage angle lies visibly off its own
	// stroke on any diagonal, for the same reason routeArrow corrects: percentages are not square.
	it("turns the label to the angle the eye sees, not the one the numbers describe", () => {
		// 50 across and 50 * 1.25 = 62.5 down is a 45 degree line on screen.
		const curve = edgeCurve({
			from: { left: 25, top: 18.75 }, to: { left: 75, top: 81.25 }, aspect: ASPECT, r,
		});
		expect(edgeLabelAnchor(curve, ASPECT).angle).toBeCloseTo(45, 0);
	});

	it("never sets a label upside down", () => {
		for (const [from, to] of [
			[{ left: 80, top: 50 }, { left: 20, top: 50 }],
			[{ left: 85, top: 20 }, { left: 15, top: 80 }],
			[{ left: 90, top: 80 }, { left: 10, top: 20 }],
		]) {
			const angle = edgeLabelAnchor(edgeCurve({ from, to, aspect: ASPECT, r }), ASPECT).angle;
			expect(angle).toBeGreaterThanOrEqual(-90);
			expect(angle).toBeLessThanOrEqual(90);
		}
	});

	it("has nothing to place for a link that could not be drawn", () => {
		expect(edgeLabelAnchor(null, ASPECT)).toBeNull();
	});
});

describe("the arrowheads that say which way a link is read", () => {
	const r = nodeRadiusPct(72, 1200);
	const curve = () => edgeCurve({
		from: { left: 20, top: 50 }, to: { left: 80, top: 50 }, aspect: ASPECT, r,
	});

	// The ordinary case, and the default. Most ties between people are mutual, and a board of
	// arrows all pointing at each other says less than a board with none.
	it("wears none by default", () => {
		expect(edgeArrowheads(curve(), ASPECT, "none")).toEqual([]);
		expect(edgeArrowheads(curve(), ASPECT)).toEqual([]);
	});

	it("wears one at the far end for a one-way link, pointing that way", () => {
		const [head] = edgeArrowheads(curve(), ASPECT, "a-b");
		expect(head.end).toBe("to");
		expect(head.left).toBeGreaterThan(50);
		expect(head.angle).toBeCloseTo(0, 0);
	});

	it("points the other way when the link is read backwards", () => {
		const [head] = edgeArrowheads(curve(), ASPECT, "b-a");
		expect(head.end).toBe("from");
		expect(head.left).toBeLessThan(50);
		expect(Math.abs(head.angle)).toBeCloseTo(180, 0);
	});

	it("wears two, pointing opposite ways, when it is read both ways", () => {
		const heads = edgeArrowheads(curve(), ASPECT, "both");
		expect(heads).toHaveLength(2);
		const [a, b] = heads.map(h => h.angle);
		expect(Math.abs(Math.abs(a - b) - 180)).toBeLessThan(1);
	});

	it("sits its heads inside the link rather than out past the rims", () => {
		const line = curve();
		for (const head of edgeArrowheads(line, ASPECT, "both")) {
			expect(head.left).toBeGreaterThanOrEqual(line.from.left - 0.01);
			expect(head.left).toBeLessThanOrEqual(line.to.left + 0.01);
		}
	});

	it("has no heads to place for a link that could not be drawn", () => {
		expect(edgeArrowheads(null, ASPECT, "both")).toEqual([]);
	});
});

describe("seating people who have never been placed", () => {
	const r = nodeRadiusPct(72, 1200);

	it("puts one person in the middle", () => {
		expect(ringLayout(1, { aspect: ASPECT, r })).toEqual([{ left: 50, top: 50 }]);
	});

	it("starts at twelve o'clock, so the first person added is always at the top", () => {
		const [first] = ringLayout(6, { aspect: ASPECT, r });
		expect(first.left).toBeCloseTo(50, 1);
		expect(first.top).toBeLessThan(50);
	});

	// A ring laid out in raw percentages comes out as an oval on a landscape board. Laid out in
	// flat space and converted back, it is a circle to the eye.
	it("lays a ring that is round TO THE EYE, not an oval", () => {
		const ring = ringLayout(12, { aspect: ASPECT, r });
		const radii = ring.map(p => seen({ left: 50, top: 50 }, p));
		for (const radius of radii) expect(radius).toBeCloseTo(radii[0], 1);
	});

	it("never seats anyone off the board, however tall it is or however big the portraits", () => {
		for (const aspect of [0.6, 1, 1.25, 2.4]) {
			for (const p of ringLayout(9, { aspect, r: nodeRadiusPct(120, 900) })) {
				expect(p.left).toBeGreaterThanOrEqual(0);
				expect(p.left).toBeLessThanOrEqual(100);
				expect(p.top).toBeGreaterThanOrEqual(0);
				expect(p.top).toBeLessThanOrEqual(100);
			}
		}
	});

	it("never seats two people on one spot", () => {
		const ring = ringLayout(10, { aspect: ASPECT, r });
		const spots = new Set(ring.map(p => `${p.left},${p.top}`));
		expect(spots.size).toBe(ring.length);
	});

	it("seats nobody for a count of none, or of nonsense", () => {
		for (const bad of [0, -2, null, undefined, "x"]) {
			expect(ringLayout(bad, { aspect: ASPECT, r })).toEqual([]);
		}
	});
});

describe("finding room for one more", () => {
	const r = nodeRadiusPct(72, 1200);

	it("lands clear of everyone already placed", () => {
		const taken = ringLayout(5, { aspect: ASPECT, r });
		const spot = freeSpot(taken, { aspect: ASPECT, r });
		for (const p of taken) expect(seen(p, spot)).toBeGreaterThan(2 * r);
	});

	it("puts the very first person somewhere on the board", () => {
		const spot = freeSpot([], { aspect: ASPECT, r });
		expect(spot.left).toBeGreaterThan(0);
		expect(spot.top).toBeGreaterThan(0);
	});

	// A board so full there is no clear air still has to accept the person. Stacked can be dragged
	// apart in a second; refused leaves the reader wondering whether the button works at all.
	it("gives up onto the middle rather than refusing to place anyone", () => {
		const crowd = ringLayout(60, { aspect: ASPECT, r: 0.2 })
			.concat(ringLayout(60, { aspect: ASPECT, r: 0.2 }).map(p => ({ ...p, top: p.top - 1 })));
		const spot = freeSpot(crowd.concat([{ left: 50, top: 50 }]), { aspect: ASPECT, r: 40 });
		expect(Number.isFinite(spot.left)).toBe(true);
		expect(Number.isFinite(spot.top)).toBe(true);
	});

	it("ignores holes in the list it is given", () => {
		expect(() => freeSpot([null, undefined, { left: 50, top: 50 }], { aspect: ASPECT, r }))
			.not.toThrow();
	});
});

describe("keeping a coordinate on the board", () => {
	it("holds a percentage between the edges and rounds it short", () => {
		expect(clampPct(120)).toBe(100);
		expect(clampPct(-5)).toBe(0);
		expect(clampPct(33.33333)).toBe(33.33);
	});

	it("answers the middle for anything that is not a number", () => {
		for (const bad of [NaN, null, undefined, "x", Infinity]) expect(clampPct(bad)).toBe(50);
	});

	it("measures a portrait's radius as a share of the board's WIDTH", () => {
		expect(nodeRadiusPct(72, 1200)).toBeCloseTo(3, 6);
		expect(nodeRadiusPct(0, 1200)).toBe(0);
		expect(nodeRadiusPct(72, 0)).toBe(0);
	});

	it("has a board wider than it is tall", () => {
		expect(RELMAP_BOARD_ASPECT).toBeGreaterThan(1);
	});
});

describe("seating a whole village", () => {
	const r = nodeRadiusPct(72, 1200);
	const opts = { aspect: ASPECT, r };

	/** The closest two seats come to each other, as the eye measures it. */
	function tightest(seats) {
		let closest = Infinity;
		for (let i = 0; i < seats.length; i++) {
			for (let j = i + 1; j < seats.length; j++) {
				closest = Math.min(closest, seen(seats[i], seats[j]));
			}
		}
		return closest;
	}

	// The good-looking case is not sacrificed to the large one: a handful of people still come out
	// as the single wide ring a relationship poster is drawn as.
	it("keeps a small cast on one wide ring", () => {
		const seats = ringsLayout(8, opts);
		const radii = seats.map(p => seen({ left: 50, top: 50 }, p));
		for (const radius of radii) expect(radius).toBeCloseTo(radii[0], 1);
	});

	// The whole reason this exists beside `ringLayout`. Twenty-odd people on ONE ring are spaced
	// closer than their own portraits are wide and overlap into an unreadable band.
	it("spreads a cast too big for one ring across several", () => {
		const seats = ringsLayout(30, opts);
		const radii = seats.map(p => Math.round(seen({ left: 50, top: 50 }, p)));
		expect(new Set(radii).size).toBeGreaterThan(1);
	});

	it("seats everybody it was asked to, at every size", () => {
		for (const count of [1, 2, 5, 12, 25, 40, 80]) {
			expect(ringsLayout(count, opts)).toHaveLength(count);
		}
	});

	it("never seats anyone off the board, at any size or shape", () => {
		for (const aspect of [0.7, 1, 1.25, 2.2]) {
			for (const count of [3, 17, 60]) {
				for (const p of ringsLayout(count, { aspect, r })) {
					expect(p.left).toBeGreaterThanOrEqual(0);
					expect(p.left).toBeLessThanOrEqual(100);
					expect(p.top).toBeGreaterThanOrEqual(0);
					expect(p.top).toBeLessThanOrEqual(100);
				}
			}
		}
	});

	it("never seats two people on the same spot", () => {
		for (const count of [6, 21, 44]) {
			const seats = ringsLayout(count, opts);
			expect(new Set(seats.map(p => `${p.left},${p.top}`)).size).toBe(count);
		}
	});

	// A cast that fits should actually be given the room: portraits no closer than their own width.
	it("keeps a cast that fits clear of itself", () => {
		expect(tightest(ringsLayout(18, opts))).toBeGreaterThanOrEqual(2 * r);
	});

	it("puts one person in the middle, and nobody nowhere", () => {
		expect(ringsLayout(1, opts)).toEqual([{ left: 50, top: 50 }]);
		for (const bad of [0, -3, null, undefined, "x"]) expect(ringsLayout(bad, opts)).toEqual([]);
	});
});

describe("finding room on a board that is filling up", () => {
	const r = nodeRadiusPct(72, 1200);
	const opts = { aspect: ASPECT, r };

	// Two rings was enough while people arrived one at a time, and is not once a board carries a
	// village: the outer ring fills, the half ring fills, and everyone after lands on the pile in
	// the middle.
	it("keeps finding clear air well past the first two rings", () => {
		const taken = [];
		for (let i = 0; i < 24; i++) {
			const spot = freeSpot(taken, opts);
			taken.push(spot);
		}
		const middle = taken.filter(p => p.left === 50 && p.top === 50);
		expect(middle.length).toBeLessThanOrEqual(1);
	});
});
