import { describe, expect, it } from "vitest";
import {
	RELMAP_NODE_PX, RELMAP_PLATE_GAP_PX, RELMAP_SUBTITLE_LINES_MAX, boardBounds, freeSpot, groupFloor, groupOutline,
	personReach, plateReach, sideOf, subtitleLines, underReach,
} from "../../module/utils/relmap-geometry.js";
import {
	RELMAP_SIDES, RELMAP_SUBTITLE_LINES, RELMAP_SUBTITLE_MAX, addNodePatch, nodePatch, normalizeGraph, readItalic, readSide,
	subtitleOf, takenSpots,
} from "../../module/relmap/relmap-store.js";

// WHERE A PERSON'S NAME, LABEL AND CHIPS STAND, A LABEL OF UP TO THREE LINES, AND ITS ITALICS.
// After Dom Bosco's tags pull request (domfortunato), which brought the side, the lines and the Save.

const PREFIX = "flags.stonetop-pwd.relationshipMap";
const board = { width: 1200, height: 800 };
const FACE = RELMAP_NODE_PX / 2;

describe("the label's lines", () => {
	it("keeps each line typed, tidied, and no more than three", () => {
		expect(RELMAP_SUBTITLE_LINES).toBe(3);
		expect(subtitleOf("  The Iron   Knight \n\n Lord of the Vale ")).toBe("The Iron Knight\nLord of the Vale");
		expect(subtitleOf("one\r\ntwo\rthree\nfour")).toBe("one\ntwo\nthree");
		expect(subtitleOf("   \n  ")).toBe("");
		expect(subtitleOf(null)).toBe("");
	});

	it("reads a label written before lines existed exactly as it was", () => {
		expect(subtitleOf("Acolyte of the Celebrated Seer")).toBe("Acolyte of the Celebrated Seer");
		expect(normalizeGraph({ nodes: { a: { name: "A", subtitle: "Iron Knight" } } }).nodes.a.subtitle).toBe("Iron Knight");
	});

	it("cuts the whole label at its length", () => {
		expect(subtitleOf("x".repeat(RELMAP_SUBTITLE_MAX + 30))).toHaveLength(RELMAP_SUBTITLE_MAX);
	});

	it("counts the lines a label is drawn at, wraps included, never past the clamp", () => {
		expect(subtitleLines("")).toBe(0);
		expect(subtitleLines("Squire")).toBe(1);
		expect(subtitleLines("The Iron Knight\nLord of the Vale")).toBe(2);
		expect(subtitleLines("a\nb\nc")).toBe(3);
		// One long line wraps.
		expect(subtitleLines("Acolyte of the Celebrated Seer of the Northern Marches")).toBeGreaterThan(1);
		expect(subtitleLines("x\n".repeat(9) + "x")).toBe(RELMAP_SUBTITLE_LINES_MAX);
	});

	// Two lines' room for any label, as there always was, and a third only for a label drawn three deep.
	it("gives a three-line label a line more room than a one- or two-line one", () => {
		const reach = personReach();
		const two = underReach({ subtitle: "Squire" }, reach).down;
		expect(underReach({ subtitle: "a\nb" }, reach).down).toBe(two);
		expect(underReach({ subtitle: "a\nb\nc" }, reach).down).toBe(two + reach.subLine);
	});
});

describe("the side the words stand on, and the italics, in the store", () => {
	it("reads the four sides, and anything else as below", () => {
		expect(RELMAP_SIDES).toEqual(["below", "above", "left", "right"]);
		for (const side of RELMAP_SIDES) expect(readSide(side)).toBe(side);
		for (const junk of [undefined, null, "", "LEFT", "middle", 3]) expect(readSide(junk)).toBe("below");
	});

	it("reads a label as italic unless it was turned upright", () => {
		expect(readItalic(undefined)).toBe(true);
		expect(readItalic(true)).toBe(true);
		expect(readItalic("no")).toBe(true);
		expect(readItalic(false)).toBe(false);
	});

	// ⚠ EMITTED ON EVERY NODE, so a change to either can be taken back; absent, as on every board stored
	// before they existed, they read as below and italic and nothing migrates.
	it("reads both on every person, with the old look where none was stored", () => {
		const g = normalizeGraph({ nodes: { a: { name: "A" }, b: { name: "B", side: "left", italic: false } } });
		expect(g.nodes.a).toMatchObject({ side: "below", italic: true });
		expect(g.nodes.b).toMatchObject({ side: "left", italic: false });
	});

	it("writes them through the gates, and with a whole person", () => {
		expect(nodePatch("a", { side: "sideways" })).toEqual({ [`${PREFIX}.nodes.a.side`]: "below" });
		expect(nodePatch("a", { italic: false })).toEqual({ [`${PREFIX}.nodes.a.italic`]: false });
		const added = addNodePatch("a", { name: "A", side: "right", italic: false });
		expect(added[`${PREFIX}.nodes.a.side`]).toBe("right");
		expect(added[`${PREFIX}.nodes.a.italic`]).toBe(false);
		const plain = addNodePatch("b", { name: "B" });
		expect(plain[`${PREFIX}.nodes.b.side`]).toBe("below");
		expect(plain[`${PREFIX}.nodes.b.italic`]).toBe(true);
	});
});

