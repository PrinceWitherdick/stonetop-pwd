// The 11-06 Level Up audit, PBA slice (Blessed, Lightbearer), fixes L1, L9 and C3's onboarding side:
//   · L1: Big Magic's extra remarkable trait (Book I p.106) says it is still owed, on the move card
//     and the pouch row, once its editor has been closed.
//   · L9: re-running onboarding counts a free-pick Big Magic once, not twice, and the apply holds
//     the pouch's traits to 1 + Big Magic.
//   · C3: a Lightbearer made above 1st level is asked for the Invocations of the even levels already
//     reached (p.146: "you start knowing 2 Invocations. Each time you reach an even-numbered level,
//     learn 1 new Invocation").

import { describe, expect, it, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { readRepo } from "../../fakes/css.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { CREATION_PICK_FLAG } from "../../../module/actors/character/StonetopCharacter.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";
import { attachPossessionChoicesOwed, possessionChoicesOwedView } from "../../../module/actors/character/possession-choices-owed.js";

const SCOPE = "stonetop-pwd";
const POUCH = "sacred-pouch";
const PACK = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const playbookDoc = slug => ({ ...structuredClone(PACK.get(slug)), uuid: `Compendium.test.${slug}` });
const blessedMove = name => sourceMovesFor("The Blessed").find(d => d.name === name);
const moveItem = (name, flags = {}) => makeLiveItem({ name, type: "move", system: structuredClone(blessedMove(name).system), flags });
const TRAITS = ["trait-indestructible", "trait-unnoticed", "trait-sealed", "trait-unclean"];

function blessed({ traits = [], items = [], level = 2 } = {}) {
	return buildLiveCharacter({
		slug: "the-blessed", name: "The Blessed", level, items,
		flags: { "possessions.subChoices": { [POUCH]: ["origin-heirloom", ...traits] } },
	});
}

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

describe("L1: Big Magic's owed remarkable trait", () => {
	it("is owed while the pouch has fewer traits than 1 + Big Magic", async () => {
		const { char } = blessed({ traits: [TRAITS[0]], items: [moveItem("Big Magic")] });
		const owed = char.possessionChoicesOwed(await char.playbook());
		expect(owed).toEqual({ byMove: { "Big Magic": { slug: POUCH, count: 1 } }, bySlug: { [POUCH]: 1 } });
	});

	it("is not owed once the trait is picked, nor for a Blessed without Big Magic", async () => {
		const done = blessed({ traits: TRAITS.slice(0, 2), items: [moveItem("Big Magic")] }).char;
		expect(done.possessionChoicesOwed(await done.playbook())).toEqual({ byMove: {}, bySlug: {} });
		const plain = blessed({ traits: [] }).char;
		expect(plain.possessionChoicesOwed(await plain.playbook())).toEqual({ byMove: {}, bySlug: {} });
	});

	it("counts only a LEARNED Big Magic, and two of them owe two", async () => {
		const off = blessed({ traits: [TRAITS[0]], items: [moveItem("Big Magic", { [SCOPE]: { learned: false } })] }).char;
		expect(off.possessionChoicesOwed(await off.playbook()).bySlug).toEqual({});
		const two = blessed({ traits: [TRAITS[0]], items: [moveItem("Big Magic"), moveItem("Big Magic")] }).char;
		expect(two.possessionChoicesOwed(await two.playbook()).byMove["Big Magic"]).toEqual({ slug: POUCH, count: 2 });
	});

	it("says it in words a screen reader speaks", () => {
		const view = possessionChoicesOwedView({ byMove: { "Big Magic": { slug: POUCH, count: 1 } }, bySlug: { [POUCH]: 2 } });
		expect(view.byMove["Big Magic"]).toMatchObject({ slug: POUCH, count: 1,
			label: "Big Magic: your sacred pouch has 1 more remarkable trait to choose. Choose it now." });
		expect(view.bySlug[POUCH]).toMatchObject({ count: 2, label: "Choose 2 more traits" });
		expect(possessionChoicesOwedView({ byMove: {}, bySlug: { [POUCH]: 1 } }).bySlug[POUCH].label).toBe("Choose 1 more trait");
	});

	it("rides on the move card and the possession row it belongs to, null elsewhere", () => {
		const view = possessionChoicesOwedView({ byMove: { "Big Magic": { slug: POUCH, count: 1 } }, bySlug: { [POUCH]: 1 } });
		const moves = [{ name: "Big Magic" }, { name: "Seasoned Warrior", possessionChoiceOwed: { stale: true } }, null];
		const rows = [{ slug: POUCH }, { slug: "other" }];
		attachPossessionChoicesOwed(moves, rows, view);
		expect(moves[0].possessionChoiceOwed).toBe(view.byMove["Big Magic"]);
		expect(moves[1].possessionChoiceOwed).toBeNull();
		expect(rows[0].choicesOwed).toBe(view.bySlug[POUCH]);
		expect(rows[1].choicesOwed).toBeNull();
	});

	it("is on the move card and the pouch row, as a keyboard button that opens the add-only editor", () => {
		const card = readRepo("templates/actor/partials/move-group.hbs");
		expect(card).toContain("stonetop-move-possession-choice-needed");
		expect(card).toMatch(/data-possession-choices-owed="[^"]+"[^>]*aria-label="[^"]+"[^>]*role="button" tabindex="0"/);
		const gear = readRepo("templates/actor/partials/tab-equipment.hbs");
		expect(gear).toMatch(/class="stonetop-possession-choices-owed" role="button" tabindex="0" data-possession-choices-owed=/);
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toContain("attachPossessionChoicesOwed(_movelistMoves(context.stonetop.movelist),");
		expect(card).toContain("{{this.possessionChoiceOwed.label}}");
		expect(gear).toContain("{{this.choicesOwed.label}}");
		expect(sheet).toContain("this._openPossessionChoices(cue.dataset.possessionChoicesOwed, { addOnly: true });");
	});
});

describe("L9: a free-pick Big Magic counts once on a re-run of onboarding", () => {
	const bigMagicId = blessedMove("Big Magic")._id;
	function onboarding({ owned = {}, restored = {}, moves = [], cache = true } = {}) {
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(playbookDoc("the-blessed"), null, null);
		if (cache) d._movesCache = sourceMovesFor("The Blessed").map(doc => ({ id: doc._id, name: doc.name, system: doc.system }));
		d._ownedMoveCounts = owned;
		d._restoredPickCounts = restored;
		d._selections.moves = moves;
		return d;
	}

	it("counts the restored pick from the selection, by id or still by name", () => {
		expect(onboarding({ owned: { "Big Magic": 1 }, restored: { "Big Magic": 1 }, moves: [bigMagicId] })._effectiveMoveCounts()["Big Magic"]).toBe(1);
		expect(onboarding({ owned: { "Big Magic": 1 }, restored: { "Big Magic": 1 }, moves: ["Big Magic"], cache: false })._effectiveMoveCounts()["Big Magic"]).toBe(1);
	});

	it("drops to 0 when the re-run lets the pick go, and keeps a level-up copy", () => {
		expect(onboarding({ owned: { "Big Magic": 1 }, restored: { "Big Magic": 1 } })._effectiveMoveCounts()["Big Magic"]).toBe(0);
		expect(onboarding({ owned: { "Big Magic": 2 }, restored: { "Big Magic": 1 }, moves: [bigMagicId] })._effectiveMoveCounts()["Big Magic"]).toBe(2);
	});

	it("the sheet hands onboarding the free picks it restores", async () => {
		const pick = moveItem("Big Magic", { [SCOPE]: { [CREATION_PICK_FLAG]: true } });
		const levelUp = moveItem("Big Magic");
		const { char, actor } = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", level: 3, items: [pick, levelUp] });
		const sheet = sheetFor(char, actor);
		expect(sheet._restoredPickCounts(playbookDoc("the-blessed"))).toEqual({ "Big Magic": 1 });
		expect(readRepo("module/actors/character/StonetopCharacterSheet.js").match(/restoredPickCounts: this\._restoredPickCounts\(playbookDoc\)/g)).toHaveLength(2);
	});

	it("the apply holds the pouch's traits to 1 + Big Magic", async () => {
		const { char, actor } = blessed({ items: [moveItem("Big Magic")] });
		await char.setPossessionSubChoices(POUCH, ["origin-heirloom", ...TRAITS.slice(0, 3)]);
		const traits = (actor.getFlag(SCOPE, "possessions.subChoices")?.[POUCH] ?? []).filter(s => TRAITS.includes(s));
		expect(traits).toEqual(TRAITS.slice(0, 2));
		// The flavour lines are radios with no move bonus: left alone.
		expect(actor.getFlag(SCOPE, "possessions.subChoices")[POUCH]).toContain("origin-heirloom");
	});
});

describe("C3: a Lightbearer made above 1st level is owed its even levels' Invocations", () => {
	function step(level, { learned = [], chosen = [] } = {}) {
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(playbookDoc("the-lightbearer"), null, null);
		d._characterLevel = level;
		d._selections.invocations = chosen;
		d._selections.learnedInvocations = learned;
		return d;
	}

	it("asks for 2 at 1st level, 2 + 1 per even level above it, never more than the ten", () => {
		expect(step(1)._invocationPickCount()).toBe(2);
		expect(step(2)._invocationPickCount()).toBe(3);
		expect(step(5)._invocationPickCount()).toBe(4);
		expect(step(20)._invocationPickCount()).toBe(10);
	});

	it("counts the ones a level-up taught, kept on a re-run, toward that number", () => {
		expect(step(4, { learned: ["warmth-of-the-sun", "cold-light-of-day"] })._invocationPickCount()).toBe(2);
		expect(step(6, { learned: ["warmth-of-the-sun"] })._invocationPickCount()).toBe(4);
	});

	it("says how many and why, and completes only at that number", () => {
		const four = ["blinding-light", "dancing-light", "warmth-of-the-sun", "cold-light-of-day"];
		const d = step(5, { chosen: four.slice(0, 2) });
		expect(d._invocationStepData()).toMatchObject({ startingCount: 2, pickCount: 4, levelExtra: 2, level: 5 });
		expect(d._isStepComplete("invocations")).toBe(false);
		d._selections.invocations = four;
		expect(d._isStepComplete("invocations")).toBe(true);
		const tpl = readRepo("templates/dialogs/character-onboarding.hbs");
		expect(tpl).toContain("/ {{invocationData.pickCount}} chosen");
		expect(tpl).toContain("more for reaching level {{invocationData.level}}");
	});

	it("the sheet passes the character's level to onboarding", () => {
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet.match(/characterLevel: this\.actor\.system\?\.attributes\?\.level\?\.value \?\? 1,/g)).toHaveLength(2);
	});
});
