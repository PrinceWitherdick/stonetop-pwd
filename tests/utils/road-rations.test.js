import { describe, expect, it } from "vitest";
import {
	defaultRoadShares, drainPurses, roadLedger, roadMouths, roadSummaryRows, roadUsesPerDay,
} from "../../module/utils/road-rations.js";
import { campPurses } from "../../module/camp/camp-rules.js";

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

describe("the chat summary", () => {
	it("names the bill, each payer and what they paid from, and any shortfall", () => {
		const ledger = roadLedger([pc("Ash", { supplies: 1, provisions: 1 })], { days: 3 });
		const rows = roadSummaryRows(ledger);
		expect(rows[0].value).toContain("3 days, 1 mouth: 1 use a day, 3 uses in all.");
		expect(rows[1]).toEqual({ label: "Ash", value: "2 uses (1 provisions, 1 supplies)" });
		expect(rows[2].label).toBe("Went short");
		expect(rows[2].value).toContain("p.335");
	});

	it("says nobody counts meals with a laden pack animal", () => {
		const rows = roadSummaryRows(roadLedger([pc("Ash", { supplies: 4 })], { days: 2, packAnimal: true }));
		expect(rows).toHaveLength(1);
		expect(rows[0].value).toContain("re-Outfit");
	});
});
