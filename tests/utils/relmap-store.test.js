import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	RELMAP_DASH_DEFAULT, RELMAP_DIR_DEFAULT, RELMAP_INKS, RELMAP_INK_DEFAULT, RELMAP_LABEL_MAX,
	RELMAP_ORIGIN_MAX, RELMAP_SEAT_AUTO, RELMAP_SEAT_MAX, RELMAP_SEAT_MIN,
	RELMAP_SIZE_MAX, RELMAP_SIZE_MIN, RELMAP_SIZE_NONE, RELMAP_VERSION,
	addEdgePatch, addNodePatch, dropEdgePatch, dropNodePatch, edgePatch, edgesBetween,
	edgesTouching, emptyGraph, fanIndexes, isImportedEdge, isSafeId, nodePatch, normalizeGraph,
	readSeat, relmapPath,
} from "../../module/relmap/relmap-store.js";
import { RELMAP_CAPTION_PX } from "../../module/utils/relmap-geometry.js";

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
	// ⚠ ABSENT READS AS SOLID, which is every line on every board drawn before the field existed.
	// Nothing migrates, and nothing has to: a map written last season opens exactly as it looked.
	it("reads a line with no stroke recorded as a solid one", () => {
		const read = normalizeGraph({
			nodes: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } },
			edges: { link1: { a: "a", b: "b" }, link2: { a: "a", b: "b", dash: "spotty" } },
		});
		expect(read.edges.link1.dash).toBe(RELMAP_DASH_DEFAULT);
		expect(read.edges.link2.dash).toBe(RELMAP_DASH_DEFAULT);
	});

	it("keeps a stroke somebody broke by hand", () => {
		const read = normalizeGraph({
			nodes: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } },
			edges: { link1: { a: "a", b: "b", dash: "dotted" } },
		});
		expect(read.edges.link1.dash).toBe("dotted");
	});

	// ⚠ THE SAME PROMISE FOR THE WRITING'S SIZE: a board drawn before anybody could ask for a
	// bigger caption reads as one whose lines are all set in whatever the sheet sets.
	it("reads a line with no size recorded as having none of its own", () => {
		const read = normalizeGraph({
			nodes: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } },
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
			nodes: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } },
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

	// THE NINTH ANSWER, in the same field as the eight because a colour and "which of the eight" are
	// one question. What is checked on the way through is the SHAPE and nothing else: this runs on
	// every read of every map with no document to measure against, and it is the gate between stored
	// data and a `style` attribute on the board.
	it("keeps a colour of the reader's own", () => {
		const read = ink => normalizeGraph({
			nodes: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } },
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
			nodes: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } },
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
			nodes: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } },
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
