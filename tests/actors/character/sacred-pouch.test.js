// The Blessed re-audit (2026-10-18), items 8-10: the sacred pouch's named entries (Suck the Poison Out's
// stored malady, Borrow Power's borrowed power), its growth arriving EMPTY, and the downtime refill.
//
// Book I, The Blessed: the pouch "can hold up to 3 Stock... Each time you gain an even-numbered level,
// your pouch can hold +1 Stock... When you have a few days of downtime in familiar terrain, you may
// replenish your Stock." The track counts Stock SPENT, so `remaining = max - spent` (stock-cost.js).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Handlebars from "handlebars";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { readRepo } from "../../fakes/css.js";
import {
	POUCH_SLOT, readPouchSlots, pouchUsableMax, spentAfterStore, spentAfterFree, settledPouchSpent,
	sacredPouchPanel, pouchStoreWarning, storeInPouch, takeFromPouch, replenishPouch, loseBorrowedPower,
	suckThePoisonOutRollOptions, borrowPowerRollOptions, settlePouchStore, settlePowerLost,
	POUCH_STORED_FLAG, SUCK_THE_POISON_OUT, BORROW_POWER,
} from "../../../module/actors/character/sacred-pouch.js";
import { restockPouch } from "../../../module/actors/character/provisions.js";
import { MOVE_ROLL_OPTIONS } from "../../../module/actors/character/move-roll-options.js";
import { createStonetopCharacterSheetClass, GUIDED_CHARACTER_MOVES } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { LevelUpDialog } from "../../../module/actors/character/dialogs/LevelUpDialog.js";

// The level-up's agreed step asks a world setting whether this user may write a custom move
// (utils/authoring-gates.js); a world always has settings, so the tests give it some, all unset.
let priorSettings;
beforeEach(() => { priorSettings = game.settings; game.settings ??= { get: () => undefined }; });
afterEach(() => { game.settings = priorSettings; });

const SCOPE = "stonetop-pwd";
const POUCH = "sacred-pouch";
const blessedMove = name => sourceMovesFor("The Blessed").find(d => d.name === name);
const moveItem = (name, { learned = true } = {}) => makeLiveItem({
	name, type: "move", system: structuredClone(blessedMove(name).system),
	flags: learned ? {} : { [SCOPE]: { learned: false } },
});

/** A Blessed at `level` with `spent` Stock gone and `slots` already in the pouch. */
function blessed({ level = 1, spent = 0, slots = null, items = [] } = {}) {
	const flags = {};
	if (spent) flags["possessions.uses"] = { [POUCH]: spent };
	if (slots) flags["possessions.pouchSlots"] = slots;
	const built = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", level, items, flags });
	built.actor.typedActor = built.char;
	built.actor.isOwner = true;
	built.actor.items.get = id => built.actor.items.find(i => i.id === id);
	return built;
}
const spentOf = actor => actor.getFlag(SCOPE, "possessions.uses")?.[POUCH] ?? 0;
const pouchOf = async char => (await char.stockSources()).find(s => s.key === "stock");
const slot = (id, kind, name) => ({ id, kind, name });

beforeEach(() => {
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
});
afterEach(() => {
	delete globalThis.ui; delete globalThis.Roll; delete globalThis.ChatMessage;
});

