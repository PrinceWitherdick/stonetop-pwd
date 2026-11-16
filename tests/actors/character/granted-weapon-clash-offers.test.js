// A Clash made with a granted weapon (Purifying Flames' holy light: StonetopCharacterSheet#_rollGrantedWeaponAttack)
// is onRoll's Clash with the stat and the weapon pre-answered. Its window now carries the Clash's own lines
// (roll-offers-sheet.test.js has that wire); these are the other half: the lines it hands on are folded and
// paid for exactly as on any Clash.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem } from "../../fakes/LiveCharacter.js";

// The attack's prompts (weapon, targets) stand in: `begin` answers the Clash as begun, aimed at nobody, and
// records what it was asked with. A Clash's 6- counter-attack is the attack flow's own business.
const seams = vi.hoisted(() => ({ begin: null }));
vi.mock("../../../module/combat/attack-flow.js", async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		maybeBeginAttack: (...args) => (seams.begin ?? real.maybeBeginAttack)(...args),
		maybeCounterOnMiss: async () => false,
	};
});

const SCOPE = "stonetop-pwd";
const BA = "Binding Arbitration";

let begun;
beforeEach(() => {
	begun = [];
	seams.begin = async (actor, item, opts) => {
		begun.push({ item: item.name, ...opts });
		return { messageFlags: { [SCOPE]: { attack: { moveKey: "clash", targets: [] } } } };
	};
});
afterEach(() => { seams.begin = null; });

/** A character with `moves` learned and an owned Clash, rolled the way the granted-weapon path rolls it. */
function clasher({ slug, name, moves = [], flags = {}, total = 8 } = {}) {
	const clash = { _id: "clash-1", name: "Clash", type: "move", system: { rollType: "str" }, roll: vi.fn(async () => ({ total })) };
	const made = buildLiveCharacter({
		slug, name, seedStartingMoves: false, flags,
		items: moves.map(m => makeLiveItem({ name: m, type: "move", system: { moveType: "playbook" } })),
	});
	const items = [...made.actor.items, clash];
	items.get = id => items.find(i => i._id === id) ?? null;
	made.actor.items = items;
	// What _rollGrantedWeaponAttack hands onRoll: the stat the grant rides on, the weapon in hand, and the window's answer.
	const rollWithLight = prompted => made.char.onRoll({
		currentTarget: { closest: sel => (sel === ".item" ? { dataset: { itemId: clash._id } } : null), getAttribute: () => null },
	}, { statOverride: "wis", weaponSlug: "holy-light", ...prompted });
	return { ...made, clash, rollWithLight };
}
const rolledWith = clash => clash.roll.mock.calls.at(-1)[0];

describe("the lines a Clash made with a granted weapon takes", () => {
	it("is offered the Clash's own lines, and a ticked Constant Vigilance is advantage, named", async () => {
		const { char, clash, rollWithLight } = clasher({ slug: "the-ranger", name: "The Ranger", moves: ["Constant Vigilance"] });
		const offered = await char.rollOffers(clash);
		expect(offered.map(o => o.key)).toEqual(["constant-vigilance"]);
		await rollWithLight({ takenOffers: ["constant-vigilance"], offered });
		expect(begun).toEqual([{ item: "Clash", stat: "wis", weaponSlug: "holy-light" }]);
		expect(rolledWith(clash).rollMode).toBe("adv");
		expect(rolledWith(clash).conditionNotes).toContain("Constant Vigilance");
	});

	it("takes Underestimated, and an oathbreaker's line on a Clash aimed at nobody, the same way", async () => {
		const hero = clasher({ slug: "the-would-be-hero", name: "The Would-Be Hero", moves: ["Underestimated"] });
		const heroOffered = await hero.char.rollOffers(hero.clash);
		await hero.rollWithLight({ takenOffers: ["underestimated"], offered: heroOffered });
		expect(rolledWith(hero.clash).rollMode).toBe("adv");
		expect(rolledWith(hero.clash).conditionNotes).toContain("Underestimated");

		const judge = clasher({ slug: "the-judge", name: "The Judge", moves: [BA], flags: { oaths: [{ id: "o1", name: "Brennan", broken: true }] } });
		const judgeOffered = await judge.char.rollOffers(judge.clash);
		expect(judgeOffered.map(o => o.key)).toEqual(["binding-arbitration"]);
		await judge.rollWithLight({ takenOffers: ["binding-arbitration"], offered: judgeOffered });
		expect(rolledWith(judge.clash).rollMode).toBe("adv");
		expect(rolledWith(judge.clash).conditionNotes.filter(n => n === BA)).toHaveLength(1);
	});

	it("left unticked, buys nothing", async () => {
		const { char, clash, rollWithLight } = clasher({ slug: "the-ranger", name: "The Ranger", moves: ["Constant Vigilance"] });
		await rollWithLight({ takenOffers: [], offered: await char.rollOffers(clash) });
		expect(rolledWith(clash).rollMode).toBe("normal");
	});

	// No Clash line carries a price today, so a priced one stands in: the payment is the same code as every
	// roll's (_payTakenOffers), made after the dice and filed under the Clash.
	it("pays a taken line's price after the dice, and nothing when the attack is backed out of", async () => {
		const spend = vi.fn(async () => {});
		const priced = { key: "priced", label: "Spend something: advantage", applied: false, source: "Something", spend };
		const { clash, rollWithLight } = clasher({ slug: "the-ranger", name: "The Ranger" });
		await rollWithLight({ takenOffers: ["priced"], offered: [priced] });
		expect(rolledWith(clash).rollMode).toBe("adv");
		expect(spend).toHaveBeenCalledTimes(1);
		// With the tier the card counts as, for a line whose price buys nothing on it (Ephemera's on a 6-).
		expect(spend).toHaveBeenCalledWith("Clash", { tier: expect.any(String) });

		seams.begin = async () => "cancel";
		spend.mockClear();
		await rollWithLight({ takenOffers: ["priced"], offered: [priced] });
		expect(spend).not.toHaveBeenCalled();
	});
});
