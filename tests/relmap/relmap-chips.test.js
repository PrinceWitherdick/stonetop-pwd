import { describe, it, expect, vi } from "vitest";
import {
	RELMAP_CHIP_ICONS, RELMAP_CHIP_NAME_MAX, RELMAP_CHIP_PRESETS, addChipPatch, addNodePatch, chipPatch,
	chipsWorn, dropChipPatch, dropNodePatch, emptyGraph, nodeChipsPatch, normalizeGraph, relmapPath, storableGraph,
	takenSpots,
} from "../../module/relmap/relmap-store.js";
import { describeWrite, stepPatch } from "../../module/relmap/relmap-history.js";
import { chipLibrary, chipWearPatch, spreadChip, chipElsewhere } from "../../module/relmap/relmap-chips.js";
import {
	RELMAP_CHIP_GAP_PX, RELMAP_CHIP_H_PX, RELMAP_CHIP_ROWS_MAX, RELMAP_CHIP_ROW_W, RELMAP_SUBTITLE_REACH_PX,
	boardBounds, chipLayout, chipReach, chipWidthPx, groupFloor, groupOutline, personReach, underReach,
} from "../../module/utils/relmap-geometry.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// TAG CHIPS ON THE RELATIONSHIP MAP ("Dead", "Noble"): defined per board in `graph.chips`, worn one
// leaf per chip per person, shared between boards by id, and reached round by every outline.

const PREFIX = relmapPath();

/** The document's own merge of a patch onto the RAW flag, at any depth (a chip leaf is four deep). */
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

const RAW = () => ({
	nodes: {
		elena: { uuid: "Actor.a1", name: "Elena", x: 20, y: 30 },
		stefan: { uuid: "Actor.b2", name: "Stefan", x: 70, y: 30 },
	},
	edges: {},
	chips: { dead: { name: "Dead", icon: "fa-skull", ink: "crimson" } },
});

describe("reading chips back", () => {
	it("is on every graph and every person, empty, so nothing migrates", () => {
		expect(emptyGraph().chips).toEqual({});
		const g = normalizeGraph({ nodes: { a: { name: "A" } } });
		expect(g.chips).toEqual({});
		expect(g.nodes.a.chips).toEqual({});
		expect(g.nodes.a.chipRows).toBeUndefined();
	});

	it("keeps a chip's name, icon and ink, and drops what it cannot draw", () => {
		const g = normalizeGraph({
			chips: {
				ok: { name: "  Noble  ", icon: "fa-crown", ink: "#336699", junk: 1 },
				badIcon: { name: "Odd", icon: "fa-not-a-thing", ink: "nope" },
				blank: { name: "   ", icon: "fa-star" },
				"bad.id": { name: "Dotted" },
				long: { name: "x".repeat(RELMAP_CHIP_NAME_MAX + 10) },
			},
		});
		expect(g.chips.ok).toEqual({ name: "Noble", icon: "fa-crown", ink: "#336699" });
		expect(g.chips.badIcon).toEqual({ name: "Odd", icon: "", ink: "slate" });
		expect(g.chips.blank).toBeUndefined();
		expect(g.chips["bad.id"]).toBeUndefined();
		expect(g.chips.long.name).toHaveLength(RELMAP_CHIP_NAME_MAX);
	});

	it("keeps only the chips this board defines on a person, and counts the rows they are drawn in", () => {
		const raw = RAW();
		raw.nodes.elena.chips = { dead: true, gone: true, off: false };
		const g = normalizeGraph(raw);
		expect(g.nodes.elena.chips).toEqual({ dead: true });
		expect(g.nodes.elena.chipRows).toBe(1);
		expect(g.nodes.stefan.chipRows).toBeUndefined();
	});

	it("lays a person's chips out once, on the read, and never writes that back", () => {
		const raw = RAW();
		raw.nodes.elena.chips = { dead: true };
		const g = normalizeGraph(raw);
		expect(g.nodes.elena.chipLaid).toEqual(chipLayout(chipsWorn(g.nodes.elena, g)));
		expect(g.nodes.stefan.chipLaid).toBeUndefined();
		const stored = storableGraph(g);
		expect(stored.nodes.elena).not.toHaveProperty("chipLaid");
		expect(stored.nodes.elena).not.toHaveProperty("chipRows");
		expect(stored.nodes.elena.chips).toEqual({ dead: true });
		// A copy: the read the window paints from keeps its layout.
		expect(g.nodes.elena.chipLaid).toBeTruthy();
	});

	it("lists a person's chips presets first, then by name", () => {
		const g = normalizeGraph({
			nodes: { a: { name: "A", chips: { z: true, dead: true, b: true } } },
			chips: {
				z: { name: "aardvark" }, b: { name: "Beekeeper" },
				dead: { name: "Dead", icon: "fa-skull", ink: "crimson" },
			},
		});
		expect(chipsWorn(g.nodes.a, g).map(chip => chip.id)).toEqual(["dead", "z", "b"]);
	});

	it("offers every icon it accepts, and the Dead preset wears the skull", () => {
		expect(RELMAP_CHIP_ICONS).toContain("fa-skull");
		expect(new Set(RELMAP_CHIP_ICONS).size).toBe(RELMAP_CHIP_ICONS.length);
		expect(RELMAP_CHIP_PRESETS[0]).toMatchObject({ id: "dead", icon: "fa-skull", ink: "crimson" });
	});
});

