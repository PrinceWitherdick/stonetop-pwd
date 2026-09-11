import { describe, it, expect } from "vitest";
import { carriedAttackWeapons } from "../../module/combat/attack-flow.js";
import { weaponMetaFromNote } from "../../module/data/weapon-from-note.js";
import { mitigateDamage } from "../../module/utils/damage.js";
import { isClashWeapon, isLetFlyWeapon } from "../../module/data/weapons.js";
import { TestCharacterBuilder } from "../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../fakes/FakeActorBuilder.js";
import { FakeInventoryRepository } from "../fakes/FakeInventoryRepository.js";
import { FakeArcanaRepository } from "../fakes/FakeArcanaRepository.js";

// A weapon is only offered for Clash / Let Fly if the attack flow can SEE it, and it used to see
// one store: `inventory.checked`. That missed two whole classes of weapon —
//
//   1. GEAR CHOICES. The Heavy's and Marshal's Weapons of War are `choices.gear`, marked carried
//      in possessions.choiceCarried. Every one of their slugs (sword, battleaxe, warhammer,
//      mace-or-flail, crossbow, long-spear, composite-bow) is a full WEAPON_META entry, and not
//      one of them was ever offered. Their signature gear.
//   2. ANYTHING PICKED UP IN PLAY. Arcana curios and Book II treasures have no WEAPON_META entry
//      at all; their mechanics are stated only in their own tag line.

const CLASH   = { key: "clash",   filter: isClashWeapon };
const LET_FLY = { key: "letfly",  filter: isLetFlyWeapon };

// An actor whose StonetopCharacter answers with the given gear records.
function actorWith(gear, { flags = {} } = {}) {
	return {
		// A real actor always has an items collection — the move-granted-weapon sweep walks it
		// looking for the likes of Purifying Flames.
		items: [],
		typedActor: {
			carriedWeaponGear: async () => gear,
			// The real StonetopCharacter answers the possessions store through this accessor
			// rather than exposing its flag path; the stub reads the same map it is given.
			subChoiceUses: (possessionSlug, choiceSlug) =>
				Number((flags["possessions.choiceUses"] ?? {})[`${possessionSlug}:${choiceSlug}`]) || 0,
		},
		getFlag: (_scope, path) => flags[path] ?? null,
	};
}

// An actor with NO StonetopCharacter — the legacy fallback path (a bare fixture, an unlinked
// token, a non-character). Must keep working exactly as before.
function bareActor(checked) {
	return { items: [], getFlag: (_scope, path) => (path === "inventory.checked" ? checked : null) };
}

const gearRow = (over = {}) => ({
	slug: "x", weaponSlug: null, name: null, note: null, ammoStore: "inventory", ammo: false, ...over,
});

describe("carriedAttackWeapons — gear choices", () => {
	it("offers the Heavy's Weapons of War battleaxe for Clash", async () => {
		const actor = actorWith([gearRow({
			slug: "weapons-of-war:battleaxe", weaponSlug: "battleaxe", name: "◇ Battleaxe, iron",
			ammoStore: "possessions",
		})]);
		const out = await carriedAttackWeapons(actor, CLASH);
		expect(out).toHaveLength(1);
		expect(out[0].meta.name).toBe("Battleaxe");
		// The carried mark is keyed by the COMPOSITE, which is what the ammo/serialisation path
		// must keep using; the WEAPON_META lookup used the bare choice slug.
		expect(out[0].slug).toBe("weapons-of-war:battleaxe");
	});

	it("offers the Marshal's long spear and composite bow to the right moves", async () => {
		const gear = [
			gearRow({ slug: "weapons-of-war:long-spear", weaponSlug: "long-spear", ammoStore: "possessions" }),
			gearRow({ slug: "weapons-of-war:composite-bow", weaponSlug: "composite-bow", ammoStore: "possessions", ammo: true }),
		];
		const clash = await carriedAttackWeapons(actorWith(gear), CLASH);
		expect(clash.map(c => c.meta.name)).toEqual(["Long spear"]);
		const letFly = await carriedAttackWeapons(actorWith(gear), LET_FLY);
		expect(letFly.map(c => c.meta.name)).toEqual(["Composite bow"]);
	});

	it("reads a gear-choice weapon's ammo from possessions.choiceUses, not inventory.resources", async () => {
		const gear = [gearRow({
			slug: "weapons-of-war:crossbow", weaponSlug: "crossbow", ammoStore: "possessions",
		})];
		const actor = actorWith(gear, {
			flags: {
				// 2 = "All out" in that store; the inventory store says otherwise and must be ignored.
				"possessions.choiceUses": { "weapons-of-war:crossbow": 2 },
				"inventory.resources": { "weapons-of-war:crossbow": 0 },
			},
		});
		const [bow] = await carriedAttackWeapons(actor, LET_FLY);
		expect(bow.ammoStore).toBe("possessions");
		expect(bow.ammoLabel).toBe("All out");
	});
});

