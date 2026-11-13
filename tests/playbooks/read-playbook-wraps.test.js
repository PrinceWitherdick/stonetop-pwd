import { describe, it, expect } from "vitest";
import { buildPageRuns, H, BOX, B } from "../fakes/pdf-page-builder.js";
import { readPlaybook, assemblePlaybook } from "../../module/playbooks/pdf/read-playbook.js";
import { normalizeBundle } from "../../module/playbooks/homebrew-bundle.js";

// What the first live import of a real playbook (the Stranger, 2026-11-12) read wrong, rebuilt on
// a page of our own: the template's list bullets are PICTURES, so a bullet's second line sits where
// a new bullet would; its leading is uneven, so "(choose" and "1 or 2)" sit a paragraph apart; the
// stat box's labels top the next column; a write-in's blank is a drawn line, not text.
const WRAPPER = buildPageRuns([{ columns: [
	{ x: 30, lines: [
		H("The Wrapper", "", 24),
		["Reads wraps. It has a second sentence."],
		H("Background", "(Choose 1)"),
		BOX(B("THE WRAPPED")),
		["You wrap lines for a living."],
		H("Drive", "(Choose 1)"),
		BOX(B("TIDINESS")),
		["Keep things neat."],
		H("Special possessions", "(Pick 1)"),
		BOX(B("Glue pot"), " (", { t: "l l", f: "ding" }, "uses): sticks things. Spend ", { t: "n", f: "ding" }, "to hold 1."),
	] },
	{ x: 220, lines: [
		H("Moves", "You start with Fold."),
		BOX(B("FOLD")),
		["When you fold something, roll +DEX: on a 7+, it folds; on a 10+,"],
		["it also creases; on a 6-, it tears. Choose one:"],
		// The widest line on the column: it ran to the edge, and the next carries on its sentence.
		{ tokens: ["Stack it neatly on the long shelf where the others are"], indent: 13 },
		{ tokens: ["kept, out of the way."], indent: 13 },
		{ tokens: ["Hand it to someone"], indent: 13 },
		{ tokens: ["Keep it"], indent: 13 },
		BOX(B("SNIFF")),
		["When you sniff blood and Seek Insight you may roll +CON."],
	] },
	{ x: 470, lines: [
		// The stat box's own labels, at the head of a column with no heading of its own.
		["(WIS)(WIS) (CON)(CON) (CHA)(CHA)"],
		H("Belonging"),
		["When you were small they … (choose"],
		{ gap: 6 },
		["1 or 2)"],
		BOX("… hid you"),
		BOX("… raised you, by"),
		BOX(),
		["Tell us, where do you go to think?"],
	] },
] }], { shuffle: true });

const read = readPlaybook(WRAPPER);
const { bundle } = assemblePlaybook(read.draft);
const move = name => bundle.moves.find(m => m.name === name);

describe("reading wrapped lines", () => {
	it("joins a bullet's carried-on line to it, and keeps a short bullet its own", () => {
		expect(move("Fold").description).toContain("\n- Stack it neatly on the long shelf where the others are kept, out of the way.\n- Hand it to someone\n- Keep it");
	});

	it("reads \"on a 7+\" tiers the way the sheet does", () => {
		expect(move("Fold")).toMatchObject({ rollType: "dex" });
		expect(move("Fold").results.partial).toBe("It folds.");
		expect(move("Fold").results.success).toMatch(/^It folds; it also creases\.?$/);
		expect(move("Fold").results.failure).toMatch(/^It tears/);
	});

	it("doesn't make a roll of a move that only bends another move's roll", () => {
		expect(move("Sniff").rollType).toBe("");
	});

	it("never runs the stat box's labels on into a move", () => {
		for (const m of bundle.moves) expect(m.description).not.toMatch(/\(WIS\)|\(CON\)|WIS WIS/);
	});

	it("keeps a sentence split by uneven leading in one paragraph", () => {
		const q = bundle.playbook.lore.find(l => /When you were small/.test(l.description));
		expect(q.description).toBe("When you were small they … (choose 1 or 2)");
	});

	it("titles each question under a shared heading by its own question, with the heading over them", () => {
		const titles = bundle.playbook.lore.map(l => l.title);
		expect(titles).toEqual(["Belonging", "When you were small they …", "Where do you go to think?"]);
		expect(bundle.playbook.lore[0].options).toEqual([]);
	});

	it("gives a write-in its blank back: a dangling word, and an empty box among options to tick", () => {
		const { bundle: clean } = normalizeBundle(bundle);
		const q = clean.playbook.lore.find(l => l.title === "When you were small they …");
		expect(q.options.map(o => o.description)).toEqual(["… hid you", "… raised you, by ___", "Something else: ___"]);
		expect(q.options.every(o => !o.freeText)).toBe(true);
	});

	it("spaces a word set against a glyph", () => {
		expect(bundle.playbook.possessions.options[0].description).toBe("(○○ uses): sticks things. Spend ☐ to hold 1.");
	});

	it("fills the picker's blurb from the playbook's own opening words", () => {
		expect(bundle.playbook.summary).toBe("Reads wraps. It has a second sentence.");
	});
});
