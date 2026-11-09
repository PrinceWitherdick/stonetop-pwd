// The Lightbearer's audit (2026-09-25), driven through a real StonetopCharacter: the gate on every
// "(Requires level 6+ and X)" move and the stat moves' caps; the Invocation Level Up step 5 owes at
// each even level; a Would-be Hero who takes Invoke the Sun God through Versatile, and loses it
// again; the rolls that light and snuff the holy light (Luminous Shield, Wielder of the White
// Flame); the unticked Persuade lines (Radiant Countenance, Soul on Fire); and A Candle Against
// the Dark's armor beside a shield and beside Barkskin.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem, ownedMoveNames, resetLiveIds, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { canWieldHolyLight, holyLightAfterRoll, HOLY_LIGHT_FLAG } from "../../../module/actors/character/holy-light.js";
import { BARKSKIN } from "../../../module/actors/character/blessed-marks.js";
import { CANDLE_AGAINST_THE_DARK, ARMOR_SOURCE_JOIN } from "../../../module/actors/character/move-armor.js";
import { settleTierEffects, recordTierEffects, reconcileTierEffects } from "../../../module/actors/character/tier-effects.js";

const PACK   = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const GROUPS = PACK.get("the-lightbearer").flags.stonetop.moves?.choices ?? [];
const lb     = name => sourceMovesFor("The Lightbearer").find(d => d.name === name);
const lbAt   = (level, opts = {}) => buildLiveCharacter({ slug: "the-lightbearer", name: "The Lightbearer", level, ...opts });
const known  = actor => actor.getFlag(STONETOP_SCOPE, "invocations.selected") ?? [];
const STAT_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

// The Lightbearer's moves as the Moves tab builds them, keyed by name.
async function sheetEntries(char, level) {
	const entries = await char._moveRepo.getPlaybookMoves("The Lightbearer");
	const built = char.buildMovelistContext(entries, char._buildOwnedMovesMap(), new Set(), level, "The Lightbearer", GROUPS);
	return new Map(built.map(e => [e.name, e]));
}

beforeEach(() => resetLiveIds());

describe("the Lightbearer's move gates, as the sheet reads them", () => {
	it.each([
		["Burn Twice as Bright",       "Invoke the Sun God"],
		["Empowered Invocations",      "Invoke the Sun God"],
		["Glorious Servant",           "Invoke the Sun God"],
		["Wielder of the White Flame", "Invoke the Sun God"],
		["Hungry Flames",              "Purifying Flames"],
		["Light, More Light",          "Consecrated Flame"],
	])("%s needs level 6+ and %s", async (name, need) => {
		const { char } = lbAt(6, { seedStartingMoves: false });
		expect((await sheetEntries(char, 6)).get(name)).toMatchObject({ minLevel: 6, requiresLabel: `${need}; level 6+`, locked: true });
		await char.addMove(lb(need)._id);
		expect((await sheetEntries(char, 5)).get(name).locked).toBe(true);
		expect((await sheetEntries(char, 6)).get(name).locked).toBe(false);
	});

	it("Luminous Shield needs A Candle Against the Dark, at any level", async () => {
		const { char } = lbAt(1);
		expect((await sheetEntries(char, 1)).get("Luminous Shield")).toMatchObject({ minLevel: null, requiresLabel: "A Candle Against the Dark", locked: true });
		await char.addMove(lb("A Candle Against the Dark")._id);
		expect((await sheetEntries(char, 1)).get("Luminous Shield").locked).toBe(false);
	});

	it("Superior Stat is level 6+, capped at +3 and taken once; Improved Stat caps at +2, three takes", async () => {
		const { char } = lbAt(6);
		const at5 = await sheetEntries(char, 5);
		expect(at5.get("Superior Stat")).toMatchObject({ minLevel: 6, locked: true, cap: 3, repeatMax: 1 });
		expect(at5.get("Improved Stat")).toMatchObject({ minLevel: null, locked: false, cap: 2, repeatMax: 3 });
		expect((await sheetEntries(char, 6)).get("Superior Stat").locked).toBe(false);
	});
});

