import { describe, expect, it } from "vitest";
import { supplyPursesFor, defaultSupplyPurse, campUsesNeeded, spendablePurseResources, suppliesUsesOnMark, suppliesGiveBack, SUPPLY_PURPOSE, SUPPLY_SLUGS } from "../../../module/actors/character/supply-cost.js";

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

// ── what a character can reach ───────────────────────────────────────────────

describe("spendablePurseResources", () => {
	// Only MARKED rows can be spent (Book I p.89: "clear the marks from your Inventory insert" when
	// home), and never past the row's current size, which a fall in Prosperity can shrink.
	it("empties a purse that is not carried and caps one that is", () => {
		const out = spendablePurseResources(
			{ supplies: 6, "more-supplies": 3, provisions: 2, "a-ring": 5 },
			{ checked: { supplies: true, provisions: true }, max: { supplies: 4, "more-supplies": 4 } },
		);
		expect(out).toEqual({ supplies: 4, "more-supplies": 0, provisions: 2, "a-ring": 5 });
	});

	// IA-3: the mark test is the printed rows' alone (the INV-4 ruling). Provisions from a haul that
	// claimed no ◆ ("an extra 1d6 uses", p.79) and Twisting Pine sap are spendable unmarked.
	it("asks only the three printed supplies rows to be marked", () => {
		const out = spendablePurseResources(
			{ supplies: 3, provisions: 2, "twisting-pine": 1 },
			{ checked: {}, max: {} },
		);
		expect(out).toEqual({ supplies: 0, provisions: 2, "twisting-pine": 1 });
	});

	it("leaves the purses as stored when nothing is asked", () => {
		expect(spendablePurseResources({ supplies: 6 })).toEqual({ supplies: 6 });
	});

	it("feeds supplyPursesFor when it is handed the limits", () => {
		const purses = supplyPursesFor({ supplies: 3, "more-supplies": 2 }, SUPPLY_PURPOSE.RECOVER, { checked: { "more-supplies": true } });
		expect(purses.eligible.map(p => [p.slug, p.remaining])).toEqual([["more-supplies", 2]]);
		expect(purses.total).toBe(2);
	});
});

// IA-1: a ◆ of supplies is its food; the tick moves the ◆ (Book I p.88, p.326-327).
describe("suppliesUsesOnMark / suppliesGiveBack", () => {
	it("packs a fresh, full ◆ when the mark drew an undefined ◆ or the row was empty", () => {
		expect(suppliesUsesOnMark({ drew: 1, uses: 0, perSupply: 5 })).toBe(5);
		expect(suppliesUsesOnMark({ drew: 1, uses: 2, perSupply: 5 })).toBe(5);
		expect(suppliesUsesOnMark({ drew: 0, uses: 2, perSupply: 5 })).toBe(2);
		// Marked by hand at home after a Reset: a fresh ◆, not an empty one.
		expect(suppliesUsesOnMark({ drew: 0, uses: 0, perSupply: 5 })).toBe(5);
	});

	it("hands back the draw only while the ◆ is still full", () => {
		expect(suppliesGiveBack({ drawn: 1, uses: 5, perSupply: 5 })).toBe(1);
		expect(suppliesGiveBack({ drawn: 1, uses: 6, perSupply: 5 })).toBe(1);
		expect(suppliesGiveBack({ drawn: 1, uses: 4, perSupply: 5 })).toBe(0);
		expect(suppliesGiveBack({ drawn: 1, uses: 0, perSupply: 5 })).toBe(0);
		expect(suppliesGiveBack({ drawn: 0, uses: 5, perSupply: 5 })).toBe(0);
	});
});
