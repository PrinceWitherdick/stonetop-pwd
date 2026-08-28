import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import {
	stockSources, canPayStock, defaultStockSource, stockCostFromDescription,
	SACRED_POUCH_SLUG, DEFAULT_SACRED_POUCH_MAX,
} from "../../../module/actors/character/stock-cost.js";
import { GUIDED_CHARACTER_MOVES } from "../../../module/actors/character/StonetopCharacterSheet.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Danu's Grasp is the one move that CHARGES before it rolls: "spend 1 Stock and roll +WIS".
// Its dialog has to answer two questions before the dice — can this character pay, and out of
// what — and refuse the roll when the answer is no.

describe("stockSources", () => {
	// BOTH tracks store checks SPENT, not held (model/Resource.js: "current - checks used").
	// Read the other way round, a full pouch reports no Stock and an empty one reports three.
	it("counts what is LEFT, from what has been spent", () => {
		expect(stockSources({ pouchMax: 3, pouchStored: 1 })[0])
			.toMatchObject({ key: "stock", label: "Stock", max: 3, stored: 1, remaining: 2 });
		expect(stockSources({ pouchMax: 3, pouchStored: 0 })[0].remaining).toBe(3);
		expect(stockSources({ pouchMax: 3, pouchStored: 3 })[0].remaining).toBe(0);
	});

	it("never reports a negative purse", () => {
		expect(stockSources({ pouchMax: 3, pouchStored: 9 })[0].remaining).toBe(0);
		expect(stockSources({ pouchMax: 3, pouchStored: -2 })[0].remaining).toBe(3);
	});

	it("takes the pouch's raised capacity when it has one", () => {
		expect(stockSources({ pouchMax: 5, pouchStored: 1 })[0].remaining).toBe(4);
	});

	it("offers Favor only to a character who owns Rites of the Land", () => {
		expect(stockSources({ favorMax: null }).map(s => s.key)).toEqual(["stock"]);
		expect(stockSources({ favorMax: 4, favorStored: 1 }).map(s => s.key)).toEqual(["stock", "favor"]);
	});

	// THE TWO PURSES COUNT OPPOSITE WAYS. The test that settles it is the one know-things.js
	// states for the Logbook: whatever a stored ZERO means has to be true of a character who
	// has never touched the move. A fresh Blessed has a FULL pouch and NO Favor.
	it("reads Favor as HELD, not as spent", () => {
		expect(stockSources({ favorMax: 4, favorStored: 0 })[1].remaining).toBe(0);
		expect(stockSources({ favorMax: 4, favorStored: 1 })[1].remaining).toBe(1);
		expect(stockSources({ favorMax: 4, favorStored: 4 })[1].remaining).toBe(4);
	});

	it("reads the pouch as a CAPACITY, the other way round", () => {
		expect(stockSources({ pouchStored: 0 })[0].remaining).toBe(3);
		expect(stockSources({ pouchStored: 3 })[0].remaining).toBe(0);
	});

	// Spending moves them in opposite directions, so each purse is asked rather than told.
	it("spends the pouch UP and Favor DOWN", () => {
		const [pouch, favor] = stockSources({ pouchStored: 1, favorMax: 4, favorStored: 3 });
		expect(pouch.after(1)).toBe(2);
		expect(favor.after(1)).toBe(2);
		// Neither runs off its end.
		expect(stockSources({ pouchStored: 3 })[0].after(1)).toBe(3);
		expect(stockSources({ favorMax: 4, favorStored: 0 })[1].after(1)).toBe(0);
	});

	// An empty purse is still listed: "Stock 0 of 3" is the sentence that explains the missing
	// Roll button, where dropping the row would just look like the dialog forgot something.
	it("still lists a purse that is empty", () => {
		expect(stockSources({ pouchStored: 3 }).map(s => s.key)).toEqual(["stock"]);
	});

	it("drops the pouch for a character who does not carry one", () => {
		expect(stockSources({ hasPouch: false })).toEqual([]);
		expect(stockSources({ hasPouch: false, favorMax: 4 }).map(s => s.key)).toEqual(["favor"]);
	});
});

