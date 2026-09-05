// The family tree: the same map, read as generations instead of as a web.
//
// WHY THIS IS A VIEW AND NOT A THIRD "TIDY UP" SHAPE, which is where it would naturally have gone
// (relmap-layout.js next door already lays a whole board out and writes the result). Tidy up MOVES
// PEOPLE: it writes everybody's coordinates into the shared document, and the arrangement the table
// has built up over a season is gone. A tree is not an arrangement of the board, it is a different
// question asked of the same data, and the answer is derived entirely from who is marked as whose
// parent. So nothing here is ever written. The seats are worked out on the reader's own machine,
// each time the board is painted, and the moment they switch back the board is exactly as they and
// everybody else left it. It is also why the portraits are not draggable while it is on: there is
// nowhere for a drag to be remembered, and a portrait that sprang back would read as a broken board
// rather than as a computed one.
//
// WHAT IT DRAWS, and why not the bowed lines the rest of the board uses. A descent is not a
// relationship between two people that happens to be drawn as a curve; it is a structure, and the
// structure is the information: a bar between two parents, one stem down from it, one rail across
// their children, and a short drop into each child's head. Four square corners say "these four are
// siblings and these two are their parents" at a glance, where eight separate curves say only that
// eight lines exist. Everything is drawn in the same 0-100 space as `relmap-geometry.js` works in,
// so it lands on the board's own stretched SVG with no second coordinate system to keep in step.
//
// THE SHEET IS SIZED FOR THE TREE, not for the cast. `boardMetrics` grows the board with how many
// people are on it, which is the right question for a web and the wrong one for a chart: six people
// in six generations want a tall sheet and four cousins in one row want a wide one, and neither is
// what "six people" asks for. The sheet here is the larger of what the generations and the widest
// row need, and the chart then grows to fill it up to a limit rather than being stretched onto it.
//
// DETERMINISTIC THROUGHOUT, for the reason relmap-layout.js gives: every walk is over a sorted
// copy and there is no `Math.random` anywhere, because two people looking at the same map have to
// be looking at the same tree.

import {
	RELMAP_BOARD_ASPECT, round, sheetFor,
} from "./relmap-geometry.js";
import { generationOf, households, kinTies } from "./relmap-kin.js";
import { componentsOf } from "./relmap-layout.js";

/** How much room one row and one column of the chart want, in board pixels at 1:1. A portrait is
 * `RELMAP_NODE_PX` across with its name under it, so these are that plus the daylight that keeps a
 * chart from reading as a wall of faces. The sheet grows until they are met. */
const ROW_PX = 190;
const COL_PX = 132;

/** How much wider than that a chart with room to spare is allowed to stand, before it stops
 * growing and simply sits in the middle of the sheet. A small family should use the sheet rather
 * than huddle in the centre of it, and should not be flung to its corners either. */
const SPREAD = 2;

/** How tall the name under a portrait is, in board pixels: the chip's line box plus its margin.
 * The descent lines leave from BELOW it, so a stem never runs behind somebody's name. Mirrors
 * `.stonetop-relmap-name` in the stylesheet and must move with it. */
const NAME_PX = 20;

/** The daylight kept outside the outermost portraits, in flat units (percent of the board's
 * width). Small: the chart has already claimed the sheet it needs. */
const EDGE_PAD = 1.5;

/** How many columns of clear air are left between two families who share nobody. Wide enough that
 * the eye reads two charts rather than one with a gap in it. */
const FAMILY_GAP = 1.6;

/** How many times the columns are pulled towards their parents and then towards their children.
 * It converges quickly (the separation sweep is what does most of the work), and the cost is a
 * handful of passes over a cast that is never large. */
const SLOT_PASSES = 8;

/** Below this, two columns are the same column. Only ever used to recognise the people a sweep has
 * left packed shoulder to shoulder, which is an exact arithmetic relation with floating point
 * noise on it rather than a judgement about how close is close. */
const EPSILON = 1e-9;

const mean = list => (list.length ? list.reduce((sum, n) => sum + n, 0) / list.length : 0);

