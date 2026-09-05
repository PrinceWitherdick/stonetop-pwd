// Where the portraits GO, worked out from who knows whom.
//
// WHY IT IS NOT IN relmap-geometry.js, which is next door and about the same board. That file is
// the arithmetic of DRAWING a map whose people are already placed: where a curve runs between two
// portraits, where its label rides, which way its heads point. This one answers the question
// before that: given a graph, where should the people BE so the drawing has a chance. The split is
// not tidiness. The geometry runs on every repaint and on every frame of a drag and has to stay
// cheap; this runs once, when somebody presses Tidy up, and is allowed to spend a hundred times as
// long because nothing is waiting on it but one button.
//
// WHAT WENT WRONG WITH ONE RING IN INSERTION ORDER, which is what this replaces. Seating people in
// the order they happened to be added is seating them at random, so a link between two of them is
// as likely to be a diameter as a short hop. Every diameter crosses every other diameter, and the
// midpoint of a diameter is the middle of the board, so the labels all land in one heap there too.
// At a village's worth of people the board stops being a map and becomes a ball of string. Both
// shapes below exist to put linked people NEAR each other, which is the single change that fixes
// the lines and the labels at once: a short line crosses little and its label sits out where
// there is room.
//
// EVERYTHING IS DETERMINISTIC. No `Math.random` anywhere, and every walk over a set of ids is over
// a SORTED copy. A shared board that laid itself out differently each press would be unusable at a
// table: one player pressing Tidy up would scramble the picture everybody else had learned.
//
// AND BOTH SHAPES ARE GENTLE. Each starts from where people already are and improves it, rather
// than starting from nothing: the ring picks the turn and the handedness that move the fewest
// people, and the clusters begin at the portraits' current spots. Pressing Tidy up on a board that
// is already tidy should barely move anything, or nobody will dare press it.
//
// FLAT SPACE, as in relmap-geometry.js and for the same reason: percentages are not a square
// space, so a distance measured in raw percentages is squashed along one axis. `left` unchanged,
// `top` divided by the aspect, and the two axes are then comparable.

import {
	RELMAP_BOARD_ASPECT, boardMetrics, clampPct, graphCapPx, nodeRadiusPct, ratioOf, ringLayout,
	ringRadius,
	ringsLayout,
} from "./relmap-geometry.js";

/** The two shapes Tidy up can put a board into. Stored on the map, so it remembers. */
export const RELMAP_SHAPE_RING = "ring";
export const RELMAP_SHAPE_CLUSTERS = "clusters";
export const RELMAP_SHAPES = Object.freeze([RELMAP_SHAPE_RING, RELMAP_SHAPE_CLUSTERS]);
export const RELMAP_SHAPE_DEFAULT = RELMAP_SHAPE_RING;

// ── The ring ─────────────────────────────────────────────────────────────────────────

/** How many times the seats are re-sorted by where each person's friends sit. Converges long
 * before this on any board a table would build; the cap is only there so a pathological graph
 * cannot spin. */
const BARYCENTRE_PASSES = 24;

/** How many sweeps of "which seat would cross the fewest lines for this person?" to make, and the
 * most lines it is worth asking about. The sweep costs about the people times the square of the
 * lines, so a board with many hundreds of links would spend most of a second on a refinement the
 * barycentre passes have already got most of. Above the cap it is simply skipped. */
const SIFT_PASSES = 4;
const SIFT_MAX_CHORDS = 400;

// ── The clusters ─────────────────────────────────────────────────────────────────────

/** How many rounds the springs are allowed. Enough to settle a village; the cost is quadratic in
 * people per round, and a board of forty is about a millisecond a round. */
const FORCE_STEPS = 320;

/** How hard the middle of the board pulls, and how much harder on somebody with many links. The
 * second half is what puts the hubs (a steading, a faction, the character everybody has an opinion
 * about) in the middle with their satellites around them, instead of leaving them adrift in the
 * ring of people they are attached to. */
const GRAVITY = 0.055;

/** How far apart two portraits sat on the exact same spot are nudged before the springs start.
 * Every unplaced node reads as the middle of the board (see `clampPct`), where every force is
 * exactly zero and nothing would ever move. Along a golden-angle spiral, so the nudge is spread
 * evenly and is the same on every client. */
