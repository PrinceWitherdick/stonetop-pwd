import { describe, it, expect, vi } from "vitest";
import { burnBrightlyAffordable, burnBrightlyTooltipKey, burnsBrightlyDriven, BURN_BRIGHTLY_COST, DRIVEN } from "../../../module/actors/character/burn-brightly.js";
import { adjustXp } from "../../../module/utils/xp.js";

// Burn Brightly: "When you have enough XP to Level Up, you may spend 2 XP after any roll you make to add +1".
// The Would-Be Hero's Driven: "You always have the option to Burn Brightly; you can spend 2 XP after you roll to
// add +1, even if you don't have enough XP to level."

const SCOPE = "stonetop-pwd";

function hero({ background = null, playbook = "The Would-Be Hero", xp = 0, level = 1 } = {}) {
	const actor = {
		type: "character", uuid: `Actor.${Math.random()}`,
		system: { playbook: { name: playbook }, attributes: { xp: { value: xp }, level: { value: level } } },
		flags: { [SCOPE]: background ? { background: { selected: background } } : {} },
		update: vi.fn(async data => { actor.system.attributes.xp.value = data["system.attributes.xp.value"]; }),
	};
	return actor;
}

describe("burnBrightlyAffordable", () => {
	it("asks everyone else for the level-up total", () => {
		const other = hero({ background: "impetuous-youth" });
		expect(burnBrightlyAffordable(other, 7, 1)).toBe(false);
		expect(burnBrightlyAffordable(other, 8, 1)).toBe(true);
		expect(burnBrightlyAffordable(other, 9, 2)).toBe(false);
	});

	it("asks a Driven Would-Be Hero only for the 2 XP it costs, whatever the level", () => {
		const driven = hero({ background: "driven" });
		expect(burnsBrightlyDriven(driven)).toBe(true);
		expect(burnBrightlyAffordable(driven, 2, 5)).toBe(true);
		expect(burnBrightlyAffordable(driven, 1, 1)).toBe(false);
		expect(burnBrightlyAffordable(driven, 0, 1)).toBe(false);
	});

	it("is the Would-Be Hero's Driven only: another playbook's background of that slug is not it", () => {
		const other = hero({ background: "driven", playbook: "The Heavy" });
		expect(burnsBrightlyDriven(other)).toBe(false);
		expect(burnBrightlyAffordable(other, 2, 1)).toBe(false);
		expect(DRIVEN).toMatchObject({ playbook: "The Would-Be Hero", slug: "driven" });
	});
});

// Book I p.582: "Let players always Burn Brightly, even if they lack the XP to Level Up." A world setting.
describe("the world's always-Burn-Brightly rule", () => {
	it("lets anyone spend 2 XP below the level-up total, and says so on the button", () => {
		const other = hero({ background: "impetuous-youth" });
		expect(burnBrightlyAffordable(other, 2, 3)).toBe(false);
		expect(burnBrightlyTooltipKey(other)).toBe("tooltip");
		const saved = global.game.settings;
		global.game.settings = { get: (_scope, key) => key === "burnBrightlyAlways" };
		try {
			expect(burnBrightlyAffordable(other, 2, 3)).toBe(true);
			expect(burnBrightlyAffordable(other, 1, 3)).toBe(false);
			expect(burnBrightlyTooltipKey(other)).toBe("alwaysTooltip");
			expect(burnBrightlyTooltipKey(hero({ background: "driven" }))).toBe("drivenTooltip");
		} finally {
			global.game.settings = saved;
		}
	});
});

describe("the Burn Brightly spend, refused inside the XP queue", () => {
	const spend = actor => adjustXp(actor, -BURN_BRIGHTLY_COST, {
		move: "Burn Brightly", require: (xp, level) => burnBrightlyAffordable(actor, xp, level),
	});

	it("lets a Driven hero below the threshold spend 2", async () => {
		const driven = hero({ background: "driven", xp: 3, level: 3 });
		const result = await spend(driven);
		expect(result.applied).toBe(true);
		expect(driven.system.attributes.xp.value).toBe(1);
	});

	it("never takes a Driven hero below 0: 1 XP is not enough", async () => {
		const driven = hero({ background: "driven", xp: 1, level: 1 });
		expect((await spend(driven)).applied).toBe(false);
		expect(driven.update).not.toHaveBeenCalled();
	});

	it("still refuses anyone else below the level-up total", async () => {
		const other = hero({ xp: 5, level: 1 });
		expect((await spend(other)).applied).toBe(false);
	});
});
