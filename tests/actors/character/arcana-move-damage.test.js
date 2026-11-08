import { describe, expect, it } from "vitest";
import { arcanumMoveDamage, arcanumMoveDamageActions } from "../../../module/actors/character/arcana-move-damage.js";

// Audit EDG-4 (2026-11-06): damage printed in an arcanum move's results (Book II) is a button on its roll card.

const scepter = `<p><strong>BURNING HATRED</strong> (<em>near, magical, reload</em>)<br>When you <strong><em>point the Red Scepter at an object of your hatred and erase 1 charge</em></strong>, roll +CHA: <strong>on a 10+</strong>, the Scepter deals 2d4 damage (<em>messy, ignores armor</em>), manifested as blistering burns; <strong>on a 7-9</strong>, as a 10+ but pick 1: Mark a consequence / Spend a few seconds chanting and muttering before dealing damage / Cause any exposed, combustible items in range to burst into flames. <strong>On a 6-</strong>, the GM says what happens (which may or may not involve marking a consequence).</p>`;
const siphon = `<p>When you raise your ringed hand and will the ring to consume someone's life-force (at up to reach range), roll +CON: on a 10+, deal 1d10 damage (<em>grabby, ignores armor</em>); on a 7-9, deal 1d10 damage (<em>ignores armor</em>) but choose one: The ring eats at your life-force, too—lose 1d10 HP and mark a debility / Mark a consequence. On a 6-, the GM says what happens.</p>`;

describe("the damage an arcanum's move deals", () => {
	it("reads Burning Hatred's 10+, and its 7-9 'as a 10+' (Book II pp.558-559)", () => {
		const dealt = arcanumMoveDamage(scepter);
		expect(dealt.success).toMatchObject({ formula: "2d4", ignoresArmor: true, self: false });
		expect(dealt.success.tags).toContain("messy");
		expect(dealt.partial).toMatchObject({ formula: "2d4", ignoresArmor: true });
	});

	it("reads Siphon's own 7-9 blow, and leaves its 'lose 1d10 HP' to the roller (pp.572-573)", () => {
		const dealt = arcanumMoveDamage(siphon);
		expect(dealt.success).toMatchObject({ formula: "1d10", ignoresArmor: true, self: false });
		expect(dealt.partial).toMatchObject({ formula: "1d10", ignoresArmor: true, self: false });
	});

	it("aims the roller's own harm at the roller", () => {
		const dealt = arcanumMoveDamage("<p>Roll +WIS: on a 10+, you learn the truth; on a 7-9, you learn it, but you take 2d4 damage (ignores armor).</p>");
		expect(dealt.success).toBeUndefined();
		expect(dealt.partial).toMatchObject({ formula: "2d4", self: true });
	});

	it("draws the post-death card's move-damage button on each hit tier, and nothing for a move that deals none", () => {
		const actions = arcanumMoveDamageActions(scepter, "Burning Hatred");
		expect(actions.success).toContain("stonetop-pd-move-damage");
		expect(actions.success).toContain('data-formula="2d4"');
		expect(actions.success).toContain('data-ignores="1"');
		expect(actions.success).toContain('data-move="Burning Hatred"');
		expect(actions.success).not.toContain("data-self");
		expect(actions.failure).toBeUndefined();
		expect(arcanumMoveDamageActions("<p>Roll +INT: on a 10+, ask 3; on a 7-9, ask 1.</p>", "Lore")).toBeNull();
		expect(arcanumMoveDamageActions("", "Nothing")).toBeNull();
	});
});
