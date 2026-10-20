// Marshal re-audit (2026-10-18), items 5, 6, 11 and 12:
//  - SPEAK SOFTLY (Book I p.127): "When you offer peace but your enemy refuses, gain advantage on your next roll
//    against them." A record of WHO refused, on the Marshal, spent by the next roll aimed at them; an enemy
//    nobody could point at on the map is an unticked "vs. <name>" line on the next rolls until used.
//  - FOCUS FIRE: "each ally has advantage on their next damage roll against that foe", a follower's and the
//    crew's blow included, once per follower.
//  - SET-UP STRIKE: the Clash card's Aid button is live once that Clash's damage took the disadvantage line.
//  - BATTLEFIELD GRACE: with no fight to read, an UNTICKED line on damage to the Marshal, a move's own
//    number included, rather than nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import {
	HERO_MOVES, SPEAK_SOFTLY_FLAG, FOCUS_FIRE_FLAG, FOCUS_FIRE_USED_FLAG,
	recordSpeakSoftly, speakSoftlyAgainst, spendSpeakSoftly, speakSoftlyNamed, speakSoftlyNamedKey, foeAdvantage,
	followerFocusFireOffer, focusFireAgainst, spendFocusFire, defenderDisadvantage,
} from "../../module/fight/hero-moves.js";
import { giveAdvantageCardHtml, setUpStrikeGate } from "../../module/actors/character/give-advantage.js";
import {
	wireSpeakSoftly, speakSoftlyRefused, SPEAK_SOFTLY_CARD_FLAG, wireGiveAdvantage,
} from "../../module/actors/character/give-advantage-flow.js";
import { defenderLines, tookSetUpStrike, SET_UP_STRIKE_STAMP, _movesTakenDamage } from "../../module/combat/attack-flow.js";
import { foesInFight } from "../../module/fight/fight-targets.js";
import { StonetopCharacter } from "../../module/actors/character/StonetopCharacter.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { readRepo } from "../fakes/css.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";

let saved;
beforeEach(() => {
	saved = { game: globalThis.game, ui: globalThis.ui, canvas: globalThis.canvas, CONST: globalThis.CONST, fromUuidSync: globalThis.fromUuidSync, ChatMessage: globalThis.ChatMessage };
	globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
});
afterEach(() => { Object.assign(globalThis, saved); });

/** A character holding the moves named, flags read and written as Foundry's are. */
function pc({ id = "bryn", name = "Bryn", moves = [HERO_MOVES.SPEAK_SOFTLY], owner = true } = {}) {
	const flags = { [SYSTEM_ID]: {} };
	return {
		id, uuid: `Actor.${id}`, name, type: "character", isOwner: owner,
		items: moves.map(move => ({ type: "move", name: move, flags: {} })),
		flags, system: { attributes: { hp: { value: 20, max: 20 } } },
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { flags[scope][key] = value; }),
	};
}

