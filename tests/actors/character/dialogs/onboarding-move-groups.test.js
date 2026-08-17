import { describe, it, expect } from "vitest";
import {
	ONBOARDING_MOVE_GROUPS,
	moveGroupsForPlaybook,
	moveGroupKeys,
	partitionMovesByGroup,
	UNGROUPED_MOVE_KEY,
} from "../../../../module/actors/character/dialogs/onboarding-move-groups.js";

const named = (...names) => names.map(name => ({ name }));

describe("onboarding move groups — table shape", () => {
	it("gives every playbook exactly three chips", () => {
		for (const [playbook, groups] of Object.entries(ONBOARDING_MOVE_GROUPS)) {
			expect(groups, playbook).toHaveLength(3);
		}
	});

	// The sheet buckets a move into the FIRST group that claims it, so an overlap
	// would silently drop the move out of every later group's heading. Nothing in the
	// table overlaps today; this is the guard on the next name someone adds.
	it("never lists one move under two of a playbook's groups", () => {
		for (const [playbook, groups] of Object.entries(ONBOARDING_MOVE_GROUPS)) {
			const seen = new Set();
			for (const group of groups) {
				for (const move of group.moves) {
					expect(seen.has(move), `${playbook}: ${move}`).toBe(false);
					seen.add(move);
				}
			}
		}
	});
});

describe("moveGroupsForPlaybook / moveGroupKeys", () => {
	it("returns the chips for a known playbook and nothing for an unknown one", () => {
		expect(moveGroupsForPlaybook("The Blessed")).toEqual([
			{ key: "spirits", label: "Spirits" },
			{ key: "nature",  label: "Nature" },
			{ key: "wards",   label: "Wards" },
		]);
		expect(moveGroupsForPlaybook("The Homebrew")).toEqual([]);
	});

	it("reports the groups a move belongs to", () => {
		expect(moveGroupKeys("The Blessed", "Barkskin")).toEqual(["nature"]);
		expect(moveGroupKeys("The Blessed", "Improved Stat")).toEqual([]);
		expect(moveGroupKeys("The Homebrew", "Barkskin")).toEqual([]);
	});
});

describe("partitionMovesByGroup", () => {
	it("buckets a playbook's moves into its three groups, in table order", () => {
		const groups = partitionMovesByGroup("The Blessed",
			named("Barkskin", "Veil", "Spirit Tongue", "Wild Soul"));

		expect(groups.map(g => [g.key, g.moves.map(m => m.name)])).toEqual([
			["spirits", ["Spirit Tongue"]],
			["nature",  ["Barkskin", "Wild Soul"]],
			["wards",   ["Veil"]],
		]);
	});

	it("keeps the order the moves arrive in, so owned-first sorting survives", () => {
		const groups = partitionMovesByGroup("The Blessed",
			named("Wild Soul", "Barkskin", "Lightning Rod"));

		expect(groups.find(g => g.key === "nature").moves.map(m => m.name))
			.toEqual(["Wild Soul", "Barkskin", "Lightning Rod"]);
	});

	it("collects what no group claims into a trailing 'Other'", () => {
		const groups = partitionMovesByGroup("The Blessed",
			named("Improved Stat", "Barkskin", "Superior Stat", "Heed My Words"));

		expect(groups.map(g => g.key)).toEqual(["nature", UNGROUPED_MOVE_KEY]);
		expect(groups.at(-1).label).toBe("Other");
		expect(groups.at(-1).moves.map(m => m.name))
			.toEqual(["Improved Stat", "Superior Stat", "Heed My Words"]);
	});

	it("drops groups that came out empty", () => {
		const groups = partitionMovesByGroup("The Blessed", named("Barkskin"));
		expect(groups.map(g => g.key)).toEqual(["nature"]);
	});

	// [] is the caller's signal to render one flat list instead.
	it("returns nothing for a playbook it has no groups for", () => {
		expect(partitionMovesByGroup("The Homebrew", named("Barkskin"))).toEqual([]);
		expect(partitionMovesByGroup(null, named("Barkskin"))).toEqual([]);
	});

	it("tolerates a missing move list", () => {
		expect(partitionMovesByGroup("The Blessed", undefined)).toEqual([]);
	});
});
