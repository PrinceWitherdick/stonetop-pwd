// The Fox's combat moves, checked against what they do in a fight (Book I, the Fox's playbook):
// Cheap Shot's advantage, All in the Wrist's blades and thrown knives, and Battle Dancer's 12+.
// Second Intent's strike-back line lives with the Defend spends (tests/fight/defend-spend.test.js,
// tests/fight/hero-moves-blows.test.js), and the Battle Dancer Confirm with the other Clash Confirms
// (tests/combat/roll-damage-at.test.js).
//
// Below those, the Fox's advancement and creation (the 2026-09-24 Fox audit): the gate on every
// move, the "either X OR Y" starting moves (the Heavy's pair too), and what a re-run of onboarding
// keeps: HP, possessions, the tall tales.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { damageAdvantageFrom, carriedAttackWeapons, depleteAmmoAndPost, letFlyAmmoStatuses, maybeBeginAttack, battleDancing } from "../../../module/combat/attack-flow.js";
import { isClashWeapon, isLetFlyWeapon, weaponMeta, ALL_IN_THE_WRIST } from "../../../module/data/weapons.js";
import { installCombatChatFakes, uninstallCombatChatFakes } from "../../fakes/combat-chat.js";
import { buildLiveCharacter, sourceMovesFor, ownedMoveNames, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { FakePlaybookRepository } from "../../fakes/FakePlaybookRepository.js";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { PlaybookMoveEntry } from "../../../module/actors/character/PlaybookMoveEntry.js";
import { MoveDefinition } from "../../../module/model/MoveDefinition.js";
import { CREATION_PICK_FLAG, STARTING_CHOICE_FLAG } from "../../../module/actors/character/StonetopCharacter.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";

const SCOPE = "stonetop-pwd";
const CLASH   = { key: "clash",   filter: isClashWeapon };
const LET_FLY = { key: "let-fly", filter: isLetFlyWeapon };

const move = (name, { moveType = "playbook", learned = true, custom = false } = {}) => ({
	type: "move", name, system: { moveType },
	flags: { [SCOPE]: { ...(learned ? {} : { learned: false }), ...(custom ? { custom: true } : {}) } },
});

// ── Cheap Shot ────────────────────────────────────────────────────────────────
// "When you Ambush with a hand weapon, you have advantage on your damage roll."
describe("Cheap Shot", () => {
	const knife = weaponMeta("knife-dagger");
	const sword = weaponMeta("sword");
	const fox = (...items) => ({ items });

	it("sharpens an Ambush with a hand weapon, and not one with a close-only weapon", () => {
		const owner = fox(move("Cheap Shot"));
		expect(damageAdvantageFrom(owner, "ambush", knife)).toBe("adv");
		expect(damageAdvantageFrom(owner, "ambush", sword)).toBeNull();
		// ...and only the Ambush it names.
		expect(damageAdvantageFrom(owner, "clash", knife)).toBeNull();
	});

	it("needs the move owned, and LEARNED", () => {
		expect(damageAdvantageFrom(fox(), "ambush", knife)).toBeNull();
		// A player can switch a move off and keep it on the sheet; switched off, it does nothing.
		expect(damageAdvantageFrom(fox(move("Cheap Shot", { learned: false })), "ambush", knife)).toBeNull();
	});

	it("is the book's move: not a player's own move of the name, but still one a GM dropped from the Fox", () => {
		expect(damageAdvantageFrom(fox(move("Cheap Shot", { moveType: "other", custom: true })), "ambush", knife)).toBeNull();
		expect(damageAdvantageFrom(fox(move("Cheap Shot", { moveType: "other" })), "ambush", knife)).toBe("adv");
	});
});

// ── All in the Wrist ──────────────────────────────────────────────────────────
// "Any knife or dagger gets the thrown tag in your hands. Also, you keep a few iron throwing blades (near)
// on you; they don't take up space in your inventory. Reset your ammo whenever you Outfit."
const WRIST = sourceMovesFor("The Fox").find(d => d.name === ALL_IN_THE_WRIST);

/** An actor carrying `gear`, owning `items`, whose move tracks live in `tracks`. */
function wristActor({ items = [], gear = [], tracks = {} } = {}) {
	return {
		name: "Vess", type: "character", items,
		getFlag: () => null,
		sheet: { render: () => {} },
		typedActor: {
			carriedWeaponGear: async () => gear,
			moveResources: {
				getMoveResources: () => ({ ...tracks }),
				setUses: vi.fn(async (name, value) => { tracks[name] = value; }),
			},
		},
	};
}
const wrist = (opts = {}) => ({ ...move(ALL_IN_THE_WRIST, opts), system: { ...WRIST.system, ...(opts.moveType ? { moveType: opts.moveType } : {}) } });
const knifeGear = { slug: "knife-dagger", weaponSlug: "knife-dagger", catalog: true, ammoStore: "inventory" };
const BLADES = "all-in-the-wrist-throwing-blades";

describe("All in the Wrist: the throwing blades", () => {
	it("are offered for Let Fly only while the move is learned", async () => {
		const learned = await carriedAttackWeapons(wristActor({ items: [wrist()] }), LET_FLY);
		expect(learned.find(w => w.slug === BLADES)).toMatchObject({ grantedBy: ALL_IN_THE_WRIST, meta: { name: "Iron throwing blades", ammo: true } });
		expect((await carriedAttackWeapons(wristActor({ items: [wrist({ learned: false })] }), LET_FLY)).map(w => w.slug)).not.toContain(BLADES);
		expect((await carriedAttackWeapons(wristActor(), LET_FLY)).map(w => w.slug)).not.toContain(BLADES);
		// Near and thrown, not a melee weapon.
		expect((await carriedAttackWeapons(wristActor({ items: [wrist()] }), CLASH)).map(w => w.slug)).not.toContain(BLADES);
	});

	it("read their ammo off the move's own track, in the move's words", async () => {
		const actor = wristActor({ items: [wrist()], tracks: { [ALL_IN_THE_WRIST]: 1 } });
		const blades = (await carriedAttackWeapons(actor, LET_FLY)).find(w => w.slug === BLADES);
		expect(blades).toMatchObject({ ammoStore: "move", ammoMove: ALL_IN_THE_WRIST, ammoMax: 2, ammoLabel: "A few left" });
		expect(await letFlyAmmoStatuses(actor)).toEqual({ weapons: [{ name: "Iron throwing blades", label: "A few left", allOut: false }], allOut: false });
	});

	describe("Let Fly's 7-9 \"deplete your ammo\"", () => {
		let posted;
		// The fakes tear their globals down to nothing; the ones this file's other tests read are put back.
		const GLOBALS = ["Roll", "CONST", "ChatMessage", "game", "ui", "fromUuid"];
		let saved;
		beforeEach(() => {
			saved = Object.fromEntries(GLOBALS.map(key => [key, globalThis[key]]));
			posted = installCombatChatFakes();
		});
		afterEach(() => {
			uninstallCombatChatFakes();
			for (const key of GLOBALS) if (saved[key] !== undefined) globalThis[key] = saved[key];
		});

		const card = () => {
			const flags = {};
			return { id: "m1", flags, getFlag: (_s, key) => flags[key], setFlag: async (_s, key, value) => { flags[key] = value; } };
		};

		it("marks the move's track: a few left, then out", async () => {
			const tracks = {};
			const actor = wristActor({ items: [wrist()], tracks });
			const [blades] = (await carriedAttackWeapons(actor, LET_FLY)).filter(w => w.slug === BLADES);
			const weapon = { slug: blades.slug, name: blades.meta.name, ammo: true, ammoStore: blades.ammoStore, ammoMax: blades.ammoMax, ammoLabels: blades.ammoLabels, ammoMove: blades.ammoMove };

			expect(await depleteAmmoAndPost(card(), actor, { weapon }, "0")).toMatchObject({ index: 1, label: "A few left", allOut: false });
			expect(actor.typedActor.moveResources.setUses).toHaveBeenLastCalledWith(ALL_IN_THE_WRIST, 1, { stonetopMove: ALL_IN_THE_WRIST });
			expect(await depleteAmmoAndPost(card(), actor, { weapon }, "0")).toMatchObject({ index: 2, label: "Out", allOut: true });
			expect(tracks[ALL_IN_THE_WRIST]).toBe(2);
			expect(posted.at(-1).content).toContain("out of ammunition");
		});
	});

	it("are refilled by Outfit", async () => {
		const { char } = buildLiveCharacter({
			slug: "the-fox", name: "The Fox", seedStartingMoves: false,
			// MoveResources' own flag (namespace "moves"), keyed by the move's name: both boxes marked.
			flags: { "moves.backgroundChoices": { [ALL_IN_THE_WRIST]: 2, "Silver Tongued": 1 } },
		});
		await char.applyOutfit({}, 0, 0);
		expect(char.moveResources.getMoveResources()).toEqual({ [ALL_IN_THE_WRIST]: 0, "Silver Tongued": 1 });
	});
});

describe("All in the Wrist: knives and daggers", () => {
	it("get the thrown tag, and so reach Let Fly, while the move is learned", async () => {
		const withMove = await carriedAttackWeapons(wristActor({ items: [wrist()], gear: [knifeGear] }), LET_FLY);
		expect(withMove.find(w => w.slug === "knife-dagger")?.meta.range).toEqual(["hand", "thrown"]);
		// Still a knife in the hand for Clash.
		expect((await carriedAttackWeapons(wristActor({ items: [wrist()], gear: [knifeGear] }), CLASH)).map(w => w.slug)).toContain("knife-dagger");
	});

	it("stay hand weapons without it, or with it switched off", async () => {
		for (const items of [[], [wrist({ learned: false })]]) {
			expect((await carriedAttackWeapons(wristActor({ items, gear: [knifeGear] }), LET_FLY)).map(w => w.slug)).not.toContain("knife-dagger");
		}
	});

	it("leaves a weapon that is not a knife or dagger alone", async () => {
		const sword = { slug: "sword", weaponSlug: "sword", catalog: true, ammoStore: "inventory" };
		expect((await carriedAttackWeapons(wristActor({ items: [wrist()], gear: [sword] }), LET_FLY)).map(w => w.slug)).not.toContain("sword");
	});
});

// ── Battle Dancer ─────────────────────────────────────────────────────────────
// "When you roll +DEX to Clash, on a 12+ you deal your damage, avoid your enemy's attack, and
// impress/embarrass/overawe your foes." The Confirm's side is in tests/combat/roll-damage-at.test.js.
describe("Battle Dancer", () => {
	const fox = (...items) => ({
		uuid: "Actor.fox", items,
		getFlag: (_scope, key) => (key === "inventory.checked" ? { "knife-dagger": true } : {}),
	});
	const clash = { type: "move", name: "Clash", system: { moveType: "basic" } };
	const flagFor = async (actor, stat) => (await maybeBeginAttack(actor, clash, { stat })).messageFlags[SCOPE].attack;

	it("marks a Clash rolled +DEX by a Fox with the move learned", async () => {
		expect((await flagFor(fox(move("Battle Dancer")), "dex")).battleDancer).toBe(true);
	});

	it("leaves a +STR Clash, or a Fox without the move learned, as it was", async () => {
		expect((await flagFor(fox(move("Battle Dancer")), "str")).battleDancer).toBeUndefined();
		expect((await flagFor(fox(), "dex")).battleDancer).toBeUndefined();
		expect((await flagFor(fox(move("Battle Dancer", { learned: false })), "dex")).battleDancer).toBeUndefined();
	});

	it("is the 12+, read off the card's roll, not an 11", () => {
		const card = total => ({ rolls: [{ total }] });
		expect(battleDancing(card(12), { battleDancer: true })).toBe(true);
		expect(battleDancing(card(11), { battleDancer: true })).toBe(false);
		expect(battleDancing(card(12), {})).toBe(false);
	});
});

// ══ Advancement and creation (the 2026-09-24 Fox audit) ════════════════════════

const PACK   = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const pbDoc  = slug => ({ ...structuredClone(PACK.get(slug)), uuid: `Compendium.test.${slug}` });
const FOX_GROUPS   = PACK.get("the-fox").flags.stonetop.moves.choices;
const HEAVY_GROUPS = PACK.get("the-heavy").flags.stonetop.moves.choices;

const fox   = name => sourceMovesFor("The Fox").find(d => d.name === name);
const heavy = name => sourceMovesFor("The Heavy").find(d => d.name === name);
const foxAt = (level, opts = {}) => buildLiveCharacter({ slug: "the-fox", name: "The Fox", level, ...opts });
const stamp = flag => ({ [STONETOP_SCOPE]: { [flag]: true } });
// A Fox move as an owned item, optionally stamped.
const foxItem = (name, flags) => makeLiveItem({ name, type: "move", system: structuredClone(fox(name).system), flags });
const itemNamed = (actor, name) => actor.items.find(i => i.name === name);
const flagOf = (item, flag) => !!item?.flags?.[STONETOP_SCOPE]?.[flag];

// The Fox's moves as the Moves tab builds them, keyed by name.
async function sheetEntries(char, level) {
	const entries = await char._moveRepo.getPlaybookMoves("The Fox");
	const built = char.buildMovelistContext(entries, char._buildOwnedMovesMap(), new Set(), level, "The Fox", FOX_GROUPS);
	return new Map(built.map(e => [e.name, e]));
}

describe("the Fox's move gates, as the sheet reads them", () => {
	it("starts with Ambush OR Skill at Arms, and Danger Sense OR Perceptive", () => {
		expect(PACK.get("the-fox").flags.stonetop.moves.startingMovesNote)
			.toBe("You start with Ambush OR Skill at Arms; Danger Sense OR Perceptive; and 1 of your choice.");
		expect(FOX_GROUPS.map(g => g.options)).toEqual([["Ambush", "Skill at Arms"], ["Danger Sense", "Perceptive"]]);
		for (const name of FOX_GROUPS.flatMap(g => g.options)) expect(fox(name).system.isStartingMove).toBe(true);
	});

	it("the Heavy starts with Armored OR Uncanny Reflexes", () => {
		expect(HEAVY_GROUPS.map(g => g.options)).toEqual([["Armored", "Uncanny Reflexes"]]);
	});

	it.each([
		["Battle Dancer", ["Skill at Arms"],                "Skill at Arms; level 6+"],
		["Cheap Shot",    ["Ambush"],                       "Ambush; level 6+"],
		["Second Intent", ["Parry & Riposte", "Ambush"],    "Parry & Riposte, Ambush; level 6+"],
	])("%s needs level 6+ and %j", async (name, needs, label) => {
		const { char } = foxAt(6, { seedStartingMoves: false });
		expect((await sheetEntries(char, 6)).get(name)).toMatchObject({ minLevel: 6, requiresLabel: label, locked: true });
		for (const need of needs.slice(0, -1)) {
			await char.addMove(fox(need)._id);
			expect((await sheetEntries(char, 6)).get(name).locked).toBe(true);
		}
		await char.addMove(fox(needs.at(-1))._id);
		expect((await sheetEntries(char, 5)).get(name).locked).toBe(true);
		expect((await sheetEntries(char, 6)).get(name).locked).toBe(false);
	});

	it.each(["Eye on the Door", "Pants on Fire", "Slippery", "Superior Stat"])("%s needs level 6+ and nothing else", async name => {
		const { char } = foxAt(6, { seedStartingMoves: false });
		expect((await sheetEntries(char, 5)).get(name)).toMatchObject({ minLevel: 6, requiresLabel: "level 6+", locked: true });
		expect((await sheetEntries(char, 6)).get(name).locked).toBe(false);
	});

	it("Superior Stat raises to a max of +3", async () => {
		const { char } = foxAt(6);
		expect((await sheetEntries(char, 6)).get("Superior Stat").cap).toBe(3);
	});

	it("Parry & Riposte needs Skill at Arms, at any level", async () => {
		const { char } = foxAt(1, { seedStartingMoves: false });
		expect((await sheetEntries(char, 1)).get("Parry & Riposte")).toMatchObject({ minLevel: null, requiresLabel: "Skill at Arms", locked: true });
		await char.addMove(fox("Skill at Arms")._id);
		expect((await sheetEntries(char, 1)).get("Parry & Riposte").locked).toBe(false);
	});

	it("Dabbler: level 2+, the Fox only, a Heavy, Marshal, Ranger or Seeker move, three times", async () => {
		const { char } = foxAt(1);
		const dabbler = (await sheetEntries(char, 1)).get("Dabbler");
		expect(dabbler).toMatchObject({ minLevel: 2, requiresPlaybook: "The Fox", repeatMax: 3, locked: true });
		expect(dabbler.crossPlaybook.playbooks).toEqual(["The Heavy", "The Marshal", "The Ranger", "The Seeker"]);
		expect((await sheetEntries(char, 2)).get("Dabbler").locked).toBe(false);
		expect(new PlaybookMoveEntry(new MoveDefinition(fox("Dabbler")), [], new Set(), new Map(), 6, "The Heavy").locked).toBe(true);
		const offered = await char.getForeignMovesForLevelUp(dabbler.crossPlaybook, 2);
		expect(offered.length).toBeGreaterThan(0);
		expect(offered.every(m => dabbler.crossPlaybook.playbooks.includes(m.playbook))).toBe(true);
	});

	it("Improved Stat: three times, to a max of +2", async () => {
		const { char } = foxAt(1);
		expect((await sheetEntries(char, 1)).get("Improved Stat")).toMatchObject({ repeatMax: 3, cap: 2, minLevel: null });
	});
});

// ── The either/or starting moves ─────────────────────────────────────────────────

const FOX_PB = {
	slug: "the-fox", name: "The Fox", img: "x.svg", description: "", statsNote: "", hp: 16, damage: "d8",
	startingMovesNote: "You start with Ambush OR Skill at Arms; Danger Sense OR Perceptive; and 1 of your choice.",
	startingMoveChoices: FOX_GROUPS,
};
const HEAVY_PB = {
	slug: "the-heavy", name: "The Heavy", img: "x.svg", description: "", statsNote: "", hp: 20, damage: "d10",
	startingMovesNote: "You start with Dangerous, Hard to Kill, Armored OR Uncanny Reflexes, and 1 more move of your choice.",
	startingMoveChoices: HEAVY_GROUPS,
};
const pbMove = (pb, id, name, o = {}) => ({ _id: id, name, system: { moveType: "playbook", isStartingMove: false, rollType: null, playbook: pb, ...o } });
const owned  = (pb, id, name, o = {}) => ({ _id: id, type: "move", name, ...(o.flags ? { flags: o.flags } : {}), ...(o._stats ? { _stats: o._stats } : {}),
	system: { moveType: "playbook", playbook: pb, isStartingMove: !!o.starting } });

// The Moves tab's movelist for a character owning `items`, with the budget the sheet shows.
async function movelist(pb, level, defs, items) {
	const actor = new FakeActorBuilder().withPlaybook(pb.slug, pb.name).withLevel(level).withItems(items).build();
	let b = new TestCharacterBuilder(actor).withPlaybookRepo(new FakePlaybookRepository(pb));
	for (const d of defs) b = b.addPlaybookMove(d);
	return (await b.build().buildSnapshot()).movelist;
}
const FOX_DEFS = [
	pbMove("The Fox", "am", "Ambush", { isStartingMove: true }), pbMove("The Fox", "sa", "Skill at Arms", { isStartingMove: true }),
	pbMove("The Fox", "ds", "Danger Sense", { isStartingMove: true }), pbMove("The Fox", "pe", "Perceptive", { isStartingMove: true }),
	pbMove("The Fox", "ca", "Catlike"), pbMove("The Fox", "bu", "Burgle"),
];
const foxOwned = (id, name, o) => owned("The Fox", id, name, o);
const started  = { starting: true, flags: stamp(STARTING_CHOICE_FLAG) };
const byName   = (ml, name) => ml.playbookMoves.find(m => m.name === name);

describe("either/or starting moves on the Moves tab", () => {
	it("the other half taken at a level-up is a pick: counted, unlabelled, free to untick", async () => {
		const ml = await movelist(FOX_PB, 2, FOX_DEFS, [
			foxOwned("a1", "Ambush", started), foxOwned("p1", "Perceptive", started),
			foxOwned("c1", "Catlike"), foxOwned("s1", "Skill at Arms", { starting: true }),
		]);
		expect(ml.levelMovesShortfall).toBe(0);
		expect(ml.levelMovesOverage).toBe(0);
		expect(ml.levelMovesIncomplete).toBe(false);
		// The template disables an owned move's box only when it is a starting one.
		expect(byName(ml, "Skill at Arms")).toMatchObject({ owned: true, isStarting: false, sourceLabel: null });
		expect(byName(ml, "Ambush")).toMatchObject({ owned: true, isStarting: true, sourceLabel: "Starting move" });
		expect(byName(ml, "Danger Sense")).toMatchObject({ owned: false, isStarting: false, sourceLabel: null });
	});

	it("a character from before the stamp: the one it holds is the starting move; holding both, book order", async () => {
		const ml = await movelist(FOX_PB, 2, FOX_DEFS, [
			foxOwned("a1", "Ambush", { starting: true }), foxOwned("p1", "Perceptive", { starting: true }),
			foxOwned("c1", "Catlike"), foxOwned("s1", "Skill at Arms", { starting: true }),
		]);
		expect(ml.levelMovesShortfall).toBe(0);
		expect(ml.levelMovesOverage).toBe(0);
		expect(byName(ml, "Ambush").sourceLabel).toBe("Starting move");
		expect(byName(ml, "Perceptive").sourceLabel).toBe("Starting move");
		expect(byName(ml, "Skill at Arms").sourceLabel).toBeNull();
	});

	it("a character from before the stamp holding both: the one gained first, when that is known", async () => {
		const ml = await movelist(FOX_PB, 2, FOX_DEFS, [
			foxOwned("a1", "Ambush", { starting: true, _stats: { createdTime: 200 } }), foxOwned("p1", "Perceptive", { starting: true }),
			foxOwned("c1", "Catlike"), foxOwned("s1", "Skill at Arms", { starting: true, _stats: { createdTime: 100 } }),
		]);
		expect(byName(ml, "Skill at Arms").sourceLabel).toBe("Starting move");
		expect(byName(ml, "Ambush").sourceLabel).toBeNull();
		expect(ml.levelMovesShortfall).toBe(0);
	});

	it("before either is chosen, both halves still read as the starting choice", async () => {
		const ml = await movelist(FOX_PB, 1, FOX_DEFS, []);
		for (const name of ["Ambush", "Skill at Arms", "Danger Sense", "Perceptive"]) {
			expect(byName(ml, name)).toMatchObject({ owned: false, isStarting: true, sourceLabel: "Starting move" });
		}
	});

	// The user's ruling: the free pick may be the other half. At 1st level it is the "1 of your
	// choice", and the budget and the labels agree.
	it("at 1st level, the other half as the free pick fills the free pick", async () => {
		const ml = await movelist(FOX_PB, 1, FOX_DEFS, [
			foxOwned("a1", "Ambush", started), foxOwned("d1", "Danger Sense", started),
			foxOwned("s1", "Skill at Arms", { starting: true, flags: stamp(CREATION_PICK_FLAG) }),
		]);
		expect(ml.movesIncomplete).toBe(false);
		expect(ml.levelMovesShortfall).toBe(0);
		expect(ml.levelMovesOverage).toBe(0);
		expect(byName(ml, "Skill at Arms")).toMatchObject({ isStarting: false, sourceLabel: null });
		expect(byName(ml, "Ambush").sourceLabel).toBe("Starting move");
	});

	it("the Heavy's Uncanny Reflexes taken at a level-up after starting with Armored", async () => {
		const defs = [
			pbMove("The Heavy", "ar", "Armored", { isStartingMove: true }), pbMove("The Heavy", "ur", "Uncanny Reflexes", { isStartingMove: true }),
			pbMove("The Heavy", "be", "Berserker"),
		];
		const ml = await movelist(HEAVY_PB, 2, defs, [
			owned("The Heavy", "a1", "Armored", started), owned("The Heavy", "b1", "Berserker"),
			owned("The Heavy", "u1", "Uncanny Reflexes", { starting: true }),
		]);
		expect(ml.levelMovesShortfall).toBe(0);
		expect(ml.levelMovesOverage).toBe(0);
		expect(byName(ml, "Uncanny Reflexes")).toMatchObject({ isStarting: false, sourceLabel: null });
	});
});

// ── Onboarding: the sheet's apply ───────────────────────────────────────────────

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

const FOX_STATS = { str: 0, dex: 2, con: 0, int: 1, wis: 1, cha: -1 };
const FOX_RUN = (over = {}) => ({
	backgroundSlug: "the-natural",
	stats:          FOX_STATS,
	possessions:    ["tannery", "distillery"],
	moves:          [fox("Catlike")._id],
	moveChoices:    { 0: fox("Ambush")._id, 1: fox("Danger Sense")._id },
	lore:           { picks: {}, texts: {} },
	...over,
});

// A Fox built the way onboarding builds one, from nothing.
async function onboardedFox(run = FOX_RUN()) {
	const made = buildLiveCharacter({ slug: "the-fox", name: "The Fox", level: 1, seedStartingMoves: false, stats: FOX_STATS });
	const sheet = sheetFor(made.char, made.actor);
	await sheet._applyPlaybookSelections(pbDoc("the-fox"), run);
	return { ...made, sheet };
}

describe("onboarding's either/or picks", () => {
	it("stamps the half granted as the one started with", async () => {
		const { actor } = await onboardedFox();
		expect(flagOf(itemNamed(actor, "Ambush"), STARTING_CHOICE_FLAG)).toBe(true);
		expect(flagOf(itemNamed(actor, "Danger Sense"), STARTING_CHOICE_FLAG)).toBe(true);
		expect(ownedMoveNames(actor)).not.toContain("Skill at Arms");
	});

	// Re-running onboarding deleted the real starting move: it restored the FIRST held option of
	// each group and then removed every other one, however it was gained.
	it("a re-run restores the half started with and keeps the half a level-up gave", async () => {
		const { char, actor, sheet } = await onboardedFox();
		actor.system.attributes.level.value = 3;
		await char.addMove(fox("Skill at Arms")._id);
		await char.addMove(fox("Perceptive")._id);
		const doc = pbDoc("the-fox");

		const restored = sheet._readSelectionsFromActor(doc);
		expect(restored.moveChoices).toEqual({ 0: "Ambush", 1: "Danger Sense" });
		await sheet._applyPlaybookSelections(doc, restored);

		expect(ownedMoveNames(actor)).toEqual(expect.arrayContaining(["Ambush", "Skill at Arms", "Danger Sense", "Perceptive"]));
	});

	it("switching the pick takes back the half started with, and not a level-up's", async () => {
		const { char, actor, sheet } = await onboardedFox();
		actor.system.attributes.level.value = 2;
		await char.addMove(fox("Perceptive")._id);
		const doc = pbDoc("the-fox");

		const sel = sheet._readSelectionsFromActor(doc);
		await sheet._applyPlaybookSelections(doc, { ...sel, moveChoices: { 0: "Skill at Arms", 1: "Danger Sense" } });

		expect(ownedMoveNames(actor)).not.toContain("Ambush");
		expect(flagOf(itemNamed(actor, "Skill at Arms"), STARTING_CHOICE_FLAG)).toBe(true);
		expect(ownedMoveNames(actor)).toContain("Perceptive");
	});

	it("past 1st level, a character from before the stamp loses nothing, and the pick is stamped", async () => {
		const { char, actor } = foxAt(3, { seedStartingMoves: false,
			items: ["Skill at Arms", "Ambush", "Perceptive", "Catlike"].map(n => foxItem(n)) });
		const sheet = sheetFor(char, actor);
		expect(sheet._restoreOwnedMoveChoices(pbDoc("the-fox"))).toEqual({ 0: "Ambush", 1: "Perceptive" });

		await char.applyStartingMoveChoices(FOX_GROUPS, { 0: fox("Skill at Arms")._id, 1: fox("Perceptive")._id });

		expect(ownedMoveNames(actor).sort()).toEqual(["Ambush", "Catlike", "Perceptive", "Skill at Arms"]);
		expect(flagOf(itemNamed(actor, "Skill at Arms"), STARTING_CHOICE_FLAG)).toBe(true);
		expect(flagOf(itemNamed(actor, "Ambush"), STARTING_CHOICE_FLAG)).toBe(false);
	});

	it("the Heavy's pair: a re-run keeps Uncanny Reflexes taken at a level-up", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 3 });
		await char.addMove(heavy("Uncanny Reflexes")._id);
		const sheet = sheetFor(char, actor);
		expect(sheet._restoreOwnedMoveChoices(pbDoc("the-heavy"))).toEqual({ 0: "Armored" });

		await char.applyStartingMoveChoices(HEAVY_GROUPS, { 0: heavy("Armored")._id });

		expect(ownedMoveNames(actor)).toEqual(expect.arrayContaining(["Armored", "Uncanny Reflexes"]));
	});
});