function card({ flags = {} } = {}) {
	const data = { [SYSTEM_ID]: { ...flags } };
	return {
		id: "msg1", flags: data,
		getFlag: (scope, key) => data[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { (data[scope] ??= {})[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete data[scope]?.[key]; }),
	};
}

// Unlinked tokens: each is keyed by its token (fight/hero-moves.js#foeKey).
const REEVE = { uuid: "Scene.s.Token.reeve", name: "Reeve Gunnar" };
const RAIDER = { uuid: "Scene.s.Token.raider", name: "Raider" };

/** The aimed-roll fold, as both roll paths ask it, for `actor`. */
const fold = (actor, targets, options = {}) => StonetopCharacter.prototype._foldAimedModes.call({ _actor: actor }, { ...options }, targets);

describe("Speak Softly: who refused", () => {
	it("is a \"They refused\" button on the posted card, wired from the chat hook", () => {
		const html = giveAdvantageCardHtml(pc(), HERO_MOVES.SPEAK_SOFTLY);
		expect(html).toContain("stonetop-speak-softly");
		expect(readRepo("stonetop.js")).toContain("wireSpeakSoftly(message, html);");
	});

	it("names the ONE targeted token without asking, and the card says who", async () => {
		const bryn = pc();
		const root = new Window().document.createElement("div");
		root.innerHTML = giveAdvantageCardHtml(bryn, HERO_MOVES.SPEAK_SOFTLY);
		const message = card();
		const pick = vi.fn();
		wireSpeakSoftly(message, root, { giver: bryn, usable: true, pick, targets: () => [{ name: "Reeve Gunnar", document: { uuid: REEVE.uuid } }] });
		root.querySelector(".stonetop-speak-softly").click();
		await vi.waitFor(() => expect(message.getFlag(SYSTEM_ID, SPEAK_SOFTLY_CARD_FLAG)).toEqual({ foe: "Reeve Gunnar" }));
		expect(pick).not.toHaveBeenCalled();
		expect(bryn.flags[SYSTEM_ID][SPEAK_SOFTLY_FLAG]).toEqual([{ key: REEVE.uuid, name: "Reeve Gunnar" }]);

		const again = new Window().document.createElement("div");
		again.innerHTML = giveAdvantageCardHtml(bryn, HERO_MOVES.SPEAK_SOFTLY);
		wireSpeakSoftly(message, again, { giver: bryn, usable: true });
		expect(again.querySelector(".stonetop-speak-softly")).toBeNull();
		expect(again.textContent).toContain("Reeve Gunnar refused your peace");
	});

	it("asks among the foes in the fight with nobody targeted, with a row for someone off the map", async () => {
		const bryn = pc();
		const pick = vi.fn(async () => RAIDER.uuid);
		expect(await speakSoftlyRefused(card(), bryn, { targets: () => [], fight: () => [REEVE, RAIDER], pick, resolve: () => null })).toBe(true);
		const ids = pick.mock.calls[0][0].options.map(o => o.id);
		expect(ids.slice(0, 2)).toEqual([REEVE.uuid, RAIDER.uuid]);
		expect(ids).toHaveLength(3);
		expect(bryn.flags[SYSTEM_ID][SPEAK_SOFTLY_FLAG]).toEqual([{ key: RAIDER.uuid, name: "Raider" }]);
	});

	it("takes a typed name with nobody on the map to point at, or from the picker's off-map row", async () => {
		const bryn = pc();
		const askName = vi.fn(async () => "  The Ash Witch ");
		const message = card();
		expect(await speakSoftlyRefused(message, bryn, { targets: () => [], fight: () => [], askName })).toBe(true);
		expect(bryn.flags[SYSTEM_ID][SPEAK_SOFTLY_FLAG]).toEqual([{ key: speakSoftlyNamedKey("The Ash Witch"), name: "The Ash Witch" }]);
		expect(message.getFlag(SYSTEM_ID, SPEAK_SOFTLY_CARD_FLAG)).toEqual({ foe: "The Ash Witch", named: true });

		const other = pc();
		const pick = vi.fn(async ({ options }) => options.at(-1).id);
		expect(await speakSoftlyRefused(card(), other, { targets: () => [], fight: () => [REEVE], pick, askName: async () => "Hermit" })).toBe(true);
		expect(speakSoftlyNamed(other)).toEqual([{ key: speakSoftlyNamedKey("Hermit"), name: "Hermit" }]);
	});

	it("records nothing when the question is put away, and nothing for a Marshal without the move", async () => {
		const bryn = pc();
		expect(await speakSoftlyRefused(card(), bryn, { targets: () => [], fight: () => [], askName: async () => null })).toBe(false);
		expect(await speakSoftlyRefused(card(), bryn, { targets: () => [], fight: () => [REEVE], pick: async () => null })).toBe(false);
		expect(bryn.setFlag).not.toHaveBeenCalled();
		const plain = pc({ moves: [] });
		expect(await recordSpeakSoftly(plain, [REEVE])).toBe(false);
	});
});

describe("Speak Softly: the next roll against them", () => {
	it("gives the next roll aimed at that enemy advantage, named, then is spent; any other roll keeps it", async () => {
		const bryn = pc();
		await recordSpeakSoftly(bryn, [REEVE]);
		// Aimed at someone else: not owed, and nothing is spent.
		const elsewhere = fold(bryn, [RAIDER]);
		expect(elsewhere.options.rollMode).toBeUndefined();
		await elsewhere.spend();
		expect(speakSoftlyAgainst(bryn, [REEVE])).toBe(HERO_MOVES.SPEAK_SOFTLY);
		// An attack reads it as the foe's advantage too (combat/attack-flow.js#attackFoeAdvantage).
		expect(foeAdvantage(bryn, [REEVE])).toBe(HERO_MOVES.SPEAK_SOFTLY);
		const first = fold(bryn, [REEVE]);
		expect(first.options.rollMode).toBe("adv");
		expect(first.options.conditionNotes).toContain("Speak Softly");
		await first.spend();
		expect(speakSoftlyAgainst(bryn, [REEVE])).toBeNull();
		expect(bryn.flags[SYSTEM_ID][SPEAK_SOFTLY_FLAG]).toEqual([]);
	});

	it("is spent by an attack at them, which folds only the disadvantages (grudged)", async () => {
		const bryn = pc();
		await recordSpeakSoftly(bryn, [REEVE]);
		const attack = StonetopCharacter.prototype._foldAimedModes.call({ _actor: bryn }, {}, [REEVE], { grudged: true });
		// The attack's advantage was folded as the foe's (foeAdvantage), so not again here.
		expect(attack.options.rollMode).toBeUndefined();
		await attack.spend();
		expect(await spendSpeakSoftly(bryn, [REEVE])).toBe(false);
		expect(speakSoftlyAgainst(bryn, [REEVE])).toBeNull();
	});

	it("is an UNTICKED \"vs. <name>\" line on the next rolls for an enemy only named, spent when taken", async () => {
		const bryn = pc();
		await recordSpeakSoftly(bryn, [{ name: "The Ash Witch", named: true }]);
		// A named enemy is never matched by a token.
		expect(speakSoftlyAgainst(bryn, [REEVE])).toBeNull();
		const lines = StonetopCharacter.prototype._speakSoftlyNamedOffers.call({ _actor: bryn });
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ applied: false, source: "Speak Softly (vs. The Ash Witch)" });
		expect(lines[0].label).toContain("vs. The Ash Witch: Speak Softly advantage");
		await lines[0].spend();
		expect(speakSoftlyNamed(bryn)).toEqual([]);
		expect(StonetopCharacter.prototype._speakSoftlyNamedOffers.call({ _actor: bryn })).toEqual([]);
	});

	it("rides every move roll's window and a bare stat roll's", () => {
		const src = readRepo("module/actors/character/StonetopCharacter.js");
		const named = src.slice(src.indexOf("async _rollOffersNamed("), src.indexOf("_speakSoftlyNamedOffers() {"));
		expect(named).toContain("...this._speakSoftlyNamedOffers()");
		const direct = src.slice(src.indexOf("async directRollOffers("), src.indexOf("async _rollOffersNamed("));
		expect(direct).toContain("...this._speakSoftlyNamedOffers()");
	});
});

