import { describe, it, expect, vi, afterEach } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import { StonetopSteading, SURPLUS_SEASON_STEP, REMINDER_SEASON_STEP } from "../../../module/actors/steading/StonetopSteading.js";
import { surplusRollFormula } from "../../../module/actors/steading/season-effects.js";
import { rollAdjustments, rollConditionNotes, STEADING_MOVE } from "../../../module/actors/steading/improvement-rolls.js";
import { meetWithDisaster, openDisasterPicker, disasterChoices, debilityPath } from "../../../module/actors/steading/steading-debilities.js";
import { postSeasonsRollPrompt } from "../../../module/utils/roll-engine.js";

// Spring, summer and autumn against Book I pp. 516-523 and the improvements that fire with them.
// Winter's own rules are winter-debt.test.js's and season-effects.test.js's.

const SHEET = read("module/actors/steading/StonetopSteadingSheet.js");

function steadingWith({ season = "autumn", year = 1, steading = {} } = {}) {
	const flags = {
		seasonsCurrent: season ? { season, year } : undefined,
		seasonsCurrentYear: year,
		steading: { system: { stats: { fortunes: { value: 2 } } }, ...steading },
	};
	return new StonetopSteading({
		type: "stonetop", system: {}, flags: { "stonetop-pwd": flags },
		getFlag: (scope, key) => (scope === "stonetop-pwd" ? flags[key] ?? null : null),
		setFlag: vi.fn(), update: vi.fn(),
	});
}

