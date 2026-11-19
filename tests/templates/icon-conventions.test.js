import { describe, expect, it } from "vitest";
import { templateSources } from "../fakes/hbs.js";

// HOW AN ICON IS WRITTEN IN A TEMPLATE (STYLEGUIDE.md, "Icons and glyphs").
//
// Three habits had drifted apart across 150 templates, and each is invisible in a browser, where
// both spellings draw the same glyph:
//
//   · the style class: `fas` in 813 places and `fa-solid` in 35. One spelling, so a search for an
//     icon finds all of them.
//   · the name: a handful of Font Awesome 5 aliases (`fa-times`, `fa-edit`, `fa-save`, `fa-undo`…)
//     beside their v6 names, and EDIT drawn as a pencil on the hover pencils but as a pen on some
//     two dozen other controls. One glyph per meaning; edit is `fa-pencil`.
//   · `aria-hidden`: on a third of them. A decorative `<i>` with no words in it is announced by
//     some screen readers as a private-use character, and one reader at this table uses one.
//
// Markup built in JS is not read here. It follows the same rules, and nothing yet holds it to them.

const TEMPLATES = templateSources();
const where = (re, source) => [...source.matchAll(re)].map(m => source.slice(0, m.index).split("\n").length);
const offenders = re => TEMPLATES.flatMap(({ rel, source }) => where(re, source).map(line => `${rel}:${line}`));

describe("an icon in a template", () => {
	it("found the templates (guards every check below)", () => {
		expect(TEMPLATES.length).toBeGreaterThan(100);
		expect(offenders(/<i class="fas /g).length).toBeGreaterThan(500);
	});

	it("is written `fas`, never `fa-solid`", () => {
		expect(offenders(/<i\s+class="fa-solid /g)).toEqual([]);
	});

	it("uses the current name for its glyph, and the pencil for edit", () => {
		const OLD = /fa-(?:times|times-circle|edit|pen|pen-to-square|save|undo|info-circle|question-circle|exclamation-triangle|check-circle|dice-d20)(?![-\w])/g;
		expect(offenders(OLD)).toEqual([]);
	});

	// Only the bare form: an `<i>` that carries a tooltip, a title or a label of its own is saying
	// something, and hiding it would take that away.
	it("is hidden from a screen reader when it carries nothing but its class", () => {
		expect(offenders(/<i class="(?:fas|far|fab) [^"<>]*"><\/i>/g)).toEqual([]);
	});
});
