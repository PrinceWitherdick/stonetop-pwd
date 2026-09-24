import { describe, expect, it } from "vitest";
import { declarations, readCss, readRepo, stripComments } from "../fakes/css.js";

/**
 * CALL FOR STRUGGLE AS ONE WEARS THE SYSTEM'S SKINS (templates/dialogs/struggle-setup.hbs).
 *
 * It first shipped in core's grey fields, with a checkbox drawn inside every stat pill: two controls
 * for one choice. Nothing logs either, so they are pinned here.
 */

const CSS = readCss();
const TEMPLATE = stripComments(readRepo("templates/dialogs/struggle-setup.hbs"));
const checkboxes = [...TEMPLATE.matchAll(/<input type="checkbox"[^>]*>/g)].map(m => m[0]);

describe("the struggle setup's controls", () => {
	it("draws every tick box with the shared skin, and every stat as a chip whose box is not drawn", () => {
		expect(checkboxes.length).toBeGreaterThan(0);
		for (const box of checkboxes) {
			if (box.includes('data-field="stat"')) expect(box).toContain('class="stonetop-struggle-chip-input"');
			else expect(box).toContain('class="stonetop-check"');
		}
		const hidden = declarations(CSS, ".stonetop-struggle-chip > input");
		expect(hidden).toMatch(/opacity:\s*0/);
		expect(hidden).toMatch(/position:\s*absolute/);
		expect(declarations(CSS, ".stonetop-struggle-chip:has(input:checked)")).toMatch(/var\(--st-green-bg\)/);
		expect(declarations(CSS, ".stonetop-struggle-chip:has(input:focus-visible)")).toMatch(/outline:/);
	});

	it("puts every field in the system's well, with core's inset ring put out", () => {
		const well = declarations(CSS, '.stonetop-struggle-window :is(input[type="text"], select, textarea)');
		expect(well).toMatch(/background:\s*rgba\(255, 255, 255, 0\.7\)/);
		expect(well).toMatch(/border:\s*1px solid #999/);
		expect(well).toMatch(/box-shadow:\s*none/);
	});

	it("lines each label up beside its field", () => {
		expect(declarations(CSS, ".stonetop-struggle-fields")).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\)/);
		expect(declarations(CSS, ".stonetop-struggle-fields > label")).toMatch(/display:\s*contents/);
		expect(TEMPLATE).toMatch(/<select class="stonetop-struggle-aid"[^>]*data-field="aidPick"/);
		expect(declarations(CSS, ".stonetop-struggle-fields select.stonetop-struggle-aid")).toMatch(/width:\s*100%/);
		expect(TEMPLATE).toMatch(/<select class="stonetop-struggle-bonus" aria-label="Rolls"/);
	});
});
