import { afterEach, describe, expect, it, vi } from "vitest";
import {
	RAISED_OPTION,
	onPreUpdateActorDeathsDoor,
	onUpdateActorDeathsDoorRaised,
	promptRaiseFromDead,
} from "../../module/hooks/DeathsDoorPrompt.js";
import { DEATHS_DOOR_STATE } from "../../module/actors/character/deaths-door.js";
import { UNSTOPPABLE_INSTEAD_OPTION, UNSTOPPABLE_REGAIN_OPTION } from "../../module/actors/character/unstoppable.js";
import { BATTLE_JOY_DROPPED_OPTION } from "../../module/actors/character/battle-joy.js";
import { FakeActorBuilder } from "../fakes/FakeActorBuilder.js";

const STATE_PATH = "flags.stonetop-pwd.deathsDoor";

/**
 * A character about to take a hit, with whatever death flags the case needs. The prompt setting is
 * OFF: the card is a separate question, and every case here is about the state the hook records.
 */
function about(flags, hp = 5) {
	const actor = new FakeActorBuilder().withFlags(flags).build();
	actor.type = "character";
	actor.system = { attributes: { hp: { value: hp } } };
	global.game = { settings: { get: () => false } };
	// tests/setup.js fakes `getProperty` but not `setProperty`, and this hook swallows its own
	// faults on purpose (a throw here would abort the HP write and lose the damage) — so without
	// this the assertions below would pass or fail on a silently caught TypeError.
	global.foundry.utils.setProperty ??= (obj, path, value) => {
		const parts = String(path).split(".");
		let current = obj;
		for (const key of parts.slice(0, -1)) { current[key] ??= {}; current = current[key]; }
		current[parts.at(-1)] = value;
	};
	return actor;
}

/** The hook writes into the pending `changes`; this is what it added, if anything. */
function recorded(actor, newHp, options = {}) {
	const changes = { system: { attributes: { hp: { value: newHp } } } };
	onPreUpdateActorDeathsDoor(actor, changes, options);
	// setProperty writes the dotted path as a real nesting; read it either way.
	return changes.flags?.["stonetop-pwd"]?.deathsDoor ?? changes[STATE_PATH];
}

/** Run the pair the way Foundry does: one options object handed to both halves. */
function applyHp(actor, newHp, { userId = "me" } = {}) {
	const options = {};
	const changes = { system: { attributes: { hp: { value: newHp } } } };
	onPreUpdateActorDeathsDoor(actor, changes, options);
	onUpdateActorDeathsDoorRaised(actor, changes, options, userId);
	return options;
}

afterEach(() => { delete global.game; delete global.Dialog; });

describe("onPreUpdateActorDeathsDoor — the state a hit records", () => {
	it("makes a living character dying when they cross to 0", () => {
		expect(recorded(about({}), 0)).toBe(DEATHS_DOOR_STATE.DYING);
	});

	/**
	 * The freeze this guards against. `fate-pending` is one of the two states nextDeathsDoorState
	 * refuses to move off — rightly, since a fatal roll is on the table — so a stale one left
	 * beside an insert (a torn write, see effectiveDeathsDoorState) would have frozen this
	 * character's state for good: never dying again, and so never announcing it, for the rest of
	 * their career. Read through the same lens the character model uses and the next hit both
	 * records the dying state and overwrites the stale flag.
	 */
	it("still lands on a Ghost carrying a fate-pending nothing ever cleared", () => {
		const actor = about({
			deathsDoor: DEATHS_DOOR_STATE.FATE_PENDING,
			postDeathInsert: { slug: "ghost" },
		});

		expect(recorded(actor, 0)).toBe(DEATHS_DOOR_STATE.DYING);
	});

	// A fate-pending with no insert behind it is a real one: the 6- is rolled and the fate is
	// genuinely still owed, so another hit must not restart the brush with death.
	it("leaves a real fate-pending standing", () => {
		const actor = about({ deathsDoor: DEATHS_DOOR_STATE.FATE_PENDING }, 0);

		expect(recorded(actor, 0)).toBeUndefined();
	});

	// A write that settles the Door names its own state, and the hit points in it must not overrule it:
	// Undying's "regain half your max HP" with "out of the action until the next sunset" is HP up AND
	// out of the action in one write (UndeathDialog#_onApply). Read as HP alone it came back "no state".
	it("keeps the state a settling write names, even with hit points coming back in it", () => {
		const actor = about({ deathsDoor: DEATHS_DOOR_STATE.DYING, deathsDoorRolling: { userId: "p1", nonce: "n1" } }, 0);
		const changes = {
			system: { attributes: { hp: { value: 6 } } },
			flags: { "stonetop-pwd": { deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION } },
		};

		onPreUpdateActorDeathsDoor(actor, changes, {});

		expect(changes.flags["stonetop-pwd"].deathsDoor).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
		// Still the end of this brush with death, so a roll left on the sheet goes with it.
		expect(changes.flags["stonetop-pwd"]).toHaveProperty(["-=deathsDoorRolling"], null);
	});

	// Nothing walks `dead` back on its own — the raise is asked about, never assumed.
	it("writes no state change when a dead character is given hit points", () => {
		const actor = about({ deathsDoor: DEATHS_DOOR_STATE.DEAD }, 0);

		expect(recorded(actor, 5)).toBeUndefined();
	});
});

