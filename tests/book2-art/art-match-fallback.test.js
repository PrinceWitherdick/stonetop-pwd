import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// The importer finds an illustration by its exact native pixel size. A printing can re-save the
// same picture at a different resolution without moving it: the 2nd printing of both books does
// that to nine of them, and every row pointing at one fails with "no WxH on pN" and leaves a
// broken image on a bestiary entry.
//
// So there is a fallback. When the recorded size is absent, the matcher takes the illustration
// of the same SHAPE sitting in the same PLACE, and normalises it back to the recorded size. That
// pair identifies a picture across printings; the pixel count is only how one export stored it.
//
// Measured against both 2nd-printing PDFs, over all 471 stencil rows: exact-size finds 459 and
// misses 12; shape-and-place finds all 471, is ambiguous nowhere, and picks the identical image
// on all 459 the exact rule already resolves.
//
// These guard the two halves that can silently regress. scripts/local/book2-art/gen-pack-macro.js
// rebuilds packs/src/stonetop-macros/import-book2-art.json from sources OUTSIDE this repo, so a
// regeneration from a body that never learned the fallback would drop it with every other test
// still green (the same "guard it from the far side" problem as the people projection and the
// duplicate-art collapse).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MACRO_PACK_DOC = path.resolve(HERE, "../../packs/src/stonetop-macros/import-book2-art.json");
const COMMAND = JSON.parse(fs.readFileSync(MACRO_PACK_DOC, "utf8")).command;

/** The manifest literal out of the shipped macro, brace-matched from its marker. */
function macroManifest() {
	const marker = COMMAND.indexOf("/*__MANIFEST__*/");
	const start = COMMAND.indexOf("{", marker);
	let depth = 0;
	for (let i = start; i < COMMAND.length; i++) {
		const c = COMMAND[i];
		if (c === "{") depth++;
		else if (c === "}" && --depth === 0) return JSON.parse(COMMAND.slice(start, i + 1));
	}
	throw new Error("could not find the manifest literal in the Import Book Art macro");
}

const MANIFEST = macroManifest();

/**
 * A CONFIG number read out of the macro itself. The ambiguity guard below has to run against the
 * tolerances that SHIP, not against a copy of them: hardcoding the pair here would let someone
 * widen either one in the macro and watch every test stay green while the guarantee quietly died.
 */
function configNumber(name) {
	const m = COMMAND.match(new RegExp(`\\b${name}:\\s*([0-9.]+)`));
	expect(m, `CONFIG.${name} is not declared in the macro`).not.toBeNull();
	return Number(m[1]);
}

/** Every image the importer lifts as a stencil, with the geometry the matcher uses. */
function stencils() {
	const out = [];
	const add = (row, im) => {
		if (!im.out || im.pdfPage == null) return;
		// Nothing RENDERED is ever matched by size: a `render` row is rasterised from a page RECT
		// rather than lifted out of the page's image objects — the printed maps, and the GM
		// playbook's two flowcharts, which are vector and have no image object to lift at all.
		// Neither is a pagemap WITHOUT `render`, which is wiring-only: its `out` is another row's
		// file, so it asks for no extraction. All of them legitimately carry no w/h/bbox, which is
		// why they are cut here rather than counted as rows missing their geometry.
		if (row.render || row.kind === "pagemap") return;
		out.push({ slug: row.slug, kind: row.kind, out: im.out, book: im.book ?? row.book ?? 2, page: im.pdfPage, w: im.w, h: im.h, at: im.bbox });
	};
	for (const row of MANIFEST.rows ?? []) {
		if (row.kind === "location") { for (const im of row.images ?? []) add(row, im); continue; }
		add(row, row);
	}
	return out;
}

const ALL = stencils();

