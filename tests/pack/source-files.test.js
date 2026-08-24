import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";

const SRC_DIR = path.resolve("packs/src");

async function findJsonFiles(dir) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const results = await Promise.all(entries.map(async entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return findJsonFiles(full);
		if (entry.name.endsWith(".json")) return [full];
		return [];
	}));
	return results.flat();
}

// Stack-based balanced HTML tag checker. Returns a list of problem descriptions.
function checkHtmlBalance(html) {
	const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img",
	                      "input", "link", "meta", "source", "track", "wbr"]);
	const RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
	const stack = [];
	const issues = [];
	let m;
	while ((m = RE.exec(html)) !== null) {
		const tag = m[1].toLowerCase();
		if (VOID.has(tag)) continue;
		if (m[0].startsWith("</")) {
			if (stack.length === 0 || stack[stack.length - 1] !== tag) {
				issues.push(`unexpected </${tag}> (open: ${stack[stack.length - 1] ?? "none"})`);
			} else {
				stack.pop();
			}
		} else if (!m[0].endsWith("/>")) {
			stack.push(tag);
		}
	}
	for (const tag of stack) issues.push(`unclosed <${tag}>`);
	return issues;
}

let allDocs;

beforeAll(async () => {
	const files = await findJsonFiles(SRC_DIR);
	allDocs = await Promise.all(files.map(async f => ({
		file: path.relative(SRC_DIR, f),
		doc:  JSON.parse(await fs.readFile(f, "utf8")),
	})));
});

describe("pack source files", () => {
	it("found at least one source file", () => {
		expect(allDocs.length).toBeGreaterThan(0);
	});

	it("all have a valid _id (16 alphanumeric characters)", () => {
		const bad = allDocs.filter(({ doc }) => !/^[A-Za-z0-9]{16}$/.test(doc._id));
		expect(bad.map(b => b.file)).toEqual([]);
	});

	it("all have _key matching their document type", () => {
		const bad = allDocs.filter(({ doc }) =>
			doc._key !== `!items!${doc._id}` &&
			doc._key !== `!folders!${doc._id}` &&
			doc._key !== `!journal!${doc._id}` &&
			doc._key !== `!actors!${doc._id}` &&
			doc._key !== `!macros!${doc._id}`
		);
		expect(bad.map(b => b.file)).toEqual([]);
	});

	it("all have required top-level fields for their document type", () => {
		const bad = allDocs.filter(({ doc }) => {
			if (!doc.name) return true;
			if (doc._key?.startsWith("!journal!")) return !Array.isArray(doc.pages);
			return !doc.type;
		});
		expect(bad.map(b => b.file)).toEqual([]);
	});

	it("arcana items have flags.stonetop.slug, front, and back", () => {
		const arcana = allDocs.filter(({ doc }) => doc.system?.moveType === "arcanum");
		const bad = arcana.filter(({ doc }) =>
			!doc.flags?.stonetop?.slug ||
			!doc.flags?.stonetop?.front ||
			!doc.flags?.stonetop?.back
		);
		expect(bad.map(b => b.file)).toEqual([]);
	});

	it("arcana only expose regular or small inventory items with matching markers", () => {
		const bySlug = new Map(
			allDocs
				.filter(({ doc }) => doc.system?.moveType === "arcanum")
				.map(({ doc }) => [doc.flags.stonetop.slug, doc.flags.stonetop])
		);
		const bad = [];

		for (const [slug, arcanum] of bySlug.entries()) {
			for (const sideName of ["front", "back"]) {
				const item = arcanum[sideName]?.item;
				if (!item?.name) continue;
				if (item.inventoryColumn === "regular" && !(item.weight > 0)) {
					bad.push(`${slug}.${sideName}: regular item without diamonds`);
				}
				if (item.inventoryColumn === "small" && item.weight != null) {
					bad.push(`${slug}.${sideName}: small item should not define diamond weight`);
				}
			}
		}

		// A card with nothing to hold at all: a story is not a thing.
		expect(bySlug.get("a-folktale").front.item).toBeNull();
		// An IMPLANTED card does carry an item, but only so its tag line can print. It stays
		// weightless and columnless, and CharacterArcana keeps it off the Inventory tab off the
		// same tag — see isImplantedArcanumItem. (This one used to be null outright, which lost
		// the "implanted, magical" the book prints under its title on p.556.)
		expect(bySlug.get("ineffable-words").front.item).toEqual({
			name: "Ineffable Words",
			weight: null,
			note: "<em>implanted, magical</em>",
			inventoryColumn: null,
		});
		expect(bySlug.get("whispering-rocks").front.item).toMatchObject({
			name: "Whispering Rocks",
			weight: 1,
			inventoryColumn: "regular",
		});
		// Two minors kept their tag line at `front.note`, a key nothing renders and the data
		// exporter drops, so the sheet printed no tags under either title. The book prints
		// `immobile` under the sphere and `magical` under the pillars (Book II p.513).
		expect(bySlug.get("huge-wooden-sphere").front.item).toEqual({
			name: "A huge wooden sphere",
			weight: null,
			note: "<em>immobile</em>",
			inventoryColumn: null,
		});
		expect(bySlug.get("rune-etched-pillars").front.item).toEqual({
			name: "Rune-etched pillars",
			weight: null,
			note: "<em>magical</em>",
			inventoryColumn: null,
		});
		expect(bad).toEqual([]);
	});

	it("keeps no arcanum's tag line in a key nothing renders", () => {
		// The sheet draws a side's tags from `<side>.item.note` and nowhere else. A tag line
		// parked beside it — `front.note` — reads like authored content and prints nothing.
		const stray = allDocs
			.filter(({ doc }) => doc.system?.moveType === "arcanum")
			.flatMap(({ doc }) => ["front", "back"]
				.filter(side => doc.flags.stonetop[side]?.note != null)
				.map(side => `${doc.flags.stonetop.slug}.${side}.note`));
		expect(stray).toEqual([]);
	});

	it("HTML descriptions have balanced tags", () => {
		const issues = [];
		for (const { file, doc } of allDocs) {
			const desc = doc.system?.description;
			if (!desc) continue;
			const problems = checkHtmlBalance(desc);
			if (problems.length) issues.push(`${file}: ${problems.join("; ")}`);
		}
		expect(issues).toEqual([]);
	});
});
