import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	RELMAP_DASH_DEFAULT, RELMAP_DIR_DEFAULT, RELMAP_INKS, RELMAP_INK_DEFAULT, RELMAP_LABEL_MAX,
	RELMAP_ORIGIN_MAX, RELMAP_SEAT_AUTO, RELMAP_SEAT_MAX, RELMAP_SEAT_MIN,
	RELMAP_SIZE_MAX, RELMAP_SIZE_MIN, RELMAP_SIZE_NONE, RELMAP_SUBTITLE_MAX, RELMAP_VERSION,
	addEdgePatch, addNodePatch, dropEdgePatch, dropNodePatch, edgePatch, edgesBetween,
	edgesTouching, emptyGraph, fanIndexes, isImportedEdge, isSafeId, nodePatch, normalizeGraph,
	pruneDeadPatch, readSeat, relmapPath, seatArrivals, takenSpots, withPersonChange,
} from "../../module/relmap/relmap-store.js";
import { RELMAP_CAPTION_PX, RELMAP_REACH_MAX, RELMAP_REACH_MIN, RELMAP_SUBTITLE_MAX_W, RELMAP_SUBTITLE_REACH_PX } from "../../module/utils/relmap-geometry.js";

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

	// THE SHEET IS NOT A WALL (user, 2026-09-27): a portrait put down off it stays where it was put.
	it("keeps a coordinate off the sheet on the way in", () => {
		const patch = nodePatch("elena", { x: 140, y: -20 });
		expect(patch[`${PREFIX}.nodes.elena.x`]).toBe(140);
		expect(patch[`${PREFIX}.nodes.elena.y`]).toBe(-20);
	});

	it("holds a coordinate past reach to the rail on the way in", () => {
		const patch = nodePatch("elena", { x: 9000, y: -9000 });
		expect(patch[`${PREFIX}.nodes.elena.x`]).toBe(RELMAP_REACH_MAX);
		expect(patch[`${PREFIX}.nodes.elena.y`]).toBe(RELMAP_REACH_MIN);
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

	// ⚠ AND THE SAME GATE ON THE WAY IN, so a patch built from a line still carrying one of the two
	// retired colours cannot write that key back onto the board. See RELMAP_INK_WAS.
	it("writes the replacement rather than a colour that is no longer offered", () => {
		expect(edgePatch("link1", { ink: "teal" })[`${PREFIX}.edges.link1.ink`]).toBe("green");
	});

	// WHETHER THE STROKE IS BROKEN, which is a leaf like every other: two people breaking two
	// different lines both land, and a made-up answer is refused the way a made-up ink is.
	it("writes the stroke as its own leaf, and refuses one it does not know", () => {
		expect(edgePatch("link1", { dash: "dotted" })).toEqual({
			[`${PREFIX}.edges.link1.dash`]: "dotted",
		});
		expect(edgePatch("link1", { dash: "squiggly" })[`${PREFIX}.edges.link1.dash`])
			.toBe(RELMAP_DASH_DEFAULT);
	});

	// HOW BIG THE WRITING IS SET, which is a number rather than a key and is the one field on a
	// line that is stored as the ABSENCE of the ordinary answer. See RELMAP_SIZES.
	it("writes a chosen size as its own leaf, and the ordinary size as none", () => {
		expect(edgePatch("link1", { size: 18 })).toEqual({
			[`${PREFIX}.edges.link1.size`]: 18,
		});
		expect(edgePatch("link1", { size: RELMAP_CAPTION_PX })[`${PREFIX}.edges.link1.size`])
			.toBe(RELMAP_SIZE_NONE);
	});

	it("holds a wild size to the bounds, and drops what is not a size at all", () => {
		expect(edgePatch("link1", { size: 500 })[`${PREFIX}.edges.link1.size`])
			.toBe(RELMAP_SIZE_MAX);
		expect(edgePatch("link1", { size: 2 })[`${PREFIX}.edges.link1.size`])
			.toBe(RELMAP_SIZE_MIN);
		expect(edgePatch("link1", { size: "huge" })[`${PREFIX}.edges.link1.size`])
			.toBe(RELMAP_SIZE_NONE);
	});

	it("writes a whole person when somebody is added", () => {
		const patch = addNodePatch("elena", { uuid: "Actor.a1", name: "Elena", x: 20, y: 30 });
		expect(Object.keys(patch).sort()).toEqual([
			`${PREFIX}.nodes.elena.img`, `${PREFIX}.nodes.elena.name`, `${PREFIX}.nodes.elena.note`,
			`${PREFIX}.nodes.elena.subtitle`, `${PREFIX}.nodes.elena.side`, `${PREFIX}.nodes.elena.italic`,
			`${PREFIX}.nodes.elena.uuid`, `${PREFIX}.nodes.elena.x`, `${PREFIX}.nodes.elena.y`,
		].sort());
	});

	// ⚠ THE LABEL IS WRITTEN WHOLE ON AN ADD, because undoing a removal puts somebody back through
	// `addNodePatch`: left out, "Deceased" would not come back with Simon.
	it("writes the label under a person's name with them, and cuts a long one short", () => {
		const patch = addNodePatch("simon", { name: "Simon", subtitle: "Deceased" });
		expect(patch[`${PREFIX}.nodes.simon.subtitle`]).toBe("Deceased");
		expect(addNodePatch("simon", { name: "Simon" })[`${PREFIX}.nodes.simon.subtitle`]).toBe("");
		const long = nodePatch("simon", { subtitle: "x".repeat(RELMAP_SUBTITLE_MAX + 20) });
		expect(long[`${PREFIX}.nodes.simon.subtitle`]).toHaveLength(RELMAP_SUBTITLE_MAX);
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
			nodes: { elena: { name: "elena", x: 1, y: 1 }, stefan: { name: "stefan", x: 2, y: 2 }, damon: { name: "damon", x: 3, y: 3 } },
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
			nodes: { a: { name: "a", x: 1, y: 1 }, b: { name: "b", x: 2, y: 2 }, c: { name: "c", x: 3, y: 3 } },
			edges: { e1: { a: "a", b: "b" }, e2: { a: "c", b: "a" }, e3: { a: "b", b: "c" } },
		});
		expect(edgesTouching(g, "a")).toEqual(["e1", "e2"]);
	});

	// AUDIT 2026-11-03 (O6): the dead data that piles up in the flag, read off the RAW flag.
	describe("rubbing out what nothing can bring back", () => {
		const raw = () => ({
			nodes: {
				elena: { uuid: "Actor.a1", name: "Elena", x: 1, y: 1 },
				stefan: { uuid: "Actor.b2", name: "Stefan", x: 2, y: 2 },
				// A stray field left by a move landing after a removal: nobody at all.
				ghost: { x: 5 },
			},
			edges: {
				link1: { a: "elena", b: "stefan" },
				// The race: a line drawn to somebody in the moment they were taken off.
				raced: { a: "elena", b: "damon" },
				toGhost: { a: "ghost", b: "stefan" },
				self: { a: "elena", b: "elena" },
				junk: "not a line",
				"bad.id": { a: "elena", b: "nobody" },
			},
			groups: {
				hunt: { name: "Hunters", members: { elena: true, damon: true } },
				gone: { name: "Empty", members: { damon: true } },
			},
		});

		it("rubs out every line no board can draw, in the v13 spelling", () => {
			expect(pruneDeadPatch(raw())).toEqual({
				[`${PREFIX}.edges.-=raced`]: null,
				[`${PREFIX}.edges.-=toGhost`]: null,
				[`${PREFIX}.edges.-=self`]: null,
				[`${PREFIX}.edges.-=junk`]: null,
			});
		});

		it("and in the v14 one", () => {
			globalThis.game.release.generation = 14;
			const patch = pruneDeadPatch(raw());
			expect(Object.keys(patch)).toContain(`${PREFIX}.edges.raced`);
			expect(patch[`${PREFIX}.edges.raced`]).toBeInstanceOf(foundry.data.operators.ForcedDeletion);
		});

		// ⚠ THE UNDO STILL READS THESE: see `pruneDeadPatch`.
		it("leaves a removed person's membership keys, an emptied group and a faceless node alone", () => {
			const keys = Object.keys(pruneDeadPatch(raw()));
			expect(keys.some(key => key.includes(".groups."))).toBe(false);
			expect(keys.some(key => key.includes(".nodes."))).toBe(false);
		});

		it("answers nothing for a clean map, an empty one, or no map", () => {
			const clean = raw();
			clean.edges = { link1: clean.edges.link1 };
			expect(pruneDeadPatch(clean)).toBeNull();
			expect(pruneDeadPatch(emptyGraph())).toBeNull();
			for (const nothing of [null, undefined, "x", {}, { edges: "x" }]) expect(pruneDeadPatch(nothing)).toBeNull();
		});

		it("leaves a board that reads exactly as it did", () => {
			const before = raw();
			const after = raw();
			for (const key of Object.keys(pruneDeadPatch(before))) delete after.edges[key.split(".-=")[1]];
			expect(normalizeGraph(after)).toEqual(normalizeGraph(before));
		});
	});
});

