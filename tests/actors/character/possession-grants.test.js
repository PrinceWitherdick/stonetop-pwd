import { describe, it, expect, afterEach } from "vitest";
import {
	grantsToCreate,
	grantAdoptionKeys,
	grantSourceMap,
	itemGrantKey,
	grantOfTaggedItem,
	grantRepair,
} from "../../../module/actors/character/possession-grants.js";

const APIARY = [
	{ name: "Beeswax", column: "small" },
	{ name: "Honey", column: "small" },
	{ name: "Bee smokers", column: "regular", weight: 1 },
	{ name: "Hat & veils", column: "regular", weight: 1 },
];

describe("grantsToCreate", () => {
	it("maps small items to the small column with no weight", () => {
		const out = grantsToCreate([{ name: "Honey", column: "small" }], new Set(), { slug: "apiary", sourceLabel: "Apiary" });
		expect(out).toEqual([{
			name: "Honey",
			type: "move",
			system: {
				moveType: "inventory-custom",
				inventoryColumn: "small",
				sourcePossession: "apiary",
				sourceKey: "Honey",
				sourceLabel: "Apiary",
			},
		}]);
		expect(out[0].system).not.toHaveProperty("weight");
	});

	it("maps regular items to the regular column carrying their weight", () => {
		const [item] = grantsToCreate([{ name: "Bee smokers", column: "regular", weight: 2 }], new Set(), { slug: "apiary", sourceLabel: "Apiary" });
		expect(item.system.inventoryColumn).toBe("regular");
		expect(item.system.weight).toBe(2);
	});

	it("defaults a regular item's weight to 1 ◇ when unspecified", () => {
		const [item] = grantsToCreate([{ name: "Notebook", column: "regular" }], new Set(), { slug: "scribes-tools" });
		expect(item.system.weight).toBe(1);
	});

	it("skips items already present (matched by sourceKey)", () => {
		const out = grantsToCreate(APIARY, new Set(["Beeswax", "Bee smokers"]), { slug: "apiary", sourceLabel: "Apiary" });
		expect(out.map(i => i.name)).toEqual(["Honey", "Hat & veils"]);
	});

	it("returns nothing when every item is already present", () => {
		const out = grantsToCreate(APIARY, new Set(["Beeswax", "Honey", "Bee smokers", "Hat & veils"]), { slug: "apiary" });
		expect(out).toEqual([]);
	});

	it("ignores entries without a name and tolerates an empty/undefined list", () => {
		expect(grantsToCreate([{ column: "small" }], new Set(), { slug: "x" })).toEqual([]);
		expect(grantsToCreate(undefined, new Set(), { slug: "x" })).toEqual([]);
		expect(grantsToCreate()).toEqual([]);
	});

	it("carries a null sourceLabel through when none is supplied", () => {
		const [item] = grantsToCreate([{ name: "Honey", column: "small" }], new Set(), { slug: "apiary" });
		expect(item.system.sourceLabel).toBeNull();
	});

	it("passes a worn item's armor shape through to system.armor", () => {
		const [item] = grantsToCreate(
			[{ name: "Boiled leather cuirass (1 armor)", column: "regular", weight: 1, armor: { base: 1 } }],
			new Set(), { slug: "tannery", sourceLabel: "Tannery" },
		);
		expect(item.system.armor).toEqual({ base: 1 });
	});

	it("leaves armor off items that don't grant any", () => {
		const [item] = grantsToCreate([{ name: "Lime", column: "small" }], new Set(), { slug: "tannery" });
		expect(item.system).not.toHaveProperty("armor");
	});
});