/**
 * Everything the family view needs, worked out from one graph.
 *
 * @param {object} graph  a normalized graph, from `readGraph`.
 * @returns {{
 *   people: string[], seats: Record<string, {left: number, top: number}>,
 *   paths: Array<{key: string, d: string, couple: boolean, people: string[]}>,
 *   rows: number, omitted: number, board: {width: number, height: number, r: number},
 * }}
 */
export function familyPlan(graph) {
	const everyone = Object.keys(graph?.nodes ?? {});
	const ties = kinTies(graph);
	if (!ties.people.length) {
		return {
			people: [], seats: {}, paths: [], rows: 0,
			omitted: everyone.length,
			// THE CHART'S OWN RULE, even for a chart with nothing on it. `boardMetrics` is the
			// CAST's answer and belongs to the other view -- this file says so twice, in its header
			// and again over `treeBoard` -- so a map of forty people with no family marked was
			// handing this view a 3000px sheet to display one panel, and the surface fitted that
			// empty board into the window at a third of scale for no reason a reader could name.
			board: treeBoard(0, 0),
		};
	}

	const rowOf = generationOf(ties);
	const homes = households(ties);
	const slots = columnsFor(ties, homes, rowOf);
	const rows = Math.max(...ties.people.map(id => rowOf.get(id))) + 1;
	const span = Math.max(...ties.people.map(id => slots.get(id)));

	const board = treeBoard(rows, span);
	const r = board.r;
	// A portrait is a circle of fixed pixels, so DOWN the board it covers more percentage points
	// than it does across: `r` is the flat radius (a share of the width), and the same circle
	// measured against the height is that times the aspect. Every vertical number below is in
	// percent of the HEIGHT, because that is the space the board's stretched SVG is drawn in.
	const rv = r * RELMAP_BOARD_ASPECT;
	const nameH = (100 * NAME_PX) / board.height;

	// HOW FAR APART A CHART STANDS: it fills the sheet, but only up to a point, and then it stops
	// and sits centred. Filling alone puts two people, one the other's parent, at opposite ends of
	// the board joined by a line the length of the window, and puts a couple a whole screen apart
	// with their marriage bar stretched between them. `SPREAD` is where the growing stops, in
	// multiples of the spacing a portrait and its name actually want.
	const marginX = r + EDGE_PAD;
	const marginTop = rv + EDGE_PAD;
	const marginBottom = rv + nameH + EDGE_PAD;
	const roomX = 100 - 2 * marginX;
	const roomY = 100 - marginTop - marginBottom;
	const stepX = span > 0 ? Math.min(roomX / span, (SPREAD * 100 * COL_PX) / board.width) : 0;
	const stepY = rows > 1 ? Math.min(roomY / (rows - 1), (SPREAD * 100 * ROW_PX) / board.height) : 0;
	const left = slot => 50 + (slot - span / 2) * stepX;
	const top = row => marginTop + (roomY - stepY * (rows - 1)) / 2 + row * stepY;

	const seats = {};
	for (const id of ties.people) {
		seats[id] = { left: round(left(slots.get(id))), top: round(top(rowOf.get(id))) };
	}

	return {
		people: ties.people,
		seats,
		paths: drawHouseholds(homes, seats, { r, rv, nameH }),
		rows,
		omitted: everyone.length - ties.people.length,
		board,
	};
}

/**
 * The sheet this chart wants: the larger of what its generations and its widest row ask for.
 *
 * ASKED OF `sheetFor`, which is where the floor, the cap and the aspect live for every board -- so
 * a chart is capped at `RELMAP_BOARD_MAX` and floored at the plain sheet like anything else, and
 * changing that rule changes it for both views at once. Past the cap the chart simply draws
 * tighter, which is a crowded chart and still a chart; refusing to draw a family of two hundred
 * would not be.
 *
 * NOT `boardMetrics`, though, which is the CAST's answer and belongs to the other view. That
 * sizing exists to make room for the writing on eighty lines; a chart carries no captions at all,
 * so a family of forty would be handed a sheet three times the size of its own chart and the
 * reader would meet it as a small drawing in the middle of a large empty page. What this view has
 * of its own is the width it asks for, and nothing else.
 */