const SEED_JITTER = 0.35;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** How many rounds of pushing overlapping portraits apart, once the springs have finished. */
const SEPARATE_PASSES = 32;

/** Below this two points count as the same point, and are pushed apart along a fixed direction
 * rather than by a normal nobody can compute. */
const EPSILON = 1e-6;

/** One shape name, or the default. Anything else is somebody's stored rubbish or a newer version's
 * shape read by an older one, and the ring is the safe answer to both. */
export function normalizeShape(shape) {
	return RELMAP_SHAPES.includes(shape) ? shape : RELMAP_SHAPE_DEFAULT;
}

/**
 * Everybody's neighbours, as a plain undirected adjacency.
 *
 * PARALLEL LINKS COLLAPSE. Two people with three lines between them are no more connected, for the
 * purpose of deciding where to sit them, than two with one: the three are drawn as a fan off the
 * same route either way. Counting them three times would drag a pair together hard enough to
 * distort everybody else's placement over a distinction the eye cannot see.
 *
 * Self-links are dropped for the same reason `normalizeGraph` drops them: there is no line.
 */
function neighbourhood(graph) {
	const adj = new Map();
	for (const id of Object.keys(graph?.nodes ?? {})) adj.set(id, new Set());
	for (const edge of Object.values(graph?.edges ?? {})) {
		if (!edge || edge.a === edge.b) continue;
		if (!adj.has(edge.a) || !adj.has(edge.b)) continue;
		adj.get(edge.a).add(edge.b);
		adj.get(edge.b).add(edge.a);
	}
	return adj;
}

/**
 * An adjacency in pieces that have nothing to do with each other, biggest first.
 *
 * WHY THEY ARE FOUND SEPARATELY rather than left to the ordering to sort out. Two groups of people
 * who share no link have no reason to be interleaved around the ring, and every interleaving is a
 * pile of crossings for nothing: put each group on its own stretch of the circle and no line from
 * one can cross a line from the other, ever, because a chord whose ends are both inside an arc
 * stays inside it. Contiguity is a guarantee here, not a hope.
 *
 * Biggest first so the web that needs the room gets the long stretch, and the pairs and lone
 * figures are gathered together at the end instead of scattered between them.
 *
 * IT TAKES AN ADJACENCY RATHER THAN A GRAPH because the family chart wants the same guarantee for
 * the same reason -- two families who share nobody must never be interleaved either -- and the two
 * views disagree about what a tie IS and about nothing else here.
 */
export function componentsOf(ids, adj) {
	const seen = new Set();
	const out = [];
	for (const start of ids) {
		if (seen.has(start)) continue;
		seen.add(start);
		const group = [];
		const queue = [start];
		while (queue.length) {
			const id = queue.shift();
			group.push(id);
			for (const next of [...adj.get(id)].sort()) {
				if (seen.has(next)) continue;
				seen.add(next);
				queue.push(next);
			}
		}
		out.push(group);
	}
	out.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
	return out;
}

/**
 * Whether two chords of a circle cross, each given as the two seats it spans with the lower first.
 *
 * The whole test in one line: they cross exactly when one end of the second lies strictly inside
 * the arc the first spans and the other lies strictly outside. Written on POSITIONS rather than
 * angles, because the seats are evenly spaced and integers do not drift.
 *
 * ONE SPELLING, because both readers below ask it of the same chords: the counter that says how
 * good an order is, and the refinement that tries to better it. Two spellings would be two rings.
 */
const crosses = (lo1, hi1, lo2, hi2) => (lo1 < lo2 && lo2 < hi1 && hi1 < hi2)
	|| (lo2 < lo1 && lo1 < hi2 && hi2 < hi1);

/**
 * How many times the lines would cross, for people seated in this order round a circle.
 *
 * Exported because it is what the tests measure the ordering against. A heuristic is worth having
 * only if it actually crosses fewer lines than the order it replaced, and that is a claim about
 * this number.
 */
