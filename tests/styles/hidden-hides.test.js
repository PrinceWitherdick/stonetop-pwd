import { describe, it, expect } from "vitest";
import { HIDDEN_HIDES, readCss, splitSelectorList } from "../fakes/css.js";

// The UA's `[hidden] { display: none }` loses to ANY author `display`, whatever its specificity, so a
// flex or grid element that JS hides by the attribute stays on screen. That shipped broken one class
// at a time until the stylesheet carried some seventy re-hides of its own. Now one rule near the top
// does it for anything wearing a `stonetop-` class: `!important` so no `display` rule beats it, and
// `:where()` so it weighs no more than `[hidden]` itself. Nothing out-weighs it on purpose any more:
// an element that keeps its space while out of use wears a state class instead (the third case).

const CSS = readCss();
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, prelude, body]) => ({
	selectors: splitSelectorList(prelude),
	body: body.trim(),
}));

describe("the hidden attribute on our elements", () => {
	it("is made to hide by one rule, before any component's", () => {
		const at = CSS.indexOf(HIDDEN_HIDES);
		expect(at, "the stylesheet's `hidden` rule is gone or reworded").toBeGreaterThan(-1);
		expect(at, "it should sit with the base rules near the top").toBeLessThan(CSS.length / 20);
	});

	it("is not re-hidden class by class for an element the rule already covers", () => {
		// A re-hide is `.x[hidden] { display: none }` where `.x` is the element's own stonetop- class.
		// The rule above already does it, so a new one is noise that implies the global rule is absent.
		const redundant = RULES
			.filter(r => /^display:\s*none;?$/.test(r.body))
			.flatMap(r => r.selectors)
			.filter(sel => /\.stonetop-[\w-]+\)?\[hidden\]$/.test(sel));
		expect(redundant).toEqual([]);
	});

	// `hidden` means gone. The timeline's colour reset used to keep its space while hidden by
	// out-weighing the rule above with a class-named `display: inline-flex !important`, the one
	// place the attribute meant something else. It wears `.is-idle` now, and nothing may answer a
	// `[hidden]` with a `display` again: an element that has to keep its space is out of use, not
	// hidden, and says so with a state class.
	it("is never out-weighed: no `[hidden]` rule shows what the attribute hides", () => {
		const named = RULES.flatMap(r => r.selectors).filter(sel => /\[hidden\]/.test(sel));
		expect(named.length, "the scan found no `[hidden]` rule at all").toBeGreaterThan(3);
		const shown = RULES
			.filter(r => /(?:^|;)\s*display:(?!\s*none\b)[^;]+/.test(r.body))
			.flatMap(r => r.selectors)
			.filter(sel => /\[hidden\]/.test(sel.replace(/:not\([^()]*\[hidden\][^()]*\)/g, "")));
		expect(shown).toEqual([]);
	});

	it("keeps the timeline colour reset's space while idle with a state class, not the attribute", () => {
		const rule = RULES.find(r => r.selectors.includes(".stonetop-timeline-colours-reset.is-idle"));
		expect(rule, "the idle reset's rule is gone or renamed").toBeTruthy();
		expect(rule.body).toMatch(/^visibility:\s*hidden;?$/);
	});
});
