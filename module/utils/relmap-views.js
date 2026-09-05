// The two narrow ways of reading a relationship map: just the party, and just one person's web.
//
// WHY THEY EXIST. The board answers "who at this table knows whom" by drawing all of it at once,
// and past a couple of dozen people that stops being an answer: a table that filled its sheets in
// during the introductions gets a line per rating per direction on top of everything it drew by
// hand, and the picture is a ball of string. The remedy the family tree already found is not a
// better layout, it is a NARROWER QUESTION -- and these are two more of those. "Only the player
// characters, and only the lines between them" is the party seen without the village around them.
// "This person, and everybody with a line straight to them" is what a player actually wants to
// know.
//
// EVERYTHING HERE IS PER-READER AND WRITES NOTHING, which is the rule utils/relmap-tree.js states
// at length and the reason these can be views at all rather than more shapes for Tidy up. Tidy up
// MOVES PEOPLE: it writes everybody's coordinates into the shared document, and the arrangement the
// table has built up over a season is gone. A view derives its seats on the reader's own machine
// each time the board is painted, and the moment they switch back the board is exactly as they and
// everybody else left it. It is also why the portraits are not draggable while one is up: there is
// nowhere for a drag to be remembered.
//
// ⚠ THE SEATS ARE BAKED INTO THE GRAPH, not carried beside it. This is the one thing about this
// module that is not obvious and cannot be got wrong quietly. The board draws its lines with
// `edgeShapes`, which reads a person's position straight off `graph.nodes[id].x` -- so a plan that
// handed back "here is the subgraph, and separately here is where everybody sits" would draw every
// line between the positions people occupy on the REAL board while their faces stand somewhere
// else entirely. Worse, `edgeShapes` has no guard for an end that is missing, so pruning the people
// without also pruning their lines is a TypeError inside `getData` and a window that renders blank.
// `subgraph` therefore prunes both maps in one pass and `reseat` replaces the coordinates, and what
// comes out is an ordinary normalized graph that every other part of the feature can read without
// knowing a view is on: the fan indexes, the caption cap, the clearance dodges and the spreader all
// measure the board that is actually in front of the reader.
//
// ⚠ AND THE SEATS MUST NOT DEPEND ON THE STORED COORDINATES. It is tempting to seat the party ring
// by `layoutGraph`, which minimises crossings and then rotates the result to match where people
// already are. Both halves of that read the shared board: somebody else's drag, and above all
// somebody else pressing Tidy up, arrives here as a repaint that deliberately does NOT re-render
// (the reader keeps the corner they had zoomed into) -- so every portrait would walk to a new seat,
// or the whole ring would mirror, under a reader who is looking straight at it and did nothing.
// The order is therefore the people's own names, tie-broken by id: arbitrary, and the same
// arbitrary answer on every client, every repaint, forever. One fewer crossing on a ring of five is
// not worth a picture that reshuffles when a stranger moves an NPC.

import {
	RELMAP_BOARD_ASPECT, boardMetrics, clampPct, nodeRadiusPct, ratioOf, ringCapacity, ringRadius,
	ringSeats, ringsLayout,
} from "./relmap-geometry.js";

/** The whole board, everybody where somebody put them. The map as it is stored. */
export const RELMAP_VIEW_EVERYONE = "everyone";
/** Only the player characters, and only the lines between two of them. */
export const RELMAP_VIEW_PARTY = "party";
/** One person, everybody with a line straight to them, and only the lines that touch them. */
export const RELMAP_VIEW_FOCUS = "focus";
/** The same map read as generations. Laid out by utils/relmap-tree.js. */
export const RELMAP_VIEW_FAMILY = "family";

/**
 * The four questions this window can be asked, in the order they are offered.
 *
 * `everyone` first because it is the board itself and what somebody opening a map expects to meet;
 * then the two narrow reads, widest first; then the tree, which is the most different thing here
 * and the one a reader goes looking for rather than stumbles into.
 */
export const RELMAP_VIEWS = Object.freeze([
	RELMAP_VIEW_EVERYONE, RELMAP_VIEW_PARTY, RELMAP_VIEW_FOCUS, RELMAP_VIEW_FAMILY,
]);

