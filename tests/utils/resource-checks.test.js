import { describe, expect, it } from "vitest";
import { resourceCheckGroups, resourceCheckItems, resourceCheckName } from "../../module/utils/resource-checks.js";

// A resource track's circles are empty buttons, so each carries a spoken name (utils/resource-checks.js);
// the state and the absolute index the click handlers read are unchanged.

describe("a resource track's circles", () => {
	it("are named for the track, which circle of how many, and the label beside it", () => {
		expect(resourceCheckItems({ title: "Ammo", current: 1, max: 2, labels: ["low", "out"] })).toEqual([
			{ checked: true, label: "low", index: 0, name: "Ammo 1 of 2: low" },
			{ checked: false, label: "out", index: 1, name: "Ammo 2 of 2: out" },
		]);
	});

	it("fall back to “Mark” for a track with no title, and take no labels", () => {
		expect(resourceCheckItems({ current: 0, max: 1 })).toEqual([{ checked: false, label: null, index: 0, name: "Mark 1 of 1" }]);
	});

	it("are none for no track", () => {
		expect(resourceCheckItems(null)).toEqual([]);
		expect(resourceCheckGroups(undefined)).toEqual([]);
	});

	it("keep their absolute index and name when grouped in fives", () => {
		const groups = resourceCheckGroups({ title: "Stock", current: 6, max: 7 });
		expect(groups.map(g => g.length)).toEqual([5, 2]);
		expect(groups[1][0]).toMatchObject({ index: 5, checked: true, name: "Stock 6 of 7" });
	});

	it("names a circle from its parts", () => {
		expect(resourceCheckName("  ", 2, 3)).toBe("Mark 3 of 3");
		expect(resourceCheckName("Uses", 0, 3, "spent")).toBe("Uses 1 of 3: spent");
	});
});