export function ringCrossings(order, graph) {
	const pos = new Map(order.map((id, i) => [id, i]));
	const chords = chordsOf(graph, new Set(pos.keys())).map(([a, b]) => {
		const i = pos.get(a);
		const j = pos.get(b);
		return i < j ? [i, j] : [j, i];
	});
	let count = 0;
	for (let x = 0; x < chords.length; x++) {
		const [a1, b1] = chords[x];
		for (let y = x + 1; y < chords.length; y++) {
			const [a2, b2] = chords[y];
			if (crosses(a1, b1, a2, b2)) count++;
		}
	}
	return count;
}

/**
 * Seat one group by repeatedly moving everybody to the average direction of their friends.
 *
 * THE AVERAGE IS TAKEN AS A DIRECTION, not as a number of degrees. Angles wrap, and the plain
 * arithmetic mean of 350 and 10 is 180: the exact opposite side of the board from where both
 * neighbours actually are. Summing unit vectors and taking `atan2` of the total is the mean that
 * survives the wrap, and it also degrades honestly: somebody whose friends are spread evenly all
 * the way round has a total of nothing, which is the truth (they have no preferred side) and is
 * caught below rather than turned into a direction by accident.
 *
 * Somebody with no friends in the group, or whose friends cancel out, keeps the seat they had.
 */
function barycentreOrder(group, adj) {
	let order = group.slice();
	const n = order.length;
	// Three or fewer people round a circle cannot cross at all, whatever order they sit in.
	if (n < 4) return order;

	for (let pass = 0; pass < BARYCENTRE_PASSES; pass++) {
		const angle = new Map(order.map((id, i) => [id, (i * 2 * Math.PI) / n]));
		const wants = order.map(id => {
			let sx = 0;
			let sy = 0;
			for (const other of adj.get(id)) {
				const a = angle.get(other);
				if (a === undefined) continue;
				sx += Math.cos(a);
				sy += Math.sin(a);
			}
			const settled = angle.get(id);
			const want = Math.abs(sx) > EPSILON || Math.abs(sy) > EPSILON
				? Math.atan2(sy, sx)
				: settled;
			return { id, want: (want + 2 * Math.PI) % (2 * Math.PI), was: settled };
		});
		// Ties broken by the seat they were in and then by id, so the sort is total and the same
		// on every client. A comparator that can call two rows equal leaves the order up to the
		// engine's sort, which is not the same engine on every machine at the table.
		wants.sort((p, q) => p.want - q.want || p.was - q.was || p.id.localeCompare(q.id));
		const next = wants.map(p => p.id);
		if (next.every((id, i) => id === order[i])) break;
		order = next;
	}
	return order;
}

/**
 * Every link once, as a pair of ids, optionally kept to one set of people.
 *
 * THE ONE WALK OVER THE EDGES, because three readers want the same list read the same way and the
 * rule is not obvious: a self-link is no line at all, and a FAN OF PARALLEL LINKS IS ONE CHORD --
 * the second copy of a route crosses everything the first does, so counting it twice would scale
 * every score alike and hide the real improvements. `ringCrossings` counts over these, `siftOrder`
 * refines over these, and `uniqueLinks` springs over these; the callers differ only in what they
 * turn a pair of ids INTO.
 */
function chordsOf(graph, within = null) {
	const seen = new Map();
	for (const edge of Object.values(graph?.edges ?? {})) {
		if (!edge || edge.a === edge.b) continue;
		if (within && (!within.has(edge.a) || !within.has(edge.b))) continue;
		const key = edge.a < edge.b ? `${edge.a}:${edge.b}` : `${edge.b}:${edge.a}`;
		if (!seen.has(key)) seen.set(key, [edge.a, edge.b]);
	}
	return [...seen.values()];
}

/**
 * Take each person out of the ring in turn and put them back in the seat that crosses fewest.
 *
 * WHY NOT SWAPPING NEIGHBOURS, which is the obvious refinement and was the first one written here.
 * Swapping two adjacent seats is far too small a step: it gets stuck almost immediately, and on
 * something as simple as eight people in a circle who each know the next one it settles one
 * crossing short of the answer a person can see by eye. Lifting somebody out and trying every seat
 * subsumes the swap (a swap is a move of one place) and gets out of the holes a swap falls into.
 *
 * ONLY THE MOVED PERSON'S LINES ARE COUNTED, which is what makes it affordable. Sliding one
 * portrait round the ring cannot change whether two lines that both avoid them cross: crossing
 * depends on the order the four ends come in, and everybody else's order is untouched. So the
 * whole board's score need never be recomputed, only the part that could have changed.
 *
 * TIES KEEP THE SEAT THEY HAVE. A move that buys nothing is a portrait that walked across the
 * board for no reason, and two of them can trade places forever.
 */
