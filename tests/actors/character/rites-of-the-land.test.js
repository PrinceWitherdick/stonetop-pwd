import { describe, it, expect, vi } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import {
	ritesOptions, RITES_MOVE, RITES_SEASON_STEP, BOON_PLAIN, BOON_WITH_SURPLUS,
	ritesSeasonStep, overseeRites,
} from "../../../module/actors/character/rites-of-the-land.js";
import { StonetopSteading } from "../../../module/actors/steading/StonetopSteading.js";

// Rites of the Land is two triggers in one move, and its effects land on three documents:
// The Boon on the CHARACTER, Surplus and any cleared debility on the STEADING, and a promise of
// advantage on a +Fortunes roll that has not happened yet. That is why it is a walkthrough.

describe("ritesOptions", () => {
	it("offers the Surplus bargain only when the steading has a Surplus to give", () => {
		expect(ritesOptions({ surplus: 1 }).canSacrificeSurplus).toBe(true);
		expect(ritesOptions({ surplus: 0 }).canSacrificeSurplus).toBe(false);
	});

	it("names both amounts the move grants", () => {
		const o = ritesOptions({ surplus: 1, boonMax: 4 });
		expect(o.plainBoon).toBe(BOON_PLAIN);
		expect(o.surplusBoon).toBe(BOON_WITH_SURPLUS);
	});

	// "HOLD 1 Boon", not "gain 1" — the move SETS the track. A Blessed already sitting on more
	// than that would be knocked DOWN by overseeing without the Surplus, so they are warned
	// before they press it rather than after.
	it("warns when overseeing would cost a stocked Blessed their Boon", () => {
		expect(ritesOptions({ boonHeld: 3 }).wouldLoseBoon).toBe(true);
		expect(ritesOptions({ boonHeld: 1 }).wouldLoseBoon).toBe(false);
		expect(ritesOptions({ boonHeld: 0 }).wouldLoseBoon).toBe(false);
	});

	it("never offers more Boon than the track can hold", () => {
		const o = ritesOptions({ boonMax: 2, surplus: 5 });
		expect(o.surplusBoon).toBe(2);
	});

	it("reports the rites already overseen this season", () => {
		expect(ritesOptions({ ritesDone: true }).ritesDone).toBe(true);
	});

	it("lists only the debilities actually marked", () => {
		expect(ritesOptions({ debilities: [] }).marked).toEqual([]);
		expect(ritesOptions({ debilities: ["lacking", "malcontent"] }).marked.map(d => d.id))
			.toEqual(["lacking", "malcontent"]);
		// Order follows the book's, not the caller's.
		expect(ritesOptions({ debilities: ["malcontent", "diminished"] }).marked.map(d => d.id))
			.toEqual(["diminished", "malcontent"]);
	});
});

describe("how it is wired", () => {
	const SHEET = read("module/actors/character/StonetopCharacterSheet.js");
	const CHAR = read("module/actors/character/StonetopCharacter.js");
	const STEADING = read("module/actors/steading/StonetopSteading.js");
	const STEADING_SHEET = read("module/actors/steading/StonetopSteadingSheet.js");
	const RITES = read("module/actors/character/rites-of-the-land.js");

	it("opens from the move's own name-click", () => {
		expect(SHEET).toContain("[RITES_OF_THE_LAND]:  sheet => sheet._openRitesOfTheLand()");
		expect(SHEET).toContain("_openRitesOfTheLand()");
	});

	// The Boon track is a HOLD track, and the move says "hold N" — so it SETS rather than adds.
	it("sets the Boon track rather than adding to it", () => {
		expect(CHAR).toContain("async setRitesBoon(held)");
		const at = CHAR.indexOf("async setRitesBoon(held)");
		expect(CHAR.slice(at, at + 400)).toContain("Math.min(max,");
		expect(CHAR.slice(at, at + 400)).not.toMatch(/held\s*\+/);
	});

	it("marks the rites once per season, per overseer", () => {
		expect(RITES).toContain("setSeasonStepApplied(step, year, seasonId)");
		expect(RITES).toContain("steading.seasonStepApplied(step, year, seasonId)");
		expect(RITES).not.toContain("seasonStepApplied(RITES_SEASON_STEP");
		expect(RITES_SEASON_STEP).toBe("ritesOfTheLand");
		expect(SHEET).toContain("actorId: this.actor.id,");
	});

	// The promise outlives the window it was made in, so it is written on the steading — the one
	// document both the sacrificing character and the later roll can see.
	it("holds the Fortunes advantage on the steading", () => {
		expect(STEADING).toContain("async holdFortunesAdvantage(source)");
		expect(STEADING).toContain("async clearFortunesAdvantage()");
		expect(RITES).toContain("holdFortunesAdvantage(");
	});

	// Applied LAST so it beats the sticky selector and the pre-roll prompt: it is a rule the
	// fiction already settled, not a preference. And SPENT here, because this is the roll it was
	// promised to — a hold that survived would apply to every Fortunes roll afterwards.
	// The hold is one more SOURCE of advantage (improvement-rolls.js#rollAdjustments), netted like
	// every other: a GM-imposed disadvantage on the same roll cancels it, as the book has it.
	// Settled for every steading roll in one place (steading-roll.js, and its own test file).
	it("spends the hold on the next +Fortunes roll, and only that one", () => {
		const settle = read("module/actors/steading/steading-roll.js");
		expect(settle).toContain('statKey === "fortunes" && canSpend ? steading.fortunesAdvantage');
		expect(settle).toContain('held: held?.source ?? ""');
		expect(settle).toContain("netRollMode(");
		expect(settle).toContain("clearFortunesAdvantage()");
		const at = STEADING_SHEET.indexOf("async _onSteadingRoll(moveName, statKey");
		expect(STEADING_SHEET.slice(at, at + 4000)).toContain("settleSteadingRoll(this._stonetopSteading");
	});

	it("names the reason on the card rather than leaving the advantage unexplained", () => {
		expect(STEADING_SHEET).toContain("options.conditionNotes");
		expect(read("module/utils/roll-engine.js")).toContain("options.conditionNotes");
		expect(read("styles/stonetop.css")).toContain(".stonetop-condition-note");
	});

	it("is styled", () => {
		const css = read("styles/stonetop.css");
		for (const rule of [".stonetop-rites-dialog-body", ".stonetop-rites-warn"]) {
			expect(css, rule).toContain(rule);
		}
		// The sacrifice list is the SHARED picker's, so it wears the shared chrome and this file
		// carries no rules of its own for it. A `.stonetop-rites-choice` block coming back would
		// mean the window had gone back to hand-building its own rows.
		expect(css).not.toContain(".stonetop-rites-choice");
		expect(css).toContain(".stonetop-disaster-choice.is-selected");
	});

	it("still opens for a Blessed whose world has no steading yet", () => {
		// Anchored on the DECLARATION: the name reads as a dispatch entry further up the file,
		// and matching that one slices the wrong 700 characters.
		const at = SHEET.indexOf("\n\t\t_openRitesOfTheLand() {");
		expect(at, "the _openRitesOfTheLand declaration").toBeGreaterThan(-1);
		const body = SHEET.slice(at, at + 700);
		expect(body).toContain("steadingActor ? new StonetopSteading(steadingActor) : null");
		expect(RITES).toContain("if (!character) return;");
	});

	it("names the move once, where both halves read it", () => {
		expect(RITES_MOVE).toBe("Rites of the Land");
	});
});

