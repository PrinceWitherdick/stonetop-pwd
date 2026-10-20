// "Each character who regains HP must expend 1 use of supplies, or someone else must expend a use on their
// behalf" (Book I p.246). The payer's supplies are theirs to spend: paid here by whoever decides for them,
// else asked of their player (supply-payer.js), the rule Healer's Arts keeps for a carer's Stock.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
	SUPPLY_PAY_QUERY, supplyPayersFor, spendPayerSupplies, payOthersSupplies, handleSupplyPayQuery,
} from "../../../module/actors/character/supply-payer.js";
import { SUPPLY_PURPOSE, supplyPursesFor, otherSupplyPayers } from "../../../module/actors/character/supply-cost.js";
import { readRepo as read } from "../../fakes/css.js";

// A character as the payer rules read one: its purses (every stored use reachable, here), who owns it,
// and the write that spends from it.
function character({ id, name, supplies = 3, owners = [], isOwner = true, flags = {} } = {}) {
	const resources = { supplies };
	const actor = {
		id, name, type: "character", isOwner, flags,
		testUserPermission: (user, level) => level === "OWNER" && (!!user?.isGM || owners.includes(user?.id)),
		update: vi.fn(async data => {
			for (const [k, v] of Object.entries(data)) resources[k.split(".").at(-1)] = v;
		}),
		typedActor: {
			supplyPurses: purpose => supplyPursesFor(resources, purpose),
			spendablePurseResources: () => ({ ...resources }),
			inventoryResourceData: (slug, count) => ({ [`flags.stonetop-pwd.inventory.resources.${slug}`]: count }),
		},
	};
	return { actor, resources };
}

const player = (id, name, extra = {}) => ({ id, name, isGM: false, active: true, character: null, query: vi.fn(), ...extra });
const usersOf = (list, activeGM = null) => ({ contents: list, activeGM, get: id => list.find(u => u.id === id) ?? null, find: f => list.find(f) });

let saved;
beforeEach(() => {
	saved = { users: global.game.users, user: global.game.user, actors: global.game.actors, ui: global.ui };
	global.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
});
afterEach(() => {
	Object.assign(global.game, { users: saved.users, user: saved.user, actors: saved.actors });
	global.ui = saved.ui;
});

describe("who could pay", () => {
	it("lists the other characters with supplies to spend, never the patient or an empty pack", () => {
		const bram = character({ id: "bram", name: "Bram" }).actor;
		const wren = character({ id: "wren", name: "Wren" }).actor;
		const empty = character({ id: "nia", name: "Nia", supplies: 0 }).actor;
		const npc = { id: "npc", type: "npc" };
		const payers = otherSupplyPayers(bram, [bram, wren, empty, npc], SUPPLY_PURPOSE.RECOVER);
		expect(payers.map(p => [p.id, p.purses.total])).toEqual([["wren", 3]]);
	});

	it("leaves out the payers nobody here can answer for", () => {
		const alex = player("p-wren", "Alex");
		const bramPlayer = player("p-bram", "Sam");
		const bram = character({ id: "bram", name: "Bram", owners: ["p-bram"] }).actor;
		const wren = character({ id: "wren", name: "Wren", owners: ["p-wren"] }).actor;
		const away = character({ id: "bryn", name: "Bryn", owners: ["p-bryn"] }).actor;
		bramPlayer.character = bram;
		global.game.users = usersOf([alex, bramPlayer, player("p-bryn", "Away", { active: false })]);
		const payers = supplyPayersFor(bram, SUPPLY_PURPOSE.RECOVER, {
			actors: [bram, wren, away], user: bramPlayer, users: global.game.users,
		});
		expect(payers.map(p => p.id)).toEqual(["wren"]);
	});

	it("works out the size of a ◆ once per steading, not once per character", () => {
		const bram = character({ id: "bram", name: "Bram" }).actor;
		const steading = { id: "stonetop" };
		const payers = ["wren", "nia", "bryn"].map(id => {
			const actor = character({ id, name: id }).actor;
			actor.typedActor.getSteadingActor = () => steading;
			actor.typedActor.getUsesPerSupply = vi.fn(() => 5);
			const purses = actor.typedActor.supplyPurses;
			actor.typedActor.supplyPurses = vi.fn((purpose, opts) => purses(purpose, opts));
			return actor;
		});
		otherSupplyPayers(bram, [bram, ...payers], SUPPLY_PURPOSE.RECOVER);
		expect(payers.reduce((n, a) => n + a.typedActor.getUsesPerSupply.mock.calls.length, 0)).toBe(1);
		for (const a of payers) expect(a.typedActor.supplyPurses).toHaveBeenCalledWith(SUPPLY_PURPOSE.RECOVER, { usesPerSupply: 5 });
	});
});