function siftOrder(order, chords) {
	const n = order.length;
	if (n < 4 || !chords.length) return order;
	const mineOf = new Map(order.map(id => [id, []]));
	for (const chord of chords) {
		mineOf.get(chord[0])?.push(chord);
		mineOf.get(chord[1])?.push(chord);
	}

	let best = order.slice();
	for (let pass = 0; pass < SIFT_PASSES; pass++) {
		let moved = false;
		// Over a SNAPSHOT of the order, so that the people considered in one pass, and the order
		// they are considered in, do not depend on the moves the pass is making as it goes.
		for (const person of best.slice()) {
			const mine = mineOf.get(person) ?? [];
			if (!mine.length) continue;
			const others = chords.filter(c => c[0] !== person && c[1] !== person);
			if (!others.length) continue;
			const rest = best.filter(id => id !== person);
			const restAt = new Map(rest.map((id, i) => [id, i]));
			// Where somebody sits once `person` is put back in at `seat`: everybody after the
			// insertion point shifts along by one, which is cheaper and clearer than rebuilding
			// the whole position map for each of the seats tried.
			const posAt = (id, seat) => {
				if (id === person) return seat;
				const i = restAt.get(id);
				return i < seat ? i : i + 1;
			};
			const scoreAt = seat => {
				let count = 0;
				for (const [a, b] of mine) {
					const lo1 = Math.min(posAt(a, seat), posAt(b, seat));
					const hi1 = Math.max(posAt(a, seat), posAt(b, seat));
					for (const [c, d] of others) {
						const lo2 = Math.min(posAt(c, seat), posAt(d, seat));
						const hi2 = Math.max(posAt(c, seat), posAt(d, seat));
						if (crosses(lo1, hi1, lo2, hi2)) count++;
					}
				}
				return count;
			};

			const was = best.indexOf(person);
			let bestSeat = was;
			let bestScore = scoreAt(was);
			for (let seat = 0; seat <= rest.length && bestScore > 0; seat++) {
				if (seat === was) continue;
				const score = scoreAt(seat);
				if (score < bestScore) { bestScore = score; bestSeat = seat; }
			}
			if (bestSeat === was) continue;
			best = [...rest.slice(0, bestSeat), person, ...rest.slice(bestSeat)];
			moved = true;
		}
		if (!moved) break;
	}
	return best;
}

/**
 * Turn a seating order until it best matches where people already sit.
 *
 * A cyclic order says who sits NEXT TO whom and nothing at all about which of them is at twelve
 * o'clock, or about which way round the circle runs. Both are free, and both are worth spending,
 * because the order that reads the same to the graph can move every portrait on the board or
 * almost none of them. Pressing Tidy up on a board that is already tidy has to be nearly a no-op,
 * or the button is one nobody at the table will risk.
 *
 * Both handednesses are tried, because a mirrored ring crosses exactly as few lines and may be far
 * closer to what is on the board.
 *
 * Somebody sitting on the board's exact centre has no angle to match, and is left out of the score
 * rather than counted as pointing east: an unplaced person should not get a vote on where everyone
 * else ends up.
 */
function alignToCurrent(order, graph, aspect) {
	const n = order.length;
	if (n < 2) return order;
	const ratio = ratioOf(aspect);
	const now = new Map();
	for (const id of order) {
		const node = graph.nodes[id];
		if (!node) continue;
		const dx = node.x - 50;
		const dy = (node.y - 50) / ratio;
		if (Math.hypot(dx, dy) < 1) continue;
		now.set(id, Math.atan2(dy, dx));
	}
	if (!now.size) return order;

	// The same seats `ringLayout` will hand out: twelve o'clock, then clockwise.
	const seat = i => -Math.PI / 2 + (i * 2 * Math.PI) / n;
	const apart = (a, b) => {
		const d = Math.abs(a - b) % (2 * Math.PI);
		return d > Math.PI ? 2 * Math.PI - d : d;
	};

	let best = order;
	let bestCost = Infinity;
	for (const ring of [order, order.slice().reverse()]) {
		for (let turn = 0; turn < n; turn++) {
			let cost = 0;
			for (let i = 0; i < n; i++) {
				const angle = now.get(ring[(i + turn) % n]);
				if (angle !== undefined) cost += apart(seat(i), angle);
			}
			if (cost < bestCost - EPSILON) {
				bestCost = cost;
				best = Array.from({ length: n }, (_, i) => ring[(i + turn) % n]);
			}
		}
	}
	return best;
}

