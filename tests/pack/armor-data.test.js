import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";

// Armor that is only PROSE grants nothing. That was the whole bug: the Judge's Makerglass shield
// printed "+1 armor" inside a label string, the Demonhide Cloak printed "1 armor" inside a tag
// line, and neither carried a structured `armor` field for CharacterInventory.calculateArmor to
// read — so both rendered their armor next to a tick box that fed nothing.
//
// This pins the prose to the data, in both directions, across every catalog that can carry armor.
// A new armored item or arcanum authored with only a tag line fails here rather than shipping.
//
// THE NOTATION RULE. The book distinguishes the two armor kinds by sign, and the system's own
// base/modifier split means exactly that:
//   "2 armor"   -> { base: 2 }      worn body armor; the best one counts, they do not stack
//   "+1 armor"  -> { modifier: 1 }  a shield or a bonus; it adds on top
// Both halves are checked: a worn hauberk written as a `modifier` stacks with every other armor
// AND leaves its wearer reading as unarmored to the moves that require being so (Uncanny
// Reflexes), which is precisely how three of the five catalog armors shipped.

const ROOT = path.resolve(".");

/** "…2 armor…" / "…+1 armor…" in a tag line → the shape it must carry. Null when it says none. */
function expectedShape(text) {
	// A digit must be adjacent to the word, so the several entries reading "ignores armor" or
	// "immune to armor" are not read as granting any.
	const m = /(^|[\s,(>])(\+)?(\d+)\s*armou?r\b/i.exec(String(text ?? "").replace(/<[^>]+>/g, ""));
	if (!m) return null;
	const n = Number(m[3]);
	if (!(n > 0)) return null;
	return m[2] ? { modifier: n } : { base: n };
}

async function readJson(p) { return JSON.parse(await fs.readFile(p, "utf8")); }

async function walkJson(dir) {
	const out = [];
	let entries;
	try { entries = await fs.readdir(dir, { withFileTypes: true }); }
	catch { return out; }
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...await walkJson(full));
		else if (e.name.endsWith(".json")) out.push(full);
	}
	return out;
}

// -- The catalog: packs/src/stonetop-items/inventory-items -------------------

describe("inventory-item armor data", () => {
	let items;
	beforeAll(async () => {
		const dir = path.join(ROOT, "packs/src/stonetop-items/inventory-items");
		items = await Promise.all((await walkJson(dir)).map(async f => {
			const d = await readJson(f);
			return { file: path.basename(f), name: d.name, st: d.flags?.stonetop ?? {} };
		}));
	});

	it("gives every item whose tag line states armor a matching structured `armor`", () => {
		const wrong = [];
		for (const { file, name, st } of items) {
			const want = expectedShape(st.note);
			if (!want) continue;
			if (JSON.stringify(st.armor ?? null) !== JSON.stringify(want)) {
				wrong.push(`${file} (${name}): note says ${JSON.stringify(st.note)} → expected armor ${JSON.stringify(want)}, has ${JSON.stringify(st.armor ?? null)}`);
			}
		}
		expect(wrong).toEqual([]);
	});

	it("marks every specialCategory:'Armor' piece as worn `base`, never a stacking `modifier`", () => {
		// Worn body armor is the max-wins kind. Authored as `modifier` (as the iron hauberk, the
		// brigandine vest and the boiled leather cuirass all were) it stacks with everything and
		// contributes no worn base at all.
		const wrong = items
			.filter(i => i.st.specialCategory === "Armor" && i.st.armor)
			.filter(i => i.st.armor.base == null)
			.map(i => `${i.file} (${i.name}): ${JSON.stringify(i.st.armor)}`);
		expect(wrong).toEqual([]);
	});

	it("still has the catalog armors it is supposed to have (guards against a vacuous pass)", () => {
		const withArmor = items.filter(i => i.st.armor);
		expect(withArmor.length).toBeGreaterThanOrEqual(5);
		const shield = items.find(i => i.st.slug === "shield");
		expect(shield?.st.armor).toEqual({ modifier: 1 });
		const hides = items.find(i => i.st.slug === "thick-hides");
		expect(hides?.st.armor).toEqual({ base: 1 });
	});
});

// -- Arcana ------------------------------------------------------------------

describe("arcana armor data", () => {
	let sides;
	beforeAll(async () => {
		const dir = path.join(ROOT, "packs/src/stonetop-arcana");
		sides = [];
		for (const f of await walkJson(dir)) {
			const st = (await readJson(f)).flags?.stonetop ?? {};
			for (const side of ["front", "back"]) {
				const item = st[side]?.item;
				if (item) sides.push({ file: path.basename(f), side, item });
			}
		}
	});

	it("gives every arcanum curio whose tag line states armor a matching structured `armor`", () => {
		const wrong = [];
		for (const { file, side, item } of sides) {
			const want = expectedShape(item.note);
			if (!want) continue;
			if (JSON.stringify(item.armor ?? null) !== JSON.stringify(want)) {
				wrong.push(`${file} [${side}] ${item.name}: note ${JSON.stringify(item.note)} → expected ${JSON.stringify(want)}, has ${JSON.stringify(item.armor ?? null)}`);
			}
		}
		expect(wrong).toEqual([]);
	});

	it("covers the three armored cards (guards against a vacuous pass)", () => {
		const armored = sides.filter(s => s.item.armor);
		const names = armored.map(s => s.item.name).sort();
		expect(names).toEqual(["Demonhide Cloak", "Rune-laden Scales", "Shield of the Wisent Witch"]);
	});

	it("does not read 'ignores armor' as granting armor", () => {
		const bow = sides.find(s => /ignores armor/i.test(s.item.note ?? ""));
		expect(bow, "the Thunderbolt Bow's tag line").toBeTruthy();
		expect(bow.item.armor ?? null).toBeNull();
	});
});

