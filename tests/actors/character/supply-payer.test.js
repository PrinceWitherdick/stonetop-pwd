// "Each character who regains HP must expend 1 use of supplies, or someone else must expend a use on their
// behalf" (Book I p.246). The payer's supplies are theirs to spend: paid here by whoever decides for them,
// else asked of their player (supply-payer.js), the rule Healer's Arts keeps for a carer's Stock.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
	SUPPLY_PAY_QUERY, supplyPayersFor, spendPayerSupplies, payOthersSupplies, handleSupplyPayQuery,
} from "../../../module/actors/character/supply-payer.js";
import { SUPPLY_PURPOSE, supplyPursesFor, otherSupplyPayers } from "../../../module/actors/character/supply-cost.js";
import { OWNER_ASK_VERIFY_QUERY } from "../../../module/utils/owner-ask.js";
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

	// QY-4: the write is an absolute count, so two answers at once both read 3 and both wrote 2.
	it("pays two asks answered at once one after the other, so neither use is lost", async () => {
		const { actor: wren, resources } = character({ id: "wren", name: "Wren", supplies: 3 });
		wren.uuid = "Actor.wren";
		wren.update = vi.fn(async data => {
			await new Promise(r => setTimeout(r, 5));
			for (const [k, v] of Object.entries(data)) resources[k.split(".").at(-1)] = v;
		});
		const [a, b] = await Promise.all([spendPayerSupplies(wren, { n: 1 }), spendPayerSupplies(wren, { n: 1 })]);
		expect([a.left, b.left]).toEqual([2, 1]);
		expect(resources.supplies).toBe(1);
	});

	// The Recover a payer pays for can stop being possible while they decide: made in another window, or the
	// patient put on Death's Door. Checked in the payer's turn, just before the purse is written.
	it("pays nothing for a Recover the patient can no longer have", async () => {
		const { actor: wren, resources } = character({ id: "wren", name: "Wren" });
		const bram = character({ id: "bram", name: "Bram" }).actor;
		bram.getFlag = (_scope, key) => key === "recover.spent";
		const answer = await spendPayerSupplies(wren, { n: 1, patient: bram, recover: { self: true } });
		expect(answer).toEqual({ refused: global.game.i18n.localize("stonetop.specialMoves.recover.lockedHint") });
		expect(wren.update).not.toHaveBeenCalled();
		expect(resources.supplies).toBe(3);
	});

	it("pays for the followers alone when only the patient's own Recover is refused", async () => {
		const { actor: wren, resources } = character({ id: "wren", name: "Wren" });
		const bram = character({ id: "bram", name: "Bram" }).actor;
		bram.typedActor.canFaceDeathsDoor = true;
		const answer = await spendPayerSupplies(wren, { n: 3, patient: bram, recover: { self: true } });
		expect(answer).toMatchObject({ spent: 2, left: 1, refused: expect.any(String) });
		expect(resources.supplies).toBe(1);
	});

	it("pays for a Recover the patient can still have", async () => {
		const { actor: wren, resources } = character({ id: "wren", name: "Wren" });
		const bram = character({ id: "bram", name: "Bram" }).actor;
		bram.typedActor.debilityChoices = [{ key: "weakened", name: "Weakened", marked: true }];
		expect(await spendPayerSupplies(wren, { n: 1, patient: bram, recover: { tend: "weakened" } })).toEqual({ slug: "supplies", label: "Supplies", spent: 1, left: 2 });
		expect(resources.supplies).toBe(2);
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
		await payOthersSupplies({ payer: wren, patient: bram, n: 1, recover: { tend: "weakened" } });
		expect(alex.query.mock.calls[1][1]).toMatchObject({ recover: { tend: "weakened" } });
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

	it("pays nothing on a yes when the debility was tended meanwhile, checked against the patient here", async () => {
		const { wren, resources, actors } = world();
		actors.get("bram").typedActor.debilityChoices = [{ key: "weakened", name: "Weakened", marked: false }];
		const answer = await handleSupplyPayQuery({ payerId: "wren", patientId: "bram", n: 1, userId: "p-bram", recover: { tend: "weakened" } }, {}, { actors, users: global.game.users, confirm: async () => true });
		expect(answer).toEqual({ refused: expect.stringContaining("Weakened") });
		expect(wren.update).not.toHaveBeenCalled();
		expect(resources.supplies).toBe(3);
	});

	it("keeps them on a no", async () => {
		const { wren, actors } = world();
		const answer = await handleSupplyPayQuery({ payerId: "wren", patientId: "bram", n: 1, userId: "p-bram" }, {}, { actors, users: global.game.users, confirm: async () => false });
		expect(answer).toEqual({ declined: true });
		expect(wren.update).not.toHaveBeenCalled();
	});

	// QY-1: v13 names nobody in the context, and the GM's id in the data used to be refused, so a GM's ask
	// never reached the payer's player at all. A person still answers it here.
	it("asks for a GM who names themselves in the data, as v13 leaves the context empty, once their client says it asked", async () => {
		const { resources, actors } = world();
		const gmQuery = vi.fn(async (name, data) => name === OWNER_ASK_VERIFY_QUERY && data.askId === "ask-1");
		global.game.users.contents.push({ id: "gm", name: "GM", isGM: true, active: true, query: gmQuery });
		const confirm = vi.fn(async () => true);
		const answer = await handleSupplyPayQuery({ payerId: "wren", patientId: "bram", n: 1, userId: "gm", askId: "ask-1" }, { timeout: 120000 }, { actors, users: global.game.users, confirm });
		expect(gmQuery).toHaveBeenCalledWith(OWNER_ASK_VERIFY_QUERY, { askId: "ask-1" }, expect.anything());
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(confirm.mock.calls[0][0].content).toContain("GM asks");
		expect(answer).toMatchObject({ spent: 1, left: 2 });
		expect(resources.supplies).toBe(2);
	});

	it("refuses a player who names the GM in the data on v13: the GM's client never sent that ask", async () => {
		const { resources, actors } = world();
		global.game.users.contents.push({ id: "gm", name: "GM", isGM: true, active: true, query: vi.fn(async () => false) });
		const confirm = vi.fn(async () => true);
		const answer = await handleSupplyPayQuery({ payerId: "wren", patientId: "bram", n: 1, userId: "gm", askId: "forged" }, { timeout: 120000 }, { actors, users: global.game.users, confirm });
		expect(answer).toBeNull();
		expect(confirm).not.toHaveBeenCalled();
		expect(resources.supplies).toBe(3);
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
