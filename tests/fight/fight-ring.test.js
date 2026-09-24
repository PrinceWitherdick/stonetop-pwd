import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";

vi.mock("../../module/combat/attack-flow.js", () => ({
	pcDamageDie: vi.fn(async actor => String(actor?.system?.attributes?.damage?.value ?? "")),
	rollDamageAt: vi.fn(async () => true),
	rollCharacterDamageAt: vi.fn(async () => true),
	letFlyAmmoStatuses: vi.fn(async actor => actor?.ammo ?? { weapons: [], allOut: false }),
}));

import {
	ringButtons, ringButtonsFor, runRingButton, ringFightFor, clickOpensRing, ringGrowth, dieIcon, ringContext,
	createFightRingClass, createFightTokenClass, openRingOnClick, onBoardPress, closeFightRing, syncFightRing,
	installFightRing, currentFightRing, RING_MOVES, hasAttacker,
} from "../../module/fight/fight-ring.js";
import { rollDamageAt, rollCharacterDamageAt } from "../../module/combat/attack-flow.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";

// The fight ring: the buttons a click puts round a token in the fight, what each one rolls, and when
// the ring comes up and goes away.

const ROOT = path.resolve(import.meta.dirname, "../..");
const template = Handlebars.compile(fs.readFileSync(path.join(ROOT, "templates/hud/fight-ring.hbs"), "utf8"));

/** A printed blow's armor clause, as utils/damage.js#attackWeapon builds it. */
const weapon = (tags, { piercing = 0, ignoresArmor = false } = {}) => ({ name: "", range: [], piercing, ignoresArmor, tags, area: false });

const item = (id, type, name, system = {}, sort = 0) => ({ id, type, name, system, sort, roll: vi.fn(async () => {}) });

function bram({ items = null, die = "d8" } = {}) {
	const actor = fakeActor({ id: "bram", name: "Bram", type: "character", system: { attributes: { damage: { value: die } } } });
	actor.items = collection(items ?? [
		item("letfly", "move", "Let Fly", {}, 2),
		item("defy", "move", "Defy Danger", {}, 0),
		item("clash", "move", "Clash", {}, 1),
	]);
	actor.sheet = { rollMoveById: vi.fn(async () => {}) };
	return actor;
}

/** The Gwyllgi as it ships: two blows on its damage line, a third on a move, and two moves that roll nothing. */
function gwyllgi() {
	const actor = fakeActor({
		id: "gwyllgi", name: "Gwyllgi", type: "monster",
		system: { attributes: { damage: { value: "claws d8 (close) or bite d8+2 (hand, grabby, forceful)", rollFormula: "d8+2" } } },
	});
	actor.items = collection([
		item("m1", "monsterMove", "Manifest as a black wolf with blazing red eyes", { rollFormula: "" }),
		item("m2", "monsterMove", "Breathe forth a baleful cloud, d6 damage (reach, area, ignores armor)", { rollFormula: "d6" }),
	]);
	return actor;
}

let saved;
let settings;
beforeEach(() => {
	saved = { settings: globalThis.game.settings, combats: globalThis.game.combats, user: globalThis.game.user, activeTool: globalThis.game.activeTool, canvas: globalThis.canvas, ui: globalThis.ui, applications: globalThis.foundry.applications };
	settings = new Map([["fightTab", true], ["fightRing", true]]);
	globalThis.game.settings = { get: (scope, key) => settings.get(key) };
	globalThis.game.user = { id: "player", isGM: false };
	globalThis.game.activeTool = "select";
	vi.mocked(rollDamageAt).mockClear();
	vi.mocked(rollCharacterDamageAt).mockClear();
});
afterEach(() => {
	globalThis.game.settings = saved.settings;
	globalThis.game.combats = saved.combats;
	globalThis.game.user = saved.user;
	globalThis.game.activeTool = saved.activeTool;
	globalThis.canvas = saved.canvas;
	globalThis.ui = saved.ui;
	globalThis.foundry.applications = saved.applications;
});

