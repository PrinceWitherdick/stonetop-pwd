// @vitest-environment happy-dom
// A Force to Be Reckoned With follows the card's FINAL total, both ways (the user's ruling, 2026-10-18).
// Book I: "When you Defy Danger against something trying to harm or constrain you, on a 12+ you turn the
// tables on them", and its first use crosses off "Would-be" (WouldBeHeroAsterisk.js). A rewrite of the
// total (a Shift, a +1, Burn Brightly, Impetuous Youth) that lifts the card onto a 12+ shows the note and
// runs the hook; one that drops it off a 12+ hides the note and writes back the "Would-be" THIS card took,
// and no other's (StonetopCharacter.js#reconcileCriticalOffers, stonetop.js#_shiftRollCardFlavor).

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildLiveCharacter, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { CRITICAL_OFFERS_FLAG, reconcileCriticalOffers } from "../../../module/actors/character/StonetopCharacter.js";
import {
	A_FORCE_TO_BE_RECKONED_WITH, FORCE_CROSSED_OFF_FLAG, FORCE_TURNED_TABLES_FLAG, forceTurnedTables,
} from "../../../module/actors/character/would-be-hero-cards.js";
import { WBH_HERO_FLAG } from "../../../module/actors/character/WouldBeHeroAsterisk.js";
import { rollStat, syncCountedNotePill } from "../../../module/utils/roll-engine.js";
import { countedResult, rolledRecord } from "../../../module/utils/counted-tier.js";
import { remarkRolledTier } from "../../../module/utils/move-tiers.js";
import { formatOutcomeDetail } from "../../../module/utils/strings.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

const SCOPE = SYSTEM_ID;
const FORCE_KEY = "force-to-be-reckoned-with";

/** A Would-Be Hero holding A Force to Be Reckoned With learned, "Would-be" not yet crossed off. */
function hero() {
	const made = buildLiveCharacter({
		slug: "the-would-be-hero", name: "The Would-Be Hero", seedStartingMoves: false,
		items: [makeLiveItem({ name: A_FORCE_TO_BE_RECKONED_WITH, type: "move", system: { moveType: "playbook" } })],
	});
	made.actor.isOwner = true;
	return made.actor;
}

/** A Defy Danger card, with the lines taken on it recorded as the roll records them. */
function card(taken = [FORCE_KEY]) {
	const flags = { [SCOPE]: { move: "Defy Danger", ...(taken ? { [CRITICAL_OFFERS_FLAG]: taken } : {}) } };
	return {
		id: "m1", flags,
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { (flags[scope] ??= {})[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete flags[scope]?.[key]; }),
	};
}

const crossedOff = actor => !!actor.getFlag(SCOPE, WBH_HERO_FLAG);
const posted = () => globalThis.ChatMessage.create.mock.calls.map(([data]) => data.content);

describe("A Force to Be Reckoned With's hook, after a rewrite", () => {
	let saved;
	beforeEach(() => { saved = globalThis.ChatMessage; globalThis.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) }; });
	afterEach(() => { globalThis.ChatMessage = saved; });

	it("an 11 lifted to a 12 turns the tables and crosses off \"Would-be\"", async () => {
		const actor = hero();
		const message = card();
		await reconcileCriticalOffers(message, actor, 12);
		expect(message.getFlag(SCOPE, FORCE_TURNED_TABLES_FLAG)).toBe(true);
		expect(message.getFlag(SCOPE, FORCE_CROSSED_OFF_FLAG)).toBe(true);
		expect(crossedOff(actor)).toBe(true);
		expect(posted()).toHaveLength(1);
		expect(posted()[0]).toContain("A Would-Be Hero No Longer");
		// Moved again within the 12+: nothing more.
		await reconcileCriticalOffers(message, actor, 13);
		expect(posted()).toHaveLength(1);
	});

	it("a 12 dropped to an 11 takes the tables back and writes back the \"Would-be\" this card crossed off", async () => {
		const actor = hero();
		const message = card();
		// The roll's own 12+ (StonetopCharacter.js#_payTakenOffers calls the same hook).
		await forceTurnedTables(actor, message);
		expect(crossedOff(actor)).toBe(true);
		await reconcileCriticalOffers(message, actor, 11);
		expect(message.getFlag(SCOPE, FORCE_TURNED_TABLES_FLAG)).toBe(false);
		expect(message.getFlag(SCOPE, FORCE_CROSSED_OFF_FLAG)).toBe(false);
		expect(crossedOff(actor)).toBe(false);
		expect(posted()).toHaveLength(2);
		expect(posted()[1]).toContain("A Would-Be Hero Again");
		expect(posted()[1]).toContain("is no longer a 12+");
		// Moved again below 12: nothing more. And lifted back onto a 12+, it crosses off again.
		await reconcileCriticalOffers(message, actor, 10);
		expect(posted()).toHaveLength(2);
		await reconcileCriticalOffers(message, actor, 12);
		expect(crossedOff(actor)).toBe(true);
		expect(message.getFlag(SCOPE, FORCE_CROSSED_OFF_FLAG)).toBe(true);
	});

	it("a drop leaves \"Would-be\" crossed off when an earlier use crossed it off", async () => {
		const actor = hero();
		// An earlier card's 12+ crossed it off.
		await forceTurnedTables(actor, card());
		expect(crossedOff(actor)).toBe(true);
		const message = card();
		await reconcileCriticalOffers(message, actor, 12);
		expect(message.getFlag(SCOPE, FORCE_TURNED_TABLES_FLAG)).toBe(true);
		expect(message.getFlag(SCOPE, FORCE_CROSSED_OFF_FLAG)).toBeUndefined();
		await reconcileCriticalOffers(message, actor, 11);
		expect(message.getFlag(SCOPE, FORCE_TURNED_TABLES_FLAG)).toBe(false);
		expect(crossedOff(actor)).toBe(true);
		expect(posted()).toHaveLength(1);
	});

	it("does nothing on a card where the line was not taken", async () => {
		const actor = hero();
		for (const message of [card(null), card([]), card(["slippery"])]) {
			await reconcileCriticalOffers(message, actor, 12);
			expect(message.getFlag(SCOPE, FORCE_TURNED_TABLES_FLAG)).toBeUndefined();
			expect(message.setFlag).not.toHaveBeenCalled();
		}
		expect(crossedOff(actor)).toBe(false);
		expect(posted()).toEqual([]);
	});
});

