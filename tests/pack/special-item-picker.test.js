import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { SPECIAL_ITEM_CATALOG } from "../../module/data/special-items.js";

// The Add Special Item picker adds by SLUG — CharacterInventory.addSpecial writes the slug onto
// the actor and the gear tab resolves it against the inventory-items pack. A catalog row whose
// slug has no item therefore looks pickable and does nothing.
//
// That is exactly how five rows of the handout's Special Items table went missing for years: the
// whole Bronze Weapons category, "Small metal tool", and the fine whisky skin and firkin were all
// printed in the Setting Overview journal and existed nowhere the picker could reach. The flora
// half of this contract is pinned in flora-items.test.js; this pins the other nine categories.

const INV_DIR = path.resolve("packs/src/stonetop-items/inventory-items");

let bySlug; // slug -> { name, specialCategory }

beforeAll(async () => {
	bySlug = new Map();
	for (const f of (await fs.readdir(INV_DIR)).filter(f => f.endsWith(".json"))) {
		const doc = JSON.parse(await fs.readFile(path.join(INV_DIR, f), "utf8"));
		const st = doc.flags?.stonetop ?? {};
		if (st.slug) bySlug.set(st.slug, { name: doc.name, specialCategory: st.specialCategory, special: st.special });
	}
});

describe("the Add Special Item picker", () => {
	it("offers every row an item the character can actually be given", () => {
		const orphans = SPECIAL_ITEM_CATALOG.flatMap(g =>
			g.items.filter(i => !bySlug.has(i.slug)).map(i => `${g.category} / ${i.slug}`));
		expect(orphans).toEqual([]);
	});

	it("backs every row with an item flagged special", () => {
		// `special: true` is what marks an inventory-items doc as handout gear rather than
		// standard kit; without it the row adds an item the gear tab treats as ordinary.
		//
		// NOT asserted here: that the item's `specialCategory` string equals the catalog's
		// category. The two lists deliberately disagree in one place — the livestock items are
		// tagged "Livestock & Beasts" while the picker heads the group "Livestock & Other
		// Beasts", and setting-overview-beasts.test.js pins the item side of that — so a
		// strict match would fail on shipped, intended data.
		const unflagged = SPECIAL_ITEM_CATALOG.flatMap(g =>
			g.items.filter(i => bySlug.has(i.slug) && !bySlug.get(i.slug).special)
				.map(i => `${g.category} / ${i.slug}`));
		expect(unflagged).toEqual([]);
	});

	it("carries the handout's Bronze Weapons category and its piercing rule", () => {
		// Bronze is its own category on the handout precisely because of the footnote: it is the
		// cheap metal, and it never gets the steading's Prosperity as piercing.
		const bronze = SPECIAL_ITEM_CATALOG.find(g => g.category === "Bronze Weapons");
		expect(bronze, "Bronze Weapons category").toBeTruthy();
		expect(bronze.note).toMatch(/do not have/i);
		expect(bronze.note).toMatch(/piercing/i);
		expect(bronze.items.map(i => i.slug)).toEqual(["bronze-common-weapon", "bronze-weapon-of-war"]);
		// And no bronze weapon may claim piercing, which is the whole point of the note.
		for (const i of bronze.items) expect(i.traits, i.slug).not.toMatch(/\bx piercing\b/);
	});

	it("offers both fine whiskies and the small metal tool", () => {
		const slugs = new Set(SPECIAL_ITEM_CATALOG.flatMap(g => g.items.map(i => i.slug)));
		for (const slug of ["whisky-skin-fine", "firkin-whisky-fine", "small-metal-tool"]) {
			expect(slugs.has(slug), slug).toBe(true);
		}
		// The fine skin is the one with the Persuade trick; the plain skin is ordinary gear.
		const fine = SPECIAL_ITEM_CATALOG.flatMap(g => g.items).find(i => i.slug === "whisky-skin-fine");
		expect(fine.traits).toMatch(/Persuade/);
		expect(fine.traits).toMatch(/○○/);
	});

	it("keeps every category non-empty and uniquely slugged", () => {
		const seen = new Set();
		const dupes = [];
		for (const g of SPECIAL_ITEM_CATALOG) {
			expect(g.items.length, g.category).toBeGreaterThan(0);
			for (const i of g.items) {
				if (seen.has(i.slug)) dupes.push(i.slug);
				seen.add(i.slug);
			}
		}
		expect(dupes).toEqual([]);
	});
});