describe("writing chips", () => {
	it("puts chips on and takes them off one leaf each", () => {
		const patch = nodeChipsPatch("elena", ["dead"], ["noble"]);
		expect(patch[relmapPath("nodes", "elena", "chips", "dead")]).toBe(true);
		expect(Object.keys(patch).some(key => key.endsWith("chips.-=noble"))).toBe(true);
		expect(nodeChipsPatch("bad.id", ["dead"])).toBeNull();
		// Named in both, it is worn: the deletion is dropped.
		const both = nodeChipsPatch("elena", ["dead"], ["dead"]);
		expect(Object.keys(both)).toEqual([relmapPath("nodes", "elena", "chips", "dead")]);
	});

	it("never writes a person's chips as a whole object", () => {
		const patch = addNodePatch("elena", { name: "Elena", chips: { dead: true, off: false } });
		expect(patch[relmapPath("nodes", "elena", "chips")]).toBeUndefined();
		expect(patch[relmapPath("nodes", "elena", "chips", "dead")]).toBe(true);
		expect(Object.keys(patch).some(key => key.endsWith(".off"))).toBe(false);
	});

	it("defines a chip whole, and refuses one with no name", () => {
		expect(addChipPatch("c1", { name: "Noble", icon: "fa-crown", ink: "ochre" })).toEqual({
			[relmapPath("chips", "c1", "name")]: "Noble",
			[relmapPath("chips", "c1", "icon")]: "fa-crown",
			[relmapPath("chips", "c1", "ink")]: "ochre",
		});
		expect(addChipPatch("c1", { name: "  " })).toBeNull();
		expect(chipPatch("c1", { icon: "fa-nope" })).toEqual({ [relmapPath("chips", "c1", "icon")]: "" });
	});

	it("takes a deleted chip off everybody wearing it, in the same write", () => {
		const raw = RAW();
		raw.nodes.elena.chips = { dead: true };
		const g = normalizeGraph(raw);
		const after = normalizeGraph(landRaw(raw, dropChipPatch(g, "dead")));
		expect(after.chips.dead).toBeUndefined();
		expect(after.nodes.elena.chips).toEqual({});
	});

	it("copies a chip from another board onto this one as it is worn, under the same id", () => {
		const g = normalizeGraph({ nodes: RAW().nodes });
		const patch = chipWearPatch(g, "elena", { id: "c9", name: "Noble", icon: "fa-crown", ink: "ochre" });
		const after = normalizeGraph(landRaw({ nodes: RAW().nodes }, patch));
		expect(after.chips.c9).toEqual({ name: "Noble", icon: "fa-crown", ink: "ochre" });
		expect(after.nodes.elena.chips).toEqual({ c9: true });
		// Already here: only the leaf.
		const here = normalizeGraph(RAW());
		expect(Object.keys(chipWearPatch(here, "elena", { id: "dead", name: "Dead" }))).toEqual([
			relmapPath("nodes", "elena", "chips", "dead"),
		]);
	});
});

