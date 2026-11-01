// The branches of Recover, Convalesce and Have What You Need the sheet used to leave as text:
//   · tending a debility (Book I p.78, p.247): the GM says it's taken care of, maybe for a use of supplies;
//   · someone else expending a use on the patient's behalf (p.246);
//   · followers who Recover (a use each, p.240, p.473) or Convalesce (back to full, p.240);
//   · Have What You Need's "expend a use of supplies to mark an additional small item/slot" (p.78).

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const followers = vi.hoisted(() => ({
	hurtFollowerBodies: vi.fn(async () => []),
	restFollowers: vi.fn(async () => []),
}));
vi.mock("../../../module/actors/character/follower-rest.js", async importOriginal => ({ ...(await importOriginal()), ...followers }));
const payers = vi.hoisted(() => ({
	payOthersSupplies: vi.fn(async () => null),
	supplyPayersFor: vi.fn(() => []),
}));
vi.mock("../../../module/actors/character/supply-payer.js", async importOriginal => ({ ...(await importOriginal()), ...payers }));
const asked = vi.hoisted(() => ({ askWithButtons: vi.fn(async () => null) }));
vi.mock("../../../module/utils/ask-with-buttons.js", async importOriginal => ({ ...(await importOriginal()), ...asked }));
// The tend window: the spec it opens with, and the answer the test gives it.
const picker = vi.hoisted(() => ({ ask: vi.fn(async () => null) }));
vi.mock("../../../module/dialogs/content-picker.js", async importOriginal => {
	const original = await importOriginal();
	return { ...original, ContentPickerDialog: class extends original.ContentPickerDialog { static ask(spec) { return picker.ask(spec); } } };
});

const { createStonetopCharacterSheetClass } = await import("../../../module/actors/character/StonetopCharacterSheet.js");
const { supplyPursesFor, SUPPLY_PURPOSE } = await import("../../../module/actors/character/supply-cost.js");

