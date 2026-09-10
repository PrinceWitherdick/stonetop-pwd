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

import { ROUTE_HEAD_PATH, ROUTE_HEAD_POINTS, ROUTE_HEAD_VIEWBOX } from "./route-path.js";

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

/**
 * THE SHEET GETS BIGGER WHEN THERE ARE MORE PEOPLE ON IT.
 *
 * WHY IT HAS TO, and why nothing else would do. Everything on this board is one of two kinds of
 * thing: positioned in PERCENTAGES (the portraits, the lines, the captions) or sized in board
 * PIXELS (a portrait is 72 of them, a caption is 12-pixel type in a chip of capped width). The
 * ratio between those two is the whole of "is there room for the writing", and on a fixed sheet it
 * is fixed: forty people and a hundred captions have to share exactly the room that eight had, so
 * they overlap and no layout can win it back. A bigger sheet is the only lever, because it is the
 * one that makes the fixed-pixel things SMALLER relative to the board while leaving them their
 * full size to be read at.
 *
 * The reader pays for it in zoom, and that is the honest trade rather than a hidden cost: the
 * window opens the whole board fitted, so a big map opens smaller and is read by zooming in, where
 * the faces are 72 pixels and the type is 12 with room around it. Shrinking the type instead would
 * have made it illegible at every magnification.
 *
 * A HANDFUL OF PEOPLE CHANGES NOTHING. `RELMAP_BOARD_HOLDS` is how many the plain sheet carries
 * with room to spare, and up to that the sheet is exactly the one the board has always been: a
 * small map still opens at 1:1 with 12-pixel type and 72-pixel faces, as it always did.
 *
 * Past it the AREA per person is what is held constant, so the width goes as the square root of
 * the cast: twice the people is about half again the sheet.
 *
 * SIX WAS MEASURED, not picked. On a trial board of thirty-nine people and eighty-five captions,
 * the number of captions sitting on one another falls steeply as the sheet grows and then
 * flattens: 161 at the old fixed size, 61 at a sheet holding twelve, 43 at ten, 36 at eight, 17 at
 * six, and no better at five. Six is where the curve stops paying for the zoom it costs.
 */
const RELMAP_BOARD_HOLDS = 6;
export const RELMAP_BOARD_MAX = 4800;

/**
 * The sheet for a width a view has asked for: that width floored at the plain sheet and capped at
 * `RELMAP_BOARD_MAX`, its height, and a portrait's radius on it.
 *
 * ONE CALL, because the three have to be worked out from the same number. The floor, the cap and
 * the aspect are one rule and every view obeys it; what the views differ on is only how wide they
 * want to be, which is the argument. Everything that measures a board asks here rather than
 * reaching for the constants.
 *
 * MODULE-PRIVATE. It was exported for the view modules that each wanted a different width; those
 * are gone and `boardMetrics` is the one question anything outside this file now asks.
 */
function sheetFor(wantWidthPx) {
	const want = Math.round(Number(wantWidthPx) || 0);
	const width = Math.min(RELMAP_BOARD_MAX, Math.max(RELMAP_BOARD_WIDTH, want));
	return {
		width,
		height: Math.round(width / RELMAP_BOARD_ASPECT),
		r: nodeRadiusPct(RELMAP_NODE_PX, width),
	};
}

/** The sheet a cast of `people` gets. This is the CAST's question, which is the web view's: room
 * for the writing on as many lines as this many people carry. The family view asks `sheetFor` a
 * different one, because a chart carries no captions at all. */
export function boardMetrics(people) {
	const n = Math.max(1, Math.trunc(Number(people) || 0));
	return sheetFor(RELMAP_BOARD_WIDTH * Math.sqrt(n / RELMAP_BOARD_HOLDS));
}

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

/**
 * An arrowhead's size in board pixels — what the stylesheet draws it at — and how far its TIP
 * reaches ahead of the point it is anchored on, as a share of that size.
 *
 * WHY THE BACK-OFF IS MEASURED IN PIXELS AND NOT IN FLAT UNITS. It used to be a flat 2.2, which is
 * 2.2% of the board's width, and that is not a fixed distance: the sheet grows with the cast
 * (`boardMetrics`), so on a board of forty people the same 2.2 was over a hundred pixels and the
 * head sat well short of the face it was pointing at — about three quarters of the way along its
 * own line. The head itself is a fixed pixel size whatever the sheet, so the distance it should
 * stand off is a pixel distance too, converted per board like every other pixel measure here.
 *
 * ⚠ THE STYLESHEET DRAWS THE SAME NUMBER, as the width and height of `.stonetop-relmap-head`,
 * and the two have to agree: this file steps the head back off the rim by the tip's share of it,
 * so a stylesheet drawing a different size would put every tip short of the line or past it.
 *
 * AND IT IS EXACTLY THE TIP'S OWN REACH, so the point of the triangle lands ON the curve's end.
 * The curve is already trimmed to the rims by `edgeCurve`, so a head whose tip is at the end of
 * the line is a head touching the portrait it arrives at, which is what "which way this is read"
 * has to look like. The share comes from the triangle's own points rather than a literal 0.4, for
 * the reason route-path.js:286-316 gives: a reshaped head must not leave a second copy behind.
 *
 * The journey's trails keep their own, larger stand-off, and rightly: there the head arrives at a
 * map pin with a label beside it, and a tip touching the pin would be buried under it.
 */
export const RELMAP_HEAD_PX = 22;
const HEAD_TIP_SHARE = ROUTE_HEAD_POINTS[1][0];

// Capped at a share of the line, so a head on a short link cannot be pushed back past the portrait
// it set out from.
const HEAD_BACKOFF_SHARE = 0.35;

/**
 * WHERE THE PAINTED STROKE STOPS at an end that wears a head, as a length behind the tip.
 *
 * The head's tip sits exactly on the end of the line (`edgeArrowheads` above), which is right, and
 * for a long time the stroke was drawn all the way to that same point — which was not. A triangle
 * TAPERS: over its last few pixels it is narrower than the 3.5-pixel stroke running up the middle
 * of it, and narrower still than the 6 a picked line is drawn at. So the line showed on both sides
 * of the point and the round cap put another pixel and a half beyond it, and what the reader saw
 * was a line poking out of its own arrowhead rather than an arrowhead ending a line.
 *
 * So the stroke stops at the head's BACK EDGE, which is the whole length of the triangle behind the
 * tip: the two shares are the triangle's own points, for the reason route-path.js:286-316 gives, so
 * a reshaped head moves the stroke's end with it instead of leaving the gap this fixes.
 *
 * A PIXEL OF OVERLAP, so the join is not a seam. The stroke ends one pixel INSIDE the triangle,
 * where it is still most of its width across, and the round cap buries another pixel and a half in
 * the same place. Butt caps would do as well and would change how every gap in every line is
 * capped; this changes nothing but the two ends that have a head over them.
 */
const HEAD_BODY_SHARE = HEAD_TIP_SHARE - ROUTE_HEAD_POINTS[0][0];
const HEAD_STROKE_OVERLAP_PX = 1;

/**
 * The two lengths a head of a given size takes off the line it ends: how far its TIP reaches ahead
 * of the centre the stylesheet positions it by, and how far its BACK EDGE sits behind that tip.
 *
 * ⚠ A FUNCTION OF THE SIZE RATHER THAN TWO CONSTANTS, because the size is no longer one number.
 * `RELMAP_HEAD_PX` is what the sheet draws at 100%, and a reader who has asked for heavier
 * arrowheads (relmap/relmap-weights.js) is drawing the same triangle bigger: its tip reaches
 * further ahead, so it has to stand further off the rim, and its taper is longer, so the stroke
 * has to stop further back. Left as constants, a head at 200% would sit at the 100% stand-off with
 * its point buried in the portrait and its own line showing through both sides of the taper.
 *
 * ⚠ AND THE SHARES ARE THE TRIANGLE'S OWN POINTS, never a literal 0.4, for the reason
 * route-path.js:286-316 gives: a reshaped head must not leave a second copy of its old proportions
 * behind in the geometry that places it.
 */
function headReach(headPx = RELMAP_HEAD_PX) {
	const size = Number(headPx) > 0 ? Number(headPx) : RELMAP_HEAD_PX;
	return { tip: size * HEAD_TIP_SHARE, body: size * HEAD_BODY_SHARE };
}

// And never more than this share of the line, at either end, so a link between two portraits almost
// touching keeps a stroke at all. Under that length the heads cover the whole run anyway.
const HEAD_STROKE_MAX_SHARE = 0.4;