/**
 * The order people should sit round the ring so that as few lines as possible cross.
 *
 * Components first and contiguous, then each one settled by barycentre passes, then polished by
 * swaps, then turned to match the board as it stands. Exported on its own because it is the part
 * worth testing directly: `ringByRelations` only pours it into seats.
 */
export function seatOrder(graph, { aspect = RELMAP_BOARD_ASPECT, align = true } = {}) {
	const ids = Object.keys(graph?.nodes ?? {}).sort();
	if (ids.length < 2) return ids;
	const adj = neighbourhood(graph);
	const polish = chordsOf(graph).length <= SIFT_MAX_CHORDS;

	const order = [];
	for (const group of componentsOf(ids, adj)) {
		let seated = barycentreOrder(group, adj);
		// Refined ONE COMPONENT AT A TIME, over only that component's own links. A move inside one
		// group cannot change how many lines cross in another (no line runs between them, and each
		// owns an unbroken arc), so counting the rest of the board on every trial would be work
		// for an answer that cannot move.
		if (polish) seated = siftOrder(seated, chordsOf(graph, new Set(group)));
		order.push(...seated);
	}
	return align ? alignToCurrent(order, graph, aspect) : order;
}

/**
 * Everybody round ONE ring, seated by who knows whom.
 *
 * The poster look the board was drawn for, kept: a single circle of faces. What changes is only
 * WHICH face is in which seat, and that is the whole of the improvement. Friends end up adjacent,
 * so the line between them is a short hop near the rim that crosses nothing and carries its label
 * out where there is room, and only the genuinely distant pairs are left reaching across.
 *
 * @returns {Record<string, {left: number, top: number}>}  where each person goes, by node id.
 */
export function ringByRelations(graph, options = {}) {
	const order = seatOrder(graph, options);
	if (!order.length) return {};
	const seats = ringLayout(order.length, options);
	const out = {};
	order.forEach((id, i) => { out[id] = seats[i]; });
	return out;
}

// ── The clusters ─────────────────────────────────────────────────────────────────────

/**
 * Everybody pulled together by their links and pushed apart by everybody else.
 *
 * A spring embedder, the Fruchterman-Reingold arrangement: every pair of people repels, every link
 * pulls, the middle of the board pulls gently, and the whole thing cools so that the big
 * rearrangements happen first and the last rounds only settle it. What comes out is groups. The
 * households, the factions and the people who all have opinions about one person end up as knots
 * with space between them, which is the thing a ring cannot show however well it is ordered.
 *
 * TWO DEPARTURES FROM THE TEXTBOOK, both about hubs, because a relationship map is nearly all hub.
 * A steading, a faction, the character everyone has rated: these have ten or twenty links each
 * while most people have two.
 *
 *  • The pull on a person is divided by how many links they have. Otherwise a hub is dragged
 *    twenty times as hard as a leaf, and it does not settle among its satellites, it is hauled to
 *    the average of them and pins them in a ball on top of it.
 *  • The pull toward the middle is multiplied by it. A well-connected person belongs in the
 *    middle of the picture with their satellites around them, and saying so explicitly is what
 *    stops the board coming out as one undifferentiated hairball.
 *
 * It starts from WHERE PEOPLE ARE, not from a fresh ring, so a board somebody has already arranged
 * is improved rather than replaced.
 */