/** An unlinked monster token and a world actor behind it, `fromUuidSync` wired to both. */
function onMap(key, name) {
	const actor = Object.assign(fakeActor({ id: key, name, type: "monster" }), { documentName: "Actor" });
	const token = { uuid: `Scene.s.Token.${key}`, documentName: "Token", name, actorLink: false, actor };
	actor.token = { uuid: token.uuid };
	actor.uuid = `${token.uuid}.Actor.${key}`;
	return token;
}

function marshalWithOrder(foe) {
	const bryn = pc({ moves: [HERO_MOVES.FOCUS_FIRE] });
	bryn.flags[SYSTEM_ID][FOCUS_FIRE_FLAG] = [{ id: "bryn.1", key: foe.uuid, name: foe.name, combat: null }];
	return bryn;
}

describe("Focus Fire: a follower's and the crew's blow", () => {
	it("gives a follower's token blow at the focused foe the TICKED advantage line, once for that follower", async () => {
		const crin = onMap("crin", "Crinwin");
		globalThis.fromUuidSync = uuid => (uuid === crin.uuid ? crin : null);
		const bryn = marshalWithOrder(crin);
		const ash = pc({ id: "ash", name: "Ash", moves: [] });
		globalThis.game = { ...saved.game, actors: [bryn, ash], combats: undefined };
		const hound = { id: "hound", type: "npc", name: "Hound" };
		const cardFor = () => ({ character: ash, ftype: "animal", slug: "hound" });
		const line = followerFocusFireOffer(hound, { targets: [{ uuid: crin.uuid }], cardFor });
		expect(line).toMatchObject({ key: "focusFire", mode: "adv", applied: true });
		await line.spend();
		expect(ash.flags[SYSTEM_ID][FOCUS_FIRE_USED_FLAG]).toEqual(["bryn.1@animal:hound"]);
		expect(followerFocusFireOffer(hound, { targets: [{ uuid: crin.uuid }], cardFor })).toBeNull();
		// Ash's own blow is a different ally's, and still owed.
		expect(focusFireAgainst(ash, [{ uuid: crin.uuid }])).toMatchObject({ id: "bryn.1" });
		// A monster's blow is nobody's follower's.
		expect(followerFocusFireOffer({ id: "m", type: "npc" }, { targets: [{ uuid: crin.uuid }], cardFor: () => null })).toBeNull();
	});

	it("gives the Marshal's OWN crew the order's advantage, striking from the sheet, once as one ally", async () => {
		const crin = onMap("crin", "Crinwin");
		globalThis.fromUuidSync = uuid => (uuid === crin.uuid ? crin : null);
		const bryn = marshalWithOrder(crin);
		globalThis.game = { ...saved.game, actors: [bryn], combats: undefined };
		const which = { ftype: "crew", slug: "" };
		const line = followerFocusFireOffer(bryn, { targets: [{ uuid: crin.uuid }], which });
		expect(line).not.toBeNull();
		await line.spend();
		expect(followerFocusFireOffer(bryn, { targets: [{ uuid: crin.uuid }], which })).toBeNull();
		// The same crew as a token in the fight answers the same order: already used.
		const crewToken = { id: "crew", type: "npc" };
		expect(followerFocusFireOffer(crewToken, { targets: [{ uuid: crin.uuid }], cardFor: () => ({ character: bryn, ...which }) })).toBeNull();
		// The Marshal's own blow never answers their own order.
		expect(focusFireAgainst(bryn, [{ uuid: crin.uuid }])).toBeNull();
		// A blow at another foe gets none of it.
		expect(followerFocusFireOffer(bryn, { targets: [{ uuid: "Scene.s.Token.wolf" }], which: { ftype: "animal", slug: "hound" } })).toBeNull();
	});

	it("keeps a follower's answers when the character's own next answer prunes the dead orders", async () => {
		const crin = onMap("crin", "Crinwin");
		globalThis.fromUuidSync = uuid => (uuid === crin.uuid ? crin : null);
		const bryn = marshalWithOrder(crin);
		bryn.flags[SYSTEM_ID][FOCUS_FIRE_FLAG].push({ id: "bryn.2", key: crin.uuid, name: "Crinwin", combat: null });
		const ash = pc({ id: "ash", moves: [] });
		ash.flags[SYSTEM_ID][FOCUS_FIRE_USED_FLAG] = ["bryn.1@animal:hound", "gone.9@animal:hound"];
		await spendFocusFire(ash, { id: "bryn.2" }, { actors: [bryn, ash], combats: collection([]) });
		expect(ash.flags[SYSTEM_ID][FOCUS_FIRE_USED_FLAG]).toEqual(["bryn.1@animal:hound", "bryn.2"]);
	});

	it("is laid on the follower's damage window by the attack flow, and the sheet names the follower", () => {
		const flow = readRepo("module/combat/attack-flow.js");
		expect(flow).toContain("[followerFocusFireOffer(actor, { targets, which })]");
		expect(flow).toContain("which: striker?.which ?? null");
		expect(readRepo("module/actors/character/StonetopCharacterSheet.js")).toContain("which: { ftype: which.ftype, slug: which.slug },");
	});
});

