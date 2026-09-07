import { describe, it, expect } from "vitest";
import { ownRule, readCss } from "../fakes/css.js";

// THE MAP TAB RUNS TO THE STEADING SHEET'S EDGE, and the three rules that make it do so are each
// other's only context. Measured in a browser before they went in, on a 900px-wide sheet: the
// board's left edge stood 8px inside the window content and its right edge 18px. Two separate
// insets, neither of them the tab's own, and the asymmetry was the tell.
//
// Every failure here is SILENT. The board still renders, still pans, still zooms; it just sits a
// little way in from one edge and further in from the other, which reads as a stray margin rather
// than as a rule that stopped applying. Layout itself is verified in a browser
// (z:/tmp/foundry-verify/relmap-pad2.mjs); this holds the source-level facts that check relies on.

const CSS = readCss();

/** One rule's own declarations, comments stripped, falling back to the shared lists that name it.
 * `ownRule` rather than a local scan so the negative assertions below cannot be fooled by a
 * grouped prelude -- see tests/fakes/css.js. */
const rule = (selector) => ownRule(CSS, selector);

describe("the map tab's horizontal bleed", () => {
	// ⚠ THE TWO NUMBERS ARE ONE NUMBER. The bleed exists to cancel the actor form's inset exactly;
	// if that inset is ever retuned, this margin is wrong by the difference and the board sits
	// proud of the window on one side. Pinned together so the change cannot be made in one place.
	it("gives back exactly the inset the actor form takes", () => {
		const form = rule(".pbta.sheet.actor .window-content form");
		expect(form, "the form inset this bleed cancels is gone").toBeTruthy();
		expect(form).toMatch(/padding:\s*8px/);

		const bleed = rule(".steading-sheet-layout:has(> .sheet-body > .tab.relmap.active)");
		expect(bleed, "no bleed rule for the map tab").toBeTruthy();
		expect(bleed).toMatch(/margin-inline:\s*-8px/);
	});

	// ⚠ AND IT HAS TO BE LET THROUGH. `.sheet-wrapper` is `overflow: hidden`, so a negative margin
	// under it is simply clipped and NOTHING MOVES -- the bleed rule above still parses, still
	// applies, and has no visible effect at all.
	it("opens the wrapper's clip far enough to let the bleed past", () => {
		const wrap = rule(".steading-sheet .sheet-wrapper:has(.tab.relmap.active)");
		expect(wrap, "the wrapper still clips the bleed away").toBeTruthy();
		expect(wrap).toMatch(/overflow-clip-margin:\s*8px/);
		// `clip` and not `visible`: the wrapper is not a scroll container and must not become one,
		// and everything it holds still has to stop at its edges in the other direction.
		expect(wrap).toMatch(/overflow:\s*clip/);
		expect(wrap).not.toMatch(/overflow:\s*(visible|auto|scroll)/);
	});

	// The right-hand half of the old asymmetry, and the stranger of the two: `.stonetop-sheet-layout
	// .sheet-body` reserves a scrollbar gutter so tabs of different heights don't reflow sideways
	// past one another -- but the steading's body is `overflow: hidden` and the active tab owns the
	// scroll, so the bar it reserves for can never appear. Every other page hides the dead strip
	// under its own 12px of padding; this one has none to hide it in.
	it("drops the gutter reserved for a scrollbar that cannot appear", () => {
		const body = rule(".steading-sheet .sheet-body:has(> .tab.relmap.active)");
		expect(body, "the map tab still pays for a scrollbar gutter").toBeTruthy();
		expect(body).toMatch(/scrollbar-gutter:\s*auto/);

		// Given back HERE and not at the layout rule, whose `stable` every other steading page is
		// spaced with.
		expect(rule(".stonetop-sheet-layout .sheet-body")).toMatch(/scrollbar-gutter:\s*stable/);
	});

	// All three are scoped by `:has(... .tab.relmap.active)` rather than by the tab's own class, so
	// they lift the moment the reader tabs away and no other page of the sheet ever sees them.
	it("applies only while the map tab is the one being read", () => {
		for (const selector of [
			".steading-sheet .sheet-wrapper:has(.tab.relmap.active)",
			".steading-sheet-layout:has(> .sheet-body > .tab.relmap.active)",
			".steading-sheet .sheet-body:has(> .tab.relmap.active)",
		]) expect(CSS, selector).toContain(`\n${selector} {`);
	});
});
