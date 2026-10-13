import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStonetopActorClass } from "../../module/actors/StonetopActor.js";
import { getLedgerEntries, LEDGER_SCOPE, LEDGER_KEY } from "../../module/utils/ledger-core.js";
import { applyLedgerUpdate } from "../fakes/ledger-actor.js";

// The ledger's actor hooks: _preUpdate diffs, _onUpdate appends, and the descendant hooks log
// items. Driven the way core drives them, including the one thing core does that is easy to
// forget: a batched update hands the SAME options object to every document in it.

class FakeBaseActor {
	async _preUpdate() { return true; }
	async _onUpdate() {}
	async _onCreateDescendantDocuments() {}
	async _onDeleteDescendantDocuments() {}
	_preUpdateDescendantDocuments() {}
	async _onUpdateDescendantDocuments() {}
}

const StonetopActor = createStonetopActorClass(FakeBaseActor);

const ME = "u-me";

function makeActor({ id, type = "npc", name = "Pim", system = {}, items = [] } = {}) {
	const actor = new StonetopActor();
	const store = { raw: undefined };
	Object.assign(actor, {
		id, uuid: `Actor.${id}`, type, name, system, flags: {},
		items: new Map(items.map(item => [item.id, item])),
		getFlag: (scope, key) => (scope === LEDGER_SCOPE && key === LEDGER_KEY ? store.raw : undefined),
		update: async (data) => applyLedgerUpdate(store, data),
	});
	return actor;
}

const actions = actor => getLedgerEntries(actor).map(e => e.action);

const savedUser = global.game.user;
beforeEach(() => { global.game.user = { id: ME, name: "Me" }; });
afterEach(() => { global.game.user = savedUser; });

describe("StonetopActor ledger hooks (#17)", () => {
	it("diffs in _preUpdate and appends in _onUpdate, on the author's client", async () => {
		const actor = makeActor({ id: "a1", name: "Pim" });
		const options = {};
		await actor._preUpdate({ name: "Pimm" }, options, { id: ME });
		await actor._onUpdate({ name: "Pimm" }, options, ME);
		expect(actions(actor)).toEqual(["Name changed from Pim to Pimm"]);
	});

	it("leaves the append to the author: another client's _onUpdate writes nothing", async () => {
		const actor = makeActor({ id: "a2", name: "Pim" });
		const options = {};
		await actor._preUpdate({ name: "Pimm" }, options, { id: "someone-else" });
		await actor._onUpdate({ name: "Pimm" }, options, "someone-else");
		expect(actions(actor)).toEqual([]);
	});

	it("honours the stonetopLedger kill switch", async () => {
		const actor = makeActor({ id: "a3", name: "Pim" });
		const options = { stonetopLedger: true };
		await actor._preUpdate({ name: "Pimm" }, options, { id: ME });
		await actor._onUpdate({ name: "Pimm" }, options, ME);
		expect(actions(actor)).toEqual([]);
	});

	it("names the move that made the change", async () => {
		const actor = makeActor({ id: "a4", system: { attributes: { hp: { value: 6 } } } });
		const options = { stonetopMove: "Clash" };
		await actor._preUpdate({ "system.attributes.hp.value": 4 }, options, { id: ME });
		await actor._onUpdate({}, options, ME);
		expect(getLedgerEntries(actor).map(e => e.move)).toEqual(["Clash"]);
	});
});

describe("a batched update shares one options object (#6)", () => {
	it("gives each actor its OWN entries, not the last actor's", async () => {
		const a = makeActor({ id: "batch-a", name: "Aled" });
		const b = makeActor({ id: "batch-b", name: "Bryn" });
		const shared = {};
		await a._preUpdate({ name: "Aled the Elder" }, shared, { id: ME });
		await b._preUpdate({ name: "Bryn the Bold" }, shared, { id: ME });
		await a._onUpdate({}, shared, ME);
		await b._onUpdate({}, shared, ME);

		expect(actions(a)).toEqual(["Name changed from Aled to Aled the Elder"]);
		expect(actions(b)).toEqual(["Name changed from Bryn to Bryn the Bold"]);
	});
});