describe("paying", () => {
	it("spends the payer's own uses, read live, when this user decides for them", async () => {
		const { actor: wren, resources } = character({ id: "wren", name: "Wren", owners: ["p-wren"] });
		const bram = character({ id: "bram", name: "Bram", owners: ["p-bram"] }).actor;
		const me = player("p-wren", "Alex", { character: wren });
		global.game.user = me;
		global.game.users = usersOf([me]);
		const receipt = await payOthersSupplies({ payer: wren, patient: bram, slug: "supplies", n: 2, moveName: "Recover" });
		expect(receipt).toEqual({ slug: "supplies", label: "Supplies", spent: 2, left: 1 });
		expect(wren.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.inventory.resources.supplies": 1 }, { stonetopMove: "Recover" });
		expect(resources.supplies).toBe(1);
	});

	it("pays nothing from a purse that no longer holds enough", async () => {
		const { actor: wren } = character({ id: "wren", name: "Wren", supplies: 1 });
		expect(await spendPayerSupplies(wren, { slug: "supplies", n: 2 })).toBeNull();
		expect(wren.update).not.toHaveBeenCalled();
	});

	it("with no purse named, pays from the first one that holds enough, not a short first one", async () => {
		const { actor: wren, resources } = character({ id: "wren", name: "Wren", supplies: 1 });
		resources["more-supplies"] = 5;
		expect(await spendPayerSupplies(wren, { n: 3 })).toEqual({ slug: "more-supplies", label: "More supplies", spent: 3, left: 2 });
		expect(resources).toMatchObject({ supplies: 1, "more-supplies": 2 });
	});

	it("asks the payer's own player otherwise, and spends nothing here", async () => {
		const alex = player("p-wren", "Alex", { query: vi.fn(async () => ({ declined: true })) });
		const sam = player("p-bram", "Sam");
		const { actor: wren } = character({ id: "wren", name: "Wren", owners: ["p-wren", "p-bram"] });
		const bram = character({ id: "bram", name: "Bram", owners: ["p-bram"] }).actor;
		alex.character = wren;
		sam.character = bram;
		global.game.user = sam;
		global.game.users = usersOf([alex, sam]);
		const answer = await payOthersSupplies({ payer: wren, patient: bram, slug: "supplies", n: 1, moveName: "Recover" });
		expect(alex.query).toHaveBeenCalledWith(SUPPLY_PAY_QUERY, expect.objectContaining({ payerId: "wren", patientId: "bram", n: 1 }), expect.anything());
		expect(answer).toEqual({ declined: true });
		expect(wren.update).not.toHaveBeenCalled();
	});
});

describe("the payer's side of the ask", () => {
	function world() {
		const sam = player("p-bram", "Sam");
		const me = player("p-wren", "Alex");
		const { actor: wren, resources } = character({ id: "wren", name: "Wren", owners: ["p-wren"] });
		const bram = character({ id: "bram", name: "Bram", owners: ["p-bram"] }).actor;
		global.game.user = me;
		global.game.users = usersOf([sam, me]);
		const actors = new Map([["wren", wren], ["bram", bram]]);
		return { sam, wren, resources, actors };
	}

	it("pays out of the payer's purse on a yes", async () => {
		const { wren, resources, actors } = world();
		const confirm = vi.fn(async () => true);
		const answer = await handleSupplyPayQuery({ payerId: "wren", patientId: "bram", n: 1, userId: "p-bram", moveName: "Recover" }, {}, { actors, users: global.game.users, confirm });
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(answer).toMatchObject({ spent: 1, left: 2 });
		expect(resources.supplies).toBe(2);
		expect(wren.update).toHaveBeenCalledTimes(1);
	});

	it("asks about the purse that can pay, with no purse named", async () => {
		const { resources, actors } = world();
		resources.supplies = 1;
		resources["more-supplies"] = 5;
		const confirm = vi.fn(async () => true);
		const answer = await handleSupplyPayQuery({ payerId: "wren", patientId: "bram", n: 3, userId: "p-bram" }, {}, { actors, users: global.game.users, confirm });
		expect(confirm.mock.calls[0][0].content).toContain("More supplies (5 left)");
		expect(answer).toMatchObject({ slug: "more-supplies", spent: 3, left: 2 });
	});

	it("asks about a large Recover the same as a small one, and says so when the purse is short", async () => {
		const { resources, actors } = world();
		resources.supplies = 30;
		const confirm = vi.fn(async () => true);
		expect(await handleSupplyPayQuery({ payerId: "wren", patientId: "bram", n: 21, userId: "p-bram" }, {}, { actors, users: global.game.users, confirm }))
			.toMatchObject({ spent: 21, left: 9 });
		confirm.mockClear();
		expect(await handleSupplyPayQuery({ payerId: "wren", patientId: "bram", n: 10, userId: "p-bram" }, {}, { actors, users: global.game.users, confirm })).toBeNull();
		expect(confirm).not.toHaveBeenCalled();
		expect(global.ui.notifications.warn).toHaveBeenCalledWith("Wren's Supplies holds 9, not the 10 uses asked for.");
	});

	it("keeps them on a no", async () => {
		const { wren, actors } = world();
		const answer = await handleSupplyPayQuery({ payerId: "wren", patientId: "bram", n: 1, userId: "p-bram" }, {}, { actors, users: global.game.users, confirm: async () => false });
		expect(answer).toEqual({ declined: true });
		expect(wren.update).not.toHaveBeenCalled();
	});

	it("refuses an asker who does not own the patient", async () => {
		const { actors } = world();
		const confirm = vi.fn(async () => true);
		global.game.users.contents.push(player("p-other", "Rando"));
		const answer = await handleSupplyPayQuery({ payerId: "wren", patientId: "bram", n: 1, userId: "p-other" }, {}, { actors, users: global.game.users, confirm });
		expect(answer).toBeNull();
		expect(confirm).not.toHaveBeenCalled();
	});
});

// Registered at init beside the other User queries, not from inside camp's hooks: one place lists every
// question one client can put to another.
describe("the supply-pay query", () => {
	it("is registered in stonetop.js beside the others, and not by camp", () => {
		expect(read("stonetop.js")).toContain("CONFIG.queries[SUPPLY_PAY_QUERY] = (data, context) => handleSupplyPayQuery(data, context)");
		expect(read("module/camp/camp-store.js")).not.toContain("SUPPLY_PAY_QUERY");
	});
});
