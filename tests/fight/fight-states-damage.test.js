import { describe, it, expect } from "vitest";
import { ownDamageMode, blowOffers } from "../../module/fight/hero-moves.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// Two of the fight states on a character's own damage (actors/character/fight-states.js): shaken nerves
// ("disadvantage on all rolls") folding into the damage die's mode beside Dangerous, and the Storm
// Markings' "+1 damage until you calm down" as a ticked line in the damage window.

function hero({ moves = [], arcana = [], flags = {} } = {}) {
	const actor = {
		id: "h", name: "Hale", type: "character",
		items: moves.map(name => ({ type: "move", name, flags: {} })),
		flags: { [SYSTEM_ID]: { arcana: { owned: arcana }, ...flags } },
		getFlag: (scope, path) => path.split(".").reduce((v, k) => v?.[k], actor.flags[scope]),
	};
	return actor;
}

describe("shaken nerves on the damage die", () => {
	it("rolls a shaken character's damage at disadvantage", () => {
		expect(ownDamageMode(hero({ flags: { shakenNerves: true } }), "")).toBe("dis");
	});

	it("cancels against Dangerous rather than stepping past it", () => {
		const heavy = hero({ moves: ["Dangerous"], flags: { shakenNerves: true } });
		expect(ownDamageMode(heavy, "")).toBe("normal");
		// A strike back's disadvantage too: adv and dis both spoke, so it is straight.
		expect(ownDamageMode(heavy, "dis")).toBe("normal");
	});

	it("is Dangerous alone for a steady character", () => {
		expect(ownDamageMode(hero({ moves: ["Dangerous"] }), "")).toBe("adv");
		expect(ownDamageMode(hero(), "")).toBe("");
	});
});

describe("roiling with anger", () => {
	const roiling = offers => offers.find(o => o.key === "roiling");

	it("offers the Storm Markings' +1, ticked, while they roil", () => {
		const line = roiling(blowOffers(hero({ arcana: ["storm-markings"], flags: { roiling: true } })));
		expect(line).toMatchObject({ dice: "1", applied: true });
		expect(line.label).toBe("Roiling with anger: +1 damage");
		expect(line.pill).toBe("Storm Markings +1");
	});

	it("offers nothing once they calm down, or without the card", () => {
		expect(roiling(blowOffers(hero({ arcana: ["storm-markings"] })))).toBeUndefined();
		expect(roiling(blowOffers(hero({ flags: { roiling: true } })))).toBeUndefined();
	});
});
