// The Heavy's Unstoppable: "When you are reduced to 0 HP in battle, you can keep fighting. Each time
// you take damage while at 0 HP, mark 1. If you would regain HP while fighting, clear one mark
// instead." (the playbook sheet). The predicates every seam asks, on a live character.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { stubConfirm } from "../../fakes/confirm.js";
import {
	UNSTOPPABLE_INSTEAD_OPTION,
	UNSTOPPABLE_REGAIN_OPTION,
	downOnUnstoppable,
	fightsOnWhenDropped,
	keepsFightingAtZero,
	markUnstoppable,
	onUpdateActorUnstoppable,
	regainInstead,
	stopFightingUpdate,
	unstoppableMarks,
} from "../../../module/actors/character/unstoppable.js";
import { DEATHS_DOOR_STATE } from "../../../module/actors/character/deaths-door.js";

const TRACK = "flags.stonetop-pwd.moves.backgroundChoices.Unstoppable";

// "When you are reduced to 0 HP IN BATTLE": read at the drop, which stamps `unstoppableFighting` (the HP write's
// preUpdate, tests/hooks/DeathsDoorPromptState.test.js). Each Heavy below carries that stamp unless
// `fighting: false`, and stands in a combat NOW unless `inBattle: false`; the two are separate on purpose.
let savedCombats;
beforeEach(() => { savedCombats = globalThis.game.combats; });
afterEach(() => { globalThis.game.combats = savedCombats; });

/** A Heavy with Unstoppable, down at `hp` in `state`, with `marks` circles marked, stamped and in a fight unless told not. */
function heavy({ hp = 0, state = DEATHS_DOOR_STATE.DYING, marks = 0, learned = true, insert = null, inBattle = true, fighting = true } = {}) {
	const def = sourceMovesFor("The Heavy").find(d => d.name === "Unstoppable");
	const unstoppable = makeLiveItem({
		name: "Unstoppable", type: "move", system: structuredClone(def.system),
		flags: learned ? {} : { "stonetop-pwd": { learned: false } },
	});
	const flags = {};
	if (state) flags.deathsDoor = state;
	if (marks) flags["moves.backgroundChoices"] = { Unstoppable: marks };
	if (insert) flags["postDeathInsert.slug"] = insert;
	if (fighting) flags.unstoppableFighting = true;
	const built = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", items: [unstoppable], flags });
	built.actor.system.attributes.hp = { value: hp, max: 20 };
	built.actor.id = "heavy-1";
	globalThis.game.combats = inBattle ? [{ combatants: [{ actorId: built.actor.id }] }] : [];
	return built.actor;
}