// The user's ruling: the free pick may be the other half of an either/or.
describe("the free pick as the other half", () => {
	const run = FOX_RUN({ moves: [fox("Skill at Arms")._id] });

	it("is granted beside the half started with, stamped as the free pick", async () => {
		const { actor, char } = await onboardedFox(run);
		expect(ownedMoveNames(actor)).toEqual(expect.arrayContaining(["Ambush", "Skill at Arms"]));
		expect(flagOf(itemNamed(actor, "Skill at Arms"), CREATION_PICK_FLAG)).toBe(true);
		expect(flagOf(itemNamed(actor, "Skill at Arms"), STARTING_CHOICE_FLAG)).toBe(false);
		const entries = await sheetEntries(char, 1);
		expect(entries.get("Skill at Arms")).toMatchObject({ owned: true, isStarting: false, source: null });
		expect(entries.get("Ambush")).toMatchObject({ owned: true, isStarting: true, source: "Starting move" });
	});

	it("a re-run confirmed as read back changes nothing", async () => {
		const { actor, sheet } = await onboardedFox(run);
		const before = ownedMoveNames(actor).sort();
		const doc = pbDoc("the-fox");
		const sel = sheet._readSelectionsFromActor(doc);
		expect(sel.moves).toEqual(["Skill at Arms"]);
		expect(sel.moveChoices).toEqual({ 0: "Ambush", 1: "Danger Sense" });

		await sheet._applyPlaybookSelections(doc, sel);

		expect(ownedMoveNames(actor).sort()).toEqual(before);
	});

	it("a re-run that swaps the halves keeps both, each with its new stamp", async () => {
		const { actor, sheet } = await onboardedFox(run);
		const doc = pbDoc("the-fox");
		const sel = sheet._readSelectionsFromActor(doc);

		await sheet._applyPlaybookSelections(doc, { ...sel, moves: [fox("Ambush")._id], moveChoices: { 0: fox("Skill at Arms")._id, 1: fox("Danger Sense")._id } });

		expect(ownedMoveNames(actor).filter(n => n === "Ambush" || n === "Skill at Arms").sort()).toEqual(["Ambush", "Skill at Arms"]);
		expect(flagOf(itemNamed(actor, "Skill at Arms"), STARTING_CHOICE_FLAG)).toBe(true);
		expect(flagOf(itemNamed(actor, "Ambush"), CREATION_PICK_FLAG)).toBe(true);
		expect(flagOf(itemNamed(actor, "Ambush"), STARTING_CHOICE_FLAG)).toBe(false);
	});
});

