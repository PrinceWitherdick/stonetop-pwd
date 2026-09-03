import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	RELMAP_DIR_DEFAULT, RELMAP_INKS, RELMAP_INK_DEFAULT, RELMAP_LABEL_MAX, RELMAP_VERSION,
	addEdgePatch, addNodePatch, dropEdgePatch, dropNodePatch, edgePatch, edgesBetween,
	edgesTouching, emptyGraph, fanIndexes, isSafeId, nodePatch, normalizeGraph, relmapPath,
} from "../../module/relmap/relmap-store.js";

// The map's data layer: the only place in the feature that writes a flag path string, and the
// guard that stops an id from destroying the map it is stored in.

const PREFIX = "flags.stonetop-pwd.relationshipMap";

/** A graph with two people and one link between them. */
function graph() {
	return normalizeGraph({
		nodes: {
			elena: { uuid: "Actor.a1", name: "Elena", x: 20, y: 30 },
			stefan: { uuid: "Actor.b2", name: "Stefan", x: 70, y: 30 },
		},
		edges: { link1: { a: "elena", b: "stefan", label: "exes", ink: "rose" } },
	});
}

describe("ids that may be stored", () => {
	// THE TEST THIS FILE EXISTS FOR. Foundry expands dotted keys inside a flag object, so an id
	// carrying a dot is written as a nested tree and matches nothing on the way back out. The node
	// is gone, there is no error, and the map looks like it simply forgot somebody. The obvious
	// future refactor — "let us key nodes by their actor uuid" — walks straight into it.
	it("refuses any id containing a dot", () => {
		for (const bad of ["Actor.a1", "a.b", ".", "node.", "JournalEntry.x.y"]) {
			expect(isSafeId(bad)).toBe(false);
		}
	});

	it("refuses ids that are empty, too long, or not strings at all", () => {
		for (const bad of ["", "x".repeat(65), null, undefined, 7, {}, ["a"], "a b", "a/b"]) {
			expect(isSafeId(bad)).toBe(false);
		}
	});

	it("accepts what randomID actually produces", () => {
		expect(isSafeId(foundry.utils.randomID())).toBe(true);
		expect(isSafeId("node_1")).toBe(true);
		expect(isSafeId("a-b-c")).toBe(true);
	});

	// Every builder, not just the ones a caller happens to remember. A patch that got through here
	// would be written verbatim.
	it("is enforced by every builder, so a bad id can never reach a write", () => {
		const bad = "Actor.a1";
		expect(nodePatch(bad, { x: 1 })).toBeNull();
		expect(edgePatch(bad, { label: "x" })).toBeNull();
		expect(addNodePatch(bad, {})).toBeNull();
		expect(addEdgePatch("ok1", { a: bad, b: "ok2" })).toBeNull();
		expect(addEdgePatch(bad, { a: "ok1", b: "ok2" })).toBeNull();
		expect(dropNodePatch(graph(), bad)).toBeNull();
		expect(dropEdgePatch(bad)).toBeNull();
	});

	// A field name is part of the path too, so it is held to the same rule. Without this a caller
	// could reach any flag in the document by naming a field "-=nodes" or "../core".
	it("refuses a field name that would reach outside its own node", () => {
		const patch = nodePatch("elena", { "x": 5, "-=y": 1, "a.b": 2, "": 3 });
		expect(Object.keys(patch)).toEqual([`${PREFIX}.nodes.elena.x`]);
	});
});