/** A view name, made safe. Anything unrecognised reads as the whole board, which is the one view
 * that is always drawable. */
export function normalizeView(view) {
	return RELMAP_VIEWS.includes(view) ? view : RELMAP_VIEW_EVERYONE;
}

/** Does this view place its own portraits, rather than showing them where the table put them? */
export function seatsItself(view) {
	return normalizeView(view) !== RELMAP_VIEW_EVERYONE;
}

/**
 * The part of a graph a view is showing: some of the people, and some of the lines between them.
 *
 * BOTH MAPS IN ONE PASS, and that is the whole point of the function. The feature's existing
 * subgraph idiom is `_visibleGraph`'s `{ ...graph, edges }` -- an EDGE filter, with the people left
 * alone. Spelt the mirror way round for a node filter (`{ ...graph, nodes }`) it keeps every line,
 * including the ones now hanging off somebody who is not on the board, and the first thing that
 * reads one of those ends throws. So a line survives only when BOTH of its people did, which is the
 * same rule `normalizeGraph` applies to a stored map for the same reason.
 *
 * @param {object} graph  a normalized graph.
 * @param {Set<string>|Function} keep  which people stay: a set of ids, or `(node, id) => boolean`.
 * @param {Function} [keepEdge]  an extra question asked of each surviving line, `(edge, id) => boolean`.
 */
export function subgraph(graph, keep, keepEdge = null) {
	const wanted = typeof keep === "function" ? keep : (node, id) => keep.has(id);
	const nodes = {};
	for (const [id, node] of Object.entries(graph?.nodes ?? {})) {
		if (wanted(node, id)) nodes[id] = node;
	}
	const edges = {};
	for (const [id, edge] of Object.entries(graph?.edges ?? {})) {
		if (!nodes[edge.a] || !nodes[edge.b]) continue;
		if (keepEdge && !keepEdge(edge, id)) continue;
		edges[id] = edge;
	}
	return { ...graph, nodes, edges };
}

/**
 * The same graph with everybody moved to where this view is putting them.
 *
 * A COPY OF EACH NODE, never a write through to the stored one. These objects come out of
 * `readGraph`, which is a fresh read each time, so mutating them would not reach the document --
 * but it would reach `plan.whole`, which every WRITING path in the window reads, and a person the
 * reader was merely looking at from a distance would be saved back at their computed seat the next
 * time anybody edited anything.
 */
export function reseat(graph, seats) {
	const nodes = {};
	for (const [id, node] of Object.entries(graph?.nodes ?? {})) {
		const spot = seats?.[id];
		nodes[id] = spot ? { ...node, x: clampPct(spot.left), y: clampPct(spot.top) } : node;
	}
	return { ...graph, nodes };
}

/**
 * The order people are seated in, and the one thing about it that matters is that it never changes.
 *
 * ⚠ NOT `seatOrder`, which is what this was called and which relmap-layout.js next door already
 * exports. Both take a graph as their first argument and both answer with an order, so a mixed-up
 * import type-checks and runs: hand THIS one layout's options bag and `[...ids]` throws, but hand
 * THAT one an array of ids and it quietly ignores it and returns a crossing-minimised order of the
 * whole graph instead. The two are opposites on purpose -- that one spends everything on fewest
 * crossings and rotates the result to match the stored board, this one refuses to read the stored
 * board at all so the picture cannot re-deal itself under a reader -- so the names must not be
 * confusable.
 *
 * By the STORED name and then by id. The stored name rather than the live actor's, because a node
 * carries a name even when its actor has been deleted or moved out of reach, and a view that
 * re-ordered itself around whether a lookup happened to resolve would be a view that reshuffles
 * when a compendium is unlocked. The id is the tie-break and it is not optional: a half-written map
 * is full of exact ties (`clampPct` reads a missing coordinate as the middle, so people can share a
 * name as easily as a position), and falling back to object key order means falling back to
 * something relmap-store.js records as not surviving a flag merge -- two readers of one map would
 * see two different rings.
 */
export function stableOrder(graph, ids) {
	return [...ids].sort((a, b) => {
		const an = graph?.nodes?.[a]?.name ?? "";
		const bn = graph?.nodes?.[b]?.name ?? "";
		if (an !== bn) return an < bn ? -1 : 1;
		return a < b ? -1 : 1;
	});
}