describe("how far a person reaches on each side", () => {
	const reach = personReach();
	const labelled = { name: "Lord Elroy", subtitle: "The Iron Knight", x: 50, y: 50 };

	it("reads an unknown side as below", () => {
		expect(sideOf({ side: "left" })).toBe("left");
		expect(sideOf({ side: "nowhere" })).toBe("below");
		expect(sideOf(null)).toBe("below");
	});

	// ⚠ BELOW IS EXACTLY WHAT EVERY BOARD ALWAYS HAD, so nothing stored before sides existed moves.
	it("reaches below exactly as the label under the name always did", () => {
		const under = underReach(labelled, reach);
		expect(plateReach(labelled, reach)).toEqual({
			left: under.x, right: under.x, top: reach.top, bottom: reach.bottom + under.down,
		});
		expect(plateReach({ ...labelled, side: "below" }, reach)).toEqual(plateReach(labelled, reach));
	});

	it("stands the same block over the face, and nothing under it", () => {
		const below = plateReach(labelled, reach);
		const above = plateReach({ ...labelled, side: "above" }, reach);
		expect(above.bottom).toBe(FACE);
		expect(above.left).toBe(below.left);
		// The block is as tall over the face as it hung under it.
		expect(above.top - FACE).toBe(below.bottom - FACE);
	});

	it("stands it beside the face, off the rim, level with the middle", () => {
		const left = plateReach({ ...labelled, side: "left" }, reach);
		expect(left.right).toBe(FACE);
		expect(left.left).toBeGreaterThan(FACE + RELMAP_PLATE_GAP_PX);
		expect(left.top).toBe(left.bottom);
		const right = plateReach({ ...labelled, side: "right" }, reach);
		expect(right).toEqual({ left: left.right, right: left.left, top: left.top, bottom: left.bottom });
		// A longer name reaches further, up to the name's cap.
		const long = plateReach({ name: "A".repeat(80), side: "right" }, reach);
		const short = plateReach({ name: "Al", side: "right" }, reach);
		expect(long.right).toBeGreaterThan(short.right);
		expect(long.right).toBeLessThanOrEqual(FACE + RELMAP_PLATE_GAP_PX + 126);
	});

	it("draws a group's outline round words standing to one side", () => {
		const plain = groupOutline([labelled], { board });
		const left = groupOutline([{ ...labelled, side: "left" }], { board });
		expect(left.left).toBeLessThan(plain.left);
		expect(left.right).toBeLessThan(plain.right);
		expect(left.bottom).toBeLessThan(plain.bottom);
		const above = groupOutline([{ ...labelled, side: "above" }], { board });
		expect(above.top).toBeLessThan(plain.top);
	});

	it("never shrinks a group below one person with their words standing to one side", () => {
		const floor = groupFloor([{ ...labelled, side: "right" }]);
		const plate = plateReach({ ...labelled, side: "right" }, reach);
		expect(floor.w).toBeGreaterThanOrEqual(plate.left + plate.right);
		expect(groupFloor([labelled])).toEqual(groupFloor([{ ...labelled, side: "below" }]));
	});

	it("frames words standing off the sheet's edge, and frames a person below as it always did", () => {
		const atEdge = { ...labelled, x: 0, y: 50 };
		expect(boardBounds([{ ...atEdge, side: "left" }], board).left).toBeLessThan(boardBounds([atEdge], board).left);
		expect(boardBounds([{ ...atEdge, side: "below" }], board)).toEqual(boardBounds([atEdge], board));
	});

	// A newcomer is not seated on somebody's words, wherever those stand.
	it("keeps a newcomer off words standing beside somebody", () => {
		const graph = normalizeGraph({ nodes: { a: { name: "A long name here", subtitle: "Iron Knight", side: "right", x: 50, y: 5 } } });
		const taken = takenSpots(graph);
		expect(taken[0]).toMatchObject({ side: "right" });
		expect(taken[0].plate.right).toBeGreaterThan(FACE);
		const spot = freeSpot(taken);
		const clear = freeSpot([{ left: 50, top: 5 }]);
		// Where the words are the ring's first stop would be taken; the seat moves on from it.
		expect(spot).not.toEqual(clear);
	});
});