describe("paying", () => {
	// "Spend Favor in lieu of Stock, 1-for-1" (Rites of the Land). A gate that only knew about
	// the pouch would refuse a Blessed holding Favor a move the book grants them.
	it("lets Favor stand in for an empty pouch", () => {
		const sources = stockSources({ pouchStored: 3, favorMax: 4, favorStored: 1 });
		expect(canPayStock(sources, 1)).toBe(true);
		expect(defaultStockSource(sources, 1).key).toBe("favor");
	});

	it("spends the pouch first when both could pay — Favor is the substitute, not the default", () => {
		const sources = stockSources({ pouchStored: 1, favorMax: 4, favorStored: 1 });
		expect(defaultStockSource(sources, 1).key).toBe("stock");
	});

	it("will not spend Favor a Blessed has not earned", () => {
		// Owns Rites of the Land, has never overseen the rites: the track is empty, so is the purse.
		const sources = stockSources({ pouchStored: 3, favorMax: 4, favorStored: 0 });
		expect(sources.map(s => s.remaining)).toEqual([0, 0]);
		expect(canPayStock(sources, 1)).toBe(false);
	});

	it("refuses when neither purse can cover it", () => {
		const broke = stockSources({ pouchStored: 3, favorMax: 4, favorStored: 0 });
		expect(canPayStock(broke, 1)).toBe(false);
		expect(defaultStockSource(broke, 1)).toBeNull();
	});

	// Costs are not split across purses: one Stock and one Favor is not two of anything.
	it("does not split a cost across two purses", () => {
		const sources = stockSources({ pouchStored: 2, favorMax: 4, favorStored: 1 });
		expect(sources.map(s => s.remaining)).toEqual([1, 1]);
		expect(canPayStock(sources, 2)).toBe(false);
	});
});

describe("which moves are gated, and which must never be", () => {
	const strip = h => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
	const moves = new Map();
	const walk = dir => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) { walk(p); continue; }
			if (!e.name.endsWith(".json")) continue;
			let j; try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
			if (j?.type === "move") moves.set(j.name, j.system ?? {});
		}
	};
	walk(path.resolve(HERE, "../../../packs/src/stonetop-items"));

	const gated = Object.entries(GUIDED_CHARACTER_MOVES).filter(([, g]) => g.cost).map(([n]) => n);

	it("gates exactly the moves whose ONE trigger both spends and rolls", () => {
		expect(gated.slice().sort()).toEqual(["Danu's Grasp", "Suck the Poison Out"]);
	});

	it.each(gated)("%s spends and rolls in the same breath", name => {
		expect(moves.get(name)?.rollType, name).toBeTruthy();
		// "spend 1 Stock and roll +X" — one clause, with no second trigger between them.
		expect(strip(moves.get(name)?.description ?? "")).toMatch(/spend 1 Stock and roll \+/i);
	});

	// The three that cost Stock, DO roll, and must NOT be gated: each pays at one trigger and
	// rolls at another, so a Stock gate on the roll would refuse a Blessed the roll for a charm,
	// ward or veil they already paid for — possibly sessions earlier. This is the guard against
	// "gate every Stock move that rolls", which reads like the obvious generalisation and is wrong.
	it.each([
		["Amulets & Talismans", "when that harm actually comes"],
		["Wards & Bindings", "when the wards are tested"],
		["Veil", "when the deception is scrutinised"],
	])("%s is left alone — it rolls %s", name => {
		const sys = moves.get(name);
		expect(sys, name).toBeTruthy();
		expect(sys.rollType, name).toBeTruthy();
		const text = strip(sys.description ?? "");
		expect(text).toMatch(/spend 1 Stock/i);
		// The tell: a SECOND "When…" introduces the roll, well after the spend.
		expect(text).toMatch(/spend 1 Stock[\s\S]*\bWhen\b[\s\S]*roll \+/i);
		expect(GUIDED_CHARACTER_MOVES[name]?.cost, `${name} must not be gated`).toBeUndefined();
	});

	// Stock moves that never roll: no dialog, so no moment at which to charge. Paid by hand on
	// the pouch, as the Blessed's marks deliberately are (see blessed-marks.js).
	it.each(["Call the Spirits", "Healer's Arts", "Potent Workings", "Trackless Step"])(
		"%s has no roll to gate", name => {
			expect(moves.has(name), name).toBe(true);
			expect(moves.get(name).rollType || null).toBeNull();
			expect(GUIDED_CHARACTER_MOVES[name]).toBeUndefined();
		});
});