// How finely the trim below hunts for the rim, and how many bisections refine the answer. A
// quadratic crossing a circle is a quartic, and solving it exactly buys nothing here: the walk
// finds the bracket and eight halvings pin it to well under a hundredth of a percent.
const TRIM_SAMPLES = 48;
const TRIM_REFINE = 8;

// The board's width over its height, defaulted. Every function here that measures a bow, an angle
// or a radius depends on this being the SAME rule, so it is written once. Exported for the modules
// that already draw on this one: relmap-store.js seats arrivals on the same board with the same
// aspect.
// (route-path.js keeps its own copy of this one line; it shares nothing else with this module, and
// a shared import would tie two of them together for four characters.)
export const ratioOf = aspect => (Number(aspect) > 0 ? Number(aspect) : 1);

/** A quadratic Bezier on one axis. Spelled out once, for the same reason route-path.js does. */
const quadAt = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;

/** Its slope at `t`, unnormalized. */
const quadSlope = (a, b, c, t) => 2 * (1 - t) * (b - a) + 2 * t * (c - b);

/** Every number this feature writes into markup, at `RELMAP_PRECISION`. Exported so every module
 * that hands over a seat rounds it by the same rule as the lines drawn between them. */
export const round = n => Number(Number(n).toFixed(RELMAP_PRECISION));

/**
 * How far along a curve a caller meant, on [0, 1], defaulting to the middle.
 *
 * SHARED BECAUSE THE `Number(null) === 0` TRAP HAS BITTEN FOUR TIMES IN THIS ONE FEATURE, and
 * every time it reads "nowhere in particular" as one particular END. `clampPct` above records the
 * first; the ratings import's own band reader the second, in a module since deleted;
 * `edgeLabelAnchor` parked a caption on a portrait's rim; and `curveWithGap` cut the gap for it in
 * the wrong place. Two callers spelling this out is two chances to spell it differently, so it is
 * spelt once.
 */
const alongT = t => {
	const asked = t === null || t === undefined || t === "" ? NaN : Number(t);
	return Number.isFinite(asked) ? Math.min(1, Math.max(0, asked)) : 0.5;
};

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
 * The stretch of one quadratic between two parameters, as its own three points.
 *
 * EXACT RATHER THAN SAMPLED: a subsegment of a quadratic IS a quadratic, and
 * `Q1 = Q0 + (t1 - t0) * B'(t0) / 2` is de Casteljau written out for the one case this needs.
 *
 * Written once because two callers want the same cut -- `edgeCurve` trimming a line back to the two
 * rims, and `subPath` cutting the gap the caption sits in -- and two copies of one formula is two
 * chances for them to disagree about the same curve.
 *
 * The maths is affine, so this is as true of the percentages a `d` is written in as of the flat
 * units distances are measured in; each caller passes whichever space it is already in.
 */
const subQuad = (p0, p1, p2, tA, tB) => {
	const q0 = at(p0, p1, p2, tA);
	const span = tB - tA;
	return {
		q0,
		q1: {
			left: q0.left + (span * quadSlope(p0.left, p1.left, p2.left, tA)) / 2,
			top: q0.top + (span * quadSlope(p0.top, p1.top, p2.top, tA)) / 2,
		},
		q2: at(p0, p1, p2, tB),
	};
};

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

	const { q0, q1, q2 } = subQuad(p0, p1, p2, t0, t1);

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
 *
 * `t` IS WHERE ALONG THE CURVE, and it is halfway by default because that is where a caption
 * belongs when nothing is in its way. `spreadLabels` below is the one caller that passes anything
 * else: on a busy board a chip is slid along its OWN line to find clear air, never off it, because
 * a label that has left its line is a label about some other line.
 *
 * IT SITS ON THE STROKE, not beside it, because the stroke gets out of its way: `curveWithGap`
 * below cuts a length out of the line exactly where the caption goes, so the words sit IN the line
 * rather than on top of it. That is why there is no perpendicular offset here to keep in step with
 * the stylesheet.
 *
 * ⚠ `span` IS HOW LONG THE WORDS ARE, in flat units, and it is what makes a caption MEET its line
 * instead of merely touching it. The words are set STRAIGHT (the board cannot afford to warp type;
 * see the arc-table section below), so on a bowed line a caption is a straight run laid over a
 * curved one and the two can only agree in some places. Given no span, the run is the TANGENT
 * where the caption sits: the two agree at the caption's middle and part company from there, so
 * the words end a dozen pixels to one side of the very stub of stroke they are supposed to be
 * continuing -- which is exactly what a reader sees as "that caption is not on its line", because
 * the join is the only place the eye can check.
 *
 * GIVEN A SPAN, the run is the CHORD of the stretch the words cover: both ends land ON the curve,
 * at the two places the stroke stops and picks up again, and the parting company is moved to the
 * middle of the caption where there is no stroke to disagree with. Half the deviation, and none of
 * it where it shows. Measured on a real board of thirteen people: the worst join went from 12
 * pixels off its stroke to nothing, and no caption's middle strays further than the joins used to.
 *
 * THE WINDOW SLIDES RATHER THAN SHRINKS where the words are longer than the line, so the chord
 * stays the length of the caption and the caption stays centred on the words it is. That case is
 * also the one `curveWithGap` refuses to cut a hole for (`GAP_MIN_STUB`), so a slid caption is
 * never a caption sitting away from a hole cut somewhere else.
 */
export function edgeLabelAnchor(curve, aspect = RELMAP_BOARD_ASPECT, t = 0.5, span = 0) {
	if (!curve) return null;
	const ratio = ratioOf(aspect);
	const a = flat(curve.from, ratio);
	const b = flat(curve.control, ratio);
	const c = flat(curve.to, ratio);
	const along = alongT(t);
	const seat = chordSeat(curve, ratio, along, span);
	const point = seat?.point ?? at(a, b, c, along);
	let angle = seat?.angle;
	if (angle === undefined) {
		const alongX = quadSlope(a.left, b.left, c.left, along);
		const alongY = quadSlope(a.top, b.top, c.top, along);
		angle = (Math.atan2(alongY, alongX) * 180) / Math.PI;
	}
	if (angle > 90) angle -= 180;
	if (angle < -90) angle += 180;
	const back = unflat(point, ratio);
	// `t` rides along, because the caller that placed this caption is also the one that has to cut
	// the gap in the line for it, and the gap has to be centred on the same point.
	//
	// `+ 0` ON THE ANGLE, which is not noise: a chord across a level line comes out a hair BELOW
	// level in floating point, and `Math.round` of that is negative zero. It reads back as zero
	// everywhere but in the markup, where it prints as `rotate(-0 ...)`.
	return { left: round(back.left), top: round(back.top), angle: round(angle) + 0, t: along };
}

/** How finely a curve is walked to find the point on it nearest the cursor. Chords, like the arc
 * table's, and the same reasoning: between this many samples a bow this shallow leaves its own
 * chord by a fraction of a pixel, which is far inside the accuracy a dragged caption needs. */
const SEAT_SAMPLES = 48;

/**
 * WHERE ON A LINE A POINT IS, as the parameter of the nearest place on the curve to it.
 *
 * WHAT THIS IS FOR is dragging a caption ALONG its own line: the pointer goes where a hand goes,
 * which is near the line and never exactly on it, and what the board needs from that is the one
 * number a caption is placed by. Nothing else about the pointer survives — a caption cannot be
 * dragged OFF its line, because a label that has left its line is a label about some other line
 * (`edgeLabelAnchor` says the same thing where the spreader slides one).
 *
 * IN FLAT SPACE, because it compares DISTANCES: the board is taller than it is wide, and a nearest
 * point measured in raw percentages would be pulled along whichever axis the board is longer in —
 * so a caption dragged square across a near-vertical line would slide when it should not.
 *
 * BY PROJECTING ONTO EACH CHORD rather than by taking the nearest sample: the samples are 2% of a
 * line apart, and the nearest of them alone would step a caption in visible jumps down a long
 * stroke. The projection puts it anywhere between two.
 *
 * @param {object} curve  `from`/`control`/`to` from `edgeCurve`.
 * @param {{left: number, top: number}} point  where the pointer is, in board percentages.
 * @returns {number|null}  0 to 1 along the curve, or null when there is no curve or no point.
 */