// Level Up step 5 (Book I p.528): "If you are the Lightbearer (or have Invoke the Sun God) and your new
// level is even, choose a new invocation." Known = 2 + floor(L/2), until all ten are known.
describe("the Invocation each even level owes", () => {
	it("is asked at every even level and never at an odd one, so 2 + floor(L/2) are known at each level, capped at 10", async () => {
		const { char, actor } = lbAt(1, { flags: { "invocations.selected": ["bath-of-healing-light", "blinding-light"] } });
		const seen = [];
		for (let step = 0; step < 20; step++) {
			const data = await char.getLevelUpData();
			if (!data.availableMoves.length) break;
			expect(data.needsInvocation).toBe(data.newLevel % 2 === 0 && known(actor).length < 10);
			const move = data.availableMoves[0];
			const choices = move.cap != null ? { stat: STAT_KEYS.find(k => actor.system.stats[k].value < move.cap), cap: move.cap } : null;
			await char.applyLevelUp(move.compendiumId, data.needsInvocation ? data.availableInvocations[0].slug : null, choices);
			const level = actor.system.attributes.level.value;
			expect(known(actor)).toHaveLength(Math.min(10, 2 + Math.floor(level / 2)));
			seen.push(level);
		}
		// Past 10th level the climb goes on, and the tenth Invocation (at 16th) is the last one asked.
		expect(seen).toContain(18);
	});

	it("asks nothing once all ten are known", async () => {
		const all = PACK.get("the-lightbearer").flags.stonetop.invocations.options.map(o => o.slug);
		expect(all).toHaveLength(10);
		const { char } = lbAt(3, { flags: { "invocations.selected": all } });
		const data = await char.getLevelUpData();
		expect(data.newLevel).toBe(4);
		expect(data.needsInvocation).toBe(false);
		expect(data.availableInvocations).toEqual([]);
	});

	it("learns an Invocation once, however often the step is applied with it (B10)", async () => {
		const { char, actor } = lbAt(3, { flags: { "invocations.selected": ["bath-of-healing-light", "blinding-light"] } });
		const data = await char.getLevelUpData();
		const move = data.availableMoves.find(m => m.cap == null);
		await char.applyLevelUp(move.compendiumId, "blinding-light", null);
		expect(known(actor)).toEqual(["bath-of-healing-light", "blinding-light"]);
	});
});

describe("a Would-be Hero with Invoke the Sun God through Versatile", () => {
	const versatileId = () => sourceMovesFor("The Would-Be Hero").find(d => d.name === "Versatile")._id;
	const takeInvoke = (char, invocation) => char.applyLevelUp(versatileId(), invocation,
		{ crossPlaybook: true, foreignMoveId: lb("Invoke the Sun God")._id, grantsPossession: null });

	it("learns the Invocation the even level owes on the level-up that grants the move", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 3 });
		const data = await char.getLevelUpData();
		// Not owed yet (no Invoke the Sun God), but on offer for the step the dialog opens when it's picked.
		expect(data.needsInvocation).toBe(false);
		expect(data.availableInvocations.length).toBe(10);
		await takeInvoke(char, "bath-of-healing-light");
		expect(ownedMoveNames(actor)).toContain("Invoke the Sun God");
		expect(known(actor)).toEqual(["bath-of-healing-light"]);
	});

	it("is owed nothing for an Invoke the Sun God held switched off (B4)", async () => {
		const invoke = lb("Invoke the Sun God");
		const { char } = buildLiveCharacter({
			slug: "the-would-be-hero", name: "The Would-Be Hero", level: 3,
			items: [makeLiveItem({ name: invoke.name, type: "move", system: structuredClone(invoke.system), flags: { [STONETOP_SCOPE]: { learned: false } } })],
		});
		expect((await char.getLevelUpData()).needsInvocation).toBe(false);
		// The Invocations tab still shows the held copy's list.
		expect(await char.invocationSource()).not.toBeNull();
		expect(await char.invocationSource(undefined, { learned: true })).toBeNull();
	});

	it("loses the Invocations and the ongoing slots with the move (R6)", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 3 });
		await takeInvoke(char, "blinding-light");
		await actor.setFlag(STONETOP_SCOPE, "ongoingInvocation", "blinding-light");
		await actor.setFlag(STONETOP_SCOPE, "ongoingInvocationSecond", "dancing-light");
		const versatile = actor.items.find(i => i.name === "Versatile")._id;
		// The sheet warns of it first (moveRemovalStakes reads the same plan the removal applies).
		expect(await char.moveRemovalStakes(versatile)).toMatchObject({ granted: ["Invoke the Sun God"], invocations: true });
		await char.removeMove(versatile);
		expect(ownedMoveNames(actor)).not.toContain("Invoke the Sun God");
		expect(actor.getFlag(STONETOP_SCOPE, "invocations")).toBeNull();
		expect(actor.getFlag(STONETOP_SCOPE, "ongoingInvocation")).toBeNull();
		expect(actor.getFlag(STONETOP_SCOPE, "ongoingInvocationSecond")).toBeNull();
		expect(await char.invocationSource()).toBeNull();
	});

	it("keeps them while another copy of Invoke the Sun God is still held", async () => {
		const invoke = lb("Invoke the Sun God");
		const { char, actor } = buildLiveCharacter({
			slug: "the-would-be-hero", name: "The Would-Be Hero", level: 3,
			flags: { "invocations.selected": ["blinding-light"] },
			items: [makeLiveItem({ name: invoke.name, type: "move", system: structuredClone(invoke.system) })],
		});
		const extra = makeLiveItem({ name: "Undaunted", type: "move", system: {} });
		actor.items.push(extra);
		await char.removeMove(extra._id);
		expect(known(actor)).toEqual(["blinding-light"]);
	});
});