function makeSheet({ hp = 4, max = 20, supplies = 3, spent = false, debilities = [], smallMarks = 0, insert = null } = {}) {
	const flags = { "inventory.resources": { supplies }, "recover.spent": spent };
	const patient = {
		id: "bram", name: "Bram", isOwner: true,
		// A worn post-death insert, where isUnliving reads it.
		flags: insert ? { "stonetop-pwd": { postDeathInsert: { slug: insert } } } : {},
		getFlag: (_scope, key) => flags[key] ?? null,
		update: vi.fn(async () => {}),
		typedActor: {
			hp,
			computedMaxHp: vi.fn(async () => max),
			inventoryResourceData: vi.fn((slug, count) => ({ [`flags.stonetop-pwd.inventory.resources.${slug}`]: count })),
			supplyPurses: vi.fn(purpose => supplyPursesFor(flags["inventory.resources"], purpose)),
			spendablePurseResources: vi.fn(() => flags["inventory.resources"]),
			stabilizeOpenWoundsUpdate: vi.fn(() => ({ update: {}, stabilized: [] })),
			convalesceWounds: vi.fn(async () => {}),
			debilityChoices: debilities.map(d => ({ key: d, name: d[0].toUpperCase() + d.slice(1), marked: true })),
			undefinedSmallMarks: smallMarks,
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

let saved;
beforeEach(() => {
	saved = { actors: global.game.actors, ChatMessage: global.ChatMessage, ui: global.ui };
	global.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
	global.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
	global.game.actors = new Map();
	for (const fn of [...Object.values(followers), ...Object.values(payers), ...Object.values(asked)]) fn.mockClear();
	followers.hurtFollowerBodies.mockImplementation(async () => []);
	followers.restFollowers.mockImplementation(async () => []);
	payers.supplyPayersFor.mockImplementation(() => []);
	payers.payOthersSupplies.mockImplementation(async () => null);
	picker.ask.mockReset();
	picker.ask.mockImplementation(async () => null);
});
afterEach(() => {
	global.game.actors = saved.actors;
	global.ChatMessage = saved.ChatMessage;
	global.ui = saved.ui;
});

describe("the Recover card", () => {
	const snapshot = ({ value = 20, max = 20, debility = false } = {}) => ({
		vitals: { hp: { value, max } },
		inventory: { outfit: { usesPerSupply: 4, smallItemLimit: 4 } },
		debilities: [{ key: "weakened", name: "Weakened", active: debility }],
	});

	it("opens at full HP for a debility to tend, or a follower to heal, and not otherwise", () => {
		const { sheet } = makeSheet({ hp: 20 });
		expect(sheet._buildRecoverData(snapshot({ debility: true }))).toMatchObject({ canRecover: false, canTend: true, canOpen: true });
		expect(sheet._buildRecoverData(snapshot(), { hurtFollowers: 2 })).toMatchObject({ canRecover: false, followersCanRecover: true, canOpen: true });
		expect(sheet._buildRecoverData(snapshot())).toMatchObject({ canOpen: false });
	});

	it("opens a tend even once the HP Recover is spent", () => {
		const { sheet } = makeSheet({ spent: true });
		expect(sheet._buildRecoverData(snapshot({ value: 5, debility: true }))).toMatchObject({ locked: true, canRecover: false, canOpen: true });
	});
});

describe("Recover with followers", () => {
	it("spends a use for the character and one per follower, and heals each follower by 4+Prosperity", async () => {
		followers.hurtFollowerBodies.mockImplementation(async () => [{ id: "f1" }, { id: "f2" }]);
		followers.restFollowers.mockImplementation(async () => [{ name: "Hari", from: 1, to: 5 }, { name: "Glaw", from: 2, to: 6 }]);
		const { sheet, patient } = makeSheet();
		await sheet._applyRecover({ purse, base: 4, followers: ["f1", "f2"] });
		expect(patient.update).toHaveBeenCalledWith({
			"flags.stonetop-pwd.inventory.resources.supplies": 0,
			"system.attributes.hp.value": 8,
			"flags.stonetop-pwd.recover.spent": true,
		}, { stonetopMove: "Recover" });
		// Not handed the bodies read before any ask: restFollowers reads their HP again at the heal.
		expect(followers.restFollowers).toHaveBeenCalledWith(patient, ["f1", "f2"], { heal: 4, moveName: "Recover" });
		expect(global.ChatMessage.create.mock.calls[0][0].content).toContain("Hari 1 → 5; Glaw 2 → 6");
	});

	it("heals the followers alone when the character's own Recover is spent, leaving their HP and lock be", async () => {
		followers.hurtFollowerBodies.mockImplementation(async () => [{ id: "f1" }]);
		const { sheet, patient } = makeSheet({ hp: 20, spent: true });
		await sheet._applyRecover({ purse, base: 4, self: false, followers: ["f1"] });
		expect(patient.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.inventory.resources.supplies": 2 }, { stonetopMove: "Recover" });
		expect(followers.restFollowers).toHaveBeenCalledTimes(1);
	});

	// The window opened with the character hurt, and a heal topped them up before the press: the ticked
	// followers are still owed their Recover, and only their uses are spent.
	it("heals the followers alone when the character reached full HP since the window opened", async () => {
		followers.hurtFollowerBodies.mockImplementation(async () => [{ id: "f1" }]);
		const { sheet, patient } = makeSheet({ hp: 20 });
		await sheet._applyRecover({ purse, base: 4, followers: ["f1"] });
		expect(patient.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.inventory.resources.supplies": 2 }, { stonetopMove: "Recover" });
		expect(followers.restFollowers).toHaveBeenCalledTimes(1);
	});

	it("spends nothing at full HP with no follower ticked", async () => {
		const { sheet, patient } = makeSheet({ hp: 20 });
		await sheet._applyRecover({ purse, base: 4 });
		expect(patient.update).not.toHaveBeenCalled();
		expect(global.ui.notifications.warn).toHaveBeenCalledWith(global.game.i18n.localize("stonetop.specialMoves.recover.fullHpHint"));
	});

	// Code review 10-22 (HC-9): a follower whose HP is an NPC this client cannot write is healed by the GM's
	// client. With no GM here, they are left out before anything is spent on them.
	it("spends nothing on a follower only the absent GM could heal", async () => {
		followers.hurtFollowerBodies.mockImplementation(async () => [
			{ id: "f1", name: "Hari" }, { id: "f2", name: "Glaw", npcHeld: true, healable: false },
		]);
		const { sheet, patient } = makeSheet();
		await sheet._applyRecover({ purse, base: 4, followers: ["f1", "f2"] });
		expect(patient.update).toHaveBeenCalledWith(expect.objectContaining({ "flags.stonetop-pwd.inventory.resources.supplies": 1 }), { stonetopMove: "Recover" });
		expect(followers.restFollowers).toHaveBeenCalledWith(patient, ["f1"], { heal: 4, moveName: "Recover" });
		expect(global.ui.notifications.warn.mock.calls[0][0]).toContain("Glaw");
	});

	it("refuses when the purse cannot pay for everyone picked", async () => {
		followers.hurtFollowerBodies.mockImplementation(async () => [{ id: "f1" }, { id: "f2" }, { id: "f3" }]);
		const { sheet, patient } = makeSheet();
		await sheet._applyRecover({ purse, base: 4, followers: ["f1", "f2", "f3"] });
		expect(patient.update).not.toHaveBeenCalled();
		expect(followers.restFollowers).not.toHaveBeenCalled();
	});
});

describe("someone else's supplies", () => {
	function payer() {
		const wren = {
			id: "wren", name: "Wren",
			typedActor: { supplyPurses: purpose => supplyPursesFor({ supplies: 5 }, purpose) },
		};
		global.game.actors = new Map([["wren", wren]]);
		return wren;
	}

	it("pays from the payer, and writes only the patient's HP and lock", async () => {
		const wren = payer();
		payers.payOthersSupplies.mockImplementation(async () => ({ slug: "supplies", label: "Supplies", spent: 1, left: 4 }));
		const { sheet, patient } = makeSheet({ supplies: 0 });
		await sheet._applyRecover({ purse: { slug: "supplies", label: "Supplies" }, payer: { id: "wren" }, base: 4 });
		expect(payers.payOthersSupplies).toHaveBeenCalledWith(expect.objectContaining({ payer: wren, patient, n: 1, purpose: SUPPLY_PURPOSE.RECOVER }));
		expect(patient.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 8, "flags.stonetop-pwd.recover.spent": true }, { stonetopMove: "Recover" });
		expect(global.ChatMessage.create.mock.calls[0][0].content).toContain("Expended 1 use on Bram&#x27;s behalf (4 left)");
	});

	it("writes no second heal or lock when another window made the Recover while the payer was asked", async () => {
		payer();
		const { sheet, patient } = makeSheet({ supplies: 0 });
		payers.payOthersSupplies.mockImplementation(async () => {
			patient.getFlag = (_scope, key) => key === "recover.spent";
			return { slug: "supplies", label: "Supplies", spent: 1, left: 4 };
		});
		await sheet._applyRecover({ purse: { slug: "supplies", label: "Supplies" }, payer: { id: "wren" }, base: 4 });
		expect(patient.update).not.toHaveBeenCalled();
		expect(global.ui.notifications.warn.mock.calls[0][0]).toContain("Wren's supplies were already spent");
	});

	it("still heals the followers the payer paid for when the character's own Recover was made meanwhile", async () => {
		payer();
		followers.hurtFollowerBodies.mockImplementation(async () => [{ id: "f1" }]);
		followers.restFollowers.mockImplementation(async () => [{ name: "Hari", from: 1, to: 5 }]);
		const { sheet, patient } = makeSheet({ supplies: 0 });
		payers.payOthersSupplies.mockImplementation(async () => {
			patient.getFlag = (_scope, key) => key === "recover.spent";
			return { slug: "supplies", label: "Supplies", spent: 2, left: 3 };
		});
		await sheet._applyRecover({ purse: { slug: "supplies", label: "Supplies" }, payer: { id: "wren" }, base: 4, followers: ["f1"] });
		expect(patient.update).not.toHaveBeenCalled();
		expect(followers.restFollowers).toHaveBeenCalledWith(patient, ["f1"], { heal: 4, moveName: "Recover" });
		expect(global.ChatMessage.create.mock.calls[0][0].content).toContain("Hari 1 → 5");
	});

	// Code review 10-22 (HC-3): a blow can land while the payer decides. "A character disabled this way can't
	// save themselves" (Book I p.240), so the patient's own heal is refused then, as it is before the ask.
	it("heals nothing of the patient's own when they went to Death's Door while the payer was asked", async () => {
		payer();
		const { sheet, patient } = makeSheet({ supplies: 0 });
		payers.payOthersSupplies.mockImplementation(async () => {
			patient.typedActor.canFaceDeathsDoor = true;
			return { slug: "supplies", label: "Supplies", spent: 1, left: 4 };
		});
		await sheet._applyRecover({ purse: { slug: "supplies", label: "Supplies" }, payer: { id: "wren" }, base: 4 });
		expect(patient.update).not.toHaveBeenCalled();
		expect(global.ui.notifications.warn.mock.calls[0][0]).toContain("Wren's supplies were already spent");
	});

	// The payer's turn checks the Recover is still possible before it pays (supply-payer.js#spendPayerSupplies).
	it("asks the payer's turn to check the patient's own Recover, and heals nothing it refused", async () => {
		payer();
		payers.payOthersSupplies.mockImplementation(async () => ({ refused: "Already recovered." }));
		const { sheet, patient } = makeSheet({ supplies: 0 });
		await sheet._applyRecover({ purse: { slug: "supplies", label: "Supplies" }, payer: { id: "wren" }, base: 4 });
		expect(payers.payOthersSupplies).toHaveBeenCalledWith(expect.objectContaining({ n: 1, recover: { self: true } }));
		expect(patient.update).not.toHaveBeenCalled();
		expect(global.ui.notifications.warn).toHaveBeenCalledWith("Already recovered.");
		expect(global.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("heals the followers alone when the payer's turn paid for them and refused the patient's own part", async () => {
		payer();
		followers.hurtFollowerBodies.mockImplementation(async () => [{ id: "f1" }]);
		followers.restFollowers.mockImplementation(async () => [{ name: "Hari", from: 1, to: 5 }]);
		payers.payOthersSupplies.mockImplementation(async () => ({ slug: "supplies", label: "Supplies", spent: 1, left: 4, refused: "On Death's Door." }));
		const { sheet, patient } = makeSheet({ supplies: 0 });
		await sheet._applyRecover({ purse: { slug: "supplies", label: "Supplies" }, payer: { id: "wren" }, base: 4, followers: ["f1"] });
		expect(payers.payOthersSupplies).toHaveBeenCalledWith(expect.objectContaining({ n: 2 }));
		expect(patient.update).not.toHaveBeenCalled();
		expect(followers.restFollowers).toHaveBeenCalledWith(patient, ["f1"], { heal: 4, moveName: "Recover" });
		expect(global.ui.notifications.warn).toHaveBeenCalledWith("On Death's Door.");
	});

	it("heals nothing when the payer keeps their supplies", async () => {
		payer();
		payers.payOthersSupplies.mockImplementation(async () => ({ declined: true }));
		const { sheet, patient } = makeSheet({ supplies: 0 });
		await sheet._applyRecover({ purse: { slug: "supplies", label: "Supplies" }, payer: { id: "wren" }, base: 4 });
		expect(patient.update).not.toHaveBeenCalled();
		expect(global.ui.notifications.warn).toHaveBeenCalled();
	});
});

describe("tending a debility", () => {
	it("clears it on the GM's word, needing no supplies", async () => {
		const { sheet, patient } = makeSheet({ hp: 20, spent: true, debilities: ["dazed"] });
		await sheet._applyTendDebility({ key: "dazed" });
		expect(patient.update).toHaveBeenCalledWith({ "system.attributes.debilities.options.dazed.value": false }, { stonetopMove: "Recover" });
	});

	it("spends the use of supplies the GM asked for in the same write", async () => {
		const { sheet, patient } = makeSheet({ debilities: ["weakened"] });
		await sheet._applyTendDebility({ key: "weakened", spend: true, purse });
		expect(patient.update).toHaveBeenCalledWith({
			"system.attributes.debilities.options.weakened.value": false,
			"flags.stonetop-pwd.inventory.resources.supplies": 2,
		}, { stonetopMove: "Recover" });
	});

	it("asks in the system's own window, still saying why provisions can't pay when someone else could", async () => {
		const wren = { id: "wren", name: "Wren", typedActor: { supplyPurses: purpose => supplyPursesFor({ supplies: 5 }, purpose) } };
		global.game.actors = new Map([["wren", wren]]);
		payers.supplyPayersFor.mockImplementation(() => [{ id: "wren", name: "Wren", actor: wren, purses: supplyPursesFor({ supplies: 5 }, SUPPLY_PURPOSE.RECOVER) }]);
		payers.payOthersSupplies.mockImplementation(async () => ({ slug: "supplies", label: "Supplies", spent: 1, left: 4 }));
		const { sheet, patient } = makeSheet({ supplies: 0, debilities: ["weakened"] });
		patient.typedActor.supplyPurses.mockImplementation(purpose => supplyPursesFor({ provisions: 4 }, purpose));
		picker.ask.mockImplementation(async spec => spec.read({
			querySelector: sel => ({
				'[name="tendSpend"]': { checked: true },
				'[name="tendDebility"]:checked': { value: "weakened" },
				'input[name="supplyPurse"]:checked': { value: "wren::supplies" },
			})[sel] ?? null,
		}));
		await sheet._onTendDebility();
		const spec = picker.ask.mock.calls[0][0];
		expect(spec.body).toContain("Wren&#x27;s supplies");
		expect(spec.body).toContain("stonetop-supply-purse-refused");
		expect(payers.payOthersSupplies).toHaveBeenCalledWith(expect.objectContaining({ payer: wren, patient, slug: "supplies", n: 1 }));
		expect(patient.update).toHaveBeenCalledWith({ "system.attributes.debilities.options.weakened.value": false }, { stonetopMove: "Recover" });
		expect(global.ChatMessage.create.mock.calls[0][0].content).toContain("Expended 1 use on Bram&#x27;s behalf (4 left)");
	});

	it("asks the payer's turn to check the debility, and clears nothing it refused", async () => {
		const wren = { id: "wren", name: "Wren", typedActor: { supplyPurses: purpose => supplyPursesFor({ supplies: 5 }, purpose) } };
		global.game.actors = new Map([["wren", wren]]);
		payers.payOthersSupplies.mockImplementation(async () => ({ refused: "Weakened was tended already." }));
		const { sheet, patient } = makeSheet({ supplies: 0, debilities: ["weakened"] });
		await sheet._applyTendDebility({ key: "weakened", spend: true, purse: { slug: "supplies" }, payer: { id: "wren" } });
		expect(payers.payOthersSupplies).toHaveBeenCalledWith(expect.objectContaining({ recover: { tend: "weakened" } }));
		expect(patient.update).not.toHaveBeenCalled();
		expect(global.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("clears nothing that is no longer marked", async () => {
		const { sheet, patient } = makeSheet({ debilities: [] });
		await sheet._applyTendDebility({ key: "weakened" });
		expect(patient.update).not.toHaveBeenCalled();
	});

	// Code review 10-22 (HC-4): the payer can take minutes, and the debility can be tended meanwhile (a camp,
	// the GM, another window). Read again once they have paid: the card says the use went and nothing was tended.
	it("clears nothing, and says the payer's use went, when it was tended while the payer was asked", async () => {
		const wren = { id: "wren", name: "Wren", typedActor: { supplyPurses: purpose => supplyPursesFor({ supplies: 5 }, purpose) } };
		global.game.actors = new Map([["wren", wren]]);
		const { sheet, patient } = makeSheet({ supplies: 0, debilities: ["weakened"] });
		payers.payOthersSupplies.mockImplementation(async () => {
			patient.typedActor.debilityChoices = [{ key: "weakened", name: "Weakened", marked: false }];
			return { slug: "supplies", label: "Supplies", spent: 1, left: 4 };
		});
		await sheet._applyTendDebility({ key: "weakened", spend: true, purse: { slug: "supplies" }, payer: { id: "wren" } });
		expect(patient.update).not.toHaveBeenCalled();
		expect(global.ui.notifications.warn.mock.calls[0][0]).toContain("Wren's supplies were already spent");
		const card = global.ChatMessage.create.mock.calls[0][0].content;
		expect(card).toContain("Expended 1 use on Bram&#x27;s behalf (4 left)");
		expect(card).toContain(global.game.i18n.localize("stonetop.specialMoves.recover.tend.notTended"));
	});
});

describe("Convalesce with followers", () => {
	it("rests the followers ticked back to their max", async () => {
		followers.restFollowers.mockImplementation(async () => [{ name: "Hari", from: 1, to: 6 }]);
		const { sheet } = makeSheet();
		await sheet._applyConvalesce({ debilities: [], followers: ["f1"] });
		expect(followers.restFollowers).toHaveBeenCalledWith(expect.anything(), ["f1"], { moveName: "Convalesce" });
		expect(global.ChatMessage.create.mock.calls[0][0].content).toContain("Hari 1 → 6");
	});
});

// RV-2 (2026-10-26 audit; the user's ruling, 2026-10-27): "You gain no benefit from ... Recover or
// Convalesce" is the Ghost's or Revenant's own. Their followers are not Unliving, and Recover and
// Convalesce on their own, so both moves stay open for them, follower-only.
describe("an Unliving character's followers", () => {
	const snapshot = ({ value = 4, max = 20, debility = true } = {}) => ({
		vitals: { hp: { value, max } },
		inventory: { outfit: { usesPerSupply: 4, smallItemLimit: 4 } },
		debilities: [{ key: "weakened", name: "Weakened", active: debility }],
		wounds: [],
	});

	it("keeps the Recover card open for hurt followers alone, and locked with none", () => {
		const { sheet } = makeSheet({ insert: "revenant" });
		expect(sheet._buildRecoverData(snapshot(), { hurtFollowers: 1 })).toMatchObject({
			canRecover: false, canTend: false, followersCanRecover: true, canOpen: true,
			hint: { text: global.game.i18n.localize("stonetop.specialMoves.recover.unlivingFollowersHint") },
		});
		expect(sheet._buildRecoverData(snapshot())).toMatchObject({
			canOpen: false, hint: { text: global.game.i18n.localize("stonetop.specialMoves.recover.unlivingHint") },
		});
	});

	it("keeps the Convalesce card open for hurt followers alone, not for the character's own HP or debilities", () => {
		const { sheet } = makeSheet({ insert: "ghost" });
		expect(sheet._buildConvalesceData(snapshot(), { hurtFollowers: 2 })).toMatchObject({ canConvalesce: true });
		expect(sheet._buildConvalesceData(snapshot())).toMatchObject({ canConvalesce: false });
	});

	it("spends a use per follower and leaves the character's own HP and lock alone, even when asked for both", async () => {
		followers.hurtFollowerBodies.mockImplementation(async () => [{ id: "f1" }]);
		const { sheet, patient } = makeSheet({ insert: "revenant" });
		await sheet._applyRecover({ purse, base: 4, self: true, care: { carer: { id: "x" }, stock: true }, followers: ["f1"] });
		expect(patient.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.inventory.resources.supplies": 2 }, { stonetopMove: "Recover" });
		expect(followers.restFollowers).toHaveBeenCalledWith(patient, ["f1"], { heal: 4, moveName: "Recover" });
	});

	it("spends nothing on a Recover with no follower ticked", async () => {
		const { sheet, patient } = makeSheet({ insert: "revenant" });
		await sheet._applyRecover({ purse, base: 4 });
		expect(patient.update).not.toHaveBeenCalled();
		expect(global.ui.notifications.warn).toHaveBeenCalledWith(global.game.i18n.localize("stonetop.specialMoves.recover.unlivingHint"));
	});

	it("rests the followers ticked and writes nothing of the character's own", async () => {
		followers.restFollowers.mockImplementation(async () => [{ name: "Hari", from: 1, to: 6 }]);
		const { sheet, patient } = makeSheet({ insert: "ghost" });
		await sheet._applyConvalesce({ debilities: [{ key: "weakened", name: "Weakened" }], healIds: ["w1"], followers: ["f1"] });
		expect(patient.update).not.toHaveBeenCalled();
		expect(patient.typedActor.convalesceWounds).not.toHaveBeenCalled();
		expect(followers.restFollowers).toHaveBeenCalledWith(patient, ["f1"], { moveName: "Convalesce" });
		const card = global.ChatMessage.create.mock.calls[0][0].content;
		expect(card).toContain("Hari 1 → 6");
		expect(card).not.toContain("Weakened");
	});

	it("writes nothing at all with no follower ticked", async () => {
		const { sheet, patient } = makeSheet({ insert: "ghost" });
		await sheet._applyConvalesce({ debilities: [{ key: "weakened", name: "Weakened" }], followers: [] });
		expect(patient.update).not.toHaveBeenCalled();
		expect(followers.restFollowers).not.toHaveBeenCalled();
	});
});

describe("Have What You Need: a small item past the allotment", () => {
	// The small column as the sheet draws it: its allotment, and how many of its boxes are ticked now.
	const column = (allotment, ticked) => ({ dataset: { smallAllotment: String(allotment) }, querySelectorAll: () => ({ length: ticked }) });

	it("offers to expend a use of supplies once the undefined small marks are spent, and spends it", async () => {
		asked.askWithButtons.mockImplementation(async () => "spend");
		const { sheet, patient } = makeSheet({ smallMarks: 0 });
		expect(await sheet._haveExtraSmallItem(column(4, 5), "Whistle")).toBe("spent");
		expect(patient.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.inventory.resources.supplies": 2 }, { stonetopMove: "Have What You Need" });
		expect(global.ChatMessage.create.mock.calls[0][0].content).toContain("Whistle");
	});

	it("marks nothing when the window is closed", async () => {
		asked.askWithButtons.mockImplementation(async () => null);
		const { sheet, patient } = makeSheet({ smallMarks: 0 });
		expect(await sheet._haveExtraSmallItem(column(4, 5))).toBeNull();
		expect(patient.update).not.toHaveBeenCalled();
	});

	it("asks nothing within the allotment, or while undefined small marks remain", async () => {
		const { sheet } = makeSheet({ smallMarks: 0 });
		expect(await sheet._haveExtraSmallItem(column(4, 4))).toBe("ok");
		const withMarks = makeSheet({ smallMarks: 2 }).sheet;
		expect(await withMarks._haveExtraSmallItem(column(4, 5))).toBe("ok");
		expect(asked.askWithButtons).not.toHaveBeenCalled();
	});
});
