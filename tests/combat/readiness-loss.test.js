import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi } from "vitest";
import {
	askGoingOnOffense, settleReadinessOnAttack, holdersLeft, droppedHoldingReadiness, installReadinessLoss, charactersLeft,
	settleFollowerReadinessOnAttack, settleFollowerTokenReadinessOnAttack, shieldWallsLeft,
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

/** A character with move tracks (`tracks`, counting what is held), written as MoveResources writes them. */
function marshal(id, tracks = {}) {
	const actor = hero(id);
	actor.tracks = { ...tracks };
	actor.typedActor = {
		moveResources: {
			getMoveResources: () => actor.tracks,
			usesUpdate: (move, value) => ({ [`flags.${SYSTEM_ID}.backgroundChoices.${move}`]: value }),
		},
	};
	actor.update = vi.fn(async data => {
		for (const [path, value] of Object.entries(data)) actor.tracks[path.split(".").at(-1)] = value;
	});
	return actor;
}
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

	// Unstoppable: "When you are reduced to 0 HP in battle, you can keep fighting." Still fighting is
	// still defending, until they roll Death's Door. In battle: the drop stamped it (hooks/DeathsDoorPrompt.js).
	it("not a Heavy who fights on at 0 HP with Unstoppable", () => {
		const bram = hero("bram", 2, { hp: 0 });
		bram.flags[SYSTEM_ID].deathsDoor = "dying";
		bram.flags[SYSTEM_ID].unstoppableFighting = true;
		bram.items = [{ type: "move", name: "Unstoppable", flags: {} }];
		expect(droppedHoldingReadiness(bram, { system: { attributes: { hp: { value: 0 } } } })).toBe(false);
		bram.items[0].flags = { [SYSTEM_ID]: { learned: false } };
		expect(droppedHoldingReadiness(bram, { system: { attributes: { hp: { value: 0 } } } })).toBe(true);
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

	// Payback keeps a follower's grudges on the character it follows (hero-moves.js#recordHarmedBy), and
	// that character need not be in the fight: the fight ending still clears them.
	it("the fight ending clears Payback's grudges on a follower's character who was not in it", async () => {
		const withGrudges = (actor, list) => {
			actor.flags[SYSTEM_ID].harmedBy = list;
			actor.getFlag = (scope, key) => actor.flags[scope]?.[key];
			return actor;
		};
		const bram = withGrudges(hero("bram"), ["foe-1"]);
		const dog = withGrudges(hero("dog", 0, { type: "npc" }), []);
		const cardFor = vi.fn(actor => (actor === dog ? { character: bram } : null));
		const hooks = fakeHooks();
		installReadinessLoss({ hooks, cardFor });
		await hooks.fire("deleteCombat", fight("f1", [combatant("d", dog)]));
		expect(bram.flags[SYSTEM_ID].harmedBy).toEqual([]);
		expect(cardFor).toHaveBeenCalledWith(dog);
	});

	// Heavy re-audit, the user's ruling (2026-10-18): grudges against NAMED foes outlast the fight.
	it("the fight ending keeps Payback's grudges against named foes and lets the mooks' tokens go", async () => {
		const bram = hero("bram");
		bram.flags[SYSTEM_ID].harmedBy = ["Actor.villain", "Scene.s1.Token.crin", "Actor.witch"];
		bram.getFlag = (scope, key) => bram.flags[scope]?.[key];
		const hooks = fakeHooks();
		installReadinessLoss({ hooks });
		await hooks.fire("deleteCombat", fight("f1", [combatant("a", bram)]));
		expect(bram.flags[SYSTEM_ID].harmedBy).toEqual(["Actor.villain", "Actor.witch"]);
	});

	// Payback and Rapier Wit record against a plain core Combat too (the Fight tab off), so its end lets the
	// mooks go just the same; Readiness stays the Fight's own.
	it("a plain Combat ending lets the mooks' grudges go but leaves Readiness alone", async () => {
		const bram = hero("bram", 2);
		bram.flags[SYSTEM_ID].harmedBy = ["Actor.villain", "Scene.s1.Token.crin"];
		bram.flags[SYSTEM_ID].rapierWit = [{ key: "Scene.s1.Token.ogre", name: "Ogre", roll: true, blow: true }];
		bram.getFlag = (scope, key) => bram.flags[scope]?.[key];
		const hooks = fakeHooks();
		installReadinessLoss({ hooks });
		await hooks.fire("deleteCombat", fight("c1", [combatant("a", bram)], {}));
		expect(bram.flags[SYSTEM_ID].harmedBy).toEqual(["Actor.villain"]);
		expect(bram.flags[SYSTEM_ID].rapierWit).toEqual([]);
		expect(held(bram)).toBe(2);
		expect(posted).toEqual([]);
	});

	// Fox re-audit, the same ruling: Rapier Wit's records against tokens go with the fight, a named foe's stays.
	it("the fight ending lets the Fox's Rapier Wit at a token go and keeps it at a named foe", async () => {
		const vesna = hero("vesna");
		vesna.flags[SYSTEM_ID].harmedBy = ["Actor.villain"];
		vesna.flags[SYSTEM_ID].rapierWit = [
			{ key: "Scene.s1.Token.ogre", name: "Ogre", roll: true, blow: true },
			{ key: "Actor.villain", name: "Lord Ulm", roll: false, blow: true },
		];
		vesna.getFlag = (scope, key) => vesna.flags[scope]?.[key];
		const hooks = fakeHooks();
		installReadinessLoss({ hooks });
		await hooks.fire("deleteCombat", fight("f1", [combatant("v", vesna)]));
		expect(vesna.flags[SYSTEM_ID].rapierWit).toEqual([{ key: "Actor.villain", name: "Lord Ulm", roll: false, blow: true }]);
		expect(vesna.flags[SYSTEM_ID].harmedBy).toEqual(["Actor.villain"]);
		expect(vesna.setFlag).not.toHaveBeenCalledWith(SYSTEM_ID, "harmedBy", expect.anything());
	});

	it("only the primary GM writes", async () => {
		const hooks = fakeHooks();
		installReadinessLoss({ hooks });
		globalThis.game.user = { id: "player", isGM: false };
		const bram = hero("bram", 2);
		const maddoc = marshal("maddoc", { "Stentorian": 2 });
		await hooks.fire("deleteCombat", fight("f1", [combatant("a", bram), combatant("m", maddoc)]));
		expect(held(bram)).toBe(2);
		expect(maddoc.tracks.Stentorian).toBe(2);
		expect(posted).toEqual([]);
	});

	// The Marshal's re-audit, the user's ruling (2026-10-18): Stentorian's Command, Front Line Leader's Presence
	// and Prepare a Welcome's Surprise are for one battle, and go when it ends (combat/battle-holds.js#clearFightHolds).
	it("the fight ending clears the Marshal's battle holds, in one write, learned or not", async () => {
		const hooks = fakeHooks();
		installReadinessLoss({ hooks });
		const maddoc = marshal("maddoc", { "Stentorian": 2, "Front Line Leader": 1, "Prepare a Welcome": 2, "Logbook": 1 });
		const bram = marshal("bram", { "Stentorian": 0 });
		await hooks.fire("deleteCombat", fight("f1", [combatant("a", maddoc), combatant("b", maddoc), combatant("c", bram)]));
		expect(maddoc.tracks).toEqual({ "Stentorian": 0, "Front Line Leader": 0, "Prepare a Welcome": 0, "Logbook": 1 });
		expect(maddoc.update).toHaveBeenCalledTimes(1);
		// Nothing held, nothing written.
		expect(bram.update).not.toHaveBeenCalled();
	});

	it("a Marshal still fighting on another map keeps their battle holds", async () => {
		const hooks = fakeHooks();
		installReadinessLoss({ hooks });
		const maddoc = marshal("maddoc", { "Stentorian": 2 });
		const ended = fight("f1", [combatant("a", maddoc)]);
		globalThis.game.combats = collection([ended, fight("f2", [combatant("b", maddoc)])]);
		await hooks.fire("deleteCombat", ended);
		expect(maddoc.tracks.Stentorian).toBe(2);
		// A plain core combat is not a fight.
		globalThis.game.combats = collection([ended, fight("f3", [combatant("c", maddoc)], {})]);
		await hooks.fire("deleteCombat", ended);
		expect(maddoc.tracks.Stentorian).toBe(0);
	});
});

describe("charactersLeft", () => {
	it("the characters in the fight that ended and in no other, once each", () => {
		const bram = hero("bram");
		const ana = hero("ana");
		const wolf = hero("wolf", 0, { type: "npc" });
		const ended = fight("f1", [combatant("a", bram), combatant("b", bram), combatant("c", ana), combatant("d", wolf)]);
		expect(charactersLeft(ended, [ended])).toEqual([bram, ana]);
		expect(charactersLeft(ended, [ended, fight("f2", [combatant("e", ana)])])).toEqual([bram]);
	});
});

// ── Followers go on the offense too (the Marshal's re-audit, the user's ruling 2026-10-18: "Full: followers too") ──

/** A Marshal whose crew holds `readiness`, formed in a shield wall or not, with Shield Wall learned or not. */
function crewLeader(id, { readiness = 0, formed = false, wall = true, owner = true, flags = {} } = {}) {
	const actor = hero(id);
	actor.isOwner = owner;
	actor.flags[SYSTEM_ID].crew = { readiness, ...(formed ? { shieldWall: true } : {}) };
	Object.assign(actor.flags[SYSTEM_ID], flags);
	actor.items = wall ? [{ type: "move", name: "Shield Wall", flags: {} }] : [];
	actor.update = vi.fn(async data => {
		for (const [path, value] of Object.entries(data)) {
			const keys = path.split(".").slice(2);
			let at = actor.flags[SYSTEM_ID];
			for (const key of keys.slice(0, -1)) at = (at[key] ??= {});
			at[keys.at(-1)] = value;
		}
	});
	return actor;
}
const crewHeld = actor => actor.flags[SYSTEM_ID].crew.readiness;

describe("settleFollowerReadinessOnAttack", () => {
	it("asks the crew holding Readiness, by the crew's name and count, and rushing in loses it on the ledger", async () => {
		const maddoc = crewLeader("maddoc", { readiness: 2, wall: false });
		const ask = vi.fn(async () => true);
		expect(await settleFollowerReadinessOnAttack(maddoc, { ftype: "crew", name: "The Wolves" }, "Clash", { ask })).toBe(true);
		expect(ask).toHaveBeenCalledWith(maddoc, "Clash", { name: "The Wolves", count: 2 });
		expect(crewHeld(maddoc)).toBe(0);
		expect(maddoc.update).toHaveBeenCalledWith({ [`flags.${SYSTEM_ID}.crew.readiness`]: 0 }, { stonetopMove: "Clash" });
		expect(posted[0].content).toContain("The Wolves goes on the offense (Clash) and loses all held Readiness");
	});

	it("holding their ground keeps it, and says so", async () => {
		const maddoc = crewLeader("maddoc", { flags: { initiatesReadiness: { seren: 3 } } });
		expect(await settleFollowerReadinessOnAttack(maddoc, { ftype: "initiate", slug: "seren", name: "Seren" }, "Let Fly", { ask: async () => false })).toBe(false);
		expect(maddoc.flags[SYSTEM_ID].initiatesReadiness.seren).toBe(3);
		expect(maddoc.update).not.toHaveBeenCalled();
		expect(posted[0].content).toContain("Seren fights defensively (Let Fly) and keeps 3 Readiness");
	});

	it("asks nothing of a follower holding none, nor on a client that cannot write the character", async () => {
		const ask = vi.fn(async () => true);
		expect(await settleFollowerReadinessOnAttack(crewLeader("maddoc"), { ftype: "crew" }, "Clash", { ask })).toBe(false);
		expect(await settleFollowerReadinessOnAttack(crewLeader("maddoc", { readiness: 2, owner: false }), { ftype: "crew" }, "Clash", { ask })).toBe(false);
		expect(await settleFollowerReadinessOnAttack(crewLeader("maddoc", { readiness: 2 }), { ftype: "nobody" }, "Clash", { ask })).toBe(false);
		expect(ask).not.toHaveBeenCalled();
		expect(posted).toEqual([]);
	});

	// Shield Wall (p.126): "As long as they maintain formation, they can go on the offensive without losing Readiness."
	it("a crew in a shield wall is asked to hold it; holding keeps the Readiness, and the card says why", async () => {
		const maddoc = crewLeader("maddoc", { readiness: 3, formed: true });
		const ask = vi.fn(async () => false);
		expect(await settleFollowerReadinessOnAttack(maddoc, { ftype: "crew", name: "The Wolves" }, "Clash", { ask })).toBe(false);
		expect(ask).toHaveBeenCalledWith(maddoc, "Clash", { name: "The Wolves", count: 3, shieldWall: true });
		expect(crewHeld(maddoc)).toBe(3);
		expect(maddoc.update).not.toHaveBeenCalled();
		expect(posted[0].content).toContain("Shield Wall: The Wolves hold formation and keep their 3 Readiness (Clash).");
	});

	it("breaking formation to charge loses the Readiness and the wall in one write, and says so", async () => {
		const maddoc = crewLeader("maddoc", { readiness: 3, formed: true });
		expect(await settleFollowerReadinessOnAttack(maddoc, { ftype: "crew", name: "The Wolves" }, "Clash", { ask: async () => true })).toBe(true);
		expect(maddoc.update).toHaveBeenCalledTimes(1);
		expect(maddoc.update).toHaveBeenCalledWith({ [`flags.${SYSTEM_ID}.crew.readiness`]: 0, [`flags.${SYSTEM_ID}.crew.shieldWall`]: false }, { stonetopMove: "Clash" });
		expect(maddoc.flags[SYSTEM_ID].crew).toMatchObject({ readiness: 0, shieldWall: false });
		expect(posted[0].content).toContain("The Wolves break formation to charge (Clash): they lose all held Readiness, and the shield wall is gone.");
	});

	it("the wall counts only for the crew, and only with Shield Wall learned", async () => {
		const ask = vi.fn(async () => false);
		await settleFollowerReadinessOnAttack(crewLeader("maddoc", { readiness: 2, formed: true, wall: false }), { ftype: "crew" }, "Clash", { ask });
		expect(ask).toHaveBeenCalledTimes(1);
		const other = crewLeader("maddoc", { readiness: 0, formed: true, flags: { beastReadiness: { wolf: 1 } } });
		await settleFollowerReadinessOnAttack(other, { ftype: "beast", slug: "wolf", name: "Wolf" }, "Clash", { ask });
		expect(ask).toHaveBeenCalledTimes(2);
	});

	it("a follower's token is asked over the card it stands for", async () => {
		const maddoc = crewLeader("maddoc", { readiness: 1 });
		const token = hero("wolves", 0, { type: "npc" });
		token.name = "The Wolves";
		const ask = vi.fn(async () => true);
		const cardFor = vi.fn(() => ({ character: maddoc, ftype: "crew", slug: "" }));
		expect(await settleFollowerTokenReadinessOnAttack(token, "Damage", { cardFor, ask })).toBe(true);
		expect(ask).toHaveBeenCalledWith(maddoc, "Damage", { name: "The Wolves", count: 1 });
		expect(crewHeld(maddoc)).toBe(0);
		// A monster, or an NPC who is nobody's follower, is never asked.
		expect(await settleFollowerTokenReadinessOnAttack(hero("ogre", 0, { type: "monster" }), "Damage", { cardFor, ask })).toBe(false);
		expect(await settleFollowerTokenReadinessOnAttack(token, "Damage", { cardFor: () => null, ask })).toBe(false);
	});
});

describe("askGoingOnOffense for a follower", () => {
	it("names the follower and the Readiness on their card", async () => {
		const { document } = globalThis;
		const { applications } = globalThis.foundry;
		globalThis.document = { createElement: () => ({}) };
		onTestFinished(() => { globalThis.document = document; globalThis.foundry.applications = applications; });
		const asked = stubAsk("keep");
		expect(await askGoingOnOffense(crewLeader("maddoc"), "Clash", { name: "The Wolves", count: 2 })).toBe(false);
		expect(asked.mock.calls[0][0].window.title).toBe("The Wolves holds 2 Readiness");
	});

	it("asks a crew in a shield wall in the wall's words, holding it by default", async () => {
		const { document } = globalThis;
		const { applications } = globalThis.foundry;
		globalThis.document = { createElement: () => ({}) };
		onTestFinished(() => { globalThis.document = document; globalThis.foundry.applications = applications; });
		const asked = stubAsk("lose");
		expect(await askGoingOnOffense(crewLeader("maddoc"), "Clash", { name: "The Wolves", count: 3, shieldWall: true })).toBe(true);
		const spec = asked.mock.calls[0][0];
		expect(spec.window.title).toBe("The Wolves hold the shield wall");
		expect(spec.buttons.map(b => b.label)).toEqual(["Break formation: lose the Readiness", "Hold the wall: keep it"]);
		expect(spec.buttons.find(b => b.default)?.action).toBe("keep");
		stubAsk(null);
		expect(await askGoingOnOffense(crewLeader("maddoc"), "Clash", { name: "The Wolves", count: 3, shieldWall: true })).toBe(false);
	});
});

describe("the shield wall goes when the fight ends or the crew's Readiness does", () => {
	it("shieldWallsLeft: the Marshals in the fight, or behind a crew token in it, fighting nowhere else", () => {
		const maddoc = crewLeader("maddoc", { readiness: 2, formed: true });
		const ysolde = crewLeader("ysolde", { readiness: 2, formed: true });
		const plain = crewLeader("plain", { readiness: 2 });
		const wolves = hero("wolves", 0, { type: "npc" });
		const cardFor = actor => (actor === wolves ? { character: ysolde, ftype: "crew", slug: "" } : null);
		const ended = fight("f1", [combatant("a", maddoc), combatant("b", wolves), combatant("c", plain)]);
		expect(shieldWallsLeft(ended, [ended], { cardFor })).toEqual([maddoc, ysolde]);
		// Ysolde fights on elsewhere: her crew's wall stands.
		expect(shieldWallsLeft(ended, [ended, fight("f2", [combatant("d", ysolde)])], { cardFor })).toEqual([maddoc]);
	});

	it("the fight ending breaks the wall, and the crew's Readiness emptying does too", async () => {
		const hooks = fakeHooks();
		const maddoc = crewLeader("maddoc", { readiness: 2, formed: true });
		installReadinessLoss({ hooks, cardFor: () => null });
		await hooks.fire("deleteCombat", fight("f1", [combatant("a", maddoc)]));
		expect(maddoc.flags[SYSTEM_ID].crew.shieldWall).toBe(false);
		expect(maddoc.update).toHaveBeenCalledWith({ [`flags.${SYSTEM_ID}.crew.shieldWall`]: false }, { stonetopLedger: true });

		const ysolde = crewLeader("ysolde", { readiness: 0, formed: true });
		await hooks.fire("updateActor", ysolde, { flags: { [SYSTEM_ID]: { crew: { readiness: 0 } } } });
		expect(ysolde.flags[SYSTEM_ID].crew.shieldWall).toBe(false);
		// Another change leaves a standing wall alone.
		const held = crewLeader("held", { readiness: 2, formed: true });
		await hooks.fire("updateActor", held, { flags: { [SYSTEM_ID]: { crew: { readiness: 2 } } } });
		await hooks.fire("updateActor", held, { name: "Held" });
		expect(held.update).not.toHaveBeenCalled();
	});
});
