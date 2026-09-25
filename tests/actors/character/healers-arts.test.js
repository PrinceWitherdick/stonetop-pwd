// Healer's Arts on someone else's Recover (actors/character/healers-arts.js):
// "When someone Recovers under your care, they recover (extra) HP equal to your WIS. If you also
//  spend 1 Stock, they heal an extra 5 HP and their wounds/injuries are stabilized."
// Before this, the Recover window healed a flat 4+Prosperity and nothing read the move at all.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
	HEALERS_ARTS, HEALERS_ARTS_QUERY, HEALERS_ARTS_ASK_MS, recoverHeal, recoverBreakdown, healersArtsCarers,
	payHealersArtsStock, handleHealersArtsQuery, carerStockAnswerer, canReachCarerStock,
} from "../../../module/actors/character/healers-arts.js";
import { createStonetopCharacterSheetClass, GUIDED_CHARACTER_MOVES } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { readRepo as read } from "../../fakes/css.js";

const move = (name, learned = true) => ({ type: "move", name, flags: learned ? {} : { "stonetop-pwd": { learned: false } } });

// A carer as the rules read one: a character document with its moves, its WIS and its purses.
// `owners` are the user ids that own it (a GM owns every actor).
function carer({ id = "gwynn", name = "Gwynn", wis = 2, owner = true, learned = true, purses = null, owners = [] } = {}) {
	const sources = purses ?? [{ key: "stock", label: "Stock", remaining: 2, max: 3 }];
	return {
		id, name, type: "character", isOwner: owner,
		system: { stats: { wis: { value: wis } } },
		items: [move(HEALERS_ARTS, learned)],
		testUserPermission: (user, level) => level === "OWNER" && (!!user?.isGM || owners.includes(user?.id)),
		typedActor: {
			stockSources: vi.fn(async () => sources),
			spendStock: vi.fn(async () => ({ lost: 0 })),
		},
	};
}

// The world's users as game.users reads them: `contents`, `get`, and the primary GM.
function usersOf(list, activeGM = null) {
	return { contents: list, activeGM, get: id => list.find(u => u.id === id) ?? null };
}
const player = (id, name, extra = {}) => ({ id, name, isGM: false, active: true, character: null, query: vi.fn(), ...extra });

// Answer the windows askWithButtons opens, in order: each key presses that button, null closes it.
function stubAnswers(...keys) {
	const wait = vi.fn(async config => {
		const key = keys.shift();
		return config.buttons?.some(b => b.action === key) ? key : null;
	});
	globalThis.foundry ??= {};
	globalThis.foundry.applications ??= {};
	globalThis.foundry.applications.api ??= {};
	globalThis.foundry.applications.api.DialogV2 = { wait };
	return wait;
}

let savedGame;
let savedChat;
let savedUi;
beforeEach(() => {
	savedGame = { users: global.game.users, user: global.game.user, actors: global.game.actors };
	savedChat = global.ChatMessage;
	savedUi = global.ui;
	global.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: ({ actor } = {}) => ({ actor: actor?.id }) };
	global.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
});
afterEach(() => {
	Object.assign(global.game, savedGame);
	global.ChatMessage = savedChat;
	global.ui = savedUi;
	vi.restoreAllMocks();
});

describe("what a tended Recover heals", () => {
	it("adds the carer's WIS to 4+Prosperity", () => {
		expect(recoverHeal({ base: 4, hp: 2, max: 20, wis: 2 })).toMatchObject({ wisBonus: 2, newHp: 8, gained: 6 });
	});

	it("adds 5 more for the Stock", () => {
		expect(recoverHeal({ base: 4, hp: 2, max: 20, wis: 2, stock: true })).toMatchObject({ stockBonus: 5, newHp: 13 });
	});

	// The carer never makes a Recover worse: a WIS of 0 or less adds nothing.
	it("reads a WIS of 0 or less as nothing extra, never as HP taken away", () => {
		expect(recoverHeal({ base: 4, hp: 2, max: 20, wis: -1 }).newHp).toBe(6);
		expect(recoverHeal({ base: 4, hp: 2, max: 20, wis: 0 }).newHp).toBe(6);
	});

	it("stops at max HP", () => {
		expect(recoverHeal({ base: 4, hp: 15, max: 18, wis: 3, stock: true }).newHp).toBe(18);
	});

	it("is the plain Recover when nobody tends it", () => {
		expect(recoverHeal({ base: 4, hp: 2, max: 20 })).toMatchObject({ wisBonus: 0, stockBonus: 0, newHp: 6 });
	});

	it("says where every point came from", () => {
		expect(recoverBreakdown(recoverHeal({ base: 4, hp: 2, max: 20 }))).toBe("4+Prosperity = 4");
		expect(recoverBreakdown(recoverHeal({ base: 4, hp: 2, max: 20, wis: 2, stock: true }), "Gwynn"))
			.toBe("4+Prosperity = 4, +2 Healer's Arts (Gwynn's WIS), +5 Healer's Arts (1 Stock)");
		expect(recoverBreakdown(recoverHeal({ base: 4, hp: 2, max: 20, wis: -1 }), "Bram"))
			.toBe("4+Prosperity = 4, +0 Healer's Arts (Bram's WIS -1, which never takes HP away)");
	});
});

