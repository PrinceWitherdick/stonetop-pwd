import { describe, it, expect } from "vitest";
import { beastFollowerForAsset, followerInputFromBeast, BEAST_CATALOG } from "../../module/data/beasts.js";

// Requisition → follower bridge: a steading asset naming a follower-capable animal
// (the town's horses, a mule, a dog) can be added to the Followers tab.

describe("beastFollowerForAsset", () => {
	it("matches the town's draft horses to the horse stat block", () => {
		const m = beastFollowerForAsset("A pair of hardy draft horses");
		expect(m?.slug).toBe("horse");
		expect(m?.beast.hp).toBe(10);
	});

	it("matches mules and dogs (and hounds)", () => {
		expect(beastFollowerForAsset("A sturdy mule")?.slug).toBe("mule");
		expect(beastFollowerForAsset("Good hunting dog")?.slug).toBe("dog-follower");
		expect(beastFollowerForAsset("A pack of hounds")?.slug).toBe("dog-follower");
	});

	it("counts the animals an asset names, and only a plain count", () => {
		expect(beastFollowerForAsset("A pair of hardy draft horses").count).toBe(2);
		expect(beastFollowerForAsset("Three ponies").count).toBe(3);
		expect(beastFollowerForAsset("4 mules").count).toBe(4);
		expect(beastFollowerForAsset("A sturdy mule").count).toBe(1);
		expect(beastFollowerForAsset("A pack of hounds").count).toBe(1);
	});

	it("reads a count only where it leads the name", () => {
		expect(beastFollowerForAsset("Old mare - HP 10; d6+3 dmg").count).toBe(1);
		expect(beastFollowerForAsset("A horse named Six-Toes").count).toBe(1);
		expect(beastFollowerForAsset("Mule, 4 years old").count).toBe(1);
		expect(beastFollowerForAsset("A brace of hounds").count).toBe(2);
	});

	it("does not read horse-drawn gear or horse harness as horses", () => {
		expect(beastFollowerForAsset("A pair of horse-drawn plows, iron")).toBeNull();
		expect(beastFollowerForAsset("A pair of carts (plus horse harness)")).toBeNull();
		expect(beastFollowerForAsset("A wagon (plus horse harness)")).toBeNull();
		expect(beastFollowerForAsset("A cart and a horse")?.slug).toBe("horse");
	});

	it("takes a row's structured beast field over its name", () => {
		const m = beastFollowerForAsset({ name: "The old greys", beast: { slug: "horse", count: 2, traits: ["swift"] } });
		expect(m).toMatchObject({ slug: "horse", count: 2, chosenTraits: ["swift"] });
		expect(beastFollowerForAsset({ name: "A horse-shaped weathervane", beast: null })).toBeNull();
		expect(beastFollowerForAsset({ name: "A sturdy mule" })?.slug).toBe("mule");
	});

	it("does not match livestock or non-animals (not proper followers)", () => {
		expect(beastFollowerForAsset("A cart of grain")).toBeNull();
		expect(beastFollowerForAsset("Three goats")).toBeNull();
		expect(beastFollowerForAsset("A fine sword")).toBeNull();
		expect(beastFollowerForAsset("")).toBeNull();
	});
});

describe("followerInputFromBeast", () => {
	it("turns a beast catalog entry into buildCustomFollower input", () => {
		const input = followerInputFromBeast(BEAST_CATALOG.horse, { name: "Fflur" });
		expect(input.name).toBe("Fflur");
		expect(input.hp).toBe(10);
		expect(input.damage).toBe("d6+3 (hand, close, forceful)");
		expect(input.instinct).toBe("panic");
		expect(input.cost).toBe("care & grooming");
	});

	it("returns null for a missing beast", () => {
		expect(followerInputFromBeast(null)).toBeNull();
	});

	it("records which beast it was made from, for what the animal eats", () => {
		expect(followerInputFromBeast(BEAST_CATALOG["dog-follower"]).beastSlug).toBe("dog-follower");
		expect(followerInputFromBeast(BEAST_CATALOG.mule).beastSlug).toBe("mule");
		expect(followerInputFromBeast({ ...BEAST_CATALOG.mule }).beastSlug).toBe("");
	});

	it("carries an open tag choice into the follower's notes", () => {
		expect(followerInputFromBeast(BEAST_CATALOG["dog-follower"]).notes).toBe("Tags still to choose: pick 2 more.");
		expect(followerInputFromBeast(BEAST_CATALOG.horse).notes).toBe("Tags still to choose: swift or hardy.");
		expect(followerInputFromBeast(BEAST_CATALOG.goat).notes).toBe("");
	});

	it("makes the steading's hardy draft horses hardy, with the choice settled", () => {
		// The Stonetop steading playbook's asset line, as the steading seeds it.
		const match = beastFollowerForAsset("A pair of hardy draft horses, HP 10 each; d6+3 dmg (hand, close, forceful)");
		expect(match.chosenTraits).toEqual(["hardy"]);
		const input = followerInputFromBeast(match.beast, { chosenTraits: match.chosenTraits });
		expect(input.tags).toEqual(["large", "powerful", "keen-nosed", "hardy"]);
		expect(input.notes).toBe("");
	});

	it("settles nothing when the asset names no option", () => {
		expect(beastFollowerForAsset("Good hunting dog").chosenTraits).toEqual([]);
		expect(beastFollowerForAsset("A sturdy mule").chosenTraits).toEqual([]);
	});
});
