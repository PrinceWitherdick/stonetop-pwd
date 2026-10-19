import { describe, it, expect, vi } from "vitest";
import { changeFollowerLoyalty, costPaidSince, costPaidKey, COST_PAID_FLAG, STRENGTHEN_YOUR_BOND, SPEND_LOYALTY } from "../../../module/actors/character/follower-bond.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// Strengthen Your Bond (p.464): "and you haven't done so recently". The table judges "recently"; the card
// remembers when the cost was last paid, so it can say a payment came since the last End of Session.

function leader(flags = {}) {
	return { isOwner: true, flags: { [SYSTEM_ID]: flags }, update: vi.fn(async () => {}) };
}

describe("costPaidSince", () => {
	it("reads a payment after the last End of Session, and none before it", () => {
		const flags = { [COST_PAID_FLAG]: { [costPaidKey("crew")]: 2000 } };
		expect(costPaidSince(flags, "crew", "", 1000)).toBe(true);
		expect(costPaidSince(flags, "crew", "", 3000)).toBe(false);
		expect(costPaidSince(flags, "custom", "a1", 0)).toBe(false);
		// No End of Session recorded yet: any payment counts.
		expect(costPaidSince(flags, "crew", "", 0)).toBe(true);
	});
});

describe("paying the cost stamps it", () => {
	it("writes the time with the Loyalty on Strengthen Your Bond, and not on a spend", async () => {
		const pc = leader({ crew: { loyalty: 1 } });
		await changeFollowerLoyalty(pc, { ftype: "crew", delta: 1, move: STRENGTHEN_YOUR_BOND });
		const [update] = pc.update.mock.calls[0];
		expect(update[`flags.${SYSTEM_ID}.crew.loyalty`]).toBe(2);
		expect(update[`flags.${SYSTEM_ID}.${COST_PAID_FLAG}.crew:`]).toBeGreaterThan(0);

		const spender = leader({ crew: { loyalty: 2 } });
		await changeFollowerLoyalty(spender, { ftype: "crew", delta: -1, move: SPEND_LOYALTY });
		expect(Object.keys(spender.update.mock.calls[0][0])).toEqual([`flags.${SYSTEM_ID}.crew.loyalty`]);
	});
});
