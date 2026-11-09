import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { installCombatChatFakes, uninstallCombatChatFakes } from "../fakes/combat-chat.js";

// The Let Fly an arcanum grants, as Book II prints it (round-2 audit, handed from EDG to ATK): the Storm Markings'
// bolt of lightning, the Azure Hand's fling, the Aetherium Spear's warcry blast.

const { arcanaAttackWeapons, arcanaGrantOpen, payArcanaGrantCost } = await import("../../module/combat/arcana-attacks.js");
const { heldOn } = await import("../../module/actors/character/arcana-blow-offers.js");
const { ARCANA_RIDERS, noteArcanumBack, ruleTrack } = await import("../../module/data/arcana-rules.js");
const { ARCANA_GRANTED_WEAPONS, isLetFlyWeapon } = await import("../../module/data/weapons.js");
const { carriedAttackWeapons, weaponWarningsHtml } = await import("../../module/combat/attack-flow.js");
const { backBoxChecked } = await import("../../module/utils/glyphs.js");

const LET_FLY = { key: "let-fly", filter: isLetFlyWeapon };
const card = slug => JSON.parse(fs.readFileSync(path.resolve(`packs/src/stonetop-arcana/${slug}.json`), "utf8")).flags.stonetop;
const STORM = card("major/storm-markings");
const AZURE = card("major/azure-hand");
const SPEAR = card("minor/corroded-spearhead");
noteArcanumBack("storm-markings", STORM.back.description);

/** A character holding `owned` arcana with these box states and debilities. */
function seeker({ owned = [], identified = owned, leads = [], boxes = {}, unlocked = true, debilities = [] } = {}) {
	const cards = { "storm-markings": STORM, "azure-hand": AZURE, "corroded-spearhead": SPEAR };
	return {
		type: "character", name: "Blodwen", uuid: "Actor.b", items: [],
		getFlag: () => null,
		typedActor: {
			carriedWeaponGear: async () => [],
			debilityMarkChoices: debilities,
			_arcana: {
				ownedSlugs: new Set(owned), identifiedSlugs: new Set(identified), leadSlugs: new Set(leads), boxStates: boxes,
				isArcanumUnlocked: async () => unlocked,
				getArcanum: async slug => cards[slug] ?? null,
			},
		},
	};
}

const I18N = globalThis.game?.i18n;
beforeEach(() => { installCombatChatFakes(); globalThis.game.i18n = I18N; });
afterEach(() => { uninstallCombatChatFakes(); vi.restoreAllMocks(); });

describe("the cards' own words", () => {
	it("name the two Storm Markings mysteries the bolt needs, as back boxes 0 and 1", () => {
		const back = STORM.back.description;
		expect(backBoxChecked(back, "storm-markings", "STORM'S FURY", { "storm-markings:back:0": true })).toBe(true);
		expect(backBoxChecked(back, "storm-markings", "CHOSEN OF THE STORM-BRINGER", { "storm-markings:back:1": true })).toBe(true);
		expect(back).toContain("Roll +CON to Let Fly with a bolt of lightning (2d6 damage");
	});

	it("print the Azure Hand's +INT fling on its front, and the spear's +STR warcry on its back", () => {
		expect(AZURE.front.description).toMatch(/rolling \+INT to Let Fly/);
		expect(SPEAR.back.description).toMatch(/rolling \+STR to Let Fly instead of \+DEX/);
		expect(SPEAR.back.item.name).toBe(ARCANA_GRANTED_WEAPONS.aetheriumBlast.gate.name);
	});

	it("carry the printed profiles", () => {
		expect(ARCANA_GRANTED_WEAPONS.stormBolt).toMatchObject({ stat: "con", cost: "fury", meta: { damageDie: "2d6", ignoresArmor: true, range: ["thrown"] } });
		expect(ARCANA_GRANTED_WEAPONS.azureFling).toMatchObject({ stat: "int", cost: "vortex", gmDamage: true, meta: { range: ["thrown"], tags: ["dangerous"] } });
		expect(ARCANA_GRANTED_WEAPONS.aetheriumBlast).toMatchObject({ stat: "str", cost: "debility", meta: { range: ["far"], area: true, ammo: false } });
	});
});

