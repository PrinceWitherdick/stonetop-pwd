// Skins of fine whisky, "(○○ uses, grants advantage to Persuade)" (the Distillery, for the Fox, the
// Heavy, the Judge, the Lightbearer, the Marshal and the Seeker). The user's ruling: a pre-ticked
// line in the Persuade roll window. Kept ticked, advantage as a SOURCE (it nets with disadvantage)
// and 1 use marked after the dice; unticked, nothing. From the 2026-09-25 Fox audit, where the skin
// was a label on the sheet that bought nothing.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { fineWhiskyOffer, isFineWhiskyName, isPersuadeMove, FINE_WHISKY_OFFER } from "../../../module/actors/character/fine-whisky.js";
import { promptRoll, tookOffer } from "../../../module/dialogs/RollDialog.js";

// Binding Arbitration's rolls below need an attack's targets and a Persuade (vs. PCs)'s aim without
// the prompts that settle them. Both answer null (not an attack, aimed at nobody) unless a test says
// otherwise, which is what the real ones answer for every other roll in this file.
const seams = vi.hoisted(() => ({ begin: null, aim: null, turned: null }));
// A Force to Be Reckoned With's 12+ hook, watched without replacing it.
vi.mock("../../../module/actors/character/would-be-hero-cards.js", async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, forceTurnedTables: (...args) => { seams.turned?.(...args); return real.forceTurnedTables(...args); } };
});
vi.mock("../../../module/combat/attack-flow.js", async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, maybeBeginAttack: (...args) => (seams.begin ?? real.maybeBeginAttack)(...args) };
});
vi.mock("../../../module/pc-asks/pc-ask-flow.js", async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, aimPcAskRoll: (...args) => (seams.aim ?? real.aimPcAskRoll)(...args) };
});

const SCOPE = "stonetop-pwd";

describe("which whisky counts", () => {
	it("is a skin of FINE whisky, by any of its spellings", () => {
		for (const name of ["Skins of fine whisky", "Fine whisky (advantage to Persuade)", "Fine whisky", "Whisky, skin, fine", "Skin of whisky, fine"]) {
			expect(isFineWhiskyName(name)).toBe(true);
		}
		for (const name of ["Whisky, skin", "Firkin of whisky, fine", "Barrel of whisky, fine", "Firkins", "", null]) {
			expect(isFineWhiskyName(name)).toBe(false);
		}
	});

	it("sweetens either Persuade and nothing else", () => {
		expect(isPersuadeMove("Persuade (vs. NPCs)")).toBe(true);
		expect(isPersuadeMove("Persuade (vs. PCs)")).toBe(true);
		expect(isPersuadeMove("Defy Danger")).toBe(false);
	});

	const skin = { slug: "w1", name: "Skins of fine whisky", ammoMax: 2 };
	it("is offered only CARRIED, and only with a use left", () => {
		expect(fineWhiskyOffer({ gear: [skin], marks: { w1: true }, resources: {} })).toMatchObject({ key: FINE_WHISKY_OFFER, slug: "w1", used: 0, max: 2, applied: true });
		expect(fineWhiskyOffer({ gear: [skin], marks: {}, resources: {} })).toBeNull();
		expect(fineWhiskyOffer({ gear: [skin], marks: { w1: true }, resources: { w1: 2 } })).toBeNull();
	});

	it("finds a granted skin by its grant's key, and reads a pre-track skin's uses off its possession", () => {
		const granted = { slug: "w2", name: "Something renamed", sourceKey: "Fine whisky (advantage to Persuade)", ammoMax: null, legacyUsed: 1 };
		expect(fineWhiskyOffer({ gear: [granted], marks: { w2: true } })).toMatchObject({ used: 1, max: 2 });
	});

	it("takes the line only when a window showed it and it stayed ticked", () => {
		const offer = { key: FINE_WHISKY_OFFER, applied: true };
		expect(tookOffer(offer, null)).toBe(false);
		expect(tookOffer(offer, [])).toBe(false);
		expect(tookOffer(offer, [FINE_WHISKY_OFFER])).toBe(true);
		expect(tookOffer(null, [FINE_WHISKY_OFFER])).toBe(false);
	});
});

// ── The roll window ──────────────────────────────────────────────────────────
describe("promptRoll's offered lines", () => {
	const offers = [{ key: FINE_WHISKY_OFFER, label: "Share a skin of fine whisky (spend 1 use): advantage" }];
	afterEach(() => { delete global.Dialog; });

	it("shows the line ticked, and reports it back only while it stays ticked", async () => {
		let data;
		global.Dialog = vi.fn(function (d) { data = d; this.render = vi.fn(); });
		const pending = promptRoll({ askMode: false, askModifier: true, offers });
		expect(data.content).toContain(`name="offer-${FINE_WHISKY_OFFER}" checked`);
		expect(data.content).toContain("Share a skin of fine whisky (spend 1 use): advantage");
		const box = { checked: false };
		const root = { querySelector: sel => (sel === `[name="offer-${FINE_WHISKY_OFFER}"]` ? box : { value: "0" }) };
		data.buttons.roll.callback([root]);
		expect(await pending).toEqual({ situational: 0, takenOffers: [] });
	});

	it("opens for the line alone when neither setting asks anything", async () => {
		let data;
		global.Dialog = vi.fn(function (d) { data = d; this.render = vi.fn(); });
		const pending = promptRoll({ askMode: false, askModifier: false, offers });
		expect(global.Dialog).toHaveBeenCalledTimes(1);
		expect(data.content).toContain(`name="offer-${FINE_WHISKY_OFFER}" checked`);
		expect(data.content).not.toContain('name="modifier"');
		const root = { querySelector: sel => (sel === `[name="offer-${FINE_WHISKY_OFFER}"]` ? { checked: true } : null) };
		data.buttons.roll.callback([root]);
		expect(await pending).toEqual({ situational: 0, takenOffers: [FINE_WHISKY_OFFER] });
	});

	it("takes nothing on a Shift-click: the dice and nothing else", async () => {
		global.Dialog = vi.fn();
		expect(await promptRoll({ shiftKey: true, askMode: false, askModifier: true, offers })).toEqual({ situational: 0, takenOffers: [] });
		expect(global.Dialog).not.toHaveBeenCalled();
	});

	it("keeps the answer's shape for a roll that offered nothing", async () => {
		expect(await promptRoll({ askMode: false, askModifier: false })).toEqual({ situational: 0 });
	});
});