describe("a Lightbearer losing Invoke the Sun God", () => {
	it("keeps the playbook's own Invocations (R6 is for a borrowed list only)", async () => {
		const { char, actor } = lbAt(2, { flags: { "invocations.selected": ["bath-of-healing-light", "blinding-light"], ongoingInvocation: "blinding-light" } });
		const invoke = actor.items.find(i => i.name === "Invoke the Sun God")._id;
		// So the untick's warning doesn't say they go.
		expect(await char.moveRemovalStakes(invoke)).toMatchObject({ invocations: false });
		await char.removeMove(invoke);
		expect(known(actor)).toEqual(["bath-of-healing-light", "blinding-light"]);
		expect(actor.getFlag(STONETOP_SCOPE, "ongoingInvocation")).toBe("blinding-light");
	});
});

// Luminous Shield: "on a 6-, your light snuffs out and the attack is unimpeded". Wielder of the White
// Flame: "on a 10+, it ignites with a white flame that casts a holy light ...; on a 7-9, it ignites".
describe("the rolls that snuff and light the holy light (B5)", () => {
	let chat;
	beforeEach(() => {
		chat = vi.fn(async () => ({}));
		globalThis.ChatMessage = { create: chat, getSpeaker: () => ({}) };
	});
	afterEach(() => { delete globalThis.ChatMessage; });

	function roller({ move, total, learned = true, flags = {} }) {
		const made = lbAt(6, { flags });
		const item = {
			_id: `${move}-1`, name: move, type: "move", system: { rollType: "cha" },
			flags: learned ? {} : { [STONETOP_SCOPE]: { learned: false } },
			roll: vi.fn(async () => ({ total })),
		};
		const items = [...made.actor.items, item];
		items.get = id => items.find(i => i._id === id) ?? null;
		made.actor.items = items;
		const roll = () => made.char.onRoll({
			currentTarget: { closest: sel => (sel === ".item" ? { dataset: { itemId: item._id } } : null), getAttribute: () => null },
		}, {});
		return { ...made, roll };
	}
	const lit = actor => !!actor.getFlag(STONETOP_SCOPE, HOLY_LIGHT_FLAG);
	const said = () => chat.mock.calls.map(([msg]) => msg.content).join("\n");

	it("reads the tier: Shield's 6- snuffs, Wielder's 7+ lights, nothing else does", () => {
		expect(holyLightAfterRoll("Luminous Shield", "failure")).toBe(false);
		expect(holyLightAfterRoll("Luminous Shield", "partial")).toBeNull();
		expect(holyLightAfterRoll("Wielder of the White Flame", "success")).toBe(true);
		expect(holyLightAfterRoll("Wielder of the White Flame", "partial")).toBe(true);
		expect(holyLightAfterRoll("Wielder of the White Flame", "failure")).toBeNull();
		expect(holyLightAfterRoll("Consecrated Flame", "failure")).toBeNull();
	});

	it("snuffs the light on a Luminous Shield 6-, ends the Invocation running and says what went out", async () => {
		const { actor, roll } = roller({ move: "Luminous Shield", total: 4, flags: { [HOLY_LIGHT_FLAG]: true, ongoingInvocation: "blinding-light" } });
		await roll();
		expect(lit(actor)).toBe(false);
		expect(actor.getFlag(STONETOP_SCOPE, "ongoingInvocation")).toBeNull();
		expect(said()).toContain("holy light snuffs out");
		expect(said()).toContain("Blinding Light");
	});

	it("keeps the light on a Luminous Shield 7-9, and posts nothing for a light already out", async () => {
		const held = roller({ move: "Luminous Shield", total: 8, flags: { [HOLY_LIGHT_FLAG]: true } });
		await held.roll();
		expect(lit(held.actor)).toBe(true);
		const dark = roller({ move: "Luminous Shield", total: 3 });
		await dark.roll();
		expect(said()).not.toContain("snuffs out");
	});

	it("lights it on a Wielder of the White Flame 7+, and not for the move switched off", async () => {
		const { actor, roll } = roller({ move: "Wielder of the White Flame", total: 8 });
		await roll();
		expect(lit(actor)).toBe(true);
		const off = roller({ move: "Wielder of the White Flame", total: 11, learned: false });
		await off.roll();
		expect(lit(off.actor)).toBe(false);
	});

	// The card's tier moved after the dice (a GM's Shift, a +1 on it): the light follows it
	// (actors/character/tier-effects.js), relit with the Invocation the 6- ended.
	it("relights a Luminous Shield 6- lifted to a 7-9, with its Invocation, and snuffs it lowered again", async () => {
		const { char, actor } = roller({ move: "Luminous Shield", total: 4, flags: { [HOLY_LIGHT_FLAG]: true, ongoingInvocation: "blinding-light" } });
		actor.typedActor = char;
		const flags = { [STONETOP_SCOPE]: { move: "Luminous Shield" } };
		const message = {
			getFlag: (scope, key) => flags[scope]?.[key],
			setFlag: vi.fn(async (scope, key, value) => { flags[scope][key] = value; }),
		};
		await recordTierEffects(message, await settleTierEffects(actor, "Luminous Shield", "failure"));
		expect(lit(actor)).toBe(false);
		expect(actor.getFlag(STONETOP_SCOPE, "ongoingInvocation")).toBeNull();

		await reconcileTierEffects(message, 8, { actor });
		expect(lit(actor)).toBe(true);
		expect(actor.getFlag(STONETOP_SCOPE, "ongoingInvocation")).toBe("blinding-light");

		await reconcileTierEffects(message, 5, { actor });
		expect(lit(actor)).toBe(false);
	});
});

