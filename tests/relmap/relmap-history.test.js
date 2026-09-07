import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	RELMAP_COALESCE_MS, RELMAP_HISTORY_MAX, RelmapHistory, describeWrite, forgetAllHistory,
	forgetHistory, historyFor, stepPatch,
} from "../../module/relmap/relmap-history.js";
import {
	addEdgePatch, addNodePatch, dropEdgePatch, dropNodePatch, edgePatch, nodePatch, normalizeGraph,
	relmapPath,
} from "../../module/relmap/relmap-store.js";

// TAKING A CHANGE BACK ON THE RELATIONSHIP MAP.
//
// The thing this file is really holding is the decision at the head of relmap-history.js: an undo
// here is a REVERSING WRITE of leaf paths, not a saved copy of the board written back over
// everybody else's evening. So most of what is asserted below is about a step recorded against one
// board and applied against a DIFFERENT one — the board as four people at a table left it while the
// reader was deciding to press undo.

const PREFIX = relmapPath();

/** Two people and one line between them. */
function graph(over = {}) {
	return normalizeGraph({
		nodes: {
			elena: { uuid: "Actor.a1", name: "Elena", img: "e.webp", x: 20, y: 30 },
			stefan: { uuid: "Actor.b2", name: "Stefan", img: "s.webp", x: 70, y: 30 },
		},
		// ⚠ THE LINE CARRIES A SIZE OF ITS OWN, which is not decoration in a fixture. Putting a
		// rubbed-out line back is a deep comparison against every field an edge has, so a field
		// added to the store and forgotten in `addEdgePatch` fails HERE -- the line comes back
		// looking right and set in the ordinary size, with nothing else in the suite to notice.
		edges: { link1: { a: "elena", b: "stefan", label: "exes", ink: "rose", size: 18 } },
		...over,
	});
}

/** What the board looks like once a patch has landed on it, near enough for these tests: the
 * document's own merge, spelled out. Only the `-=` deletion form, which is what this suite's core
 * generation produces; the v14 form has its own test below. */
function afterPatch(graph, patch) {
	const next = foundry.utils.deepClone(graph);
	for (const [key, value] of Object.entries(patch)) {
		const parts = key.slice(`${PREFIX}.`.length).split(".");
		const leaf = parts[parts.length - 1];
		if (leaf.startsWith("-=")) {
			delete next[parts[0]][leaf.slice(2)];
			continue;
		}
		if (parts.length === 1) { next[parts[0]] = value; continue; }
		const [kind, id, field] = parts;
		next[kind][id] ??= {};
		next[kind][id][field] = value;
	}
	return normalizeGraph(next);
}

describe("what one write does, and what would put it back", () => {
	it("puts a moved portrait back where it was found", () => {
		const before = graph();
		const patch = nodePatch("elena", { x: 80, y: 90 });
		const change = describeWrite(before, patch);
		const after = afterPatch(before, patch);
		expect(after.nodes.elena.x).toBe(80);

		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.nodes.elena.x).toBe(20);
		expect(back.nodes.elena.y).toBe(30);
		// And nobody else was touched on the way.
		expect(back.nodes.stefan).toEqual(before.nodes.stefan);
	});

	// THE TEST THE WHOLE DESIGN EXISTS FOR. A step that saved the graph would put this board back
	// as it was including Stefan, who somebody else moved in the meantime.
	it("leaves alone what somebody else changed while the reader was deciding", () => {
		const before = graph();
		const change = describeWrite(before, nodePatch("elena", { x: 80, y: 90 }));
		// Elena moved, and then somebody at the far end of the table moved Stefan and drew a line.
		let live = afterPatch(before, nodePatch("elena", { x: 80, y: 90 }));
		live = afterPatch(live, nodePatch("stefan", { x: 5, y: 5 }));
		live = afterPatch(live, addEdgePatch("link2", { a: "elena", b: "stefan", label: "rivals" }));

		const back = afterPatch(live, stepPatch(live, change.back));
		expect(back.nodes.elena.x).toBe(20);
		expect(back.nodes.stefan.x).toBe(5);
		expect(back.edges.link2.label).toBe("rivals");
	});

	it("puts a caption back, and only the fields that were written", () => {
		const before = graph();
		const change = describeWrite(before, edgePatch("link1", { label: "friends" }));
		const after = afterPatch(before, edgePatch("link1", { label: "friends" }));

		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.edges.link1.label).toBe("exes");
		expect(back.edges.link1.ink).toBe("rose");
	});
});