// ── The roll ─────────────────────────────────────────────────────────────────
function persuader({ carried = true, used = 0, sticky = "normal", withSkin = true } = {}) {
	const persuade = { _id: "persuade-1", name: "Persuade (vs. NPCs)", type: "move", system: { rollType: "cha" }, roll: vi.fn(async () => ({ total: 8 })) };
	const whisky = makeLiveItem({
		name: "Skins of fine whisky", type: "move",
		system: { moveType: "inventory-custom", inventoryColumn: "small", sourcePossession: "distillery", sourceKey: "Fine whisky (advantage to Persuade)", resource: { max: 2 } },
	});
	const made = buildLiveCharacter({
		slug: "the-fox", name: "The Fox", seedStartingMoves: false,
		items: withSkin ? [whisky] : [],
		flags: { rollMode: sticky, inventory: { checked: { [whisky._id]: carried }, resources: used ? { [whisky._id]: used } : {} } },
	});
	const items = [...made.actor.items, persuade];
	items.get = id => items.find(i => i._id === id) ?? null;
	made.actor.items = items;
	return { ...made, persuade, whisky };
}
const rollPersuade = (char, prompted = {}) => char.onRoll({
	currentTarget: { closest: sel => (sel === ".item" ? { dataset: { itemId: "persuade-1" } } : null), getAttribute: () => null },
}, prompted);
const rolledWith = persuade => persuade.roll.mock.calls[0][0];
const usesMarked = (actor, whisky) => actor.flags[SCOPE].inventory?.resources?.[whisky._id];

describe("sharing a skin on Persuade", () => {
	it("offers the skin to the roll window", async () => {
		const { char, persuade } = persuader();
		expect((await char.rollOffers(persuade)).map(o => o.key)).toEqual([FINE_WHISKY_OFFER]);
		expect(await char.rollOffers({ name: "Defy Danger" })).toEqual([]);
		expect(await persuader({ carried: false }).char.rollOffers(persuade)).toEqual([]);
		expect(await persuader({ used: 2 }).char.rollOffers(persuade)).toEqual([]);
	});

	it("kept ticked: advantage, named on the card, and 1 use marked", async () => {
		const { char, actor, persuade, whisky } = persuader();
		await rollPersuade(char, { takenOffers: [FINE_WHISKY_OFFER] });
		expect(rolledWith(persuade).rollMode).toBe("adv");
		expect(rolledWith(persuade).conditionNotes).toContain("Fine whisky");
		expect(usesMarked(actor, whisky)).toBe(1);
	});

	it("unticked: nothing happens", async () => {
		const { char, actor, persuade, whisky } = persuader();
		await rollPersuade(char, { takenOffers: [] });
		expect(rolledWith(persuade).rollMode).toBe("normal");
		expect(usesMarked(actor, whisky)).toBeUndefined();
	});

	it("is a SOURCE: it nets with a disadvantage and the roll goes straight", async () => {
		const { char, persuade } = persuader({ sticky: "dis" });
		await rollPersuade(char, { takenOffers: [FINE_WHISKY_OFFER] });
		expect(rolledWith(persuade).rollMode).toBe("normal");
	});

	it("with no window asked, is not poured", async () => {
		const { char, actor, persuade, whisky } = persuader({ used: 1 });
		await rollPersuade(char);
		expect(rolledWith(persuade).rollMode).toBe("normal");
		expect(usesMarked(actor, whisky)).toBe(1);
	});

	it("does nothing for a character with no skin to share", async () => {
		const { char, persuade } = persuader({ withSkin: false });
		await rollPersuade(char, { takenOffers: [FINE_WHISKY_OFFER] });
		expect(rolledWith(persuade).rollMode).toBe("normal");
	});
});

// ── The unticked lines (StonetopCharacter's FICTION_ROLL_OFFERS) ─────────────
// Heavy audit (2026-09-25): Intimidating ("When you Persuade using violence or threats, you have
// advantage"), Husbandry tools ("Gain advantage to Persuade domestic beasts") and Stone Cold ("When you
// Defy Danger ... by keeping calm and carrying on, treat a 6- as a 7-9") did nothing on the roll. Each is
// the player's call, so each is an UNTICKED line in the same window the whisky uses.
function heavy({ moves = [], possessions = [], total = 5 } = {}) {
	const rolled = name => ({ _id: `${name}-1`, name, type: "move", system: { rollType: "cha" }, roll: vi.fn(async () => ({ total })) });
	const persuade = rolled("Persuade (vs. NPCs)");
	const persuadePcs = rolled("Persuade (vs. PCs)");
	const defy = rolled("Defy Danger");
	const made = buildLiveCharacter({
		slug: "the-heavy", name: "The Heavy", seedStartingMoves: false,
		items: moves.map(m => makeLiveItem({ name: m.name ?? m, type: "move", system: { moveType: "playbook" }, flags: m.learned === false ? { [SCOPE]: { learned: false } } : undefined })),
		flags: { "possessions.selected": possessions },
	});
	const items = [...made.actor.items, persuade, persuadePcs, defy];
	items.get = id => items.find(i => i._id === id) ?? null;
	made.actor.items = items;
	const roll = (item, prompted) => made.char.onRoll({
		currentTarget: { closest: sel => (sel === ".item" ? { dataset: { itemId: item._id } } : null), getAttribute: () => null },
	}, prompted);
	return { ...made, persuade, persuadePcs, defy, roll };
}
const keysOf = async (char, item) => (await char.rollOffers(item)).map(o => o.key);

