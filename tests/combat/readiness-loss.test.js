import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi } from "vitest";
import {
	askGoingOnOffense, settleReadinessOnAttack, holdersLeft, droppedHoldingReadiness, installReadinessLoss,
} from "../../module/combat/readiness-loss.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { collection } from "../fakes/fight.js";
import { stubAsk } from "../fakes/confirm.js";

// Losing Defend's Readiness (p.216): asked on an attack, since a defensive Clash keeps it; lost when the
// fight ends, the character leaves it, or goes down.

const FIGHT = { [SYSTEM_ID]: { fight: { v: 1 } } };

function hero(id, readiness = 0, { hp = 10, type = "character" } = {}) {
	const actor = {
		id, name: id[0].toUpperCase() + id.slice(1), type,
		flags: { [SYSTEM_ID]: { readiness } },
		system: { attributes: { hp: { value: hp } } },
		setFlag: vi.fn(async (scope, key, value) => { actor.flags[scope][key] = value; }),
	};
	return actor;
}
const held = actor => actor.flags[SYSTEM_ID].readiness;
const combatant = (id, actor) => ({ id, actor });
const fight = (id, combatants, flags = FIGHT) => {
	const combat = { id, flags, combatants: collection(combatants) };
	for (const c of combatants) c.parent = combat;
	return combat;
};

function fakeHooks() {
	const on = new Map();
	return {
		on: (name, fn) => { on.set(name, [...(on.get(name) ?? []), fn]); return on.get(name).length; },
		off: () => {},
		fire: async (name, ...args) => { for (const fn of on.get(name) ?? []) fn(...args); await new Promise(r => setTimeout(r, 0)); },
	};
}

let saved;
let posted;
beforeEach(() => {
	saved = { ChatMessage: globalThis.ChatMessage, user: globalThis.game.user, users: globalThis.game.users, combats: globalThis.game.combats };
	posted = [];
	globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: ({ actor }) => ({ actor: actor.id }) };
	const gm = { id: "gm", isGM: true, active: true };
	globalThis.game.user = gm;
	globalThis.game.users = Object.assign(collection([gm]), { activeGM: gm });
	globalThis.game.combats = collection([]);
});
afterEach(() => {
	globalThis.ChatMessage = saved.ChatMessage;
	globalThis.game.user = saved.user;
	globalThis.game.users = saved.users;
	globalThis.game.combats = saved.combats;
});

describe("settleReadinessOnAttack", () => {
	it("asks nothing of a character holding none", async () => {
		const bram = hero("bram", 0);
		const ask = vi.fn(async () => true);
		expect(await settleReadinessOnAttack(bram, "Clash", { ask })).toBe(false);
		expect(ask).not.toHaveBeenCalled();
		expect(posted).toEqual([]);
	});

	it("rushing in loses it all, and says so", async () => {
		const bram = hero("bram", 3);
		expect(await settleReadinessOnAttack(bram, "Clash", { ask: async () => true })).toBe(true);
		expect(held(bram)).toBe(0);
		expect(posted[0].content).toContain("goes on the offense (Clash) and loses all held Readiness");
	});

	it("holding their ground keeps it (p.216: a defensive Clash), and says so", async () => {
		const bram = hero("bram", 2);
		expect(await settleReadinessOnAttack(bram, "Clash", { ask: async () => false })).toBe(false);
		expect(held(bram)).toBe(2);
		expect(bram.setFlag).not.toHaveBeenCalled();
		expect(posted[0].content).toContain("fights defensively (Clash) and keeps 2 Readiness");
	});

	it("leaves anyone but a character alone", async () => {
		const ask = vi.fn(async () => true);
		expect(await settleReadinessOnAttack(hero("crew", 2, { type: "npc" }), "Clash", { ask })).toBe(false);
		expect(ask).not.toHaveBeenCalled();
	});
});

describe("askGoingOnOffense", () => {
	it("loses on the rushing-in button, keeps on the other or a closed window", async () => {
		const bram = hero("bram", 2);
		const { document } = globalThis;
		const { applications } = globalThis.foundry;
		globalThis.document = { createElement: () => ({}) };
		onTestFinished(() => { globalThis.document = document; globalThis.foundry.applications = applications; });
		const asked = stubAsk("lose");
		expect(await askGoingOnOffense(bram, "Let Fly")).toBe(true);
		// The buttons name the outcome, the one that costs something on the left; Enter keeps it.
		const spec = asked.mock.calls[0][0];
		expect(spec.buttons.map(b => b.action)).toEqual(["lose", "keep"]);
		expect(spec.buttons.find(b => b.default)?.action).toBe("keep");
		expect(spec.window.title).toBe("Bram holds 2 Readiness");
		stubAsk("keep");
		expect(await askGoingOnOffense(bram, "Let Fly")).toBe(false);
		stubAsk(null);
		expect(await askGoingOnOffense(bram, "Let Fly")).toBe(false);
	});
});