describe("Set-Up Strike: the Aid waits on the damage", () => {
	const clash = attack => card({ flags: attack === undefined ? {} : { attack } });

	it("reads whether the damage window came back with the line ticked", () => {
		expect(tookSetUpStrike({ extraDice: [{ key: "setUpStrike", pill: "Set-Up Strike" }] })).toBe(true);
		expect(tookSetUpStrike({ extraDice: [{ key: "focusFire" }] })).toBe(false);
		expect(tookSetUpStrike({ extraDice: "1d4" })).toBe(false);
		expect(tookSetUpStrike(null)).toBe(false);
		expect(SET_UP_STRIKE_STAMP).toBe("setUpStrike");
	});

	it("is open once the Clash's damage took it, shut before the damage and when it was declined", () => {
		expect(setUpStrikeGate(clash({ moveKey: "clash" }))).toBe("unrolled");
		expect(setUpStrikeGate(clash({ moveKey: "clash", resolved: true, setUpStrike: true }))).toBe("open");
		expect(setUpStrikeGate(clash({ moveKey: "clash", resolved: true, setUpStrike: false }))).toBe("declined");
	});

	it("falls back OPEN for a card that cannot say: no attack record, or resolved before the stamp", () => {
		expect(setUpStrikeGate(clash(undefined))).toBe("open");
		expect(setUpStrikeGate(clash({ moveKey: "clash", resolved: true }))).toBe("open");
	});

	it("greys the button out with the reason beside it, and leaves the other giving moves alone", () => {
		const marshal = { ...pc({ moves: ["Set-Up Strike"] }), typedActor: { holdAdvantage: vi.fn() } };
		const root = new Window().document.createElement("div");
		root.innerHTML = '<button type="button" class="stonetop-give-advantage" data-move="Set-Up Strike">Give</button><button type="button" class="stonetop-give-advantage" data-move="Shake It Off">Give</button>';
		wireGiveAdvantage(clash({ moveKey: "clash" }), root, { giver: marshal, usable: true });
		const [setUp, shake] = root.querySelectorAll(".stonetop-give-advantage");
		expect(setUp.disabled).toBe(true);
		expect(root.textContent).toContain("Roll your damage with Set-Up Strike first");
		expect(shake.disabled).toBe(false);

		const done = new Window().document.createElement("div");
		done.innerHTML = '<button type="button" class="stonetop-give-advantage" data-move="Set-Up Strike">Give</button>';
		wireGiveAdvantage(clash({ moveKey: "clash", resolved: true, setUpStrike: true }), done, { giver: marshal, usable: true });
		expect(done.querySelector(".stonetop-give-advantage").disabled).toBe(false);
		expect(done.querySelector(".stonetop-give-advantage-gate")).toBeNull();
	});

	it("is stamped by the Clash card's Confirm, and the line asks the damage window even with it switched off", () => {
		const flow = readRepo("module/combat/attack-flow.js");
		expect(flow).toContain('...(attack.moveKey === "clash" ? { [SET_UP_STRIKE_STAMP]: tookSetUpStrike(damage) } : {}),');
		expect(flow).toContain('lines.some(line => line?.ask) ? true : undefined');
	});
});

