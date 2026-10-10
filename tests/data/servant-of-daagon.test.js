import { describe, it, expect } from "vitest";
import {
	resolveServantBatch, buildServantFollower,
	SERVANT_ASPECTS, SERVANT_BASE_TAGS, SERVANT_TAG_OPTIONS,
	SERVANT_NUMBER_OPTIONS, SERVANT_SIZE_OPTIONS, SERVANT_TRAIT_OPTIONS, SERVANT_MOVE_OPTIONS,
	SERVANT_SOURCE_UUID,
} from "../../module/data/servant-of-daagon.js";

describe("Servant of Daagon aspect tables", () => {
	it("has five aspects and a d4 mapping for each keyed 1-4", () => {
		expect(SERVANT_ASPECTS.map(a => a.key)).toEqual(["tags", "number", "size", "traits", "moves"]);
		for (const map of [SERVANT_TAG_OPTIONS, SERVANT_NUMBER_OPTIONS, SERVANT_SIZE_OPTIONS]) {
			expect(Object.keys(map).sort()).toEqual(["1", "2", "3", "4"]);
		}
	});

	it("offers six traits and six moves to choose from", () => {
		expect(SERVANT_TRAIT_OPTIONS).toHaveLength(6);
		expect(SERVANT_MOVE_OPTIONS).toHaveLength(6);
	});

	// The chosen moves become the batch's move lines as written, so they are the book's
	// words (Book II p.561), not a paraphrase.
	it("words the moves as the book prints them", () => {
		expect(SERVANT_MOVE_OPTIONS).toEqual([
			"Wriggle free of danger/restraint",
			"Heal at a prodigious rate",
			"Smother/constrict/engulf them",
			"Dissolve organic material",
			"Mesmerize the weak-willed",
			"Paralyze them with venom",
		]);
	});
});

describe("resolveServantBatch", () => {
	it("keeps the three base tags on every batch", () => {
		const out = resolveServantBatch({ aspectDie: { tags: 2, number: 2, size: 2, traits: 0, moves: 0 }, count: 4 });
		for (const t of SERVANT_BASE_TAGS) expect(out.tags).toContain(t);
	});

	it("resolves a horde of small, craven servants with hide + powerful traits", () => {
		const out = resolveServantBatch({
			aspectDie:    { tags: 1, number: 1, size: 1, traits: 2, moves: 2 },
			count:        5,
			chosenTraits: ["hide", "powerful"],
			chosenMoves:  ["Wriggle free of danger/restraint", "Dissolve organic material"],
		});
		// horde base HP 3, small -2 → 1
		expect(out.hp).toBe(1);
		expect(out.armor).toBe(2);                       // blubbery/scaly hide
		// d6 base; size -2 and powerful +2 cancel to a flat +0; hand (small) + forceful (powerful)
		expect(out.damage).toBe("d6 (hand, forceful)");
		expect(out.tags).toContain("craven");
		expect(out.exceptional).toBe(false);
		expect(out.isGroup).toBe(true);
		expect(out.size).toBe(5);
		expect(out.moves).toBe("Wriggle free of danger/restraint\nDissolve organic material");
		expect(out.sourceUuid).toBe(SERVANT_SOURCE_UUID);
		expect(out.repeatable).toBe(true);
	});

	it("resolves a solitary, large, exceptional servant with tentacles + claws", () => {
		const out = resolveServantBatch({
			aspectDie:    { tags: 4, number: 4, size: 4, traits: 2, moves: 1 },
			count:        1,
			chosenTraits: ["tentacles", "claws"],
			chosenMoves:  ["Mesmerize the weak-willed"],
		});
		// solitary base HP 12, large +4 → 16
		expect(out.hp).toBe(16);
		// d10 base; large +1 flat; ranges close+reach, plus tentacle/claw damage tags (deduped)
		expect(out.damage).toBe("d10+1 (close, reach, grabby, 1 piercing, messy)");
		expect(out.exceptional).toBe(true);
		// A 4 on Tags grants no literal tag — only the exceptional flag.
		expect(out.tags).toEqual(SERVANT_BASE_TAGS);
		expect(out.isGroup).toBe(false);
		expect(out.size).toBe(0);
		expect(out.typeLabel).toBe("deep one");
		expect(out.name).toBe("Servant of Daagon");
		expect(out.pronoun).toBe("it");
	});

	it("adds the stealthy trait's tags and defaults the group name", () => {
		const out = resolveServantBatch({
			aspectDie:    { tags: 3, number: 2, size: 2, traits: 1, moves: 0 },
			count:        4,
			chosenTraits: ["stealthy"],
		});
		expect(out.tags).toEqual(expect.arrayContaining(["cunning", "stealthy", "cautious"]));
		expect(out.name).toBe("Servants of Daagon");
		expect(out.typeLabel).toBe("deep ones");
		expect(out.pronoun).toBe("they");
		expect(out.armor).toBe(0);
	});

	it("tolerates a half-finished assignment for a live preview", () => {
		const out = resolveServantBatch({ aspectDie: {}, chosenTraits: [], chosenMoves: [] });
		expect(out).toBeTruthy();
		expect(out.tags).toEqual(SERVANT_BASE_TAGS);
		expect(typeof out.damage).toBe("string");
	});
});

describe("buildServantFollower", () => {
	it("builds a valid stored custom-follower carrying the exceptional flag", () => {
		const input = resolveServantBatch({
			aspectDie: { tags: 4, number: 4, size: 2, traits: 1, moves: 1 },
			count:     1,
			chosenTraits: ["hide"],
			chosenMoves:  ["Wriggle free of danger/restraint"],
		});
		const f = buildServantFollower(input);
		expect(f.name).toBe("Servant of Daagon");
		expect(f.hpMax).toBe(12);
		expect(f.hpCurrent).toBe(12);
		expect(f.armor).toBe(2);
		expect(f.exceptional).toBe(true);
		expect(f.sourceUuid).toBe(SERVANT_SOURCE_UUID);
		expect(Number.isInteger(f.hpMax)).toBe(true);
	});

	it("defaults a non-exceptional batch's flag to false", () => {
		const input = resolveServantBatch({ aspectDie: { tags: 1, number: 2, size: 2, traits: 0, moves: 0 }, count: 3 });
		expect(buildServantFollower(input).exceptional).toBe(false);
	});
});