describe("making and unmaking", () => {
	it("takes a newly added person off again", () => {
		const before = graph();
		const patch = addNodePatch("dam1", { uuid: "Actor.c3", name: "Damon", x: 50, y: 50 });
		const change = describeWrite(before, patch);
		const after = afterPatch(before, patch);
		expect(after.nodes.dam1.name).toBe("Damon");

		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.nodes.dam1).toBeUndefined();
		expect(Object.keys(back.nodes).sort()).toEqual(["elena", "stefan"]);
	});

	// ⚠ THE LINES DRAWN TO THEM SINCE COME OFF TOO. The step names only the person, because when it
	// was recorded that was all there was; the patch is built against the board as it stands.
	it("takes the lines somebody drew to them in the meantime off with them", () => {
		const before = graph();
		const patch = addNodePatch("dam1", { uuid: "Actor.c3", name: "Damon", x: 50, y: 50 });
		const change = describeWrite(before, patch);
		let live = afterPatch(before, patch);
		live = afterPatch(live, addEdgePatch("link9", { a: "dam1", b: "stefan", label: "brothers" }));

		const written = stepPatch(live, change.back);
		expect(Object.keys(written).sort()).toEqual([
			`${PREFIX}.edges.-=link9`, `${PREFIX}.nodes.-=dam1`,
		].sort());
		const back = afterPatch(live, written);
		expect(back.nodes.dam1).toBeUndefined();
		expect(back.edges.link9).toBeUndefined();
		expect(back.edges.link1.label).toBe("exes");
	});

	it("puts a person back whole, with every line that came off with them", () => {
		const before = graph();
		const patch = dropNodePatch(before, "elena");
		const change = describeWrite(before, patch);
		const after = afterPatch(before, patch);
		expect(after.nodes.elena).toBeUndefined();
		expect(after.edges.link1).toBeUndefined();

		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.nodes.elena).toEqual(before.nodes.elena);
		expect(back.edges.link1).toEqual(before.edges.link1);
	});

	it("draws a rubbed-out line again, exactly as it was", () => {
		const before = graph();
		const change = describeWrite(before, dropEdgePatch("link1"));
		const after = afterPatch(before, dropEdgePatch("link1"));

		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.edges.link1).toEqual(before.edges.link1);
	});

	it("goes forward again as well as back", () => {
		const before = graph();
		const change = describeWrite(before, dropEdgePatch("link1"));
		const after = afterPatch(before, dropEdgePatch("link1"));
		const back = afterPatch(after, stepPatch(after, change.back));

		const again = afterPatch(back, stepPatch(back, change.forward));
		expect(again.edges.link1).toBeUndefined();
	});
});

// EVERY ONE OF THESE IS THE BOARD MOVING ON UNDER A STEP, and in every one of them the answer is to
// leave that part out rather than write it.
describe("a board that has moved on underneath the step", () => {
	// ⚠ THE ONE THAT WOULD SHOW. A leaf write creates whatever is missing along its path, so putting
	// `nodes.elena.x` back for somebody taken off the map would put a nameless, faceless portrait on
	// the board holding nothing but coordinates.
	it("refuses to half-create somebody who has been taken off the map", () => {
		const before = graph();
		const change = describeWrite(before, nodePatch("elena", { x: 80, y: 90 }));
		const live = afterPatch(before, dropNodePatch(before, "elena"));

		expect(stepPatch(live, change.back)).toBeNull();
	});

	it("leaves out a line whose other end has left the board", () => {
		const before = graph();
		const change = describeWrite(before, dropNodePatch(before, "elena"));
		// Elena went, and then somebody took Stefan off too.
		let live = afterPatch(before, dropNodePatch(before, "elena"));
		live = afterPatch(live, dropNodePatch(live, "stefan"));

		const back = afterPatch(live, stepPatch(live, change.back));
		expect(back.nodes.elena).toEqual(before.nodes.elena);
		expect(back.edges.link1).toBeUndefined();
	});

	it("has nothing to rub out twice", () => {
		const before = graph();
		const change = describeWrite(before, dropEdgePatch("link1"));
		const live = afterPatch(before, dropEdgePatch("link1"));

		expect(stepPatch(live, change.forward)).toBeNull();
	});

	// Two people pressing Delete on the same person is not an error, and what both of them wanted
	// has happened. There is simply nothing left to put back.
	it("records a deletion of somebody already gone with nothing to restore", () => {
		const before = graph();
		const change = describeWrite(before, dropEdgePatch("gone1"));
		expect(change.forward.drop).toEqual([{ kind: "edges", id: "gone1" }]);
		expect(change.back.make).toEqual([]);
	});
});

