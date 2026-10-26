import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../../../module/utils/roll-engine.js", async importOriginal => ({
	...(await importOriginal()),
	rollStat: vi.fn(async () => ({ total: 8 })),
}));

const { rollStat } = await import("../../../module/utils/roll-engine.js");
const { StonetopSteading } = await import("../../../module/actors/steading/StonetopSteading.js");
const { createStonetopSteadingSheetClass } = await import("../../../module/actors/steading/StonetopSteadingSheet.js");
const {
	TRADE_VALUES, TRADE_PAY_FLAG, TRADE_ARTIFACT_FLAG, normalizePayment, paymentLine, tradePaymentChanges,
	settleTradePayment, tradePaymentActions, tradePaymentBodyHtml, readTradePaymentForm, artifactTradeValue,
	tradeArtifactCandidates, wireTradePaymentRow, wireTradeItemCard,
} = await import("../../../module/actors/steading/steading-trade-card.js");

// Trade & Barter's payment side (Book I pp.540-542): the steading pays (or is paid) in Surplus, worth Value 2,
// and in the coins in its boxes (Value 0 to 4 by size and metal); a character's artifact with a Value can be
// handed over; a unique item with no Value is beyond the move (p.540).

const SCOPE = "stonetop-pwd";

function setPath(obj, dotted, value) {
	const keys = dotted.split(".");
	let at = obj;
	for (const key of keys.slice(0, -1)) at = (at[key] ??= {});
	at[keys.at(-1)] = value;
}

function fakeSteadingActor({ steading = {}, system = {}, isOwner = true } = {}) {
	const actor = {
		id: "st1", name: "Stonetop", type: "stonetop", isOwner, system,
		flags: { [SCOPE]: { steading } },
		getFlag: (scope, key) => actor.flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { actor.flags[scope] ??= {}; actor.flags[scope][key] = value; }),
		update: vi.fn(async data => { for (const [k, v] of Object.entries(data)) setPath(actor, k, v); }),
	};
	actor.typedActor = Object.assign(new StonetopSteading(actor), { improvementRules: () => [] });
	return actor;
}

const steadingFlags = actor => actor.flags[SCOPE].steading;

