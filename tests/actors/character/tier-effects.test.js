import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	settleTierEffects, recordTierEffects, reconcileTierEffects, TIER_EFFECTS_FLAG, TIER_EFFECT_MOVES, SILVER_TONGUED,
} from "../../../module/actors/character/tier-effects.js";
import { FIGHT_STATES, fightStateOn, WE_HAPPY_FEW } from "../../../module/actors/character/fight-states.js";
import { PREPARE_A_WELCOME } from "../../../module/combat/battle-holds.js";
import { COMMUNE_WITH_ARATIS } from "../../../module/actors/character/roll-boosts.js";
import { LUMINOUS_SHIELD, WIELDER_OF_THE_WHITE_FLAME } from "../../../module/actors/character/holy-light.js";
import { DEFEND_MOVE, readinessForTier } from "../../../module/combat/defend-readiness.js";
import { StonetopCharacter } from "../../../module/actors/character/StonetopCharacter.js";
import { messageOfRoll } from "../../../module/utils/roll-engine.js";
import { SYSTEM_ID } from "../../../module/system-id.js";
import { ROLLED_FLAG, rolledRecord } from "../../../module/utils/counted-tier.js";

// What a roll's tier does to its roller, kept in step with the card when its tier moves after the dice (a
// GM's Shift, a +1 pressed on it). Each case rolls one tier, records what it did on a card, then moves the
// card's total and checks the character followed, undoing only what that card did.

/** A character with the moves named, their tracks (`max` pips each, 2 unless given, counting what is HELD) and their flags. */
function hero({ moves = [], held = {}, nerves = false, isOwner = true, max = 2 } = {}) {
	const tracks = { ...held };
	const bag = nerves ? { [FIGHT_STATES.nerves.flag]: true } : {};
	const actor = {
		id: "h", name: "Hale", type: "character", isOwner,
		items: moves.map(name => ({ type: "move", name, flags: {}, system: { resource: { max, title: "Hold" } } })),
		flags: { [SYSTEM_ID]: bag },
		getFlag: (scope, path) => path.split(".").reduce((v, k) => v?.[k], actor.flags[scope]),
		setFlag: vi.fn(async (scope, key, value) => { actor.flags[scope][key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete actor.flags[scope][key]; }),
		typedActor: {
			moveResources: {
				getMoveResources: () => tracks,
				setUses: vi.fn(async (move, value) => { tracks[move] = value; }),
			},
		},
	};
	return { actor, tracks };
}

/** A roll card for `move`, its flags read and written as Foundry's are. */
function card(move) {
	const flags = { [SYSTEM_ID]: { move } };
	return {
		flags,
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { flags[scope][key] = value; }),
	};
}

/** Roll `move` at `tier` for `actor`, and put what it did on a fresh card, as onRoll does. */
async function rolled(actor, move, tier, options = {}) {
	const message = card(move);
	await recordTierEffects(message, await settleTierEffects(actor, move, tier, null, options));
	return message;
}

const shift = (message, actor, total) => reconcileTierEffects(message, total, { actor });

let saved;
let posted;
beforeEach(() => {
	saved = globalThis.ChatMessage;
	posted = [];
	globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: ({ actor }) => ({ alias: actor.name }) };
});
afterEach(() => { globalThis.ChatMessage = saved; });

describe("We Happy Few's nerves", () => {
	it("steady again when a 6- is lifted to a 7+, and shake when a 7+ is lowered to a 6-", async () => {
		const { actor } = hero({ moves: [WE_HAPPY_FEW] });
		const miss = await rolled(actor, WE_HAPPY_FEW, "failure");
		expect(fightStateOn(actor, "nerves")).toBe(true);
		expect(miss.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ nerves: true });

		expect(await shift(miss, actor, 7)).toBe(true);
		expect(fightStateOn(actor, "nerves")).toBe(false);
		expect(miss.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ nerves: false });

		// And back down again: the card is a miss once more.
		await shift(miss, actor, 6);
		expect(fightStateOn(actor, "nerves")).toBe(true);
	});

	it("shake when a hit is lowered to a miss", async () => {
		const { actor } = hero({ moves: [WE_HAPPY_FEW] });
		const hit = await rolled(actor, WE_HAPPY_FEW, "partial");
		expect(fightStateOn(actor, "nerves")).toBe(false);
		await shift(hit, actor, 6);
		expect(fightStateOn(actor, "nerves")).toBe(true);
		expect(posted.at(-1).content).toContain("nagging doubts");
	});

	it("stay shaken when they were before the roll: the lift undoes only what this card did", async () => {
		const { actor } = hero({ moves: [WE_HAPPY_FEW], nerves: true });
		const miss = await rolled(actor, WE_HAPPY_FEW, "failure");
		expect(miss.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ nerves: false });
		await shift(miss, actor, 8);
		expect(fightStateOn(actor, "nerves")).toBe(true);
	});
});

