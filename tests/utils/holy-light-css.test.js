import { describe, it, expect } from "vitest";
import { readRepo, readCss, declarations } from "../fakes/css.js";

// The Lightbearer's header candle. How it LOOKS is verified in a browser; these three guard
// the ways it can break with no signal at all — the element still lays out, still hovers,
// still clicks, and nothing is logged.

const read = readRepo;

const CSS = readCss();
const SVG = read("assets/icons/candle-light.svg");
const HEADER = read("templates/actor/partials/actor-header.hbs");

/** Everything an exact selector declares, across every rule that names it — see fakes/css.js. */
const block = (selector) => declarations(CSS, selector);

describe("the holy-light candle", () => {
	// game-icons.net ships its art as white-on-an-opaque-black-plate. As a MASK, an opaque
	// plate passes 100% of its own box — so the header would render a solid slab where the
	// candle should be, and nothing anywhere would say why.
	it("carries no opaque backing plate, which would mask as a solid slab", () => {
		expect(SVG).not.toMatch(/d="M0 0h512v512H0z"(?![^>]*fill-opacity="0")/);
	});

	// The canvas is cropped to the drawing, and the element is sized by RATIO rather than by
	// two lengths — so the candle fills its box at any size. Put a fixed width or height back
	// and it letterboxes inside its own box again, which is what the crop was for.
	it("keeps the cropped canvas and sizes the box by that crop's ratio", () => {
		expect(SVG).toMatch(/viewBox="155\.43 23\.56 214\.32 464\.56"/);
		const icon = block(".stonetop-holy-light-icon");
		expect(icon, "the icon's rule is gone").toBeTruthy();
		expect(icon).toMatch(/aspect-ratio:\s*214\.32\s*\/\s*464\.56/);
		expect(icon).toMatch(/width:\s*auto/);
	});

	// The gap before the candle has to sit on the BUTTON. On the masked span it would grow
	// that span's padding box, and `mask-size: contain` would rescale the drawing to fit it —
	// shrinking the candle instead of moving it over, which looks like a sizing bug.
	it("keeps the gap off the masked element, which would rescale the drawing", () => {
		expect(block(".stonetop-holy-light")).toMatch(/padding:\s*0 0 0 16px/);
		expect(block(".stonetop-holy-light-icon")).not.toMatch(/padding/);
	});

	// The plate's own `margin-top: auto` has to be off inside the row, or it cancels the
	// stretch and drops the plate to the row's bottom edge instead of the column's.
	it("keeps the name plate pinned by the row rather than by itself", () => {
		const row = block(".stonetop-name-called-row");
		expect(row, "the name/candle row is gone").toBeTruthy();
		expect(row).toMatch(/align-items:\s*stretch/);
		expect(row).toMatch(/margin-top:\s*auto/);
		expect(block(".stonetop-name-called-row > .stonetop-name-called-box")).toMatch(/margin-top:\s*0/);
	});

	it("stands the candle beside the name plate, inside that row", () => {
		const row = HEADER.match(/<div class="stonetop-name-called-row">[\s\S]*?\n\t\t<\/div>/)?.[0];
		expect(row, "the name/candle row is gone from the header template").toBeTruthy();
		expect(row).toContain("stonetop-name-called-box");
		expect(row).toContain("stonetop-holy-light");
		// ...and it did NOT get left behind on the appearance line as well.
		const line = HEADER.match(/<p class="stonetop-appearance-summary">[\s\S]*?<\/p>/)?.[0];
		expect(line).not.toContain("stonetop-holy-light");
	});

	// `button.x:hover` carries an element on top of its class, so it out-specifies `.x.is-lit`
	// wherever the two meet — a burning candle would go near-black under the pointer, inside
	// its own gold halo. Specificity bugs like this are invisible in review and in every test
	// that does not render, so the guard is on the selector itself.
	it("does not let hover overrule a lit candle's colour", () => {
		expect(CSS).toMatch(/button\.stonetop-holy-light:not\(\.is-lit\):hover\s*\{/);
		expect(CSS).not.toMatch(/button\.stonetop-holy-light:hover\s*\{/);
	});

	// A mask is applied AFTER filter and clips box-shadow and outline too, so all three are
	// erased on the element that carries it. The lit glow therefore lives on the button.
	it("keeps the glow off the masked element, which would erase it", () => {
		const icon = block(".stonetop-holy-light-icon");
		expect(icon, "the icon's rule is gone").toBeTruthy();
		expect(icon).not.toMatch(/filter:/);
		expect(icon).not.toMatch(/box-shadow:/);
		expect(icon).not.toMatch(/outline:/);
		// ...and it is on the button instead, or nothing ever looks lit.
		expect(block(".stonetop-holy-light.is-lit")).toMatch(/filter:\s*drop-shadow/);
	});
});
