import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BESTIARY_SECTIONS, MONSTER_ORGANIZATIONS, bestiarySectionForFolder } from "../../module/bestiary/bestiary-sections.js";
import { CREATURE_TYPES } from "../../module/bestiary/creature-types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACK = path.join(ROOT, "packs", "src", "stonetop-bestiary");

/** Every monster source doc, plus the folder docs that say which section it's in. */
function loadPack() {
	const monsters = [];
	const folders  = new Map();
	(function walk(dir) {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) { walk(p); continue; }
			if (!e.name.endsWith(".json")) continue;
			const doc = JSON.parse(fs.readFileSync(p, "utf8"));
			if (doc?.type === "monster") monsters.push(doc);
			else if (doc?._key?.startsWith("!folders!")) folders.set(doc._id, doc);
		}
	})(PACK);
	return { monsters, folders };
}

const { monsters, folders } = loadPack();
const folderNameFor = doc => folders.get(doc.folder)?.name ?? "";

describe("BESTIARY_SECTIONS", () => {
	it("is the book's four divisions", () => {
		expect(BESTIARY_SECTIONS.map(s => s.key)).toEqual(["peoples", "regions", "powers", "makers"]);
	});

	it("gives every section a label, icon and tooltip hint", () => {
		for (const s of BESTIARY_SECTIONS) {
			expect(s.label, s.key).toBeTruthy();
			expect(s.icon, s.key).toMatch(/^fas fa-/);
			expect(s.hint, s.key).toBeTruthy();
		}
	});

	it("names folders that actually exist in the pack", () => {
		const names = new Set([...folders.values()].map(f => f.name));
		for (const s of BESTIARY_SECTIONS) expect(names, s.key).toContain(s.folder);
	});
});

describe("bestiarySectionForFolder", () => {
	it("resolves each shipped folder name", () => {
		expect(bestiarySectionForFolder("Regions")).toBe("regions");
		expect(bestiarySectionForFolder("The Makers")).toBe("makers");
		expect(bestiarySectionForFolder("Primordial & Mythic Powers")).toBe("powers");
		expect(bestiarySectionForFolder("Peoples & Folk")).toBe("peoples");
	});

	it("tolerates surrounding whitespace", () => {
		expect(bestiarySectionForFolder("  Regions  ")).toBe("regions");
	});

	it("returns no section for anything else, rather than guessing", () => {
		// A homebrew monster in a folder of its own still shows in the unfiltered list; it
		// just isn't matched by the section chips.
		expect(bestiarySectionForFolder("My Monsters")).toBe("");
		expect(bestiarySectionForFolder(null)).toBe("");
		expect(bestiarySectionForFolder(undefined)).toBe("");
	});
});

describe("the shipped bestiary against the browser's facets", () => {
	it("holds 213 monsters, every one of them in a known section", () => {
		expect(monsters).toHaveLength(213);
		const unplaced = monsters
			.filter(d => !bestiarySectionForFolder(folderNameFor(d)))
			.map(d => d.name);
		expect(unplaced).toEqual([]);
	});

	it("leaves no section chip empty", () => {
		const counts = {};
		for (const d of monsters) {
			const key = bestiarySectionForFolder(folderNameFor(d));
			counts[key] = (counts[key] ?? 0) + 1;
		}
		expect(counts).toEqual({ peoples: 36, regions: 67, powers: 82, makers: 28 });
	});

	it("uses only organization values the Numbers chips offer", () => {
		const keys = new Set(MONSTER_ORGANIZATIONS.map(o => o.key));
		const stray = [...new Set(monsters.map(d => d.system?.organization).filter(Boolean))]
			.filter(v => !keys.has(v));
		expect(stray).toEqual([]);
	});

	it("uses only creature types the Type chips offer", () => {
		const slugs = new Set(CREATURE_TYPES.map(t => t.slug));
		const stray = [...new Set(monsters.map(d => d.system?.creatureType).filter(Boolean))]
			.filter(v => !slugs.has(v));
		expect(stray).toEqual([]);
	});

	it("gives the Numbers chips a label, icon and hint each", () => {
		expect(MONSTER_ORGANIZATIONS.map(o => o.key)).toEqual(["solitary", "group", "horde"]);
		for (const o of MONSTER_ORGANIZATIONS) {
			expect(o.label, o.key).toBeTruthy();
			expect(o.icon, o.key).toMatch(/^fas fa-/);
			expect(o.hint, o.key).toBeTruthy();
		}
	});
});
