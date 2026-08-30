import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { statApproaches } from "../../module/utils/stat-approaches.js";

// Defy Danger and Interfere print what each stat MEANS for them ("... +STR to power through or
// test your might"), and that list is the whole content of the choice the stat picker puts to the
// player. It is read off the move rather than restated in a table, so these tests are as much
// about what must NOT be read: an ordinary "roll +STR:" trigger is not an approach list, and a
// move that prints no list must leave the picker exactly as it was.

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SIX = {
	str: "to power through or test your might",
	dex: "to employ speed, agility, or finesse",
	con: "to endure or hold steady",
	int: "to apply expertise or enact a clever plan",
	wis: "to exert willpower or rely on your senses",
	cha: "to charm, bluff, impress, or fit in",
};

describe("statApproaches", () => {
	it("reads the clause off each printed line", () => {
		expect(statApproaches("<p>... +STR to power through or test your might</p>"))
			.toEqual({ str: "to power through or test your might" });
	});

	it("reads a list printed as bullets, as a homebrew move might write it", () => {
		expect(statApproaches("<ul><li>... +WIS to keep your head</li><li>... +CHA to talk it down</li></ul>"))
			.toEqual({ wis: "to keep your head", cha: "to talk it down" });
	});

	it("drops the trailing ellipsis the printed layout carries into the next line", () => {
		expect(statApproaches("<p>... +CON to endure or hold steady ...</p>"))
			.toEqual({ con: "to endure or hold steady" });
	});

	// The guard that keeps this off every other move in the system: a trigger names a stat too.
	it("ignores an ordinary trigger line", () => {
		expect(statApproaches("<p>When you fight in melee or close quarters, roll +STR:</p>")).toEqual({});
		expect(statApproaches("<p>Spend 1 Stock and roll +WIS.</p>")).toEqual({});
		expect(statApproaches("")).toEqual({});
		expect(statApproaches(null)).toEqual({});
	});

	it("keeps the first clause when a stat is listed twice", () => {
		expect(statApproaches("<p>... +STR to power through</p><p>... +STR to lift</p>"))
			.toEqual({ str: "to power through" });
	});

	it("survives the entity spellings compendium prose arrives in", () => {
		expect(statApproaches("<p>...&nbsp;+DEX to employ speed, agility, or finesse</p>"))
			.toEqual({ dex: "to employ speed, agility, or finesse" });
	});
});

// The shipped moves, so a reworded move or a change to the reader shows up here as a diff rather
// than as a picker that quietly stopped explaining itself.
describe("what the shipped moves derive", () => {
	const derived = new Map();
	const walk = d => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, entry.name);
			if (entry.isDirectory()) { walk(p); continue; }
			if (!entry.name.endsWith(".json")) continue;
			let doc; try { doc = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
			for (const move of Array.isArray(doc) ? doc : [doc]) {
				if (move?.type !== "move") continue;
				const found = statApproaches(move.system?.description ?? "");
				if (Object.keys(found).length) derived.set(move.name, found);
			}
		}
	};
	walk(path.resolve(HERE, "../../packs/src"));

	it("gives Defy Danger and Interfere all six approaches", () => {
		expect(derived.get("Defy Danger")).toEqual(SIX);
		expect(derived.get("Interfere")).toEqual(SIX);
	});

	// Every other move rolls a fixed stat or asks for one without saying what each would mean,
	// and none of them should grow a list of approaches out of its trigger.
	it("reads an approach list out of those two moves and no others", () => {
		expect([...derived.keys()].sort()).toEqual(["Defy Danger", "Interfere"]);
	});
});