export function seatAlong(curve, point, aspect = RELMAP_BOARD_ASPECT) {
	if (!curve?.from || !curve.control || !curve.to || !point) return null;
	const ratio = ratioOf(aspect);
	const left = Number(point.left);
	const top = Number(point.top);
	if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
	const p = flat({ left, top }, ratio);
	const a = flat(curve.from, ratio);
	const b = flat(curve.control, ratio);
	const c = flat(curve.to, ratio);
	let best = 0.5;
	let nearest = Infinity;
	let prev = at(a, b, c, 0);
	for (let i = 1; i <= SEAT_SAMPLES; i++) {
		const next = at(a, b, c, i / SEAT_SAMPLES);
		const dx = next.left - prev.left;
		const dy = next.top - prev.top;
		const run = dx * dx + dy * dy;
		// How far along THIS chord the point falls, held to the chord's own two ends so that a
		// pointer out past one of them lands on the end rather than off the line.
		const share = run > 0
			? Math.min(1, Math.max(0, ((p.left - prev.left) * dx + (p.top - prev.top) * dy) / run))
			: 0;
		const gap = Math.hypot(p.left - (prev.left + share * dx), p.top - (prev.top + share * dy));
		if (gap < nearest) {
			nearest = gap;
			best = (i - 1 + share) / SEAT_SAMPLES;
		}
		prev = next;
	}
	return best;
}

/**
 * The straight run one caption of `span` covers, as the chord of the curve under it: where its
 * middle goes, and how far it is turned over. Both in FLAT space, which is the space an angle
 * means anything in.
 *
 * MEASURED ALONG THE CURVE and not across it, for the reason `curveWithGap` gives: the words are
 * as long as they are, and the stretch of a bowed line they cover is longer than the straight run
 * between its ends. The same arc table serves both, so the chord and the hole cut for it are the
 * same stretch of the same line by construction.
 *
 * Null for a caption with no width, which is every line with nothing written on it: those want the
 * tangent, because what rides on them is the tie bar rather than any words.
 */
function chordSeat(curve, ratio, along, span) {
	const wide = Number(span);
	if (!(wide > 0)) return null;
	const arc = arcOf(curve, ratio);
	if (!(arc.total > 0)) return null;
	// Never longer than the line it is measured on: past that there is no stretch left to slide.
	const half = Math.min(wide, arc.total) / 2;
	// Slid back inside the curve where the words run off the end of it. `Math.max` last, so a
	// caption exactly as long as its line comes out as the whole line rather than as nothing.
	const lo = Math.max(0, Math.min(arc.at(along) - half, arc.total - 2 * half));
	const a = flat(curve.from, ratio);
	const b = flat(curve.control, ratio);
	const c = flat(curve.to, ratio);
	const ends = [lo, lo + 2 * half].map(s => at(a, b, c, arc.tAt(s)));
	return {
		point: { left: (ends[0].left + ends[1].left) / 2, top: (ends[0].top + ends[1].top) / 2 },
		angle: (Math.atan2(ends[1].top - ends[0].top, ends[1].left - ends[0].left) * 180) / Math.PI,
	};
}

/**
 * Where a line actually runs, as a run of points along it.
 *
 * FOR ANYTHING THAT HAS TO KEEP OFF THE STROKE rather than sit on it. The middle of a line says
 * nothing about where the rest of it goes: a near-vertical link has its whole upper half directly
 * above its own midpoint, so a panel placed "above the middle" lands squarely across it. The tie
 * bar walks these points to find a seat the stroke does not pass through.
 *
 * IN THE PERCENTAGES THE CURVE IS WRITTEN IN, unflattened, because that is the space the stroke is
 * PAINTED in -- the line layer is stretched with `preserveAspectRatio="none"`, so a percentage pair
 * multiplied by the painted box is exactly where the reader sees that piece of the line. Flattening
 * here would hand back points off the drawing on every board that is not square.
 *
 * CHORDS, NOT THE CURVE. A caller asking whether a box is clear of this line tests the segments
 * between these points, and between them the real curve bulges away from its chord by less than a
 * pixel at this many samples on a board of any size a person reads -- which is well inside the
 * clearance any such caller keeps anyway.
 *
 * @param {object} curve  `from`/`control`/`to` from `edgeCurve`.
 * @param {number} [count]  how many segments to cut it into; the run is one point longer.
 * @returns {Array<{left: number, top: number}>|null}  null when there is no curve to walk.
 */
export function curvePoints(curve, count = 32) {
	const { from, control, to } = curve ?? {};
	if (!from || !control || !to) return null;
	const steps = Math.max(1, Math.trunc(count) || 1);
	const out = [];
	for (let i = 0; i <= steps; i++) out.push(at(from, control, to, i / steps));
	return out;
}

// ── Cutting the line open where its caption goes ─────────────────────────────────────
//
// WHY A GAP AND NOT SOMETHING CHEAPER. The caption is bare words now, and a stroke drawn straight
// through them is the one thing that makes them hard to read. The halo behind the letters covers
// most of it, but only a ring around each glyph: the line still shows through the counters of the
// letters and the spaces between the words, which reads as a scratched-out caption. Taking the
// stroke away over exactly that stretch leaves the words sitting IN the line, the way a label sits
// in a rule on a drawing.
//
// AS TWO SUBPATHS OF ONE `d`, and that is what makes it cheap. A `d` may hold several `M ... Q`
// runs, so the break costs no extra element, no change to the markup, and nothing at all to the
// live drag, which already rewrites `d` on every frame.
//
// NOT `stroke-dasharray`, which is the other obvious way and does not work here. The line layer is
// stretched with `preserveAspectRatio="none"`, so a length along a diagonal path in the SVG's own
// units is not proportional to the length a reader sees, and a dash pattern measured in either
// space comes out the wrong size in the other. Splitting the curve is exact in both, because the
// subsegment of a quadratic is a quadratic and splitting is unaffected by the stretch.

/** How much more than the words themselves the gap takes: the two round stroke caps, plus air, in
 * board pixels. Without the caps the stroke creeps back in at both ends of the gap. */
const GAP_AIR_PX = 9;

/** How short a piece of line the break may leave at either end, as a share of the whole. Under
 * this the line is left WHOLE and the caption rides on it with only its halo: a caption longer
 * than the line it belongs to would otherwise rub out the entire relationship to make room for
 * the words describing it, and a missing line says something false about two people. */
const GAP_MIN_STUB = 0.1;

/**
 * Which of a curve's two ends wear an arrowhead, given which way the link is meant to be read.
 *
 * ⚠ ONE ANSWER, TWO READERS. `edgeArrowheads` places the heads and `curveWithGap` cuts the stroke
 * back from underneath them, and the moment those two disagree about which end has a head on it,
 * one line on the board is drawn short of nothing at all and another pokes out of its own point.
 */
function headEnds(dir) {
	if (!dir || dir === "none") return [];
	if (dir === "both") return ["to", "from"];
	return dir === "b-a" ? ["from"] : ["to"];
}

/** How much stroke comes off each end for the head sitting on it, in flat units. See `headReach`:
 * it is the triangle's own length at the size this board is drawing heads at, less a pixel so the
 * two overlap. */
function headStrokeTrim(dir, { boardWidthPx, total, headPx = RELMAP_HEAD_PX }) {
	const ends = headEnds(dir);
	if (!ends.length || !(boardWidthPx > 0)) return { from: 0, to: 0 };
	const back = (100 * Math.max(0, headReach(headPx).body - HEAD_STROKE_OVERLAP_PX)) / boardWidthPx;
	const cut = Math.min(back, total * HEAD_STROKE_MAX_SHARE);
	return { from: ends.includes("from") ? cut : 0, to: ends.includes("to") ? cut : 0 };
}

/** The stretch of one curve between two parameters, as its own `M ... Q` run. Cut in the
 * PERCENTAGES the curve is stored in, which `subQuad` is exactly as true of as of flat space. */
function subPath(curve, a, b) {
	const { q0, q1, q2 } = subQuad(curve.from, curve.control, curve.to, a, b);
	const pt = p => `${round(p.left)},${round(p.top)}`;
	return `M ${pt(q0)} Q ${pt(q1)} ${pt(q2)}`;
}

/**
 * THE LINE AS IT IS PAINTED: a length taken out of the middle for its caption to sit in, and short
 * of either end that wears an arrowhead.
 *
 * ⚠ NOT WHAT A CLICK LANDS ON. The invisible target keeps `curve.d`, the whole run end to end: it
 * is not drawn, so it has no caption to make room for and no head to stop under, and giving it
 * either would put a dead patch in the middle of the stretch a reader aims at and another one where
 * the arrow is.
 *
 * @param {object} curve  from `edgeCurve`.
 * @param {object} spec
 * @param {number} spec.t     where along the curve the caption sits, from `edgeLabelAnchor`.
 * @param {number} spec.span  how long the caption is, in flat units, along the line. Zero for a
 *        line with nothing written on it, which still wants its ends cut back.
 * @param {number} spec.boardWidthPx  what the air either side of the words, and the room for the
 *        arrowheads, are measured against.
 * @param {string} spec.dir  which way this link is read, as `edgeArrowheads` takes it. That is what
 *        says which ends have a head over them to stop under.
 * @param {number} spec.headPx  how big those heads are drawn, which is how far back the stroke has
 *        to stop. `RELMAP_HEAD_PX` unless this reader has asked for heavier ones; see
 *        relmap/relmap-weights.js.
 * @returns {string}  a `d` of one run or two. Unbroken whenever breaking it would leave less line
 *          than caption.
 */
