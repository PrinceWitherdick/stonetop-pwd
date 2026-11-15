import { describe, it, expect } from "vitest";
import { hashText, shapeHash, shapesOf, runsFromShapes, coverage, readOutlinePage } from "../../module/playbooks/pdf/outline-text.js";

// A page "printed" to PDF: every letter a filled outline under its own translate. These tests draw
// their own little outlines (a square per letter, sized and placed by hand) and a glyph table that
// names them; no third-party PDF's shapes or words.

const OPS = { save: 10, restore: 11, transform: 12, constructPath: 91, fill: 22, eoFill: 23, setFillRGBColor: 59 };
const VIEWPORT = [1, 0, 0, 1, 0, 0]; // points, y down, already

/** One outline: a w×h box drawn from its translate (x, top), `id` making each letter's shape its own. */
function outline(id, w = 4, h = 5) {
	const ops = [13, 14, 14, 14, 18, 13, 14, 18];
	const coords = [0, 0, w, 0, w, h, 0, h, 0, 0, id / 20, 0];
	return { ops, coords, key: shapeHash(ops, coords) };
}

/** An operator list drawing `glyphs` ({ shape, x, y (top), white }). */
function opList(glyphs) {
	const fnArray = [], argsArray = [];
	const push = (fn, args = null) => { fnArray.push(fn); argsArray.push(args); };
	for (const g of glyphs) {
		push(OPS.save);
		push(OPS.transform, [1, 0, 0, 1, g.x, g.y]);
		push(OPS.setFillRGBColor, g.white ? [255, 255, 255] : [35, 31, 32]);
		push(OPS.constructPath, [g.shape.ops, g.shape.coords, [0, 0, 0, 0]]);
		push(OPS.fill);
		push(OPS.restore);
	}
	return { fnArray, argsArray };
}

// Letters: each its own outline, 4pt wide, baseline 5pt under its translate.
const LETTERS = "Theyouarecat,.-’”“()1A";
const SHAPES = Object.fromEntries([...LETTERS].map((c, i) => [c, outline(i + 1)]));
const SPECK = outline(90, 0.5, 0.5);
const table = {
	fonts: { R: "ACaslonPro-Regular", B: "ACaslonPro-Bold", D: "ZapfDingbats", A: "Avara-Bold" },
	glyphs: Object.fromEntries([...LETTERS].map(c => [SHAPES[c].key, `${c}\tR\t8\t5`])),
};
table.glyphs[SPECK.key] = ""; // known to be no letter

/** Lay a line of text out from x, at one baseline: letters 4pt wide, 0.4pt apart, words 2.4pt apart. */
function line(text, x, top, { space = 2.4, kern = 0.4 } = {}) {
	const out = [];
	for (const ch of text) {
		if (ch === " ") { x += space - kern; continue; }
		out.push({ shape: SHAPES[ch], x, y: top });
		x += 4 + kern;
	}
	return out;
}

const read = (glyphs, t = table, page = 1) => runsFromShapes(shapesOf(opList(glyphs), OPS, VIEWPORT), t, { page });

describe("outline text: shapes", () => {
	it("hashes the same outline the same wherever it is drawn, and another outline differently", () => {
		expect(shapeHash([13, 14], [0, 0, 1.004, 2])).toBe(shapeHash([13, 14], [0, 0, 1.0049, 2]));
		expect(shapeHash([13, 14], [0, 0, 1, 2])).not.toBe(shapeHash([13, 14], [0, 0, 1, 3]));
		expect(hashText("abc")).toMatch(/^[0-9a-z]+$/);
	});

	it("keeps every hash it has ever printed: the known PDFs' glyph tables are keyed by them", () => {
		expect(hashText("abc")).toBe("1dtlchkfkb1");
		expect(hashText("")).toBe("wvjl67o803");
		expect(hashText("abc", 7)).toBe("154j5ko83iz");
		expect(hashText("known:theabhorseninwaiting")).toBe("1qlrn2ydto7");
		expect(shapeHash([13, 14, 18], [0, 0, 4.5, 5])).toBe("279vh9p85ne");
	});

	it("places each shape on the page, and marks a white one apart", () => {
		const shapes = shapesOf(opList([{ shape: SHAPES.T, x: 10, y: 20 }, { shape: SHAPES.h, x: 30, y: 20, white: true }]), OPS, VIEWPORT);
		expect(shapes[0]).toMatchObject({ hash: SHAPES.T.key, x0: 10, ty: 20, white: false });
		expect(shapes[1].hash).toBe(`w${SHAPES.h.key}`);
	});

	it("says how much of a page a table can read, white knock-outs aside", () => {
		const shapes = shapesOf(opList([...line("The cat", 10, 20), { shape: outline(70), x: 60, y: 20 }, { shape: outline(71), x: 70, y: 20, white: true }]), OPS, VIEWPORT);
		expect(coverage(shapes, table)).toBeCloseTo(6 / 7);
		expect(readOutlinePage(opList(line("The cat", 10, 20)), OPS, VIEWPORT, table)).toHaveLength(1);
		expect(readOutlinePage(opList([{ shape: outline(70), x: 1, y: 1 }]), OPS, VIEWPORT, table)).toBeNull();
	});
});

