// The relationship map as geometry: where the portraits sit, the curve that runs between two of
// them, where its label rides, and which way the arrowheads point.
//
// WHY IT IS ITS OWN MODULE, and why it looks so much like utils/route-path.js. That file's header
// explains the rule this one follows: the arithmetic lives apart from the renderers, because a
// curve computed twice is a curve that drifts. The map has two renderers already — the edge
// strokes are one stretched SVG, while the labels and the arrowheads are separate HTML and
// fixed-pixel SVG riding on top of it in percentages — and all three have to agree about where the
// same line is, to the pixel, or a label sits off its own stroke.
//
// EVERYTHING IS IN PERCENTAGES of the board, which is what lets one set of numbers serve an SVG
// viewBox, an absolutely-positioned HTML layer, and a board the reader has zoomed to any size.
//
// The `aspect` threaded through nearly every function is the board's width over its height, and it
// is here for the reason route-path.js gives at its top: percentages are not a square space. A step
// of 1% across is a different number of pixels from a step of 1% down, so a bow, an angle and a
// radius all have to be measured in the board's real proportions or they come out squashed along
// one axis. "Flat space" below is that correction applied: `left` unchanged, `top` divided by the
// aspect. Both flat axes then scale by the same board-width-over-100, so a distance in flat space
// is proportional to a distance in pixels, which is the space the reader's eye is actually in.

import { ROUTE_HEAD_PATH, ROUTE_HEAD_VIEWBOX } from "./route-path.js";

// Re-exported rather than re-authored. route-path.js:286-316 records that this triangle was once
// written twice and the two drifted; the map is a third surface drawing the same head, and the
// cheapest way not to become the fourth mistake is to import it.
export { ROUTE_HEAD_PATH, ROUTE_HEAD_VIEWBOX };

/** How many decimals a stored coordinate keeps. Two is a fifth of a node radius: far finer than
 * anyone can aim, and short enough that a flag full of them stays readable in the inspector. */
export const RELMAP_PRECISION = 2;

/**
 * The board's own proportions, and the size it pretends to be for the zoom arithmetic.
 *
 * A VIRTUAL board rather than a picture: utils/image-zoom.js works in an image's natural size, and
 * the map has no image, so it is handed these instead. Landscape, because a web of people spreads
 * sideways and because the window opens into a landscape hole in the screen.
 */
export const RELMAP_BOARD_ASPECT = 1.25;
export const RELMAP_BOARD_WIDTH = 1200;
export const RELMAP_BOARD_HEIGHT = Math.round(RELMAP_BOARD_WIDTH / RELMAP_BOARD_ASPECT);

/**
 * A portrait's diameter, in board pixels at 1:1.
 *
 * In PIXELS and not percentages, because it has to match what the stylesheet draws — the node is a
 * fixed-size circle that stays the same size as the board is zoomed, the same bargain the journey's
 * arrowheads make. The geometry needs it only to know where a curve should stop, so it is converted
 * to flat space once, by `nodeRadiusPct`, and never used raw below.
 */
export const RELMAP_NODE_PX = 72;

// How far a line bows off the straight run between two portraits, per step of the fan: a share of
// the line's own length, capped, both in flat units. Larger than the trail's, because these bows
// are doing a different job — they are what keeps two links between the same pair of people from
// lying on top of each other — and a bow too shallow to see is a link the reader cannot read.
const RELMAP_BOW_SHARE = 0.09;
const RELMAP_BOW_MAX = 5;

// How far back from the rim an arrowhead sits, in flat units, capped at a share of the line so a
// head on a short link cannot be pushed back past the portrait it set out from.
const HEAD_BACKOFF = 2.2;
const HEAD_BACKOFF_SHARE = 0.35;

// How finely the trim below hunts for the rim, and how many bisections refine the answer. A
// quadratic crossing a circle is a quartic, and solving it exactly buys nothing here: the walk
// finds the bracket and eight halvings pin it to well under a hundredth of a percent.
const TRIM_SAMPLES = 48;
const TRIM_REFINE = 8;

// The board's width over its height, defaulted. Every function here that measures a bow, an angle
// or a radius depends on this being the SAME rule, so it is written once. (route-path.js keeps its
// own copy of this one line; a shared import would tie two modules together for four characters.)
const ratioOf = aspect => (Number(aspect) > 0 ? Number(aspect) : 1);

