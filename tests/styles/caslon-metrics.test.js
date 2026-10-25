import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { declarations, declared, readCss } from "../fakes/css.js";

/**
 * Libre Caslon Text's line box, centred on its capitals in the font itself.
 *
 * The face ships ascent 970 / descent 260 (upm 1000) with an 'H' 781.25 tall, so a line box's middle
 * sat 0.036em above the middle of the capitals and every box that centres a line box (buttons, inputs,
 * icon rows) showed its words high. It was patched element by element with 0.048em lifts. The fix now
 * lives in every Libre Caslon Text @font-face: ascent-override / descent-override keep the sum (so no
 * `line-height: normal` box changes height) and make ascent - descent equal the H's height.
 *
 * Measured offline (core foundry2.css + stonetop.css, Chromium): a flex-centred `line-height: normal`
 * line across 10-24px went from 0.61px high on average to 0.03px; the native Dialog footer buttons from
 * up to 1.77px high to within 0.4px; no text-centring audit finding left at roots 12-24.
 */

const CSS = readCss();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The H's height in font units, as Chromium measures it (canvas actualBoundingBoxAscent at 1000px).
const H_HEIGHT = 781.25;

const caslonFaces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)]
	.map(m => m[1])
	.filter(body => /font-family:\s*"Libre Caslon Text"/.test(body));

/** hhea ascent, descent (positive) and unitsPerEm, read from the TTF itself. */
function vertical(file) {
	const b = fs.readFileSync(file);
	const tables = {};
	for (let i = 0; i < b.readUInt16BE(4); i++) {
		const o = 12 + i * 16;
		tables[b.toString("latin1", o, o + 4)] = b.readUInt32BE(o + 8);
	}
	return { upm: b.readUInt16BE(tables.head + 18), ascent: b.readInt16BE(tables.hhea + 4), descent: -b.readInt16BE(tables.hhea + 6) };
}

const percent = (body, prop) => parseFloat(declared(body, prop));

describe("the Libre Caslon Text @font-face rules", () => {
	it("are all found (regular, bold, italic and the two upright-bracket italics)", () => {
		expect(caslonFaces).toHaveLength(5);
	});

	it.each(caslonFaces.map((body, i) => [i, body]))("face %i centres its line box on its capitals", (_, body) => {
		const file = body.match(/url\("\.\.\/([^"]+)"\)/)[1];
		const { upm, ascent, descent } = vertical(path.join(ROOT, file));
		const a = percent(body, "ascent-override");
		const d = percent(body, "descent-override");
		// Same total height as the file's own metrics, so line-height: normal boxes keep their size.
		expect(a + d).toBeCloseTo(((ascent + descent) / upm) * 100, 6);
		// Ascent minus descent is the capital H, so the line box's middle is the capitals' middle.
		expect(a - d).toBeCloseTo((H_HEIGHT / upm) * 100, 6);
	});
});

describe("what used to compensate for the old metrics", () => {
	it("no longer lifts the Welcome create label or the relationship map's tool labels by hand", () => {
		expect(CSS).not.toContain("--st-relmap-ink-lift");
		expect(declared(declarations(CSS, ".stonetop-welcome-create-label"), "top")).toBeNull();
	});

	it("leaves the roll-mode radio level with its label, and core's 2px drop zeroed", () => {
		expect(declared(declarations(CSS, ".stonetop-roll-mode-option input"), "top")).toBe("0");
	});

	it("gives the native Dialog footer labels no leading for Blink to floor", () => {
		// A bare text node in a flex button cannot be trimmed; with no leading its line box is the
		// font's own, which the @font-face centres. A number here left labels up to 1px high.
		expect(declared(declarations(CSS, ".vtt .stonetop.dialog .dialog-buttons button"), "line-height")).toBe("normal");
	});
});