// The note: on every card the line was taken on, hidden below 12, and shown or hidden by the rewrite with
// the total (stonetop.js#_shiftRollCardFlavor is not importable, since the entry point registers every hook,
// so it is lifted out of the file and run on the posted card with the helpers it imports).
describe("the 12+ note, after a rewrite", () => {
	const STONETOP_JS = fs.readFileSync(path.resolve(__dirname, "../../../stonetop.js"), "utf8");
	const at = STONETOP_JS.indexOf("function _shiftRollCardFlavor");
	const source = STONETOP_JS.slice(at, at + STONETOP_JS.slice(at).search(/\n\}\r?\n/) + 2);
	const shiftRollCardFlavor = new Function("countedResult", "rolledRecord", "formatOutcomeDetail", "remarkRolledTier", "syncCountedNotePill",
		`${source}\nreturn _shiftRollCardFlavor;`)(countedResult, rolledRecord, formatOutcomeDetail, remarkRolledTier, syncCountedNotePill);
	const NOTE = '<p class="stonetop-roll-offer-note">Turn the tables</p>';

	let flavor;
	let total;
	beforeEach(() => {
		flavor = null;
		global.game.settings = { get: vi.fn(() => "publicroll") };
		global.ChatMessage = { getSpeaker: vi.fn(() => ({ alias: "Wren" })), create: vi.fn() };
		global.Roll = class {
			constructor(formula) { this.formula = formula; this.total = total; this.dice = [{ results: [{ result: 5 }, { result: 6 }] }]; }
			async evaluate() { return this; }
			async toMessage(data) { flavor = data.flavor; return { id: "card" }; }
		};
	});

	const rolled = async (at, options = {}) => {
		total = at;
		await rollStat("dex", { type: "stonetop", name: "Wren", system: {} }, { statValue: 0, moveName: "Defy Danger", noXpOnMiss: true, criticalActions: NOTE, ...options });
		return flavor;
	};
	const noteShown = html => {
		const root = document.createElement("div");
		root.innerHTML = html;
		const row = root.querySelector(".stonetop-roll-critical-action");
		return !!row && !row.hasAttribute("hidden") && !row.closest("[hidden]");
	};

	it("an 11 lifted to a 12 shows it; dropped back to an 11, or a 10, it is hidden again", async () => {
		const eleven = await rolled(11);
		expect(noteShown(eleven)).toBe(false);
		const twelve = shiftRollCardFlavor(eleven, 12);
		expect(noteShown(twelve)).toBe(true);
		expect(noteShown(shiftRollCardFlavor(twelve, 11))).toBe(false);
		expect(noteShown(shiftRollCardFlavor(twelve, 10))).toBe(false);
	});

	it("a 12 dropped to an 11 hides it, and a 7-9 or a miss shows it nowhere", async () => {
		const twelve = await rolled(12);
		expect(noteShown(twelve)).toBe(true);
		for (const to of [11, 8, 5]) expect(noteShown(shiftRollCardFlavor(twelve, to))).toBe(false);
	});

	it("keeps the 10+ row's own actions showing on a 10 or 11 while the note is hidden", async () => {
		const twelve = await rolled(12, { tierActions: { success: "<button class=\"own\">Own</button>" } });
		const root = document.createElement("div");
		root.innerHTML = shiftRollCardFlavor(twelve, 11);
		expect(root.querySelector("[data-tier=\"success\"]:not([data-critical])").hasAttribute("hidden")).toBe(false);
		expect(noteShown(root.innerHTML)).toBe(false);
	});
});
