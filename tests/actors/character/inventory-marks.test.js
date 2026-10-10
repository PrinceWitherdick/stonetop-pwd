import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeInventoryRepository } from "../../fakes/FakeInventoryRepository.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { SUPPLY_PURPOSE } from "../../../module/actors/character/supply-cost.js";
import { WRITE_IN_SOURCE } from "../../../module/actors/character/write-in-source.js";
import { stubAsk } from "../../fakes/confirm.js";

/**
 * The Inventory tab's marks, draws and supplies, written against an actor that MERGES flag objects
 * the way Foundry does. The shared fakes replace a flag object outright, so a write that only
 * works under replace (an emptied map written over a full one) passed against them and did
 * nothing in a real world.
 */

const SCOPE = "stonetop-pwd";

function isPlain(v) {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Foundry's update: a plain object merges into what is there, key by key; anything else replaces.
function mergeAt(root, path, value) {
	const parts = String(path).split(".");
	let node = root;
	for (const key of parts.slice(0, -1)) {
		if (!isPlain(node[key])) node[key] = {};
		node = node[key];
	}
	const leaf = parts.at(-1);
	if (isPlain(value) && isPlain(node[leaf])) {
		for (const [k, v] of Object.entries(value)) mergeAt(node[leaf], k, v);
	} else {
		node[leaf] = isPlain(value) ? structuredClone(value) : value;
	}
}

function unsetAt(root, path) {
	const parts = String(path).split(".");
	let node = root;
	for (const key of parts.slice(0, -1)) {
		node = node?.[key];
		if (!node) return;
	}
	delete node[parts.at(-1)];
}

/** A FakeActorBuilder actor whose setFlag and update merge like Foundry's. */
function mergingActor(flags = {}) {
	const builder = new FakeActorBuilder();
	for (const [key, value] of Object.entries(flags)) builder.withFlag(key, value);
	const actor = builder.build();
	actor.setFlag = vi.fn(async (scope, key, value) => mergeAt(actor.flags[scope], key, value));
	actor.update = vi.fn(async (data = {}) => {
		for (const [path, value] of Object.entries(data)) {
			const parts = path.split(".");
			const leaf = parts.at(-1);
			if (leaf.startsWith("-=")) unsetAt(actor, [...parts.slice(0, -1), leaf.slice(2)].join("."));
			else mergeAt(actor, path, value);
		}
	});
	return actor;
}

function makeChar(actor) {
	return new TestCharacterBuilder(actor)
		.withPlaybookRepo(null)
		.withMoveRepo(null)
		.withInventoryRepo(new FakeInventoryRepository([]))
		.build();
}

const flag = (actor, key) => actor.getFlag(SCOPE, key);

afterEach(() => {
	delete global.game.actors;
});

describe("a Have What You Need draw record (INV-3)", () => {
	it("is forgotten when its item is un-marked, so a later un-mark cannot hand it back twice", async () => {
		const actor = mergingActor({ "inventory.regularPool": 3 });
		const char = makeChar(actor);
		await char.toggleCarriedItem("rope", true, { weight: 1 });    // draws 1: pool 2
		await char.toggleCarriedItem("rope", false, { weight: 1 });   // returns 1: pool 3
		expect(flag(actor, "inventory.drawn")).not.toHaveProperty("rope");

		await char.setInventoryRegularPool(0);                         // the reserve spent elsewhere
		await char.toggleCarriedItem("rope", true, { weight: 1 });    // nothing to draw: loot
		await char.toggleCarriedItem("rope", false, { weight: 1 });   // nothing to give back
		expect(flag(actor, "inventory.regularPool")).toBe(0);
	});

	it("does not outlive an Outfit, so un-marking gear defined there returns nothing", async () => {
		const actor = mergingActor({ "inventory.regularPool": 3 });
		const char = makeChar(actor);
		await char.toggleCarriedItem("shovel", true, { weight: 1 });  // a field draw: { shovel: 1 }
		await char.applyOutfit({ shovel: true }, 0, 0);                // Outfit again, shovel defined
		expect(flag(actor, "inventory.drawn") ?? {}).not.toHaveProperty("shovel");
		await char.toggleCarriedItem("shovel", false, { weight: 1 }); // dropped in the field
		expect(flag(actor, "inventory.regularPool")).toBe(0);
	});
});

describe("item marks are written one slug at a time (INV-12)", () => {
	it("marks one item without re-sending anybody else's mark", async () => {
		const actor = mergingActor({ "inventory.checked": { cloak: true, rope: false } });
		await makeChar(actor).setInventoryItemChecked("rope", true);
		const written = [...actor.update.mock.calls.map(c => c[0]), ...actor.setFlag.mock.calls.map(c => ({ [c[1]]: c[2] }))];
		expect(written).toEqual([{ [`flags.${SCOPE}.inventory.checked.rope`]: true }]);
		expect(flag(actor, "inventory.checked")).toEqual({ cloak: true, rope: true });
	});

	it("has an Outfit write only the marks it names, each as its own key", async () => {
		const actor = mergingActor({ "inventory.checked": { cloak: true } });
		await makeChar(actor)._inventory.setAllChecked({ rope: true, spear: false });
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(actor.update).toHaveBeenCalledWith({
			[`flags.${SCOPE}.inventory.checked.rope`]:  true,
			[`flags.${SCOPE}.inventory.checked.spear`]: false,
		}, undefined);
		expect(flag(actor, "inventory.checked")).toEqual({ cloak: true, rope: true, spear: false });
	});
});

describe("a ◆ of supplies (INV-4)", () => {
	it("comes full when Have What You Need makes it from an undefined ◆ on the sheet", async () => {
		const actor = mergingActor({ "inventory.regularPool": 2, "inventory.resources": { supplies: 0 } });
		await makeChar(actor).toggleCarriedItem("supplies", true, { weight: 1 });
		// No steading: 4+0 ("+0 by default", Book I p.88).
		expect(flag(actor, "inventory.resources").supplies).toBe(4);
		expect(flag(actor, "inventory.regularPool")).toBe(1);
	});

	// IA-1: the tick moves the ◆, not the food.
	it("is not refilled by un-ticking and re-ticking it once some food is gone", async () => {
		const actor = mergingActor({ "inventory.regularPool": 2, "inventory.resources": { supplies: 0 } });
		const char = makeChar(actor);
		await char.toggleCarriedItem("supplies", true, { weight: 1 });    // fresh: 4 uses, pool 1
		await char.setInventoryResource("supplies", 1);                    // three eaten
		await char.toggleCarriedItem("supplies", false, { weight: 1 });   // a real ◆ now: nothing back
		expect(flag(actor, "inventory.regularPool")).toBe(1);
		await char.toggleCarriedItem("supplies", true, { weight: 1 });    // a NEW ◆ from the last undefined
		expect(flag(actor, "inventory.regularPool")).toBe(0);
		expect(flag(actor, "inventory.resources").supplies).toBe(4);
		await char.setInventoryResource("supplies", 2);
		await char.toggleCarriedItem("supplies", false, { weight: 1 });
		await char.toggleCarriedItem("supplies", true, { weight: 1 });    // no undefined ◆: picked back up
		expect(flag(actor, "inventory.resources").supplies).toBe(2);
		expect(flag(actor, "inventory.regularPool")).toBe(0);
	});

	it("gives its undefined ◆ back while still full, and a re-tick then changes nothing", async () => {
		const actor = mergingActor({ "inventory.regularPool": 1, "inventory.resources": {} });
		const char = makeChar(actor);
		await char.toggleCarriedItem("supplies", true, { weight: 1 });
		await char.toggleCarriedItem("supplies", false, { weight: 1 });   // a misclick, nothing eaten
		expect(flag(actor, "inventory.regularPool")).toBe(1);
		await char.toggleCarriedItem("supplies", true, { weight: 1 });
		expect(flag(actor, "inventory.regularPool")).toBe(0);
		expect(flag(actor, "inventory.resources").supplies).toBe(4);
	});

	it("is packed full by every Outfit that leaves it marked, and emptied by one that doesn't", async () => {
		const actor = mergingActor({
			"inventory.checked":   { supplies: true },
			"inventory.resources": { supplies: 1, "more-supplies": 2 },
		});
		// A second Outfit with the row still marked restocks it (Book I p.77, p.88).
		await makeChar(actor).applyOutfit({ supplies: true, "more-supplies": false }, 0, 0);
		expect(flag(actor, "inventory.resources")).toEqual({ supplies: 4, "more-supplies": 0 });
	});

	it("goes empty at a Reset, so the next trip's ◆ is packed fresh", async () => {
		const actor = mergingActor({
			"inventory.checked":   { supplies: true },
			"inventory.resources": { supplies: 3, provisions: 2 },
		});
		const char = makeChar(actor);
		await char.resetInventorySelections();
		expect(flag(actor, "inventory.resources")).toEqual({ supplies: 0, provisions: 2 });
		// Marked by hand on the sheet at home, with no undefined ◆: still a full ◆.
		await char.toggleCarriedItem("supplies", true, { weight: 1 });
		expect(flag(actor, "inventory.resources").supplies).toBe(4);
	});

	it("can be spent only while it is marked, and only up to its current size", async () => {
		const actor = mergingActor({
			"inventory.checked":   { supplies: true, "more-supplies": false },
			// 6 stored from a Prosperity +2 that has since fallen; the row is 4 now.
			"inventory.resources": { supplies: 6, "more-supplies": 3 },
		});
		const purses = makeChar(actor).supplyPurses(SUPPLY_PURPOSE.RECOVER);
		expect(purses.eligible).toEqual([{ slug: "supplies", label: "Supplies", remaining: 4 }]);
		expect(purses.total).toBe(4);
	});

	// IA-3: only the three printed rows need a mark; a haul that claimed no ◆ is still food.
	it("lets unmarked provisions feed a camp", async () => {
		const actor = mergingActor({ "inventory.checked": {}, "inventory.resources": { provisions: 3, supplies: 2 } });
		const purses = makeChar(actor).supplyPurses(SUPPLY_PURPOSE.CAMP);
		expect(purses.eligible.map(p => [p.slug, p.remaining])).toEqual([["provisions", 3]]);
	});

	it("lets carried provisions feed a camp up to the larder's acquired size", async () => {
		const actor = mergingActor({
			"inventory.checked":     { provisions: true },
			"inventory.resources":   { provisions: 9 },
			"inventory.resourceMax": { provisions: 7 },
		});
		expect(makeChar(actor).supplyPurses(SUPPLY_PURPOSE.CAMP).total).toBe(7);
	});
});

describe("weight gained in the field (INV-5)", () => {
	it("draws nothing from the undefined ◇, so the load grows by it", async () => {
		const actor = mergingActor({ "inventory.regularPool": 3 });
		const char = makeChar(actor);
		await char.toggleCarriedItem("t-1", true, { weight: 2, loot: true });
		expect(flag(actor, "inventory.regularPool")).toBe(3);
		expect(flag(actor, "inventory.drawn") ?? {}).not.toHaveProperty("t-1");
		await char.toggleCarriedItem("t-1", false, { weight: 2, loot: true });
		expect(flag(actor, "inventory.regularPool")).toBe(3);
	});
});

// IA-2: a treasure kept from an earlier trip is a possession, which Have What You Need can mark in
// the field (Book I p.89), so a treasure row asks like a write-in rather than always counting as found.
describe("the inventory row templates", () => {
	const read = name => readFileSync(new URL(`../../../templates/actor/partials/${name}`, import.meta.url), "utf8");

	it("ask where a treasure came from, as a write-in does, and keep data-loot for provisions alone", () => {
		for (const name of ["inv-item-regular.hbs", "inv-item-small.hbs"]) {
			const body = read(name).replace(/{{!--[\s\S]*?--}}/g, "");
			expect(body).toMatch(/{{#if (\.\.\/)?deletable}}data-write-in="true"/);
			expect(body).not.toMatch(/treasure[^}]*}}data-loot/);
		}
		expect(read("inv-item-regular.hbs")).toContain('{{#if (eq ../slug "provisions")}}data-loot="true"{{/if}}');
	});
});

describe("Reset Inventory (INV-7)", () => {
	it("sets a special possession's chosen gear down too", async () => {
		const actor = mergingActor({
			"inventory.checked": { cloak: true },
			"possessions.choiceCarried": { "weapons-of-war:battleaxe": true },
		});
		await makeChar(actor).resetInventorySelections();
		expect(flag(actor, "inventory.checked")).toBeNull();
		expect(flag(actor, "possessions.choiceCarried")).toBeNull();
	});
});

// One inventory action is one actor.update: one round trip, one diff for the ledger, one re-render.
describe("each inventory action is one write", () => {
	it("un-marks an item, forgets its draw and hands the ◇ back together", async () => {
		const actor = mergingActor({ "inventory.regularPool": 1, "inventory.checked": { rope: true }, "inventory.drawn": { rope: 2, cloak: 1 } });
		await makeChar(actor).toggleCarriedItem("rope", false, { weight: 2 });
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(flag(actor, "inventory.drawn")).toEqual({ cloak: 1 });
		expect(flag(actor, "inventory.regularPool")).toBe(3);
	});

	it("packs a fresh ◆ of supplies in the same write as its mark", async () => {
		const actor = mergingActor({ "inventory.regularPool": 1, "inventory.resources": { supplies: 0 } });
		await makeChar(actor).toggleCarriedItem("supplies", true, { weight: 1 });
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.update.mock.calls[0][0]).toMatchObject({ [`flags.${SCOPE}.inventory.resources.supplies`]: 4 });
	});

	it("writes a caller's own count of uses with the mark (Have What You Need at the fire)", async () => {
		const actor = mergingActor({ "inventory.regularPool": 1, "inventory.resources": { supplies: 0 } });
		await makeChar(actor).toggleCarriedItem("supplies", true, { weight: 1, uses: 6 });
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(flag(actor, "inventory.resources").supplies).toBe(6);
	});

	it("lands a whole Outfit at once", async () => {
		const actor = mergingActor({ "inventory.drawn": { rope: 1 }, "inventory.resources": { supplies: 1 } });
		await makeChar(actor).applyOutfit({ supplies: true, rope: true, "weapons-of-war:battleaxe": true }, 2, 3);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(flag(actor, "inventory.checked")).toEqual({ supplies: true, rope: true });
		expect(flag(actor, "possessions.choiceCarried")).toEqual({ "weapons-of-war:battleaxe": true });
		expect(flag(actor, "inventory.regularPool")).toBe(2);
		expect(flag(actor, "inventory.smallPool")).toBe(3);
		expect(flag(actor, "inventory.drawn")).toBeNull();
		expect(flag(actor, "inventory.resources").supplies).toBe(4);
	});

	it("lands a whole Reset at once", async () => {
		const actor = mergingActor({
			"inventory.checked": { supplies: true }, "inventory.regularPool": 2, "inventory.resources": { supplies: 3 },
			"possessions.choiceCarried": { "weapons-of-war:battleaxe": true },
		});
		await makeChar(actor).resetInventorySelections();
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(flag(actor, "inventory.regularPool")).toBeNull();
		expect(flag(actor, "inventory.resources")).toEqual({ supplies: 0 });
	});
});

