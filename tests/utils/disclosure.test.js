import { describe, it, expect } from "vitest";
import { toggleDisclosure } from "../../module/utils/disclosure.js";

// The suite runs on `environment: "node"` with no jsdom, so these run against a stand-in for a
// button and the panel beside it. That covers the whole of what this module does, and the thing
// it exists to stop (the `hidden` and the `aria-expanded` drifting apart) is exactly what a
// stand-in can see.

/**
 * A button and the panels beside it, as far as this module is concerned. `.panel` matches them
 * all, `.first` only the first, and anything else nothing.
 */
function fakePair({ open = false, panels = 1 } = {}) {
	const list = Array.from({ length: panels }, () => ({ hidden: !open }));
	const button = {
		attrs: {},
		setAttribute(name, value) { this.attrs[name] = value; },
		parentElement: {
			querySelectorAll: sel =>
				(sel.includes(".panel") ? list : sel.includes(".first") ? list.slice(0, 1) : []),
		},
	};
	return { button, panel: list[0], panels: list };
}

describe("toggleDisclosure", () => {
	it("opens a shut panel and says so", () => {
		const { button, panel } = fakePair();
		expect(toggleDisclosure(button, ".panel")).toBe(true);
		expect(panel.hidden).toBe(false);
		expect(button.attrs["aria-expanded"]).toBe("true");
	});

	it("shuts an open one and says that", () => {
		const { button, panel } = fakePair({ open: true });
		expect(toggleDisclosure(button, ".panel")).toBe(false);
		expect(panel.hidden).toBe(true);
		expect(button.attrs["aria-expanded"]).toBe("false");
	});

	// The pair is the whole point. Move `hidden` without `aria-expanded` and the panel is open
	// while a screen reader is told it is shut, which nothing on the visible page can show.
	it("never moves one without the other", () => {
		const { button, panel } = fakePair();
		for (let i = 0; i < 4; i += 1) {
			toggleDisclosure(button, ".panel");
			expect(button.attrs["aria-expanded"]).toBe(String(!panel.hidden));
		}
	});

	// A blurb whose halves disagree is the failure this exists to stop: the GM moves list reveals
	// the rest of a sentence INSIDE the button and a panel under it, and a caller that toggled
	// them one at a time could leave the sentence finished above a panel that never opened.
	it("moves every panel the selector matches, as one", () => {
		const { button, panels } = fakePair({ panels: 3 });
		expect(toggleDisclosure(button, ".panel")).toBe(true);
		expect(panels.map(p => p.hidden)).toEqual([false, false, false]);
		toggleDisclosure(button, ".panel");
		expect(panels.map(p => p.hidden)).toEqual([true, true, true]);
	});

	// ...and it takes the state from the FIRST match, so a set that has somehow drifted apart is
	// pulled back together rather than each half flipping to its own opposite.
	it("takes the new state from the first match", () => {
		const { button, panels } = fakePair({ panels: 2 });
		panels[1].hidden = false;                       // drifted open on its own
		expect(toggleDisclosure(button, ".panel")).toBe(true);
		expect(panels.map(p => p.hidden)).toEqual([false, false]);
	});

	// Delegated handlers fire on markup that may have moved on. A missing panel is a no-op rather
	// than a throw, and it says nothing happened so a caller can tell.
	it("shrugs at a button with no panel, and at no button", () => {
		const { button } = fakePair();
		expect(toggleDisclosure(button, ".nothing-here")).toBeNull();
		expect(button.attrs["aria-expanded"]).toBeUndefined();
		expect(toggleDisclosure(null, ".panel")).toBeNull();
		expect(toggleDisclosure({}, ".panel")).toBeNull();
	});
});