describe("carriedAttackWeapons — weapons picked up in play", () => {
	it("offers an arcanum weapon off its own tag line (the Blood-quenched Sword)", async () => {
		const actor = actorWith([gearRow({
			slug: "blood-quenched-sword", name: "Blood-quenched Sword",
			note: "<em>close, +1 damage, 1 piercing, messy, magical</em>",
		})]);
		const [w] = await carriedAttackWeapons(actor, CLASH);
		expect(w.meta.name).toBe("Blood-quenched Sword");
		expect(w.meta.damageBonus).toBe(1);
		expect(w.meta.piercing).toBe(1);
		expect(w.meta.tags).toContain("messy");
	});

	it("offers the Thunderbolt Bow for Let Fly, ignoring armor", async () => {
		const actor = actorWith([gearRow({
			slug: "bow-with-no-string", name: "Thunderbolt Bow",
			note: "<em>far, forceful, magical, loud, reload</em>, ignores armor",
		})]);
		const [w] = await carriedAttackWeapons(actor, LET_FLY);
		expect(w.meta.ignoresArmor).toBe(true);
		expect(w.meta.range).toContain("far");
	});

	it("does not offer a non-weapon curio that merely mentions a tag word", async () => {
		const actor = actorWith([gearRow({ slug: "cloak", name: "Demonhide Cloak", note: "<em>1 armor, warm, magical</em>" })]);
		expect(await carriedAttackWeapons(actor, CLASH)).toEqual([]);
	});

	it("names a gear choice by the weapon, not by its whole printed line", async () => {
		// A gear choice prints the name and the tag line as one sentence, and hands the whole of
		// it over as both. The bolded run is the name; the rest is prose the picker states for
		// itself — and un-stripped it put raw <strong> tags on the button and the chat card.
		const label = "<strong>Black iron maul</strong>, utterly immune to all magic (<em>close, forceful, awkward</em>, +1 damage)";
		const actor = actorWith([gearRow({
			slug: "symbol-of-authority:black-iron-maul", weaponSlug: "black-iron-maul",
			name: label, note: label, ammoStore: "possessions",
		})]);
		const [w] = await carriedAttackWeapons(actor, CLASH);
		expect(w.meta.name).toBe("Black iron maul");
		expect(w.meta.damageBonus).toBe(1);
	});
});

// -- What a tag line does NOT make a weapon -----------------------------------
//
// Every one of these was offered for Clash the moment the tag line became a source of weapon
// metadata: they all name a range, because the book writes a lamp's reach and a horse's bite in
// the same words it writes a spear's.