/**
 * Unstoppable: "If you would regain HP while fighting, clear one mark instead." Decided on the HP
 * write itself, before the state reads it, so a Heavy fighting on at 0 stays dying.
 */
describe("onPreUpdateActorDeathsDoor: Unstoppable's mark instead of hit points", () => {
	const unstoppable = { type: "move", name: "Unstoppable", system: { resource: { max: 5 } }, flags: {} };
	function fightingOn(marks) {
		const actor = about({ deathsDoor: DEATHS_DOOR_STATE.DYING, "moves.backgroundChoices": { Unstoppable: marks } }, 0);
		actor.items = [unstoppable];
		return actor;
	}
	function heal(actor, hp, changes = {}) {
		const options = {};
		Object.assign(changes, { system: { attributes: { hp: { value: hp } } } });
		onPreUpdateActorDeathsDoor(actor, changes, options);
		return { changes, options };
	}

	it("keeps them at 0 HP and dying, clears a mark, and stamps what they would have had", () => {
		const { changes, options } = heal(fightingOn(3), 4);
		expect(changes.system.attributes.hp.value).toBe(0);
		expect(changes.flags["stonetop-pwd"].moves.backgroundChoices.Unstoppable).toBe(2);
		// No state change written: they are still dying, still fighting.
		expect(changes.flags["stonetop-pwd"].deathsDoor).toBeUndefined();
		expect(options[UNSTOPPABLE_INSTEAD_OPTION]).toEqual({ hp: 4, marks: 2 });
	});

	it("lets the hit points through with no mark left to clear", () => {
		const { changes } = heal(fightingOn(0), 4);
		expect(changes.system.attributes.hp.value).toBe(4);
		expect(changes.flags["stonetop-pwd"].deathsDoor).toBeNull();
	});

	it("leaves the write that settles the Door alone (Death's Door's 1 HP)", () => {
		const { changes, options } = heal(fightingOn(3), 1, { flags: { "stonetop-pwd": { deathsDoor: null } } });
		expect(changes.system.attributes.hp.value).toBe(1);
		expect(options[UNSTOPPABLE_INSTEAD_OPTION]).toBeUndefined();
	});

	it("lets through the write that takes the hit points back after all", () => {
		const actor = fightingOn(3);
		const changes = { system: { attributes: { hp: { value: 4 } } } };
		onPreUpdateActorDeathsDoor(actor, changes, { [UNSTOPPABLE_REGAIN_OPTION]: true });
		expect(changes.system.attributes.hp.value).toBe(4);
	});
});

/**
 * The Heavy's Battle Joy lasts "as long as you keep fighting", and one who drops to 0 HP has stopped
 * (the user's ruling): the write that makes them dying ends it, with no roll, so the Death's Door roll
 * takes their debilities. Unless Unstoppable keeps them fighting at 0.
 */
