import { describe, expect, it } from "vitest";
import {
	crewResetData, followerResetData, followerHasInventoryToClear, pcHasInventoryToClear,
} from "../../../module/actors/character/homecoming-reset.js";

// Reset Inventory, back home (Book I p.89): what a follower's and the crew's unpacking writes, and when
// there is nothing to write. Every reader is pure over the character's resolved flags.

const SCOPE = "stonetop-pwd";

describe("a follower's Reset Inventory", () => {
	it("unticks every line on a custom follower's list, keeps the lines, and forgets their Outfit", () => {
		const flags = { customFollowers: { abc: {
			name: "Bryn",
			gear: [{ label: "Spear", checked: true }, { label: "Beznpol hide", checked: false }],
			outfit: { regular: 2, small: 1, load: "normal" },
		} } };
		const data = followerResetData(flags, "custom", "abc");
		expect(data[`flags.${SCOPE}.customFollowers.abc.gear`]).toEqual([
			{ label: "Spear", checked: false },
			{ label: "Beznpol hide", checked: false },
		]);
		expect(data).toHaveProperty(`flags.${SCOPE}.customFollowers.abc.-=outfit`, null);
	});

	it("writes to a built-in follower's details", () => {
		const flags = { animalCompanion: { details: { gear: [{ label: "Harness", checked: true }] } } };
		expect(Object.keys(followerResetData(flags, "animal-companion"))).toEqual([`flags.${SCOPE}.animalCompanion.details.gear`]);
		const beast = { beastDetails: { mule: { gear: [{ label: "Saddlebags", checked: true }] } } };
		expect(Object.keys(followerResetData(beast, "beast", "mule"))).toEqual([`flags.${SCOPE}.beastDetails.mule.gear`]);
	});

	it("writes nothing for a follower who is already unpacked", () => {
		const flags = { customFollowers: { abc: { gear: [{ label: "Spear", checked: false }] } } };
		expect(followerResetData(flags, "custom", "abc")).toEqual({});
		expect(followerHasInventoryToClear(flags, "custom", "abc")).toBe(false);
		expect(followerHasInventoryToClear({}, "initiate", "nobody")).toBe(false);
	});

	it("counts a last Outfit's record as something to clear, since the card still says its load", () => {
		const flags = { initiateDetails: { ash: { gear: [], outfit: { regular: 0, small: 0, load: "light" } } } };
		expect(followerHasInventoryToClear(flags, "initiate", "ash")).toBe(true);
	});
});

describe("the crew's Reset Inventory", () => {
	it("empties every gear pip and every set of Supplies, keeping the slugs and the roster's length", () => {
		const flags = { crew: { name: "The Wolves", gear: { spears: 1, shields: 2, rope: 0 }, supplies: [5, 5, 2, 0] } };
		expect(crewResetData(flags)).toEqual({
			[`flags.${SCOPE}.crew.gear`]: { spears: 0, shields: 0, rope: 0 },
			[`flags.${SCOPE}.crew.supplies`]: [0, 0, 0, 0],
		});
	});

	it("unticks what one member produced, through the crew's own reset", () => {
		const flags = { crew: { name: "The Wolves", details: { gear: [{ label: "◇◇ litter (Lowri)", checked: true }] } } };
		expect(followerResetData(flags, "crew")[`flags.${SCOPE}.crew.details.gear`]).toEqual([{ label: "◇◇ litter (Lowri)", checked: false }]);
	});

	it("reads an old boolean pip as marked", () => {
		expect(crewResetData({ crew: { gear: { spears: true } } })).toEqual({ [`flags.${SCOPE}.crew.gear`]: { spears: 0 } });
	});

	it("writes nothing for a crew with nothing out", () => {
		const flags = { crew: { name: "The Wolves", gear: { spears: 0 }, supplies: [0, 0] } };
		expect(followerResetData(flags, "crew")).toEqual({});
		expect(crewResetData({})).toEqual({});
	});
});

describe("whether a PC has anything to unpack", () => {
	it("sees a mark, a reserve, a possession's gear, or food left in a supplies row", () => {
		expect(pcHasInventoryToClear({ inventory: { checked: { rope: true } } })).toBe(true);
		expect(pcHasInventoryToClear({ inventory: { regularPool: 2 } })).toBe(true);
		expect(pcHasInventoryToClear({ inventory: { smallPool: 1 } })).toBe(true);
		expect(pcHasInventoryToClear({ possessions: { choiceCarried: { "weapons-of-war:axe": true } } })).toBe(true);
		expect(pcHasInventoryToClear({ inventory: { resources: { supplies: 3 } } })).toBe(true);
	});

	it("does not count what a reset leaves alone: unmarked rows, provisions, ammo", () => {
		expect(pcHasInventoryToClear({})).toBe(false);
		expect(pcHasInventoryToClear({ inventory: {
			checked: { rope: false }, regularPool: 0,
			resources: { supplies: 0, provisions: 6, arrows: 2 },
		} })).toBe(false);
	});
});
