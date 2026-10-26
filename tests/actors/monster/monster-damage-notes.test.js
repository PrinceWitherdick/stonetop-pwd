// A monster's printed weaknesses are reminded on its damage-card row, for the GM, and never applied
// (audit FOE-1, the user's ruling of 2026-10-23).

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendMonsterDamageNotes } from "../../../module/actors/monster/monster-damage-notes.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(HERE, "../../..", rel), "utf8");

const savedDocument = globalThis.document;
afterEach(() => { globalThis.document = savedDocument; });

function fakeDom() {
	globalThis.document = { createElement: tag => ({ tagName: tag, className: "", textContent: "" }) };
	const kids = [];
	return { kids, actions: { append: (...k) => kids.push(...k) } };
}

const wretch = {
	type: "monster", name: "Wretch",
	system: { attributes: { armor: { value: 4, source: "resilience" } }, qualities: "<p>Burnt by bronze (+1d6 damage). Armor 0 vs. bronze.</p>" },
};

describe("appendMonsterDamageNotes", () => {
	it("prints a monster's weaknesses on its row, for the GM", () => {
		const { kids, actions } = fakeDom();
		expect(appendMonsterDamageNotes(actions, { row: { name: "Wretch" }, target: wretch, isGM: true })).toBe(true);
		expect(kids).toHaveLength(1);
		expect(kids[0].className).toBe("stonetop-damage-foe-notes");
		expect(kids[0].textContent).toBe("Its stat block also says (not applied): Burnt by bronze (+1d6 damage)");
	});

	it("names the row on a card with several", () => {
		const { kids, actions } = fakeDom();
		appendMonsterDamageNotes(actions, { row: { name: "Wretch (2)" }, target: wretch, several: true, isGM: true });
		expect(kids[0].textContent).toContain("Wretch (2)'s stat block also says");
	});

	it("draws nothing for a player, a monster that prints none, or anyone else", () => {
		const { kids, actions } = fakeDom();
		expect(appendMonsterDamageNotes(actions, { row: {}, target: wretch, isGM: false })).toBe(false);
		expect(appendMonsterDamageNotes(actions, { row: {}, target: { type: "monster", system: { qualities: "Hates the sun." } }, isGM: true })).toBe(false);
		expect(appendMonsterDamageNotes(actions, { row: {}, target: { ...wretch, type: "npc" }, isGM: true })).toBe(false);
		expect(kids).toHaveLength(0);
	});

	it("is drawn by the damage card beside its armor boxes", () => {
		const flow = read("module/combat/attack-flow.js");
		const wire = flow.slice(flow.indexOf("export function wireConditionalArmor"));
		expect(wire.slice(0, wire.indexOf("\n}\n"))).toContain("appendMonsterDamageNotes(actions, { row, target, several });");
	});
});