describe("ringButtons", () => {
	it("gives a character Clash, Let Fly and Defy Danger in the ring's order, not their sheet's, and their damage die", () => {
		const { moves, damage } = ringButtons(bram(), { die: "d8" });
		expect(moves).toEqual([
			{ run: "move", itemId: "clash", label: "Clash", icon: "fa-solid fa-swords" },
			{ run: "move", itemId: "letfly", label: "Let Fly", icon: "fa-solid fa-bow-arrow" },
			{ run: "move", itemId: "defy", label: "Defy Danger", icon: "fa-solid fa-person-running" },
		]);
		expect(damage).toEqual([{ run: "damage", label: "Damage", formula: "d8", icon: "fa-solid fa-dice-d8" }]);
	});

	it("leaves off a move the character does not have, and a namesake that is not a move", () => {
		const actor = bram({ items: [item("clash", "move", "Clash"), item("book", "inventory", "Let Fly")] });
		expect(ringButtons(actor, { die: "d6" }).moves.map(m => m.label)).toEqual(["Clash"]);
	});

	it("has no damage button for a character with no die", () => {
		expect(ringButtons(bram(), { die: " " }).damage).toEqual([]);
	});

	it("gives a monster a button for every blow on its damage line and every move that rolls, in the stat block's words", () => {
		const { moves, damage } = ringButtons(gwyllgi());
		expect(moves).toEqual([]);
		expect(damage).toEqual([
			{ run: "damage", label: "Claws", formula: "d8", keywords: "close", rollMode: "normal", weapon: weapon(["close"]), icon: "fa-solid fa-dice-d8" },
			{ run: "damage", label: "Bite", formula: "d8+2", keywords: "hand, grabby, forceful", rollMode: "normal", weapon: weapon(["hand", "grabby", "forceful"]), icon: "fa-solid fa-dice-d8" },
			{ run: "item", itemId: "m2", label: "Breathe forth a baleful cloud", formula: "d6", icon: "fa-solid fa-dice-d6" },
		]);
	});

	it("carries each blow's armor clause, for the Apply that takes armor off it", () => {
		const actor = fakeActor({ id: "m", type: "monster", system: { attributes: { damage: { value: "dagger d10 (hand, 1 piercing) or garrote d8 (hand, grabby, ignores armor)" } } } });
		const [dagger, garrote] = ringButtons(actor).damage;
		expect(dagger.weapon).toMatchObject({ piercing: 1, ignoresArmor: false });
		expect(garrote.weapon).toMatchObject({ piercing: 0, ignoresArmor: true, tags: ["hand", "grabby", "ignores armor"] });
	});

	it("rolls a monster's noted disadvantage the way its stat block does", () => {
		const actor = fakeActor({ id: "m", type: "monster", system: { attributes: { damage: { value: "icy touch d6 w/disadvantage (hand)" } } } });
		expect(ringButtons(actor).damage[0]).toMatchObject({ formula: "d6", rollMode: "dis" });
	});

	it("falls back to a hand-written monster's formula when its damage line prints no die", () => {
		const actor = fakeActor({ id: "m", type: "monster", system: { attributes: { damage: { value: "", rollFormula: "2d4 + 1" } } } });
		expect(ringButtons(actor).damage).toEqual([
			{ run: "damage", label: "Damage", formula: "2d4+1", keywords: "", rollMode: "normal", weapon: null, icon: "fa-solid fa-dice-d4" },
		]);
	});

	it("gives an NPC its one damage button, titled with the blow that prints its die, and none of its moves", () => {
		const actor = fakeActor({ id: "n", type: "npc", system: { attributes: { damage: { value: "spear d8 (close, reach)", rollFormula: "d8" } } } });
		actor.items = collection([item("x", "npcMove", "Shout for help", { rollFormula: "d6" })]);
		expect(ringButtons(actor)).toEqual({
			moves: [],
			damage: [{ run: "damage", label: "Spear", formula: "d8", keywords: "close, reach", rollMode: "normal", weapon: weapon(["close", "reach"]), icon: "fa-solid fa-dice-d8" }],
			readiness: 0,
		});
	});

	it("gives a follower the three fight moves and Order, all of them their character's to roll", () => {
		const actor = fakeActor({ id: "enfys", type: "npc", system: { attributes: { damage: { value: "staff d6 (close)", rollFormula: "d6" } } } });
		const order = { character: { id: "cadi" }, ftype: "initiate", slug: "enfys", follower: { name: "Enfys" } };
		const { moves, damage } = ringButtons(actor, { order });
		expect(moves).toEqual([
			{ run: "order", moveKey: "clash", label: "Clash", icon: "fa-solid fa-swords", order },
			{ run: "order", moveKey: "let-fly", label: "Let Fly", icon: "fa-solid fa-bow-arrow", order },
			{ run: "order", moveKey: "defend", label: "Defend", icon: "fa-solid fa-shield", order },
			{ run: "order", moveKey: null, label: "Order", icon: "fa-solid fa-hand-point-right", order },
		]);
		// Their damage is untouched: still the NPC sheet's one button.
		expect(damage).toEqual([{ run: "damage", label: "Staff", formula: "d6", keywords: "close", rollMode: "normal", weapon: weapon(["close"]), icon: "fa-solid fa-dice-d6" }]);
	});

	it("puts all of a group on one foe beside one member's die, same blow, same tags", () => {
		const actor = fakeActor({ id: "crew", type: "npc", system: { attributes: { damage: { value: "spears d6 (close, forceful)", rollFormula: "d6" } } } });
		const { damage } = ringButtons(actor, { swarm: { formula: "d6+5", standing: 6, bonus: 5 } });
		expect(damage).toEqual([
			{ run: "damage", label: "Spears", formula: "d6", keywords: "close, forceful", rollMode: "normal", weapon: weapon(["close", "forceful"]), icon: "fa-solid fa-dice-d6" },
			{ run: "damage", label: "Swarm", formula: "d6+5", keywords: "close, forceful", rollMode: "normal", weapon: weapon(["close", "forceful"]), icon: "fa-solid fa-dice-d6", aria: "Roll damage: all 6 of them on one foe, d6+5" },
		]);
	});

	it("says how many are piling on rather than reading the swarm button's name back", () => {
		const swarm = { run: "damage", label: "Swarm", formula: "d6+5", aria: "Roll damage: all 6 of them on one foe, d6+5" };
		expect(ringContext({ moves: [], damage: [swarm] }).damage[0].aria).toBe("Roll damage: all 6 of them on one foe, d6+5");
	});

	it("keeps an NPC blow's printed disadvantage, on its own die and the group's", () => {
		const actor = fakeActor({ id: "s", type: "npc", system: { attributes: { damage: { value: "stone fists d10+1 (hand, close, disadvantage)", rollFormula: "d10+1" } } } });
		const { damage } = ringButtons(actor, { swarm: { formula: "d10+3", standing: 3, bonus: 2 } });
		expect(damage.map(b => b.rollMode)).toEqual(["dis", "dis"]);
	});

	it("leaves a plain NPC with no orders to take exactly as it was", () => {
		const actor = fakeActor({ id: "n", type: "npc", system: { attributes: { damage: { value: "spear d8", rollFormula: "d8" } } } });
		expect(ringButtons(actor, { order: null }).moves).toEqual([]);
	});

	it("orders a follower even when they have no die to roll", () => {
		const actor = fakeActor({ id: "n", type: "npc", system: { attributes: { damage: { value: "" } } } });
		const buttons = ringButtons(actor, { order: { character: {}, ftype: "crew", slug: "", follower: {} } });
		expect(buttons.moves.map(b => b.label)).toEqual(["Clash", "Let Fly", "Defend", "Order"]);
		expect(buttons.damage).toEqual([]);
	});

	it("has nothing for an NPC with no formula, or anything that is not a fighter", () => {
		const nothing = { moves: [], damage: [], readiness: 0 };
		expect(ringButtons(fakeActor({ id: "n", type: "npc", system: { attributes: { damage: { value: "fists" } } } }))).toEqual(nothing);
		expect(ringButtons(fakeActor({ id: "s", type: "stonetop" }))).toEqual(nothing);
		expect(ringButtons(null)).toEqual(nothing);
	});

	it("looks the character's die up the way the attack flow does", async () => {
		expect((await ringButtonsFor(bram({ die: "d10" }))).damage[0].formula).toBe("d10");
	});

	it("looks a follower's character up for them, so their token can be ordered", async () => {
		const cadi = fakeActor({ id: "cadi", type: "character", name: "Cadi", flags: { [SYSTEM_ID]: { crew: { details: { exceptional: true } } } } });
		cadi.uuid = "Actor.cadi";
		const crew = fakeActor({
			id: "crew", type: "npc", name: "The Crew",
			system: { tags: "warrior, organized", attributes: { damage: { value: "" } } },
			flags: { [SYSTEM_ID]: { followerOrigin: { characterUuid: "Actor.cadi", ftype: "crew", slug: "" } } },
		});
		crew.items = collection([]);
		const actors = globalThis.game.actors;
		globalThis.game.actors = collection([cadi, crew]);
		try {
			const { moves } = await ringButtonsFor(crew);
			expect(moves.map(b => b.label)).toEqual(["Clash", "Let Fly", "Defend", "Order"]);
			expect(moves[0].order).toMatchObject({
				character: cadi, ftype: "crew", slug: "",
				follower: { name: "The Crew", tags: ["warrior", "organized"], moves: [], exceptional: true },
			});
		} finally {
			globalThis.game.actors = actors;
		}
	});

	it("offers the three fighting moves, then Defy Danger, which a follower's Order already opens on", () => {
		expect(RING_MOVES.map(m => m.name)).toEqual(["Clash", "Let Fly", "Defend", "Defy Danger"]);
		expect(RING_MOVES.filter(m => m.characterOnly).map(m => m.name)).toEqual(["Defy Danger"]);
	});

	it("shows the Readiness a character holds over their token, and nothing when they hold none", () => {
		expect(ringContext({ moves: [], damage: [], readiness: 2 }, { name: "Bram" }).readiness)
			.toEqual({ count: 2, label: "Bram holds 2 Readiness", pips: [0, 1] });
		expect(ringContext({ moves: [], damage: [], readiness: 0 }, { name: "Bram" }).readiness).toBeNull();
	});

	it("offers Big Damn Hero's lock eyes to a Would-Be Hero holding Readiness with a foe to face", () => {
		const actor = fakeActor({ id: "pim", type: "character" });
		actor.items = collection([item("bdh", "move", "Big Damn Hero")]);
		expect(ringButtons(actor, { die: "d6", readiness: 1, canLockEyes: true }).moves.map(b => b.run)).toEqual(["lockEyes"]);
		expect(ringButtons(actor, { die: "d6", readiness: 0, canLockEyes: true }).moves).toEqual([]);
		expect(ringButtons(actor, { die: "d6", readiness: 1, canLockEyes: false }).moves).toEqual([]);
	});

	it("offers Defend's strike back while a character holds Readiness, at their die with disadvantage", () => {
		const actor = fakeActor({ id: "bram", type: "character" });
		actor.items = collection([]);
		expect(ringButtons(actor, { die: "d8", readiness: 0 }).damage.map(b => b.run)).toEqual(["damage"]);
		const [, strike] = ringButtons(actor, { die: "d8", readiness: 2 }).damage;
		expect(strike).toMatchObject({ run: "strikeBack", label: "Strike back", formula: "d8", rollMode: "dis", aria: "Spend 1 of 2 Readiness to strike back: d8, with disadvantage" });
	});

	it("offers no strike back with nobody attacking them: \"can't strike back at a foe that's out of reach\"", () => {
		const actor = fakeActor({ id: "bram", type: "character" });
		actor.items = collection([]);
		expect(ringButtons(actor, { die: "d8", readiness: 2, canStrikeBack: false }).damage.map(b => b.run)).toEqual(["damage"]);
	});
});

