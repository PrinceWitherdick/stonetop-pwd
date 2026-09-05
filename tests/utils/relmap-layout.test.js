import { describe, it, expect } from "vitest";
import {
	RELMAP_SHAPE_CLUSTERS, RELMAP_SHAPE_RING, clusterLayout, layoutGraph, normalizeShape,
	ringByRelations, ringCrossings, seatOrder,
} from "../../module/utils/relmap-layout.js";
import { nodeRadiusPct } from "../../module/utils/relmap-geometry.js";
import { ASPECT, apart, graphOf as boardOf } from "../fakes/relmap-graph.js";

// Where the portraits GO. What is proven here is the claim the feature rests on: that seating
// people by who knows whom crosses fewer lines than seating them in the order they were added,
// which is the whole reason any of this replaced a plain ring.

const R = nodeRadiusPct(72, 1200); // 3% of the board's width

/** The distance the EYE sees between two portraits, which is not the distance the numbers say. */
const seen = apart;

/**
 * This file's links are bare pairs and its seats arrive as a `places` map; the stored shape is
 * tests/fakes/relmap-graph.js. Everybody starts in the middle unless the caller says otherwise,
 * which is what an unplaced board actually looks like: `clampPct` reads a missing coordinate as 50.
 */
const graphOf = (ids, pairs = [], places = {}) =>
	boardOf(ids.map(id => [id, places[id] ? { x: places[id].x, y: places[id].y } : {}]), pairs);

/** Seats laid round a ring in a given order, which is what the board looked like BEFORE. */
function seatEveryone(ids) {
	const places = {};
	ids.forEach((id, i) => {
		const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ids.length;
		places[id] = { x: 50 + 34 * Math.cos(angle), y: 50 + 34 * ASPECT * Math.sin(angle) };
	});
	return places;
}

/** A ring of people who each know the next one round, but whose IDS run in a different order from
 * the ring: sorted by id they interleave, which is exactly what adding people to a map in the
 * order they came up at the table produces. */
function tangledCycle() {
	const ids = ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7"];
	const round = ["n0", "n2", "n4", "n6", "n1", "n3", "n5", "n7"];
	const pairs = round.map((id, i) => [id, round[(i + 1) % round.length]]);
	return { ids, round, graph: graphOf(ids, pairs, seatEveryone(ids)) };
}

describe("seating people round the ring by who knows whom", () => {
	it("untangles a ring of neighbours that was seated in the order people were added", () => {
		const { ids, graph } = tangledCycle();
		// Sorted ids is what the board had: `_tidy` used to hand `Object.keys` straight to the ring.
		const before = ringCrossings(ids, graph);
		const after = ringCrossings(seatOrder(graph, { aspect: ASPECT }), graph);
		expect(before).toBeGreaterThan(0);
		expect(after).toBe(0);
	});

	it("gives the same answer twice, because a shared board must not re-deal itself", () => {
		// The reason this is a test and not a comment: everybody at the table is looking at this
		// map, and one person pressing Tidy up has to produce the picture everybody else's client
		// would have produced. A walk over an unsorted key set is all it would take to break it.
		const { graph } = tangledCycle();
		const once = seatOrder(graph, { aspect: ASPECT });
		const twice = seatOrder(graph, { aspect: ASPECT });
		expect(twice).toEqual(once);
	});

	it("keeps groups that have nothing to do with each other on their own stretch of ring", () => {
		// Two triangles sharing no link. Interleaving them would cross their lines for nothing, so
		// each has to come out as an unbroken run of seats.
		const ids = ["a1", "a2", "a3", "b1", "b2", "b3"];
		const pairs = [["a1", "a2"], ["a2", "a3"], ["a3", "a1"], ["b1", "b2"], ["b2", "b3"], ["b3", "b1"]];
		const order = seatOrder(graphOf(ids, pairs, seatEveryone(ids)), { aspect: ASPECT });
		const letters = order.map(id => id[0]).join("");
		// One run of each letter, wherever the ring happens to start: doubling the string turns the
		// wrap-around into an ordinary substring.
		expect(`${letters}${letters}`).toMatch(/a{3}b{3}|b{3}a{3}/);
	});

	it("barely moves anybody on a board that is already seated well", () => {
		// The gentleness rule. A cyclic order says nothing about which seat is twelve o'clock or
		// which way round it runs, and spending those two freedoms on matching the board as it
		// stands is what makes Tidy up a button somebody dares press on a map they have arranged.
		const { round, graph } = tangledCycle();
		const settled = graphOf(round, Object.values(graph.edges).map(e => [e.a, e.b]), seatEveryone(round));
		expect(seatOrder(settled, { aspect: ASPECT })).toEqual(round);
	});

	it("has nothing to say about one person, or none", () => {
		expect(seatOrder(graphOf([]), { aspect: ASPECT })).toEqual([]);
		expect(seatOrder(graphOf(["only"]), { aspect: ASPECT })).toEqual(["only"]);
	});

	it("seats people nobody has drawn a line to rather than dropping them", () => {
		const ids = ["a", "b", "lonely"];
		const order = seatOrder(graphOf(ids, [["a", "b"]], seatEveryone(ids)), { aspect: ASPECT });
		expect(order.slice().sort()).toEqual(ids);
	});
});