// -- Playbook gear choices ---------------------------------------------------

describe("playbook gear-choice armor data", () => {
	let options;
	beforeAll(async () => {
		const dir = path.join(ROOT, "packs/src/stonetop-items/playbooks");
		options = [];
		for (const f of await walkJson(dir)) {
			const st = (await readJson(f)).flags?.stonetop ?? {};
			for (const opt of st.specialPossessions?.options ?? []) {
				if (!opt.choices?.gear) continue;
				for (const c of opt.choices.options ?? []) {
					options.push({ file: path.basename(f), poss: opt.slug, c });
				}
			}
		}
	});

	it("gives every gear choice whose label states armor a matching structured `armor`", () => {
		const wrong = [];
		for (const { file, poss, c } of options) {
			const want = expectedShape(c.label);
			if (!want) continue;
			if (JSON.stringify(c.armor ?? null) !== JSON.stringify(want)) {
				wrong.push(`${file} ${poss}/${c.slug}: label states ${JSON.stringify(want)}, has ${JSON.stringify(c.armor ?? null)}`);
			}
		}
		expect(wrong).toEqual([]);
	});

	it("arms the Judge's Makerglass shield (guards against a vacuous pass)", () => {
		const shield = options.find(o => o.c.slug === "makerglass-shield");
		expect(shield, "the Judge's Makerglass shield").toBeTruthy();
		expect(shield.c.armor).toEqual({ modifier: 1 });
	});
});

// -- Shields -----------------------------------------------------------------

// A shield grants its armor AND "+1 Readiness on a 7+ to Defend" (p.216). bearsShield reads the
// explicit `shield` flag, so anything the book prints that Readiness clause on has to carry it —
// this is the same prose-vs-data pin the armor checks above make, for the Readiness half.
describe("shield data", () => {
	const READINESS = /readiness/i;

	it("marks every catalog / arcanum / gear-choice item whose tag line promises Readiness", async () => {
		const wrong = [];
		let found = 0;

		const items = await walkJson(path.join(ROOT, "packs/src/stonetop-items/inventory-items"));
		for (const f of items) {
			const st = (await readJson(f)).flags?.stonetop ?? {};
			if (!READINESS.test(st.note ?? "")) continue;
			found++;
			if (!st.shield) wrong.push(`${path.basename(f)}: note promises Readiness, no shield flag`);
		}

		for (const f of await walkJson(path.join(ROOT, "packs/src/stonetop-arcana"))) {
			const st = (await readJson(f)).flags?.stonetop ?? {};
			for (const side of ["front", "back"]) {
				const item = st[side]?.item;
				if (!item || !READINESS.test(item.note ?? "")) continue;
				found++;
				if (!item.shield) wrong.push(`${path.basename(f)} [${side}]: note promises Readiness, no shield flag`);
			}
		}

		for (const f of await walkJson(path.join(ROOT, "packs/src/stonetop-items/playbooks"))) {
			const st = (await readJson(f)).flags?.stonetop ?? {};
			for (const opt of st.specialPossessions?.options ?? []) {
				if (!opt.choices?.gear) continue;
				for (const c of opt.choices.options ?? []) {
					if (!READINESS.test(c.label ?? "")) continue;
					found++;
					if (!c.shield) wrong.push(`${path.basename(f)} ${opt.slug}/${c.slug}: label promises Readiness, no shield flag`);
				}
			}
		}

		expect(wrong).toEqual([]);
		// The catalog Shield, the Shield of the Wisent Witch and the Judge's Makerglass shield.
		expect(found).toBeGreaterThanOrEqual(3);
	});

	it("gives every flagged shield some armor to grant", async () => {
		// A shield with no armor would be half-wired: Readiness but no mitigation.
		const wrong = [];
		for (const f of await walkJson(path.join(ROOT, "packs/src/stonetop-items/inventory-items"))) {
			const st = (await readJson(f)).flags?.stonetop ?? {};
			if (st.shield && !st.armor) wrong.push(path.basename(f));
		}
		expect(wrong).toEqual([]);
	});

	it("does not flag ordinary body armor as a shield", async () => {
		const wrong = [];
		for (const f of await walkJson(path.join(ROOT, "packs/src/stonetop-items/inventory-items"))) {
			const st = (await readJson(f)).flags?.stonetop ?? {};
			if (st.specialCategory === "Armor" && st.shield) wrong.push(path.basename(f));
		}
		expect(wrong).toEqual([]);
	});
});

// -- grantsItems bundles -----------------------------------------------------

describe("possession grantsItems armor data", () => {
	it("authors worn armor among granted gear as `base`", async () => {
		const dir = path.join(ROOT, "packs/src/stonetop-items/playbooks");
		const wrong = [];
		let seen = 0;
		for (const f of await walkJson(dir)) {
			const st = (await readJson(f)).flags?.stonetop ?? {};
			for (const opt of st.specialPossessions?.options ?? []) {
				for (const g of opt.grantsItems ?? []) {
					const want = expectedShape(g.name);
					if (!want) continue;
					seen++;
					if (JSON.stringify(g.armor ?? null) !== JSON.stringify(want)) {
						wrong.push(`${path.basename(f)} ${opt.slug}/${g.name}: expected ${JSON.stringify(want)}, has ${JSON.stringify(g.armor ?? null)}`);
					}
				}
			}
		}
		expect(wrong).toEqual([]);
		// The two Tannery cuirasses (the Fox's and the Would-Be Hero's).
		expect(seen).toBeGreaterThanOrEqual(2);
	});
});
