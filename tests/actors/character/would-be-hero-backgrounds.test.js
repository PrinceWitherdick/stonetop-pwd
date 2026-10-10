// The Would-Be Hero's backgrounds (Book I p.137) and Death's Door, through the real sheet and a stateful
// character (LiveCharacter), with the playbook and its moves as the pack ships them:
//  - Destined's Omens: a 3-circle setup track and a background move, Omens of Fate, rolled +Omens with no
//    XP on a 6-; its tier empties the track (7+) or adds one (6-), kept in step with a Shift or a +1.
//  - Destined's Death's Door: "until your destiny is fulfilled, treat a 6- as a 7-9, and a 7-9 as a 10+",
//    with a "Destiny fulfilled" box that turns it off.
//  - Never Gonna Keep Me Down's once-a-session "don't roll. You get a 10+", a circle End of Session clears.
//  - Driven's "What was it? Choose 1" and Destined's "Choose 3-4" destiny words as background choices,
//    on the Details tab and asked at creation.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem, ownedMoveNames, resetLiveIds, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { stubConfirm } from "../../fakes/confirm.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";
import { DeathsDoorDialog } from "../../../module/actors/character/dialogs/DeathsDoorDialog.js";
import { settleTierEffects, recordTierEffects, reconcileTierEffects } from "../../../module/actors/character/tier-effects.js";
import { moveRollOptions } from "../../../module/actors/character/move-roll-options.js";
import { OMENS_OF_FATE, omensForTier, omensRollOptions, rollOmensOfFate } from "../../../module/actors/character/destined.js";
import {
	NEVER_GONNA_KEEP_ME_DOWN, deathsDoorCardTier, deathsDoorCardTierShift, deathsDoorRollOptions,
} from "../../../module/actors/character/deaths-door.js";
import { resetNeverGonnaKeepMeDown } from "../../../module/actors/character/deaths-door-actor.js";
import { backgroundChoicePatch } from "../../../module/actors/character/initiates.js";
import { maybeRemindPotentialForGreatness } from "../../../module/actors/character/WouldBeHeroAsterisk.js";
import { remindDestinedOmenRoll, wireOmenRollButtons, OMENS_ROLLED_FROM_FLAG } from "../../../module/hooks/StonetopSingleton.js";
import { ROLLED_FLAG, rolledRecord } from "../../../module/utils/counted-tier.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// Only the dice are stood in for: the Death's Door window reads what the roll was handed and the total.
const rollStat = vi.hoisted(() => vi.fn(async () => ({ total: 5 })));
vi.mock("../../../module/utils/roll-engine.js", async importOriginal => ({ ...(await importOriginal()), rollStat }));
// The Door's pre-roll window, answered as one that asked nothing.
const promptRoll = vi.hoisted(() => vi.fn(async () => ({ situational: 0 })));
vi.mock("../../../module/dialogs/RollDialog.js", async importOriginal => ({ ...(await importOriginal()), promptRoll }));

// A Death's Door window's stand-in character: dying, and rolling straight through to the dice as
// StonetopCharacter#onDirectStatRoll would hand them over.
const atTheDoor = (actor, deathsDoorRollOptions) => ({
	_actor: actor,
	deathsDoorState: "dying",
	deathsDoorRollOptions,
	onDirectStatRoll: (stat, opts) => rollStat(stat, actor, opts),
});

const WBH = "The Would-Be Hero";
const ALL_PLAYBOOKS = loadPlaybookPackDocs();
const PACK = new Map(ALL_PLAYBOOKS.map(doc => [doc.system.slug, doc]));
const playbookDoc = () => ({ ...structuredClone(PACK.get("the-would-be-hero")), uuid: "Compendium.test.the-would-be-hero" });
const backgrounds = () => PACK.get("the-would-be-hero").flags.stonetop.backgrounds;
const background = slug => backgrounds().find(b => b.slug === slug);
const wbhMove = name => sourceMovesFor(WBH).find(d => d.name === name);
const flag = (actor, key) => actor.getFlag(SYSTEM_ID, key);
const omens = actor => flag(actor, "background.setupResources")?.omens ?? 0;
const WBH_STATS = { str: 1, dex: 0, con: 0, int: 0, wis: 0, cha: -1 };

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