describe("hasAttacker", () => {
	const place = entry => () => ({ entry: { attackers: [], ...entry } });
	it("a foe in contact or one shooting at them; not a foe they only shoot at", () => {
		expect(hasAttacker({}, { engagementOf: place({ attackers: ["wolf"] }) })).toBe(true);
		expect(hasAttacker({}, { engagementOf: place({ attackers: ["archer"] }) })).toBe(true);
		expect(hasAttacker({}, { engagementOf: place({}) })).toBe(false);
	});
	it("leaves it to the table where the fight cannot be read", () => {
		expect(hasAttacker({}, { engagementOf: () => null })).toBe(true);
	});
});

describe("dieIcon", () => {
	it("draws the die a formula opens with, and a pair of dice for one Font Awesome has no face for", () => {
		expect(dieIcon("d12+2")).toBe("fa-solid fa-dice-d12");
		expect(dieIcon("2d4")).toBe("fa-solid fa-dice-d4");
		expect(dieIcon("d20")).toBe("fa-solid fa-dice-d20");
		expect(dieIcon("d3")).toBe("fa-solid fa-dice");
		expect(dieIcon("")).toBe("fa-solid fa-dice");
	});
});

describe("runRingButton", () => {
	it("rolls a character's move through their sheet, the way the hotbar does, passing Shift along", async () => {
		const actor = bram();
		await runRingButton({ run: "move", itemId: "clash" }, actor, { shiftKey: true });
		expect(actor.sheet.rollMoveById).toHaveBeenCalledWith("clash", { shiftKey: true });
	});

	it("rolls the move itself when the sheet cannot", async () => {
		const actor = bram();
		actor.sheet = {};
		await runRingButton({ run: "move", itemId: "clash" }, actor);
		expect(actor.items.get("clash").roll).toHaveBeenCalled();
	});

	it("rolls a monster's move item as its sheet's roll button does", async () => {
		const actor = gwyllgi();
		await runRingButton({ run: "item", itemId: "m2" }, actor, { shiftKey: false });
		expect(actor.items.get("m2").roll).toHaveBeenCalledWith({ shiftKey: false });
	});

	it("rolls a blow at whoever the monster is fighting, with its title, tags, advantage and armor clause", async () => {
		const actor = gwyllgi();
		const [, bite] = ringButtons(actor).damage;
		await runRingButton(bite, actor);
		expect(rollDamageAt).toHaveBeenCalledWith(actor, {
			formula: "d8+2", label: "Bite", keywords: "hand, grabby, forceful", rollMode: "normal",
			weapon: weapon(["hand", "grabby", "forceful"]), shiftKey: false,
		});
	});

	it("rolls a character's damage with the weapon in hand, as the sheet's Damage button does, Shift and all", async () => {
		const actor = bram();
		await runRingButton(ringButtons(actor, { die: "d8" }).damage[0], actor, { shiftKey: true });
		expect(rollCharacterDamageAt).toHaveBeenCalledWith(actor, { label: "Damage", rollMode: undefined, seeded: true, strikeBack: false, shiftKey: true });
		expect(rollDamageAt).not.toHaveBeenCalled();
	});

	it("strikes back with disadvantage and no fight +N: one defender's blow", async () => {
		const actor = bram();
		actor.flags = { [SYSTEM_ID]: { readiness: 2 } };
		actor.setFlag = vi.fn(async () => {});
		await runRingButton({ run: "strikeBack", label: "Strike back", formula: "d8", rollMode: "dis", weapon: null }, actor);
		expect(rollCharacterDamageAt).toHaveBeenCalledWith(actor, { label: "Strike back", rollMode: "dis", seeded: false, strikeBack: true, shiftKey: false });
		expect(actor.setFlag).toHaveBeenCalledWith(expect.any(String), expect.any(String), 1);
	});

	it("a strike back spends one Readiness without asking whether they went on the offense", async () => {
		const actor = bram();
		actor.flags = { [SYSTEM_ID]: { readiness: 2 } };
		actor.setFlag = vi.fn(async (scope, key, value) => { actor.flags[scope][key] = value; });
		const wait = vi.fn(async spec => spec.buttons[0].callback());
		globalThis.foundry.applications = { ...(globalThis.foundry.applications ?? {}), api: { DialogV2: { wait } } };
		const document = globalThis.document;
		globalThis.document = { createElement: () => ({}) };
		const ChatMessage = globalThis.ChatMessage;
		globalThis.ChatMessage = { create: vi.fn(async () => {}), getSpeaker: () => ({}) };
		onTestFinished(() => { globalThis.document = document; globalThis.ChatMessage = ChatMessage; });
		await runRingButton({ run: "strikeBack", label: "Strike back", formula: "d8", rollMode: "dis", weapon: null }, actor);
		expect(wait).not.toHaveBeenCalled();
		expect(actor.flags[SYSTEM_ID].readiness).toBe(1);
	});

	it("orders a follower through their character's sheet, and never on Shift's shortcut", async () => {
		const sheet = { orderFollower: vi.fn(async () => {}) };
		const order = { character: { sheet }, ftype: "crew", slug: "", follower: { name: "The Crew", tags: ["warrior"], moves: [], exceptional: true } };
		const actor = fakeActor({ id: "crew", type: "npc" });
		await runRingButton({ run: "order", moveKey: "let-fly", order }, actor, { shiftKey: true });
		expect(sheet.orderFollower).toHaveBeenCalledWith(
			{ name: "The Crew", tags: ["warrior"], moves: [], exceptional: true, moveKey: "let-fly" },
			{ ftype: "crew", slug: "" },
		);
		expect(rollDamageAt).not.toHaveBeenCalled();
	});

	it("does nothing without a button or an actor", async () => {
		await runRingButton(null, bram());
		await runRingButton({ run: "damage", formula: "d6" }, null);
		expect(rollDamageAt).not.toHaveBeenCalled();
	});
});