export function clusterLayout(graph, {
	aspect = RELMAP_BOARD_ASPECT, r = nodeRadiusPct(), pad = 3, steps = FORCE_STEPS, room = 0,
} = {}) {
	const everyone = Object.keys(graph?.nodes ?? {}).sort();
	if (!everyone.length) return {};
	if (everyone.length === 1) return { [everyone[0]]: { left: 50, top: 50 } };

	const ratio = ratioOf(aspect);
	const width = 100;
	const height = 100 / ratio;
	const adj = neighbourhood(graph);

	// WHO THE SPRINGS ARE FOR. Somebody nobody has drawn a line to has no place the springs can
	// give them: nothing pulls them anywhere, so where they end up is decided entirely by being
	// pushed away from everyone else, and they drift out to the far corners. That would be merely
	// untidy if it stopped there. It does not: the fit below scales the arrangement to fill the
	// sheet, and a handful of people flung to the corners are what it measures, so the whole
	// connected web gets squeezed into a ball in the middle to make room for four people standing
	// on their own in the wilderness. They are lifted out and given the rim instead.
	const alone = everyone.filter(id => !adj.get(id).size);
	const ids = everyone.filter(id => adj.get(id).size);
	// TWO WAYS THIS IS NOT A WEB AT ALL, and in both of them the rim-and-middle arrangement below
	// is a worse picture than an ordinary ring. Fewer than three people linked is not a shape the
	// springs can find anything in; and more people standing alone than the rim can hold without
	// them touching means the rim IS the board, so putting a handful in the middle of it and
	// pressing everyone else into a crowd round the edge helps nobody.
	const rim = ringRadius(ratio, r, pad);
	const rimHolds = Math.max(1, Math.floor((2 * Math.PI * rim) / Math.max(0.001, 2 * r + pad)));
	if (ids.length < 3 || alone.length > rimHolds) {
		return ringsLayout(everyone.length, { aspect, r, pad })
			.reduce((out, spot, i) => Object.assign(out, { [everyone[i]]: spot }), {});
	}

	const n = ids.length;
	const links = uniqueLinks(graph, ids);
	const pts = seedPoints(graph, ids, ratio);
	const degree = ids.map(id => Math.max(1, adj.get(id).size));

	// A lane round the outside for the people with no lines, and the rest of the sheet for the web.
	const lane = alone.length ? 2 * r + pad : 0;
	const box = {
		left: r + pad + lane, right: width - r - pad - lane,
		top: r + pad + lane, bottom: height - r - pad - lane,
	};

	// HOW FAR APART THE SPRINGS AIM TO SETTLE, and it is the larger of two claims. The first is the
	// usual one: share the sheet's area out per person. The second is what the CAPTIONS need, and
	// it is the one that was missing. A caption rides the middle of its line, turned to lie along
	// it, so a line has to be longer than the words on it plus the two faces at its ends or the
	// chip is wider than the gap it is sitting in. `room` is that length, in flat units, handed in
	// by whoever knows how wide the chips will be painted.
	const k = Math.max(Math.sqrt(((box.right - box.left) * (box.bottom - box.top)) / n),
		Number(room) > 0 ? Number(room) : 0);
	let heat = Math.max(width, height) / 8;
	const cooling = heat / (steps + 1);

	const dx = new Float64Array(n);
	const dy = new Float64Array(n);
	for (let step = 0; step < steps; step++) {
		dx.fill(0);
		dy.fill(0);

		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const { ux, uy, d } = direction(pts[i], pts[j], i * n + j);
				const push = (k * k) / d;
				dx[i] += ux * push; dy[i] += uy * push;
				dx[j] -= ux * push; dy[j] -= uy * push;
			}
		}

		for (const [i, j] of links) {
			const { ux, uy, d } = direction(pts[i], pts[j], i * n + j);
			const pull = (d * d) / k;
			dx[i] -= (ux * pull) / degree[i]; dy[i] -= (uy * pull) / degree[i];
			dx[j] += (ux * pull) / degree[j]; dy[j] += (uy * pull) / degree[j];
		}

		for (let i = 0; i < n; i++) {
			const gx = pts[i].x - width / 2;
			const gy = pts[i].y - height / 2;
			const hold = GRAVITY * (1 + degree[i]);
			dx[i] -= gx * hold;
			dy[i] -= gy * hold;
		}

		// Capped at the temperature, so an early round can rearrange the board and a late one can
		// only nudge it. Without the cap the quadratic pull on a long link throws people off the
		// board and the whole thing oscillates instead of settling.
		for (let i = 0; i < n; i++) {
			const travel = Math.hypot(dx[i], dy[i]);
			if (travel < EPSILON) continue;
			const move = Math.min(travel, heat) / travel;
			pts[i].x += dx[i] * move;
			pts[i].y += dy[i] * move;
		}
		heat = Math.max(0, heat - cooling);
	}

	fitInto(pts, box);
	// HOW CLOSE TWO FACES MAY EVER COME, and it is a whole portrait of daylight rather than the
	// hair's breadth `pad` alone leaves. The springs settle on an AVERAGE spacing and say nothing
	// about the worst pair, and the worst pair is what the eye goes to: two portraits all but
	// touching read as one blob with two faces in it, and there is nowhere for the caption on the
	// line between them to sit. `pad` is kept as the floor for a board too full to give more.
	separate(pts, 2 * r + Math.max(pad, 2 * r), box);

	const out = {};
	ids.forEach((id, i) => {
		out[id] = { left: clampPct(pts[i].x), top: clampPct(pts[i].y * ratio) };
	});
	// The people with no lines, evenly round the rim: present, findable, and out of the way of the
	// web. On the outside rather than tucked in a corner, because they are on the map for a reason
	// and somebody will want to draw a line to one of them.
	if (alone.length) {
		alone.forEach((id, i) => {
			const angle = -Math.PI / 2 + (i * 2 * Math.PI) / alone.length;
			out[id] = {
				left: clampPct(50 + rim * Math.cos(angle)),
				top: clampPct(50 + rim * ratio * Math.sin(angle)),
			};
		});
	}
	return out;
}

