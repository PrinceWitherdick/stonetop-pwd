import { describe, expect, it } from "vitest";
import { declarations, declared, readCss, readRepo } from "../fakes/css.js";

/**
 * Every chip centres its label by TRIMMING the label's line box to its cap band, never by nudging.
 *
 * A chip that centres an untrimmed line box is at the mercy of the font's ascent and descent, which
 * Blink rounds to whole pixels: measured from rendered pixels across UI font sizes 12-24px, the same
 * label moved by up to 2.4px about its chip's centre from one size to the next, so any nudge tuned at
 * one size was a pixel out at another. That is how the sheet came to have a dozen chips each carrying
 * its own hand-measured correction, and most of them still visibly off at the user's UI font size.
 *
 * The fix is one mechanism, and this file holds its pieces together:
 *  - the TOKENS in :root rebuild a trimmed line box's height as padding, with one constant lift;
 *  - a text-only chip trims ITSELF (inline-block, not inline-flex: an anonymous flex item takes no
 *    `text-box`) and pads with both tokens;
 *  - a chip with an icon or a count trims its LABEL ELEMENT, so every such label must be an element,
 *    in every template that renders one;
 *  - its ICON sits at a whole-pixel font-size, because Font Awesome's metrics round the same way.
 */

const CSS = readCss();
const TRIM = /text-box:\s*trim-both cap alphabetic/;
const PADS = /var\(--st-trim-top\)[\s\S]*var\(--st-trim-bottom\)/;

/** The body of the one @supports fallback block, or undefined. */
const FALLBACK = CSS.match(/@supports not \(text-box: trim-both cap alphabetic\)\s*\{([\s\S]*?\})\s*\}/)?.[1];

/** The stylesheet with that fallback block taken out, so a value it zeroes cannot answer for the real rule. */
const MAIN = FALLBACK ? CSS.replace(FALLBACK, "") : CSS;

describe("the chip-centring tokens", () => {
	const root = declarations(MAIN, ":root");

	it("rebuild the trimmed line box from the reader's own lh and cap", () => {
		expect(declared(root, "--st-trim-top")).toBe("calc((1lh - 1cap) / 2 + var(--st-caps-trim-nudge))");
		expect(declared(root, "--st-trim-bottom")).toBe("calc((1lh - 1cap) / 2 - var(--st-caps-trim-nudge))");
	});

	it("lift every face by the one constant the pixel sweep found", () => {
		// -0.020em Signika, -0.015em Libre Caslon, -0.028em IM Fell English, at every weight.
		expect(declared(root, "--st-caps-trim-nudge")).toBe("-0.02em");
	});

	it("is a constant, not a per-face table the settings write at runtime", () => {
		// An inline copy on :root would override the constant every chip reads.
		const settings = readRepo("module/settings.js");
		expect(settings).not.toContain("_FONT_CAPS_TRIM_NUDGE");
		expect(settings).not.toContain('"--st-caps-trim-nudge"');
	});

	it("zeroes both tokens where text-box is unsupported, so nothing grows", () => {
		expect(FALLBACK, "the @supports fallback is gone").toBeTruthy();
		expect(FALLBACK).toMatch(/--st-trim-top:\s*0px/);
		expect(FALLBACK).toMatch(/--st-trim-bottom:\s*0px/);
	});
});

