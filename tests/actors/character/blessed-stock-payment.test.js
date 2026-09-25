// Paying the Blessed's Stock, end to end on a live character: the Vessel's "lose 2d4 HP instead",
// the pouch read live (its real max, and held when it is only preselected), learned-only Big Magic
// and Rites of the Land, the hotbar's Spend button, and the "no pouch" note on foreign-move pickers.

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { createStonetopCharacterSheetClass, GUIDED_CHARACTER_MOVES } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { LevelUpDialog } from "../../../module/actors/character/dialogs/LevelUpDialog.js";
import { NO_POUCH_STOCK_NOTE, stockCostFromDescription, stockSources } from "../../../module/actors/character/stock-cost.js";
import { restockPouch } from "../../../module/actors/character/provisions.js";
import { readRepo } from "../../fakes/css.js";

const POUCH = "sacred-pouch";
const RITES = "Rites of the Land";
const blessedMove = name => sourceMovesFor("The Blessed").find(d => d.name === name);
const moveItem = (name, { learned = true } = {}) => makeLiveItem({
	name, type: "move", system: structuredClone(blessedMove(name).system),
	flags: learned ? {} : { "stonetop-pwd": { learned: false } },
});

/** A Blessed, optionally a Vessel, with `spent` Stock gone from the pouch. */
function blessed({ level = 1, vessel = false, spent = 0, items = [], hp = 8 } = {}) {
	const flags = {};
	if (vessel) flags["background.selected"] = "vessel";
	if (spent) flags["possessions.uses"] = { [POUCH]: spent };
	const built = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", level, items, flags });
	built.actor.system.attributes.hp = { value: hp, max: hp };
	return built;
}

/** A die that always lands on `total`, capturing what reached chat. */
function loadedDie(total) {
	const posted = [];
	globalThis.Roll = class {
		constructor(formula) { this.formula = formula; this.total = total; this.dice = []; }
		evaluate() { return Promise.resolve(this); }
		toMessage(data) { posted.push({ formula: this.formula, ...data }); return Promise.resolve(data); }
	};
	globalThis.ChatMessage = { getSpeaker: ({ actor } = {}) => ({ alias: actor?.name ?? "" }), create: vi.fn(async d => d) };
	return posted;
}

/** The character sheet around a live character, with the one Dialog it opens captured. */
let opened = null;
function sheetFor({ char, actor }) {
	actor.typedActor = char;
	actor.isOwner = true;
	actor.items.get = id => actor.items.find(i => i.id === id);
	global.Dialog = class { constructor(config) { opened = config; } render() { return this; } };
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		activateListeners() {}
		render = vi.fn();
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	sheet._stonetopCharacter = char;
	return sheet;
}

/** A detached stand-in for a move row's `.rollable`, as the dialog reads it. */
const rollableFor = stat => ({ dataset: { roll: stat } });
/** What a dialog button's callback reads the "Spend from" choice off. */
const pickedPurse = key => [{ querySelector: sel => (sel.includes("stockCostSource") ? { value: key } : null) }];

beforeEach(() => {
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
});
afterEach(() => {
	delete globalThis.Roll; delete globalThis.ChatMessage; delete global.Dialog; delete globalThis.ui;
	opened = null;
});

