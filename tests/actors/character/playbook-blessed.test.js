// The Blessed's advancement, checked against the sheet the player sees: the gate on every
// move (Book I, the Blessed's playbook), Wild Soul's Ranger picks, and the sacred pouch's
// remarkable traits and max Stock as Big Magic comes and goes.

import { afterEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, ownedMoveNames, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { loadPlaybookDefs } from "../../fakes/sourcePack.js";
import { PlaybookMoveEntry } from "../../../module/actors/character/PlaybookMoveEntry.js";
import { MoveDefinition } from "../../../module/model/MoveDefinition.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";

const POUCH   = "sacred-pouch";
const blessed = name => sourceMovesFor("The Blessed").find(d => d.name === name);
const seeker  = name => sourceMovesFor("The Seeker").find(d => d.name === name);
const { byName: PB_DEFS } = loadPlaybookDefs();

const blessedAt = (level, opts = {}) => buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", level, ...opts });

// The Blessed's moves as the Moves tab builds them, keyed by name.
async function sheetEntries(char, level) {
	const entries = await char._moveRepo.getPlaybookMoves("The Blessed");
	const built = char.buildMovelistContext(entries, char._buildOwnedMovesMap(), new Set(), level, "The Blessed");
	return new Map(built.map(e => [e.name, e]));
}

const traits = actor => actor.getFlag("stonetop-pwd", "possessions.subChoices")?.[POUCH] ?? [];

describe("the Blessed's move gates, as the sheet reads them", () => {
	it("starts with Spirit Tongue and Call the Spirits", async () => {
		const { char } = blessedAt(1);
		const starting = [...(await sheetEntries(char, 1)).values()].filter(e => e.isStarting).map(e => e.name);
		expect(starting.sort()).toEqual(["Call the Spirits", "Spirit Tongue"]);
	});

	it("Borrow Power and Call the Spirits need Spirit Tongue", async () => {
		const { char } = blessedAt(1, { seedStartingMoves: false });
		const without = await sheetEntries(char, 1);
		expect(without.get("Borrow Power")).toMatchObject({ requiresLabel: "Spirit Tongue", locked: true });
		expect(without.get("Call the Spirits").requiresLabel).toBe("Spirit Tongue");

		await char.addMove(blessed("Spirit Tongue")._id);
		expect((await sheetEntries(char, 1)).get("Borrow Power").locked).toBe(false);
	});

	it("Wild Soul: level 2+, the Blessed only, a Ranger move, twice", async () => {
		const { char } = blessedAt(1);
		const wildSoul = (await sheetEntries(char, 1)).get("Wild Soul");
		expect(wildSoul).toMatchObject({ minLevel: 2, requiresPlaybook: "The Blessed", repeatMax: 2, locked: true });
		expect(wildSoul.crossPlaybook.playbooks).toEqual(["The Ranger"]);
		expect((await sheetEntries(char, 2)).get("Wild Soul").locked).toBe(false);
	});

	it.each([
		["Nature's Wrath",            "Danu's Grasp"],
		["Potent Workings",           "Amulets & Talismans"],
		["Shared Souls",              "Into the Lion's Den"],
		["Suck the Poison Out",       "Healer's Arts"],
		["Voice of the Earth Mother", "Spirit Tongue"],
	])("%s needs level 6+ and %s", async (name, needs) => {
		const { char } = blessedAt(6);
		if (needs !== "Spirit Tongue") {
			const before = (await sheetEntries(char, 6)).get(name);
			expect(before).toMatchObject({ minLevel: 6, requiresLabel: `${needs}; level 6+`, locked: true });
			await char.addMove(blessed(needs)._id);
		}
		expect((await sheetEntries(char, 5)).get(name).locked).toBe(true);
		expect((await sheetEntries(char, 6)).get(name)).toMatchObject({ requiresLabel: `${needs}; level 6+`, locked: false });
	});

	it("Superior Stat: level 6+, to a max of +3", async () => {
		const { char } = blessedAt(6);
		expect((await sheetEntries(char, 6)).get("Superior Stat")).toMatchObject({ minLevel: 6, cap: 3 });
	});

	it("Improved Stat: three times, to a max of +2; Big Magic: twice", async () => {
		const { char } = blessedAt(1);
		const entries = await sheetEntries(char, 1);
		expect(entries.get("Improved Stat")).toMatchObject({ repeatMax: 3, cap: 2, minLevel: null });
		expect(entries.get("Big Magic")).toMatchObject({ repeatMax: 2, minLevel: null });
	});
});

// "Each time you take this move, gain a Ranger move of your choice for which you qualify.
// You can't pick Improved Stat or Superior Stat."
describe("Wild Soul", () => {
	const wildSoul = () => blessed("Wild Soul");
	const cross = foreignMoveId => ({ crossPlaybook: true, foreignMoveId, grantsPossession: null });

	it("offers Ranger moves only, never a stat move or another cross-playbook move", async () => {
		const { char } = blessedAt(6);
		const offered = await char.getForeignMovesForLevelUp(wildSoul().system.crossPlaybook, 7);
		const rangerNames = new Set(sourceMovesFor("The Ranger").map(d => d.name));
		expect(offered.length).toBeGreaterThan(0);
		expect(offered.every(m => m.playbook === "The Ranger" && rangerNames.has(m.name))).toBe(true);
		const names = offered.map(m => m.name);
		for (const never of ["Improved Stat", "Superior Stat", "Worldly"]) expect(names).not.toContain(never);
	});

	it("is never offered to anyone but the Blessed", async () => {
		// Not on another playbook's own list (the sheet locks it)...
		const def = new MoveDefinition(wildSoul());
		expect(new PlaybookMoveEntry(def, [], new Set(), new Map(), 6, "The Ranger").locked).toBe(true);
		// ...nor through a Ranger's Worldly, nor a Would-be Hero's Versatile.
		const ranger = buildLiveCharacter({ slug: "the-ranger", name: "The Ranger", level: 6 }).char;
		const worldly = sourceMovesFor("The Ranger").find(d => d.name === "Worldly").system.crossPlaybook;
		expect((await ranger.getForeignMovesForLevelUp(worldly, 7)).map(m => m.name)).not.toContain("Wild Soul");
		const hero = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 6 }).char;
		expect((await hero.getForeignMovesForLevelUp({ playbooks: "any" }, 7)).map(m => m.name)).not.toContain("Wild Soul");
	});

	// Book I, the Ranger's Alpha: "(Requires level 6+, and Wild Speech or Spirit Tongue)".
	// A Blessed starts with Spirit Tongue, so Wild Soul reaches Alpha at level 6.
	it("offers Alpha to a level-6 Blessed who has Spirit Tongue but not Wild Speech", async () => {
		const { char, actor } = blessedAt(6);
		expect(ownedMoveNames(actor)).toContain("Spirit Tongue");
		expect(ownedMoveNames(actor)).not.toContain("Wild Speech");
		const offered = await char.getForeignMovesForLevelUp(wildSoul().system.crossPlaybook, 7);
		const alpha = offered.find(m => m.name === "Alpha");
		expect(alpha).toBeTruthy();
		expect(alpha.requiresLabel).toBe("Wild Speech or Spirit Tongue");
		expect((await char.getForeignMovesForLevelUp(wildSoul().system.crossPlaybook, 5)).map(m => m.name)).not.toContain("Alpha");

		await char.applyLevelUp(wildSoul()._id, null, cross(alpha.compendiumId));
		expect(ownedMoveNames(actor)).toContain("Alpha");
	});

	it("can be taken twice, each time for a different Ranger move", async () => {
		const { char, actor } = blessedAt(2);
		const first = (await char.getForeignMovesForLevelUp(wildSoul().system.crossPlaybook, 3))[0];
		await char.applyLevelUp(wildSoul()._id, null, cross(first.compendiumId));

		const again = await char.getForeignMovesForLevelUp(wildSoul().system.crossPlaybook, 4);
		expect(again.map(m => m.name)).not.toContain(first.name);
		const data = await char.getLevelUpData();
		expect(data.availableMoves.map(m => m.name)).toContain("Wild Soul");
		await char.applyLevelUp(wildSoul()._id, null, cross(again[0].compendiumId));

		const souls = actor.items.filter(i => i.name === "Wild Soul");
		expect(souls).toHaveLength(2);
		const granted = name => actor.items.find(i => i.name === name).flags["stonetop-pwd"].grantedBy;
		expect(granted(first.name)).toMatchObject({ move: "Wild Soul", instanceId: souls[0]._id });
		expect(granted(again[0].name)).toMatchObject({ move: "Wild Soul", instanceId: souls[1]._id });
		expect((await char.getLevelUpData()).availableMoves.map(m => m.name)).not.toContain("Wild Soul");
	});

	it("un-learning it takes its Ranger move with it", async () => {
		const { char, actor } = blessedAt(2);
		const pick = (await char.getForeignMovesForLevelUp(wildSoul().system.crossPlaybook, 3))[0];
		await char.applyLevelUp(wildSoul()._id, null, cross(pick.compendiumId));
		expect(ownedMoveNames(actor)).toContain(pick.name);

		await char.removeMove(actor.items.find(i => i.name === "Wild Soul")._id);
		expect(ownedMoveNames(actor)).not.toContain("Wild Soul");
		expect(ownedMoveNames(actor)).not.toContain(pick.name);
	});
});

