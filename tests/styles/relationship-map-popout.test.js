import { describe, it, expect } from "vitest";
import { ownRule, readCss, readRepo } from "../fakes/css.js";

// THE WAY OUT OF THE STEADING SHEET'S MAP TAB INTO A WINDOW: a small tile in the board's top-right
// corner, the same place and the same mark as the expedition map's own.
//
// Every declaration pinned here has a failure that is SILENT. The tile still lays out, still
// hovers, still takes a click; it just does the wrong thing, or does nothing, or sits slightly
// wrong in a way that reads as sloppiness rather than as a bug. Layout itself is verified in a
// browser (z:/tmp/foundry-verify/relmap-tab-verify.mjs); this holds the source-level facts that
// browser check is relying on.

const CSS = readCss();
const HBS = readRepo("templates/dialogs/relationship-map.hbs");
const WINDOW = readRepo("module/dialogs/RelationshipMapWindow.js");

/** One rule's own declarations, comments stripped, falling back to the shared lists that name it.
 * `ownRule` rather than a local scan so the negative assertions below cannot be fooled by a
 * grouped prelude -- see tests/fakes/css.js. */
const rule = (selector) => ownRule(CSS, selector);

describe("the pop-out tile", () => {
	it("sits in the top-right corner of the board", () => {
		const block = rule(".stonetop-relmap-popout");
		expect(block, "no rule for the tile").toBeTruthy();
		expect(block).toMatch(/position:\s*absolute/);
		expect(block).toMatch(/top:\s*0\.5em/);
		expect(block).toMatch(/right:\s*0\.5em/);
		// The corner the expedition map's own way out stands in (user, 2026-09-07), so the way out
		// of a picture is in the same place on both surfaces. Pinned against the OTHER edge as
		// well: with both written the tile stretches down the whole right-hand side of the board.
		expect(block).not.toMatch(/\bbottom:/);
	});

	// ⚠ HIDDEN HAS TO MEAN UNCLICKABLE. The tile is INSIDE the pan/zoom viewport, so a transparent
	// button left live in that corner swallows presses meant for the board under it -- and on this
	// board a press is how a portrait is dragged and how a line is taken hold of.
	it("takes the pointer with it when it fades out", () => {
		const block = rule(".stonetop-relmap-popout");
		expect(block).toMatch(/opacity:\s*0/);
		expect(block).toMatch(/pointer-events:\s*none/);
		expect(CSS).toMatch(
			/\.stonetop-relmap-view:hover \.stonetop-relmap-popout,\s*\n\.stonetop-relmap-popout:focus-visible \{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/);
	});

	// A control that can be tabbed to but never seen is a control that cannot be used, and a touch
	// screen has no pointer to reveal it with at all.
	it("appears for a keyboard, and stands permanently where there is no hover", () => {
		expect(CSS).toContain(".stonetop-relmap-popout:focus-visible");
		expect(CSS).toMatch(/@media \(hover: none\) \{\s*\n\t\.stonetop-relmap-popout \{[^}]*opacity:\s*1/);
	});

	// It is laid ON the board rather than being part of it, over a diagram that is nothing but
	// lines and faces. Without its own opaque ground it is unreadable over half the map.
	it("carries its own ground, in the panel tone rather than the page tone", () => {
		const block = rule(".stonetop-relmap-popout");
		expect(block).toMatch(/background:\s*var\(--stonetop-bg\)/);
		expect(block).toMatch(/border:\s*1px solid var\(--st-card-rule\)/);
		expect(block).toMatch(/box-shadow:/);
	});

	// Over the board, under the tie bar. The bar is the control the reader has just opened by
	// pressing a line; if the two land on the same corner, the one they asked for wins.
	it("stacks above the board and below the tie bar", () => {
		expect(rule(".stonetop-relmap-popout")).toMatch(/z-index:\s*4/);
		expect(rule(".stonetop-relmap-tiebar")).toMatch(/z-index:\s*5/);
	});
});

describe("the glyph inside it", () => {
	// ⚠ THE DECLARATION THAT LOOKS REDUNDANT AND IS NOT. The tile's square comes from a 1.6em icon
	// box, and the icon carried a 1.6 line-height to match -- so the glyph was placed by a BASELINE
	// sitting low in a line box far taller than the artwork, and rode high: measured 0.8px at root
	// 16 and 4.1px at root 24, where the space under it was nearly twice the space over it.
	// Collapsing the line box to the glyph's own em and centring it with flex is the whole fix.
	it("centres the glyph in its own em rather than by a baseline", () => {
		const block = rule(".stonetop-relmap-popout > i");
		expect(block, "no rule for the glyph").toBeTruthy();
		expect(block).toMatch(/line-height:\s*1;/);
		expect(block).toMatch(/display:\s*flex/);
		expect(block).toMatch(/align-items:\s*center/);
		expect(block).toMatch(/justify-content:\s*center/);
		// The square the tile is built from, which must not move with the line box.
		expect(block).toMatch(/width:\s*1\.6em/);
		expect(block).toMatch(/height:\s*1\.6em/);
	});

	// Core's `body.game .app button > i` carries a `margin-right: 3px` for the label it assumes is
	// coming. There is no label here, so it is welded to the right of the box being centred and the
	// glyph paints about 1.5px left of the middle.
	it("takes core's icon-to-label margin off every side", () => {
		expect(rule(".stonetop-relmap-popout > i")).toMatch(/margin:\s*0;/);
	});
});

describe("what makes it work at all", () => {
	// ⚠ THE ONE THAT BREAKS SILENTLY AND TOTALLY. The tile is inside the pan/zoom viewport: a press
	// the surface does not recognise takes a pointer capture, the capture retargets the click at
	// the viewport, and the button is dead on a dead-centre press that never moved a pixel.
	// `BOARD_CONTROLS` names `[data-relmap-action]`, so that attribute is what keeps it alive.
	it("keeps the attribute BOARD_CONTROLS lets through the pan surface", () => {
		expect(HBS).toMatch(/class="stonetop-relmap-tool stonetop-relmap-popout"\s*\n\s*data-relmap-action="popout"/);
		const controls = WINDOW.match(/const BOARD_CONTROLS =([\s\S]*?);/)[1];
		expect(controls).toContain("[data-relmap-action]");
	});

	// A tool with no entry in that table is a button whose click handler returns at its first line.
	it("is a tool the window knows, and not an edit", () => {
		expect(WINDOW).toMatch(/popout:\s*\{\s*needsEdit:\s*false/);
	});

	// The glyph IS the button, so its name has to reach a reader some other way: the tooltip for
	// everyone else and the accessible name for a screen reader, from ONE string so they cannot
	// drift apart.
	it("says what it is, twice, from one string", () => {
		const tag = HBS.match(/<button[^>]*data-relmap-action="popout"[\s\S]*?>/)[0];
		expect(tag).toContain('data-tooltip="{{popOutLabel}}"');
		expect(tag).toContain('aria-label="{{popOutLabel}}"');
	});
});
