import { describe, expect, it } from "vitest";
import Handlebars from "handlebars";
import { readRepo } from "../../fakes/css.js";

// The header's two held-promise glyphs (a held advantage, a held disadvantage) are one inline
// partial in actor-header.hbs, called once for each. Rendered off the shipping template: the slice
// from the partial's definition to its second call.

const HEADER = readRepo("templates/actor/partials/actor-header.hbs");
const FROM = '{{#*inline "stonetopHeldGlyph"}}';
const TO = '{{> stonetopHeldGlyph held=stonetop.heldDisadvantage stem="stonetop-held-disadvantage"}}';
const glyphs = Handlebars.compile(HEADER.slice(HEADER.indexOf(FROM), HEADER.indexOf(TO) + TO.length));

const held = (label, tooltip) => ({ show: true, label, tooltip });
const hidden = { show: false, label: "", tooltip: "" };

describe("the held-promise glyphs", () => {
	it("draws a release button for each promise held, on an editable sheet", () => {
		const html = glyphs({
			editable: true,
			stonetop: {
				heldAdvantage: held("Advantage held", "Wren's Aid"),
				heldDisadvantage: held("Disadvantage held", "Interfered with by Bram"),
			},
		});
		expect(html).toContain(`<button type="button" class="stonetop-held-advantage"`);
		expect(html).toContain(`<span class="stonetop-held-advantage-icon" aria-hidden="true"></span></button>`);
		expect(html).toContain(`<button type="button" class="stonetop-held-disadvantage"`);
		expect(html).toContain(`data-tooltip="Interfered with by Bram"`);
		expect(html).not.toContain(`role="img"`);
	});

	it("draws a readout, not a button, where the sheet is not editable", () => {
		const html = glyphs({ editable: false, stonetop: { heldAdvantage: held("Advantage held", "Wren's Aid"), heldDisadvantage: hidden } });
		expect(html).toContain(`<span class="stonetop-held-advantage" role="img"`);
		expect(html).toContain(`aria-label="Advantage held"`);
		expect(html).not.toContain("<button");
	});

	it("draws only what is held", () => {
		const html = glyphs({ editable: true, stonetop: { heldAdvantage: hidden, heldDisadvantage: held("Disadvantage held", "x") } });
		expect(html).not.toContain("stonetop-held-advantage");
		expect(html).toContain("stonetop-held-disadvantage");
		expect(glyphs({ editable: true, stonetop: { heldAdvantage: hidden, heldDisadvantage: hidden } }).trim()).toBe("");
	});
});