describe("Prepare a Welcome's Surprise", () => {
	// The track as it stands AFTER the roll's own spend (StonetopCharacter#onRoll takes it before the dice).
	const spent = { surpriseSpent: true };

	it("is regained when a 9 is lifted to a 10, and taken back when lowered again", async () => {
		const { actor, tracks } = hero({ moves: [PREPARE_A_WELCOME], held: { [PREPARE_A_WELCOME]: 1 } });
		const partial = await rolled(actor, PREPARE_A_WELCOME, "partial", spent);
		expect(tracks[PREPARE_A_WELCOME]).toBe(1);
		await shift(partial, actor, 10);
		expect(tracks[PREPARE_A_WELCOME]).toBe(2);
		expect(partial.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ surpriseRegained: { spent: true, regained: 1 } });
		await shift(partial, actor, 9);
		expect(tracks[PREPARE_A_WELCOME]).toBe(1);
	});

	it("regained on a 10+ goes back when the card is lowered, never below none", async () => {
		const { actor, tracks } = hero({ moves: [PREPARE_A_WELCOME], held: { [PREPARE_A_WELCOME]: 0 } });
		const hit = await rolled(actor, PREPARE_A_WELCOME, "success", spent);
		expect(tracks[PREPARE_A_WELCOME]).toBe(1);
		// Spent since, on another roll: nothing left to take back.
		tracks[PREPARE_A_WELCOME] = 0;
		await shift(hit, actor, 8);
		expect(tracks[PREPARE_A_WELCOME]).toBe(0);
	});

	it("takes nothing back that a full track never gave", async () => {
		const { actor, tracks } = hero({ moves: [PREPARE_A_WELCOME], held: { [PREPARE_A_WELCOME]: 2 } });
		const hit = await rolled(actor, PREPARE_A_WELCOME, "success", spent);
		expect(hit.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ surpriseRegained: { spent: true, regained: 0 } });
		await shift(hit, actor, 9);
		expect(tracks[PREPARE_A_WELCOME]).toBe(2);
	});

	// Marshal re-audit (2026-10-18): "spend 1 Surprise ... on a 10+ ... regain 1 Surprise". A roll made holding
	// none (allowed: the card says "No Surprise held to spend") spent nothing, so its 10+ makes none from nothing.
	it("regains none on a 10+ of a roll that spent none, however its tier moves", async () => {
		const { actor, tracks } = hero({ moves: [PREPARE_A_WELCOME], held: { [PREPARE_A_WELCOME]: 0 } });
		const hit = await rolled(actor, PREPARE_A_WELCOME, "success", { surpriseSpent: false });
		expect(tracks[PREPARE_A_WELCOME]).toBe(0);
		expect(hit.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ surpriseRegained: { spent: false, regained: 0 } });
		const partial = await rolled(actor, PREPARE_A_WELCOME, "partial");
		await shift(partial, actor, 11);
		expect(tracks[PREPARE_A_WELCOME]).toBe(0);
		await shift(hit, actor, 8);
		await shift(hit, actor, 12);
		expect(tracks[PREPARE_A_WELCOME]).toBe(0);
	});

	it("reads a card from before the spend was kept as having spent one", async () => {
		const { actor, tracks } = hero({ moves: [PREPARE_A_WELCOME], held: { [PREPARE_A_WELCOME]: 1 } });
		const old = card(PREPARE_A_WELCOME);
		old.flags[SYSTEM_ID][TIER_EFFECTS_FLAG] = { surpriseRegained: 1 };
		await shift(old, actor, 8);
		expect(tracks[PREPARE_A_WELCOME]).toBe(0);
		expect(old.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ surpriseRegained: { spent: true, regained: 0 } });
		await shift(old, actor, 10);
		expect(tracks[PREPARE_A_WELCOME]).toBe(1);
	});
});

