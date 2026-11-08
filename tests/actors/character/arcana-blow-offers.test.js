import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	arcanaBlowOffers, markDebilityForBlow, spendHeldCircle,
} from "../../../module/actors/character/arcana-blow-offers.js";
import { ARCANA_RIDERS, noteArcanumBack, ruleBoxes, ruleTrack } from "../../../module/data/arcana-rules.js";

// Audit EDG-5 (2026-11-06): what an arcanum adds to a blow reaches the damage window (Book II card text).

const PACKS = path.resolve(__dirname, "../../../packs/src/stonetop-arcana");
const back = file => JSON.parse(fs.readFileSync(path.join(PACKS, file), "utf8")).flags.stonetop.back.description;
for (const slug of ["storm-markings", "twisted-spear", "shield-of-the-wisent-witch", "blood-quenched-sword"]) noteArcanumBack(slug, back(`major/${slug}.json`));

/** A character holding `owned` cards, with `boxes` ticked and `resources` on its inventory. */
function hero({ owned = [], leads = [], boxes = {}, resources = {}, debilities = [] } = {}) {
	const arcana = {
		ownedSlugs: new Set(owned),
		leadSlugs: new Set(leads),
		boxStates: { ...boxes },
		setArcanumBoxChecked: vi.fn(async (slug, context, index, checked) => {
			arcana.boxStates[`${slug}:${context}:${index}`] = checked;
			return true;
		}),
	};
	const typed = {
		_arcana: arcana,
		_inventory: { resources },
		debilityMarkChoices: debilities,
		markDebility: vi.fn(async () => true),
	};
	return { type: "character", name: "Rhian", typedActor: typed, arcana, typed };
}

const keys = offers => offers.map(o => o.key);

describe("the cards' boxes, as the shipped backs print them", () => {
	it("finds the box and the track each rider reads by its printed label", () => {
		expect(ruleBoxes(ARCANA_RIDERS.stormsFury)).toEqual([0]);
		expect(ruleTrack(ARCANA_RIDERS.stormsFury)).toEqual({ from: 0, length: 4 });
		expect(ruleBoxes(ARCANA_RIDERS.promiseOfDoom)).toEqual([1]);
		expect(ruleBoxes(ARCANA_RIDERS.herd)).toEqual([0]);
		// The blood-rage's □□□ all end at its words.
		expect(ruleBoxes(ARCANA_RIDERS.bloodRage)).toEqual([2, 3, 4]);
		expect(back("major/blood-quenched-sword.json")).toContain(`□□□ ${ARCANA_RIDERS.bloodRage.label}`);
	});

	it("reads a rider's box as unmarked while its card's text is unread", () => {
		expect(ruleBoxes({ slug: "not-a-rule-card", label: "ANYTHING" })).toEqual([]);
		expect(ruleTrack({ slug: "not-a-rule-card", label: "ANYTHING", track: true })).toBeNull();
	});
});