/** Bryn (a Marshal) at (1,1) in a fight on the canvas scene, with whoever else the caller puts there. */
function fight(others = []) {
	const bryn = Object.assign(fakeActor({ id: "bryn", name: "Bryn", type: "character" }), { items: [{ type: "move", name: HERO_MOVES.BATTLEFIELD_GRACE }] });
	const token = (id, col, row, actor, disposition = -1) => Object.assign(fakeToken({ id, col, row, actor, disposition }), { uuid: `Scene.scene1.Token.${id}` });
	const tokens = { bryn: token("tBryn", 1, 1, bryn, 1) };
	for (const [key, col, row, actor, disposition] of others) tokens[key] = token(`t${key}`, col, row, actor, disposition);
	const scene = fakeScene({ tokens: Object.values(tokens) });
	const combatants = Object.values(tokens).map(t => fakeCombatant({ id: `c${t.id}`, token: t, scene }));
	const combat = fakeCombat({ scene, combatants });
	globalThis.game = { ...saved.game, user: { id: "gm", isGM: true }, users: collection([]), combats: collection([combat]), settings: { get: (_s, key) => (key === "fightTab" ? true : undefined) } };
	globalThis.ui = { ...globalThis.ui, combat: { viewed: combat } };
	globalThis.canvas = { scene };
	return { bryn, tokens };
}

