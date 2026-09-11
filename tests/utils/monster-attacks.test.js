import { describe, it, expect } from "vitest";

const { parseMonsterAttacks } = await import("../../module/utils/damage.js");

// Every damage line quoted below is VERBATIM from a shipped bestiary stat block. The parser reads
// prose the books wrote, so the fixtures have to be that prose and not a tidied paraphrase of it —
// a test that invented its own grammar would pass while the pack it exists for did not parse.

describe("parseMonsterAttacks: one attack", () => {
	it("reads the die, the name and the tags off a single printed attack", () => {
		const [attack] = parseMonsterAttacks("bronze khopesh d10+2 (close, messy, 2 piercing)", "d10+2");
		expect(attack).toMatchObject({
			label: "bronze khopesh",
			formula: "d10+2",
			piercing: 2,
			ignoresArmor: false,
			rollMode: "normal",
		});
		expect(attack.tags).toEqual(["close", "messy", "2 piercing"]);
	});

	it("keeps a tag list's own commas out of the attack split", () => {
		// The separator and the tag separator are the same character; only depth tells them apart.
		expect(parseMonsterAttacks("antler of jagged bone d10+2 (close, messy, 1 piercing)")).toHaveLength(1);
	});

	it("falls back to rollFormula when the prose carries no die", () => {
		const [attack] = parseMonsterAttacks("by weapon", "d8");
		expect(attack).toMatchObject({ label: "", formula: "d8" });
	});

	it("offers nothing to roll for a foe whose damage line reads 'none'", () => {
		// The 22 spirits. A fabricated d6 here would be damage the book never gave them.
		expect(parseMonsterAttacks("none", "")).toEqual([]);
	});

	it("returns nothing rather than throwing on an absent damage line", () => {
		expect(parseMonsterAttacks(undefined, undefined)).toEqual([]);
		expect(parseMonsterAttacks("", "")).toEqual([]);
	});
});

describe("parseMonsterAttacks: a fragment with no die names the next attack", () => {
	it("reads 'bite or maul d12+5' as ONE attack, not two", () => {
		// The Bear of Winter. Splitting here would invent a die-less attack and halve the real one.
		const attacks = parseMonsterAttacks("bite or maul d12+5 (close, hand, reach, forceful, grabby, messy, 1 piercing)", "d12+5");
		expect(attacks).toHaveLength(1);
		expect(attacks[0]).toMatchObject({ label: "bite, maul", formula: "d12+5", piercing: 1 });
	});

	it("keeps a middle attack's several names together", () => {
		// The Spirit-talker: three attacks, the middle one named "club, adz".
		const attacks = parseMonsterAttacks(
			"flint-tipped spear d8 (close, thrown, crude), club or adz d8 (hand, crude), or bow d8 (near)", "d8");
		expect(attacks.map(a => a.label)).toEqual(["flint-tipped spear", "club, adz", "bow"]);
	});

	// …UNLESS IT BROUGHT ITS OWN TAGS, in which case it is a printed attack that deals no damage.
	describe("a die-less fragment WITH a tag list is an attack of its own", () => {
		// The Thraulgwyn Raider, verbatim: four attacks, and the third of them rolls nothing.
		const RAIDER = "obsidian-tipped bone spear d8 (close, thrown, crude), femur d8 (close, crude), "
			+ "hair-rope net (thrown, crude, grabby), bite d6 (hand)";

		it("gives the raider all four of its attacks", () => {
			const attacks = parseMonsterAttacks(RAIDER, "d8");
			expect(attacks.map(a => a.label))
				.toEqual(["obsidian-tipped bone spear", "femur", "hair-rope net", "bite"]);
		});

		it("gives the net no die and keeps its tags off the bite", () => {
			const [, , net, bite] = parseMonsterAttacks(RAIDER, "d8");
			expect(net).toMatchObject({ label: "hair-rope net", formula: "" });
			expect(net.tags).toEqual(["thrown", "crude", "grabby"]);
			// The whole reason it matters: the merge handed the next blow the previous one's tag
			// list, and a stray "ignores armor" or "N piercing" there changes what a PC takes.
			expect(bite).toMatchObject({ label: "bite", formula: "d6" });
			expect(bite.tags).toEqual(["hand"]);
		});

		it("does not carry a die-less attack's armor clause onto the next one", () => {
			const [gaze, claws] = parseMonsterAttacks("withering gaze (reach, ignores armor), claws d6 (close)");
			expect(gaze).toMatchObject({ formula: "", ignoresArmor: true });
			expect(claws).toMatchObject({ formula: "d6", ignoresArmor: false });
		});
	});
});

