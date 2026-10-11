import { describe, it, expect } from "vitest";
import { readCss, readRepo, declarations, ownRule } from "../fakes/css.js";

/**
 * A follower's Loyalty and Readiness rows, and the Spend button at the end of each.
 *
 * The row holds three things that cannot give: a label slot fixed wide enough for "Readiness",
 * a pip track reserved in px so both rows' buttons start at the same x, and a button sized to
 * its own words. That is the whole point of the design on a roomy card — but the Followers grid
 * holds two columns at EVERY width now (see `.stonetop-followers`), so a sheet dragged to its
 * 800px floor hands the card less width than those three add up to. As grid tracks they had
 * nowhere to go: they overflowed, and the card's `overflow: hidden` sliced the Spend button in
 * half, which is what a player saw.
 *
 * So the row wraps. The two things this guards are the two ways the fix can be undone by someone
 * reading only the rule:
 *
 * IT MUST NOT GO BACK TO FIXED TRACKS. `display: grid` with three unshrinkable columns is the
 * bug. Flex is load-bearing here, not a style preference: it is what puts Spend on a second line
 * at exactly the width where it stops fitting.
 *
 * AND IT MUST NOT BE A PX BREAKPOINT. The tempting fix is a container query beside the header's,
 * and it is wrong: the label slot and the button are ems while the pips are px, so the width at
 * which Spend stops fitting MOVES with the client's UI Font Size setting. Measured on a 4-pip
 * card, it crossed the gutter at 274px of card at a 14px root but at 294px at 20px -- the size
 * this project's own player runs. Any single number leaves one font size clipping in the gap.
 *
 * The alignment the original grid existed for is asserted too, because it is the thing a rewrite
 * is most likely to drop on the way past: both rows share one label width and one pip
 * reservation, and the two buttons carry one icon box, so Loyalty and Readiness never disagree
 * about where their Spend sits or which shape they are in.
 */

const CSS = readCss();

const ROW = ".stonetop-follower-field-row.stonetop-follower-loyalty-row";
const READINESS_ROW = ".stonetop-follower-field-row.stonetop-follower-readiness-row";

