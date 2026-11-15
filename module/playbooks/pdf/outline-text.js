// TEXT DRAWN AS OUTLINES, READ BACK INTO RUNS. PURE apart from the pdf.js operator list it is handed.
//
// Some playbooks reach the GM "printed" to PDF (Windows' Microsoft Print to PDF does this): every letter
// is a small filled shape under its own translate, with no font and no text layer, so pdf.js finds no
// text. The shapes repeat, though: every "e" of one face at one size is the same outline, point for
// point. A GLYPH TABLE says which letter each outline is (a hash of the outline -> the letter, its face,
// its size), so the page's runs can be rebuilt from where the shapes sit.
//
// A glyph table holds no words of the playbook: only which outline is which letter, the way a font's
// own character map does. The tables live with the known third-party playbooks (known/), each made
// from the GM's own copy of that PDF.
//
// Glyph table: { fonts: { <face>: <font name the reader knows> },
//                glyphs: { <shape hash>: "<text>\t<face>\t<size>\t<baseline offset>" } }
//   face: a short key ("R", "B", "I", "BI", "A" Avara, "D" dingbats); text: one letter, a ligature
//   ("fi"), or the template's dingbat letters ("n" a box, "4" a tick, "l" a pip, "u" a diamond);
//   baseline offset: points from the shape's translate down to its baseline.

import { cyrb53Halves } from "../../hooks/journal-sync-core.js";