/** Bram and a gwyllgi in a fight on the canvas scene, and a bystander who is not in it. */
function table() {
	const bramToken = fakeToken({ id: "tBram", col: 0, row: 0, actor: bram() });
	const foeToken = fakeToken({ id: "tFoe", col: 1, row: 0, actor: gwyllgi() });
	const bystander = fakeToken({ id: "tBy", col: 5, row: 5, actor: bram() });
	const scene = fakeScene({ tokens: [bramToken, foeToken, bystander] });
	const combat = fakeCombat({
		scene,
		combatants: [
			fakeCombatant({ id: "cBram", token: bramToken, scene, side: "heroes" }),
			fakeCombatant({ id: "cFoe", token: foeToken, scene, side: "foes" }),
		],
	});
	globalThis.game.combats = collection([combat]);
	globalThis.canvas = { scene, stage: { scale: { x: 1 } } };
	globalThis.ui = { ...saved.ui, combat: { viewed: combat } };
	const placeable = doc => ({ document: doc, actor: doc.actor, controlled: true, destroyed: false });
	return { scene, combat, bram: placeable(bramToken), foe: placeable(foeToken), bystander: placeable(bystander) };
}

describe("ringFightFor", () => {
	it("finds the fight a token on the canvas scene is in", () => {
		const { bram: token, combat } = table();
		expect(ringFightFor(token)).toMatchObject({ combat, combatant: { id: "cBram" } });
	});

	it("has nothing for a token that is not in the fight", () => {
		expect(ringFightFor(table().bystander)).toBeNull();
	});

	it("has nothing for a token on a scene nobody is looking at", () => {
		const { bram: token } = table();
		expect(ringFightFor(token, { canvasScene: { id: "elsewhere" } })).toBeNull();
	});

	it("has nothing for a reader who turned the ring off, or with the Fight tab off", () => {
		const { bram: token } = table();
		settings.set("fightRing", false);
		expect(ringFightFor(token)).toBeNull();
		settings.set("fightRing", true);
		settings.set("fightTab", false);
		expect(ringFightFor(token)).toBeNull();
	});
});