describe("the unticked lines a Heavy's moves and possessions bring", () => {
	it("offers Intimidating on either Persuade, unticked, for a LEARNED move only", async () => {
		const { char, persuade, persuadePcs, defy } = heavy({ moves: ["Intimidating"] });
		const [line] = await char.rollOffers(persuade);
		expect(line).toMatchObject({ key: "intimidating", applied: false, source: "Intimidating" });
		expect(line.spend).toBeUndefined();
		expect(await keysOf(char, persuadePcs)).toEqual(["intimidating"]);
		expect(await keysOf(char, defy)).toEqual([]);
		const off = heavy({ moves: [{ name: "Intimidating", learned: false }] });
		expect(await keysOf(off.char, off.persuade)).toEqual([]);
	});

	it("taken, Intimidating is a SOURCE of advantage named on the card; left unticked, nothing", async () => {
		const { persuade, roll } = heavy({ moves: ["Intimidating"] });
		await roll(persuade, { takenOffers: ["intimidating"] });
		expect(rolledWith(persuade).rollMode).toBe("adv");
		expect(rolledWith(persuade).conditionNotes).toContain("Intimidating");
		const other = heavy({ moves: ["Intimidating"] });
		await other.roll(other.persuade, { takenOffers: [] });
		expect(rolledWith(other.persuade).rollMode).toBe("normal");
	});

	it("offers Husbandry tools on Persuade (vs. NPCs) while the possession is held", async () => {
		const { char, persuade, persuadePcs, roll } = heavy({ possessions: ["husbandry-tools"] });
		expect(await char.rollOffers(persuade)).toEqual([expect.objectContaining({ key: "husbandry-tools", applied: false, source: "Husbandry tools" })]);
		// Domestic beasts are never player characters.
		expect(await keysOf(char, persuadePcs)).toEqual([]);
		expect(await keysOf(heavy({ possessions: ["smithy"] }).char, persuade)).toEqual([]);
		await roll(persuade, { takenOffers: ["husbandry-tools"] });
		expect(rolledWith(persuade).rollMode).toBe("adv");
	});

	it("offers Stone Cold on Defy Danger, and taken it counts a 6- as a 7-9 rather than giving advantage", async () => {
		const { char, defy, persuade, roll } = heavy({ moves: ["Stone Cold"] });
		expect(await char.rollOffers(defy)).toEqual([expect.objectContaining({ key: "stone-cold", applied: false, source: "Stone Cold", effect: "missAsPartial" })]);
		expect(await keysOf(char, persuade)).toEqual([]);
		await roll(defy, { takenOffers: ["stone-cold"] });
		expect(rolledWith(defy).missCountsAsPartial).toBe("Stone Cold");
		expect(rolledWith(defy).rollMode).toBe("normal");
		const unticked = heavy({ moves: ["Stone Cold"] });
		await unticked.roll(unticked.defy, { takenOffers: [] });
		expect(rolledWith(unticked.defy).missCountsAsPartial).toBeUndefined();
	});
});

// Judge audit (2026-09-25): Legacy ("When you Know Things about the people or history of Stonetop, you
// have advantage"), For the Greater Good ("When you Persuade someone to act in defense of their
// community or civilization at large, you have advantage"), The Tower Eternal ("When you Defy Danger
// against magic, treat a result of 6- as a 7-9") and the helm set with a dark ice "jewel" ("Grants
// advantage to resist mind-affecting magic") did nothing on the roll. Each is the player's call.
function judgeRoller({ moves = [], background = null, subChoices = null, carried = null, oaths = null, total = 8 } = {}) {
	const rolled = (name, rollType = "cha") => ({ _id: `${name}-1`, name, type: "move", system: { rollType }, roll: vi.fn(async () => ({ total })) });
	const knowThings = rolled("Know Things", "int");
	const persuade = rolled("Persuade (vs. NPCs)");
	const persuadePcs = rolled("Persuade (vs. PCs)");
	const defy = rolled("Defy Danger");
	const clash = rolled("Clash", "str");
	const flags = {};
	if (background) flags["background.selected"] = background;
	if (subChoices) flags["possessions.subChoices"] = subChoices;
	if (carried) flags["possessions.choiceCarried"] = carried;
	if (oaths) flags.oaths = oaths;
	const made = buildLiveCharacter({
		slug: "the-judge", name: "The Judge", seedStartingMoves: false,
		items: moves.map(m => makeLiveItem({ name: m.name ?? m, type: "move", system: { moveType: "playbook" }, flags: m.learned === false ? { [SCOPE]: { learned: false } } : undefined })),
		flags,
	});
	const items = [...made.actor.items, knowThings, persuade, persuadePcs, defy, clash];
	items.get = id => items.find(i => i._id === id) ?? null;
	made.actor.items = items;
	const roll = (item, prompted) => made.char.onRoll({
		currentTarget: { closest: sel => (sel === ".item" ? { dataset: { itemId: item._id } } : null), getAttribute: () => null },
	}, prompted);
	return { ...made, knowThings, persuade, persuadePcs, defy, clash, roll };
}

describe("the unticked lines a Judge's background, moves and helm bring", () => {
	it("offers Legacy on Know Things to a Legacy Judge, and not to a Missionary", async () => {
		const legacy = judgeRoller({ background: "legacy" });
		expect(await legacy.char.rollOffers(legacy.knowThings)).toEqual([expect.objectContaining({ key: "legacy", applied: false, source: "Legacy" })]);
		expect(await keysOf(legacy.char, legacy.defy)).toEqual([]);
		const missionary = judgeRoller({ background: "missionary" });
		expect(await keysOf(missionary.char, missionary.knowThings)).toEqual([]);
		await legacy.roll(legacy.knowThings, { takenOffers: ["legacy"] });
		expect(rolledWith(legacy.knowThings).rollMode).toBe("adv");
		expect(rolledWith(legacy.knowThings).conditionNotes).toContain("Legacy");
	});

	it("offers For the Greater Good on either Persuade, for a LEARNED move only", async () => {
		const { char, persuade, persuadePcs, defy } = judgeRoller({ moves: ["For the Greater Good"] });
		expect(await char.rollOffers(persuade)).toEqual([expect.objectContaining({ key: "for-the-greater-good", applied: false, source: "For the Greater Good" })]);
		expect(await keysOf(char, persuadePcs)).toEqual(["for-the-greater-good"]);
		expect(await keysOf(char, defy)).toEqual([]);
		const off = judgeRoller({ moves: [{ name: "For the Greater Good", learned: false }] });
		expect(await keysOf(off.char, off.persuade)).toEqual([]);
	});

	it("offers The Tower Eternal on Defy Danger, and taken it counts a 6- as a 7-9", async () => {
		const { char, defy, persuade, roll } = judgeRoller({ moves: ["The Tower Eternal"], total: 5 });
		expect(await char.rollOffers(defy)).toEqual([expect.objectContaining({ key: "tower-eternal", applied: false, source: "The Tower Eternal", effect: "missAsPartial" })]);
		expect(await keysOf(char, persuade)).toEqual([]);
		await roll(defy, { takenOffers: ["tower-eternal"] });
		expect(rolledWith(defy).missCountsAsPartial).toBe("The Tower Eternal");
		expect(rolledWith(defy).rollMode).toBe("normal");
	});

	it("offers the helm on Defy Danger only while it is the symbol picked AND carried", async () => {
		const helm = { "symbol-of-authority": ["helm"] };
		const worn = judgeRoller({ subChoices: helm, carried: { "symbol-of-authority:helm": true } });
		expect(await worn.char.rollOffers(worn.defy)).toEqual([expect.objectContaining({ key: "judge-helm", applied: false, source: "Helm" })]);
		expect(await keysOf(worn.char, worn.persuade)).toEqual([]);
		const home = judgeRoller({ subChoices: helm, carried: { "symbol-of-authority:helm": false } });
		expect(await keysOf(home.char, home.defy)).toEqual([]);
		const maul = judgeRoller({ subChoices: { "symbol-of-authority": ["black-iron-maul"] }, carried: { "symbol-of-authority:black-iron-maul": true, "symbol-of-authority:helm": true } });
		expect(await keysOf(maul.char, maul.defy)).toEqual([]);
		await worn.roll(worn.defy, { takenOffers: ["judge-helm"] });
		expect(rolledWith(worn.defy).rollMode).toBe("adv");
	});
});