describe("text-only chips trim themselves", () => {
	const SELF = [
		".stonetop-stat-boost-chip",
		".stonetop-instinct-temporary-badge",
		".stonetop-move-roll-chip",
		".stonetop-add-item-chip",
		".deaths-door-mark-chip",
		".stonetop-year-chip",
		".steading-improvement-custom-tag",
		".stonetop-onboarding-origin-label",
		".onboard-name-chip",
		".stonetop-onboarding-move-chip",
		".stonetop-levelup-move-chip",
		".stonetop-onboarding-possession-badge",
		".stonetop-call-up-dialog .stonetop-cu-preview-tag",
		".stonetop-follower-tag",
		".stonetop-monster-org-pill",
		".stonetop-cf-tag",
		".stonetop-cf-chip",
		".stonetop-cf-preview-tag",
		".stonetop .threat-themes__item",
		".stonetop .threat-suggested__chip",
		".stonetop-expedition-dialog .stonetop-exp-load-pill",
		".stonetop-journey-canvas .stonetop-journey-tag",
		".stonetop-rel-lane-count",
		".stonetop-fight-badge",
		".stonetop-steading-plan button.spe-prompt",
	];

	it.each(SELF)("%s trims and pads with both tokens", sel => {
		const body = declarations(MAIN, sel);
		expect(body, `${sel} has no rule`).toBeTruthy();
		expect(body).toMatch(TRIM);
		expect(declared(body, "padding")).toMatch(PADS);
		// A flex chip's bare text is an anonymous flex item, which ignores the trim.
		expect(declared(body, "display") ?? "").not.toMatch(/flex/);
	});

	it("drops the old hand-measured nudges they carried", () => {
		expect(CSS).not.toContain("--stonetop-chip-caps-nudge");
		expect(CSS).not.toContain("--stonetop-roll-chip-caps-nudge");
	});

	it("keeps the move roll chip on a whole-pixel height", () => {
		// The trimmed cap band is fractional; the pinned height stops it making the chip fractional.
		expect(declared(declarations(MAIN, ".stonetop-move-roll-chip"), "height")).toBe("calc(1lh + 4px)");
	});

	it("keeps the fight tab's count badge on a whole-pixel height", () => {
		// Same snap, but rounded from `1.5em`: the badge inherits its size from the row it sits in,
		// so there is no font-size expression here to round the way the move roll chip rounds one.
		const body = declarations(MAIN, ".stonetop-fight-badge");
		expect(declared(body, "line-height")).toBe("round(1.5em, 1px)");
		expect(declared(body, "height")).toBe("calc(1lh + 2px)");
	});

	it("puts the fight badge back on flex centring where text-box is unsupported", () => {
		expect(FALLBACK).toMatch(/\.stonetop-fight-badge\s*\{[^}]*display:\s*inline-flex/);
	});

	it("takes the base tag's trim back off the exceptional toggle, whose span trims instead", () => {
		const body = declarations(MAIN, ".stonetop-follower-tag.stonetop-exceptional-toggle");
		expect(declared(body, "text-box")).toBe("none");
		expect(declared(body, "padding")).toBe("1px 8px");
	});
});