// AUDIT 2026-11-03 (S3): a newcomer's face is kept off a label under somebody's name.
describe("where the people already standing are", () => {
	it("marks the ones with a label, and nobody else", () => {
		const g = normalizeGraph({
			nodes: {
				elena: { uuid: "Actor.a1", name: "Elena", x: 20, y: 30, subtitle: "Iron Knight" },
				stefan: { uuid: "Actor.b2", name: "Stefan", x: 70, y: 30, subtitle: "   " },
			},
		});
		expect(takenSpots(g)).toEqual([{ left: 20, top: 30, under: RELMAP_SUBTITLE_REACH_PX, across: RELMAP_SUBTITLE_MAX_W / 2 }, { left: 70, top: 30 }]);
	});

	it("seats an arrival off a standing person's label", () => {
		// Where the first arrival on this board goes when the person standing has no label.
		// Just above the top of the outer ring, far enough that the two FACES clear: so the label is
		// all that stands in the way of the newcomer's usual first seat.
		const plain = { uuid: "Actor.a1", name: "Elena", x: 50, y: -4.4 };
		const people = [{ uuid: "Actor.c3", name: "Damon" }];
		const unlabelled = seatArrivals(normalizeGraph({ nodes: { elena: plain } }), people, () => "dam1");
		const labelled = seatArrivals(
			normalizeGraph({ nodes: { elena: { ...plain, subtitle: "Iron Knight" } } }), people, () => "dam1",
		);
		const at = seating => ({ x: seating.nodes.dam1.x, y: seating.nodes.dam1.y });
		expect(at(unlabelled)).toEqual({ x: 50, y: 7.5 });
		expect(at(labelled)).not.toEqual(at(unlabelled));
	});
});