// Binding Arbitration: "If they have broken their word, you gain advantage on all rolls against them".
// The user's ruling: EVERY roll aimed at an oathbreaker, not only attacks, imposed and named on the
// card; a roll aimed at nobody offers it as an unticked line instead.
describe("Binding Arbitration on every roll against an oathbreaker", () => {
	const BA = "Binding Arbitration";
	const brokenBy = [{ id: "o1", name: "Brennan", broken: true }];
	const brennanToken = { document: { uuid: "Scene.s.Token.tb", name: "Brennan" }, actor: { id: "brennanActor" } };
	const target = tokens => { global.game.user = { targets: new Set(tokens) }; };
	afterEach(() => { delete global.game.user; seams.begin = null; seams.aim = null; });
	const notesOf = item => rolledWith(item).conditionNotes ?? [];

	it("imposes advantage on a Persuade aimed at a targeted oathbreaker, named on the card, with no line", async () => {
		target([brennanToken]);
		const { char, persuade, roll } = judgeRoller({ moves: [BA], oaths: brokenBy });
		expect(await keysOf(char, persuade)).toEqual([]);
		await roll(persuade, { takenOffers: [] });
		expect(rolledWith(persuade).rollMode).toBe("adv");
		expect(notesOf(persuade)).toContain(BA);
	});

	it("imposes it on a Persuade (vs. PCs) aimed at an oathbreaking character", async () => {
		seams.aim = async () => ({ messageFlags: { [SCOPE]: { pcAsk: { move: "Persuade (vs. PCs)", targetId: "brennanActor", targetName: "Brennan" } } }, conditionNotes: ["To Brennan"] });
		const { char, persuadePcs, roll } = judgeRoller({ moves: [BA], oaths: brokenBy });
		// Aimed once the window closes, so the window has no line to offer.
		expect(await keysOf(char, persuadePcs)).toEqual([]);
		await roll(persuadePcs, { takenOffers: [] });
		expect(rolledWith(persuadePcs).rollMode).toBe("adv");
		expect(notesOf(persuadePcs).filter(n => n === BA)).toHaveLength(1);
	});

	it("imposes nothing on a roll aimed at someone who kept their word", async () => {
		target([{ document: { uuid: "Scene.s.Token.tx", name: "Stranger" }, actor: { id: "x" } }]);
		const { char, persuade, roll } = judgeRoller({ moves: [BA], oaths: brokenBy });
		expect(await keysOf(char, persuade)).toEqual([]);
		await roll(persuade, { takenOffers: [] });
		expect(rolledWith(persuade).rollMode).toBe("normal");
	});

	it("offers an unticked line naming the oathbreakers on a roll aimed at nobody", async () => {
		const { char, defy, roll } = judgeRoller({ moves: [BA], oaths: [...brokenBy, { id: "o2", name: "Old Mag", broken: true }, { id: "o3", name: "Kept", broken: false }] });
		const [line] = await char.rollOffers(defy);
		expect(line).toMatchObject({ key: "binding-arbitration", applied: false, source: BA });
		expect(line.label).toContain("Brennan");
		expect(line.label).toContain("Old Mag");
		expect(line.label).not.toContain("Kept");
		await roll(defy, { takenOffers: ["binding-arbitration"] });
		expect(rolledWith(defy).rollMode).toBe("adv");
		expect(notesOf(defy)).toContain(BA);
	});

	it("offers nothing with no oath broken, or with the move not learned", async () => {
		const kept = judgeRoller({ moves: [BA], oaths: [{ id: "o1", name: "Brennan", broken: false }] });
		expect(await keysOf(kept.char, kept.defy)).toEqual([]);
		const unlearned = judgeRoller({ moves: [{ name: BA, learned: false }], oaths: brokenBy });
		expect(await keysOf(unlearned.char, unlearned.defy)).toEqual([]);
		target([brennanToken]);
		await unlearned.roll(unlearned.persuade, { takenOffers: [] });
		expect(rolledWith(unlearned.persuade).rollMode).toBe("normal");
	});

	it("gives an attack at an oathbreaker its advantage exactly once, even with the line ticked", async () => {
		seams.begin = async () => ({ messageFlags: { [SCOPE]: { attack: { moveKey: "clash", targets: [{ uuid: "Scene.s.Token.tb", name: "Brennan", actorId: "brennanActor" }] } } } });
		const { clash, roll } = judgeRoller({ moves: [BA], oaths: brokenBy });
		await roll(clash, { takenOffers: ["binding-arbitration"] });
		expect(rolledWith(clash).rollMode).toBe("adv");
		expect(notesOf(clash).filter(n => n === BA)).toHaveLength(1);
	});
});