export function curveWithGap(curve, {
	t, span = 0, boardWidthPx = RELMAP_BOARD_WIDTH, aspect = RELMAP_BOARD_ASPECT, dir = "none",
	headPx = RELMAP_HEAD_PX,
} = {}) {
	if (!curve) return "";
	const along = alongT(t);
	const wide = Number(span);
	if (!(curve.length > 0)) return curve.d;
	const ratio = ratioOf(aspect);
	// MEASURED ALONG THE CURVE, not across its chord. The words are written on the curve itself
	// so the hole cut for them has to be the same length of the same line: a gap
	// worked out from the straight run between the two ends is short by however far the bow has
	// travelled, and leaves a stub of stroke inside the caption at each end. The same is true of
	// the room left for a head, which is a fixed length of line and not a fixed share of it.
	const arc = arcOf(curve, ratio);
	if (!(arc.total > 0)) return curve.d;
	const trim = headStrokeTrim(dir, { boardWidthPx, total: arc.total, headPx });
	const head = trim.from;
	const tail = arc.total - trim.to;
	// The whole painted run, or a stretch of it, as its own `M ... Q`. A line with no head at
	// either end and nothing written on it comes back as the curve's own `d` untouched, which is
	// the ordinary case and the one worth not re-emitting.
	const run = (from, to) => subPath(curve, arc.tAt(from), arc.tAt(to));
	const unbroken = () => (trim.from || trim.to ? run(head, tail) : curve.d);
	if (!(wide > 0)) return unbroken();
	const air = boardWidthPx > 0 ? (100 * GAP_AIR_PX) / boardWidthPx : 0;
	const half = (wide + air) / 2;
	const middle = arc.at(along);
	// The stub either side of the gap is measured against what is actually drawn, so a caption on a
	// short arrow-headed line is judged against the stroke it would break rather than the run the
	// heads have already taken most of.
	if (middle - half < head + GAP_MIN_STUB * arc.total) return unbroken();
	if (middle + half > tail - GAP_MIN_STUB * arc.total) return unbroken();
	return `${run(head, middle - half)} ${run(middle + half, tail)}`;
}

// -- Measuring along a curve -----------------------------------------------------------------
//
// ⚠ THIS SECTION USED TO DESCRIBE A DESIGN THAT WAS TRIED, MEASURED AND ABANDONED, and it described
// it as the only possible one -- "SO THE CAPTION IS WRITTEN ON THE CURVE ITSELF, as SVG text on a
// path. There is no other mechanism." A reader who believed that would rebuild the single worst
// performance defect this feature has had, so what actually happened is recorded here instead.
//
// A caption WAS written as SVG text on a path, on its own unstretched rail cut from the same
// quadratic as the stroke, so that the words bent along the line. It looked lovely and it was
// unaffordable: warping type gives every glyph its own transform, so the browser's glyph cache
// misses on all of them, and with the halo stroked around each warped outline as well ONE TILE of
// this board cost 73ms to raster. Panning was a slideshow and the whole application went with it,
// because Foundry's canvas shares that thread. The same words set STRAIGHT, turned once to the
// angle of their line where they sit, with the same halo: 1.2ms. Sixty times less.
//
// So the board draws a caption as one straight `<text>` in a viewBox that is NOT stretched (the
// stroke layer is `preserveAspectRatio="none"`, which shears glyphs), rotated about its own anchor
// -- the way an arrowhead is placed. Most lines are near enough straight across the stretch one
// caption covers that the two are hard to tell apart; a strongly bowed line carries its caption as
// a chord. See the board partial, which says the same thing from the markup's side.
//
// WHAT SURVIVED, and what the rest of this section is for: the caption still sits IN its stroke,
// in a hole cut for exactly the width of the words (`curveWithGap`), and cutting that hole means
// measuring LENGTH along a quadratic -- which its parameter is not. That is what the arc table
// below is. Nothing here bends any type.

/** How finely the arc-length table below is sampled. A quadratic's parameter is not its length --
 * a caption placed at `t = 0.5` sits at the middle of the PARAMETER, which on a bowed curve is not
 * the middle of the line -- and every measurement a caption needs is a length. Sixty-four pieces
 * hold a bow this shallow to a small fraction of a pixel. */
const ARC_SAMPLES = 64;

/**
 * Where the length along a curve and its parameter meet, both ways round, in flat units.
 *
 * Sampled rather than solved. The arc length of a quadratic has a closed form, and it is a page of
 * logarithms that degenerates exactly where these curves usually live -- a bow of nothing at all,
 * which is to say a straight line. The table is four lines, is exact in that case, and is read
 * from far more often than it is built.
 */
function arcTable(a, b, c) {
	const ts = [0];
	const ss = [0];
	let prev = at(a, b, c, 0);
	let run = 0;
	for (let i = 1; i <= ARC_SAMPLES; i++) {
		const t = i / ARC_SAMPLES;
		const point = at(a, b, c, t);
		run += dist(point, prev);
		prev = point;
		ts.push(t);
		ss.push(run);
	}
	/** Between the two samples either side of a reading, which is where the table's answer is. */
	const between = (from, to, i, x) => {
		const span = from[i] - from[i - 1];
		const share = span > 0 ? (x - from[i - 1]) / span : 0;
		return to[i - 1] + share * (to[i] - to[i - 1]);
	};

	// ⚠ NEITHER DIRECTION WALKS THE TABLE, which it used to do -- up to sixty-five comparisons per
	// reading. This is the innermost operation of the whole caption arrangement: seating one caption
	// asks it once per candidate stop, and a repaint seats every caption on the board.
	return {
		total: run,
		/**
		 * How far along the curve, in flat units, the parameter `t` is.
		 *
		 * Straight to the sample, because `ts` is EVENLY spaced by construction: the index either
		 * side of a parameter is arithmetic, not a search. The step is a power of two, so a
		 * parameter that is itself a sample lands exactly on it rather than a hair below.
		 */
		at: (t) => {
			if (!(t > 0)) return ss[0];
			if (t >= 1) return ss[ARC_SAMPLES];
			return between(ts, ss, Math.max(1, Math.ceil(t * ARC_SAMPLES)), t);
		},
		/**
		 * Which parameter is `s` flat units along it.
		 *
		 * Halved rather than walked: `ss` is sorted but NOT evenly spaced -- that unevenness is the
		 * whole point of the table, since equal steps of parameter are unequal steps of length on a
		 * bowed line -- so the index has to be looked for, in six comparisons rather than sixty-five.
		 */
		tAt: (s) => {
			if (!(s > ss[0])) return ts[0];
			if (s > ss[ARC_SAMPLES]) return ts[ARC_SAMPLES];
			let lo = 1;
			let hi = ARC_SAMPLES;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (ss[mid] < s) lo = mid + 1;
				else hi = mid;
			}
			return between(ss, ts, lo, s);
		},
	};
}

/**
 * That table for one curve, built at most once and kept ON the curve.
 *
 * KEPT ON THE CURVE because `curveWithGap` walks it on every repaint, and on every pointer frame
 * of a live drag. `edgeCurve` builds each curve once and nothing mutates it afterwards, so the
 * table is as good as the curve is.
 *
 * NON-ENUMERABLE ON PURPOSE: a curve is spread into template context and compared whole in tests,
 * and a cache is not part of what a curve IS. The aspect is kept beside it because it is the one
 * thing that could make the table wrong for the same curve.
 */
function arcOf(curve, ratio) {
	if (curve._arc && curve._arc.ratio === ratio) return curve._arc.table;
	const table = arcTable(flat(curve.from, ratio), flat(curve.control, ratio), flat(curve.to, ratio));
	Object.defineProperty(curve, "_arc", { value: { ratio, table }, writable: true, configurable: true });
	return table;
}

/**
 * The arrowheads a link wears, given which way it is meant to be read.
 *
 * `dir` is one of `a-b`, `b-a`, `both` or `none`, where a and b are the curve's own `from` and
 * `to`. "None" is the ordinary case and the default: most ties between people are mutual, and a
 * board of arrows all pointing at each other says less than a board with none.
 *
 * Each head lands its TIP on the end of the line, which `edgeCurve` has already cut back to the
 * rim, so the point of the triangle touches the face it arrives at. The anchor is the head's
 * CENTRE — that is what the stylesheet positions it by — so it is stepped back by the tip's own
 * reach and no further; see `RELMAP_HEAD_PX` above for why that reach is a pixel measure, and
 * `headPx` for why it is not always the same pixel measure.
 *
 * Each takes the curve's slope where it actually sits rather than the angle between the two
 * portraits, because the line is bowed and by the time it arrives it is already turning.
 *
 * `boardWidthPx` is the sheet the head will be painted on, from `boardMetrics`.
 */
