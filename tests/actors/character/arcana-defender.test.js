import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARCANA_DEFENCES } from "../../../module/data/arcana-rules.js";
import { arcanaDefenderLines, demonhideFloor, readsAsDemon } from "../../../module/actors/character/arcana-defender.js";
import { noteArcanumBack, ruleBoxes } from "../../../module/data/arcana-rules.js";
import { mitigateDamage } from "../../../module/utils/damage.js";

// Audit EDG-15 (2026-11-06): a defender's arcana on a blow that lands on them (Book II).

const PACKS = path.resolve(__dirname, "../../../packs/src/stonetop-arcana");
const back = file => JSON.parse(fs.readFileSync(path.join(PACKS, file), "utf8")).flags.stonetop.back.description;

noteArcanumBack("norubas-ice-sphere", back("major/norubas-ice-sphere.json"));
noteArcanumBack("redwood-effigy", back("major/redwood-effigy.json"));

function pc({ owned = [], leads = [], boxes = {}, checked = {} } = {}) {
	return {
		documentName: "Actor", type: "character", name: "Bryn", uuid: "Actor.bryn",
		typedActor: { _arcana: { ownedSlugs: new Set(owned), leadSlugs: new Set(leads), boxStates: boxes }, _inventory: { checked } },
	};
}
const at = actor => [{ uuid: actor.uuid }];
const resolveTo = actor => () => actor;

describe("the cards' boxes", () => {
	it("are found on the shipped backs by the words printed right after them", () => {
		const { iceSphere, redwood } = ARCANA_DEFENCES;
		expect(ruleBoxes(iceSphere)).toEqual([10]);
		expect(ruleBoxes(redwood)).toEqual([8]);
	});
});

describe("the damage window's lines", () => {
	it("offers the Ice Sphere's 'roll twice and take the higher' against fire, unticked (pp.546-547)", () => {
		const bryn = pc({ owned: ["norubas-ice-sphere"], boxes: { "norubas-ice-sphere:back:10": true } });
		expect(arcanaDefenderLines(at(bryn), { resolve: resolveTo(bryn) }))
			.toEqual([expect.objectContaining({ key: "arcana-ice-sphere", mode: "adv", applied: false })]);
	});

	it("offers the Redwood Effigy's +1d6 from heat or fire, unticked (pp.570-571)", () => {
		const bryn = pc({ owned: ["redwood-effigy"], boxes: { "redwood-effigy:back:8": true } });
		expect(arcanaDefenderLines(at(bryn), { resolve: resolveTo(bryn) }))
			.toEqual([expect.objectContaining({ key: "arcana-redwood-fire", dice: "1d6", applied: false })]);
	});

	it("offers nothing unmarked, at a non-character, or at several targets", () => {
		const bryn = pc({ owned: ["redwood-effigy"], boxes: { "redwood-effigy:back:8": true } });
		expect(arcanaDefenderLines(at(pc({ owned: ["redwood-effigy"] })), { resolve: resolveTo(pc({ owned: ["redwood-effigy"] })) })).toEqual([]);
		expect(arcanaDefenderLines([{ uuid: "a" }, { uuid: "b" }], { resolve: resolveTo(bryn) })).toEqual([]);
		expect(arcanaDefenderLines(at(bryn), { resolve: () => ({ documentName: "Actor", type: "monster" }) })).toEqual([]);
		expect(arcanaDefenderLines([], {})).toEqual([]);
	});
});

describe("the Demonhide Cloak (p.544)", () => {
	const demon = { documentName: "Actor", type: "monster", name: "Hungering one", system: { concept: "a demon of the Hollow", tags: "" } };
	const wolf = { documentName: "Actor", type: "monster", name: "Wolf", system: { tags: "group, beast" } };
	const worn = pc({ owned: ["demonhide-cloak"], checked: { "demonhide-cloak": true } });

	it("reads a demon off the stat block", () => {
		expect(readsAsDemon(demon)).toBe(true);
		expect(readsAsDemon({ actor: { name: "Imp", system: { tags: "demonic, small" } } })).toBe(true);
		expect(readsAsDemon(wolf)).toBe(false);
		expect(readsAsDemon(null)).toBe(false);
	});

	it("holds its 1 armor against a demon's piercing and 'ignores armor', worn and held only", () => {
		expect(demonhideFloor(worn, demon)).toBe(1);
		expect(demonhideFloor(worn, wolf)).toBe(0);
		expect(demonhideFloor(pc({ owned: ["demonhide-cloak"] }), demon)).toBe(0);
		expect(demonhideFloor(pc({ checked: { "demonhide-cloak": true } }), demon)).toBe(0);
		// A lead is not in their hands yet, whatever the Inventory box says.
		expect(demonhideFloor(pc({ owned: ["demonhide-cloak"], leads: ["demonhide-cloak"], checked: { "demonhide-cloak": true } }), demon)).toBe(0);
		// As Apply uses it: 5 damage that ignores armor, against 1 armor floored by the Cloak, is 4.
		expect(mitigateDamage(5, { armor: 1, ignoresArmor: true, unpierceable: demonhideFloor(worn, demon) })).toBe(4);
		expect(mitigateDamage(5, { armor: 1, piercing: 3, unpierceable: demonhideFloor(worn, demon) })).toBe(4);
	});
});
