import { describe, expect, it } from "vitest";
import { supplyPursesFor, defaultSupplyPurse, spendSupplies, campUsesNeeded, SUPPLY_PURPOSE, SUPPLY_SLUGS } from "../../../module/actors/character/supply-cost.js";

const labels = rows => rows.map(r => r.label);

// ── who may pay for what ─────────────────────────────────────────────────────

describe("supplyPursesFor", () => {
	it("lets the three printed supplies rows pay for anything", () => {
		const carried = { supplies: 4, "more-supplies": 2, "even-more-supplies": 1 };
		for (const purpose of Object.values(SUPPLY_PURPOSE)) {
			expect(labels(supplyPursesFor(carried, purpose).eligible))
				.toEqual(["Supplies", "More supplies", "Even more supplies"]);
		}
		expect(SUPPLY_SLUGS).toEqual(["supplies", "more-supplies", "even-more-supplies"]);
	});

	// Book I p.89: provisions stand in for supplies "when you Make Camp, or to feed yourself as
	// you travel" — and nowhere else. This is the rule the whole module exists to hold.
	it("takes provisions at camp and refuses them at a Recover, with the reason", () => {
		const carried = { supplies: 1, provisions: 4 };

		const camp = supplyPursesFor(carried, SUPPLY_PURPOSE.CAMP);
		expect(labels(camp.eligible)).toEqual(["Supplies", "Provisions"]);
		expect(camp.ineligible).toEqual([]);
		expect(camp.total).toBe(5);

		const recover = supplyPursesFor(carried, SUPPLY_PURPOSE.RECOVER);
		expect(labels(recover.eligible)).toEqual(["Supplies"]);
		expect(recover.ineligible[0]).toMatchObject({ slug: "provisions", remaining: 4 });
		expect(recover.ineligible[0].reason).toMatch(/Make Camp/);
		expect(recover.total).toBe(1);   // the larder is NOT counted toward what can Recover
	});

	// And the mirror image: Twisting Pine sap is "used in lieu of supplies to Recover" (Book II
	// p.462) — it seals wounds, so it is no use at all as dinner.
	it("takes Twisting Pine sap at a Recover and refuses it at camp", () => {
		const carried = { "twisting-pine": 1 };
		expect(labels(supplyPursesFor(carried, SUPPLY_PURPOSE.RECOVER).eligible)).toEqual(["Twisting Pine sap"]);

		const camp = supplyPursesFor(carried, SUPPLY_PURPOSE.CAMP);
		expect(camp.eligible).toEqual([]);
		expect(camp.ineligible[0].reason).toMatch(/not food/i);
	});

	// A row at zero is not a choice, and refusing a purse the player hasn't got is a sentence
	// about nothing.
	it("leaves empty purses out of both lists", () => {
		const purses = supplyPursesFor({ supplies: 0, provisions: 0 }, SUPPLY_PURPOSE.RECOVER);
		expect(purses.eligible).toEqual([]);
		expect(purses.ineligible).toEqual([]);
		expect(purses.total).toBe(0);
	});

	it("survives a character carrying nothing at all", () => {
		expect(supplyPursesFor(undefined, SUPPLY_PURPOSE.CAMP)).toEqual({ eligible: [], ineligible: [], total: 0 });
	});
});

describe("defaultSupplyPurse", () => {
	// A larder or a vial is the thing you have fewer of; the printed rows go first so neither is
	// spent by a player who just pressed the default button.
	it("drains the printed supplies rows before a larder", () => {
		const purses = supplyPursesFor({ provisions: 6, supplies: 1 }, SUPPLY_PURPOSE.CAMP);
		expect(defaultSupplyPurse(purses).slug).toBe("supplies");
	});

	it("is null when nothing can pay", () => {
		expect(defaultSupplyPurse(supplyPursesFor({}, SUPPLY_PURPOSE.CAMP))).toBeNull();
	});
});

// ── what a night costs ───────────────────────────────────────────────────────

describe("campUsesNeeded", () => {
	it("charges a use a head without a mess kit", () => {
		expect([0, 1, 4, 5].map(n => campUsesNeeded(n, false))).toEqual([0, 1, 4, 5]);
	});

	// "1 use can provide for up to four people" — and the fifth mouth needs a second use, not a
	// quarter of one. Halves round UP throughout Stonetop.
	it("stretches one use over four with a mess kit, rounding up", () => {
		expect([0, 1, 4, 5, 8, 9].map(n => campUsesNeeded(n, true))).toEqual([0, 1, 1, 2, 2, 3]);
	});

	it("treats junk head counts as nobody", () => {
		expect([campUsesNeeded(-3, false), campUsesNeeded(NaN, true), campUsesNeeded("", false)]).toEqual([0, 0, 0]);
	});
});

// ── paying the bill ──────────────────────────────────────────────────────────

describe("spendSupplies", () => {
	const camp = carried => supplyPursesFor(carried, SUPPLY_PURPOSE.CAMP);

	it("takes it all from one purse when one purse can cover it", () => {
		const { spends, short } = spendSupplies(camp({ supplies: 4 }), 3, "supplies");
		expect(spends).toEqual([{ slug: "supplies", label: "Supplies", spend: 3, left: 1 }]);
		expect(short).toBe(0);
	});

	// A camp of four eats four uses and one row rarely holds four, so the bill spills — starting
	// where the player pointed, then down the rest in order.
	it("spills across purses, starting with the one the player picked", () => {
		const { spends, spent, short } = spendSupplies(camp({ supplies: 2, provisions: 3 }), 4, "provisions");
		expect(spends).toEqual([
			{ slug: "provisions", label: "Provisions", spend: 3, left: 0 },
			{ slug: "supplies",   label: "Supplies",   spend: 1, left: 1 },
		]);
		expect(spent).toBe(4);
		expect(short).toBe(0);
	});

	// A party CAN try to camp with two uses between five of them. The move's answer to that is
	// deprivation (Book I p.335), so this reports the shortfall rather than refusing.
	it("spends what there is and reports the shortfall", () => {
		const { spends, spent, short } = spendSupplies(camp({ supplies: 2 }), 5, "supplies");
		expect(spends).toEqual([{ slug: "supplies", label: "Supplies", spend: 2, left: 0 }]);
		expect(spent).toBe(2);
		expect(short).toBe(3);
	});

	it("falls back to table order when the picked purse cannot pay at all", () => {
		const { spends } = spendSupplies(camp({ supplies: 2 }), 1, "provisions");
		expect(spends).toEqual([{ slug: "supplies", label: "Supplies", spend: 1, left: 1 }]);
	});

	it("spends nothing for a bill of nothing", () => {
		expect(spendSupplies(camp({ supplies: 4 }), 0)).toEqual({ spends: [], spent: 0, short: 0 });
	});
});
