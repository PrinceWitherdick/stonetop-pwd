import { describe, it, expect } from "vitest";
import { readRepo, readCss, declarations } from "../fakes/css.js";

// The frosted seam between a sheet's pinned header and the tab scrolling under it: content
// blurs and dissolves as it passes behind the portrait block instead of being sliced off at
// a hard edge. Layout is verified in a browser; these guard the pieces that fail SILENTLY.
//
// Two of them are silent in opposite directions:
//  1. `position: relative` on `.sheet-body`. Without it the band's containing block is
//     whatever is positioned above it (`.window-content`), so it is neither clipped by the
//     body nor anchored to it: the blur lands over the sheet HEADER, over the portrait,
//     with nothing scrolling under it at all.
//  2. the `is-scrolled` pairing. If the gate class stops being honoured the band paints
//     always, and the tab's first line is permanently fuzzy — which reads as a broken
//     renderer, not a depth cue.

const read = readRepo;

const CSS = readCss();
const CHARACTER_SHEET = read("module/actors/character/StonetopCharacterSheet.js");
const STEADING_SHEET = read("module/actors/steading/StonetopSteadingSheet.js");
const FROST = read("module/utils/scroll-frost.js");

/** Everything an exact selector declares, across every rule that names it — see fakes/css.js. */
const block = (selector) => declarations(CSS, selector);

// Sheets EXEMPT from the seam's separator, because something of their own already draws a rule
// flush above it (measured: a 0px gap). Painting both makes the edge visibly thicken the moment
// the tab scrolls.
//
// The exemption is OPT-IN and declared by the markup: a sheet whose header carries a bottom
// border puts `stonetop-sheet-layout--own-seam` on its layout div, in the same template the
// border is written in. So there is no list in the CSS to keep in step — each entry below is
// just a template that claims the exemption, plus the header whose border is the reason for it.
// Both halves are asserted, so a claim cannot outlive the rule it defers to and quietly leave
// that sheet with no separator at all.
const SEAM_EXEMPT = [
	{ template: "templates/actor/steading.hbs",    header: ".steading-header" },
	{ template: "templates/actor/gm-toolkit.hbs",  header: ".stonetop-gm-toolkit-header" },
];

/** The opt-out class, and the separator's selector built from it. */
const OWN_SEAM = "stonetop-sheet-layout--own-seam";
const SEAM = `.stonetop-sheet-layout:not(.${OWN_SEAM})`;