describe("Battlefield Grace: when the fight cannot be read", () => {
	it("is OFFERED ticked leading an ally who is up, NOTHING with no ally, and UNREAD with no fight to read", async () => {
		const ally = fakeActor({ id: "ash", name: "Ash", type: "character" });
		const wolf = fakeActor({ id: "wolf", name: "Wolf", type: "monster" });
		const led = fight([["ash", 3, 3, ally, 1], ["wolf", 2, 1, wolf, -1]]);
		expect(await defenderDisadvantage(led.bryn)).toMatchObject({ offered: [HERO_MOVES.BATTLEFIELD_GRACE], unread: [] });
		const alone = fight([["wolf", 2, 1, wolf, -1]]);
		expect(await defenderDisadvantage(alone.bryn)).toMatchObject({ offered: [], unread: [] });
		globalThis.game.settings = { get: () => false };
		expect(await defenderDisadvantage(alone.bryn)).toMatchObject({ offered: [], unread: [HERO_MOVES.BATTLEFIELD_GRACE] });
	});

	it("is an UNTICKED line on the damage window, worded as the table's question", () => {
		const bryn = { name: "Bryn" };
		const lines = defenderLines([], [{ actor: bryn, move: HERO_MOVES.BATTLEFIELD_GRACE }]);
		expect(lines).toEqual([expect.objectContaining({ key: "battlefieldGrace", mode: "dis", applied: false })]);
		expect(lines[0].label).toContain("if they are leading their allies in battle");
		expect(defenderLines([{ actor: bryn, move: HERO_MOVES.BATTLEFIELD_GRACE }])[0]).toMatchObject({ applied: true });
	});

	it("asks a move's own damage number on the Marshal, ticked or unticked, and rolls nothing when the window is closed", async () => {
		const bryn = Object.assign(fakeActor({ id: "bryn", name: "Bryn", type: "character" }), { documentName: "Actor", system: { attributes: { hp: { value: 20 } } }, items: [{ type: "move", name: HERO_MOVES.BATTLEFIELD_GRACE }] });
		globalThis.fromUuidSync = uuid => (uuid === "Actor.bryn" ? bryn : null);
		globalThis.game = { ...saved.game, settings: { get: () => false } };
		const targets = [{ uuid: "Actor.bryn" }];
		const prompt = vi.fn(async ({ offers }) => ({ rollMode: "dis", bonus: 0, extraDice: [{ key: offers[0].key }] }));
		const rolled = await _movesTakenDamage(targets, { formula: "2d4", move: "Danu's Grasp", prompt });
		expect(prompt.mock.calls[0][0]).toMatchObject({ ask: true, formula: "2d4", rollMode: "normal" });
		expect(prompt.mock.calls[0][0].offers).toEqual([expect.objectContaining({ key: "battlefieldGrace", applied: false })]);
		expect(rolled).toMatchObject({ base: "2d4", rollMode: "dis" });
		expect(await _movesTakenDamage(targets, { formula: "2d4", prompt: async () => null })).toBeNull();

		// Nobody carrying it: no window, the number as it is.
		const plain = vi.fn();
		bryn.items = [];
		expect(await _movesTakenDamage(targets, { formula: "2d4", prompt: plain })).toEqual({ base: "2d4", rollMode: "normal", bonus: 0, extraDice: "" });
		expect(plain).not.toHaveBeenCalled();
	});

	it("re-enables an option's damage button whose window was closed", () => {
		expect(readRepo("stonetop.js")).toMatch(/rollOptionDamage\(actor, \{ move: move \|\| "Damage", damage: dealt \}\);\s*\/\/[^\n]*\n\s*if \(results === null\) \{\s*btn\.disabled = false;/);
	});
});

describe("foesInFight", () => {
	it("lists everyone on the other side who is up, those engaged with the roller first", () => {
		const wolf = fakeActor({ id: "wolf", name: "Wolf", type: "monster" });
		const chief = fakeActor({ id: "chief", name: "Chief", type: "monster" });
		const ally = fakeActor({ id: "ash", name: "Ash", type: "character" });
		const { bryn } = fight([["chief", 6, 6, chief, -1], ["wolf", 2, 1, wolf, -1], ["ash", 4, 4, ally, 1]]);
		expect(foesInFight(bryn).map(foe => foe.name)).toEqual(["Wolf", "Chief"]);
		globalThis.game.settings = { get: () => false };
		expect(foesInFight(bryn)).toEqual([]);
	});
});
