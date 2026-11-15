// The 11-14 review of the uncommitted homebrew pile: a move's own roll whose tiers follow is no bend, a
// move named with a dot records its Minor Arcana draw, and the one walk over learned homebrew moves.

import { describe, it, expect } from "vitest";
import { rollBendsFrom } from "../../module/playbooks/move-words.js";
import { learnedHomebrewMoves } from "../../module/actors/character/homebrew-roll-bends.js";
import { occultDrawKey, occultDrawsOwed } from "../../module/actors/character/occult-draw.js";
import { holdMoreBonus } from "../../module/actors/character/tier-effects.js";
import { SYSTEM_ID } from "../../module/system-id.js";

const hbFlags = () => ({ [SYSTEM_ID]: { homebrewPlaybook: "homebrew-the-tester" } });

describe("a move's own roll is not a bend", () => {
	it("even with its tiers in the sentence after", () => {
		expect(rollBendsFrom("When you Aid a monster, roll +CHA. On a 10+, they owe you. On a 7-9, they owe you less.")).toEqual([]);
	});

	it("but a swap that says what it replaces is still read", () => {
		const read = rollBendsFrom("When you Aid a monster, roll +CHA instead of +INT. On a 10+, they owe you.");
		expect(read.map(({ kind, stat, moves }) => ({ kind, stat, moves }))).toEqual([{ kind: "stat", stat: "cha", moves: ["Aid"] }]);
	});
});

describe("a Minor Arcana draw under a move named with a dot", () => {
	it("is recorded under a key Foundry won't split, and found there", () => {
		expect(occultDrawKey("St. Agnes's Interest")).toBe("St_ Agnes's Interest");
		const item = { id: "o", type: "move", name: "St. Agnes's Interest", flags: hbFlags(), system: { description: "<p>Draw three random Minor Arcana and choose one.</p>" } };
		expect([...occultDrawsOwed({ items: [item], flags: {} })]).toEqual([["St. Agnes's Interest", 3]]);
		expect([...occultDrawsOwed({ items: [item], flags: { [SYSTEM_ID]: { occultDraws: { [occultDrawKey(item.name)]: "the-jar" } } } })]).toEqual([]);
	});
});

describe("learnedHomebrewMoves", () => {
	it("walks the homebrew moves only, with their words as the readers take them", () => {
		const hb = { id: "a", type: "move", name: "Deadly", flags: hbFlags(), system: { description: "<p>Increase all damage dice by one size.</p>" } };
		const book = { id: "b", type: "move", name: "Clash", flags: {}, system: { description: "<p>Roll +STR.</p>" } };
		const gear = { id: "c", type: "item", name: "Rope", flags: hbFlags(), system: {} };
		const got = [...learnedHomebrewMoves({ items: [hb, book, gear] })];
		expect(got.map(g => g.item.name)).toEqual(["Deadly"]);
		expect(got[0].words).toContain("Increase all damage dice by one size.");
	});
});

describe("holdMoreBonus", () => {
	it("keeps the one shape, and is null for nothing", () => {
		expect(holdMoreBonus({ success: 1, partial: "1", failure: undefined })).toEqual({ success: 1, partial: 1, failure: 0 });
		expect(holdMoreBonus(null)).toBeNull();
		expect(holdMoreBonus({ success: 0 })).toBeNull();
	});
});