// Ranger audit (2026-09-26): Naturalist ("When you Know Things about beasts, natural environs, or spirits
// of the wild, you have advantage"), Home on the Range ("When a journey requires you to Defy Danger or
// Struggle as One, treat a 6- as a 7-9"), Trailblazer ("When a journey causes you to Defy Danger or
// Struggle as One, on a 10+ you also learn or discover something interesting and useful") and Constant
// Vigilance ("Unless you're dazed ... When you intercept a sudden threat (to yourself or an ally), you
// have advantage on whatever move you make") did nothing on a solo roll. Each is the player's call.
function rangerRoller({ moves = [], dazed = false, total = 8 } = {}) {
	const rolled = (name, rollType = "wis") => ({ _id: `${name}-1`, name, type: "move", system: { rollType }, roll: vi.fn(async () => ({ total })) });
	const knowThings = rolled("Know Things", "int");
	const persuade = rolled("Persuade (vs. NPCs)", "cha");
	const defy = rolled("Defy Danger");
	const clash = rolled("Clash", "str");
	const alpha = rolled("Alpha");
	const made = buildLiveCharacter({
		slug: "the-ranger", name: "The Ranger", seedStartingMoves: false,
		items: moves.map(m => makeLiveItem({ name: m.name ?? m, type: "move", system: { moveType: "playbook" }, flags: m.learned === false ? { [SCOPE]: { learned: false } } : undefined })),
	});
	made.actor.system.attributes.debilities.options.dazed.value = dazed;
	const items = [...made.actor.items, knowThings, persuade, defy, clash, alpha];
	items.get = id => items.find(i => i._id === id) ?? null;
	made.actor.items = items;
	const roll = (item, prompted) => made.char.onRoll({
		currentTarget: { closest: sel => (sel === ".item" ? { dataset: { itemId: item._id } } : null), getAttribute: () => null },
	}, prompted);
	return { ...made, knowThings, persuade, defy, clash, alpha, roll };
}

describe("the unticked lines a Ranger's moves bring", () => {
	it("offers Naturalist on Know Things, for a LEARNED move only, and taken it is a SOURCE of advantage", async () => {
		const { char, knowThings, defy, roll } = rangerRoller({ moves: ["Naturalist"] });
		expect(await char.rollOffers(knowThings)).toEqual([expect.objectContaining({ key: "naturalist", applied: false, source: "Naturalist" })]);
		expect(await keysOf(char, defy)).toEqual([]);
		const off = rangerRoller({ moves: [{ name: "Naturalist", learned: false }] });
		expect(await keysOf(off.char, off.knowThings)).toEqual([]);
		await roll(knowThings, { takenOffers: ["naturalist"] });
		expect(rolledWith(knowThings).rollMode).toBe("adv");
		expect(rolledWith(knowThings).conditionNotes).toContain("Naturalist");
	});

	it("offers Home on the Range on Defy Danger, and taken it counts a 6- as a 7-9", async () => {
		const { char, defy, knowThings, roll } = rangerRoller({ moves: ["Home on the Range"], total: 5 });
		expect(await char.rollOffers(defy)).toEqual([expect.objectContaining({ key: "home-on-the-range", applied: false, source: "Home on the Range", effect: "missAsPartial" })]);
		expect(await keysOf(char, knowThings)).toEqual([]);
		await roll(defy, { takenOffers: ["home-on-the-range"] });
		expect(rolledWith(defy).missCountsAsPartial).toBe("Home on the Range");
		expect(rolledWith(defy).rollMode).toBe("normal");
		const off = rangerRoller({ moves: [{ name: "Home on the Range", learned: false }] });
		expect(await keysOf(off.char, off.defy)).toEqual([]);
	});

	it("offers Trailblazer on Defy Danger, and taken it prints its discovery on the 10+ row alone", async () => {
		const { char, defy, roll } = rangerRoller({ moves: ["Home on the Range", "Trailblazer"] });
		expect(await keysOf(char, defy)).toEqual(["home-on-the-range", "trailblazer"]);
		await roll(defy, { takenOffers: ["trailblazer"] });
		const options = rolledWith(defy);
		expect(options.rollMode).toBe("normal");
		expect(options.conditionNotes).toContain("Trailblazer");
		expect(options.tierActions.success).toContain("something interesting and useful");
		expect(options.tierActions.partial).toBeUndefined();
		expect(options.tierActions.failure).toBeUndefined();
		const off = rangerRoller({ moves: [{ name: "Trailblazer", learned: false }] });
		expect(await keysOf(off.char, off.defy)).toEqual([]);
	});

	// The user's ruling: Trailblazer REQUIRES Home on the Range (the sheet's wording; Book I p.131's
	// "replaces" is a misprint), so a Ranger keeps both and both lines are offered.
	it("keeps Trailblazer a dependent of Home on the Range, never its replacement", () => {
		const url = new URL("../../../packs/src/stonetop-items/playbook-moves/the-ranger/trailblazer.json", import.meta.url);
		const { system } = JSON.parse(readFileSync(url, "utf8"));
		expect(system.requirement.moves).toContain("Home on the Range");
		expect(system.replaces).toBeUndefined();
		expect(system.requirement.replaces).toBeUndefined();
	});

	it("offers Constant Vigilance on every roll, never while dazed, for a LEARNED move only", async () => {
		const { char, knowThings, persuade, defy, clash, roll } = rangerRoller({ moves: ["Constant Vigilance"] });
		for (const item of [knowThings, persuade, defy, clash]) {
			expect(await char.rollOffers(item)).toEqual([expect.objectContaining({ key: "constant-vigilance", applied: false, source: "Constant Vigilance" })]);
		}
		const dazed = rangerRoller({ moves: ["Constant Vigilance"], dazed: true });
		expect(await keysOf(dazed.char, dazed.defy)).toEqual([]);
		const off = rangerRoller({ moves: [{ name: "Constant Vigilance", learned: false }] });
		expect(await keysOf(off.char, off.defy)).toEqual([]);
		await roll(defy, { takenOffers: ["constant-vigilance"] });
		expect(rolledWith(defy).rollMode).toBe("adv");
		expect(rolledWith(defy).conditionNotes).toContain("Constant Vigilance");
	});

	// GUARD (wave 4): a move a player wrote under a book move's name acts as itself (owns-move.js#bookMoveName).
	// It is still a move rolled in their presence, so the rows of every move roll stay; no named row rides it,
	// and the book's tier effects (Prepare a Welcome's Surprise, Commune's Sanction, ...) never settle off it.
	it("gives a player's own \"Defy Danger\" only the rows of every move roll, and no tier effects", async () => {
		const { char, actor, defy, roll } = rangerRoller({ moves: ["Home on the Range", "Constant Vigilance"], total: 10 });
		const homebrew = { ...defy, _id: "homebrew-defy", flags: { [SCOPE]: { custom: true } }, roll: vi.fn(async () => ({ total: 10 })) };
		actor.items.push(homebrew);
		expect(await keysOf(char, defy)).toEqual(["home-on-the-range", "constant-vigilance"]);
		expect(await keysOf(char, homebrew)).toEqual(["constant-vigilance"]);

		const settle = vi.spyOn(char, "_settleRolledTierEffects").mockResolvedValue(undefined);
		await roll(homebrew, {});
		expect(homebrew.roll).toHaveBeenCalledTimes(1);
		expect(settle).not.toHaveBeenCalled();
		await roll(defy, {});
		expect(settle).toHaveBeenCalledWith(expect.anything(), "Defy Danger", expect.anything(), expect.anything());
	});
});

