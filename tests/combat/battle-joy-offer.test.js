import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	offersBattleJoy, askLoseThemselves, offerBattleJoyOnDamage, offerBattleJoyOnHurt, hpLost, installBattleJoyOnHurt, HP_LOST_OPTION,
	installBattleJoyEnd, stillFighting,
} from "../../module/combat/battle-joy-offer.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// The Heavy spilling blood, theirs or another's: dealing damage or losing HP asks whether they lose
// themselves in battle, and a yes ticks the header glyph's own flag.

function heavy({ moves = ["Battle Joy"], raging = false, type = "character", isOwner = true, learned = true } = {}) {
	const actor = {
		id: "duvin", name: "Duvin", type, isOwner,
		system: { attributes: { hp: { value: 10 } } },
		items: moves.map(name => ({ type: "move", name, flags: learned ? {} : { [SYSTEM_ID]: { learned: false } } })),
		flags: { [SYSTEM_ID]: raging ? { battleJoy: true } : {} },
		getFlag: (scope, key) => actor.flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { actor.flags[scope][key] = value; }),
	};
	return actor;
}

let saved;
let posted;
beforeEach(() => {
	saved = { ChatMessage: globalThis.ChatMessage, document: globalThis.document };
	posted = [];
	globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: ({ actor }) => ({ alias: actor.name }) };
	globalThis.document = { createElement: () => ({}) };
});
afterEach(() => {
	globalThis.ChatMessage = saved.ChatMessage;
	globalThis.document = saved.document;
});

describe("offersBattleJoy", () => {
	it("asks a Heavy who dealt damage", () => {
		expect(offersBattleJoy(heavy(), [3])).toBe(true);
		expect(offersBattleJoy(heavy(), [0, 4])).toBe(true);
	});

	it("does not ask when no blood was spilled", () => {
		expect(offersBattleJoy(heavy(), [0])).toBe(false);
		expect(offersBattleJoy(heavy(), [])).toBe(false);
	});

	it("does not ask one already raging, without the move, with it switched off, or not theirs to write", () => {
		expect(offersBattleJoy(heavy({ raging: true }), [3])).toBe(false);
		expect(offersBattleJoy(heavy({ moves: ["Berserker"] }), [3])).toBe(false);
		expect(offersBattleJoy(heavy({ learned: false }), [3])).toBe(false);
		expect(offersBattleJoy(heavy({ isOwner: false }), [3])).toBe(false);
		expect(offersBattleJoy(heavy({ type: "npc" }), [3])).toBe(false);
	});
});

describe("offerBattleJoyOnDamage", () => {
	it("a yes enters the Battle Joy and says so", async () => {
		const duvin = heavy();
		expect(await offerBattleJoyOnDamage(duvin, "Clash", [5], { ask: async () => true })).toBe(true);
		expect(duvin.flags[SYSTEM_ID].battleJoy).toBe(true);
		expect(posted[0].content).toContain("loses themselves in battle");
	});

	it("a no leaves them as they were, and says nothing", async () => {
		const duvin = heavy();
		expect(await offerBattleJoyOnDamage(duvin, "Clash", [5], { ask: async () => false })).toBe(false);
		expect(duvin.setFlag).not.toHaveBeenCalled();
		expect(posted).toEqual([]);
	});

	it("never asks when it would not offer", async () => {
		const ask = vi.fn(async () => true);
		expect(await offerBattleJoyOnDamage(heavy({ raging: true }), "Clash", [5], { ask })).toBe(false);
		expect(ask).not.toHaveBeenCalled();
	});
});

describe("askLoseThemselves", () => {
	it("is yes only on the lose-yourself button", async () => {
		const waitFor = answer => ({ wait: vi.fn(async ({ buttons }) => buttons.find(b => b.action === answer)?.callback() ?? null) });
		expect(await askLoseThemselves(heavy(), "Duvin bled.", { DialogV2: waitFor("rage") })).toBe(true);
		expect(await askLoseThemselves(heavy(), "Duvin bled.", { DialogV2: waitFor("calm") })).toBe(false);
		expect(await askLoseThemselves(heavy(), "Duvin bled.", { DialogV2: waitFor(null) })).toBe(false);
	});

	it("keeps their head by default", async () => {
		let buttons;
		await askLoseThemselves(heavy(), "Duvin bled.", { DialogV2: { wait: async opts => { buttons = opts.buttons; return null; } } });
		expect(buttons[0].action).toBe("rage");
		expect(buttons.find(b => b.default)?.action).toBe("calm");
	});
});

