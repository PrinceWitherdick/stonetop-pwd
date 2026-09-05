import { describe, it, expect } from "vitest";
import {
	RELMAP_VIEWS, RELMAP_VIEW_EVERYONE, RELMAP_VIEW_FAMILY, RELMAP_VIEW_FOCUS, RELMAP_VIEW_PARTY,
	defaultCentre, focusPlan, normalizeView, partyPlan, reseat, rimSeats, seatsItself, stableOrder,
	subgraph, viewBoard,
} from "../../module/utils/relmap-views.js";
import { RELMAP_BOARD_WIDTH } from "../../module/utils/relmap-geometry.js";
import { ASPECT, apart, graphOf } from "../fakes/relmap-graph.js";


/** Everybody's seat, off a plan's re-seated graph rather than its `seats`, so the assertions are
 * made against what the board would actually be drawn from. */
const seatsOf = plan => Object.fromEntries(
	Object.entries(plan.graph.nodes).map(([id, node]) => [id, { left: node.x, top: node.y }]),
);

describe("which question a map is being asked", () => {
	it("offers the four views, the whole board first", () => {
		expect(RELMAP_VIEWS[0]).toBe(RELMAP_VIEW_EVERYONE);
		expect([...RELMAP_VIEWS].sort()).toEqual(
			[RELMAP_VIEW_EVERYONE, RELMAP_VIEW_PARTY, RELMAP_VIEW_FOCUS, RELMAP_VIEW_FAMILY].sort(),
		);
	});

	// A view name arrives from a `<select>`, and one day from a newer version of this system that
	// had a fifth. Falling back to the whole board is the one answer that is always drawable.
	it("reads anything it does not know as the whole board", () => {
		expect(normalizeView("nonsense")).toBe(RELMAP_VIEW_EVERYONE);
		expect(normalizeView(undefined)).toBe(RELMAP_VIEW_EVERYONE);
		expect(normalizeView(RELMAP_VIEW_FOCUS)).toBe(RELMAP_VIEW_FOCUS);
	});

	// The question every gate in the window asks, and the reason it is one function: written out
	// as `!== family` at each of the four call sites, a fifth view inherits "yes" from all of them.
	it("says which views place their own portraits", () => {
		expect(seatsItself(RELMAP_VIEW_EVERYONE)).toBe(false);
		expect(seatsItself(RELMAP_VIEW_PARTY)).toBe(true);
		expect(seatsItself(RELMAP_VIEW_FOCUS)).toBe(true);
		expect(seatsItself(RELMAP_VIEW_FAMILY)).toBe(true);
	});
});

describe("taking part of a map", () => {
	// ⚠ THE ONE THAT CRASHES. `edgeShapes` reads an end's `x` with no guard, so a line left behind
	// by a person who was dropped is a TypeError inside `getData` and a window that renders blank.
	it("drops every line whose person went with it", () => {
		const graph = graphOf(["a", "b", "c"], [["a", "b"], ["b", "c"]]);
		const kept = subgraph(graph, new Set(["a", "b"]));
		expect(Object.keys(kept.nodes)).toEqual(["a", "b"]);
		expect(Object.values(kept.edges).map(e => [e.a, e.b])).toEqual([["a", "b"]]);
		for (const edge of Object.values(kept.edges)) {
			expect(kept.nodes[edge.a]).toBeTruthy();
			expect(kept.nodes[edge.b]).toBeTruthy();
		}
	});

	it("takes a question about the people as well as a set", () => {
		const graph = graphOf([["a", { uuid: "Actor.1" }], "b"], [["a", "b"]]);
		expect(Object.keys(subgraph(graph, node => !!node.uuid).nodes)).toEqual(["a"]);
	});

	it("asks the extra question of the lines that survived", () => {
		const graph = graphOf(["a", "b", "c"], [["a", "b"], ["b", "c"]]);
		const kept = subgraph(graph, new Set(["a", "b", "c"]), edge => edge.a === "a");
		expect(Object.values(kept.edges).map(e => [e.a, e.b])).toEqual([["a", "b"]]);
	});

	// The stored graph is what every WRITING path in the window reads. A view that moved people in
	// place would have the reader's private arrangement saved back the next time anybody edited.
	it("re-seats a copy and never the graph it was handed", () => {
		const graph = graphOf(["a"]);
		const moved = reseat(graph, { a: { left: 10, top: 20 } });
		expect(moved.nodes.a.x).toBe(10);
		expect(moved.nodes.a.y).toBe(20);
		expect(graph.nodes.a.x).toBe(50);
		expect(graph.nodes.a.y).toBe(50);
	});

	it("leaves somebody the view had no seat for exactly where they were", () => {
		const moved = reseat(graphOf(["a", "b"]), { a: { left: 10, top: 20 } });
		expect(moved.nodes.b.x).toBe(50);
	});
});