describe("the pouch's arithmetic", () => {
	it("an entry takes the space of 1 Stock off the usable max, never below 0", () => {
		expect(pouchUsableMax(4, 1)).toBe(3);
		expect(pouchUsableMax(3, 5)).toBe(0);
	});

	// "taking the space of 1 Stock": an empty space first, else a Stock goes (flagged, never refused).
	it("storing fills an empty space, else displaces a Stock", () => {
		expect(spentAfterStore(2, 3)).toEqual({ spent: 1, displaced: false, overfull: false });
		expect(spentAfterStore(0, 3)).toEqual({ spent: 0, displaced: true, overfull: false });
		expect(spentAfterStore(0, 0)).toEqual({ spent: 0, displaced: false, overfull: true });
	});

	it("taking one out leaves its space empty", () => {
		expect(spentAfterFree(1, 2, 3)).toBe(2);
		expect(spentAfterFree(0, 0, 0)).toBe(0);
	});

	// The user's ruling: growth arrives EMPTY; a shrink clamps; a pouch gained or lost settles nothing.
	it("settles a max change: growth empty, shrink clamped", () => {
		expect(settledPouchSpent(0, 3, 4)).toBe(1);
		expect(settledPouchSpent(1, 4, 6)).toBe(3);
		expect(settledPouchSpent(1, 6, 4)).toBe(1);
		expect(settledPouchSpent(5, 6, 4)).toBe(4);
		expect(settledPouchSpent(2, 3, 3)).toBeNull();
		expect(settledPouchSpent(0, null, 4)).toBeNull();
		expect(settledPouchSpent(0, 4, null)).toBeNull();
	});

	it("reads only named rows", () => {
		expect(readPouchSlots([slot("a", "power", " Keen nose "), { id: "b", name: "" }, null, slot("c", "x", "Rot")]))
			.toEqual([slot("a", "power", "Keen nose"), slot("c", "malady", "Rot")]);
		expect(readPouchSlots("nope")).toEqual([]);
	});
});