describe("what it refuses to record at all", () => {
	// A half-invertible step is an undo button that does most of what it says, which is worse than
	// one that was never offered.
	it("refuses a patch that reaches outside this map's flag", () => {
		expect(describeWrite(graph(), { name: "Elsewhere" })).toBeNull();
		expect(describeWrite(graph(), { "flags.core.sheetClass": "x" })).toBeNull();
	});

	it("refuses a write of a whole half of the graph", () => {
		expect(describeWrite(graph(), { [`${PREFIX}.nodes`]: {} })).toBeNull();
	});

	it("refuses a field this map does not keep", () => {
		expect(describeWrite(graph(), { [`${PREFIX}.nodes.elena.wat`]: 1 })).toBeNull();
	});

	it("refuses an id it would never have written", () => {
		expect(describeWrite(graph(), { [`${PREFIX}.nodes.Actor.a1.x`]: 1 })).toBeNull();
	});

	it("has nothing to say about an empty patch", () => {
		expect(describeWrite(graph(), {})).toBeNull();
		expect(describeWrite(graph(), null)).toBeNull();
	});
});

// The two live cores spell a deletion differently, and a reader that knows only one of them reads
// the other as an ordinary write of `null` — which an undo would then put INTO the document.
describe("both spellings of a deletion", () => {
	const generation = globalThis.game?.release?.generation;
	beforeEach(() => { globalThis.game = { ...globalThis.game, release: { generation: 14 } }; });
	afterEach(() => {
		if (globalThis.game?.release) globalThis.game.release.generation = generation;
	});

	it("reads a v14 ForcedDeletion as a deletion and not as a write", () => {
		const before = graph();
		const patch = dropEdgePatch("link1");
		const [[key, value]] = Object.entries(patch);
		expect(key).toBe(`${PREFIX}.edges.link1`);
		expect(value).toBeInstanceOf(foundry.data.operators.ForcedDeletion);

		const change = describeWrite(before, patch);
		expect(change.forward.drop).toEqual([{ kind: "edges", id: "link1" }]);
		expect(change.back.make[0].data.label).toBe("exes");
	});

	it("reads a v13 -= leaf the same way", () => {
		globalThis.game.release.generation = 13;
		const change = describeWrite(graph(), dropEdgePatch("link1"));
		expect(change.forward.drop).toEqual([{ kind: "edges", id: "link1" }]);
		expect(change.back.make[0].data.label).toBe("exes");
	});
});

describe("the stack itself", () => {
	const change = () => describeWrite(graph(), nodePatch("elena", { x: 80 }));

	it("keeps at least the twenty states that were asked for", () => {
		expect(RELMAP_HISTORY_MAX).toBeGreaterThanOrEqual(20);
	});

	it("drops the oldest once it is full, and never grows past the cap", () => {
		const history = new RelmapHistory({ max: 3 });
		for (const label of ["a", "b", "c", "d"]) history.record({ ...change(), label });
		expect(history.depth).toBe(3);
		expect(history.undoLabel).toBe("d");
		history.commitUndo();
		history.commitUndo();
		history.commitUndo();
		expect(history.canUndo).toBe(false);
	});

	it("moves a change across on an undo, and back again on a redo", () => {
		const history = new RelmapHistory();
		history.record({ ...change(), label: "moving someone" });
		expect(history.canUndo).toBe(true);
		expect(history.canRedo).toBe(false);

		history.commitUndo();
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(true);
		expect(history.redoLabel).toBe("moving someone");

		history.commitRedo();
		expect(history.canUndo).toBe(true);
		expect(history.canRedo).toBe(false);
	});

	// A change made after an undo is a new branch, and there is no longer one "again" to put back.
	it("forgets what was undone the moment a new change is made", () => {
		const history = new RelmapHistory();
		history.record({ ...change(), label: "a" });
		history.commitUndo();
		expect(history.canRedo).toBe(true);
		history.record({ ...change(), label: "b" });
		expect(history.canRedo).toBe(false);
	});

	it("has nothing to hand back when it is empty", () => {
		const history = new RelmapHistory();
		expect(history.peekUndo()).toBeNull();
		expect(history.peekRedo()).toBeNull();
		expect(history.commitUndo()).toBeNull();
		expect(history.undoLabel).toBe("");
	});
});