describe("clickOpensRing", () => {
	const click = p => clickOpensRing({ tokenId: "t", tool: "select", modifiers: false, controlled: true, ...p });

	it("opens on a plain click that selected the token", () => {
		expect(click({})).toBe(true);
		expect(click({ pressedOn: "other" })).toBe(true);
	});

	it("puts it away instead when this press closed the same token's ring", () => {
		expect(click({ pressedOn: "t" })).toBe(false);
	});

	it("stays down while aiming or measuring, for a modified click, and for a token the click did not leave selected", () => {
		expect(click({ tool: "target" })).toBe(false);
		expect(click({ tool: "ruler" })).toBe(false);
		expect(click({ modifiers: true })).toBe(false);
		expect(click({ controlled: false })).toBe(false);
	});
});

describe("ringGrowth", () => {
	it("leaves the ring alone where the map already draws it at least its natural size", () => {
		expect(ringGrowth(1, 1)).toBe(1);
		expect(ringGrowth(2.5, 1)).toBe(1);
		expect(ringGrowth(2, 0.5)).toBe(1);
	});

	it("grows it back to its natural size on screen when zoomed out, or on a small grid", () => {
		expect(ringGrowth(0.5, 1)).toBe(2);
		expect(ringGrowth(1, 0.5)).toBe(2);
		expect(ringGrowth(0.25, 2)).toBe(2);
	});

	it("does nothing with a scale it cannot read", () => {
		expect(ringGrowth(0, 1)).toBe(1);
		expect(ringGrowth(undefined, 1)).toBe(1);
	});
});