describe("taking a chip change back", () => {
	const round = (raw, patch) => {
		const before = normalizeGraph(raw);
		const change = describeWrite(before, patch);
		expect(change).toBeTruthy();
		const landed = landRaw(raw, patch);
		const after = normalizeGraph(landed);
		const backRaw = landRaw(landed, stepPatch(after, change.back));
		return { before, after, back: normalizeGraph(backRaw), change, backRaw };
	};

	it("takes a chip back off, and puts one taken off back on", () => {
		const { after, back } = round(RAW(), nodeChipsPatch("elena", ["dead"]));
		expect(after.nodes.elena.chips).toEqual({ dead: true });
		expect(back.nodes.elena.chips).toEqual({});

		const worn = RAW();
		worn.nodes.elena.chips = { dead: true };
		const off = round(worn, nodeChipsPatch("elena", [], ["dead"]));
		expect(off.after.nodes.elena.chips).toEqual({});
		expect(off.back.nodes.elena.chips).toEqual({ dead: true });
	});

	it("undoes a chip made and worn in one step as one step: the chip goes too", () => {
		const raw = { nodes: RAW().nodes };
		const patch = chipWearPatch(normalizeGraph(raw), "elena", { id: "c9", name: "Noble", icon: "fa-crown", ink: "ochre" });
		const { after, back, change } = round(raw, patch);
		expect(after.chips.c9).toBeTruthy();
		expect(back.chips.c9).toBeUndefined();
		expect(back.nodes.elena.chips).toEqual({});
		// And a redo makes both again.
		const redo = normalizeGraph(landRaw(landRaw(raw, {}), stepPatch(back, change.forward)));
		expect(redo.chips.c9).toEqual({ name: "Noble", icon: "fa-crown", ink: "ochre" });
		expect(redo.nodes.elena.chips).toEqual({ c9: true });
	});

	it("puts a recoloured chip back as it was", () => {
		const { after, back } = round(RAW(), chipPatch("dead", { ink: "#123456", icon: "fa-ghost" }));
		expect(after.chips.dead).toMatchObject({ ink: "#123456", icon: "fa-ghost" });
		expect(back.chips.dead).toEqual({ name: "Dead", icon: "fa-skull", ink: "crimson" });
	});

	it("brings a deleted chip back onto everybody who wore it", () => {
		const raw = RAW();
		raw.nodes.elena.chips = { dead: true };
		raw.nodes.stefan.chips = { dead: true };
		const { after, back } = round(raw, dropChipPatch(normalizeGraph(raw), "dead"));
		expect(after.chips.dead).toBeUndefined();
		expect(back.chips.dead).toEqual({ name: "Dead", icon: "fa-skull", ink: "crimson" });
		expect(back.nodes.elena.chips).toEqual({ dead: true });
		expect(back.nodes.stefan.chips).toEqual({ dead: true });
	});

	it("brings somebody's chips back with them when their removal is undone", () => {
		const raw = RAW();
		raw.nodes.elena.chips = { dead: true };
		const { after, back } = round(raw, dropNodePatch(normalizeGraph(raw), "elena"));
		expect(after.nodes.elena).toBeUndefined();
		expect(back.nodes.elena.chips).toEqual({ dead: true });
	});
});

