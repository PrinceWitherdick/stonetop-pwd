import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildLiveCharacter, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { companionHasUniqueTrait, companionUniqueTraitOwed } from "../../../module/actors/character/follower-masters.js";

// Level Up audit 2026-11-06:
//  - PBB-4 / L2: Veteran Crew, "Each time you take this move, pick 1. You can also choose to reselect their
//    Instinct and Cost" (Book I p.126). Offered after every take: the crew card opens with a note.
//  - PBB-5 / L3: Beast of Legend's "They develop some unique ability or trait" (Book I p.131): a cue on the
//    companion card until it is written down, and the card opens when the pick is made.

const sheetMod = await import("../../../module/actors/character/StonetopCharacterSheet.js");
const marshal  = name => sourceMovesFor("The Marshal").find(d => d.name === name);
const ranger   = name => sourceMovesFor("The Ranger").find(d => d.name === name);
const pick     = level => ({ stat: "", level });
const VC  = "Veteran Crew";
const BOL = "Beast of Legend";
const CREW = { name: "The Wolves", tags: ["brave"], instinct: "x", cost: "y" };

function sheetFor(char, actor) {
	actor.typedActor = char;
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const sheet = new (sheetMod.createStonetopCharacterSheetClass(Base))();
	sheet._stonetopCharacter = char;
	return sheet;
}

let savedUi;
beforeEach(() => {
	savedUi = globalThis.ui;
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
});
afterEach(() => { globalThis.ui = savedUi; });

describe("Veteran Crew: reselect their Instinct and Cost", () => {
	it("opens the crew card with a note after a take, for a crew that exists", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-marshal", name: "The Marshal", level: 2, flags: { crew: CREW } });
		await char.addMove(marshal(VC)._id);
		const sheet = sheetFor(char, actor);
		expect(await sheet._offerCrewReselect("Logistics")).toBe(false);
		expect(await sheet._offerCrewReselect(VC)).toBe(true);
		expect(sheet._editingSections.has("follower-card:crew:")).toBe(true);
		expect(sheet._activateTabOnRender).toBe("followers");
		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith(expect.stringMatching(/reselect their Instinct and Cost/));
	});

	it("says nothing for a crew never set up (Create your crew asks both)", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-marshal", name: "The Marshal", level: 2 });
		await char.addMove(marshal(VC)._id);
		expect(await sheetFor(char, actor)._offerCrewReselect(VC)).toBe(false);
		expect(globalThis.ui.notifications.info).not.toHaveBeenCalled();
	});

	it("is wired after a level-up, a Moves-tab tick and a cross-playbook pick (all through _afterMoveTaken)", () => {
		const src = readFileSync(new URL("../../../module/actors/character/StonetopCharacterSheet.js", import.meta.url), "utf8");
		expect(src).toContain("this._afterMoveTaken([addedMoveName, foreignMoveName])");
		expect(src).toContain("await this._afterMoveTaken(added.name)");
		expect(src).toContain("await this._afterMoveTaken(learned.name)");
	});
});

// One list of what taking a move owes, so every path asks the same (the Moves-tab tick and a
// cross-playbook pick used to skip the crew's tags and the companion's unique trait).
describe("_afterMoveTaken / _afterMarkTicked", () => {
	const OPENERS = ["_maybeOpenPossessionChoicesForMove", "_maybeOpenCompanionTraitsForMove", "_maybeOpenCrewTagsForMarks", "_offerCrewReselect", "_maybeOpenCompanionUniqueTrait"];
	function stubbed() {
		const { char, actor } = buildLiveCharacter({ slug: "the-marshal", name: "The Marshal", level: 2 });
		const sheet = sheetFor(char, actor);
		for (const m of OPENERS) sheet[m] = vi.fn(async () => false);
		return sheet;
	}

	it("asks the pouch for each move it is handed, and a follower opener only for its own move, skipping blanks", async () => {
		const sheet = stubbed();
		await sheet._afterMoveTaken(["Seasoned Warrior", null, VC, "Magnificent Specimen", BOL]);
		expect(sheet._maybeOpenPossessionChoicesForMove).toHaveBeenCalledTimes(4);
		for (const [m, name] of [["_maybeOpenCompanionTraitsForMove", "Magnificent Specimen"], ["_maybeOpenCrewTagsForMarks", VC], ["_offerCrewReselect", VC], ["_maybeOpenCompanionUniqueTrait", BOL]]) {
			expect(sheet[m]).toHaveBeenCalledTimes(1);
			expect(sheet[m]).toHaveBeenCalledWith(name);
		}
	});

	it("onboarding asks only the pouch's freed trait", async () => {
		const sheet = stubbed();
		await sheet._afterMoveTaken("Big Magic", { onboarding: true });
		expect(sheet._maybeOpenPossessionChoicesForMove).toHaveBeenCalledWith("Big Magic");
		for (const m of OPENERS.slice(1)) expect(sheet[m]).not.toHaveBeenCalled();
	});

	it("a ticked box opens what it owes, and only that box", async () => {
		const sheet = stubbed();
		await sheet._afterMarkTicked(VC, "tags");
		expect(sheet._maybeOpenCrewTagsForMarks).toHaveBeenCalledWith(VC);
		await sheet._afterMarkTicked(BOL, "unique");
		expect(sheet._maybeOpenCompanionUniqueTrait).toHaveBeenCalledWith(BOL);
		await sheet._afterMarkTicked(VC, "crew-hp");
		await sheet._afterMarkTicked(BOL, "tough");
		await sheet._afterMarkTicked("constructor", "tags");
		expect(sheet._maybeOpenCrewTagsForMarks).toHaveBeenCalledTimes(1);
		expect(sheet._maybeOpenCompanionUniqueTrait).toHaveBeenCalledTimes(1);
	});
});