// Big Magic: "Each time you take this move, choose an additional remarkable trait for your
// sacred pouch and increase your max Stock by 2."
describe("Big Magic and the sacred pouch", () => {
	const bigMagicId = () => blessed("Big Magic")._id;
	const withTraits = (list, level = 3) => blessedAt(level, { flags: { "possessions.subChoices": { [POUCH]: list } } });

	it("un-learning Big Magic takes back the trait it added, and leaves the pouch's flavour alone", async () => {
		const { char, actor } = withTraits(["origin-heirloom", "trait-sealed", "material-fur"]);
		const bm = await char.addMove(bigMagicId());
		await char.selectSubChoice(POUCH, "trait-unclean");
		expect(traits(actor)).toEqual(["origin-heirloom", "trait-sealed", "material-fur", "trait-unclean"]);

		await char.removeMove(bm._id);
		expect(traits(actor)).toEqual(["origin-heirloom", "trait-sealed", "material-fur"]);
	});

	it("removing one of two Big Magics trims three traits to two", async () => {
		const { char, actor } = withTraits(["trait-sealed"]);
		const first  = await char.addMove(bigMagicId());
		await char.addMove(bigMagicId());
		await char.selectSubChoice(POUCH, "trait-unclean");
		await char.selectSubChoice(POUCH, "trait-unnoticed");
		expect(traits(actor)).toHaveLength(3);

		await char.removeMove(first._id);
		expect(traits(actor)).toEqual(["trait-sealed", "trait-unclean"]);
	});

	it("removing one of two Big Magics leaves two traits alone, the cap being two", async () => {
		const { char, actor } = withTraits(["trait-sealed"]);
		const first = await char.addMove(bigMagicId());
		await char.addMove(bigMagicId());
		await char.selectSubChoice(POUCH, "trait-unclean");

		await char.removeMove(first._id);
		expect(traits(actor)).toEqual(["trait-sealed", "trait-unclean"]);
	});

	// Level Up step 4, Book I p.528, plus Big Magic's +2 each time.
	it("two Big Magics take max Stock to 3, +1 per even level, +4", async () => {
		const { char } = blessedAt(5);
		await char.applyLevelUp(bigMagicId(), null, null);
		const once = char.computePossessionMaxUses(PB_DEFS.get("The Blessed").specialPossessions, char._buildOwnedMovesMap(), 6);
		expect(once[POUCH]).toBe(3 + 3 + 2);
		await char.applyLevelUp(bigMagicId(), null, null);
		const twice = char.computePossessionMaxUses(PB_DEFS.get("The Blessed").specialPossessions, char._buildOwnedMovesMap(), 7);
		expect(twice[POUCH]).toBe(3 + 3 + 4);
	});

	// A Seeker's pouch comes from Initiate of the Secret Arts with no trait at all; Big Magic
	// learned the same way frees one. The pouch is on the Seeker's OWN playbook (grant-only).
	it("a Seeker who learns Big Magic through Initiate has a trait to pick", async () => {
		const { char } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker", level: 3 });
		await char.applyLevelUp(seeker("Initiate of the Secret Arts")._id, null, {
			crossPlaybook: true, foreignMoveId: bigMagicId(), grantsPossession: POUCH,
		});
		expect(await char.possessionWithOpenChoiceFor("Big Magic")).toBe(POUCH);
		// The move named on the level-up is Initiate, which frees nothing on its own; the sheet
		// has to be told about the foreign move.
		expect(await char.possessionWithOpenChoiceFor("Initiate of the Secret Arts")).toBeNull();
	});
});