/** A quadratic Bezier on one axis. Spelled out once, for the same reason route-path.js does. */
const quadAt = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;

/** Its slope at `t`, unnormalized. */
const quadSlope = (a, b, c, t) => 2 * (1 - t) * (b - a) + 2 * t * (c - b);

const round = n => Number(Number(n).toFixed(RELMAP_PRECISION));

/** A coordinate a node may actually be stored at. Percentages, and never off the board. */
export function clampPct(n) {
	// `Number(null)` is 0 and `Number("")` is 0, so the obvious one-liner reads a coordinate that
	// was never set as the top-left CORNER of the board rather than as missing. Every unplaced node
	// in a half-written map would pile up in that corner, which looks like a bug in the layout
	// rather than like data nobody has filled in. Missing means the middle.
	const v = n === null || n === undefined || n === "" ? NaN : Number(n);
	if (!Number.isFinite(v)) return 50;
	return round(Math.min(100, Math.max(0, v)));
}

/**
 * A portrait's radius as a percentage of the board's WIDTH — which is also its radius in flat
 * space, on both axes.
 *
 * That equivalence is the whole reason flat space is worth having. The node is a circle of fixed
 * pixels, so in percentages it is an ELLIPSE: one radius across, a different one down. Divide the
 * vertical percentage by the aspect and both come out the same number, so every distance test
 * below compares one scalar instead of solving an ellipse.
 */
export function nodeRadiusPct(diameterPx = RELMAP_NODE_PX, boardWidthPx = RELMAP_BOARD_WIDTH) {
	if (!(boardWidthPx > 0) || !(diameterPx > 0)) return 0;
	return (100 * (diameterPx / 2)) / boardWidthPx;
}

/**
 * Which way, and how far, the nth link between the same two people bows.
 *
 * THE FIRST LINK IS ALWAYS STRAIGHT, and that is a stability decision rather than a taste one. A
 * symmetric fan (-1, +1 for a pair) looks tidier the moment you draw it and is wrong the moment
 * anyone edits it: adding a second link to a pair would swing the first one off the line it had
 * been sitting on, and deleting one would swing the survivor back. Fanning outward from a fixed
 * centre means an edit only ever moves the link that was edited.
 *
 * Sides alternate so the fan spreads both ways instead of drifting off to one side.
 */
export function fanBow(index) {
	const i = Math.max(0, Math.trunc(Number(index) || 0));
	if (!i) return 0;
	return i % 2 ? (i + 1) / 2 : -(i / 2);
}

/** Into the space the eye is in, and back out again. */
const flat = (p, ratio) => ({ left: p.left, top: p.top / ratio });
const unflat = (p, ratio) => ({ left: p.left, top: p.top * ratio });

/** A point on a quadratic given as three flat points. */
const at = (a, b, c, t) => ({
	left: quadAt(a.left, b.left, c.left, t),
	top: quadAt(a.top, b.top, c.top, t),
});

const dist = (a, b) => Math.hypot(b.left - a.left, b.top - a.top);

/**
 * The first `t` at which the curve is at least `r` away from `anchor`, hunted then halved.
 *
 * Walks forward rather than solving, and returns null when the curve never gets that far — two
 * portraits overlapping, or a link so short it is entirely inside its own endpoints. A caller that
 * gets null draws nothing, which is the honest answer: there is no line to see between two circles
 * that are on top of each other.
 */
function escapeT(a, b, c, anchor, r, { from = 0, to = 1 } = {}) {
	// One sample of the walk, SIGNED: negative when the hunt runs from 1 back down to 0, which is
	// how the far rim is found. The step has to keep that sign, because the sample before `lo` is
	// `lo - step` in both directions and getting it wrong brackets the bisection around the sample
	// AFTER the crossing instead of the one before it. That still converges, silently, on a point
	// well past the rim.
	const step = (to - from) / TRIM_SAMPLES;
	let lo = null;
	for (let i = 1; i <= TRIM_SAMPLES; i++) {
		const t = from + step * i;
		if (dist(at(a, b, c, t), anchor) >= r) { lo = t; break; }
	}
	if (lo === null) return null;
	// Bracket is [previous sample, lo]; halve it down to the rim.
	let inside = lo - step;
	let outside = lo;
	for (let i = 0; i < TRIM_REFINE; i++) {
		const mid = (inside + outside) / 2;
		if (dist(at(a, b, c, mid), anchor) >= r) outside = mid;
		else inside = mid;
	}
	return outside;
}