/** `chordsOf` again, as pairs of indexes into the sorted ids: what the springs pull along. */
function uniqueLinks(graph, ids) {
	const index = new Map(ids.map((id, i) => [id, i]));
	return chordsOf(graph, new Set(ids)).map(([a, b]) => [index.get(a), index.get(b)]);
}

/**
 * Where everybody starts: where they are now, nudged along a spiral.
 *
 * THE NUDGE IS NOT COSMETIC. Every node nobody has placed reads as the exact middle of the board
 * (`clampPct` answers 50 for a missing coordinate, and says why), and a pile of people on one
 * point is a pile where every repulsion is a zero-length vector with no direction in it. Left
 * alone they would sit there for all three hundred rounds. A golden-angle spiral spreads the nudge
 * evenly, is a fixed sequence rather than a random one, and is far smaller than a portrait, so it
 * disturbs nothing on a board that IS placed.
 */
function seedPoints(graph, ids, ratio) {
	return ids.map((id, i) => {
		const node = graph.nodes[id];
		const turn = i * GOLDEN_ANGLE;
		return {
			x: node.x + Math.cos(turn) * SEED_JITTER,
			y: node.y / ratio + Math.sin(turn) * SEED_JITTER,
		};
	});
}

/**
 * The unit vector from `b` to `a` and how far apart they are, never dividing by zero.
 *
 * Two points that have landed on each other have no direction between them, and `salt` is what
 * decides the one they are given: a fixed function of which pair they are, so the same pair is
 * always pushed apart the same way on every client rather than by whatever happened to be in the
 * floating point noise.
 */
function direction(a, b, salt) {
	let ux = a.x - b.x;
	let uy = a.y - b.y;
	let d = Math.hypot(ux, uy);
	if (d < EPSILON) {
		const turn = salt * GOLDEN_ANGLE;
		ux = Math.cos(turn) * EPSILON;
		uy = Math.sin(turn) * EPSILON;
		d = EPSILON;
	}
	return { ux: ux / d, uy: uy / d, d };
}

/**
 * Scale and slide the whole arrangement to fill the board.
 *
 * ONE SCALE FOR BOTH AXES. The springs settle at whatever size the cast and the board's area
 * happen to produce, and it is never quite the board: stretching each axis to fit on its own would
 * squash a group of five into an oval and turn the even spacing the springs worked for into
 * something visibly wrong along one direction. Scaled together and centred, the picture that comes
 * out is the picture the springs found, only bigger.
 *
 * Never scaled UP past what the box can hold, and a degenerate arrangement (everybody on one line,
 * or on one point) is simply centred rather than divided by nothing.
 */