describe("carriedAttackWeapons — things that are not weapons", () => {
	it("does not offer a catalog row the curated table does not name", async () => {
		// A torch is lit, not swung. `catalog` says the row came from the book's equipment list,
		// whose weapons ARE WEAPON_META — so the table's silence is the answer, and the tag line
		// is not consulted at all.
		const actor = actorWith([gearRow({
			slug: "torch", weaponSlug: "torch", catalog: true,
			name: "Torch", note: "lasts ~1 hour; <em>reach</em>, <em>area</em>, <em>dangerous</em>",
		})]);
		expect(await carriedAttackWeapons(actor, CLASH)).toEqual([]);
	});

	it("still offers a catalog weapon the table does name", async () => {
		const actor = actorWith([gearRow({ slug: "sword", weaponSlug: "sword", catalog: true })]);
		expect((await carriedAttackWeapons(actor, CLASH)).map(c => c.meta.name)).toEqual(["Sword"]);
	});

	it("does not offer a light source picked up in play", async () => {
		// Book II's lamps and lanterns have no catalog slug, so the tag line IS all there is —
		// and "reach, area" with no damage beside it is an illumination radius, not a reach.
		const actor = actorWith([
			gearRow({ slug: "t1", name: "Self-burning lamp", note: "<em>reach</em>, <em>area</em>, <em>hours</em>, Value 2" }),
			gearRow({ slug: "t2", name: "12 beeswax candles", note: "~1 hour, <em>close</em>, Value 1" }),
			gearRow({ slug: "t3", name: "A gold butter lamp", note: "<em>magical, reach, area</em>" }),
		]);
		expect(await carriedAttackWeapons(actor, CLASH)).toEqual([]);
	});

	it("does not offer a beast whose stat line prints ITS damage", async () => {
		const actor = actorWith([gearRow({
			slug: "horse", name: "Horse", note: "HP 10, d6+3 damage (<em>hand</em>, <em>close</em>, <em>forceful</em>)",
		})]);
		expect(await carriedAttackWeapons(actor, CLASH)).toEqual([]);
	});

	it("keeps offering a weapon that states an area AND damage", async () => {
		// The naphtha is the reason the rule is "no damage clause", not "no area": it is thrown,
		// it covers an area, and it very much is a weapon.
		const actor = actorWith([gearRow({
			slug: "t4", name: "Clay spheres of naphtha",
			note: "damage d10, <em>thrown</em>, <em>area</em>, <em>dangerous</em>, <em>ignores armor</em>",
		})]);
		expect((await carriedAttackWeapons(actor, LET_FLY)).map(c => c.meta.name)).toEqual(["Clay spheres of naphtha"]);
	});

	it("keeps offering a knife that states only its reach", async () => {
		// The guard must not reach past the two things it names: most picked-up weapons say
		// nothing but "hand, magical", and refusing those would undo the whole feature.
		const actor = actorWith([gearRow({ slug: "t5", name: "An old bronze dagger", note: "<em>hand</em>, magical" })]);
		expect((await carriedAttackWeapons(actor, CLASH)).map(c => c.meta.name)).toEqual(["An old bronze dagger"]);
	});
});

// -- The ammo track is the ITEM's ---------------------------------------------

describe("carriedAttackWeapons — how long the ammo track is", () => {
	it("reads a four-use item as four, not as the bows' two", async () => {
		const gear = [gearRow({
			slug: "spheres", name: "Clay spheres of naphtha", ammo: true, ammoMax: 4,
			note: "damage d10, <em>thrown</em>, <em>area</em>, <em>dangerous</em>",
		})];
		const actor = actorWith(gear, { flags: { "inventory.resources": { spheres: 2 } } });
		const [w] = await carriedAttackWeapons(actor, LET_FLY);
		// Two of four spent is low, NOT "all out" — which is what a hard-coded max of 2 said,
		// with half the case still in hand.
		expect(w.ammoLabel).toBe("Low ammo");
	});

	it("calls the last box of a one-throw item all out", async () => {
		const gear = [gearRow({
			slug: "javelins", name: "Javelins", ammo: true, ammoMax: 1, ammoLabels: ["all out"],
			note: "<em>thrown</em>, +1 damage",
		})];
		const actor = actorWith(gear, { flags: { "inventory.resources": { javelins: 1 } } });
		const [w] = await carriedAttackWeapons(actor, LET_FLY);
		expect(w.ammoLabel).toBe("All out");
	});

	it("prefers the item's own word for a box over the ammo wording", async () => {
		const gear = [gearRow({
			slug: "lantern-bow", name: "Oil-fed sling", ammo: true, ammoMax: 5,
			ammoLabels: ["", "", "", "running low", "out"],
			note: "<em>near</em>, +1 damage",
		})];
		const actor = actorWith(gear, { flags: { "inventory.resources": { "lantern-bow": 4 } } });
		const [w] = await carriedAttackWeapons(actor, LET_FLY);
		expect(w.ammoLabel).toBe("Running low");
	});
});

