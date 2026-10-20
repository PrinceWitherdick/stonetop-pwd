import { describe, it, expect } from "vitest";
import { orderedAttackButton, orderedAttackTierActions } from "../../module/fight/follower-order-attack.js";

// An ordered Clash or Let Fly that hits deals the follower's damage (Book I p.462: "they trigger the move"),
// from a button on the order's card: on a 10+ and a 7-9, never on a miss.

describe("orderedAttackTierActions", () => {
	it("puts the damage button on both hits and nothing on a miss", () => {
		const actions = orderedAttackTierActions({ ftype: "crew", slug: "", name: "The Wolves", move: "clash" });
		expect(Object.keys(actions)).toEqual(["success", "partial"]);
		expect(actions.success).toBe(actions.partial);
	});

	it("names the follower, and carries which card and move to roll", () => {
		const html = orderedAttackButton({ ftype: "custom", slug: "a1", name: "Andras", move: "let-fly" });
		expect(html).toContain('class="stonetop-follower-order-damage"');
		expect(html).toContain('data-ftype="custom"');
		expect(html).toContain('data-slug="a1"');
		expect(html).toContain('data-move="let-fly"');
		expect(html).toContain("Andras");
	});

	it("escapes a name typed on the card", () => {
		expect(orderedAttackButton({ ftype: "custom", slug: "x", name: "<b>Bo</b>", move: "clash" })).not.toContain("<b>Bo</b>");
	});
});