describe("the riders", () => {
	const sword = { slug: "rusty-steel-blade", name: "Flaming Sword" };

	it("adds the Blaze die to the Flaming Sword's blow, ticked, while it is lit (p.534)", () => {
		const lit = hero({ owned: ["rusty-steel-blade"], resources: { "rusty-steel-blade": 2 } });
		const [blaze] = arcanaBlowOffers(lit, { weapon: sword, moveKey: "clash" });
		expect(blaze).toMatchObject({ key: "arcana-blaze", dice: "1d6", applied: true });
		// Unlit (the Blaze die is nil), another weapon, or the rusty blade's front: nothing.
		expect(arcanaBlowOffers(hero({ owned: ["rusty-steel-blade"] }), { weapon: sword })).toEqual([]);
		expect(arcanaBlowOffers(lit, { weapon: { slug: "spear", name: "Spear" } })).toEqual([]);
		expect(arcanaBlowOffers(lit, { weapon: { slug: "rusty-steel-blade", name: "Rusty steel blade" } })).toEqual([]);
		// A lead is not in their hands yet.
		expect(arcanaBlowOffers(hero({ owned: ["rusty-steel-blade"], leads: ["rusty-steel-blade"], resources: { "rusty-steel-blade": 1 } }), { weapon: sword })).toEqual([]);
	});

	it("offers the Aetherium Spear's lightning on a Clash, for a debility the player picks (p.531)", async () => {
		const pc = hero({ owned: ["corroded-spearhead"], debilities: [{ key: "weakened", name: "Weakened" }, { key: "dazed", name: "Dazed", marked: true }] });
		const spear = { slug: "corroded-spearhead", name: "Aetherium Spear" };
		const [line] = arcanaBlowOffers(pc, { weapon: spear, moveKey: "clash" });
		expect(line).toMatchObject({ key: "arcana-aetherium", dice: "1d6", applied: false, tags: ["forceful", "loud"] });
		expect(arcanaBlowOffers(pc, { weapon: spear, moveKey: "letfly" })).toEqual([]);
		const ask = vi.fn(async ({ buttons }) => {
			expect(buttons.map(b => b.value)).toEqual(["weakened", null]);
			return "weakened";
		});
		expect(await markDebilityForBlow(pc, "Aetherium Spear", { ask })).toBe(true);
		expect(pc.typed.markDebility).toHaveBeenCalledWith("weakened", { moveName: "Aetherium Spear" });
		expect(await markDebilityForBlow(pc, "Aetherium Spear", { ask: async () => null })).toBeNull();
	});

	it("offers the Thunderbolt Bow's charged shot, unticked, on a shot (p.532)", () => {
		const pc = hero({ owned: ["bow-with-no-string"] });
		const bow = { slug: "bow-with-no-string", name: "Thunderbolt Bow" };
		expect(arcanaBlowOffers(pc, { weapon: bow, moveKey: "letfly" })).toEqual([
			expect.objectContaining({ key: "arcana-thunderbolt", dice: "1d4", applied: false, tags: ["area", "dangerous"] }),
		]);
		expect(arcanaBlowOffers(pc, { weapon: bow, moveKey: "clash" })).toEqual([]);
	});

	it("spends 1 Fury for the force of thunder while Storm's Fury holds some (pp.566-567)", async () => {
		const pc = hero({ owned: ["storm-markings"], boxes: { "storm-markings:back:0": true, "storm-markings:backCircle:0": true, "storm-markings:backCircle:1": true } });
		const [line] = arcanaBlowOffers(pc, {});
		expect(line).toMatchObject({ key: "arcana-stormsFury", dice: "1d6", applied: false, tags: ["forceful", "loud"] });
		expect(await line.spend(pc)).toBe(true);
		expect(pc.arcana.setArcanumBoxChecked).toHaveBeenCalledWith("storm-markings", "backCircle", 1, false);
		expect(await spendHeldCircle(pc, "storm-markings", ruleTrack(ARCANA_RIDERS.stormsFury))).toBe(true);
		// None left by the time it is paid: unpaid, so the window leaves the +1d6 off.
		expect(await spendHeldCircle(pc, "storm-markings", ruleTrack(ARCANA_RIDERS.stormsFury))).toBeNull();
		expect(arcanaBlowOffers(pc, {})).toEqual([]);
		// Without the mystery learned there is no Fury to spend.
		expect(arcanaBlowOffers(hero({ owned: ["storm-markings"], boxes: { "storm-markings:backCircle:0": true } }), {})).toEqual([]);
	});

	it("offers Promise of Doom's +2d4 and its -4, both the player's to say (pp.542-543)", () => {
		const pc = hero({ owned: ["twisted-spear"], boxes: { "twisted-spear:back:1": true } });
		const offers = arcanaBlowOffers(pc, {});
		expect(keys(offers)).toEqual(["arcana-doomSworn", "arcana-doomOther"]);
		expect(offers.map(o => o.dice)).toEqual(["2d4", "-4"]);
		expect(offers.every(o => o.applied === false)).toBe(true);
		expect(arcanaBlowOffers(hero({ owned: ["twisted-spear"], boxes: { "twisted-spear:back:0": true } }), {})).toEqual([]);
	});

	it("offers the wisent herd on a Clash once Spirits of the Herd is learned (pp.554-555)", () => {
		const pc = hero({ owned: ["shield-of-the-wisent-witch"], boxes: { "shield-of-the-wisent-witch:back:0": true } });
		expect(keys(arcanaBlowOffers(pc, { moveKey: "clash" }))).toEqual(["arcana-herd"]);
		expect(arcanaBlowOffers(pc, { moveKey: "letfly" })).toEqual([]);
	});

	it("offers the blood-rage's advantage while that consequence is marked (pp.552-553)", () => {
		const pc = hero({ owned: ["blood-quenched-sword"], boxes: { "blood-quenched-sword:back:3": true } });
		expect(arcanaBlowOffers(pc, {})).toEqual([expect.objectContaining({ key: "arcana-bloodRage", mode: "adv", applied: false })]);
		expect(arcanaBlowOffers(hero({ owned: ["blood-quenched-sword"] }), {})).toEqual([]);
	});

	it("is nothing for anyone but a character with arcana", () => {
		expect(arcanaBlowOffers({ type: "npc" }, {})).toEqual([]);
		expect(arcanaBlowOffers({ type: "character", typedActor: null }, {})).toEqual([]);
	});
});