// Ranger audit M10, Alpha: "on a 10+, you also have advantage on your next roll against them." The Alpha's
// 10+ remembers the foes it was aimed at (fight/hero-moves.js, like But I Get Up Again's record), and the
// next roll aimed at them is at advantage, named, and spends it. Aimed at nobody, nothing is remembered.
describe("Alpha's advantage on the next roll against them", () => {
	const wolf = { document: { uuid: "Scene.s.Token.tw", name: "Grey Wolf" }, actor: { id: "wolfActor" } };
	const target = tokens => { global.game.user = { targets: new Set(tokens) }; };
	afterEach(() => { delete global.game.user; seams.begin = null; seams.aim = null; });

	it("remembers the foe an Alpha 10+ was aimed at, and spends it on the next roll against them", async () => {
		target([wolf]);
		const { actor, alpha, persuade, defy, roll } = rangerRoller({ moves: ["Alpha"], total: 11 });
		await roll(alpha, { takenOffers: [] });
		expect(actor.getFlag(SCOPE, "alphaOver")).toEqual([{ key: "Scene.s.Token.tw", name: "Grey Wolf" }]);
		await roll(persuade, { takenOffers: [] });
		expect(rolledWith(persuade).rollMode).toBe("adv");
		expect(rolledWith(persuade).conditionNotes).toContain("Alpha");
		expect(actor.getFlag(SCOPE, "alphaOver")).toEqual([]);
		// Spent: the roll after that is a straight one.
		await roll(defy, { takenOffers: [] });
		expect(rolledWith(defy).rollMode).toBe("normal");
	});

	it("remembers nothing on a 7-9, aimed at nobody, or with the move not learned", async () => {
		target([wolf]);
		const partial = rangerRoller({ moves: ["Alpha"], total: 8 });
		await partial.roll(partial.alpha, { takenOffers: [] });
		expect(partial.actor.getFlag(SCOPE, "alphaOver")).toBeNull();
		// The rolled move itself switched off on the sheet.
		const off = rangerRoller({ total: 11 });
		off.alpha.flags = { [SCOPE]: { learned: false } };
		await off.roll(off.alpha, { takenOffers: [] });
		expect(off.actor.getFlag(SCOPE, "alphaOver")).toBeNull();
		target([]);
		const nobody = rangerRoller({ moves: ["Alpha"], total: 11 });
		await nobody.roll(nobody.alpha, { takenOffers: [] });
		expect(nobody.actor.getFlag(SCOPE, "alphaOver")).toBeNull();
	});

	it("gives nothing on a roll aimed at someone else, and keeps the record for the wolf", async () => {
		target([wolf]);
		const { actor, alpha, persuade, roll } = rangerRoller({ moves: ["Alpha"], total: 11 });
		await roll(alpha, { takenOffers: [] });
		target([{ document: { uuid: "Scene.s.Token.tx", name: "Stranger" }, actor: { id: "x" } }]);
		await roll(persuade, { takenOffers: [] });
		expect(rolledWith(persuade).rollMode).toBe("normal");
		expect(actor.getFlag(SCOPE, "alphaOver")).toHaveLength(1);
	});

	// A 7-9 the roll treats as a 10+ (a taken "treat a 7-9 as a 10+" line) settles as the 10+ it counts as,
	// at the roll as after a rewrite (actors/character/tier-effects.js, utils/counted-tier.js).
	it("remembers the foe on a 7-9 the roll counts as a 10+", async () => {
		target([wolf]);
		const { actor, alpha, roll } = rangerRoller({ moves: ["Alpha"], total: 8 });
		await roll(alpha, { takenOffers: ["deal"], offered: [{ key: "deal", effect: "partialAsSuccess", source: "Let's Make a Deal" }] });
		expect(rolledWith(alpha).partialCountsAsSuccess).toBe("Let's Make a Deal");
		expect(actor.getFlag(SCOPE, "alphaOver")).toEqual([{ key: "Scene.s.Token.tw", name: "Grey Wolf" }]);
	});

	// A guided move, Improvise or a bare stat roll (onDirectStatRoll) aimed at them is the next roll against
	// them too, and uses the advantage up.
	describe("on a roll with no move behind it (onDirectStatRoll)", () => {
		let direct;
		beforeEach(() => {
			direct = [];
			vi.doMock("../../../module/utils/roll-engine.js", async (importOriginal) => ({
				...(await importOriginal()),
				rollStat: vi.fn(async (stat, actor, options) => { direct.push(options); return { total: 8 }; }),
			}));
		});
		afterEach(() => vi.doUnmock("../../../module/utils/roll-engine.js"));
		const cowed = [{ key: "Scene.s.Token.tw", name: "Grey Wolf" }];

		it("gives a guided roll at the cowed foe advantage, named Alpha, and spends it", async () => {
			target([wolf]);
			const { actor, char } = rangerRoller({ moves: ["Alpha"] });
			await actor.setFlag(SCOPE, "alphaOver", cowed);
			await char.onDirectStatRoll("wis", { moveName: "Forage" });
			expect(direct[0].rollMode).toBe("adv");
			expect(direct[0].conditionNotes).toContain("Alpha");
			expect(actor.getFlag(SCOPE, "alphaOver")).toEqual([]);
			await char.onDirectStatRoll("wis", { moveName: "Forage" });
			expect(direct[1].rollMode).toBe("normal");
		});

		it("names only Binding Arbitration when it bought the advantage, and spends Alpha's all the same", async () => {
			target([wolf]);
			const made = buildLiveCharacter({
				slug: "the-ranger", name: "The Ranger", seedStartingMoves: false,
				items: ["Alpha", "Binding Arbitration"].map(name => makeLiveItem({ name, type: "move", system: { moveType: "playbook" } })),
				flags: { oaths: [{ id: "o1", name: "Grey Wolf", broken: true }], alphaOver: cowed },
			});
			await made.char.onDirectStatRoll("wis", { moveName: "Forage" });
			expect(direct[0].rollMode).toBe("adv");
			expect(direct[0].conditionNotes).toContain("Binding Arbitration");
			expect(direct[0].conditionNotes).not.toContain("Alpha");
			expect(made.actor.getFlag(SCOPE, "alphaOver")).toEqual([]);
		});
	});
});

