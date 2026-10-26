import { describe, expect, it } from "vitest";
import {
	crewRoadText, defaultRoadShares, drainPurses, ledgerAsPaid, roadLedger, roadMouths, roadSummaryRows, roadUsesPerDay,
} from "../../module/utils/road-rations.js";
import { campPurses } from "../../module/camp/camp-rules.js";
import { CREW_SUPPLIES_SLUG } from "../../module/actors/character/supply-cost.js";

/**
 * DAYS ON THE ROAD (Book I p.89, p.304): 1 use a head a day; a mess kit feeds four, so 2 a day for
 * five to eight and 3 for nine to twelve; provisions before supplies; a pack animal or cart laden
 * with 1 Surplus of supplies stops the count.
 */

const pc = (id, resources, over = {}) => ({ actorId: id, name: id, eats: true, followers: 0, resources, ...over });

describe("the bill for a day on the road", () => {
	it("is 1 use per person per day without a mess kit", () => {
		expect(roadUsesPerDay(5)).toBe(5);
	});

	it("rounds the mess kit up per day: 4 feed on 1, 5-8 on 2, 9-12 on 3 (p.304)", () => {
		expect(roadUsesPerDay(4, { messKit: true })).toBe(1);
		expect(roadUsesPerDay(5, { messKit: true })).toBe(2);
		expect(roadUsesPerDay(8, { messKit: true })).toBe(2);
		expect(roadUsesPerDay(9, { messKit: true })).toBe(3);
		expect(roadUsesPerDay(12, { messKit: true })).toBe(3);
	});

	it("costs nothing with a laden pack animal or cart (p.304)", () => {
		expect(roadUsesPerDay(6, { packAnimal: true })).toBe(0);
		expect(roadUsesPerDay(6, { messKit: true, packAnimal: true })).toBe(0);
	});

	it("counts a member's followers, and not a member who does not eat", () => {
		expect(roadMouths(pc("a", {}, { followers: 2 }))).toBe(3);
		expect(roadMouths(pc("a", {}, { eats: false, followers: 1 }))).toBe(1);
	});

	it("multiplies the per-day bill by the days, never rounding across them", () => {
		// Five with a mess kit for three days: 2 a day, 6 in all, not ceil(15/4) = 4.
		const party = ["a", "b", "c", "d", "e"].map(id => pc(id, { supplies: 4 }));
		const ledger = roadLedger(party, { days: 3, messKit: true });
		expect(ledger.perDay).toBe(2);
		expect(ledger.bill).toBe(6);
	});
});

describe("who pays", () => {
	it("eats provisions before supplies, as Make Camp does (p.89)", () => {
		const purses = campPurses({ supplies: 4, provisions: 2 });
		expect(drainPurses(purses, 3)).toEqual([
			{ slug: "provisions", label: "Provisions", n: 2 },
			{ slug: "supplies", label: "Supplies", n: 1 },
		]);
	});

	it("splits the bill by mouths, adding up to the bill", () => {
		const rows = [
			{ actorId: "a", mouths: 1, holds: 10 },
			{ actorId: "b", mouths: 2, holds: 10 },
		];
		expect(defaultRoadShares(rows, 3)).toEqual({ a: 1, b: 2 });
		const shares = defaultRoadShares(rows, 2);
		expect(shares.a + shares.b).toBe(2);
	});

	it("has the next pack with food to spare cover what one cannot", () => {
		const rows = [
			{ actorId: "a", mouths: 1, holds: 0 },
			{ actorId: "b", mouths: 1, holds: 5 },
		];
		expect(defaultRoadShares(rows, 4)).toEqual({ a: 0, b: 4 });
	});

	it("takes the GM's figure for a member, capped at what their pack holds", () => {
		const ledger = roadLedger([pc("a", { supplies: 4 }), pc("b", { supplies: 4 })], { days: 2, paid: { a: 9 } });
		const a = ledger.rows.find(r => r.actorId === "a");
		expect(a.pays).toBe(4);
		expect(ledger.paid).toBe(6);
		expect(ledger.over).toBe(2);
	});

	it("leaves a shortfall when the packs run dry, rather than inventing food", () => {
		const ledger = roadLedger([pc("a", { supplies: 1 })], { days: 3 });
		expect(ledger.bill).toBe(3);
		expect(ledger.paid).toBe(1);
		expect(ledger.short).toBe(2);
	});

	it("reads an unmarked supplies row as nothing to eat, since the pack is what was read", () => {
		const ledger = roadLedger([pc("a", { supplies: 0, provisions: 3 })], { days: 2 });
		expect(ledger.rows[0].spend).toEqual([{ slug: "provisions", label: "Provisions", n: 2 }]);
	});
});

