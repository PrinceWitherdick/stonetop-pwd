// Veteran Crew's "Go mark it now" (Book I p.125, the Scion: "You start with the Veteran Crew move...
// Go mark it now"). Onboarding's crew step asks the pick for each copy creation gives (the
// background's, and a free pick of it), the crew's tag count follows a "Select 2 new tags" pick, and
// the apply stores the picks as Veteran Crew's 1st-level marks, which a re-run replaces.

import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildLiveCharacter, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";
import {
	CREATION_MARK_MOVES, VETERAN_CREW_MOVE, creationMarkCopies, creationMarkCrewTags, creationMarksComplete, creationMarkRadios,
} from "../../../module/actors/character/dialogs/creation-marks.js";

const PACK = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const playbookDoc = slug => ({ ...structuredClone(PACK.get(slug)), uuid: `Compendium.test.${slug}` });
const vcId = () => sourceMovesFor("The Marshal").find(d => d.name === VETERAN_CREW_MOVE)._id;
const MARSHAL_STATS = { str: 2, dex: 0, con: 1, int: -1, wis: 0, cha: 1 };

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
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	sheet._openPossessionChoices = vi.fn();
	sheet._applyBackgroundNeighbors = vi.fn();
	return sheet;
}

function freshMarshal(level = 1) {
	const made = buildLiveCharacter({ slug: "the-marshal", name: "The Marshal", level, seedStartingMoves: false, stats: MARSHAL_STATS });
	return { ...made, sheet: sheetFor(made.char, made.actor) };
}

const vcMarks = actor => actor.getFlag("stonetop-pwd", "moves.moveMarks")?.[VETERAN_CREW_MOVE] ?? {};
const marked = actor => Object.entries(vcMarks(actor)).flatMap(([slug, v]) => (v ?? []).map(() => slug)).sort();

const run = (sheet, { backgroundSlug = "scion", moves = [], picks = [] } = {}) => sheet._applyPlaybookSelections(playbookDoc("the-marshal"), {
	backgroundSlug, stats: MARSHAL_STATS, moves, lore: { picks: {}, texts: {} },
	crew: { name: "", tags: ["athletic", "brave"], instinct: "To take needless risks", cost: "Merry-making, as a group" },
	creationMoveMarks: { [VETERAN_CREW_MOVE]: picks },
});

afterEach(() => { vi.restoreAllMocks(); });

describe("creation-marks.js", () => {
	it("lists Veteran Crew's options as the pack ships them", () => {
		const shipped = JSON.parse(readFileSync("packs/src/stonetop-items/playbook-moves/the-marshal/veteran-crew.json", "utf8"));
		const pick = o => ({ slug: o.slug, label: o.label, marks: o.marks, crewTags: o.crewTags ?? undefined });
		expect(CREATION_MARK_MOVES[VETERAN_CREW_MOVE].map(pick)).toEqual(shipped.system.markOptions.map(pick));
	});

	it("counts the background's copy and each free pick", () => {
		expect(creationMarkCopies(new Set([VETERAN_CREW_MOVE]), [VETERAN_CREW_MOVE, "Logistics"]))
			.toEqual([{ move: VETERAN_CREW_MOVE, copies: 2, fromBackground: true }]);
		expect(creationMarkCopies(new Set(), [VETERAN_CREW_MOVE])).toEqual([{ move: VETERAN_CREW_MOVE, copies: 1, fromBackground: false }]);
		expect(creationMarkCopies(new Set(["We Happy Few"]), [])).toEqual([]);
	});

	it("gives 2 crew tags for each copy that picked the tags", () => {
		expect(creationMarkCrewTags({ [VETERAN_CREW_MOVE]: ["tags", "crew-hp"] })).toBe(2);
		expect(creationMarkCrewTags({ [VETERAN_CREW_MOVE]: ["tags", "tags"] })).toBe(4);
		expect(creationMarkCrewTags({})).toBe(0);
	});

	it("wants a pick for every copy, and the damage die's one box only once", () => {
		expect(creationMarksComplete(VETERAN_CREW_MOVE, ["tags"], 1)).toBe(true);
		expect(creationMarksComplete(VETERAN_CREW_MOVE, ["tags", ""], 2)).toBe(false);
		expect(creationMarksComplete(VETERAN_CREW_MOVE, ["crew-damage", "crew-damage"], 2)).toBe(false);
		expect(creationMarksComplete(VETERAN_CREW_MOVE, ["nonsense"], 1)).toBe(false);
		const second = creationMarkRadios(VETERAN_CREW_MOVE, ["crew-damage", ""], 1, 2);
		expect(second.find(o => o.slug === "crew-damage").disabled).toBe(true);
		expect(second.find(o => o.slug === "tags").disabled).toBe(false);
	});
});

