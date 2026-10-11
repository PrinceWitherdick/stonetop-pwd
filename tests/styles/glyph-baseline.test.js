import { describe, it, expect } from "vitest";
import { readCss, declarations, declared, splitSelectorList } from "../fakes/css.js";

/**
 * The ◇/◆/□/■/▶ glyph boxes (wrapStonetopGlyphsInEl) are placed by their BOTTOM edge: the base rule's
 * `vertical-align: -0.125em` centres a 0.95em box on the cap band. That holds only while the bottom
 * edge IS the box's baseline, which takes `overflow: hidden`. Without it the hidden character inside
 * gives the inline-block a text baseline of its own, set by whichever fallback symbol font drew it:
 * measured with the system's fonts, sheet prose drew them 2.1-2.7px low at UI sizes 14-20px, and the
 * journal's □/▶ 1.9-3.5px below its masked ◇. It was patched for one dialog at a time (the Outfit
 * window's own rule) before it was fixed here, once.
 */
const CSS = readCss();
const BASE = [
	".stonetop-glyph--diamond",
	".stonetop-glyph--diamond-selected",
	".stonetop-glyph--arrow",
	".stonetop-glyph--checkbox",
	".stonetop-glyph--checkbox-checked",
];

describe("the glyph boxes' baseline", () => {
	it("is the box's bottom edge on every glyph, so the base rule's placement is the one drawn", () => {
		for (const sel of BASE) {
			const d = declarations(CSS, sel);
			expect(d, sel).toMatch(/vertical-align:\s*-0\.125em/);
			expect(d, sel).toMatch(/overflow:\s*hidden/);
		}
	});

	it("is not patched again per surface", () => {
		// Any rule but the base one that names a box glyph and sets `overflow` is the old
		// one-dialog-at-a-time patch coming back (or undoing the base rule somewhere). The
		// currentColor-mask recipe is exempt: it sets `overflow` to clip the character its
		// `text-indent` shoves out of the box, a different job that happens to need the same line.
		const BOX = /\.stonetop-glyph--(?:diamond|diamond-selected|arrow|checkbox|checkbox-checked)\b/;
		const patches = [];
		for (const [, prelude, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			const sels = splitSelectorList(prelude);
			if (!sels.some(s => BOX.test(s)) || declared(body, "overflow") === null) continue;
			if (sels.length === BASE.length && BASE.every(b => sels.includes(b))) continue;
			if (declared(body, "text-indent") !== null) continue;
			patches.push(sels.join(", "));
		}
		expect(patches).toEqual([]);
	});

	it("puts the Possessions tab's px load boxes on the same cap band at every UI font size", () => {
		// Those boxes are 14px while their font is rem, so a fixed em offset (the old -0.04em)
		// is right at one root size only. The base rule's centring, worked from the px box.
		const d = declarations(CSS, ".tab-section--possessions [data-glyphs-wrapped] .stonetop-glyph--diamond");
		expect(declared(d, "height")).toBe("calc(14px * var(--stonetop-font-scale, 1))");
		expect(declared(d, "vertical-align")).toBe("calc(0.35em - 7px * var(--stonetop-font-scale, 1))");
	});
});