describe("re-running onboarding keeps HP, and takes back an unticked possession", () => {
	it("leaves the damage taken on the same playbook", async () => {
		const { actor, sheet } = await onboardedFox();
		actor.system.attributes.hp.value = 5;
		const doc = pbDoc("the-fox");
		await sheet._applyPlaybookSelections(doc, sheet._readSelectionsFromActor(doc));
		expect(actor.system.attributes.hp.value).toBe(5);
	});

	it("starts HP full with a new playbook", async () => {
		const made = buildLiveCharacter({ slug: "", name: "", level: 1, seedStartingMoves: false, stats: FOX_STATS });
		made.actor.system.attributes.hp.value = 2;
		await sheetFor(made.char, made.actor)._applyPlaybookSelections(pbDoc("the-fox"), FOX_RUN());
		expect(made.actor.system.attributes.hp).toMatchObject({ value: 16, max: 16 });
	});

	it("takes back an unticked possession with its gear, and leaves the background's", async () => {
		const run = FOX_RUN({
			backgroundSlug: "a-life-of-crime",
			backgroundSetup: { choices: { extraMove: "Burgle", extraPossession: "burglars-kit" } },
		});
		const { actor, sheet } = await onboardedFox(run);
		const selected = () => [...actor.getFlag(STONETOP_SCOPE, "possessions.selected")].sort();
		expect(selected()).toEqual(["burglars-kit", "distillery", "tannery"]);
		expect(ownedMoveNames(actor)).toContain("Stills");

		const doc = pbDoc("the-fox");
		const sel = sheet._readSelectionsFromActor(doc);
		await sheet._applyPlaybookSelections(doc, { ...sel, possessions: ["tannery", "mummers-kit"] });

		expect(selected()).toEqual(["burglars-kit", "mummers-kit", "tannery"]);
		expect(ownedMoveNames(actor)).not.toContain("Stills");
		expect(ownedMoveNames(actor)).toContain("Motley");
		expect(ownedMoveNames(actor)).toContain("Picks");
	});
});