describe("who can tend a Recover", () => {
	it("is every character with Healer's Arts LEARNED", () => {
		const off = carer({ id: "off", learned: false });
		const npc = { ...carer({ id: "npc" }), type: "npc" };
		const on = carer();
		expect(healersArtsCarers([off, npc, on, { type: "character", items: [] }]).map(a => a.id)).toEqual(["gwynn"]);
	});
});

describe("paying the carer's Stock", () => {
	it("spends out of the carer's own purse when this client owns the carer", async () => {
		const gwynn = carer();
		const paid = await payHealersArtsStock({ carer: gwynn, patient: { id: "bram" }, sourceKey: "stock" });
		expect(gwynn.typedActor.spendStock).toHaveBeenCalledWith(
			expect.objectContaining({ key: "stock" }), 1, expect.objectContaining({ moveName: HEALERS_ARTS }));
		expect(paid).toMatchObject({ key: "stock", label: "Stock", remaining: 1 });
	});

	it("takes a Vessel's HP only when it was picked", async () => {
		const vessel = { key: "hp", label: "HP", vessel: true, remaining: Infinity };
		const gwynn = carer({ purses: [vessel] });
		expect(await payHealersArtsStock({ carer: gwynn, patient: { id: "bram" } })).toBeNull();
		expect(gwynn.typedActor.spendStock).not.toHaveBeenCalled();
		await payHealersArtsStock({ carer: gwynn, patient: { id: "bram" }, sourceKey: "hp" });
		expect(gwynn.typedActor.spendStock).toHaveBeenCalledWith(vessel, 1, expect.anything());
	});

	// The patient's own carer (their own Blessed, or the GM at the keyboard): the one deciding is the
	// one paying, so nobody is asked.
	it("pays straight out of a carer this client owns, asking nobody", async () => {
		const wait = stubAnswers();
		const answerer = player("p-gwynn", "Alex");
		global.game.users = usersOf([answerer], { id: "gm", query: vi.fn() });
		const gwynn = carer({ owners: ["p-gwynn"] });
		expect(await payHealersArtsStock({ carer: gwynn, patient: { id: "bram", name: "Bram" }, sourceKey: "stock" })).toMatchObject({ key: "stock" });
		expect(answerer.query).not.toHaveBeenCalled();
		expect(global.game.users.activeGM.query).not.toHaveBeenCalled();
		expect(wait).not.toHaveBeenCalled();
	});

	it("is registered as a query", () => {
		expect(read("stonetop.js")).toContain("CONFIG.queries[HEALERS_ARTS_QUERY] = (data, context) => handleHealersArtsQuery(data, context)");
	});
});

