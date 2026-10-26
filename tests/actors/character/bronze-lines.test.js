import { describe, it, expect, vi } from "vitest";
import { bronzeRowOf, bronzeLines, BRONZE_COPY_FLAG, onBronzeLineDeleted, registerBronzeLineHooks } from "../../../module/actors/character/bronze-lines.js";
import { CharacterInventory } from "../../../module/actors/character/CharacterInventory.js";
import { StonetopFlags, STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { settleTradeItem, tradeCandidates, pickSoldLine } from "../../../module/actors/steading/steading-trade-card.js";
import { carriedAttackWeapons } from "../../../module/combat/attack-flow.js";
import { isClashWeapon } from "../../../module/data/weapons.js";
import { ITEM_FLAG_SCOPE } from "../../../module/system-id.js";

// Bronze weapons, one line each (Book I p.93, p.95): a second bronze weapon of the same kind is a line of its own,
// asked once which weapon it is, and a sold or lost one takes its answer with it.

const ROW = "bronze-common-weapon";

/** A character whose flags live in a flat map keyed as StonetopFlags reads them ("inventory.addedSpecial"). */
function character(id, { added = [], bronzeAs = {}, items = [] } = {}) {
	const flags = { "inventory.addedSpecial": added, "inventory.bronzeAs": bronzeAs };
	const actor = {
		id, name: id, type: "character", isOwner: true, items: [...items],
		flags: { [STONETOP_SCOPE]: flags },
		getFlag: (scope, key) => (scope === STONETOP_SCOPE ? flags[key] : undefined),
		setFlag: vi.fn(async (_scope, key, value) => { flags[key] = value; }),
		update: vi.fn(async changes => {
			for (const [key, value] of Object.entries(changes)) {
				const m = /^flags\.[^.]+\.inventory\.([^.]+)\.(?:-=)?([^.]+)$/.exec(key);
				if (!m) continue;
				const [, bag, sub] = m;
				const isDelete = key.includes("-=") || value?.constructor?.name === "ForcedDeletion" || value === null;
				const next = { ...(flags[`inventory.${bag}`] ?? {}) };
				if (isDelete) delete next[sub]; else next[sub] = value;
				flags[`inventory.${bag}`] = next;
			}
			const set = /^flags\.[^.]+\.inventory\.addedSpecial$/;
			for (const [key, value] of Object.entries(changes)) if (set.test(key)) flags["inventory.addedSpecial"] = value;
		}),
		createEmbeddedDocuments: vi.fn(async (_type, docs) => {
			for (const doc of docs) actor.items.push({ ...doc, id: `item${actor.items.length + 1}` });
		}),
		deleteEmbeddedDocuments: vi.fn(async (_type, ids) => { actor.items = actor.items.filter(i => !ids.includes(i.id)); }),
		store: flags,
	};
	return actor;
}

const copy = id => ({ id, name: "Common weapons, bronze", type: "move", system: { moveType: "inventory-custom" }, flags: { [ITEM_FLAG_SCOPE]: { [BRONZE_COPY_FLAG]: ROW } } });

describe("bronze weapons, one line each", () => {
	it("knows a write-in standing for a bronze row, and nothing else", () => {
		expect(bronzeRowOf(copy("a"))).toBe(ROW);
		expect(bronzeRowOf({ flags: { [ITEM_FLAG_SCOPE]: { [BRONZE_COPY_FLAG]: "sword" } } })).toBeNull();
		expect(bronzeRowOf({})).toBeNull();
	});

	it("gives every line its own weapon in the attack picker", async () => {
		const actor = character("Pim", { added: [ROW], bronzeAs: { [ROW]: "spear", item7: "knife-dagger" } });
		actor.typedActor = { carriedWeaponGear: async () => [
			{ slug: ROW, weaponSlug: ROW, name: "Common weapons, bronze", catalog: true, ammoStore: "inventory" },
			{ slug: "item7", weaponSlug: ROW, name: "Common weapons, bronze", catalog: false, ammoStore: "inventory" },
		] };
		const names = (await carriedAttackWeapons(actor, { key: "clash", filter: isClashWeapon })).map(c => c.meta.name);
		expect(names).toEqual(["Bronze spear", "Bronze knife or dagger"]);
	});

	it("buys a second bronze weapon as a line of its own, the first as the handout row", async () => {
		const ash = character("Ash");
		await settleTradeItem(ash, ROW, "buy");
		expect(ash.store["inventory.addedSpecial"]).toEqual([ROW]);
		expect(ash.createEmbeddedDocuments).not.toHaveBeenCalled();
		await settleTradeItem(ash, ROW, "buy");
		expect(ash.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [expect.objectContaining({
			name: "Common weapons, bronze",
			system: expect.objectContaining({ moveType: "inventory-custom", weight: 1 }),
			flags: { [ITEM_FLAG_SCOPE]: { [BRONZE_COPY_FLAG]: ROW } },
		})]);
		// Any other special item is still one row.
		await settleTradeItem(ash, "sword", "buy");
		await settleTradeItem(ash, "sword", "buy");
		expect(ash.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
	});

	it("sells the line the player names, and forgets that line's weapon", async () => {
		const wren = character("Wren", { added: [ROW], bronzeAs: { [ROW]: "spear", item1: "hatchet" }, items: [copy("item1")] });
		const inventory = new CharacterInventory(new StonetopFlags(wren, "inventory"));
		expect(bronzeLines(wren, ROW, inventory, "Common weapons, bronze").map(l => l.label)).toEqual(["Bronze spear", "Bronze hatchet"]);
		expect(tradeCandidates("sell", ROW, [wren, character("Ash")]).map(a => a.id)).toEqual(["Wren"]);
		const ask = vi.fn(async ({ buttons }) => buttons.find(b => b.label === "Bronze hatchet").value);
		const line = await pickSoldLine(wren, ROW, { ask });
		expect(line.key).toBe("item1");
		await settleTradeItem(wren, ROW, "sell", { line });
		expect(wren.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["item1"]);
		expect(wren.store["inventory.bronzeAs"]).toEqual({ [ROW]: "spear" });
		expect(wren.store["inventory.addedSpecial"]).toEqual([ROW]);
		// One line left: nothing to ask, and selling the row forgets its weapon too.
		expect((await pickSoldLine(wren, ROW, { ask })).key).toBe(ROW);
		await settleTradeItem(wren, ROW, "sell");
		expect(wren.store["inventory.addedSpecial"]).toEqual([]);
		expect(wren.store["inventory.bronzeAs"]).toEqual({});
		expect(ask).toHaveBeenCalledTimes(1);
	});

	it("a bronze line deleted from the sheet takes its answer with it, written by the client that deleted it", async () => {
		const wren = character("Wren", { bronzeAs: { [ROW]: "spear", item1: "hatchet" } });
		const line = { ...copy("item1"), parent: wren };
		const on = vi.fn();
		registerBronzeLineHooks({ on });
		expect(on).toHaveBeenCalledWith("deleteItem", onBronzeLineDeleted);
		// Someone else's client deleted it: theirs to write.
		expect(onBronzeLineDeleted(line, {}, "other", "me")).toBeNull();
		await onBronzeLineDeleted(line, {}, "me", "me");
		expect(wren.store["inventory.bronzeAs"]).toEqual({ [ROW]: "spear" });
		// Any other item: nothing.
		expect(onBronzeLineDeleted({ id: "x", parent: wren, flags: {} }, {}, "me", "me")).toBeNull();
	});

	it("a closed window sells nothing", async () => {
		const wren = character("Wren", { added: [ROW], items: [copy("item1")] });
		expect(await pickSoldLine(wren, ROW, { ask: async () => null })).toBeNull();
		expect(await pickSoldLine(wren, "sword", { ask: async () => null })).toBeUndefined();
	});
});