describe("chips with an icon or a count trim their label element", () => {
	const LABELS = [
		".stonetop-chip-text",
		".steading-improvement-filter > span",
		".stonetop-catalog-filter > span",
		".stonetop-invocation-chip-name",
		".stonetop-inspiration-chip-name",
		".stonetop-rapport-chip-name",
		".stonetop-reminder-chip-text",
		".stonetop .create-monster .cm-move-suggestion > span",
		".stonetop-person-picker-chip-name",
		".stonetop-timeline-entry-linked-text",
		".stonetop-expedition-dialog .stonetop-exp-load-move > span",
		".stonetop-expedition-dialog .stonetop-exp-load-chip .tick",
		".stonetop-people-gallery .stonetop-people-count",
		".stonetop-arcanum-edit .stonetop-arc-chip-label",
		// Button and tab labels beside an icon or in a padded box: once hand-lifted 0.048em for Libre
		// Caslon's line box, now trimmed (the font fixes its own line box; Blink still floors leading).
		".stonetop-welcome-create-label",
		".stonetop-relmap-tool > span",
		".pbta.sheet .sheet-tabs:not(.stonetop-tab-rail) .item .stonetop-tab-label",
	];

	it.each(LABELS)("%s trims and pads with both tokens", sel => {
		const body = declarations(MAIN, sel);
		expect(body, `${sel} has no rule`).toBeTruthy();
		expect(body).toMatch(TRIM);
		expect(declared(body, "padding-top")).toBe("var(--st-trim-top)");
		expect(declared(body, "padding-bottom")).toBe("var(--st-trim-bottom)");
	});

	/** Every element carrying `chipClass` in `src` has a `.stonetop-chip-text` label inside it. */
	function everyChipWrapped(src, chipClass, tag) {
		const re = new RegExp(String.raw`<${tag}\b[^>]*class="[^"]*\b${chipClass}\b[^"]*"[^>]*>([\s\S]*?)</${tag}>`, "g");
		const chips = [...src.matchAll(re)];
		return { count: chips.length, bare: chips.filter(m => !m[1].includes('class="stonetop-chip-text"')).map(m => m[0]) };
	}

	it.each([
		["templates/dialogs/order-followers.hbs", "stonetop-of-tag", "button", 2],
		["templates/dialogs/create-follower.hbs", "stonetop-cf-chosen-tag", "button", 2],
		["templates/dialogs/npc-to-follower.hbs", "stonetop-cf-chosen-tag", "button", 1],
		["templates/dialogs/monster-to-follower.hbs", "stonetop-cf-chosen-tag", "button", 1],
		["templates/dialogs/partials/expedition-load.hbs", "stonetop-exp-load-chip", "button", 1],
		["templates/dialogs/people-gallery.hbs", "stonetop-people-chip", "button", 10],
		// The fallen card's, and a custom group's roster row marked fallen at the group's floor.
		["templates/actor/partials/tab-followers.hbs", "stonetop-follower-dead-badge", "span", 2],
		["templates/actor/partials/tab-followers.hbs", "stonetop-exceptional-toggle", "button", 1],
		// Veteran Crew's "tags owed" cue, a flex chip with a hand icon.
		["templates/actor/partials/tab-followers.hbs", "stonetop-crew-tags-owed", "span", 1],
		["templates/dialogs/partials/catalog-shell.hbs", "stonetop-catalog-badge", "span", 1],
	])("wraps every label in %s (.%s)", (file, chipClass, tag, count) => {
		const { count: found, bare } = everyChipWrapped(readRepo(file), chipClass, tag);
		expect(found, `expected ${count} ${chipClass} in ${file}`).toBe(count);
		expect(bare).toEqual([]);
	});

	it("wraps every reminder chip's label, and keeps the row a gap-spaced list with no entry margin", () => {
		const src = readRepo("templates/actor/partials/reminder-chips.hbs");
		const chips = [...src.matchAll(/<li class="stonetop-reminder-chip [^"]*"[^>]*>([\s\S]*?)<\/li>/g)];
		expect(chips.length).toBe(1);
		expect(chips[0][1]).toContain('<span class="stonetop-reminder-chip-text">');
		const row = declarations(MAIN, ".stonetop-reminder-chips");
		expect(declared(row, "display")).toBe("flex");
		expect(declared(row, "gap")).toBeTruthy();
		expect(declared(declarations(MAIN, ".stonetop-reminder-chip"), "margin")).toBe("0");
		expect(declared(declarations(MAIN, ".stonetop-reminder-chip-slot"), "margin")).toBe("0");
	});

	// The character header runs the chips on after the appearance line's last word (measured 10-20 with the
	// text-centring audit: chip caps 0.08px off the line's at 1x/1.25x/1.5x; `flex-start` put them 1.06px low).
	it("runs the header's chips on the appearance line, centred and gap-spaced", () => {
		const header = readRepo("templates/actor/partials/actor-header.hbs");
		const row = header.match(/<div class="stonetop-appearance-row">([\s\S]*?)<\/div>/)?.[1];
		expect(row, "the appearance row is gone from actor-header.hbs").toBeTruthy();
		expect(row).toContain('<p class="stonetop-appearance-summary">');
		expect(row).toContain('{{> "stonetop.reminder-chips"');
		const body = declarations(MAIN, ".stonetop-appearance-row");
		expect(declared(body, "display")).toBe("flex");
		expect(declared(body, "flex-wrap")).toBe("wrap");
		expect(declared(body, "align-items")).toBe("center");
		expect(declared(body, "gap")).toBeTruthy();
		expect(declared(declarations(MAIN, ".stonetop-appearance-row > .stonetop-reminder-chips"), "display")).toBe("contents");
		expect(declared(declarations(MAIN, ".stonetop-appearance-row > .stonetop-appearance-summary"), "margin")).toBe("0");
	});

	// The "+" and a typed chip's x are icon-only buttons: no label to trim, so neither may carry the trim
	// a flex box would ignore. Their glyphs are sized by the chip's own icon rule (whole pixels, below).
	it("keeps the reminder row's icon-only buttons untrimmed", () => {
		for (const sel of [".stonetop-reminder-chips button.stonetop-reminder-chip--add", ".stonetop-reminder-chip button.stonetop-reminder-chip-remove"]) {
			const body = declarations(MAIN, sel);
			expect(body, `${sel} has no rule`).toBeTruthy();
			expect(body).not.toMatch(TRIM);
		}
	});

	// No trim reaches an input's text. The Libre Caslon Text @font-face now centres its line box on the
	// capitals, but the chip's whole-pixel line leaves ~1px of leading whose top half Blink floors to a
	// whole pixel, so the padding still lowers the words: geometric -0.36/+0.09/-0.02px at roots 14/16/20
	// with it, -0.90/-0.53/-0.79px without (Signika and IM Fell English improve with it too).
	it("lowers the reminder input's typed words onto the cap band with its padding", () => {
		const body = declarations(MAIN, ".stonetop-reminder-chips input.stonetop-reminder-chip--input");
		expect(declared(body, "padding")).toBe("calc(1px + 0.048em) 9px calc(1px - 0.048em)");
	});

	it("wraps the roll card's kind badge label where it is built", () => {
		const chat = readRepo("module/utils/chat.js");
		const fn = chat.match(/export function rollKindBadge[\s\S]*?\n\}/)?.[0];
		expect(fn, "rollKindBadge is gone from chat.js").toBeTruthy();
		expect(fn).toContain('<span class="stonetop-chip-text">');
	});
});