export function edgeArrowheads(
	curve, aspect = RELMAP_BOARD_ASPECT, dir = "none",
	{ boardWidthPx = RELMAP_BOARD_WIDTH, headPx = RELMAP_HEAD_PX } = {},
) {
	const ends = headEnds(dir);
	if (!curve || !ends.length) return [];
	const ratio = ratioOf(aspect);
	const a = flat(curve.from, ratio);
	const b = flat(curve.control, ratio);
	const c = flat(curve.to, ratio);
	const len = curve.length;
	if (!(len > 0)) return [];
	const reach = boardWidthPx > 0 ? (100 * headReach(headPx).tip) / boardWidthPx : 0;
	const backoff = Math.min(reach, len * HEAD_BACKOFF_SHARE) / len;

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

/** How far out the outermost ring sits, measured on BOTH axes so a tall board or a large portrait
 * pulls the ring in rather than pushing half of it off the top edge.
 *
 * MODULE-PRIVATE, though it was not always: the cluster layout parked the people with no lines on
 * this same rim, and was exported to so there could be no second opinion about where the rim is.
 * That module is gone and `ringsLayout` and `freeSpot` below are the only askers left. */
function ringRadius(ratio, r, pad) {
	const across = 50 - r - pad;
	const down = 50 / ratio - r - pad;
	return Math.max(8, Math.min(across, down));
}

/** How many portraits fit round a ring of radius `R` without touching, at least one.
 *
 * Module-private for the same reason `ringRadius` is, and it still matters INSIDE this file: a
 * second opinion about how many fit on a circle is how one seating comes to overlap faces another
 * would have spread. */
function ringCapacity(radius, clear) {
	return Math.max(1, Math.floor((2 * Math.PI * radius) / Math.max(0.001, clear)));
}

/**
 * The seats on ONE ring, as board percentages.
 *
 * ⚠ THE FLAT-SPACE-TO-PERCENTAGE CONVERSION, IN ONE PLACE. The ring is walked in flat space, where
 * a circle is a circle, and squashed back by `ratio` on the way out so it does not come out as an
 * oval on a landscape board. Every coordinate on this feature's boards has to agree about that, and
 * this expression was written three times over: here, in `ringsLayout` below, and once more in a
 * module that has since gone. `ringRadius` and `ringCapacity` are kept as the single answer to
 * where a rim is and how many fit on it; this is the remaining third of that set, and it was the
 * one still being copied.
 *
 * The callers keep their own policies -- how many rings, how big, and how many people go on
 * each -- because that is where they genuinely differ.
 *
 * @param {number} radius  in flat-space percent from the middle.
 * @param {number} count   how many to space evenly round it.
 * @param {object} opts
 * @param {number} opts.ratio  the board's aspect ratio, from `ratioOf`.
 * @param {number} [opts.turn] radians to rotate this ring by, so consecutive rings interleave
 *        rather than lining up into spokes with corridors of empty board between them.
 */
function ringSeats(radius, count, { ratio, turn = 0 } = {}) {
	// Starts at twelve o'clock and goes clockwise, because that is the order a reader's eye takes a
	// ring in and it makes the seating plan predictable: the first person added is always at the top.
	return Array.from({ length: Math.max(0, count) }, (_, k) => {
		const angle = -Math.PI / 2 + turn + (k * 2 * Math.PI) / count;
		return {
			left: clampPct(50 + radius * Math.cos(angle)),
			top: clampPct(50 + radius * ratio * Math.sin(angle)),
		};
	});
}

/** The most rings worth trying. Past this the board is so crowded that another ring buys nothing. */
const MAX_RINGS = 8;

/**
 * Where `count` portraits go when nobody has placed them: across CONCENTRIC rings, sized to fit.
 *
 * ONE RING WOULD DO FOR A HANDFUL, and is exactly the look of a relationship poster. A steading's
 * whole cast is not a handful: twenty-odd people on one ring are spaced closer than their own
 * portraits are wide, and they overlap into an unreadable band. So this lays as many rings as the
 * count needs — and a small cast still comes out as that single wide ring, because the outermost is
 * laid FIRST and the good-looking case is not sacrificed to the large one.
 *
 * An ELLIPSE in percentages, which is a circle to the eye — each ring is laid out in flat space and
 * converted back on the way out, so it does not come out as an oval on a landscape board. The
 * outermost radius shrinks to whatever the board can hold, measured on BOTH axes, so a tall board
 * or a large portrait pulls the rings in rather than pushing half of them off the top edge.
 *
 * Each ring starts at twelve o'clock and goes clockwise, because that is the order a reader's eye
 * takes a ring in, and is turned half a step against the one outside it so the seats do not line up
 * into spokes with corridors of empty board between them.
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
		out.push(...ringSeats(radius, here, { ratio, turn }));
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

// ── Bowing a line clear of somebody it has nothing to do with ────────────────────────
//
// THE PROBLEM THIS SOLVES IS A LIE, not an untidiness. A line that runs underneath a portrait it
// is not attached to reads, to anybody glancing at the board, as a line attached to that portrait:
// the reader sees a stroke going into a face and out the other side and believes it. Nothing else
// on the board is wrong in that way. A crossing is obviously a crossing; a line through a face is
// a relationship that does not exist.
//
// It is also, as it happens, exactly what makes an ordered ring readable. Two people seated three
// apart have the two between them sitting just outside the straight line between them, so clearing
// those two bends the link gently inward: short hops become shallow arcs near the rim, long ones
// pass through the empty middle and stay straight. That is the look of a good chord diagram, and
// it falls out of one rule about faces rather than a second rule about rings.

/** How much daylight to leave between a line and a face it is passing, in flat units, on top of
 * the portrait's own radius. Roughly the stroke's own width plus a little. */
const CLEAR_GAP = 1.2;

/** How far along a link a portrait has to be before it is worth dodging. A face sitting almost on
 * top of one of the link's own ends cannot be dodged (the curve is anchored there and trimmed to
 * the rim), and trying makes the bow explode: the deflection available at the ends is nil, so the
 * arithmetic asks for an unbounded bow to buy it. */
const CLEAR_MARGIN = 0.15;

/** The bows worth considering, in the units `fanBow` speaks. Both signs, because a face can be on
 * either hand, and both are tried at every size so the answer is the SMALLEST bend that works
 * rather than the first one found. Nothing beyond three: a link bent further than that has stopped
 * looking like a line between two people. */
const CLEAR_STEPS = Object.freeze([0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3]);

/**
 * How much EXTRA bow a link needs so it does not run under anybody else's face.
 *
 * Added to whatever `fanBow` gave it, and returned separately rather than folded in because the
 * two answer different questions: the fan keeps a link off its own twin, and this keeps it off
 * third parties, and a caller reading the code has to be able to see both.
 *
 * SEARCHED, NOT SOLVED. The exact answer is a quartic per blocking face with the sign of the
 * deflection flipping in the middle of it, and getting that algebra subtly wrong would show up as
 * a line that dodges the wrong way, once, on somebody's board. Thirteen candidate bows scored
 * against every face in the way is a handful of arithmetic per link, is obviously right by
 * construction, and can be read.
 *
 * WHEN NOTHING CLEARS, the least bad bow wins rather than none. A face wedged between two people
 * who are barely apart cannot be dodged, and the honest response to that is the bend that hides
 * the least of it.
 *
 * @param {object} spec
 * @param {{left, top}} spec.from   one end's CENTRE, in percentages.
 * @param {{left, top}} spec.to     the other end's centre.
 * @param {{left, top}[]} spec.avoid  every OTHER portrait's centre. The link's own two ends may be
 *                                  in the list; they are recognised by position and ignored.
 * @param {number} spec.bow         the bow the link already has, from `fanBow`.
 * @returns {number}  the bow to ADD. Zero when the way is clear, which is the common case.
 */
export function clearanceBow({
	from, to, avoid = [], bow = 0, aspect = RELMAP_BOARD_ASPECT, r = nodeRadiusPct(),
} = {}) {
	if (!from || !to || !avoid.length) return 0;
	const ratio = ratioOf(aspect);
	const p0 = flat(from, ratio);
	const p2 = flat(to, ratio);
	const dx = p2.left - p0.left;
	const dy = p2.top - p0.top;
	const len = Math.hypot(dx, dy);
	if (!len) return 0;

	// How far one unit of bow actually carries the curve sideways. `edgeCurve` sets its control
	// point twice as far out as the depth it wants, because a quadratic only travels half way to
	// its control; this is that same number, undoubled, and the two must not drift apart.
	const depthPer = Math.min(len * RELMAP_BOW_SHARE, RELMAP_BOW_MAX);
	if (!(depthPer > 0)) return 0;

	// Each face in the way, as how far ALONG the link it sits and how far to one side. The sign of
	// the side is what says which way to bend, and it is measured along the SAME normal that a
	// positive bow pushes the curve down, `(dy, -dx)` in `edgeCurve`. Measured along the other
	// normal, every dodge would be a swerve INTO the face it was avoiding.
	const ux = dx / len;
	const uy = dy / len;
	const need = r + CLEAR_GAP;
	const swing = depthPer * (Math.abs(Number(bow) || 0) + 3);
	const blockers = [];
	for (const spot of avoid) {
		if (!spot) continue;
		// `flat` inlined, and deliberately: this runs for every face on the board, for every one of
		// the dragged person's links, on every painted frame of a drag. The flattened point never
		// leaves these four lines, so allocating an object to hold it is the whole cost of it.
		const fx = spot.left - p0.left;
		const fy = spot.top / ratio - p0.top;
		const alongPct = (fx * ux + fy * uy) / len;
		if (alongPct <= CLEAR_MARGIN || alongPct >= 1 - CLEAR_MARGIN) continue;
		const side = fx * uy - fy * ux;
		// Out of reach of the curve however far it is bent, so it cannot be hit and cannot be
		// swerved into either.
		if (Math.abs(side) >= need + swing) continue;
		blockers.push({ along: alongPct, side });
	}
	if (!blockers.length) return 0;

	let best = 0;
	let bestHarm = Infinity;
	for (const step of CLEAR_STEPS) {
		const depth = (Number(bow) + step) * depthPer;
		let harm = 0;
		for (const blocker of blockers) {
			// A quadratic's sideways travel at `u`, as a share of its deepest point.
			const reach = 4 * blocker.along * (1 - blocker.along) * depth;
			harm += Math.max(0, need - Math.abs(reach - blocker.side));
		}
		// Strictly less, so a tie goes to the earlier and therefore gentler step.
		if (harm < bestHarm - 1e-9) {
			bestHarm = harm;
			best = step;
			if (!harm) break;
		}
	}
	return best;
}

/**
 * The bow a link is finally drawn with: its dodge, and its place in its pair's fan on top.
 *
 * THE FAN SPREADS IN THE DODGE'S OWN DIRECTION, which is the whole reason this is a function
 * rather than an addition written at the call site. `fanBow` alternates sides so that a fan spreads
 * both ways off a straight route, and that is right for a straight route and wrong for a dodged
 * one: the member that alternates back would be spread straight into the face the dodge was
 * avoiding. Once a route has been bent aside, every later link between the same two people is bent
 * FURTHER aside, so each of them is at least as clear as the first.
 *
 * And a fan is still a fan. Adding the dodge to the fan naively, which is what this replaced, let
 * the two cancel: two links between one pair that both had to clear the same face were handed the
 * same total and drawn exactly on top of each other, which is the one thing the fan exists to
 * prevent.
 *
 * `clearance` is `clearanceBow` measured on the pair's UNFANNED route, so every link in a fan gets
 * the same dodge and they part company by their fan index alone.
 */
export function edgeBow(fanIndex, clearance = 0) {
	const dodge = Number(clearance) || 0;
	// Nothing in the way: the ordinary alternating fan, spreading both ways off a straight route.
	if (!dodge) return fanBow(fanIndex);
	// Bent aside: the fan spreads ONE WAY, further out with each link. Alternating here would put
	// every second link back on the near side of the dodge, which is where the face is. A crowded
	// pair that also has to dodge somebody therefore reaches a little further off its own line
	// than it otherwise would, which is the right trade: a wide arc can be read and an overlap
	// cannot.
	const step = Math.max(0, Math.trunc(Number(fanIndex) || 0));
	return dodge + step * (dodge < 0 ? -1 : 1);
}

// ── Keeping the captions off one another ─────────────────────────────────────────────
//
// WHY THE LABELS ARE THE WORST OF IT, worse than the lines. A crossing costs the reader a moment;
// a heap of chips of prose stacked on one another costs them all of them, because the ones
// underneath cannot be read at all and the ones on top cannot be told apart from the ones
// underneath. On a ring in insertion order every line was a chord and every chord's midpoint was
// the middle of the board, so every caption on the board landed in one pile.
//
// THE CHIP SLIDES ALONG ITS OWN LINE AND NOWHERE ELSE. Pushing a caption sideways into free space
// is the obvious fix and it is the wrong one: the whole meaning of a caption on this board is
// which stroke it is sitting on, and a chip floating beside three lines belongs to none of them.
// Sliding keeps that meaning intact at every position it can take.
//
// THE SIZE IS ESTIMATED, and that is a real limitation written down rather than hidden. The chip
// is HTML in a proportional font, so its true width is not knowable without measuring it in a
// laid-out document, and this module is arithmetic that also runs under a test with no document at
// all. The estimate errs LARGE, which is the safe direction: a slightly-too-big chip claims a
// little more room than it needs and the board spreads a little further than it had to.

/** The caption, in board pixels: what one character costs at `RELMAP_CAPTION_PX`, what the halo
 * and its padding cost around the words, and how tall a line of them is. These mirror the
 * stylesheet and are the reason the comment above says the estimate is an estimate. Smaller than
 * they were: the caption used to be a chip of paper with a border and a colour stripe, and is now
 * bare words with a halo of the page tone behind them.
 *
 * ⚠ THE TWO THAT ARE TYPE MOVE WITH THE BASE SIZE AND THE ONE THAT IS NOT DOES NOT. A
 * character and a line's height are measured AT the base -- they were 6.3 and 20 while the base
 * was twelve, and are these while it is sixteen -- but the halo is a 3px stroke around the words
 * whatever they are set in, so `LABEL_CHROME_PX` stayed where it was. See `sizeScale`, which is
 * what carries the two of them to a line set in a size of its own. */
const LABEL_CHAR_PX = 8.4;
const LABEL_CHROME_PX = 10;
const LABEL_HEIGHT_PX = 26.7;

/**
 * The size a caption is set in when nobody has said otherwise, in board pixels.
 *
 * ⚠ THE STYLESHEET IS WHERE THIS IS ACTUALLY PAINTED (`.stonetop-relmap-label-text`), and this is
 * the same number written where the arithmetic can see it. It has to be a constant here as well
 * as a declaration there because the three numbers above are measured AT it: a character costs
 * 8.4 pixels at sixteen-pixel type, and a caption set in twenty-four costs half as much again. So
 * a line with a size of its own is estimated by scaling from this, and the pair has to be kept in
 * step -- a test holds them together, because nothing else would notice them drifting apart.
 *
 * ⚠ AND IT IS THE FALLBACK EVERYWHERE, NOT A DEFAULT WRITTEN ONTO LINES. Nearly every line on
 * every board has no size of its own and never will: that is the state the whole feature was
 * drawn in before a reader could ask for a bigger caption, and it stays the honest way to say
 * "whatever the sheet sets". See `readSize` in relmap/relmap-store.js.
 */
export const RELMAP_CAPTION_PX = 16;

/**
 * The smallest type worth drawing a caption in, in painted pixels.
 *
 * A LEGIBILITY FLOOR FIRST -- eight pixels of type is not writing, it is texture -- and the board's
 * performance rule second, because the two turn out to be the same line: below it the window stops
 * drawing captions at all and heals every stroke. Generous rather than tight: there is a reader at
 * this table on a screen magnifier.
 *
 * ⚠ IT IS ALSO THE FLOOR ON A SIZE A READER MAY CHOOSE (`RELMAP_SIZE_MIN`), and that is not a
 * coincidence worth spelling twice: a size under the floor is one somebody could pick, store, and
 * then never see. Two literals coupled by prose is one of them raised for legibility and the other
 * quietly turning three steps of the chooser into ways to make a caption invisible.
 */
export const RELMAP_CAPTION_FLOOR_PX = 8;

/**
 * What one caption's own size costs it, against the size the metrics above were measured at.
 *
 * ⚠ `basePx` IS WHAT "NO SIZE OF ITS OWN" IS WORTH ON THIS BOARD, and it is the whole reason this
 * takes a second argument. A line with no size of its own used to be worth exactly 1, because the
 * only thing it could be set in was `RELMAP_CAPTION_PX` and the metrics above were measured at
 * precisely that. A reader can now ask a whole board for heavier writing (relmap/relmap-weights.js),
 * which moves the size EVERY plain caption is painted in without writing a number onto a single
 * line -- so the estimate has to be told what the plain size currently is, or it would go on
 * measuring a board of 24-pixel captions as though they were sixteen and cut every sentence a third
 * too long.
 *
 * It defaults to the base, so a caller that has no opinion is answered exactly as before.
 */
function sizeScale(px, basePx = RELMAP_CAPTION_PX) {
	const size = Number(px);
	const base = Number(basePx) > 0 ? Number(basePx) : RELMAP_CAPTION_PX;
	return (size > 0 ? size : base) / RELMAP_CAPTION_PX;
}

/**
 * The paper kept between the last letter of a caption and the portrait at that end of its line, in
 * board pixels.
 *
 * WHY THE WORDS MAY NOT SIMPLY RUN TO THE RIMS. A caption is set ALONG its line, so every pixel it
 * grows by is a pixel closer to one of the two faces the line is about, and a sentence that reaches
 * the rim reads as a label ON that portrait rather than as something said about the pair. Two
 * people standing close together got the worst of it: the whole sentence drawn across both their
 * faces, because the line between them was shorter than the words.
 *
 * ABOUT FOUR CHARACTERS OF CLEAR PAPER at the ordinary caption size, which is enough for the eye to
 * see where the writing stops and the face begins. In BOARD pixels like everything else here, so it
 * shrinks with the zoom as the words do rather than eating the whole of a line on a board somebody
 * has zoomed away from.
 */
export const RELMAP_LABEL_CLEAR_PX = 32;

/**
 * How much room ONE caption has on ONE line, in board pixels.
 *
 * THE LINE'S OWN LENGTH IS THE ROOM, LESS THE CLEARANCE AT EITHER END. What a caption is for is the
 * sentence on it, so a line long enough to carry the whole of one carries the whole of it, however
 * long that is; what no caption may do is run up against the faces at its two ends. The clearance
 * comes off TWICE because the words are centred on their seat, so every pixel of width costs half a
 * pixel at each end.
 *
 * ⚠ AND IT IS A CEILING WITH NOTHING UNDER IT, which it did not used to be. There were two floors
 * here, a width promised per board (the crowding cap) and an absolute minimum, and both were there
 * to let a caption on a SHORT line overhang its stroke rather than be cut to a smudge. Overhanging
 * ALONG a line is overhanging into the portraits at its ends, so what the floors really bought was
 * the failure above: the ellipsis arrived far too late, and by the time it did the words were on
 * somebody's face. A line with little room now says little, and one with none says only its
 * ellipsis. The whole sentence is in the tooltip and in the tie bar either way, which is where a
 * reader who wants all of it was always going to read it.
 *
 * ONE FUNCTION because three things have to agree about it to the pixel: the spreader that slides
 * the captions apart, the stylesheet that paints them, and the gap cut in the line for the words
 * to sit in. A gap measured off a different width is a gap with a stub of stroke left inside it.
 */
export function captionRoomPx(curve, { boardWidthPx = RELMAP_BOARD_WIDTH } = {}) {
	const own = ((curve?.length ?? 0) * boardWidthPx) / 100;
	return Math.max(0, own - 2 * RELMAP_LABEL_CLEAR_PX);
}

/** How big ONE caption is on ONE line, in flat units: its words, measured, inside the room
 * `captionRoomPx` says it has.
 *
 * `paintedPx` is that caption's REAL width, read off the laid-out element by whoever has a
 * document to read it from. See `labelSize` for why it is worth the trouble of passing.
 *
 * ⚠ `px` IS THE SIZE THIS ONE CAPTION IS SET IN, and it is NOT the room. The room is the line's
 * own length and does not move when the type gets bigger; what moves is how much of the sentence
 * fits inside it, and how tall the chip is that everything else has to be kept off. A board where
 * one line is set in eighteen and the rest in twelve is the ordinary case, so this is per caption
 * rather than per board. */
export function captionSize(
	text, curve,
	{ boardWidthPx = RELMAP_BOARD_WIDTH, paintedPx = null, px = 0, basePx = RELMAP_CAPTION_PX } = {},
) {
	return labelSize(
		text, boardWidthPx, captionRoomPx(curve, { boardWidthPx }), paintedPx, px, basePx,
	);
}

/**
 * THE WIDTH A CAPTION WAS ONCE PROMISED, AND IS NOT ANY MORE. There were three numbers here, a
 * width a caption could always claim (220 pixels, stepping down to 140 as the cast grew) and an
 * absolute floor of 58 under them, and what they bought was the right to OVERHANG a line too short
 * to hold the words. On this board overhanging along a line means overhanging into the two faces
 * at its ends, which is the failure `RELMAP_LABEL_CLEAR_PX` exists to have fixed, so the room a
 * caption gets is now its own line's and nothing else's.
 *
 * The board still narrows what it shows as it fills up. It does it by drawing more people on a
 * BIGGER sheet (`boardMetrics`) rather than by promising each caption less of a fixed one.
 */

/** How far along its line a chip may slide, either way from the middle, and in how many stops.
 * Not to the very ends: a caption sitting on a portrait's rim reads as belonging to the portrait
 * rather than to the line. */
const LABEL_SLIDE = 0.42;
const LABEL_STOPS = 14;

/**
 * How big one caption is, in flat units.
 *
 * `paintedPx` IS THE MEASUREMENT WINNING OVER THE ESTIMATE, and it is the whole reason this takes
 * a fourth argument. Counting characters cannot tell an `i` from an `m`, and on this font at this
 * size the count above overshoots by about a fifth: a sentence of a hundred and fourteen
 * characters estimates at 728 pixels and paints at 585. For the spreader that error is slack and
 * the comment above calls it safe, which it is. For the GAP CUT IN THE STROKE it is not slack at
 * all: it is 143 pixels of line rubbed out for words that were never there, seventy at each end,
 * which is exactly what a reader sees as a caption floating in a hole too big for it.
 *
 * So the one caller that can measure -- the window, which has the caption laid out in a document
 * and can simply ask it how wide it came out -- passes what it read, and the arithmetic here is
 * the fallback for the callers that cannot: the spreader on a first paint, and this module's
 * tests, which run with no document at all.
 *
 * Exported for the tests, which have to be able to say what "these two overlap" meant.
 */
export function labelSize(
	text, boardWidthPx = RELMAP_BOARD_WIDTH, roomPx = Infinity, paintedPx = null, px = 0,
	basePx = RELMAP_CAPTION_PX,
) {
	const chars = typeof text === "string" ? text.length : 0;
	// ⚠ NO ROOM IS NO WIDTH, and that is the one reading of this argument that has to be spelt
	// out. `captionRoomPx` answers zero for a line with two portraits nearly touching at its ends,
	// and a zero read as "unmeasured, take the default" would put the whole sentence back across
	// both their faces -- which is the bug this pair of functions was rewritten to fix. Only a
	// number that is not one at all (a missing argument, NaN) means unbounded.
	const said = Number(roomPx);
	const room = Number.isFinite(said) ? Math.max(0, said) : Infinity;
	const painted = Number(paintedPx);
	// ⚠ THE ESTIMATE SCALES WITH THE TYPE AND THE MEASUREMENT DOES NOT. `paintedPx` was read off a
	// caption that had already been SET in its own size, so it is the answer for that size and
	// scaling it again would double the whole difference. The character count was measured at
	// `RELMAP_CAPTION_PX` (see `LABEL_CHAR_PX`), so it has to be moved.
	//
	// The trim is left where it is: the halo is the same ring at any size, and it is ten pixels of
	// slack on a number the comment above already calls an estimate.
	const asked = painted > 0
		? painted
		: chars * LABEL_CHAR_PX * sizeScale(px, basePx) + LABEL_CHROME_PX;
	const wide = Math.min(room, asked);
	const scale = boardWidthPx > 0 ? 100 / boardWidthPx : 0;
	// THE HEIGHT ALWAYS SCALES, measured or not. Nothing measures a caption's HEIGHT -- the window
	// reads a width off the laid-out element and nothing else -- so this is the one number that is
	// arithmetic in every caller, and a line of eighteen-pixel type is half again as tall as a line
	// of twelve. Left flat, the spreader would slide a big caption clear sideways and leave it
	// sitting on the one above.
	return { w: wide * scale, h: LABEL_HEIGHT_PX * sizeScale(px, basePx) * scale };
}

/** One turned chip as the four numbers a separating-axis test needs: its centre, the two
 * directions its own edges run in, and how far it reaches along each. */
function labelBox(centre, w, h, angleDeg) {
	const rad = (Number(angleDeg) || 0) * Math.PI / 180;
	return {
		cx: centre.left, cy: centre.top,
		ax: Math.cos(rad), ay: Math.sin(rad),
		hw: w / 2, hh: h / 2,
	};
}

/** Do two turned chips overlap? The separating-axis test, on the four axes two rectangles have
 * between them: if the two boxes' shadows are apart on ANY of them, the boxes are apart. */
function boxesOverlap(a, b) {
	const dx = b.cx - a.cx;
	const dy = b.cy - a.cy;
	const axes = [
		[a.ax, a.ay], [-a.ay, a.ax],
		[b.ax, b.ay], [-b.ay, b.ax],
	];
	for (const [nx, ny] of axes) {
		const gap = Math.abs(dx * nx + dy * ny);
		const spreadA = a.hw * Math.abs(a.ax * nx + a.ay * ny) + a.hh * Math.abs(-a.ay * nx + a.ax * ny);
		const spreadB = b.hw * Math.abs(b.ax * nx + b.ay * ny) + b.hh * Math.abs(-b.ay * nx + b.ax * ny);
		if (gap > spreadA + spreadB) return false;
	}
	return true;
}

/** Is a turned chip sitting on a portrait? Measured in the chip's own frame, where the box is
 * square to the axes and the nearest point to a circle's centre is one clamp away. */
function boxHitsCircle(box, centre, radius) {
	const dx = centre.left - box.cx;
	const dy = centre.top - box.cy;
	const localX = dx * box.ax + dy * box.ay;
	const localY = -dx * box.ay + dy * box.ax;
	const nearX = Math.min(box.hw, Math.max(-box.hw, localX));
	const nearY = Math.min(box.hh, Math.max(-box.hh, localY));
	return Math.hypot(localX - nearX, localY - nearY) < radius;
}

/** The stops a chip tries, nearest the middle of its line first, alternating either side so a
 * caption never drifts consistently toward one end. */
function slideStops() {
	const out = [0.5];
	for (let i = 1; i <= LABEL_STOPS; i++) {
		const off = (LABEL_SLIDE * i) / LABEL_STOPS;
		out.push(0.5 + off, 0.5 - off);
	}
	return out;
}

/**
 * Place every caption on the board so that as few as possible sit on one another.
 *
 * Greedy and first-fit: the captions are placed one at a time, each taking the stop nearest the
 * middle of its own line that is clear of everything already down, and the hardest ones go first.
 *
 * LONGEST FIRST, ties by id. A long chip has the fewest places it can fit, so it has to choose
 * while there is still room; leaving it until last means it is the one that ends up overlapping.
 * The id tie-break is what makes the whole thing reproducible: two clients painting the same board
 * must place the captions identically or the map looks different to different people at the table.
 *
 * A caption with NOWHERE clear keeps the middle of its line. Sliding it to a stop that is merely
 * less bad would move it away from where its line is without buying legibility.
 *
 * ⚠ AND A CAPTION THE READER HAS SEATED BY HAND IS NOT PLACED AT ALL — it is put down first, where
 * they put it, and everything else is spread around it. A reader who drags words along a stroke has
 * answered this question for that line, and a spreader that then slid them somewhere it liked
 * better would be undoing the gesture in front of them, at the moment of the very next repaint.
 *
 * THEY GO DOWN BEFORE THE QUEUE, not merely ahead of it, and that is what makes the rest of the
 * board give way to them: a seated caption takes its room in the pile like anything else, so the
 * captions that CAN move are the ones that move. Ordered by id, for the reason the queue is —
 * two clients painting the same board must place every caption identically.
 *
 * ⚠ AND A CAPTION SET BIGGER TAKES MORE ROOM IN THE PILE, which is why each entry carries its own
 * size rather than the board carrying one. A line the reader has set in eighteen is half again as
 * tall and its words half again as long, and a spreader that measured every chip at twelve would
 * slide the board's quiet captions apart perfectly and leave the one the table cares about sitting
 * across two of them.
 *
 * @param {object} spec
 * @param {{id: string, curve: object, text: string, px?: number, seat?: number}[]} spec.labels  one
 *        entry per captioned link. `px` is the size that caption is SET in, where it has one of its
 *        own; `seat` is where along its line the reader dragged it, where they have.
 * @param {{left, top}[]} spec.nodes  every portrait's centre, which a caption keeps clear of by
 *        `RELMAP_LABEL_CLEAR_PX` rather than merely not touching.
 * @returns {Map<string, {left, top, angle}>}  where each caption goes, by link id.
 */
export function spreadLabels({
	labels = [], nodes = [], aspect = RELMAP_BOARD_ASPECT, r = nodeRadiusPct(),
	boardWidthPx = RELMAP_BOARD_WIDTH, basePx = RELMAP_CAPTION_PX,
} = {}) {
	const out = new Map();
	if (!labels.length) return out;
	const ratio = ratioOf(aspect);
	const stops = slideStops();
	// Everything below compares distances, so it all happens in flat space.
	const faces = nodes.filter(Boolean).map(n => flat(n, ratio));
	// ⚠ THE FACES ARE TREATED AS BIGGER THAN THEY ARE, by the same clearance the room on a line is
	// measured with (`RELMAP_LABEL_CLEAR_PX`). That room keeps a caption off the two portraits its
	// OWN line joins, and it does the reckoning at the middle of the line; a caption slid along its
	// line to get out of another's way is off that middle, and one merely touching this stroke on
	// its way past somebody else's face was never covered by it at all. Asking every stop to clear
	// an inflated circle says the one rule once, for every face on the board: the words keep their
	// paper, wherever they end up sitting.
	const keepOff = r + (boardWidthPx > 0 ? (RELMAP_LABEL_CLEAR_PX * 100) / boardWidthPx : 0);

	const measured = labels
		.filter(entry => entry?.curve && entry.text)
		.map(entry => ({
			...entry,
			size: captionSize(entry.text, entry.curve, { boardWidthPx, px: entry.px, basePx }),
		}));
	const queue = measured
		.filter(entry => !(Number(entry.seat) > 0))
		.sort((a, b) => b.size.w - a.size.w || String(a.id).localeCompare(String(b.id)));

	const placed = [];
	// THE READER'S OWN SEATS FIRST, and they are not candidates for anything: each is placed where
	// it was dragged to and takes its room in the pile, so the captions still free to move are the
	// ones asked to give way.
	const seated = measured
		.filter(entry => Number(entry.seat) > 0)
		.sort((a, b) => String(a.id).localeCompare(String(b.id)));
	for (const entry of seated) {
		// Seated on its own width, like every stop below and like the paint: which straight run a
		// caption covers depends on how long the words are. See `edgeLabelAnchor`.
		const anchor = edgeLabelAnchor(entry.curve, aspect, entry.seat, entry.size.w);
		if (!anchor) continue;
		out.set(entry.id, anchor);
		const box = labelBox(flat(anchor, ratio), entry.size.w, entry.size.h, anchor.angle);
		placed.push({ box, reach: Math.hypot(box.hw, box.hh) });
	}
	for (const entry of queue) {
		// The first stop tried, which is the middle of this caption's own line: where it goes if
		// none of the stops turns out to be clear. Kept apart from "did we place it" so that each
		// says one thing -- one variable answering both read backwards in the tail below.
		let middle = null;
		let settled = false;
		for (const t of stops) {
			// ⚠ SEATED ON ITS OWN WIDTH, like the paint. A caption is a straight run laid over a
			// bowed line and where that run sits depends on how long it is (`edgeLabelAnchor`), so
			// a spreader that measured every stop from the tangent would be sliding boxes that are
			// not where the words end up -- clearing overlaps that were never there and leaving
			// ones it could not see.
			const anchor = edgeLabelAnchor(entry.curve, aspect, t, entry.size.w);
			if (!anchor) break;
			middle ??= anchor;
			const box = labelBox(flat(anchor, ratio), entry.size.w, entry.size.h, anchor.angle);
			const reach = Math.hypot(box.hw, box.hh);
			const clear = !faces.some(face => boxHitsCircle(box, face, keepOff))
				&& !placed.some(other => (
					Math.hypot(other.box.cx - box.cx, other.box.cy - box.cy) <= other.reach + reach
					&& boxesOverlap(other.box, box)
				));
			if (clear) {
				out.set(entry.id, anchor);
				placed.push({ box, reach });
				settled = true;
				break;
			}
		}
		if (settled || !middle) continue;
		// Nowhere clear. Back to the middle of its own line, and it takes its room in the pile
		// like everything else so the NEXT caption knows the spot is spoken for.
		out.set(entry.id, middle);
		const box = labelBox(flat(middle, ratio), entry.size.w, entry.size.h, middle.angle);
		placed.push({ box, reach: Math.hypot(box.hw, box.hh) });
	}
	return out;
}