describe("Commune with Aratis's Sanction", () => {
	it("fills when a 7-9 is lifted to a 10+, and empties what it filled when lowered", async () => {
		const { actor, tracks } = hero({ moves: [COMMUNE_WITH_ARATIS], held: { [COMMUNE_WITH_ARATIS]: 0 } });
		const partial = await rolled(actor, COMMUNE_WITH_ARATIS, "partial");
		expect(tracks[COMMUNE_WITH_ARATIS]).toBe(0);
		await shift(partial, actor, 10);
		expect(tracks[COMMUNE_WITH_ARATIS]).toBe(2);
		expect(partial.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ sanctionFilled: 2 });
		await shift(partial, actor, 9);
		expect(tracks[COMMUNE_WITH_ARATIS]).toBe(0);
	});

	it("takes back only what it filled, keeping Sanction held before the roll", async () => {
		const { actor, tracks } = hero({ moves: [COMMUNE_WITH_ARATIS], held: { [COMMUNE_WITH_ARATIS]: 1 } });
		const hit = await rolled(actor, COMMUNE_WITH_ARATIS, "success");
		expect(tracks[COMMUNE_WITH_ARATIS]).toBe(2);
		await shift(hit, actor, 9);
		expect(tracks[COMMUNE_WITH_ARATIS]).toBe(1);
	});
});

// The Fox's Silver Tongued: "on a 10+, hold 3 Nerve; on a 7-9, hold 1 Nerve", on its ○○○ track. "Hold N" is
// "you now hold N": never lowered by the roll, never past the track's max.
describe("Silver Tongued's Nerve", () => {
	const fox = held => hero({ moves: [SILVER_TONGUED], held: { [SILVER_TONGUED]: held }, max: 3 });

	it("is a move whose tier does something to the roller", () => {
		expect(TIER_EFFECT_MOVES).toContain(SILVER_TONGUED);
	});

	it("fills to 3 on a 10+ and to 1 on a 7-9, and holds nothing more on a 6-", async () => {
		const hit = fox(0);
		const card10 = await rolled(hit.actor, SILVER_TONGUED, "success");
		expect(hit.tracks[SILVER_TONGUED]).toBe(3);
		expect(card10.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ nerveHeld: 3 });

		const partial = fox(0);
		await rolled(partial.actor, SILVER_TONGUED, "partial");
		expect(partial.tracks[SILVER_TONGUED]).toBe(1);

		const miss = fox(1);
		const card6 = await rolled(miss.actor, SILVER_TONGUED, "failure");
		expect(miss.tracks[SILVER_TONGUED]).toBe(1);
		// Still recorded, so a Shift up off the 6- can hold what the new tier asks.
		expect(card6.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ nerveHeld: 0 });
	});

	it("does not lower 3 Nerve already held on a 7-9, nor take any of it back when the card is lowered", async () => {
		const { actor, tracks } = fox(3);
		const partial = await rolled(actor, SILVER_TONGUED, "partial");
		expect(tracks[SILVER_TONGUED]).toBe(3);
		expect(actor.typedActor.moveResources.setUses).not.toHaveBeenCalled();
		await shift(partial, actor, 5);
		expect(tracks[SILVER_TONGUED]).toBe(3);
	});

	it("tops up 1 held to 3 on a 10+, and takes back only the 2 it added", async () => {
		const { actor, tracks } = fox(1);
		const hit = await rolled(actor, SILVER_TONGUED, "success");
		expect(tracks[SILVER_TONGUED]).toBe(3);
		expect(hit.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ nerveHeld: 2 });
		await shift(hit, actor, 6);
		expect(tracks[SILVER_TONGUED]).toBe(1);
	});

	it("adds 2 more when a 7-9 is rewritten to a 10+, and the 10+ moved to a 6- takes back all it added", async () => {
		const { actor, tracks } = fox(0);
		const card = await rolled(actor, SILVER_TONGUED, "partial");
		expect(tracks[SILVER_TONGUED]).toBe(1);
		await shift(card, actor, 10);
		expect(tracks[SILVER_TONGUED]).toBe(3);
		expect(card.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ nerveHeld: 3 });
		await shift(card, actor, 6);
		expect(tracks[SILVER_TONGUED]).toBe(0);
		expect(card.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ nerveHeld: 0 });
	});

	it("leaves Nerve spent since spent when the card is lowered, and lifts by the difference again", async () => {
		const { actor, tracks } = fox(0);
		const hit = await rolled(actor, SILVER_TONGUED, "success");
		tracks[SILVER_TONGUED] = 1; // two spent to move about unchallenged
		await shift(hit, actor, 8);
		// Back by the 2 the 10+ added over the 7-9, never below none.
		expect(tracks[SILVER_TONGUED]).toBe(0);
		await shift(hit, actor, 10);
		expect(tracks[SILVER_TONGUED]).toBe(2);
	});

	it("leaves no trace for a character without Silver Tongued learned", async () => {
		const { actor } = hero({ moves: [] });
		const card = await rolled(actor, SILVER_TONGUED, "success");
		expect(card.setFlag).not.toHaveBeenCalled();
	});
});