describe("the ring's template", () => {
	it("puts moves on the left and damage on the right, numbered straight through, each saying what it rolls", () => {
		const context = ringContext(ringButtons(bram(), { die: "d8" }), { name: "Bram" });
		expect([...context.moves, ...context.damage].map(b => b.label)).toEqual(["Clash", "Let Fly", "Defy Danger", "Damage"]);
		const html = template(context);
		const left = html.slice(html.indexOf("col left"), html.indexOf("col right"));
		const right = html.slice(html.indexOf("col right"));
		expect(left).toContain('data-index="0"');
		expect(left).toContain('aria-label="Roll Clash"');
		expect(left).toContain('data-index="1"');
		expect(left).toContain('aria-label="Roll Defy Danger"');
		expect(left).not.toContain("stonetop-fight-ring-formula");
		expect(right).toContain('data-index="3"');
		expect(right).toContain('aria-label="Roll damage: Damage, d8"');
		expect(right).toContain('<span class="stonetop-fight-ring-formula">d8</span>');
		expect(html).toContain('aria-label="Bram in the fight: Moves"');
		for (const button of html.match(/<button[^>]*>/g)) expect(button).toContain('type="button"');
	});

	it("always renders both columns, so core does not unwrap a lone one", () => {
		const html = template(ringContext(ringButtons(gwyllgi()), { name: "Gwyllgi" }));
		expect(html).toContain("col left");
		expect(html).toContain("col right");
		const holder = html.match(/<div class="col [^"]*"/g);
		expect(holder).toHaveLength(2);
	});

	it("escapes a name a GM typed", () => {
		const actor = fakeActor({ id: "n", type: "npc", system: { attributes: { damage: { value: "<b>claw</b> d4", rollFormula: "d4" } } } });
		expect(template(ringContext(ringButtons(actor)))).not.toContain("<b>");
	});
});

// Core's HUD base, as much of it as the ring leans on: rendering, closing, placement.
class FakeHUD {
	static DEFAULT_OPTIONS = {};
	rendered = false;
	object = undefined;
	renders = [];
	closes = 0;
	positions = 0;
	get document() { return this.object?.document; }
	async render(options) {
		this.renders.push(options);
		this.object = options.object;
		this.context = await this._prepareContext(options);
		this.rendered = true;
		return this;
	}
	async close() { this.closes++; this.rendered = false; this.object = undefined; }
	setPosition() { this.positions++; }
	_updatePosition(position) { return Object.assign(position, { left: 10, top: 20, width: 100, height: 100, scale: 1 }); }
}
const fakeFoundry = { hud: { BasePlaceableHUD: FakeHUD }, api: { HandlebarsApplicationMixin: Base => class extends Base {} } };