function treeBoard(rows, span) {
	const wantTall = rows * ROW_PX * RELMAP_BOARD_ASPECT;
	const wantWide = (span + 1) * COL_PX;
	return sheetFor(Math.max(wantTall, wantWide));
}

// ── Which column everybody stands in ─────────────────────────────────────────────────

/** Everybody's kin neighbours, both directions, as one plain adjacency. Used only to find the
 * families that share nobody, so that two of them are never interleaved. */
function kinAdjacency(ties) {
	const adj = new Map(ties.people.map(id => [id, new Set()]));
	for (const [child, parents] of ties.parents) {
		for (const parent of parents) {
			adj.get(child)?.add(parent);
			adj.get(parent)?.add(child);
		}
	}
	for (const [a, b] of ties.partners) {
		adj.get(a)?.add(b);
		adj.get(b)?.add(a);
	}
	return adj;
}

/** The separate families on this map, biggest first, each one a sorted list of ids. The same walk
 * the ring seats its own components with, over kin ties instead of lines: two families who share
 * nobody must never be interleaved, and that is one question with one answer. */
function familiesOf(ties) {
	return componentsOf(ties.people, kinAdjacency(ties)).map(group => group.sort());
}

/**
 * The order people stand in, one row at a time, by walking each family DOWNWARD from its eldest.
 *
 * WHY A WALK AND NOT A SORT. What makes a chart readable is that a branch stays together: all of
 * one daughter's descendants, then all of the other's, rather than the two families' children
 * interleaved because their ids happen to alternate. Walking down from the top and taking each
 * household in turn produces exactly that, and it comes out of the walk for free rather than having
 * to be recovered afterwards by counting crossings.
 *
 * A PARTNER IS VISITED FIRST, before any children, so a couple end up side by side in their row
 * with their household's bar between them and nothing sitting in the gap.
 */
function walkOrder(group, ties, homesOfParent, rowOf) {
	const inGroup = new Set(group);
	const seen = new Set();
	const order = new Map();
	const visit = id => {
		if (seen.has(id) || !inGroup.has(id)) return;
		seen.add(id);
		const partners = ties.partnersOf.get(id) ?? [];
		// SOMEBODY WITH TWO PARTNERS STANDS BETWEEN THEM, so one of the two is seated first. A
		// remarriage seated in the order it was walked puts both partners on the same side, and the
		// bar to the further one then runs straight through the nearer one's face on its way there.
		// Marked seen already, so seating a partner first cannot come back round and seat this
		// person twice.
		if (partners.length > 1) visit(partners[0]);
		const row = rowOf.get(id);
		if (!order.has(row)) order.set(row, []);
		order.get(row).push(id);
		for (const partner of partners) visit(partner);
		for (const home of homesOfParent.get(id) ?? []) {
			// The other parent before the children, for the reason above.
			for (const parent of home.parents) visit(parent);
			for (const child of home.children) visit(child);
		}
	};

	const byRow = (a, b) => rowOf.get(a) - rowOf.get(b) || a.localeCompare(b);
	// From whoever has no recorded parents, eldest row first. Then anything the walk could not
	// reach from a root, which is a loop somebody has drawn: it still gets a place on the chart.
	group.filter(id => !(ties.parents.get(id)?.length)).sort(byRow).forEach(visit);
	group.slice().sort(byRow).forEach(visit);
	return order;
}

/**
 * Where along its row each person stands, in COLUMNS rather than percentages.
 *
 * The columns are settled before the sheet is sized, because the sheet's size depends on how many
 * of them there turn out to be. One column is one portrait's worth of room.
 *
 * The arrangement is the standard one for a layered drawing: fix the order within each row (above),
 * then pull everybody towards the people they are joined to, then push apart anybody who has ended
 * up on top of somebody else. Down the rows and then up again, so that a parent ends up over their
 * children AND a child ends up under their parents rather than only one of the two.
 *
 * FAMILIES THAT SHARE NOBODY GET THEIR OWN STRETCH of the chart, side by side. A guarantee rather
 * than a hope: no line of one family can reach into another's columns, so nothing of theirs can
 * cross, and the eye reads two charts instead of one tangle.
 */