describe("reading a stored map back", () => {
	// ⚠ ABSENT READS AS SOLID, which is every line on every board drawn before the field existed.
	// Nothing migrates, and nothing has to: a map written last season opens exactly as it looked.
	it("reads a line with no stroke recorded as a solid one", () => {
		const read = normalizeGraph({
			nodes: { a: { name: "a", x: 1, y: 1 }, b: { name: "b", x: 2, y: 2 } },
			edges: { link1: { a: "a", b: "b" }, link2: { a: "a", b: "b", dash: "spotty" } },
		});
		expect(read.edges.link1.dash).toBe(RELMAP_DASH_DEFAULT);
		expect(read.edges.link2.dash).toBe(RELMAP_DASH_DEFAULT);
	});

	it("keeps a stroke somebody broke by hand", () => {
		const read = normalizeGraph({
			nodes: { a: { name: "a", x: 1, y: 1 }, b: { name: "b", x: 2, y: 2 } },
			edges: { link1: { a: "a", b: "b", dash: "dotted" } },
		});
		expect(read.edges.link1.dash).toBe("dotted");
	});

	// ⚠ THE SAME PROMISE FOR THE WRITING'S SIZE: a board drawn before anybody could ask for a
	// bigger caption reads as one whose lines are all set in whatever the sheet sets.
	it("reads a line with no size recorded as having none of its own", () => {
		const read = normalizeGraph({
			nodes: { a: { name: "a", x: 1, y: 1 }, b: { name: "b", x: 2, y: 2 } },
			edges: {
				link1: { a: "a", b: "b" },
				link2: { a: "a", b: "b", size: "enormous" },
				link3: { a: "a", b: "b", size: 18 },
			},
		});
		expect(read.edges.link1.size).toBe(RELMAP_SIZE_NONE);
		expect(read.edges.link2.size).toBe(RELMAP_SIZE_NONE);
		expect(read.edges.link3.size).toBe(18);
	});

	// ⚠ THE SAME PROMISE AGAIN FOR WHERE THE WRITING SITS. Zero is not the start of the line, it is
	// "wherever the board puts it" — which is every line on every board drawn before a caption could
	// be dragged, and nearly every line since.
	it("reads a line with no seat recorded as one the board still places", () => {
		const read = normalizeGraph({
			nodes: { a: { name: "a", x: 1, y: 1 }, b: { name: "b", x: 2, y: 2 } },
			edges: {
				link1: { a: "a", b: "b" },
				link2: { a: "a", b: "b", seat: "halfway" },
				link3: { a: "a", b: "b", seat: 0.25 },
			},
		});
		expect(read.edges.link1.seat).toBe(RELMAP_SEAT_AUTO);
		expect(read.edges.link2.seat).toBe(RELMAP_SEAT_AUTO);
		expect(read.edges.link3.seat).toBe(0.25);
	});

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
			nodes: { elena: { name: "elena", x: 1, y: 1 } },
			edges: { ghost: { a: "elena", b: "gone" }, alsoGhost: { a: "nobody", b: "elena" } },
		});
		expect(g.edges).toEqual({});
	});

	it("drops a node whose id could never have been written by this system", () => {
		const g = normalizeGraph({
			nodes: { "Actor.a1": { name: "Actor.a1", x: 1, y: 1 }, elena: { name: "elena", x: 2, y: 2 } },
			edges: { e1: { a: "Actor.a1", b: "elena" } },
		});
		expect(Object.keys(g.nodes)).toEqual(["elena"]);
		expect(g.edges).toEqual({});
	});

	it("keeps only the fields it knows, so junk cannot ride along into a render", () => {
		const g = normalizeGraph({
			nodes: { elena: { name: "elena", x: 1, y: 1, onclick: "alert(1)", __proto__: { evil: true } } },
			edges: {},
		});
		expect(Object.keys(g.nodes.elena).sort())
			.toEqual(["chips", "img", "italic", "name", "note", "side", "subtitle", "uuid", "x", "y"]);
	});

	// ⚠ EMPTY AND NOT ABSENT on every person put down before labels existed: the undo stack records a
	// field only when it can read its old value off this read, so an absent one could not be taken back.
	it("reads every person's label, empty where none was ever written", () => {
		const g = normalizeGraph({
			nodes: {
				elroy: { name: "Lord Elroy", subtitle: "Iron Knight", x: 1, y: 1 },
				simon: { name: "Simon", x: 2, y: 2 },
				vera: { name: "Vera", subtitle: "y".repeat(RELMAP_SUBTITLE_MAX + 5), x: 3, y: 3 },
			},
		});
		expect(g.nodes.elroy.subtitle).toBe("Iron Knight");
		expect(g.nodes.simon.subtitle).toBe("");
		expect(g.nodes.vera.subtitle).toHaveLength(RELMAP_SUBTITLE_MAX);
	});

	// AUDIT 2026-11-02: a label of nothing but spaces drew a blank chip where "Add a label" belongs.
	it("reads a label of only spaces as no label, and trims the ends of a real one", () => {
		const g = normalizeGraph({ nodes: {
			simon: { name: "Simon", subtitle: "   ", x: 1, y: 1 },
			elroy: { name: "Lord Elroy", subtitle: "  Iron Knight ", x: 2, y: 2 },
		} });
		expect(g.nodes.simon.subtitle).toBe("");
		expect(g.nodes.elroy.subtitle).toBe("Iron Knight");
		expect(nodePatch("simon", { subtitle: "  " })[`${PREFIX}.nodes.simon.subtitle`]).toBe("");
	});

	// AUDIT 2026-11-02: a move or a label written by one reader landing just after another took the
	// person off makes the node again out of that one field, and the table saw a blank "Someone".
	it("drops a person who is nobody at all, the leftovers of a write that raced a removal", () => {
		const g = normalizeGraph({
			nodes: {
				elena: { name: "Elena", x: 1, y: 1 },
				raced: { x: 40, y: 40, subtitle: "Squire" },
			},
			edges: { e1: { a: "elena", b: "raced" } },
		});
		expect(Object.keys(g.nodes)).toEqual(["elena"]);
		expect(g.edges).toEqual({});
		// Anybody with an actor, a name or a picture is somebody.
		const kept = normalizeGraph({ nodes: {
			a: { uuid: "Actor.a", x: 1, y: 1 }, b: { img: "b.webp", x: 2, y: 2 }, c: { name: "Cora", x: 3, y: 3 },
		} });
		expect(Object.keys(kept.nodes).sort()).toEqual(["a", "b", "c"]);
	});

	it("reads a person with no actor behind them, which is a real case", () => {
		const g = normalizeGraph({ nodes: { ghost: { name: "The one in the woods", x: 5, y: 5 } } });
		expect(g.nodes.ghost.uuid).toBeNull();
		expect(g.nodes.ghost.name).toBe("The one in the woods");
	});

	// Read back through the sheet's edge, somebody standing off it would be walked onto it at every
	// repaint, which is the invisible wall this was widened to take away.
	it("reads a coordinate off the sheet back where it was stored", () => {
		const g = normalizeGraph({ nodes: { elena: { name: "elena", x: 140, y: -4 } } });
		expect(g.nodes.elena).toMatchObject({ x: 140, y: -4 });
	});

	it("holds a coordinate stored past reach to the rail", () => {
		const g = normalizeGraph({ nodes: { elena: { name: "elena", x: 9000, y: -9000 } } });
		expect(g.nodes.elena).toMatchObject({ x: RELMAP_REACH_MAX, y: RELMAP_REACH_MIN });
	});

	it("keeps every ink it ships and replaces any it does not", () => {
		for (const ink of RELMAP_INKS) {
			const g = normalizeGraph({
				nodes: { a: { name: "a", x: 1, y: 1 }, b: { name: "b", x: 2, y: 2 } },
				edges: { e1: { a: "a", b: "b", ink } },
			});
			expect(g.edges.e1.ink).toBe(ink);
		}
	});

	// THE NINTH ANSWER, in the same field as the eight because a colour and "which of the eight" are
	// one question. What is checked on the way through is the SHAPE and nothing else: this runs on
	// every read of every map with no document to measure against, and it is the gate between stored
	// data and a `style` attribute on the board.
	it("keeps a colour of the reader's own", () => {
		const read = ink => normalizeGraph({
			nodes: { a: { name: "a", x: 1, y: 1 }, b: { name: "b", x: 2, y: 2 } },
			edges: { e1: { a: "a", b: "b", ink } },
		}).edges.e1.ink;
		expect(read("#a1263a")).toBe("#a1263a");
		// Written how a reader types it, stored how the board reads it.
		expect(read("#A1263A")).toBe("#a1263a");
		expect(read("#0af")).toBe("#00aaff");
	});

	// ⚠ AND REFUSES EVERYTHING THAT IS NOT ONE. Whatever comes out of here is written into markup,
	// so a value that is nearly a colour is not repaired into one -- it falls back to the default,
	// which is a line somebody can see and go and fix.
	it("refuses anything that is not a colour rather than putting it on the board", () => {
		const read = ink => normalizeGraph({
			nodes: { a: { name: "a", x: 1, y: 1 }, b: { name: "b", x: 2, y: 2 } },
			edges: { e1: { a: "a", b: "b", ink } },
		}).edges.e1.ink;
		for (const bad of ["red", "#abcd", "rgb(1,2,3)", "#a1263a;x:y", "var(--st-page)"]) {
			expect(read(bad), bad).toBe(RELMAP_INK_DEFAULT);
		}
	});

	// ⚠ THE TWO COLOURS THAT WERE TAKEN AWAY ARE STILL ON EVERY BOARD ALREADY DRAWN. "sage" and
	// "teal" were two greens nobody could tell apart at the zoom a big map is read at; they are
	// gone, and a line drawn in either reads as the one green that replaced them -- everywhere, on
	// every client, with nothing written anywhere. Falling back to the DEFAULT instead would turn
	// somebody's board grey a colour at a time, which is the failure this exists to prevent.
	it("reads the two colours that were taken away as the green that replaced them", () => {
		const read = ink => normalizeGraph({
			nodes: { a: { name: "a", x: 1, y: 1 }, b: { name: "b", x: 2, y: 2 } },
			edges: { e1: { a: "a", b: "b", ink } },
		}).edges.e1.ink;
		expect(read("sage")).toBe("green");
		expect(read("teal")).toBe("green");
		// And a colour that never existed is still the default, which is the other half of the rule.
		expect(read("chartreuse")).toBe(RELMAP_INK_DEFAULT);
	});

});