// A Candle Against the Dark, Purifying Flames, Luminous Shield and Hungry Flames read a holy light, and
// a Would-be Hero can take the first two through Versatile with no maker: the candle has to be theirs.
describe("who gets the candle (B8)", () => {
	it.each(["A Candle Against the Dark", "Purifying Flames", "Luminous Shield", "Hungry Flames"])("%s earns it", name => {
		expect(canWieldHolyLight({ items: [{ type: "move", name }] })).toBe(true);
	});
	it("still leaves a character with none of the moves without one", () => {
		expect(canWieldHolyLight({ items: [{ type: "move", name: "Undaunted" }] })).toBe(false);
	});
});

describe("the Lightbearer's unticked Persuade lines", () => {
	function persuader({ moves = [], background = null, total = 8 } = {}) {
		const flags = background ? { "background.selected": background } : {};
		const made = buildLiveCharacter({
			slug: "the-lightbearer", name: "The Lightbearer", seedStartingMoves: false, flags,
			items: moves.map(m => makeLiveItem({ name: m.name ?? m, type: "move", system: { moveType: "playbook" }, flags: m.learned === false ? { [STONETOP_SCOPE]: { learned: false } } : undefined })),
		});
		const rolled = name => ({ _id: `${name}-1`, name, type: "move", system: { rollType: "cha" }, roll: vi.fn(async () => ({ total })) });
		const persuade = rolled("Persuade (vs. NPCs)");
		const persuadePcs = rolled("Persuade (vs. PCs)");
		const items = [...made.actor.items, persuade, persuadePcs];
		items.get = id => items.find(i => i._id === id) ?? null;
		made.actor.items = items;
		const roll = (item, prompted) => made.char.onRoll({
			currentTarget: { closest: sel => (sel === ".item" ? { dataset: { itemId: item._id } } : null), getAttribute: () => null },
		}, prompted);
		return { ...made, persuade, persuadePcs, roll };
	}
	const keysOf = async (char, item) => (await char.rollOffers(item)).map(o => o.key);
	const rolledWith = item => item.roll.mock.calls[0][0];

	it("offers Radiant Countenance's fond attention on Persuade, for the LEARNED move only (B11)", async () => {
		const { char, persuade, roll } = persuader({ moves: ["Radiant Countenance"] });
		expect(await char.rollOffers(persuade)).toEqual([expect.objectContaining({ key: "radiant-countenance", applied: false, source: "Radiant Countenance" })]);
		await roll(persuade, { takenOffers: ["radiant-countenance"] });
		expect(rolledWith(persuade).rollMode).toBe("adv");
		expect(rolledWith(persuade).conditionNotes).toContain("Radiant Countenance");
		const off = persuader({ moves: [{ name: "Radiant Countenance", learned: false }] });
		expect(await keysOf(off.char, off.persuade)).toEqual([]);
	});

	it("offers Soul on Fire to its background on a Persuade (vs. NPCs), and taken it prints the choice on 7+ (D2)", async () => {
		const { char, persuade, persuadePcs, roll } = persuader({ background: "soul-on-fire" });
		expect(await char.rollOffers(persuade)).toEqual([expect.objectContaining({ key: "soul-on-fire", applied: false, source: "Soul on Fire", effect: "hitNote" })]);
		expect(await keysOf(char, persuadePcs)).toEqual([]);
		expect(await keysOf(persuader({ background: "auspicious-birth" }).char, persuade)).toEqual([]);
		await roll(persuade, { takenOffers: ["soul-on-fire"] });
		const options = rolledWith(persuade);
		// No advantage: it adds a choice, not a die.
		expect(options.rollMode).toBe("normal");
		expect(options.conditionNotes).toContain("Soul on Fire");
		for (const tier of ["success", "partial"]) expect(options.tierActions[tier]).toContain("your name and your message spread");
		expect(options.tierActions.failure).toBeUndefined();
	});

	it("prints nothing when the Soul on Fire line is left unticked", async () => {
		const { persuade, roll } = persuader({ background: "soul-on-fire" });
		await roll(persuade, { takenOffers: [] });
		expect(rolledWith(persuade).tierActions).toBeUndefined();
	});
});

