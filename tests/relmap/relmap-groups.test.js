import { describe, it, expect } from "vitest";
import { describeWrite, stepPatch } from "../../module/relmap/relmap-history.js";
import {
	RELMAP_GROUP_DASHES, RELMAP_GROUP_SHAPES, addGroupPatch, dropGroupPatch, dropNodePatch, emptyGraph,
	groupMembersPatch, groupPatch, normalizeGraph, relmapPath,
} from "../../module/relmap/relmap-store.js";
import {
	RELMAP_CAPTION_PX, RELMAP_GROUP_GROW_MAX, RELMAP_GROUP_MIN_H, RELMAP_GROUP_MIN_W, RELMAP_GROUP_PAD_PX, boardBounds, groupNestPx,
	groupOutline, groupShapes, groupsInside, growFor, insideGroupShape, readGroupGrow, resizeRect,
} from "../../module/utils/relmap-geometry.js";

// NAMED GROUPS ON THE RELATIONSHIP MAP: "The hunters", "The elders", an outline round some people.
//
// What is stored is the name, the colour, box or oval, and who is in it, ONE LEAF PER PERSON. The
// outline is worked out from where those people stand on every paint, so nothing about where a
// group is drawn is ever stored. Most of what is held below is that split, and the undo that has to
// reverse a membership write it reaches below a field to make.

const PREFIX = relmapPath();

/** Four people, two of them hunters. */
function graph(over = {}) {
	return normalizeGraph({
		nodes: {
			ordga: { name: "Ordga", x: 20, y: 30 },
			marrec: { name: "Marrec", x: 40, y: 30 },
			sela: { name: "Sela", x: 70, y: 60 },
			pell: { name: "Pell", x: 80, y: 20 },
		},
		edges: {},
		groups: {
			hunt: { name: "The hunters", shape: "box", ink: "green", members: { ordga: true, marrec: true } },
		},
		...over,
	});
}

/** A patch landed on a graph, the document's own merge spelled out: leaf writes, `-=` deletions,
 * and the one four-part path a membership is. */
function afterPatch(before, patch) {
	return normalizeGraph(landRaw(before, patch));
}

/** The same merge onto the RAW flag, which is what the document really holds: a key normalizing
 * would hide (a membership for somebody taken off the board) is still in it. */
function landRaw(raw, patch) {
	const next = foundry.utils.deepClone(raw);
	for (const [key, value] of Object.entries(patch ?? {})) {
		const parts = key.slice(`${PREFIX}.`.length).split(".");
		let at = next;
		for (const part of parts.slice(0, -1)) at = (at[part] ??= {});
		const leaf = parts[parts.length - 1];
		if (leaf.startsWith("-=")) delete at[leaf.slice(2)];
		else at[leaf] = value;
	}
	return next;
}