describe("how big a sheet a narrow view wants", () => {
	// ⚠ THE RULE THIS PINS IS THE ONE THAT WAS WRONG FIRST. Sizing the sheet by the LINE count --
	// six players carrying thirty imported arrows is the densest link set in any world -- sounds
	// right and measures worse on both counts: it opens the party view below the caption floor, so
	// there is no writing on it at all until the reader zooms, and it does not even reduce the
	// stacking, because the spreader and the curves are both in percentages of the sheet and scale
	// with it. See the numbers in relmap-views.js.
	it("grows with the people and not with the lines", () => {
		const people = ["a", "b", "c", "d", "e", "f"];
		const pairs = [];
		for (const a of people) for (const b of people) if (a !== b) pairs.push([a, b]);
		expect(viewBoard(graphOf(people, pairs)).width)
			.toBe(viewBoard(graphOf(people, [["a", "b"]])).width);
	});

	// Small enough to open at 1:1 is the whole point: the window fits the board into the viewport,
	// and below eight pixels of painted type it stops drawing captions at all.
	it("still opens a small map at its natural size", () => {
		expect(viewBoard(graphOf(["a", "b"], [["a", "b"]])).width).toBe(RELMAP_BOARD_WIDTH);
		const six = ["a", "b", "c", "d", "e", "f"];
		const pairs = [];
		for (const a of six) for (const b of six) if (a !== b) pairs.push([a, b]);
		expect(viewBoard(graphOf(six, pairs)).width).toBe(RELMAP_BOARD_WIDTH);
	});

	// A focus on somebody half the village is linked to is a genuinely large cast, and gets a
	// genuinely large sheet -- the same answer the whole board would give for the same number.
	it("still grows for a view that really is carrying a crowd", () => {
		const many = Array.from({ length: 40 }, (unused, i) => "n" + i);
		expect(viewBoard(graphOf(many)).width).toBeGreaterThan(RELMAP_BOARD_WIDTH);
	});
});

describe("the ring around a focused person", () => {
	// ⚠ `ringLayout(1)` and `ringsLayout(1)` both answer with the BOARD'S CENTRE, which is exactly
	// where the focused person is standing: the commonest small case there is would have come out
	// as two portraits in a pile with no line between them, because `edgeCurve` returns null for
	// two ends in the same place.
	it("never puts anybody in the middle, not even one person", () => {
		for (const n of [1, 2, 3, 12, 40]) {
			for (const spot of rimSeats(n, { r: 3, aspect: ASPECT })) {
				expect(apart(spot, { left: 50, top: 50 })).toBeGreaterThan(3);
			}
		}
	});

	it("keeps a whole portrait of daylight between neighbours", () => {
		for (const n of [1, 2, 3, 8, 20]) {
			const spots = rimSeats(n, { r: 3, aspect: ASPECT });
			expect(spots).toHaveLength(n);
			for (let i = 0; i < spots.length; i++) {
				for (let k = i + 1; k < spots.length; k++) {
					expect(apart(spots[i], spots[k])).toBeGreaterThan(2 * 3);
				}
			}
		}
	});

	it("stays on the board however many there are", () => {
		for (const spot of rimSeats(60, { r: 1, aspect: ASPECT })) {
			expect(spot.left).toBeGreaterThanOrEqual(0);
			expect(spot.left).toBeLessThanOrEqual(100);
			expect(spot.top).toBeGreaterThanOrEqual(0);
			expect(spot.top).toBeLessThanOrEqual(100);
		}
	});

	it("has nobody to seat when nobody is linked", () => {
		expect(rimSeats(0, { r: 3 })).toEqual([]);
	});
});

