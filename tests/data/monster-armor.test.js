// A stat block's printed armor exception ("Armor 0 vs. bronze", Book I p.397 "list any variants or exceptions")
// rides the same damage-card box an NPC follower's "2 (0 vs. iron)" does (audit FOE-1), and everything else
// that changes what a blow does to it is a reminder line, never arithmetic (the user's ruling, 2026-10-23).

import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	monsterArmorGate, monsterDamageNotes,
} from "../../module/data/monster-armor.js";
import { armorGateWords } from "../../module/actors/character/move-armor.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = resolve(HERE, "../../packs/src/stonetop-bestiary");
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const statBlocks = () => walk(PACK).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(f, "utf8"))).filter(j => j.type === "monster");

const block = (armor, qualities = "", source = "resilience") => ({ attributes: { armor: { value: armor, source } }, qualities });

describe("monsterArmorGate", () => {
	it("reads a lower armor against one thing as the part of the armor it takes away", () => {
		expect(monsterArmorGate(block(4, "<p>Hates daylight. Armor 0 vs. bronze.</p>"))).toEqual({ conditional: 4, conditionalSource: "vs. bronze" });
		expect(monsterArmorGate(block(6, "<p>Armor 2 vs. iron.</p>"))).toEqual({ conditional: 4, conditionalSource: "vs. iron" });
		expect(monsterArmorGate(block(4, "<p>Bound to their barrow. Armor 2 vs. bronze or fire (mail).</p>"))).toEqual({ conditional: 2, conditionalSource: "vs. bronze or fire" });
		expect(monsterArmorGate(block(4, "<p>Armor 0 against bare hands.</p>"))).toEqual({ conditional: 4, conditionalSource: "vs. bare hands" });
	});

	it("reads an enricher's label and stops the thing at a dash", () => {
		const fae = block(5, "<p><strong>@UUID[Compendium.x.JournalEntry.y]{Fae nature}</strong>. Armor 1 vs. black iron &mdash; and can be truly destroyed only by black iron.</p>");
		expect(monsterArmorGate(fae)).toEqual({ conditional: 4, conditionalSource: "vs. black iron" });
	});

	it("reads an armor source that is itself the exception (the Unliving Chimera)", () => {
		expect(monsterArmorGate(block(4, "", "0 vs. bronze"))).toEqual({ conditional: 4, conditionalSource: "vs. bronze" });
	});

	it("carries nothing for a higher armor against one thing, or none printed", () => {
		expect(monsterArmorGate(block(1, "<p>Armor 4 vs. stabbing (just bones).</p>"))).toEqual({ conditional: 0, conditionalSource: "" });
		expect(monsterArmorGate(block(3, "<p>Fireproof.</p>"))).toEqual({ conditional: 0, conditionalSource: "" });
		expect(monsterArmorGate({})).toEqual({ conditional: 0, conditionalSource: "" });
	});

	it("is worded by the damage card's versus box", () => {
		expect(armorGateWords(monsterArmorGate(block(4, "Armor 0 vs. bronze.")).conditionalSource)).toMatchObject({ key: "versus", params: { against: "bronze" } });
	});
});

describe("monsterDamageNotes", () => {
	it("lists the weaknesses and defenses, and the armor exceptions the box does not carry", () => {
		const vermin = block(5, "<p>Hive-mind; unharmed by piercing or cutting weapons; takes half damage from smashing weapons; vulnerable to area effects (like naphtha fire). Armor 1 vs. bronze.</p>");
		expect(monsterDamageNotes(vermin)).toEqual([
			"Unharmed by piercing or cutting weapons", "Takes half damage from smashing weapons", "Vulnerable to area effects (like naphtha fire)",
		]);
		expect(monsterDamageNotes(block(1, "<p>Armor 4 vs. stabbing (just bones).</p>"))).toEqual(["Armor 4 vs. stabbing (just bones)"]);
		expect(monsterDamageNotes(block(4, "<p>Armor 1 vs. iron (bark); takes +1d4 damage from bronze.</p>"))).toEqual(["Takes +1d4 damage from bronze"]);
	});

	it("keeps the half of a clause the box does not say, and says nothing of harm the monster deals", () => {
		expect(monsterDamageNotes(block(5, "<p>Armor 1 vs. black iron — and can be truly destroyed only by black iron.</p>")))
			.toEqual(["Can be truly destroyed only by black iron"]);
		expect(monsterDamageNotes(block(2, "<p>Deals damage with disadvantage; batters them with debris (d6 damage).</p>"))).toEqual([]);
		expect(monsterDamageNotes(block(2, "<p>Immune to mental manipulation.</p>"))).toEqual([]);
	});
});