describe("keepsFightingAtZero", () => {
	it("is a Heavy with Unstoppable at 0 HP who has not rolled Death's Door yet", () => {
		expect(keepsFightingAtZero(heavy())).toBe(true);
	});

	it("is nobody with HP left", () => {
		expect(keepsFightingAtZero(heavy({ hp: 3 }))).toBe(false);
	});

	it("is nobody who has rolled: rolling is when they stopped fighting", () => {
		for (const state of [null, DEATHS_DOOR_STATE.OUT_OF_ACTION, DEATHS_DOOR_STATE.FATE_PENDING, DEATHS_DOOR_STATE.DEAD]) {
			expect(keepsFightingAtZero(heavy({ state }))).toBe(false);
		}
	});

	it("is nobody whose Unstoppable is switched off", () => {
		expect(keepsFightingAtZero(heavy({ learned: false }))).toBe(false);
	});

	// "When you are reduced to 0 HP in battle" (Book I p.114), read AT THE DROP: a Heavy who dropped with no fight
	// running (a fall, a trap) has no stamp, and a combat started round them since does not make them fight on.
	// downOnUnstoppable is the same test without the stamp, for clearing the circles on a not-lethal ruling.
	it("is nobody who dropped outside battle, even once a fight is running round them", () => {
		const actor = heavy({ fighting: false, inBattle: true });
		expect(keepsFightingAtZero(actor)).toBe(false);
		expect(downOnUnstoppable(actor)).toBe(true);
		expect(regainInstead(heavy({ marks: 3, fighting: false }), { oldHp: 0, newHp: 4 })).toBeNull();
	});

	// The stamp outlives the combat: by deleteCombat the fight is gone from the world, and the fight's end is
	// what hands them the Door (combat/battle-joy-offer.js#actionStops).
	it("is one who dropped in battle, after the combat itself is gone", () => {
		expect(keepsFightingAtZero(heavy({ fighting: true, inBattle: false }))).toBe(true);
	});

	// The drop's own question is asked of the world as it is at the drop.
	it("asks at the drop whether they stand in a fight, by actor id, from a linked token's combatant too", () => {
		const actor = heavy({ hp: 5, state: null, fighting: false, inBattle: false });
		expect(fightsOnWhenDropped(actor)).toBe(false);
		expect(fightsOnWhenDropped(actor, { combats: [{ combatants: [{ actor: { id: actor.id } }] }] })).toBe(true);
		expect(fightsOnWhenDropped(actor, { combats: [{ combatants: [{ actorId: "someone-else" }] }] })).toBe(false);
		expect(fightsOnWhenDropped(heavy({ hp: 5, state: null, learned: false }))).toBe(false);
	});

	it("lifts the stamp with stopFightingUpdate, and asks nothing when none is laid", () => {
		expect(stopFightingUpdate(heavy())).toEqual({ "flags.stonetop-pwd.-=unstoppableFighting": null });
		expect(stopFightingUpdate(heavy({ fighting: false }))).toEqual({});
	});

	it("is nobody whose 0-HP move is an insert's rather than Death's Door", () => {
		expect(keepsFightingAtZero(heavy({ insert: "revenant" }))).toBe(false);
	});

	it("is nobody without the move", () => {
		const { actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", flags: { deathsDoor: DEATHS_DOOR_STATE.DYING } });
		actor.system.attributes.hp = { value: 0, max: 20 };
		expect(keepsFightingAtZero(actor)).toBe(false);
	});
});

describe("markUnstoppable: each time you take damage while at 0 HP, mark 1", () => {
	it("marks one more circle", async () => {
		const actor = heavy({ marks: 2 });
		expect(await markUnstoppable(actor)).toEqual({ marks: 3, max: 5, full: false });
		expect(unstoppableMarks(actor)).toBe(3);
	});

	it("writes nothing with every circle already marked, and says so", async () => {
		const actor = heavy({ marks: 5 });
		actor.update.mockClear();
		expect(await markUnstoppable(actor)).toEqual({ marks: 5, max: 5, full: true });
		expect(actor.update).not.toHaveBeenCalled();
	});
});

describe("regainInstead: if you would regain HP while fighting, clear one mark instead", () => {
	it("keeps the hit points and clears a mark in their place", () => {
		const instead = regainInstead(heavy({ marks: 3 }), { oldHp: 0, newHp: 4 });
		expect(instead).toEqual({ hp: 4, marks: 2, update: { [TRACK]: 2 } });
	});

	it("lets the hit points through with no mark to clear", () => {
		expect(regainInstead(heavy({ marks: 0 }), { oldHp: 0, newHp: 4 })).toBeNull();
	});

	it("is not a write that takes hit points away", () => {
		expect(regainInstead(heavy({ marks: 3 }), { oldHp: 0, newHp: 0 })).toBeNull();
	});

	it("is nobody who is not fighting on at 0 HP", () => {
		expect(regainInstead(heavy({ marks: 3, state: DEATHS_DOOR_STATE.OUT_OF_ACTION }), { oldHp: 0, newHp: 4 })).toBeNull();
		expect(regainInstead(heavy({ marks: 3, learned: false }), { oldHp: 0, newHp: 4 })).toBeNull();
	});
});

describe("onUpdateActorUnstoppable: the hit points offered back", () => {
	let posted;
	let user;
	beforeEach(() => {
		posted = [];
		user = globalThis.game.user;
		globalThis.ChatMessage = { create: vi.fn(async d => posted.push(d)), getSpeaker: () => ({}) };
		globalThis.game.user = { id: "me" };
	});
	afterEach(() => { delete globalThis.ChatMessage; delete globalThis.foundry.applications; globalThis.game.user = user; });

	it("keeps the book's way by default, and says so", async () => {
		const actor = heavy({ marks: 2 });
		actor.update.mockClear();
		const wait = stubConfirm(true);
		await onUpdateActorUnstoppable(actor, {}, { [UNSTOPPABLE_INSTEAD_OPTION]: { hp: 4, marks: 2 } }, "me");
		expect(wait).toHaveBeenCalledTimes(1);
		expect(actor.update).not.toHaveBeenCalled();
		expect(posted.at(-1).content).toContain("clears one Unstoppable mark instead");
	});

	it("gives the hit points back and restores the mark when the table says so", async () => {
		const actor = heavy({ marks: 2 });
		stubConfirm(false);
		await onUpdateActorUnstoppable(actor, {}, { [UNSTOPPABLE_INSTEAD_OPTION]: { hp: 4, marks: 2 } }, "me");
		const [changes, options] = actor.update.mock.calls.at(-1);
		expect(changes).toEqual({ "system.attributes.hp.value": 4, [TRACK]: 3 });
		expect(options[UNSTOPPABLE_REGAIN_OPTION]).toBe(true);
	});

	it("asks only whoever made the change", async () => {
		const wait = stubConfirm(true);
		await onUpdateActorUnstoppable(heavy({ marks: 2 }), {}, { [UNSTOPPABLE_INSTEAD_OPTION]: { hp: 4, marks: 2 } }, "someone-else");
		expect(wait).not.toHaveBeenCalled();
	});
});
