import { afterEach, describe, expect, it, vi } from "vitest";
import { expeditionUnderwayFor, levelUpAwayNote, tripUnderway } from "../../module/campaign/level-up-at-home.js";
import { LevelUpDialog } from "../../module/actors/character/dialogs/LevelUpDialog.js";

// Book I p.528: "PCs can't Level Up 'in the field.' They need to head home." But "don't be a stickler", so
// the Level Up window only says so. "Away" is a logged trip that has set out (Running the Journey) and has
// not reached its homecoming, with this character in its party.

const away = { id: "t1", title: "To the Delve", setOut: { season: "summer", year: 1 }, partyOut: { stayer: true } };
const home = { id: "t0", title: "", setOut: { season: "spring", year: 1 }, timelineRecorded: { season: "spring", year: 1 } };
const planned = { id: "t2", title: "Next one" };

describe("an expedition underway", () => {
	it("is a trip that set out and has not come home", () => {
		expect(tripUnderway(away)).toBe(true);
		expect(tripUnderway(home)).toBe(false);
		expect(tripUnderway(planned)).toBe(false);
	});

	it("names the trip a character is on, and not one they were left out of", () => {
		const log = { currentId: "t2", list: [home, away, planned] };
		expect(expeditionUnderwayFor("bram", log)).toEqual({ trip: away, label: "To the Delve" });
		expect(expeditionUnderwayFor("stayer", log)).toBeNull();
		expect(expeditionUnderwayFor("bram", { list: [home, planned] })).toBeNull();
		expect(expeditionUnderwayFor("bram", null)).toBeNull();
	});

	it("words the reminder with the trip's name, and says nothing at home", () => {
		const log = { list: [{ ...away, title: "" }] };
		expect(levelUpAwayNote({ id: "bram" }, log)).toContain("Expedition 1 has set out");
		expect(levelUpAwayNote({ id: "bram" }, { list: [home] })).toBe("");
	});
});

describe("the Level Up window", () => {
	const saved = global.game.settings;
	afterEach(() => { global.game.settings = saved; });

	const open = () => new LevelUpDialog({ _actor: { id: "bram" }, applyLevelUp: vi.fn() }, {
		level: 2, newLevel: 3, cost: 10, xpRemaining: 0, playbookName: "The Fox", needsInvocation: false,
		availableMoves: [], lockedMoves: [], availableInvocations: [], stats: [],
	}, vi.fn());

	it("warns on its first step while the character's trip is underway, and still lets them go on", () => {
		global.game.settings = { get: (_scope, key) => (key === "expeditionAnswers" ? { list: [away] } : undefined) };
		const ctx = open().getData();
		expect(ctx.awayWarning).toContain("To the Delve");
		expect(ctx.canContinue).toBe(true);
	});

	it("says nothing with no trip underway", () => {
		global.game.settings = { get: () => ({ list: [home] }) };
		expect(open().getData().awayWarning).toBe("");
	});
});