describe("the chips every board offers", () => {
	const board = (raw, { owner = true, visible = true, name = "Board" } = {}) => ({
		name,
		isOwner: owner,
		testUserPermission: () => visible,
		getFlag: (scope, key) => (scope === SYSTEM_ID && key === "relationshipMap" ? raw : undefined),
		update: vi.fn(async () => true),
	});
	const localize = key => (key === "stonetop.relmap.chips.dead" ? "Dead" : key);

	it("offers this board's chips, every board's this reader can see, and Dead", () => {
		const here = normalizeGraph({ chips: { c1: { name: "Noble", ink: "ochre" } } });
		const other = board({ chips: { c2: { name: "Healer", icon: "fa-leaf" } } });
		const hidden = board({ chips: { c3: { name: "Secret" } } }, { visible: false });
		const list = chipLibrary(here, { boards: [other, hidden], localize });
		expect(list.map(chip => chip.name)).toEqual(["Dead", "Healer", "Noble"]);
		expect(list.find(chip => chip.id === "c1").here).toBe(true);
		expect(list.find(chip => chip.id === "c2").here).toBe(false);
	});

	it("offers one chip per name, this board's own first", () => {
		const here = normalizeGraph({ chips: { mine: { name: "noble", ink: "rose" } } });
		const other = board({ chips: { theirs: { name: "Noble", ink: "green" }, dead: { name: "Dead", ink: "slate" } } });
		const list = chipLibrary(here, { boards: [other], localize });
		expect(list.filter(chip => chip.name.toLowerCase() === "noble").map(chip => chip.id)).toEqual(["mine"]);
		// Another board's Dead is the same chip as the preset (same id), and is offered as it is there.
		expect(list.filter(chip => chip.id === "dead")).toHaveLength(1);
		expect(list.find(chip => chip.id === "dead").ink).toBe("slate");
	});

	it("carries an edit to every other board holding the chip that this reader may edit", async () => {
		const doc = board(RAW());
		const has = board(RAW());
		const lacks = board({ nodes: {} });
		const locked = board(RAW(), { owner: false });
		const wrote = await spreadChip("dead", { name: "Fallen", icon: "fa-ghost", ink: "slate" }, {
			doc, boards: [doc, has, lacks, locked],
		});
		expect(wrote).toBe(1);
		expect(doc.update).not.toHaveBeenCalled();
		expect(lacks.update).not.toHaveBeenCalled();
		expect(locked.update).not.toHaveBeenCalled();
		expect(has.update).toHaveBeenCalledWith(expect.objectContaining({ [relmapPath("chips", "dead", "name")]: "Fallen" }));
	});

	it("carries a deletion the same way, wearers and all", async () => {
		const raw = RAW();
		raw.nodes.elena.chips = { dead: true };
		const other = board(raw);
		await spreadChip("dead", null, { boards: [other] });
		const sent = other.update.mock.calls[0][0];
		expect(Object.keys(sent).some(key => key.endsWith("chips.-=dead"))).toBe(true);
		expect(Object.keys(sent).some(key => key.endsWith("elena.chips.-=dead"))).toBe(true);
		expect(chipElsewhere("dead", { boards: [other, board({})] })).toBe(1);
	});

	// The same boards `spreadChip` writes: a board this reader can only see is not reached by the
	// deletion, so the question does not promise it.
	it("counts for the delete question only the boards the deletion reaches", () => {
		const raw = RAW();
		raw.nodes.elena.chips = { dead: true };
		const mine = board(raw);
		const seenOnly = board(raw, { owner: false });
		expect(chipElsewhere("dead", { boards: [mine, seenOnly] })).toBe(1);
	});

	it("warns about a board that refuses the edit, and still carries it to the rest", async () => {
		const refuses = board(RAW(), { name: "Locked away" });
		refuses.update = vi.fn(async () => { throw new Error("refused"); });
		const takes = board(RAW());
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await spreadChip("dead", { name: "Fallen" }, { boards: [refuses, takes] })).toBe(1);
		expect(takes.update).toHaveBeenCalled();
		expect(warn.mock.calls[0][0]).toContain('"Locked away" to carry a chip there');
		warn.mockRestore();
	});
});