describe("a removed arcanum (INV-11)", () => {
	it("takes its carried mark with it, so it comes back set down", async () => {
		const actor = mergingActor({ "inventory.checked": { "a-gold-ring": true, cloak: true } });
		const char = makeChar(actor);
		char._arcana.removeArcanum = vi.fn(async () => {});
		await char.removeArcanum("a-gold-ring");
		expect(flag(actor, "inventory.checked")).toEqual({ cloak: true });
	});
});

// Book I p.88-89: a write-in is either something had all along (Have What You Need moves an undefined
// mark onto it; the chalk) or something new (added "in one of the blanks", drawing nothing; the
// makerglass shard). Marking one asks which, while there is an undefined mark to use.
describe("marking a written-in item", () => {
	afterEach(() => {
		delete globalThis.foundry.applications.api.DialogV2;
	});

	it("asks, and 'Had it all along' moves an undefined mark onto it", async () => {
		const ask = stubAsk(WRITE_IN_SOURCE.HAD);
		const actor = mergingActor({ "inventory.regularPool": 3 });
		const answer = await makeChar(actor).markWriteInCarried("w-1", { name: "Chalk & slate", weight: 2 });
		expect(answer).toBe(WRITE_IN_SOURCE.HAD);
		expect(ask).toHaveBeenCalledTimes(1);
		expect(flag(actor, "inventory.checked")).toEqual({ "w-1": true });
		expect(flag(actor, "inventory.regularPool")).toBe(1);
		expect(flag(actor, "inventory.drawn")).toEqual({ "w-1": 2 });
	});

	it("asks, and 'Found it' adds to the load and draws nothing", async () => {
		stubAsk(WRITE_IN_SOURCE.FOUND);
		const actor = mergingActor({ "inventory.regularPool": 3 });
		const char = makeChar(actor);
		expect(await char.markWriteInCarried("w-1", { name: "Beznpol hide", weight: 1 })).toBe(WRITE_IN_SOURCE.FOUND);
		expect(flag(actor, "inventory.checked")).toEqual({ "w-1": true });
		expect(flag(actor, "inventory.regularPool")).toBe(3);
		expect(flag(actor, "inventory.drawn") ?? {}).not.toHaveProperty("w-1");
		// Un-marking hands back exactly what was drawn, which is nothing.
		await char.toggleCarriedItem("w-1", false, { weight: 1 });
		expect(flag(actor, "inventory.regularPool")).toBe(3);
	});

	it("marks nothing when the window is closed", async () => {
		stubAsk(null);
		const actor = mergingActor({ "inventory.smallPool": 2 });
		expect(await makeChar(actor).markWriteInCarried("w-2", { name: "Makerglass shard", small: true })).toBeNull();
		expect(flag(actor, "inventory.checked")).toBeNull();
		expect(flag(actor, "inventory.smallPool")).toBe(2);
		expect(actor.update).not.toHaveBeenCalled();
		expect(actor.setFlag).not.toHaveBeenCalled();
	});

	it("doesn't ask with no undefined mark left: it can only be new", async () => {
		const ask = stubAsk(WRITE_IN_SOURCE.HAD);
		const actor = mergingActor({ "inventory.smallPool": 0 });
		expect(await makeChar(actor).markWriteInCarried("w-2", { name: "Makerglass shard", small: true })).toBe(WRITE_IN_SOURCE.FOUND);
		expect(ask).not.toHaveBeenCalled();
		expect(flag(actor, "inventory.checked")).toEqual({ "w-2": true });
		expect(flag(actor, "inventory.smallPool")).toBe(0);
	});

	it("explains both answers, affirmative first, with what each does to the marks", async () => {
		const ask = stubAsk(WRITE_IN_SOURCE.HAD);
		await makeChar(mergingActor({ "inventory.regularPool": 1 })).markWriteInCarried("w-1", { name: "Spade <b>", weight: 2 });
		const asked = ask.mock.calls[0][0];
		expect(asked.buttons.map(b => [b.action, b.label])).toEqual([["had", "Had it all along"], ["found", "Found it"]]);
		expect(asked.content).toContain("Spade &lt;b&gt;");
		expect(asked.content).toContain("uses your last 1 undefined ◆, and the other 1 ◆ add to your load");
		expect(asked.content).toContain("adds 2 ◆ to your load");
		expect(asked.content).toContain("Close this window to leave it unmarked.");
		expect(asked.content).not.toContain("—");
	});
});
