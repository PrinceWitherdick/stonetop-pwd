import { describe, it, expect } from "vitest";
import { syncClipTooltip, bindClipTooltips } from "../../module/utils/clip-tooltips.js";

// A People row's field is one line, cut with "…" when it doesn't fit. The full text shows on
// hover only while it is cut, and the rich notes preview keeps its formatting.

function cell({ scrollWidth, clientWidth, text = "", html = "", rich = false, dataset = {} }) {
	return {
		scrollWidth, clientWidth, textContent: text, innerHTML: html, dataset,
		matches: sel => rich && sel === ".stonetop-npc-rich-text",
	};
}

describe("syncClipTooltip", () => {
	it("shows the full text, above, when the text is cut short", () => {
		const el = cell({ scrollWidth: 300, clientWidth: 120, text: "  owes a debt to the Judge " });
		syncClipTooltip(el);
		expect(el.dataset).toEqual({ tooltipText: "owes a debt to the Judge", tooltipDirection: "UP" });
	});

	it("keeps the notes preview's formatting", () => {
		const el = cell({ scrollWidth: 300, clientWidth: 120, html: "<p>One</p><p><em>Two</em></p>", rich: true });
		syncClipTooltip(el);
		expect(el.dataset).toEqual({ tooltipHtml: "<p>One</p><p><em>Two</em></p>", tooltipDirection: "UP" });
	});

	it("clears the tooltip once the text fits (a wider window)", () => {
		const el = cell({ scrollWidth: 120, clientWidth: 120, dataset: { tooltipText: "old", tooltipDirection: "UP" } });
		syncClipTooltip(el);
		expect(el.dataset).toEqual({});
	});

	it("ignores a sub-pixel overflow", () => {
		const el = cell({ scrollWidth: 121, clientWidth: 120, text: "fits" });
		syncClipTooltip(el);
		expect(el.dataset).toEqual({});
	});
});

describe("bindClipTooltips", () => {
	function fakeRoot() {
		const listeners = [];
		const root = {
			addEventListener: (type, fn) => listeners.push({ type, fn }),
			contains: () => true,
		};
		return { root, listeners };
	}

	it("listens once per root, on pointerover (which comes before Foundry's pointerenter)", () => {
		const { root, listeners } = fakeRoot();
		bindClipTooltips(root, ".x");
		bindClipTooltips(root, ".x");
		expect(listeners.map(l => l.type)).toEqual(["pointerover"]);
	});

	it("syncs the matched ancestor of whatever the pointer is over", () => {
		const { root, listeners } = fakeRoot();
		bindClipTooltips(root, ".steading-person-text");
		const el = cell({ scrollWidth: 300, clientWidth: 100, text: "Aerin The Blessed" });
		listeners[0].fn({ target: { closest: sel => (sel === ".steading-person-text" ? el : null) } });
		expect(el.dataset.tooltipText).toBe("Aerin The Blessed");
	});
});