// "When you wield a holy light but go otherwise unarmed, you have 2 Armor." A shield is the part of
// "otherwise unarmed" the sheet can read (R4); Barkskin beside it is a second clause, not a second base (B7).
describe("A Candle Against the Dark's armor, through the armor arithmetic", () => {
	const SHIELD = { slug: "shield", name: "Shield", shield: true, armor: { modifier: 1 } };
	function candleBearer({ barkskin = false, lit = true } = {}) {
		const moves = [CANDLE_AGAINST_THE_DARK, ...(barkskin ? [BARKSKIN] : [])];
		return buildLiveCharacter({
			slug: "the-lightbearer", name: "The Lightbearer", seedStartingMoves: false,
			flags: lit ? { [HOLY_LIGHT_FLAG]: true } : {},
			items: moves.map(name => makeLiveItem({ name, type: "move", system: { moveType: "playbook" } })),
		});
	}
	const armorOf = (char, carried) => char._armorFrom({ items: [SHIELD], marks: carried ? { shield: true } : {} }, { armor: 0 });

	it("gives 2 armor with the light lit and no shield, and offers it back on the card", () => {
		expect(armorOf(candleBearer().char, false)).toMatchObject({ armor: 2, conditional: 2, conditionalSource: CANDLE_AGAINST_THE_DARK });
	});

	it("gives nothing with a shield carried: the shield's own 1 is all (R4)", () => {
		expect(armorOf(candleBearer().char, true)).toMatchObject({ armor: 1, conditional: 0, conditionalSource: "" });
	});

	it("carries both names when Barkskin holds too, so one unticked clause cannot strip it (B7)", () => {
		expect(armorOf(candleBearer({ barkskin: true }).char, false))
			.toMatchObject({ armor: 2, conditional: 2, conditionalSource: `${BARKSKIN}${ARMOR_SOURCE_JOIN}${CANDLE_AGAINST_THE_DARK}` });
		// A shield takes the Candle out, and Barkskin alone is left (shield on top of the base).
		expect(armorOf(candleBearer({ barkskin: true }).char, true)).toMatchObject({ armor: 3, conditional: 2, conditionalSource: BARKSKIN });
	});
});