describe("the shape of a write", () => {
	it("writes dotted LEAVES, never the object above them", () => {
		const patch = nodePatch("elena", { x: 12.5, y: 40 });
		expect(patch).toEqual({
			[`${PREFIX}.nodes.elena.x`]: 12.5,
			[`${PREFIX}.nodes.elena.y`]: 40,
		});
		for (const key of Object.keys(patch)) {
			expect(key.endsWith(".nodes")).toBe(false);
			expect(key.endsWith(".elena")).toBe(false);
		}
	});

	// The concurrency story, in one assertion. Two people dragging two portraits at the same moment
	// write disjoint paths, so the server merges both and neither is lost. A patch that wrote the
	// `nodes` object would have one of these clobber the other.
	it("lets two people drag two portraits at once without either losing", () => {
		const mine = nodePatch("elena", { x: 10, y: 10 });
		const theirs = nodePatch("stefan", { x: 90, y: 90 });
		const merged = { ...foundry.utils.flattenObject(mine), ...foundry.utils.flattenObject(theirs) };
		expect(Object.keys(merged)).toHaveLength(4);
		expect(merged[`${PREFIX}.nodes.elena.x`]).toBe(10);
		expect(merged[`${PREFIX}.nodes.stefan.x`]).toBe(90);
	});

	it("clamps a coordinate onto the board on the way in", () => {
		const patch = nodePatch("elena", { x: 140, y: -20 });
		expect(patch[`${PREFIX}.nodes.elena.x`]).toBe(100);
		expect(patch[`${PREFIX}.nodes.elena.y`]).toBe(0);
	});

	it("shortens a runaway label rather than refusing the save", () => {
		const patch = edgePatch("link1", { label: "x".repeat(500) });
		expect(patch[`${PREFIX}.edges.link1.label`]).toHaveLength(RELMAP_LABEL_MAX);
	});

	it("falls back to a known ink and direction rather than storing a made-up one", () => {
		const patch = edgePatch("link1", { ink: "chartreuse", dir: "sideways" });
		expect(patch[`${PREFIX}.edges.link1.ink`]).toBe(RELMAP_INK_DEFAULT);
		expect(patch[`${PREFIX}.edges.link1.dir`]).toBe(RELMAP_DIR_DEFAULT);
	});

	it("writes a whole person when somebody is added", () => {
		const patch = addNodePatch("elena", { uuid: "Actor.a1", name: "Elena", x: 20, y: 30 });
		expect(Object.keys(patch).sort()).toEqual([
			`${PREFIX}.nodes.elena.img`, `${PREFIX}.nodes.elena.name`, `${PREFIX}.nodes.elena.note`,
			`${PREFIX}.nodes.elena.uuid`, `${PREFIX}.nodes.elena.x`, `${PREFIX}.nodes.elena.y`,
		].sort());
	});

	it("refuses a link from somebody to themselves", () => {
		expect(addEdgePatch("link1", { a: "elena", b: "elena" })).toBeNull();
	});

	it("has nothing to write when handed no fields", () => {
		expect(nodePatch("elena", {})).toBeNull();
	});

	it("builds every path off the one prefix", () => {
		expect(relmapPath("nodes", "elena", "x")).toBe(`${PREFIX}.nodes.elena.x`);
		expect(relmapPath()).toBe(PREFIX);
	});
});

// The two live cores disagree about how a key is removed, and the shape this code would naturally
// have been written in — a nested ForcedDeletion inside the flag object — is silently ignored on
// v13. That cost the followers feature its delete, so it is tested on both.
describe("removing things, on both cores", () => {
	const generation = globalThis.game?.release?.generation;
	beforeEach(() => { globalThis.game = { ...globalThis.game, release: { generation: 13 } }; });
	afterEach(() => {
		if (globalThis.game?.release) globalThis.game.release.generation = generation;
	});

	it("deletes with a -= LEAF on v13", () => {
		const patch = dropEdgePatch("link1");
		expect(patch).toEqual({ [`${PREFIX}.edges.-=link1`]: null });
	});

	it("deletes with a ForcedDeletion instance on v14", () => {
		globalThis.game.release.generation = 14;
		const patch = dropEdgePatch("link1");
		const [[key, value]] = Object.entries(patch);
		expect(key).toBe(`${PREFIX}.edges.link1`);
		expect(value).toBeInstanceOf(foundry.data.operators.ForcedDeletion);
	});

	// One write, so there is one broadcast and one repaint. Two writes would show every other
	// client a moment in which the portrait is gone and its lines are still hanging in the air.
	it("takes a person's links with them, in the same update", () => {
		const g = normalizeGraph({
			nodes: { elena: { x: 1, y: 1 }, stefan: { x: 2, y: 2 }, damon: { x: 3, y: 3 } },
			edges: {
				link1: { a: "elena", b: "stefan" },
				link2: { a: "damon", b: "elena" },
				link3: { a: "damon", b: "stefan" },
			},
		});
		const patch = dropNodePatch(g, "elena");
		expect(Object.keys(patch).sort()).toEqual([
			`${PREFIX}.edges.-=link1`, `${PREFIX}.edges.-=link2`, `${PREFIX}.nodes.-=elena`,
		].sort());
		// The link between the two people still standing is untouched.
		expect(Object.keys(patch).some(k => k.includes("link3"))).toBe(false);
	});

	it("finds every link touching somebody, from either end", () => {
		const g = normalizeGraph({
			nodes: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, c: { x: 3, y: 3 } },
			edges: { e1: { a: "a", b: "b" }, e2: { a: "c", b: "a" }, e3: { a: "b", b: "c" } },
		});
		expect(edgesTouching(g, "a")).toEqual(["e1", "e2"]);
	});
});