describe("carriedAttackWeapons — the legacy fallback", () => {
	it("still reads inventory.checked for an actor with no StonetopCharacter", async () => {
		const out = await carriedAttackWeapons(bareActor({ sword: true, rope: true }), CLASH);
		expect(out.map(c => c.meta.name)).toEqual(["Sword"]);
	});

	it("ignores an unticked weapon", async () => {
		expect(await carriedAttackWeapons(bareActor({ sword: false }), CLASH)).toEqual([]);
	});
});

// -- The real gear source, end to end -----------------------------------------

// The tests above hand carriedAttackWeapons its gear records directly, which proves the flow
// reads them but not that StonetopCharacter actually PRODUCES them. This closes that gap: a real
// Heavy, a real Weapons-of-War bundle, and the two slugs the flow depends on.
describe("StonetopCharacter#carriedWeaponGear (the real source)", () => {
	const HEAVY = {
		slug: "the-heavy", name: "The Heavy",
		specialPossessions: {
			pickCount: 0, preselected: ["weapons-of-war"],
			options: [{
				slug: "weapons-of-war", label: "Weapons of war",
				choices: {
					pickCount: 3, gear: true,
					options: [
						{ slug: "battleaxe", label: "◇ Battleaxe, iron (close, messy)" },
						{ slug: "crossbow",  label: "◇ Crossbow (far, +1 damage, reload)" },
					],
				},
			}],
		},
	};

	async function heavyCarrying(carried) {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withFlag("possessions.subChoices", { "weapons-of-war": ["battleaxe", "crossbow"] })
			.withFlag("possessions.choiceCarried", carried)
			.build();
		return new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([]))
			.withArcanaRepo(new FakeArcanaRepository([]))
			.addPlaybook(HEAVY).build();
	}

	it("carries BOTH slugs: the composite for its mark, the choice slug for WEAPON_META", async () => {
		const char = await heavyCarrying({ "weapons-of-war:battleaxe": true });
		const gear = await char.carriedWeaponGear();
		const axe = gear.find(g => g.weaponSlug === "battleaxe");
		expect(axe).toBeTruthy();
		expect(axe.slug).toBe("weapons-of-war:battleaxe");
		expect(axe.ammoStore).toBe("possessions");
	});

	it("leaves out a weapon that is owned but not carried", async () => {
		const char = await heavyCarrying({ "weapons-of-war:battleaxe": true });
		const gear = await char.carriedWeaponGear();
		expect(gear.find(g => g.weaponSlug === "crossbow")).toBeFalsy();
	});

	it("actually reaches the attack flow: the axe is offered for Clash", async () => {
		const char = await heavyCarrying({ "weapons-of-war:battleaxe": true });
		// The real records, through the real enumeration.
		const actor = { items: [], typedActor: char, getFlag: () => null };
		const out = await carriedAttackWeapons(actor, CLASH);
		expect(out.map(c => c.meta.name)).toContain("Battleaxe");
	});
});

// -- The tag-line reader ------------------------------------------------------