// "If you also spend 1 Stock": the Stock is the carer's to spend, so a patient's player who does not
// own the carer ASKS the carer's player, and only falls back to the GM when none of them is online.
describe("asking the carer's player", () => {
	const receipt = { key: "stock", label: "Stock", vessel: false, lost: 0, remaining: 1 };
	const bram = { id: "bram", name: "Bram" };
	beforeEach(() => { global.game.user = { id: "p-bram", isGM: false }; });

	it("asks an online player who owns the carer, not the GM, and leaves the purse to them", async () => {
		const alex = player("p-gwynn", "Alex", { query: vi.fn(async () => receipt) });
		const gm = { id: "gm", name: "GM", isGM: true, active: true, query: vi.fn() };
		global.game.users = usersOf([gm, alex], gm);
		const gwynn = carer({ owner: false, owners: ["p-gwynn"] });
		const paid = await payHealersArtsStock({ carer: gwynn, patient: bram, sourceKey: "stock" });
		expect(alex.query).toHaveBeenCalledWith(HEALERS_ARTS_QUERY,
			{ carerId: "gwynn", patientId: "bram", userId: "p-bram" }, { timeout: HEALERS_ARTS_ASK_MS });
		expect(gm.query).not.toHaveBeenCalled();
		expect(gwynn.typedActor.spendStock).not.toHaveBeenCalled();
		expect(paid).toEqual(receipt);
		expect(global.ui.notifications.info.mock.calls[0][0]).toBe("Asking Alex whether Gwynn spends 1 Stock on Bram's Recover.");
	});

	it("asks the player the carer is assigned to first, and never an offline one", async () => {
		const sam = player("p-a", "Sam", { query: vi.fn(async () => receipt) });
		const alex = player("p-b", "Alex", { character: { id: "gwynn" }, query: vi.fn(async () => receipt) });
		const away = player("p-0", "Away", { active: false, character: { id: "gwynn" } });
		global.game.users = usersOf([away, sam, alex], null);
		const gwynn = carer({ owner: false, owners: ["p-0", "p-a", "p-b"] });
		expect(carerStockAnswerer(gwynn)).toBe(alex);
		await payHealersArtsStock({ carer: gwynn, patient: bram });
		expect(alex.query).toHaveBeenCalled();
		expect(sam.query).not.toHaveBeenCalled();
	});

	it("falls back to the primary GM when none of the carer's players is online", async () => {
		const gm = { id: "gm", name: "GM", isGM: true, active: true, query: vi.fn(async () => ({ declined: true })) };
		global.game.users = usersOf([gm, player("p-gwynn", "Alex", { active: false })], gm);
		const gwynn = carer({ owner: false, owners: ["p-gwynn"] });
		expect(canReachCarerStock(gwynn)).toBe(true);
		expect(await payHealersArtsStock({ carer: gwynn, patient: bram })).toEqual({ declined: true });
		expect(gm.query).toHaveBeenCalledWith(HEALERS_ARTS_QUERY, expect.objectContaining({ carerId: "gwynn" }), { timeout: HEALERS_ARTS_ASK_MS });
		expect(global.ui.notifications.info.mock.calls[0][0]).toContain("Asking the GM");
	});

	// Out of time, or the carer's player left: nobody said yes, so it reads as a no.
	it("reads no answer at all as the Stock kept", async () => {
		const alex = player("p-gwynn", "Alex", { query: vi.fn(async () => { throw new Error("timed out"); }) });
		global.game.users = usersOf([alex], null);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const gwynn = carer({ owner: false, owners: ["p-gwynn"] });
		expect(await payHealersArtsStock({ carer: gwynn, patient: bram })).toEqual({ declined: true, unanswered: true });
	});

	// The "no one can answer" disabled tick: nobody online owns the carer and no GM is connected.
	it("spends nothing, and cannot be offered, with nobody to ask", async () => {
		global.game.users = usersOf([player("p-gwynn", "Alex", { active: false })], null);
		const gwynn = carer({ owner: false, owners: ["p-gwynn"] });
		expect(canReachCarerStock(gwynn)).toBe(false);
		expect(await payHealersArtsStock({ carer: gwynn, patient: bram, sourceKey: "stock" })).toBeNull();
		expect(gwynn.typedActor.spendStock).not.toHaveBeenCalled();
	});
});