// "Once per season" is per character (user ruling). The marker used to be one key on the
// steading, so a second owner of the move (a second Blessed, or a Versatile / Worldly pick) was
// told "Already overseen" for rites they had never held.
describe("once per season, per overseer", () => {
	// A steading whose flag writes land where its reads look, so a second oversight sees the first.
	function liveSteading({ surplus = 2, seasonSteps = {} } = {}) {
		const actor = {
			type: "stonetop",
			system: { attributes: { surplus: { value: surplus } } },
			flags: { "stonetop-pwd": { steading: { seasonSteps: { ...seasonSteps } } } },
			getFlag(scope, key) { return this.flags[scope]?.[key]; },
			async setFlag(scope, key, value) { this.flags[scope][key] = value; },
			update: vi.fn(async function (data) {
				for (const [path, value] of Object.entries(data)) {
					const keys = path.split(".");
					const last = keys.pop();
					keys.reduce((node, k) => (node[k] ??= {}), actor)[last] = value;
				}
			}),
		};
		return new StonetopSteading(actor);
	}
	const character = () => ({ setRitesBoon: vi.fn(async () => {}) });
	const state = ritesOptions({ surplus: 2, boonMax: 4 });
	const at = { year: 2, seasonId: "summer" };

	it("keys the marker by the overseer's actor", () => {
		expect(ritesSeasonStep("abc")).toBe("ritesOfTheLand:abc");
	});

	it("closes the rites for the one who oversaw them and nobody else", async () => {
		const steading = liveSteading();
		await overseeRites({ character: character(), steading, step: ritesSeasonStep("gwynn"), ...at, withSurplus: false, state });
		expect(steading.seasonStepApplied(ritesSeasonStep("gwynn"), 2, "summer")).toBe(true);
		expect(steading.seasonStepApplied(ritesSeasonStep("wren"), 2, "summer")).toBe(false);
	});

	it("closes it the same way when the Surplus is sacrificed", async () => {
		const steading = liveSteading();
		const who = character();
		await overseeRites({ character: who, steading, step: ritesSeasonStep("wren"), ...at, withSurplus: true, state });
		expect(steading.getStatValue("surplus")).toBe(1);
		expect(who.setRitesBoon).toHaveBeenCalledWith(BOON_WITH_SURPLUS);
		expect(steading.seasonStepApplied(ritesSeasonStep("wren"), 2, "summer")).toBe(true);
		expect(steading.seasonStepApplied(ritesSeasonStep("gwynn"), 2, "summer")).toBe(false);
	});

	// A marker written before the key was per character names nobody, so it blocks nobody.
	it("reads an old, un-keyed marker as nobody's", () => {
		const steading = liveSteading({ seasonSteps: { [RITES_SEASON_STEP]: "2:summer" } });
		expect(steading.seasonStepApplied(ritesSeasonStep("gwynn"), 2, "summer")).toBe(false);
	});
});