describe("onPreUpdateActorDeathsDoor: a raging Heavy dropping to 0 HP", () => {
	function raging({ unstoppable = false, hp = 5, state = null } = {}) {
		const actor = about({ battleJoy: true, ...(state ? { deathsDoor: state } : {}) }, hp);
		actor.items = unstoppable ? [{ type: "move", name: "Unstoppable", system: {}, flags: {} }] : [];
		return actor;
	}
	function drop(actor, hp = 0) {
		const options = {};
		const changes = { system: { attributes: { hp: { value: hp } } } };
		onPreUpdateActorDeathsDoor(actor, changes, options);
		return { bag: changes.flags?.["stonetop-pwd"] ?? {}, options };
	}

	it("ends the Battle Joy in the same write, and stamps it for the chat line", () => {
		const { bag, options } = drop(raging());
		expect(bag.deathsDoor).toBe(DEATHS_DOOR_STATE.DYING);
		expect(bag).toHaveProperty(["-=battleJoy"], null);
		expect(options[BATTLE_JOY_DROPPED_OPTION]).toBe(true);
	});

	it("leaves it on for a Heavy whose Unstoppable keeps them fighting at 0", () => {
		const { bag, options } = drop(raging({ unstoppable: true }));
		expect(bag.deathsDoor).toBe(DEATHS_DOOR_STATE.DYING);
		expect(bag).not.toHaveProperty(["-=battleJoy"]);
		expect(options[BATTLE_JOY_DROPPED_OPTION]).toBeUndefined();
	});

	it("touches nothing on a hit that leaves them standing, or on a calm Heavy", () => {
		expect(drop(raging(), 3).options[BATTLE_JOY_DROPPED_OPTION]).toBeUndefined();
		const calm = about({}, 5);
		calm.items = [];
		const { bag, options } = drop(calm);
		expect(bag).not.toHaveProperty(["-=battleJoy"]);
		expect(options[BATTLE_JOY_DROPPED_OPTION]).toBeUndefined();
	});
});

/**
 * A Death's Door roll in progress (DEATHS_DOOR_ROLLING_FLAG) belongs to one brush with death. One left behind
 * by a write that failed must not tell the NEXT visit that somebody is already rolling, or hand a Take over its
 * old card; so the write that moves the state by hit points drops it.
 */
describe("onPreUpdateActorDeathsDoor: a Death's Door roll left on the sheet", () => {
	const MARKER = { userId: "p1", userName: "Aline", nonce: "n1", at: 1, messageId: "m1", total: 8, tier: "partial" };
	function hit(flags, oldHp, newHp) {
		const changes = { system: { attributes: { hp: { value: newHp } } } };
		onPreUpdateActorDeathsDoor(about(flags, oldHp), changes, {});
		return changes.flags?.["stonetop-pwd"] ?? {};
	}

	it("is dropped by the write that makes them dying afresh", () => {
		const bag = hit({ deathsDoorRolling: MARKER }, 5, 0);
		expect(bag.deathsDoor).toBe(DEATHS_DOOR_STATE.DYING);
		expect(bag).toHaveProperty(["-=deathsDoorRolling"], null);
	});

	it("is dropped by the hit point that brings them back up (the 10+'s own, or a heal)", () => {
		const bag = hit({ deathsDoor: DEATHS_DOOR_STATE.DYING, deathsDoorRolling: MARKER }, 0, 1);
		expect(bag.deathsDoor).toBeNull();
		expect(bag).toHaveProperty(["-=deathsDoorRolling"], null);
	});

	it("stands through a hit that moves no state: the roll is still under way", () => {
		const bag = hit({ deathsDoor: DEATHS_DOOR_STATE.DYING, deathsDoorRolling: MARKER }, 0, 0);
		expect(bag).not.toHaveProperty(["-=deathsDoorRolling"]);
		// And nothing to drop is never written as a deletion.
		expect(hit({}, 5, 0)).not.toHaveProperty(["-=deathsDoorRolling"]);
	});

	// Audit DD-5: a Hard to Kill trade the last brush's 7-9 left open belongs to that brush. Going down afresh drops
	// it, so a later out-of-the-action that no 7-9 opened (a GM's "not lethal", an insert taken) never offers it.
	it("drops a Hard to Kill trade the last brush left open, on going down afresh", () => {
		const bag = hit({ hardToKillTrade: true }, 5, 0);
		expect(bag.deathsDoor).toBe(DEATHS_DOOR_STATE.DYING);
		expect(bag).toHaveProperty(["-=hardToKillTrade"], null);
		// Not on the hit point that ends a brush: the trade is still that brush's to make.
		expect(hit({ deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION, hardToKillTrade: true }, 0, 1))
			.not.toHaveProperty(["-=hardToKillTrade"]);
	});
});