describe("reconcileTierEffects", () => {
	it("leaves a card alone that carries no record (rolled before this was kept)", async () => {
		const { actor } = hero({ moves: [WE_HAPPY_FEW] });
		const old = card(WE_HAPPY_FEW);
		expect(await shift(old, actor, 5)).toBe(false);
		expect(fightStateOn(actor, "nerves")).toBe(false);
		expect(old.setFlag).not.toHaveBeenCalled();
	});

	it("writes nothing on a client that cannot write the roller", async () => {
		const { actor } = hero({ moves: [WE_HAPPY_FEW] });
		const miss = await rolled(actor, WE_HAPPY_FEW, "failure");
		actor.isOwner = false;
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await shift(miss, actor, 9)).toBe(false);
		expect(fightStateOn(actor, "nerves")).toBe(true);
		warn.mockRestore();
	});

	it("writes nothing when the tier did not move", async () => {
		const { actor } = hero({ moves: [WE_HAPPY_FEW] });
		const hit = await rolled(actor, WE_HAPPY_FEW, "partial");
		hit.setFlag.mockClear();
		expect(await shift(hit, actor, 9)).toBe(false);
		expect(hit.setFlag).not.toHaveBeenCalled();
	});

	it("records nothing for a move whose tier does nothing to the roller", async () => {
		const { actor } = hero({ moves: ["Clash"] });
		const clash = await rolled(actor, "Clash", "failure");
		expect(clash.setFlag).not.toHaveBeenCalled();
		expect(TIER_EFFECT_MOVES).toEqual(expect.arrayContaining([WE_HAPPY_FEW, PREPARE_A_WELCOME, COMMUNE_WITH_ARATIS, DEFEND_MOVE]));
	});

	it("knows no card for a roll it did not post", () => {
		expect(messageOfRoll({})).toBeNull();
		expect(messageOfRoll(null)).toBeNull();
	});
});

// The two the roll path also settled by tier: Defend's Readiness and the holy light.
describe("Defend's Readiness", () => {
	it("follows the tier by the difference, so Readiness spent since stays spent, never below none", () => {
		// Rolled a 7-9 holding none: holds 1.
		expect(readinessForTier({ prior: 0, hold: 1 })).toEqual({ next: 1, set: 1 });
		// Lifted to a 10+: 3.
		expect(readinessForTier({ prior: 0, set: 1, current: 1, hold: 3 })).toEqual({ next: 3, set: 3 });
		// Lowered from a 10+ after spending 2 of its 3: back by the 2 the 10+ added over the 7-9.
		expect(readinessForTier({ prior: 0, set: 3, current: 1, hold: 1 })).toEqual({ next: 0, set: 1 });
		// A pool held before the roll is never lowered by it.
		expect(readinessForTier({ prior: 2, set: 3, current: 3, hold: 1 })).toEqual({ next: 2, set: 2 });
	});

	it("rises when a 7-9 is lifted to a 10+ and falls back when lowered (the character's own settle)", async () => {
		const self = {
			_actor: { name: "Hale" },
			hasGuardianMove: false,
			defendReadiness: 0,
			bearsShield: async () => false,
			_writeDefendReadiness: vi.fn(async n => { self.defendReadiness = n; }),
		};
		const settle = (tier, done) => StonetopCharacter.prototype.settleDefendReadinessTier.call(self, tier, done);
		const done = await settle("partial");
		expect(self.defendReadiness).toBe(1);
		expect(done).toEqual({ prior: 0, set: 1 });
		const lifted = await settle("success", done);
		expect(self.defendReadiness).toBe(3);
		expect(posted.at(-1).content).toContain("holds <strong>3</strong> Readiness");
		await settle("partial", lifted);
		expect(self.defendReadiness).toBe(1);
	});

	it("is settled through the character", async () => {
		const settle = vi.fn(async (_tier, done) => ({ prior: 0, set: done ? 3 : 1 }));
		const { actor } = hero({ moves: [DEFEND_MOVE] });
		actor.typedActor.settleDefendReadinessTier = settle;
		const defend = await rolled(actor, DEFEND_MOVE, "partial");
		await shift(defend, actor, 11);
		expect(settle.mock.calls).toEqual([["partial", undefined], ["success", { prior: 0, set: 1 }]]);
		expect(defend.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ readiness: { prior: 0, set: 3 } });
	});
});