describe("the crew pays its own mouths (the Crew insert, Book I p.144)", () => {
	/** A Marshal feeding a crew of `crew`, whose crew's supplies hold `held`. */
	const marshal = (id, resources, { crew = 4, held = 0, ...over } = {}) => pc(id, resources, { followers: crew, crewMouths: crew, crew: { held }, ...over });

	it("pays the crew from its own supplies first and leaves the packs only the rest", () => {
		const ledger = roadLedger([marshal("Rook", { supplies: 4 }, { held: 20 }), pc("Bo", { supplies: 4 })], { days: 3 });
		// Six mouths for three days: 18. The crew's 12 come out of its supplies; Rook and Bo eat 3 each.
		expect(ledger.bill).toBe(18);
		expect(ledger.crewPaid).toBe(12);
		const [rook, bo] = ledger.rows;
		expect(rook).toMatchObject({ crewBill: 12, crewPays: 12, pays: 3 });
		expect(rook.crewSpend).toEqual([{ slug: CREW_SUPPLIES_SLUG, label: "Crew supplies", n: 12 }]);
		expect(bo).toMatchObject({ crewPays: 0, pays: 3, crewSpend: [] });
		expect(ledger.short).toBe(0);
	});

	it("bills what the crew's supplies cannot cover to the packs, the keeper's first", () => {
		const ledger = roadLedger([marshal("Rook", { supplies: 10 }, { held: 6 }), pc("Bo", { supplies: 4 })], { days: 2 });
		// 12 in all; the crew eats 8 and its supplies pay 6. Rook's pack pays Rook's 2 and the crew's other 2.
		expect(ledger.rows.map(r => [r.crewPays, r.pays])).toEqual([[6, 4], [0, 2]]);
		expect(ledger.paid).toBe(12);
	});

	it("has the pack feed the whole crew when the crew's supplies are empty", () => {
		const ledger = roadLedger([marshal("Rook", { supplies: 10 }, { held: 0 })], { days: 1 });
		expect(ledger.rows[0]).toMatchObject({ crewBill: 4, crewPays: 0, pays: 5, crewSpend: [] });
	});

	it("bills the crew's meal per day, a quarter of its mouths rounded up over a mess kit", () => {
		const ledger = roadLedger([marshal("Rook", { supplies: 4 }, { crew: 6, held: 20 })], { days: 2, messKit: true });
		// Seven mouths over a mess kit: 2 a day, 4 in all; the crew's 6 eat 2 a day, all of it.
		expect(ledger.bill).toBe(4);
		expect(ledger.rows[0]).toMatchObject({ crewBill: 4, crewPays: 4, pays: 0 });
	});

	it("never feeds more of the crew than the followers the GM left eating, and nothing over a laden cart", () => {
		expect(roadLedger([marshal("Rook", {}, { held: 20, followers: 2 })]).rows[0].crewPays).toBe(2);
		const cart = roadLedger([marshal("Rook", {}, { held: 20 })], { days: 3, packAnimal: true });
		expect(cart.rows[0]).toMatchObject({ crewBill: 0, crewPays: 0 });
	});

	it("has two crews over one mess kit pay no more than the party's whole bill", () => {
		const ledger = roadLedger([
			marshal("Rook", {}, { crew: 1, held: 4, eats: false }),
			marshal("Wren", {}, { crew: 1, held: 4, eats: false }),
		], { messKit: true });
		expect(ledger.bill).toBe(1);
		expect(ledger.rows.map(r => r.crewPays)).toEqual([1, 0]);
		expect(ledger.over).toBe(0);
	});

	it("leaves everyone without a crew paying as before", () => {
		const before = roadLedger([pc("a", { supplies: 4 }), pc("b", { supplies: 4 })], { days: 2 });
		expect(before.rows.map(r => r.pays)).toEqual([2, 2]);
		expect(before.crewPaid).toBe(0);
	});

	it("says what the crew's supplies pay, in place of a figure to set", () => {
		expect(crewRoadText({ crewBill: 0, crewPays: 0 })).toBe("");
		expect(crewRoadText({ crewBill: 6, crewPays: 6 })).toBe("Feeds the crew first: 6 uses, all the crew eats.");
		expect(crewRoadText({ crewBill: 6, crewPays: 5 })).toBe("Feeds the crew first: 5 of the 6 uses the crew eats. The other 1 comes out of the packs.");
		expect(crewRoadText({ crewBill: 1, crewPays: 0 })).toBe("Empty, so what the crew eats (1 use) comes out of the packs.");
	});

	it("names on the card what came from the crew's supplies and what from the pack", () => {
		const rows = roadSummaryRows(roadLedger([marshal("Rook", { supplies: 10 }, { held: 6 })], { days: 2 }));
		expect(rows).toContainEqual({ label: "Rook", value: "6 uses from the crew's own supplies; 4 uses (4 supplies) from the pack" });
		const crewOnly = roadSummaryRows(roadLedger([marshal("Rook", {}, { crew: 1, held: 4, eats: false })]));
		expect(crewOnly).toContainEqual({ label: "Rook", value: "1 use from the crew's own supplies" });
	});
});

