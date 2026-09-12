import { describe, it, expect } from "vitest";
import {
	computeMonster,
	buildMonsterActorData,
	stepDie,
	ORGANIZATIONS,
	SIZES,
} from "../../module/data/monster-builder.js";
import { parseMonsterAttacks } from "../../module/utils/damage.js";

describe("stepDie", () => {
	it("steps up and down the ladder", () => {
		expect(stepDie("d8", 1)).toBe("d10");
		expect(stepDie("d8", -1)).toBe("d6");
		expect(stepDie("d8", 0)).toBe("d8");
	});
	it("clamps at the ends of the ladder", () => {
		expect(stepDie("d10", 5)).toBe("d12");
		expect(stepDie("d6", -5)).toBe("d4");
	});
	it("treats an off-ladder die as d6", () => {
		expect(stepDie("d20", 0)).toBe("d6");
	});
});

describe("computeMonster — HP by organization and size", () => {
	it("uses the organization base HP and damage die", () => {
		expect(computeMonster({ organization: "horde" }).hp).toBe(3);
		expect(computeMonster({ organization: "group" }).hp).toBe(6);
		expect(computeMonster({ organization: "solitary" }).hp).toBe(12);
		expect(computeMonster({ organization: "horde" }).damageDie).toBe("d6");
		expect(computeMonster({ organization: "solitary" }).damageDie).toBe("d10");
	});

	it("applies the size HP modifier", () => {
		expect(computeMonster({ organization: "solitary", size: "large" }).hp).toBe(16);
		expect(computeMonster({ organization: "solitary", size: "huge" }).hp).toBe(20);
	});

	it("never drops below 1 HP (a tiny horde)", () => {
		expect(computeMonster({ organization: "horde", size: "tiny" }).hp).toBe(1);
	});

	it("sums the extra HP modifiers", () => {
		// solitary(12) + large(+4) + tough(+4) + fated(+2) = 22
		const out = computeMonster({
			organization: "solitary", size: "large", hpMods: ["tough", "fated"],
		});
		expect(out.hp).toBe(22);
	});

	it("defaults to group when organization is missing", () => {
		expect(computeMonster({}).hp).toBe(6);
		expect(computeMonster({}).count).toBe(3);
	});
});

describe("computeMonster — armor", () => {
	it("uses the base armor and its source", () => {
		const out = computeMonster({ organization: "group", armorBase: 2 });
		expect(out.armorValue).toBe(2);
		expect(out.armorSource).toBe("mail");
	});

	it("adds +1 armor for tiny automatically and tags the source", () => {
		const out = computeMonster({ organization: "horde", size: "tiny", armorBase: 1 });
		expect(out.armorValue).toBe(2); // leathers(1) + tiny(+1)
		expect(out.armorSource).toContain("hide");
		expect(out.armorSource).toContain("small");
	});

	it("stacks shield / skilled / no-organs modifiers", () => {
		const out = computeMonster({
			organization: "solitary", armorBase: 3, armorMods: ["shield", "skilled"],
		});
		expect(out.armorValue).toBe(5); // 3 + 1 + 1
		expect(out.armorSource).toBe("plate, shield, skill");
	});

	it("lets a typed source override the auto-derived one", () => {
		const out = computeMonster({ armorBase: 4, armorSource: "ancient wards" });
		expect(out.armorValue).toBe(4);
		expect(out.armorSource).toBe("ancient wards");
	});
});

