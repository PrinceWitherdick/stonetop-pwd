import { describe, it, expect } from "vitest";
import {
	WEAPON_META, weaponMeta,
	isMeleeWeapon, isThrownWeapon, isRangedWeapon,
	isClashWeapon, isLetFlyWeapon, isMessyWeapon, isForcefulWeapon,
} from "../../module/data/weapons.js";

describe("weaponMeta", () => {
	it("returns metadata for a known weapon slug", () => {
		expect(weaponMeta("sword")?.name).toBe("Sword");
	});

	it("returns null for tools / supplies / write-ins", () => {
		expect(weaponMeta("supplies")).toBeNull();
		expect(weaponMeta("my-homebrew-axe")).toBeNull();
	});
});

describe("melee / thrown / ranged classification", () => {
	it("classifies a plain melee weapon", () => {
		const staff = weaponMeta("staff");
		expect(isMeleeWeapon(staff)).toBe(true);
		expect(isThrownWeapon(staff)).toBe(false);
		expect(isRangedWeapon(staff)).toBe(false);
	});

	it("treats a thrown melee weapon (Spear) as BOTH Clash and Let Fly", () => {
		const spear = weaponMeta("spear");
		expect(isClashWeapon(spear)).toBe(true);   // close
		expect(isLetFlyWeapon(spear)).toBe(true);  // thrown
	});

	it("classifies a bow as Let Fly only", () => {
		const bow = weaponMeta("composite-bow");
		expect(isClashWeapon(bow)).toBe(false);
		expect(isLetFlyWeapon(bow)).toBe(true);
	});

	it("guards against null meta", () => {
		expect(isMeleeWeapon(null)).toBe(false);
		expect(isLetFlyWeapon(undefined)).toBe(false);
	});
});

describe("mechanical fields", () => {
	it("carries the Sword's +1 damage", () => {
		expect(weaponMeta("sword").damageBonus).toBe(1);
	});

	it("records the battleaxe as messy, not +1 damage (pack-note data bug corrected)", () => {
		const axe = weaponMeta("battleaxe");
		expect(axe.tags).toContain("messy");
		expect(axe.damageBonus).toBe(0);
	});

	it("gives the warhammer fixed 2 piercing and iron weapons 'prosperity' piercing", () => {
		expect(weaponMeta("warhammer").piercing).toBe(2);
		expect(weaponMeta("spear").piercing).toBe("prosperity");
	});

	it("models naphtha as an area, armor-ignoring weapon with its own d8", () => {
		const n = weaponMeta("naphtha");
		expect(n.area).toBe(true);
		expect(n.ignoresArmor).toBe(true);
		expect(n.damageDie).toBe("d8");
	});

	it("flags messy weapons from meta and from a serialized card weapon", () => {
		expect(isMessyWeapon(weaponMeta("battleaxe"))).toBe(true);
		expect(isMessyWeapon(weaponMeta("mattock"))).toBe(true);
		expect(isMessyWeapon(weaponMeta("sword"))).toBe(false);
		expect(isMessyWeapon({ name: "Battleaxe", tags: ["messy"] })).toBe(true);
		expect(isMessyWeapon(null)).toBe(false);
		expect(isMessyWeapon({ name: "Fists" })).toBe(false);
	});

	it("flags forceful weapons from meta and from a serialized card weapon", () => {
		expect(isForcefulWeapon(weaponMeta("maul"))).toBe(true);
		expect(isForcefulWeapon(weaponMeta("mace-or-flail"))).toBe(true);
		expect(isForcefulWeapon(weaponMeta("sword"))).toBe(false);
		expect(isForcefulWeapon({ name: "Maul", tags: ["forceful", "awkward"] })).toBe(true);
		expect(isForcefulWeapon(null)).toBe(false);
		expect(isForcefulWeapon({ name: "Fists" })).toBe(false);
	});

	it("every weapon record has a name and a range", () => {
		for (const [slug, meta] of Object.entries(WEAPON_META)) {
			expect(meta.name, slug).toBeTruthy();
			expect(Array.isArray(meta.range) && meta.range.length, slug).toBeTruthy();
		}
	});
});