describe("item create and delete carry the causing move (#13)", () => {
	it("tags a created item with stonetopMove", async () => {
		const actor = makeActor({ id: "move-create" });
		await actor._onCreateDescendantDocuments(actor, "items", [{ type: "npcMove", name: "Gore" }], [], { stonetopMove: "Monstrous Growth" }, ME);
		expect(getLedgerEntries(actor).map(e => [e.action, e.move])).toEqual([["Move added: Gore", "Monstrous Growth"]]);
	});

	it("tags a deleted item with stonetopMove", async () => {
		const actor = makeActor({ id: "move-delete" });
		await actor._onDeleteDescendantDocuments(actor, "items", [{ type: "npcMove", name: "Gore" }], [], { stonetopMove: "Tame" }, ME);
		expect(getLedgerEntries(actor).map(e => [e.action, e.move])).toEqual([["Move removed: Gore", "Tame"]]);
	});
});

describe("edits to a character's items (#21b)", () => {
	const sword = () => ({
		id: "i1", _id: "i1", name: "Longsword", type: "move",
		system: { moveType: "inventory-custom", description: "<p>Sharp.</p>", note: "", sourceKey: null },
	});

	async function edit(actor, change, options = {}, userId = ME) {
		actor._preUpdateDescendantDocuments(actor, "items", [change], options, userId);
		const item = actor.items.get(change._id);
		if (change.name) item.name = change.name;
		await actor._onUpdateDescendantDocuments(actor, "items", [item], [change], options, userId);
	}

	it("logs a rename and a description edit", async () => {
		const actor = makeActor({ id: "items-1", type: "character", items: [sword()] });
		await edit(actor, { _id: "i1", name: "Longsword of Ash", "system.description": "<p>Sharper.</p>" });
		expect(actions(actor)).toEqual([
			"Longsword of Ash edited: description",
			"Inventory item renamed from Longsword to Longsword of Ash",
		]);
	});

	it("folds a burst of edits to one item into one line", async () => {
		const actor = makeActor({ id: "items-2", type: "character", items: [sword()] });
		await edit(actor, { _id: "i1", "system.description": "<p>A.</p>" });
		await edit(actor, { _id: "i1", "system.note": "heavy" });
		expect(actions(actor)).toEqual(["Longsword edited: description, notes"]);
	});

	it("stays quiet for bookkeeping: sort, picture, flags, the grant tags", async () => {
		const actor = makeActor({ id: "items-3", type: "character", items: [sword()] });
		await edit(actor, { _id: "i1", sort: 5, img: "x.webp", "flags.stonetop-pwd.k": 1, "system.sourceKey": "k2" });
		expect(actions(actor)).toEqual([]);
	});

	it("honours stonetopLedger and stonetopMove", async () => {
		const quiet = makeActor({ id: "items-4", type: "character", items: [sword()] });
		await edit(quiet, { _id: "i1", "system.description": "<p>A.</p>" }, { stonetopLedger: true });
		expect(actions(quiet)).toEqual([]);

		const moved = makeActor({ id: "items-5", type: "character", items: [sword()] });
		await edit(moved, { _id: "i1", "system.identifyState": "known" }, { stonetopMove: "Know Things" });
		expect(getLedgerEntries(moved).map(e => [e.action, e.move])).toEqual([["Longsword edited: identification", "Know Things"]]);
	});

	it("is written by the author's client only", async () => {
		const actor = makeActor({ id: "items-6", type: "character", items: [sword()] });
		await edit(actor, { _id: "i1", "system.description": "<p>A.</p>" }, {}, "someone-else");
		expect(actions(actor)).toEqual([]);
	});
});

// A default level the GM sets by hand (core's Configure Ownership) takes the character off the
// sheet-sharing switch in the same write (actors/character/shared-sheets.js).
describe("StonetopActor#_preUpdate and the sheet-sharing switch", () => {
	function sharedCharacter() {
		const actor = makeActor({ id: "pc1", type: "character", name: "Bram" });
		actor.ownership = { default: 2 };
		actor.flags = { [LEDGER_SCOPE]: { sharedWithTable: true } };
		return actor;
	}
	const dropsFlag = changed => Object.keys(changed).some(key => key.startsWith(`flags.${LEDGER_SCOPE}.`) && key.endsWith("sharedWithTable"));

	it("lets go of the character when the GM moves its default level", async () => {
		const changed = { ownership: { default: 0 } };
		await sharedCharacter()._preUpdate(changed, {}, { id: ME });
		expect(dropsFlag(changed)).toBe(true);
	});

	it("keeps hold through the switch's own write", async () => {
		const changed = { "ownership.default": 0 };
		await sharedCharacter()._preUpdate(changed, { stonetopSharedSheets: true }, { id: ME });
		expect(dropsFlag(changed)).toBe(false);
	});
});
