import { describe, expect, it } from "vitest";
import { declared, ownRule, readCss } from "../fakes/css.js";

// A homebrew playbook's own advances (Details tab) and a move's write-in mark row: each a box beside
// words that may wrap, the box seated on the words' FIRST line and raised to their capitals by the one
// formula every box beside words uses (camp-window.test.js), not by a nudge tuned at one UI size.
const CSS = readCss();

describe("a homebrew playbook's advance rows", () => {
	it("seat the box on its words' first line, raised to the caps", () => {
		const seat = ownRule(CSS, ".stonetop-advancement-label > input.stonetop-advancement-check");
		expect(seat, "the seat rule is gone").toBeTruthy();
		// Core drops an app's inputs with `top`; leaving it unsaid leaves the box low.
		expect(declared(seat, "top")).toBe("0");
		expect(declared(seat, "margin")).toBe("calc((1lh - var(--st-check-size)) / 2 - var(--st-caps-lift)) 0 0");
		// 1lh is read off the input's own leading: only the row's line once inherited.
		expect(declared(seat, "line-height")).toBe("inherit");
		expect(declared(seat, "font-size")).toBe("inherit");
		expect(declared(ownRule(CSS, ".stonetop-advancement-label"), "align-items")).toBe("flex-start");
	});
});

describe("a move's mark row with words", () => {
	it("holds its boxes in a box one line tall, raised to the caps", () => {
		expect(declared(ownRule(CSS, ".stonetop-move-mark:has(> .stonetop-move-mark-label)"), "align-items")).toBe("flex-start");
		const checks = ownRule(CSS, ".stonetop-move-mark:has(> .stonetop-move-mark-label) > .stonetop-move-mark-checks");
		expect(checks, "the boxes' rule is gone").toBeTruthy();
		expect(declared(checks, "min-height")).toBe("1lh");
		expect(declared(checks, "align-items")).toBe("center");
		expect(declared(checks, "top")).toBe("calc(-1 * var(--st-caps-lift))");
	});
});
