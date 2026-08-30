import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readCss, readRepo, splitSelectorList } from "../fakes/css.js";
import { fakeEl } from "../fakes/dom.js";
import { applySheetContrast, applySheetTexture, applyNoItalics } from "../../module/settings.js";
import { PREFERENCE_GROUPS, PREFERENCE_KEYS, GM_ONLY_KEYS } from "../../module/utils/sheet-preferences.js";

/**
 * The three accessibility settings, and the join between the switch and the paint.
 *
 * Both of them work the same way `reduceMotion` does: a client setting whose whole effect is a
 * class on `document.documentElement`, with a block in the stylesheet answering to that class.
 * Which means the feature is a NAME agreed between two files and asserted by neither. Rename the
 * class on either side and nothing throws, nothing logs, no test fails, and the only symptom is
 * that a reader who is 90% blind turns High Contrast on and their sheet does not change. That is
 * the failure these guards exist for; the ratios themselves are checked in
 * tests/styles/high-contrast.test.js.
 *
 * The other half is reachability. A client that stored "high" last session has to load in the
 * palette it stored, and `onChange` only fires when somebody CHANGES a setting — so the apply
 * calls have to be in the `ready` block beside the font ones, or the mode is on in the settings
 * window and off on the screen until the reader touches the control again.
 *
 * `noItalics` is guarded here too, and carries one guard the other two do not need: its stylesheet
 * block has to reach ELEMENTS and not only the root. `font-style` inherits, so a rule on `:root`
 * alone would look right in a spot check and leave every one of the ~190 places this file sets
 * `font-style: italic` on the element ITSELF still slanted — which is most of what a reader
 * would have turned the setting on to be rid of.
 */

// Comment-stripped, from the shared reader: a commented-out rule must not answer for a live
// one, and the paragraphs in this stylesheet are long enough to contain most of the strings
// asserted below — "nothing answers to .stonetop-no-texture" would otherwise pass on prose.
const CSS = readCss();
const SETTINGS_SRC = readRepo("module/settings.js");
const READY_SRC = readRepo("module/hooks/Ready.js");

/** The class list on the fake root, as the apply functions have left it. */
const rootClasses = () => globalThis.document.documentElement.classes;

let saved;
beforeEach(() => {
	saved = globalThis.document;
	// The smallest `document` these functions can be exercised against — they call nothing on it
	// but `documentElement.classList.toggle`, which the shared element fake already models.
	globalThis.document = { documentElement: fakeEl() };
});
afterEach(() => {
	globalThis.document = saved;
});

describe("applySheetContrast", () => {
	it("puts the high-contrast class on the document root", () => {
		applySheetContrast("high");
		expect(rootClasses().includes("stonetop-high-contrast")).toBe(true);
	});

	// Compared against the one value that means "on", so a retired or unreadable setting lands on
	// the normal palette rather than on a half-applied one.
	it("takes it off again for anything that is not \"high\"", () => {
		for (const value of ["high", "normal", "", undefined, null, "HIGH", 0, "dark"]) {
			applySheetContrast(value);
			expect(rootClasses().includes("stonetop-high-contrast"), String(value))
				.toBe(value === "high");
		}
	});
});

describe("applySheetTexture", () => {
	// Keyed on the class being ABSENT from the normal case, so the markup carries a class only for
	// the reader who has turned something off.
	it("marks the root only when the grain is off", () => {
		applySheetTexture(true);
		expect(rootClasses().includes("stonetop-no-texture")).toBe(false);
		applySheetTexture(false);
		expect(rootClasses().includes("stonetop-no-texture")).toBe(true);
	});
});

describe("applyNoItalics", () => {
	// The opposite way round from `applySheetTexture`: the class marks the reader who HAS asked for
	// this, so a client that has not is carrying nothing.
	it("marks the root only when italics are off", () => {
		applyNoItalics(true);
		expect(rootClasses().includes("stonetop-no-italics")).toBe(true);
		applyNoItalics(false);
		expect(rootClasses().includes("stonetop-no-italics")).toBe(false);
	});

	it("takes anything falsy for off", () => {
		for (const value of [undefined, null, 0, ""]) {
			applyNoItalics(value);
			expect(rootClasses().includes("stonetop-no-italics"), String(value)).toBe(false);
		}
	});
});