describe("reading a stored map back", () => {
	it("survives being handed nothing at all", () => {
		for (const bad of [null, undefined, "", 7, [], "wat"]) {
			expect(normalizeGraph(bad)).toEqual(emptyGraph());
		}
		expect(emptyGraph().version).toBe(RELMAP_VERSION);
	});

	// It can happen honestly: one player deletes a portrait while another is mid-draw of a line to
	// it. The delete takes the edges it knew about; this catches the race.
	it("drops a link whose end is not on the map", () => {
		const g = normalizeGraph({
			nodes: { elena: { x: 1, y: 1 } },
			edges: { ghost: { a: "elena", b: "gone" }, alsoGhost: { a: "nobody", b: "elena" } },
		});
		expect(g.edges).toEqual({});
	});

	it("drops a node whose id could never have been written by this system", () => {
		const g = normalizeGraph({
			nodes: { "Actor.a1": { x: 1, y: 1 }, elena: { x: 2, y: 2 } },
			edges: { e1: { a: "Actor.a1", b: "elena" } },
		});
		expect(Object.keys(g.nodes)).toEqual(["elena"]);
		expect(g.edges).toEqual({});
	});

	it("keeps only the fields it knows, so junk cannot ride along into a render", () => {
		const g = normalizeGraph({
			nodes: { elena: { x: 1, y: 1, onclick: "alert(1)", __proto__: { evil: true } } },
			edges: {},
		});
		expect(Object.keys(g.nodes.elena).sort())
			.toEqual(["img", "name", "note", "uuid", "x", "y"]);
	});

	it("reads a person with no actor behind them, which is a real case", () => {
		const g = normalizeGraph({ nodes: { ghost: { name: "The one in the woods", x: 5, y: 5 } } });
		expect(g.nodes.ghost.uuid).toBeNull();
		expect(g.nodes.ghost.name).toBe("The one in the woods");
	});

	it("clamps a coordinate that was stored off the board", () => {
		const g = normalizeGraph({ nodes: { elena: { x: 900, y: -4 } } });
		expect(g.nodes.elena).toMatchObject({ x: 100, y: 0 });
	});

	it("keeps every ink it ships and replaces any it does not", () => {
		for (const ink of RELMAP_INKS) {
			const g = normalizeGraph({
				nodes: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } },
				edges: { e1: { a: "a", b: "b", ink } },
			});
			expect(g.edges.e1.ink).toBe(ink);
		}
	});
});

describe("fanning a pair's links apart", () => {
	const many = () => normalizeGraph({
		nodes: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, c: { x: 3, y: 3 } },
		edges: {
			e3: { a: "a", b: "b", label: "third" },
			e1: { a: "a", b: "b", label: "first" },
			e2: { a: "b", b: "a", label: "drawn the other way round" },
			other: { a: "a", b: "c" },
		},
	});

	// A link drawn from b to a is the same PAIR as one drawn from a to b, so it belongs in the same
	// fan. Miss that and the two lie exactly on top of each other with no way to tell there are two.
	it("counts a link as the same pair whichever way round it was drawn", () => {
		expect(edgesBetween(many(), "a", "b")).toEqual(["e1", "e2", "e3"]);
		expect(edgesBetween(many(), "b", "a")).toEqual(["e1", "e2", "e3"]);
	});

	// Stable, because the order decides how the fan spreads. Read them in whatever order a flag
	// merge happened to leave them and the fan re-deals on every write, so lines nobody touched jump.
	it("orders them the same way every time, whatever order they were stored in", () => {
		expect(fanIndexes(many())).toEqual({ e1: 0, e2: 1, e3: 2, other: 0 });
		expect(fanIndexes(many())).toEqual(fanIndexes(many()));
	});

	it("starts every pair's fan at zero, so one link between two people is straight", () => {
		const g = graph();
		expect(fanIndexes(g).link1).toBe(0);
	});

	it("has nothing to fan on an empty map", () => {
		expect(fanIndexes(emptyGraph())).toEqual({});
		expect(edgesBetween(emptyGraph(), "a", "b")).toEqual([]);
	});
});
