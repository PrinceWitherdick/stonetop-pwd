import { describe, it, expect } from "vitest";
import { familyPlan } from "../../module/utils/relmap-tree.js";
import {
	RELMAP_KIN_NONE, RELMAP_KIN_PARENT, RELMAP_KIN_PARTNER, RELMAP_KIN_UNSET,
} from "../../module/utils/relmap-kin.js";
import { ASPECT, graphOf as boardOf } from "../fakes/relmap-graph.js";

// The family tree: where the portraits go when the map is read as generations, and what is drawn
// between them.
//
// WHAT IS ACTUALLY BEING CLAIMED, since a chart is easy to eyeball and hard to pin down. Four
// things, and each of them is something a reader would notice instantly if it broke:
//
//  • the eldest generation is at the top and each one below it is lower down the board;
//  • a couple stand side by side with a bar between them, and their children hang under the middle
//    of that bar rather than off one end;
//  • no two portraits are drawn on top of each other; and
//  • the same map gives the same chart every time, on every client, because it is a shared board.

/** This file's ties read `[a, b, kin]`; the stored shape is tests/fakes/relmap-graph.js. */
const graphOf = (people, ties = []) =>
	boardOf(people, ties.map(([a, b, kin]) => [a, b, { kin }]));

/** Three generations: two grandparents, their two daughters, one daughter's husband, and the
 * children of each. The shape a table actually builds, and the one every claim above is about. */
function threeGenerations() {
	return graphOf(["gran", "grandad", "ma", "aunt", "pa", "kid1", "kid2", "cousin"], [
		["gran", "grandad", RELMAP_KIN_PARTNER],
		["gran", "ma", RELMAP_KIN_PARENT],
		["grandad", "ma", RELMAP_KIN_PARENT],
		["gran", "aunt", RELMAP_KIN_PARENT],
		["grandad", "aunt", RELMAP_KIN_PARENT],
		["ma", "pa", RELMAP_KIN_PARTNER],
		["ma", "kid1", RELMAP_KIN_PARENT],
		["pa", "kid1", RELMAP_KIN_PARENT],
		["ma", "kid2", RELMAP_KIN_PARENT],
		["pa", "kid2", RELMAP_KIN_PARENT],
		["aunt", "cousin", RELMAP_KIN_PARENT],
	]);
}

/**
 * Every point a household's stroke passes through.
 *
 * The path is written as subpaths of `M x,y` followed by one `H` or `V`, so the numbers can be read
 * straight back out without a full SVG parser. What the tests want from it is only where the bar
 * runs and how far the rail reaches.
 */
function pointsOf(d) {
	const out = [];
	for (const part of d.split("M").map(piece => piece.trim()).filter(Boolean)) {
		const [start, rest] = part.split(/\s+(?=[HV])/);
		const [x, y] = start.split(",").map(Number);
		out.push({ x, y });
		if (!rest) continue;
		const to = Number(rest.slice(1));
		out.push(rest[0] === "H" ? { x: to, y } : { x, y: to });
	}
	return out;
}

const pathFor = (plan, key) => plan.paths.find(path => path.key === key);

