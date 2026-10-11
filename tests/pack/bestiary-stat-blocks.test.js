import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { monsterTokenSize } from "../../module/data/monster-builder.js";

// Stat-block data in the bestiary pack source, checked against the books.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "packs", "src", "stonetop-bestiary");
const readTree = dir => readdirSync(dir).flatMap(name => {
	const p = path.join(dir, name);
	if (statSync(p).isDirectory()) return name === "_folders" ? [] : readTree(p);
	return name.endsWith(".json") ? [{ file: path.relative(root, p), doc: JSON.parse(readFileSync(p, "utf8")) }] : [];
});
const monsters = readTree(root).filter(({ doc }) => doc.type === "monster");
const named = name => monsters.find(({ doc }) => doc.name === name)?.doc;

describe("bestiary stat blocks", () => {
	it("give every creature a token its size: large 2x2, huge 3x3, the rest one square", () => {
		const wrong = monsters
			.filter(({ doc }) => {
				const want = monsterTokenSize(doc.system?.size);
				return (doc.prototypeToken?.width ?? 1) !== want || (doc.prototypeToken?.height ?? 1) !== want;
			})
			.map(({ file }) => file);
		expect(wrong).toEqual([]);
		expect(named("Mammoth").prototypeToken).toMatchObject({ width: 3, height: 3 });
		expect(named("Aurochs").prototypeToken).toMatchObject({ width: 2, height: 2 });
	});

	it("give the Crinwin only the three moves the book prints (Book I p.391, Book II p.61)", () => {
		expect(named("Crinwin").items.map(m => m.name)).toEqual([
			"Mimic noises, words, cries for help",
			"Hide or vanish into the trees",
			"Snatch something and dart away",
		]);
	});

	it("name the Broodfather's tongue with its printed damage (Book II p.61)", () => {
		const tongue = named("Crinwin Broodfather").items.find(m => m.name.startsWith("Lash out"));
		expect(tongue.name).toBe("Lash out with a choking tongue (d6+2, reach, forceful, grabby)");
		expect(tongue.system.rollFormula).toBe("d6+2");
	});

	it("carry the South Manmarch's horde of bandits as Book II p.355 prints them", () => {
		const bandit = named("Bandit (South Manmarch)");
		expect(bandit).toBeTruthy();
		expect(bandit.system).toMatchObject({
			organization: "horde",
			tags: "horde, stealthy, cautious, devious",
			attributes: {
				hp: { value: 3, max: 3 },
				// "Armor up to 2 (hides, shields)", recorded as the Plains bandit's "up to 2" is.
				armor: { value: 1, source: "hides, shields (up to 2)" },
				damage: { value: "spear d6 (close, thrown) or sling d6 (near, awkward, reload)", rollFormula: "d6" },
				instinct: { value: "to survive at the expense of others" },
			},
		});
		expect(bandit.items.map(m => m.name)).toEqual([
			"Block passage, issue a blunt demand",
			"Ambush under cover of darkness",
			"Ransom the best, kill the rest",
		]);
		// Filed beside the Plains bandit, under the same codex entry.
		const plains = named("Bandit");
		expect(bandit.folder).toBe(plains.folder);
		expect(bandit.system.entry).toBe(plains.system.entry);
	});
});