function hero({ flags = {}, items = [], seedStartingMoves = false } = {}) {
	const made = buildLiveCharacter({ slug: "the-would-be-hero", name: WBH, stats: WBH_STATS, seedStartingMoves, flags, items });
	return { ...made, sheet: sheetFor(made.char, made.actor) };
}

const RUN = (over = {}) => ({ backgroundSlug: "destined", stats: WBH_STATS, moves: [], lore: { picks: {}, texts: {} }, ...over });
const onboard = (sheet, selections) => sheet._applyPlaybookSelections(playbookDoc(), selections);
const choose  = (sheet, slug) => sheet._onBackgroundChange({ currentTarget: { value: slug } });

// A roll card as the tier effects write and read it.
function card(move) {
	const flags = { [SYSTEM_ID]: { move } };
	return {
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { flags[scope][key] = value; }),
	};
}

beforeEach(() => resetLiveIds());
afterEach(() => { vi.restoreAllMocks(); delete globalThis.ChatMessage; });

describe("the Would-Be Hero's backgrounds, as the pack ships them", () => {
	it("Destined carries the book's words, the Omens track, the Destiny fulfilled box and its move", () => {
		const destined = background("destined");
		expect(destined.description).toContain("the GM will describe a vision or portent that points toward your fate and/or clarifies your current situation");
		expect(destined.description).toContain("and how your fears play into them");
		expect(destined.description).not.toContain("will share a vision");
		expect(destined.setup.resources).toEqual([
			{ key: "omens", label: "Omens", max: 3, value: 0 },
			{ key: "destiny-fulfilled", label: "Destiny fulfilled", max: 1, value: 0 },
		]);
		expect(destined.moves).toEqual([OMENS_OF_FATE]);
	});

	it("Omens of Fate rolls +Omens, marks no XP on a 6-, and belongs to the Destined alone", () => {
		const move = wbhMove(OMENS_OF_FATE);
		expect(move.system).toMatchObject({
			rollType: "omens", noXpOnMiss: true,
			requirement: { playbook: WBH, background: "destined" },
		});
		expect(move.system.moveResults.partial.value).toMatch(/^Lose all Omens/);
		expect(move.system.moveResults.success.value).toContain("follow-up question");
		expect(move.system.moveResults.failure.value).toContain("Hold +1 Omen");
	});

	it("Driven asks 'What was it?' (choose 1) and Destined asks for 3 or 4 of the 25 destiny words", () => {
		const driven = background("driven");
		expect(driven.choices.count).toEqual([1]);
		expect(driven.choices.options.map(o => o.label)).toEqual([
			"A loved one was killed or abducted",
			"Someone gave their life to save you",
			"Your idol sacrificed themselves to save many",
			"You stumbled upon a dark mystery",
			"You must make amends for a terrible mistake",
		]);
		const destined = background("destined");
		expect(destined.choices.count).toEqual([3, 4]);
		expect(destined.choices.options).toHaveLength(25);
		expect(destined.choices.options.map(o => o.label)).toEqual(expect.arrayContaining(
			["anointed", "your coming foretold", "unify", "earth & stone", "the Things Below"]));
		// The lists now show the options, so the descriptions keep only their lead-ins.
		expect(driven.description).toContain("What was it? Choose 1.");
		expect(driven.description).not.toContain("a loved one was killed");
		expect(destined.description).toContain("Choose 3-4 of the items below to describe your destiny.");
		expect(destined.description).not.toContain("the Things Below");
	});

	// `background.choices` is one flat map shared by every background (the Blessed's Initiates are in it).
	it("every background choice slug is unique across all the playbooks", () => {
		const slugs = ALL_PLAYBOOKS.flatMap(pb => (pb.flags.stonetop.backgrounds ?? []).flatMap(b => (b.choices?.options ?? []).map(o => o.slug)));
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it("drops the dead omen and resolve clocks from the playbook item", () => {
		expect(PACK.get("the-would-be-hero").system.attributes).toEqual({});
	});

	it("Never Gonna Keep Me Down prints one circle (p.138)", () => {
		expect(wbhMove(NEVER_GONNA_KEEP_ME_DOWN).system.resource).toEqual({ max: 1, title: "Used this session" });
	});
});

describe("the Destined's Omens track", () => {
	it("onboarding as the Destined starts with no Omens, the box unticked, and Omens of Fate given", async () => {
		const { actor, sheet } = hero();
		await onboard(sheet, RUN());
		expect(flag(actor, "background.setupResources")).toMatchObject({ omens: 0, "destiny-fulfilled": 0 });
		expect(ownedMoveNames(actor)).toContain(OMENS_OF_FATE);
	});

	it("a switch to Destined mid-play empties both, and leaving it takes Omens of Fate back", async () => {
		const { actor, sheet } = hero({ flags: {
			"background.selected": "driven",
			"background.setupResources": { omens: 2, "destiny-fulfilled": 1 },
		} });
		stubConfirm(true);
		await choose(sheet, "destined");
		expect(flag(actor, "background.setupResources")).toMatchObject({ omens: 0, "destiny-fulfilled": 0 });
		expect(ownedMoveNames(actor)).toContain(OMENS_OF_FATE);

		await choose(sheet, "impetuous-youth");
		expect(ownedMoveNames(actor)).not.toContain(OMENS_OF_FATE);
	});

	it("is never a level-up pick for another background's hero", async () => {
		const { char } = buildLiveCharacter({ slug: "the-would-be-hero", name: WBH, level: 2, flags: { "background.selected": "driven" } });
		const data = await char.getLevelUpData();
		expect(data.availableMoves.map(m => m.name)).not.toContain(OMENS_OF_FATE);
		expect(data.lockedMoves.map(m => m.name)).not.toContain(OMENS_OF_FATE);
	});

	it("shows on the Details tab: the circles, and the destiny words laid out in a row", async () => {
		const { char } = hero({ flags: { "background.selected": "destined", "background.setupResources": { omens: 2 } } });
		const { playbook } = await char.buildSnapshot();
		const destined = playbook.background.options.find(o => o.slug === "destined");
		expect(destined.setupResources.map(r => [r.key, r.current, r.max])).toEqual([["omens", 2, 3], ["destiny-fulfilled", 0, 1]]);
		expect(destined.choices).toMatchObject({ inline: true, countLabel: "3 or 4" });
		expect(playbook.background.options.find(o => o.slug === "driven").choices).toMatchObject({ inline: false, countLabel: "1" });
	});
});

describe("rolling +Omens", () => {
	it("adds the Omens held as the stat, and marks no XP on a 6-", () => {
		const { actor } = hero({ flags: { "background.selected": "destined", "background.setupResources": { omens: 2 } } });
		expect(omensRollOptions(actor)).toEqual({ statValue: 2, noXpOnMiss: true });
		// Through the seam the generic roll asks (item/StonetopItem.js#roll).
		expect(moveRollOptions(OMENS_OF_FATE, actor)).toMatchObject({ statValue: 2, noXpOnMiss: true });
		// Not Destined: nothing to roll with.
		const other = hero({ flags: { "background.selected": "driven" } });
		expect(omensRollOptions(other.actor)).toBeNull();
	});

	it("is not a stat roll, so its 10+ asks nothing of Potential for Greatness", async () => {
		const { actor } = hero({ flags: { "background.selected": "destined" }, seedStartingMoves: true });
		globalThis.ChatMessage = { create: vi.fn(), getSpeaker: () => ({}) };
		await maybeRemindPotentialForGreatness(actor, "omens", 11);
		expect(globalThis.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("asks for none on a 7+ and one more on a 6-, never past 3", () => {
		expect(omensForTier("success", 2)).toBe(0);
		expect(omensForTier("partial", 3)).toBe(0);
		expect(omensForTier("failure", 0)).toBe(1);
		expect(omensForTier("failure", 3)).toBe(3);
	});

	it("a 6- holds +1 Omen and a 7+ loses them all, and a Shift or +1 moves the track with the card", async () => {
		const { actor } = hero({ flags: { "background.selected": "destined", "background.setupResources": { omens: 1 } } });
		const message = card(OMENS_OF_FATE);

		await recordTierEffects(message, await settleTierEffects(actor, OMENS_OF_FATE, "failure"));
		expect(omens(actor)).toBe(2);
		expect(message.getFlag(SYSTEM_ID, "tierEffects")).toEqual({ omens: { prior: 1, set: 2 } });

		// Lifted to a 7-9: all Omens lost.
		await reconcileTierEffects(message, 8, { actor });
		expect(omens(actor)).toBe(0);
		// And back down to the 6-: the one it held, back again.
		await reconcileTierEffects(message, 6, { actor });
		expect(omens(actor)).toBe(2);
	});

	it("keeps an Omen ticked by hand since the roll when its tier moves", async () => {
		const { actor, char } = hero({ flags: { "background.selected": "destined", "background.setupResources": { omens: 0 } } });
		const message = card(OMENS_OF_FATE);
		await recordTierEffects(message, await settleTierEffects(actor, OMENS_OF_FATE, "failure"));
		expect(omens(actor)).toBe(1);
		await char.background.setSetupResource("omens", 2);
		// The 6- is shifted up: only the one it added comes off.
		await reconcileTierEffects(message, 7, { actor });
		expect(omens(actor)).toBe(1);
	});

	it("does nothing for a hero who is no longer Destined", async () => {
		const { actor } = hero({ flags: { "background.selected": "driven", "background.setupResources": { omens: 2 } } });
		expect(await settleTierEffects(actor, OMENS_OF_FATE, "success")).toEqual({});
		expect(omens(actor)).toBe(2);
	});
});

describe("the start-of-session Omens reminder", () => {
	const saved = {};
	beforeEach(() => { saved.game = globalThis.game; });
	afterEach(() => { globalThis.game = saved.game; });

	it("prints the book's words and a Roll button per Destined hero", async () => {
		const posted = [];
		globalThis.ChatMessage = { create: vi.fn(async d => posted.push(d)) };
		const destinedHero = { id: "hero-1", name: "Wynfor", type: "character", flags: { [SYSTEM_ID]: { background: { selected: "destined" } } }, getFlag: () => null };
		const actors = [destinedHero];
		globalThis.game = {
			i18n: saved.game.i18n,
			user: { id: "gm", isGM: true },
			users: { activeGM: { id: "gm" } },
			settings: { get: () => true },
			actors: Object.assign(actors, { filter: fn => Array.prototype.filter.call(actors, fn) }),
		};

		await remindDestinedOmenRoll();

		const html = posted[0].content;
		expect(html).toContain("the GM will describe a vision or portent that points toward your fate and/or clarifies your current situation");
		expect(html).toContain("and how your fears play into them");
		expect(html).toContain('class="stonetop-omens-roll-btn" data-actor-id="hero-1"');
	});

	it("the button rolls that hero's Omens of Fate for its owner, and is disabled for anyone else", async () => {
		const { actor, char } = hero({ flags: { "background.selected": "destined" } });
		await char.ensureStartingMoves();
		actor.isOwner = true;
		actor.sheet = { rollMoveByName: vi.fn(async () => {}) };
		const stranger = { isOwner: false };
		globalThis.game = { actors: { get: id => (id === "mine" ? actor : stranger) } };

		const listeners = {};
		const mine = { dataset: { actorId: "mine" }, disabled: false, addEventListener: (type, fn) => { listeners.mine = fn; } };
		const theirs = { dataset: { actorId: "theirs" }, disabled: false, addEventListener: vi.fn() };
		wireOmenRollButtons({ querySelectorAll: () => [mine, theirs] });

		expect(theirs.disabled).toBe(true);
		expect(theirs.addEventListener).not.toHaveBeenCalled();
		await listeners.mine();
		expect(actor.sheet.rollMoveByName).toHaveBeenCalledWith(OMENS_OF_FATE);
	});

	it("the roll is once a session: spent on that card after a roll, given back when the roll is backed out of", async () => {
		const { actor, char } = hero({ flags: { "background.selected": "destined" } });
		await char.ensureStartingMoves();
		actor.isOwner = true;
		const flags = {};
		actor.getFlag = (_scope, key) => flags[key];
		actor.setFlag = vi.fn(async (_scope, key, value) => { flags[key] = value; });
		actor.sheet = { rollMoveByName: vi.fn(async () => false) };
		globalThis.game = { actors: { get: () => actor } };
		const message = { id: "reminder-1" };
		const button = () => {
			const btn = { dataset: { actorId: "mine" }, disabled: false, addEventListener: (type, fn) => { btn.click = fn; } };
			return btn;
		};

		const first = button();
		wireOmenRollButtons({ querySelectorAll: () => [first] }, message);
		await first.click();                                   // backed out of the roll's window
		expect(first.disabled).toBe(false);
		expect(actor.setFlag).not.toHaveBeenCalled();

		actor.sheet.rollMoveByName.mockResolvedValue(undefined);
		await first.click();                                   // rolled
		expect(first.disabled).toBe(true);
		expect(flags[OMENS_ROLLED_FROM_FLAG]).toBe("reminder-1");

		const rerendered = button();
		wireOmenRollButtons({ querySelectorAll: () => [rerendered] }, message);
		expect(rerendered.disabled).toBe(true);
		const nextSession = button();
		wireOmenRollButtons({ querySelectorAll: () => [nextSession] }, { id: "reminder-2" });
		expect(nextSession.disabled).toBe(false);
	});

	it("gives a Destined hero from before the move shipped their Omens of Fate first", async () => {
		const { actor } = hero({ flags: { "background.selected": "destined" } });
		actor.isOwner = true;
		actor.sheet = { rollMoveByName: vi.fn(async () => {}) };
		expect(ownedMoveNames(actor)).not.toContain(OMENS_OF_FATE);
		expect(await rollOmensOfFate(actor)).toBe(true);
		expect(ownedMoveNames(actor)).toContain(OMENS_OF_FATE);
	});
});

describe("Death's Door for a Destined hero", () => {
	it("moves the tier up a step until the destiny is fulfilled", () => {
		const open = { backgroundSlug: "destined", setupResources: {} };
		expect(deathsDoorRollOptions([], {}, open).tierShift).toBe("Destined");
		expect(deathsDoorRollOptions([], {}, { backgroundSlug: "destined", setupResources: { "destiny-fulfilled": 1 } }).tierShift).toBeNull();
		expect(deathsDoorRollOptions([], {}, { backgroundSlug: "driven", setupResources: {} }).tierShift).toBeNull();
		expect(deathsDoorRollOptions([], {}).tierShift).toBeNull();

		// The Door's card carries the bend (utils/counted-tier.js), and is read the same by the window and the GM.
		const doorCard = tierShift => ({
			getFlag: (scope, key) => (scope === SYSTEM_ID && key === ROLLED_FLAG ? rolledRecord("", {
				moveName: "Death's Door", missCountsAsPartial: tierShift ?? "", partialCountsAsSuccess: tierShift ?? "",
			}) : undefined),
		});
		expect(deathsDoorCardTier(doorCard("Destined"), 6)).toBe("partial");
		expect(deathsDoorCardTier(doorCard("Destined"), 8)).toBe("success");
		expect(deathsDoorCardTier(doorCard("Destined"), 12)).toBe("success");
		expect(deathsDoorCardTier(doorCard(null), 6)).toBe("failure");
		expect(deathsDoorCardTierShift(doorCard("Destined"))).toBe("Destined");
		expect(deathsDoorCardTierShift(doorCard(null))).toBeNull();
	});

	it("reads the background and its box off the live character", async () => {
		const { char } = hero({ flags: { "background.selected": "destined" } });
		expect(char.deathsDoorRollOptions().tierShift).toBe("Destined");
		await char.background.setSetupResource("destiny-fulfilled", 1);
		expect(char.deathsDoorRollOptions().tierShift).toBeNull();
	});

	it("the walkthrough applies the shifted tier, and the card and window both name the Destined", async () => {
		const actor = { id: "a1", name: "Wynfor", type: "character", getFlag: () => null };
		const character = atTheDoor(actor, () => deathsDoorRollOptions([], {}, { backgroundSlug: "destined" }));
		const dialog = new DeathsDoorDialog(character, () => {});
		dialog._applyTier = vi.fn(async () => {});
		dialog.renderIfOpen = vi.fn();
		rollStat.mockResolvedValueOnce({ total: 5 });

		await dialog._onRoll();

		expect(dialog._applyTier).toHaveBeenCalledWith("partial");
		expect(rollStat.mock.calls.at(-1)[2]).toMatchObject({ missCountsAsPartial: "Destined", partialCountsAsSuccess: "Destined", noXpOnMiss: true });
		const data = dialog.getData();
		expect(data).toMatchObject({ isWeak: true, isMiss: false });
		expect(data.tierNote).toBe("Destined: your 6- counts as a 7-9.");
	});

	it("a fulfilled destiny rolls Death's Door as written", async () => {
		const actor = { id: "a1", name: "Wynfor", type: "character", getFlag: () => null };
		const character = atTheDoor(actor, () => deathsDoorRollOptions([], {}, { backgroundSlug: "destined", setupResources: { "destiny-fulfilled": 1 } }));
		const dialog = new DeathsDoorDialog(character, () => {});
		dialog._applyTier = vi.fn(async () => {});
		dialog.renderIfOpen = vi.fn();
		rollStat.mockResolvedValueOnce({ total: 5 });

		await dialog._onRoll();

		expect(dialog._applyTier).toHaveBeenCalledWith("failure");
		expect(rollStat.mock.calls.at(-1)[2].missCountsAsPartial).toBeUndefined();
		expect(dialog.getData().tierNote).toBe("");
	});
});

describe("Never Gonna Keep Me Down at Death's Door", () => {
	const neverGonna = () => makeLiveItem({ name: NEVER_GONNA_KEEP_ME_DOWN, type: "move", system: structuredClone(wbhMove(NEVER_GONNA_KEEP_ME_DOWN).system) });

	it("offers the skip only while it is learned and its circle is clear", async () => {
		expect(deathsDoorRollOptions([NEVER_GONNA_KEEP_ME_DOWN], {}).skipRollMove).toBe(NEVER_GONNA_KEEP_ME_DOWN);
		expect(deathsDoorRollOptions([NEVER_GONNA_KEEP_ME_DOWN], { [NEVER_GONNA_KEEP_ME_DOWN]: 1 })).toMatchObject({ skipRollMove: null, neverGonnaUsed: true });
		expect(deathsDoorRollOptions([], {}).skipRollMove).toBeNull();

		const { char } = hero({ items: [neverGonna()] });
		expect(char.deathsDoorRollOptions().skipRollMove).toBe(NEVER_GONNA_KEEP_ME_DOWN);
		await char.moveResources.setUses(NEVER_GONNA_KEEP_ME_DOWN, 1);
		expect(char.deathsDoorRollOptions()).toMatchObject({ skipRollMove: null, neverGonnaUsed: true });
	});

	it("'Don't roll: take a 10+' marks the circle, lands a 10+ with no dice, and names the move", async () => {
		const posted = [];
		globalThis.ChatMessage = { create: vi.fn(async d => posted.push(d)), getSpeaker: () => ({}) };
		// At the Door: dying at 0 HP, which is the only time the window offers the button.
		const { char, actor } = hero({ items: [neverGonna()], flags: { deathsDoor: "dying" } });
		actor.id = "a1";
		actor.system.attributes.hp.value = 0;
		const dialog = new DeathsDoorDialog(char, () => {});
		dialog._applyTier = vi.fn(async () => {});
		dialog.renderIfOpen = vi.fn();
		rollStat.mockClear();

		await dialog._onTakeTenPlus();

		expect(rollStat).not.toHaveBeenCalled();
		expect(dialog._applyTier).toHaveBeenCalledWith("success");
		expect(char.moveResources.getMoveResources()[NEVER_GONNA_KEEP_ME_DOWN]).toBe(1);
		expect(posted[0].content).toContain(NEVER_GONNA_KEEP_ME_DOWN);
		expect(posted[0].content).toContain("doesn't roll Death's Door");
		const data = dialog.getData();
		expect(data).toMatchObject({ isStrong: true, rolledTotal: null, skipRollMove: null, neverGonnaUsed: true });
		expect(data.tierNote).toContain(NEVER_GONNA_KEEP_ME_DOWN);

		// Spent for the session: a second press does nothing.
		dialog._applyTier.mockClear();
		await dialog._onTakeTenPlus();
		expect(dialog._applyTier).not.toHaveBeenCalled();
	});

	it("End of Session gives the use back", async () => {
		const { char, actor } = hero({ items: [neverGonna()] });
		await char.moveResources.setUses(NEVER_GONNA_KEEP_ME_DOWN, 1);
		const untouched = hero();
		expect(await resetNeverGonnaKeepMeDown([actor, untouched.actor, { name: "no sheet" }])).toBe(1);
		expect(char.moveResources.getMoveResources()[NEVER_GONNA_KEEP_ME_DOWN]).toBe(0);
		expect(char.deathsDoorRollOptions().skipRollMove).toBe(NEVER_GONNA_KEEP_ME_DOWN);
	});
});

describe("the Driven's and Destined's choices at creation", () => {
	function dialogFor(selections = {}) {
		const dialog = Object.create(CharacterOnboardingDialog.prototype);
		dialog._initializeState(playbookDoc(), null, null);
		Object.assign(dialog._selections, selections);
		return dialog;
	}

	it("asks each background's own list on its card, and only the taken one shows picks", () => {
		const dialog = dialogFor({ backgroundSlug: "destined", backgroundPicks: ["destiny-fire", "driven-dark-mystery"] });
		const destined = dialog._backgroundPicksData(background("destined"));
		expect(destined).toMatchObject({ label: "Your destiny", countLabel: "3 or 4", inline: true, selectedCount: 1, underMin: true });
		expect(destined.options.find(o => o.slug === "destiny-fire").selected).toBe(true);
		const driven = dialog._backgroundPicksData(background("driven"));
		expect(driven).toMatchObject({ countLabel: "1", selectedCount: 0, underMin: false });
		expect(driven.options.every(o => !o.selected && !o.disabled)).toBe(true);
		expect(dialog._backgroundPicksData(background("impetuous-youth"))).toBeNull();
	});

	it("flags a short list, never refuses it, and a full list disables what is left", () => {
		const dialog = dialogFor({ backgroundSlug: "driven" });
		expect(dialog._backgroundPicksData(background("driven")).underMin).toBe(true);
		expect(dialog._setBackgroundPick("driven-make-amends", true)).toBe(true);
		const full = dialog._backgroundPicksData(background("driven"));
		expect(full.underMin).toBe(false);
		expect(full.options.filter(o => o.disabled)).toHaveLength(4);
		// Choose 1: a second tick is refused, as the Details tab's disabled boxes refuse it.
		expect(dialog._setBackgroundPick("driven-dark-mystery", true)).toBe(false);
		expect(dialog._selections.backgroundPicks).toEqual(["driven-make-amends"]);
		expect(dialog._setBackgroundPick("driven-make-amends", false)).toBe(true);
		expect(dialog._selections.backgroundPicks).toEqual([]);
	});

	it("keeps the Blessed's Initiates on their own step", () => {
		const blessed = loadPlaybookPackDocs().find(d => d.system.slug === "the-blessed");
		const dialog = Object.create(CharacterOnboardingDialog.prototype);
		dialog._initializeState({ ...structuredClone(blessed), uuid: "Compendium.test.the-blessed" }, null, null);
		dialog._selections.backgroundSlug = "initiate";
		expect(dialog._backgroundPicksData(blessed.flags.stonetop.backgrounds.find(b => b.slug === "initiate"))).toBeNull();
	});

	it("onboarding writes the taken background's list as a set, leaving another background's picks alone", async () => {
		const { actor, sheet } = hero({ flags: { "background.choices": { "driven-dark-mystery": true } } });
		await onboard(sheet, RUN({ backgroundPicks: ["destiny-fire", "destiny-protect", "destiny-the-stone", "driven-make-amends"] }));
		const choices = flag(actor, "background.choices");
		expect(Object.entries(choices).filter(([, v]) => v === true).map(([k]) => k).sort())
			.toEqual(["destiny-fire", "destiny-protect", "destiny-the-stone", "driven-dark-mystery"]);
		expect(choices["destiny-anointed"]).toBe(false);

		// And a re-run reads them back for the dialog.
		const restored = sheet._readSelectionsFromActor(playbookDoc());
		expect(restored.backgroundPicks).toEqual(expect.arrayContaining(["destiny-fire", "destiny-protect", "destiny-the-stone"]));
	});

	it("backgroundChoicePatch covers only that background's options", () => {
		const patch = backgroundChoicePatch(backgrounds(), "driven", ["driven-idol-sacrificed", "destiny-fire"]);
		expect(Object.keys(patch)).toHaveLength(5);
		expect(patch["driven-idol-sacrificed"]).toBe(true);
		expect(patch["destiny-fire"]).toBeUndefined();
	});
});