function fitInto(pts, box) {
	let minX = Infinity; let maxX = -Infinity;
	let minY = Infinity; let maxY = -Infinity;
	for (const p of pts) {
		minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
	}
	const spanX = maxX - minX;
	const spanY = maxY - minY;
	const roomX = box.right - box.left;
	const roomY = box.bottom - box.top;
	const scale = Math.min(
		spanX > EPSILON ? roomX / spanX : Infinity,
		spanY > EPSILON ? roomY / spanY : Infinity,
	);
	const grow = Number.isFinite(scale) ? scale : 1;
	const midX = (minX + maxX) / 2;
	const midY = (minY + maxY) / 2;
	const toX = (box.left + box.right) / 2;
	const toY = (box.top + box.bottom) / 2;
	for (const p of pts) {
		p.x = toX + (p.x - midX) * grow;
		p.y = toY + (p.y - midY) * grow;
	}
}

/**
 * Push any two portraits closer than `clear` apart, and keep everybody on the board.
 *
 * The springs settle on an AVERAGE spacing and say nothing about the worst pair, so a knot of five
 * people who all know each other can come out with two faces sitting on one another. This is the
 * last word on that: half the shortfall to each of them, a few dozen rounds, and a clamp back onto
 * the board after each round so the fix cannot push somebody off the edge.
 *
 * It gives up quietly rather than looping. A board with more people than the sheet can hold apart
 * ends up crowded, which is a full board and readable; refusing to lay it out at all would not be.
 */
function separate(pts, clear, box) {
	const n = pts.length;
	for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
		let worst = 0;
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const { ux, uy, d } = direction(pts[i], pts[j], i * n + j);
				if (d >= clear) continue;
				const half = (clear - d) / 2;
				worst = Math.max(worst, half);
				pts[i].x += ux * half; pts[i].y += uy * half;
				pts[j].x -= ux * half; pts[j].y -= uy * half;
			}
		}
		for (const p of pts) {
			p.x = Math.min(box.right, Math.max(box.left, p.x));
			p.y = Math.min(box.bottom, Math.max(box.top, p.y));
		}
		if (worst < EPSILON) break;
	}
}

// ── The one way in ───────────────────────────────────────────────────────────────────

/**
 * Lay a whole board out in the named shape.
 *
 * The single entry point the window calls, so that "which shapes are there" is a question with one
 * answer and adding a third does not mean finding every caller.
 *
 * @param {object} graph    a normalized graph, from `readGraph`.
 * @param {string} shape    one of `RELMAP_SHAPES`; anything else is treated as the ring.
 * @returns {Record<string, {left: number, top: number}>}  where each person goes, by node id.
 */
export function layoutGraph(graph, shape = RELMAP_SHAPE_DEFAULT, options = {}) {
	const opts = { ...layoutRoom(graph), ...options };
	return normalizeShape(shape) === RELMAP_SHAPE_CLUSTERS
		? clusterLayout(graph, opts)
		: ringByRelations(graph, opts);
}

/** How much daylight a line wants beyond the words on it and the two faces at its ends, in flat
 * units. Small: the caption and the portraits are the real claim, and this only keeps the chip from
 * arriving exactly rim to rim. */
const CAPTION_MARGIN = 2;

/**
 * The room this particular board has to lay itself out in.
 *
 * THE ONE PLACE THAT KNOWS THE SHEET GROWS WITH THE CAST. `boardMetrics` says how big the sheet is
 * for this many people and how small a portrait is on it; `graphCapPx` says the width a caption is
 * promised whatever line it lands on; and `room` puts the two together into the thing the springs
 * actually need, which is how long a line has to be for the words riding on it to fit between the
 * two faces. A line drawn that long is a line whose caption never has to overhang it.
 */
function layoutRoom(graph) {
	const board = boardMetrics(Object.keys(graph?.nodes ?? {}).length);
	return {
		aspect: RELMAP_BOARD_ASPECT,
		r: board.r,
		room: (100 * graphCapPx(graph)) / board.width + 2 * board.r + CAPTION_MARGIN,
	};
}
