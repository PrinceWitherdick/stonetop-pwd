import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Run an Expedition walkthrough, read the way a low-vision or screen-reader player meets it:
// a table using this system has a player who is around 90% blind. Each check is one that was
// failing before, pinned so it cannot quietly come back.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const MAIN = read("templates/dialogs/expedition.hbs");
const LOAD = read("templates/dialogs/partials/expedition-load.hbs");
const JOURNEY = read("templates/dialogs/partials/expedition-journey.hbs");
const CONTROLS = read("templates/dialogs/partials/expedition-journey-controls.hbs");
const CSS = read("styles/stonetop.css");

/** The opening tag of the first element carrying `cls`. */
function tagWith(html, cls) {
	const at = html.indexOf(cls);
	expect(at, cls).toBeGreaterThan(-1);
	return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

/** Every rule block whose selector names one of the walkthrough's own classes. */
function walkthroughRules() {
	const rules = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m;
	while ((m = re.exec(CSS))) {
		const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
		if (/\.stonetop-(exp|spring|journey)-/.test(selector)) rules.push({ selector, body: m[2] });
	}
	return rules;
}

describe("what a screen reader is told", () => {
	// On or off was a tick glyph and a strikethrough, neither of which is read out.
	it("says whether each trip chip and each asset is on", () => {
		expect(tagWith(LOAD, "stonetop-exp-load-chip")).toContain("aria-pressed=");
		expect(tagWith(MAIN, "stonetop-exp-asset-btn")).toContain("aria-pressed=");
	});

	it("names the icon-only controls", () => {
		expect(tagWith(MAIN, "stonetop-exp-chart-remove")).toContain("aria-label=");
		expect(tagWith(JOURNEY, "stonetop-journey-book")).toContain("aria-label=");
		expect(tagWith(CONTROLS, "fa-image-slash")).toMatch(/role="img"[^>]*aria-label=/);
	});

	it("does not read the decorative glyphs aloud", () => {
		expect(MAIN).toContain(`Done <span aria-hidden="true">✦</span>`);
		expect(LOAD).toContain(`<span class="tick" aria-hidden="true">`);
	});

	it("gives the step buttons an explicit type", () => {
		for (const cls of ["stonetop-spring-back", "stonetop-spring-next", "stonetop-spring-done"])
			expect(tagWith(MAIN, cls), cls).toContain(`type="button"`);
	});
});

describe("what a low-vision reader sees", () => {
	// The design tokens floor readable text at 0.9em. These rules size in rem-times-scale, so the
	// floor is checked on the rem figure.
	it("sizes no walkthrough text below the 0.9 floor", () => {
		const small = walkthroughRules()
			.flatMap(({ selector, body }) => [...body.matchAll(/font-size:\s*calc\((0?\.\d+)rem/g)]
				.filter(([, n]) => Number(n) < 0.9)
				.map(([, n]) => `${selector}: ${n}rem`));
		expect(small).toEqual([]);
	});

	it("keeps readable words off the faintest ink", () => {
		for (const sel of [".stonetop-exp-load-fol {", ".stonetop-exp-load-move .rq {"]) {
			const rule = walkthroughRules().find(r => r.selector.endsWith(sel.slice(0, -2)));
			expect(rule?.body, sel).not.toContain("--st-text-faint");
		}
	});

	// The high-contrast skin re-points tokens; a literal is a colour it cannot reach.
	it("colours the roll results with tokens the high-contrast skin re-points", () => {
		for (const tier of ["success", "partial", "failure"]) {
			const rules = walkthroughRules().filter(r => r.selector.endsWith(`stonetop-spring--${tier}`));
			expect(rules.length, tier).toBeGreaterThan(0);
			for (const r of rules) expect(r.body, r.selector).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(/i);
		}
	});

	it("rings the transparent controls when the keyboard lands on them", () => {
		const selectors = walkthroughRules().map(r => r.selector).join("\n");
		expect(selectors).toContain(".stonetop-exp-asset-btn:focus-visible");
		expect(selectors).toContain(".stonetop-exp-load-chip:focus-visible");
		expect(selectors).toContain("li:has(.stonetop-journey-row:focus-visible)");
	});
});