describe("the ring window", () => {
	const Ring = createFightRingClass({ applications: fakeFoundry });

	it("is core's placeable HUD, marked as ours, with the one action its buttons use", () => {
		expect(Ring.prototype).toBeInstanceOf(FakeHUD);
		expect(Ring.DEFAULT_OPTIONS).toMatchObject({ id: "stonetop-fight-ring", classes: ["stonetop-fight-ring"] });
		expect(Ring.PARTS.ring).toEqual({ root: true, template: "systems/stonetop-pwd/templates/hud/fight-ring.hbs" });
		expect(typeof Ring.DEFAULT_OPTIONS.actions.ringRoll).toBe("function");
	});

	it("grows round the token when zoomed out, keeping its box on the token", () => {
		const ring = new Ring();
		globalThis.canvas = { stage: { scale: { x: 0.5 } } };
		expect(ring._updatePosition({})).toEqual({ left: 10, top: 20, width: 50, height: 50, scale: 2 });
		globalThis.canvas = { stage: { scale: { x: 1.5 } } };
		expect(ring._updatePosition({})).toEqual({ left: 10, top: 20, width: 100, height: 100, scale: 1 });
	});

	it("rolls the pressed button for the token's actor, after putting itself away", async () => {
		const { bram: token } = table();
		const ring = new Ring();
		await ring.render({ object: token, ringButtons: ringButtons(token.actor, { die: "d8" }) });
		const actor = token.actor;
		await Ring.DEFAULT_OPTIONS.actions.ringRoll.call(ring, { shiftKey: false }, { dataset: { index: "1" } });
		expect(ring.closes).toBe(1);
		expect(actor.sheet.rollMoveById).toHaveBeenCalledWith("letfly", { shiftKey: false });
		await ring.render({ object: token });
		await Ring.DEFAULT_OPTIONS.actions.ringRoll.call(ring, { shiftKey: true }, { dataset: { index: "3" } });
		expect(rollCharacterDamageAt).toHaveBeenCalledWith(actor, { label: "Damage", rollMode: undefined, seeded: true, strikeBack: false, shiftKey: true });
	});
});

describe("clicking tokens", () => {
	beforeEach(async () => {
		globalThis.foundry.applications = fakeFoundry;
		await closeFightRing();
		// A press the previous test left remembered is spent by the next click.
		await openRingOnClick(null, {});
	});

	const renders = () => currentFightRing()?.renders.length ?? 0;

	it("puts the ring up on a plain click, with the token's buttons", async () => {
		const { bram: token } = table();
		await openRingOnClick(token, {});
		const ring = currentFightRing();
		expect(ring.rendered).toBe(true);
		expect(ring.object).toBe(token);
		expect(ring.renders.at(-1)).toMatchObject({ force: true, position: true, object: token });
		expect(ring.context.moves.map(m => m.label)).toEqual(["Clash", "Let Fly", "Defy Danger"]);
	});

	it("puts it away on the next press, and keeps it away when that press was on the same token", async () => {
		const { bram: token } = table();
		await openRingOnClick(token, {});
		const ring = currentFightRing();
		await onBoardPress();
		expect(ring.rendered).toBe(false);
		await openRingOnClick(token, {});
		expect(ring.rendered).toBe(false);
		// The click after that is a fresh one.
		await openRingOnClick(token, {});
		expect(ring.rendered).toBe(true);
	});

	it("moves to another token clicked while it is up", async () => {
		const { bram: token, foe } = table();
		await openRingOnClick(token, {});
		await onBoardPress();
		await openRingOnClick(foe, {});
		const ring = currentFightRing();
		expect(ring.rendered).toBe(true);
		expect(ring.object).toBe(foe);
		expect(ring.context.damage.map(d => d.label)).toEqual(["Claws", "Bite", "Breathe forth a baleful cloud"]);
	});

	it("does not come up for a token outside the fight, a Shift-click, the target tool, or a token let go of meanwhile", async () => {
		const { bram: token, bystander } = table();
		const before = renders();
		await openRingOnClick(bystander, {});
		await openRingOnClick(token, { shiftKey: true });
		await openRingOnClick({ ...token, controlled: false }, {});
		globalThis.game.activeTool = "target";
		await openRingOnClick(token, {});
		expect(renders()).toBe(before);
	});

	it("does not come up for a token with nothing to roll", async () => {
		const { bram: token } = table();
		token.document.actor = fakeActor({ id: "empty", type: "character" });
		token.document.actor.items = collection([]);
		const before = renders();
		await openRingOnClick(token, {});
		expect(renders()).toBe(before);
	});

	it("goes away when its token leaves the fight", async () => {
		const { bram: token, combat } = table();
		await openRingOnClick(token, {});
		combat.combatants = collection([]);
		syncFightRing();
		expect(currentFightRing().rendered).toBe(false);
	});

	it("follows its token and the zoom, and goes away when the token is let go of", async () => {
		const hooks = fakeHooks();
		installFightRing({ hooks });
		const { bram: token, foe } = table();
		await openRingOnClick(token, {});
		const ring = currentFightRing();
		const moved = ring.positions;
		hooks.fire("refreshToken", foe, {});
		expect(ring.positions).toBe(moved);
		hooks.fire("refreshToken", token, {});
		hooks.fire("canvasPan", {}, { scale: 0.5 });
		expect(ring.positions).toBe(moved + 2);
		hooks.fire("controlToken", foe, false);
		expect(ring.rendered).toBe(true);
		hooks.fire("controlToken", token, false);
		expect(ring.rendered).toBe(false);
	});

	it("goes away when its token is deleted, the map closes, or the reader switches it off", async () => {
		const hooks = fakeHooks();
		installFightRing({ hooks });
		const { bram: token } = table();
		const ring = async () => { await openRingOnClick(token, {}); return currentFightRing(); };
		hooks.fire("deleteToken", { id: "tBram" });
		expect((await ring()).rendered).toBe(true);
		hooks.fire("deleteToken", { id: "tBram" });
		expect(currentFightRing().rendered).toBe(false);
		await ring();
		hooks.fire("canvasTearDown");
		expect(currentFightRing().rendered).toBe(false);
		await ring();
		hooks.fire("clientSettingChanged", "core.something");
		expect(currentFightRing().rendered).toBe(true);
		hooks.fire("clientSettingChanged", `${SYSTEM_ID}.fightRing`);
		expect(currentFightRing().rendered).toBe(false);
	});

	it("listens for presses on the board once, before core sees them", () => {
		const hooks = fakeHooks();
		installFightRing({ hooks });
		const view = { addEventListener: vi.fn() };
		hooks.fire("canvasReady", { app: { view } });
		hooks.fire("canvasReady", { app: { view } });
		expect(view.addEventListener).toHaveBeenCalledTimes(1);
		expect(view.addEventListener).toHaveBeenCalledWith("pointerdown", onBoardPress, { capture: true });
	});
});