describe("the frosted header seam", () => {
	it("anchors the band to the scrolling body, not to the window", () => {
		const body = block(".stonetop-sheet-layout .sheet-body");
		expect(body, "no declaration block for the sheet body").toBeTruthy();
		expect(body).toMatch(/position:\s*relative/);
	});

	// The price of that `position: relative`: `.sheet-body` is an ancestor of every tab, so it
	// becomes the containing block for any absolutely positioned descendant inside one that has
	// no positioned wrapper of its own — silently shifting it by the window header plus the
	// pinned header block. Every such element today does have a positioned parent, and giving
	// the tab panels one is what keeps that from being something anyone has to remember: the
	// panel a thing sits on is the right answer, and it scrolls with the content.
	it("keeps each tab panel its own containing block, so the band can't re-parent its content", () => {
		const tab = block(".stonetop-sheet-layout .sheet-body > .tab");
		expect(tab, "the tab panels are back to position: static").toBeTruthy();
		expect(tab).toMatch(/position:\s*relative/);
	});

	it("blurs its backdrop through a fading mask", () => {
		const band = block(".stonetop-sheet-layout .sheet-body::before");
		expect(band, "the seam's rule is gone").toBeTruthy();
		expect(band).toMatch(/backdrop-filter:\s*blur\(/);
		// A uniform strip reads as a smudge with two hard edges of its own; the mask is what
		// makes it a seam.
		expect(band).toMatch(/mask-image:\s*linear-gradient\(to bottom/);
		expect(band).toMatch(/transparent/);
		// It lies over the tab's top rows, so it must not take clicks, drags or the wheel.
		expect(band).toMatch(/pointer-events:\s*none/);
		expect(band).toMatch(/opacity:\s*0\b/);
	});

	// The separator is drawn on the LAYOUT, not on the band, and that placement is the whole
	// point of it: the layout is a flex ROW — the tab body beside the moves sidebar — so a
	// line on the band stops dead at the sidebar's edge and leaves the last third of the
	// sheet unruled. `.sheet-body` also clips its own overflow, so widening the band's
	// pseudo-element is not an escape either; it is cut off at the same place.
	it("rules the full width of the sheet, sidebar included", () => {
		const sep = block(SEAM);
		expect(sep, "the separator's rule is gone").toBeTruthy();
		expect(sep).toMatch(/border-top:\s*1px solid/);
		// Transparent-then-coloured, never added-then-removed: toggling the border itself
		// shifts the whole layout a pixel every time the seam appears.
		expect(sep).toMatch(/border-top:\s*1px solid transparent/);
		const on = block(`${SEAM}:has(> .sheet-body.is-scrolled)`);
		expect(on, "the gate rule is gone — the seam would never colour in").toBeTruthy();
		expect(on).toMatch(/border-top-color:/);
	});

	it("does not also draw the line on the band, which would double it", () => {
		expect(block(".stonetop-sheet-layout .sheet-body::before")).not.toMatch(/border-top:/);
	});

	// Not silent, but ugly and easy to reintroduce: these headers sit flush on the seam (a
	// measured 0px gap) with a rule of their own, so an unscoped separator paints a second line
	// on top and the edge visibly thickens the moment the tab scrolls. Ugly only under scroll,
	// which is what makes it easy to ship.
	it.each(SEAM_EXEMPT)("leaves $template alone, which already has a rule at that seam", ({ template, header }) => {
		// The template claims the exemption on the same div that carries the shared layout class.
		const hbs = read(template);
		expect(hbs, `${template} stopped claiming the exemption`)
			.toMatch(new RegExp(`class="[^"]*stonetop-sheet-layout[^"]*${OWN_SEAM}`));
		// ...and the rule it defers to has to still be there, or that sheet silently ends up as
		// the one with no separator at all.
		expect(block(header), `${header} lost the border the exemption defers to`)
			.toMatch(/border-bottom:\s*2px solid/);
	});

	// The opt-out is honoured on BOTH halves of the separator: miss it off the `is-scrolled`
	// half and the doubled line comes back at exactly the moment it is meant to be suppressed.
	it("honours the opt-out on both halves of the separator", () => {
		const escaped = `\\.stonetop-sheet-layout:not\\(\\.${OWN_SEAM}\\)`;
		expect(CSS).toMatch(new RegExp(`${escaped}\\s*\\{[^}]*border-top:`));
		expect(CSS).toMatch(new RegExp(`${escaped}[^{]*is-scrolled[^{]*\\{[^}]*border-top-color:`));
	});

	// The band exists to soften text being sliced off as it passes UNDER a pinned header. On the
	// CLASSIC character sheet what sits above the seam is the tab strip and its own 2px rule,
	// and nothing appears to pass behind that — so the blur reads as the page's top line having
	// gone out of focus. Same rendering-fault look the `is-scrolled` gate exists to avoid,
	// reached from the other side. Dropped there, and only there.
	it("is dropped on the classic character sheet without touching anyone else's", () => {
		const off = block(".stonetop-layout-classic.pbta.sheet.actor.character .stonetop-sheet-layout .sheet-body::before");
		expect(off, "the classic character sheet is painting the band again").toBeTruthy();
		// `content: none` removes the pseudo-element: nothing to composite, and no
		// backdrop-filter layer promoting the body on every scroll frame.
		expect(off).toMatch(/content:\s*none/);
		// ...and it is a scoped override, not the shared rule being gutted for everybody.
		expect(block(".stonetop-sheet-layout .sheet-body::before")).toMatch(/backdrop-filter:\s*blur\(/);
	});

	it("only shows while the tab is off its top", () => {
		const on = block(".stonetop-sheet-layout .sheet-body.is-scrolled::before");
		expect(on, "the gate rule is gone — the band would paint at rest").toBeTruthy();
		expect(on).toMatch(/opacity:\s*1/);
		// ...and the class the rule waits for is the one the helper writes.
		expect(FROST).toContain('classList.toggle("is-scrolled"');
	});

	for (const [name, source] of [["character", CHARACTER_SHEET], ["steading", STEADING_SHEET]]) {
		it(`is mounted by the ${name} sheet, after the rail reaches the frame`, () => {
			expect(source).toContain("mountScrollFrost(this, html)");
			// The tab-change watcher binds to the rail in its final home on the window frame,
			// so mounting before the rail moves would bind to a node about to be relocated.
			expect(source.indexOf("mountScrollFrost(this, html)"))
				.toBeGreaterThan(source.indexOf("mountTabRail(this, html)"));
		});
	}
});