/**
 * How big a sheet a narrow view wants: `boardMetrics`, the same rule as the whole board.
 *
 * ⚠ THIS WAS WRITTEN THE OTHER WAY ROUND FIRST, and the reasoning was good and the measurement said
 * no. The argument was: the party view is six people carrying, on any table that pressed "Pull in
 * ratings" during the introductions, up to thirty labelled and arrow-headed lines — the densest link
 * set in the world on the smallest sheet the feature has — so size it by whichever there are more
 * of, people or lines. Measured on a party of 4, 5 and 6 where everybody had rated everybody
 * (z:/tmp/foundry-verify/measure-party-sheet.mjs), that sizing LOSES ON BOTH COUNTS:
 *
 *     party   sized by lines            sized by people (this)
 *       4     1697px, 2 stacked, 6.8px  1200px, 1 stacked, 9.6px
 *       5     2191px, 0 stacked, 5.3px  1200px, 2 stacked, 9.6px
 *       6     2683px, 3 stacked, 4.3px  1200px, 2 stacked, 9.6px
 *
 * The last number is the one that decided it: the window opens with the board FITTED, and stops
 * drawing captions below `CAPTION_FLOOR_PX` (8) of painted type. A sheet grown for the lines opens
 * the party view with no writing on it at all until the reader zooms in — on the one view whose
 * whole purpose is reading back what everybody answered about each other.
 *
 * And the stacking it was meant to buy is not there. Both `spreadLabels` and `edgeCurve` work in
 * percentages of the sheet, so growing it scales the captions and the lines together and the
 * picture is the same picture; only `labelCapPx`, which is in pixels, changes — and on a handful of
 * captions it is not even at its first step. Growing the sheet buys room on a board whose CAST is
 * what fills it. A ring of six is not that board.
 *
 * Kept as a named function rather than inlined, so the measurement above has somewhere to live and
 * so a view can differ later without anybody having to rediscover why.
 */
export function viewBoard(graph) {
	return boardMetrics(Object.keys(graph?.nodes ?? {}).length);
}

/**
 * The most rings the rim will lay before it starts packing tighter instead.
 *
 * LOWER THAN `ringsLayout`'s eight, deliberately, and the difference is not an oversight: that one
 * divides the board's whole radius into however many rings it needs, so its innermost ring can sit
 * anywhere; this one starts at the rim and steps INWARD by a fixed portrait's clearance, and has to
 * stop before it reaches the person standing in the middle. Six such steps is already more rings
 * than any board this system sizes has room for, so the cap is a rail rather than a limit anybody
 * meets. (An earlier comment here claimed the two numbers were the same and must stay so; they were
 * not, and it was measuring a different thing.)
 */
const MAX_RIM_RINGS = 6;

/**
 * Where the people around a focused person stand: rings about the middle, with the middle KEPT FREE.
 *
 * NOT `ringLayout` OR `ringsLayout`, and the reason is their degenerate case rather than a
 * preference. Both answer a count of one with `[{left: 50, top: 50}]` -- the board's centre, which
 * is exactly where the focused person is standing. A focus with one neighbour is the commonest
 * small case there is, and through either of those it comes out as two portraits in a pile with no
 * line between them at all, because `edgeCurve` returns null for two ends in the same place. The
 * whole content of the view, silently missing.
 *
 * OUTERMOST RING FIRST, and each ring a whole portrait's clearance inside the one outside it, so a
 * handful of people come out as the single wide circle a focus view ought to look like and a hub
 * with forty neighbours gets as many rings as there is room for rather than an unreadable band.
 * Alternate rings are turned half a step, so they interleave instead of lining up into spokes.
 *
 * It never refuses: past `MAX_RIM_RINGS` the seats simply pack tighter than ideal, which is a
 * crowded picture rather than a broken one, and the reader can zoom.
 */
