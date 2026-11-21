// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { setTooltip } from "../../module/utils/set-tooltip.js";

// setTooltip is the one way a module gives an element Foundry's tooltip or takes it away
// (tests/templates/js-tooltip-conventions.test.js keeps hand-written clears out).

describe("setTooltip", () => {
	it("writes our own words as data-tooltip, and data from elsewhere as data-tooltip-text", () => {
		const a = document.createElement("button");
		setTooltip(a, "Roll it");
		expect(a.getAttribute("data-tooltip")).toBe("Roll it");
		const b = document.createElement("button");
		setTooltip(b, "<b>Bram</b>", { text: true });
		expect(b.getAttribute("data-tooltip-text")).toBe("<b>Bram</b>");
		expect(b.hasAttribute("data-tooltip")).toBe(false);
	});

	it("takes both forms away on no words, since an empty attribute is still an attribute", () => {
		const el = document.createElement("button");
		el.setAttribute("data-tooltip", "a");
		el.setAttribute("data-tooltip-text", "b");
		for (const none of ["", null, undefined]) {
			setTooltip(el, none);
			expect(el.hasAttribute("data-tooltip")).toBe(false);
			expect(el.hasAttribute("data-tooltip-text")).toBe(false);
		}
	});

	it("names an icon-only control with the same words when asked, and unnames it with them", () => {
		const el = document.createElement("button");
		setTooltip(el, "Expand section", { name: true });
		expect(el.getAttribute("aria-label")).toBe("Expand section");
		setTooltip(el, "", { name: true });
		expect(el.hasAttribute("aria-label")).toBe(false);
	});

	it("leaves the name alone unless asked", () => {
		const el = document.createElement("button");
		el.setAttribute("aria-label", "Roll");
		setTooltip(el, "");
		expect(el.getAttribute("aria-label")).toBe("Roll");
	});

	it("does nothing for a missing element", () => {
		expect(() => setTooltip(null, "x")).not.toThrow();
	});
});