// Seeker audit (2026-09-26): Let's Make a Deal ("When you Persuade by offering them something that you know
// they want or need, treat a 7-9 as a 10+"), Polyglot ("When you Know Things about any script, text, runes or
// symbols that you encounter, you have advantage"), Proof Against Detection ("When you hold Protection, you ...
// have advantage to Defy Danger by being stealthy") and Safety First ("spend 1 Protection either to gain
// advantage on any roll to resist it or to halve its damage/effects"; the user's ruling: an unticked line on
// Defy Danger that spends a pip only when taken) did nothing on the roll.
function seekerRoller({ moves = [], protection = 0, total = 8 } = {}) {
	const rolled = (name, rollType = "int") => ({ _id: `${name}-1`, name, type: "move", system: { rollType }, roll: vi.fn(async () => ({ total })) });
	const knowThings = rolled("Know Things");
	const persuade = rolled("Persuade (vs. NPCs)", "cha");
	const persuadePcs = rolled("Persuade (vs. PCs)", "cha");
	const defy = rolled("Defy Danger", "dex");
	const made = buildLiveCharacter({
		slug: "the-seeker", name: "The Seeker", seedStartingMoves: false,
		items: moves.map(m => makeLiveItem({
			name: m.name ?? m, type: "move",
			system: { moveType: "playbook", ...((m.name ?? m) === "Safety First" ? { resource: { max: 2, title: "Protection" } } : {}) },
			flags: m.learned === false ? { [SCOPE]: { learned: false } } : undefined,
		})),
		flags: protection ? { "moves.backgroundChoices": { "Safety First": protection } } : {},
	});
	const items = [...made.actor.items, knowThings, persuade, persuadePcs, defy];
	items.get = id => items.find(i => i._id === id) ?? null;
	made.actor.items = items;
	const roll = (item, prompted) => made.char.onRoll({
		currentTarget: { closest: sel => (sel === ".item" ? { dataset: { itemId: item._id } } : null), getAttribute: () => null },
	}, prompted);
	return { ...made, knowThings, persuade, persuadePcs, defy, roll };
}
const protectionHeld = char => char.moveResources.getMoveResources()["Safety First"];

describe("the unticked lines a Seeker's moves bring", () => {
	it("offers Let's Make a Deal on either Persuade, and taken it counts a 7-9 as a 10+", async () => {
		const { char, persuade, persuadePcs, defy, roll } = seekerRoller({ moves: ["Let's Make a Deal"] });
		expect(await char.rollOffers(persuade)).toEqual([expect.objectContaining({ key: "lets-make-a-deal", applied: false, source: "Let's Make a Deal", effect: "partialAsSuccess" })]);
		expect(await keysOf(char, persuadePcs)).toEqual(["lets-make-a-deal"]);
		expect(await keysOf(char, defy)).toEqual([]);
		await roll(persuade, { takenOffers: ["lets-make-a-deal"] });
		expect(rolledWith(persuade).partialCountsAsSuccess).toBe("Let's Make a Deal");
		expect(rolledWith(persuade).rollMode).toBe("normal");
		const unticked = seekerRoller({ moves: ["Let's Make a Deal"] });
		await unticked.roll(unticked.persuade, { takenOffers: [] });
		expect(rolledWith(unticked.persuade).partialCountsAsSuccess).toBeUndefined();
		const off = seekerRoller({ moves: [{ name: "Let's Make a Deal", learned: false }] });
		expect(await keysOf(off.char, off.persuade)).toEqual([]);
	});

	it("offers Polyglot on Know Things, for a LEARNED move only, and taken it is a SOURCE of advantage", async () => {
		const { char, knowThings, defy, roll } = seekerRoller({ moves: ["Polyglot"] });
		expect(await char.rollOffers(knowThings)).toEqual([expect.objectContaining({ key: "polyglot", applied: false, source: "Polyglot" })]);
		expect(await keysOf(char, defy)).toEqual([]);
		const off = seekerRoller({ moves: [{ name: "Polyglot", learned: false }] });
		expect(await keysOf(off.char, off.knowThings)).toEqual([]);
		await roll(knowThings, { takenOffers: ["polyglot"] });
		expect(rolledWith(knowThings).rollMode).toBe("adv");
		expect(rolledWith(knowThings).conditionNotes).toContain("Polyglot");
	});

	it("offers Proof Against Detection on Defy Danger only while Protection is held, and spends none", async () => {
		const held = seekerRoller({ moves: ["Safety First", "Proof Against Detection"], protection: 1 });
		expect(await keysOf(held.char, held.defy)).toEqual(["proof-against-detection", "safety-first"]);
		expect(await keysOf(held.char, held.persuade)).toEqual([]);
		await held.roll(held.defy, { takenOffers: ["proof-against-detection"] });
		expect(rolledWith(held.defy).rollMode).toBe("adv");
		expect(rolledWith(held.defy).conditionNotes).toContain("Proof Against Detection");
		expect(protectionHeld(held.char)).toBe(1);
		const none = seekerRoller({ moves: ["Safety First", "Proof Against Detection"], protection: 0 });
		expect(await keysOf(none.char, none.defy)).toEqual([]);
	});

	it("offers Safety First's advantage on Defy Danger while Protection is held, spending 1 only when taken", async () => {
		const { char, defy, roll } = seekerRoller({ moves: ["Safety First"], protection: 2 });
		const [line] = await char.rollOffers(defy);
		expect(line).toMatchObject({ key: "safety-first", applied: false, source: "Safety First" });
		expect(line.label).toContain("spend 1 Protection");
		await roll(defy, { takenOffers: ["safety-first"] });
		expect(rolledWith(defy).rollMode).toBe("adv");
		expect(rolledWith(defy).conditionNotes).toContain("Safety First");
		expect(protectionHeld(char)).toBe(1);

		const unticked = seekerRoller({ moves: ["Safety First"], protection: 2 });
		await unticked.roll(unticked.defy, { takenOffers: [] });
		expect(protectionHeld(unticked.char)).toBe(2);
		expect(await keysOf(seekerRoller({ moves: ["Safety First"] }).char, defy)).toEqual([]);
		const off = seekerRoller({ moves: [{ name: "Safety First", learned: false }], protection: 2 });
		expect(await keysOf(off.char, off.defy)).toEqual([]);
	});
});

