import { describe, it, expect } from "vitest";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";

// The Would-Be Hero is the only playbook that can pick a stat-increase move (Improved
// Stat, cap 2) at creation — it's among its "2 other moves of your choice". Onboarding
// must collect the "+1 to which stat?" choice for it, or the move grants nothing. These
// tests drive the dialog's choice-collection helpers directly (no live Foundry), building
// an instance via the same Object.create path the class's own static probes use.

// Minimal Would-Be Hero playbook doc: enough for _initializeState to build steps and
// parse a 2-move free pick.
const WBH_DOC = {
	name: "The Would-Be Hero",
	flags: {
		stonetop: {
			statsNote: "Assign these scores to your stats: +1, +0, +0, +0, +0, -1",
			moves: {
				startingMovesNote:
					"You start with Anger is a Gift, Potential for Greatness, and 2 other moves of your choice.",
			},
		},
	},
};

// Stand-in move docs the moves step would otherwise load from the compendium.
const IMPROVED_STAT = { id: "imp1", name: "Improved Stat", system: { cap: 2, moveType: "playbook" } };
const IRON_WILL     = { id: "iron1", name: "Iron Will",     system: { cap: null } };

function makeDialog(selectionOverrides = {}) {
	const d = Object.create(CharacterOnboardingDialog.prototype);
	d._initializeState(WBH_DOC, null, null);
	d._movesCache = [IMPROVED_STAT, IRON_WILL];
	Object.assign(d._selections, selectionOverrides);
	return d;
}

describe("onboarding stat-increase move choice", () => {
	it("reports the pick count parsed from the WBH note", () => {
		const d = makeDialog();
		expect(d._movePickCount).toBe(2);
	});

	it("identifies a selected Improved Stat as a stat move needing a choice", () => {
		const d = makeDialog({ moves: ["imp1", "iron1"] });
		expect(d._selectedStatMoveIds()).toEqual(["imp1"]);
	});

	it("builds a stat picker with all stats below cap selectable", () => {
		const d = makeDialog({ stats: { str: 1, dex: 0, con: 0, int: 0, wis: 0, cha: -1 } });
		const data = d._moveStatChoiceData("imp1", 2);
		expect(data.cap).toBe(2);
		expect(data.options).toHaveLength(6);
		// WBH's best stat is +1, still under the +2 cap, so nothing is disabled.
		expect(data.options.every(o => !o.disabled)).toBe(true);
		const str = data.options.find(o => o.key === "str");
		expect(str.currentDisplay).toBe("+1");
		expect(str.nextDisplay).toBe("+2");
	});

	it("disables a stat already at the cap", () => {
		const d = makeDialog({ stats: { str: 2, dex: 0, con: 0, int: 0, wis: 0, cha: -1 } });
		const str = d._moveStatChoiceData("imp1", 2).options.find(o => o.key === "str");
		// atCap is the single flag the template drives both the disabled attribute and
		// the "(max)" delta from.
		expect(str.atCap).toBe(true);
		expect(str.currentDisplay).toBe("+2");
	});

	it("marks the chosen stat selected", () => {
		const d = makeDialog({ moves: ["imp1"], moveStatChoices: { imp1: "dex" } });
		const opts = d._moveStatChoiceData("imp1", 2).options;
		expect(opts.find(o => o.key === "dex").selected).toBe(true);
		expect(opts.filter(o => o.selected)).toHaveLength(1);
	});

	it("blocks the moves step until the stat is chosen, then allows it", () => {
		const d = makeDialog({ moves: ["imp1", "iron1"] });
		// Both moves picked (2 of 2) but Improved Stat has no stat yet → incomplete.
		expect(d._isStepComplete("moves")).toBe(false);
		d._selections.moveStatChoices.imp1 = "con";
		expect(d._isStepComplete("moves")).toBe(true);
	});

	it("does not block the moves step when no stat move is picked", () => {
		const d = makeDialog({ moves: ["iron1", "iron1"] });
		// Two non-stat moves; length check is what gates, not any stat choice.
		d._selections.moves = ["iron1", "other1"];
		expect(d._isStepComplete("moves")).toBe(true);
	});

	it("drops a stat pick when its move is unselected", () => {
		const d = makeDialog({ moves: ["iron1"], moveStatChoices: { imp1: "str" } });
		d._reconcileMoveStatChoices();
		expect(d._selections.moveStatChoices).toEqual({});
	});

	it("drops a stat pick when the chosen stat is now at the cap", () => {
		const d = makeDialog({
			moves: ["imp1"],
			stats: { str: 2, dex: 0, con: 0, int: 0, wis: 0, cha: -1 },
			moveStatChoices: { imp1: "str" },
		});
		d._reconcileMoveStatChoices();
		expect(d._selections.moveStatChoices).toEqual({});
	});

	it("keeps a valid stat pick through reconciliation", () => {
		const d = makeDialog({
			moves: ["imp1"],
			stats: { str: 1, dex: 0, con: 0, int: 0, wis: 0, cha: -1 },
			moveStatChoices: { imp1: "str" },
		});
		d._reconcileMoveStatChoices();
		expect(d._selections.moveStatChoices).toEqual({ imp1: "str" });
	});
});