describe("the holy light", () => {
	/** StonetopCharacter's own settleHolyLightTier, over a light and Invocations kept in plain fields. */
	function lightbearer({ lit = false, invocations = { primary: "", second: "" } } = {}) {
		const self = {
			holyLight: lit,
			invocationState: invocations,
			setHolyLight: vi.fn(async on => {
				const changed = self.holyLight !== on;
				self.holyLight = on;
				if (!on) self.invocationState = { primary: "", second: "" };
				return changed;
			}),
			_settleHolyLightOnRoll: vi.fn(async (item, tier) => self.setHolyLight(item.name === WIELDER_OF_THE_WHITE_FLAME && tier !== "failure")),
			_writeInvocationState: vi.fn(async state => { self.invocationState = state; return true; }),
		};
		return { self, settle: (move, tier, done) => StonetopCharacter.prototype.settleHolyLightTier.call(self, move, tier, done) };
	}

	it("lit by a Wielder's 7+ goes out when the card is lowered to a 6-, and lights when lifted", async () => {
		const { self, settle } = lightbearer();
		const done = await settle(WIELDER_OF_THE_WHITE_FLAME, "partial");
		expect(done).toBe(true);
		expect(self.holyLight).toBe(true);
		expect(await settle(WIELDER_OF_THE_WHITE_FLAME, "failure", done)).toBe(false);
		expect(self.holyLight).toBe(false);
		expect(await settle(WIELDER_OF_THE_WHITE_FLAME, "success", false)).toBe(true);
		expect(self.holyLight).toBe(true);
	});

	it("already burning is left burning when a Wielder's hit is lowered", async () => {
		const { self, settle } = lightbearer({ lit: true });
		const done = await settle(WIELDER_OF_THE_WHITE_FLAME, "success");
		expect(done).toBe(false);
		await settle(WIELDER_OF_THE_WHITE_FLAME, "failure", done);
		expect(self.holyLight).toBe(true);
	});

	it("snuffed by a Luminous Shield 6- is relit with its Invocations when the card is lifted", async () => {
		const running = { primary: "dancing-light", second: "" };
		const { self, settle } = lightbearer({ lit: true, invocations: running });
		const done = await settle(LUMINOUS_SHIELD, "failure");
		expect(self.holyLight).toBe(false);
		expect(done).toEqual({ lit: true, invocations: running });
		expect(await settle(LUMINOUS_SHIELD, "partial", done)).toBe(false);
		expect(self.holyLight).toBe(true);
		expect(self.invocationState).toEqual(running);
	});
});