describe("8. pouch slots lower the usable max, for every reader", () => {
	it("a stored entry lowers sacredPouchMax and stockSources, and keeps the room", async () => {
		const { char } = blessed({ level: 2, spent: 1, slots: [slot("m1", "malady", "Rot fever")] });
		expect(await char.sacredPouchMax(undefined, { capacity: true })).toBe(4);
		expect(await char.sacredPouchMax()).toBe(3);
		expect(await pouchOf(char)).toMatchObject({ max: 3, remaining: 2 });
	});

	it("storing into free room keeps the Stock; into a full pouch it displaces 1", async () => {
		const roomy = blessed({ spent: 1 });
		const entry = await roomy.char.storePouchSlot({ kind: POUCH_SLOT.MALADY, name: "Rot fever" });
		expect(entry).toMatchObject({ kind: "malady", name: "Rot fever", displaced: false });
		expect(await pouchOf(roomy.char)).toMatchObject({ max: 2, remaining: 2 });
		expect(spentOf(roomy.actor)).toBe(0);

		const full = blessed();
		expect((await full.char.storePouchSlot({ kind: POUCH_SLOT.POWER, name: "Keen nose" })).displaced).toBe(true);
		expect(await pouchOf(full.char)).toMatchObject({ max: 2, remaining: 2 });
	});

	it("taking an entry out gives the space back empty", async () => {
		const { char, actor } = blessed({ slots: [slot("p1", "power", "Keen nose")] });
		expect(await pouchOf(char)).toMatchObject({ max: 2, remaining: 2 });
		expect(await char.removePouchSlot("p1")).toMatchObject({ name: "Keen nose" });
		expect(await pouchOf(char)).toMatchObject({ max: 3, remaining: 2 });
		expect(spentOf(actor)).toBe(1);
		expect(char.pouchSlots).toEqual([]);
	});

	it("the gear tab's track is the usable max, drawn at most full spent", async () => {
		const { char } = blessed({ spent: 3, slots: [slot("m1", "malady", "Rot")] });
		const snap = await char.buildSnapshot();
		const row = snap.inventory.possessions.items.find(i => i.slug === POUCH);
		expect(row.resource.max).toBe(2);
		expect(row.resource.current).toBe(2);
	});

	// Forage restocks through stockSources' pouch purse, which is the usable max.
	it("Forage's restock stops at the usable max", async () => {
		const { char } = blessed({ spent: 3, slots: [slot("m1", "malady", "Rot")] });
		const pouch = await pouchOf(char);
		expect(pouch.max).toBe(2);
		expect(restockPouch(pouch.stored, 5, pouch.max)).toEqual({ spent: 2, restocked: 2, held: 2 });
	});

	it("the store window warns, never refuses, when there is no free room", () => {
		expect(pouchStoreWarning({ usable: 3, spent: 1 })).toBe("");
		expect(pouchStoreWarning({ usable: 3, spent: 0 })).toMatch(/takes the place of 1 Stock, which you discard/);
		expect(pouchStoreWarning({ usable: 0, spent: 0 })).toMatch(/no room left/);
	});

	it("storeInPouch asks the name, stores it and says so", async () => {
		const { actor, char } = blessed();
		const ask = vi.fn(async () => "Rot fever");
		const post = vi.fn();
		const entry = await storeInPouch(actor, POUCH_SLOT.MALADY, { moveName: SUCK_THE_POISON_OUT, ask, post });
		expect(ask.mock.calls[0][1].warning).toMatch(/full of Stock/);
		expect(entry).toMatchObject({ name: "Rot fever" });
		expect(char.pouchSlots.map(s => s.name)).toEqual(["Rot fever"]);
		expect(post.mock.calls[0][2]).toContain("discarding 1 Stock to make room");

		const cancelled = blessed();
		expect(await storeInPouch(cancelled.actor, POUCH_SLOT.MALADY, { ask: async () => null, post })).toBeNull();
		expect(cancelled.char.pouchSlots).toEqual([]);
	});

	it("the remove control asks why, then takes it out", async () => {
		const { actor, char } = blessed({ slots: [slot("m1", "malady", "Rot")] });
		const post = vi.fn();
		expect(await takeFromPouch(actor, "m1", { ask: async () => null, post })).toBeNull();
		expect(char.pouchSlots).toHaveLength(1);
		expect(await takeFromPouch(actor, "m1", { ask: async () => "inflict", post })).toMatchObject({ id: "m1" });
		expect(char.pouchSlots).toEqual([]);
		expect(post.mock.calls[0][2]).toContain("to inflict on another");
	});

	it("Borrow Power's 7-9 loses the one power, or asks which of several", async () => {
		const one = blessed({ slots: [slot("m1", "malady", "Rot"), slot("p1", "power", "Keen nose")] });
		const ask = vi.fn(async () => "p2");
		expect(await loseBorrowedPower(one.actor, { ask, post: vi.fn() })).toMatchObject({ id: "p1" });
		expect(ask).not.toHaveBeenCalled();
		expect(one.char.pouchSlots.map(s => s.id)).toEqual(["m1"]);

		const two = blessed({ slots: [slot("p1", "power", "Keen nose"), slot("p2", "power", "Thick hide")] });
		expect(await loseBorrowedPower(two.actor, { ask, post: vi.fn() })).toMatchObject({ id: "p2" });
		expect(ask.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Keen nose", "Thick hide", "Cancel"]);

		expect(await loseBorrowedPower(blessed().actor, { ask, post: vi.fn() })).toBeNull();
	});

	it("the gear tab's panel lists the entries with their remove control", () => {
		const { actor } = blessed({ spent: 1, slots: [slot("m1", "malady", "Rot"), slot("p1", "power", "Keen nose")] });
		const panel = sacredPouchPanel(actor, { editable: true });
		expect(panel).toMatchObject({ slug: POUCH, hasSlots: true, canReplenish: true });
		expect(panel.slots.map(s => `${s.kindLabel}: ${s.name}`)).toEqual(["Malady: Rot", "Borrowed power: Keen nose"]);
		expect(sacredPouchPanel(actor, { editable: false }).canReplenish).toBe(false);

		const src = readRepo("templates/actor/partials/tab-equipment.hbs");
		const from = src.indexOf("{{#if (and checked (eq slug @root.stonetop.sacredPouch.slug))}}");
		const fragment = src.slice(from, src.indexOf("{{#if choiceSummary}}", from));
		const hb = Handlebars.create();
		hb.registerHelper("eq", (a, b) => a === b);
		hb.registerHelper("and", (...args) => args.slice(0, -1).every(Boolean));
		const html = hb.compile(fragment)({ slug: POUCH, checked: true, stonetop: { sacredPouch: panel } });
		expect(html).toContain('data-slot-id="m1"');
		expect(html).toContain("Borrowed power:</span> Keen nose");
		expect(html).toContain("stonetop-pouch-replenish");
		expect(html).toContain("Replenish (downtime)");

		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toContain('html.find(".stonetop-pouch-slot-remove").on("click", pouchAction(btn => takeFromPouch(this.actor, btn.dataset.slotId)));');
		expect(sheet).toContain('html.find(".stonetop-pouch-replenish").on("click", pouchAction(() => replenishPouch(this.actor)));');
		expect(sheet).toContain("context.stonetop.sacredPouch     = sacredPouchPanel(this.actor, { editable: this.isEditable, usable: await this._stonetopCharacter.sacredPouchMax?.() });");
	});

	// Every space holding an entry leaves a usable max of 0: replenishPouch would only say "already full".
	it("offers no Replenish when the stored spent count is over the usable max", async () => {
		const { actor, char } = blessed({ spent: 1, slots: [slot("a", "malady", "A"), slot("b", "malady", "B"), slot("c", "malady", "C")] });
		const usable = await char.sacredPouchMax();
		expect(usable).toBe(0);
		expect(sacredPouchPanel(actor, { editable: true, usable }).canReplenish).toBe(false);
		expect(sacredPouchPanel(actor, { editable: true, usable: 3 }).canReplenish).toBe(true);
	});
});

describe("8. the buttons that store and lose", () => {
	const learned = () => blessed({ items: [moveItem(SUCK_THE_POISON_OUT), moveItem(BORROW_POWER)] });

	it("ride the roll cards only for LEARNED moves", () => {
		expect(suckThePoisonOutRollOptions(learned().actor).tierActions.success).toContain("Store the malady in your pouch");
		expect(borrowPowerRollOptions(learned().actor).tierActions.partial).toContain("Lose the power");
		const off = blessed({ items: [moveItem(SUCK_THE_POISON_OUT, { learned: false }), moveItem(BORROW_POWER, { learned: false })] });
		expect(suckThePoisonOutRollOptions(off.actor)).toBeNull();
		expect(borrowPowerRollOptions(off.actor)).toBeNull();
		expect(MOVE_ROLL_OPTIONS.some(e => e.matches(SUCK_THE_POISON_OUT))).toBe(true);
		expect(MOVE_ROLL_OPTIONS.some(e => e.matches(BORROW_POWER))).toBe(true);
		expect(readRepo("stonetop.js")).toContain("wirePouchCards(message, html);");
	});

	/** A posted roll card at `total`, its flags real. */
	const card = total => {
		const flags = {};
		return {
			rolls: [{ total }],
			getFlag: (_s, k) => flags[k],
			setFlag: vi.fn(async (_s, k, v) => { flags[k] = v; }),
			unsetFlag: vi.fn(async (_s, k) => { delete flags[k]; }),
		};
	};
	const btn = tier => ({ dataset: { tier } });

	it("the 10+ store runs once, and only while the card reads 10+", async () => {
		const { actor } = learned();
		const store = vi.fn(async () => ({ id: "x" }));
		const hit = card(11);
		expect(await settlePouchStore(hit, actor, btn("success"), { store })).toBe(true);
		expect(store).toHaveBeenCalledWith(actor, POUCH_SLOT.MALADY, { moveName: SUCK_THE_POISON_OUT });
		expect(hit.getFlag(SCOPE, POUCH_STORED_FLAG)).toBe(true);
		expect(await settlePouchStore(hit, actor, btn("success"), { store })).toBe(false);

		const shifted = card(8);
		expect(await settlePouchStore(shifted, actor, btn("success"), { store })).toBe(false);
		expect(store).toHaveBeenCalledTimes(1);
	});

	it("a store backed out of gives the card back", async () => {
		const { actor } = learned();
		const hit = card(10);
		expect(await settlePouchStore(hit, actor, btn("success"), { store: async () => null })).toBe(false);
		expect(hit.getFlag(SCOPE, POUCH_STORED_FLAG)).toBeUndefined();
	});

	it("the 7-9 lose runs on a 7-9 card", async () => {
		const { actor } = learned();
		const lose = vi.fn(async () => ({ id: "p1" }));
		expect(await settlePowerLost(card(8), actor, btn("partial"), { lose })).toBe(true);
		expect(await settlePowerLost(card(11), actor, btn("partial"), { lose })).toBe(false);
		expect(lose).toHaveBeenCalledTimes(1);
	});

	it("the windows say what the buttons do, not 'mark it yourself'", async () => {
		const suck = GUIDED_CHARACTER_MOVES[SUCK_THE_POISON_OUT];
		const borrow = GUIDED_CHARACTER_MOVES[BORROW_POWER];
		for (const g of [suck, borrow]) {
			expect(g.note).not.toMatch(/yourself/);
			expect(g.note).toMatch(/space of 1 Stock/);
			expect(g.note).not.toContain(String.fromCharCode(0x2014));
		}
		expect(borrow.pouchStore).toEqual({ kind: "power", label: "Store the borrowed power" });

		// The Borrow Power window carries the store button for a LEARNED move.
		let opened = null;
		global.Dialog = class { constructor(c) { opened = c; } render() { return this; } };
		try {
			const sheetFor = built => {
				const Base = class {
					constructor() { this._actor = built.actor; }
					get actor() { return this._actor; }
					get isEditable() { return true; }
					activateListeners() {}
					render = vi.fn();
				};
				const sheet = new (createStonetopCharacterSheetClass(Base))();
				sheet._stonetopCharacter = built.char;
				return sheet;
			};
			await sheetFor(learned())._openGuidedCharacterMove({ name: BORROW_POWER, guide: borrow }, { dataset: { roll: "wis" } });
			expect(opened.buttons.pouchStore.label).toBe("Store the borrowed power");
			expect(Object.keys(opened.buttons).indexOf("pouchStore")).toBeLessThan(Object.keys(opened.buttons).indexOf("roll"));
			const off = blessed({ items: [moveItem(BORROW_POWER, { learned: false })] });
			await sheetFor(off)._openGuidedCharacterMove({ name: BORROW_POWER, guide: borrow }, { dataset: { roll: "wis" } });
			expect(opened.buttons.pouchStore).toBeUndefined();
		} finally {
			delete global.Dialog;
		}
	});
});

describe("9. pouch growth arrives EMPTY", () => {
	const bigMagicId = () => blessedMove("Big Magic")._id;

	it("level 1 to 2 keeps 3 Stock in a pouch of 4", async () => {
		const { char, actor } = blessed();
		await char.applyLevelUp(null, null, null);
		expect(actor.system.attributes.level.value).toBe(2);
		expect(await pouchOf(char)).toMatchObject({ max: 4, remaining: 3 });
	});

	it("an odd level adds nothing", async () => {
		const { char } = blessed({ level: 2, spent: 1 });
		await char.applyLevelUp(null, null, null);
		expect(await pouchOf(char)).toMatchObject({ max: 4, remaining: 3 });
	});

	// One settle around the whole level-up: the even level's +1 and Big Magic's +2, each counted once.
	it("Big Magic on an even level-up adds 3 empty spaces, once", async () => {
		const { char } = blessed({ level: 3, spent: 1 });
		await char.applyLevelUp(bigMagicId(), null, null);
		expect(await pouchOf(char)).toMatchObject({ max: 7, remaining: 3 });
	});

	it("removing Big Magic clamps the spent count to the smaller pouch", async () => {
		const { char, actor } = blessed({ level: 2 });
		await char.applyLevelUp(bigMagicId(), null, null);
		expect(await pouchOf(char)).toMatchObject({ max: 6, remaining: 4 });
		const bm = actor.items.find(i => i.name === "Big Magic");
		await char.removeMove(bm._id);
		expect(await pouchOf(char)).toMatchObject({ max: 4, remaining: 2 });
		expect(spentOf(actor)).toBe(2);
	});

	it("Big Magic dropped on from a compendium adds empty room", async () => {
		const { char, actor } = blessed();
		expect(await char.onDropMove(blessedMove("Big Magic"))).toBe(true);
		expect(actor.items.some(i => i.name === "Big Magic")).toBe(true);
		expect(await pouchOf(char)).toMatchObject({ max: 5, remaining: 3 });
	});

	it("un-learning Big Magic shrinks, re-learning adds empty room", async () => {
		const { char, actor } = blessed({ items: [moveItem("Big Magic")] });
		expect(await pouchOf(char)).toMatchObject({ max: 5, remaining: 5 });
		const bm = actor.items.find(i => i.name === "Big Magic");
		await char.setMoveLearned(bm._id, false);
		expect(await pouchOf(char)).toMatchObject({ max: 3, remaining: 3 });
		await char.setMoveLearned(bm._id, true);
		expect(await pouchOf(char)).toMatchObject({ max: 5, remaining: 3 });
	});

	// Two changes in flight at once share ONE settle, so neither one's growth is lost or counted twice.
	it("a move re-learned while a level-up is in flight settles both growths as empty room", async () => {
		const { char, actor } = blessed({ items: [moveItem("Big Magic", { learned: false })] });
		expect(await pouchOf(char)).toMatchObject({ max: 3, remaining: 3 });
		const bm = actor.items.find(i => i.name === "Big Magic");
		await Promise.all([char.applyLevelUp(null, null, null), char.setMoveLearned(bm._id, true)]);
		expect(await pouchOf(char)).toMatchObject({ max: 6, remaining: 3 });
		expect(char._pouchSettle).toBeNull();
	});

	// Onboarding adds its moves straight (addMove), never through a settle: a pouch at creation is full.
	it("a character made at any level starts with a full pouch", async () => {
		const { char } = blessed({ level: 6 });
		await char.addMove(bigMagicId());
		expect(await pouchOf(char)).toMatchObject({ max: 8, remaining: 8 });
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toContain("const added = await this._stonetopCharacter.addMove(compendiumId, { skipIfOwned: true });");
	});

	// The sheet's own two ways round the level-up: the level box typed over, and a move ticked on the
	// Moves tab. Both settle like a level-up does.
	const sheetOn = built => {
		const Base = class {
			constructor() { this._actor = built.actor; }
			get actor() { return this._actor; }
			get object() { return this._actor; }
			get isEditable() { return true; }
			activateListeners() {}
			async _updateObject(event, formData) { return this._actor.update(formData); }
			render = vi.fn();
		};
		const sheet = new (createStonetopCharacterSheetClass(Base))();
		sheet._stonetopCharacter = built.char;
		return sheet;
	};

	it("a level typed by hand grows the pouch with empty room", async () => {
		const built = blessed();
		await sheetOn(built)._updateObject(null, { "system.attributes.level.value": 2 });
		expect(built.actor.system.attributes.level.value).toBe(2);
		expect(await pouchOf(built.char)).toMatchObject({ max: 4, remaining: 3 });
	});

	it("a level typed lower clamps the spent count to the smaller pouch", async () => {
		const built = blessed({ level: 2, spent: 1 });
		await sheetOn(built)._updateObject(null, { "system.attributes.level.value": 1 });
		expect(await pouchOf(built.char)).toMatchObject({ max: 3, remaining: 2 });
		expect(spentOf(built.actor)).toBe(1);
	});

	it("a save that leaves the level alone settles nothing", async () => {
		const built = blessed({ level: 2 });
		const settle = vi.spyOn(built.char, "withPouchSettled");
		await sheetOn(built)._updateObject(null, { "system.attributes.level.value": 2, "name": "Wren" });
		await sheetOn(built)._updateObject(null, { "name": "Wren" });
		expect(settle).not.toHaveBeenCalled();
		expect(await pouchOf(built.char)).toMatchObject({ max: 4, remaining: 4 });
	});

	// The save the level check now wraps keeps its HP-ceiling branch: a capped HP still saves with
	// the option that tells the update hook the ceiling was already applied.
	it("a capped HP still saves through the ceiling branch", async () => {
		const built = blessed();
		built.actor.id ??= "wren";
		const sheet = sheetOn(built);
		sheet._hpCapped = true;
		await sheet._updateObject(null, { "system.attributes.hp.value": 18 });
		expect(sheet._hpCapped).toBe(false);
		const [data, options] = built.actor.update.mock.calls.at(-1);
		expect(data).toEqual({ "system.attributes.hp.value": 18 });
		expect(Object.values(options ?? {})).toContain(true);
	});

	it("Big Magic ticked on the Moves tab adds empty room", async () => {
		const built = blessed();
		const sheet = sheetOn(built);
		sheet._maybePromptStatIncrease = vi.fn();
		sheet._maybePromptForeignMove = vi.fn();
		sheet._maybeOpenPossessionChoicesForMove = vi.fn();
		sheet._maybeOpenCompanionTraitsForMove = vi.fn();
		await sheet._onMoveCheck({ currentTarget: { checked: true, dataset: { compendiumId: bigMagicId(), moveName: "Big Magic" } } });
		expect(built.actor.items.some(i => i.name === "Big Magic")).toBe(true);
		expect(await pouchOf(built.char)).toMatchObject({ max: 5, remaining: 3 });
	});

	it("the level-up overview says the new room is empty, at an even level", async () => {
		const odd = await blessed({ level: 2 }).char.getLevelUpData();
		expect(odd.pouchGrowth).toBe(0);
		const data = await blessed({ level: 1 }).char.getLevelUpData();
		expect(data.pouchGrowth).toBe(1);
		const dlg = new LevelUpDialog({}, { ...data, availableMoves: [], lockedMoves: [], availableInvocations: [], stats: [] }, vi.fn());
		dlg._step = "overview";
		expect(dlg.getData().pouchGrowthNote).toBe("Your sacred pouch can hold +1 Stock (the new space is empty: replenish with downtime or Forage).");
		expect(readRepo("templates/dialogs/level-up.hbs")).toContain("{{#if pouchGrowthNote}}");
		const fox = await buildLiveCharacter({ slug: "the-fox", name: "The Fox", level: 1 }).char.getLevelUpData();
		expect(fox.pouchGrowth).toBe(0);
	});
});

describe("10. Replenish (downtime)", () => {
	it("refills to the usable max after a confirm quoting the book", async () => {
		const { actor, char } = blessed({ level: 2, spent: 3, slots: [slot("m1", "malady", "Rot")] });
		const confirm = vi.fn(async () => true);
		const post = vi.fn();
		expect(await replenishPouch(actor, { confirm, post })).toBe(true);
		expect(confirm.mock.calls[0][0].content).toContain("a few days of downtime in familiar terrain");
		expect(confirm.mock.calls[0][0].content).toContain("from 0 to 3 Stock");
		expect(await pouchOf(char)).toMatchObject({ max: 3, remaining: 3 });
		expect(char.pouchSlots).toHaveLength(1);
		expect(post).toHaveBeenCalledTimes(1);
	});

	it("writes nothing when declined, full, or not the owner", async () => {
		const declined = blessed({ spent: 2 });
		expect(await replenishPouch(declined.actor, { confirm: async () => false, post: vi.fn() })).toBe(false);
		expect(spentOf(declined.actor)).toBe(2);

		const confirm = vi.fn(async () => true);
		expect(await replenishPouch(blessed().actor, { confirm, post: vi.fn() })).toBe(false);
		expect(confirm).not.toHaveBeenCalled();

		const stranger = blessed({ spent: 2 });
		stranger.actor.isOwner = false;
		expect(await replenishPouch(stranger.actor, { confirm, post: vi.fn() })).toBe(false);
		expect(spentOf(stranger.actor)).toBe(2);
	});
});
