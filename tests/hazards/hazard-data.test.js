import { describe, it, expect } from "vitest";
import {
	HAZARD_DAMAGE_DICE, HAZARD_DAMAGE_EFFECTS,
	resolveDamageEffects, formatHazardDamage,
} from "../../module/hazards/hazard-data.js";
import { hazardDamageLine } from "../../module/hazards/hazard-view.js";

describe("hazard damage worksheet (Book I, Dangers p. 383)", () => {
	it("offers the book's four dice plus a no-damage option", () => {
		expect(HAZARD_DAMAGE_DICE.map(d => d.id)).toEqual(["", "d4", "d6", "d8", "d10"]);
	});

	it("resolves effect picks to tags and a flat bonus", () => {
		const { tags, bonus } = resolveDamageEffects(["ignoresArmor", "forceful", "big"]);
		expect(tags).toEqual(["ignores armor", "forceful"]);
		expect(bonus).toBe(2);
	});

	it("dedupes overlapping tags across effects", () => {
		// pierce1 and pierce3 both carry "messy".
		const { tags } = resolveDamageEffects(["pierce1", "pierce3"]);
		expect(tags.filter(t => t === "messy")).toHaveLength(1);
	});

	it("ignores unknown effect ids", () => {
		expect(resolveDamageEffects(["nope"])).toEqual({ tags: [], bonus: 0 });
	});

	it("formats the book's example line (the crinwin-nest climb, p. 385)", () => {
		expect(formatHazardDamage({ die: "d10", bonus: 2, tags: ["ignores armor", "forceful"] }))
			.toBe("1d10+2 (ignores armor, forceful)");
	});

	it("formats a bare die with no tags or bonus", () => {
		expect(formatHazardDamage({ die: "d6" })).toBe("1d6");
	});

	it("returns nothing for a no-damage hazard", () => {
		expect(formatHazardDamage({ die: "" })).toBe("");
	});

	it("certain death replaces the roll outright", () => {
		expect(formatHazardDamage({ die: "d10", tags: ["forceful"], certainDeath: true }))
			.toMatch(/^certain death/);
	});

	it("every effect contributes tags or a bonus (no dead picks)", () => {
		for (const e of HAZARD_DAMAGE_EFFECTS) {
			expect(e.tags.length > 0 || e.bonus > 0).toBe(true);
		}
	});
});

describe("hazardDamageLine (stored system data -> card line)", () => {
	it("combines effect picks with free-form extras, deduped", () => {
		const line = hazardDamageLine({
			damageDie: "d8",
			damageEffects: ["pierce1", "big"],
			damageExtra: "area, messy",
		});
		expect(line).toBe("1d8+2 (1 piercing, messy, area)");
	});

	it("prefers certain death over the worksheet", () => {
		expect(hazardDamageLine({ damageDie: "d4", certainDeath: true })).toMatch(/Death's Door/);
	});

	// p.383 is "choose all that apply", so both piercing rows stay tickable, but the line carries
	// one piercing value: the larger, which already covers the smaller.
	it("prints one piercing tag, the larger, when both piercing rows are ticked", () => {
		expect(hazardDamageLine({ damageDie: "d8", damageEffects: ["pierce1", "pierce3"] }))
			.toBe("1d8 (3 piercing, messy)");
		expect(hazardDamageLine({ damageDie: "d8", damageEffects: ["pierce3", "pierce1", "forceful"] }))
			.toBe("1d8 (3 piercing, messy, forceful)");
		expect(hazardDamageLine({ damageDie: "d6", damageEffects: ["pierce1"], damageExtra: "2 piercing, area" }))
			.toBe("1d6 (2 piercing, messy, area)");
		expect(hazardDamageLine({ damageDie: "d6", damageEffects: ["pierce1"] })).toBe("1d6 (1 piercing, messy)");
	});
});