describe("how far chips reach under a person", () => {
	it("lays pills into rows no wider than a chip row, two rows at most, the rest behind +N", () => {
		const chip = name => ({ name, icon: "fa-star" });
		const one = chipLayout([chip("Dead"), chip("Noble")]);
		expect(one.rows).toHaveLength(1);
		expect(one.hidden).toEqual([]);
		const many = chipLayout(["Dead", "Noble", "Healer", "Outcast", "Hunter", "Elder", "Spy"].map(chip));
		expect(many.rows).toHaveLength(RELMAP_CHIP_ROWS_MAX);
		expect(many.hidden.length).toBeGreaterThan(0);
		for (const row of many.rows) {
			const width = row.reduce((sum, c, i) => sum + (i ? RELMAP_CHIP_GAP_PX : 0) + chipWidthPx(c), 0);
			expect(width).toBeLessThanOrEqual(RELMAP_CHIP_ROW_W);
		}
		// The last row leaves room for the "+N" pill.
		const last = many.rows.at(-1);
		const lastWidth = last.reduce((sum, c, i) => sum + (i ? RELMAP_CHIP_GAP_PX : 0) + chipWidthPx(c), 0);
		expect(lastWidth + RELMAP_CHIP_GAP_PX + chipWidthPx({ name: `+${many.hidden.length}` })).toBeLessThanOrEqual(RELMAP_CHIP_ROW_W);
		// Every chip is either drawn or counted.
		expect(many.rows.flat().length + many.hidden.length).toBe(7);
	});

	it("never draws one pill wider than a row", () => {
		expect(chipWidthPx({ name: "W".repeat(40), icon: "fa-star" })).toBe(RELMAP_CHIP_ROW_W);
	});

	it("reaches nothing further for somebody with no label and no chips", () => {
		const reach = personReach();
		expect(underReach({}, reach)).toEqual({ x: reach.x, down: 0 });
		expect(underReach({ chipRows: 2 }, reach)).toEqual({ x: RELMAP_CHIP_ROW_W / 2, down: chipReach(2) });
		expect(underReach({ subtitle: "Iron Knight" }, reach).x).toBe(reach.subX);
		expect(underReach({ subtitle: "Iron Knight", chipRows: 1 }, reach).down)
			.toBe(RELMAP_SUBTITLE_REACH_PX + RELMAP_CHIP_GAP_PX + RELMAP_CHIP_H_PX);
	});

	it("keeps the chips at their base size whatever the names dial says", () => {
		const chipped = { chipRows: 2 };
		for (const dial of [0.5, 1.5, 2]) {
			const reach = personReach(dial);
			expect(reach.chipH).toBe(RELMAP_CHIP_H_PX);
			expect(underReach(chipped, reach).down).toBe(chipReach(2));
		}
	});

	it("grows a group's outline, its floor and the board's frame round a chipped person", () => {
		const board = { width: 1200, height: 960 };
		const plain = { x: 50, y: 50 };
		const chipped = { x: 50, y: 50, chipRows: 2 };
		const a = groupOutline([plain], { board });
		const b = groupOutline([chipped], { board });
		expect(b.snug.bottom - a.snug.bottom).toBeCloseTo(chipReach(2), 5);
		expect(groupFloor([chipped]).h - groupFloor([plain]).h).toBe(chipReach(2));
		const low = { x: 50, y: 99 };
		expect(boardBounds([{ ...low, chipRows: 1 }], board).bottom - boardBounds([low], board).bottom).toBe(chipReach(1));
	});

	it("keeps a newcomer off a chipped person's chips", () => {
		const g = normalizeGraph({
			nodes: { a: { name: "A", x: 20, y: 30, chips: { dead: true } } },
			chips: { dead: { name: "Dead", icon: "fa-skull" } },
		});
		expect(takenSpots(g)).toEqual([{ left: 20, top: 30, under: chipReach(1), across: RELMAP_CHIP_ROW_W / 2 }]);
	});
});
