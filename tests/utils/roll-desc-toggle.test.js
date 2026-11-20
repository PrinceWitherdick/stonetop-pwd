// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { wireDescToggle } from "../../module/utils/roll-engine.js";

// THE ROLL CARD'S "?" SAYS WHETHER THE DESCRIPTION IS OPEN (STYLEGUIDE.md, "Icons and glyphs":
// a control that is only an icon carries a name). The button is only a glyph, so its aria-label
// is all a screen reader hears; a fixed "Show move description" left a reader who had pressed it
// with no way to tell the description was now showing, or how to shut it again. The open state
// is the card's `desc-revealed` class (the stylesheet reads it); the button mirrors it.

const card = ({ revealed = false, legacy = false } = {}) => {
	const root = document.createElement("div");
	// A card posted before the toggle carried a state: a native title, no aria-* at all.
	const button = legacy
		? `<button class="stonetop-roll-card-desc-toggle" type="button" title="Show move description"><i class="fas fa-question-circle"></i></button>`
		: `<button class="stonetop-roll-card-desc-toggle" type="button" aria-expanded="false" aria-label="Show move description" data-tooltip="Show move description"><i class="fas fa-circle-question" aria-hidden="true"></i></button>`;
	root.innerHTML = `<div class="stonetop-roll-card${revealed ? " desc-revealed" : ""}"><h3>Defy Danger ${button}</h3><div class="stonetop-roll-card-description">…</div></div>`;
	return { root, card: root.querySelector(".stonetop-roll-card"), toggle: root.querySelector("button") };
};

const said = toggle => ({
	expanded: toggle.getAttribute("aria-expanded"),
	label: toggle.getAttribute("aria-label"),
	tooltip: toggle.getAttribute("data-tooltip"),
});

describe("the roll card's description toggle", () => {
	it("starts shut, and says it will show the description", () => {
		const { root, toggle } = card();
		wireDescToggle(root);
		expect(said(toggle)).toEqual({ expanded: "false", label: "Show move description", tooltip: "Show move description" });
	});

	it("opens the card on a press, and then says it will hide it", () => {
		const { root, card: el, toggle } = card();
		wireDescToggle(root);
		toggle.click();
		expect(el.classList.contains("desc-revealed")).toBe(true);
		expect(said(toggle)).toEqual({ expanded: "true", label: "Hide move description", tooltip: "Hide move description" });
	});

	it("shuts it again on a second press", () => {
		const { root, card: el, toggle } = card();
		wireDescToggle(root);
		toggle.click();
		toggle.click();
		expect(el.classList.contains("desc-revealed")).toBe(false);
		expect(said(toggle).expanded).toBe("false");
		expect(said(toggle).label).toBe("Show move description");
	});

	it("reads the state off the card, not the markup it was posted with", () => {
		const { root, toggle } = card({ revealed: true });
		wireDescToggle(root);
		expect(said(toggle).expanded).toBe("true");
		expect(said(toggle).label).toBe("Hide move description");
	});

	it("brings a card posted before the toggle carried a state up to date", () => {
		const { root, toggle } = card({ legacy: true });
		wireDescToggle(root);
		expect(said(toggle)).toEqual({ expanded: "false", label: "Show move description", tooltip: "Show move description" });
	});

	it("leaves a card with no toggle alone", () => {
		const root = document.createElement("div");
		root.innerHTML = `<div class="stonetop-roll-card"><h3>Defy Danger</h3></div>`;
		expect(() => wireDescToggle(root)).not.toThrow();
		expect(() => wireDescToggle(null)).not.toThrow();
	});
});