// ⚠ WITHOUT THIS, TYPING FILLS THE HISTORY: the tie bar writes a caption within a breath of the
// last keystroke, so one phrase is half a dozen writes and twenty steps of real work fall off the
// end of the stack while somebody names a line.
describe("a burst that the reader means as one change", () => {
	let clock;
	const history = () => new RelmapHistory({ now: () => clock });
	const typed = (label) => ({
		...describeWrite(graph(), edgePatch("link1", { label })),
		label: "changing a line",
		coalesce: "edge:link1",
	});

	beforeEach(() => { clock = 1000; });

	it("folds writes to the same thing into one step", () => {
		const stack = history();
		stack.record(typed("f"));
		clock += 200;
		stack.record(typed("fri"));
		clock += 200;
		stack.record(typed("friends"));
		expect(stack.depth).toBe(1);
	});

	// The point of folding is that one press gets back to before the burst STARTED.
	it("keeps the state from before the burst, and replays all of it forward", () => {
		const before = graph();
		const stack = history();
		stack.record(typed("f"));
		clock += 200;
		stack.record(typed("friends"));

		const after = afterPatch(before, edgePatch("link1", { label: "friends" }));
		const back = afterPatch(after, stepPatch(after, stack.peekUndo().back));
		expect(back.edges.link1.label).toBe("exes");

		const again = afterPatch(back, stepPatch(back, stack.peekUndo().forward));
		expect(again.edges.link1.label).toBe("friends");
	});

	// ⚠ A COALESCE KEY NAMES A GESTURE, NOT A FIELD. The tie bar keys every press on a line as
	// `edge:<id>`, so recolouring a line and then dashing it within a breath is ONE step made of two
	// DIFFERENT fields. An undo that remembered only the first write's `back` put the colour back,
	// left the dashes standing, and told the reader it had taken the whole change back.
	it("puts back every field the burst touched, and not only the first", () => {
		const before = graph();
		const stack = history();
		const one = edgePatch("link1", { ink: "slate" });
		stack.record({ ...describeWrite(before, one), coalesce: "edge:link1" });
		const mid = afterPatch(before, one);
		clock += 200;
		const two = edgePatch("link1", { dash: "dotted" });
		stack.record({ ...describeWrite(mid, two), coalesce: "edge:link1" });
		const after = afterPatch(mid, two);
		expect(stack.depth).toBe(1);

		const back = afterPatch(after, stepPatch(after, stack.peekUndo().back));
		expect(back.edges.link1.ink).toBe(before.edges.link1.ink);
		expect(back.edges.link1.dash).toBe(before.edges.link1.dash);

		const again = afterPatch(back, stepPatch(back, stack.peekUndo().forward));
		expect(again.edges.link1.ink).toBe("slate");
		expect(again.edges.link1.dash).toBe("dotted");
	});

	// And the field written twice INSIDE the burst still goes back the whole way, which is what
	// says the fold keeps the EARLIEST value rather than merely the latest one it has not seen.
	it("goes back past every value a field held during the burst", () => {
		const before = graph();
		const stack = history();
		let at = before;
		for (const ink of ["green", "ochre", "crimson"]) {
			const patch = edgePatch("link1", { ink });
			stack.record({ ...describeWrite(at, patch), coalesce: "edge:link1" });
			at = afterPatch(at, patch);
			clock += 200;
		}
		expect(stack.depth).toBe(1);
		const back = afterPatch(at, stepPatch(at, stack.peekUndo().back));
		expect(back.edges.link1.ink).toBe("rose");
	});

	it("starts a new step once the reader has stopped for a moment", () => {
		const stack = history();
		stack.record(typed("f"));
		clock += RELMAP_COALESCE_MS + 1;
		stack.record(typed("friends"));
		expect(stack.depth).toBe(2);
	});

	it("never folds two different things together", () => {
		const stack = history();
		stack.record(typed("f"));
		stack.record({ ...typed("x"), coalesce: "edge:link2" });
		expect(stack.depth).toBe(2);
	});

	// A drag passes no key at all, because a drag is one gesture already and two deliberate drags a
	// second apart are two changes.
	it("never folds a change that did not ask to be folded", () => {
		const stack = history();
		const moved = () => ({
			...describeWrite(graph(), nodePatch("elena", { x: 80 })), label: "moving someone",
		});
		stack.record(moved());
		stack.record(moved());
		expect(stack.depth).toBe(2);
	});
});

// One map is several named boards on several pages, and the reader flicks between them with the tab
// strip. A history shared by all of them would make undo mean "take back whatever I last did,
// wherever I did it".
describe("one history per board", () => {
	beforeEach(() => forgetAllHistory());
	afterEach(() => forgetAllHistory());

	it("hands the same board the same history, and a different board a different one", () => {
		const one = { uuid: "JournalEntry.m1.JournalEntryPage.p1" };
		const two = { uuid: "JournalEntry.m1.JournalEntryPage.p2" };
		expect(historyFor(one)).toBe(historyFor(one));
		expect(historyFor(one)).not.toBe(historyFor(two));
	});

	it("forgets a board that has been rubbed out", () => {
		const page = { uuid: "JournalEntry.m1.JournalEntryPage.p1" };
		const kept = historyFor(page);
		forgetHistory(page);
		expect(historyFor(page)).not.toBe(kept);
	});

	// A handle with no uuid is one nothing could find again; it must not end up sharing a stack with
	// every other such handle under the key `undefined`.
	it("never shares a history between two nameless handles", () => {
		expect(historyFor(null)).not.toBe(historyFor(null));
	});
});
