import { describe, it, expect } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import {
	ritesOptions, RITES_MOVE, RITES_SEASON_STEP, FAVOR_PLAIN, FAVOR_WITH_SURPLUS,
} from "../../../module/actors/character/rites-of-the-land.js";

// Rites of the Land is two triggers in one move, and its effects land on three documents:
// Favor on the CHARACTER, Surplus and any cleared debility on the STEADING, and a promise of
// advantage on a +Fortunes roll that has not happened yet. That is why it is a walkthrough.

describe("ritesOptions", () => {
	it("offers the Surplus bargain only when the steading has a Surplus to give", () => {
		expect(ritesOptions({ surplus: 1 }).canSacrificeSurplus).toBe(true);
		expect(ritesOptions({ surplus: 0 }).canSacrificeSurplus).toBe(false);
	});

	it("names both amounts the move grants", () => {
		const o = ritesOptions({ surplus: 1, favorMax: 4 });
		expect(o.plainFavor).toBe(FAVOR_PLAIN);
		expect(o.surplusFavor).toBe(FAVOR_WITH_SURPLUS);
	});

	// "HOLD 1 Favor", not "gain 1" — the move SETS the track. A Blessed already sitting on more
	// than that would be knocked DOWN by overseeing without the Surplus, so they are warned
	// before they press it rather than after.
	it("warns when overseeing would cost a stocked Blessed their Favor", () => {
		expect(ritesOptions({ favorHeld: 3 }).wouldLoseFavor).toBe(true);
		expect(ritesOptions({ favorHeld: 1 }).wouldLoseFavor).toBe(false);
		expect(ritesOptions({ favorHeld: 0 }).wouldLoseFavor).toBe(false);
	});

	it("never offers more Favor than the track can hold", () => {
		const o = ritesOptions({ favorMax: 2, surplus: 5 });
		expect(o.surplusFavor).toBe(2);
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

	// The Favor track is a HOLD track, and the move says "hold N" — so it SETS rather than adds.
	it("sets the Favor track rather than adding to it", () => {
		expect(CHAR).toContain("async setRitesFavor(held)");
		const at = CHAR.indexOf("async setRitesFavor(held)");
		expect(CHAR.slice(at, at + 400)).toContain("Math.min(max,");
		expect(CHAR.slice(at, at + 400)).not.toMatch(/held\s*\+/);
	});

	it("marks the rites once per season", () => {
		expect(RITES).toContain("setSeasonStepApplied(RITES_SEASON_STEP, year, seasonId)");
		expect(RITES_SEASON_STEP).toBe("ritesOfTheLand");
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
	it("spends the hold on the next +Fortunes roll, and only that one", () => {
		const at = STEADING_SHEET.indexOf('statKey === "fortunes" ? this._stonetopSteading.fortunesAdvantage()');
		expect(at).toBeGreaterThan(-1);
		const block = STEADING_SHEET.slice(at, at + 700);
		expect(block).toContain('options.rollMode = "adv"');
		expect(block).toContain("clearFortunesAdvantage()");
		// After the debility branches, so nothing later quietly overrules it.
		expect(at).toBeGreaterThan(STEADING_SHEET.indexOf('stonetopDebilityTooltip = "Treat Prosperity as 1 lower."'));
	});

	it("names the reason on the card rather than leaving the advantage unexplained", () => {
		expect(STEADING_SHEET).toContain("options.conditionNotes");
		expect(read("module/utils/roll-engine.js")).toContain("options.conditionNotes");
		expect(read("styles/stonetop.css")).toContain(".stonetop-condition-note");
	});

	it("is styled", () => {
		const css = read("styles/stonetop.css");
		for (const rule of [".stonetop-rites-dialog-body", ".stonetop-rites-choice.is-picked", ".stonetop-rites-warn"]) {
			expect(css, rule).toContain(rule);
		}
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