describe("where the family tree stands people", () => {
	it("puts the eldest generation at the top and each one below it further down", () => {
		const plan = familyPlan(threeGenerations());
		expect(plan.rows).toBe(3);
		expect(plan.seats.gran.top).toBeLessThan(plan.seats.ma.top);
		expect(plan.seats.ma.top).toBeLessThan(plan.seats.kid1.top);
		// Sisters share a row; so do all four of the grandchildren.
		expect(plan.seats.aunt.top).toBe(plan.seats.ma.top);
		expect(plan.seats.cousin.top).toBe(plan.seats.kid1.top);
		expect(plan.seats.kid2.top).toBe(plan.seats.kid1.top);
	});

	// A partner marries INTO a generation: `pa` has no recorded parents of his own and would sit at
	// the top on his own, which would draw his children as his siblings' cousins.
	it("seats somebody married in beside their partner, not above them", () => {
		const plan = familyPlan(threeGenerations());
		expect(plan.seats.pa.top).toBe(plan.seats.ma.top);
	});

	it("shows only the people a family line touches, and says how many it is leaving out", () => {
		const graph = graphOf(["ma", "kid", "smith", "miller"], [
			["ma", "kid", RELMAP_KIN_PARENT],
			["smith", "miller", RELMAP_KIN_NONE],
		]);
		const plan = familyPlan(graph);
		expect(plan.people).toEqual(["kid", "ma"]);
		expect(plan.omitted).toBe(2);
	});

	it("has nothing to draw on a map where nobody has marked a tie", () => {
		const plan = familyPlan(graphOf(["a", "b"], [["a", "b", RELMAP_KIN_UNSET]]));
		expect(plan.people).toEqual([]);
		expect(plan.paths).toEqual([]);
		expect(plan.rows).toBe(0);
		expect(plan.omitted).toBe(2);
	});

	// ⚠ A SHARED BOARD. Two people at one table looking at the same map have to be looking at the
	// same chart, so there is no `Math.random` in the layout and every walk is over a sorted copy.
	it("gives the same chart every time it is asked", () => {
		const once = familyPlan(threeGenerations());
		const twice = familyPlan(threeGenerations());
		expect(twice.seats).toEqual(once.seats);
		expect(twice.paths).toEqual(once.paths);
	});

	// The springs and the sifting in relmap-layout.js can afford to leave two faces close together
	// on a web; a chart cannot, because a portrait sitting on another one destroys the one thing a
	// chart is for, which is reading off who is beside whom.
	it("never draws two portraits on top of each other", () => {
		const plan = familyPlan(threeGenerations());
		const seats = plan.people.map(id => plan.seats[id]);
		for (let i = 0; i < seats.length; i++) {
			for (let j = i + 1; j < seats.length; j++) {
				// In FLAT space: a portrait is a circle of fixed pixels, so the same radius covers
				// more percentage points down the board than across it.
				const apart = Math.hypot(
					seats[i].left - seats[j].left,
					(seats[i].top - seats[j].top) / ASPECT,
				);
				expect(apart).toBeGreaterThan(2 * plan.board.r);
			}
		}
	});

	// Two families who share nobody must not be interleaved: every interleaving is a rail from one
	// reaching across the other for nothing.
	it("gives two unrelated families their own stretch of the chart", () => {
		const plan = familyPlan(graphOf(["a1", "a2", "b1", "b2"], [
			["a1", "a2", RELMAP_KIN_PARENT],
			["b1", "b2", RELMAP_KIN_PARENT],
		]));
		const first = [plan.seats.a1.left, plan.seats.a2.left];
		const second = [plan.seats.b1.left, plan.seats.b2.left];
		expect(Math.max(...first)).toBeLessThan(Math.min(...second));
	});

	// A chart nineteen generations tall for three people, because a loop cannot settle. Guarded in
	// `generationOf`; asserted here because this is where it would be seen.
	it("draws a loop of parents as a chart rather than as a tower", () => {
		const plan = familyPlan(graphOf(["a", "b", "c"], [
			["a", "b", RELMAP_KIN_PARENT],
			["b", "c", RELMAP_KIN_PARENT],
			["c", "a", RELMAP_KIN_PARENT],
		]));
		expect(plan.rows).toBe(3);
	});
});

