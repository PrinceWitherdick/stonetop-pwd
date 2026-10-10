// Send Them Back (the Ring of Daagon's servants, Book II p.561): "on a 10+, they go, now; on a 7-9, they
// go, but take their time and likely do some harm on their way; on a 6-, spend their Loyalty or mark a
// consequence and they'll eventually go (as on a 7-9); otherwise, this batch breaks free of your control
// and are no longer followers."
//
// Wave 3 audit DAA-3: the outcome used to be decided off the raw total the moment the dice landed, in a
// pop-up, so a Burn Brightly or a GM's Shift afterwards could not change what happened to the batch. The
// outcome is now the card's own buttons, read against the tier the card ends on. DAA-4: every write names
// the move for the ledger.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	SEND_BACK_FLAG, SEND_THEM_BACK, runSendBack, sendBackCardTier, sendBackRollOptions, sendBackTierActions, settleSendBack,
} from "../../../module/actors/character/send-them-back.js";
import { RING_SOURCE_UUID, SERVANT_SOURCE_UUID } from "../../../module/data/servant-of-daagon.js";

function actorWith(followers) {
	const flags = { customFollowers: structuredClone(followers) };
	return {
		name: "Wynn",
		flags,
		getFlag: vi.fn((scope, key) => key.split(".").reduce((o, k) => o?.[k], flags)),
		update: vi.fn(async () => {}),
	};
}

const FOLLOWERS = {
	ring:  { name: "The Ring", sourceUuid: RING_SOURCE_UUID, loyalty: 2 },
	deep:  { name: "Servants of Daagon", sourceUuid: SERVANT_SOURCE_UUID },
};

/** A Send Them Back card whose dice total `total`, with a message-flag store for the latch. */
function cardAt(total) {
	const store = {};
	return {
		rolls: [{ total }],
		getFlag: vi.fn((scope, key) => store[key]),
		setFlag: vi.fn(async (scope, key, value) => { store[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete store[key]; }),
		store,
	};
}

const btn = (tier, act, slug = "deep") => ({ dataset: { tier, act, slug } });

beforeEach(() => {
	global.ui = { notifications: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } };
	global.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: vi.fn(() => ({})) };
});

describe("the card's buttons", () => {
	it("prints each tier's own choices, for the row the card ends on to show", () => {
		const actions = sendBackTierActions("deep");
		expect(actions.success).toContain('data-tier="success" data-act="depart" data-slug="deep"');
		expect(actions.partial).toContain('data-tier="partial" data-act="depart"');
		for (const act of ["loyalty", "consequence", "free"]) expect(actions.failure).toContain(`data-tier="failure" data-act="${act}"`);
		const options = sendBackRollOptions("deep");
		expect(options.moveName).toBe(SEND_THEM_BACK);
		expect(options.tierActions).toEqual(actions);
	});

	it("reads the tier the card's total says NOW, so a Shift or a Burn Brightly decides it", () => {
		expect(sendBackCardTier(cardAt(5))).toBe("failure");
		expect(sendBackCardTier(cardAt(8))).toBe("partial");
		expect(sendBackCardTier(cardAt(12))).toBe("success");
		expect(sendBackCardTier({ rolls: [] })).toBeNull();
	});

	it("refuses a row the card no longer reads: a 6- lifted to a 7-9 cannot be broken free", async () => {
		const actor = actorWith(FOLLOWERS);
		const card = cardAt(7);   // rolled 6, burned up to 7
		expect(await settleSendBack(card, actor, btn("failure", "free"))).toBe(false);
		expect(actor.update).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining("7-9"));
		expect(card.store[SEND_BACK_FLAG]).toBeUndefined();
	});

	it("acts once per card", async () => {
		const actor = actorWith(FOLLOWERS);
		const card = cardAt(10);
		expect(await settleSendBack(card, actor, btn("success", "depart"))).toBe(true);
		expect(card.store[SEND_BACK_FLAG]).toBe("depart");
		actor.update.mockClear();
		expect(await settleSendBack(card, actor, btn("success", "depart"))).toBe(false);
		expect(actor.update).not.toHaveBeenCalled();
	});
});

describe("what each button does", () => {
	it("10+ and 7-9: takes the batch off the Followers tab, naming the move", async () => {
		const actor = actorWith(FOLLOWERS);
		expect(await runSendBack(actor, "deep", "depart")).toBe(true);
		const [data, options] = actor.update.mock.calls[0];
		expect(Object.keys(data)[0]).toMatch(/customFollowers\.(-=)?deep$/);
		expect(options).toEqual({ stonetopMove: SEND_THEM_BACK });
	});

	it("6-, spend their Loyalty: the Ring's shared pool pays 1, then they go", async () => {
		const actor = actorWith(FOLLOWERS);
		expect(await runSendBack(actor, "deep", "loyalty")).toBe(true);
		expect(actor.update.mock.calls[0]).toEqual([
			{ "flags.stonetop-pwd.customFollowers.ring.loyalty": 1 }, { stonetopMove: SEND_THEM_BACK },
		]);
		expect(Object.keys(actor.update.mock.calls[1][0])[0]).toMatch(/customFollowers\.(-=)?deep$/);
		expect(actor.update.mock.calls[1][1]).toEqual({ stonetopMove: SEND_THEM_BACK });
	});

	it("6-, spend their Loyalty with none held: says so and does nothing", async () => {
		const actor = actorWith({ ...FOLLOWERS, ring: { ...FOLLOWERS.ring, loyalty: 0 } });
		expect(await runSendBack(actor, "deep", "loyalty")).toBe(false);
		expect(actor.update).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalled();
	});

	it("6-, mark a consequence: the Ring's next Consequence is marked, then they go; backing out keeps them", async () => {
		const actor = actorWith(FOLLOWERS);
		const markConsequence = vi.fn(async () => true);
		expect(await runSendBack(actor, "deep", "consequence", { markConsequence })).toBe(true);
		expect(markConsequence).toHaveBeenCalledWith(actor, "ring-of-daagon");
		expect(actor.update).toHaveBeenCalledTimes(1);

		const kept = actorWith(FOLLOWERS);
		expect(await runSendBack(kept, "deep", "consequence", { markConsequence: vi.fn(async () => false) })).toBe(false);
		expect(kept.update).not.toHaveBeenCalled();
	});

	it("6-, otherwise: the batch breaks free, named for the move", async () => {
		const actor = actorWith(FOLLOWERS);
		expect(await runSendBack(actor, "deep", "free")).toBe(true);
		expect(actor.update).toHaveBeenCalledWith(
			{ "flags.stonetop-pwd.customFollowers.deep.brokenFree": true }, { stonetopMove: SEND_THEM_BACK });
	});

	it("goes through the sheet's own removal when the actor has a sheet", async () => {
		const actor = actorWith(FOLLOWERS);
		actor.sheet = { _removeCustomFollower: vi.fn(async () => {}) };
		await runSendBack(actor, "deep", "depart");
		expect(actor.sheet._removeCustomFollower).toHaveBeenCalledWith("deep", { stonetopMove: SEND_THEM_BACK });
		expect(actor.update).not.toHaveBeenCalled();
	});
});