describe("the ring itself", () => {
	it("gives every person a seat, and puts none of them off the board", () => {
		const { ids, graph } = tangledCycle();
		const seats = ringByRelations(graph, { aspect: ASPECT, r: R });
		expect(Object.keys(seats).sort()).toEqual(ids.slice().sort());
		for (const spot of Object.values(seats)) {
			expect(spot.left).toBeGreaterThanOrEqual(0);
			expect(spot.left).toBeLessThanOrEqual(100);
			expect(spot.top).toBeGreaterThanOrEqual(0);
			expect(spot.top).toBeLessThanOrEqual(100);
		}
	});

	it("sits people who are linked nearer each other than people who are not", () => {
		const { round, graph } = tangledCycle();
		const seats = ringByRelations(graph, { aspect: ASPECT, r: R });
		// Every neighbour in the cycle is a neighbour on the ring, so the longest link is shorter
		// than the distance across it.
		const links = round.map((id, i) => seen(seats[id], seats[round[(i + 1) % round.length]]));
		const across = seen(seats[round[0]], seats[round[4]]);
		expect(Math.max(...links)).toBeLessThan(across);
	});
});

describe("pulling people into groups by their links", () => {
	/** Two households who each know their own and nobody else's. */
	const twoHouses = () => {
		const ids = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"];
		const pairs = [];
		for (const side of ["a", "b"]) {
			for (let i = 1; i <= 4; i++) {
				for (let j = i + 1; j <= 4; j++) pairs.push([`${side}${i}`, `${side}${j}`]);
			}
		}
		return graphOf(ids, pairs, seatEveryone(ids));
	};

	it("ends with everybody nearer their own household than anybody else's", () => {
		const seats = clusterLayout(twoHouses(), { aspect: ASPECT, r: R });
		const side = letter => Object.entries(seats).filter(([id]) => id[0] === letter).map(([, s]) => s);
		let widest = 0;
		for (const group of [side("a"), side("b")]) {
			for (const p of group) for (const q of group) widest = Math.max(widest, seen(p, q));
		}
		let nearest = Infinity;
		for (const p of side("a")) for (const q of side("b")) nearest = Math.min(nearest, seen(p, q));
		expect(widest).toBeLessThan(nearest);
	});

	// A WHOLE PORTRAIT OF DAYLIGHT, not the hair's breadth `pad` alone leaves. The springs settle
	// on an average and say nothing about the worst pair, and the worst pair is what the eye goes
	// to: two faces all but touching read as one blob, with nowhere for the caption on the line
	// between them to sit.
	it("leaves a portrait's width of daylight between the closest two faces", () => {
		const seats = Object.values(clusterLayout(twoHouses(), { aspect: ASPECT, r: R }));
		for (let i = 0; i < seats.length; i++) {
			for (let j = i + 1; j < seats.length; j++) {
				expect(seen(seats[i], seats[j])).toBeGreaterThanOrEqual(4 * R - 0.01);
			}
		}
	});

	it("keeps everybody on the board", () => {
		for (const spot of Object.values(clusterLayout(twoHouses(), { aspect: ASPECT, r: R }))) {
			expect(spot.left).toBeGreaterThanOrEqual(R);
			expect(spot.left).toBeLessThanOrEqual(100 - R);
			expect(spot.top).toBeGreaterThanOrEqual(R * ASPECT);
			expect(spot.top).toBeLessThanOrEqual(100 - R * ASPECT);
		}
	});

	it("gives the same answer twice, from the same board", () => {
		const graph = twoHouses();
		expect(clusterLayout(graph, { aspect: ASPECT, r: R }))
			.toEqual(clusterLayout(graph, { aspect: ASPECT, r: R }));
	});

	it("spreads a board where nobody has been placed at all, instead of leaving the pile", () => {
		// Every unplaced person reads as the exact middle, where every force is a zero-length
		// vector: without the seeding nudge they would all still be there at the end.
		const ids = ["p", "q", "r", "s"];
		const seats = clusterLayout(graphOf(ids, [["p", "q"], ["r", "s"]]), { aspect: ASPECT, r: R });
		const spots = Object.values(seats);
		for (let i = 0; i < spots.length; i++) {
			for (let j = i + 1; j < spots.length; j++) {
				expect(seen(spots[i], spots[j])).toBeGreaterThan(2 * R);
			}
		}
	});

	it("puts one person in the middle and nobody nowhere", () => {
		expect(clusterLayout(graphOf(["only"]), { aspect: ASPECT, r: R }))
			.toEqual({ only: { left: 50, top: 50 } });
		expect(clusterLayout(graphOf([]), { aspect: ASPECT, r: R })).toEqual({});
	});
});