describe("Danu's Grasp, on the sheet", () => {
	const SHEET = read("module/actors/character/StonetopCharacterSheet.js");
	const guide = GUIDED_CHARACTER_MOVES["Danu's Grasp"];

	it("declares the cost the move prints", () => {
		expect(guide).toBeTruthy();
		expect(guide.cost).toEqual({ amount: 1, label: "Stock" });
		expect(guide.roll).toBe("wis");
		expect(guide.trigger).toContain("spend 1 Stock and roll +WIS");
	});

	// The gate, and the reason it is a GATE and not a warning: the button is simply not built.
	it("offers no Roll button when the cost cannot be paid", () => {
		expect(SHEET).toContain("if (rollable && (!cost || cost.affordable))");
	});

	// Paid after the prompt and before the dice: backing out of the prompt spends nothing, and
	// any roll that happens has been paid for.
	it("charges between the prompt and the dice", () => {
		const at = SHEET.indexOf("if (cost && !(await this._spendStockCost(cost, html, name)))");
		expect(at).toBeGreaterThan(-1);
		const before = SHEET.slice(SHEET.lastIndexOf("callback: async html => {", at), at);
		expect(before).toContain("_promptRollOptions");
		expect(SHEET.slice(at, at + 400)).toContain("onRoll(");
	});

	// The purse is re-read at the moment of spending. This dialog is not modal, so the pouch can
	// be emptied on the sheet behind it between opening the window and pressing the button.
	it("re-reads the purse before it charges", () => {
		const spend = SHEET.slice(SHEET.indexOf("async _spendStockCost"));
		expect(spend.slice(0, 900)).toContain("const live = this._stockCostView(cost)");
		expect(spend.slice(0, 900)).toContain("return false");
	});

	it("names both purses and the constants they live under", () => {
		expect(SHEET).toContain(SACRED_POUCH_SLUG);
		expect(SHEET).toContain("RITES_OF_THE_LAND");
		expect(DEFAULT_SACRED_POUCH_MAX).toBe(3);
	});

	it("is styled, including the state that explains the missing button", () => {
		const css = read("styles/stonetop.css");
		for (const rule of [".stonetop-move-cost {", ".stonetop-move-cost-purse.is-empty", ".stonetop-move-cost.is-unaffordable"]) {
			expect(css, rule).toContain(rule);
		}
	});
});