/**
 * The curve between two portraits: a quadratic, bowed by `bow`, and TRIMMED TO THE RIMS.
 *
 * WHY IT IS TRIMMED. A line drawn between two centres runs underneath both portraits and comes out
 * the far side. Round-clipping the portraits hides most of that, but not the arrowhead — a head at
 * the centre of a face is buried, and a head at the untrimmed end points at nothing. Cutting the
 * curve back to where it crosses each circle gives every renderer the same honest endpoints: the
 * stroke starts at the rim, the head sits on the rim pointing in, and the label at the halfway
 * mark is halfway along the part anyone can see rather than halfway between two noses.
 *
 * The subsegment of a quadratic is still a quadratic, so the trim is exact rather than an
 * approximation: `Q1 = Q0 + (t1 - t0) * B'(t0) / 2` is de Casteljau written out for the one case
 * this needs.
 *
 * @param {object} spec  `from`/`to` are `{left, top}` centres in percentages; `r` is the radius
 *                       from `nodeRadiusPct` (one number, both ends); `bow` from `fanBow`.
 * @returns {{d: string, from, to, control, length: number}|null}  null when there is no line to
 *          draw: the two ends coincide, or the portraits swallow the whole of it.
 */
export function edgeCurve({ from, to, bow = 0, aspect = RELMAP_BOARD_ASPECT, r = nodeRadiusPct() } = {}) {
	if (!from || !to) return null;
	const ratio = ratioOf(aspect);
	const p0 = flat(from, ratio);
	const p2 = flat(to, ratio);
	const dx = p2.left - p0.left;
	const dy = p2.top - p0.top;
	const len = Math.hypot(dx, dy);
	// Two portraits on the same spot have no direction between them and so no curve.
	if (!len) return null;

	// Twice the depth wanted, because a quadratic only travels half way to its control point.
	const reach = Number(bow) * Math.min(len * RELMAP_BOW_SHARE, RELMAP_BOW_MAX) * 2;
	const p1 = {
		left: (p0.left + p2.left) / 2 + (dy / len) * reach,
		top: (p0.top + p2.top) / 2 - (dx / len) * reach,
	};

	// Where the curve leaves the first rim, and where it reaches the second.
	const t0 = r > 0 ? escapeT(p0, p1, p2, p0, r, { from: 0, to: 1 }) : 0;
	const t1 = r > 0 ? escapeT(p0, p1, p2, p2, r, { from: 1, to: 0 }) : 1;
	if (t0 === null || t1 === null || !(t1 > t0)) return null;

	const q0 = at(p0, p1, p2, t0);
	const q2 = at(p0, p1, p2, t1);
	const span = t1 - t0;
	const q1 = {
		left: q0.left + (span * quadSlope(p0.left, p1.left, p2.left, t0)) / 2,
		top: q0.top + (span * quadSlope(p0.top, p1.top, p2.top, t0)) / 2,
	};

	const back = p => ({ left: round(p.left), top: round(p.top * ratio) });
	const curve = {
		from: back(q0),
		to: back(q2),
		control: back(q1),
		// Kept in FLAT units, which is the only space a length means anything in. Callers use it
		// to decide whether a link is long enough to carry a head or a label at all.
		length: dist(q0, q2),
	};
	const pt = p => `${p.left},${p.top}`;
	curve.d = `M ${pt(curve.from)} Q ${pt(curve.control)} ${pt(curve.to)}`;
	return curve;
}

/**
 * Where a link's label sits, and how far it is turned over.
 *
 * ON the curve at its halfway point, not on the chord between the ends: the whole reason a second
 * link between the same pair bows is so its label clears the first one, and a label placed on the
 * chord would sit in the same spot for every link in the fan.
 *
 * THE ANGLE IS TAKEN IN FLAT SPACE, for the reason routeArrow gives at route-path.js:318-335: the
 * board is wider than it is tall, so the direction the numbers describe is not the direction the
 * reader sees, and a label set to the raw angle lies visibly off its own line on a diagonal.
 *
 * AND IT IS NEVER UPSIDE DOWN. Past a quarter turn either way the text is flipped to read along
 * the line the other way instead. A label is prose, and prose the reader has to tilt their head to
 * take in is worse than one that runs right-to-left along its line.
 */
