// The inline "debility" tooltip (module/utils/debility-tooltips.js): every bare "debility" / "debilities" in
// sheet and journal prose is emboldened and explains the three character debilities (Book I p.52). A
// mention qualified by "steading" is the steading's own debilities (diminished, lacking, malcontent) and
// is left alone; so are controls, links, the debility tracker and a live editor. Idempotent, and gated
// by the hover-descriptions settings.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import { markDebilityTooltips, DEBILITY_TOOLTIP_KEY } from "../../module/utils/debility-tooltips.js";

let window;
let settings;
const saved = {};

beforeEach(() => {
	window = new Window();
	saved.document = globalThis.document;
	saved.NodeFilter = globalThis.NodeFilter;
	saved.settings = globalThis.game.settings;
	globalThis.document = window.document;
	globalThis.NodeFilter = window.NodeFilter;
	settings = { hoverDescriptionsEnabled: true, hoverDescriptionsDebilities: true };
	globalThis.game.settings = { get: (_ns, key) => settings[key] };
});

afterEach(() => {
	globalThis.document = saved.document;
	globalThis.NodeFilter = saved.NodeFilter;
	globalThis.game.settings = saved.settings;
	window.close();
});

/** A container holding `html`, run through the enhancer. */
function marked(html) {
	const root = window.document.createElement("div");
	root.innerHTML = html;
	markDebilityTooltips(root);
	return root;
}
const terms = root => [...root.querySelectorAll(".stonetop-debility-term")];

describe("a bare mention", () => {
	it("wraps each one with the book's summary from en.json, leaving the text around it as it was", () => {
		const root = marked("<p>Mark a debility, or clear all your debilities.</p>");
		expect(terms(root).map(t => t.textContent)).toEqual(["debility", "debilities"]);
		const tip = terms(root)[0].dataset.tooltip;
		expect(tip).toBe(globalThis.game.i18n.localize(DEBILITY_TOOLTIP_KEY));
		expect(tip).toContain("Weakened (+STR / +DEX), Dazed (+INT / +WIS), and Miserable (+CON / +CHA)");
		expect(root.textContent).toBe("Mark a debility, or clear all your debilities.");
	});

	it("keeps the case it was written in", () => {
		expect(terms(marked("<h3>Debilities</h3>")).map(t => t.textContent)).toEqual(["Debilities"]);
	});

	it("leaves a word that only starts the same alone", () => {
		expect(terms(marked("<p>A debilitating poison.</p>"))).toHaveLength(0);
	});
});

describe("the steading's own debilities", () => {
	it.each([
		"<p>Clear one of the steading's debilities.</p>",
		"<p>Clear one of the steading’s debilities.</p>",
		"<p>If the steading has no debilities, raise Fortunes.</p>",
		"<p>Mark a steading debility.</p>",
	])("are left alone: %s", html => {
		expect(terms(marked(html))).toHaveLength(0);
	});

	it("still wraps a character's mention when the steading is further back than three words", () => {
		expect(terms(marked("<p>When the steading is attacked you mark a debility.</p>"))).toHaveLength(1);
	});

	it("does not reach across punctuation to a steading earlier in the sentence", () => {
		expect(terms(marked("<p>When you return to the steading, mark a debility.</p>"))).toHaveLength(1);
	});

	// The qualifier is read inside the one text node: "steading" in its own <strong> is not seen.
	// Pinned as the known limit, so a change to it is a decision rather than an accident.
	it("cannot see a steading in a separate element", () => {
		expect(terms(marked("<p>The <strong>steading</strong> debility track.</p>"))).toHaveLength(1);
	});
});

describe("what it never touches", () => {
	it("skips links, form controls, code and the debility trackers", () => {
		const root = marked(`
			<a class="content-link">a debility link</a>
			<textarea>a debility in a textarea</textarea>
			<select><option>debility</option></select>
			<code>debility</code>
			<pre>debility</pre>
			<div class="stonetop-debilities"><span>debility box</span></div>
			<div class="steading-debilities-section"><span>Debilities</span></div>`);
		expect(terms(root)).toHaveLength(0);
	});

	it("skips a live journal editor but still marks its read-view sibling", () => {
		const root = marked(`
			<div class="ProseMirror" contenteditable="true"><p>mark a debility</p></div>
			<section><p>mark a debility</p></section>`);
		expect(terms(root)).toHaveLength(1);
		expect(terms(root)[0].closest("section")).not.toBeNull();
	});
});

describe("run again", () => {
	it("wraps nothing twice", () => {
		const root = marked("<p>Mark a debility.</p>");
		markDebilityTooltips(root);
		markDebilityTooltips(root);
		expect(terms(root)).toHaveLength(1);
		expect(root.querySelectorAll(".stonetop-debility-term .stonetop-debility-term")).toHaveLength(0);
	});
});

describe("the settings", () => {
	it("does nothing with the debility hovers switched off", () => {
		settings.hoverDescriptionsDebilities = false;
		expect(terms(marked("<p>Mark a debility.</p>"))).toHaveLength(0);
	});

	it("does nothing with every hover description switched off", () => {
		settings.hoverDescriptionsEnabled = false;
		expect(terms(marked("<p>Mark a debility.</p>"))).toHaveLength(0);
	});

	it("is on when neither setting has been saved yet", () => {
		settings = {};
		expect(terms(marked("<p>Mark a debility.</p>"))).toHaveLength(1);
	});

	it("tolerates a missing container", () => {
		expect(() => markDebilityTooltips(null)).not.toThrow();
	});
});