describe("the carer's side of the ask", () => {
	const asker = { id: "p-bram", name: "Robin", isGM: false };
	function world({ ownsPatient = true, learned = true, ownsCarer = true, gm = false, primary = true, purses = null } = {}) {
		const gwynn = carer({ learned, owner: ownsCarer, purses });
		const bram = { id: "bram", name: "Bram", testUserPermission: (user, level) => ownsPatient && user === asker && level === "OWNER" };
		const actors = new Map([["gwynn", gwynn], ["bram", bram]]);
		global.game.user = gm ? { id: "gm", isGM: true } : { id: "p-gwynn", isGM: false };
		global.game.users = { activeGM: gm && !primary ? { id: "gm-2" } : { id: "gm" }, get: id => (id === asker.id ? asker : null) };
		return { gwynn, actors };
	}
	const ask = { carerId: "gwynn", patientId: "bram", userId: "p-bram" };

	it("asks the carer's player, naming the patient and the cost, and pays on a yes", async () => {
		const wait = stubAnswers("yes");
		const { gwynn, actors } = world();
		const paid = await handleHealersArtsQuery(ask, {}, { actors });
		expect(paid).toMatchObject({ key: "stock", label: "Stock", remaining: 1 });
		expect(gwynn.typedActor.spendStock).toHaveBeenCalledWith(
			expect.objectContaining({ key: "stock" }), 1, expect.objectContaining({ moveName: HEALERS_ARTS }));
		const asked = wait.mock.calls[0][0];
		expect(asked.content).toContain("<strong>Bram</strong> is Recovering under <strong>Gwynn</strong>");
		expect(asked.content).toContain("heals 5 more HP");
		expect(asked.buttons.map(b => b.label)).toEqual(["Spend 1 Stock on Bram", "Keep my Stock"]);
		expect(asked.content).not.toContain(String.fromCharCode(0x2014));
	});

	it("keeps the Stock on a no", async () => {
		stubAnswers("no");
		const { gwynn, actors } = world();
		expect(await handleHealersArtsQuery(ask, {}, { actors })).toEqual({ declined: true });
		expect(gwynn.typedActor.spendStock).not.toHaveBeenCalled();
	});

	it("keeps the Stock when the window is closed", async () => {
		stubAnswers(null);
		const { gwynn, actors } = world();
		expect(await handleHealersArtsQuery(ask, {}, { actors })).toEqual({ declined: true });
		expect(gwynn.typedActor.spendStock).not.toHaveBeenCalled();
	});

	// The same purse question the chat card's Spend button asks (ask-stock-source.js).
	it("lets them pick the purse when there is a choice, and leaving it unpaid is a no", async () => {
		const purses = [
			{ key: "stock", label: "Stock", remaining: 2, max: 3 },
			{ key: "boon", label: "Boon", remaining: 1, max: 4 },
		];
		const wait = stubAnswers("yes", "boon");
		const picked = world({ purses });
		expect(await handleHealersArtsQuery(ask, {}, { actors: picked.actors })).toMatchObject({ key: "boon", label: "Boon" });
		expect(picked.gwynn.typedActor.spendStock).toHaveBeenCalledWith(expect.objectContaining({ key: "boon" }), 1, expect.anything());
		expect(wait.mock.calls[1][0].buttons.map(b => b.label)).toEqual(["Spend 1 Stock (2 left)", "Spend 1 Boon (1 left)", "Leave it unpaid"]);

		stubAnswers("yes", "unpaid");
		const unpaid = world({ purses });
		expect(await handleHealersArtsQuery(ask, {}, { actors: unpaid.actors })).toEqual({ declined: true });
		expect(unpaid.gwynn.typedActor.spendStock).not.toHaveBeenCalled();
	});

	// A yes pressed after the asker stopped waiting would pay for a Recover already made without it.
	it("spends nothing on a yes that comes too late", async () => {
		let now = 1000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		globalThis.foundry.applications.api.DialogV2 = { wait: vi.fn(async () => { now += HEALERS_ARTS_ASK_MS; return "yes"; }) };
		const { gwynn, actors } = world();
		expect(await handleHealersArtsQuery(ask, {}, { actors })).toEqual({ declined: true });
		expect(gwynn.typedActor.spendStock).not.toHaveBeenCalled();
	});

	it("asks the primary GM the same question when it falls back to them", async () => {
		const wait = stubAnswers("yes");
		const { gwynn, actors } = world({ gm: true });
		expect(await handleHealersArtsQuery(ask, {}, { actors })).toMatchObject({ key: "stock" });
		expect(gwynn.typedActor.spendStock).toHaveBeenCalled();
		expect(wait.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Spend 1 Stock on Bram", "Keep Gwynn's Stock"]);
		expect(wait.mock.calls[0][0].content).toContain("so the GM answers");
	});

	it("is answered by no second GM", async () => {
		const wait = stubAnswers("yes");
		const { gwynn, actors } = world({ gm: true, primary: false });
		expect(await handleHealersArtsQuery(ask, {}, { actors })).toBeNull();
		expect(wait).not.toHaveBeenCalled();
		expect(gwynn.typedActor.spendStock).not.toHaveBeenCalled();
	});

	it("refuses, without asking, a player who does not own the patient", async () => {
		const wait = stubAnswers("yes");
		const { gwynn, actors } = world({ ownsPatient: false });
		expect(await handleHealersArtsQuery(ask, {}, { actors })).toBeNull();
		expect(wait).not.toHaveBeenCalled();
		expect(gwynn.typedActor.spendStock).not.toHaveBeenCalled();
	});

	it("refuses, without asking, a carer whose Healer's Arts is not learned", async () => {
		const wait = stubAnswers("yes");
		const { gwynn, actors } = world({ learned: false });
		expect(await handleHealersArtsQuery(ask, {}, { actors })).toBeNull();
		expect(wait).not.toHaveBeenCalled();
		expect(gwynn.typedActor.spendStock).not.toHaveBeenCalled();
	});

	it("refuses, without asking, on a client that does not own the carer", async () => {
		const wait = stubAnswers("yes");
		const { gwynn, actors } = world({ ownsCarer: false });
		expect(await handleHealersArtsQuery(ask, {}, { actors })).toBeNull();
		expect(wait).not.toHaveBeenCalled();
		expect(gwynn.typedActor.spendStock).not.toHaveBeenCalled();
	});
});

describe("stabilizing the patient's wounds", () => {
	it("stabilizes every open problematic wound, and nothing else, in one update", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy" });
		await char.addWound({ text: "Gashed arm", requirementNote: "needs stitching" });
		await char.addWound({ text: "Lost eye", status: "permanent" });
		await char.addWound({ text: "Old scar", healed: true });
		const { update, stabilized } = char.stabilizeOpenWoundsUpdate();
		expect(stabilized.map(w => w.text)).toEqual(["Gashed arm"]);
		const next = update["system.attributes.wounds"];
		expect(next.map(w => [w.text, w.status])).toEqual([["Gashed arm", "stabilized"], ["Lost eye", "permanent"], ["Old scar", "problematic"]]);
		expect(next[0].requirementNote).toBe("");
		expect(actor.system.attributes.wounds[0].status).toBe("problematic");   // handed back, not written
	});

	it("hands back no update when nothing is open", () => {
		const { char } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy" });
		expect(char.stabilizeOpenWoundsUpdate()).toEqual({ update: {}, stabilized: [] });
	});
});