// Ranger audit M10: Alpha's "on a 10+, you also have advantage on your next roll against them". The 10+
// remembers the foes the roll was aimed at (fight/hero-moves.js#alphaAgainst reads it), and a Shift that
// takes the 10+ away forgets them again; one that lifts a 7-9 to a 10+ remembers them then.
describe("Alpha's foes", () => {
	const wolf = { uuid: "Scene.s.Token.tw", name: "Grey Wolf" };
	const alphaRoll = async (actor, tier, targets) => {
		const message = card("Alpha");
		await recordTierEffects(message, await settleTierEffects(actor, "Alpha", tier, null, { targets }));
		return message;
	};

	it("are remembered on a 10+, forgotten when it is lowered, and remembered again when lifted", async () => {
		const { actor } = hero({ moves: ["Alpha"] });
		const hit = await alphaRoll(actor, "success", [wolf]);
		expect(actor.flags[SYSTEM_ID].alphaOver).toEqual([{ key: wolf.uuid, name: "Grey Wolf" }]);
		expect(hit.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ alphaOver: { foes: [{ key: wolf.uuid, name: "Grey Wolf" }], set: true } });
		await shift(hit, actor, 9);
		expect(actor.flags[SYSTEM_ID].alphaOver).toEqual([]);
		// The card kept who it was aimed at, so a lift needs no targets to remember them by.
		await shift(hit, actor, 10);
		expect(actor.flags[SYSTEM_ID].alphaOver).toEqual([{ key: wolf.uuid, name: "Grey Wolf" }]);
	});

	it("a 7-9 lifted to a 10+ remembers them then", async () => {
		const { actor } = hero({ moves: ["Alpha"] });
		const partial = await alphaRoll(actor, "partial", [wolf]);
		expect(actor.flags[SYSTEM_ID].alphaOver).toBeUndefined();
		await shift(partial, actor, 11);
		expect(actor.flags[SYSTEM_ID].alphaOver).toEqual([{ key: wolf.uuid, name: "Grey Wolf" }]);
	});

	it("an Alpha aimed at nobody leaves no trace, on the character or the card", async () => {
		const { actor } = hero({ moves: ["Alpha"] });
		const hit = await alphaRoll(actor, "success", []);
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(hit.setFlag).not.toHaveBeenCalled();
	});
});

// A card rolled with a bend ("treat a 7-9 as a 10+", Let's Make a Deal; "treat a 6- as a 7-9", Herd of Horses)
// settles the tier it COUNTS as when its total is rewritten, read off the record rollStat stamps on it
// (utils/counted-tier.js#ROLLED_FLAG). A card with no record reads its total as it always has.
describe("a rewritten card that bends its tier", () => {
	const bent = (message, bends) => { message.flags[SYSTEM_ID][ROLLED_FLAG] = rolledRecord("", bends); return message; };
	const deal = { partialCountsAsSuccess: "Let's Make a Deal" };

	it("settles a 6- lifted to a 7 as the 10+ it counts as", async () => {
		const { actor, tracks } = hero({ moves: [PREPARE_A_WELCOME], held: { [PREPARE_A_WELCOME]: 1 } });
		const miss = bent(await rolled(actor, PREPARE_A_WELCOME, "failure", { surpriseSpent: true }), deal);
		await shift(miss, actor, 7);
		expect(tracks[PREPARE_A_WELCOME]).toBe(2);
		expect(miss.getFlag(SYSTEM_ID, TIER_EFFECTS_FLAG)).toEqual({ surpriseRegained: { spent: true, regained: 1 } });
	});

	it("leaves a counted 10+ lifted within the 7-9 where it is, and takes it back below a 7", async () => {
		const { actor, tracks } = hero({ moves: [PREPARE_A_WELCOME], held: { [PREPARE_A_WELCOME]: 0 } });
		const hit = bent(await rolled(actor, PREPARE_A_WELCOME, "success", { surpriseSpent: true }), deal);
		expect(tracks[PREPARE_A_WELCOME]).toBe(1);
		hit.setFlag.mockClear();
		expect(await shift(hit, actor, 9)).toBe(false);
		expect(hit.setFlag).not.toHaveBeenCalled();
		await shift(hit, actor, 6);
		expect(tracks[PREPARE_A_WELCOME]).toBe(0);
	});

	it("keeps the nerves steady on a 6- that counts as a 7-9", async () => {
		const { actor } = hero({ moves: [WE_HAPPY_FEW] });
		const hit = bent(await rolled(actor, WE_HAPPY_FEW, "partial"), { missCountsAsPartial: "Herd of Horses" });
		await shift(hit, actor, 5);
		expect(fightStateOn(actor, "nerves")).toBe(false);
	});

	it("reads its total as always on a card with no record, or one that bends nothing", async () => {
		const { actor, tracks } = hero({ moves: [PREPARE_A_WELCOME], held: { [PREPARE_A_WELCOME]: 1 } });
		const plain = bent(await rolled(actor, PREPARE_A_WELCOME, "failure", { surpriseSpent: true }), {});
		await shift(plain, actor, 7);
		expect(tracks[PREPARE_A_WELCOME]).toBe(1);
		await shift(plain, actor, 12);
		expect(tracks[PREPARE_A_WELCOME]).toBe(2);
	});
});