describe("the shape-and-place fallback survives a regeneration", () => {
	it("has something to check", () => {
		expect(ALL.length).toBeGreaterThan(300);
	});

	it("still falls back to the same shape in the same place", () => {
		// The three clauses that make the fallback safe, each load-bearing: not smaller (a page's
		// own 75x75 bullets and 651x13 rules must never stand in for its plate), same proportions,
		// and near where the manifest records this row's art.
		expect(COMMAND, "the not-smaller clause is gone").toMatch(/s\.w >= want\.w && s\.h >= want\.h/);
		expect(COMMAND, "the shape comparison is gone").toMatch(/CONFIG\.SHAPE_TOL/);
		expect(COMMAND, "the placement ceiling is gone").toMatch(/CONFIG\.MAX_OFFSET_PT/);
	});

	it("still normalises the lift to the size the manifest records", () => {
		// Unconditional, and taken from the manifest rather than as a ratio off the lifted canvas.
		// Without it a re-saved illustration writes at the printing's resolution instead of the
		// one every crop fraction and square-face rect was measured against.
		expect(COMMAND).toContain("downscale(lifted, Math.max(want.w, want.h))");
	});

	it("keeps the fallback off the exact path", () => {
		// An exact hit must still win outright, or a PDF carrying the recorded size would start
		// resolving through a looser rule than the one that has always shipped.
		expect(COMMAND).toMatch(/s\.w === want\.w && s\.h === want\.h/);
	});
});

describe("the manifest can still be matched by shape and place", () => {
	it("gives every stencil row a usable placement", () => {
		// `bbox` used to be only a tiebreak between equally-sized candidates, so a sloppy one was
		// harmless. It is now the guard on the fallback, and a row without it silently loses its
		// only recourse on a PDF that re-saved its art.
		const bad = ALL.filter((s) => !Array.isArray(s.at) || s.at.length < 2
			|| !Number.isFinite(s.at[0]) || !Number.isFinite(s.at[1]));
		expect(bad.map((s) => `${s.kind}:${s.slug} ${s.out}`), "no usable bbox").toEqual([]);
	});

	it("gives every stencil row a usable size", () => {
		const bad = ALL.filter((s) => !(s.w > 0) || !(s.h > 0));
		expect(bad.map((s) => `${s.kind}:${s.slug} ${s.out}`), "no usable w/h").toEqual([]);
	});

	it("never puts two different pictures at the same shape and place on one page", () => {
		// What would make the fallback ambiguous. Two rows describing the SAME picture are the
		// normal case and fine (a person illustration and its square face are one image cut
		// twice); two rows describing DIFFERENT pixels are not.
		//
		// Read from the macro, so widening either tolerance is checked against the book rather
		// than merely re-stating itself. Also reports how close the nearest survivor came, since
		// "no clashes" says nothing about whether the next edit creates one: the tightest pair in
		// Book II clears the placement ceiling by only about 1.5x.
		const SHAPE_TOL = configNumber("SHAPE_TOL");
		const MAX_OFFSET_PT = configNumber("MAX_OFFSET_PT");
		const clashes = [];
		let tightest = null;
		for (let i = 0; i < ALL.length; i++) {
			for (let j = i + 1; j < ALL.length; j++) {
				const a = ALL[i], b = ALL[j];
				if (a.book !== b.book || a.page !== b.page) continue;
				if (a.w === b.w && a.h === b.h) continue;                       // one picture, many rows
				// Only pairs the "not smaller" clause would let stand in for each other.
				if (!((a.w >= b.w && a.h >= b.h) || (b.w >= a.w && b.h >= a.h))) continue;
				const shapeGap = Math.abs((a.w / a.h) / (b.w / b.h) - 1);
				const placeGap = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
				const where = `b${a.book} p${a.page}: ${a.out} (${a.w}x${a.h}) vs ${b.out} (${b.w}x${b.h})`;
				if (shapeGap <= SHAPE_TOL && placeGap <= MAX_OFFSET_PT) { clashes.push(where); continue; }
				// Margin on whichever tolerance this pair clears by the least.
				const margin = Math.min(shapeGap / SHAPE_TOL, placeGap / MAX_OFFSET_PT);
				if (!tightest || margin < tightest.margin) tightest = { margin, where, shapeGap, placeGap };
			}
		}
		expect(clashes, "two different pictures the fallback could confuse").toEqual([]);
		expect(tightest, "no differently-sized pairs found at all, so this guard proves nothing").not.toBeNull();
		expect(
			tightest.margin,
			`the closest pair is only ${tightest.margin.toFixed(2)}x clear of a tolerance `
			+ `(${Math.round(tightest.placeGap)}pt vs a ${MAX_OFFSET_PT}pt ceiling, `
			+ `${(tightest.shapeGap * 100).toFixed(2)}% vs a ${(SHAPE_TOL * 100).toFixed(2)}% shape tolerance) -- ${tightest.where}`,
		).toBeGreaterThan(1.25);
	});
});