describe("the chat summary", () => {
	it("names the bill, each payer and what they paid from, and any shortfall", () => {
		const ledger = roadLedger([pc("Ash", { supplies: 1, provisions: 1 })], { days: 3 });
		const rows = roadSummaryRows(ledger);
		expect(rows[0].value).toContain("3 days, 1 mouth: 1 use a day, 3 uses in all.");
		expect(rows[1]).toEqual({ label: "Ash", value: "2 uses (1 provisions, 1 supplies)" });
		expect(rows[2].label).toBe("Went short");
		expect(rows[2].value).toContain("p.335");
	});

	// Code review 10-22 (HC-8): the window reads the packs once. A use eaten or found while it was open is
	// not named on the card as paid: each purse pays what it holds now, and the rest is the shortfall.
	it("pays only what each purse still holds, and counts the rest as short", () => {
		const ledger = roadLedger([pc("Ash", { supplies: 2, provisions: 1 })], { days: 3 });
		expect(ledger.short).toBe(0);
		const paid = ledgerAsPaid(ledger, () => ({ provisions: 0, supplies: 1 }));
		expect(paid.rows[0].spend).toEqual([{ slug: "supplies", label: expect.any(String), n: 1 }]);
		expect(paid.rows[0].pays).toBe(1);
		expect(paid.paid).toBe(1);
		expect(paid.short).toBe(2);
		expect(roadSummaryRows(paid).at(-1).label).toBe("Went short");
		// Held as read: nothing changes.
		expect(ledgerAsPaid(ledger, () => ({ provisions: 1, supplies: 2 })).short).toBe(0);
	});

	it("says nobody counts meals with a laden pack animal", () => {
		const rows = roadSummaryRows(roadLedger([pc("Ash", { supplies: 4 })], { days: 2, packAnimal: true }));
		expect(rows).toHaveLength(1);
		expect(rows[0].value).toContain("re-Outfit");
	});
});
