import { describe, it, expect } from "vitest";
import {
	RELMAP_BOARD_ASPECT, RELMAP_BOARD_MAX, RELMAP_BOARD_WIDTH, RELMAP_CAPTION_PX, RELMAP_HEAD_PX,
	boardMetrics,
	clampPct, clearanceBow,
	RELMAP_LABEL_CLEAR_PX,
	edgeArrowheads, edgeBow, edgeCurve, edgeLabelAnchor, fanBow, freeSpot, labelSize,
	captionRoomPx, captionSize, curvePoints, curveWithGap, nodeRadiusPct, ringsLayout,
	spreadLabels,
} from "../../module/utils/relmap-geometry.js";

// The relationship map's arithmetic, which three renderers share: the stretched SVG that strokes
// the lines, the HTML labels riding on top of it, and the fixed-pixel arrowhead SVGs. They agree
// only because they all ask this file, so what is proven here is what keeps a label on its own
// stroke.

const ASPECT = 1.25;

// THE HEAD'S OWN MEASUREMENTS, taken off the constant rather than written out, so bumping the
// arrowhead's size moves these with it instead of turning every head test red at once. Its
// points sit at -0.4 and 0.4 of its size, so the tip reaches 0.4 of it ahead of the centre the
// stylesheet positions by, and the triangle behind that tip is 0.8 of it long. The stroke stops
// a pixel INSIDE that back edge, so what a head takes off its end is one less.
const HEAD_TIP_PX = RELMAP_HEAD_PX * 0.4;
const HEAD_CUT_PX = RELMAP_HEAD_PX * 0.8 - 1;

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