describe("the Vessel: 2d4 HP in place of 1 Stock", () => {
	it("is read off the Blessed's background", () => {
		expect(blessed({ vessel: true }).char.isVessel).toBe(true);
		expect(blessed().char.isVessel).toBe(false);
	});

	// The user's ruling: offered even with an empty pouch, so a Vessel is never locked out.
	it("keeps a purse when the pouch is empty", async () => {
		const sources = await blessed({ vessel: true, spent: 3 }).char.stockSources();
		expect(sources.map(s => [s.key, s.remaining])).toEqual([["stock", 0], ["hp", Infinity]]);
		expect(await blessed({ spent: 3 }).char.stockSources()).toHaveLength(1);
	});

	// HP LOST, not damage: no armor applies, the dice are seen, and the ledger names the move.
	it("pays by throwing 2d4 where the table sees it and losing that much HP", async () => {
		const { char, actor } = blessed({ vessel: true, spent: 3, hp: 8 });
		actor.system.attributes.armor = { value: 2 };
		const posted = loadedDie(5);
		const hp = (await char.stockSources()).find(s => s.vessel);

		expect(await char.spendStock(hp, 1, { moveName: "Call the Spirits" })).toEqual({ lost: 5 });
		expect(actor.system.attributes.hp.value).toBe(3);
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 3 }, { stonetopMove: "Call the Spirits" });
		expect(posted).toHaveLength(1);
		expect(posted[0].formula).toBe("2d4");
		expect(posted[0].flavor).toContain("HP lost");
		expect(posted[0].flavor).toContain("in place of 1 Stock");
		// The pouch was not touched.
		expect(actor.getFlag("stonetop-pwd", "possessions.uses")[POUCH]).toBe(3);
	});

	// Danu's Grasp charges before it rolls, and its Roll button was simply not built for an
	// empty pouch. A Vessel gets it, with the HP named in the "Spend from" picker.
	it("unlocks the gated roll, and names the trade in the picker", async () => {
		const sheet = sheetFor(blessed({ vessel: true, spent: 3 }));
		await sheet._openGuidedCharacterMove({ name: "Danu's Grasp", guide: GUIDED_CHARACTER_MOVES["Danu's Grasp"] }, rollableFor("wis"));
		expect(opened.buttons.roll).toBeTruthy();
		expect(opened.content).toContain('name="stockCostSource"');
		expect(opened.content).toContain('<option value="hp">Lose 2d4 HP instead</option>');
		expect(opened.content).toContain("or lose <strong>2d4</strong> HP (Vessel)");
	});

	it("leaves a Blessed who is not a Vessel refused, as before", async () => {
		const sheet = sheetFor(blessed({ spent: 3 }));
		await sheet._openGuidedCharacterMove({ name: "Danu's Grasp", guide: GUIDED_CHARACTER_MOVES["Danu's Grasp"] }, rollableFor("wis"));
		expect(opened.buttons.roll).toBeUndefined();
	});

	// "may choose": the pouch is where the picker starts, and the HP is only taken when picked.
	it("offers the pouch first while it has Stock, and spends HP only when picked", async () => {
		const built = blessed({ vessel: true, spent: 1, hp: 8 });
		const sheet = sheetFor(built);
		await sheet._openGuidedCharacterMove({ name: "Danu's Grasp", guide: GUIDED_CHARACTER_MOVES["Danu's Grasp"] }, rollableFor("wis"));
		expect(opened.content.indexOf('value="stock"')).toBeLessThan(opened.content.indexOf('value="hp"'));

		loadedDie(4);
		const paid = await sheet._spendStockCost({ amount: 1, label: "Stock" }, pickedPurse("hp"), "Danu's Grasp");
		expect(paid).toMatchObject({ key: "hp", lost: 4 });
		expect(built.actor.system.attributes.hp.value).toBe(4);
		expect(built.actor.getFlag("stonetop-pwd", "possessions.uses")[POUCH]).toBe(1);

		// With no pick, the pouch pays and no HP is lost.
		const stock = await sheet._spendStockCost({ amount: 1, label: "Stock" }, null, "Danu's Grasp");
		expect(stock.key).toBe("stock");
		expect(built.actor.getFlag("stonetop-pwd", "possessions.uses")[POUCH]).toBe(2);
		expect(built.actor.system.attributes.hp.value).toBe(4);
	});
});

// The sheet's dialog used the render snapshot's pouch max, which only exists once the sheet has
// drawn. After a reload, a Stock move opened from the hotbar priced a level-6 pouch at 3.
describe("the pouch's max, read live", () => {
	it("prices a raised pouch correctly with no render behind it", async () => {
		const built = blessed({ level: 6, spent: 3 });
		const view = await sheetFor(built)._stockCostView({ amount: 1 });
		expect(view.sources[0]).toMatchObject({ key: "stock", max: 6, remaining: 3 });
		expect(view.affordable).toBe(true);
	});
});