describe("reading a stored group back", () => {
	it("is on every graph, empty, so nothing migrates", () => {
		expect(emptyGraph().groups).toEqual({});
		expect(normalizeGraph({ nodes: {}, edges: {} }).groups).toEqual({});
	});

	it("keeps the name, the shape, the stroke and the ink, and every field even on a bare group", () => {
		const got = normalizeGraph({ nodes: { a: { name: "A" } }, groups: { g: { members: { a: true } } } });
		expect(got.groups.g).toEqual({
			name: "", shape: "box", dash: "solid", ink: "slate",
			grow: { left: 0, top: 0, right: 0, bottom: 0 }, members: { a: true },
		});
	});

	// SOLID UNLESS SOMEBODY CHOSE DASHES. Every group stored before the stroke was a choice has no
	// `dash` at all, and the table asked for those to draw whole.
	it("reads an absent or unknown stroke as solid, and keeps a dashed one", () => {
		const got = graph({
			groups: {
				old: { members: { ordga: true } },
				dots: { dash: "dotted", members: { ordga: true } },
				broken: { dash: "dashed", members: { ordga: true } },
			},
		});
		expect(got.groups.old.dash).toBe("solid");
		expect(got.groups.dots.dash).toBe("solid");
		expect(got.groups.broken.dash).toBe("dashed");
		expect(RELMAP_GROUP_DASHES).toEqual(["solid", "dashed"]);
	});

	it("reads an unknown shape as a box and an unknown ink as slate", () => {
		const got = graph({ groups: { g: { shape: "hexagon", ink: "chartreuse", members: { ordga: true } } } });
		expect(got.groups.g.shape).toBe("box");
		expect(got.groups.g.ink).toBe("slate");
		expect(RELMAP_GROUP_SHAPES).toEqual(["box", "oval"]);
	});

	// ⚠ TAKING SOMEBODY OFF THE MAP LEAVES THEIR MEMBERSHIP KEY WHERE IT IS, on purpose: an undo puts
	// them back under the same id, and back in their groups with them. This is what keeps the stale
	// key from drawing anything in between.
	it("counts only the people who are standing on the board", () => {
		const got = graph({ groups: { g: { members: { ordga: true, gone: true, "bad.id": true, pell: false } } } });
		expect(got.groups.g.members).toEqual({ ordga: true });
	});

	it("drops a group whose id could not have been written", () => {
		const got = graph({ groups: { "Actor.x": { members: { ordga: true } } } });
		expect(got.groups).toEqual({});
	});

	// ⚠ A GROUP WITH NOBODY LEFT STANDING IS NOT ON THE BOARD. It has no outline to draw, so nothing
	// could pick it or rub it out, and its colour would go on counting as worn and as already on the map.
	it("leaves out a group whose every member has left the board", () => {
		const got = graph({
			groups: {
				ghosts: { ink: "rose", members: { gone: true } },
				bare: { ink: "plum", members: {} },
				hunt: { members: { ordga: true } },
			},
		});
		expect(Object.keys(got.groups)).toEqual(["hunt"]);
	});

	// LEFT OUT ON THE READ AND NOT RUBBED OUT: the undo that puts its last member back puts it back.
	it("brings a group back with its last member when taking them off is undone", () => {
		const before = graph({ groups: { solo: { name: "Alone", ink: "rose", members: { sela: true } } } });
		const patch = dropNodePatch(before, "sela");
		const change = describeWrite(before, patch);
		const raw = landRaw(before, patch);
		const after = normalizeGraph(raw);
		expect(after.groups.solo).toBeUndefined();
		const back = normalizeGraph(landRaw(raw, stepPatch(after, change.back)));
		expect(back.groups.solo).toMatchObject({ name: "Alone", ink: "rose", members: { sela: true } });
	});
});

describe("the shape of a group write", () => {
	it("draws a new group whole, with each member its own leaf", () => {
		const patch = addGroupPatch("g1", { name: "Elders", members: ["ordga", "pell"], ink: "plum" });
		expect(patch).toEqual({
			[`${PREFIX}.groups.g1.name`]: "Elders",
			[`${PREFIX}.groups.g1.shape`]: "box",
			[`${PREFIX}.groups.g1.dash`]: "solid",
			[`${PREFIX}.groups.g1.ink`]: "plum",
			[`${PREFIX}.groups.g1.grow`]: { left: 0, top: 0, right: 0, bottom: 0 },
			[`${PREFIX}.groups.g1.members.ordga`]: true,
			[`${PREFIX}.groups.g1.members.pell`]: true,
		});
	});

	it("refuses a group with nobody in it, and an id with a dot in it", () => {
		expect(addGroupPatch("g1", { members: [] })).toBeNull();
		expect(addGroupPatch("g.1", { members: ["ordga"] })).toBeNull();
		expect(groupMembersPatch("g1", ["bad.id"])).toBeNull();
	});

	// A whole `members` object would be one player's list replacing another's; one leaf per person
	// is what lets two people fill the same group at once.
	it("never writes members as a whole object", () => {
		const patch = groupPatch("g1", { name: "Hunters", members: { ordga: true } });
		expect(Object.keys(patch)).toEqual([`${PREFIX}.groups.g1.name`]);
	});

	it("writes a stroke it knows and refuses one it does not", () => {
		expect(groupPatch("g1", { dash: "dashed" })).toEqual({ [`${PREFIX}.groups.g1.dash`]: "dashed" });
		expect(groupPatch("g1", { dash: "wavy" })).toEqual({ [`${PREFIX}.groups.g1.dash`]: "solid" });
	});

	it("puts people in and takes people out, one leaf each", () => {
		const patch = groupMembersPatch("hunt", ["sela"], ["ordga"]);
		expect(patch[`${PREFIX}.groups.hunt.members.sela`]).toBe(true);
		expect(patch[`${PREFIX}.groups.hunt.members.-=ordga`]).toBeNull();
		const after = afterPatch(graph(), patch);
		expect(after.groups.hunt.members).toEqual({ marrec: true, sela: true });
	});

	it("rubs a group out and leaves everybody in it on the board", () => {
		const after = afterPatch(graph(), dropGroupPatch("hunt"));
		expect(after.groups).toEqual({});
		expect(Object.keys(after.nodes)).toHaveLength(4);
	});
});