// Would-Be Hero audit (2026-09-27): Speak Truth to Power ("When you demand that someone does what is clearly
// good and right, you have advantage to Persuade. If they refuse, gain +1 Resolve"), Better Part of Valor
// ("When you are outnumbered or facing a foe bigger than you, you have advantage to hide from, escape from,
// or sneak past them"), Underestimated ("When you first make your move against an enemy who underestimates
// you, you have advantage") and A Force to Be Reckoned With ("When you Defy Danger against something trying
// to harm or constrain you, on a 12+ you turn the tables on them") did nothing on the roll.
function heroRoller({ moves = [], total = 8 } = {}) {
	const rolled = (name, rollType = "cha") => ({ _id: `${name}-1`, name, type: "move", system: { rollType }, roll: vi.fn(async () => ({ total })) });
	const knowThings = rolled("Know Things", "int");
	const persuade = rolled("Persuade (vs. NPCs)");
	const persuadePcs = rolled("Persuade (vs. PCs)");
	const defy = rolled("Defy Danger", "dex");
	const clash = rolled("Clash", "str");
	const made = buildLiveCharacter({
		slug: "the-would-be-hero", name: "The Would-Be Hero", seedStartingMoves: false,
		items: moves.map(m => makeLiveItem({ name: m.name ?? m, type: "move", system: { moveType: "playbook" }, flags: m.learned === false ? { [SCOPE]: { learned: false } } : undefined })),
	});
	const items = [...made.actor.items, knowThings, persuade, persuadePcs, defy, clash];
	items.get = id => items.find(i => i._id === id) ?? null;
	made.actor.items = items;
	const roll = (item, prompted) => made.char.onRoll({
		currentTarget: { closest: sel => (sel === ".item" ? { dataset: { itemId: item._id } } : null), getAttribute: () => null },
	}, prompted);
	return { ...made, knowThings, persuade, persuadePcs, defy, clash, roll };
}

describe("the unticked lines a Would-Be Hero's moves bring", () => {
	afterEach(() => { seams.turned = null; });

	it("offers Speak Truth to Power on either Persuade, for a LEARNED move only", async () => {
		const { char, persuade, persuadePcs, defy } = heroRoller({ moves: ["Speak Truth to Power"] });
		expect(await char.rollOffers(persuade)).toEqual([expect.objectContaining({ key: "speak-truth-to-power", applied: false, source: "Speak Truth to Power" })]);
		expect(await keysOf(char, persuadePcs)).toEqual(["speak-truth-to-power"]);
		expect(await keysOf(char, defy)).toEqual([]);
		const off = heroRoller({ moves: [{ name: "Speak Truth to Power", learned: false }] });
		expect(await keysOf(off.char, off.persuade)).toEqual([]);
	});

	it("taken, Speak Truth to Power is advantage, and every tier carries the refusal's +1 Resolve", async () => {
		const { persuade, roll } = heroRoller({ moves: ["Speak Truth to Power"] });
		await roll(persuade, { takenOffers: ["speak-truth-to-power"] });
		const options = rolledWith(persuade);
		expect(options.rollMode).toBe("adv");
		expect(options.conditionNotes).toContain("Speak Truth to Power");
		for (const tier of ["success", "partial", "failure"]) expect(options.tierActions[tier]).toContain("stonetop-speak-truth-refused");
		const unticked = heroRoller({ moves: ["Speak Truth to Power"] });
		await unticked.roll(unticked.persuade, { takenOffers: [] });
		expect(rolledWith(unticked.persuade).tierActions).toBeUndefined();
	});

	it("offers Better Part of Valor on Defy Danger alone, and taken it is advantage", async () => {
		const { char, defy, persuade, roll } = heroRoller({ moves: ["Better Part of Valor"] });
		expect(await char.rollOffers(defy)).toEqual([expect.objectContaining({ key: "better-part-of-valor", applied: false, source: "Better Part of Valor" })]);
		expect(await keysOf(char, persuade)).toEqual([]);
		const off = heroRoller({ moves: [{ name: "Better Part of Valor", learned: false }] });
		expect(await keysOf(off.char, off.defy)).toEqual([]);
		await roll(defy, { takenOffers: ["better-part-of-valor"] });
		expect(rolledWith(defy).rollMode).toBe("adv");
		expect(rolledWith(defy).conditionNotes).toContain("Better Part of Valor");
	});

	it("offers Underestimated on every move roll, for a LEARNED move only", async () => {
		const { char, knowThings, persuade, defy, clash, roll } = heroRoller({ moves: ["Underestimated"] });
		for (const item of [knowThings, persuade, defy, clash]) {
			expect(await char.rollOffers(item)).toEqual([expect.objectContaining({ key: "underestimated", applied: false, source: "Underestimated" })]);
		}
		const off = heroRoller({ moves: [{ name: "Underestimated", learned: false }] });
		expect(await keysOf(off.char, off.defy)).toEqual([]);
		await roll(persuade, { takenOffers: ["underestimated"] });
		expect(rolledWith(persuade).rollMode).toBe("adv");
	});

	it("offers A Force to Be Reckoned With on Defy Danger; taken it buys no advantage and prints its note on a 12+ only", async () => {
		const { char, defy, persuade, roll } = heroRoller({ moves: ["A Force to Be Reckoned With"], total: 12 });
		expect(await char.rollOffers(defy)).toEqual([expect.objectContaining({ key: "force-to-be-reckoned-with", applied: false, effect: "criticalNote" })]);
		expect(await keysOf(char, persuade)).toEqual([]);
		const turned = vi.fn();
		seams.turned = turned;
		await roll(defy, { takenOffers: ["force-to-be-reckoned-with"] });
		const options = rolledWith(defy);
		expect(options.rollMode).toBe("normal");
		expect(options.conditionNotes).toContain("A Force to Be Reckoned With");
		expect(options.criticalActions).toContain("turn the tables");
		expect(options.tierActions).toBeUndefined();
		// The 12+ came up: the asterisk wave's hook is called.
		expect(turned).toHaveBeenCalledTimes(1);
		expect(turned.mock.calls[0][0]).toBe(char._actor);
	});

	it("calls no turned-tables hook on an 11, or with the line left unticked", async () => {
		const turned = vi.fn();
		seams.turned = turned;
		const eleven = heroRoller({ moves: ["A Force to Be Reckoned With"], total: 11 });
		await eleven.roll(eleven.defy, { takenOffers: ["force-to-be-reckoned-with"] });
		const unticked = heroRoller({ moves: ["A Force to Be Reckoned With"], total: 12 });
		await unticked.roll(unticked.defy, { takenOffers: [] });
		expect(rolledWith(unticked.defy).criticalActions).toBeUndefined();
		expect(turned).not.toHaveBeenCalled();
	});
});
