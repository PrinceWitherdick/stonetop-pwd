import { describe, expect, it } from "vitest";
import Handlebars from "handlebars";
import { readRepo } from "../fakes/css.js";

// The Disadvantage / Normal / Advantage pill (roll-mode-strip.hbs), rendered off the shipping
// partial: once inside the steading's section-heading picker, once as the expedition walkthrough
// draws it over the Die of Fate, whose hovers name its own dice.

const EN = JSON.parse(readRepo("languages/en.json"));
const lookup = key => String(key).split(".").reduce((node, part) => node?.[part], EN) ?? key;

function hbs() {
	const env = Handlebars.create();
	// Foundry's own helpers, the ones the partial leans on.
	env.registerHelper("localize", key => lookup(key));
	env.registerHelper("eq", (a, b) => a === b);
	env.registerHelper("concat", (...parts) => parts.slice(0, -1).join(""));
	env.registerPartial("stonetop.roll-mode-strip", readRepo("templates/actor/partials/roll-mode-strip.hbs"));
	return env;
}

describe("the roll-mode strip", () => {
	it("presses the mode it is given, worst to best, and says what each rolls", () => {
		const html = hbs().compile(readRepo("templates/actor/partials/roll-mode-picker.hbs"))({ rollMode: "adv" });
		expect([...html.matchAll(/data-roll-mode="(\w+)"/g)].map(m => m[1])).toEqual(["dis", "normal", "adv"]);
		expect(html).toMatch(/is-active"\s+data-roll-mode="adv"\s+aria-pressed="true"/);
		expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
		expect(html).toContain(`aria-label="${Handlebars.escapeExpression(EN.stonetop.rollMode.label)}"`);
		expect(html).toContain(`data-tooltip="${Handlebars.escapeExpression(EN.stonetop.rollMode.advTooltip)}"`);
		// Still in its section heading, so folding the section folds the pill.
		expect(html).toContain("stonetop-roll-mode-bar stonetop-section-heading-control");
	});

	it("names the Die of Fate's own dice when the walkthrough draws it", () => {
		const call = '{{> "stonetop.roll-mode-strip" rollMode=fateMode labelKey="stonetop.rollMode.pickerLabel" tipKey="stonetop.expedition.fateMode"}}';
		expect(readRepo("templates/dialogs/expedition.hbs")).toContain(call);
		const html = hbs().compile(call)({ fateMode: "normal" });
		expect(html).toContain(`data-tooltip="Roll 2d6 and keep the higher"`);
		expect(html).toContain(`data-tooltip="Roll 1d6"`);
		expect(html).toContain(`aria-label="${Handlebars.escapeExpression(EN.stonetop.rollMode.pickerLabel)}"`);
		expect(html).not.toContain("3d6");
	});
});
