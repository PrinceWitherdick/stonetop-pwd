import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../module/utils/roll-engine.js", async importOriginal => ({
	...(await importOriginal()),
	rollStat: vi.fn(async () => ({ total: 7 })),
}));

const { rollStat } = await import("../../../module/utils/roll-engine.js");
const { StonetopSteading } = await import("../../../module/actors/steading/StonetopSteading.js");
const { createStonetopSteadingSheetClass } = await import("../../../module/actors/steading/StonetopSteadingSheet.js");
const {
	payFortunesCost, giveBackFortunes, withMusterCostActions, settleRequisitionMiss, takeRequisitionedAsset,
	requisitionMissCostAction, requisitionTakeAction, assetFromButton, STEADING_FORTUNES_CARD_ACTIONS,
	MUSTER_PAY_COST_ACTION, MUSTER_PITCH_IN_ACTION, PULL_TOGETHER_COST_ACTION,
} = await import("../../../module/actors/steading/steading-card-actions.js");
const { openReturnTriumphant } = await import("../../../module/actors/steading/return-triumphant.js");

// The steading moves' Fortunes costs and give-backs, the asset takes behind Requisition's card, and
// the Muster's +1 Defenses: each against Book I as the 2026-10-08 audit (STD-1..13) read it.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");
const SHEET_JS = read("module/actors/steading/StonetopSteadingSheet.js");
const STONETOP_JS = read("stonetop.js");

function setPath(obj, dotted, value) {
	const keys = dotted.split(".");
	let at = obj;
	for (const key of keys.slice(0, -1)) at = (at[key] ??= {});
	at[keys.at(-1)] = value;
}

/** A steading actor whose writes land where its reads look, flags in the live scope. */
function fakeSteadingActor({ steading = {}, system = {}, isOwner = true, season = null } = {}) {
	const actor = {
		id: "st1", name: "Stonetop", type: "stonetop", isOwner, system,
		flags: { "stonetop-pwd": { steading, ...(season ? { seasonsCurrent: season } : {}) } },
		getFlag: (scope, key) => actor.flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { actor.flags[scope] ??= {}; actor.flags[scope][key] = value; }),
		update: vi.fn(async data => { for (const [k, v] of Object.entries(data)) setPath(actor, k, v); }),
	};
	return actor;
}

const fortunesOf = actor => actor.flags["stonetop-pwd"].steading.system?.stats?.fortunes?.value
	?? actor.system?.stats?.fortunes?.value;
const lastUpdateOptions = actor => actor.update.mock.calls.at(-1)?.[1] ?? {};

let dialogs;
beforeEach(() => {
	dialogs = [];
	globalThis.Dialog = class { constructor(data) { this.data = data; dialogs.push(this); } render() { return this; } };
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
	rollStat.mockClear();
});
afterEach(() => {
	delete globalThis.Dialog;
	vi.unstubAllGlobals();
});

