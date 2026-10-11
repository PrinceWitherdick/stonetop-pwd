// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { wrapStonetopGlyphsInEl } from "../../module/utils/glyphs.js";

// An arcanum consequence reads "<li>□ Lose 1d6 HP…": the □ IS that item's marker, so the spiral
// bullet must go (CSS keys on `--lead`). Only a run that opens the item counts; a glyph later in
// the line, or one written inside punctuation, is prose and keeps its spiral.
function render(html) {
	const root = document.createElement("div");
	root.innerHTML = html;
	wrapStonetopGlyphsInEl(root);
	return [...root.querySelectorAll("li")].map(li => !!li.querySelector(".stonetop-glyph-run--lead"));
}

describe("wrapStonetopGlyphsInEl: a glyph that opens its list item", () => {
	it("marks the run leading an item, past any whitespace before it", () => {
		expect(render("<ul><li>□ Lose 1d6 HP</li><li>\n\t○ mark one</li></ul>")).toEqual([true, true]);
	});

	it("leaves a glyph mid-line, or inside punctuation, unmarked", () => {
		expect(render("<ul><li>Carry a ◇ item</li><li>(□) a small item</li><li><strong>Name</strong> □</li></ul>"))
			.toEqual([false, false, false]);
	});

	// Rich-text markup: the paragraph that opens the item stands in for it.
	it("marks a run leading the paragraph that leads its item", () => {
		expect(render("<ul><li><p>□ Lose 1d6 HP</p></li><li><p>Intro</p><p>□ later</p></li></ul>"))
			.toEqual([true, false]);
	});

	it("is idempotent across a second walk", () => {
		const root = document.createElement("div");
		root.innerHTML = "<ul><li>□ Lose 1d6 HP</li></ul>";
		wrapStonetopGlyphsInEl(root);
		wrapStonetopGlyphsInEl(root);
		expect(root.querySelectorAll(".stonetop-glyph-run--lead")).toHaveLength(1);
		expect(root.querySelectorAll(".stonetop-glyph")).toHaveLength(1);
	});
});