// The Blessed's pouch is PRESELECTED. One never written to `possessions.selected` still counts,
// as it does on the gear tab and for Forage.
describe("a preselected pouch", () => {
	it("is a purse even when `possessions.selected` never named it", async () => {
		const { char, actor } = blessed();
		expect(actor.getFlag("stonetop-pwd", "possessions.selected")).toBeNull();
		expect((await char.stockSources()).map(s => s.key)).toEqual(["stock"]);
	});
});

// A move un-learned is kept on the sheet switched off. It must stop counting for the rules.
describe("un-learned Big Magic and Rites of the Land", () => {
	it("an un-learned Big Magic does not grow the pouch or the trait cap", async () => {
		const off = blessed({ items: [moveItem("Big Magic", { learned: false })] }).char;
		expect(await off.sacredPouchMax()).toBe(3);
		expect(off.ownedMoveCounts()["Big Magic"]).toBe(0);

		const on = blessed({ items: [moveItem("Big Magic")] }).char;
		expect(await on.sacredPouchMax()).toBe(5);
		expect(on.ownedMoveCounts()["Big Magic"]).toBe(1);
	});

	it("an un-learned Rites of the Land offers no Boon", async () => {
		const off = blessed({ items: [moveItem(RITES, { learned: false })] });
		expect((await off.char.stockSources()).map(s => s.key)).toEqual(["stock"]);
		expect(off.char.ritesBoonMax()).toBe(0);

		const on = blessed({ items: [moveItem(RITES)] });
		expect((await on.char.stockSources()).map(s => s.key)).toEqual(["stock", "boon"]);
		expect(on.char.ritesBoonMax()).toBeGreaterThan(0);
	});

	it("the sheet and the chat read the Boon off a LEARNED Rites only", () => {
		const character = readRepo("module/actors/character/StonetopCharacter.js");
		expect(character).toContain("ritesMax:      this.ritesBoonMax()");
		expect(character).toContain("Number(ownedLearnedMove(this._actor, RITES_OF_THE_LAND)?.system?.resource?.max)");
		expect(readRepo("stonetop.js")).not.toContain("ownedMove(actor, RITES_OF_THE_LAND)");
	});
});

// A Stock move made from the hotbar or the fight ring arrives at rollMoveById, whose card had no
// Spend button: the one surface a Blessed could make Call the Spirits from without paying.
describe("the hotbar's card carries the Spend button", () => {
	it("posts a Stock move through item.roll with the Spend button on it", async () => {
		const built = blessed();
		const sheet = sheetFor(built);
		const call = built.actor.items.find(i => i.name === "Call the Spirits");
		call.roll = vi.fn(async () => "posted");
		sheet._onDescriptionMoveUsed = vi.fn();

		expect(await sheet.rollMoveById(call.id)).toBe("posted");
		expect(call.roll.mock.calls[0][0].actions).toContain('class="stonetop-spend-stock"');
		expect(sheet._onDescriptionMoveUsed).toHaveBeenCalledWith(call);
	});

	it("adds nothing to a move that costs no Stock", async () => {
		const built = blessed();
		const sheet = sheetFor(built);
		const tongue = built.actor.items.find(i => i.name === "Spirit Tongue");
		tongue.roll = vi.fn(async () => "posted");
		await sheet.rollMoveById(tongue.id);
		expect(tongue.roll.mock.calls[0][0].actions).toBe("");
	});
});

