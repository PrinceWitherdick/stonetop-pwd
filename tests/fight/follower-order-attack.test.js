import { describe, it, expect, vi } from "vitest";
import {
	orderedAttackButton, orderedAttackTierActions, orderedBlowFormula, orderedPress, depleteFollowerAmmo, followerUsesAmmo, orderedFoeBodies,
} from "../../module/fight/follower-order-attack.js";
import { SYSTEM_ID } from "../../module/system-id.js";

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

// FOE-3/4/5/10: the whole group at one foe adds +1 per other attacker; Clash's 10+ strike hard adds 1d6 and the
// counter-blow; one member ordered on their own is one attacker; Let Fly's 7-9 can deplete the card's ammo.
describe("an ordered blow", () => {
	it("a whole group at one foe rolls one attacker's die +1 for each other standing (p.473)", () => {
		expect(orderedBlowFormula("d6", { standing: 2, foes: 1 })).toBe("d6+1");
		expect(orderedBlowFormula("d6", { standing: 5, foes: 1 })).toBe("d6+4");
		// At several foes, each is rolled on its own die; one member is one attacker.
		expect(orderedBlowFormula("d6", { standing: 5, foes: 3 })).toBe("d6");
		expect(orderedBlowFormula("d6", { standing: 5, foes: 1, member: true })).toBe("d6");
		expect(orderedBlowFormula("d8+1", { standing: 1, foes: 1, extraDice: ["1d6"] })).toBe("d8+1+1d6");
	});

	it("reads Clash's ticked 10+ strike hard as 1d6 and a counter-blow, and a 7-9 as the counter alone", () => {
		const strike = "Strike hard and fast, for 1d6 extra damage, but suffer your enemy's attack";
		expect(orderedPress("clash", "success", [strike])).toEqual({ counter: true, extraDice: ["1d6"] });
		expect(orderedPress("clash", "success", ["Avoid, prevent, or counter your enemy's attack"])).toEqual({ counter: false, extraDice: [] });
		expect(orderedPress("clash", "partial", [strike])).toEqual({ counter: true, extraDice: [] });
		expect(orderedPress("let-fly", "partial", [])).toEqual({ counter: false, extraDice: [] });
	});

	it("carries the member ordered on their own on the button", () => {
		const html = orderedAttackButton({ ftype: "crew", name: "Glaw", move: "clash", member: "named:0", memberName: "Glaw" });
		expect(html).toContain('data-member="named:0"');
		expect(html).toContain('data-member-name="Glaw"');
		expect(orderedAttackButton({ ftype: "crew", name: "The Crew", move: "clash" })).not.toContain("data-member");
	});

	it("puts the deplete button on an ordered Let Fly's 7-9 only for a card that tracks ammo", () => {
		const shooting = orderedAttackTierActions({ ftype: "crew", slug: "", name: "The Crew", move: "let-fly", usesAmmo: true });
		expect(shooting.partial).toContain("stonetop-follower-order-deplete");
		expect(shooting.success).not.toContain("stonetop-follower-order-deplete");
		expect(orderedAttackTierActions({ ftype: "crew", move: "let-fly", usesAmmo: false }).partial).not.toContain("deplete");
		expect(orderedAttackTierActions({ ftype: "crew", move: "clash", usesAmmo: true }).partial).not.toContain("deplete");
	});

	it("depletes the card's next ammo status, and says when it is all out", async () => {
		const flags = { crew: { ammo: 0 } };
		const character = { name: "Rhianna", flags: { [SYSTEM_ID]: flags }, update: vi.fn(async data => { flags.crew.ammo = data[`flags.${SYSTEM_ID}.crew.ammo`]; }) };
		const savedUi = globalThis.ui;
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
		try {
			expect(await depleteFollowerAmmo(character, { ftype: "crew", name: "The Crew" })).toBe("Low ammo");
			expect(await depleteFollowerAmmo(character, { ftype: "crew", name: "The Crew" })).toBe("All out");
			expect(await depleteFollowerAmmo(character, { ftype: "crew", name: "The Crew" })).toBeNull();
			expect(globalThis.ui.notifications.warn).toHaveBeenCalledTimes(1);
			expect(followerUsesAmmo({ crew: { details: { usesAmmo: true } } }, "crew")).toBe(true);
			expect(followerUsesAmmo({}, "crew")).toBe(false);
		} finally {
			globalThis.ui = savedUi;
		}
	});

	it("counts the foes the blow is aimed at: the roller's targets, else the follower's fight, else one", () => {
		const foe = { actor: { type: "monster", system: {} } };
		expect(orderedFoeBodies({ character: {}, targets: [foe], engagement: () => null })).toBe(1);
		expect(orderedFoeBodies({ character: {}, targets: [foe, foe], engagement: () => null })).toBe(2);
		const place = { entry: { melee: ["a"], shootingAt: [] }, fighters: [{ id: "a", bodies: 6 }] };
		expect(orderedFoeBodies({ character: {}, targets: [], engagement: () => place })).toBe(6);
		expect(orderedFoeBodies({ character: {}, targets: [], engagement: () => null })).toBe(1);
		// Never one inside a group-against-group exchange (p.416), as the token's swarm die reads it.
		const exchange = { ...place, combatant: { id: "crew" }, fighters: [{ id: "a", bodies: 1 }], result: { clusters: [{ heroIds: ["crew"], foeIds: ["a"], groups: {} }] } };
		expect(orderedFoeBodies({ character: {}, targets: [foe], engagement: () => exchange })).toBeGreaterThan(1);
	});
});
