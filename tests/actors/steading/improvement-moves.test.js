import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../module/utils/roll-engine.js", async importOriginal => ({
	...(await importOriginal()),
	rollStat: vi.fn(async () => ({ total: 7 })),
}));

const { rollStat } = await import("../../../module/utils/roll-engine.js");
const { createStonetopSteadingSheetClass } = await import("../../../module/actors/steading/StonetopSteadingSheet.js");
const { IMPROVEMENT_DEFINITIONS } = await import("../../../module/actors/steading/StonetopSteading.js");

/**
 * The steading's homefront rolls, with what the steading has built folded in: a Township's
 * advantage, the wall a Deploy takes advantage of, the standing watch's +1 Defenses, who picks
 * Deploy's 7-9 consequence, and the herd's Requisition. The rules themselves are
 * improvement-rolls.test.js's; this is that they reach the dice.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");
const STEADING_JS = read("module/actors/steading/StonetopSteadingSheet.js");
const STONETOP_JS = read("stonetop.js");
const IMPROVEMENTS_HBS = read("templates/actor/partials/steading-tab-improvements.hbs");

function makeSheet({ built = [], stats = {}, diminished = false, militiaR = [], held = null, sticky = "normal" } = {}) {
	const typedActor = {
		getSystemValue: vi.fn(path => (path.includes("diminished") ? diminished : false)),
		getStatValue: vi.fn(stat => stats[stat] ?? 0),
		fortunesAdvantage: vi.fn(() => held),
		clearFortunesAdvantage: vi.fn(async () => {}),
		improvementCompleted: vi.fn(slug => built.includes(slug)),
		improvementDef: vi.fn(slug => IMPROVEMENT_DEFINITIONS.find(d => d.slug === slug) ?? null),
		improvementRequirements: vi.fn(slug => (slug === "wellTrainedMilitia" ? militiaR : [])),
	};
	const actor = { name: "Stonetop", type: "stonetop", isOwner: true, typedActor, getFlag: vi.fn(() => sticky) };
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		render() {}
	};
	const Sheet = createStonetopSteadingSheetClass(Base);
	return new Sheet();
}

const lastRoll = () => rollStat.mock.calls.at(-1);

beforeEach(() => rollStat.mockClear());
afterEach(() => vi.clearAllMocks());

describe("a homefront roll, with what the steading has built", () => {
	it("gives a Township's Muster advantage, and cancels it against Diminished", async () => {
		await makeSheet({ built: ["township"] })._onSteadingRoll("Muster", "population", {});
		expect(lastRoll()[2]).toMatchObject({ rollMode: "adv", conditionNotes: ["Township: advantage"] });
		await makeSheet({ built: ["township"], diminished: true })._onSteadingRoll("Muster", "population", {});
		expect(lastRoll()[2]).toMatchObject({ rollMode: "normal", stonetopDebility: "Diminished" });
	});

	it("nets winter's Trade & Barter disadvantage against the player's own advantage", async () => {
		await makeSheet()._onSteadingRoll("Trade & Barter", "prosperity", { rollMode: "adv", winter: true });
		expect(lastRoll()[2].rollMode).toBe("normal");
		await makeSheet()._onSteadingRoll("Trade & Barter", "prosperity", { winter: true });
		expect(lastRoll()[2].rollMode).toBe("dis");
	});

	it("rolls a Deploy at advantage from the palisade, with the watch's Defenses, and names who picks", async () => {
		const sheet = makeSheet({ built: ["palisade", "standingWatch"], stats: { defenses: 1 } });
		await sheet._onSteadingRoll("Deploy", "defenses", { improvementAnswers: { wall: "yes", watch: "yes", strength: "yes" } });
		const opts = lastRoll()[2];
		expect(opts.rollMode).toBe("adv");
		expect(opts.statValue).toBe(2);
		expect(opts.moveResults.partial.value).toMatch(/you pick 1/);
		await sheet._onSteadingRoll("Deploy", "defenses", { improvementAnswers: {} });
		expect(lastRoll()[2].moveResults.partial.value).toMatch(/the GM picks 1/);
	});

	it("counts a trained tactic as a position of strength", async () => {
		// [veteran, Archery, Cavalry, Formations, ...]: Formations trained.
		const sheet = makeSheet({ built: ["wellTrainedMilitia"], militiaR: [true, false, false, true] });
		await sheet._onSteadingRoll("Deploy", "defenses", { improvementAnswers: { tactic: "3" } });
		expect(lastRoll()[2].moveResults.partial.value).toMatch(/you pick 1/);
		expect(lastRoll()[2].conditionNotes).toContain("Trained tactic: Formations");
	});

	it("passes a herd Requisition's 6- as a 7-9 to the roll", async () => {
		await makeSheet({ built: ["herdOfHorses"] })._onSteadingRoll("Requisition", "fortunes", { improvementAnswers: { herdShare: "yes" } });
		expect(lastRoll()[2].missCountsAsPartial).toMatch(/half the herd/i);
	});

	it("spends a held Rites of the Land advantage as one more source", async () => {
		const sheet = makeSheet({ held: { source: "A sacrifice at the sacred rites" } });
		await sheet._onSteadingRoll("Persuade", "fortunes", { rollMode: "dis" });
		expect(lastRoll()[2].rollMode).toBe("normal");
		expect(sheet.actor.typedActor.clearFortunesAdvantage).toHaveBeenCalled();
	});
});

describe("the improvements that are moves", () => {
	it("list the Aurochs Hunt and Heroic Reputation only once built", () => {
		expect(STEADING_JS).toContain('requires: "aurochsHunting"');
		expect(STEADING_JS).toContain('requires: "heroicReputation"');
		expect(STEADING_JS).toContain("STEADING_MOVES.filter(move => !move.requires || this._hasImprovement(move.requires))");
	});

	it("roll from their own card too, for anyone who can see the sheet", () => {
		expect(IMPROVEMENTS_HBS).toContain('class="steading-improvement-move-btn" data-action="improvement-move"');
		// Bound in the listener the Homefront moves use, ABOVE the sheet's editable guard: rolling is play.
		const button = STEADING_JS.indexOf('ev.target.closest(".steading-improvement-move-btn")');
		const guard = STEADING_JS.indexOf("if (!this.isEditable) return;", STEADING_JS.indexOf("activateListeners(html)"));
		expect(button).toBeGreaterThan(-1);
		expect(button).toBeLessThan(guard);
	});

	it("write the hunt's Surplus, lost horses and weak herd from its card", () => {
		for (const cls of ["stonetop-aurochs-surplus", "stonetop-aurochs-horses", "stonetop-aurochs-weak"]) {
			expect(STEADING_JS, cls).toContain(cls);
			expect(STONETOP_JS, cls).toContain(`".${cls}"`);
		}
		expect(STONETOP_JS).toContain("_chatWireAurochsHunt(message, html);");
	});
});

describe("Deploy, as Book I has it", () => {
	it("reads 10+ as well as can be expected, and a 7-9 as a consequence someone picks", () => {
		const deploy = STEADING_JS.slice(STEADING_JS.indexOf('slug: "deploy"'), STEADING_JS.indexOf('slug: "deploy"') + 1200);
		expect(deploy).toContain("it goes as well as can be expected");
		expect(deploy).toContain("someone picks 1 from the list below");
		expect(deploy).not.toMatch(/choose 2/);
	});
});