describe("offered only while the card says it may be used", () => {
	it("offers the bolt once Storm's Fury and Chosen of the Storm-bringer are both ticked on an unlocked card", async () => {
		const both = { "storm-markings:back:0": true, "storm-markings:back:1": true };
		expect(await arcanaGrantOpen(seeker({ owned: ["storm-markings"], boxes: both }), [], ARCANA_GRANTED_WEAPONS.stormBolt)).toBe(true);
		expect(await arcanaGrantOpen(seeker({ owned: ["storm-markings"], boxes: { "storm-markings:back:0": true } }), [], ARCANA_GRANTED_WEAPONS.stormBolt)).toBe(false);
		expect(await arcanaGrantOpen(seeker({ owned: ["storm-markings"], boxes: both, unlocked: false }), [], ARCANA_GRANTED_WEAPONS.stormBolt)).toBe(false);
		expect(await arcanaGrantOpen(seeker({ owned: ["storm-markings"], leads: ["storm-markings"], boxes: both }), [], ARCANA_GRANTED_WEAPONS.stormBolt)).toBe(false);
	});

	it("offers the fling while the Azure Hand is carried and identified", async () => {
		const gear = [{ slug: "azure-hand", name: "Azure Hand" }];
		expect(await arcanaGrantOpen(seeker({ owned: ["azure-hand"] }), gear, ARCANA_GRANTED_WEAPONS.azureFling)).toBe(true);
		expect(await arcanaGrantOpen(seeker({ owned: ["azure-hand"] }), [], ARCANA_GRANTED_WEAPONS.azureFling)).toBe(false);
		expect(await arcanaGrantOpen(seeker({ owned: ["azure-hand"], identified: [] }), gear, ARCANA_GRANTED_WEAPONS.azureFling)).toBe(false);
	});

	it("offers the blast only with the spear's back realised (carried as the Aetherium Spear)", async () => {
		const row = ARCANA_GRANTED_WEAPONS.aetheriumBlast;
		expect(await arcanaGrantOpen(seeker({ owned: ["corroded-spearhead"] }), [{ slug: "corroded-spearhead", name: "Aetherium Spear" }], row)).toBe(true);
		expect(await arcanaGrantOpen(seeker({ owned: ["corroded-spearhead"] }), [{ slug: "corroded-spearhead", name: "A corroded spearhead" }], row)).toBe(false);
	});

	it("puts them in the Let Fly picker, beside an unarmed row, carrying the stat and the price", async () => {
		const actor = seeker({ owned: ["storm-markings"], boxes: { "storm-markings:back:0": true, "storm-markings:back:1": true } });
		const candidates = await carriedAttackWeapons(actor, LET_FLY);
		expect(candidates.map(c => c.slug)).toEqual(["", "storm-markings-lightning-bolt"]);
		expect(candidates[1].grant).toMatchObject({ stat: "con", cost: "fury", card: "storm-markings" });
		expect(await arcanaAttackWeapons(actor, [], { filter: () => false })).toEqual([]);
	});
});

describe("the printed price, asked when the attack is made", () => {
	const bolt = { grant: { key: "stormBolt", stat: "con", cost: "fury", name: "Chosen of the Storm-bringer" } };
	const blast = { grant: { key: "aetheriumBlast", stat: "str", cost: "debility", name: "Aetherium Spear" } };
	const fling = { grant: { key: "azureFling", stat: "int", cost: "vortex", name: "Azure Hand" } };

	it("spends 1 Fury once the player says so, and backs out with nothing spent", async () => {
		const actor = seeker({ owned: ["storm-markings"], boxes: { "storm-markings:backCircle:0": true, "storm-markings:backCircle:1": true } });
		expect(heldOn(actor.typedActor._arcana.boxStates, "storm-markings", ruleTrack(ARCANA_RIDERS.stormsFury))).toBe(2);
		const spendFury = vi.fn(async () => true);
		const paid = await payArcanaGrantCost(actor, bolt, { ask: async () => true, spendFury });
		expect(paid).toMatchObject({ paid: true });
		expect(spendFury).toHaveBeenCalledWith(actor, "storm-markings", expect.objectContaining({ from: 0, length: 4 }));
		// A roll that never lands ticks back the very circle spent: the last one held.
		actor.typedActor._arcana.setArcanumBoxChecked = vi.fn(async () => {});
		await paid.refund();
		expect(actor.typedActor._arcana.setArcanumBoxChecked).toHaveBeenCalledWith("storm-markings", "backCircle", 1, true);
		const unspent = vi.fn();
		expect(await payArcanaGrantCost(actor, bolt, { ask: async () => false, spendFury: unspent })).toBe("cancel");
		expect(unspent).not.toHaveBeenCalled();
	});

	it("flags, never blocks, a bolt with no Fury held, and says so on the damage card", async () => {
		const ask = vi.fn();
		const price = await payArcanaGrantCost(seeker({ owned: ["storm-markings"] }), bolt, { ask });
		expect(price.unpaid).toContain("no Fury");
		expect(ask).not.toHaveBeenCalled();
		expect(weaponWarningsHtml({ costUnpaid: price.unpaid })).toContain("no Fury");
	});

	it("marks a debility of the player's choice for the blast, and flags one with none left", async () => {
		const markDebility = vi.fn(async () => true);
		const open = seeker({ debilities: [{ key: "weakened", name: "Weakened", marked: false }] });
		expect(await payArcanaGrantCost(open, blast, { markDebility })).toEqual({ paid: true });
		expect(markDebility).toHaveBeenCalledWith(open, "Aetherium Spear");
		// The debility just marked is cleared again by a roll that never lands.
		const marks = vi.fn(async () => { open.typedActor.debilityMarkChoices[0].marked = true; return true; });
		open.typedActor.receiveHealing = vi.fn(async () => ({}));
		const paid = await payArcanaGrantCost(open, blast, { markDebility: marks });
		await paid.refund();
		expect(open.typedActor.receiveHealing).toHaveBeenCalledWith({ clearDebilities: ["weakened"] });
		open.typedActor.debilityMarkChoices[0].marked = false;
		expect(await payArcanaGrantCost(open, blast, { markDebility: async () => null })).toBe("cancel");
		const none = seeker({ debilities: [{ key: "weakened", name: "Weakened", marked: true }] });
		expect((await payArcanaGrantCost(none, blast, { markDebility })).unpaid).toContain("no debility");
	});

	it("asks before flinging the Azure Hand's energy, and charges nothing else", async () => {
		expect(await payArcanaGrantCost(seeker(), fling, { ask: async () => true })).toEqual({ paid: true });
		expect(await payArcanaGrantCost(seeker(), fling, { ask: async () => null })).toBe("cancel");
		expect(await payArcanaGrantCost(seeker(), { name: "Bow" })).toEqual({ paid: true });
	});

	it("says on the card that the fling's damage is the GM's", () => {
		expect(weaponWarningsHtml({ grant: { name: "Azure Hand", gmDamage: true } })).toContain("other effects of the GM");
	});
});
