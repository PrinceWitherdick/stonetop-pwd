import { describe, it, expect } from "vitest";
import {
	possessionFollower, availablePossessionFollowers, POSSESSION_FOLLOWER_CATALOG,
} from "../../module/data/possession-followers.js";

// Playbook possession-followers (the Would-be Hero's dog, the Ranger's Hounds, the
// Blessed's Mastiffs): mirrored as buildCustomFollower inputs so the Followers tab
// can offer a one-click "Add as follower".

describe("possessionFollower", () => {
	it("returns the dog as a single follower with a stable source", () => {
		const dog = possessionFollower("a-good-dog");
		expect(dog.name).toBe("Good dog");
		expect(dog.isGroup).toBeFalsy();
		expect(dog.sourceUuid).toBe("possession:a-good-dog");
	});

	// "follower (☐ retriever or ☐ herder, keen-nosed, clever)": the pick is the player's.
	it("leads the dog's tags with the retriever or herder the player picked", () => {
		expect(possessionFollower("a-good-dog", ["retriever"]).tags).toEqual(["retriever", "keen-nosed", "clever"]);
		expect(possessionFollower("a-good-dog", ["herder"]).tags).toEqual(["herder", "keen-nosed", "clever"]);
	});

	it("leaves the dog's choice off, rather than guessing, when nothing is picked", () => {
		const dog = possessionFollower("a-good-dog");
		expect(dog.tags).toEqual(["keen-nosed", "clever"]);
		expect(dog.choiceTags).toBeUndefined();
	});

	it("returns the Ranger's Hounds and Blessed's Mastiffs as groups", () => {
		expect(possessionFollower("hounds").isGroup).toBe(true);
		expect(possessionFollower("hounds").size).toBe(2);
		expect(possessionFollower("mastiffs").isGroup).toBe(true);
	});

	it("returns null for a non-follower possession", () => {
		expect(possessionFollower("a-sturdy-sword")).toBeNull();
		expect(possessionFollower(undefined)).toBeNull();
	});

	it("every catalog entry carries a possession:<slug> source", () => {
		for (const [slug, entry] of Object.entries(POSSESSION_FOLLOWER_CATALOG)) {
			expect(entry.sourceUuid).toBe(`possession:${slug}`);
		}
	});
});

describe("availablePossessionFollowers", () => {
	it("offers the follower-granting possessions the character holds", () => {
		const offers = availablePossessionFollowers(["a-good-dog", "a-sturdy-sword", "hounds"]);
		expect(offers.map(o => o.slug)).toEqual(["a-good-dog", "hounds"]);
	});

	it("skips ones already materialized (deduped by sourceUuid)", () => {
		const present = new Set(["possession:hounds"]);
		const offers = availablePossessionFollowers(["a-good-dog", "hounds"], present);
		expect(offers.map(o => o.slug)).toEqual(["a-good-dog"]);
	});

	it("returns nothing when the character holds no follower possessions", () => {
		expect(availablePossessionFollowers(["a-sturdy-sword", "an-old-map"])).toEqual([]);
		expect(availablePossessionFollowers([])).toEqual([]);
	});
});
