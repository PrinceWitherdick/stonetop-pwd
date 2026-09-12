import { describe, it, expect } from "vitest";

const { parseMonsterAttacks, splitMonsterAttackProse, foeAttacks } = await import("../../module/utils/damage.js");

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
		// And named the way the book names it: the "or" that joined the two words is printed, not
		// swapped for the comma that would have separated two attacks.
		expect(attacks[0]).toMatchObject({ label: "bite or maul", formula: "d12+5", piercing: 1 });
	});

	it("keeps a middle attack's several names together", () => {
		// The Spirit-talker: three attacks, the middle one named "club or adz".
		const attacks = parseMonsterAttacks(
			"flint-tipped spear d8 (close, thrown, crude), club or adz d8 (hand, crude), or bow d8 (near)", "d8");
		expect(attacks.map(a => a.label)).toEqual(["flint-tipped spear", "club or adz", "bow"]);
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

// The stat-block sheet prints one line per attack and hangs a roll button off each. It reads the
// same split, so the lines a GM looks at and the attacks a PC can suffer are one list.
describe("splitMonsterAttackProse: the same attacks, as the book printed them", () => {
	it("prints each attack verbatim, tags and all", () => {
		expect(splitMonsterAttackProse(
			"dagger d10 (hand, 1 piercing) or garrote d8 (hand, grabby, ignores armor)"))
			.toEqual(["dagger d10 (hand, 1 piercing)", "garrote d8 (hand, grabby, ignores armor)"]);
	});

	it("keeps the separator that only joined two names for one blow", () => {
		// Re-joining with a comma here would put words on the sheet the book never printed.
		expect(splitMonsterAttackProse("bite or maul d12+5 (close, hand, reach)"))
			.toEqual(["bite or maul d12+5 (close, hand, reach)"]);
		expect(splitMonsterAttackProse("brick, makeshift club, or rusty knife d6 (hand, crude)"))
			.toEqual(["brick, makeshift club, or rusty knife d6 (hand, crude)"]);
	});

	it("drops the separator between two attacks, so no line opens with a stray 'or'", () => {
		expect(splitMonsterAttackProse(
			"iron-tipped long spear d6+4 (reach, forceful), sword d6+4 (close, forceful), or bow d6 (far)"))
			.toEqual([
				"iron-tipped long spear d6+4 (reach, forceful)",
				"sword d6+4 (close, forceful)",
				"bow d6 (far)",
			]);
	});

	it("gives a printed attack with no die a line of its own", () => {
		// The raider's net. The sheet shows it with no roll button; the combat pick offers it with
		// no die. Both need it to be its own entry rather than folded into the bite.
		expect(splitMonsterAttackProse("hair-rope net (thrown, crude, grabby), bite d6 (hand)"))
			.toEqual(["hair-rope net (thrown, crude, grabby)", "bite d6 (hand)"]);
	});

	it("still prints a line that names no attack at all", () => {
		// The 22 spirits. The sheet says "none" where the damage goes; `parseMonsterAttacks` reads
		// no attack out of it, which is what sends the GM the ask-for-a-number card instead.
		expect(splitMonsterAttackProse("none")).toEqual(["none"]);
		expect(parseMonsterAttacks("none", "")).toEqual([]);
	});

	it("hands a trailing name with no die to the attack before it rather than dropping it", () => {
		expect(splitMonsterAttackProse("claws d6 (hand), and whatever else is to hand"))
			.toEqual(["claws d6 (hand), and whatever else is to hand"]);
	});

	it("gives it back with the separator the book used, not an invented comma", () => {
		// The same rule the folded NAMES above get. Re-joining with ", " prints a line the book
		// never wrote — and this branch was the one place that ignored the separator it had been
		// at pains to carry everywhere else.
		expect(splitMonsterAttackProse("claws d8 (close) or thrashing tail"))
			.toEqual(["claws d8 (close) or thrashing tail"]);
	});
});

// A trailing fragment is printed as part of the attack before it, and must not be READ as part of
// it: `_readAttack` scans whatever string it is handed for a tag list, an "N piercing" and an
// "ignores armor", and piercing is subtracted from the target's armor when the blow lands.
describe("what a trailing fragment must not do to the attack it joins", () => {
	it("cannot give it a piercing clause the book never printed", () => {
		expect(parseMonsterAttacks("claws d8 (close), and 2 piercing on a charge", ""))
			.toEqual([expect.objectContaining({ label: "claws", formula: "d8", piercing: 0 })]);
	});

	it("cannot make it ignore armor either", () => {
		const [attack] = parseMonsterAttacks("gore d10 (close), said to ignore armor in the old tales", "");
		expect(attack.ignoresArmor).toBe(false);
		expect(attack.tags).toEqual(["close"]);
	});

	it("still PRINTS every word of it, which is why it is kept at all", () => {
		expect(splitMonsterAttackProse("claws d8 (close), and 2 piercing on a charge"))
			.toEqual(["claws d8 (close), and 2 piercing on a charge"]);
	});

	it("returns nothing for a damage line that is not there", () => {
		expect(splitMonsterAttackProse(undefined)).toEqual([]);
		expect(splitMonsterAttackProse("")).toEqual([]);
	});
});

// The book gives a monster ONE damage value and routes anything else through a move: "a move
// describing it, with tags and (if appropriate) an alternative damage value". 19 shipped stat
// blocks take it up, and until this the counter-attack could not reach a single one of them.
describe("foeAttacks: the damage line AND the moves that roll", () => {
	/** A stat block whose items behave like a Foundry embedded collection (it has .filter). */
	const foe = (damage, items = []) => ({
		system: { attributes: { damage } },
		items: { filter: predicate => items.filter(predicate) },
	});

	const CLOUD = {
		type: "monsterMove",
		name: "Breathe forth a baleful cloud, d6 damage (reach, area, ignores armor)",
		system: { rollFormula: "d6" },
	};

	it("offers the Gwyllgi its cloud after its claws and its bite", () => {
		const attacks = foeAttacks(foe(
			{ value: "claws d8 (close) or bite d8+2 (hand, grabby, forceful)", rollFormula: "d8" },
			[CLOUD]));

		// Printed attacks first, in the order the book prints them, then what the moves roll.
		expect(attacks.map(a => `${a.label} ${a.formula}`))
			.toEqual(["claws d8", "bite d8+2", "Breathe forth a baleful cloud d6"]);
	});

	it("carries a move attack's own armor clause and tags", () => {
		// The reason it has to be a real attack and not a footnote: the cloud ignores armor and
		// neither of the Gwyllgi's printed blows does, so the pick changes what reaches the PC.
		const [, , cloud] = foeAttacks(foe(
			{ value: "claws d8 (close) or bite d8+2 (hand, grabby, forceful)", rollFormula: "d8" }, [CLOUD]));
		expect(cloud).toMatchObject({ ignoresArmor: true, piercing: 0, rollMode: "normal" });
		expect(cloud.tags).toEqual(["reach", "area", "ignores armor"]);
	});

	it("takes the die from the move's own field, not from its name", () => {
		// Bhoka prints "1d10+3" in the name while the field reads "d10+3"; the field is the one the
		// sheet's roll button uses, and the one the GM edited.
		const [attack] = foeAttacks(foe({ value: "none", rollFormula: "" }, [{
			type: "monsterMove",
			name: "Fling lightning, 1d10+3 damage (far, forceful, loud, reload)",
			system: { rollFormula: "d10+3" },
		}]));
		expect(attack).toMatchObject({ label: "Fling lightning", formula: "d10+3" });
	});

	it("names a move whose die is buried in its tag list", () => {
		// The Prenysbyrd prints the die inside the parentheses, so the name runs up to a bare "(".
		const [attack] = foeAttacks(foe({ value: "none", rollFormula: "" }, [{
			type: "monsterMove",
			name: "Smother a prone foe with soil, leaves, and wood (d8+1 damage, near, grabby)",
			system: { rollFormula: "d8+1" },
		}]));
		expect(attack.label).toBe("Smother a prone foe with soil, leaves, and wood");
	});

	it("reads a move that names no die at all by its whole name", () => {
		// The Crinwin's tongue: the name is pure fiction and the formula lives only in the field.
		const [attack] = foeAttacks(foe({ value: "none", rollFormula: "" }, [{
			type: "monsterMove", name: "Choke with sinewy fingers", system: { rollFormula: "d6" },
		}]));
		expect(attack).toMatchObject({ label: "Choke with sinewy fingers", formula: "d6" });
	});

	it("ignores a move with no die: that field is the whole signal", () => {
		// 711 of the 730 shipped moves are fiction, not attacks. Offering them would bury the blows.
		const attacks = foeAttacks(foe({ value: "claws d8 (close)", rollFormula: "d8" }, [
			{ type: "monsterMove", name: "Stalk their target at length", system: { rollFormula: "" } },
			{ type: "monsterMove", name: "Slip away, try again later", system: {} },
		]));
		expect(attacks.map(a => a.label)).toEqual(["claws"]);
	});

	it("reads a person's moves the same way a monster's are read", () => {
		const [attack] = foeAttacks(foe({ value: "none", rollFormula: "" }, [{
			type: "npcMove", name: "Lash out in fear, d4 damage (hand)", system: { rollFormula: "d4" },
		}]));
		expect(attack).toMatchObject({ label: "Lash out in fear", formula: "d4" });
	});

	it("returns nothing for a foe that is not there", () => {
		expect(foeAttacks(null)).toEqual([]);
		expect(foeAttacks(undefined)).toEqual([]);
		expect(foeAttacks({})).toEqual([]);
	});
});