describe("their own blood", () => {
	it("says what happened, whichever way the blood was spilled", async () => {
		const ask = vi.fn(async () => false);
		await offerBattleJoyOnDamage(heavy(), "Clash", [5], { ask });
		await offerBattleJoyOnHurt(heavy(), 3, { ask });
		expect(ask.mock.calls.map(c => c[1])).toEqual(["Duvin has just dealt damage (Clash).", "Duvin has just lost 3 HP."]);
	});

	it("asks once while a question is already open for the same Heavy", async () => {
		const duvin = heavy();
		let answer;
		const ask = vi.fn(() => new Promise(r => { answer = r; }));
		const first = offerBattleJoyOnDamage(duvin, "Clash", [5], { ask });
		expect(await offerBattleJoyOnHurt(duvin, 3, { ask })).toBe(false);
		answer(true);
		expect(await first).toBe(true);
		expect(ask).toHaveBeenCalledTimes(1);
	});

	it("counts HP lost by someone left standing, and nothing at 0 or on a heal", () => {
		expect(hpLost(10, 7)).toBe(3);
		expect(hpLost(10, "7")).toBe(3);
		expect(hpLost(10, 0)).toBe(0);
		expect(hpLost(5, 9)).toBe(0);
		expect(hpLost(10, "")).toBe(0);
	});
});

describe("installBattleJoyOnHurt", () => {
	function fakeHooks() {
		const on = new Map();
		return {
			on: (name, fn) => { on.set(name, fn); return name; },
			off: vi.fn(),
			fire: (name, ...args) => on.get(name)?.(...args),
		};
	}
	let savedGame;
	beforeEach(() => {
		savedGame = { user: globalThis.game.user, users: globalThis.game.users, foundry: globalThis.foundry };
		globalThis.foundry = { ...(globalThis.foundry ?? {}), utils: { ...(globalThis.foundry?.utils ?? {}), getProperty: (o, path) => path.split(".").reduce((v, k) => v?.[k], o) } };
	});
	afterEach(() => {
		globalThis.game.user = savedGame.user;
		globalThis.game.users = savedGame.users;
		globalThis.foundry = savedGame.foundry;
	});

	it("marks the write that takes HP off a Heavy, and nobody else's", () => {
		const hooks = fakeHooks();
		installBattleJoyOnHurt({ hooks });
		const options = {};
		hooks.fire("preUpdateActor", heavy(), { system: { attributes: { hp: { value: 6 } } } }, options);
		expect(options[HP_LOST_OPTION]).toBe(4);

		const other = {};
		hooks.fire("preUpdateActor", heavy({ moves: [] }), { system: { attributes: { hp: { value: 6 } } } }, other);
		hooks.fire("preUpdateActor", heavy(), { system: { attributes: { hp: { value: 0 } } } }, other);
		hooks.fire("preUpdateActor", heavy(), { name: "Duv" }, other);
		expect(other).toEqual({});
	});

	it("asks on the Heavy's own player's screen, not the GM's who applied it", async () => {
		const hooks = fakeHooks();
		installBattleJoyOnHurt({ hooks });
		const duvin = heavy();
		const gm = { id: "gm", isGM: true, active: true, character: null };
		const player = { id: "p1", isGM: false, active: true, character: duvin };
		duvin.testUserPermission = () => true;
		globalThis.game.users = [gm, player];
		const wait = vi.fn(async () => null);
		globalThis.foundry.applications = { api: { DialogV2: { wait } } };

		globalThis.game.user = gm;
		hooks.fire("updateActor", duvin, {}, { [HP_LOST_OPTION]: 4 });
		await new Promise(r => setTimeout(r, 0));
		expect(wait).not.toHaveBeenCalled();

		globalThis.game.user = player;
		hooks.fire("updateActor", duvin, {}, { [HP_LOST_OPTION]: 4 });
		await new Promise(r => setTimeout(r, 0));
		expect(wait).toHaveBeenCalledTimes(1);
	});
});