describe("what the family tree draws between them", () => {
	it("runs a bar between two partners, from rim to rim", () => {
		const plan = familyPlan(threeGenerations());
		const bar = pathFor(plan, "gran|grandad");
		expect(bar.couple).toBe(true);
		const [from, to] = pointsOf(bar.d);
		// Level with both faces, and stopping short of each rather than running under them.
		expect(from.y).toBe(plan.seats.gran.top);
		expect(to.y).toBe(plan.seats.gran.top);
		const [leftFace, rightFace] = [plan.seats.gran.left, plan.seats.grandad.left].sort((a, b) => a - b);
		expect(from.x).toBeGreaterThan(leftFace);
		expect(to.x).toBeLessThan(rightFace);
	});

	// THE THING THAT MAKES IT A FAMILY TREE rather than a set of lines: the children hang off the
	// MIDDLE of their parents' bar, and the rail they hang from reaches every one of them.
	it("hangs the children off the middle of their parents, reaching every one", () => {
		const plan = familyPlan(threeGenerations());
		const points = pointsOf(pathFor(plan, "ma|pa").d);
		const xs = points.map(point => point.x);
		// To the precision a stored coordinate keeps: the path rounds, the midpoint of two rounded
		// seats does not.
		const middle = (plan.seats.ma.left + plan.seats.pa.left) / 2;
		expect(xs.some(x => Math.abs(x - middle) < 0.01)).toBe(true);
		expect(Math.min(...xs)).toBeLessThanOrEqual(Math.min(plan.seats.kid1.left, plan.seats.kid2.left));
		expect(Math.max(...xs)).toBeGreaterThanOrEqual(Math.max(plan.seats.kid1.left, plan.seats.kid2.left));
	});

	// ⚠ THE CORNERS HAVE TO BE ON THEIR OWN MIDDLES, and this is the assertion that caught them not
	// being. Giving the room back after the separation sweep by sliding the WHOLE row moves
	// everybody, including the people the sweep never touched: a single child ends up beside their
	// parent rather than below, and every junction on the chart is a corner slightly out of true.
	// Only the people packed shoulder to shoulder owe room back, so only they are slid.
	it("centres a family on its parents, and hangs an only child straight down", () => {
		const plan = familyPlan(threeGenerations());
		// Two children, centred on the bar between their parents.
		const kids = (plan.seats.kid1.left + plan.seats.kid2.left) / 2;
		expect(kids).toBeCloseTo((plan.seats.ma.left + plan.seats.pa.left) / 2, 1);
		// One child, directly under the one parent she has.
		expect(plan.seats.cousin.left).toBeCloseTo(plan.seats.aunt.left, 1);
		// And the sisters sit either side of their own parents' midpoint.
		const sisters = (plan.seats.ma.left + plan.seats.aunt.left) / 2;
		expect(sisters).toBeCloseTo((plan.seats.gran.left + plan.seats.grandad.left) / 2, 1);
	});

	// The rail sits BETWEEN the two rows, so the corners are the same size on both sides and the
	// chart reads as one grid rather than as a set of hooks.
	it("turns the corner between the two rows, not against either of them", () => {
		const plan = familyPlan(threeGenerations());
		const ys = pointsOf(pathFor(plan, "ma|pa").d).map(point => point.y);
		const rail = Math.max(...ys.filter(y => y < plan.seats.kid1.top));
		expect(rail).toBeGreaterThan(plan.seats.ma.top);
		expect(rail).toBeLessThan(plan.seats.kid1.top);
	});

	// A stroke joins as many people as the household has children, so it carries the LIST. That is
	// what lets resting on any one of them light the whole household.
	it("names everybody a household's stroke joins", () => {
		const plan = familyPlan(threeGenerations());
		expect(pathFor(plan, "ma|pa").people.sort()).toEqual(["kid1", "kid2", "ma", "pa"]);
	});

	it("draws a childless couple as their bar and nothing else", () => {
		const plan = familyPlan(graphOf(["a", "b"], [["a", "b", RELMAP_KIN_PARTNER]]));
		expect(plan.paths).toHaveLength(1);
		expect(plan.paths[0].couple).toBe(true);
		expect(pointsOf(plan.paths[0].d)).toHaveLength(2);
	});

	// ⚠ A REMARRIAGE. Seated in the order it was walked, both partners land on the same side and
	// the bar to the further one runs straight through the nearer one's face on its way there.
	it("stands somebody with two partners between them", () => {
		const plan = familyPlan(graphOf(["ma", "pa", "step"], [
			["ma", "pa", RELMAP_KIN_PARTNER],
			["ma", "step", RELMAP_KIN_PARTNER],
		]));
		const others = [plan.seats.pa.left, plan.seats.step.left];
		expect(plan.seats.ma.left).toBeGreaterThan(Math.min(...others));
		expect(plan.seats.ma.left).toBeLessThan(Math.max(...others));
	});
});

describe("the sheet the family tree is drawn on", () => {
	// NOT `boardMetrics`, which sizes a board for how many CAPTIONS it has to find room for. A
	// chart carries none, and wants room for its generations and its widest row instead.
	it("grows the sheet for a deep chart rather than for a large cast", () => {
		const chain = ["a", "b", "c", "d", "e", "f", "g"];
		const plan = familyPlan(graphOf(chain, chain.slice(1).map((id, i) => [chain[i], id, RELMAP_KIN_PARENT])));
		const flat = familyPlan(graphOf(chain, chain.slice(1).map(id => [chain[0], id, RELMAP_KIN_PARENT])));
		expect(plan.rows).toBe(7);
		expect(flat.rows).toBe(2);
		// Same seven people; the tall one needs a taller sheet and the wide one a wider chart.
		expect(plan.board.height).toBeGreaterThan(960);
		expect(flat.board.height).toBe(960);
	});

	// A small family should use the sheet rather than huddle in the middle of it, and should not be
	// flung to its corners either: two people one row apart, spread to fill, are a portrait at each
	// end of the window joined by a line the length of it.
	it("lets a small chart fill the sheet, but only so far", () => {
		const plan = familyPlan(graphOf(["ma", "kid"], [["ma", "kid", RELMAP_KIN_PARENT]]));
		const apart = plan.seats.kid.top - plan.seats.ma.top;
		expect(apart).toBeGreaterThan(10 * plan.board.r);
		expect(apart).toBeLessThan(50);
	});
});
