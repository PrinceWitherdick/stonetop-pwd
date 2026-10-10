import { describe, it, expect } from "vitest";
import { cardCountedTier, cardTierNow, countedNote, countedResult, countedTier, outcomeTier, rolledRecord, totalTier, isStrongHit } from "../../module/utils/counted-tier.js";

describe("countedTier", () => {
	it("is the total's own tier on a card that bends nothing", () => {
		expect([5, 6, 7, 9, 10, 11, 12].map(t => countedTier(t))).toEqual(
			["failure", "failure", "partial", "partial", "success", "success", "critical"]);
		expect(totalTier(13)).toBe("critical");
	});

	it("counts a 7-9 as a 10+ when the roll treats it so, and nothing else", () => {
		const record = rolledRecord("cha", { partialCountsAsSuccess: "Let's Make a Deal" });
		expect(countedTier(8, record)).toBe("success");
		expect(countedTier(6, record)).toBe("failure");
		expect(isStrongHit(countedTier(8, record))).toBe(true);
	});

	it("counts a 6- as a 7-9, and only one step, when the roll carries both bends (Destined)", () => {
		const record = rolledRecord("", { missCountsAsPartial: "Destined", partialCountsAsSuccess: "Destined" });
		expect(countedTier(4, record)).toBe("partial");
		expect(countedTier(8, record)).toBe("success");
	});
});

describe("rolledRecord", () => {
	it("records the stat, the heading, and whether each bend was carried", () => {
		expect(rolledRecord("str", { moveName: "Clash", partialCountsAsSuccess: "  " })).toEqual({
			stat: "str", move: "Clash", missCountsAsPartial: false, partialCountsAsSuccess: false,
			missCountsAsPartialWhy: "", partialCountsAsSuccessWhy: "",
		});
	});

	it("keeps the rule that bent it, so a rewrite can name it", () => {
		expect(rolledRecord("cha", { partialCountsAsSuccess: " Let's Make a Deal " }).partialCountsAsSuccessWhy)
			.toBe("Let's Make a Deal");
	});

	it("reads a card's result block dataset, which names the bends as the options do", () => {
		const dataset = { outcomeSuccess: "You do it.", partialCountsAsSuccess: "Let's Make a Deal" };
		expect(countedTier(8, rolledRecord("", dataset))).toBe("success");
	});
});

// The rewrite path (stonetop.js#_shiftRollCardFlavor): a card rolled with a bend and then lifted or dropped
// reads the tier it COUNTS as, and names the rule while the bend is firing, as rollStat's own card does.
describe("countedResult", () => {
	const deal = rolledRecord("cha", { partialCountsAsSuccess: "Let's Make a Deal" });
	const destined = rolledRecord("", { missCountsAsPartial: "Destined", partialCountsAsSuccess: "Destined" });

	it("labels a lifted 7-9 on a Let's Make a Deal roll a Strong Hit, and names the rule", () => {
		expect(countedResult(8, deal)).toEqual({
			key: "success", label: "Strong Hit", note: "Rolled a 7-9, counted as a 10+ (Let's Make a Deal)",
		});
	});

	it("drops the note once the total counts as itself", () => {
		expect(countedResult(10, deal)).toEqual({ key: "success", label: "Strong Hit", note: "" });
		expect(countedResult(12, deal)).toEqual({ key: "critical", label: "12+ Strong Hit", note: "" });
		expect(countedResult(6, deal)).toEqual({ key: "failure", label: "Miss", note: "" });
	});

	it("counts a 6- as a 7-9 on a Destined roll, and a 7-9 as a 10+", () => {
		expect(countedResult(5, destined)).toEqual({
			key: "partial", label: "Weak Hit", note: "Rolled a 6-, counted as a 7-9 (Destined)",
		});
		expect(countedResult(7, destined).note).toBe("Rolled a 7-9, counted as a 10+ (Destined)");
	});

	it("is the total's own tier on a card that bends nothing", () => {
		expect(countedResult(8)).toEqual({ key: "partial", label: "Weak Hit", note: "" });
		expect(countedResult(8, rolledRecord("", {}))).toEqual({ key: "partial", label: "Weak Hit", note: "" });
	});

	it("still says the bend on a record without its rule", () => {
		expect(countedNote(8, { partialCountsAsSuccess: true })).toBe("Rolled a 7-9, counted as a 10+");
	});
});

// What a rewritten card's identification and tier effects read (stonetop.js#_resyncRewrittenTotal,
// tier-effects.js#reconcileTierEffects): the card's own record, under the system's scope.
describe("cardCountedTier", () => {
	const card = rolled => ({ getFlag: (scope, key) => (scope === "stonetop-pwd" && key === "rolled" ? rolled : undefined) });

	it("counts a card's total by the bends it carries", () => {
		const message = card(rolledRecord("cha", { partialCountsAsSuccess: "Let's Make a Deal" }));
		expect(cardCountedTier(message, 7, "stonetop-pwd")).toBe("success");
		expect(cardCountedTier(message, 6, "stonetop-pwd")).toBe("failure");
		expect(cardCountedTier(message, 12, "stonetop-pwd")).toBe("critical");
	});

	it("reads a card with no record, or no card, by its total", () => {
		expect(cardCountedTier(card(undefined), 8, "stonetop-pwd")).toBe("partial");
		expect(cardCountedTier(null, 5, "stonetop-pwd")).toBe("failure");
	});

	it("keys a 12+ as the 10+ a move's outcomes are written under", () => {
		expect(["critical", "success", "partial", "failure"].map(outcomeTier)).toEqual(["success", "success", "partial", "failure"]);
	});
});

// What stonetop.js reads off an Invoke card (its 6- consequences) and a Know Things card (whether a Logbook use still
// buys anything): the card's tier NOW, its shifted total bent by the rules stamped on it.
describe("cardTierNow", () => {
	const card = (total, rolled) => ({
		rolls: total == null ? [] : [{ total }],
		getFlag: (scope, key) => (scope === "stonetop-pwd" && key === "rolled" ? rolled : undefined),
	});

	it("lifts a 6- off the miss when the card counts a miss as a 7-9", () => {
		const record = rolledRecord("con", { missCountsAsPartial: "Stone Cold" });
		expect(cardTierNow(card(6, record), "stonetop-pwd")).toBe("partial");
		expect(cardTierNow(card(6, undefined), "stonetop-pwd")).toBe("failure");
	});

	it("reads a 7-9 the card counts as a 10+ as a 10+, and a 12+ as its 10+", () => {
		const record = rolledRecord("int", { partialCountsAsSuccess: "Let's Make a Deal" });
		expect(cardTierNow(card(8, record), "stonetop-pwd")).toBe("success");
		expect(cardTierNow(card(12, undefined), "stonetop-pwd")).toBe("success");
		expect(cardTierNow(card(9, undefined), "stonetop-pwd")).toBe("partial");
	});

	it("is null for a card with no roll", () => {
		expect(cardTierNow(card(null, undefined), "stonetop-pwd")).toBeNull();
	});
});