// ── Onboarding: the dialog ──────────────────────────────────────────────────────

function dialogFor(slug, selections = {}) {
	const d = Object.create(CharacterOnboardingDialog.prototype);
	d._initializeState(pbDoc(slug), null, null);
	d._movesCache = sourceMovesFor(PACK.get(slug).name).map(doc => ({ id: doc._id, name: doc.name, system: doc.system }));
	Object.assign(d._selections, selections);
	return d;
}
const offerNames = d => d._freePickOffers().map(doc => doc.name);

describe("onboarding's free-pick offers", () => {
	it("after Ambush: Skill at Arms may be the free pick, Parry & Riposte may not", () => {
		const names = offerNames(dialogFor("the-fox", { moveChoices: { 0: fox("Ambush")._id, 1: fox("Danger Sense")._id } }));
		expect(names).toContain("Skill at Arms");
		expect(names).toContain("Perceptive");
		expect(names).not.toContain("Ambush");
		expect(names).not.toContain("Danger Sense");
		expect(names).not.toContain("Parry & Riposte");
	});

	it("after Skill at Arms: Parry & Riposte is offered, and Ambush as the other half", () => {
		const names = offerNames(dialogFor("the-fox", { moveChoices: { 0: fox("Skill at Arms")._id } }));
		expect(names).toContain("Parry & Riposte");
		expect(names).toContain("Ambush");
		expect(names).not.toContain("Skill at Arms");
	});

	it("reads a pick still named as a re-run restores it", () => {
		expect(offerNames(dialogFor("the-fox", { moveChoices: { 0: "Skill at Arms" } }))).toContain("Parry & Riposte");
	});

	it("never offers a level-gated move", () => {
		const names = offerNames(dialogFor("the-fox", { moveChoices: { 0: fox("Skill at Arms")._id } }));
		for (const gated of ["Battle Dancer", "Dabbler", "Superior Stat", "Second Intent"]) expect(names).not.toContain(gated);
	});

	it("the Heavy's pair: the half not picked is offered, the one picked is not", () => {
		const names = offerNames(dialogFor("the-heavy", { moveChoices: { 0: heavy("Armored")._id } }));
		expect(names).toContain("Uncanny Reflexes");
		expect(names).not.toContain("Armored");
		expect(names).not.toContain("Dangerous");
	});
});

