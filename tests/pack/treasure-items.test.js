import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { TREASURE_CATALOG } from "../../module/data/treasure-catalog.js";
import { treasureItemData } from "../../module/utils/treasure-drops.js";

// The Treasures & Wonders pack source is GENERATED from the catalog, by the same
// treasureItemData() the journal drag path uses:
//
//   node scripts/local/treasures/extract-writeups.mjs   # prose out of the journal sources
//   node scripts/local/treasures/apply-writeups.mjs     # into module/data/treasure-catalog.js
//   node scripts/local/treasures/gen-treasure-items.mjs # into packs/src/…/treasures-and-wonders
//
// Generated, and therefore able to go stale silently: the generator lives under scripts/local,
// which is gitignored, so a checkout that edits the catalog has nothing reminding it to re-run
// the last step. Then a treasure dragged out of a journal carries the book's write-up while the
// identical Item in the compendium — the copy a GM actually hands a player — does not.
//
// This pins the two together. A failure means the catalog moved and the pack wasn't rebuilt.

const DIR = path.resolve("packs/src/stonetop-items/treasures-and-wonders");
const shipped = TREASURE_CATALOG.filter(e => e.heading !== "Sample specimens");

let bySlug;   // flags.stonetop.slug -> doc  (the item's name-slug, not the catalog's)

beforeAll(async () => {
	bySlug = new Map();
	for (const section of await fs.readdir(DIR)) {
		const dir = path.join(DIR, section);
		if (!(await fs.stat(dir)).isDirectory()) continue;
		for (const f of await fs.readdir(dir)) {
			if (!f.endsWith(".json")) continue;
			// Keyed by FILE stem, which the generator sets to the catalog slug — the item's own
			// flags.stonetop.slug is the name-slug and the two split compounds share one.
			bySlug.set(f.replace(/\.json$/, ""), JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
		}
	}
});

describe("the Treasures & Wonders pack source", () => {
	it("has one item per catalog entry", () => {
		expect(bySlug.size).toBe(shipped.length);
		const missing = shipped.filter(e => !bySlug.has(e.slug)).map(e => e.slug);
		expect(missing).toEqual([]);
	});

	it("matches what a journal drag would build, field for field", () => {
		const drift = [];
		for (const entry of shipped) {
			const doc = bySlug.get(entry.slug);
			if (!doc) continue;
			const built = treasureItemData(entry);
			// `img` is excluded on purpose: the drag path resolves a treasure's illustration
			// from the world's art index at drag time (absent here), while the pack item takes
			// the vase category glyph. Everything the catalog states must agree.
			if (doc.name !== built.name) drift.push(`${entry.slug}: name`);
			if (JSON.stringify(doc.system) !== JSON.stringify(built.system)) drift.push(`${entry.slug}: system`);
			if (JSON.stringify(doc.flags) !== JSON.stringify(built.flags)) drift.push(`${entry.slug}: flags`);
		}
		expect(drift, "run: node scripts/local/treasures/gen-treasure-items.mjs").toEqual([]);
	});

	it("carries the book's write-up on every treasure the book writes up", () => {
		const bare = shipped.filter(e => e.writeup && !bySlug.get(e.slug)?.system?.artifactLore);
		expect(bare.map(e => e.slug)).toEqual([]);
		// And the dagger from the book's own sidebar, end to end, as the shape to beat.
		const dagger = bySlug.get("barrow-builders-an-old-bronze-dagger");
		expect(dagger.system.artifactLore).toContain("Tinged green, but sharp and sturdy.");
		expect(dagger.system.artifactLore).toContain("What do they carry that is useful to me?");
	});

	it("ships no treasure pre-concealed", () => {
		// A pack item with identifyState set would arrive in every world already hidden, taking
		// the choice off the GM. Concealment is the drop's, per world setting.
		const hidden = [...bySlug].filter(([, d]) => d.system?.identifyState).map(([slug]) => slug);
		expect(hidden).toEqual([]);
	});
});