describe("taking a group change back", () => {
	it("takes a person back out of a group they were put into", () => {
		const before = graph();
		const patch = groupMembersPatch("hunt", ["sela"]);
		const change = describeWrite(before, patch);
		expect(change).not.toBeNull();
		const after = afterPatch(before, patch);
		expect(after.groups.hunt.members.sela).toBe(true);
		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.groups.hunt.members).toEqual(before.groups.hunt.members);
		const again = afterPatch(back, stepPatch(back, change.forward));
		expect(again.groups.hunt.members.sela).toBe(true);
	});

	it("puts a person back into a group they were taken out of", () => {
		const before = graph();
		const patch = groupMembersPatch("hunt", [], ["ordga"]);
		const change = describeWrite(before, patch);
		const after = afterPatch(before, patch);
		expect(after.groups.hunt.members).toEqual({ marrec: true });
		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.groups.hunt.members).toEqual({ marrec: true, ordga: true });
	});

	it("rubs a drawn group out again, and redraws it", () => {
		const before = graph();
		const patch = addGroupPatch("eld", { name: "The elders", members: ["pell", "sela"], ink: "plum" });
		const change = describeWrite(before, patch);
		const after = afterPatch(before, patch);
		expect(after.groups.eld.members).toEqual({ pell: true, sela: true });
		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.groups.eld).toBeUndefined();
		const again = afterPatch(back, stepPatch(back, change.forward));
		expect(again.groups.eld).toEqual(after.groups.eld);
	});

	it("puts a rubbed-out group back whole, members and all", () => {
		const before = graph();
		const change = describeWrite(before, dropGroupPatch("hunt"));
		const after = afterPatch(before, dropGroupPatch("hunt"));
		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.groups.hunt).toEqual(before.groups.hunt);
	});

	it("takes a rename or a recolour back", () => {
		const before = graph();
		const patch = groupPatch("hunt", { name: "Trappers", ink: "rust", shape: "oval", dash: "dashed" });
		const change = describeWrite(before, patch);
		const after = afterPatch(before, patch);
		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.groups.hunt).toEqual(before.groups.hunt);
	});

	// THE FREE RIDE THE STORAGE WAS CHOSEN FOR: membership keys are not touched when a person is taken
	// off, so the undo that puts them back puts them back in their groups too.
	it("puts a person taken off the board back into their groups when that is undone", () => {
		const before = graph();
		const patch = dropNodePatch(before, "ordga");
		const change = describeWrite(before, patch);
		const raw = landRaw(before, patch);
		// The key is still in the document, and the board read off it does not show it.
		expect(raw.groups.hunt.members.ordga).toBe(true);
		const after = normalizeGraph(raw);
		expect(after.groups.hunt.members).toEqual({ marrec: true });
		const back = normalizeGraph(landRaw(raw, stepPatch(after, change.back)));
		expect(back.groups.hunt.members).toEqual({ marrec: true, ordga: true });
	});

	it("does not put somebody who has since left the board back into a group", () => {
		const before = graph();
		const change = describeWrite(before, groupMembersPatch("hunt", [], ["ordga"]));
		let live = afterPatch(before, groupMembersPatch("hunt", [], ["ordga"]));
		live = afterPatch(live, dropNodePatch(live, "ordga"));
		const patch = stepPatch(live, change.back);
		expect(patch).toBeNull();
	});

	it("re-makes a group only with the people still standing", () => {
		const before = graph();
		const change = describeWrite(before, dropGroupPatch("hunt"));
		let live = afterPatch(before, dropGroupPatch("hunt"));
		live = afterPatch(live, dropNodePatch(live, "marrec"));
		const back = afterPatch(live, stepPatch(live, change.back));
		expect(back.groups.hunt.members).toEqual({ ordga: true });
	});

	it("still refuses a four-part path that is not a membership", () => {
		expect(describeWrite(graph(), { [`${PREFIX}.groups.hunt.name.x`]: "y" })).toBeNull();
		expect(describeWrite(graph(), { [`${PREFIX}.nodes.ordga.x.y`]: 1 })).toBeNull();
	});
});