// Book (the Fox's tall tales): "Mix and match the following to come up with a couple of your more
// memorable adventures"; "There was that time that you... (choose 1 per tale)"; "And you ended
// up... (choose 1 or 2 per tale)". The sheet draws two boxes on each of those options.
describe("tall tales in onboarding", () => {
	const section = (d, slug) => d._rawLore.find(s => s.slug === slug);

	it("counts each list per tale, for a couple of tales", () => {
		const d = dialogFor("the-fox");
		expect(d._parseLorePickMin(section(d, "tall-tales-beginning"))).toBe(2);
		expect(d._parseLorePickMax(section(d, "tall-tales-beginning"))).toBe(2);
		expect(d._parseLorePickMin(section(d, "tall-tales-ending"))).toBe(2);
		expect(d._parseLorePickMax(section(d, "tall-tales-ending"))).toBe(4);
		// "But all you've got left to show for it is..." states no count, and is left as it was.
		expect(d._parseLorePickMax(section(d, "tall-tales-legacy"))).toBe(1);
	});

	it("leaves a section with no `tales` alone", () => {
		const d = dialogFor("the-blessed");
		for (const s of d._rawLore) expect(d._loreTales(s)).toBe(1);
	});

	it("lets an option be taken twice, each take counting toward the section", () => {
		const d = dialogFor("the-fox");
		const beginning = section(d, "tall-tales-beginning");
		expect(d._setLorePick(beginning, "ruined-tower", 0, true)).toBe(true);
		expect(d._setLorePick(beginning, "ruined-tower", 1, true)).toBe(true);
		expect(d._selections.lore.picks["tall-tales-beginning:ruined-tower"]).toBe(2);
		expect(d._countLoreSectionPicks("tall-tales-beginning")).toBe(2);
		expect(d._isLoreSectionAnswered(beginning)).toBe(true);
		// Full: a third take anywhere is refused.
		expect(d._setLorePick(beginning, "hillfolk", 0, true)).toBe(false);
		// Unticking the second box drops one take; unticking the first drops both.
		expect(d._setLorePick(beginning, "ruined-tower", 1, false)).toBe(true);
		expect(d._selections.lore.picks["tall-tales-beginning:ruined-tower"]).toBe(1);
		expect(d._setLorePick(beginning, "hillfolk", 0, true)).toBe(true);
		expect(d._setLorePick(beginning, "hillfolk", 0, false)).toBe(true);
		expect(d._selections.lore.picks["tall-tales-beginning:hillfolk"]).toBe(0);
	});

	it("never takes an option past its own max", () => {
		const d = dialogFor("the-fox");
		const legacy = section(d, "tall-tales-legacy");
		expect(d._setLorePick(legacy, "nasty-scar", 1, true)).toBe(true);
		expect(d._selections.lore.picks["tall-tales-legacy:nasty-scar"]).toBe(1);
	});

	it("draws a second box on a twice-pickable option, open once the first is ticked", () => {
		const d = dialogFor("the-fox");
		const ending = section(d, "tall-tales-ending");
		const running = () => d._loreSectionData(ending).options.find(o => o.slug === "running");
		expect(running().extraBoxes).toEqual([{ index: 1, checked: false, disabled: true }]);
		d._setLorePick(ending, "running", 0, true);
		expect(running().extraBoxes).toEqual([{ index: 1, checked: false, disabled: false }]);
		d._setLorePick(ending, "running", 1, true);
		expect(running().extraBoxes).toEqual([{ index: 1, checked: true, disabled: false }]);
		expect(d._loreSectionData(section(d, "tall-tales-legacy")).options[0].extraBoxes).toEqual([]);
	});

	it("the sheet keeps a tale told twice, and a re-run replaces the picks", async () => {
		const { actor, sheet } = await onboardedFox(FOX_RUN({
			lore: { picks: { "tall-tales-beginning:ruined-tower": 2, "tall-tales-ending:running": 1, "tall-tales-ending:ghost": 2 }, texts: {} },
		}));
		const counts = () => actor.getFlag(STONETOP_SCOPE, "lore.counts");
		expect(counts()).toMatchObject({ "tall-tales-beginning:ruined-tower": 2, "tall-tales-ending:ghost": 2, "tall-tales-ending:running": 1 });

		const doc = pbDoc("the-fox");
		const sel = sheet._readSelectionsFromActor(doc);
		sel.lore.picks["tall-tales-beginning:ruined-tower"] = 1;
		sel.lore.picks["tall-tales-beginning:hillfolk"] = 1;
		await sheet._applyPlaybookSelections(doc, sel);
		expect(counts()).toMatchObject({ "tall-tales-beginning:ruined-tower": 1, "tall-tales-beginning:hillfolk": 1 });
	});
});

// ── The Fox's playbook text ─────────────────────────────────────────────────────

describe("the Fox's playbook text, against the book", () => {
	const st = PACK.get("the-fox").flags.stonetop;
	const background = slug => st.backgrounds.find(b => b.slug === slug).description;

	it("The Prodigal Returned lists what a 7-9 picks from", () => {
		expect(background("the-prodigal-returned")).toContain("<ul><li>They still hold a grudge</li><li>They're going to need something from you first</li>"
			+ "<li>They swore off this sort of thing long ago</li><li>You can't exactly, y'know, trust them</li></ul>");
	});

	it("A Life of Crime asks who and what you DID leave behind", () => {
		expect(background("a-life-of-crime")).toContain("Who and what did you leave behind?");
	});

	it("a build 'like a whippin' stick'", () => {
		expect(st.appearance.flat()).toContain("like a whippin' stick");
	});
});