describe("installBattleJoyEnd: the action stops", () => {
	function hooksFake() {
		const on = new Map();
		return { on: (name, fn) => { on.set(name, fn); return name; }, off: vi.fn(), fire: (name, ...args) => on.get(name)?.(...args) };
	}
	const combat = (id, actors) => ({ id, combatants: actors.map((actor, i) => ({ id: `${id}-c${i}`, actor })) });
	let savedGame;
	beforeEach(() => { savedGame = { user: globalThis.game.user, users: globalThis.game.users, combats: globalThis.game.combats }; });
	afterEach(() => {
		globalThis.game.user = savedGame.user;
		globalThis.game.users = savedGame.users;
		globalThis.game.combats = savedGame.combats;
	});

	/** A raging Heavy played by p1, with the GM and p1 both logged in; this client is `me`. */
	function table(me = "p1", { raging = true } = {}) {
		const duvin = heavy({ raging });
		duvin.testUserPermission = () => true;
		const gm = { id: "gm", isGM: true, active: true, character: null };
		const player = { id: "p1", isGM: false, active: true, character: duvin };
		globalThis.game.users = [gm, player];
		globalThis.game.user = me === "gm" ? gm : player;
		return duvin;
	}

	it("asks the raging Heavy's own player to roll +CON when the fight is over", () => {
		const duvin = table("p1");
		const hooks = hooksFake();
		const endBattleJoy = vi.fn(async () => {});
		installBattleJoyEnd({ hooks, endBattleJoy });
		globalThis.game.combats = [];
		hooks.fire("deleteCombat", combat("f1", [duvin, duvin]));
		expect(endBattleJoy).toHaveBeenCalledTimes(1);
		expect(endBattleJoy).toHaveBeenCalledWith(duvin);
	});

	it("asks nothing on the GM's screen, of a calm Heavy, or of one still fighting elsewhere", () => {
		const hooks = hooksFake();
		const endBattleJoy = vi.fn(async () => {});
		installBattleJoyEnd({ hooks, endBattleJoy });
		globalThis.game.combats = [];

		hooks.fire("deleteCombat", combat("f1", [table("gm")]));
		hooks.fire("deleteCombat", combat("f1", [table("p1", { raging: false })]));
		const duvin = table("p1");
		globalThis.game.combats = [combat("f2", [duvin])];
		hooks.fire("deleteCombat", combat("f1", [duvin]));
		expect(endBattleJoy).not.toHaveBeenCalled();
	});

	it("asks when the Heavy leaves the last fight they were in, but not when the whole fight goes", () => {
		const duvin = table("p1");
		const hooks = hooksFake();
		const endBattleJoy = vi.fn(async () => {});
		installBattleJoyEnd({ hooks, endBattleJoy });
		const fight = combat("f1", [duvin]);
		const leaving = { ...fight.combatants[0], parent: fight };

		globalThis.game.combats = Object.assign([fight], { get: id => (id === "f1" ? fight : undefined) });
		hooks.fire("deleteCombatant", leaving);
		expect(endBattleJoy).toHaveBeenCalledTimes(1);

		globalThis.game.combats = Object.assign([], { get: () => undefined });
		hooks.fire("deleteCombatant", leaving);
		expect(endBattleJoy).toHaveBeenCalledTimes(1);
	});

	it("knows who is still fighting", () => {
		const duvin = heavy();
		duvin.id = "duvin";
		const f1 = combat("f1", [duvin]);
		expect(stillFighting(duvin, [f1])).toBe(true);
		expect(stillFighting(duvin, [f1], { exceptCombat: f1 })).toBe(false);
		expect(stillFighting(duvin, [f1], { exceptCombatant: f1.combatants[0] })).toBe(false);
	});
});
