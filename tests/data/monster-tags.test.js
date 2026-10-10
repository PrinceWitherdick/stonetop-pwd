import { describe, it, expect } from "vitest";
import { findMonsterTag, MONSTER_TAGS } from "../../module/data/monster-tags.js";

describe("findMonsterTag", () => {
	it("looks up tags case- and whitespace-insensitively", () => {
		expect(findMonsterTag("Terrifying")).toBe(MONSTER_TAGS.terrifying);
		expect(findMonsterTag("  SOLITARY ")).toBe(MONSTER_TAGS.solitary);
	});

	it("returns null for unknown / flavor tags and empty input", () => {
		expect(findMonsterTag("grumpy")).toBeNull();
		expect(findMonsterTag("")).toBeNull();
		expect(findMonsterTag(null)).toBeNull();
		expect(findMonsterTag(undefined)).toBeNull();
	});

	it("explains the book's own tags in the book's own words (Book I pp.395-398)", () => {
		expect(findMonsterTag("construct")).toBe("Made by someone.");
		expect(findMonsterTag("fae")).toBe("Between physical and spiritual.");
		expect(findMonsterTag("spirit")).toBe("Lacks physical form.");
		expect(findMonsterTag("terrifying")).toBe("Disturbing or terrible presence.");
		expect(findMonsterTag("tiny")).toBe("Cat-sized or smaller: -2 HP, -2 damage, +1 armor, and its attack's range is one step lower.");
		expect(findMonsterTag("huge")).toBe("Like an elephant, or bigger: +8 HP, +3 damage, and its attack gains a range.");
		// Nothing the book does not say: no immunities, no Faerie, no "steeling yourself".
		const all = Object.values(MONSTER_TAGS).join(" ");
		expect(all).not.toMatch(/immune|Faerie|steeling|hard to hit|hard to harm/i);
	});

	it("covers the organization and size terms", () => {
		for (const term of ["solitary", "group", "horde", "tiny", "small", "large", "huge"]) {
			expect(findMonsterTag(term)).toBeTypeOf("string");
		}
	});
});