function columnsFor(ties, homes, rowOf) {
	const homesOfParent = new Map();
	const homesOfChild = new Map();
	for (const home of homes) {
		for (const parent of home.parents) {
			if (!homesOfParent.has(parent)) homesOfParent.set(parent, []);
			homesOfParent.get(parent).push(home);
		}
		for (const child of home.children) {
			if (!homesOfChild.has(child)) homesOfChild.set(child, []);
			homesOfChild.get(child).push(home);
		}
	}

	const x = new Map();
	let offset = 0;
	for (const group of familiesOf(ties)) {
		const order = walkOrder(group, ties, homesOfParent, rowOf);
		const rows = [...order.keys()].sort((a, b) => a - b);
		for (const row of rows) order.get(row).forEach((id, i) => x.set(id, i));

		const anchorsDown = id => (homesOfChild.get(id) ?? [])
			.map(home => mean(home.parents.filter(p => x.has(p)).map(p => x.get(p))))
			.filter(Number.isFinite);
		const anchorsUp = id => [
			...(homesOfParent.get(id) ?? [])
				.filter(home => home.children.length)
				.map(home => mean(home.children.filter(c => x.has(c)).map(c => x.get(c)))),
			...(ties.partnersOf.get(id) ?? []).filter(p => x.has(p)).map(p => x.get(p)),
		].filter(Number.isFinite);

		// UP FIRST AND DOWN LAST, and the order is the whole difference between a chart and a
		// spread of people. The two pulls disagree (a mother is pulled towards her children and her
		// children towards her), so whichever runs last is the one the picture ends up satisfying,
		// and only one of the two is worth looking at: children sitting squarely under their
		// parents is what a family tree IS. Ending on the upward pass instead leaves every set of
		// siblings hauled apart towards their own descendants, with the rail above them stretched
		// across the whole chart to reach them.
		for (let pass = 0; pass < SLOT_PASSES; pass++) {
			for (const row of [...rows].reverse()) settleRow(order.get(row), x, anchorsUp);
			for (const row of rows) settleRow(order.get(row), x, anchorsDown);
		}

		// Slid over so this family starts where the last one finished, and pinned to whole columns
		// so that two families' rows do not end up half a portrait out of step with each other.
		const lowest = Math.min(...group.map(id => x.get(id)));
		for (const id of group) x.set(id, x.get(id) - lowest + offset);
		offset = Math.max(...group.map(id => x.get(id))) + 1 + FAMILY_GAP;
	}
	return x;
}

/**
 * One row, pulled towards whatever it is anchored to and then pushed apart.
 *
 * The push is a single left-to-right sweep, which is enough because the row's ORDER never changes:
 * nobody has to get past anybody. Somebody with nothing to pull them keeps the column they had,
 * which is what leaves a person standing where the walk put them rather than at the left margin.
 *
 * ⚠ AND THE PUSH IS THEN UNDONE IN BLOCKS, not across the whole row, which is the difference
 * between a chart and a chart that is subtly out of true. The sweep can only shove people RIGHT, so
 * something has to give the room back, and sliding the whole row was the obvious way and was wrong:
 * it moves everybody, including the people the sweep never touched. Two children of one couple end
 * up not quite under them, a single child ends up beside their parent instead of below, and every
 * junction in the chart is a corner slightly off its own middle.
 *
 * A BLOCK is a run of people the sweep has left packed shoulder to shoulder: they were all trying
 * to stand in about the same place and could not, so they are the ones that owe room back. Each
 * block is slid so its middle sits where its members wanted to be, which centres a pair of siblings
 * under their parents exactly, and everybody the sweep left alone is left alone.
 */
