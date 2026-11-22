import { describe, it, expect } from "vitest";
import { buildCustomMoveData } from "../../module/utils/custom-move-data.js";
import { clampInt } from "../../module/utils/clamp-int.js";

// The shared shaping behind both save targets: the actor-embedded Moves-tab flow and
// the reusable world-item "Create Item → Move" flow. Both must author identical moves,
// so this locks the document shape rollStat / StonetopItem.roll depend on.
describe("buildCustomMoveData", () => {
	it("forces moveType 'other' and flags the move as custom", () => {
		const out = buildCustomMoveData({ name: "Reckless Charge" });
		expect(out.system.moveType).toBe("other");
		expect(out.flags["stonetop-pwd"].custom).toBe(true);
		expect(out).not.toHaveProperty("type"); // caller adds type:"move"
	});

	it("defaults a blank name to 'New Move' and trims", () => {
		expect(buildCustomMoveData({ name: "   " }).name).toBe("New Move");
		expect(buildCustomMoveData({}).name).toBe("New Move");
		expect(buildCustomMoveData({ name: "  Parley  " }).name).toBe("Parley");
	});

	it("keeps a valid roll stat and drops an unknown one", () => {
		expect(buildCustomMoveData({ rollType: "WIS" }).system.rollType).toBe("wis");
		expect(buildCustomMoveData({ rollType: "ask" }).system.rollType).toBe("ask");
		expect(buildCustomMoveData({ rollType: "luck" }).system.rollType).toBe("");
		expect(buildCustomMoveData({}).system.rollType).toBe("");
	});

	it("builds moveResults only when a roll AND some result text are present", () => {
		const withRoll = buildCustomMoveData({
			rollType: "str",
			results: { success: "you smash through", partial: "but", failure: "" },
		});
		expect(withRoll.system.moveResults).toEqual({
			success: { label: "10+", value: "you smash through" },
			partial: { label: "7-9", value: "but" },
			failure: { label: "6-", value: "" },
		});

		// A roll with no result text at all → null (a pure 2d6+stat move with no text).
		expect(buildCustomMoveData({ rollType: "str", results: {} }).system.moveResults).toBeNull();
		// Result text but no roll → null (a narrative move ignores stray result text).
		expect(buildCustomMoveData({ results: { success: "x" } }).system.moveResults).toBeNull();
	});

	it("builds a resource track only for a positive max, clamped to [0,20], with parsed labels", () => {
		const out = buildCustomMoveData({
			resource: { max: "3", title: "  Favor ", labels: "some, last, out" },
		});
		expect(out.system.resource).toEqual({ max: 3, title: "Favor", labels: ["some", "last", "out"] });

		expect(buildCustomMoveData({ resource: { max: 0 } }).system.resource).toBeNull();
		expect(buildCustomMoveData({ resource: { max: 99 } }).system.resource.max).toBe(20);
		expect(buildCustomMoveData({}).system.resource).toBeNull();
		// A blank title collapses to null; blank labels are filtered out.
		const blankTitle = buildCustomMoveData({ resource: { max: 2, title: "  ", labels: "a, , b" } });
		expect(blankTitle.system.resource).toEqual({ max: 2, title: null, labels: ["a", "b"] });
	});

	it("clamps hp/armor/load bonuses to [0,99] and coerces the noXp flag", () => {
		const out = buildCustomMoveData({
			hpBonus: "3", armorBonus: -5, loadBonus: 250, noXpOnMiss: 1,
		});
		expect(out.system.hpBonus).toBe(3);
		expect(out.system.armorBonus).toBe(0);
		expect(out.system.loadBonus).toBe(99);
		expect(out.system.noXpOnMiss).toBe(true);
		expect(buildCustomMoveData({}).system.noXpOnMiss).toBe(false);
	});

	it("escapes the description into stored paragraph HTML", () => {
		expect(buildCustomMoveData({ description: "When you <charge>" }).system.description)
			.toBe("<p>When you &lt;charge&gt;</p>");
		expect(buildCustomMoveData({}).system.description).toBe("");
	});
});

describe("clampInt", () => {
	it("truncates, coerces non-numbers to 0, and clamps to bounds", () => {
		expect(clampInt("5", 0, 10)).toBe(5);
		expect(clampInt(7.9, 0, 10)).toBe(7);
		expect(clampInt("nope", 0, 10)).toBe(0);
		expect(clampInt(-4, 0, 10)).toBe(0);
		expect(clampInt(99, 0, 10)).toBe(10);
	});
});

describe("buildCustomMoveData requirement", () => {
	it("keeps a printed prerequisite as the note requirementLabel reads", () => {
		expect(buildCustomMoveData({ name: "Commune with Aratis", requires: "  Prophet   background " }).system.requirement)
			.toEqual({ note: "Prophet background" });
	});

	it("is null (so an edit can clear it) when there is none", () => {
		expect(buildCustomMoveData({ name: "x", requires: "   " }).system.requirement).toBe(null);
		expect(buildCustomMoveData({ name: "x" }).system.requirement).toBe(null);
		expect(buildCustomMoveData({ name: "x" }, { requirement: { note: "old" } }).system.requirement).toBe(null);
	});

	// The dialog shows only the note, so an edit must not wipe what it never showed.
	it("keeps the rest of a stored requirement through an edit", () => {
		const stored = { moves: ["Bonded"], stats: { wis: 1 }, note: "old" };
		expect(buildCustomMoveData({ name: "x" }, { requirement: stored }).system.requirement)
			.toEqual({ moves: ["Bonded"], stats: { wis: 1 }, note: null });
		expect(buildCustomMoveData({ name: "x", requires: "Prophet" }, { requirement: stored }).system.requirement)
			.toEqual({ moves: ["Bonded"], stats: { wis: 1 }, note: "Prophet" });
	});
});
