import { describe, expect, it, vi, beforeEach } from "vitest";
import { contentOptionsFor } from "../../module/dialogs/create-stonetop-content-dialog.js";

// Only the CHOOSER is faked. Running the flow on the picked row is the real `runPickedOption`,
// because a group row's refine window is exactly that dispatch, one level down.
const picker = vi.hoisted(() => ({ pick: vi.fn() }));
vi.mock("../../module/dialogs/content-picker.js", async (importOriginal) => ({
	...(await importOriginal()),
	pickContentOption: picker.pick,
}));

beforeEach(() => picker.pick.mockReset());

const ids = rows => rows.map(r => r.id);

describe("the first window", () => {
	// A homebrew playbook is world prep, so the GM alone sees that row; a player's list below is unchanged.
	it("offers the GM five broad kinds, a homebrew playbook among them", () => {
		expect(ids(contentOptionsFor(true, { canArcana: true })))
			.toEqual(["gear", "move", "playbook", "improvement", "dangers"]);
	});

	// A player may make only an inventory item under Gear & Treasure, so the group would be a
	// window with one choice in it. The item's own row stands in its place instead.
	it("offers a player the inventory item's own row, not a one-choice group", () => {
		const rows = contentOptionsFor(false);
		expect(ids(rows)).toEqual(["inventory", "move", "improvement"]);
		expect(rows[0].label).toBe("Inventory Item");
	});

	it("keeps the group for a player who may author arcana", () => {
		expect(ids(contentOptionsFor(false, { canArcana: true }))).toEqual(["gear", "move", "improvement"]);
	});

	it("gives every row an icon, a hint and a flow", () => {
		for (const row of contentOptionsFor(true, { canArcana: true })) {
			expect(row.icon).toMatch(/^fa-/);
			expect(row.hint.length).toBeGreaterThan(0);
			expect(typeof row.create).toBe("function");
		}
	});
});

describe("refining a group", () => {
	const group = (id, opts) => contentOptionsFor(true, opts).find(r => r.id === id);

	it("opens Gear & Treasure on its rows, arcana under their own heading", async () => {
		picker.pick.mockResolvedValue(null);
		await group("gear", { canArcana: true }).create();
		const { title, options } = picker.pick.mock.calls[0][0];
		expect(title).toBe("Create Gear or Treasure");
		expect(options.map(r => r.heading ?? r.id))
			.toEqual(["inventory", "treasure", "Arcana", "arcanumBlank", "arcanumInspire"]);
	});

	// A GM kept out of arcana (the setting is theirs to flip, but the gate is one function) still
	// sees Treasure beside the item, and no "Arcana" caption over nothing.
	it("drops a heading with no rows left under it", async () => {
		picker.pick.mockResolvedValue(null);
		await group("gear", { canArcana: false }).create();
		expect(picker.pick.mock.calls[0][0].options.map(r => r.heading ?? r.id))
			.toEqual(["inventory", "treasure"]);
	});

	it("opens Dangers & Places with the Things Below under their heading", async () => {
		picker.pick.mockResolvedValue(null);
		await group("dangers").create();
		const { title, options } = picker.pick.mock.calls[0][0];
		expect(title).toBe("Create a Danger or Place");
		expect(options.map(r => r.heading ?? r.id))
			.toEqual(["threat", "site", "The Things Below", "thing", "corruptedSite", "being", "emanation"]);
	});

	it("does nothing when the refine window is dismissed", async () => {
		picker.pick.mockResolvedValue(null);
		expect(await group("dangers").create()).toBeNull();
	});
});
