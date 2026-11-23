import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";

// The locations and lore generators (scripts/local/locations/build.mjs and
// scripts/local/lore/build.mjs) materialize each Book II place, and each topic (gods,
// factions, world-reference), as a JournalEntry holding ONE structured `location` page
// whose system.sections[] drive the StonetopLocationPageSheet. The two source dirs share
// that shape, so the same guards run over each:
//   • exactly one `location` page per entry
//   • every section is a valid kind with the matching payload
//   • the gazetteer "Questions" section is a `qa` section with prompts
//   • the old `.stonetop-location-body` prose wrapper is gone

const SRC = path.resolve("packs/src");

async function readDocs(dir) {
	const out = [];
	async function walk(d) {
		for (const e of await fs.readdir(d, { withFileTypes: true })) {
			if (e.name === "_folders") continue;
			const full = path.join(d, e.name);
			if (e.isDirectory()) await walk(full);
			else if (e.name.endsWith(".json")) out.push({ file: path.relative(SRC, full), doc: JSON.parse(await fs.readFile(full, "utf8")) });
		}
	}
	await walk(dir);
	return out;
}

// One read per source dir, shared by every block that asks for it.
const loaded = new Map();
const docsIn = (dir) => {
	if (!loaded.has(dir)) loaded.set(dir, readDocs(path.join(SRC, dir)));
	return loaded.get(dir);
};