export function rimSeats(count, { aspect = RELMAP_BOARD_ASPECT, r = nodeRadiusPct(), pad = 3 } = {}) {
	const n = Math.max(0, Math.trunc(Number(count) || 0));
	if (!n) return [];
	const ratio = ratioOf(aspect);
	const outer = ringRadius(ratio, r, pad);
	const clear = 2 * r + pad;
	// The nearest a rim may come to the middle: a whole portrait of daylight around the person
	// standing there, so the centre is never crowded by its own ring. Never past the board's own
	// edge, which on a tiny sheet with a large portrait is closer in than that clearance.
	const inner = Math.min(outer, clear);
	const room = Math.max(0, outer - inner);
	const rings = Math.max(1, Math.min(MAX_RIM_RINGS, Math.floor(room / Math.max(0.001, clear)) + 1));

	const out = [];
	let left = n;
	for (let i = 0; i < rings && left > 0; i++) {
		// Outermost first, stepping inward by a whole clearance each time; the last ring lands on
		// `inner` exactly when the room divided evenly, and short of it when it did not.
		const radius = rings === 1 ? outer : outer - (room * i) / (rings - 1);
		// The innermost ring takes whatever is left over, however many that is: it is the smallest
		// circle and the one with the least to lose by being tight.
		const here = i === rings - 1 ? left : Math.min(left, ringCapacity(radius, clear));
		const turn = i % 2 ? Math.PI / here : 0;
		out.push(...ringSeats(radius, here, { ratio, turn }));
		left -= here;
	}
	return out;
}

/**
 * Everything the party view needs, worked out from one graph.
 *
 * ONLY THE PLAYER CHARACTERS, and every line whose two ends are both of them. A NARROWING of the
 * board and nothing more: it draws what is there, between the people it keeps.
 *
 * ⚠ IT DOES NOT READ THE INTRODUCTIONS, and briefly did. The answers the party recorded about each
 * other are seeded onto a board of their own ("The Party", relmap/relmap-party.js) as real lines
 * the table can arrange and edit. Deriving the same answers here as well would put two pictures of
 * one thing on the same window, differing in ways nobody could predict from the outside -- which is
 * the crowding these views exist to escape. What is computed belongs in a view; what a table
 * arranges belongs on a page; the introductions are the second of those.
 *
 * WHO COUNTS AS THE PARTY is not decided here: the caller hands in the question. That keeps this
 * module free of `game`, and more importantly it keeps the map from forming a second opinion about
 * who the player characters are -- the same rule the sheets' own reader follows, and for the same
 * reason.
 *
 * @param {object} graph  a normalized graph, from `readGraph`.
 * @param {Function} isParty  `(node, id) => boolean`.
 */
export function partyPlan(graph, isParty) {
	const everyone = Object.keys(graph?.nodes ?? {}).length;
	const kept = subgraph(graph, isParty);
	const people = stableOrder(kept, Object.keys(kept.nodes));
	const board = viewBoard(kept);
	// A ring, and concentric ones past the point where a single one would space people closer than
	// their own portraits are wide. A party is a handful by definition, so this is nearly always the
	// one wide circle -- but "the party" is whatever the caller says it is, and a world where nobody
	// has been assigned a character yet can hand this every character in it.
	const spots = ringsLayout(people.length, { r: board.r, aspect: RELMAP_BOARD_ASPECT });
	const seats = {};
	people.forEach((id, i) => { if (spots[i]) seats[id] = spots[i]; });

	return {
		graph: reseat(kept, seats),
		people,
		seats,
		board,
		omitted: everyone - people.length,
	};
}

/**
 * Everything the focus view needs: one person, their neighbours, and the lines between them.
 *
 * DIRECT LINKS ONLY, in both senses, and the second one is a choice rather than a consequence. The
 * people are those with a line straight to the centre -- that is what "how do I relate to these
 * people" asks. The LINES are only those that touch the centre, so two of the centre's friends can
 * stand side by side on the ring with nothing drawn between them although the shared board has a
 * line there. That is the difference between a star, which can be read at a glance, and a small
 * dense web, which is the thing this view exists to escape. It is also a per-reader view asserting
 * an absence, which is exactly the sort of thing the aside is for: the window says out loud that
 * only the lines touching this person are drawn.
 *
 * A CENTRE THAT IS NOT ON THE MAP is answered honestly rather than guessed around. It happens: the
 * reader picks somebody and another player takes them off the board a minute later, and this runs
 * again inside a repaint. `centre` comes back null, nothing is drawn, and the window has a panel
 * that says so and offers the reader a way out. Quietly re-centring on somebody else would be a
 * view that changes its subject without being asked.
 *
 * @param {object} graph  a normalized graph, from `readGraph`.
 * @param {string|null} centre  whose web to show.
 */