describe("parseMonsterAttacks: several attacks", () => {
	it("splits the Rime Lord and keeps each attack's OWN armor clause", () => {
		// The reason the pick exists: one of these ignores armor and the other does not, so a
		// picker that carried a single shared clause would make the choice cosmetic.
		const attacks = parseMonsterAttacks(
			"conjured ice d12+3 (any range, area, grabby, forceful) or heat-drain d12+1 (reach, ignores armor)", "d12+3");
		expect(attacks).toHaveLength(2);
		expect(attacks[0]).toMatchObject({ label: "conjured ice", formula: "d12+3", ignoresArmor: false });
		expect(attacks[1]).toMatchObject({ label: "heat-drain", formula: "d12+1", ignoresArmor: true });
	});

	it("splits three attacks on a mixed ', ' / ', or ' list", () => {
		const attacks = parseMonsterAttacks(
			"iron battleaxe d8 (close, messy, 1 piercing), spear d8 (close, thrown, 1 piercing), or knife d6 (hand, 1 piercing)", "d8");
		expect(attacks.map(a => `${a.label} ${a.formula}`))
			.toEqual(["iron battleaxe d8", "spear d8", "knife d6"]);
	});

	it("carries each attack's own disadvantage and piercing", () => {
		// Mkhalang. `rollFormula` is d8+7 — the SECOND attack — so a picker reading only the
		// formula would offer the trample at the ice-tusks' die.
		const attacks = parseMonsterAttacks(
			"trample d8+3 w/disadvantage (hand, close) or ice-tusks d8+7 w/disadvantage (reach, forceful, messy, crude, 1 piercing)", "d8+7");
		expect(attacks[0]).toMatchObject({ formula: "d8+3", rollMode: "dis", piercing: 0 });
		expect(attacks[1]).toMatchObject({ formula: "d8+7", rollMode: "dis", piercing: 1 });
	});
});

describe("parseMonsterAttacks: advantage on the damage die", () => {
	it("reads 'w/advantage' beside the die", () => {
		expect(parseMonsterAttacks("orichalcum sword d10+2 w/advantage (close, messy, 2 piercing)")[0].rollMode)
			.toBe("adv");
	});

	it("reads the bare word inside a tag list", () => {
		// Dawa Eyegouger prints it as a tag rather than beside the die.
		expect(parseMonsterAttacks("knife or fingers d8 (hand, messy, 1 piercing, advantage)")[0].rollMode)
			.toBe("adv");
	});

	it("never reads a disadvantage as an advantage", () => {
		// "disadvantage" contains "advantage"; a test for the shorter word first gets this backwards.
		expect(parseMonsterAttacks("trample d8+3 w/disadvantage (hand, close)")[0].rollMode).toBe("dis");
		expect(parseMonsterAttacks("iron mattock d8 w/disadvantage (close, messy, awkward)")[0].rollMode).toBe("dis");
	});
});

describe("parseMonsterAttacks: every formula it returns is rollable", () => {
	it("yields a bare dice expression for each attack, whatever the prose around it", () => {
		// The formula goes straight to Foundry's Roll. Anything that smuggled a word or a comma
		// through would throw at the table, which is the failure the prose split exists to prevent.
		const lines = [
			"conjured ice d12+3 (any range, area, grabby, forceful) or heat-drain d12+1 (reach, ignores armor)",
			"maw full of iron teeth d10+3 w/advantage (hand, messy, grabby, 1 piercing), iron tail-quills d10+1 (near, area, reload)",
			"weapon d6 (tags by weapon) or crushing grip d4 (hand, grabby)",
			"trample and wheel-scythes d8+5 (hand, close, forceful, messy, 1 piercing), iron battleaxe d8+3 (close, messy)",
			"bronze or dark ice-tipped weapons d8 (tags by weapon)",
			"iron-tipped long spear d6+4 (reach, forceful), sword d6+4 (close, forceful), or bow d6 (far)",
		];
		for (const line of lines) {
			const attacks = parseMonsterAttacks(line, "");
			expect(attacks.length).toBeGreaterThan(0);
			for (const attack of attacks) expect(attack.formula).toMatch(/^\d*d\d+(?:[+-]\d+)?$/i);
		}
	});
});
