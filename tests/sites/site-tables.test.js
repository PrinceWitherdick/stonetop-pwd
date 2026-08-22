import { describe, it, expect } from "vitest";
import {
	SITE_MANNERS, REGIONS, siteManner, region, visibleTables, pickLines,
	rollMannerTable, rollTerrain, rollOnTable,
	COMBINE_SEP, againSpec, combinableRows, combineMax,
	joinCombined, splitCombined, primaryPick,
} from "../../module/data/site-tables.js";

/** The die a table declares, as a number ("1d12" -> 12). */
const dieSize = (die) => Number(String(die).split("d")[1]);

/** Every table of every manner, flattened, with enough context to name a failure. */
const allTables = SITE_MANNERS.flatMap(m => m.tables.map(t => ({ manner: m.id, ...t })));

/** Every rollable table in the file: the manners' own, plus each region's terrain. */
const everyTable = [
	...allTables,
	...REGIONS.map(r => ({ manner: r.id, ...r.terrain })),
];

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
			const covered = r.terrain.rows.flatMap(row =>
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

describe("combining picks", () => {
	// A pick used to print the book's bookkeeping into the site: the roll that produced it, and
	// the "and roll 1d8 again" telling the GM to do something the wizard can do itself. Both are
	// gone from the text; the instruction now rides on the row as `again`, and the wizard follows
	// it into a field of its own.
	it("leaves the roll-again instruction out of every result", () => {
		for (const t of everyTable) {
			for (const row of t.rows) {
				expect(row.text, `${t.manner}.${t.key}`).not.toMatch(/roll\s+(1d\d+[, ]\s*)?(again|twice)/i);
				expect(row.text, `${t.manner}.${t.key}`).not.toMatch(/roll\s+(again|twice)/i);
			}
		}
	});

	it("points every roll-again at rows the table has, and never back at the row itself", () => {
		let found = 0;
		for (const t of everyTable) {
			for (const row of t.rows) {
				const spec = againSpec(row);
				if (!spec) continue;
				found++;
				const pool = combinableRows(t.rows, spec.max);
				expect(pool.length, `${t.manner}.${t.key} pool`).toBeGreaterThan(0);
				// The sub-die stops short of the instruction row, which is how the book keeps a
				// "roll again" from landing on itself and asking to be rolled again.
				expect(spec.max, `${t.manner}.${t.key} sub-die`).toBeLessThan(row.min);
				expect(pool, `${t.manner}.${t.key} pool`).not.toContain(row);
			}
		}
		expect(found).toBeGreaterThan(0);
	});

	it("keeps the combine separator out of every result, so a combined pick splits back cleanly", () => {
		// " + " is what joins a combined answer into the one string the page stores. A result
		// containing it would be cut in half the next time the site was opened to edit.
		for (const t of everyTable) {
			for (const row of t.rows) {
				expect(row.text, `${t.manner}.${t.key}`).not.toContain(COMBINE_SEP);
			}
		}
	});

	it("keeps every table key clear of the wizard's reserved terrain key", () => {
		// The wizard addresses the terrain control with "#terrain" so its pick handlers can be the
		// manner tables' own. A table key starting with "#" would be answered by the wrong control.
		for (const t of allTables) expect(t.key.startsWith("#"), `${t.manner}.${t.key}`).toBe(false);
	});

	it("carries a combined answer out to one string and back into its rows", () => {
		const values = ["Sized for giants", "Fae servants/rebellion"];
		expect(joinCombined(values)).toBe("Sized for giants + Fae servants/rebellion");
		expect(splitCombined(joinCombined(values))).toEqual(values);
	});

	it("reads a pick the same whether it is one string or a list", () => {
		expect(splitCombined("A ruin")).toEqual(["A ruin"]);
		expect(splitCombined(["A ruin", "", "  "])).toEqual(["A ruin"]);
		// The joined form splits, which is what lets a COMBINED pick still name its row.
		expect(primaryPick(`A ruin${COMBINE_SEP}A tomb`)).toBe("A ruin");
		expect(primaryPick(["A", "B"])).toBe("A");
		expect(primaryPick("")).toBe("");
		expect(splitCombined(undefined)).toEqual([]);
	});

	it("asks for nothing of a row that says nothing", () => {
		expect(againSpec({ text: "A ruin" })).toBe(null);
		expect(againSpec(undefined)).toBe(null);
		expect(againSpec({ again: 10 })).toEqual({ max: 10, count: 1 });
		expect(againSpec({ again: 10, againCount: 2 })).toEqual({ max: 10, count: 2 });
	});

	it("offers the whole table when no sub-die is named", () => {
		const rows = siteManner("primordial").tables.find(t => t.key === "theme").rows;
		expect(combinableRows(rows, 0)).toEqual(rows);
		// A COPY, never the module's own array. Handing the shipped rows back by reference makes
		// compile-time data writable through an ordinary-looking return value, and a caller that
		// sorted what it was given would reshape the book's table for the rest of the session.
		expect(combinableRows(rows, 0)).not.toBe(rows);
	});

	it("joins a combined pick into the one value the page stores", () => {
		const lines = pickLines("greenLord", { theme: ["Sized for giants", "Fae servants/rebellion"] });
		expect(lines[0]).toEqual({
			key: "theme", label: "Theme", value: "Sized for giants + Fae servants/rebellion",
		});
	});

	it("reads the branch off the row a combined pick was made on", () => {
		const site = siteManner("greenLord").tables.find(t => t.key === "site");
		const ruin = site.rows.find(r => r.branch === "ruin").text;
		expect(visibleTables("greenLord", { site: [ruin] }).map(t => t.key))
			.toEqual(["theme", "site", "structure", "purpose", "elements", "condition"]);
	});
});

describe("how many answers a table takes", () => {
	it("says it on the table rather than only in the prose beneath it", () => {
		// Six tables used to carry "Pick 1 or combine 2" / "Pick or roll 1 to 3" as a note under a
		// control that offered exactly one field. The note told the GM to do something the wizard
		// gave them no way to do; the limit belongs on the table, where the control can read it.
		for (const t of allTables) {
			expect(t.note ?? "", `${t.manner}.${t.key} note`)
				.not.toMatch(/\b(pick|roll)\b[^.]*\b(1|2|3|one|two|three)\b/i);
		}
	});

	it("takes one answer unless the book says otherwise", () => {
		expect(combineMax({})).toBe(1);
		expect(combineMax(undefined)).toBe(1);
		expect(combineMax({ combine: 2 })).toBe(2);
		expect(combineMax({ combine: 3 })).toBe(3);
	});

	it("lets every table the book says to take several of take several", () => {
		const combinable = allTables.filter(t => combineMax(t) > 1).map(t => `${t.manner}.${t.key}`);
		expect(combinable).toEqual([
			"greenLord.theme", "stoneLord.theme", "forgeLord.theme", "rimeLord.theme",
			"tempestLord.theme", "barrowBuilder.theme", "barrowBuilder.signs",
			"barrowBuilder.barrowElements", "haunted.theme", "faeDomain.theme", "faeDomain.element",
			"primordial.theme", "primordial.features", "sacred.theme", "cave.inhabitant",
			"forestFolk.site", "corrupted.theme",
		]);
	});
});
