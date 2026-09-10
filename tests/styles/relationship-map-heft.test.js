import { describe, it, expect } from "vitest";
import { ownRule, readCss, readRepo } from "../fakes/css.js";

// HOW HEAVILY THIS READER WANTS THE BOARD DRAWN: three dials on the relationship map's footer,
// immediately right of the captions box -- the arrowheads, the strokes and the writing, each a
// percentage of what the stylesheet sets. See module/relmap/relmap-weights.js.
//
// ⚠ WHAT THIS FILE IS REALLY GUARDING IS ONE TRAP, AND IT COST THIS CONTROL A RELEASE. Foundry's
// compatibility layer gives every button inside an AppV1 window `width: 100%` and `margin: 0 1px`,
// and pins its `font-size` in PIXELS; stonetop.css is unlayered, so it beats core per PROPERTY --
// but only for properties it actually declares. A button of ours that names no width simply takes
// core's, and on a flex item that must not shrink that is one control as wide as everything around
// it with its neighbours shoved out past the edge. It shipped that way: the readout filled the row
// and the `+` stood 56px OUTSIDE the panel it was then drawn in, which reads as a background box
// failing to contain its buttons rather than as one button demanding the whole row.
//
// It got that far because the browser check written for it (z:/tmp/foundry-verify/relmap-heft-shot.mjs)
// mounted the markup under a bare `<div class="stonetop-relmap">` with stonetop.css alone, so
// neither core declaration was in the cascade and the shot was clean. relmap-heft-fit.mjs is the
// honest one -- foundry2.css first, and the markup inside a real `.app.window-app` -- and this file
// holds the source-level facts it measured, so the next hand in here cannot quietly drop them.

const CSS = readCss();
const HBS = readRepo("templates/dialogs/relationship-map.hbs");

/** One rule's own declarations, comments stripped, so a negative assertion cannot be fooled by a
 * grouped prelude or by the prose above it. See tests/fakes/css.js. */
const rule = (selector) => ownRule(CSS, selector);

describe("the readout, which is also the way back to 100%", () => {
	// ⚠ THE ONE THAT SHIPPED BROKEN. Without a width of its own this is 100% of the line.
	it("names its own width rather than taking core's full-width one", () => {
		const block = rule(".stonetop-relmap-heft-now");
		expect(block, "no rule for the readout").toBeTruthy();
		expect(block).toMatch(/width:\s*auto/);
	});

	// A percentage width on a `flex: none` item cannot be shrunk back by the line, which is why the
	// pair have to be read together: either one alone is survivable, and together they burst the
	// row. The `flex: none` is wanted (the arrows must not move while the number is pressed), so
	// the width is the half that has to be declared.
	it("cannot be shrunk back by the line it overflows", () => {
		expect(rule(".stonetop-relmap-heft-now")).toMatch(/flex:\s*none/);
	});

	// TABULAR FIGURES AND A FLOOR ON THE WIDTH: this number runs 50% to 300% and is pressed
	// repeatedly, so proportional digits would slide the `+` out from under the finger holding it
	// -- and, on one line, would shunt the two dials beyond it sideways on every press.
	it("holds one width across every number it can show", () => {
		const block = rule(".stonetop-relmap-heft-now");
		expect(block).toMatch(/min-width:\s*3\.4em/);
		expect(block).toMatch(/font-variant-numeric:\s*tabular-nums/);
	});

	// Core's `body.game .app button { margin: 0 1px }` is spacing the dial's own `gap` knows nothing
	// about -- four controls a dial, three dials, on a line that has to line up with a label.
	it("takes core's button margin off", () => {
		expect(rule(".stonetop-relmap-heft-now")).toMatch(/margin:\s*0;/);
	});
});

describe("the two arrows", () => {
	// These always named a width, which is why only their neighbour burst the row.
	it("are a square that does not move with the line", () => {
		const block = rule(".stonetop-relmap-heft-step");
		expect(block, "no rule for the arrows").toBeTruthy();
		expect(block).toMatch(/flex:\s*none/);
		expect(block).toMatch(/width:\s*1\.35em/);
		expect(block).toMatch(/height:\s*1\.35em/);
	});

	it("takes core's button margin off", () => {
		expect(rule(".stonetop-relmap-heft-step")).toMatch(/margin:\s*0;/);
	});

	// Core's `body.game .app button > i` carries a `margin-right: 3px` for a label that is not
	// coming, and on a button this small three pixels is most of what centring there is. Set on all
	// four sides so a core change to any one of them lands the same way.
	it("takes core's icon-to-label margin off the glyph inside it", () => {
		expect(rule(".stonetop-relmap-heft-step > i")).toMatch(/margin:\s*0;/);
	});
});

// ⚠ THE THIRD FACE OF THE SAME TRAP, and the one that only bites on this line. Core pins a button's
// `font-size` in PIXELS (`var(--font-size-14)`), so an `em` inside one is px-anchored too: the
// squares and the number would be the same size at every interface font setting, level with the
// label beside them at a 16px root and out of step with it at every other -- and the reader most
// likely to have moved that setting is the reader these dials exist for.
describe("what size the dials are", () => {
	it("takes its size from the group and not from core's pixels", () => {
		expect(rule(".stonetop-relmap-heft")).toMatch(/font-size:\s*var\(--st-fs-sm\)/);
		expect(rule(".stonetop-relmap-heft-step")).toMatch(/font-size:\s*inherit/);
		expect(rule(".stonetop-relmap-heft-now")).toMatch(/font-size:\s*inherit/);
	});

	// The captions box beside it is `--st-fs-sm` too. One token, one line, no arithmetic to drift.
	it("is the size the captions box beside it is set in", () => {
		expect(rule(".stonetop-relmap-foot-check")).toMatch(/font-size:\s*var\(--st-fs-sm\)/);
	});
});

