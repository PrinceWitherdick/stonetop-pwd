import { describe, it, expect } from "vitest";
import { readRepo, readCss, declarations } from "../fakes/css.js";

// The two header glyphs added beside the Lightbearer's candle and the Judge's scales: the
// Blessed's triquetra and the Heavy's Battle Joy. How they LOOK is verified in a browser; these
// guard the ways they can break with no signal at all — the element still lays out, still hovers,
// still clicks, and nothing is logged. Direct siblings of holy-light-css.test.js, which documents
// each trap at length; the notes here say only which one is being watched for.

const read = readRepo;
const CSS = readCss();
const HEADER = readRepo("templates/actor/partials/actor-header.hbs");

/** Everything an exact selector declares, across every rule that names it (lists count). */
const block = (selector) => declarations(CSS, selector);

const GLYPHS = [
	{
		name: "the Blessed's marks",
		icon: ".stonetop-blessed-marks-icon",
		control: ".stonetop-blessed-marks",
		svg: "assets/icons/triquetra.svg",
		viewBox: /viewBox="19\.69 47\.43 472\.71 417\.13"/,
		ratio: /aspect-ratio:\s*472\.71\s*\/\s*417\.13/,
	},
	{
		name: "the Heavy's Battle Joy",
		icon: ".stonetop-battle-joy-icon",
		control: ".stonetop-battle-joy",
		svg: "assets/icons/enrage.svg",
		viewBox: /viewBox="19\.80 22\.28 475\.16 471\.71"/,
		ratio: /aspect-ratio:\s*475\.16\s*\/\s*471\.71/,
	},
];

describe.each(GLYPHS)("$name", ({ icon, control, svg, viewBox, ratio }) => {
	const SVG = read(svg);

	// game-icons.net ships its art white-on-an-opaque-black-plate. As a MASK, an opaque plate
	// passes 100% of its own box, so the header would paint a solid slab and say nothing.
	it("carries no opaque backing plate, which would mask as a solid slab", () => {
		expect(SVG).not.toMatch(/d="M0 0h512v512H0z"(?![^>]*fill-opacity="0")/);
	});

	// The canvas is cropped to the drawing and the element is sized by RATIO, so the glyph fills
	// its box at any size. A fixed width or height puts the letterboxing back.
	it("keeps the cropped canvas and sizes the box by that crop's ratio", () => {
		expect(SVG).toMatch(viewBox);
		const rule = block(icon);
		expect(rule, `${icon}'s rule is gone`).toBeTruthy();
		expect(rule).toMatch(ratio);
		expect(rule).toMatch(/width:\s*auto/);
	});

	// The seam sits on the BUTTON. On the masked span it would grow that span's padding box and
	// `mask-size: contain` would rescale the drawing to fit it, shrinking the glyph instead of
	// moving it over.
	it("keeps the gap off the masked element, which would rescale the drawing", () => {
		expect(block(control)).toMatch(/padding:\s*0 0 0 16px/);
		expect(block(icon)).not.toMatch(/padding/);
	});

	// A mask is applied AFTER filter and clips box-shadow and outline too, so all three are erased
	// on the element carrying it.
	it("keeps filters and shadows off the masked element, which would erase them", () => {
		const rule = block(icon);
		expect(rule).not.toMatch(/filter:/);
		expect(rule).not.toMatch(/box-shadow:/);
	});

	// Otherwise the viewBox and ratio above are measured against a file the header never loads.
	it("points its mask at the file this test measured", () => {
		expect(block(icon)).toContain(svg);
	});
});

describe("where they stand", () => {
	it("puts both beside the name plate, in the row the candle and scales share", () => {
		const row = HEADER.match(/<div class="stonetop-name-called-row">[\s\S]*?\n\t\t<\/div>/)?.[0];
		expect(row, "the name/glyph row is gone from the header template").toBeTruthy();
		for (const cls of ["stonetop-holy-light", "stonetop-condemn", "stonetop-blessed-marks", "stonetop-battle-joy"]) {
			expect(row, cls).toContain(cls);
		}
	});

	// `button.x:hover` carries an element on top of its class, so it out-specifies `.x.is-raging`
	// wherever the two meet — a raging glyph would go near-black under the pointer. The same trap
	// the candle's hover rule was written around.
	it("does not let hover overrule a raging Battle Joy's colour", () => {
		expect(CSS).toMatch(/button\.stonetop-battle-joy:not\(\.is-raging\):hover\s*\{/);
		expect(CSS).not.toMatch(/button\.stonetop-battle-joy:hover\s*\{/);
	});

	// Both "state is on" modifiers must be declared AFTER their base rule: an equal-specificity
	// modifier sitting earlier silently loses the tie.
	it.each([
		[".stonetop-battle-joy", ".stonetop-battle-joy.is-raging"],
		[".stonetop-blessed-marks", ".stonetop-blessed-marks.is-marking"],
	])("declares %s's on-state after its base rule", (base, modifier) => {
		const baseAt = CSS.indexOf(`\n${base},`) >= 0 ? CSS.indexOf(`\n${base},`) : CSS.indexOf(`\n${base} {`);
		const modAt = CSS.indexOf(`\n${modifier} {`);
		expect(baseAt, `${base} is gone`).toBeGreaterThan(-1);
		expect(modAt, `${modifier} is gone`).toBeGreaterThan(-1);
		expect(modAt).toBeGreaterThan(baseAt);
	});

	// The rage does not clear the boxes, it fades them: a cleared box would say the debility was
	// gone, and it bites again the moment the action stops. Ticking one mid-rage has to stay
	// possible, so the block must not be made unclickable.
	it("fades the debility boxes while raging rather than disabling them", () => {
		const rule = block(".stonetop-debilities.is-ignored");
		expect(rule, "the raging-debilities rule is gone").toBeTruthy();
		expect(rule).toMatch(/opacity:/);
		expect(rule).not.toMatch(/pointer-events/);
		expect(read("templates/actor/partials/stat-block.hbs"))
			.toContain("stonetop-debilities{{#if stonetop.battleJoy.raging}} is-ignored{{/if}}");
	});
});
