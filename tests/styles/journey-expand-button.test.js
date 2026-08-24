import { describe, it, expect } from "vitest";
import { readCss, readRepo, stripComments, declarations, ownRule } from "../fakes/css.js";

/**
 * The route step's expand button: "see the whole map", worn in the corner of the map itself.
 *
 * It used to be a pill on a line of its own under the picture, where it was simply always there
 * and could not go wrong. Over the picture it can, in two ways that a browser reports as nothing
 * at all:
 *
 * WHERE IT SITS. The map box is what the drawing and place-a-site gestures listen on
 * (ExpeditionDialog `_armPanelDrawing`, `_placeSiteFromPanel`), so a button moved INSIDE it would
 * still open the window — and would also lay a route mark, or drop a site, at the spot it was
 * pressed. Hence the wrapper: the button is the map's sibling and only looks like its child.
 *
 * WHETHER IT IS THERE TO BE PRESSED. A control that fades in on hover has to take its clicks with
 * it when it fades out, because it covers a corner of a map where clicking is how a destination
 * gets chosen — an invisible button at `opacity: 0` would eat those clicks and look like a dead
 * spot on the map.
 */

const TEMPLATE = "templates/dialogs/partials/expedition-journey.hbs";
const CSS = readCss();
const HBS = stripComments(readRepo(TEMPLATE));

/**
 * The markup inside the first `<div>` carrying `cls`, its own closing tag excluded.
 *
 * Counted rather than matched: these boxes nest (the wrapper holds the map box, which holds the
 * pin layer), so the first `</div>` after the opening tag is the wrong one every time.
 */
function insideDiv(html, cls) {
	const at = html.indexOf(`<div class="${cls}`);
	if (at < 0) return null;
	let depth = 0;
	for (const m of html.slice(at).matchAll(/<div\b|<\/div>/g)) {
		depth += m[0] === "</div>" ? -1 : 1;
		if (depth === 0) return html.slice(at, at + m.index);
	}
	return null;
}

describe("the route step's expand button", () => {
	it("is rendered once, in the wrapper, and NOT inside the map box the gestures listen on", () => {
		expect(HBS.match(/class="stonetop-journey-zoom"/g)).toHaveLength(1);

		const wrap = insideDiv(HBS, "stonetop-journey-mapwrap");
		expect(wrap).toContain("stonetop-journey-zoom");
		expect(wrap).toContain("stonetop-journey-map stonetop-journey-canvas");

		const map = insideDiv(HBS, "stonetop-journey-map stonetop-journey-canvas");
		expect(map).not.toContain("stonetop-journey-zoom");
	});

	it("keeps the dataset the shared binding reads, and says what it is without its label", () => {
		// `bindJourneyControls` finds the button by class and opens `data-key`'s map; moving the
		// button was only ever safe because neither of those moved with it.
		expect(HBS).toMatch(/class="stonetop-journey-zoom"[\s\S]{0,240}?data-key="\{\{journey\.activeTier\}\}"/);
		// The words "see the whole map" used to be the button. Now that it is a glyph, they have to
		// survive somewhere a screen reader and a tooltip can still reach.
		expect(HBS).toMatch(/aria-label="See the whole map"/);
		expect(HBS).toMatch(/data-tooltip="See the whole map"/);
	});

	it("hangs off the wrapper, and takes its clicks with it when it fades out", () => {
		const wrap = declarations(CSS, ".stonetop-journey .stonetop-journey-mapwrap");
		expect(wrap).toMatch(/position:\s*relative/);

		const own = ownRule(CSS, ".stonetop-journey .stonetop-journey-zoom");
		expect(own).toMatch(/position:\s*absolute/);
		expect(own).toMatch(/opacity:\s*0\b/);
		expect(own).toMatch(/pointer-events:\s*none/);
	});

	// A CONTROL LAID ON THE ART, not a piece of it. Both of these were spotted on sight (user,
	// 2026-08-24): a cream tile reads as torn-out map, and the glyph inside it sat visibly left and
	// high of the square it is drawn in. The margin is core's, so it comes back on any button that
	// forgets the correction; the numbers are held here because nothing on screen can be measured
	// from a unit test, and the pixel sweep that chose them is named in the stylesheet.
	it("stands on its own white ground, with the glyph centred in both axes", () => {
		const own = ownRule(CSS, ".stonetop-journey .stonetop-journey-zoom");
		expect(own).toMatch(/background:\s*#fff\b/);

		const icon = declarations(CSS, ".stonetop-journey .stonetop-journey-zoom > i");
		// Core Foundry gives every `button > i` a right margin for the label it assumes is coming.
		expect(icon).toMatch(/margin-right:\s*0\b/);
		// Font Awesome 7 paints above the middle of its own box, and no amount of centring reaches it.
		expect(icon).toMatch(/transform:\s*translate\(/);
	});

	it("comes back for a pointer and for a keyboard, both", () => {
		const shown = declarations(CSS, ".stonetop-journey .stonetop-journey-mapwrap:hover .stonetop-journey-zoom");
		expect(shown).toMatch(/opacity:\s*1\b/);
		// Revealed and clickable are one state: without this the button would paint on hover and
		// still refuse the press it was painted for.
		expect(shown).toMatch(/pointer-events:\s*auto/);
		// A keyboard has no pointer to reveal it with.
		expect(declarations(CSS, ".stonetop-journey .stonetop-journey-zoom:focus-visible")).toMatch(/opacity:\s*1\b/);
	});
});