function settleRow(ids, x, anchorsOf) {
	if (!ids?.length) return;
	const want = ids.map(id => {
		const anchors = anchorsOf(id);
		return anchors.length ? mean(anchors) : x.get(id);
	});
	const out = want.slice();
	for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + 1);

	for (let from = 0; from < out.length;) {
		let to = from;
		while (to + 1 < out.length && Math.abs(out[to + 1] - out[to] - 1) < EPSILON) to++;
		const block = (list, at, end) => mean(list.slice(at, end + 1));
		let shift = block(want, from, to) - block(out, from, to);
		// Never back into the block behind (already settled) or into the one ahead (not yet moved,
		// and no further right than the sweep left it). Both are one-sided clamps, so a block that
		// cannot have all the room it is owed simply takes what there is.
		if (from > 0) shift = Math.max(shift, out[from - 1] + 1 - out[from]);
		if (to + 1 < out.length) shift = Math.min(shift, out[to + 1] - 1 - out[to]);
		for (let i = from; i <= to; i++) out[i] += shift;
		from = to + 1;
	}
	ids.forEach((id, i) => x.set(id, out[i]));
}

// ── The lines between the generations ────────────────────────────────────────────────

/**
 * One path per household: the bar between the parents, the stem down from it, the rail across the
 * children, and a drop into each child.
 *
 * ONE PATH AND NOT FOUR ELEMENTS. A household is one thing the eye follows, so it is one stroke:
 * lighting it up lights all of it, and there is no chance of the rail and the drops disagreeing
 * about where the corner is because they were painted from two calls.
 *
 * WHERE THE LINES LEAVE FROM. A stem leaves from below the NAME, not from the bottom of the
 * portrait, because the name is a plate of solid paper and a line running behind it would appear to
 * be cut in half. A drop arrives at the TOP of the child's head, where there is nothing in the way.
 */
function drawHouseholds(homes, seats, { r, rv, nameH }) {
	const out = [];
	for (const home of homes) {
		const parents = home.parents.filter(id => seats[id]);
		const children = home.children.filter(id => seats[id]);
		if (!parents.length) continue;

		const parts = [];
		const level = parents.length === 2 && seats[parents[0]].top === seats[parents[1]].top;
		// The bar between two parents on the same row. Skipped when their portraits are close
		// enough to touch: there is no gap to draw it in, and a bar shorter than nothing comes out
		// backwards.
		let stem = null;
		if (level) {
			const [a, b] = [seats[parents[0]], seats[parents[1]]].sort((p, q) => p.left - q.left);
			if (b.left - a.left > 2 * r) parts.push(`M ${round(a.left + r)},${round(a.top)} H ${round(b.left - r)}`);
			stem = { left: (a.left + b.left) / 2, top: a.top };
		}
		if (!children.length) {
			// A couple with nobody below them is just their bar. Nothing to hang.
			if (parts.length) out.push(pathOf(home, parts, true));
			continue;
		}

		// The rail sits halfway between where the stems leave and where the heads begin, so the two
		// corners are the same size and the chart reads as one grid rather than as a set of hooks.
		const stems = stem
			? [stem]
			: parents.map(id => ({ left: seats[id].left, top: seats[id].top + rv + nameH }));
		const from = Math.max(...stems.map(p => p.top));
		const heads = children.map(id => ({ left: seats[id].left, top: seats[id].top - rv }));
		const to = Math.min(...heads.map(p => p.top));
		const railY = round(from + (to - from) / 2);

		for (const spot of stems) parts.push(`M ${round(spot.left)},${round(spot.top)} V ${railY}`);
		const rail = [...stems, ...heads].map(p => p.left);
		const railLeft = round(Math.min(...rail));
		const railRight = round(Math.max(...rail));
		if (railRight > railLeft) parts.push(`M ${railLeft},${railY} H ${railRight}`);
		for (const head of heads) parts.push(`M ${round(head.left)},${railY} V ${round(head.top)}`);

		out.push(pathOf(home, parts, level));
	}
	return out;
}

function pathOf(home, parts, couple) {
	return {
		key: home.key,
		d: parts.join(" "),
		couple: !!couple,
		// Everybody this stroke joins, so that resting on any one of them can light the whole
		// household. A list rather than the two ends every other line on the board carries: a
		// household has as many ends as it has children.
		people: [...home.parents, ...home.children],
	};
}
