import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	offersBattleJoy, askLoseThemselves, offerBattleJoyOnDamage, offerBattleJoyOnHurt, hpLost, installBattleJoyOnHurt, HP_LOST_OPTION,
	installBattleJoyEnd, stillFighting, actionStops, wireBattleJoyResult, settleBattleJoyResult, BATTLE_JOY_RESULT_FLAG,
} from "../../module/combat/battle-joy-offer.js";
import { BATTLE_JOY_DROPPED_OPTION } from "../../module/actors/character/battle-joy.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { stubAsk } from "../fakes/confirm.js";

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
		unsetFlag: vi.fn(async (scope, key) => { delete actor.flags[scope][key]; }),
	};
	return actor;
}

let saved;
let posted;
beforeEach(() => {
	saved = { ChatMessage: globalThis.ChatMessage, document: globalThis.document, applications: globalThis.foundry.applications };
	posted = [];
	globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: ({ actor }) => ({ alias: actor.name }) };
	globalThis.document = { createElement: () => ({}) };
});
afterEach(() => {
	globalThis.ChatMessage = saved.ChatMessage;
	globalThis.document = saved.document;
	globalThis.foundry.applications = saved.applications;
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
		stubAsk("rage");
		expect(await askLoseThemselves(heavy(), "Duvin bled.")).toBe(true);
		stubAsk("calm");
		expect(await askLoseThemselves(heavy(), "Duvin bled.")).toBe(false);
		stubAsk(null);
		expect(await askLoseThemselves(heavy(), "Duvin bled.")).toBe(false);
	});

	it("keeps their head by default", async () => {
		const asked = stubAsk(null);
		await askLoseThemselves(heavy(), "Duvin bled.");
		const { buttons } = asked.mock.calls[0][0];
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

	// Wave 4 HP-3: HP taken down to a max that fell (or a typed number capped at it) is no blood spilled.
	it("leaves alone HP a fallen max takes with it", () => {
		const hooks = fakeHooks();
		installBattleJoyOnHurt({ hooks });
		const options = { stonetopHpCeiling: true };
		hooks.fire("preUpdateActor", heavy(), { system: { attributes: { hp: { value: 6 } } } }, options);
		expect(options[HP_LOST_OPTION]).toBeUndefined();
	});

	// Dropping to 0 HP ended it in the same write (hooks/DeathsDoorPrompt.js); the chat line is said
	// once, by whoever made the change.
	it("says a Heavy who dropped has come out of their Battle Joy, on the writer's client only", async () => {
		const hooks = fakeHooks();
		installBattleJoyOnHurt({ hooks });
		globalThis.game.user = { id: "gm" };
		hooks.fire("updateActor", heavy(), {}, { [BATTLE_JOY_DROPPED_OPTION]: true }, "p1");
		await new Promise(r => setTimeout(r, 0));
		expect(posted).toEqual([]);
		hooks.fire("updateActor", heavy(), {}, { [BATTLE_JOY_DROPPED_OPTION]: true }, "gm");
		await new Promise(r => setTimeout(r, 0));
		expect(posted[0].content).toContain("Duvin drops to 0 HP and stops fighting: their Battle Joy ends, with no roll.");
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

	/** Put a table()'s Heavy down at 0 HP and dying, with Unstoppable learned if asked. */
	// Down at 0 HP and dying; with Unstoppable, reduced there in battle (the drop's stamp) unless `inBattle: false`.
	function down(duvin, { unstoppable = false, inBattle = true } = {}) {
		duvin.system.attributes.hp.value = 0;
		duvin.flags[SYSTEM_ID].deathsDoor = "dying";
		if (unstoppable) duvin.items.push({ type: "move", name: "Unstoppable", flags: {} });
		if (unstoppable && inBattle) duvin.flags[SYSTEM_ID].unstoppableFighting = true;
		duvin.update = vi.fn(async changes => {
			for (const key of Object.keys(changes)) {
				const leaf = key.split(".").at(-1);
				if (leaf.startsWith("-=")) delete duvin.flags[SYSTEM_ID][leaf.slice(2)];
			}
		});
		return duvin;
	}

	// The ruling: one who is down stopped fighting when they dropped, so nothing is rolled.
	it("ends a downed Heavy's Battle Joy with no +CON roll, and says so", async () => {
		const duvin = down(table("p1"));
		const hooks = hooksFake();
		const endBattleJoy = vi.fn(async () => {});
		installBattleJoyEnd({ hooks, endBattleJoy, openDeathsDoor: vi.fn(async () => {}) });
		globalThis.game.combats = [];
		hooks.fire("deleteCombat", combat("f1", [duvin]));
		await vi.waitFor(() => expect(duvin.flags[SYSTEM_ID].battleJoy).toBeUndefined());
		expect(endBattleJoy).not.toHaveBeenCalled();
		expect(posted[0].content).toContain("The action stops with Duvin down: their Battle Joy ends, with no roll.");
	});

	// Unstoppable: "When you stop fighting, roll for Death's Door". The Joy goes first, so the roll
	// takes their debilities again.
	it("hands a Heavy fighting on at 0 HP Death's Door once the fight is over, after the Joy ends", async () => {
		const duvin = down(table("p1"), { unstoppable: true });
		const hooks = hooksFake();
		const order = [];
		const openDeathsDoor = vi.fn(async actor => order.push(["door", actor.flags[SYSTEM_ID].battleJoy]));
		installBattleJoyEnd({ hooks, endBattleJoy: vi.fn(), openDeathsDoor });
		globalThis.game.combats = [];
		hooks.fire("deleteCombat", combat("f1", [duvin]));
		await vi.waitFor(() => expect(openDeathsDoor).toHaveBeenCalledWith(duvin));
		expect(order).toEqual([["door", undefined]]);
		expect(posted.map(p => p.content).join(" ")).toContain("time to roll Death&#x27;s Door");
		// They have stopped fighting: the stamp laid at the drop is lifted, though the combat is long gone.
		expect(duvin.update).toHaveBeenCalledWith({ [`flags.${SYSTEM_ID}.-=unstoppableFighting`]: null }, { stonetopMove: "Unstoppable" });
		expect(duvin.flags[SYSTEM_ID].unstoppableFighting).toBeUndefined();
	});

	// "When you are reduced to 0 HP in battle" (Book I p.114): one who dropped outside battle and was later put
	// in a fight never fought on, so its end asks nothing of them; their Door is the ordinary one, already offered.
	it("asks nothing at the fight's end of a Heavy who dropped outside battle", async () => {
		const openDeathsDoor = vi.fn(async () => {});
		const duvin = down(table("p1", { raging: false }), { unstoppable: true, inBattle: false });
		const hooks = hooksFake();
		installBattleJoyEnd({ hooks, endBattleJoy: vi.fn(), openDeathsDoor });
		globalThis.game.combats = [];
		hooks.fire("deleteCombat", combat("f1", [duvin]));
		await new Promise(r => setTimeout(r, 0));
		expect(openDeathsDoor).not.toHaveBeenCalled();
		expect(duvin.update).not.toHaveBeenCalled();
	});

	it("asks Death's Door of one fighting on who was never raging, and nothing of one on their feet", async () => {
		const openDeathsDoor = vi.fn(async () => {});
		const standing = table("p1", { raging: false });
		standing.items.push({ type: "move", name: "Unstoppable", flags: {} });
		await actionStops(standing, { endBattleJoy: vi.fn(), openDeathsDoor });
		expect(openDeathsDoor).not.toHaveBeenCalled();

		const duvin = down(table("p1", { raging: false }), { unstoppable: true });
		const hooks = hooksFake();
		installBattleJoyEnd({ hooks, endBattleJoy: vi.fn(), openDeathsDoor });
		globalThis.game.combats = [];
		hooks.fire("deleteCombat", combat("f1", [duvin]));
		await vi.waitFor(() => expect(openDeathsDoor).toHaveBeenCalledWith(duvin));
	});

	it("still rolls +CON for a Heavy on their feet", async () => {
		const duvin = table("p1");
		const endBattleJoy = vi.fn(async () => {});
		const openDeathsDoor = vi.fn(async () => {});
		await actionStops(duvin, { endBattleJoy, openDeathsDoor });
		expect(endBattleJoy).toHaveBeenCalledWith(duvin);
		expect(openDeathsDoor).not.toHaveBeenCalled();
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

// "On a 10+, that was a rush, regain 1d4 HP; ... on a 6-, mark a debility but don't mark XP." Buttons on
// the roll card, each card spent once.
describe("the Battle Joy roll card's buttons", () => {
	let savedGlobals;
	beforeEach(() => {
		savedGlobals = { Roll: globalThis.Roll, actors: globalThis.game.actors, user: globalThis.game.user, ui: globalThis.ui };
		globalThis.Roll = class {
			constructor(formula) { this.formula = formula; }
			async evaluate() { this.total = 3; return this; }
			async toMessage(data) { posted.push(data); }
		};
		globalThis.game.user = { id: "p1" };
		globalThis.ui = { notifications: { warn: vi.fn() } };
	});
	afterEach(() => {
		globalThis.Roll = savedGlobals.Roll;
		globalThis.game.actors = savedGlobals.actors;
		globalThis.game.user = savedGlobals.user;
		globalThis.ui = savedGlobals.ui;
	});

	/** A Heavy at `hp` of 12, with the character model the buttons write through. */
	function rolled({ hp = 7, marked = [], writable = true } = {}) {
		const duvin = heavy();
		duvin.system.attributes.hp.value = hp;
		duvin.typedActor = {
			computedMaxHp: async () => 12,
			restoreHp: vi.fn(async to => { duvin.system.attributes.hp.value = to; return true; }),
			markDebility: vi.fn(async key => !marked.includes(key)),
			debilityMarkChoices: [{ key: "weakened", name: "Weakened" }, { key: "dazed", name: "Dazed" }],
		};
		globalThis.game.actors = { get: id => (id === duvin.id ? duvin : undefined) };
		const message = {
			speaker: { actor: duvin.id },
			flags: {},
			getFlag: (scope, key) => message.flags[scope]?.[key],
			setFlag: vi.fn(async (scope, key, value) => { (message.flags[scope] ??= {})[key] = value; }),
			unsetFlag: vi.fn(async (scope, key) => { delete message.flags[scope]?.[key]; }),
			canUserModify: () => writable,
		};
		return { duvin, message };
	}

	function card(...choices) {
		const buttons = choices.map(choice => {
			const btn = { dataset: { choice }, disabled: false, classList: { toggle: vi.fn() } };
			btn.addEventListener = (_ev, fn) => { btn.click = fn; };
			return btn;
		});
		return { buttons, html: { querySelectorAll: () => buttons } };
	}

	it("the 10+ rolls 1d4 and regains it, capped at max HP, once", async () => {
		const { duvin, message } = rolled({ hp: 7 });
		expect(await settleBattleJoyResult(message, duvin, "regain")).toBe(true);
		expect(duvin.typedActor.restoreHp).toHaveBeenCalledWith(10, "Battle Joy");
		expect(posted.at(-1).flavor).toContain("stonetop-roll-card");
		expect(posted.at(-1).flavor).toContain("HP 7 → 10");
		expect(message.flags[SYSTEM_ID][BATTLE_JOY_RESULT_FLAG]).toBe("regain");
		// A second press, or a reload, finds it spent.
		expect(await settleBattleJoyResult(message, duvin, "regain")).toBe(false);
		expect(duvin.typedActor.restoreHp).toHaveBeenCalledTimes(1);
	});

	it("stops at max HP", async () => {
		const { duvin, message } = rolled({ hp: 11 });
		await settleBattleJoyResult(message, duvin, "regain");
		expect(duvin.typedActor.restoreHp).toHaveBeenCalledWith(12, "Battle Joy");
	});

	// A Thrall's Torment's Blessing halves the heal inside restoreHp (rounded up): the card reads the
	// sheet back, so it says 7 → 9, not the 7 → 10 that was asked.
	it("says what the sheet now holds when the heal is halved", async () => {
		const { duvin, message } = rolled({ hp: 7 });
		duvin.typedActor.restoreHp = vi.fn(async to => { duvin.system.attributes.hp.value = 7 + Math.ceil((to - 7) / 2); return true; });
		await settleBattleJoyResult(message, duvin, "regain");
		expect(duvin.typedActor.restoreHp).toHaveBeenCalledWith(10, "Battle Joy");
		expect(posted.at(-1).flavor).toContain("HP 7 → 9");
	});

	it("the 6- marks the chosen debility, once, and says so", async () => {
		const { duvin, message } = rolled();
		expect(await settleBattleJoyResult(message, duvin, "dazed")).toBe(true);
		expect(duvin.typedActor.markDebility).toHaveBeenCalledWith("dazed", { moveName: "Battle Joy" });
		expect(posted.at(-1).content).toContain("Duvin marks Dazed as their Battle Joy ends");
		expect(await settleBattleJoyResult(message, duvin, "weakened")).toBe(false);
		expect(duvin.typedActor.markDebility).toHaveBeenCalledTimes(1);
	});

	it("gives the card back when the debility was marked since it was posted", async () => {
		const { duvin, message } = rolled({ marked: ["dazed"] });
		const { buttons } = card("weakened", "dazed");
		expect(await settleBattleJoyResult(message, duvin, "dazed", { buttons })).toBe(false);
		expect(message.flags[SYSTEM_ID]?.[BATTLE_JOY_RESULT_FLAG]).toBeUndefined();
		expect(buttons.every(b => !b.disabled)).toBe(true);
		expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
		expect(await settleBattleJoyResult(message, duvin, "weakened")).toBe(true);
	});

	it("wires the buttons for whoever can write the card and the Heavy, and disables a spent card", async () => {
		const { duvin, message } = rolled();
		const fresh = card("weakened", "dazed");
		wireBattleJoyResult(message, fresh.html);
		expect(fresh.buttons.every(b => !b.disabled && typeof b.click === "function")).toBe(true);
		fresh.buttons[1].click();
		await vi.waitFor(() => expect(duvin.typedActor.markDebility).toHaveBeenCalledWith("dazed", { moveName: "Battle Joy" }));

		// Re-rendered (or reloaded) after it was spent.
		const again = card("weakened", "dazed");
		wireBattleJoyResult(message, again.html);
		expect(again.buttons.every(b => b.disabled)).toBe(true);
		expect(again.buttons[1].classList.toggle).toHaveBeenCalledWith("is-chosen", true);
	});

	it("leaves the buttons disabled for someone who cannot write the card", () => {
		const { message } = rolled({ writable: false });
		const { buttons, html } = card("regain");
		wireBattleJoyResult(message, html);
		expect(buttons[0].disabled).toBe(true);
		expect(buttons[0].click).toBeUndefined();
	});
});