describe("where the three dials stand", () => {
	// ⚠ ON THE FOOTER'S LINE, WHICH IS WHAT MAKES ALL THE CHROME BELOW UNNECESSARY. They used to
	// float in the board's top-left corner, which cost an opaque ground, a border, a shadow, a
	// z-index argued against the tie bar, a hover reveal and a touch-screen exception. On a row
	// that already has a ground of its own, every one of those is gone -- and if any of them comes
	// back, this control has quietly gone back to being a panel laid over the diagram.
	it("is laid out in line rather than floated over the board", () => {
		const block = rule(".stonetop-relmap-heft");
		expect(block, "no rule for the group").toBeTruthy();
		expect(block).toMatch(/display:\s*flex/);
		expect(block).not.toMatch(/position:\s*absolute/);
		expect(block).not.toMatch(/\bz-index:/);
		expect(block).not.toMatch(/\bbackground:/);
		expect(block).not.toMatch(/\bbox-shadow:/);
		expect(block).not.toMatch(/\bopacity:/);
	});

	// A control that appears only under a pointer is one a touch screen never shows and a keyboard
	// reaches blind. Nothing reveals these now, so nothing may hide them either.
	it("is not hidden until something is hovered", () => {
		expect(CSS).not.toContain(".stonetop-relmap-view:hover .stonetop-relmap-heft");
		expect(CSS).not.toMatch(/@media \(hover: none\) \{\s*\n\t\.stonetop-relmap-heft \{/);
	});

	// ⚠ IT WRAPS, and for the reason the footer around it wraps: nothing in here gives up any width,
	// so at a large font scale or in a narrow window the third dial would leave the line and be
	// clipped by the content box with no scrollbar and no sign it was ever there.
	it("wraps rather than losing a dial off the end of the line", () => {
		expect(rule(".stonetop-relmap-heft")).toMatch(/flex-wrap:\s*wrap/);
		expect(rule(".stonetop-relmap-foot")).toMatch(/flex-wrap:\s*wrap/);
	});

	// ⚠ THREE CONTROLS AND NOT TWELVE, WHICH IS WHAT THE RULE ROUND EACH DIAL IS FOR. Laid out in
	// line with nothing but air between them the dials bled into one another and into the captions
	// box: `Hide labels ▶ − 130% + ＼ − 100% + A − 100% +`, in which the minus signs read as part of
	// the run of numbers (user, 2026-09-09). Air could not fix it -- a gap wide enough to part three
	// dials parts all twelve -- so the boundary is a hairline, and the mark sits INSIDE it, which is
	// what turns the icon into that dial's label rather than one more mark on the line.
	it("fences each dial with a rule of its own", () => {
		const block = rule(".stonetop-relmap-heft-dial");
		expect(block, "no rule for the dial").toBeTruthy();
		expect(block).toMatch(/border:\s*1px solid var\(--st-card-rule\)/);
		expect(block).toMatch(/border-radius:/);
		expect(block).toMatch(/padding:/);
	});

	// The mark is the first thing in the box and a MINUS SIGN is the second: at an even spacing the
	// two read as one expression rather than as a label followed by a control.
	it("gives the mark more air than the dial's own gap before the minus", () => {
		const gap = Number(rule(".stonetop-relmap-heft-dial").match(/gap:\s*([\d.]+)em/)[1]);
		const [, right] = rule(".stonetop-relmap-heft-mark").match(/margin:\s*0 ([\d.]+)em/);
		expect(gap + Number(right)).toBeGreaterThan(gap);
	});

	// The air outside the rules keeps the footer's own rhythm, so the boxes sit at the same
	// distance from each other as from the captions box beside them.
	it("spaces the boxes the way the footer spaces its groups", () => {
		const outer = rule(".stonetop-relmap-heft").match(/gap:\s*([\d.]+)em/)[1];
		const foot = rule(".stonetop-relmap-foot").match(/gap:\s*([\d.]+)em/)[1];
		expect(outer).toBe(foot);
	});

	// ⚠ IN THE FOOTER'S LEFT HALF, WHICH IS THE HALF THAT BELONGS TO THIS READER, and OUTSIDE the
	// `{{#if canEdit}}` that fences the tools on the right: this writes to one browser and nobody
	// else's window moves, so a reader who may only look -- the one who cannot move a portrait to
	// see what is under it -- keeps it.
	it("is on the footer beside the captions box, and not behind the editing gate", () => {
		const foot = HBS.slice(HBS.indexOf('<div class="stonetop-relmap-foot">'));
		const check = foot.indexOf("stonetop-relmap-foot-check");
		const heft = foot.indexOf('<div class="stonetop-relmap-heft"');
		const gate = foot.indexOf("{{#if canEdit}}");
		expect(check).toBeGreaterThan(-1);
		expect(heft).toBeGreaterThan(check);
		expect(heft).toBeLessThan(gate);
	});

	// It is no longer inside the pan/zoom viewport, so `BOARD_CONTROLS` is not what keeps it alive
	// any more -- but the click handler still dispatches on this attribute, and a button without it
	// is a button whose press returns at the first line of the handler.
	it("keeps the attribute the click handler dispatches on", () => {
		const dial = HBS.slice(
			HBS.indexOf('<div class="stonetop-relmap-heft-dial"'),
			HBS.indexOf("{{/each}}", HBS.indexOf('<div class="stonetop-relmap-heft-dial"')),
		);
		expect(dial.match(/data-relmap-action="weight"/g)).toHaveLength(3);
	});
});