describe("the Recover window", () => {
	function makeSheet({ hp = 4, max = 20 } = {}) {
		const patient = {
			id: "bram", name: "Bram", isOwner: true,
			update: vi.fn(async () => {}),
			typedActor: {
				hp,
				computedMaxHp: vi.fn(async () => max),
				setInventoryResource: vi.fn(async () => {}),
				stabilizeOpenWoundsUpdate: vi.fn(() => ({ update: { "system.attributes.wounds": ["stabilized"] }, stabilized: [{ text: "Gashed arm" }] })),
			},
		};
		const Base = class {
			get actor() { return patient; }
			get isEditable() { return true; }
			render = vi.fn();
		};
		const Sheet = createStonetopCharacterSheetClass(Base);
		return { sheet: new Sheet(), patient };
	}
	const purse = { slug: "supplies", label: "Supplies", remaining: 3 };
	const care = (c, extra = {}) => ({ carer: { id: c.id, name: c.name, wis: c.system.stats.wis.value }, stock: false, sourceKey: null, base: 4, ...extra });

	it("adds the carer's WIS to the heal", async () => {
		const gwynn = carer();
		global.game.actors = new Map([["gwynn", gwynn]]);
		const { sheet, patient } = makeSheet();
		await sheet._applyRecover({ purse, oldHp: 4, newHp: 8, care: care(gwynn) });
		expect(patient.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 10, "flags.stonetop-pwd.recover.spent": true });
		expect(gwynn.typedActor.spendStock).not.toHaveBeenCalled();
	});

	it("with the Stock: the carer pays, the patient heals 5 more and the wounds stabilize in the same write", async () => {
		const gwynn = carer();
		global.game.actors = new Map([["gwynn", gwynn]]);
		const { sheet, patient } = makeSheet();
		await sheet._applyRecover({ purse, oldHp: 4, newHp: 8, care: care(gwynn, { stock: true, sourceKey: "stock" }) });
		expect(gwynn.typedActor.spendStock).toHaveBeenCalledTimes(1);
		expect(patient.update).toHaveBeenCalledWith({
			"system.attributes.hp.value": 15,
			"flags.stonetop-pwd.recover.spent": true,
			"system.attributes.wounds": ["stabilized"],
		});
		const card = global.ChatMessage.create.mock.calls[0][0].content;
		expect(card).toContain("Under Gwynn&#x27;s care: +2 HP (WIS)");
		expect(card).toContain("Spent 1 Stock: +5 HP");
		expect(card).toContain("Gashed arm");
	});

	it("spends nothing at all when the carer's Stock cannot be paid", async () => {
		const gwynn = carer({ purses: [] });
		global.game.actors = new Map([["gwynn", gwynn]]);
		const { sheet, patient } = makeSheet();
		await sheet._applyRecover({ purse, oldHp: 4, newHp: 8, care: care(gwynn, { stock: true, sourceKey: "stock" }) });
		expect(patient.update).not.toHaveBeenCalled();
		expect(patient.typedActor.setInventoryResource).not.toHaveBeenCalled();
	});

	it("lists the carers, this character included, with what each can pay", async () => {
		const gwynn = carer();
		const broke = carer({ id: "wren", name: "Wren", purses: [] });
		global.game.actors = { contents: [gwynn, broke, { type: "character", items: [] }] };
		const { sheet } = makeSheet();
		const carers = await sheet._recoverCarers();
		expect(carers.map(c => [c.id, c.wis, c.canPay])).toEqual([["gwynn", 2, true], ["wren", 2, false]]);
		expect(carers[1].whyNot).toBe("Wren has no Stock left to spend.");
	});

	// A carer's player who keeps their Stock still tends the Recover: WIS, but no 5 HP and no stabilizing.
	it("goes ahead without the 5 HP or the stabilizing when the carer keeps their Stock, and says so", async () => {
		const alex = player("p-gwynn", "Alex", { query: vi.fn(async () => ({ declined: true })) });
		global.game.users = usersOf([alex], null);
		global.game.user = { id: "p-bram", isGM: false };
		const gwynn = carer({ owner: false, owners: ["p-gwynn"] });
		global.game.actors = new Map([["gwynn", gwynn]]);
		const { sheet, patient } = makeSheet();
		await sheet._applyRecover({ purse, oldHp: 4, newHp: 8, care: care(gwynn, { stock: true }) });
		expect(patient.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 10, "flags.stonetop-pwd.recover.spent": true });
		expect(patient.typedActor.stabilizeOpenWoundsUpdate).not.toHaveBeenCalled();
		expect(patient.typedActor.setInventoryResource).toHaveBeenCalledWith("supplies", 2);
		expect(global.ui.notifications.info).toHaveBeenLastCalledWith(
			"Gwynn kept their Stock: you recover without the extra 5 HP, and your wounds are not stabilized.");
		const card = global.ChatMessage.create.mock.calls[0][0].content;
		expect(card).toContain("Under Gwynn&#x27;s care: +2 HP (WIS)");
		expect(card).toContain("Kept, not spent: no extra 5 HP, wounds not stabilized");
		expect(card).not.toContain("Wounds stabilized");
	});

	it("goes ahead the same way when no answer comes", async () => {
		const alex = player("p-gwynn", "Alex", { query: vi.fn(async () => { throw new Error("timed out"); }) });
		global.game.users = usersOf([alex], null);
		global.game.user = { id: "p-bram", isGM: false };
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const gwynn = carer({ owner: false, owners: ["p-gwynn"] });
		global.game.actors = new Map([["gwynn", gwynn]]);
		const { sheet, patient } = makeSheet();
		await sheet._applyRecover({ purse, oldHp: 4, newHp: 8, care: care(gwynn, { stock: true }) });
		expect(patient.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 10, "flags.stonetop-pwd.recover.spent": true });
		expect(global.ui.notifications.info.mock.calls.at(-1)[0]).toContain("No answer came about Gwynn's Stock");
		expect(global.ChatMessage.create.mock.calls[0][0].content).toContain("Not answered, not spent");
	});

	it("marks which carers this client pays for, and which it has to ask, or cannot reach", async () => {
		global.game.users = usersOf([player("p-wren", "Sam"), player("p-bryn", "Away", { active: false })], null);
		const own = carer();
		const asked = carer({ id: "wren", name: "Wren", owner: false, owners: ["p-wren"] });
		const unreachable = carer({ id: "bryn", name: "Bryn", owner: false, owners: ["p-bryn"] });
		global.game.actors = { contents: [own, asked, unreachable] };
		const { sheet } = makeSheet();
		const carers = await sheet._recoverCarers();
		expect(carers.map(c => [c.id, c.direct, c.canPay])).toEqual([["gwynn", true, true], ["wren", false, true], ["bryn", false, false]]);
		expect(carers[2].whyNot).toBe("Spending Bryn's Stock needs Bryn's player or the GM here.");
	});

	it("names Healer's Arts in the Recover guide", () => {
		expect(GUIDED_CHARACTER_MOVES.Recover.note).toContain("Healer's Arts");
	});
});