describe("the token class", () => {
	it("lets core handle the click first, then offers the ring", () => {
		const calls = [];
		class CoreToken { _onUnclickLeft(event) { calls.push(["core", event]); } }
		const Token = createFightTokenClass(CoreToken);
		const token = new Token();
		token.document = null;
		const event = { shiftKey: true };
		token._onUnclickLeft(event);
		expect(Token.prototype).toBeInstanceOf(CoreToken);
		expect(Token.name).toBe("StonetopToken");
		expect(calls).toEqual([["core", event]]);
	});
});

function fakeHooks() {
	const on = new Map();
	return {
		on: (name, fn) => { on.set(name, [...(on.get(name) ?? []), fn]); return on.get(name).length; },
		off: () => {},
		fire: (name, ...args) => { for (const fn of on.get(name) ?? []) fn(...args); },
	};
}

describe("Let Fly's ammo on the ring", () => {
	const low = { name: "Crossbow", label: "Low ammo", allOut: false };
	const out = { name: "Composite bow", label: "All out", allOut: true };
	const letFly = (ammo, ammoOut = false) => ringContext(ringButtons(bram(), { die: "d8", ammo, ammoOut }), { name: "Bram" })
		.moves.find(m => m.label === "Let Fly");

	it("says nothing while the quiver is full", () => {
		expect(letFly([])).toMatchObject({ ammo: "", ammoOut: false, aria: "Roll Let Fly" });
	});

	it("puts a low bow on the Let Fly button, and only there", () => {
		const context = ringContext(ringButtons(bram(), { die: "d8", ammo: [low] }), { name: "Bram" });
		expect(context.moves.find(m => m.label === "Let Fly")).toMatchObject({ ammo: "Low ammo", ammoOut: false });
		expect(context.moves.find(m => m.label === "Clash").ammo).toBe("");
		// Spoken with the weapon's name, which the badge leaves off.
		expect(context.moves.find(m => m.label === "Let Fly").aria).toBe("Roll Let Fly (Crossbow: low ammo)");
	});

	it("is red only when nothing they carry has any left", () => {
		expect(letFly([out], true).ammoOut).toBe(true);
		const both = letFly([low, out]);
		expect(both.ammoOut).toBe(false);
		expect(both.ammo).toBe("Crossbow: low ammo, Composite bow: all out");
		// An empty crossbow beside a full bow, which the list leaves out: still shots to fire.
		expect(letFly([out], false).ammoOut).toBe(false);
	});

	it("draws the badge in the template", () => {
		const html = template(ringContext(ringButtons(bram(), { die: "d8", ammo: [out], ammoOut: true }), { name: "Bram" }));
		expect(html).toContain('<span class="stonetop-fight-ring-ammo is-out">All out</span>');
		expect(template(ringContext(ringButtons(bram(), { die: "d8" }), { name: "Bram" }))).not.toContain("stonetop-fight-ring-ammo");
	});

	it("is looked up for a character, and never for a monster", async () => {
		const actor = bram();
		actor.ammo = { weapons: [out], allOut: true };
		const button = (await ringButtonsFor(actor)).moves.find(m => m.label === "Let Fly");
		expect(button).toMatchObject({ ammo: [out], ammoOut: true });
		const beast = gwyllgi();
		beast.ammo = { weapons: [low], allOut: false };
		expect((await ringButtonsFor(beast)).moves).toEqual([]);
	});
});