describe("the onboarding crew step", () => {
	const scionDialog = () => {
		const dialog = Object.create(CharacterOnboardingDialog.prototype);
		dialog._initializeState(playbookDoc("the-marshal"), null, null);
		dialog._applyBackgroundChange("scion");
		dialog._selections.crew = { name: "", tags: ["athletic", "brave"], instinct: "To take needless risks", cost: "Merry-making, as a group" };
		return dialog;
	};

	it("asks a Scion's pick, and waits for it", () => {
		const dialog = scionDialog();
		const [mark] = dialog._creationMarkData();
		expect(mark).toMatchObject({ move: VETERAN_CREW_MOVE, copy: 0 });
		expect(mark.label).toContain("from your background");
		expect(mark.options.map(o => o.slug)).toEqual(["tags", "crew-damage", "crew-hp"]);
		expect(dialog._isStepComplete("crew")).toBe(false);
		dialog._setCreationMark(VETERAN_CREW_MOVE, 0, "crew-hp");
		expect(dialog._isStepComplete("crew")).toBe(true);
	});

	it("asks nothing of a background without Veteran Crew", () => {
		const dialog = scionDialog();
		dialog._applyBackgroundChange("penitent");
		expect(dialog._creationMarkData()).toEqual([]);
		expect(dialog._crewTagLimit()).toBe(2);
	});

	it("'Select 2 new tags' raises the tag count to 4, and giving it up drops the newest tags", () => {
		const dialog = scionDialog();
		dialog._setCreationMark(VETERAN_CREW_MOVE, 0, "tags");
		expect(dialog._crewTagLimit()).toBe(4);
		expect(dialog._isStepComplete("crew")).toBe(false);
		dialog._toggleCrewTag("cunning", true);
		dialog._toggleCrewTag("hardy", true);
		expect(dialog._isStepComplete("crew")).toBe(true);
		dialog._setCreationMark(VETERAN_CREW_MOVE, 0, "crew-damage");
		expect(dialog._crewTagLimit()).toBe(2);
		expect(dialog._selections.crew.tags).toEqual(["athletic", "brave"]);
	});

	it("asks twice when the free pick is a second Veteran Crew", () => {
		const dialog = scionDialog();
		dialog._selections.moves = [VETERAN_CREW_MOVE];
		const marks = dialog._creationMarkData();
		expect(marks.map(m => m.copy)).toEqual([0, 1]);
		expect(marks[1].label).toContain("your free pick");
		dialog._setCreationMark(VETERAN_CREW_MOVE, 0, "tags");
		dialog._setCreationMark(VETERAN_CREW_MOVE, 1, "tags");
		expect(dialog._crewTagLimit()).toBe(6);
	});

	it("counts a re-run's bonus from later marks on top of its own picks", () => {
		const dialog = scionDialog();
		dialog._crewTagBonus = 2; // a level-up copy's "Select 2 new tags"
		dialog._setCreationMark(VETERAN_CREW_MOVE, 0, "tags");
		expect(dialog._crewTagLimit()).toBe(6);
	});
});

describe("the apply", () => {
	it("marks the Scion's pick at 1st level, and a re-run replaces it", async () => {
		const { actor, sheet } = freshMarshal();
		await run(sheet, { picks: ["crew-hp"] });
		expect(marked(actor)).toEqual(["crew-hp"]);
		expect(vcMarks(actor)["crew-hp"][0]).toMatchObject({ level: 1, creation: true });
		expect(sheet._readSelectionsFromActor(playbookDoc("the-marshal")).creationMoveMarks).toEqual({ [VETERAN_CREW_MOVE]: ["crew-hp"] });
		await run(sheet, { picks: ["tags"] });
		expect(marked(actor)).toEqual(["tags"]);
	});

	it("marks both copies when the free pick is the second Veteran Crew, and drops its pick when given back", async () => {
		const { actor, sheet } = freshMarshal();
		await run(sheet, { moves: [vcId()], picks: ["tags", "crew-hp"] });
		expect(actor.items.filter(i => i.name === VETERAN_CREW_MOVE)).toHaveLength(2);
		expect(marked(actor)).toEqual(["crew-hp", "tags"]);
		await run(sheet, { moves: [], picks: ["tags", "crew-hp"] });
		expect(marked(actor)).toEqual(["tags"]);
	});

	it("keeps a level-up's mark through a re-run, and leaves it out of onboarding's tag bonus", async () => {
		const { char, actor, sheet } = freshMarshal(3);
		await run(sheet, { picks: ["tags"] });
		await char.addMove(vcId());
		await actor.setFlag("stonetop-pwd", "moves.moveMarks", {
			[VETERAN_CREW_MOVE]: { ...vcMarks(actor), tags: [...vcMarks(actor).tags, { stat: "", level: 2 }] },
		});
		sheet._crewTagBonus = 4; // both "Select 2 new tags", as the sheet's crew stats read them
		expect(sheet._crewTagBonusBeyondCreation()).toBe(2);
		await run(sheet, { picks: ["crew-hp"] });
		expect(vcMarks(actor).tags).toEqual([{ stat: "", level: 2 }]);
		expect(vcMarks(actor)["crew-hp"]).toEqual([{ stat: "", level: 1, creation: true }]);
	});
});