describe("computeMonster — damage", () => {
	it("builds the roll formula from die + flat bonus", () => {
		// group d8, large (+1 dmg), vicious (+2 dmg) => d8+3
		const out = computeMonster({
			organization: "group", size: "large", damageMods: ["vicious"],
		});
		expect(out.rollFormula).toBe("d8+3");
	});

	it("steps the die for ancient / weak / subtle", () => {
		expect(computeMonster({ organization: "solitary", damageMods: ["ancient"] }).damageDie).toBe("d12");
		expect(computeMonster({ organization: "group", damageMods: ["weak"] }).damageDie).toBe("d6");
		expect(computeMonster({ organization: "group", damageMods: ["weak", "subtle"] }).damageDie).toBe("d4");
	});

	it("nets advantage against disadvantage", () => {
		expect(computeMonster({ damageMods: ["relentless"] }).rollMode).toBe("adv");
		expect(computeMonster({ damageMods: ["abhorrent"] }).rollMode).toBe("dis");
		expect(computeMonster({ damageMods: ["relentless", "abhorrent"] }).rollMode).toBe("");
	});

	it("assembles range tags, effect tags, and modifier-contributed tags", () => {
		const out = computeMonster({
			organization: "solitary",
			damageTags: ["reach", "messy", "1 piercing"],
			damageMods: ["strong"], // contributes "forceful" + damage
		});
		expect(out.damageTags).toEqual(["reach", "messy", "1 piercing", "forceful"]);
		expect(out.damageValue).toContain("(reach, messy, 1 piercing, forceful)");
		expect(out.damageValue).toContain("d10+2");
	});

	it("notes advantage in the prose damage value", () => {
		const out = computeMonster({ organization: "group", damageMods: ["relentless"] });
		expect(out.damageValue).toBe("d8 w/advantage");
	});

	it("heads the damage line with what the monster attacks with", () => {
		// Every printed stat block names the blow before its die, and everything that reads the
		// line back apart keeps that name: the combat pick's buttons, and the damage card's fine
		// print. Without one the worksheet produced a bare "d8+2 (close)" and both came back blank.
		const out = computeMonster({
			organization: "group",
			attackName: "rusty sword",
			damageTags: ["close"],
			damageMods: ["strong"],
		});
		expect(out.damageValue).toBe("rusty sword d8+2 (close, forceful)");
		// The name is prose only. The rollable field stays the bare die it always was.
		expect(out.rollFormula).toBe("d8+2");
	});

	it("leaves the line unnamed when nothing was typed", () => {
		expect(computeMonster({ organization: "group" }).damageValue).toBe("d8");
		expect(computeMonster({ organization: "group", attackName: "   " }).damageValue).toBe("d8");
	});

	it("keeps a typed name from smuggling a second die onto the line", () => {
		// "claws d6" ahead of a d8 line makes d6 the FIRST die in the string, so every reader of
		// the prose rolls d6 while rollFormula still says d8. The name is prose; the die is not.
		const out = computeMonster({ organization: "group", attackName: "claws d6" });
		expect(out.damageValue).toBe("claws d8");
	});

	it("takes EVERY die out of a typed name, not just the first", () => {
		// The name is free text, so a GM types "claws d6 and fangs d10". Stripping one die leaves
		// the other standing at the head of the line, which is the same bug wearing a longer
		// name: the sheet's roll button and the counter-attack read d10 off the prose while
		// rollFormula says d8.
		const out = computeMonster({
			organization: "group", attackName: "claws d6 and fangs d10", damageTags: ["close"],
		});
		expect(out.damageValue).toBe("claws and fangs d8 (close)");
		expect(parseMonsterAttacks(out.damageValue, out.rollFormula).map(a => a.formula)).toEqual(["d8"]);
	});

	it("takes them out of an EXTRA attack's name too, which reads the same field", () => {
		const out = computeMonster({
			organization: "group", attackName: "claws",
			extraAttacks: [{ name: "bow d6 or sling d4", tags: ["near"] }],
		});
		expect(out.damageValue).toContain("bow or sling d8 (near)");
	});

	it("keeps a typed name from breaking the tag list open", () => {
		// The tag list is found by counting parens, so a stray one swallows the rest of the line.
		const out = computeMonster({ organization: "group", attackName: "sword (rusty", damageTags: ["close"] });
		expect(out.damageValue).toBe("sword rusty d8 (close)");
	});

	it("prints a second attack the way the book prints one", () => {
		// The Assassin, in worksheet form: two blows, two dice, and only one of them ignores armor.
		const out = computeMonster({
			organization: "solitary",
			attackName: "dagger",
			damageTags: ["hand", "1 piercing"],
			extraAttacks: [{ name: "garrote", die: "d8", tags: ["hand", "grabby", "ignores armor"] }],
		});
		expect(out.damageValue)
			.toBe("dagger d10 (hand, 1 piercing) or garrote d8 (hand, grabby, ignores armor)");
		// The rollable field stays the PRIMARY attack; the rest live in the prose, where the sheet
		// and the combat pick read them back apart.
		expect(out.rollFormula).toBe("d10");
	});

	it("punctuates three or more attacks as the books do", () => {
		// The Chosen Shield's shape: commas between, " or " before the last. The reader that
		// splits this line back apart keys on exactly those separators.
		const out = computeMonster({
			organization: "group",
			attackName: "iron battleaxe",
			damageTags: ["close", "messy"],
			extraAttacks: [
				{ name: "spear", tags: ["close", "thrown"] },
				{ name: "knife", die: "d6", tags: ["hand"] },
			],
		});
		expect(out.damageValue).toBe(
			"iron battleaxe d8 (close, messy), spear d8 (close, thrown), or knife d6 (hand)");
	});

	it("gives an extra attack the creature's die when none was typed", () => {
		const out = computeMonster({
			organization: "group", size: "large",   // d8, +1 damage
			attackName: "tusks", damageTags: ["reach"],
			extraAttacks: [{ name: "trample", tags: ["hand", "area"] }],
		});
		expect(out.damageValue).toBe("tusks d8+1 (reach) or trample d8+1 (hand, area)");
	});

	it("refuses a typed die that is not a die, rather than printing an unrollable one", () => {
		// This string reaches the sheet's roll button and then `new Roll`. Prose here would throw
		// at the table; the creature's own die is the honest fallback, and the summary shows it.
		const out = computeMonster({
			organization: "group", attackName: "claws",
			extraAttacks: [{ name: "bite", die: "big" }],
		});
		expect(out.damageValue).toBe("claws d8 or bite d8");
	});

	it("carries the creature's advantage onto every blow it has", () => {
		// "Relentless or overwhelming" describes the CREATURE, so both of its attacks roll it.
		const out = computeMonster({
			organization: "group", damageMods: ["relentless"],
			attackName: "claws", extraAttacks: [{ name: "bite" }],
		});
		expect(out.damageValue).toBe("claws d8 w/advantage or bite d8 w/advantage");
	});

	it("ignores an extra attack card left entirely blank", () => {
		const out = computeMonster({
			organization: "group", attackName: "claws",
			extraAttacks: [{ name: "", die: "", tags: [] }],
		});
		expect(out.damageValue).toBe("claws d8");
	});

	it("renders a negative bonus (tiny)", () => {
		// horde d6, tiny (-2 dmg) => d6-2
		const out = computeMonster({ organization: "horde", size: "tiny" });
		expect(out.rollFormula).toBe("d6-2");
	});
});

