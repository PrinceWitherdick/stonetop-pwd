import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// A monster move's price to ITSELF ("costs 1d4 HP", "lose 2d4 HP") is not the blow's die (round-2 audit, from the FOE
// fixer): the Lightning Vortex's bolt and the Stone Sentinel's flurry had it read as their attack, which mangled the
// card's title and lost the flurry's 3 piercing. A variant move rolls the stat block's printed blow, its tags and
// piercing kept, with the move's own "+" added (Book II's stat blocks).

const { damageCardText, readMoveAttack, withoutSelfHpCosts, selfHpCosts, parseMonsterAttacks, foeAttacks } = await import("../../module/utils/damage.js");

const block = slug => JSON.parse(fs.readFileSync(path.resolve(`packs/src/stonetop-bestiary/makers/${slug}.json`), "utf8"));
/** A shipped stat block as an actor whose moves know their parent, the way Foundry's embedded items do. */
function actorOf(slug) {
	const json = block(slug);
	const actor = { name: json.name, system: json.system, items: [] };
	actor.items = json.items.map(it => ({ ...it, actor, parent: actor }));
	return actor;
}
const move = (actor, starts) => actor.items.find(i => i.name.startsWith(starts));

describe("a self-cost is taken out of the blow", () => {
	it("strips 'costs NdX HP', 'lose NdX HP' and 'gaining NdX HP', and keeps them to say", () => {
		expect(withoutSelfHpCosts("Fling a lightning bolt (+near, +forceful, +loud, ignores armor; costs 1d4 HP)")).toBe("Fling a lightning bolt (+near, +forceful, +loud, ignores armor)");
		expect(withoutSelfHpCosts("Erupt in a flurry of violence (area, +2 damage, lose 2d4 HP)")).toBe("Erupt in a flurry of violence (area, +2 damage)");
		expect(withoutSelfHpCosts("Leap across a barrier (but lose 1d4 HP)")).toBe("Leap across a barrier");
		expect(selfHpCosts("Fling flames (+near; costs 1d4 HP)")).toEqual(["costs 1d4 HP"]);
	});

	it("never strips a loss said of someone else", () => {
		expect(withoutSelfHpCosts("Drain them (they lose 1d6 HP)")).toBe("Drain them (they lose 1d6 HP)");
	});

	it("titles the card with the blow's name, and says the cost beside its tags", () => {
		const bolt = damageCardText("Fling a lightning bolt (+near, +forceful, +loud, ignores armor; costs 1d4 HP)", "d10");
		expect(bolt.title).toBe("Fling a lightning bolt");
		expect(bolt.keywords).toContain("ignores armor");
		expect(bolt.keywords).toContain("costs 1d4 HP");
		expect(parseMonsterAttacks("Fling a lightning bolt (+near; costs 1d4 HP)")[0].formula).toBe("");
		// Taken out before the line is split, so a cost printed outside the tags is no attack of its own.
		expect(parseMonsterAttacks("claws d8 (close), costs 1d4 HP").map(x => x.formula)).toEqual(["d8"]);
		expect(damageCardText("claws d8 (close), costs 1d4 HP", "d8")).toEqual({ title: "Claws", keywords: "close · costs 1d4 HP" });
	});
});

describe("the two variant moves roll their printed blow", () => {
	it("the Lightning Vortex's bolt rolls the zap's d10, its own tags added, ignoring armor", () => {
		const vortex = actorOf("lightning-vortex");
		const bolt = readMoveAttack(move(vortex, "Fling a lightning bolt"));
		expect(bolt).toMatchObject({ label: "Fling a lightning bolt", formula: "d10", ignoresArmor: true });
		expect(bolt.tags).toEqual(expect.arrayContaining(["hand", "close", "near", "forceful", "loud"]));
		expect(foeAttacks(vortex).map(a => a.label)).toContain("Fling a lightning bolt");
	});

	it("the Stone Sentinel's flurry rolls its fists +2, keeping their 3 piercing, with the area added", () => {
		const sentinel = actorOf("stone-sentinel");
		const flurry = readMoveAttack(move(sentinel, "Erupt in a flurry"));
		expect(flurry).toMatchObject({ label: "Erupt in a flurry of violence", formula: "d10+5", piercing: 3 });
		expect(flurry.tags).toEqual(expect.arrayContaining(["area", "grabby", "messy", "forceful"]));
		expect(flurry.tags).not.toContain("+2 damage");
		expect(damageCardText(move(sentinel, "Erupt in a flurry").name, "d10+5").title).toBe("Erupt in a flurry of violence");
	});

	it("leaves a move that names a blow of its own as it is", () => {
		const actor = { system: { attributes: { damage: { value: "claws d6 (close, 2 piercing)", rollFormula: "d6" } } } };
		const own = readMoveAttack({ name: "Breathe fire, d10+3 damage (near, area)", system: { rollFormula: "d10+3" }, actor });
		expect(own).toMatchObject({ piercing: 0, formula: "d10+3" });
		expect(own.tags).toEqual(["near", "area"]);
	});
});