describe("the sheet asks for Big Magic's trait on every way of gaining it", () => {
	const priorDialog = global.Dialog;
	afterEach(() => { global.Dialog = priorDialog; vi.restoreAllMocks(); });

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
		return sheet;
	}

	it("the Moves tab's Learn, for a Seeker ticking Initiate and picking Big Magic", async () => {
		let config = null;
		global.Dialog = class { constructor(c) { config = c; } render() { return this; } };
		const { char, actor } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker", level: 3 });
		const sheet = sheetFor(char, actor);
		const initiate = await char.addMove(seeker("Initiate of the Secret Arts")._id);

		await sheet._maybePromptForeignMove(initiate);
		const bigMagicId = blessed("Big Magic")._id;
		await config.buttons.learn.callback({ find: () => ({ val: () => bigMagicId }) });

		expect(ownedMoveNames(actor)).toContain("Big Magic");
		expect(sheet._openPossessionChoices).toHaveBeenCalledWith(POUCH, { addOnly: true });
	});

	it("onboarding, for a Blessed whose free pick is Big Magic", async () => {
		const { char, actor } = blessedAt(1, { flags: { "possessions.subChoices": { [POUCH]: ["trait-sealed"] } } });
		const sheet = sheetFor(char, actor);
		sheet._playbookHpInit = () => ({});
		sheet._applyCommonSelections = async () => ({ flagUpd: {}, selectedBackground: null, backgroundSetup: null });
		sheet._applyBackgroundNeighbors = vi.fn();
		const playbookDoc = { uuid: "Compendium.test.the-blessed", name: "The Blessed", system: { slug: "the-blessed" }, flags: {} };

		await sheet._applyPlaybookSelections(playbookDoc, { moves: [blessed("Big Magic")._id] });

		expect(ownedMoveNames(actor)).toContain("Big Magic");
		expect(sheet._openPossessionChoices).toHaveBeenCalledWith(POUCH, { addOnly: true });
	});

	it("onboarding asks nothing when the free pick frees no trait", async () => {
		const { char, actor } = blessedAt(1, { flags: { "possessions.subChoices": { [POUCH]: ["trait-sealed"] } } });
		const sheet = sheetFor(char, actor);
		sheet._playbookHpInit = () => ({});
		sheet._applyCommonSelections = async () => ({ flagUpd: {}, selectedBackground: null, backgroundSetup: null });
		sheet._applyBackgroundNeighbors = vi.fn();
		const playbookDoc = { uuid: "Compendium.test.the-blessed", name: "The Blessed", system: { slug: "the-blessed" }, flags: {} };

		await sheet._applyPlaybookSelections(playbookDoc, { moves: [blessed("Barkskin")._id] });

		expect(ownedMoveNames(actor)).toContain("Barkskin");
		expect(sheet._openPossessionChoices).not.toHaveBeenCalled();
	});
});

