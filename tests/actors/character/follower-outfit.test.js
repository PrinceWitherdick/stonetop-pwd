import { describe, it, expect, vi } from "vitest";
import { followerOutfitSnapshot, gearAfterOutfit, followerOutfitLoad, FollowerOutfitter } from "../../../module/actors/character/follower-outfit.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

// "Followers need to Outfit, too!" (Book I p.306), "just like PCs" (p.310): the character's own Outfit window
// over the village catalog, writing to the follower's gear checklist.

const PC_OUTFIT = {
	regularSegments: [{ items: [{ slug: "spear", name: "Spear", weight: 1 }, { slug: "shield", name: "Shield", weight: 2 }] }],
	smallItems: [{ slug: "rope", name: "Rope" }],
	smallGridItems: [{ slug: "torch", name: "Torches" }],
	arcanaRegular: [{ slug: "orb", name: "The Orb", weight: 1 }],
	possessionRegular: [{ slug: "symbol", name: "Personal symbol", weight: 1 }],
	smallItemLimit: 6, prosperityKnown: true,
};

describe("followerOutfitSnapshot", () => {
	it("offers the village catalog marked by what they carry, and nothing that is only the character's", () => {
		const snap = followerOutfitSnapshot(PC_OUTFIT, [{ label: "spear", checked: true }, { label: "Rope", checked: false }], { regular: 2 });
		expect(snap.regularSegments[0].items.map(i => [i.slug, i.checked])).toEqual([["spear", true], ["shield", false]]);
		expect(snap.smallItems[0].checked).toBe(false);
		expect(snap).not.toHaveProperty("arcanaRegular");
		expect(snap).not.toHaveProperty("possessionRegular");
		expect(snap.smallItemLimit).toBe(6);
		expect(snap.regularPool.current).toBe(2);
		expect(snap.loadBonus).toBe(0);
	});
});

describe("gearAfterOutfit", () => {
	it("ticks what was marked, unticks what was not, adds what is new and leaves a hand-written line alone", () => {
		const gear = [{ label: "Spear", checked: true }, { label: "lucky stone", checked: true }, { label: "Shield", checked: true }];
		const items = [...PC_OUTFIT.regularSegments[0].items, ...PC_OUTFIT.smallItems];
		expect(gearAfterOutfit(gear, items, { spear: true, shield: false, rope: true })).toEqual([
			{ label: "Spear", checked: true },
			{ label: "lucky stone", checked: true },
			{ label: "Shield", checked: false },
			{ label: "Rope", checked: true },
		]);
	});
});

describe("followerOutfitLoad", () => {
	it("weighs the marked regular items and the ◇ in reserve", () => {
		const items = PC_OUTFIT.regularSegments[0].items;
		expect(followerOutfitLoad(items, { spear: true }, 0)).toBe("light");
		expect(followerOutfitLoad(items, { spear: true, shield: true }, 2)).toBe("normal");
		expect(followerOutfitLoad(items, {}, 0)).toBeNull();
	});
});

describe("FollowerOutfitter", () => {
	it("writes the follower's list and what the Outfit came to, under the move's name", async () => {
		const character = { id: "cadi", flags: { [SYSTEM_ID]: { customFollowers: { a1: { gear: [] } } } }, update: vi.fn(async () => {}) };
		const outfitter = new FollowerOutfitter(character, "custom", "a1", PC_OUTFIT);
		expect(outfitter._actor.id).toBe("cadi-custom-a1");
		await outfitter.applyOutfit({ spear: true }, 1, 0);
		expect(character.update).toHaveBeenCalledWith({
			[`flags.${SYSTEM_ID}.customFollowers.a1.gear`]: [{ label: "Spear", checked: true }],
			[`flags.${SYSTEM_ID}.customFollowers.a1.outfit`]: { regular: 1, small: 0, load: "light" },
		}, { stonetopMove: "Outfit" });
	});
});