// The rule for recognising UNTAGGED legacy gear — gear from before MoveModel declared
// `sourcePossession`, which therefore names no owner. Shared by the gear tab (which renders it
// inside a possession's card), the select path (which declines to duplicate it) and the deselect
// path (which DELETES it), so its edges are exactly where a player's own write-in is safe.
describe("grantAdoptionKeys", () => {
	const BURGLARS_KIT = {
		slug: "burglars-kit",
		grantsItems: [
			{ name: "Grappling hook", column: "regular", weight: 1 },
			{ name: "Lockpicks", column: "small" },
		],
	};
	const CARPENTERS = {
		slug: "carpenters-tools",
		grantsItems: [{ name: "Firkins", column: "regular", weight: 1 }, { name: "Nails", column: "small" }],
	};
	const DISTILLERY = {
		slug: "distillery",
		grantsItems: [
			{ name: "Firkins", column: "regular", weight: 1 },
			// The shape that first broke the collision guard: sourceKey repeated in aliases.
			{
				name: "Skins of fine whisky",
				sourceKey: "Fine whisky (advantage to Persuade)",
				aliases: ["Fine whisky (advantage to Persuade)", "Fine whisky"],
				column: "small",
			},
		],
	};

	const item = (name, inventoryColumn) => ({ name, system: { inventoryColumn } });

	it("keys a grant by the column it lands in as well as its name", () => {
		const keys = grantAdoptionKeys("burglars-kit", [BURGLARS_KIT]);
		expect([...keys.keys()].sort()).toEqual(["regular:Grappling hook", "small:Lockpicks"]);
	});

	// The one that let a deselect delete a player's own gear: a hand-written SMALL "Grappling
	// hook" is not the Burglar's Kit's ◇ regular one, however alike they read.
	it("will not claim a write-in sitting in the other column", () => {
		const keys = grantAdoptionKeys("burglars-kit", [BURGLARS_KIT]);
		expect(keys.has(itemGrantKey(item("Grappling hook", "regular")))).toBe(true);
		expect(keys.has(itemGrantKey(item("Grappling hook", "small")))).toBe(false);
	});

	// Two possessions granting the same thing cannot both own one untagged item, and guessing
	// between them is how an item gets rendered under one and deleted by the other.
	it("lets neither possession claim a name they both grant", () => {
		const mine   = grantAdoptionKeys("distillery", [CARPENTERS, DISTILLERY]);
		const theirs = grantAdoptionKeys("carpenters-tools", [CARPENTERS, DISTILLERY]);
		expect(mine.has("regular:Firkins")).toBe(false);
		expect(theirs.has("regular:Firkins")).toBe(false);
		// Only the contested name is dropped — the rest of each possession still claims its own.
		expect(mine.has("small:Fine whisky")).toBe(true);
		expect(theirs.has("small:Nails")).toBe(true);
	});

	// A possession the character does not hold contests nothing, so the same name is claimable
	// again the moment the rival is deselected.
	it("only counts possessions that are actually held", () => {
		expect(grantAdoptionKeys("distillery", [DISTILLERY]).has("regular:Firkins")).toBe(true);
	});

	it("answers every alias of a grant with that same grant", () => {
		const keys = grantAdoptionKeys("distillery", [DISTILLERY]);
		for (const name of ["Skins of fine whisky", "Fine whisky (advantage to Persuade)", "Fine whisky"]) {
			expect(keys.get(`small:${name}`)?.sourceKey).toBe("Fine whisky (advantage to Persuade)");
		}
	});

	it("tolerates possessions with no grants at all", () => {
		expect(grantAdoptionKeys("mastiffs", [{ slug: "mastiffs" }]).size).toBe(0);
		expect(grantAdoptionKeys("mastiffs", []).size).toBe(0);
		expect(grantAdoptionKeys("mastiffs").size).toBe(0);
	});

	it("names the owner of each uncontested key, and null for a contested one", () => {
		const sources = grantSourceMap([CARPENTERS, DISTILLERY]);
		expect(sources.get("small:Nails").slug).toBe("carpenters-tools");
		expect(sources.get("regular:Firkins")).toBeNull();
	});
});

describe("itemGrantKey", () => {
	it("files anything that is not the regular column as small, matching the grant side", () => {
		expect(itemGrantKey({ name: "Nails", system: { inventoryColumn: "regular" } })).toBe("regular:Nails");
		expect(itemGrantKey({ name: "Nails", system: { inventoryColumn: "small" } })).toBe("small:Nails");
		expect(itemGrantKey({ name: "Nails", system: {} })).toBe("small:Nails");
		expect(itemGrantKey({ name: "Nails" })).toBe("small:Nails");
	});
});

// Gear is made once and nothing revisits it, so a grant corrected in a later release (the Tannery
// cuirass, `{modifier: 1}` from 1.3.2 to 1.6.0, `{base: 1}` now) stayed wrong on the characters
// who took it. These two decide which grant a tagged item came from and what to rewrite.
describe("grantOfTaggedItem", () => {
	const BURGLARS_KIT = {
		slug: "burglars-kit",
		grantsItems: [
			// Renamed, keeping the old name as its sourceKey: the items made before still carry it.
			{ name: "Lantern", sourceKey: "Lantern (close, area)", column: "regular", weight: 1, resource: { max: 5 } },
			{ name: "Grappling hook", column: "regular", weight: 1 },
		],
	};
	const tagged = (name, sourceKey) => ({ name, system: { sourcePossession: "burglars-kit", sourceKey } });

	it("finds the grant by the sourceKey it stamped, whatever the item is called now", () => {
		expect(grantOfTaggedItem(tagged("Lantern (close, area)", "Lantern (close, area)"), BURGLARS_KIT).name).toBe("Lantern");
		expect(grantOfTaggedItem(tagged("Grappling hook", "Grappling hook"), BURGLARS_KIT).name).toBe("Grappling hook");
	});

	it("falls back to the item's current name when its sourceKey no longer names a grant", () => {
		expect(grantOfTaggedItem(tagged("Grappling hook", "Hook (old)"), BURGLARS_KIT).name).toBe("Grappling hook");
	});

	it("names no grant for an item it cannot place, or a name two grants share", () => {
		expect(grantOfTaggedItem(tagged("Crowbar", "Crowbar"), BURGLARS_KIT)).toBeNull();
		expect(grantOfTaggedItem(tagged("Lantern", null), { grantsItems: [
			{ name: "Lantern", column: "regular" }, { name: "Lanterns", aliases: ["Lantern"], column: "regular" },
		] })).toBeNull();
		expect(grantOfTaggedItem(tagged("Lantern", "Lantern"), undefined)).toBeNull();
	});
});