describe.each([
	["locations", "stonetop-locations"],
	["lore", "stonetop-lore"],
])("%s journal: structured location pages", (_journal, dir) => {
	let entries;

	beforeAll(async () => {
		entries = await docsIn(dir);
	});

	it("found entries", () => {
		expect(entries.length).toBeGreaterThan(0);
	});

	it("every entry has exactly one `location` page", () => {
		const bad = entries.filter(({ doc }) =>
			!Array.isArray(doc.pages) || doc.pages.length !== 1 || doc.pages[0].type !== "location"
		);
		expect(bad.map(b => b.file)).toEqual([]);
	});

	it("every section is a valid kind with a matching payload", () => {
		const bad = [];
		for (const { file, doc } of entries) {
			const sections = doc.pages?.[0]?.system?.sections;
			if (!Array.isArray(sections) || !sections.length) { bad.push(`${file}: no sections`); continue; }
			for (const [i, s] of sections.entries()) {
				if (!["prose", "qa", "groups"].includes(s.kind)) { bad.push(`${file}#${i}: bad kind ${s.kind}`); continue; }
				if (typeof s.heading !== "string") bad.push(`${file}#${i}: missing heading`);
				if (s.kind === "qa") {
					if (!Array.isArray(s.pairs)) bad.push(`${file}#${i}: qa without pairs[]`);
					else if (s.pairs.some(p => typeof p.prompt !== "string" || typeof p.answer !== "string"))
						bad.push(`${file}#${i}: qa pair not {prompt,answer}`);
				} else if (s.kind === "groups") {
					if (!Array.isArray(s.groups)) bad.push(`${file}#${i}: groups without groups[]`);
					else if (s.groups.some(g => typeof g.heading !== "string" || typeof g.body !== "string"))
						bad.push(`${file}#${i}: group entry not {heading,body}`);
				} else if (typeof s.body !== "string") {
					bad.push(`${file}#${i}: prose without body`);
				}
			}
		}
		expect(bad).toEqual([]);
	});

	it("the Questions section is a `qa` section with at least one prompt", () => {
		const bad = [];
		for (const { file, doc } of entries) {
			const q = (doc.pages?.[0]?.system?.sections ?? []).find(s => s.heading === "Questions");
			if (!q) continue; // not every place or topic has Questions
			if (q.kind !== "qa") bad.push(`${file}: Questions is ${q.kind}, not qa`);
			else if (!(q.pairs ?? []).some(p => p.prompt?.trim())) bad.push(`${file}: Questions has no prompts`);
		}
		expect(bad).toEqual([]);
	});

	it("no section retains the old `.stonetop-location-body` wrapper", () => {
		const bad = entries.filter(({ doc }) =>
			(doc.pages?.[0]?.system?.sections ?? []).some(s => (s.body ?? "").includes("stonetop-location-body"))
		);
		expect(bad.map(b => b.file)).toEqual([]);
	});

	// The PDF import ran the book's layout together (issue #55). Each pattern is one way it did:
	const IMPORT_GLITCHES = {
		// "Size … Population … Prosperity" on one line
		statLine: /Population [^<]*Prosperity/,
		// a list header ("Resources", "Defenses +1") glued to the last item of the list before it
		gluedStatHeader: /\S (?:Resources|Defenses [+\-−]\d[^<]*)<\/(?:li|p)>/,
		// a "…" leader left at the end of the line above the option it belongs to
		trailingLeader: /(?:\.\.\.|…)\s*<\/li>/,
		doubledLeader: /(?:\.\.\.|…) (?:\.\.\.|…)/,
		// one list chopped into several back-to-back lists
		splitList: /<\/ul><ul>/,
		// a price list flattened into one line of "item N item N item N"
		flatPriceList: /(?:[a-z)] [0-4] [A-Z…][^<0-9]{3,80}){3,}/,
		// a treasure's name, tags and description run into one line
		// (tags in parentheses mid-sentence are fine, and so is a Dangers card's one-line
		// "Spirit, magical, … Instinct to …" header)
		runTreasure: /<(?:li|p)>[A-Z][^<(]{2,50}? (?:magical|immobile|fragile)(?:, [a-z]+)*,? (?:Value \d+ )?(?!Instinct|Damage)[A-Z][a-z]/,
		// a threat's name and "Threat (type)" run into one line
		runThreat: /<li>[^<]{3,80} Threat \([a-z ]+\)/,
	};
	const htmlIn = (section) => [section.body, ...(section.groups ?? []).map(g => g.body)].filter(Boolean);

	it("no section keeps the PDF import's run-together layout", () => {
		const bad = [];
		for (const { file, doc } of entries) {
			for (const s of doc.pages?.[0]?.system?.sections ?? []) {
				for (const html of htmlIn(s)) {
					for (const [name, re] of Object.entries(IMPORT_GLITCHES)) {
						if (re.test(html)) bad.push(`${file} › ${s.heading}: ${name}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
	});
});

describe("locations journal: the Dangers section", () => {
	let entries;

	beforeAll(async () => {
		entries = await docsIn("stonetop-locations");
	});

	// The "Dangers" section lists danger references under Hazards / Monsters /
	// People sub-labels and THEN dumps the region's creature stat-block catalog. We
	// keep the reference lists and cut only the catalog, so the gazetteer's Monsters
	// list survives (a past bug cut it along with the catalog), and no Dangers
	// section ever leaks a stat block (an "HP <n>" descriptor).
	const dangersOf = (name) => {
		const e = entries.find(x => x.doc.name === name);
		return (e?.doc.pages?.[0]?.system?.sections ?? []).find(s => s.heading === "Dangers");
	};

	it("keeps the gazetteer Monsters reference list in Dangers", () => {
		for (const name of ["North Manmarch", "South Manmarch"]) {
			const d = dangersOf(name);
			expect(d, `${name} has a Dangers section`).toBeTruthy();
			expect(d.kind, `${name} Dangers is a groups section`).toBe("groups");
			expect((d.groups ?? []).map(g => g.heading), `${name} Dangers keeps its Monsters entry`).toContain("Monsters");
		}
	});

	it("cuts the creature catalog: no Dangers section leaks a stat block", () => {
		const bad = entries
			.filter(({ doc }) => (doc.pages?.[0]?.system?.sections ?? [])
				.some(s => s.heading === "Dangers" && (s.groups ?? []).some(g => /HP\s*\d/.test(g.body ?? ""))))
			.map(b => b.file);
		expect(bad).toEqual([]);
	});
});
