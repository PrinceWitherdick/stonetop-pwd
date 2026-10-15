import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOOK_SETTLEMENT_STATS, SETTLEMENT_TEMPLATES } from "../../module/data/settlement-stats.js";
import { STEADING_SIZES } from "../../module/utils/improvement-def.js";
import { SETTLEMENTS } from "../../module/data/settlements.js";

// The settlement stat blocks are hand-transcribed from Book II (module/data/settlement-stats.js),
// because the compendium's copy of each sidebar runs its headings into its list items. This holds
// every transcribed number and list entry against that compendium text, so a slip in the table,
// or a regenerated pack that drifts from it, fails here rather than at the table.

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCES = ["packs/src/stonetop-locations", "packs/src/stonetop-lore"];

/** Every journal source file, by `_id`. */
function journalsById() {
	const byId = new Map();
	const walk = dir => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".json")) {
				const doc = JSON.parse(fs.readFileSync(full, "utf8"));
				if (doc?._id && Array.isArray(doc.pages)) byId.set(doc._id, doc);
			}
		}
	};
	for (const dir of SOURCES) walk(path.join(ROOT, dir));
	return byId;
}

/** An entry's whole text, tags and link markup stripped, quotes and dashes folded. */
function plainText(doc) {
	const html = doc.pages.flatMap(p => [p.text?.content ?? "", ...(p.system?.sections ?? []).map(s => s.body ?? "")]).join(" ");
	return html
		.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/[‘’]/g, "'")
		.replace(/[–—]/g, "-")
		.replace(/\s+/g, " ")
		.toLowerCase()
		// A link inside a hyphenated word leaves a space before the hyphen ("mammoth -mounted").
		// Letters both sides only, so a signed stat ("prosperity -1") is left alone.
		.replace(/([a-z]) -([a-z])/g, "$1-$2");
}

const fold = s => String(s).replace(/[‘’]/g, "'").replace(/[–—]/g, "-").toLowerCase();
const signed = n => (n < 0 ? `-${-n}` : `+${n}`);

const JOURNALS = journalsById();
const BLOCKS = [
	...Object.entries(BOOK_SETTLEMENT_STATS).map(([slug, block]) => [slug, block]),
	...SETTLEMENT_TEMPLATES.map(t => [t.id, t]),
];

describe("settlement stat blocks", () => {
	it("finds the journal sources, so the checks below mean something", () => {
		expect(JOURNALS.size).toBeGreaterThan(30);
		expect(BLOCKS.length).toBeGreaterThan(8);
	});

	it("keys the named places by roster slug", () => {
		const roster = new Set(SETTLEMENTS.map(s => s.slug));
		for (const slug of Object.keys(BOOK_SETTLEMENT_STATS)) expect(roster.has(slug), slug).toBe(true);
	});

	it("gives templates unique, dot-free ids (they are stored on the sheet)", () => {
		const ids = SETTLEMENT_TEMPLATES.map(t => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
	});

	it.each(BLOCKS)("%s points at a gazetteer entry that exists", (_key, block) => {
		expect(JOURNALS.has(block.journalId), block.journalId).toBe(true);
	});

	it.each(BLOCKS)("%s carries a known Size and a book page", (_key, block) => {
		expect(STEADING_SIZES).toContain(block.size);
		expect(block.page).toMatch(/^Book II p\.\d+$/);
	});

	// A printed stat must appear in the entry as "<Stat> <signed value>". A stat the book gives as a
	// range, or does not print at all, is named in `statRanges` and skipped.
	it.each(BLOCKS)("%s matches its printed stats", (_key, block) => {
		const text = plainText(JOURNALS.get(block.journalId));
		for (const stat of ["population", "prosperity", "defenses"]) {
			if (block.statRanges?.[stat]) continue;
			expect(text, `${stat} ${signed(block[stat])}`).toContain(`${stat} ${signed(block[stat])}`);
		}
	});

	it.each(BLOCKS)("%s matches its printed lists", (_key, block) => {
		const text = plainText(JOURNALS.get(block.journalId));
		const said = s => expect(text, s).toContain(fold(s));
		for (const row of [...block.resources, ...block.fortifications]) {
			said(row.name);
			if (row.detail) said(row.detail);
		}
		for (const row of block.tradeWith) {
			said(row.partner.replace(/, etc\.$/, ""));
			if (row.goods) said(row.goods.replace(/, etc\.$/, ""));
		}
		for (const row of block.leaders ?? []) {
			said(row.name);
			if (row.instinct) said(row.instinct.replace(/^To /, "").replace("seize", "sieze"));
		}
	});

	it("links trade partners only to roster rows", () => {
		const roster = new Set(SETTLEMENTS.map(s => s.slug));
		for (const [key, block] of BLOCKS) {
			for (const row of block.tradeWith) if (row.slug) expect(roster.has(row.slug), `${key}: ${row.slug}`).toBe(true);
		}
	});

	it("puts a range's default inside the range", () => {
		const farm = SETTLEMENT_TEMPLATES.find(t => t.id === "whitefang-farm-valley");
		expect(farm.statRanges.population).toBe("-1 to +1");
		expect(farm.population).toBe(0);
	});
});