// Raised by Wolves: "Also, when you Forage, you have advantage." A SOURCE of advantage folded like
// every other (utils/roll-mode.js#layModes), so winter's disadvantage on Forage cancels it and the
// roll goes straight, as advantage and disadvantage do (p.230).
describe("Raised by Wolves forages at advantage", () => {
	const wolf = ({ background = "raised-by-wolves", sticky = "normal", slug = "the-blessed", name = "The Blessed" } = {}) => {
		const forage = { _id: "forage-1", name: "Forage", type: "move", system: { rollType: "wis" }, roll: vi.fn(async () => ({ total: 8 })) };
		const made = buildLiveCharacter({
			slug, name, seedStartingMoves: false,
			flags: { rollMode: sticky, background: { selected: background } },
		});
		const items = [...made.actor.items, forage];
		items.get = id => items.find(i => i._id === id) ?? null;
		made.actor.items = items;
		return { ...made, forage };
	};
	const rollForage = async (char, prompted = {}) => char.onRoll({
		currentTarget: {
			closest: sel => (sel === ".item" ? { dataset: { itemId: "forage-1" } } : null),
			getAttribute: () => null,
		},
	}, prompted);

	it("rolls Forage at advantage and names the background on the card", async () => {
		const { char, forage } = wolf();
		await rollForage(char);
		const options = forage.roll.mock.calls[0][0];
		expect(options.rollMode).toBe("adv");
		expect(options.conditionNotes).toContain("Raised by Wolves");
	});

	it("cancels against winter's disadvantage, from the sticky selector or the pre-roll window", async () => {
		const sticky = wolf({ sticky: "dis" });
		await rollForage(sticky.char);
		expect(sticky.forage.roll.mock.calls[0][0].rollMode).toBe("normal");

		const prompted = wolf();
		await rollForage(prompted.char, { rollMode: "dis" });
		expect(prompted.forage.roll.mock.calls[0][0].rollMode).toBe("normal");
	});

	it("is the background's alone, and the Blessed's alone", async () => {
		expect(wolf({ background: "vessel" }).char.backgroundMoveAdvantage("Forage")).toBeNull();
		expect(wolf({ slug: "the-ranger", name: "The Ranger" }).char.backgroundMoveAdvantage("Forage")).toBeNull();
		expect(wolf().char.backgroundMoveAdvantage("Forage")).toBe("Raised by Wolves");
		expect(wolf().char.backgroundMoveAdvantage("Defy Danger")).toBeNull();
	});

	it("also rides a Forage rolled by name, with no owned item behind it", async () => {
		const rolled = [];
		vi.doMock("../../../module/utils/roll-engine.js", () => ({
			rollStat: vi.fn(async (stat, actor, options) => { rolled.push(options); return { total: 7 }; }),
		}));
		try {
			const { char } = wolf();
			await char.onDirectStatRoll("wis", { moveName: "Forage" });
			await char.onDirectStatRoll("wis", { moveName: "Know Things" });
			expect(rolled[0].rollMode).toBe("adv");
			expect(rolled[1].rollMode).toBe("normal");
		} finally {
			vi.doUnmock("../../../module/utils/roll-engine.js");
		}
	});
});