describe("the party view", () => {
	const PARTY = new Set(["Actor.pim", "Actor.sela"]);
	const isParty = node => !!node.uuid && PARTY.has(node.uuid);
	const world = () => graphOf([
		["pim", { uuid: "Actor.pim", name: "Pim" }],
		["sela", { uuid: "Actor.sela", name: "Sela" }],
		["ordga", { uuid: "Actor.ordga", name: "Ordga" }],
		["mill", { uuid: null, name: "The mill" }],
	], [
		["pim", "sela", { label: "trusts" }],
		["sela", "pim", { label: "wary of" }],
		["pim", "ordga", { label: "her apprentice" }],
		["ordga", "mill", { label: "keeps it" }],
	]);

	it("keeps the player characters and nobody else", () => {
		const plan = partyPlan(world(), isParty);
		expect(plan.people.sort()).toEqual(["pim", "sela"]);
		expect(Object.keys(plan.graph.nodes).sort()).toEqual(["pim", "sela"]);
		expect(plan.omitted).toBe(2);
	});

	// A NARROWING and nothing more. It draws what is on the board between the people it keeps --
	// including the two opposed arrows a seeded party board carries, which is where the
	// introduction answers live (relmap/relmap-party.js). It does NOT derive those itself: two
	// pictures of one thing on one window is the crowding these views exist to escape.
	it("draws every line the board has between two of them", () => {
		const plan = partyPlan(world(), isParty);
		expect(Object.values(plan.graph.edges).map(e => e.label).sort()).toEqual(["trusts", "wary of"]);
	});

	it("drops the lines that reach outside the party", () => {
		const plan = partyPlan(world(), isParty);
		for (const edge of Object.values(plan.graph.edges)) {
			expect(plan.graph.nodes[edge.a]).toBeTruthy();
			expect(plan.graph.nodes[edge.b]).toBeTruthy();
		}
	});

	// ⚠ THE ONE THAT MATTERS MOST. A repaint arrives every time anybody at the table touches this
	// map, and it deliberately does NOT re-render — the reader keeps the corner they had zoomed
	// into. So a seating that moved when the graph changed would walk every portrait to a new place
	// under a reader who is looking straight at it and did nothing. This is why the ring is not
	// crossing-minimised and not aligned to the stored board.
	it("seats the same people the same way however the rest of the map changes", () => {
		const before = seatsOf(partyPlan(world(), isParty));
		const busier = world();
		busier.nodes.stranger = { uuid: null, name: "A stranger", img: "", x: 12, y: 90, note: "" };
		busier.edges.zz = { a: "ordga", b: "stranger", label: "", ink: "slate", dir: "none", kin: "", src: "", note: "" };
		// And somebody drags a party member clean across the shared board.
		busier.nodes.pim.x = 5;
		busier.nodes.pim.y = 95;
		expect(seatsOf(partyPlan(busier, isParty))).toEqual(before);
	});

	it("gives the same ring every time it is asked", () => {
		const once = partyPlan(world(), isParty);
		const twice = partyPlan(world(), isParty);
		expect(seatsOf(twice)).toEqual(seatsOf(once));
	});

	it("says it is showing nobody rather than pretending, on a map with no player characters", () => {
		const plan = partyPlan(world(), () => false);
		expect(plan.people).toEqual([]);
		expect(Object.keys(plan.graph.edges)).toEqual([]);
		expect(plan.omitted).toBe(4);
	});
});

