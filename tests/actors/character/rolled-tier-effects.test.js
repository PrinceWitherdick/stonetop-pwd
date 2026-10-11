import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildLiveCharacter, resetLiveIds } from "../../fakes/LiveCharacter.js";
import { ROLLED_FLAG, rolledRecord } from "../../../module/utils/counted-tier.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// What the tier just rolled does to the character (tier-effects.js) is settled off the CARD's total, not the
// Roll in hand: a Burn Brightly, a +1 or a GM's Shift can land on the card between the dice and the settle
// (the miss XP's relay to the GM is in between), and a rewrite lifts only a copy of the roll. Such a rewrite
// found no record on the card to bring along, so one landing while the effects are settled is caught up after.

vi.mock("../../../module/utils/roll-engine.js", async importOriginal => ({
	...(await importOriginal()),
	messageOfRoll: roll => roll?.card ?? null,
}));
vi.mock("../../../module/actors/character/tier-effects.js", async importOriginal => ({
	...(await importOriginal()),
	settleTierEffects: vi.fn(async (_actor, _move, tier) => ({ settledAt: tier })),
	recordTierEffects: vi.fn(async () => true),
	reconcileTierEffects: vi.fn(async () => true),
}));

const { settleTierEffects, recordTierEffects, reconcileTierEffects } = await import("../../../module/actors/character/tier-effects.js");

/** A posted roll card showing `total`, with the record rollStat stamps on it. */
function card(total, record = rolledRecord("wis", { moveName: "Commune with Aratis" })) {
	const flags = { [SYSTEM_ID]: { [ROLLED_FLAG]: record } };
	return { rolls: [{ total }], flags, getFlag: (scope, key) => flags[scope]?.[key] };
}

function hero() {
	return buildLiveCharacter({ slug: "the-judge", name: "The Judge", seedStartingMoves: false });
}

beforeEach(() => {
	resetLiveIds();
	vi.mocked(settleTierEffects).mockClear();
	vi.mocked(recordTierEffects).mockClear();
	vi.mocked(reconcileTierEffects).mockClear();
});

describe("settling a roll's tier effects", () => {
	it("settles the tier the card shows when a +1 landed on it before the settle", async () => {
		const { char } = hero();
		const roll = { total: 9, card: card(10) };
		await char._settleRolledTierEffects(roll, "Commune with Aratis", {}, []);
		expect(settleTierEffects.mock.calls[0][2]).toBe("success");
		expect(recordTierEffects).toHaveBeenCalledWith(roll.card, { settledAt: "success" });
		expect(reconcileTierEffects).not.toHaveBeenCalled();
	});

	it("brings the record along when the card's tier moves while the effects are being settled", async () => {
		const { char, actor } = hero();
		const roll = { total: 9, card: card(9) };
		vi.mocked(settleTierEffects).mockImplementationOnce(async (_a, _m, tier) => {
			roll.card.rolls = [{ total: 10 }];
			return { settledAt: tier };
		});
		await char._settleRolledTierEffects(roll, "Commune with Aratis", {}, []);
		expect(settleTierEffects.mock.calls[0][2]).toBe("partial");
		expect(reconcileTierEffects).toHaveBeenCalledWith(roll.card, 10, { actor });
	});

	it("reads the tier the card COUNTS as, a 6- a rule treats as a 7-9 included", async () => {
		const { char } = hero();
		const roll = { total: 5, card: card(5, rolledRecord("wis", { missCountsAsPartial: "Herd of Horses" })) };
		await char._settleRolledTierEffects(roll, "Requisition", {}, []);
		expect(settleTierEffects.mock.calls[0][2]).toBe("partial");
	});

	it("falls back to the Roll in hand for a roll with no card", async () => {
		const { char } = hero();
		await char._settleRolledTierEffects({ total: 11 }, "Commune with Aratis", {}, []);
		expect(settleTierEffects.mock.calls[0][2]).toBe("success");
	});
});