describe("computeMonster — tag line", () => {
	it("leads with organization then size, then nature and notable tags", () => {
		const out = computeMonster({
			organization: "group", size: "large",
			natureTags: ["undead"], notableTags: ["cunning", "stealthy"],
		});
		expect(out.tags).toBe("group, large, undead, cunning, stealthy");
	});

	it("omits the size tag for medium", () => {
		const out = computeMonster({ organization: "solitary", size: "medium" });
		expect(out.tags).toBe("solitary");
	});

	it("folds in and de-dupes free-text custom tags", () => {
		const out = computeMonster({
			organization: "horde", notableTags: ["cunning"], customTags: "Cunning, drunkard",
		});
		expect(out.tags).toBe("horde, cunning, drunkard");
	});

	it("surfaces range advice from size", () => {
		expect(computeMonster({ size: "large" }).rangeAdvice).toBe("add");
		expect(computeMonster({ size: "tiny" }).rangeAdvice).toBe("reduce");
		expect(computeMonster({ size: "medium" }).rangeAdvice).toBeNull();
	});
});

describe("data tables sanity", () => {
	it("has three organizations and five sizes", () => {
		expect(ORGANIZATIONS).toHaveLength(3);
		expect(SIZES).toHaveLength(5);
	});
});

describe("buildMonsterActorData", () => {
	it("shapes the full monster creation payload from flat options", () => {
		const data = buildMonsterActorData({
			name: "Gnarl", img: "icons/gnarl.webp", folder: "folder1", creatureType: "beast",
			hp: 12, armorValue: 2, armorSource: "hide", damageValue: "claws d8", rollFormula: "d8",
			instinct: "hunt", concept: "a beast", organization: "group", size: "large",
			tags: "solitary, beast", qualities: "keen senses", notes: "lurks", count: 1,
			items: [{ name: "Pounce", type: "monsterMove", system: { description: "leaps", rollFormula: "" } }],
		});
		expect(data.name).toBe("Gnarl");
		expect(data.type).toBe("monster");
		expect(data.folder).toBe("folder1");
		expect(data.img).toBe("icons/gnarl.webp");
		expect(data.system.attributes).toEqual({
			hp:       { value: 12, max: 12 },
			armor:    { value: 2, source: "hide" },
			damage:   { value: "claws d8", rollFormula: "d8" },
			instinct: { value: "hunt" },
		});
		expect(data.system.concept).toBe("a beast");
		expect(data.system.organization).toBe("group");
		expect(data.system.creatureType).toBe("beast");
		expect(data.system.size).toBe("large");
		expect(data.system.tags).toBe("solitary, beast");
		expect(data.system.qualities).toBe("keen senses");
		expect(data.system.notes).toBe("lurks");
		expect(data.system.count).toBe(1);
		expect(data.system.entry).toBe("");
		expect(data.prototypeToken).toMatchObject({ name: "Gnarl", actorLink: false, texture: { src: "icons/gnarl.webp" } });
		expect(data.prototypeToken.disposition).toBe(-1); // HOSTILE
		expect(data.items).toHaveLength(1);
	});

	it("omits the token texture and leaves folder undefined when neither is given", () => {
		const data = buildMonsterActorData({ name: "Blob" });
		expect(data.folder).toBeUndefined();
		expect(data.img).toBeUndefined();
		expect(data.prototypeToken.texture).toBeUndefined();
		// Sensible empty defaults so a bare call still yields a valid stat block.
		expect(data.system.attributes.hp).toEqual({ value: 0, max: 0 });
		expect(data.system.count).toBe(1);
		expect(data.items).toEqual([]);
	});
});