describe("a follower's Loyalty / Readiness row", () => {
	it("wraps instead of laying its parts out as grid tracks that cannot shrink", () => {
		const row = ownRule(CSS, ROW);
		expect(row).toBeTruthy();
		expect(row).toMatch(/display:\s*flex/);
		expect(row).toMatch(/flex-wrap:\s*wrap/);
		// The bug, spelled out: fixed tracks have nowhere to go on a narrow card.
		expect(row).not.toMatch(/display:\s*grid/);
		expect(row).not.toMatch(/grid-template-columns/);
	});

	it("gives Readiness the same treatment as Loyalty, so the two rows match", () => {
		expect(ownRule(CSS, READINESS_ROW)).toBe(ownRule(CSS, ROW));
	});

	it("keeps one shared label width, so the pips start at the same x on both rows", () => {
		for (const sel of [
			".stonetop-follower-loyalty-row > .stonetop-follower-field-label",
			".stonetop-follower-readiness-row > .stonetop-follower-field-label",
		]) {
			// Must beat `.stonetop-follower-field-label { flex: none }`, which would otherwise
			// size each label to its own text and push "Readiness"'s pips right of "Loyalty"'s.
			expect(declarations(CSS, sel)).toMatch(/flex:\s*0\s+0\s+5\.3em/);
		}
	});

	it("keeps the pip reservation, so an extra Readiness circle does not shift its Spend", () => {
		for (const sel of [
			".stonetop-follower-loyalty-row > .stonetop-loyalty-pips",
			".stonetop-follower-readiness-row > .stonetop-readiness-pips",
		]) {
			const d = declarations(CSS, sel);
			// The track still holds --st-follower-pip-slots circles whatever THIS row draws,
			// and an over-held row still grows past it rather than overflowing.
			expect(d).toMatch(/min-width:\s*var\(--st-pip-track\)/);
			expect(d).toMatch(/width:\s*max-content/);
		}
	});

	it("sizes both Spend glyphs into one box, so the two rows wrap at the same width", () => {
		// fa-shield is narrower than fa-hand-holding-hand. Left to themselves the buttons differ
		// by a couple of px, which is enough to leave Readiness on one line while Loyalty has
		// already gone to two.
		for (const sel of [
			".stonetop-follower-loyalty-row .stonetop-spend-loyalty > i",
			".stonetop-follower-readiness-row .stonetop-spend-readiness > i",
		]) {
			expect(declarations(CSS, sel)).toMatch(/width:\s*1em/);
		}
	});

	it("keeps the row tight, so Spend only wraps when it truly cannot fit", () => {
		// Measured on a 4-pip card: the stock 12px gap and 8px button padding sent Spend to a
		// second line on a 275px card with only 11px missing at a 16px root.
		expect(ownRule(CSS, ROW)).toMatch(/column-gap:\s*8px/);
		for (const sel of [
			".stonetop-follower-loyalty-row .stonetop-spend-loyalty",
			".stonetop-follower-readiness-row .stonetop-spend-readiness",
		]) {
			const d = declarations(CSS, sel);
			expect(d).toMatch(/padding-left:\s*5px/);
			expect(d).toMatch(/padding-right:\s*5px/);
			expect(d).toMatch(/gap:\s*3px/);
		}
	});

	// Left to core's `button { width: 100% }`, Pay cost claimed a whole line of the Loyalty row
	// and pushed Spend under it, and Remove, Hand off, Order and every other inline action took a
	// line of their own. One rule sizes them all; it is `:where()`, so a button that pins its own
	// width (the crew steppers, the gear remove) still wins over it.
	const SHARED = ":where(.stonetop-inline-btn, .stonetop-follower-order, .stonetop-daagon-btn)";

	it("sizes every inline action, Order and the Daagon buttons to their labels, at no specificity", () => {
		const d = declarations(CSS, SHARED);
		expect(d).toMatch(/width:\s*auto/);
		// May shrink: a named crew member's "Order {name}" sits in a row that cannot wrap, and
		// wrapping its own label is what keeps it inside the card.
		expect(d).toMatch(/flex:\s*0\s+1\s+auto/);
	});

	it("sets no max-width, which would beat the crew steppers' and gear remove's pinned !important widths", () => {
		// max-width outranks width even when width is !important, so `max-width: max-content`
		// shrank those px squares down to their one icon.
		expect(declarations(CSS, SHARED)).not.toMatch(/max-width/);
	});

	it("reaches Pay cost, both Spends and every Remove through the class the shared rule names", () => {
		// The row rules no longer size these buttons themselves, so dropping the class from the
		// template would bring core's full width back and push Spend under Pay cost again.
		const hbs = readRepo("templates/actor/partials/tab-followers.hbs");
		for (const cls of ["stonetop-pay-cost", "stonetop-spend-loyalty", "stonetop-spend-readiness", "stonetop-follower-remove"]) {
			const buttons = [...hbs.matchAll(new RegExp(`<button[^>]*class="[^"]*\\b${cls}\\b[^"]*"`, "g"))].map(m => m[0]);
			expect(buttons.length, cls).toBeGreaterThan(0);
			for (const b of buttons) expect(b, cls).toMatch(/\bstonetop-inline-btn\b/);
		}
	});

	it("is not governed by a px container query, which no single number could get right", () => {
		// Scanned over the raw at-rule preludes rather than the flattened rules, because that is
		// the shape the mistake takes: an `@container follower-card (max-width: N)` block that
		// reaches these rows. The header's own fallback is fine and stays -- it guards two
		// px-fixed boxes, so ITS threshold really is constant.
		for (const [, prelude, body] of CSS.matchAll(/@container([^{]*)\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
			if (/loyalty-row|readiness-row|spend-loyalty|spend-readiness/.test(body)) {
				throw new Error(`Spend reflow pinned to a container query: @container${prelude}`);
			}
		}
	});
});
