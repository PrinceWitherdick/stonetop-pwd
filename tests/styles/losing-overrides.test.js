import { describe, expect, it } from "vitest";
import { declarations, readCss, splitSelectorList } from "../fakes/css.js";

/**
 * Overrides that are outranked by the rule they were written to beat.
 *
 * The failure mode is always the same and always silent: the stylesheet READS as though the
 * override were in force, nothing is logged, the element renders — it just renders in the other
 * rule's colour. `tests/styles/dialog-button-specificity.test.js` makes the same argument for one
 * family (a per-dialog footer button rule under the shared `.stonetop.dialog` one) and does it with
 * a scan. This file is the two cases that are not about dialog footers, each pinned by name,
 * because both were shipped broken and neither is derivable from a pattern:
 *
 *   - A bare `.x-remove:hover` under a `.x-btns button:hover` that carries an element and therefore
 *     outranks it. The red never lands and the trash icon greys like its neighbours.
 *   - An author `display` on a panel that JS hides with the `hidden` ATTRIBUTE. Author beats UA
 *     whatever the specificity, so `[hidden]` does nothing until the sheet says so itself.
 */

const CSS = readCss();

/** CSS specificity as [ids, classes, elements]. Same reading as dialog-button-specificity.js. */
function specificity(selector) {
	const ids = (selector.match(/#[\w-]+/g) || []).length;
	const classes = (selector.match(/\.[\w-]+/g) || []).length
		+ (selector.match(/\[[^\]]*\]/g) || []).length
		+ (selector.match(/(?<!:):(?!:)[\w-]+/g) || []).length;
	const elements = (selector
		.replace(/[.#][\w-]+/g, "")
		.replace(/\[[^\]]*\]/g, "")
		.replace(/::?[\w-]+/g, "")
		.match(/\b[a-zA-Z][\w-]*/g) || []).length;
	return [ids, classes, elements];
}

const beats = (a, b) => (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0;

/** Every rule in the stylesheet, one entry per comma-separated selector, in source order. */
const RULES = [];
for (const [, prelude, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
	const props = [...body.matchAll(/(^|[;\s])([-\w]+)\s*:/g)].map(m => m[2]);
	for (const selector of splitSelectorList(prelude)) RULES.push({ selector, props, spec: specificity(selector) });
}

/**
 * The rules that declare `prop` and would apply to an element carrying exactly the classes in `on`.
 *
 * At least ONE class has to match, not merely "no class that doesn't". Without that floor a
 * selector naming no class at all — `#stonetop-map-pin-names`, say — satisfies the `every` test
 * vacuously and is reported as a rival of a panel it has never touched.
 */
function rivalsFor(prop, on) {
	return RULES.filter(r => {
		if (!r.props.includes(prop)) return false;
		const classes = [...r.selector.matchAll(/\.[\w-]+/g)].map(m => m[0].slice(1));
		return classes.length > 0 && classes.every(c => on.includes(c));
	});
}

describe("the improvement builder's remove buttons keep their red", () => {
	// Both remove buttons sit inside the -btns span that carries the shared bare-glyph look, so
	// `… -btns button:hover` (0,2,1) applies to them as well and used to beat a bare
	// `.…-remove:hover` (0,2,0). The group's had worked for months and was broken by the pass that
	// merged the row's button chrome with the group's; the row's had never worked at all.
	const CASES = [
		["stonetop-improvement-builder-req-btns", "stonetop-improvement-builder-req-remove"],
		["stonetop-improvement-builder-group-btns", "stonetop-improvement-builder-group-remove"],
	];

	it.each(CASES)("%s: the red beats the shared hover it sits under", (btns, remove) => {
		const on = [btns, remove];
		const reds = rivalsFor("color", on).filter(r => /:hover/.test(r.selector) && r.selector.includes(remove));
		expect(reds.length, `no :hover colour rule found for .${remove}`).toBeGreaterThan(0);

		// Every OTHER hover rule that would paint this same element. The shared one is the rival
		// that matters, but naming it here would let a third rule slip in above it unnoticed.
		const others = rivalsFor("color", on).filter(r => /:hover/.test(r.selector) && !r.selector.includes(remove));
		expect(others.length, "the shared -btns button:hover rule is gone or renamed").toBeGreaterThan(0);

		const dead = others.filter(o => reds.every(red => beats(o.spec, red.spec)));
		expect(dead.map(o => o.selector), "these out-specify the remove button's red").toEqual([]);
	});

	it("paints the two removes red and their neighbours not", () => {
		for (const [, remove] of CASES) {
			const red = RULES.find(r => r.selector.includes(remove) && /:hover/.test(r.selector));
			expect(CSS.slice(CSS.indexOf(red.selector)), `.${remove} lost its red`).toMatch(/--st-red-text/);
		}
	});
});

describe("a panel hidden by the attribute is actually hidden", () => {
	// `_toggleEmpty` sets `panel.hidden`. The UA's `[hidden] { display: none }` loses to ANY author
	// `display` whatever the specificity, so without a rule of our own the empty panel goes on
	// covering a board that now has people on it. The stylesheet already says this out loud in four
	// other places; this is the one that did not.
	const PANEL = "stonetop-relmap-empty";

	it("declares a display the attribute would have to beat (guards the assertion below)", () => {
		expect(declarations(CSS, `.${PANEL}`), "the empty panel's rule is gone or renamed").toMatch(/display:/);
	});

	it("says [hidden] outright rather than leaving it to the UA sheet", () => {
		const rule = RULES.find(r => r.selector === `.${PANEL}[hidden]`);
		expect(rule, `.${PANEL}[hidden] is missing; the panel will not hide`).toBeTruthy();
		expect(rule.props).toContain("display");

		const shown = rivalsFor("display", [PANEL]).filter(r => !r.selector.includes("[hidden]"));
		const dead = shown.filter(r => beats(r.spec, rule.spec));
		expect(dead.map(r => r.selector), "these out-specify the [hidden] rule").toEqual([]);
	});
});