describe("one person's web", () => {
	const world = () => graphOf(["pim", "sela", "ordga", "mill", "alone"], [
		["pim", "sela", { label: "best friends" }],
		["ordga", "pim", { label: "her apprentice" }],
		["sela", "ordga", { label: "cannot stand her" }],
		["ordga", "mill", { label: "keeps it" }],
	]);

	it("keeps the person, and everybody with a line straight to them", () => {
		const plan = focusPlan(world(), "pim");
		expect(plan.centre).toBe("pim");
		expect(Object.keys(plan.graph.nodes).sort()).toEqual(["ordga", "pim", "sela"]);
		expect(plan.rim.sort()).toEqual(["ordga", "sela"]);
		// `mill` and `alone` are still on the map and come back the moment the view is switched.
		expect(plan.omitted).toBe(2);
	});

	// DIRECT LINKS ONLY, and this is the half that is a choice rather than a consequence: two of
	// the centre's friends stand side by side with nothing drawn between them although the shared
	// board has a line there. That is the difference between a star and a small dense web, and the
	// window says so in the corner.
	it("draws only the lines that touch the person in the middle", () => {
		const plan = focusPlan(world(), "pim");
		const said = Object.values(plan.graph.edges).map(e => e.label).sort();
		expect(said).toEqual(["best friends", "her apprentice"]);
		for (const edge of Object.values(plan.graph.edges)) {
			expect(edge.a === "pim" || edge.b === "pim").toBe(true);
		}
	});

	it("puts the person in the middle and everybody else round them", () => {
		const plan = focusPlan(world(), "pim");
		const seats = seatsOf(plan);
		expect(seats.pim).toEqual({ left: 50, top: 50 });
		for (const id of plan.rim) expect(apart(seats[id], seats.pim)).toBeGreaterThan(plan.board.r);
	});

	// The commonest small case, and the one `ringLayout` would have stacked on the centre.
	it("does not stack a single neighbour on the person they are linked to", () => {
		const plan = focusPlan(graphOf(["a", "b"], [["a", "b"]]), "a");
		const seats = seatsOf(plan);
		expect(apart(seats.a, seats.b)).toBeGreaterThan(2 * plan.board.r);
	});

	// Two readers looking at the same map with the same centre have to be looking at the same
	// picture, and one reader must not find it re-dealt after an unrelated write.
	it("gives the same ring every time, whatever else moves on the board", () => {
		const before = seatsOf(focusPlan(world(), "pim"));
		const moved = world();
		moved.nodes.sela.x = 3;
		moved.nodes.ordga.y = 97;
		moved.nodes.mill.x = 80;
		expect(seatsOf(focusPlan(moved, "pim"))).toEqual(before);
	});

	// It happens: the reader picks somebody and another player takes them off the board a minute
	// later. Answered honestly rather than quietly re-centred on a stranger.
	it("answers with nobody when the person is no longer on the map", () => {
		const plan = focusPlan(world(), "somebody-else");
		expect(plan.centre).toBeNull();
		expect(Object.keys(plan.graph.nodes)).toEqual([]);
		expect(Object.keys(plan.graph.edges)).toEqual([]);
		expect(plan.omitted).toBe(5);
	});

	it("answers with nobody when nobody has been chosen", () => {
		expect(focusPlan(world(), null).centre).toBeNull();
	});

	it("shows somebody nothing is linked to as themselves alone", () => {
		const plan = focusPlan(world(), "alone");
		expect(plan.centre).toBe("alone");
		expect(plan.rim).toEqual([]);
		expect(Object.keys(plan.graph.nodes)).toEqual(["alone"]);
	});
});

describe("who the focus view opens on", () => {
	const world = () => graphOf([
		["pim", { uuid: "Actor.pim" }],
		["sela", { uuid: "Actor.sela" }],
		["ordga", { uuid: "Actor.ordga" }],
	], [
		["sela", "ordga"], ["ordga", "pim"], ["ordga", "sela"],
	]);

	it("opens on the reader's own person when they are on this map", () => {
		expect(defaultCentre(world(), node => node.uuid === "Actor.pim")).toBe("pim");
	});

	// The trap this chain exists for: a full GM's `user.character` is their GM Toolkit actor, which
	// cannot be on a relationship map at all. Falling through to the busiest person is the most
	// useful centre any map has.
	it("falls through to whoever has the most lines when the reader's person is not on it", () => {
		expect(defaultCentre(world(), node => node.uuid === "Actor.toolkit")).toBe("ordga");
	});

	it("falls through when the reader has no person at all", () => {
		expect(defaultCentre(world(), null)).toBe("ordga");
	});

	it("has nobody to offer on a map with nobody on it", () => {
		expect(defaultCentre(graphOf([]), null)).toBeNull();
	});

	// Object key order survives a JSON round trip but not a flag merge, so a tie settled by "the
	// first one" is a tie settled differently on two clients.
	it("breaks a tie by id rather than by whatever order the flag came back in", () => {
		const flat = graphOf(["zed", "abe"]);
		expect(defaultCentre(flat, null)).toBe("abe");
	});
});

// ⚠ NOT CALLED `seatOrder`: relmap-layout.js exports one of those, it also takes a graph first,
// and it is this one's opposite -- crossing-minimised and rotated to match the stored board, where
// this one refuses to read the stored board at all.
describe("the order people are seated in", () => {
	it("goes by name, then by id", () => {
		const graph = graphOf([
			["z", { name: "Ordga" }], ["a", { name: "Sela" }], ["m", { name: "Ordga" }],
		]);
		expect(stableOrder(graph, ["a", "m", "z"])).toEqual(["m", "z", "a"]);
	});

	it("settles a whole board of identical names by id alone", () => {
		const graph = graphOf([["c", { name: "" }], ["a", { name: "" }], ["b", { name: "" }]]);
		expect(stableOrder(graph, ["c", "a", "b"])).toEqual(["a", "b", "c"]);
	});
});