describe("the class names the stylesheet is waiting for", () => {
	// The join. Each of these is one string agreed between a `classList.toggle` and a selector,
	// and a mismatch is silent on both sides.
	it("matches every class the apply functions set to a rule that paints it", () => {
		for (const name of ["stonetop-high-contrast", "stonetop-no-texture", "stonetop-no-italics"]) {
			expect(SETTINGS_SRC, `${name} is not set by settings.js`)
				.toContain(`classList.toggle("${name}"`);
			expect(CSS, `${name} is set but nothing in the stylesheet answers to it`)
				.toContain(`:root.${name}`);
		}
	});
});

describe("reaching the reader who already stored a value", () => {
	it("applies both on load, beside the font settings", () => {
		const block = /export async function onReady\(\)\s*\{([\s\S]{0,1500})/.exec(READY_SRC);
		expect(block, "onReady not found — did Ready.js reorganize?").not.toBeNull();
		expect(block[1]).toContain('applySheetContrast(getSetting("sheetContrast"))');
		expect(block[1]).toContain('applySheetTexture(getSetting("sheetTexture"))');
		expect(block[1]).toContain('applyNoItalics(getSetting("noItalics"))');
		// And they are imported, or the call above is a ReferenceError at `ready`.
		expect(READY_SRC).toMatch(/import\s*\{[^}]*applySheetContrast[^}]*\}\s*from\s*"\.\.\/settings\.js"/s);
		expect(READY_SRC).toMatch(/import\s*\{[^}]*applySheetTexture[^}]*\}\s*from\s*"\.\.\/settings\.js"/s);
		expect(READY_SRC).toMatch(/import\s*\{[^}]*applyNoItalics[^}]*\}\s*from\s*"\.\.\/settings\.js"/s);
	});
});

describe("where a player finds them", () => {
	// The reason the Preferences tab exists is that the options a player actually wants are the
	// ones hardest to reach. These two are the ones a low-vision reader came for, so they sit with
	// the text size in a group of their OWN, named for what it is and drawn first — not filed
	// under "Look and Feel", where someone who cannot read the sheet has no reason to look.
	it("offers both in the Accessibility group at the top of the tab", () => {
		const access = PREFERENCE_GROUPS.find(group => group.id === "accessibility");
		expect(access, "the accessibility group is gone").toBeTruthy();
		expect(PREFERENCE_GROUPS[0].id, "accessibility is not the first group drawn")
			.toBe("accessibility");
		for (const key of ["sheetFontScale", "sheetContrast", "sheetTexture", "noItalics"]) {
			expect(access.keys, `${key} is not offered on the tab`).toContain(key);
			expect(PREFERENCE_KEYS.has(key), `${key} is not writable from the tab`).toBe(true);
			expect(GM_ONLY_KEYS.has(key), `${key} must not be GM-only`).toBe(false);
		}
		// Size first, then the two that decide whether the text is legible at all.
		const order = access.keys;
		expect(order.indexOf("sheetFontScale")).toBeLessThan(order.indexOf("sheetContrast"));
		expect(order.indexOf("sheetContrast")).toBeLessThan(order.indexOf("sheetTexture"));
		// The two "take this treatment off" switches together, and both above `reduceMotion`.
		expect(order.indexOf("sheetTexture")).toBeLessThan(order.indexOf("noItalics"));
		expect(order.indexOf("noItalics")).toBeLessThan(order.indexOf("reduceMotion"));
		// And none of them left behind among the matters of taste.
		const appearance = PREFERENCE_GROUPS.find(group => group.id === "appearance");
		for (const key of access.keys) {
			expect(appearance?.keys ?? [], `${key} is listed twice`).not.toContain(key);
		}
	});
});