// An icon-and-label button with no trim centres its row by flex on the font's own balanced line box
// (measured 10-19 with the text-centring audit: within 0.7px at 1x/1.25x/1.5x). What would break that is a
// hand nudge, so each keeps flex centring and even top and bottom padding.
describe("icon-and-label buttons centre by flex, unnudged", () => {
	it.each([
		".stonetop-steading-plan button.spe-req-add",
		".steading-plan-add",
		".stonetop-love-letter-send",
		".stonetop-love-letter-resend",
		// Text-only, on the same balanced line box: Introductions' Un-pass and an answer's Save / Cancel.
		".stonetop-intros-unpass",
		".stonetop-intros-recorded-save",
		".stonetop-intros-recorded-cancel",
		// The Post-Death tab's outcome buttons, the Favor row's (+1 Favor, the tentacle, the maw) among them
		// (measured 10-28 with the text-centring audit: -0.2px at 1x/1.25x/1.5x).
		".stonetop-pdi-outcome-btn",
	])("%s", sel => {
		const body = declarations(MAIN, sel);
		expect(body, `${sel} has no rule`).toBeTruthy();
		expect(declared(body, "display")).toMatch(/flex/);
		expect(declared(body, "align-items")).toBe("center");
		const [top, , bottom = top] = (declared(body, "padding") ?? "0").split(/\s+/);
		expect(bottom).toBe(top);
	});
});

// Measured 10-28 with the text-centring audit: the Bolster card's icon-and-label button -0.5px (row) at
// 1x/1.25x/1.5x on core's button, and Death's Door's gold "Suggested" tag is plain text inside its fate button,
// with no box to centre in. What would break either is a hand nudge, so neither may carry one.
describe("the Bolster button and the Suggested tag carry no hand nudge", () => {
	it.each([
		".stonetop-special-move-card button",
		".deaths-door-fate-dictated",
	])("%s", sel => {
		const body = declarations(MAIN, sel);
		expect(body, `${sel} has no rule`).toBeTruthy();
		for (const prop of ["top", "bottom", "transform", "translate", "padding-top", "padding-bottom", "vertical-align"]) {
			expect(declared(body, prop) ?? null, `${sel} sets ${prop}`).toBeNull();
		}
		const [top, , bottom = top] = (declared(body, "padding") ?? "0").split(/\s+/);
		expect(bottom).toBe(top);
	});

	it("draws the Bolster button on the special-move card, under the rule above", () => {
		const src = readRepo("templates/actor/partials/tab-special-moves.hbs");
		expect(src).toMatch(/<div class="stonetop-special-move-card">[\s\S]*?<button type="button" class="stonetop-bolster-open-btn">/);
	});
});

describe("chip icons sit at a whole-pixel size", () => {
	const ICONS = [
		".stonetop-roll-card-badge i",
		".stonetop-dead-tag i",
		".stonetop-condemned-tag i",
		".stonetop-invocation-chip i",
		".steading-improvement-filter > i",
		".stonetop-catalog-filter > i",
		".stonetop-catalog-badge > i",
		".stonetop-cf-chosen-tag i",
		".stonetop .create-monster .cm-move-suggestion i",
		".stonetop-person-picker-chip i",
		".stonetop-order-followers-dialog .stonetop-of-tag i",
		".stonetop-follower-dead-badge i",
		".stonetop-timeline-entry-linked i",
		".stonetop .stonetop-moves-level-notice-dismiss i",
		".stonetop-reminder-chip i",
		".stonetop-crew-tags-owed > i",
	];

	it.each(ICONS)("%s rounds its font-size to 1px", sel => {
		const body = declarations(MAIN, sel);
		expect(body, `${sel} has no rule`).toBeTruthy();
		expect(declared(body, "font-size")).toMatch(/^round\(.+, 1px\)$/);
	});
});

describe("the fixed discs trim their numeral", () => {
	it("sets the count disc's digit in the middle of its pinned size", () => {
		const body = declarations(MAIN, ".stonetop-condemn-count");
		expect(body).toMatch(TRIM);
		expect(declared(body, "display")).toBe("block");
		expect(declared(body, "padding-top")).toBe("calc((var(--st-condemn-count-size) - 1cap) / 2 + var(--st-caps-trim-nudge))");
	});

	it("puts the count disc back on flex centring where text-box is unsupported", () => {
		expect(FALLBACK).toMatch(/\.stonetop-marks-count\s*\{[^}]*display:\s*inline-flex[^}]*padding-top:\s*0/);
	});

	it("trims the relationship heart's numeral", () => {
		expect(declarations(MAIN, ".stonetop-rel-heart-badge-value")).toMatch(TRIM);
	});
});
