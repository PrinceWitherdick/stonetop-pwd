import { describe, it, expect } from "vitest";
import {
	SITE_MANNERS, REGIONS, siteManner, region, visibleTables, pickLines,
	rollMannerTable, rollTerrain, rollOnTable,
} from "../../module/data/site-tables.js";

/** The die a table declares, as a number ("1d12" -> 12). */
const dieSize = (die) => Number(String(die).split("d")[1]);

/** Every table of every manner, flattened, with enough context to name a failure. */
const allTables = SITE_MANNERS.flatMap(m => m.tables.map(t => ({ manner: m.id, ...t })));

describe("Book II site tables", () => {
	it("covers each table's die exactly once, with no gaps or overlaps", () => {
		for (const t of allTables) {
			const covered = new Set();
			for (const row of t.rows) {
				for (let n = row.min; n <= row.max; n++) {
					expect(covered.has(n), `${t.manner}.${t.key} repeats ${n}`).toBe(false);
					covered.add(n);
				}
			}
			const size = dieSize(t.die);
			expect([...covered].sort((a, b) => a - b), `${t.manner}.${t.key} span`)
				.toEqual(Array.from({ length: size }, (_, i) => i + 1));
		}
	});

	it("gives every table a key unique within its manner, so picks can't collide", () => {
		for (const m of SITE_MANNERS) {
			const keys = m.tables.map(t => t.key);
			expect(new Set(keys).size, `${m.id} keys`).toBe(keys.length);
		}
	});

	it("gives every table a label unique within its manner, so a stored pick reads back", () => {
		for (const m of SITE_MANNERS) {
			const labels = m.tables.map(t => t.label);
			expect(new Set(labels).size, `${m.id} labels`).toBe(labels.length);
		}
	});

	it("only branches tables onto branches some row actually opens", () => {
		for (const m of SITE_MANNERS) {
			const opened = new Set(m.tables.flatMap(t => t.rows.map(r => r.branch).filter(Boolean)));
			for (const t of m.tables) {
				if (!t.branch) continue;
				expect(opened.has(t.branch), `${m.id}.${t.key} branch "${t.branch}"`).toBe(true);
			}
		}
	});

	it("covers each region's terrain die exactly once", () => {
		for (const r of REGIONS) {
			const covered = r.terrain.flatMap(row =>
				Array.from({ length: row.max - row.min + 1 }, (_, i) => row.min + i));
			expect(covered, `${r.id} terrain`).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
		}
	});

	it("keeps the Green Lord entry the book prints (p. 214)", () => {
		const greenLord = siteManner("greenLord");
		const structure = greenLord.tables.find(t => t.key === "structure");
		// The example site in Book I's Sites chapter rolls a 6 here.
		expect(rollOnTable(structure.rows, () => 5.5 / 6).text).toBe("Ziggurat/pyramid/dome");
	});
});

describe("visibleTables", () => {
	it("hides both branches until the branching table is answered", () => {
		const keys = visibleTables("greenLord", {}).map(t => t.key);
		expect(keys).toEqual(["theme", "site"]);
	});

	it("shows only the lingering-signs table once that branch is taken", () => {
		const site = siteManner("greenLord").tables.find(t => t.key === "site");
		const signs = site.rows.find(r => r.branch === "signs").text;
		const keys = visibleTables("greenLord", { site: signs }).map(t => t.key);
		expect(keys).toEqual(["theme", "site", "sign"]);
	});

	it("shows the ruin worksheet once that branch is taken", () => {
		const site = siteManner("greenLord").tables.find(t => t.key === "site");
		const ruin = site.rows.find(r => r.branch === "ruin").text;
		const keys = visibleTables("greenLord", { site: ruin }).map(t => t.key);
		expect(keys).toEqual(["theme", "site", "structure", "purpose", "elements", "condition"]);
	});

	it("keeps a Barrow Builder barrow and a reclaimed ruin apart", () => {
		const site = siteManner("barrowBuilder").tables.find(t => t.key === "site");
		const barrow = site.rows.find(r => r.branch === "barrow").text;
		const reclaimed = site.rows.find(r => r.branch === "reclaimed").text;
		expect(visibleTables("barrowBuilder", { site: barrow }).map(t => t.key))
			.toEqual(["theme", "site", "size", "barrowPurpose", "barrowElements", "barrowCondition", "feature"]);
		expect(visibleTables("barrowBuilder", { site: reclaimed }).map(t => t.key))
			.toEqual(["theme", "site", "origin", "signs", "reclaimedCondition"]);
	});

	it("returns nothing for an unknown manner", () => {
		expect(visibleTables("nope", {})).toEqual([]);
	});
});

describe("pickLines", () => {
	it("returns the answered tables in book order, with their table keys", () => {
		const site = siteManner("greenLord").tables.find(t => t.key === "site");
		const ruin = site.rows.find(r => r.branch === "ruin").text;
		const lines = pickLines("greenLord", { theme: "Tombs, mummification, constructed afterlives", site: ruin, purpose: "" });
		expect(lines).toEqual([
			{ key: "theme", label: "Theme", value: "Tombs, mummification, constructed afterlives" },
			{ key: "site", label: "What kind of site?", value: ruin },
		]);
	});

	it("drops a pick left behind by a branch that is no longer taken", () => {
		const site = siteManner("greenLord").tables.find(t => t.key === "site");
		const signs = site.rows.find(r => r.branch === "signs").text;
		// "structure" belongs to the ruin branch, which this pick set doesn't open.
		const lines = pickLines("greenLord", { site: signs, structure: "Underground vault(s)" });
		expect(lines.map(l => l.key)).toEqual(["site"]);
	});
});

describe("rolling", () => {
	it("rolls a manner's table and lands inside it", () => {
		const rolled = rollMannerTable("stoneLord", "purpose", () => 0);
		expect(rolled.text).toBe("Dwelling (home, barracks, dormitory, prison, etc.)");
	});

	it("returns null for a table the manner doesn't have", () => {
		expect(rollMannerTable("cave", "ustrina")).toBe(null);
		expect(rollMannerTable("nope", "structure")).toBe(null);
	});

	it("rolls terrain for a region", () => {
		expect(rollTerrain("greatWood", () => 0).text).toBe("Pond, wetland, or lake");
		expect(rollTerrain("nope")).toBe(null);
	});

	it("weights a ranged row by its span", () => {
		// Great Wood 4-5 is "Clearing, meadow, sparse trees": three single rows precede it,
		// so anything landing in slots 4 or 5 of 12 gives that result.
		expect(rollTerrain("greatWood", () => 3.5 / 12).text).toBe("Clearing, meadow, sparse trees");
		expect(rollTerrain("greatWood", () => 4.5 / 12).text).toBe("Clearing, meadow, sparse trees");
	});

	it("resolves regions and manners by id", () => {
		expect(region("whitefangs").label).toBe("The Whitefang Mountains");
		expect(region("nope")).toBe(null);
		expect(siteManner("faeDomain").label).toBe("Fae domain");
		expect(siteManner("nope")).toBe(null);
	});
});