describe("the registrations", () => {
	/** The options object of one `game.settings.register(SYSTEM_ID, "<key>", { … })` block. */
	function registration(key) {
		const at = SETTINGS_SRC.indexOf(`game.settings.register(SYSTEM_ID, "${key}", {`);
		expect(at, `${key} is not registered`).toBeGreaterThan(-1);
		return SETTINGS_SRC.slice(at, SETTINGS_SRC.indexOf("\n\t});", at));
	}

	// Client scope is not a detail: a world-scoped setting written from a player's sheet is
	// rejected on their client and applied for EVERYONE on a GM's. A reader's own palette is
	// theirs, and it has to be theirs on every world this browser opens.
	it("registers both per client, visible in the settings window, and wired to an apply", () => {
		for (const [key, apply] of [["sheetContrast", "applySheetContrast"],
			["sheetTexture", "applySheetTexture"], ["noItalics", "applyNoItalics"]]) {
			const body = registration(key);
			expect(body, `${key} is not client-scoped`).toMatch(/scope:\s*"client"/);
			expect(body, `${key} is hidden from the settings window`).toMatch(/config:\s*true/);
			expect(body, `${key} repaints nothing when it changes`).toContain(`${apply}(value)`);
			expect(body, `${key} has no default`).toMatch(/default:/);
		}
	});

	// Nobody who has not been bothered by the parchment should have to go and turn it back on,
	// and nobody should find their sheets repainted by an upgrade they did not ask for.
	it("leaves a table that has not asked for anything exactly where it was", () => {
		expect(registration("sheetContrast")).toMatch(/default:\s*"normal"/);
		expect(registration("sheetTexture")).toMatch(/default:\s*true/);
		// Off, for a reason worth stating: italic IS the emphasis in most of the prose this system
		// ships, and nobody should have it flattened by an upgrade they did not ask for.
		expect(registration("noItalics")).toMatch(/default:\s*false/);
	});

	// A choice rather than a checkbox, because the palette is the axis: a light-on-dark option
	// belongs here as a third value, not as a second setting kept exclusive with this one by hand.
	it("shapes the contrast setting as a choice", () => {
		const body = registration("sheetContrast");
		expect(body).toMatch(/type:\s*String/);
		expect(body).toMatch(/choices:\s*\{/);
		expect(body).toContain('"normal": "stonetop.settings.sheetContrast.normal"');
		expect(body).toContain('"high":   "stonetop.settings.sheetContrast.high"');
	});
});

// ── "No Italic Text": reach, which is the whole of whether it works ────────────────────

describe("the reach of the no-italics rule", () => {
	/** Every rule in the stylesheet keyed on `.stonetop-no-italics`. `CSS` is already stripped. */
	const RULES = (() => {
		const out = [];
		for (const m of CSS.matchAll(/([^{}]*\.stonetop-no-italics[^{}]*)\{([^{}]*)\}/g)) {
			out.push({ prelude: m[1].trim(), body: m[2] });
		}
		return out;
	})();

	/**
	 * Every selector entry across all of those rules, split by the shared scanner — which steps
	 * over the commas inside `:is(…)` and normalizes a selector wrapped across two lines, so an
	 * entry answers to the one-line spelling the assertions below ask with.
	 */
	const ENTRIES = RULES.flatMap(rule => splitSelectorList(rule.prelude));

	/**
	 * The same entries with the `:is(…)` weight clause taken out.
	 *
	 * That clause exists only to carry specificity (see the stylesheet), and leaving it in means
	 * every assertion below has to spell it out — which would make them a test of how the weight
	 * is bought rather than of what the rule reaches. The one test that DOES care about it reads
	 * the raw entries instead.
	 */
	const NORMALIZED = ENTRIES.map(entry => entry.replace(/:is\([^)]*\)/g, ""));

	it("has rules at all", () => {
		expect(RULES.length, "nothing in the stylesheet answers to .stonetop-no-italics")
			.toBeGreaterThan(0);
	});

	// THE FIRST SILENT FAILURE. `font-style` inherits, so a rule on the root alone un-slants the
	// prose that INHERITED its italic and leaves every element declaring `font-style: italic` on
	// itself untouched — a declaration on an element always beats one inherited from an ancestor.
	it("matches elements and generated content, not just the root", () => {
		for (const shape of [":root.stonetop-no-italics",
			":root.stonetop-no-italics *",
			":root.stonetop-no-italics *::before",
			":root.stonetop-no-italics *::after"]) {
			expect(NORMALIZED, `nothing reaches ${shape}`).toContain(shape);
		}
	});

	// THE SECOND, and the one that shipped broken: `*` does not match a pseudo-element, and a
	// declaration made directly ON one beats the value it would otherwise inherit from the element
	// it belongs to. An italic `::placeholder` (ours in the onboarding dialog, core's on
	// #chat-message, and more from modules) therefore survived the first version of this block
	// entirely — which is what a reader saw as "it works on the character sheet but not elsewhere".
	it("reaches the text-bearing pseudo-elements", () => {
		for (const pseudo of ["::placeholder", "::marker", "::first-line", "::first-letter"]) {
			expect(NORMALIZED, `no rule reaches ${pseudo}`)
				.toContain(`:root.stonetop-no-italics *${pseudo}`);
		}
	});

	// And each in a rule of its OWN. One pseudo-element a browser does not recognise invalidates
	// the entire selector list it appears in, so bundling them would let one unknown name take the
	// whole feature down rather than only itself.
	it("keeps each pseudo-element in a rule of its own", () => {
		for (const rule of RULES) {
			const pseudos = [...rule.prelude.matchAll(/::[a-z-]+/g)]
				.map(m => m[0]).filter(pe => pe !== "::before" && pe !== "::after");
			expect(new Set(pseudos).size, `bundled pseudo-elements: ${rule.prelude}`)
				.toBeLessThan(2);
		}
	});

	// THE THIRD. `!important` settles ties against ordinary rules, but between two `!important`
	// author declarations SPECIFICITY decides — and the plain `:root.stonetop-no-italics *` form
	// weighs only (0,2,0). A competing Stonetop system is installed as a MODULE on the maintainer's
	// Foundry and italicises at (0,7,1) with `!important` throughout, which beat it outright. The
	// `:is(#…, .stonetop-no-italics)` clause buys ID-level weight without changing what matches,
	// so every entry has to carry it or that entry is the weak one.
	it("carries the weight clause on every entry", () => {
		for (const entry of ENTRIES) {
			expect(entry, `no weight clause, so this entry is out-specified at (0,2,0): ${entry}`)
				.toMatch(/:is\(#[\w-]+,\s*\.stonetop-no-italics\)/);
		}
	});

	it("declares font-style: normal !important, and nothing else at all", () => {
		for (const rule of RULES) {
			expect(rule.body).toMatch(/font-style:\s*normal\s*!important\s*;/);
			// ONE property per rule. This is the file's deliberate unscoped `!important`, and it is
			// defensible only while it stays this small: a second property here would repaint the
			// whole client with nothing able to override it.
			const props = [...rule.body.matchAll(/([a-z-]+)\s*:/g)].map(m => m[1]);
			expect(props).toEqual(["font-style"]);
		}
	});

	// `::selection` accepts only colour and decoration properties, so `font-style` inside it is
	// dropped by the browser. Listing it would read as coverage while doing nothing.
	it("does not pretend to reach ::selection", () => {
		expect(ENTRIES.some(entry => entry.includes("::selection"))).toBe(false);
	});

	// The system's own italics are what a reader turning this on is looking at. If the stylesheet
	// ever stopped setting any, the rule would be answering a question nobody is asking, and a
	// count is the only thing that would say so.
	it("still has italics to turn off", () => {
		const italics = [...CSS.matchAll(/font-style:\s*italic/g)].length;
		expect(italics, "no italic declarations left; is this setting still needed?")
			.toBeGreaterThan(100);
	});

	// The specific rules that caught this out, pinned so a tidy-up cannot quietly delete the
	// evidence that italic placeholders exist in our own stylesheet.
	it("still has the italic placeholders that exposed the gap", () => {
		const placeholders = [...CSS.matchAll(/::placeholder\s*\{[^}]*font-style:\s*italic/g)];
		expect(placeholders.length).toBeGreaterThan(0);
	});
});

describe("what the no-italics row says", () => {
	const EN = JSON.parse(readRepo("languages/en.json"));

	// The tab reads its label and hint off the REGISTRATION, so a missing string does not throw:
	// it draws the raw key path as the row's label.
	it("localizes the name and hint", () => {
		expect(EN.stonetop.settings.noItalics?.name).toBeTruthy();
		expect(EN.stonetop.settings.noItalics?.hint).toBeTruthy();
	});

	// The two things about this setting a reader cannot discover by trying it: that it reaches
	// past our own windows, and that turning it on costs them a distinction. Both are promises
	// made in prose about behaviour asserted above, so both are pinned.
	it("says it reaches the whole client, and what that costs", () => {
		const hint = EN.stonetop.settings.noItalics.hint;
		expect(hint).toMatch(/everywhere in Foundry/i);
		expect(hint).toMatch(/read the same as the text around them/i);
	});
});