describe("the outline round a group", () => {
	const board = { width: 1200, height: 960 };
	const at = (x, y) => ({ x, y });

	it("boxes every member's face and name with room to spare", () => {
		const members = [at(20, 30), at(40, 50)];
		const box = groupOutline(members, { board });
		for (const m of members) {
			const px = (m.x / 100) * board.width;
			const py = (m.y / 100) * board.height;
			// The face (36 each way) and the name under it (to 56 below).
			expect(box.left).toBeLessThanOrEqual(px - 54);
			expect(box.right).toBeGreaterThanOrEqual(px + 54);
			expect(box.top).toBeLessThanOrEqual(py - 36);
			expect(box.bottom).toBeGreaterThanOrEqual(py + 56);
		}
		expect(box.shape).toBe("box");
		expect(box.d).toMatch(/^M /);
	});

	it("draws an oval through the box's corners, so nobody pokes out", () => {
		const members = [at(20, 30), at(40, 50)];
		const box = groupOutline(members, { board });
		const oval = groupOutline(members, { board, shape: "oval" });
		for (const [x, y] of [[box.left, box.top], [box.right, box.bottom], [box.left, box.bottom]]) {
			const inside = ((x - oval.cx) / oval.rx) ** 2 + ((y - oval.cy) / oval.ry) ** 2;
			expect(inside).toBeLessThanOrEqual(1.0001);
		}
		expect(oval.name.align).toBe("centre");
		expect(oval.d).toContain(" A ");
	});

	it("still draws round one person alone, and round nobody returns nothing", () => {
		expect(groupOutline([at(50, 50)], { board })).not.toBeNull();
		expect(groupOutline([], { board })).toBeNull();
	});

	it("stands a group a step clear of an outline it contains", () => {
		const members = [at(20, 30), at(40, 50)];
		const flat = groupOutline(members, { board });
		const outer = groupOutline(members, { board, contain: [flat] });
		expect(flat.left - outer.left).toBeCloseTo(groupNestPx());
		expect(RELMAP_GROUP_PAD_PX).toBeGreaterThan(0);
	});

	// ⚠ THE NAMES ARE SET AT THE READER'S TEXT WEIGHT, and the inner name sits ON its line, half its
	// chip above it. A fixed step measured for one size of chip let a doubled name lie across the
	// outer stroke.
	it("stands further clear as the reader turns the words up, by half the bigger name chip", () => {
		expect(groupNestPx(2) - groupNestPx(1)).toBeCloseTo((RELMAP_CAPTION_PX * 1.56) / 2);
		expect(groupNestPx(0.5)).toBeLessThan(groupNestPx(1));
		// No weight, or a nonsense one, is the ordinary size.
		expect(groupNestPx(undefined)).toBe(groupNestPx(1));
		expect(groupNestPx(0)).toBe(groupNestPx(1));
		const got = graph({
			groups: {
				council: { members: { ordga: true, marrec: true, sela: true } },
				elders: { members: { ordga: true, marrec: true } },
			},
		});
		const gap = wordScale => {
			const shapes = groupShapes(got, board, { wordScale });
			const of = id => shapes.find(shape => shape.id === id).outline;
			return of("elders").top - of("council").top;
		};
		expect(gap(2)).toBeCloseTo(gap(1) + (RELMAP_CAPTION_PX * 1.56) / 2);
	});

	it("finds which groups lie wholly inside each one, and breaks a tie of the same people by id", () => {
		const inside = groupsInside({
			council: { members: { a: true, b: true, c: true } },
			elders: { members: { a: true, b: true } },
			twin: { members: { a: true, b: true } },
			other: { members: { c: true, d: true } },
		});
		expect([...inside.get("council")].sort()).toEqual(["elders", "twin"]);
		// "elders" and "twin" hold the same two people; the later id is the outer one.
		expect(inside.get("twin")).toEqual(["elders"]);
		expect(inside.get("elders")).toEqual([]);
		expect(inside.get("other")).toEqual([]);
	});

	// ⚠ FOUND IN A REAL BROWSER: an oval reaches past its own box, so a fixed step of padding left an
	// oval "elders" poking out through the top of a box "council" drawn round the same people.
	it("draws a group round the OUTLINE of every group inside it, whatever its shape", () => {
		const got = graph({
			groups: {
				council: { shape: "box", members: { ordga: true, marrec: true, sela: true } },
				elders: { shape: "oval", members: { ordga: true, marrec: true } },
			},
		});
		const shapes = Object.fromEntries(groupShapes(got, board).map(shape => [shape.id, shape.outline]));
		const { council, elders } = shapes;
		for (const side of ["left", "top"]) {
			expect(council[side]).toBeLessThanOrEqual(elders[side] - groupNestPx() + 0.01);
		}
		for (const side of ["right", "bottom"]) {
			expect(council[side]).toBeGreaterThanOrEqual(elders[side] + groupNestPx() - 0.01);
		}
	});

	it("lays every group out outermost first, leaving out a group with nobody standing", () => {
		const got = graph({
			groups: {
				hunt: { members: { ordga: true, marrec: true } },
				all: { members: { ordga: true, marrec: true, sela: true } },
				ghosts: { members: { gone: true } },
			},
		});
		const shapes = groupShapes(got, board);
		expect(shapes.map(shape => shape.id)).toEqual(["all", "hunt"]);
		expect(shapes[1].members).toEqual(["marrec", "ordga"]);
	});

	it("frames an outline that reaches past everybody's own room", () => {
		const outline = groupOutline([at(0, 0)], { board, contain: [{ left: -200, top: -200, right: 200, bottom: 200 }] });
		const bounds = boardBounds([at(0, 0)], board, [outline]);
		expect(bounds.left).toBeLessThanOrEqual(outline.left);
		expect(bounds.top).toBeLessThanOrEqual(outline.top);
	});
});