export function edgeLabelAnchor(curve, aspect = RELMAP_BOARD_ASPECT) {
	if (!curve) return null;
	const ratio = ratioOf(aspect);
	const a = flat(curve.from, ratio);
	const b = flat(curve.control, ratio);
	const c = flat(curve.to, ratio);
	const point = at(a, b, c, 0.5);
	const alongX = quadSlope(a.left, b.left, c.left, 0.5);
	const alongY = quadSlope(a.top, b.top, c.top, 0.5);
	let angle = (Math.atan2(alongY, alongX) * 180) / Math.PI;
	if (angle > 90) angle -= 180;
	if (angle < -90) angle += 180;
	const back = unflat(point, ratio);
	return { left: round(back.left), top: round(back.top), angle: round(angle) };
}

/**
 * The arrowheads a link wears, given which way it is meant to be read.
 *
 * `dir` is one of `a-b`, `b-a`, `both` or `none`, where a and b are the curve's own `from` and
 * `to`. "None" is the ordinary case and the default: most ties between people are mutual, and a
 * board of arrows all pointing at each other says less than a board with none.
 *
 * Each head sits just short of the rim pointing INTO it, and each takes the curve's slope where it
 * actually sits rather than the angle between the two portraits, because the line is bowed and by
 * the time it arrives it is already turning.
 */
export function edgeArrowheads(curve, aspect = RELMAP_BOARD_ASPECT, dir = "none") {
	if (!curve || dir === "none" || !dir) return [];
	const ends = dir === "both" ? ["to", "from"] : dir === "b-a" ? ["from"] : ["to"];
	const ratio = ratioOf(aspect);
	const a = flat(curve.from, ratio);
	const b = flat(curve.control, ratio);
	const c = flat(curve.to, ratio);
	const len = curve.length;
	if (!(len > 0)) return [];
	const backoff = Math.min(HEAD_BACKOFF, len * HEAD_BACKOFF_SHARE) / len;

	return ends.map(end => {
		const t = end === "to" ? 1 - backoff : backoff;
		const point = at(a, b, c, t);
		let alongX = quadSlope(a.left, b.left, c.left, t);
		let alongY = quadSlope(a.top, b.top, c.top, t);
		// A head at the `from` end points back the way the curve came.
		if (end === "from") { alongX = -alongX; alongY = -alongY; }
		const back = unflat(point, ratio);
		return {
			end,
			left: round(back.left),
			top: round(back.top),
			angle: round((Math.atan2(alongY, alongX) * 180) / Math.PI),
		};
	});
}

/**
 * Where `count` portraits go when nobody has placed them: evenly round a ring.
 *
 * An ELLIPSE in percentages, which is a circle to the eye — the ring is laid out in flat space and
 * converted back on the way out, so it does not come out as an oval on a landscape board.
 *
 * The radius shrinks to whatever the board can hold, measured on BOTH axes, so a tall board or a
 * large portrait pulls the ring in rather than pushing half of it off the top edge.
 *
 * Starts at twelve o'clock and goes clockwise, because that is the order a reader's eye takes a
 * ring in and it makes the seating plan predictable: the first person added is always at the top.
 */
export function ringLayout(count, { aspect = RELMAP_BOARD_ASPECT, r = nodeRadiusPct(), pad = 3 } = {}) {
	const n = Math.max(0, Math.trunc(Number(count) || 0));
	if (!n) return [];
	const ratio = ratioOf(aspect);
	const radius = ringRadius(ratio, r, pad);
	if (n === 1) return [{ left: 50, top: 50 }];
	return Array.from({ length: n }, (_, i) => {
		const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
		return {
			left: clampPct(50 + radius * Math.cos(angle)),
			top: clampPct(50 + radius * ratio * Math.sin(angle)),
		};
	});
}

function ringRadius(ratio, r, pad) {
	const across = 50 - r - pad;
	const down = 50 / ratio - r - pad;
	return Math.max(8, Math.min(across, down));
}