describe("STD-1: every 'reduce Fortunes by 1' goes through Meet with Disaster", () => {
	it("takes 1 Fortunes above -1, naming the move", async () => {
		const actor = fakeSteadingActor({ system: { stats: { fortunes: { value: 0 } } } });
		const out = await payFortunesCost(new StonetopSteading(actor), { stonetopMove: "Muster" });
		expect(out).toMatchObject({ fortunes: -1, disaster: false });
		expect(fortunesOf(actor)).toBe(-1);
		expect(lastUpdateOptions(actor)).toEqual({ stonetopMove: "Muster" });
	});

	// p.532: "When Fortunes would drop below -1 for any reason ... the GM picks 1 instead".
	it("at -1 writes no Fortunes, owes the GM's pick and opens it", async () => {
		const actor = fakeSteadingActor({ system: { stats: { fortunes: { value: -1 } } } });
		const out = await payFortunesCost(new StonetopSteading(actor), { stonetopMove: "Requisition", cause: "a Requisition taken on a miss" });
		expect(out.disaster).toBe(true);
		expect(out.notice).toMatch(/Meets with Disaster/);
		expect(fortunesOf(actor)).toBe(-1);
		expect(actor.flags["stonetop-pwd"].steading.disasterOwed).toEqual({ cause: "a Requisition taken on a miss" });
		expect(lastUpdateOptions(actor)).toEqual({ stonetopMove: "Requisition" });
		expect(dialogs.at(-1)?.data.title).toBe("Meet with Disaster");
	});

	it("leaves no Math.max floor on any Fortunes cost in the card wiring", () => {
		const at = STONETOP_JS.indexOf("function _chatWireRequisitionMissCost");
		expect(STONETOP_JS.slice(at, at + 1600)).not.toContain("Math.max(");
		expect(STONETOP_JS).toContain("_chatWireSteadingFortunes(message, html);");
		expect(SHEET_JS).not.toMatch(/stats\.fortunes\.value", Math\.max\(fortunes - 1, -1\)/);
	});
});

describe("STD-5 and STD-12: the Fortunes buttons a card carries", () => {
	it("gives the Muster's Fortunes back, never past +3", async () => {
		const actor = fakeSteadingActor({ system: { stats: { fortunes: { value: 0 } } } });
		expect(await giveBackFortunes(new StonetopSteading(actor), { stonetopMove: "Muster" })).toMatchObject({ given: 1, fortunes: 1 });
		expect(lastUpdateOptions(actor)).toEqual({ stonetopMove: "Muster" });
		const full = fakeSteadingActor({ system: { stats: { fortunes: { value: 3 } } } });
		expect(await giveBackFortunes(new StonetopSteading(full), { stonetopMove: "Muster" })).toMatchObject({ given: 0, fortunes: 3 });
		expect(full.update).not.toHaveBeenCalled();
	});

	it("puts the pitch-in give-back on a paid Muster's 7+ and the cost on every tier of an owed one", () => {
		const raise = { success: "<raise>", partial: "<raise>" };
		const paid = withMusterCostActions(raise, "paid");
		expect(paid.success).toBe(`${MUSTER_PITCH_IN_ACTION}<raise>`);
		expect(paid.partial).toBe(`${MUSTER_PITCH_IN_ACTION}<raise>`);
		expect(paid.failure).toBeUndefined();
		const owed = withMusterCostActions(raise, "owed");
		for (const tier of ["success", "partial", "failure"]) expect(owed[tier]).toContain(MUSTER_PAY_COST_ACTION);
		expect(withMusterCostActions(raise, undefined)).toBe(raise);
	});

	it("pays Pull Together's 7-9 Fortunes from its card, through the same floor", async () => {
		const flow = SHEET_JS.slice(SHEET_JS.indexOf("\tpullTogether: {"), SHEET_JS.indexOf("\tmuster: {"));
		expect(flow).toContain("partial: PULL_TOGETHER_COST_ACTION");
		expect(flow).not.toContain("failure: PULL_TOGETHER_COST_ACTION");
		const action = STEADING_FORTUNES_CARD_ACTIONS.find(a => PULL_TOGETHER_COST_ACTION.includes(a.selector.slice(1)));
		const actor = fakeSteadingActor({ system: { stats: { fortunes: { value: 1 } } } });
		await action.run(new StonetopSteading(actor));
		expect(fortunesOf(actor)).toBe(0);
		expect(lastUpdateOptions(actor)).toEqual({ stonetopMove: "Pull Together" });
		// Each button latches on a flag of its own.
		expect(new Set(STEADING_FORTUNES_CARD_ACTIONS.map(a => a.flag)).size).toBe(STEADING_FORTUNES_CARD_ACTIONS.length);
	});
});

describe("STD-6: the Muster's cost before the roll", () => {
	function sheetOn(actor) {
		actor.typedActor = new StonetopSteading(actor);
		const Base = class {
			constructor() { this._actor = actor; }
			get actor() { return this._actor; }
			get isEditable() { return true; }
			render() {}
		};
		return new (createStonetopSteadingSheetClass(Base))();
	}
	const muster = { beforeRoll: "musterCost" };

	it("is paid by an owner above -1, naming the Muster", async () => {
		const actor = fakeSteadingActor({ system: { stats: { fortunes: { value: 1 } } } });
		expect(await sheetOn(actor)._applyHomesteadBeforeRoll(muster)).toEqual({ musterCost: "paid" });
		expect(fortunesOf(actor)).toBe(0);
		expect(lastUpdateOptions(actor)).toEqual({ stonetopMove: "Muster" });
	});

	it("is left to the card, unwritten, for a player who cannot write the steading", async () => {
		const actor = fakeSteadingActor({ system: { stats: { fortunes: { value: 1 } } }, isOwner: false });
		expect(await sheetOn(actor)._applyHomesteadBeforeRoll(muster)).toEqual({ musterCost: "owed" });
		expect(actor.update).not.toHaveBeenCalled();
	});

	// p.532: at -1, Mustering "is going to trigger Meet With Disaster unless they pick 'everyone's
	// willing to pitch in'", which only the dice can say.
	it("is left to the card at -1, where a 7+ pitching in avoids the disaster", async () => {
		const actor = fakeSteadingActor({ system: { stats: { fortunes: { value: -1 } } } });
		expect(await sheetOn(actor)._applyHomesteadBeforeRoll(muster)).toEqual({ musterCost: "owed" });
		expect(actor.update).not.toHaveBeenCalled();
		expect(dialogs).toHaveLength(0);
	});

	it("puts the owed cost on the Muster's card and keeps it out of the roll's options", async () => {
		const actor = fakeSteadingActor({ system: { stats: { fortunes: { value: -1 } } } });
		actor.typedActor = Object.assign(new StonetopSteading(actor), { improvementRules: () => [] });
		await sheetOn(actor)._onSteadingRoll("Muster", "population", { musterCost: "owed" });
		const options = rollStat.mock.calls.at(-1)[2];
		expect(options.musterCost).toBeUndefined();
		expect(options.tierActions.failure).toContain("stonetop-muster-pay-cost");
		expect(options.tierActions.success).toContain("stonetop-muster-raise");
	});
});

describe("STD-2: Requisition's 6- take", () => {
	it("marks the asset the card names out along with the cost", async () => {
		const actor = fakeSteadingActor({
			system: { stats: { fortunes: { value: 1 } } },
			steading: { assets: [{ name: "A wagon", checked: true }] },
		});
		const steading = new StonetopSteading(actor);
		const btn = { dataset: { assetIndex: "0", assetName: "A wagon" } };
		const out = await settleRequisitionMiss(steading, { asset: assetFromButton(btn), takenBy: { name: "Wren" } });
		expect(out.marked).toBe(true);
		expect(fortunesOf(actor)).toBe(0);
		expect(actor.flags["stonetop-pwd"].steading.assets[0]).toMatchObject({ checked: false, takenBy: { name: "Wren" } });
	});

	it("draws the steading window's take on its 10+/7-9 and the cost on its 6-", () => {
		const take = requisitionTakeAction({ index: 2, name: "A wagon" });
		expect(take).toContain(`data-asset-index="2"`);
		expect(requisitionTakeAction({})).toBe("");
		expect(requisitionMissCostAction()).not.toContain("data-asset-index");
		expect(requisitionMissCostAction()).toContain("reduce Fortunes by 1");
		const walk = SHEET_JS.slice(SHEET_JS.indexOf("async _onRequisitionWalkthrough()"));
		expect(walk.slice(0, 6000)).toContain("success: requisitionTakeAction(taken)");
		expect(walk.slice(0, 6000)).toContain("failure: requisitionMissCostAction(taken)");
	});

	it("will not take an asset that went out meanwhile", async () => {
		const actor = fakeSteadingActor({ steading: { assets: [{ name: "A wagon", checked: false, takenBy: { name: "Ash" } }] } });
		const out = await takeRequisitionedAsset(new StonetopSteading(actor), { asset: { index: 0, name: "A wagon" }, takenBy: { name: "Wren" } });
		expect(out.abort).toBe(true);
		expect(actor.flags["stonetop-pwd"].steading.assets[0].takenBy).toEqual({ name: "Ash" });
	});

	it("gives the expedition walkthrough's Requisition the same 6- button, spoken for the steading", () => {
		const exp = read("module/dialogs/ExpeditionDialog.js");
		const at = exp.indexOf("async _rollRequisitionOnce()");
		expect(exp.slice(at, at + 2000)).toContain("tierActions: { failure: requisitionMissCostAction() }");
		expect(exp.slice(at, at + 2000)).toContain("actor: found?.actor ?? null");
	});
});

describe("STD-4 and STD-9: the Muster's +1 Defenses", () => {
	const spring = { season: "spring", year: 1 };

	it("adds nothing at +3, and records that it added nothing", async () => {
		const actor = fakeSteadingActor({ system: { stats: { defenses: { value: 3 } } }, season: spring });
		const steading = new StonetopSteading(actor);
		expect(await steading.raiseMuster({ defenses: true })).toEqual({ defenses: false, capped: true });
		expect(actor.flags["stonetop-pwd"].steading.musterHold.defenses).toBe(false);
		expect(steading.getStatValue("defenses")).toBe(3);
		await steading.standDownMuster();
		expect(steading.getStatValue("defenses")).toBe(3);
	});

	it("never stacks a second +1, and gives the first back when a second muster does not take it", async () => {
		const actor = fakeSteadingActor({ system: { stats: { defenses: { value: 0 } } }, season: spring });
		const steading = new StonetopSteading(actor);
		await steading.raiseMuster({ defenses: true });
		expect(steading.getStatValue("defenses")).toBe(1);
		await steading.raiseMuster({ defenses: true });
		expect(steading.getStatValue("defenses")).toBe(1);
		await steading.raiseMuster({ defenses: false });
		expect(steading.getStatValue("defenses")).toBe(0);
		expect(actor.flags["stonetop-pwd"].steading.musterHold.defenses).toBe(false);
		await steading.standDownMuster();
		expect(steading.getStatValue("defenses")).toBe(0);
	});

	it("keeps a muster holding a +1 on show after its season, so it can still be stood down", () => {
		const held = { year: 1, season: "winter", defenses: true };
		const actor = fakeSteadingActor({ steading: { musterHold: held }, season: spring });
		expect(new StonetopSteading(actor).musterHold()).toEqual(held);
		const plain = fakeSteadingActor({ steading: { musterHold: { ...held, defenses: false } }, season: spring });
		expect(new StonetopSteading(plain).musterHold()).toBeNull();
		// Raised before the clock was ever set: shown while the clock is still unset.
		const unset = fakeSteadingActor({ steading: { musterHold: { year: 1, season: "", defenses: false } } });
		expect(new StonetopSteading(unset).musterHold()).toMatchObject({ season: "" });
	});

	// p.508: Fortunes "can range from -1 to +3".
	it("lets Return Triumphant raise Fortunes no higher than +3", async () => {
		const actor = fakeSteadingActor({ system: { stats: { fortunes: { value: 3 } } } });
		openReturnTriumphant(new StonetopSteading(actor));
		expect(dialogs).toHaveLength(0);
		expect(actor.update).not.toHaveBeenCalled();
		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith(expect.stringMatching(/already \+3/));
		const room = fakeSteadingActor({ system: { stats: { fortunes: { value: 2 } } } });
		openReturnTriumphant(new StonetopSteading(room));
		expect(dialogs.at(-1).data.content).toContain("+3");
	});
});

describe("STD-10: asset writes in the steading's turn", () => {
	it("lands only one of two takes of the same asset", async () => {
		const actor = fakeSteadingActor({ steading: { assets: [{ name: "A wagon", checked: true }] } });
		const a = new StonetopSteading(actor);
		const b = new StonetopSteading(actor);
		const [one, two] = await Promise.all([
			a.setAssetTaken(0, { name: "Wren" }, { name: "A wagon" }),
			b.setAssetTaken(0, { name: "Ash" }, { name: "A wagon" }),
		]);
		expect([one, two].filter(Boolean)).toHaveLength(1);
		expect(actor.flags["stonetop-pwd"].steading.assets[0].takenBy).toEqual({ name: "Wren" });
	});

	it("refuses a row that no longer carries the asset the caller meant", async () => {
		const actor = fakeSteadingActor({ steading: { assets: [{ name: "A cart", checked: true }] } });
		expect(await new StonetopSteading(actor).setAssetTaken(0, { name: "Wren" }, { name: "A wagon" })).toBe(false);
		expect(actor.flags["stonetop-pwd"].steading.assets[0].takenBy).toBeUndefined();
	});
});

describe("STD-7: the steading's Persuade is a reference card", () => {
	it("rolls nothing, opens nothing and has no flow", () => {
		const at = SHEET_JS.indexOf(`slug: "persuade"`);
		const entry = SHEET_JS.slice(at, at + 900);
		expect(entry).toContain("rollable: false");
		expect(entry).toContain("interactive: false");
		expect(entry).toContain("reference: true");
		expect(entry).toContain("roll +CHA");
		const flows = SHEET_JS.slice(SHEET_JS.indexOf("const HOMESTEAD_MOVE_FLOWS = {"), SHEET_JS.indexOf("const STEADING_EDIT_SECTIONS"));
		expect(flows).not.toContain("persuade: {");
		expect(SHEET_JS).toContain("unowned: !move.rollable && !move.interactive && !move.reference");
	});
});

describe("STD-8: Trade & Barter hands the item over from the card", () => {
	it("no longer adds the picked item to anyone before the roll", () => {
		const at = SHEET_JS.indexOf("_onPickSpecialItem(dialogHtml) {");
		const body = SHEET_JS.slice(at, at + 1400);
		expect(body).not.toContain("addSpecial");
		expect(body).toContain(`'[name="specialItem"]'`);
	});

	it("puts the hand-over on the 10+ and 7-9 only", async () => {
		const actor = fakeSteadingActor({ system: { attributes: { prosperity: { value: 0 } } } });
		actor.typedActor = Object.assign(new StonetopSteading(actor), { improvementRules: () => [] });
		const Base = class {
			constructor() { this._actor = actor; }
			get actor() { return this._actor; }
			render() {}
		};
		await new (createStonetopSteadingSheetClass(Base))()._onSteadingRoll("Trade & Barter", "prosperity", { tradeItem: "sword" });
		const { tierActions, tradeItem } = rollStat.mock.calls.at(-1)[2];
		expect(tradeItem).toBeUndefined();
		expect(tierActions.success).toContain(`data-item-slug="sword"`);
		expect(tierActions.partial).toContain(`data-item-slug="sword"`);
		expect(tierActions?.failure ?? "").not.toContain("stonetop-trade-item");
	});
});

describe("STD-8: the hand-over itself", () => {
	const character = (id, added = []) => {
		const actor = {
			id, name: id, type: "character", isOwner: true,
			flags: { "stonetop-pwd": { "inventory.addedSpecial": added } },
			getFlag: (scope, key) => actor.flags[scope]?.[key],
			setFlag: vi.fn(async (scope, key, value) => { actor.flags[scope][key] = value; }),
			update: vi.fn(async () => {}),
		};
		return actor;
	};

	it("offers a sale only to characters holding the item, and a purchase to any of one's own", async () => {
		const { tradeCandidates } = await import("../../../module/actors/steading/steading-trade-card.js");
		const wren = character("Wren", ["sword"]);
		const ash = character("Ash");
		const theirs = { ...character("Rook"), isOwner: false };
		expect(tradeCandidates("buy", "sword", [wren, ash, theirs]).map(a => a.id)).toEqual(["Wren", "Ash"]);
		expect(tradeCandidates("sell", "sword", [wren, ash, theirs]).map(a => a.id)).toEqual(["Wren"]);
	});

	it("adds a bought item to the character's inventory", async () => {
		const { settleTradeItem } = await import("../../../module/actors/steading/steading-trade-card.js");
		const ash = character("Ash");
		await settleTradeItem(ash, "sword", "buy");
		expect(ash.setFlag).toHaveBeenCalledWith("stonetop-pwd", "inventory.addedSpecial", ["sword"]);
	});

	it("is wired once per card from the chat hook", () => {
		expect(STONETOP_JS).toContain("wireTradeItemCard(message, html);");
	});

	it("asks who through the people chooser, then latches the card with the answer", async () => {
		const { wireTradeItemCard, TRADE_ITEM_FLAG } = await import("../../../module/actors/steading/steading-trade-card.js");
		const wren = character("Wren");
		const ash = character("Ash");
		const savedGame = globalThis.game;
		globalThis.game = { ...savedGame, user: { id: "p1", isGM: false }, actors: { contents: [wren, ash] } };
		try {
			const handlers = [];
			const button = trade => ({ dataset: { trade }, disabled: false, addEventListener: (type, fn) => handlers.push(fn) });
			const buttons = [button("buy"), button("sell")];
			const row = { dataset: { itemSlug: "sword" }, querySelectorAll: () => buttons };
			const flags = {};
			const message = {
				canUserModify: () => true,
				getFlag: (scope, key) => flags[key],
				setFlag: vi.fn(async (scope, key, value) => { flags[key] = value; }),
				unsetFlag: vi.fn(async (scope, key) => { delete flags[key]; }),
			};
			const pick = vi.fn(async ({ options, title }) => {
				expect(title).toBe("Who bought it?");
				expect(options.map(o => o.id)).toEqual(["Wren", "Ash"]);
				return "Ash";
			});
			wireTradeItemCard(message, { querySelector: () => row }, { pick });
			await handlers[0]({ preventDefault() {} });
			expect(pick).toHaveBeenCalledTimes(1);
			expect(flags[TRADE_ITEM_FLAG]).toEqual({ mode: "buy", actorId: "Ash", name: "Ash" });
			expect(ash.setFlag).toHaveBeenCalledWith("stonetop-pwd", "inventory.addedSpecial", ["sword"]);
			expect(buttons.every(b => b.disabled)).toBe(true);
		} finally {
			globalThis.game = savedGame;
		}
	});
});

describe("STD-2: a Seasons-style card carries its landed tier's button", () => {
	it("prints the 6- button on a 6- only, and speaks for the steading", async () => {
		const { rollSeasonsCard } = await import("../../../module/utils/roll-engine.js");
		const posted = [];
		let total = 5;
		vi.stubGlobal("Roll", class {
			constructor(formula) { this.formula = formula; this.dice = []; this.terms = []; }
			async evaluate() { this.total = total; return this; }
			async toMessage(data) { posted.push(data); }
		});
		vi.stubGlobal("ChatMessage", { getSpeaker: () => ({ alias: "x" }) });
		const table = {
			success: { label: "10+", line: "a" }, partial: { label: "7-9", line: "b" }, failure: { label: "6-", line: "c" },
		};
		const opts = { formula: "2d6", alias: "Requisition", resultTable: table, tierActions: { failure: requisitionMissCostAction() }, actor: { id: "st1" } };
		await rollSeasonsCard(opts);
		expect(posted[0].flavor).toContain("stonetop-requisition-miss-cost");
		expect(posted[0].speaker).toEqual({ alias: "Requisition", actor: "st1" });
		total = 8;
		await rollSeasonsCard(opts);
		expect(posted[1].flavor).not.toContain("stonetop-requisition-miss-cost");
	});
});

describe("STD-13: the moves' own words", () => {
	it("prints Muster's, Requisition's and Pull Together's triggers and picks as Book I does", () => {
		expect(SHEET_JS).toContain("When you press every able body into the defense of a steading, reduce Fortunes by 1 and roll +Population.");
		expect(SHEET_JS).not.toContain("needs mustering against a threat");
		expect(SHEET_JS).not.toContain("or otherwise put them at risk");
		expect(SHEET_JS).toContain("When you borrow some of the steading's assets for an expedition (like the horses or a plow), roll +Fortunes.");
		expect(SHEET_JS).toContain("<li>It gets done, but other work doesn't; reduce Fortunes by 1</li>");
		expect(SHEET_JS).toContain(`"It gets done, but there's a consequence (bad blood, an injury, a threat unearthed, etc.)"`);
	});
});
