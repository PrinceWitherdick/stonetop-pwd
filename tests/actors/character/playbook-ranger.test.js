// The Ranger's Animal Companion, pinned to the insert (Ranger audit, 2026-09-26): each type's option
// list as the insert prints it; the options' effects read from the type's `effects` data rather than
// guessed from their wording, reaching the card, the NPC and the fight; Beast of Legend's picks
// (exceptional the crew's way, +4 HP and +1 armor, one box each); and Magnificent Specimen's 2 options
// per copy, taken back when a copy is removed and allowed in onboarding.

import { describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, sourceMovesFor, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import {
	companionStats, companionTraitAllowance, canonicalCompanionTraits, trimCompanionTraits,
} from "../../../module/actors/character/animal-companion.js";
import { companionIsExceptional, followerExceptional } from "../../../module/actors/character/follower-masters.js";
import { printedBlow } from "../../../module/utils/damage.js";
import { followerActorFields } from "../../../module/data/follower-actor.js";

const PACK    = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const pbDoc   = slug => ({ ...structuredClone(PACK.get(slug)), uuid: `Compendium.test.${slug}` });
const TYPES   = new Map(PACK.get("the-ranger").flags.stonetop.animalCompanion.types.map(t => [t.slug, t]));
const type    = slug => TYPES.get(slug);
const ranger  = name => sourceMovesFor("The Ranger").find(d => d.name === name);
const pick    = level => ({ stat: "", level });
const BOL     = "Beast of Legend";
const MS      = "Magnificent Specimen";

const rangerAt = (level, flags = {}) => buildLiveCharacter({ slug: "the-ranger", name: "The Ranger", level, flags });
const traitsOf = actor => actor.getFlag(STONETOP_SCOPE, "animalCompanion.traits");
const marksOf  = actor => actor.getFlag(STONETOP_SCOPE, "moves.moveMarks") ?? {};

describe("the Animal Companion insert: each type's options", () => {
	// Book I p.143, the Animal Companion insert, option lists in print order (write-in row aside).
	const PRINTED = {
		bird:     ["Improved damage die (d6)", "+4 HP", "+1 armor (agility)", "attack-bird", "cautious", "clever", "fast", "mimic", "sharp-eyed", "stealthy", "thieving", "tiny", "tireless"],
		critter:  ["+4 HP", "+1 armor (agility)", "agile", "adorable", "annoying", "burrowing", "cautious", "clever", "climber", "dextrous", "keen-eared", "keen-eyed", "keen-nosed", "quick", "stealthy", "stinky", "tiny", "thieving"],
		brute:    ["+1 armor (hide, scales, etc.)", "Damage is +2 damage, forceful", "Damage is messy, 1 piercing", "large (+4 HP, +1 damage, +close)", "easy-going", "fearless", "gluttonous", "keen-nosed", "powerful", "protective", "quick", "terrifying", "tough"],
		predator: ["+4 HP", "+1 armor (hide)", "Damage is messy, 1 piercing", "agile", "climber", "clever", "enduring", "fast", "fierce", "keen-eared", "keen-eyed", "pack-hunter", "keen-nosed", "patient", "powerful", "stealthy", "terrifying"],
		steed:    ["+4 HP", "+1 armor (hide)", "Damage is +2 damage, forceful", "aggressive", "agile", "beautiful", "calm", "clever", "hardy", "keen-nosed", "large", "powerful", "swift"],
	};
	const PICKS = { bird: 4, critter: 5, brute: 3, predator: 3, steed: 4 };
	const TICKED = { bird: "tiny", critter: "tiny", brute: "tough", predator: "fierce", steed: "large" };

	for (const [slug, list] of Object.entries(PRINTED)) {
		it(`${slug}: the printed list, "pick ${PICKS[slug]} more", "${TICKED[slug]}" pre-ticked`, () => {
			expect(type(slug).traits).toEqual(list);
			expect(type(slug).pickCount).toBe(PICKS[slug]);
			expect(type(slug).mandatoryTrait).toBe(TICKED[slug]);
		});
	}

	it("every effect and alias names an option the type lists", () => {
		for (const t of TYPES.values()) {
			for (const label of Object.keys(t.effects ?? {})) expect(t.traits).toContain(label);
			for (const label of Object.values(t.aliases ?? {})) expect(t.traits).toContain(label);
		}
	});
});

describe("companionStats: the line from the type's effects", () => {
	it("a bare type is its printed line", () => {
		expect(companionStats(type("bird"), [])).toMatchObject({ hp: 5, armor: "1 (size)", damage: "d4 (hand)", damageRoll: "d4" });
		expect(companionStats(type("steed"), [])).toMatchObject({ hp: 12, armor: "0", damage: "d6+1 (hand, close)", damageRoll: "d6+1" });
	});

	it("+N HP adds to max HP; tag-only options and write-ins change nothing", () => {
		expect(companionStats(type("critter"), ["+4 HP", "clever", "a write-in"]).hp).toBe(9);
		expect(companionStats(type("predator"), ["patient", "stealthy"])).toMatchObject({ hp: 8, armor: "0", damage: "d8 (hand, grabby)" });
	});

	it("+1 armor keeps its source, on a 0 base too", () => {
		expect(companionStats(type("bird"), ["+1 armor (agility)"]).armor).toBe("2 (size, agility)");
		expect(companionStats(type("brute"), ["+1 armor (hide, scales, etc.)"]).armor).toBe("1 (hide, scales, etc.)");
		expect(companionStats(type("steed"), ["+1 armor (hide)"]).armor).toBe("1 (hide)");
	});

	it("the Bird's improved damage die steps d4 to d6", () => {
		expect(companionStats(type("bird"), ["Improved damage die (d6)"])).toMatchObject({ damage: "d6 (hand)", damageRoll: "d6" });
	});

	it("Damage is +2 damage, forceful: the +2 and the tag", () => {
		expect(companionStats(type("brute"), ["Damage is +2 damage, forceful"]).damage).toBe("d6+2 (hand, forceful)");
		expect(companionStats(type("steed"), ["Damage is +2 damage, forceful"]).damage).toBe("d6+3 (hand, close, forceful)");
	});

	it("Damage is messy, 1 piercing: the tag and the piercing", () => {
		expect(companionStats(type("predator"), ["Damage is messy, 1 piercing"]).damage).toBe("d8 (hand, grabby, messy, 1 piercing)");
	});

	it("the Brute's large: +4 HP, +1 damage and close", () => {
		expect(companionStats(type("brute"), ["large (+4 HP, +1 damage, +close)"])).toMatchObject({ hp: 16, damage: "d6+1 (hand, close)" });
	});

	it("the Brute with all three damage options", () => {
		const stats = companionStats(type("brute"), ["Damage is +2 damage, forceful", "Damage is messy, 1 piercing", "large (+4 HP, +1 damage, +close)"]);
		expect(stats).toMatchObject({ hp: 16, damage: "d6+3 (hand, forceful, messy, close, 1 piercing)", damageRoll: "d6+3", damageForm: "hand" });
	});

	it("an old stored label still applies (the regex never read \"Damage +2, forceful\")", () => {
		expect(canonicalCompanionTraits(type("steed"), ["Damage +2, forceful"])).toEqual(["Damage is +2 damage, forceful"]);
		expect(companionStats(type("steed"), ["Damage +2, forceful"]).damage).toBe("d6+3 (hand, close, forceful)");
		expect(companionStats(type("brute"), ["Damage messy, 1 piercing"]).damage).toBe("d6 (hand, messy, 1 piercing)");
	});

	it("Beast of Legend's +4 HP and +1 armor ride on top", () => {
		expect(companionStats(type("brute"), [], { hp: 4, armor: 1 })).toMatchObject({ hp: 16, armor: "1" });
		expect(companionStats(type("bird"), ["+1 armor (agility)"], { hp: 4, armor: 1 })).toMatchObject({ hp: 9, armor: "3 (size, agility)" });
	});

	it("the derived line reaches the fight and the NPC: piercing, tags and the rollable die", () => {
		const { damage, damageRoll } = companionStats(type("brute"), ["Damage is +2 damage, forceful", "Damage is messy, 1 piercing"]);
		const blow = printedBlow(damage, damageRoll);
		expect(blow.weapon.piercing).toBe(1);
		expect(blow.weapon.tags).toEqual(expect.arrayContaining(["forceful", "messy"]));
		const npc = followerActorFields({ name: "Ursa", damage, damageRoll });
		expect(npc).toMatchObject({ damage: "d6+2 (hand, forceful, messy, 1 piercing)", damageRoll: "d6+2" });
	});
});

describe("Beast of Legend: the crew's shape", () => {
	it("the book's three picks in print order, one box each, exceptional first", () => {
		const bol = ranger(BOL);
		expect(bol.system.description).toBe("<p>Each time you take this move, pick 1:</p>");
		expect(bol.system.markOptions.map(o => [o.slug, o.marks])).toEqual([["exceptional", 1], ["tough", 1], ["unique", 1]]);
		expect(bol.system.markOptions[1]).toMatchObject({ companionHp: 4, companionArmor: 1 });
	});

	it("exceptional only from a LEARNED book copy with the pick marked; a stored toggle is ignored", async () => {
		const { char, actor } = rangerAt(6, { "moves.moveMarks": { [BOL]: { exceptional: [pick(6)] } } });
		expect(companionIsExceptional(actor)).toBe(false);
		const bol = await char.addMove(ranger(BOL)._id);
		expect(companionIsExceptional(actor)).toBe(true);
		expect(followerExceptional(actor, "animal-companion")).toBe(true);

		await bol.setFlag(STONETOP_SCOPE, "learned", false);
		expect(companionIsExceptional(actor)).toBe(false);

		const legacy = rangerAt(6, { animalCompanion: { type: "brute", details: { exceptional: true } } });
		await legacy.char.addMove(ranger(BOL)._id);
		expect(followerExceptional(legacy.actor, "animal-companion")).toBe(false);

		// A player's own move named Beast of Legend is not the book's.
		const custom = rangerAt(6, { "moves.moveMarks": { [BOL]: { exceptional: [pick(6)] } } });
		custom.actor.items.push(makeLiveItem({ name: BOL, type: "move", system: { moveType: "other" }, flags: { "stonetop-pwd": { custom: true } } }));
		expect(companionIsExceptional(custom.actor)).toBe(false);
	});

	it("removing one of two copies drops the latest-level pick", async () => {
		const { char, actor } = rangerAt(8, { "moves.moveMarks": { [BOL]: { exceptional: [pick(6)], tough: [pick(8)] } } });
		await char.addMove(ranger(BOL)._id);
		const second = await char.addMove(ranger(BOL)._id);
		await char.removeMove(second._id);
		expect(marksOf(actor)[BOL]).toMatchObject({ exceptional: [pick(6)], tough: [] });
		expect(companionIsExceptional(actor)).toBe(true);
		const bonuses = await char._ownedMoveBonuses(await char.playbook(), char._buildOwnedMovesMap());
		expect(bonuses).toMatchObject({ companionHp: 0, companionArmor: 0 });
	});
});

// The companion card as the Followers tab draws it (the Marshal test's harness).
const sheetMod = await import("../../../module/actors/character/StonetopCharacterSheet.js");
function companionSheet(char, actor) {
	actor.typedActor = char;
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	return new (sheetMod.createStonetopCharacterSheetClass(Base))();
}
async function companionCard(char, actor, { editing = false } = {}) {
	const snap = await char.buildSnapshot();
	const sheet = companionSheet(char, actor);
	if (editing) sheet._editingSections.add("follower-card:animal-companion:");
	return sheet._buildFollowersData(await char.playbook(), null, snap.crewBonuses, snap.companionBonuses, snap.crewDef, snap.companionDef).animalCompanion;
}

// A Ranger who holds Animal Companion: the card asks that the move is held (the panel rule).
async function companionRangerAt(level, flags = {}) {
	const made = rangerAt(level, flags);
	await made.char.addMove(ranger("Animal Companion")._id);
	return made;
}

describe("the companion card", () => {
	const BRUTE = { type: "brute", kind: "bear", traits: ["Damage +2, forceful", "Damage is messy, 1 piercing", "large (+4 HP, +1 damage, +close)"], instinct: "x", cost: "y" };

	it("derives HP, armor and the damage line from the effects, old labels included", async () => {
		const { char, actor } = await companionRangerAt(1, { animalCompanion: { ...BRUTE } });
		const card = await companionCard(char, actor);
		expect(card).toMatchObject({ hpMax: 16, armor: "0", damage: "d6+3 (hand, forceful, messy, close, 1 piercing)", damageRoll: "d6+3", damageForm: "hand" });
		expect(card.tags.map(t => t.label)).toContain("Damage is +2 damage, forceful");
		expect(card.traitsNote).toBeNull();
	});

	it("exceptional is derived and read-only, from Beast of Legend's pick", async () => {
		const { char, actor } = await companionRangerAt(6, { animalCompanion: { ...BRUTE, details: { exceptional: true } } });
		let card = await companionCard(char, actor);
		expect(card).toMatchObject({ exceptional: false, exceptionalDerived: true, exceptionalAvailable: true });
		await char.addMove(ranger(BOL)._id);
		await actor.update({ [`flags.${STONETOP_SCOPE}.moves.moveMarks`]: { [BOL]: { exceptional: [pick(6)] } } });
		card = await companionCard(char, actor);
		expect(card).toMatchObject({ exceptional: true, exceptionalDerived: true });
	});

	it("Beast of Legend's +4 HP and +1 armor reach the card", async () => {
		const { char, actor } = await companionRangerAt(6, { animalCompanion: { ...BRUTE }, "moves.moveMarks": { [BOL]: { tough: [pick(6)] } } });
		await char.addMove(ranger(BOL)._id);
		expect(await companionCard(char, actor)).toMatchObject({ hpMax: 20, armor: "1" });
	});

	it("a Magnificent Specimen taken since the build shows its options as unpicked", async () => {
		const { char, actor } = rangerAt(2, { animalCompanion: { ...BRUTE } });
		await char.addMove(ranger("Animal Companion")._id);
		await char.addMove(ranger(MS)._id);
		const card = await companionCard(char, actor);
		expect(card.traitsNote).toBe("2 options unpicked");
		const editing = await companionCard(char, actor, { editing: true });
		expect(editing.traitChoices).toMatchObject({ limit: 5, remaining: 2 });
	});

	it("a Brute's retired \"cautious\" is kept, shown and offered ticked in the picker", async () => {
		const { char, actor } = await companionRangerAt(1, { animalCompanion: { type: "brute", traits: ["cautious", "quick", "powerful"] } });
		const card = await companionCard(char, actor, { editing: true });
		expect(card.tags.map(t => t.label)).toContain("cautious");
		expect(card.traitChoices.options.find(o => o.value === "cautious")).toMatchObject({ selected: true, disabled: false });
		expect(card.traitChoices.customTrait).toBe("");
	});
});

describe("Magnificent Specimen: 2 options per copy", () => {
	const FULL = ["quick", "powerful", "fearless", "keen-nosed", "protective", "gluttonous", "terrifying"];

	it("removing a copy trims the newest picks to the allowance; never the pre-ticked option", async () => {
		const { char, actor } = rangerAt(4, { animalCompanion: { type: "brute", traits: ["tough", ...FULL] } });
		await char.addMove(ranger("Animal Companion")._id);
		await char.addMove(ranger(MS)._id);
		const second = await char.addMove(ranger(MS)._id);
		await char.removeMove(second._id);
		expect(traitsOf(actor)).toEqual(["tough", "quick", "powerful", "fearless", "keen-nosed", "protective"]);
		const last = actor.items.find(i => i.name === MS);
		await char.removeMove(last._id);
		expect(traitsOf(actor)).toEqual(["tough", "quick", "powerful", "fearless"]);
	});

	it("un-learning keeps the picks (Big Magic's precedent)", async () => {
		const { char, actor } = rangerAt(2, { animalCompanion: { type: "brute", traits: FULL.slice(0, 5) } });
		await char.addMove(ranger("Animal Companion")._id);
		const ms = await char.addMove(ranger(MS)._id);
		await ms.setFlag(STONETOP_SCOPE, "learned", false);
		expect(traitsOf(actor)).toHaveLength(5);
		expect((await char.buildSnapshot()).companionBonuses.traitPicks).toBe(0);
	});

	// Only REMOVAL trims: an un-learned copy still on the sheet keeps the 2 options it paid for, so removing
	// the other copy trims to one copy's worth, not to none.
	it("removing one copy keeps the options an un-learned second copy still pays for", async () => {
		const { char, actor } = rangerAt(4, { animalCompanion: { type: "brute", traits: ["tough", ...FULL] } });
		await char.addMove(ranger("Animal Companion")._id);
		const first = await char.addMove(ranger(MS)._id);
		const second = await char.addMove(ranger(MS)._id);
		await second.setFlag(STONETOP_SCOPE, "learned", false);
		expect(traitsOf(actor)).toHaveLength(8);
		await char.removeMove(first._id);
		expect(traitsOf(actor)).toEqual(["tough", "quick", "powerful", "fearless", "keen-nosed", "protective"]);
	});

	it("a player's own move named Magnificent Specimen gives no options", async () => {
		const { char, actor } = rangerAt(2);
		actor.items.push(makeLiveItem({ name: MS, type: "move", system: { moveType: "other" }, flags: { "stonetop-pwd": { custom: true } } }));
		expect((await char.buildSnapshot()).companionBonuses.traitPicks).toBe(0);
	});

	it("trimCompanionTraits drops from the end and ignores the pre-ticked option", () => {
		expect(trimCompanionTraits(type("bird"), ["tiny", "fast", "clever", "mimic"], 2)).toEqual(["tiny", "fast", "clever"]);
		expect(trimCompanionTraits(type("bird"), ["fast"], 4)).toEqual(["fast"]);
		expect(companionTraitAllowance(type("critter"), 2)).toBe(9);
	});
});

describe("onboarding's companion step", () => {
	function onboarding({ moves = [], bonus = 0 } = {}) {
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(pbDoc("the-ranger"), null, null);
		d._movesCache = sourceMovesFor("The Ranger").map(doc => ({ id: doc._id, name: doc.name, system: doc.system }));
		d._ownedMoveCounts = {};
		d._companionTraitBonus = bonus;
		d._selections.moves = moves;
		Object.assign(d._selections.animalCompanion, { type: "steed", kind: "horse", instinct: "x", cost: "y" });
		return d;
	}
	const steed = () => type("steed");

	it("asks for the type's picks, plus 2 for Magnificent Specimen taken as a free pick", () => {
		expect(onboarding()._companionTraitLimit(steed())).toBe(4);
		expect(onboarding({ moves: [ranger(MS)._id] })._companionTraitLimit(steed())).toBe(6);
	});

	// The sheet's bonus leaves out a free-pick Specimen (_companionTraitBonusBeyondCreation): that copy
	// is re-shown here as a pick, so un-ticking it lowers the limit.
	it("a re-run adds what the learned copies outside the free picks give", () => {
		expect(onboarding({ bonus: 2 })._companionTraitLimit(steed())).toBe(6);
		expect(onboarding({ moves: [ranger(MS)._id], bonus: 2 })._companionTraitLimit(steed())).toBe(8);
		expect(onboarding({ bonus: 0 })._companionTraitLimit(steed())).toBe(4);
	});

	it("the sheet's bonus leaves out a Specimen taken as onboarding's free pick", () => {
		const bonus = Object.getOwnPropertyDescriptor(createStonetopCharacterSheetClass(class { }).prototype, "_companionTraitBonusBeyondCreation").value;
		const sheet = picks => ({
			_companionTraitPicks: 4,
			_creationPickItemsOf: () => picks.map(name => ({ name })),
		});
		expect(bonus.call(sheet([MS]), {})).toBe(2);
		expect(bonus.call(sheet(["Trailblazer"]), {})).toBe(4);
	});

	it("the step completes only once the whole allowance is picked", () => {
		const d = onboarding({ bonus: 2 });
		d._selections.animalCompanion.traits = ["+4 HP", "calm", "swift", "hardy"];
		expect(d._isStepComplete("animalCompanion")).toBe(false);
		d._selections.animalCompanion.traits.push("agile", "clever");
		expect(d._isStepComplete("animalCompanion")).toBe(true);
	});

	it("more picks than the allowance (a free Magnificent Specimen given back) hold the step and say so, untrimmed", () => {
		const d = onboarding({ moves: [ranger(MS)._id] });
		d._selections.animalCompanion.traits = ["+4 HP", "calm", "swift", "hardy", "agile", "clever"];
		expect(d._isStepComplete("animalCompanion")).toBe(true);
		d._selections.moves = [];
		expect(d._companionTraitLimit(steed())).toBe(4);
		expect(d._isStepComplete("animalCompanion")).toBe(false);
		expect(d._selections.animalCompanion.traits).toHaveLength(6);
	});

	it("giving back a free Magnificent Specimen takes its 2 options with it, newest first", () => {
		const d = onboarding({ moves: [ranger(MS)._id] });
		d._selections.animalCompanion.traits = ["+4 HP", "calm", "swift", "hardy", "agile", "clever"];
		d._selections.moves = [];
		d._trimCompanionPicksToLimit();
		expect(d._selections.animalCompanion.traits).toEqual(["+4 HP", "calm", "swift", "hardy"]);
		expect(d._isStepComplete("animalCompanion")).toBe(true);
	});

	it("a re-run keeps what the learned copies give, and nothing is trimmed before the move list loads", () => {
		const rerun = onboarding({ moves: [ranger(MS)._id], bonus: 2 });
		rerun._selections.animalCompanion.traits = ["+4 HP", "calm", "swift", "hardy", "agile", "clever"];
		rerun._selections.moves = [];
		rerun._trimCompanionPicksToLimit();
		expect(rerun._selections.animalCompanion.traits).toHaveLength(6);

		const early = onboarding();
		early._movesCache = null;
		early._selections.animalCompanion.traits = ["+4 HP", "calm", "swift", "hardy", "agile", "clever"];
		early._trimCompanionPicksToLimit();
		expect(early._selections.animalCompanion.traits).toHaveLength(6);
	});

	it("a Specimen let go by the chained prune (its Animal Companion unpicked) trims too", () => {
		const d = onboarding({ moves: [ranger(MS)._id] });
		d._selections.animalCompanion.traits = ["+4 HP", "calm", "swift", "hardy", "agile", "clever"];
		d._freePickOffers = () => [];
		d._pruneFreePicks();
		expect(d._selections.moves).toEqual([]);
		expect(d._selections.animalCompanion.traits).toHaveLength(4);
	});
});

// ── Ranger audit, second pass (2026-09-26) ────────────────────────────────────────────────────────
// A companion built outside onboarding (companionSource + CompanionSetupDialog, the Marshal crew's
// shape), shown only while Animal Companion is held; Beast-Bonded's actions on the card and Lend it your
// strength; Loyal to the End's injured tag; a re-run keeping the level-up companion actions; and a
// foreign Beast of Legend's marks and a repeatable foreign move taken twice.
const setupMod = await import("../../../module/actors/character/dialogs/CompanionSetupDialog.js");
const bond = await import("../../../module/actors/character/companion-bond.js");
const { OrderFollowersDialog } = await import("../../../module/actors/character/dialogs/OrderFollowersDialog.js");
const { splitMarkedActions } = await import("../../../module/actors/character/StonetopCharacter.js");

const RANGER_AC = PACK.get("the-ranger").flags.stonetop.animalCompanion;
const blessed   = name => sourceMovesFor("The Blessed").find(d => d.name === name);
const moveItem  = (def, flags) => makeLiveItem({ name: def.name, type: "move", system: structuredClone(def.system), flags });
const STEED     = { type: "steed", kind: "horse", traits: ["+4 HP", "calm", "swift", "hardy"], instinct: "x", cost: "y" };

// A Blessed who took Wild Soul and, through it, the Ranger's Animal Companion.
function blessedWithCompanion({ learned = true, flags = {}, extra = [], level = 3 } = {}) {
	const wild = moveItem(blessed("Wild Soul"));
	const ac = moveItem(ranger("Animal Companion"), { [STONETOP_SCOPE]: {
		grantedBy: { move: "Wild Soul", instanceId: wild._id },
		...(learned ? {} : { learned: false }),
	} });
	const made = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", level, items: [wild, ac, ...extra], flags });
	return { ...made, ac };
}

// The Followers tab's groups, as getData builds them.
async function followerGroups(char, actor) {
	const snap = await char.buildSnapshot();
	const sheet = companionSheet(char, actor);
	return sheet._buildFollowersData(await char.playbook(), null, snap.crewBonuses, snap.companionBonuses, snap.crewDef, snap.companionDef);
}

describe("a companion built outside onboarding (R4)", () => {
	it("companionSource: the Ranger's own insert; a learned Animal Companion borrows it; none without, or switched off", async () => {
		expect((await rangerAt(1).char.companionSource()).types.map(t => t.slug)).toEqual(RANGER_AC.types.map(t => t.slug));
		expect(await buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", level: 3 }).char.companionSource()).toBeNull();
		const borrowed = await blessedWithCompanion().char.companionSource();
		expect(borrowed.types.map(t => t.slug)).toEqual(RANGER_AC.types.map(t => t.slug));
		expect(borrowed.moves.map(m => m.name)).toEqual(["Loyal to the End"]);
		expect(await blessedWithCompanion({ learned: false }).char.companionSource()).toBeNull();
	});

	it("the card shows only while Animal Companion is held; its flags wait for the move's return", async () => {
		const { char, actor } = rangerAt(1, { animalCompanion: { ...STEED } });
		expect((await followerGroups(char, actor)).animalCompanion).toBeNull();
		const ac = await char.addMove(ranger("Animal Companion")._id);
		expect((await followerGroups(char, actor)).animalCompanion).toMatchObject({ hpMax: 16 });
		// Held but switched off: the panel rule still shows the Ranger's own.
		await ac.setFlag(STONETOP_SCOPE, "learned", false);
		expect((await followerGroups(char, actor)).animalCompanion).toBeTruthy();
		await char.removeMove(ac._id);
		expect((await followerGroups(char, actor)).animalCompanion).toBeNull();
		expect(actor.getFlag(STONETOP_SCOPE, "animalCompanion.type")).toBe("steed");
		await char.addMove(ranger("Animal Companion")._id);
		expect((await followerGroups(char, actor)).animalCompanion?.hpMax).toBe(16);
	});

	it("a borrowed companion is drawn from the Ranger's insert, and Loyal to the End rides with it", async () => {
		const { char, actor } = blessedWithCompanion({ flags: { animalCompanion: { ...STEED } } });
		const snap = await char.buildSnapshot();
		expect(snap.companionDef.moves[0].name).toBe("Loyal to the End");
		const { animalCompanion, companionSetupOffer } = await followerGroups(char, actor);
		expect(animalCompanion).toMatchObject({ hpMax: 16, damage: "d6+1 (hand, close)" });
		expect(companionSetupOffer).toBe(false);
	});

	it("offers Create your companion while Animal Companion is learned and none is stored", async () => {
		expect((await followerGroups(blessedWithCompanion().char, blessedWithCompanion().actor)).companionSetupOffer).toBe(true);
		const taken = rangerAt(2);
		await taken.char.addMove(ranger("Animal Companion")._id);
		expect((await followerGroups(taken.char, taken.actor)).companionSetupOffer).toBe(true);
		const without = rangerAt(2);
		expect((await followerGroups(without.char, without.actor)).companionSetupOffer).toBe(false);
		const off = blessedWithCompanion({ learned: false });
		expect((await followerGroups(off.char, off.actor)).companionSetupOffer).toBe(false);
	});

	it("Create your companion writes the flags onboarding writes, with the learned Magnificent Specimens' extra picks", async () => {
		const opened = [];
		const spy = vi.spyOn(setupMod.CompanionSetupDialog.prototype, "promise").mockImplementation(async function () {
			opened.push(this);
			return { type: "steed", kind: " horse ", traits: ["+4 HP", "calm", "swift", "hardy", "agile", "clever"], name: " Bran ", instinct: "To bolt", cost: "Apples" };
		});
		try {
			const ms = moveItem(ranger(MS), { [STONETOP_SCOPE]: { grantedBy: { move: "Wild Soul", instanceId: "x" } } });
			const { char, actor } = blessedWithCompanion({ extra: [ms] });
			const sheet = companionSheet(char, actor);
			expect(await sheet._onCreateCompanion()).toBe(true);
			expect(opened[0]._limit()).toBe(0);
			expect(opened[0]._traitBonus).toBe(2);
			expect(actor.getFlag(STONETOP_SCOPE, "animalCompanion")).toMatchObject({
				type: "steed", kind: "horse", traits: ["+4 HP", "calm", "swift", "hardy", "agile", "clever"], name: "Bran", instinct: "To bolt", cost: "Apples",
			});
			const { animalCompanion, companionSetupOffer } = await followerGroups(char, actor);
			expect(animalCompanion.hpMax).toBe(16);
			expect(companionSetupOffer).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});

	it("nothing is written when the dialog is closed, or for a character with no Animal Companion", async () => {
		const spy = vi.spyOn(setupMod.CompanionSetupDialog.prototype, "promise").mockResolvedValue(null);
		try {
			const { char, actor } = blessedWithCompanion();
			expect(await companionSheet(char, actor)._onCreateCompanion()).toBe(false);
			expect(actor.getFlag(STONETOP_SCOPE, "animalCompanion")).toBeNull();
			const plain = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", level: 3 });
			expect(await companionSheet(plain.char, plain.actor)._onCreateCompanion()).toBe(false);
			expect(spy).toHaveBeenCalledTimes(1);
		} finally {
			spy.mockRestore();
		}
	});

	it("removing a borrowed Magnificent Specimen trims against the Ranger's insert", async () => {
		const ms = moveItem(ranger(MS), { [STONETOP_SCOPE]: { grantedBy: { move: "Wild Soul", instanceId: "x" } } });
		const { char, actor } = blessedWithCompanion({ extra: [ms], flags: { animalCompanion: { ...STEED, traits: [...STEED.traits, "agile", "clever"] } } });
		await char.removeMove(ms._id);
		expect(actor.getFlag(STONETOP_SCOPE, "animalCompanion.traits")).toEqual(STEED.traits);
	});
});

describe("the companion setup dialog's picks", () => {
	const def = RANGER_AC;
	const steedType = setupMod.companionSetupType(def, "steed");

	it("picks the type's count plus the learned extras; refuses the pre-ticked option and one past the limit", () => {
		expect(setupMod.companionSetupLimit(steedType, 2)).toBe(6);
		let sel = setupMod.companionSetupSelectType(setupMod.companionSetupInitial({}, def), "steed");
		expect(setupMod.companionSetupToggleTrait(sel, "large", true, 4, steedType).ok).toBe(false);
		for (const t of ["+4 HP", "calm", "swift", "hardy"]) sel = setupMod.companionSetupToggleTrait(sel, t, true, 4, steedType).sel;
		expect(setupMod.companionSetupToggleTrait(sel, "agile", true, 4, steedType).ok).toBe(false);
		expect(setupMod.companionSetupReady({ ...sel, kind: "horse", instinct: "x", cost: "y" }, 4)).toBe(true);
		expect(setupMod.companionSetupReady({ ...sel, kind: "", instinct: "x", cost: "y" }, 4)).toBe(false);
		expect(setupMod.companionSetupReady({ ...sel, kind: "horse", instinct: "x", cost: "y" }, 6)).toBe(false);
	});

	it("a half-made companion is finished, not restarted; the pre-ticked option is never a pick", () => {
		expect(setupMod.companionSetupInitial({ type: "steed", traits: ["large", "calm"], kind: "mule" }, def))
			.toMatchObject({ type: "steed", traits: ["calm"], kind: "mule" });
		const view = setupMod.companionSetupView(def, { type: "steed", traits: ["calm"], kind: "zebra", instinct: "", cost: "" });
		expect(view.selectedType).toMatchObject({ pickCount: 4, selectedCount: 1, isCustomKind: true });
		expect(view.selectedType.traits.find(t => t.slug === "large")).toMatchObject({ isMandatory: true, isSelected: true, disabled: true });
	});

	it("writes the onboarding flags, the name only when given", () => {
		const base = `flags.${STONETOP_SCOPE}.animalCompanion`;
		expect(setupMod.companionSetupUpdate({ type: "bird", kind: "raven", traits: ["fast"], name: " ", instinct: "a", cost: "b" })).toEqual({
			[`${base}.type`]: "bird", [`${base}.kind`]: "raven", [`${base}.traits`]: ["fast"], [`${base}.instinct`]: "a", [`${base}.cost`]: "b",
		});
	});
});

describe("Beast-Bonded on the companion card, and Lend it your strength (M8)", () => {
	const bonded = (marked, extra = {}) => companionRangerAt(3, {
		animalCompanion: { ...STEED }, "background.selected": "beast-bonded", "background.markedActions": marked, ...extra,
	});

	it("lists the marked actions, read-only, while Beast-Bonded is the background", async () => {
		const { char, actor } = await bonded(["call-back", "sense-emotion"]);
		const card = (await followerGroups(char, actor)).animalCompanion;
		expect(card.bond.actions.map(a => a.slug)).toEqual(["call-back", "sense-emotion"]);
		expect(card.bond.canLend).toBe(false);
		const other = await companionRangerAt(3, { animalCompanion: { ...STEED }, "background.selected": "wide-wanderer", "background.markedActions": ["call-back"] });
		expect((await followerGroups(other.char, other.actor)).animalCompanion.bond).toBeUndefined();
	});

	it("Lend it your strength marked is a button, offered at full HP too with a note", async () => {
		const { char, actor } = await bonded(["lend-strength"]);
		expect((await followerGroups(char, actor)).animalCompanion.bond).toMatchObject({ canLend: true, atFull: true });
		await actor.update({ [`flags.${STONETOP_SCOPE}.animalCompanion.hpCurrent`]: 5 });
		expect((await followerGroups(char, actor)).animalCompanion.bond).toMatchObject({ canLend: true, atFull: false });
	});

	// Its NPC's HP is the companion's while there is one, and the card's box mirrors it (follower-hp.js), so the
	// NPC alone is raised; with none, the box is.
	it("the Ranger loses the whole roll; the companion's NPC regains it, capped at its max, and the box is left to mirror it", async () => {
		const { actor } = await bonded(["lend-strength"], { "animalCompanion.hpCurrent": 14, "animalCompanion.details": { actorUuid: "Actor.steed" } });
		actor.system.attributes.hp.value = 8;
		const npc = { isOwner: true, system: { attributes: { hp: { value: 10, max: 16 } } }, update: vi.fn(async u => { npc.system.attributes.hp.value = u["system.attributes.hp.value"]; }) };
		const toMessage = vi.fn();
		vi.stubGlobal("Roll", class { constructor(f) { this.formula = f; } async evaluate() { this.total = 5; return this; } toMessage(d) { return toMessage(d); } });
		try {
			const out = await bond.lendStrength(actor, { npc, cardHp: async () => ({ max: 16, current: 14 }) });
			expect(out.amount).toBe(5);
			expect(actor.system.attributes.hp.value).toBe(3);
			expect(actor.getFlag(STONETOP_SCOPE, "animalCompanion.hpCurrent")).toBe(14);
			expect(npc.system.attributes.hp.value).toBe(15);
			expect(npc.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 15 }, { stonetopMove: "Lend it your strength" });
			expect(out.card).toEqual({ gain: 5, from: 10, to: 15 });
			expect(toMessage).toHaveBeenCalledOnce();
			expect(toMessage.mock.calls[0][0].flavor).toContain("Lend it your strength");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("a roll past the Ranger's HP takes them to 0 through the plain HP writer (Death's Door as usual)", async () => {
		const { actor } = await bonded(["lend-strength"], { "animalCompanion.hpCurrent": 0 });
		actor.system.attributes.hp.value = 2;
		vi.stubGlobal("Roll", class { constructor(f) { this.formula = f; } async evaluate() { this.total = 6; return this; } toMessage() {} });
		try {
			await bond.lendStrength(actor, { npc: null, cardHp: async () => ({ max: 16, current: 0 }) });
			expect(actor.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 0 }, { stonetopMove: "Lend it your strength" });
			expect(actor.getFlag(STONETOP_SCOPE, "animalCompanion.hpCurrent")).toBe(6);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("Loyal to the End's injured tag (M11)", () => {
	const fakeMessage = () => {
		const flags = {};
		return {
			getFlag: (scope, key) => flags[key],
			setFlag: vi.fn(async (scope, key, v) => { flags[key] = v; }),
			unsetFlag: vi.fn(async (scope, key) => { delete flags[key]; }),
		};
	};

	it("the 7-9 and the 6- carry the button; the 10+ none", () => {
		const actions = bond.loyalToTheEndTierActions();
		expect(actions.partial).toContain("stonetop-companion-injured");
		expect(actions.failure).toContain("stonetop-companion-injured");
		expect(actions.success).toBeUndefined();
	});

	it("adds injured once per card, as a condition beside the options", async () => {
		const { char, actor } = await companionRangerAt(1, { animalCompanion: { ...STEED } });
		const message = fakeMessage();
		expect(await bond.settleCompanionInjured(message, actor)).toBe(true);
		expect(await bond.settleCompanionInjured(message, actor)).toBe(false);
		expect(actor.getFlag(STONETOP_SCOPE, "animalCompanion.conditions")).toEqual(["injured"]);
		expect(actor.getFlag(STONETOP_SCOPE, "animalCompanion.traits")).toEqual(STEED.traits);
		const card = (await followerGroups(char, actor)).animalCompanion;
		expect(card.tags.at(-1)).toMatchObject({ label: "injured", removable: true });
		expect(card.orderTagsCsv.split("|")).toContain("injured");
		expect(card.traitsNote).toBeNull();
	});

	it("is removable by hand", async () => {
		const { char, actor } = await companionRangerAt(1, { animalCompanion: { ...STEED, conditions: ["injured"] } });
		expect(await bond.removeCompanionCondition(actor, "injured")).toBe(true);
		expect((await followerGroups(char, actor)).animalCompanion.tags.some(t => t.label === "injured")).toBe(false);
	});

	it("Order Followers offers it already marked in the way", async () => {
		const dialog = new OrderFollowersDialog({}, { name: "Bran", tags: ["calm", "injured"], hinderingTags: ["injured"] }, vi.fn());
		expect(dialog._tagState).toEqual({ injured: "hinder" });
		const { char, actor } = await companionRangerAt(1, { animalCompanion: { ...STEED, conditions: ["injured"] } });
		const sheet = companionSheet(char, actor);
		const spy = vi.spyOn(OrderFollowersDialog.prototype, "render").mockImplementation(function () { spy.dialog = this; return this; });
		try {
			await sheet.orderFollower({ name: "Bran", tags: ["calm"], moves: [], exceptional: false }, { ftype: "animal-companion", slug: "" });
			expect(spy.dialog._follower.tags).toEqual(["calm", "injured"]);
			expect(spy.dialog._tagState).toEqual({ injured: "hinder" });
		} finally {
			spy.mockRestore();
		}
	});
});

describe("re-running onboarding keeps the companion actions marked since (R8)", () => {
	const markable = PACK.get("the-ranger").flags.stonetop.backgrounds.find(b => b.slug === "beast-bonded").markableActions;
	const MARKED = ["call-back", "sense-emotion", "lend-strength"];

	function bondedRanger() {
		const made = buildLiveCharacter({
			slug: "the-ranger", name: "The Ranger", level: 5,
			flags: { "background.selected": "beast-bonded", "background.markedActions": MARKED, animalCompanion: { ...STEED } },
		});
		const sheet = companionSheet(made.char, made.actor);
		sheet._playbookHpInit = () => ({});
		sheet._openPossessionChoices = vi.fn();
		sheet._applyBackgroundNeighbors = vi.fn();
		return { ...made, sheet };
	}

	it("splitMarkedActions: the 1st level's mark first, the rest kept", () => {
		expect(splitMarkedActions(markable, MARKED)).toEqual({ starting: ["call-back"], later: ["sense-emotion", "lend-strength"] });
		expect(splitMarkedActions(null, ["x"])).toEqual({ starting: ["x"], later: [] });
	});

	it("the step shows the later marks marked and locked, and completes with the 1st level's one", () => {
		const { sheet } = bondedRanger();
		const doc = pbDoc("the-ranger");
		const sel = sheet._readSelectionsFromActor(doc);
		expect(sel).toMatchObject({ markedActions: ["call-back"], learnedMarkedActions: ["sense-emotion", "lend-strength"] });
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(doc, null, null);
		Object.assign(d._selections, sel);
		d._wordCache = new Map();
		const bg = d._selectedBackground();
		const data = d._backgroundMarkableActionsData(bg);
		expect(data).toMatchObject({ allowed: 1, markedCount: 1 });
		const bySlug = Object.fromEntries(data.options.map(o => [o.slug, o]));
		expect(bySlug["lend-strength"]).toMatchObject({ isSelected: true, isLearned: true, disabled: true });
		expect(bySlug["call-back"]).toMatchObject({ isSelected: true, isLearned: false, disabled: false });
		expect(bySlug["gauge-distance"]).toMatchObject({ isSelected: false, disabled: true });
		expect(d._backgroundActionsComplete(bg)).toBe(true);
	});

	it("the apply keeps them when the 1st level's mark is changed", async () => {
		const { actor, sheet } = bondedRanger();
		const doc = pbDoc("the-ranger");
		const sel = sheet._readSelectionsFromActor(doc);
		await sheet._applyCommonSelections(doc, { ...sel, markedActions: ["gauge-distance"] });
		expect(actor.getFlag(STONETOP_SCOPE, "background.markedActions")).toEqual(["gauge-distance", "sense-emotion", "lend-strength"]);
	});
});

describe("foreign companion moves taken through Wild Soul (M12)", () => {
	it("a repeatable foreign move is offered again while fewer copies than its repeatMax are held", async () => {
		const ms = moveItem(ranger(MS), { [STONETOP_SCOPE]: { grantedBy: { move: "Wild Soul", instanceId: "x" } } });
		const { char } = blessedWithCompanion({ extra: [ms], level: 6 });
		const offered = await char.getForeignMovesForLevelUp({ playbooks: ["The Ranger"] }, 6);
		const names = offered.map(m => m.name);
		expect(names).toContain(MS);
		expect(names).not.toContain("Animal Companion");
		expect(offered.find(m => m.name === MS).ownedIds).toEqual([ms._id]);
		const bol = offered.find(m => m.name === BOL);
		expect(bol.markOptions.map(o => o.slug)).toEqual(["exceptional", "tough", "unique"]);

		const ms2 = moveItem(ranger(MS), { [STONETOP_SCOPE]: { grantedBy: { move: "Wild Soul", instanceId: "y" } } });
		const twice = blessedWithCompanion({ extra: [ms, ms2], level: 6 });
		expect((await twice.char.getForeignMovesForLevelUp({ playbooks: ["The Ranger"] }, 6)).map(m => m.name)).not.toContain(MS);
	});

	it("a foreign Beast of Legend's marks-step pick lands on its copy and gives its bonus", async () => {
		const ms = moveItem(ranger(MS), { [STONETOP_SCOPE]: { grantedBy: { move: "Wild Soul", instanceId: "x" } } });
		const { char, actor } = blessedWithCompanion({ extra: [ms], level: 6 });
		const wild = actor.items.find(i => i.name === "Wild Soul");
		const bol = (await char.getForeignMovesForLevelUp({ playbooks: ["The Ranger"] }, 6)).find(m => m.name === BOL);
		// What applyLevelUp does with the dialog's choices: the foreign move, then the marks.
		await char._applyForeignMoveChoice(wild, bol.compendiumId, null);
		await char._applyMarkChoices(BOL, [{ slug: "tough" }]);
		expect(marksOf(actor)[BOL].tough).toHaveLength(1);
		const bonuses = await char._ownedMoveBonuses(await char.playbook(), char._buildOwnedMovesMap());
		expect(bonuses).toMatchObject({ companionHp: 4, companionArmor: 1 });
	});
});
