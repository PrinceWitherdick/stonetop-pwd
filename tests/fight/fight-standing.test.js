import { describe, it, expect } from "vitest";
import { fightStanding } from "../../module/fight/fight-state.js";
import { atZeroOf } from "../../module/fight/fight-sides.js";
import { attackerDowned } from "../../module/combat/attack-flow.js";
import { offersBattleJoy } from "../../module/combat/battle-joy-offer.js";
import { followerIsDown } from "../../module/fight/follower-order-attack.js";
import { duringLastMove } from "../../module/fight/in-battle.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// ONE reading of who is down or out, for the fight's bodies, the attack caution, a frozen target and Battle Joy.

function hero({ hp = 10, max = 18, flags = {}, moves = [] } = {}) {
	const actor = {
		id: "vahid", name: "Vahid", type: "character", isOwner: true,
		system: { attributes: { hp: { value: hp, max } } },
		items: moves.map(name => ({ type: "move", name, flags: {} })),
		flags: { [SYSTEM_ID]: flags },
		getFlag: (scope, key) => actor.flags[scope]?.[key],
	};
	return actor;
}

describe("atZeroOf", () => {
	it("is 0 of a real pool only", () => {
		expect(atZeroOf({ value: 0, max: 6 })).toBe(true);
		expect(atZeroOf({ value: -2, max: 6 })).toBe(true);
		expect(atZeroOf({ value: 1, max: 6 })).toBe(false);
		expect(atZeroOf({ value: 0, max: 0 })).toBe(false);
		expect(atZeroOf({ max: 6 })).toBe(false);
		expect(atZeroOf(null)).toBe(false);
	});

	it("is what a follower card reads", () => {
		expect(followerIsDown({ hp: { value: 0, max: 6 } })).toBe(true);
		expect(followerIsDown({ hp: { value: 0, max: 0 } })).toBe(false);
	});
});

describe("fightStanding", () => {
	it("reads a character at 0 HP as down, and fighting on on their last move", async () => {
		const actor = hero({ hp: 0, flags: { deathsDoor: "fate-pending" } });
		expect(fightStanding(actor)).toMatchObject({ atZero: true, down: true, atLastDoor: true, doorOut: true, onTheirFeet: false });
		await duringLastMove(actor, () => {
			expect(fightStanding(actor)).toMatchObject({ lastMove: true, fightingOn: true, down: false });
		});
	});

	it("reads a monster at 0 HP as down and never at the door", () => {
		const foe = { type: "monster", system: { attributes: { hp: { value: 0, max: 8 } } } };
		expect(fightStanding(foe)).toMatchObject({ down: true, doorOut: false, onTheirFeet: false, doorState: null });
	});

	it("is never thrown by a missing actor", () => {
		expect(fightStanding(null)).toMatchObject({ down: false, doorOut: false, onTheirFeet: false });
	});

	it("never throws where the foundry global is absent, and still reads a post-death insert", () => {
		const real = globalThis.foundry;
		delete globalThis.foundry;
		try {
			const revenant = hero({ hp: 5, flags: { postDeathInsert: { slug: "revenant" } } });
			expect(fightStanding(revenant)).toMatchObject({ onTheirFeet: false, down: false });
			expect(fightStanding({ type: "monster", system: { attributes: { hp: { value: 0, max: 8 } } } })).toMatchObject({ down: true });
		} finally {
			globalThis.foundry = real;
		}
	});
});

describe("a fate pending that a post-death insert has answered reads the same everywhere", () => {
	// Came back as a Revenant: the Last Door is behind them, so the door no longer holds them out of the fight,
	// and at 0 HP they are down like anyone else (the striking caution no longer reads the raw fate-pending flag).
	const revenant = (hp) => hero({ hp, flags: { deathsDoor: "fate-pending", postDeathInsert: { slug: "revenant" } } });

	it("is not out at the door", () => {
		expect(fightStanding(revenant(5)).doorOut).toBe(false);
		expect(fightStanding(revenant(5))).toMatchObject({ doorState: null, atLastDoor: false });
	});

	it("is cautioned striking at 0 HP, as the fight counts them out", () => {
		expect(attackerDowned(revenant(0))).toBe(true);
		expect(fightStanding(revenant(0)).down).toBe(true);
	});

	it("is a fate still pending without the insert: out of the fight, and its last move not cautioned", () => {
		const pending = hero({ hp: 0, flags: { deathsDoor: "fate-pending" } });
		expect(fightStanding(pending).doorOut).toBe(true);
		expect(attackerDowned(pending)).toBe(false);
	});

	it("never asks Battle Joy of the dead come back", () => {
		expect(offersBattleJoy(hero({ moves: ["Battle Joy"], flags: { postDeathInsert: { slug: "revenant" } } }), [3])).toBe(false);
		expect(offersBattleJoy(hero({ moves: ["Battle Joy"] }), [3])).toBe(true);
	});
});