describe("which shape a board is in", () => {
	it("reads anything it does not recognise as the ring", () => {
		// Stored data, so it can be a newer version's shape, an older one's, or somebody's typo in
		// the flag inspector. The ring is what every board built before the shapes existed IS.
		for (const bad of [null, undefined, "", "spiral", 7, {}]) {
			expect(normalizeShape(bad)).toBe(RELMAP_SHAPE_RING);
		}
		expect(normalizeShape(RELMAP_SHAPE_CLUSTERS)).toBe(RELMAP_SHAPE_CLUSTERS);
	});

	it("sends each shape to its own layout, and an unknown one to the ring", () => {
		const { graph } = tangledCycle();
		const opts = { aspect: ASPECT, r: R };
		expect(layoutGraph(graph, RELMAP_SHAPE_RING, opts)).toEqual(ringByRelations(graph, opts));
		expect(layoutGraph(graph, RELMAP_SHAPE_CLUSTERS, opts)).toEqual(clusterLayout(graph, opts));
		expect(layoutGraph(graph, "nonsense", opts)).toEqual(ringByRelations(graph, opts));
	});
});

describe("counting the crossings", () => {
	it("finds none when every link is between neighbours", () => {
		const ids = ["a", "b", "c", "d"];
		expect(ringCrossings(ids, graphOf(ids, [["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"]]))).toBe(0);
	});

	it("finds the one crossing two diameters make", () => {
		const ids = ["a", "b", "c", "d"];
		expect(ringCrossings(ids, graphOf(ids, [["a", "c"], ["b", "d"]]))).toBe(1);
	});

	it("counts a fan of links between one pair once, not once each", () => {
		// Three lines between the same two people take the same route and cross whatever the
		// first one crosses. Counting them separately would scale the score and hide the real
		// improvements underneath it.
		const ids = ["a", "b", "c", "d"];
		const one = ringCrossings(ids, graphOf(ids, [["a", "c"], ["b", "d"]]));
		const many = ringCrossings(ids, graphOf(ids, [["a", "c"], ["a", "c"], ["a", "c"], ["b", "d"]]));
		expect(many).toBe(one);
	});
});

describe("people nobody has drawn a line to", () => {
	/** One household who all know each other, and four people standing on their own. */
	const withLoners = () => {
		const ids = ["a1", "a2", "a3", "a4", "x1", "x2", "x3", "x4"];
		const pairs = [];
		for (let i = 1; i <= 4; i++) {
			for (let j = i + 1; j <= 4; j++) pairs.push([`a${i}`, `a${j}`]);
		}
		return graphOf(ids, pairs, seatEveryone(ids));
	};
	const loners = seats => ["x1", "x2", "x3", "x4"].map(id => seats[id]);
	const web = seats => ["a1", "a2", "a3", "a4"].map(id => seats[id]);
	const outFrom = spot => Math.hypot(spot.left - 50, (spot.top - 50) / ASPECT);

	// THE REAL DAMAGE THEY DO IS NOT UNTIDINESS. Nothing pulls somebody with no links anywhere, so
	// the springs alone decide where they go by pushing them away from everyone else, and they end
	// up in the far corners. The fit then scales the arrangement to fill the sheet and it is THOSE
	// FOUR it measures, so the whole connected web is squeezed into a ball in the middle to make
	// room for four people standing on their own in the wilderness.
	it("do not squeeze the web into the middle of the sheet", () => {
		const seats = clusterLayout(withLoners(), { aspect: ASPECT, r: R });
		const widest = Math.max(...web(seats).flatMap(p => web(seats).map(q => seen(p, q))));
		// The household spreads across a real share of the board rather than balling up.
		expect(widest).toBeGreaterThan(20);
	});

	it("are put round the rim, where they are findable and out of the way", () => {
		const seats = clusterLayout(withLoners(), { aspect: ASPECT, r: R });
		const rim = loners(seats).map(outFrom);
		// All of them the same distance out, and further out than everybody in the web.
		for (const out of rim) expect(out).toBeCloseTo(rim[0], 1);
		for (const person of web(seats)) expect(outFrom(person)).toBeLessThan(rim[0]);
	});

	it("still get a seat each, and one nobody else has", () => {
		const seats = clusterLayout(withLoners(), { aspect: ASPECT, r: R });
		expect(Object.keys(seats).sort()).toEqual(Object.keys(withLoners().nodes).sort());
		const spots = Object.values(seats);
		for (let i = 0; i < spots.length; i++) {
			for (let j = i + 1; j < spots.length; j++) expect(seen(spots[i], spots[j])).toBeGreaterThan(1);
		}
	});

	// Almost nobody linked to anybody is not a web, and pretending it is would put two people in
	// the middle of an empty sheet with a crowd pressed round the edge.
	it("get an ordinary ring when hardly anyone is linked at all", () => {
		const ids = ["a", "b", "c", "d", "e", "f"];
		const seats = clusterLayout(graphOf(ids, [["a", "b"]], seatEveryone(ids)), { aspect: ASPECT, r: R });
		expect(Object.keys(seats).sort()).toEqual(ids);
		const out = Object.values(seats).map(outFrom);
		for (const d of out) expect(d).toBeCloseTo(out[0], 1);
	});
});