// ── The harvest comes at the END of autumn ──────────────────────────────────────
// "When the harvest is complete, roll 1d4" … "No, that roll comes at the end of the season."
describe("autumn's harvest", () => {
	it("is owed all autumn until its Surplus roll is made", () => {
		expect(steadingWith().harvestOwed(1, "autumn")).toBe(true);
		const rolled = steadingWith({ steading: { seasonSteps: { [SURPLUS_SEASON_STEP]: "1:autumn" } } });
		expect(rolled.harvestOwed(1, "autumn")).toBe(false);
	});

	it("is never owed outside autumn, nor by last year's roll", () => {
		expect(steadingWith().harvestOwed(1, "summer")).toBe(false);
		const lastYear = steadingWith({ steading: { seasonSteps: { [SURPLUS_SEASON_STEP]: "1:autumn" } } });
		expect(lastYear.harvestOwed(2, "autumn")).toBe(true);
	});

	it("wears a sheaf on the header while it waits", () => {
		const keys = steadingWith({ season: "autumn" }).holdsView().map(r => r.key);
		expect(keys).toContain("harvest");
		expect(steadingWith({ season: "summer" }).holdsView().map(r => r.key)).not.toContain("harvest");
	});

	it("is rolled from the header, the window, or winter's catch-up, all one way", () => {
		expect(SHEET).toContain(`"roll-harvest":       () => this._rollHarvestFromHeader()`);
		expect(SHEET).toContain(`step("harvestLate", "Autumn's harvest"`);
		// All three doors go through the one method, which asks before it rolls: the header, and
		// the window's two buttons through their one wiring.
		expect((SHEET.match(/this\._rollSeasonSurplus\(\{/g) ?? []).length).toBe(2);
		expect((SHEET.match(/wireSurplusBtn\(/g) ?? []).length).toBe(2);
		const at = SHEET.indexOf("async _rollSeasonSurplusOnce(");
		expect(SHEET.slice(at, at + 400)).toContain("promptSurplusRoll(");
	});

	// "If the harvest fails entirely, they don't get any Surplus (and they Meet With Disaster)."
	it("can fail outright: no Surplus, and the steading Meets with Disaster", () => {
		const at = SHEET.indexOf("async _rollSeasonSurplusOnce(");
		const body = SHEET.slice(at, at + 2000);
		expect(body).toContain("if (answer.failed)");
		expect(body).toContain("meetWithDisaster(steading");
		expect(body).toContain(`cause: "a failed harvest"`);
	});

	// The sheaf and winter's catch-up step can both be showing, and each was checked only when it
	// was drawn: the harvest could be taken twice.
	it("re-reads its marker when a door is pressed, and lets one roll through at a time", () => {
		const at = SHEET.indexOf("async _rollSeasonSurplus(");
		const body = SHEET.slice(at, SHEET.indexOf("async _rollSeasonSurplusOnce("));
		expect(body).toContain("if (steading.seasonStepApplied(SURPLUS_SEASON_STEP, year, seasonId))");
		expect(body).toContain("if (this._surplusRolling.has(key)) return false;");
		expect(body).toContain("this._surplusRolling.delete(key);");
	});
});

// ── What adjusts a Surplus roll ─────────────────────────────────────────────────
// A disrupted harvest (disadvantage and/or -1), Book II's storm (-2), crown (advantage) and Danu
// (disadvantage). A 1d4 has no third die, so advantage rolls the whole formula twice.
describe("surplusRollFormula", () => {
	it("leaves a plain roll as the season wrote it", () => {
		expect(surplusRollFormula("1d4 - 1")).toBe("1d4 - 1");
	});

	it("rolls twice and keeps the higher or the lower", () => {
		expect(surplusRollFormula("1d4", { rollMode: "adv" })).toBe("{1d4, 1d4}kh");
		expect(surplusRollFormula("1d4 + 1d4 + 1", { rollMode: "dis" })).toBe("{1d4 + 1d4 + 1, 1d4 + 1d4 + 1}kl");
	});

	it("adds the modifier on top", () => {
		expect(surplusRollFormula("1d4", { modifier: -1 })).toBe("1d4 - 1");
		expect(surplusRollFormula("1d4 - 1", { rollMode: "dis", modifier: -2 })).toBe("{1d4 - 1, 1d4 - 1}kl - 2");
	});
});

describe("meetWithDisaster", () => {
	function fake(fortunes, marked = [], population = 0) {
		return {
			getStatValue: key => (key === "population" ? population : fortunes),
			getSystemValue: path => marked.some(id => path === debilityPath(id)),
			applyChanges: vi.fn(async () => {}),
		};
	}
	const opened = [];
	afterEach(() => { opened.length = 0; delete globalThis.Dialog; });
	const stubDialog = () => {
		globalThis.Dialog = class { constructor(data) { this.data = data; opened.push(this); } render() {} };
	};

	it("takes a Fortune above the floor", async () => {
		const s = fake(1);
		const out = await meetWithDisaster(s, { stonetopMove: "Seasons Change" });
		expect(out).toEqual({ fortunes: 0, disaster: false });
		expect(s.applyChanges).toHaveBeenCalledWith(
			{ system: { "stats.fortunes.value": 0 }, flags: {} }, { stonetopMove: "Seasons Change" });
	});

	// A failed harvest closes its Surplus step in the same write as the Fortune it costs.
	it("carries a step marker in that one write", async () => {
		const s = fake(1);
		await meetWithDisaster(s, { alsoFlags: { seasonSteps: { surplus: "1:autumn" } } });
		expect(s.applyChanges).toHaveBeenCalledTimes(1);
		expect(s.applyChanges.mock.calls[0][0].flags).toEqual({ seasonSteps: { surplus: "1:autumn" } });
	});

	// At −1 the step marker has closed the harvest by the time the pick opens, and the pick has no
	// Cancel but can still be shut. The owed pick rides that same write so it is never just lost.
	it("records the pick as owed at the floor, in the write that caused it", async () => {
		stubDialog();
		const s = fake(-1);
		const out = await meetWithDisaster(s, { cause: "a failed harvest", alsoFlags: { seasonSteps: { surplus: "1:autumn" } } });
		expect(out.disaster).toBe(true);
		expect(s.applyChanges).toHaveBeenCalledTimes(1);
		expect(s.applyChanges.mock.calls[0][0]).toEqual({
			system: {},
			flags: { seasonSteps: { surplus: "1:autumn" }, disasterOwed: { cause: "a failed harvest", season: null } },
		});
		expect(opened).toHaveLength(1);
	});

	it("pays the owed pick and clears it in one write", async () => {
		stubDialog();
		const s = fake(-1);
		openDisasterPicker(s, { settlesOwed: true });
		const { buttons, render } = opened[0].data;
		// Pick "Diminished", as the row click would, then commit from the footer.
		const row = { dataset: { choice: "diminished" }, classList: { toggle() {} }, setAttribute() {}, addEventListener(type, fn) { if (type === "click") this.click = fn; } };
		render({ querySelectorAll: () => [row] });
		row.click();
		await buttons.apply.callback();
		expect(s.applyChanges).toHaveBeenCalledWith(
			{ system: { [debilityPath("diminished")]: true }, flags: { disasterOwed: null } },
			{ stonetopMove: "Meet with Disaster" });
	});

	// Marking a debility already marked writes true over true: a disaster that costs nothing.
	it("offers only the debilities not already marked", () => {
		expect(disasterChoices(fake(-1)).map(c => c.id)).toEqual(["diminished", "lacking", "malcontent", "population"]);
		expect(disasterChoices(fake(-1, ["diminished", "malcontent"])).map(c => c.id)).toEqual(["lacking", "population"]);
	});

	// Population stops at -1, so "folks start to leave" there writes -1 over -1: free as well.
	it("leaves out the Population once it is at -1", () => {
		expect(disasterChoices(fake(-1, [], -1)).map(c => c.id)).toEqual(["diminished", "lacking", "malcontent"]);
		expect(disasterChoices(fake(-1, ["lacking"], 0)).map(c => c.id)).toEqual(["diminished", "malcontent", "population"]);
	});

	it("opens no window when nothing is left to take, and pays off an owed pick", async () => {
		stubDialog();
		const s = fake(-1, ["diminished", "lacking", "malcontent"], -1);
		const onApplied = vi.fn();
		expect(openDisasterPicker(s, { settlesOwed: true, onApplied })).toBeNull();
		expect(opened).toHaveLength(0);
		expect(s.applyChanges).toHaveBeenCalledWith({ flags: { disasterOwed: null } });
		await Promise.resolve();
		expect(onApplied).toHaveBeenCalled();
		// The Moves tab's own pick owes nothing, so there is nothing to write.
		const own = fake(-1, ["diminished", "lacking", "malcontent"], -1);
		openDisasterPicker(own);
		expect(own.applyChanges).not.toHaveBeenCalled();
	});

	it("is waiting on the header while it is owed", () => {
		const owed = steadingWith({ steading: { disasterOwed: { cause: "winter's shortfall" } } });
		expect(owed.disasterOwed()).toEqual({ cause: "winter's shortfall", season: null });
		// The Seasons Change it was met in comes back with it, for the pick made later.
		const season = { seasonId: "winter", year: 2, title: "Winter's shortfall" };
		expect(steadingWith({ steading: { disasterOwed: { cause: "x", season } } }).disasterOwed().season).toEqual(season);
		const row = owed.holdsView().find(r => r.key === "disasterOwed");
		expect(row.action).toBe("meet-disaster-owed");
		expect(row.tooltip).toContain("winter's shortfall");
		expect(steadingWith().disasterOwed()).toBeNull();
		expect(SHEET).toContain(`"meet-disaster-owed": () => openOwedDisasterPicker(this._stonetopSteading`);
	});

	// The Moves tab's own Meet with Disaster goes through the same helper, so the ledger names it.
	it("is the one write path for the Moves tab's move too", () => {
		const at = SHEET.indexOf("async _onMeetWithDisaster()");
		const body = SHEET.slice(at, SHEET.indexOf("async _onReturnTriumphant()"));
		expect(body).toContain("await meetWithDisaster(this._stonetopSteading");
		expect(body).not.toContain(`setSystemValue("stats.fortunes.value"`);
	});
});

// ── Tor's blessing ──────────────────────────────────────────────────────────────
// "Take +1 to Pull Together this season, and any time you roll the Die of Fate for weather, roll
// twice and take your pick."
describe("Tor's blessing", () => {
	it("adds +1 to Pull Together, and names it on the card", () => {
		const adj = rollAdjustments({ moveName: STEADING_MOVE.PULL_TOGETHER, statKey: "population", torsBlessing: true });
		expect(adj.bonus).toBe(1);
		expect(adj.statBonus).toBe(0);
		expect(rollConditionNotes(adj)).toContain("Tor's blessing: +1");
	});

	it("adds nothing to any other move, or with no blessing", () => {
		expect(rollAdjustments({ moveName: STEADING_MOVE.MUSTER, statKey: "population", torsBlessing: true }).bonus).toBe(0);
		expect(rollAdjustments({ moveName: STEADING_MOVE.PULL_TOGETHER, statKey: "population" }).bonus).toBe(0);
	});

	it("reaches the roll through the steading's own hold", () => {
		expect(read("module/actors/steading/steading-roll.js")).toContain("torsBlessing: !!steading.torsBlessingActive?.()");
		expect(SHEET).toContain("situational + (adjusted.bonus ?? 0)");
	});

	// The move's own window lists what the card will add, so the preview and the result agree.
	it("is named in Pull Together's window before the roll", () => {
		const at = SHEET.indexOf("_onHomesteadMove(moveSlug) {");
		const body = SHEET.slice(at, at + 2600);
		expect(body).toContain("torsBlessing: !!this._stonetopSteading.torsBlessingActive?.(),");
		expect(body).toContain("...standing.notes.map(note => `${note} on this roll.`),");
	});

	// Said as the roll plan's hint (utils/weather.js), which the blessing chooses; the roll itself
	// is tests/dialogs/weather-pick.test.js's business.
	it("is said in the weather window, where the Die of Fate is rolled", () => {
		expect(read("templates/dialogs/weather.hbs")).toContain("{{#if rollHint}}");
		expect(read("module/dialogs/WeatherDialog.js")).toContain("weatherRollPlan({ blessing: this._torsBlessing()");
	});
});

// ── The herd's foals, off the Fortunes summer opened with ───────────────────────
// "When the Seasons Change to summer … foals equal to 1d4+Fortunes": with the move, before its
// reset, where the herd's button (after the reset) would otherwise always read +1.
describe("StonetopSteading#openingFortunes", () => {
	it("notes the Fortunes once a season, and keeps the first", () => {
		const s = steadingWith({ season: "summer" });
		expect(s.openingFortunes(1, "summer")).toBeNull();
		expect(s.openingFortunesFlags(1, "summer")).toEqual({ seasonOpeningFortunes: { stamp: "1:summer", value: 2 } });

		const noted = steadingWith({ season: "summer", steading: { seasonOpeningFortunes: { stamp: "1:summer", value: 3 } } });
		expect(noted.openingFortunes(1, "summer")).toBe(3);
		expect(noted.openingFortunesFlags(1, "summer")).toEqual({});
	});

	it("reads nothing for another season", () => {
		const noted = steadingWith({ steading: { seasonOpeningFortunes: { stamp: "1:spring", value: 3 } } });
		expect(noted.openingFortunes(1, "summer")).toBeNull();
	});

	it("is what the herd's growth rolls off", () => {
		expect(SHEET).toContain("this._advanceHerdSummer(steading.openingFortunes(year, seasonId))");
	});

	// Noted when the roll is made (or handed over), or by the reset, and never by opening the
	// window: one opened early to look would lock in a mid-play figure.
	it("is noted with the roll, not when the window opens", () => {
		const open = SHEET.indexOf("async _showSeasonDialog(");
		expect(SHEET.slice(open, open + 1600)).not.toContain("openingFortunesFlags(");
		const withRoll = `await steading.setFlags({ ...opening, ...steading.seasonStepFlags("fortunesRoll", year, seasonId) });`;
		expect(SHEET.split(withRoll).length - 1).toBe(2);
		const reset = SHEET.indexOf("resetFortunesBtn?.addEventListener(\"click\"");
		expect(SHEET.slice(reset, reset + 2400)).toContain("...steading.openingFortunesFlags(year, seasonId),");
	});
});

// ── Spring's handed-over roll takes what the others take ────────────────────────
describe("spring's hand-off", () => {
	const created = [];
	afterEach(() => { created.length = 0; delete globalThis.ChatMessage; });

	it("carries the GM's modifier and a forced 6- onto the card", () => {
		globalThis.ChatMessage = { create: vi.fn(data => { created.push(data); return data; }) };
		postSeasonsRollPrompt({ fortunes: 1, modifier: 2, countsAsMiss: "a storm <curse>" });
		const html = created[0].content;
		expect(html).toContain(`data-mod="2"`);
		// Escaped into the attribute; the button's dataset reads it back decoded.
		expect(html).toContain(`data-counts-as-miss="a storm &lt;curse&gt;"`);
		expect(html).toContain("Roll +Fortunes (+1) +2");
	});

	it("asks the GM before handing it over", () => {
		const at = SHEET.indexOf("data-action='ask-hopeful'");
		const body = SHEET.slice(at, at + 2600);
		expect(body).toContain("promptRoll({ title: \"Seasons Change: Spring\", askModifier: true, offers: [stormMiss] })");
		expect(body).toContain("modifier: prompted.situational");
	});

	it("is rolled with both by the chat button", () => {
		const boot = read("stonetop.js");
		expect(boot).toContain("btn.dataset.countsAsMiss");
		expect(boot).toContain("countsAsMiss,");
	});
});

// ── The small ones ──────────────────────────────────────────────────────────────
describe("the window's guard rails", () => {
	// "After the roll, reset Fortunes": taken first, the roll would be made off the reset's +1. But
	// the roll can be made from the Moves tab or a player's card, which this window cannot see, so
	// the reset is never locked: it asks, and a yes closes the roll here too.
	it("asks before a reset this window has not seen the roll for", () => {
		expect(SHEET).toContain("function refreshResetLock()");
		const at = SHEET.indexOf("function refreshResetLock()");
		const body = SHEET.slice(at, at + 3200);
		expect(body).not.toContain("resetFortunesBtn.disabled = !rolled");
		expect(body).toContain("const madeElsewhere = await confirmOutcome({");
		expect(body).toContain("if (!rolled) flags.seasonSteps.fortunesRoll = `${year}:${seasonId}`;");
		expect(body).toContain("if (!rolled) fortunesRollBtns.forEach(b => { b.disabled = true; });");
	});

	it("warns when more gains are ticked than the roll picks", () => {
		expect(SHEET).toContain("data-season-gains-over");
		expect(SHEET).toContain(`const gainsMax = seasonId === "summer" ? 2 : 1;`);
	});

	it("posts the upkeep reminder once a season, however often the window opens", () => {
		expect(REMINDER_SEASON_STEP).toBe("reminderPosted");
		expect(SHEET).toContain("if (!reminded) postSeasonsChangeReminder(seasonId);");
	});
});
