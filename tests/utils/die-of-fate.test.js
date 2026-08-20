import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rollDieOfFate } from "../../module/utils/die-of-fate.js";
import {
	DEFAULT_FATE_TABLE, FATE_TABLES,
	fateRangeLabel, fateRowFor, fateTableList, fateInlinePhrase,
} from "../../module/data/fate-tables.js";

// The d6 oracle and the authored tables hung off it. What matters here is that a caller who names
// a table gets THAT table's answer on the card: the walkthrough's Die of Fate buttons sit under a
// printed table ("1: a danger springs on them…"), and a card reading only "4 — neutral / mixed"
// sends the GM back to the page to look the row up by hand.

/** A d6 that always lands on `total`, capturing what the card said. */
function d6(total) {
	const posted = [];
	globalThis.Roll = class {
		constructor(formula) { this.formula = formula; this.total = total; }
		evaluate() { return Promise.resolve(this); }
		toMessage(data) { posted.push(data); return Promise.resolve(data); }
	};
	return posted;
}

let posted;
beforeEach(() => { posted = d6(4); });
afterEach(() => { delete globalThis.Roll; });

/** The card's markup, as it reaches chat. */
const card = () => posted[0].flavor;
/** Just the result box — the line the GM actually reads. */
const result = () => card().match(/<div class="stonetop-fate-result[\s\S]*?<\/div>/)[0];

describe("the bare oracle", () => {
	it("still reads as a traffic light, and names no table", async () => {
		await rollDieOfFate();
		expect(result()).toContain("Neutral / mixed");
		expect(result()).toContain("stonetop-fate--mixed");
		expect(card()).toContain(">4<");
		// The speaker alias already says "Die of Fate"; a title row here would only repeat it.
		expect(card()).not.toContain("stonetop-fate-title");
		expect(posted[0].speaker.alias).toBe("Die of Fate");
	});

	// This is on `game.stonetop` and behind a hotbar macro, so the argument can be anything a
	// table's own macro hands it — or the jQuery Event from a stray
	// `.on("click", game.stonetop.rollDieOfFate)`. A default parameter only covers `undefined`, and
	// everything past it reads `table.rows`; the die is evaluated first, so the throw took the roll
	// with it and posted nothing at all.
	it("falls back to the bare oracle for anything that is not one of the tables", async () => {
		for (const bad of [6, null, "camp", {}, { rows: "nope" }]) {
			posted.length = 0;
			await expect(rollDieOfFate(bad)).resolves.not.toThrow();
			// The card still went out, which is the half the throw used to take with it.
			expect(posted).toHaveLength(1);
			expect(result()).toContain("Neutral / mixed");
			expect(card()).not.toContain("stonetop-fate-title");
		}
	});

	it("rolls one d6, whatever the table", async () => {
		await rollDieOfFate(FATE_TABLES.camp);
		expect(card()).toContain("1d6");
	});
});

describe("a named table", () => {
	it("answers with the row the die landed on, not the band", async () => {
		await rollDieOfFate(FATE_TABLES.perilous);
		expect(result()).toContain("Point to a looming danger.");
		expect(result()).not.toContain("Neutral / mixed");
	});

	it("says which question was asked", async () => {
		await rollDieOfFate(FATE_TABLES.camp);
		expect(card()).toContain("Making camp");
		expect(result()).toContain("The night passes uneventfully.");
	});

	it("shows the whole table, with the rolled row lit", async () => {
		await rollDieOfFate(FATE_TABLES.perilous);
		for (const row of FATE_TABLES.perilous.rows) expect(card()).toContain(row.text);
		const lit = card().match(/<li class="stonetop-fate-legend-row[^"]*is-active[^>]*>([\s\S]*?)<\/li>/);
		expect(lit[1]).toContain("Point to a looming danger.");
		expect(card().match(/is-active/g)).toHaveLength(1);
	});

	it("keeps a full sentence out of the uppercased band slot", async () => {
		// .stonetop-fate-label is uppercased in the stylesheet — it was cut for one-word bands.
		await rollDieOfFate(FATE_TABLES.perilous);
		expect(result()).toContain('stonetop-fate-text">Point to a looming danger.');
		expect(result()).not.toMatch(/stonetop-fate-label">Point/);
	});

	it("carries a band word and its sentence when the table has both", async () => {
		await rollDieOfFate(FATE_TABLES.weather);
		expect(result()).toContain('stonetop-fate-label">partway');
		expect(result()).toContain("They get part of what they were hoping for.");
	});

	it("falls back to the bare oracle when a step names nothing", async () => {
		await rollDieOfFate(FATE_TABLES.nonesuch);
		expect(result()).toContain("Neutral / mixed");
	});
});

describe("every table", () => {
	const tables = { oracle: DEFAULT_FATE_TABLE, ...FATE_TABLES };

	it("covers all six faces exactly once", () => {
		for (const [key, table] of Object.entries(tables)) {
			const faces = table.rows.flatMap(r => r.faces);
			expect(faces.slice().sort((a, b) => a - b), key).toEqual([1, 2, 3, 4, 5, 6]);
			// Rows run low to high, because that is the order they're printed in.
			expect(faces, key).toEqual(faces.slice().sort((a, b) => a - b));
		}
	});

	it("gives every row a traffic-light tone and something to say", () => {
		for (const [key, table] of Object.entries(tables)) {
			for (const row of table.rows) {
				expect(["bad", "mixed", "good"], `${key} ${row.faces}`).toContain(row.tone);
				expect(row.text ?? row.label, `${key} ${row.faces}`).toBeTruthy();
			}
		}
	});

	it("resolves each face to the row that owns it", () => {
		for (const [key, table] of Object.entries(tables)) {
			for (let face = 1; face <= 6; face++) {
				expect(fateRowFor(table, face).faces, `${key} ${face}`).toContain(face);
			}
		}
	});
});

describe("printing a table", () => {
	it("prints a single face bare and a span as a range", () => {
		expect(fateRangeLabel({ faces: [1] })).toBe("1");
		expect(fateRangeLabel({ faces: [4, 5] })).toBe("4&ndash;5");
	});

	it("renders the step body's reference list from the same rows", () => {
		const list = fateTableList(FATE_TABLES.camp);
		expect(list).toContain('class="stonetop-exp-fatetable"');
		expect(list.match(/<li>/g)).toHaveLength(FATE_TABLES.camp.rows.length);
		expect(list).toContain("<strong>4&ndash;5</strong>: The night passes uneventfully.");
	});

	it("renders the weather step's parenthetical from them too", () => {
		expect(fateInlinePhrase(FATE_TABLES.weather))
			.toBe("1&ndash;2 nope, 3&ndash;4 partway, 5&ndash;6 just what they wanted");
	});
});