beforeEach(() => {
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
	rollStat.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("what things are worth (p.542)", () => {
	it("holds the book's Value for a Surplus and each size of silver and gold", () => {
		expect(TRADE_VALUES.surplus).toBe(2);
		expect(TRADE_VALUES.silver).toEqual({ coins: 0, handfuls: 1, purses: 2 });
		expect(TRADE_VALUES.gold).toEqual({ coins: 2, handfuls: 3, purses: 4 });
	});

	it("says what was handed over, with each thing's Value", () => {
		const line = paymentLine({ surplus: 1, silver: { handfuls: 2 }, gold: { coins: 1 } }, "Stonetop");
		expect(line).toBe("Stonetop paid 1 Surplus (Value 2), 2 handfuls of silver (Value 1 each) and a single gold coin (Value 2).");
		expect(paymentLine({ direction: "receive", gold: { purses: 1 } }, "Stonetop")).toBe("Stonetop received a purse of gold (Value 4).");
	});
});

describe("the steading's side of the payment", () => {
	it("takes Surplus and coins out of the boxes, and refuses what it does not hold", () => {
		const held = { surplus: 2, silver: { purses: 0, handfuls: 3, coins: 5 }, gold: { purses: 0, handfuls: 0, coins: 0 } };
		const out = tradePaymentChanges(held, { surplus: 1, silver: { handfuls: 2 } });
		expect(out.short).toEqual([]);
		expect(out.system).toEqual({ "attributes.surplus.value": 1 });
		expect(out.flags).toEqual({ silver: { coins: 5, handfuls: 1, purses: 0 } });
		expect(tradePaymentChanges(held, { surplus: 3, gold: { coins: 1 } }).short).toEqual(["Surplus", "single gold coins"]);
	});

	it("adds what the steading receives", () => {
		const out = tradePaymentChanges({ surplus: 0, gold: { coins: 1 } }, { direction: "receive", surplus: 2, gold: { purses: 1 } });
		expect(out.system).toEqual({ "attributes.surplus.value": 2 });
		expect(out.flags.gold).toEqual({ coins: 1, handfuls: 0, purses: 1 });
	});

	it("writes it in one update filed under Trade & Barter", async () => {
		const actor = fakeSteadingActor({ steading: { silver: { purses: 1, handfuls: 0, coins: 0 } }, system: { attributes: { surplus: { value: 3 } } } });
		const out = await settleTradePayment(actor.typedActor, { surplus: 1, silver: { purses: 1 } });
		expect(out.done).toBe(true);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.update.mock.calls[0][1]).toEqual({ stonetopMove: "Trade & Barter" });
		expect(steadingFlags(actor).system.attributes.surplus.value).toBe(2);
		expect(steadingFlags(actor).silver).toEqual({ coins: 0, handfuls: 0, purses: 0 });
	});

	it("reads the window's answer back as a payment", () => {
		const doc = new Window().document;
		const form = doc.body.appendChild(doc.createElement("form"));
		form.innerHTML = tradePaymentBodyHtml({ surplus: 2 }, 2);
		expect(form.textContent).toContain("The item traded is Value 2");
		form.querySelector('input[name="surplus"]').value = "1";
		form.querySelector('input[name="gold.handfuls"]').value = "2";
		expect(readTradePaymentForm(form)).toEqual(normalizePayment({ direction: "pay", surplus: 1, gold: { handfuls: 2 } }));
	});
});

describe("the card's payment row", () => {
	const sheetOn = actor => {
		const Base = class {
			constructor() { this._actor = actor; }
			get actor() { return this._actor; }
			render() {}
		};
		return new (createStonetopSteadingSheetClass(Base))();
	};

	it("rides every Trade & Barter 10+ and 7-9, with the item's Value, and never its 6-", async () => {
		const actor = fakeSteadingActor({ system: { attributes: { prosperity: { value: 0 } } } });
		await sheetOn(actor)._onSteadingRoll("Trade & Barter", "prosperity", { tradeValue: 2 });
		const { tierActions, tradeValue } = rollStat.mock.calls.at(-1)[2];
		expect(tradeValue).toBeUndefined();
		expect(tierActions.success).toContain("stonetop-trade-pay-row");
		expect(tierActions.partial).toContain(`data-item-value="2"`);
		expect(tierActions?.failure ?? "").not.toContain("stonetop-trade-pay");
	});

	it("is not on another homefront move's card", async () => {
		const actor = fakeSteadingActor({ system: { attributes: { population: { value: 0 } } } });
		await sheetOn(actor)._onSteadingRoll("Pull Together", "population", {});
		const { tierActions } = rollStat.mock.calls.at(-1)[2];
		expect(JSON.stringify(tierActions ?? {})).not.toContain("stonetop-trade-pay");
	});

	function cardWith(actor) {
		const flags = {};
		return {
			speaker: { actor: actor.id },
			canUserModify: () => true,
			getFlag: (scope, key) => flags[key],
			setFlag: vi.fn(async (scope, key, value) => { flags[key] = value; }),
			unsetFlag: vi.fn(async (scope, key) => { delete flags[key]; }),
			flags,
		};
	}

	function rowIn(html) {
		const doc = new Window().document;
		const root = doc.body.appendChild(doc.createElement("div"));
		root.innerHTML = html;
		return root;
	}

	it("pays from the steading through the window, then latches the card", async () => {
		const actor = fakeSteadingActor({ system: { attributes: { surplus: { value: 2 } } } });
		vi.stubGlobal("game", { ...globalThis.game, actors: { get: id => (id === actor.id ? actor : null) }, user: { id: "gm", isGM: true } });
		const message = cardWith(actor);
		const root = rowIn(tradePaymentActions(2));
		const ask = vi.fn(async spec => {
			expect(spec.body).toContain("The item traded is Value 2");
			return normalizePayment({ surplus: 1 });
		});
		wireTradePaymentRow(message, root, { ask });
		root.querySelector("[data-trade-pay='stores']").click();
		await vi.waitFor(() => expect(message.flags[TRADE_PAY_FLAG]).toMatchObject({ surplus: 1, steading: "Stonetop" }));
		expect(steadingFlags(actor).system.attributes.surplus.value).toBe(1);
	});

	it("writes nothing when the steading is short", async () => {
		const actor = fakeSteadingActor({ system: { attributes: { surplus: { value: 0 } } } });
		vi.stubGlobal("game", { ...globalThis.game, actors: { get: () => actor }, user: { id: "gm", isGM: true } });
		const message = cardWith(actor);
		const root = rowIn(tradePaymentActions());
		wireTradePaymentRow(message, root, { ask: async () => normalizePayment({ surplus: 1 }) });
		root.querySelector("[data-trade-pay='stores']").click();
		await vi.waitFor(() => expect(globalThis.ui.notifications.warn).toHaveBeenCalled());
		expect(actor.update).not.toHaveBeenCalled();
		expect(message.flags[TRADE_PAY_FLAG]).toBeUndefined();
	});

	// Code review 10-22 (HC-1): the GM and whoever rolled can both write the card. A payment settled by one of
	// them while the other's window was open must not be paid a second time when that window is answered.
	it("pays nothing when the card was settled while the window was open, and opens one window per click", async () => {
		const actor = fakeSteadingActor({ system: { attributes: { surplus: { value: 3 } } } });
		vi.stubGlobal("game", { ...globalThis.game, actors: { get: () => actor }, user: { id: "gm", isGM: true } });
		const message = cardWith(actor);
		const root = rowIn(tradePaymentActions());
		let answer;
		const ask = vi.fn(() => new Promise(resolve => { answer = resolve; }));
		wireTradePaymentRow(message, root, { ask });
		const button = root.querySelector("[data-trade-pay='stores']");
		button.click();
		expect(button.disabled).toBe(true);
		button.click();
		expect(ask).toHaveBeenCalledTimes(1);
		// The other writer pays meanwhile.
		message.flags[TRADE_PAY_FLAG] = { surplus: 1, direction: "pay", steading: "Stonetop" };
		answer(normalizePayment({ surplus: 1 }));
		await vi.waitFor(() => expect(globalThis.ui.notifications.info).toHaveBeenCalled());
		expect(actor.update).not.toHaveBeenCalled();
		expect(message.setFlag).not.toHaveBeenCalled();
		expect(button.disabled).toBe(true);
	});

	it("puts the button back up when the window is closed without paying", async () => {
		const actor = fakeSteadingActor({ system: { attributes: { surplus: { value: 3 } } } });
		vi.stubGlobal("game", { ...globalThis.game, actors: { get: () => actor }, user: { id: "gm", isGM: true } });
		const message = cardWith(actor);
		const root = rowIn(tradePaymentActions());
		const ask = vi.fn(async () => null);
		wireTradePaymentRow(message, root, { ask });
		const button = root.querySelector("[data-trade-pay='stores']");
		button.click();
		await vi.waitFor(() => expect(ask).toHaveBeenCalled());
		await vi.waitFor(() => expect(button.disabled).toBe(false));
	});

	it("is wired on its own from the chat hook, beside the hand-over row", () => {
		const actor = fakeSteadingActor();
		const message = { ...cardWith(actor), getFlag: () => ({ surplus: 1, direction: "pay", steading: "Stonetop" }) };
		const root = rowIn(tradePaymentActions());
		wireTradePaymentRow(message, [root]);
		expect(root.textContent).toContain("Stonetop paid 1 Surplus");
		// The hand-over row's wiring leaves it alone.
		const other = rowIn(tradePaymentActions());
		wireTradeItemCard(message, other);
		expect(other.textContent).not.toContain("Stonetop paid");
		const main = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../stonetop.js"), "utf8");
		expect(main).toContain("wireTradePaymentRow(message, html);");
	});
});

describe("an artifact changing hands", () => {
	const treasure = (id, note, state = "") => ({
		id, name: id, type: "move", delete: vi.fn(async () => {}),
		system: { note, identifyState: state }, flags: { stonetop: { isTreasure: true } },
	});

	it("reads its Value off its tags, and calls one with none unique", () => {
		expect(artifactTradeValue(treasure("Torc", "beautiful, Value 3"))).toEqual({ value: 3, unique: false, hidden: false });
		expect(artifactTradeValue(treasure("Bowl", "Value 1, or Value 3 to a scholar")).value).toBe(1);
		expect(artifactTradeValue(treasure("Crown", "magical")).unique).toBe(true);
	});

	it("keeps an unidentified artifact's Value from a player", () => {
		expect(artifactTradeValue(treasure("Urn", "Value 2", "unknown")).hidden).toBe(true);
		expect(artifactTradeValue(treasure("Urn", "Value 2", "unknown"), { viewerIsGM: true }).hidden).toBe(false);
	});

	it("offers only treasures this user's characters carry", () => {
		const sword = { id: "sword", name: "Sword", type: "move", system: { note: "Value 1" }, flags: {} };
		const wren = { id: "wren", name: "Wren", type: "character", isOwner: true, items: [treasure("Torc", "Value 3"), sword] };
		const rook = { id: "rook", name: "Rook", type: "character", isOwner: false, items: [treasure("Ring", "Value 2")] };
		expect(tradeArtifactCandidates([wren, rook]).map(c => c.item.name)).toEqual(["Torc"]);
	});

	it("takes the picked artifact off its character, leaving a unique one out of the list", async () => {
		const torc = treasure("Torc", "Value 3");
		const crown = treasure("Crown", "magical");
		const wren = { id: "wren", name: "Wren", type: "character", isOwner: true, items: [torc, crown] };
		const flags = {};
		const message = {
			canUserModify: () => true, getFlag: (s, k) => flags[k],
			setFlag: vi.fn(async (s, k, v) => { flags[k] = v; }), unsetFlag: vi.fn(async (s, k) => { delete flags[k]; }),
		};
		const doc = new Window().document;
		const root = doc.body.appendChild(doc.createElement("div"));
		root.innerHTML = tradePaymentActions();
		const pickArtifact = vi.fn(async ({ options }) => {
			expect(options.map(o => o.label)).toEqual(["Torc (Wren)"]);
			return options[0].id;
		});
		wireTradePaymentRow(message, root, { pickArtifact, actors: [wren], user: { id: "p", isGM: false } });
		root.querySelector("[data-trade-pay='artifact']").click();
		await vi.waitFor(() => expect(flags[TRADE_ARTIFACT_FLAG]).toEqual({ actorId: "wren", name: "Wren", item: "Torc" }));
		expect(torc.delete).toHaveBeenCalled();
		expect(crown.delete).not.toHaveBeenCalled();
	});

	it("takes nothing off anyone when another writer handed one over while the picker was open", async () => {
		const torc = treasure("Torc", "Value 3");
		const wren = { id: "wren", name: "Wren", type: "character", isOwner: true, items: [torc] };
		const flags = {};
		const message = {
			canUserModify: () => true, getFlag: (s, k) => flags[k],
			setFlag: vi.fn(async (s, k, v) => { flags[k] = v; }), unsetFlag: vi.fn(async (s, k) => { delete flags[k]; }),
		};
		const doc = new Window().document;
		const root = doc.body.appendChild(doc.createElement("div"));
		root.innerHTML = tradePaymentActions();
		const pickArtifact = vi.fn(async ({ options }) => {
			flags[TRADE_ARTIFACT_FLAG] = { actorId: "rook", name: "Rook", item: "Ring" };
			return options[0].id;
		});
		wireTradePaymentRow(message, root, { pickArtifact, actors: [wren], user: { id: "p", isGM: false } });
		root.querySelector("[data-trade-pay='artifact']").click();
		await vi.waitFor(() => expect(pickArtifact).toHaveBeenCalled());
		await vi.waitFor(() => expect(globalThis.ui.notifications.info).toHaveBeenCalledWith(expect.stringContaining("Someone else settled")));
		expect(torc.delete).not.toHaveBeenCalled();
		expect(message.setFlag).not.toHaveBeenCalled();
	});
});