export function focusPlan(graph, centre) {
	const everyone = Object.keys(graph?.nodes ?? {}).length;
	const on = centre && graph?.nodes?.[centre] ? centre : null;
	if (!on) {
		// The SAME sizing rule as every other branch, asked of what is actually drawn -- which is
		// nothing, so it is the plain sheet. Sized by the whole cast instead (which is what this
		// did) the window opens a 3000px board to show one panel, and the surface fits that empty
		// sheet into the viewport at a third of scale for no reason a reader could name.
		const nobody = subgraph(graph, () => false);
		return {
			graph: nobody,
			centre: null, people: [], rim: [], seats: {},
			board: viewBoard(nobody), omitted: everyone,
		};
	}

	const touches = edge => edge.a === on || edge.b === on;
	const near = new Set([on]);
	for (const edge of Object.values(graph.edges ?? {})) {
		if (!touches(edge)) continue;
		// The far end, whichever way the line was drawn. A line from somebody to themselves cannot
		// be stored (`normalizeGraph` drops it), so this is always somebody else.
		near.add(edge.a === on ? edge.b : edge.a);
	}

	const kept = subgraph(graph, near, touches);
	const rim = stableOrder(kept, [...near].filter(id => id !== on));
	const board = viewBoard(kept);
	const seats = { [on]: { left: 50, top: 50 } };
	const spots = rimSeats(rim.length, { r: board.r, aspect: RELMAP_BOARD_ASPECT });
	rim.forEach((id, i) => { if (spots[i]) seats[id] = spots[i]; });

	return {
		graph: reseat(kept, seats),
		centre: on,
		people: [on, ...rim],
		rim,
		seats,
		board,
		omitted: everyone - 1 - rim.length,
	};
}

/**
 * Who the focus view should open on, before the reader has said.
 *
 * A CHAIN, because there is no one answer that is right for everybody at the table, and every link
 * in it resolves THROUGH THE MAP rather than through the world. That is the load-bearing part: this
 * system assigns a full GM's `user.character` to their GM Toolkit actor, which is not somebody who
 * can be on a relationship map at all, and a player may have no character assigned or one that
 * nobody has put on this particular board. Handing back an id that is not a node would open the
 * view on nothing, with no explanation.
 *
 *  1. The reader's own person, if they are on this map. What a player pressing this wants, always.
 *  2. Failing that, whoever has the most lines drawn to them -- the most useful centre any map has,
 *     and the one a GM opening somebody else's board is most likely to want.
 *  3. Failing that (a map with nobody on it), nothing, and the window asks.
 *
 * Ties are broken by id and never by object key order, for the reason `stableOrder` gives.
 *
 * @param {object} graph  a normalized graph.
 * @param {Function} isMine  `(node, id) => boolean` -- is this the reader's own person?
 * @param {boolean} [options.onlyMine]  answer with THEIR person or with nothing, never with the
 *   fallback. What the caller wants when it is about to say "this is your character" beside the
 *   answer: the two questions look alike and are not the same one, and conflating them is how a
 *   stranger gets labelled as somebody's own.
 */
export function defaultCentre(graph, isMine = null, { onlyMine = false } = {}) {
	const ids = Object.keys(graph?.nodes ?? {}).sort();
	if (!ids.length) return null;
	if (isMine) {
		const mine = ids.find(id => isMine(graph.nodes[id], id));
		if (mine) return mine;
	}
	if (onlyMine) return null;
	const degree = new Map(ids.map(id => [id, 0]));
	for (const edge of Object.values(graph.edges ?? {})) {
		if (degree.has(edge.a)) degree.set(edge.a, degree.get(edge.a) + 1);
		if (degree.has(edge.b)) degree.set(edge.b, degree.get(edge.b) + 1);
	}
	let best = ids[0];
	for (const id of ids) if (degree.get(id) > degree.get(best)) best = id;
	return best;
}