// Stock is the ONE move cost with no home on the move itself. Every other pool named as a cost
// — Nerve, Command, Resolve, Blessing, Precaution, Protection, Presence, Rapport, Favor — has a
// resource track of its own, so its pips sit on the move and the player ticks them there. Stock
// lives on the sacred POUCH, several tabs away, so the nine Stock moves that are not gated at
// roll time had a cost with nothing to click. They pay on the card their name-click posts.
describe("paying for a move that does not roll", () => {
	const SHEET = read("module/actors/character/StonetopCharacterSheet.js");
	const STONETOP = read("stonetop.js");
	const moves = new Map();
	const walk = dir => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) { walk(p); continue; }
			if (!e.name.endsWith(".json")) continue;
			let j; try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
			if (j?.type === "move") moves.set(j.name, j.system ?? {});
		}
	};
	walk(path.resolve(HERE, "../../../packs/src/stonetop-items"));

	it("reads the price off the move's own text", () => {
		expect(stockCostFromDescription("<p>spend 1 Stock and roll +WIS.</p>")).toEqual({ amount: 1, label: "Stock" });
		// Potent Workings' "1 additional Stock" is still one pip off the pouch.
		expect(stockCostFromDescription("<p>you may spend 1 additional Stock to choose 1</p>")).toEqual({ amount: 1, label: "Stock" });
		expect(stockCostFromDescription("<p>When you spend 2 Stock</p>")).toEqual({ amount: 2, label: "Stock" });
		// The marks say what the Stock BUYS rather than that it is spent.
		expect(stockCostFromDescription("<p>When you mark another with 1 Stock</p>")).toEqual({ amount: 1, label: "Stock" });
	});

	it("finds no price where there is none", () => {
		expect(stockCostFromDescription("<p>hold 2 Resolve; spend it 1-for-1.</p>")).toBeNull();
		expect(stockCostFromDescription("<p>Spend Readiness to halve the damage.</p>")).toBeNull();
		expect(stockCostFromDescription("")).toBeNull();
		expect(stockCostFromDescription(null)).toBeNull();
	});

	// Every shipped Stock move is recognised — the button is offered off the text, so a move
	// whose wording the reader missed would silently have no way to pay.
	it.each([
		"Call the Spirits", "Healer's Arts", "Potent Workings", "Trackless Step", "Barkskin",
		"Shared Souls", "Amulets & Talismans", "Wards & Bindings", "Veil",
	])("%s is recognised as costing Stock", name => {
		expect(moves.has(name), name).toBe(true);
		expect(stockCostFromDescription(moves.get(name).description), name).toEqual({ amount: 1, label: "Stock" });
	});

	// The held-pool moves must NOT grow a Stock button: their cost is spent out of a track the
	// move already granted, and its pips are on the move itself.
	it.each(["Silver Tongued", "Stentorian", "Anger is a Gift", "Defend", "Up With People", "A Safe Place"])(
		"%s is not treated as a Stock cost", name => {
			expect(stockCostFromDescription(moves.get(name)?.description ?? ""), name).toBeNull();
		});

	it("puts the button on the card, wired to the shared purse reader", () => {
		expect(SHEET).toContain("_stockSpendButtonHtml");
		expect(SHEET).toContain('class="stonetop-spend-stock"');
		expect(STONETOP).toContain("function _chatWireSpendStock");
		expect(STONETOP).toContain("_chatWireSpendStock(message, html);");
		// The SAME reader the gated dialog uses, so the two cannot disagree about the purse.
		expect(STONETOP).toContain("stockSourcesForFlags");
		expect(STONETOP).toContain("defaultStockSource");
	});

	// One card is one use of the move, so it is paid for once however many clients render it.
	it("stamps the spend on the message so it cannot be paid twice", () => {
		const at = STONETOP.indexOf("function _chatWireSpendStock");
		const body = STONETOP.slice(at, at + 2200);
		expect(body).toContain('message.getFlag(SYSTEM_ID, "stockSpent")');
        expect(body).toContain('message.setFlag(SYSTEM_ID, "stockSpent"');
		expect(body).toContain("btn.disabled = true");
	});

	// The two moves gated at ROLL time never reach the posting tail, so no card of theirs can
	// charge a second time for the Stock their dialog already took.
	it.each(["Danu's Grasp", "Suck the Poison Out"])("%s is charged by its dialog, not by a card", name => {
		expect(GUIDED_CHARACTER_MOVES[name]?.cost).toBeTruthy();
		// _guidedCharacterMoveHasAction is true for these (they roll), and that branch returns
		// before the post-to-chat tail.
		expect(moves.get(name)?.rollType, name).toBeTruthy();
	});
});
