import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OrderFollowersDialog } from "../../../module/actors/character/dialogs/OrderFollowersDialog.js";
import { orderedMoveName, ORDER_FOLLOWER_MOVES } from "../../../module/data/follower-build.js";
import { buildLiveCharacter, makeLiveItem, resetLiveIds } from "../../fakes/LiveCharacter.js";

// Order Followers shows who is being ordered and lets a balk be paid for (Book I p.464, p.466-467):
// "They might resist orders if ... the order goes against the follower's instinct, tags, cost, or other
// traits", and the player can "spend 1 Loyalty" to have them do it anyway. And the order's card reads the
// move the follower made ("they trigger the move", p.462), not a bare total.

function dialog(follower = {}, onRoll = () => {}) {
	const d = new OrderFollowersDialog({ name: "Rhianna" }, { name: "Andras", tags: ["archer"], ...follower }, onRoll);
	d.close = () => {};
	return d;
}

describe("the Order window shows who they are", () => {
	it("carries their instinct, cost and the Loyalty they hold", () => {
		expect(dialog({ instinct: "to try to impress Rhianna", cost: "recognition", loyalty: 2 }).getData()).toMatchObject({
			instinct: "to try to impress Rhianna", cost: "recognition", loyalty: 2, hasLoyalty: true, canBalk: true,
		});
	});

	it("offers no balk to a follower holding no Loyalty, and no track to one without", () => {
		expect(dialog({ loyalty: 0 }).getData()).toMatchObject({ hasLoyalty: true, canBalk: false });
		expect(dialog({}).getData()).toMatchObject({ hasLoyalty: false, canBalk: false, instinct: "", cost: "" });
	});
});

describe("a balk paid for with the order", () => {
	it("hands spendLoyalty back only when ticked and Loyalty is held", async () => {
		let handed = null;
		const d = dialog({ loyalty: 1 }, r => { handed = r; });
		d._spendLoyalty = true;
		await d._finish();
		expect(handed.spendLoyalty).toBe(true);

		const none = dialog({ loyalty: 0 }, r => { handed = r; });
		none._spendLoyalty = true;
		await none._finish();
		expect(handed).not.toHaveProperty("spendLoyalty");

		const unticked = dialog({ loyalty: 3 }, r => { handed = r; });
		await unticked._finish();
		expect(handed).not.toHaveProperty("spendLoyalty");
	});

	// Front Line Leader (Marshal, p.126): "Spend Presence in lieu of your crew's Loyalty". The sheet hands the
	// window `presence` only for the crew (front-line-presence.js#presenceFor), so the window trusts it.
	it("offers the balk on Presence alone at 0 Loyalty, and pays it with Presence", async () => {
		let handed = null;
		const d = dialog({ loyalty: 0, presence: 2 }, r => { handed = r; });
		expect(d.getData()).toMatchObject({ canBalk: true, balkOnPresence: true, presenceChoice: false, presence: 2 });
		d._spendLoyalty = true;
		await d._finish();
		expect(handed).toMatchObject({ spendLoyalty: true, payWithPresence: true });
	});

	it("beside Loyalty, Presence is a box of its own, and pays only when ticked", async () => {
		let handed = null;
		const d = dialog({ loyalty: 1, presence: 1 }, r => { handed = r; });
		expect(d.getData()).toMatchObject({ canBalk: true, balkOnPresence: false, presenceChoice: true });
		d._spendLoyalty = true;
		await d._finish();
		expect(handed.spendLoyalty).toBe(true);
		expect(handed).not.toHaveProperty("payWithPresence");

		const ticked = dialog({ loyalty: 1, presence: 1 }, r => { handed = r; });
		ticked._spendLoyalty = true;
		ticked._payWithPresence = true;
		await ticked._finish();
		expect(handed).toMatchObject({ spendLoyalty: true, payWithPresence: true });

		const none = dialog({ loyalty: 1, presence: 0 }, r => { handed = r; });
		expect(none.getData()).toMatchObject({ presenceChoice: false, balkOnPresence: false });
		none._spendLoyalty = true;
		none._payWithPresence = true;
		await none._finish();
		expect(handed).not.toHaveProperty("payWithPresence");
	});
});

describe("orderedMoveName", () => {
	it("names the character's basic move for every key but a custom order", () => {
		expect(orderedMoveName("let-fly")).toBe("Let Fly");
		expect(orderedMoveName("persuade-npcs")).toBe("Persuade (vs. NPCs)");
		expect(orderedMoveName("custom")).toBeNull();
		expect(orderedMoveName(null)).toBeNull();
		expect(ORDER_FOLLOWER_MOVES.map(m => m.key)).toContain("defy-danger");
	});
});

describe("the order's card reads the move they made", () => {
	let rolled;
	beforeEach(() => {
		resetLiveIds();
		rolled = [];
		vi.doMock("../../../module/utils/roll-engine.js", () => ({
			rollStat: vi.fn(async (stat, actor, options) => { rolled.push(options); return { total: 8 }; }),
		}));
	});
	afterEach(() => vi.doUnmock("../../../module/utils/roll-engine.js"));

	const LET_FLY_RESULTS = { success: { label: "10+", value: "Deal your damage." }, partial: { label: "7-9", value: "Pick one." } };
	function rhianna() {
		return buildLiveCharacter({
			slug: "the-marshal", name: "Rhianna", seedStartingMoves: false,
			items: [makeLiveItem({ name: "Let Fly", type: "move", system: { moveType: "basic", rollType: "dex", description: "<p>When you attack at range…</p>", moveResults: LET_FLY_RESULTS } })],
		}).char;
	}

	it("carries the move's own text and results, under a line naming who made it", async () => {
		await rhianna().onOrderFollowersRoll({ bonus: 1, moveName: "Andras: Let Fly", moveKey: "let-fly", followerName: "Andras" });
		expect(rolled[0].moveResults).toEqual(LET_FLY_RESULTS);
		expect(rolled[0].moveDescription).toContain("When you attack at range");
		expect(rolled[0].moveDescription).toContain("Andras");
	});

	it("stays the bare result for a custom order, or a move the character does not have", async () => {
		const char = rhianna();
		await char.onOrderFollowersRoll({ moveName: "Andras: scale the wall", moveKey: "custom", followerName: "Andras" });
		await char.onOrderFollowersRoll({ moveName: "Andras: Seek Insight", moveKey: "seek-insight", followerName: "Andras" });
		expect(rolled.every(o => o.moveDescription === undefined && o.moveResults === undefined)).toBe(true);
	});

	it("names the Loyalty a balk spent on the card", async () => {
		await rhianna().onOrderFollowersRoll({ moveKey: "let-fly", followerName: "Andras", loyaltySpent: { from: 2, to: 1 } });
		expect(rolled[0].conditionNotes.some(n => /Loyalty/.test(n) && /1/.test(n))).toBe(true);
	});

	it("names Presence spent in a balk's Loyalty's place on the card", async () => {
		await rhianna().onOrderFollowersRoll({ moveKey: "let-fly", followerName: "Andras", presenceSpent: { from: 2, to: 1 } });
		expect(rolled[0].conditionNotes.some(n => /Presence/.test(n) && /Front Line Leader/.test(n) && /1 left/.test(n))).toBe(true);
	});
});