describe("fanning a pair's links apart", () => {
	const many = () => normalizeGraph({
		nodes: { a: { name: "a", x: 1, y: 1 }, b: { name: "b", x: 2, y: 2 }, c: { name: "c", x: 3, y: 3 } },
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

// ── Where a line came from ───────────────────────────────────────────────────
//
// One stamp, written by the ratings import and by nothing else, so that a reader can put those
// lines away without touching the ones they drew themselves. What matters most here is the
// DEFAULT: an unstamped line is a hand-drawn line, which is what every line on every map written
// before this field existed is, and reading one of those as imported would hide somebody's own work
// behind a checkbox they never ticked.

describe("where a line came from", () => {
	/** A graph with two people and whatever lines a test wants between them. */
	const withEdges = edges => normalizeGraph({
		nodes: {
			elena: { name: "Elena", x: 20, y: 30 },
			stefan: { name: "Stefan", x: 70, y: 30 },
		},
		edges,
	});

	it("reads an unstamped line as somebody's own hand", () => {
		const read = withEdges({ link1: { a: "elena", b: "stefan" } });
		expect(read.edges.link1.src).toBe("");
		expect(isImportedEdge(read.edges.link1)).toBe(false);
	});

	it("keeps the import's stamp, and drops anything else somebody wrote there", () => {
		const read = withEdges({
			pulled: { a: "elena", b: "stefan", src: "hearts" },
			invented: { a: "elena", b: "stefan", src: "whatever" },
		});
		expect(read.edges.pulled.src).toBe("hearts");
		expect(isImportedEdge(read.edges.pulled)).toBe(true);
		expect(read.edges.invented.src).toBe("");
		expect(isImportedEdge(read.edges.invented)).toBe(false);
	});

	// Written in the same breath as the rest of the line, so a line drawn by hand today says so
	// rather than merely failing to say otherwise.
	it("writes an empty source on a line somebody draws", () => {
		expect(addEdgePatch("e1", { a: "aa", b: "bb", label: "exes" })[`${PREFIX}.edges.e1.src`])
			.toBe("");
	});

	it("writes the import's stamp when the import asks for it", () => {
		expect(addEdgePatch("e1", { a: "aa", b: "bb", src: "hearts" })[`${PREFIX}.edges.e1.src`])
			.toBe("hearts");
	});

	// The same guard the ink and the direction beside it carry: nothing but a known answer reaches a
	// world flag, whoever is calling.
	it("refuses to write a source it does not know", () => {
		expect(edgePatch("e1", { src: "sockets" })[`${PREFIX}.edges.e1.src`]).toBe("");
	});
});

// ── WHICH answer a seeded line came from ───────────────────────────────────────────────────────
//
// `src` says the party board drew it; `origin` says which answer. The board matches by that key, so
// an answer is recognised wherever it lands in the list -- counting a list that reorders itself is
// how a board came to draw a second copy of a line and drop the new answer entirely. Opaque here:
// what a key is made of belongs to relmap/relmap-intros.js.

describe("which answer a line was seeded from", () => {
	const withEdges = edges => normalizeGraph({
		nodes: {
			elena: { name: "Elena", x: 20, y: 30 },
			stefan: { name: "Stefan", x: 70, y: 30 },
		},
		edges,
	});

	// EVERY line on every board written before this existed, and every line a reader drew.
	it("reads a line with no key as one that cannot be named", () => {
		expect(withEdges({ link1: { a: "elena", b: "stefan" } }).edges.link1.origin).toBe("");
	});

	it("carries the key back out again, whatever it is made of", () => {
		const read = withEdges({
			seeded: { a: "elena", b: "stefan", src: "intros", origin: "pim::step4::0" },
		});
		expect(read.edges.seeded.origin).toBe("pim::step4::0");
	});

	// A stored key is world data any owner could have written, so it is bounded on the way out like
	// every other string here rather than trusted at whatever length it arrives.
	it("shortens a key somebody stored at absurd length", () => {
		const read = withEdges({
			seeded: { a: "elena", b: "stefan", origin: "k".repeat(500) },
		});
		expect(read.edges.seeded.origin).toHaveLength(RELMAP_ORIGIN_MAX);
	});

	it("writes an empty key on a line somebody draws, and the seeder's key when it asks", () => {
		expect(addEdgePatch("e1", { a: "aa", b: "bb", label: "exes" })[`${PREFIX}.edges.e1.origin`])
			.toBe("");
		expect(addEdgePatch("e1", { a: "aa", b: "bb", origin: "pim::step6::1" })[`${PREFIX}.edges.e1.origin`])
			.toBe("pim::step6::1");
	});

	// The write the ADOPTION makes: one leaf on a line that already exists, so nothing else about
	// it -- a caption the table rewrote, where it sits, who it joins -- is touched.
	it("writes the key on its own, without disturbing the rest of the line", () => {
		const patch = edgePatch("e1", { origin: "pim::step4::2" });
		expect(Object.keys(patch)).toEqual([`${PREFIX}.edges.e1.origin`]);
	});
});

// ── Where along its line a caption sits ────────────────────────────────────────────────────────
//
// The board places every caption for itself, sliding each one along its own line to keep it off the
// others (`spreadLabels`). This is a reader OVERRULING that on one line by dragging the words along
// the stroke, and what is stored is where they let go — nothing else.

describe("where along its line a caption was dragged to", () => {
	const withEdges = edges => normalizeGraph({
		nodes: {
			elena: { name: "Elena", x: 20, y: 30 },
			stefan: { name: "Stefan", x: 70, y: 30 },
		},
		edges,
	});

	// ⚠ THE TEST THIS FIELD MOST NEEDS. Zero has to mean "nobody has said", never "the very start
	// of the line": every line on every board drawn before this gesture existed stores nothing, and
	// a zero read as a position would pile every one of those captions onto a portrait.
	it("reads nothing at all as a seat the board is still free to choose", () => {
		for (const bad of [null, undefined, "", "middle", NaN, 0, -0.4, [], {}]) {
			expect(readSeat(bad)).toBe(RELMAP_SEAT_AUTO);
		}
	});

	it("keeps a seat somebody dragged to, rounded fine enough to land where it was dropped", () => {
		expect(readSeat(0.5)).toBe(0.5);
		expect(readSeat(0.371828)).toBe(0.372);
	});

	// Held to the bounds rather than refused: a slide that went too far is still a gesture, and both
	// ends of a line run under the portraits it joins.
	it("holds a seat off the very ends, where the words would sit on somebody's face", () => {
		expect(readSeat(0.0001)).toBe(RELMAP_SEAT_MIN);
		expect(readSeat(4)).toBe(RELMAP_SEAT_MAX);
	});

	// The same guard every other field on a line carries: nothing but a number this board can seat a
	// caption at reaches a world flag, whoever is calling.
	it("gates a seat on its way into the flag, whatever the caller passed", () => {
		expect(edgePatch("e1", { seat: 0.25 })[`${PREFIX}.edges.e1.seat`]).toBe(0.25);
		expect(edgePatch("e1", { seat: "sideways" })[`${PREFIX}.edges.e1.seat`])
			.toBe(RELMAP_SEAT_AUTO);
	});

	// One leaf, so sliding the words touches neither the caption itself, nor the colour, nor who the
	// line joins — which is what lets two people at the table work on one line at once.
	it("writes the seat on its own, without disturbing the rest of the line", () => {
		expect(Object.keys(edgePatch("e1", { seat: 0.8 }))).toEqual([`${PREFIX}.edges.e1.seat`]);
	});

	// ⚠ AND A LINE IS BORN WITH ITS SEAT WRITTEN, empty. Left unwritten, a line redrawn over an id
	// that had been dragged before — taking back a deletion is exactly that — would inherit the old
	// line's seat and open with its caption somewhere nobody on this board ever put it.
	it("writes an empty seat on a line somebody draws", () => {
		expect(addEdgePatch("e1", { a: "aa", b: "bb", label: "exes" })[`${PREFIX}.edges.e1.seat`])
			.toBe(RELMAP_SEAT_AUTO);
	});

	it("carries a stored seat back out on the way to the board", () => {
		const read = withEdges({
			moved: { a: "elena", b: "stefan", label: "exes", seat: 0.8 },
			untouched: { a: "elena", b: "stefan", label: "still friends" },
		});
		expect(read.edges.moved.seat).toBe(0.8);
		expect(read.edges.untouched.seat).toBe(RELMAP_SEAT_AUTO);
	});
});

// THE PERSON BAR'S UNSAVED CHANGE, laid over the board for painting only.
describe("withPersonChange", () => {
	const board = () => ({
		nodes: { a: { name: "A", subtitle: "Squire", side: "below", italic: true, chips: { dead: true } }, b: { name: "B", chips: {} } },
		chips: { dead: { name: "Dead", icon: "fa-skull", ink: "crimson" }, noble: { name: "Noble", icon: "", ink: "ochre" } },
	});

	it("paints the label, side and italics as changed, tidied, and leaves the board it was given alone", () => {
		const graph = board();
		const out = withPersonChange(graph, "a", { fields: { subtitle: "  Iron   Knight ", side: "left", italic: false } });
		expect(out.nodes.a).toMatchObject({ subtitle: "Iron Knight", side: "left", italic: false });
		expect(graph.nodes.a.subtitle).toBe("Squire");
		expect(out.nodes.b).toBe(graph.nodes.b);
	});

	it("puts chips on and off, defines one the board has never had, and paints changed chips", () => {
		const out = withPersonChange(board(), "a", {
			wear: [{ id: "c9", name: "Outcast", icon: "", ink: "rose" }, { id: "noble", name: "Noble", icon: "", ink: "ochre" }],
			off: ["dead"],
			defs: { noble: { name: "Lord", icon: "fa-crown", ink: "ochre" } },
		});
		expect(out.nodes.a.chips).toEqual({ c9: true, noble: true });
		expect(out.chips.c9).toEqual({ name: "Outcast", icon: "", ink: "rose" });
		expect(out.chips.noble).toEqual({ name: "Lord", icon: "fa-crown", ink: "ochre" });
	});

	it("takes a chip deleted off the board and off everybody wearing it", () => {
		const graph = board();
		graph.nodes.b.chips = { dead: true };
		const out = withPersonChange(graph, "a", { drop: ["dead"] });
		expect(out.chips.dead).toBeUndefined();
		expect(out.nodes.a.chips).toEqual({});
		expect(out.nodes.b.chips).toEqual({});
		expect(graph.nodes.b.chips).toEqual({ dead: true });
	});

	// ⚠ THE BOARD PAINTS `chipLaid`, NOT `chips`: a chip taken off in the bar stayed on the board.
	it("lays out again the chips the board paints, for the person and everybody wearing a chip changed", () => {
		const graph = normalizeGraph({
			nodes: { a: { name: "A", chips: { dead: true } }, b: { name: "B", chips: { dead: true } }, c: { name: "C" } },
			chips: { dead: { name: "Dead", icon: "fa-skull", ink: "crimson" }, noble: { name: "Noble", ink: "ochre" } },
		});
		const laid = node => (node.chipLaid?.rows ?? []).flat().map(chip => chip.name);
		expect(laid(graph.nodes.a)).toEqual(["Dead"]);

		const off = withPersonChange(graph, "a", { off: ["dead"] });
		expect(off.nodes.a.chipLaid).toBeUndefined();
		// And the row count every outline reaches round, which is Stonetop's own (`underReach` reads it).
		expect(off.nodes.a.chipRows).toBeUndefined();
		expect(off.nodes.b.chipRows).toBe(1);
		expect(laid(off.nodes.b)).toEqual(["Dead"]);

		const on = withPersonChange(graph, "c", { wear: [{ id: "noble", name: "Noble", icon: "", ink: "ochre" }] });
		expect(laid(on.nodes.c)).toEqual(["Noble"]);
		expect(on.nodes.c.chipRows).toBe(1);

		const renamed = withPersonChange(graph, "a", { defs: { dead: { name: "Fallen", icon: "fa-skull", ink: "crimson" } } });
		expect(laid(renamed.nodes.a)).toEqual(["Fallen"]);
		expect(laid(renamed.nodes.b)).toEqual(["Fallen"]);

		const dropped = withPersonChange(graph, "c", { drop: ["dead"] });
		expect(dropped.nodes.a.chipLaid).toBeUndefined();
		expect(dropped.nodes.b.chipLaid).toBeUndefined();
		expect(dropped.nodes.a.chipRows).toBeUndefined();
		expect(dropped.nodes.b.chipRows).toBeUndefined();
		// And the board read is left as it was: the stored chip comes back once the change is let go.
		expect(laid(graph.nodes.a)).toEqual(["Dead"]);
	});

	it("is the board itself for nobody, or no change", () => {
		const graph = board();
		expect(withPersonChange(graph, "gone", { fields: { subtitle: "X" } })).toBe(graph);
		expect(withPersonChange(graph, "a", null)).toBe(graph);
	});
});