// MonsterModel reads `foundry.data.fields` at import time and the node suite has no Foundry: stub the field
// constructors and the base class, then import it (as tests/data-models/MoveModel.test.js does).
describe("MonsterModel#prepareDerivedData", () => {
	let MonsterModel;
	beforeAll(async () => {
		globalThis.foundry ??= {};
		foundry.data ??= {};
		foundry.data.fields ??= new Proxy({}, { get: () => class {} });
		foundry.abstract ??= {};
		foundry.abstract.TypeDataModel ??= class {};
		({ MonsterModel } = await import("../../module/data-models/MonsterModel.js"));
	});

	const prepared = system => {
		const model = Object.assign(Object.create(MonsterModel.prototype), structuredClone(system));
		model.prepareDerivedData();
		return model.attributes.armor;
	};

	it("derives the exception from the stat block's own text, stored in no field of its own", () => {
		expect(MonsterModel.defineSchema().attributes).toBeDefined();
		expect(prepared(block(4, "<p>Armor 0 vs. bronze.</p>"))).toMatchObject({ value: 4, conditional: 4, conditionalSource: "vs. bronze" });
		expect(prepared(block(3, "<p>Fireproof.</p>"))).toMatchObject({ value: 3, conditional: 0, conditionalSource: "" });
	});

	it("follows an edit or an armor boost at once, whatever was there before", () => {
		const boosted = block(5, "<p>Armor 0 vs. bronze.</p>");
		boosted.attributes.armor.conditional = 4;
		boosted.attributes.armor.conditionalSource = "vs. silver";
		expect(prepared(boosted)).toMatchObject({ conditional: 5, conditionalSource: "vs. bronze" });
	});
});

describe("the shipped bestiary", () => {
	it("prints an exception the damage card's box can read on the stat blocks that have one", () => {
		const gated = statBlocks().filter(j => monsterArmorGate(j.system).conditional > 0).map(j => j.name);
		expect(gated.length).toBeGreaterThan(30);
		expect(gated).toEqual(expect.arrayContaining(["Wretch", "Wee Folk"]));
	});

	it("holds the book's Jellied Horror damage line, its engulf a move of its own (Book II)", () => {
		const jelly = statBlocks().find(j => j.name === "Jellied Horror");
		expect(jelly.system.attributes.damage.value).toBe("pseudopod d10+1 (reach, hand, grabby, messy, 1 piercing)");
		expect(jelly.items.find(i => i.name.startsWith("Engulf")).system.rollFormula).toBe("d10+3");
	});

	it("gives a die to every move that prints one as its blow (audit FOE-7)", () => {
		const formulaOf = (monster, move) => statBlocks().find(j => j.name === monster).items.find(i => i.name.startsWith(move)).system.rollFormula;
		expect(formulaOf("Cavalry", "Form a wedge and charge")).toBe("d6+4");
		expect(formulaOf("War-chariot", "Crash spectacularly")).toBe("d8+3");
		expect(formulaOf("The Spirit in the Cloak", "Fling lightning")).toBe("d10+3");
		expect(formulaOf("Hlomren", "Burst with acid")).toBe("d4");
		expect(formulaOf("Klezln", "Wait for prey")).toBe("d6");
		expect(formulaOf("Earth Vortex", "Grind a pinned foe")).toBe("d10");
		// The sconce's one blow is its damage line; its "Zzzolt" is how the book says it fires.
		expect(formulaOf("Lightning Sconce", "Zzzolt")).toBe("");
	});
});