// WHERE THE WHOLE STROKE GOES, for the tie bar, which has to keep OFF the line rather than sit on
// it -- and the middle of a line says nothing about where the rest of it runs.
describe("walking a line end to end", () => {
	const curve = edgeCurve({
		from: { left: 20, top: 50 }, to: { left: 80, top: 50 }, bow: 1, aspect: ASPECT,
		r: nodeRadiusPct(72, 1200),
	});

	it("starts at one end, finishes at the other, and cuts the rest evenly", () => {
		const points = curvePoints(curve, 8);
		expect(points).toHaveLength(9);
		expect(points[0].left).toBeCloseTo(curve.from.left, 6);
		expect(points[0].top).toBeCloseTo(curve.from.top, 6);
		expect(points[8].left).toBeCloseTo(curve.to.left, 6);
		expect(points[8].top).toBeCloseTo(curve.to.top, 6);
	});

	// ⚠ ON THE CURVE, NOT ON THE CHORD. A bowed line's middle is a long way off the straight run
	// between its ends, and points taken off that chord would tell a caller the line was somewhere
	// it is not -- which for the tie bar means dodging empty board and sitting on the stroke.
	it("follows the bow rather than the straight run between the ends", () => {
		const points = curvePoints(curve, 8);
		for (let i = 1; i < 8; i++) {
			const t = i / 8;
			const on = pointOn(curve, t);
			expect(points[i].left).toBeCloseTo(on.left, 6);
			expect(points[i].top).toBeCloseTo(on.top, 6);
		}
		// And the middle really has left the chord, or the check above proves nothing.
		expect(Math.abs(points[4].top - 50)).toBeGreaterThan(1);
	});

	// ⚠ IN THE PERCENTAGES THE CURVE IS WRITTEN IN, unflattened. The stroke is painted into a layer
	// stretched with `preserveAspectRatio="none"`, so these numbers times the painted box is exactly
	// where the reader sees that piece of line; correcting for the aspect here would hand back
	// points off the drawing on every board that is not square.
	it("answers in the same space the curve was given in", () => {
		const [first] = curvePoints(curve, 4);
		expect(first).toEqual({ left: curve.from.left, top: curve.from.top });
	});

	it("has nothing to walk when there is no curve", () => {
		expect(curvePoints(null)).toBe(null);
		expect(curvePoints({ from: { left: 1, top: 1 } })).toBe(null);
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

	// A caption is set STRAIGHT (warping type is what made this board unaffordable to paint), so on
	// a bowed line a straight run is laid over a curved one and the two can only meet in some
	// places. Told how long the words are, the run is the CHORD of the stretch they cover: it meets
	// the curve at the two joins, which are the only places a reader can check.
	describe("the straight run a caption of a given width covers", () => {
		const bowed = edgeCurve({
			from: { left: 15, top: 50 }, to: { left: 85, top: 50 }, bow: 2, aspect: ASPECT, r,
		});
		/** How far a point is from the curve, in the space the eye is in. */
		const offCurve = point => {
			let best = Infinity;
			for (let i = 0; i <= 800; i++) best = Math.min(best, seen(point, pointOn(bowed, i / 800)));
			return best;
		};
		/** The two ends of a caption `span` wide, seated by `edgeLabelAnchor`. */
		const endsOf = span => {
			const anchor = edgeLabelAnchor(bowed, ASPECT, 0.5, span);
			const rad = (anchor.angle * Math.PI) / 180;
			// Back into percentages: the angle is the one the EYE sees, so the step down is taken
			// in flat units and stretched again.
			return [-1, 1].map(way => ({
				left: anchor.left + way * (span / 2) * Math.cos(rad),
				top: anchor.top + way * (span / 2) * Math.sin(rad) * ASPECT,
			}));
		};

		it("lands both ends of the words ON the line, where the stroke picks up again", () => {
			for (const end of endsOf(20)) expect(offCurve(end)).toBeLessThan(0.05);
		});

		it("used to leave them off it, which is what a reader saw as a caption beside its line", () => {
			const tangent = edgeLabelAnchor(bowed, ASPECT, 0.5);
			const rad = (tangent.angle * Math.PI) / 180;
			const end = {
				left: tangent.left + 10 * Math.cos(rad),
				top: tangent.top + 10 * Math.sin(rad) * ASPECT,
			};
			expect(offCurve(end)).toBeGreaterThan(0.5);
		});

		it("stays centred on where along the line the caption was put", () => {
			for (const t of [0.3, 0.5, 0.7]) {
				expect(edgeLabelAnchor(bowed, ASPECT, t, 20).t).toBe(edgeLabelAnchor(bowed, ASPECT, t).t);
			}
		});

		// A caption longer than its line has no stretch left to slide along, and `curveWithGap`
		// refuses to cut a hole for one -- so what it must not do is run off the end of the curve
		// looking for the room.
		it("slides back inside the line rather than off the end of it", () => {
			const seat = edgeLabelAnchor(bowed, ASPECT, 0.05, 500);
			// The whole line's own chord: nothing is left to slide along, so the words are centred
			// on the two ends of the line they belong to rather than hanging off one of them.
			expect(seat.left).toBeCloseTo((bowed.from.left + bowed.to.left) / 2, 1);
			expect(seat.top).toBeCloseTo((bowed.from.top + bowed.to.top) / 2, 1);
			expect(seat.angle).toBe(0);
		});

		it("is the tangent again for a line with nothing written on it", () => {
			expect(edgeLabelAnchor(bowed, ASPECT, 0.5, 0)).toEqual(edgeLabelAnchor(bowed, ASPECT));
		});
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

	// The complaint this replaced a flat percentage back-off for: the head belongs AT the end of
	// its line, and the tip is `HEAD_TIP_PX` board pixels ahead of the centre the stylesheet
	// positions by, so on a 1200-wide sheet the centre lands that share of the width short of the
	// rim and no more.
	it("lands the tip of the head on the end of the line", () => {
		const line = curve();
		const [head] = edgeArrowheads(line, ASPECT, "a-b", { boardWidthPx: 1200 });
		expect(line.to.left - head.left).toBeCloseTo((100 * HEAD_TIP_PX) / 1200, 2);
	});

	// And it is a PIXEL stand-off, so a bigger sheet does not push the head back down its line:
	// the same head on a board four times as wide sits four times closer to the rim in percent.
	it("keeps the same pixel stand-off however wide the sheet grows", () => {
		const line = curve();
		const [near] = edgeArrowheads(line, ASPECT, "a-b", { boardWidthPx: 4800 });
		expect(line.to.left - near.left).toBeCloseTo((100 * HEAD_TIP_PX) / 4800, 2);
	});

	it("has no heads to place for a link that could not be drawn", () => {
		expect(edgeArrowheads(null, ASPECT, "both")).toEqual([]);
	});

	// ── A HEAD THIS READER HAS ASKED TO BE DRAWN BIGGER ──────────────────────────
	//
	// The footer's first dial scales the arrowheads by a percentage, and the stylesheet draws the
	// triangle at that size. What must follow it is the STAND-OFF: the anchor is the head's centre,
	// so a bigger triangle has to sit further back from the rim or its point buries itself in the
	// portrait it is meant to be touching. See `headPx` and module/relmap/relmap-weights.js.

	it("stands a bigger head further off the rim, by its own tip's reach", () => {
		const line = curve();
		const [big] = edgeArrowheads(line, ASPECT, "a-b", {
			boardWidthPx: 1200, headPx: RELMAP_HEAD_PX * 2,
		});
		expect(line.to.left - big.left).toBeCloseTo((100 * HEAD_TIP_PX * 2) / 1200, 2);
	});

	it("draws the ordinary head when nobody has asked for another size", () => {
		const line = curve();
		const [said] = edgeArrowheads(line, ASPECT, "a-b", {
			boardWidthPx: 1200, headPx: RELMAP_HEAD_PX,
		});
		const [quiet] = edgeArrowheads(line, ASPECT, "a-b", { boardWidthPx: 1200 });
		expect(said).toEqual(quiet);
	});

	// A size that is not one falls back to the sheet's own rather than collapsing every head onto
	// the rim. This is fed from browser storage through `weightScales`, and the gate there is not
	// allowed to be the only one.
	it("falls back to the ordinary head for a size that is not a size", () => {
		const line = curve();
		const [quiet] = edgeArrowheads(line, ASPECT, "a-b", { boardWidthPx: 1200 });
		for (const junk of [0, -8, NaN, null, "big"]) {
			const [said] = edgeArrowheads(line, ASPECT, "a-b", { boardWidthPx: 1200, headPx: junk });
			expect(said, String(junk)).toEqual(quiet);
		}
	});
});

describe("finding room for one more", () => {
	const r = nodeRadiusPct(72, 1200);

	it("lands clear of everyone already placed", () => {
		const taken = ringsLayout(5, { aspect: ASPECT, r });
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
		const crowd = ringsLayout(60, { aspect: ASPECT, r: 0.2 })
			.concat(ringsLayout(60, { aspect: ASPECT, r: 0.2 }).map(p => ({ ...p, top: p.top - 1 })));
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

	// The whole reason there are rings rather than a ring. Twenty-odd people on ONE would be spaced
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
describe("bowing a line clear of somebody it has nothing to do with", () => {
	const r = nodeRadiusPct(72, 1200); // 3% of the board's width
	const opts = { aspect: ASPECT, r };

	/** How close a link's drawn curve ever comes to one portrait's centre, as the eye sees it.
	 * Sampled off the TRIMMED curve, which is the only part anybody looks at. */
	function nearest(curve, spot) {
		let closest = Infinity;
		for (let i = 0; i <= 200; i++) {
			closest = Math.min(closest, seen(pointOn(curve, i / 200), spot));
		}
		return closest;
	}

	/** The curve a link is actually drawn as: its dodge, plus its place in its pair's fan, put
	 * together the one way `edgeShapes` puts them together. */
	function drawn(from, to, avoid, fan = 0) {
		const dodge = clearanceBow({ from, to, avoid, ...opts });
		return edgeCurve({ from, to, bow: edgeBow(fan, dodge), ...opts });
	}

	it("leaves a link alone when there is nobody in the way", () => {
		const from = { left: 20, top: 50 };
		const to = { left: 80, top: 50 };
		// Both ends are in the list, as they are on the real board: they are recognised by sitting
		// at the very ends of the link and left out, or every line would dodge itself.
		expect(clearanceBow({ from, to, avoid: [from, to, { left: 50, top: 10 }], ...opts })).toBe(0);
	});

	it("bends a link that would otherwise run straight through a face", () => {
		const from = { left: 20, top: 50 };
		const to = { left: 80, top: 50 };
		const between = { left: 50, top: 50 };
		expect(nearest(edgeCurve({ from, to, ...opts }), between)).toBeLessThan(r);
		expect(nearest(drawn(from, to, [from, to, between]), between)).toBeGreaterThanOrEqual(r);
	});

	it("bends AWAY from the face rather than further into it", () => {
		// The one thing that would silently be wrong with the perpendicular measured the other way
		// round: the dodge would still be a dodge, and it would swerve into what it was avoiding.
		const from = { left: 20, top: 50 };
		const to = { left: 80, top: 50 };
		for (const side of [-1, 1]) {
			const face = { left: 50, top: 50 + side * 1.5 };
			const curve = drawn(from, to, [from, to, face]);
			// The middle of the bent line has gone to the other side of the face from where it was.
			expect(Math.sign(pointOn(curve, 0.5).top - face.top)).toBe(-side);
		}
	});

	it("takes the gentlest bend that clears, not the first one it tries", () => {
		const from = { left: 20, top: 50 };
		const to = { left: 80, top: 50 };
		const grazing = { left: 50, top: 50 + 3.4 };
		const squarely = { left: 50, top: 50 };
		const small = Math.abs(clearanceBow({ from, to, avoid: [from, to, grazing], ...opts }));
		const large = Math.abs(clearanceBow({ from, to, avoid: [from, to, squarely], ...opts }));
		expect(small).toBeGreaterThan(0);
		expect(small).toBeLessThan(large);
	});

	it("ignores a face sitting on one of the link's own ends, which cannot be dodged", () => {
		// The curve is anchored at the rims, so there is no deflection to be had down there, and
		// asking for it is what makes the arithmetic demand an unbounded bow.
		const from = { left: 20, top: 50 };
		const to = { left: 80, top: 50 };
		expect(clearanceBow({ from, to, avoid: [from, to, { left: 21, top: 50 }], ...opts })).toBe(0);
	});

	it("keeps the fan it was given, so two links between one pair still part company", () => {
		// The dodge is ADDED to the fan rather than replacing it. Were it to replace it, two links
		// between the same two people that both had to clear the same face would be handed the
		// same answer and lie exactly on top of one another.
		const from = { left: 20, top: 50 };
		const to = { left: 80, top: 50 };
		const face = { left: 50, top: 50 };
		const first = drawn(from, to, [from, to, face], 0);
		const second = drawn(from, to, [from, to, face], 1);
		expect(pointOn(second, 0.5).top).not.toBeCloseTo(pointOn(first, 0.5).top, 1);
	});

	it("answers nothing for a link with no length, rather than dividing by it", () => {
		const spot = { left: 50, top: 50 };
		expect(clearanceBow({ from: spot, to: spot, avoid: [{ left: 60, top: 50 }], ...opts })).toBe(0);
		expect(clearanceBow({ from: null, to: spot, avoid: [spot], ...opts })).toBe(0);
	});
});

describe("keeping the captions off one another", () => {
	const r = nodeRadiusPct(72, 1200);
	const opts = { aspect: ASPECT, r };
	const curveOf = (from, to) => edgeCurve({ from, to, ...opts });

	/** Two links whose middles land on the same spot, running at right angles: exactly the case a
	 * ring of chords produces, where every line's middle is the middle of the board. */
	const crossing = () => ({
		across: curveOf({ left: 15, top: 50 }, { left: 85, top: 50 }),
		down: curveOf({ left: 50, top: 12 }, { left: 50, top: 88 }),
	});

	it("leaves a lone caption in the middle of its own line", () => {
		const { across } = crossing();
		const out = spreadLabels({ labels: [{ id: "a", curve: across, text: "old friends" }], ...opts });
		expect(out.get("a")).toEqual(edgeLabelAnchor(across, ASPECT, 0.5));
	});

	it("slides one of two captions that would land on the same spot", () => {
		const { across, down } = crossing();
		const text = "has never forgiven her";
		const out = spreadLabels({
			labels: [{ id: "a", curve: across, text }, { id: "b", curve: down, text }],
			...opts,
		});
		const middles = [
			edgeLabelAnchor(across, ASPECT, 0.5),
			edgeLabelAnchor(down, ASPECT, 0.5),
		];
		const stayed = ["a", "b"].filter((id, i) => {
			const at = out.get(id);
			return at.left === middles[i].left && at.top === middles[i].top;
		});
		expect(stayed.length).toBeLessThan(2);
	});

	it("never lets a caption leave its own line", () => {
		// The whole meaning of a caption here is which stroke it belongs to. A caption pushed
		// sideways into free space belongs to nothing, so the only freedom it has is to slide
		// ALONG its own line: every position it can take is a fixed hop above some point the line
		// actually passes through.
		const { across, down } = crossing();
		const curves = { a: across, b: down };
		const out = spreadLabels({
			labels: [{ id: "a", curve: across, text: "a long caption here" },
				{ id: "b", curve: down, text: "another long caption" }],
			...opts,
		});
		for (const [id, at] of out) {
			const alongIt = [];
			for (let i = 0; i <= 400; i++) alongIt.push(edgeLabelAnchor(curves[id], ASPECT, i / 400));
			expect(alongIt.some(p => Math.hypot(p.left - at.left, p.top - at.top) < 0.2)).toBe(true);
		}
	});

	it("gives the same board to every client, whatever order the links arrive in", () => {
		// Two people looking at one map must see the captions in the same places, so the placement
		// cannot depend on the order the links came out of a flag object.
		const { across, down } = crossing();
		const text = "owes her a great deal";
		const one = spreadLabels({
			labels: [{ id: "a", curve: across, text }, { id: "b", curve: down, text }], ...opts,
		});
		const two = spreadLabels({
			labels: [{ id: "b", curve: down, text }, { id: "a", curve: across, text }], ...opts,
		});
		expect([...two.entries()].sort()).toEqual([...one.entries()].sort());
	});

	it("has nothing to place for a link with no caption, or no curve", () => {
		const { across } = crossing();
		const out = spreadLabels({
			labels: [{ id: "a", curve: across, text: "" }, { id: "b", curve: null, text: "hi" }],
			...opts,
		});
		expect(out.size).toBe(0);
	});

	// ⚠ THE FACES ARE BIGGER THAN THEY LOOK TO THE SPREADER, by the clearance a caption keeps
	// from every portrait. The room on a line is reckoned at the MIDDLE of it (`captionRoomPx`), so
	// on its own it says nothing about a caption slid aside to get out of another's way, or about a
	// caption passing somebody else's face on the way. Merely not TOUCHING a portrait was the old
	// rule, and it let the words come to rest against one.
	it("slides a caption that would come to rest too near a face, not only one that lands on it", () => {
		const { across } = crossing();
		// Five flat units off the line, which is well clear of a 3-unit portrait and well inside the
		// paper a caption is supposed to keep between itself and one.
		const near = { left: 50, top: 50 + (5 * ASPECT) };
		const text = "old friends";
		const middle = edgeLabelAnchor(across, ASPECT, 0.5);
		const alone = spreadLabels({ labels: [{ id: "a", curve: across, text }], ...opts });
		const beside = spreadLabels({
			labels: [{ id: "a", curve: across, text }], nodes: [near], ...opts,
		});
		expect(alone.get("a").left).toBeCloseTo(middle.left, 6);
		expect(beside.get("a").left).not.toBeCloseTo(middle.left, 6);
		// Along its own line and away from the face, rather than off the line or past its ends.
		expect(Math.abs(beside.get("a").left - near.left))
			.toBeGreaterThan(Math.abs(middle.left - near.left));
	});

	it("sizes a caption by its words, and stops it where the room it was given stops", () => {
		expect(labelSize("ab").w).toBeLessThan(labelSize("a much longer caption").w);
		// Nothing bounds a caption but the line it sits on, so two sentences too long for the same
		// room come out the same width, and with no room named at all they do not.
		expect(labelSize("x".repeat(500), 1200, 140).w)
			.toBeCloseTo(labelSize("x".repeat(400), 1200, 140).w, 6);
		expect(labelSize("x".repeat(500)).w).toBeGreaterThan(labelSize("x".repeat(400)).w);
	});
});

describe("where along its line a caption sits", () => {
	const r = nodeRadiusPct(72, 1200);
	const opts = { aspect: ASPECT, r };

	it("is the middle when nothing says otherwise", () => {
		const curve = edgeCurve({ from: { left: 20, top: 30 }, to: { left: 70, top: 80 }, ...opts });
		expect(edgeLabelAnchor(curve, ASPECT)).toEqual(edgeLabelAnchor(curve, ASPECT, 0.5));
	});

	it("moves along the line as it is asked to, and never off the ends of it", () => {
		const curve = edgeCurve({ from: { left: 20, top: 50 }, to: { left: 80, top: 50 }, ...opts });
		expect(edgeLabelAnchor(curve, ASPECT, 0.2).left).toBeLessThan(edgeLabelAnchor(curve, ASPECT, 0.8).left);
		expect(edgeLabelAnchor(curve, ASPECT, -5)).toEqual(edgeLabelAnchor(curve, ASPECT, 0));
		expect(edgeLabelAnchor(curve, ASPECT, 9)).toEqual(edgeLabelAnchor(curve, ASPECT, 1));
	});

	it("treats rubbish as the middle rather than as nowhere", () => {
		const curve = edgeCurve({ from: { left: 20, top: 50 }, to: { left: 80, top: 50 }, ...opts });
		for (const bad of [null, undefined, "x", NaN]) {
			expect(edgeLabelAnchor(curve, ASPECT, bad)).toEqual(edgeLabelAnchor(curve, ASPECT, 0.5));
		}
	});
});

describe("putting a link's dodge and its place in the fan together", () => {
	it("is the plain fan when there was nothing to dodge", () => {
		expect([0, 1, 2, 3].map(i => edgeBow(i, 0))).toEqual([0, 1, -1, 2]);
	});

	// The rule that stops a fan being spread back into the face its route was bent aside from.
	// `fanBow` alternates, which is right off a straight line and wrong off a dodged one.
	it("spreads the fan the SAME way the dodge went, whichever way that was", () => {
		for (const dodge of [1.5, -1.5]) {
			const spread = [0, 1, 2, 3].map(i => edgeBow(i, dodge));
			// Every link in the fan is at least as far aside as the first, and no nearer the face.
			for (const bow of spread) expect(Math.abs(bow)).toBeGreaterThanOrEqual(Math.abs(dodge));
			for (const bow of spread) expect(Math.sign(bow)).toBe(Math.sign(dodge));
		}
	});

	it("still gives every link in a fan its own bow, so none lies on another", () => {
		const bows = [0, 1, 2, 3, 4].map(i => edgeBow(i, -2));
		expect(new Set(bows).size).toBe(bows.length);
	});

	it("treats rubbish as no dodge at all", () => {
		for (const bad of [null, undefined, "x", NaN]) expect(edgeBow(1, bad)).toBe(fanBow(1));
	});
});

// THE FAULT THIS BLOCK EXISTS TO CATCH, and it was on the board for a season. A caption used to be
// promised a width whatever line it sat on -- 220 pixels, or 140 on a crowded board, and never
// less than 58 -- so that two words and an ellipsis were not all a short line could say. But a
// caption is set ALONG its line, so a caption wider than its line overhangs into the two faces at
// its ends: two people standing close together had the whole sentence drawn across both their
// portraits, and the ellipsis that should have cut it arrived only once the words were longer than
// a promise nothing on the board could keep. The room is now the line's own run and nothing else,
// less the paper kept clear at each end.
describe("how wide a caption is allowed to get", () => {
	const r = nodeRadiusPct(72, 1200);
	const opts = { aspect: ASPECT, r };
	const curveOf = (from, to) => edgeCurve({ from, to, ...opts });
	// One flat unit is one percent of the board's width, which on a sheet of 1200 is twelve pixels.
	const px = flat => flat * 12;

	it("gives a line its own run, less the clearance kept at either end", () => {
		const line = curveOf({ left: 15, top: 50 }, { left: 85, top: 50 });
		expect(captionRoomPx(line, { boardWidthPx: 1200 }))
			.toBeCloseTo(px(line.length) - (2 * RELMAP_LABEL_CLEAR_PX), 6);
	});

	// TWICE, because the words are centred on their seat: a caption grows from the middle outwards,
	// so every pixel of width it takes is half a pixel closer to each of the two faces.
	it("keeps the same clearance at both ends, whatever the line", () => {
		for (const to of [{ left: 60, top: 50 }, { left: 85, top: 50 }, { left: 80, top: 80 }]) {
			const line = curveOf({ left: 15, top: 50 }, to);
			const room = captionRoomPx(line, { boardWidthPx: 1200 });
			expect((px(line.length) - room) / 2).toBeCloseTo(RELMAP_LABEL_CLEAR_PX, 6);
		}
	});

	// The case the promise was made for, answered the other way round. What a reader gets here is
	// the line, the tooltip and the tie bar, all of which carry the whole sentence; what they do not
	// get is that sentence written across two faces.
	it("gives two portraits standing close together no room at all", () => {
		const stub = curveOf({ left: 46, top: 50 }, { left: 54, top: 50 });
		expect(px(stub.length)).toBeLessThan(2 * RELMAP_LABEL_CLEAR_PX);
		expect(captionRoomPx(stub, { boardWidthPx: 1200 })).toBe(0);
		expect(captionSize("has never forgiven her", stub, { boardWidthPx: 1200 }).w).toBe(0);
	});

	it("never answers less than nothing, whatever it is handed", () => {
		for (const bad of [null, undefined, {}, { length: 0 }]) {
			expect(captionRoomPx(bad, { boardWidthPx: 1200 })).toBe(0);
		}
	});

	it("measures a chip at the width the room it was given will paint it at", () => {
		const text = "buys cheap from people who need the coin";
		expect(labelSize(text, 1200, 140).w).toBeLessThan(labelSize(text, 1200, 220).w);
		// Short enough to fit either: the two agree, so the room is a bound and not a width.
		expect(labelSize("exes", 1200, 140).w).toBeCloseTo(labelSize("exes", 1200, 220).w, 6);
	});

	// ⚠ A ROOM OF NOTHING IS NOT AN ABSENT ROOM. Read the other way -- as "nobody measured, take
	// the whole board" -- a stub line would put its entire sentence back across both faces, which is
	// the failure at the top of this block.
	it("reads a room of nothing as nothing, and only a missing one as no bound", () => {
		const text = "buys cheap from people who need the coin";
		expect(labelSize(text, 1200, 0).w).toBe(0);
		expect(labelSize(text, 1200, NaN).w).toBeCloseTo(labelSize(text, 1200).w, 6);
	});
});

describe("the sheet, which grows with the cast on it", () => {
	// THE ONLY LEVER THERE IS. Everything on this board is either positioned in percentages or
	// sized in fixed pixels, and the ratio between the two is the whole of "is there room for the
	// writing". On a fixed sheet forty people share exactly the room eight had.
	it("gives a small map the sheet the board has always had, at 1:1", () => {
		for (const few of [1, 2, 4, 6]) {
			expect(boardMetrics(few).width).toBe(RELMAP_BOARD_WIDTH);
			expect(boardMetrics(few).r).toBeCloseTo(nodeRadiusPct(72, RELMAP_BOARD_WIDTH), 6);
		}
	});

	it("grows for a bigger cast, and never shrinks as one arrives", () => {
		const widths = [6, 8, 12, 20, 39, 60].map(n => boardMetrics(n).width);
		for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
	});

	// The AREA per person is what is held, so the room each of them gets stays about the same
	// however many arrive. Four times the people is twice the sheet.
	it("holds the room per person roughly constant, so width goes as the square root", () => {
		expect(boardMetrics(24).width / boardMetrics(6).width).toBeCloseTo(2, 1);
		expect(boardMetrics(96).width / boardMetrics(24).width).toBeCloseTo(2, 1);
	});

	// A portrait is a fixed 72 pixels, so on a bigger sheet it is a SMALLER share of it. That is
	// the whole point, and it is why nothing may assume the radius is a constant.
	it("makes a portrait a smaller share of a bigger sheet", () => {
		expect(boardMetrics(39).r).toBeLessThan(boardMetrics(6).r);
		expect(boardMetrics(39).r).toBeCloseTo(nodeRadiusPct(72, boardMetrics(39).width), 6);
	});

	it("stops growing somewhere, so a runaway map cannot ask for an unbounded sheet", () => {
		expect(boardMetrics(100000).width).toBe(RELMAP_BOARD_MAX);
	});

	it("keeps the board's proportions whatever size it is", () => {
		for (const n of [1, 12, 39, 500]) {
			const sheet = boardMetrics(n);
			expect(sheet.width / sheet.height).toBeCloseTo(RELMAP_BOARD_ASPECT, 2);
		}
	});

	it("reads rubbish as one person rather than as a sheet of no size", () => {
		for (const bad of [null, undefined, "x", NaN, -4]) {
			expect(boardMetrics(bad).width).toBe(RELMAP_BOARD_WIDTH);
		}
	});
});

describe("a caption runs the length of its line, and stops short of the faces at its ends", () => {
	const r = nodeRadiusPct(72, 1200);
	const opts = { aspect: ASPECT, r };
	const sized = (text, curve) => captionSize(text, curve, { boardWidthPx: 1200 });
	const across = { from: { left: 10, top: 50 }, to: { left: 90, top: 50 } };
	const sentence = "buys cheap from people who need the coin";
	const clear = RELMAP_LABEL_CLEAR_PX / 12;

	// THE POINT OF THE CAPTION IS THE SENTENCE ON IT. A line with the length to carry the whole of
	// one carries the whole of it, however long it is: two words and an ellipsis is not a shorter
	// caption, it is a caption that has stopped saying anything.
	it("lets a long line carry its whole sentence", () => {
		const long = edgeCurve({ ...across, ...opts });
		expect(sized(sentence, long).w).toBeCloseTo(labelSize(sentence, 1200).w, 6);
	});

	it("stops short of the two faces the line joins, so the words stay clear of both", () => {
		const long = edgeCurve({ ...across, ...opts });
		const huge = "x".repeat(400);
		expect(sized(huge, long).w).toBeCloseTo(long.length - (2 * clear), 6);
	});

	// The other half of it, and the half that used to be wrong. A line too short for the sentence
	// is cut to the line rather than given a width the board cannot keep: what overhangs a line
	// here is what lies across the two portraits at its ends.
	it("cuts a short line's caption to the line rather than overhanging it", () => {
		const short = edgeCurve({ from: { left: 40, top: 50 }, to: { left: 52, top: 50 }, ...opts });
		const out = spreadLabels({ labels: [{ id: "a", curve: short, text: sentence }], ...opts });
		// Still seated on its line: the words are the button, and the whole sentence is its tooltip.
		expect(out.has("a")).toBe(true);
		expect(labelSize(sentence, 1200).w).toBeGreaterThan(short.length);
		expect(sized(sentence, short).w).toBeCloseTo(short.length - (2 * clear), 6);
	});

	it("leaves a short caption alone on any line with the room for it", () => {
		const long = edgeCurve({ ...across, ...opts });
		expect(sized("exes", long).w).toBeCloseTo(labelSize("exes", 1200).w, 6);
	});

	// ONE ANSWER, because three things have to agree about it to the pixel: the spreader that
	// slides the captions apart, the stylesheet that paints them, and the gap cut in the line for
	// the words to sit in. A gap measured off a different width leaves a stub of stroke inside it.
	// Nothing is a width too, and the honest one for a line with two faces almost touching on it:
	// no words, and so no hole cut in a stroke that has no room for either.
	it("says nothing, and cuts no hole, on a line shorter than its own clearances", () => {
		const stub = edgeCurve({ from: { left: 49, top: 50 }, to: { left: 56, top: 50 }, ...opts });
		expect(sized("has never forgiven her", stub).w).toBe(0);
		expect(curveWithGap(stub, { t: 0.5, span: 0, boardWidthPx: 1200 })).toBe(stub.d);
	});
});



// THE FAULT THIS SUITE EXISTS TO CATCH. The gap cut in a stroke is as wide as the caption sitting
// in it, and until the caption is in a document "as wide as" is a character count times a
// constant. That constant cannot tell an `i` from an `m`, and on the face this board paints in it
// overshoots by about a fifth: measured at the twelve-pixel base this board used to set its
// captions in, a hundred-and-fourteen-character sentence estimated at 728 pixels and painted at
// 585. Both numbers scale with the base; the overshoot between them does not. The estimate is slack the spreader wants; in the STROKE it is a hundred and
// forty pixels of line rubbed out for words that were never there, and the reader sees a sentence
// floating in a hole with the line picking up again somewhere off in the distance.
describe("a caption whose real width somebody has measured", () => {
	const r = nodeRadiusPct(72, 1200);
	const opts = { aspect: ASPECT, r };
	const sentence = "shut the great gate in his face and left him on the mountain overnight";
	const long = edgeCurve({ from: { left: 8, top: 50 }, to: { left: 92, top: 50 }, ...opts });

	it("is measured at what it measured, not at what the character count guessed", () => {
		const guessed = labelSize(sentence, 1200, 900).w;
		const measured = labelSize(sentence, 1200, 900, 360).w;
		expect(measured).toBeLessThan(guessed);
		expect(measured).toBeCloseTo((360 * 100) / 1200, 6);
	});

	it("is still held to the room its own line has, because that is what the paint is held to", () => {
		const stub = edgeCurve({ from: { left: 40, top: 50 }, to: { left: 60, top: 50 }, ...opts });
		const room = captionRoomPx(stub, { boardWidthPx: 1200 });
		expect(room).toBeGreaterThan(0);
		const out = captionSize(sentence, stub, { boardWidthPx: 1200, paintedPx: 5000 });
		expect(out.w).toBeCloseTo((room * 100) / 1200, 6);
	});

	// The measurement is the one thing here that can be absent: the spreader runs before there is
	// anything on screen to measure, and this module's own tests run with no document at all.
	it("falls back to the count when nobody could measure it", () => {
		const guessed = captionSize(sentence, long, { boardWidthPx: 1200 });
		for (const none of [null, undefined, 0, -5, NaN, "wide"]) {
			const out = captionSize(sentence, long, { boardWidthPx: 1200, paintedPx: none });
			expect(out.w).toBeCloseTo(guessed.w, 6);
		}
	});

	// The whole point of measuring: the hole in the stroke shrinks to the words that are in it.
	it("cuts a narrower gap in the stroke than the guess would have", () => {
		const gapOf = d => {
			const [first, second] = d.split("M").filter(Boolean);
			const end = first.split("Q")[1].trim().split(/[ ,]/).slice(2).map(Number);
			const start = second.trim().split(" ")[0].split(",").map(Number);
			return Math.hypot(start[0] - end[0], start[1] - end[1]);
		};
		const cut = paintedPx => curveWithGap(long, {
			t: 0.5,
			span: captionSize(sentence, long, { boardWidthPx: 1200, paintedPx }).w,
			boardWidthPx: 1200,
		});
		const guessed = gapOf(cut(null));
		const measured = gapOf(cut(360));
		expect(measured).toBeLessThan(guessed);
		// And by the difference between the two widths, not by some rounding: the guess for this
		// sentence is about 450 board pixels, so a caption that painted at 360 leaves 90 fewer.
		expect((guessed - measured) * 12).toBeCloseTo(
			labelSize(sentence, 1200, 900).w * 12 - 360, 0,
		);
	});
});

// A LINE THE READER HAS SET IN BIGGER TYPE, which the arithmetic has to know about even though
// nothing here paints anything. The metrics at the top of the caption section were measured at
// `RELMAP_CAPTION_PX`, so a caption set half again as big costs half again as much room -- and a
// spreader that measured every chip at the base would slide the quiet captions apart perfectly
// and leave the one the table cares about lying across two of them.
//
// ⚠ THE SIZES HERE ARE MULTIPLES OF THE BASE AND NOT NUMBERS OF THEIR OWN, because what is
// being proven is the PROPORTION. Written out as pixels they would be numbers to retune by hand
// every time the base moved, and would quietly stop testing anything the day one of them landed
// on the base itself -- where a size of one's own is stored as no size at all.
describe("a caption set in a size of its own", () => {
	const sentence = "shut the great gate in his face";

	it("is estimated wider and taller, in proportion to the type", () => {
		const plain = labelSize(sentence, 1200, 900);
		const big = labelSize(sentence, 1200, 900, null, RELMAP_CAPTION_PX * 2);
		// The trim around the words is the same ring at any size, so the words themselves are what
		// doubles: the estimate is chars * 8.4 * scale + 10.
		expect(big.w).toBeCloseTo((((sentence.length * 8.4 * 2) + 10) * 100) / 1200, 6);
		expect(big.h).toBeCloseTo(plain.h * 2, 6);
	});

	// Every line on every board drawn before sizes existed, and nearly every line after.
	it("is the ordinary caption when it has no size of its own", () => {
		const plain = labelSize(sentence, 1200, 900);
		for (const none of [0, null, undefined, NaN, "large"]) {
			const out = labelSize(sentence, 1200, 900, null, none);
			expect(out.w).toBeCloseTo(plain.w, 6);
			expect(out.h).toBeCloseTo(plain.h, 6);
		}
	});

	// ⚠ THE MEASUREMENT IS ALREADY AT THE RIGHT SIZE. What the window reads off the document is the
	// width of a caption that has already been SET in the bigger type, so scaling it a second time
	// would double the whole difference and cut a hole half again too big in the stroke.
	it("does not scale a width somebody actually measured", () => {
		const out = labelSize(sentence, 1200, 900, 360, RELMAP_CAPTION_PX * 2);
		expect(out.w).toBeCloseTo((360 * 100) / 1200, 6);
		// The height is arithmetic in every caller -- nothing measures it -- so it still scales.
		expect(out.h).toBeCloseTo(labelSize(sentence, 1200, 900, 360).h * 2, 6);
	});

	// The room is the LINE's, not the type's: a bigger caption fits fewer words into the same
	// stretch rather than being promised more of the board. `fitCaption` is what then cuts it.
	it("is still held to the room its own line has", () => {
		const r = nodeRadiusPct(72, 1200);
		const stub = edgeCurve({
			from: { left: 40, top: 50 }, to: { left: 60, top: 50 }, aspect: ASPECT, r,
		});
		const room = captionRoomPx(stub, { boardWidthPx: 1200 });
		expect(room).toBeGreaterThan(0);
		const out = captionSize(sentence, stub, { boardWidthPx: 1200, px: 24 });
		expect(out.w).toBeCloseTo((room * 100) / 1200, 6);
	});
});

// ⚠ THE HOLE IS CUT ALONG THE CURVE WHILE THE WORDS GO STRAIGHT, and that is a knowing compromise
// rather than an oversight. The words were set on the curve itself for a while, which is exact and
// was unaffordable: warping text gives every glyph its own transform, the browser's glyph cache
// misses on every one, and with the halo stroked around each warped outline ONE TILE of a real
// board cost 73ms to raster. Straight, the same words cost 1.2ms.
//
// So a strongly bowed line now carries its caption as a CHORD: the sentence leaves the stroke a
// little at both ends and crosses it in the middle. What keeps that from reading as a mistake is
// that most lines are near enough straight across the stretch one caption covers, and that the
// caption is only ever as long as the room its own line has (`captionRoomPx`). The gap below is
// still cut along the curve, because that is where the stroke actually is.
describe("cutting the line open where its caption sits", () => {
	const r = nodeRadiusPct(72, 1200);
	const opts = { aspect: ASPECT, r };
	const curveOf = (from, to) => edgeCurve({ from, to, ...opts });
	const runs = d => d.split("M").filter(Boolean).length;

	it("leaves the line whole when there is no caption to make room for", () => {
		const curve = curveOf({ left: 15, top: 50 }, { left: 85, top: 50 });
		expect(curveWithGap(curve, { t: 0.5, span: 0 })).toBe(curve.d);
	});

	// TWO SUBPATHS OF ONE `d`, which is what makes the break cost nothing: no extra element, no
	// change to the markup, and nothing at all to the live drag, which already rewrites `d`.
	it("breaks it into two runs, with the caption's length missing from the middle", () => {
		const curve = curveOf({ left: 15, top: 50 }, { left: 85, top: 50 });
		const broken = curveWithGap(curve, { t: 0.5, span: 8, boardWidthPx: 1200 });
		expect(runs(broken)).toBe(2);
		expect(runs(curve.d)).toBe(1);
	});

	it("starts where the line started and ends where it ended", () => {
		const curve = curveOf({ left: 15, top: 40 }, { left: 85, top: 70 });
		const broken = curveWithGap(curve, { t: 0.5, span: 8, boardWidthPx: 1200 });
		expect(broken.startsWith(`M ${curve.from.left},${curve.from.top}`)).toBe(true);
		expect(broken.endsWith(`${curve.to.left},${curve.to.top}`)).toBe(true);
	});

	it("puts the gap where the caption actually is, not always in the middle", () => {
		const curve = curveOf({ left: 15, top: 50 }, { left: 85, top: 50 });
		const early = curveWithGap(curve, { t: 0.3, span: 6, boardWidthPx: 1200 });
		const late = curveWithGap(curve, { t: 0.7, span: 6, boardWidthPx: 1200 });
		// The first run is shorter when the caption sits early on the line.
		const firstRunEnd = d => Number(d.split("Q")[1].trim().split(/[ ,]/)[2]);
		expect(firstRunEnd(early)).toBeLessThan(firstRunEnd(late));
	});

	// A MISSING LINE SAYS SOMETHING FALSE about two people. A caption longer than the line it
	// belongs to would rub out the whole relationship to make room for the words describing it,
	// so past a point the line is left whole and the caption's halo does the work instead.
	it("leaves the line whole rather than rubbing it out for an oversized caption", () => {
		const curve = curveOf({ left: 40, top: 50 }, { left: 60, top: 50 });
		expect(curveWithGap(curve, { t: 0.5, span: 500, boardWidthPx: 1200 })).toBe(curve.d);
	});

	it("leaves it whole when the caption is jammed against one end", () => {
		const curve = curveOf({ left: 15, top: 50 }, { left: 85, top: 50 });
		expect(curveWithGap(curve, { t: 0.02, span: 8, boardWidthPx: 1200 })).toBe(curve.d);
		expect(curveWithGap(curve, { t: 0.98, span: 8, boardWidthPx: 1200 })).toBe(curve.d);
	});

	it("has nothing to cut when there is no curve, rather than throwing", () => {
		expect(curveWithGap(null, { t: 0.5, span: 8 })).toBe("");
	});

	// WHAT THE READER SAW BEFORE THIS: a line poking out of its own arrowhead. The head's tip
	// lands on the end of the line, which is right, but a triangle TAPERS -- over its last pixels
	// it is thinner than the stroke running up the middle of it, and the round cap put another
	// pixel and a half past the point. So the stroke now stops at the head's back edge, and only
	// at an end that has a head on it.
	describe("and stopping it short of an arrowhead", () => {
		const curve = curveOf({ left: 15, top: 50 }, { left: 85, top: 50 });
		const endOf = d => {
			const last = d.trim().split(/\s+/).pop().split(",");
			return { left: Number(last[0]), top: Number(last[1]) };
		};
		const startOf = d => {
			const first = d.trim().split(/\s+/)[1].split(",");
			return { left: Number(first[0]), top: Number(first[1]) };
		};
		const flatPx = (a, b) => Math.hypot(a.left - b.left, a.top - b.top) * 12;

		it("leaves a line with no heads running end to end", () => {
			expect(curveWithGap(curve, { span: 0, boardWidthPx: 1200, dir: "none" })).toBe(curve.d);
		});

		// THE WHOLE LENGTH OF THE TRIANGLE, less the pixel of overlap that keeps the join from
		// being a seam: see `HEAD_CUT_PX`.
		it("cuts the head's own length off the end it points at", () => {
			const cut = curveWithGap(curve, { span: 0, boardWidthPx: 1200, dir: "a-b" });
			expect(flatPx(endOf(cut), curve.to)).toBeCloseTo(HEAD_CUT_PX, 1);
			expect(startOf(cut)).toEqual(curve.from);
		});

		it("cuts the other end instead when the arrow is read the other way", () => {
			const cut = curveWithGap(curve, { span: 0, boardWidthPx: 1200, dir: "b-a" });
			expect(flatPx(startOf(cut), curve.from)).toBeCloseTo(HEAD_CUT_PX, 1);
			expect(endOf(cut)).toEqual(curve.to);
		});

		it("cuts both ends of a link read both ways", () => {
			const cut = curveWithGap(curve, { span: 0, boardWidthPx: 1200, dir: "both" });
			expect(flatPx(startOf(cut), curve.from)).toBeCloseTo(HEAD_CUT_PX, 1);
			expect(flatPx(endOf(cut), curve.to)).toBeCloseTo(HEAD_CUT_PX, 1);
		});

		// A FIXED LENGTH OF LINE AND NOT A SHARE OF IT: the head is the same board pixels whatever
		// the sheet, so on a wider board the same head takes a smaller share of the same percentages.
		it("takes the same pixels off however wide the board is", () => {
			const wide = curveWithGap(curve, { span: 0, boardWidthPx: 2400, dir: "a-b" });
			expect(Math.hypot(endOf(wide).left - curve.to.left, endOf(wide).top - curve.to.top) * 24)
				.toBeCloseTo(HEAD_CUT_PX, 1);
		});

		// ⚠ AND A BIGGER HEAD TAKES MORE OFF, which is the other half of the corner over the
		// board. The triangle's taper is longer, so the stroke has to stop further back or the
		// line shows through both sides of the point it is meant to end at.
		it("cuts back further for a head this reader has made bigger", () => {
			const cut = curveWithGap(curve, {
				span: 0, boardWidthPx: 1200, dir: "a-b", headPx: RELMAP_HEAD_PX * 2,
			});
			expect(flatPx(endOf(cut), curve.to)).toBeCloseTo(RELMAP_HEAD_PX * 2 * 0.8 - 1, 1);
		});

		// A link between two portraits almost touching keeps a stroke rather than losing it
		// entirely to the two heads.
		it("never eats the whole of a very short line", () => {
			const stub = curveOf({ left: 46, top: 50 }, { left: 54, top: 50 });
			const cut = curveWithGap(stub, { span: 0, boardWidthPx: 1200, dir: "both" });
			const left = Math.hypot(endOf(cut).left - startOf(cut).left, endOf(cut).top - startOf(cut).top);
			expect(left).toBeGreaterThan(0);
			expect(left).toBeCloseTo(stub.length * 0.2, 2);
		});

		// BOTH CUTS AT ONCE. A captioned line with an arrow on it has to lose its middle AND stop
		// short of its head, and the two used to be worked out by different callers.
		it("still breaks for the caption on a line that also carries a head", () => {
			const both = curveWithGap(curve, { t: 0.5, span: 8, boardWidthPx: 1200, dir: "a-b" });
			expect(runs(both)).toBe(2);
			expect(flatPx(endOf(both), curve.to)).toBeCloseTo(HEAD_CUT_PX, 1);
		});
	});

	// The fourth time in this feature that `Number(null) === 0` would have read "nowhere in
	// particular" as one particular END. Here it would have cut the gap off the start of the line
	// while the caption sat in the middle of it.
	it("cuts the gap in the middle when it is not told where, however that is spelt", () => {
		const curve = curveOf({ left: 15, top: 50 }, { left: 85, top: 50 });
		const middle = curveWithGap(curve, { t: 0.5, span: 8, boardWidthPx: 1200 });
		for (const bad of [null, undefined, "", "x", NaN]) {
			expect(curveWithGap(curve, { t: bad, span: 8, boardWidthPx: 1200 })).toBe(middle);
		}
	});
});