describe("Beast of Legend: the unique ability or trait", () => {
	const rangerWith = (marks, companion = { type: "brute" }) => buildLiveCharacter({
		slug: "the-ranger", name: "The Ranger", level: 6,
		flags: { animalCompanion: companion, "moves.moveMarks": { [BOL]: marks } },
	});

	it("is owed while picked on a LEARNED copy and nothing is written on the card", async () => {
		const { char, actor } = rangerWith({ unique: [pick(6)] });
		expect(companionHasUniqueTrait(actor)).toBe(false);
		const bol = await char.addMove(ranger(BOL)._id);
		expect(companionHasUniqueTrait(actor)).toBe(true);
		expect(companionUniqueTraitOwed(actor, {})).toBe(true);
		expect(companionUniqueTraitOwed(actor, { moves: "Breathes fire" })).toBe(false);
		expect(companionUniqueTraitOwed(actor, { notes: "Speaks to the dead" })).toBe(false);
		await bol.setFlag(STONETOP_SCOPE, "learned", false);
		expect(companionUniqueTraitOwed(actor, {})).toBe(false);
	});

	it("another pick owes nothing", async () => {
		const { char, actor } = rangerWith({ tough: [pick(6)] });
		await char.addMove(ranger(BOL)._id);
		expect(companionUniqueTraitOwed(actor, {})).toBe(false);
	});

	it("the companion card carries the cue, and the sheet opens the card for it", async () => {
		const { char, actor } = rangerWith({ unique: [pick(6)] });
		await char.addMove(ranger(BOL)._id);
		await char.addMove(ranger("Animal Companion")._id);
		const sheet = sheetFor(char, actor);
		const snap = await char.buildSnapshot();
		const card = sheet._buildFollowersData(await char.playbook(), null, snap.crewBonuses, snap.companionBonuses).animalCompanion;
		expect(card.uniqueTraitOwed).toBe(true);
		expect(sheet._maybeOpenCompanionUniqueTrait("Magnificent Specimen")).toBe(false);
		expect(sheet._maybeOpenCompanionUniqueTrait(BOL)).toBe(true);
		expect(sheet._editingSections.has("follower-card:animal-companion:")).toBe(true);
		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith(expect.stringMatching(/unique ability or trait/));
		await actor.setFlag(STONETOP_SCOPE, "animalCompanion.details", { moves: "Its howl wakes the dead" });
		expect(sheetFor(char, actor)._maybeOpenCompanionUniqueTrait(BOL)).toBe(false);
	});

	it("is wired after a level-up, after a ticked pick, and on the card's cue", () => {
		const src = readFileSync(new URL("../../../module/actors/character/StonetopCharacterSheet.js", import.meta.url), "utf8");
		expect(src).toContain("[BEAST_OF_LEGEND,           [\"_maybeOpenCompanionUniqueTrait\"]]");
		expect(src).toContain("[`${BEAST_OF_LEGEND}:unique`,  \"_maybeOpenCompanionUniqueTrait\"]");
		expect(src).toContain("this._afterMarkTicked(moveName, markSlug)");
		expect(src).toContain(`html.find(".stonetop-companion-unique-owed")`);
		const hbs = readFileSync(new URL("../../../templates/actor/partials/tab-followers.hbs", import.meta.url), "utf8");
		expect(hbs).toContain("{{#if uniqueTraitOwed}}");
	});
});