/** How many portraits fit round a ring of radius `R` without touching, at least one. */
function ringCapacity(radius, clear) {
	return Math.max(1, Math.floor((2 * Math.PI * radius) / Math.max(0.001, clear)));
}

/** The most rings worth trying. Past this the board is so crowded that another ring buys nothing. */
const MAX_RINGS = 8;

/**
 * Seats for `count` people across CONCENTRIC rings, sized so they all fit the board.
 *
 * WHY THIS EXISTS BESIDE `ringLayout`. That one puts everybody on a single ring, which is right for
 * a handful and is exactly the look of a relationship poster. A steading's whole cast is not a
 * handful: twenty-odd people on one ring are spaced closer than their own portraits are wide, and
 * they overlap into an unreadable band. This lays as many rings as the count needs.
 *
 * OUTERMOST FIRST, so a small cast still comes out as the single wide ring — the good-looking case
 * is not sacrificed to the large one. Each ring is turned half a step against the one outside it, so
 * the seats do not line up into spokes with corridors of empty board between them.
 *
 * It never refuses and never overflows the board: past `MAX_RINGS` the seats simply pack tighter
 * than ideal, which is a crowded board rather than a broken one, and dragging fixes it.
 */
export function ringsLayout(count, { aspect = RELMAP_BOARD_ASPECT, r = nodeRadiusPct(), pad = 3 } = {}) {
	const n = Math.max(0, Math.trunc(Number(count) || 0));
	if (!n) return [];
	if (n === 1) return [{ left: 50, top: 50 }];
	const ratio = ratioOf(aspect);
	const outer = ringRadius(ratio, r, pad);
	const clear = 2 * r + pad;

	// The fewest rings that hold everybody, with the outermost always out at the board's edge.
	let rings = 1;
	while (rings < MAX_RINGS) {
		let seats = 0;
		for (let i = 1; i <= rings; i++) seats += ringCapacity((outer * i) / rings, clear);
		if (seats >= n) break;
		rings += 1;
	}

	const out = [];
	let left = n;
	for (let i = rings; i >= 1 && left > 0; i--) {
		const radius = (outer * i) / rings;
		// The innermost ring takes whatever is left over, however many that is: it is the smallest
		// circle and the one with the least to lose by being tight.
		const here = i === 1 ? left : Math.min(left, ringCapacity(radius, clear));
		// Half a step of turn per ring, so consecutive rings interleave rather than lining up.
		const turn = (i % 2 ? 0 : Math.PI / here);
		for (let k = 0; k < here; k++) {
			const angle = -Math.PI / 2 + turn + (k * 2 * Math.PI) / here;
			out.push({
				left: clampPct(50 + radius * Math.cos(angle)),
				top: clampPct(50 + radius * ratio * Math.sin(angle)),
			});
		}
		left -= here;
	}
	return out;
}

/**
 * Somewhere to put ONE new portrait that is not on top of an existing one.
 *
 * What "Add someone" needs, and what a drop with no usable coordinates falls back to. Walks the
 * ring at a fixed step looking for clear air, widening to a second ring, and gives up onto the
 * middle rather than refusing: a node stacked on another can be dragged apart in a second, while a
 * node that was never added leaves the reader wondering whether the button works.
 */
export function freeSpot(taken = [], { aspect = RELMAP_BOARD_ASPECT, r = nodeRadiusPct(), pad = 3 } = {}) {
	const ratio = ratioOf(aspect);
	const clear = 2 * r + pad;
	// SEVERAL rings, not two. Two was enough while people arrived one at a time, and is not once a
	// board carries a village: the outer ring fills, the half ring fills, and everybody after that
	// lands on the pile in the middle.
	const outer = ringRadius(ratio, r, pad);
	const rings = [1, 0.72, 0.48, 0.26].map(share => outer * share);
	for (const radius of rings) {
		const steps = Math.max(6, Math.round((2 * Math.PI * radius) / Math.max(1, clear)));
		for (let i = 0; i < steps; i++) {
			const angle = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
			const spot = {
				left: clampPct(50 + radius * Math.cos(angle)),
				top: clampPct(50 + radius * ratio * Math.sin(angle)),
			};
			const here = flat(spot, ratio);
			const clash = taken.some(p => p && dist(flat(p, ratio), here) < clear);
			if (!clash) return spot;
		}
	}
	return { left: 50, top: 50 };
}