// The Forage prompt worked the pouch out as `max - spent`, unclamped: after Big Magic went, a pouch
// stored as 5 spent of a now-3 max read "holds -2 of 3 Stock".
describe("Forage's pouch readout", () => {
	it("reads the pouch through the one clamped Stock reader", () => {
		expect(restockPouch(5, 0, 3)).toEqual({ spent: 3, restocked: 0, held: 0 });
		expect(stockSources({ pouchMax: 3, pouchStored: 5 })[0]).toMatchObject({ stored: 3, remaining: 0 });
		const src = readRepo("stonetop.js");
		const fn = src.slice(src.indexOf("async function _forageIntoPouch"));
		expect(fn.slice(0, 1400)).toContain("stockSources?.()");
		expect(fn.slice(0, 1400)).toContain("holds ${pouch.remaining} of ${pouchMax} Stock");
		expect(fn.slice(0, 1400)).not.toContain("pouchMax - spent");
	});
});

// Borrow Power: "Store it in your pouch in place of 1 Stock."
describe("Borrow Power's reminder", () => {
	it("says the borrowed power takes a Stock's space, without gating the roll", () => {
		const guide = GUIDED_CHARACTER_MOVES["Borrow Power"];
		expect(guide.note).toMatch(/space of 1 Stock/);
		expect(guide.note).not.toContain(String.fromCharCode(0x2014));
		expect(guide.cost).toBeUndefined();
		expect(guide.roll).toBe("wis");
	});
});

// A cross-playbook pick of a Stock move, for someone with no pouch: said, never filtered.
describe("the no-pouch note on foreign-move pickers", () => {
	const ranger = () => buildLiveCharacter({ slug: "the-ranger", name: "The Ranger", level: 6 }).char;

	it("marks exactly the Stock moves, and keeps them on offer", async () => {
		const foreign = await ranger().getForeignMovesForLevelUp({ playbooks: ["The Blessed"] }, 6);
		const stock = foreign.filter(m => stockCostFromDescription(m.description));
		expect(stock.length).toBeGreaterThan(0);
		for (const m of foreign) {
			expect(m.stockNote, m.name).toBe(stockCostFromDescription(m.description) ? NO_POUCH_STOCK_NOTE : null);
		}
	});

	// Initiate of the Secret Arts brings its own pouch in the same step.
	it("is not shown for a pick that grants the pouch", async () => {
		const foreign = await ranger().getForeignMovesForLevelUp({ playbooks: ["The Blessed"], grantsPossession: POUCH }, 6);
		expect(foreign.every(m => m.stockNote === null)).toBe(true);
	});

	it("is not shown to someone who carries a pouch", async () => {
		const { char } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker", level: 6,
			flags: { "possessions.selected": [POUCH] } });
		const foreign = await char.getForeignMovesForLevelUp({ playbooks: ["The Blessed"] }, 6);
		expect(foreign.every(m => m.stockNote === null)).toBe(true);
	});

	it("reaches the level-up card and the Moves tab's picker", () => {
		const dlg = new LevelUpDialog({ getForeignMovesForLevelUp: vi.fn() }, {
			level: 5, newLevel: 6, cost: 16, xpRemaining: 0, playbookName: "The Ranger", needsInvocation: false,
			availableMoves: [{ compendiumId: "w1", name: "Wild Soul", cap: null, crossPlaybook: { playbooks: ["The Blessed"] } }],
			lockedMoves: [], availableInvocations: [], stats: [],
		}, vi.fn());
		dlg._selectedMoveId = "w1";
		dlg._step = "foreignMove";
		dlg._foreignMoves = [{ compendiumId: "f1", name: "Call the Spirits", playbook: "The Blessed", stockNote: NO_POUCH_STOCK_NOTE }];
		expect(dlg.getData().foreignMoves[0].stockNote).toBe(NO_POUCH_STOCK_NOTE);
		const template = fs.readFileSync(path.join(process.cwd(), "templates", "dialogs", "level-up.hbs"), "utf8");
		expect(template).toContain("{{#if stockNote}}<p class=\"stonetop-levelup-move-note\">{{stockNote}}</p>{{/if}}");
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		const picker = sheet.slice(sheet.indexOf("async _maybePromptForeignMove(addedItem) {"));
		expect(picker.slice(0, 3000)).toContain("m.stockNote");
	});
});
