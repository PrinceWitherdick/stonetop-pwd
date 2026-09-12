import { describe, expect, it } from "vitest";
import { beats, declarations, readCss, readRepo, specificity, splitSelectorList, stripComments } from "../fakes/css.js";

/**
 * The Armor field on the character sheet wears the same number box as the vitals beside it.
 *
 * The vitals number skin is written as a DIRECT-CHILD rule,
 * `.sheet-attributes-top .cell--Number .stonetop-vital-inner > input`, and that shape is
 * deliberate: the monster and NPC stat bars put a second, non-numeric input (the armor source)
 * under the same wrapper, and it is restated with the same shape so it can beat the skin.
 *
 * Armor on the character sheet then grew a wrapper. Its hover note cannot live on the field
 * itself, because outside edit mode the input is `disabled` and a disabled control fires no
 * pointer events, so the tooltip would never open — the same reason Max HP hangs its note on
 * `.cell__max`. The wrapper broke the `>` and the skin silently stopped reaching the field: it
 * fell back to core's input chrome (a grey fill where the others are transparent), lost
 * `text-align: center` and `width: 100%`, and lost the `margin-top: 4px` that puts it level with
 * its neighbours, so it sat high and dark in a row of matching boxes. Nothing was logged, and
 * every other cell looked right.
 *
 * Neither half of the pairing is derivable from the other, so both are pinned here: the template
 * must keep the wrapper (the note depends on it), and every rule written for the direct-child
 * shape must name the wrapper alongside it.
 */

const CSS = readCss();
const VITALS = stripComments(readRepo("templates/actor/partials/actor-vitals.hbs"));

const SKIN = ".sheet-attributes-top .cell--Number .cell__number > input";
const WRAPPER = ".sheet-attributes-top .cell--Number .cell__number";

/** Every rule in the sheet, as its split selector list. */
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
	.map(([, prelude, body]) => ({ selectors: splitSelectorList(prelude), body }));

/** The bare direct-child form of the number skin, with any trailing pseudo-class captured. */
const BARE = /^\.sheet-attributes-top \.cell--Number \.stonetop-vital-inner > input(:[\w-]+)?$/;

describe("the armor input is wrapped, and the wrapper carries the note", () => {
	const armorCell = VITALS.slice(VITALS.indexOf("cell--attr-armor"));
	const wrapper = armorCell.indexOf('class="cell__number"');
	const input = armorCell.indexOf("data-armor");
	const closed = armorCell.indexOf("</span>");

	it("wraps the field in a span the tooltip can hang off", () => {
		expect(wrapper).toBeGreaterThan(-1);
		expect(wrapper).toBeLessThan(input);
		expect(input).toBeLessThan(closed);
	});

	it("puts the note on the wrapper, not on the disabled input", () => {
		const openTag = armorCell.slice(wrapper, armorCell.indexOf(">", wrapper));
		expect(openTag).toContain("armorNote");
	});
});

describe("every rule written for the direct-child skin names the wrapper too", () => {
	const shaped = RULES.filter(r => r.selectors.some(s => BARE.test(s)));

	it("finds the rules that skin the vitals number box", () => {
		// The skin, the margin that sets it below the title, and the hover/focus affordance.
		expect(shaped.length).toBe(3);
	});

	for (const rule of shaped) {
		for (const selector of rule.selectors.filter(s => BARE.test(s))) {
			const pseudo = BARE.exec(selector)[1] || "";
			it(`${selector} is paired with the wrapped armor field`, () => {
				const wanted = pseudo ? [SKIN + pseudo] : [SKIN, WRAPPER];
				expect(rule.selectors.some(s => wanted.includes(s))).toBe(true);
			});
		}
	}
});

describe("the wrapped field reads as the box its neighbours wear", () => {
	it("is transparent, centred and full width", () => {
		const skin = declarations(CSS, SKIN);
		expect(skin).toBeTruthy();
		expect(skin).toMatch(/background:\s*transparent/);
		expect(skin).toMatch(/text-align:\s*center/);
		expect(skin).toMatch(/width:\s*100%/);
		expect(skin).toMatch(/border:\s*1px solid/);
	});

	it("lays the wrapper out as the bare input did, so the field keeps its width and its line", () => {
		const wrapper = declarations(CSS, WRAPPER);
		expect(wrapper).toBeTruthy();
		expect(wrapper).toMatch(/display:\s*block/);
		expect(wrapper).toMatch(/width:\s*100%/);
		expect(wrapper).toMatch(/margin-top:\s*4px/);
	});
});

describe("a hand-set adjustment still shows its dashed rule", () => {
	// The skin sets the whole `border` shorthand and sits later in the sheet, so the dashed
	// override has to outrank it. Both halves of the shared rule are checked, because the pair is
	// written as one selector list precisely so the two cannot drift apart.
	const pairs = [
		[
			".sheet-attributes-top .cell--attr-armor .cell__number > input.stonetop-armor--adjusted",
			SKIN,
		],
		[
			".sheet-attributes-top .cell--Resource .cell__resource input.stonetop-hp-max--adjusted",
			".sheet-attributes-top .cell--Resource .cell__resource input",
		],
	];

	for (const [adjusted, base] of pairs) {
		it(`${adjusted} outranks its base skin`, () => {
			expect(declarations(CSS, adjusted)).toMatch(/border-style:\s*dashed/);
			expect(beats(specificity(adjusted), specificity(base))).toBe(true);
		});
	}
});
