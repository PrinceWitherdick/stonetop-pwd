import { afterEach, describe, expect, it } from "vitest";
import { WEAPONS_OF_WAR_COMMON, weaponMeta } from "../../module/data/weapons.js";
import { X_PIERCING_MAX, resolvePiercing } from "../../module/utils/damage.js";

/**
 * Weapons of War, on the weapons themselves: "Battleaxes and swords have 'x piercing', where x is
 * the steading's current Prosperity." And how much "x piercing" comes to, which the sheet shows
 * and damage counts the same way.
 */

const SAVED = globalThis.game;
afterEach(() => { globalThis.game = SAVED; });

function withProsperity(value, { lacking = false } = {}) {
	const steading = { type: "stonetop", system: { attributes: { prosperity: { value }, debilities: { options: { lacking: { value: lacking } } } } }, flags: {} };
	globalThis.game = { ...SAVED, actors: { find: fn => [steading].find(fn), get: () => null, filter: fn => [steading].filter(fn), contents: [steading] } };
}

describe("a battleaxe or sword under Weapons of War", () => {
	it("pierces by Prosperity once the improvement is built, and not before", () => {
		for (const slug of ["battleaxe", "sword", "short-sword"]) {
			expect(weaponMeta(slug).piercing, slug).toBe(0);
			expect(weaponMeta(slug, { weaponsOfWar: true }).piercing, slug).toBe("prosperity");
		}
	});

	it("leaves every other weapon as the book prints it", () => {
		expect(weaponMeta("warhammer", { weaponsOfWar: true }).piercing).toBe(2);
		expect(weaponMeta("mace-or-flail", { weaponsOfWar: true }).piercing).toBe(0);
	});

	it("makes common exactly the weapons the improvement names", () => {
		expect([...WEAPONS_OF_WAR_COMMON].sort()).toEqual(["battleaxe", "mace-or-flail", "short-sword", "sword", "warhammer"]);
	});
});

describe("how much x piercing comes to", () => {
	// The Inventory insert's table: "+1: x = 1 piercing", "+2: x = 2 piercing", no higher row.
	it("follows Prosperity up to the insert's last row, and never below 0", () => {
		expect(X_PIERCING_MAX).toBe(2);
		withProsperity(1);
		expect(resolvePiercing("prosperity")).toBe(1);
		withProsperity(3);
		expect(resolvePiercing("prosperity")).toBe(2);
		withProsperity(-1);
		expect(resolvePiercing("prosperity")).toBe(0);
	});

	// Lacking: "Treat Prosperity as if it's 1 lower than it is" (Book I p.513), at damage time
	// exactly as on the sheet's "1 piercing" caption.
	it("counts a Lacking steading's Prosperity as 1 lower", () => {
		withProsperity(2, { lacking: true });
		expect(resolvePiercing("prosperity")).toBe(1);
		withProsperity(1, { lacking: true });
		expect(resolvePiercing("prosperity")).toBe(0);
	});
});