/**
 * The raise prompt. `dead` is the one state with no automatic way out ("only the rarest of magic
 * can bring them back"), and a GM playing out a resurrection looks exactly like a GM fixing a typo
 * in the HP box — so the pair of hooks recognises the moment and asks whoever made the change.
 */
describe("onUpdateActorDeathsDoorRaised — asking whether they are back", () => {
	/** Stand in for core's Dialog, answering with whichever button the case wants pressed. */
	function stubDialog(press = "yes") {
		const opened = [];
		global.Dialog = class {
			constructor(data) { opened.push(data); this._data = data; }
			render() { this._data.buttons[press]?.callback?.(); return this; }
		};
		return opened;
	}

	it("asks the user who made the change, and clears the state on yes", async () => {
		const actor = about({ deathsDoor: DEATHS_DOOR_STATE.DEAD }, 0);
		actor.name = "Brakkos";
		actor.unsetFlag = vi.fn(async () => {});
		global.game.user = { id: "me" };
		global.game.i18n = { localize: k => k, format: (k, d) => `${k}:${d.name}` };
		global.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
		const opened = stubDialog("yes");

		applyHp(actor, 5);
		await Promise.resolve();

		expect(opened).toHaveLength(1);
		expect(opened[0].title).toContain("Brakkos");
		expect(actor.unsetFlag).toHaveBeenCalledWith("stonetop-pwd", "deathsDoor");
	});

	// "No" writes nothing at all: the hit points stay where the GM put them, and the only thing
	// this question ever settles is whether the sheet still says they are dead.
	it("leaves them dead on no", async () => {
		const actor = about({ deathsDoor: DEATHS_DOOR_STATE.DEAD }, 0);
		actor.unsetFlag = vi.fn(async () => {});
		global.game.user = { id: "me" };
		global.game.i18n = { localize: k => k, format: k => k };
		stubDialog("no");

		applyHp(actor, 5);
		await Promise.resolve();

		expect(actor.unsetFlag).not.toHaveBeenCalled();
	});

	// updateActor fires on EVERY connected client. Without this the whole table gets the question.
	it("stays quiet on every client but the one that made the change", () => {
		const actor = about({ deathsDoor: DEATHS_DOOR_STATE.DEAD }, 0);
		actor.unsetFlag = vi.fn(async () => {});
		global.game.user = { id: "someone-else" };
		const opened = stubDialog("yes");

		applyHp(actor, 5, { userId: "me" });

		expect(opened).toHaveLength(0);
	});

	// The stamp is what makes it a transition. A later write finds them already up, so there is
	// nothing to ask about and the question must not come back.
	it("asks once, on the write that raises them", () => {
		const actor = about({ deathsDoor: DEATHS_DOOR_STATE.DEAD }, 4);
		global.game.user = { id: "me" };
		const opened = stubDialog("no");

		const options = applyHp(actor, 6);

		expect(options[RAISED_OPTION]).toBeUndefined();
		expect(opened).toHaveLength(0);
	});

	it("says nothing about a living character being healed", () => {
		const actor = about({}, 0);
		global.game.user = { id: "me" };
		const opened = stubDialog("yes");

		applyHp(actor, 5);

		expect(opened).toHaveLength(0);
	});

	/**
	 * The `Dead` tag on the sheet is the other way in, for a table that plays the resurrection out
	 * before touching anyone's hit points. Same question, same write — only the one sentence about
	 * HP differs, and saying it on a sheet still sitting at 0 would be a lie.
	 */
	describe("the two ways in", () => {
		function content(opts) {
			const actor = about({ deathsDoor: DEATHS_DOOR_STATE.DEAD }, 0);
			actor.unsetFlag = vi.fn(async () => {});
			global.game.i18n = { localize: k => k, format: (k, d) => `${k}:${d.name}` };
			const opened = stubDialog("no");
			promptRaiseFromDead(actor, opts);
			return opened[0].content;
		}

		it("mentions the hit points when that is what raised the question", () => {
			expect(content({ fromHp: true })).toContain("raiseHpNote");
		});

		it("leaves them out when the tag was clicked", () => {
			expect(content()).not.toContain("raiseHpNote");
		});
	});
});