describe("holdersLeft", () => {
	it("the characters holding Readiness in the fight that ended, once each", () => {
		const bram = hero("bram", 2);
		const ana = hero("ana", 0);
		const wolf = hero("wolf", 3, { type: "monster" });
		const ended = fight("f1", [combatant("a", bram), combatant("b", bram), combatant("c", ana), combatant("d", wolf)]);
		expect(holdersLeft(ended, [ended])).toEqual([bram]);
	});

	it("not one still fighting somewhere else", () => {
		const bram = hero("bram", 2);
		const ended = fight("f1", [combatant("a", bram)]);
		const other = fight("f2", [combatant("b", bram)]);
		expect(holdersLeft(ended, [ended, other])).toEqual([]);
		// A plain core combat is not a fight.
		expect(holdersLeft(ended, [ended, fight("f3", [combatant("c", bram)], {})])).toEqual([bram]);
	});
});

describe("droppedHoldingReadiness", () => {
	it("a character holding Readiness whose HP was just set to 0", () => {
		expect(droppedHoldingReadiness(hero("bram", 2, { hp: 0 }), { system: { attributes: { hp: { value: 0 } } } })).toBe(true);
		expect(droppedHoldingReadiness(hero("bram", 2, { hp: 0 }), { "system.attributes.hp.value": 0 })).toBe(true);
		expect(droppedHoldingReadiness(hero("bram", 2, { hp: 3 }), { system: { attributes: { hp: { value: 3 } } } })).toBe(false);
		expect(droppedHoldingReadiness(hero("bram", 0, { hp: 0 }), { system: { attributes: { hp: { value: 0 } } } })).toBe(false);
		// Another change on a character already down is not the drop.
		expect(droppedHoldingReadiness(hero("bram", 2, { hp: 0 }), { name: "Bram" })).toBe(false);
	});
});

describe("installReadinessLoss", () => {
	it("the fight ending lets everyone's Readiness go, in one note", async () => {
		const hooks = fakeHooks();
		installReadinessLoss({ hooks });
		const bram = hero("bram", 2);
		const ana = hero("ana", 1);
		await hooks.fire("deleteCombat", fight("f1", [combatant("a", bram), combatant("b", ana)]));
		expect([held(bram), held(ana)]).toEqual([0, 0]);
		expect(posted).toHaveLength(1);
		expect(posted[0].content).toContain("The fight is over: Bram &amp; Ana let go of their Readiness.");
	});

	it("leaving a fight still going lets it go; the whole fight going says it once", async () => {
		const hooks = fakeHooks();
		installReadinessLoss({ hooks });
		const bram = hero("bram", 2);
		const going = fight("f1", [combatant("a", bram)]);
		globalThis.game.combats = collection([going]);
		const left = combatant("gone", bram);
		left.parent = going;
		// Bram is still in it as combatant "a".
		await hooks.fire("deleteCombatant", left);
		expect(held(bram)).toBe(2);
		globalThis.game.combats = collection([fight("f1", [])]);
		await hooks.fire("deleteCombatant", left);
		expect(held(bram)).toBe(0);
		expect(posted[0].content).toContain("Bram leaves the fight and loses their Readiness.");
		// Its fight already deleted: deleteCombat's to say.
		const ana = hero("ana", 1);
		const dead = combatant("x", ana);
		dead.parent = fight("gone", [dead]);
		await hooks.fire("deleteCombatant", dead);
		expect(held(ana)).toBe(1);
	});

	it("going down lets it go", async () => {
		const hooks = fakeHooks();
		installReadinessLoss({ hooks });
		const bram = hero("bram", 3, { hp: 0 });
		await hooks.fire("updateActor", bram, { system: { attributes: { hp: { value: 0 } } } });
		expect(held(bram)).toBe(0);
		expect(posted[0].content).toContain("Bram is down and loses their Readiness.");
	});

	it("only the primary GM writes", async () => {
		const hooks = fakeHooks();
		installReadinessLoss({ hooks });
		globalThis.game.user = { id: "player", isGM: false };
		const bram = hero("bram", 2);
		await hooks.fire("deleteCombat", fight("f1", [combatant("a", bram)]));
		expect(held(bram)).toBe(2);
		expect(posted).toEqual([]);
	});
});