describe("grantRepair", () => {
	const CUIRASS = { name: "Boiled leather cuirass (1 armor)", column: "regular", weight: 1, armor: { base: 1 } };
	const item = system => ({ _id: "c", name: CUIRASS.name, system: { moveType: "inventory-custom", sourcePossession: "tannery", sourceKey: CUIRASS.name, ...system } });

	const release = globalThis.game?.release;
	afterEach(() => { if (globalThis.game) globalThis.game.release = release; });

	it("turns an old stacking-modifier cuirass into worn armor, DELETING the modifier (v13 spelling)", () => {
		const repair = grantRepair(item({ inventoryColumn: "regular", weight: 1, armor: { modifier: 1 } }), CUIRASS);
		// An update MERGES into an object field, so writing {base: 1} alone would leave a
		// {base: 1, modifier: 1} that still counts twice. The modifier has to be removed.
		expect(repair.update).toEqual({ "system.armor.base": 1, "system.armor.-=modifier": null });
		expect(repair.resourceMax).toBeNull();
	});

	it("deletes with a ForcedDeletion instance on v14", () => {
		globalThis.game.release = { generation: 14 };
		const repair = grantRepair(item({ inventoryColumn: "regular", weight: 1, armor: { modifier: 1 } }), CUIRASS);
		expect(repair.update["system.armor.base"]).toBe(1);
		expect(repair.update["system.armor.modifier"]).toBeInstanceOf(foundry.data.operators.ForcedDeletion);
	});

	it("is null for an item that already matches, so a second run writes nothing", () => {
		expect(grantRepair(item({ inventoryColumn: "regular", weight: 1, armor: { base: 1 } }), CUIRASS)).toBeNull();
		expect(grantRepair(item({ inventoryColumn: "small", weight: 1 }), { name: "Lime", column: "small" })).toBeNull();
	});

	it("corrects the column, a ◇ item's weight, and armor a grant has dropped or gained", () => {
		expect(grantRepair(item({ inventoryColumn: "small", weight: 1, armor: { base: 1 } }), CUIRASS).update)
			.toEqual({ "system.inventoryColumn": "regular" });
		expect(grantRepair(item({ inventoryColumn: "regular", weight: 2, armor: { base: 1 } }), CUIRASS).update)
			.toEqual({ "system.weight": 1 });
		expect(grantRepair(item({ inventoryColumn: "regular", weight: 1, armor: { base: 1 } }), { ...CUIRASS, armor: undefined }).update)
			.toEqual({ "system.armor": null });
		expect(grantRepair(item({ inventoryColumn: "regular", weight: 1, armor: null }), CUIRASS).update)
			.toEqual({ "system.armor": { base: 1 } });
	});

	it("resizes a uses track to the grant's max but leaves the rest of it, and the name, alone", () => {
		const LANTERN = { name: "Lantern", sourceKey: "Lantern (close, area)", column: "regular", weight: 1, resource: { max: 5, title: null, labels: [] } };
		const old = { _id: "l", name: "Lantern (close, area)", system: { inventoryColumn: "regular", weight: 1, resource: { max: 6, title: "Oil", labels: [] } } };
		expect(grantRepair(old, LANTERN)).toEqual({ update: { "system.resource.max": 5 }, resourceMax: 5 });
	});

	it("gives an item with no track of its own none (the sheet reads the grant's already)", () => {
		const WHISKY = { name: "Skins of fine whisky", column: "small", resource: { max: 2 } };
		expect(grantRepair({ name: "Fine whisky", system: { inventoryColumn: "small" } }, WHISKY)).toBeNull();
	});

	it("does nothing without both an item and a grant", () => {
		expect(grantRepair(item({ inventoryColumn: "regular" }), null)).toBeNull();
		expect(grantRepair(null, CUIRASS)).toBeNull();
	});
});
