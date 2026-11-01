import { describe, expect, it } from "vitest";
import { declarations, ownRule, readCss } from "../fakes/css.js";
import { contrastRatio, ratioText } from "../fakes/contrast.js";

// The black sheet of a PC past death (audit round 3, LV-1). Its move cards' tier labels kept the
// parchment inks, about 1.7 to 2.5:1 on the black, until the sheet's own block re-inked them the way
// the insert chat cards do. Every tab reads the tokens from that one block, so the block is checked.

const CSS = readCss();
const SHEET = ".vtt .stonetop.app.stonetop-past-death.window-app .window-content";

/** Every `--custom-property: value` a rule body declares, as a Map. */
function customProperties(body) {
	const out = new Map();
	for (const m of (body ?? "").matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out.set(m[1].trim(), m[2].trim());
	return out;
}

const sheet = customProperties(ownRule(CSS, SHEET));
// The sheet's panel, and a move card on it: the card's white lift (--st-card-fill, 5.5%) over 12%.
const PANEL = sheet.get("--stonetop-bg");
const CARD = "hsl(0 0% 17%)";
const INKS = ["--st-tier-failure-text", "--st-tier-partial-text", "--st-tier-success-text", "--st-gold-text"];

describe("a past-death sheet's move-card inks", () => {
	it("are re-inked on the sheet itself, not left at their parchment values", () => {
		expect(PANEL, "the past-death sheet no longer names its panel").toBe("hsl(0 0% 12%)");
		for (const name of INKS) expect(sheet.has(name), `${name} inherits its parchment ink`).toBe(true);
	});

	it("clear 4.5:1 on the panel and on a card", () => {
		for (const name of INKS) {
			const ink = sheet.get(name);
			for (const ground of [PANEL, CARD]) {
				expect(contrastRatio(ink, ground), `${name} (${ink}) is ${ratioText(ink, ground)} on ${ground}`)
					.toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("give a love letter, which stays cream paper on the black sheet, its paper inks back", () => {
		// Live, 2026-10-28: the lifted inks reached the letter and read 2.0 to 2.7:1 on its cream.
		// The letter declares its paper inks on itself (light mode only), so the sheet's lifted ones
		// stop at its edge without the sheet having to know letters exist.
		const letter = customProperties(declarations(CSS, ":root:not(.stonetop-dark) .tab.moves .stonetop-item.stonetop-love-letter"));
		const paper = "#f6f1e6"; // the letter's --tc-paper
		for (const name of INKS) expect(letter.has(name), `${name} reaches the letter at the black sheet's lifted value`).toBe(true);
		for (const name of INKS.slice(0, 3)) {
			expect(contrastRatio(letter.get(name), paper), `${name} on the letter`).toBeGreaterThanOrEqual(4.5);
		}
		// Gold goes back to the value every parchment surface uses; it is no worse here than there.
		expect(letter.get("--st-gold-text")).toBe("#8a6d12");
	});

	it("keep the high-contrast mode's own tier stops on black paper", () => {
		const hc = customProperties(ownRule(CSS, `:root.stonetop-high-contrast ${SHEET}`));
		for (const name of INKS.slice(0, 3)) {
			expect(hc.has(name), `${name} falls back to the sheet's lifted ink under high contrast`).toBe(true);
			expect(contrastRatio(hc.get(name), PANEL)).toBeGreaterThanOrEqual(7);
		}
	});
});