// The worksheet WRITES a damage line that the sheet and the combat flow then READ back apart
// (utils/damage.js#parseMonsterAttacks). Those are two halves of one contract, and nothing checks
// it: the writer could punctuate its list any way at all and still look right in the summary
// chip, while the reader came back with one attack wearing three names and a single roll button.
describe("what the worksheet writes, the stat block can read back", () => {
	const roundTrip = sel => parseMonsterAttacks(computeMonster(sel).damageValue, computeMonster(sel).rollFormula);

	it("reads two built attacks back as two, each with its own die and armor clause", () => {
		const attacks = roundTrip({
			organization: "solitary",
			attackName: "dagger",
			damageTags: ["hand", "1 piercing"],
			extraAttacks: [{ name: "garrote", die: "d8", tags: ["hand", "grabby", "ignores armor"] }],
		});

		expect(attacks).toHaveLength(2);
		expect(attacks[0]).toMatchObject({ label: "dagger", formula: "d10", piercing: 1, ignoresArmor: false });
		expect(attacks[1]).toMatchObject({ label: "garrote", formula: "d8", piercing: 0, ignoresArmor: true });
	});

	it("reads three back as three, across the comma-and-or list", () => {
		const attacks = roundTrip({
			organization: "group",
			attackName: "iron battleaxe",
			damageTags: ["close", "messy"],
			extraAttacks: [
				{ name: "spear", tags: ["close", "thrown"] },
				{ name: "knife", die: "d6", tags: ["hand"] },
			],
		});
		expect(attacks.map(a => `${a.label} ${a.formula}`))
			.toEqual(["iron battleaxe d8", "spear d8", "knife d6"]);
	});

	it("keeps a multi-word attack name whole rather than splitting it into blows", () => {
		// "claws and bite" is ONE name. A writer that emitted "claws, bite" would read back as two.
		const attacks = roundTrip({ organization: "group", attackName: "claws and bite", damageTags: ["hand"] });
		expect(attacks).toHaveLength(1);
		expect(attacks[0]).toMatchObject({ label: "claws and bite", formula: "d8" });
	});

	it("reads the creature's advantage off every blow", () => {
		const attacks = roundTrip({
			organization: "group", damageMods: ["abhorrent"],
			attackName: "claws", extraAttacks: [{ name: "bite" }],
		});
		expect(attacks.map(a => a.rollMode)).toEqual(["dis", "dis"]);
	});

	it("yields a rollable formula for every attack it built", () => {
		// Each one goes straight to Foundry's Roll. A word or a comma smuggled through throws.
		const attacks = roundTrip({
			organization: "solitary", size: "huge", damageMods: ["strong", "deft"],
			attackName: "crushing hands",
			damageTags: ["reach", "forceful"],
			extraAttacks: [{ name: "hurled object", die: "2d6+1", tags: ["far", "area", "reload"] }],
		});
		expect(attacks.length).toBe(2);
		for (const attack of attacks) expect(attack.formula).toMatch(/^\d*d\d+(?:[+-]\d+)?$/i);
	});
});