/** The cheap 53-bit string hash (cyrb53), as base 36: a shape's key in a glyph table. */
export function hashText(str, seed = 0) {
	const [h1, h2] = cyrb53Halves(str, seed);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A shape's key: its path operators and its points to the hundredth, hashed. */
export function shapeHash(ops, coords) {
	return hashText(`${Array.from(ops).join(",")}|${Array.from(coords, v => Math.round(v * 100)).join(",")}`);
}

const mul = (a, b) => [
	a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
	a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
	a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

/**
 * Every filled shape on a page, with where it sits: the letters among them are what a glyph table
 * names. A white shape's hash starts "w": most are knock-outs (a white halo behind a word, the fill
 * inside a box) that no table names, but a table can name the few that are words (the template's
 * step numbers, white on their black squares, which its text layer does carry).
 * @param {object} opList     page.getOperatorList()
 * @param {object} OPS        pdf.js OPS
 * @param {number[]} viewport the page viewport's transform (points, y down from the top)
 * @returns {Array<{hash: string, x0: number, x1: number, y0: number, y1: number, ty: number, white: boolean}>}
 */
export function shapesOf(opList, OPS, viewport) {
	const out = [];
	let ctm = Array.from(viewport), pending = null, white = false;
	const stack = [];
	const fns = opList?.fnArray ?? [], args = opList?.argsArray ?? [];
	for (let i = 0; i < fns.length; i++) {
		const fn = fns[i], a = args[i];
		if (fn === OPS.save) stack.push({ ctm, white });
		else if (fn === OPS.restore) { const s = stack.pop(); if (s) ({ ctm, white } = s); pending = null; }
		else if (fn === OPS.transform) ctm = mul(ctm, a);
		else if (fn === OPS.setFillRGBColor) white = _isWhite(a);
		else if (fn === OPS.constructPath) pending = Array.isArray(a?.[0]) || ArrayBuffer.isView(a?.[0]) ? { ctm, ops: a[0], coords: a[1] } : null;
		else if ((fn === OPS.fill || fn === OPS.eoFill) && pending) {
			if (pending.coords?.length) {
				const c = pending.ctm;
				let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
				for (let k = 0; k + 1 < pending.coords.length; k += 2) {
					const x = pending.coords[k], y = pending.coords[k + 1];
					const px = c[0] * x + c[2] * y + c[4], py = c[1] * x + c[3] * y + c[5];
					if (px < x0) x0 = px; if (px > x1) x1 = px;
					if (py < y0) y0 = py; if (py > y1) y1 = py;
				}
				out.push({ hash: (white ? "w" : "") + shapeHash(pending.ops, pending.coords), x0, x1, y0, y1, ty: c[5], white });
			}
			pending = null;
		}
	}
	return out;
}

function _isWhite(a) {
	// pdf.js 4 hands a colour as [r, g, b] bytes; a "#rrggbb" string in later versions.
	if (typeof a?.[0] === "string") return /^#?f{6}$/i.test(a[0]);
	const v = Array.from(a ?? []);
	return v.length >= 3 && v.slice(0, 3).every(n => n >= 250);
}

/**
 * One glyph table entry, parsed. `left`/`right`: how far the letter's ink sits in from its own
 * spacing on each side, in points (an "f" leans out over its neighbour, a "1" stands well clear),
 * so the gap between two letters can be read as a word space or not.
 */
function _entry(raw) {
	const [text, face, size, dy, left, right, alt] = String(raw).split("\t");
	const [altText, altDy] = String(alt ?? "").split("@");
	return {
		text, face, size: Number(size) || 8, dy: Number(dy) || 0, left: Number(left) || 0, right: Number(right) || 0,
		alt: altText ? { text: altText, dy: Number(altDy) || 0 } : null,
	};
}

// Marks that sit off the baseline or between words: placed on the row of the letters around them
// rather than making a row of their own, and taking a word's face when they sit inside it.
const MARK = /^[\p{P}\p{S}]+$/u;
const JOINER = /^['"‘’“”-]$/u;

/**
 * How much of a page's ink a table can read: the share of its small shapes (letter-sized) it names.
 * A table made for another printing reads next to nothing.
 */
export function coverage(shapes, table) {
	const small = shapes.filter(s => !s.white && s.x1 - s.x0 < 30 && s.y1 - s.y0 < 30 && (s.x1 - s.x0 > 1.2 || s.y1 - s.y0 > 1.2));
	if (!small.length) return 0;
	return small.filter(s => table.glyphs[s.hash] !== undefined).length / small.length;
}

const ROW_TOLERANCE = 0.3; // × size: letters this close in baseline share a row
const MARK_REACH = 0.35;   // × size: how far off a row's baseline a mark may sit and still be on it
const SPACE_GAP = 0.07;    // × size: this much more room between two letters than their own is a word space
const RUN_GAP = 0.6;       // × size: a gap this wide is no longer one run (a gutter); the layout's own ABUT_GAP

/**
 * A page's runs (PageRuns' run shape: { str, x, y, w, size, font }), rebuilt from its shapes. Each run
 * is one face along one baseline; word spaces are put back from the gaps between letters.
 * `font` is the face key, which the caller lists in PageRuns.fonts with the table's font name.
 */
export function runsFromShapes(shapes, table, { page = 1 } = {}) {
	const glyphs = [], marks = [];
	for (const s of shapes) {
		const raw = table.glyphs[s.hash];
		if (raw === undefined) continue;
		const e = _entry(raw);
		if (!e.text) continue;
		const g = { ...e, x0: s.x0, x1: s.x1, base: s.ty + e.dy, altBase: e.alt ? s.ty + e.alt.dy : null };
		(MARK.test(e.text) && e.face !== "D" ? marks : glyphs).push(g);
	}
	// Rows by baseline, from the letters; then left to right.
	glyphs.sort((a, b) => a.base - b.base || a.x0 - b.x0);
	const rows = [];
	for (const g of glyphs) {
		const row = rows.findLast(r => Math.abs(r.base - g.base) <= ROW_TOLERANCE * Math.max(Math.min(r.size, g.size), 4));
		if (row) { row.glyphs.push(g); row.size = Math.max(row.size, g.size); }
		else rows.push({ base: g.base, size: g.size, glyphs: [g] });
	}
	// Each mark joins the row it sits on, beside letters. An outline that is two marks by where it sits
	// (a comma low, an apostrophe high: one shape in Caslon) is read as whichever puts it on a row. A
	// mark on no row (a line of dashes drawn as a divider) is a row of its own.
	for (const m of marks) {
		let best = null;
		const readings = [{ text: m.text, base: m.base }];
		if (m.alt) readings.push({ text: m.alt.text, base: m.altBase });
		for (const reading of readings) {
			for (const r of rows) {
				const d = Math.abs(r.base - reading.base);
				if (d > MARK_REACH * r.size || (best && d >= best.d)) continue;
				if (!r.glyphs.some(g => g.x1 >= m.x0 - r.size && g.x0 <= m.x1 + r.size)) continue;
				best = { r, reading, d };
			}
		}
		if (!best) { rows.push({ base: m.base, size: m.size, glyphs: [m] }); continue; }
		m.text = best.reading.text;
		best.r.glyphs.push(m);
	}
	const runs = [];
	for (const row of rows) {
		row.glyphs.sort((a, b) => a.x0 - b.x0 || (a.face === "D" ? -1 : 1));
		// A quote, apostrophe or hyphen is in the face of the word it touches ("Gordin's", “In-Waiting”):
		// the outline is often the same in every face, so its own label can't say. Sentence marks keep
		// their own, as the template sets them (a plain comma after an emphasised trigger).
		row.glyphs.forEach((g, i, all) => {
			if (!JOINER.test(g.text)) return;
			const a = all[i - 1], b = all[i + 1];
			const word = n => n && !MARK.test(n.text) && n.face !== "D";
			if (word(a) && !_spaced(a, g)) g.face = a.face;
			else if (word(b) && !_spaced(g, b)) g.face = b.face;
		});
		let run = null, prev = null, before = null;
		const close = () => { if (run) { run.w = round(run.end - run.x); delete run.end; runs.push(run); } run = null; };
		for (const g of row.glyphs) {
			const gap = prev ? g.x0 - prev.x1 : 0;
			const size = Math.min(g.size, prev?.size ?? g.size);
			// A hyphen inside a word ("In-Waiting") joins what follows, however wide the capital after
			// it stands; one after a number ("on a 6- to get") is a minus, and the space stays.
			const joined = prev?.text === "-" && before && /\p{L}$/u.test(before.text) && !_spaced(before, prev) && /^\p{L}/u.test(g.text);
			const spaced = prev && (_forcedSpace(table, page, g) || (!joined && _spaced(prev, g)));
			if (!run || gap > RUN_GAP * Math.max(size, 6) || g.face !== run.font) {
				// A face change inside a line: the space between goes to the run before, which then
				// reaches the new run's first letter, so the layout reads the two as abutting.
				if (run && spaced && gap <= RUN_GAP * Math.max(size, 6)) { run.str += " "; run.end = g.x0; }
				close();
				run = { str: g.text, x: round(g.x0), y: round(row.base), size: g.size, font: g.face, end: g.x1, sized: !MARK.test(g.text) };
			} else {
				run.str += (spaced ? " " : "") + g.text;
				run.end = g.x1;
				// The run's size is its letters' (a footnote's full stops are cut at the body size).
				if (!run.sized && !MARK.test(g.text)) { run.size = g.size; run.sized = true; }
			}
			before = prev;
			prev = g;
		}
		close();
	}
	for (const r of runs) delete r.sized;
	return runs;
}

/**
 * A word space the gaps can't show (a space narrower than the letters' own leaning), listed in the
 * table by where the letter after it sits: `spaces: [[page, x, baseline], …]`, in points.
 */
function _forcedSpace(table, page, g) {
	return !!table.spaces?.some(([p, x, y]) => p === page && Math.abs(g.x0 - x) < 0.3 && Math.abs(g.base - y) < 1);
}

const NO_SPACE_AFTER = /[([“‘]$/u;
const NO_SPACE_BEFORE = /^[)\],.;:!?”’…]/u;
const CLOSES = /[)”]$/u;
const WORDY = /^[\p{L}\p{N}]/u;

/**
 * Is there a word space between two letters side by side? More room than their own ink leaves. Type
 * settles the marks that have too few letters beside them to measure: nothing follows an opening
 * bracket or quote, nothing comes before a closing one or a comma, and a word after a closing one
 * stands apart.
 */
function _spaced(a, b) {
	if (NO_SPACE_AFTER.test(a.text) || NO_SPACE_BEFORE.test(b.text)) return false;
	if (CLOSES.test(a.text) && WORDY.test(b.text)) return true;
	const gap = b.x0 - a.x1 - a.right - b.left;
	return gap > SPACE_GAP * Math.min(a.size, b.size);
}

/**
 * Read a page with no text layer through a glyph table: its runs, or null when the table doesn't fit
 * the page (too few of its shapes known).
 */
export function readOutlinePage(opList, OPS, viewport, table, { minCoverage = 0.9, page = 1 } = {}) {
	const shapes = shapesOf(opList, OPS, viewport);
	if (coverage(shapes, table) < minCoverage) return null;
	return runsFromShapes(shapes, table, { page });
}

const round = v => Math.round(Number(v) * 100) / 100;
