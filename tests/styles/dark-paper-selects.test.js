import { describe, expect, it } from "vitest";
import { readCss } from "../fakes/css.js";
import { contrastRatio, ratioText } from "../fakes/contrast.js";

/**
 * The option list on a black-paper window.
 *
 * A native dropdown is the one control on these windows that the browser does NOT draw inside
 * them. Chromium builds the open list as a popup outside the page, and it fills every row from
 * core's `--color-select-option-bg` (a #dad8cc parchment in the legacy palette) while the row
 * takes its INK by inheritance from the select. Every scope that paints black paper turns the
 * ink over to bone and, until this was written, left the fill alone: bone on parchment, 1.06:1,
 * which is a dropdown that opens onto a blank strip on a dead character's sheet.
 *
 * Nothing on the page can catch that. The popup is not in the DOM, so a rendered check sees a
 * perfectly readable closed control and a screenshot cannot reach the open one. What CAN be
 * checked is the pairing that decides it, which is what this file does: for every window scope
 * that turns itself dark, the option fill it sets and the ink it sets have to clear the bar
 * against each other.
 *
 * Scoped to WINDOWS on purpose. The fourth dark-paper scope is the death-drip chat card, which
 * renders prose and nothing else; a token added there would be paint for a control that is not
 * present. If a form control ever lands in one, this test's scan picks it up by its selector.
 */
const CSS = readCss();

/** Every rule that turns its own scope over to a dark colour scheme, as [selector, body]. */
const DARK = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
	.map(m => [m[1].trim(), m[2]])
	.filter(([, body]) => /(^|[;\s])color-scheme:\s*dark\s*;/.test(body));

/** Of those, the ones that dress a WINDOW, which is where a select can appear. */
const WINDOWS = DARK.filter(([selector]) => selector.includes(".window-content"));

// `String.raw`, and it is not decoration: in a plain template literal `\s` is not an escape
// sequence JavaScript knows, so it collapses to the letter `s` before the RegExp constructor ever
// sees it. The pattern becomes `…bgs*:s*(…)`, which still MATCHES today only because `s*` is happy
// with zero letters — so every assertion below passes for the wrong reason, and the day somebody
// writes a space before a colon in the stylesheet the guard fails instead of the code.
const value = (body, name) => body.match(new RegExp(String.raw`${name}\s*:\s*([^;]+);`))?.[1]?.trim();

describe("a dropdown opened from a black-paper window", () => {
	it("finds the dark scopes at all (guards every assertion below)", () => {
		// Three rules: the past-death sheet (and every dialog it raises), the two dark-mood death
		// dialogs, which share one rule, and the drip card, which is the one that is not a window.
		expect(DARK.length).toBeGreaterThanOrEqual(3);
		expect(WINDOWS.length).toBeGreaterThanOrEqual(2);
	});

	it("repaints the option list, which core fills from a parchment it cannot see", () => {
		for (const [selector, body] of WINDOWS) {
			expect(value(body, "--color-select-option-bg"),
				`${selector} turns its ink over without repainting the option list`).toBeTruthy();
		}
	});

	it("keeps that fill opaque: a popup has no paper behind it to show through", () => {
		for (const [selector, body] of WINDOWS) {
			const fill = value(body, "--color-select-option-bg");
			expect(fill, `${selector} fills the option list with a translucent colour`)
				.not.toMatch(/rgba|hsla|\/\s*0?\.\d/);
		}
	});

	it("clears AAA for the ink the select actually carries", () => {
		for (const [selector, body] of WINDOWS) {
			// `color: var(--color-text-dark-primary)` is what the form-well rule puts on a select
			// in these scopes, and an option inherits it.
			const ink = value(body, "--color-text-dark-primary");
			const fill = value(body, "--color-select-option-bg");
			expect(ink, `${selector} sets no ink for its form wells`).toBeTruthy();
			expect(contrastRatio(ink, fill),
				`${selector}: option ink ${ratioText(ink, fill)}`).toBeGreaterThanOrEqual(7);
		}
	});
});