describe("outline text: runs", () => {
	it("puts the word spaces back from the gaps, and reads a row from left to right", () => {
		const runs = read([...line("you are", 50, 30), ...line("The cat", 10, 10)].reverse());
		expect(runs.map(r => r.str)).toEqual(["The cat", "you are"]);
		expect(runs[0]).toMatchObject({ x: 10, y: 15, size: 8, font: "R" });
	});

	it("breaks a row at a gutter into runs of their own", () => {
		const runs = read([...line("cat", 10, 10), ...line("you", 120, 10)]);
		expect(runs.map(r => r.str)).toEqual(["cat", "you"]);
	});

	it("starts a run at a change of face, the space going with the run before", () => {
		const t = structuredClone(table);
		for (const c of "you") t.glyphs[SHAPES[c].key] = `${c}\tB\t8\t5`;
		const runs = read(line("cat you", 10, 10), t);
		expect(runs.map(r => [r.str, r.font])).toEqual([["cat ", "R"], ["you", "B"]]);
		expect(runs[0].x + runs[0].w).toBeCloseTo(runs[1].x);
	});

	it("reads an outline that is two marks by where it sits: low a comma, high an apostrophe", () => {
		const t = structuredClone(table);
		// The comma's shape, read as an apostrophe when it sits 4pt higher.
		t.glyphs[SHAPES[","].key] = ",\tR\t8\t3\t0\t0\t’@7";
		const low = read([...line("cat", 10, 10), { shape: SHAPES[","], x: 22.4, y: 12 }], t);
		expect(low.map(r => r.str)).toEqual(["cat,"]);
		const high = read([...line("cat", 10, 10), { shape: SHAPES[","], x: 22.4, y: 8 }, ...line("e", 25.2, 10)], t);
		expect(high.map(r => r.str)).toEqual(["cat’e"]);
	});

	it("keeps a line of dashes off the row beside it", () => {
		const runs = read([...line("cat", 10, 20), ...line("---", 30, 15)]);
		expect(runs.map(r => r.str).sort()).toEqual(["---", "cat"]);
	});

	it("never spaces inside brackets and quotes, and always after a closing one", () => {
		expect(read(line("( cat )", 10, 10, { space: 1.2 })).map(r => r.str)).toEqual(["(cat)"]);
		expect(read(line("“cat”you", 10, 10)).map(r => r.str)).toEqual(["“cat” you"]);
	});

	it("joins a hyphen inside a word, and keeps the space after a minus", () => {
		expect(read(line("cat-The", 10, 10, { kern: 0.4 })).map(r => r.str)).toEqual(["cat-The"]);
		expect(read([...line("1-", 10, 10), ...line("cat", 20.1, 10)]).map(r => r.str)).toEqual(["1- cat"]);
	});

	it("puts a space where the table lists one the gaps can't show", () => {
		const glyphs = line("cat", 10, 10).concat(line("you", 22.6, 10));
		expect(read(glyphs).map(r => r.str)).toEqual(["catyou"]);
		const t = { ...table, spaces: [[1, 22.6, 15]] };
		expect(read(glyphs, t).map(r => r.str)).toEqual(["cat you"]);
		expect(read(glyphs, t, 2).map(r => r.str)).toEqual(["catyou"]);
	});

	it("reads a white shape only when the table names it, as the step numbers are", () => {
		const t = structuredClone(table);
		t.glyphs[`w${SHAPES["1"].key}`] = "1\tA\t9\t5";
		const glyphs = [{ shape: SHAPES["1"], x: 5, y: 10, white: true }, { shape: SHAPES.A, x: 50, y: 10, white: true }];
		expect(read(glyphs, t).map(r => [r.str, r.font, r.size])).toEqual([["1", "A", 9]]);
	});

	it("leaves out an outline the table knows is no letter", () => {
		expect(read([...line("cat", 10, 10), { shape: SPECK, x: 40, y: 12 }]).map(r => r.str)).toEqual(["cat"]);
	});
});