// RESIZING A GROUP (user, 2026-10-12: "select it and then drag to increase or shrink its size").
// What is stored is how far each side sits past (or short of) the snug outline, never a size or a
// place: the outline still follows its people. Shrunk across somebody, it takes them out (the window).
describe("a group's extra room", () => {
	const board = { width: 1200, height: 800 };
	const one = [{ x: 50, y: 50 }];
	const NONE = { left: 0, top: 0, right: 0, bottom: 0 };

	it("reads whole pixels on all four sides, either way, within the cap", () => {
		expect(readGroupGrow(undefined)).toEqual(NONE);
		expect(readGroupGrow({ left: 12.6, top: -40, right: "30", bottom: "wide" }))
			.toEqual({ left: 13, top: -40, right: 30, bottom: 0 });
		expect(readGroupGrow({ right: 1e9, left: -1e9 })).toMatchObject({ right: RELMAP_GROUP_GROW_MAX, left: -RELMAP_GROUP_GROW_MAX });
	});

	it("writes all four sides as one field, through the same reading", () => {
		expect(groupPatch("g1", { grow: { right: 40, top: -5 } }))
			.toEqual({ [`${PREFIX}.groups.g1.grow`]: { left: 0, top: -5, right: 40, bottom: 0 } });
	});

	it("moves a box's sides out by exactly that much, and keeps the snug one under it", () => {
		const snug = groupOutline(one, { board });
		const grown = groupOutline(one, { board, grow: { left: 10, top: 20, right: 30, bottom: 40 } });
		expect(grown.left).toBeCloseTo(snug.left - 10);
		expect(grown.top).toBeCloseTo(snug.top - 20);
		expect(grown.right).toBeCloseTo(snug.right + 30);
		expect(grown.bottom).toBeCloseTo(snug.bottom + 40);
		expect(grown.rect).toEqual({ left: grown.left, top: grown.top, right: grown.right, bottom: grown.bottom });
	});

	// The corners an oval is resized by are on its line, because it is drawn through them.
	it("draws an oval through the corners of its grown rectangle", () => {
		const oval = groupOutline(one, { board, shape: "oval", grow: { right: 120, bottom: 10 } });
		for (const [x, y] of [["left", "top"], ["right", "top"], ["right", "bottom"], ["left", "bottom"]]) {
			const dx = (oval.rect[x] - oval.cx) / oval.rx;
			const dy = (oval.rect[y] - oval.cy) / oval.ry;
			expect(dx * dx + dy * dy).toBeCloseTo(1);
		}
	});

	it("puts a dragged corner under the pointer and keeps the opposite one where it was", () => {
		const rect = { left: 100, top: 100, right: 400, bottom: 300 };
		expect(resizeRect(rect, "se", { x: 450, y: 360 })).toEqual({ left: 100, top: 100, right: 450, bottom: 360 });
		expect(resizeRect(rect, "nw", { x: 150, y: 120 })).toEqual({ left: 150, top: 120, right: 400, bottom: 300 });
		expect(resizeRect(rect, "ne", { x: 420, y: 40 })).toEqual({ left: 100, top: 40, right: 420, bottom: 300 });
	});

	// ⚠ NO LONGER HELD AT THE SNUG OUTLINE: shrinking past people is how they are taken out.
	// "we shouldn't be able to shrink a group down to smaller than a single token's size": the floor is
	// the snug outline round one person, face and name.
	it("shrinks past its people, but never below one person's outline, and never inside out", () => {
		const rect = { left: 100, top: 100, right: 400, bottom: 300 };
		const small = resizeRect(rect, "se", { x: 0, y: 0 });
		expect(small).toEqual({ left: 100, top: 100, right: 100 + RELMAP_GROUP_MIN_W, bottom: 100 + RELMAP_GROUP_MIN_H });
		const drawn = groupOutline(one, { board });
		expect(drawn.rect.right - drawn.rect.left).toBeCloseTo(RELMAP_GROUP_MIN_W);
		expect(drawn.rect.bottom - drawn.rect.top).toBeCloseTo(RELMAP_GROUP_MIN_H);
		const two = groupOutline([{ x: 20, y: 50 }, { x: 60, y: 50 }], { board });
		const shrunk = groupOutline([{ x: 20, y: 50 }, { x: 60, y: 50 }], {
			board, grow: growFor(two.snug, { ...two.rect, right: two.rect.right - 60 }),
		});
		expect(shrunk.rect.right).toBeCloseTo(two.rect.right - 60);
		// A lone person's outline will not shrink at all.
		const lone = groupOutline(one, { board, grow: { right: -60, bottom: -60 } });
		expect(lone.rect).toEqual(drawn.rect);
		// Offsets that would cross the sides over are drawn at the floor instead.
		const crossed = groupOutline(one, { board, grow: { left: -500, right: -500 } });
		expect(crossed.rect.right - crossed.rect.left).toBeCloseTo(RELMAP_GROUP_MIN_W);
	});

	// Shift: "make all sides of the shape equal - perfect square, perfect circle".
	it("makes all four sides equal with Shift, by the longer of the two the pointer asks for", () => {
		const rect = { left: 100, top: 100, right: 300, bottom: 200 };
		expect(resizeRect(rect, "se", { x: 400, y: 220 }, { square: true }))
			.toEqual({ left: 100, top: 100, right: 400, bottom: 400 });
		expect(resizeRect(rect, "nw", { x: 250, y: 0 }, { square: true }))
			.toEqual({ left: 100, top: 0, right: 300, bottom: 200 });
		const sq = resizeRect(rect, "sw", { x: 90, y: 150 }, { square: true });
		expect(sq.right - sq.left).toBe(sq.bottom - sq.top);
		expect(sq).toMatchObject({ right: 300, top: 100 });
		// And a square rectangle draws a circle.
		const drawn = groupOutline(one, { board, shape: "oval" });
		const round = groupOutline(one, { board, shape: "oval", grow: growFor(drawn.snug, resizeRect(drawn.rect, "se", { x: 900, y: 0 }, { square: true })) });
		expect(round.rx).toBeCloseTo(round.ry);
	});

	it("measures the offsets that put a snug rectangle on any other", () => {
		expect(growFor({ left: 10, top: 10, right: 50, bottom: 50 }, { left: 0, top: 20, right: 70, bottom: 40 }))
			.toEqual({ left: 10, top: -10, right: 20, bottom: -10 });
	});

	it("says whose face is inside a box, and inside an oval drawn on the same rectangle", () => {
		const rect = { left: 0, top: 0, right: 200, bottom: 100 };
		expect(insideGroupShape("box", rect, { x: 199, y: 99 })).toBe(true);
		expect(insideGroupShape("box", rect, { x: 201, y: 50 })).toBe(false);
		// The oval runs through the corners, so a corner is on it and a point just past the middle of a
		// side, inside the box, is still inside the oval.
		expect(insideGroupShape("oval", rect, { x: 200, y: 100 })).toBe(true);
		expect(insideGroupShape("oval", rect, { x: 230, y: 50 })).toBe(true);
		expect(insideGroupShape("oval", rect, { x: 260, y: 110 })).toBe(false);
	});

	it("keeps its room while its people move, and a group round it stands clear of the grown outline", () => {
		const nodes = { a: { name: "A", x: 30, y: 40 }, b: { name: "B", x: 60, y: 40 } };
		const plain = normalizeGraph({ nodes, groups: {
			inner: { members: { a: true } }, outer: { members: { a: true, b: true } },
		} });
		const grown = normalizeGraph({ nodes, groups: {
			inner: { members: { a: true }, grow: { left: 100 } }, outer: { members: { a: true, b: true } },
		} });
		const at = g => Object.fromEntries(groupShapes(g, board).map(shape => [shape.id, shape.outline]));
		expect(at(grown).inner.left).toBeCloseTo(at(plain).inner.left - 100);
		expect(at(grown).outer.left).toBeCloseTo(at(plain).outer.left - 100);
		const moved = normalizeGraph({ ...grown, nodes: { ...nodes, a: { ...nodes.a, x: 20 } } });
		expect(at(moved).inner.left).toBeCloseTo(at(grown).inner.left - 120);
	});

	// Its room is measured from its OWN people: a group inside it is laid round afterwards, so a shrink
	// never cuts through one, and one shrunk back later never pulls this outline in past its people.
	it("is never drawn through a group inside it, and keeps its people when that group shrinks back", () => {
		const nodes = { a: { name: "A", x: 30, y: 40 }, b: { name: "B", x: 40, y: 40 }, c: { name: "C", x: 70, y: 40 } };
		const make = (innerGrow, outerGrow) => normalizeGraph({ nodes, groups: {
			inner: { members: { a: true, b: true }, grow: innerGrow },
			outer: { members: { a: true, b: true, c: true }, grow: outerGrow },
		} });
		const at = g => Object.fromEntries(groupShapes(g, board).map(shape => [shape.id, shape.outline]));
		const nest = groupNestPx();
		// The inner group hauled out 300px on its right, then the outer one's right corner dragged in
		// to just past A and B: its people-only outline would end well inside the inner one's.
		const wide = at(make({ right: 300 }, null));
		const shrunk = at(make({ right: 300 }, growFor(wide.outer.snug, { ...wide.outer.rect, right: wide.inner.rect.right - 200 })));
		expect(shrunk.outer.rect.right).toBeGreaterThanOrEqual(shrunk.inner.right + nest - 0.01);
		// The inner one shrunk back: the outer one still stands round A and B's own outline.
		const back = at(make(null, growFor(wide.outer.snug, { ...wide.outer.rect, right: wide.inner.rect.right - 200 })));
		expect(back.outer.rect.right).toBeGreaterThanOrEqual(back.inner.right + nest - 0.01);
		expect(back.outer.snug.right).toBeCloseTo(at(make(null, null)).outer.snug.right);
	});

	it("takes a resize back in one step, to the snug outline on a group drawn before resizing existed", () => {
		const before = graph();
		const patch = groupPatch("hunt", { grow: { right: 60, bottom: 30 } });
		const change = describeWrite(before, patch);
		expect(change).not.toBeNull();
		const after = afterPatch(before, patch);
		expect(after.groups.hunt.grow).toEqual({ left: 0, top: 0, right: 60, bottom: 30 });
		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.groups.hunt.grow).toEqual(NONE);
		const again = afterPatch(back, stepPatch(back, change.forward));
		expect(again.groups.hunt.grow).toEqual(after.groups.hunt.grow);
	});

	it("puts a rubbed-out group back at the size it had", () => {
		const before = afterPatch(graph(), groupPatch("hunt", { grow: { left: 44 } }));
		const change = describeWrite(before, dropGroupPatch("hunt"));
		const after = afterPatch(before, dropGroupPatch("hunt"));
		const back = afterPatch(after, stepPatch(after, change.back));
		expect(back.groups.hunt.grow).toEqual({ left: 44, top: 0, right: 0, bottom: 0 });
	});
});