describe("weaponMetaFromNote", () => {
	it("reads range, bonus, piercing and tags", () => {
		const m = weaponMetaFromNote("Aetherium Spear", "close,thrown,magical, +1 damage");
		expect(m.range).toEqual(["close", "thrown"]);
		expect(m.damageBonus).toBe(1);
		expect(m.tags).toContain("magical");
	});

	it("reads the iron weapons' 'x piercing' as the Prosperity-scaled kind", () => {
		expect(weaponMetaFromNote("Spear", "close, x piercing").piercing).toBe("prosperity");
	});

	it("is not a weapon without a range", () => {
		expect(weaponMetaFromNote("A gold ring", "magical, valuable")).toBeNull();
		expect(weaponMetaFromNote("Rune-laden Scales", "2 armor, magical")).toBeNull();
	});

	it("does not read a bare 'damage' as a bonus", () => {
		// The book writes a weapon's bonus with a sign; "damage d6" in prose is not one.
		expect(weaponMetaFromNote("Club", "close, damage d6").damageBonus).toBe(0);
	});

	it("takes its ammo flag from the item's track, not from the word 'reload'", () => {
		expect(weaponMetaFromNote("Bow", "far, reload").ammo).toBe(false);
		expect(weaponMetaFromNote("Bow", "far, reload", { ammo: true }).ammo).toBe(true);
	});

	it("survives an empty or missing note", () => {
		expect(weaponMetaFromNote("Thing", "")).toBeNull();
		expect(weaponMetaFromNote("Thing", null)).toBeNull();
	});

	it("refuses a light source, and only for want of a damage clause", () => {
		expect(weaponMetaFromNote("A lantern", "<em>5 hours</em>, <em>reach</em>, <em>area</em>, magical")).toBeNull();
		expect(weaponMetaFromNote("Torch", "lasts ~1 hour; reach, area, dangerous")).toBeNull();
		// The same line with a die on it is the naphtha, and a weapon.
		expect(weaponMetaFromNote("Firepot", "d8, thrown, area, dangerous").damageBonus).toBe(0);
		expect(weaponMetaFromNote("Firepot", "d8, thrown, area, dangerous").range).toContain("thrown");
	});

	it("refuses a beast's own stat line", () => {
		expect(weaponMetaFromNote("Mule", "HP 14, d6+1 damage (hand, close)")).toBeNull();
	});

	it("takes the bolded name out of a line that prints the name and the tags together", () => {
		const label = "<strong>Makerglass sword</strong>, forged before the fall (<em>close, messy</em>, +1 damage)";
		expect(weaponMetaFromNote(label, label).name).toBe("Makerglass sword");
	});

	it("leaves a plain name whole, markup or none", () => {
		expect(weaponMetaFromNote("A silver-alloy dagger, useful against undead spirits", "hand, Value 2").name)
			.toBe("A silver-alloy dagger, useful against undead spirits");
		expect(weaponMetaFromNote("<em>Orichalcum spear</em>", "close, thrown, 1 piercing").name)
			.toBe("Orichalcum spear");
	});
});

// -- Unpierceable armor -------------------------------------------------------

// The Rune-laden Scales' PROOF AGAINST HARM: "3 armor, even against piercing and attacks that
// normally ignore armor." A FLOOR under the mitigation, not a second pool.
describe("mitigateDamage with unpierceable armor", () => {
	it("behaves exactly as before when nothing is unpierceable", () => {
		expect(mitigateDamage(10, { armor: 2 })).toBe(8);
		expect(mitigateDamage(10, { armor: 2, piercing: 1 })).toBe(9);
		expect(mitigateDamage(10, { armor: 2, ignoresArmor: true })).toBe(10);
	});

	it("stops piercing at the floor", () => {
		expect(mitigateDamage(10, { armor: 3, piercing: 2, unpierceable: 3 })).toBe(7);
	});

	it("still soaks when the attack ignores armor", () => {
		expect(mitigateDamage(10, { armor: 3, ignoresArmor: true, unpierceable: 3 })).toBe(7);
	});

	it("lets piercing eat the pierceable part above the floor first", () => {
		// 3 unpierceable + a 1-point shield = 4 armor; 1 piercing takes the shield's point only.
		expect(mitigateDamage(10, { armor: 4, piercing: 1, unpierceable: 3 })).toBe(7);
		// 2 piercing cannot go below the floor.
		expect(mitigateDamage(10, { armor: 4, piercing: 2, unpierceable: 3 })).toBe(7);
	});

	it("never invents protection beyond the armor actually worn", () => {
		// A floor bigger than the total can only mean stale state; it must not soak more than
		// the armor present.
		expect(mitigateDamage(10, { armor: 1, unpierceable: 5, ignoresArmor: true })).toBe(9);
	});

	it("never returns negative damage", () => {
		expect(mitigateDamage(2, { armor: 9, unpierceable: 9 })).toBe(0);
	});
});
