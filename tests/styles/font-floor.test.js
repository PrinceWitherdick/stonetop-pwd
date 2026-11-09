import { describe, expect, it } from "vitest";
import { readCss } from "../fakes/css.js";

// NO TEXT UNDER 0.95 OF THE BODY SIZE (user, 2026-11-07, after the Steading sheet's Plans hint came
// out at Foundry's --font-size-12: "I don't think any font should ever be that small". They chose
// 0.95x body as the floor, with everything between it and body text keeping its order).
//
// A floor was already written down at :root as --st-fs-2xs (then 0.9em), but nothing held anyone to
// it, and sizes had crept in as low as half the body text. A ~90%-blind player uses this system.
//
// ⚠ BODY TEXT IS 0.875rem, NOT 1rem. Foundry sets an application's text at --font-size-14 (0.875rem:
// 14px at the default 16px UI size), and .stonetop .window-content scales that by the sheet setting.
// So a size is read as a fraction of THAT, form by form:
//   calc(Xrem * var(--stonetop-font-scale, 1))   X / 0.875
//   Xrem                                         X / 0.875   (and deaf to the sheet setting)
//   Xem / round(Xem, 1px)                        X
//   Npx, var(--font-size-N), calc(Npx * scale)   N / 14      (a bare px is deaf to the UI size too)
// The --st-fs-* tokens are the floor and above, so a token always passes.
//
// ⚠ ONE GAP A STATIC READ CANNOT CLOSE: an em inside another em multiplies (0.95em inside 0.97em is
// 0.92 of the body). Prefer the rem-times-scale form for anything that nests.
//
// WHAT MAY STAY SMALLER is listed here by its exact selector, never matched by a pattern, so new text
// cannot slip through by looking like an icon. Each one is a picture rather than words: a Font
// Awesome glyph, a list bullet, a map mark, or a numeral pinned whole-pixel inside a fixed shape whose
// own comment explains the sum. Words never belong on this list.
const EXEMPT = {
	".stonetop-sidebar-toggle i": "icon",
	".stonetop-toggle-thumb i": "icon on a fixed-px thumb",
	".stonetop-time-banner__icon": "icon",
	".steading-residents-sort-icon": "icon",
	".steading-improvement-lock": "lock glyph in a locked improvement's box",
	".steading-improvement-filter > i": "icon (whole-pixel, chip-centring)",
	".steading-improvement-status > i": "icon",
	".stonetop-roll-card-badge i": "icon (whole-pixel, chip-centring)",
	".stonetop-dead-tag i": "icon (whole-pixel, chip-centring)",
	".stonetop-reminder-chip i": "icon (whole-pixel, chip-centring)",
	".stonetop-reminder-chip button.stonetop-reminder-chip-remove": "× glyph on a chip",
	".stonetop-cf-mini-btn--danger > i": "icon (whole-pixel, chip-centring)",
	".stonetop-follower-tag :is(.stonetop-follower-tag-remove, .stonetop-follower-tag-drop)": "× glyph on a tag",
	".stonetop-follower-section-caret": "caret (follower-card-folds pins it)",
	".stonetop-follower-card-fold > i": "icon (follower-card-folds pins it)",
	".stonetop-follower-moves-list li::before": "list bullet",
	".stonetop-companion-bond-actions li::before": "list bullet",
	".stonetop-monster-armor-boost-note > .fa-arrow-up": "icon",
	".stonetop-monster-move-boost-icon": "icon",
	".stonetop-intros-recorded-about > i": "icon",
	".stonetop-intros-save-status > span > i": "icon",
	".stonetop-intros-about-said > i": "icon",
	".stonetop-welcome-textlink > i": "icon",
	".stonetop-cf-chosen-tag i": "icon (whole-pixel, chip-centring)",
	".stonetop-mf-arrow": "arrow icon in a banner title",
	".stonetop .threat-move-caret": "caret",
	".stonetop .site-group__caret": "caret",
	".stonetop-journey .stonetop-journey-tier .fa-image-slash": "icon",
	".stonetop-journey-canvas .stonetop-journey-arrow": "map mark",
	".stonetop-journey-canvas .stonetop-journey-sitemark": "map mark",
	".stonetop-journey-canvas .stonetop-journey-mark": "map mark",
	".stonetop-journey-canvas .stonetop-journey-mark.is-end": "map mark",
	".stonetop-npc-following-pc i": "icon",
	".stonetop-condemn-count, .stonetop-marks-count": "numeral in a fixed whole-pixel disc",
	".stonetop-rel-heart-badge-value": "numeral in a fixed whole-pixel heart",
	".stonetop-follower-portrait-pip, .stonetop-header-pip": "icon pip",
	".stonetop-header-pip": "icon pip",
	".stonetop-gm-entry-card-head > .stonetop-gm-encounter-fight > i": "icon",
	".stonetop-catalog-filter > i": "icon (whole-pixel, chip-centring)",
	".stonetop-catalog-badge > i": "icon (whole-pixel, chip-centring)",
	".stonetop-relmap-heft-mark": "glyph picture of a dial",
	".stonetop-relmap-heft-step > i": "icon",
	".stonetop-relmap-tiebar-btn": "icon-only square",
	".stonetop-relmap-inkpop-swatch": "colour swatch",
	".stonetop-relmap-chip": "board pixels: a tag chip on the map grows with the map's zoom, not the UI size",
	".stonetop-person-picker-chip i": "icon (whole-pixel, chip-centring)",
	".stonetop-timeline-card-actions button > i": "icon",
	".stonetop-timeline-add > i": "icon",
	".steading-herd-step > i, .stonetop-crew-size-step > i, .stonetop-custom-group-size-step > i, .stonetop-crew-edit-individual > i, .stonetop-crew-delete-individual > i": "icons (whole-pixel, follower-edit-fields)",
	".stonetop-relmap-tiebar-inkopen .fa-caret-down, .stonetop-relmap-tiebar-dashopen .fa-caret-down, .stonetop-relmap-tiebar-sizeopen .fa-caret-down": "caret",
};

const FLOOR = 0.95;
const BODY_REM = 0.875;
const BODY_PX = 14;
const SCALE = String.raw`var\(\s*--stonetop-font-scale\s*,\s*1\s*\)`;
const REM_SCALED = new RegExp(String.raw`^(?:round\(\s*)?calc\(\s*([\d.]+)rem\s*\*\s*${SCALE}\s*\)(?:\s*,\s*1px\s*\))?$`);
const PX_SCALED = new RegExp(String.raw`^calc\(\s*([\d.]+)px\s*\*\s*${SCALE}\s*\)$`);

/** A font-size value as a fraction of the body text, or null for a form this file does not judge. */
function ratio(raw) {
	const v = raw.replace(/\s*!important\s*$/, "").trim();
	let m;
	if ((m = REM_SCALED.exec(v))) return +m[1] / BODY_REM;
	if ((m = PX_SCALED.exec(v))) return +m[1] / BODY_PX;
	if ((m = /^(?:round\(\s*)?([\d.]+)em(?:\s*,\s*1px\s*\))?$/.exec(v))) return +m[1];
	if ((m = /^([\d.]+)rem$/.exec(v))) return +m[1] / BODY_REM;
	if ((m = /^([\d.]+)px$/.exec(v))) return +m[1] / BODY_PX;
	if ((m = /^var\(\s*--font-size-(\d+)\s*(?:,[^)]*)?\)$/.exec(v))) return +m[1] / BODY_PX;
	return null;
}

/** Every font-size declaration with the selector of the rule it sits in. Comments are already gone. */
function fontSizes(css) {
	const out = [];
	const stack = [];
	let start = 0;
	for (let i = 0; i < css.length; i++) {
		const c = css[i];
		if (c === '"' || c === "'") { i++; while (i < css.length && css[i] !== c) { if (css[i] === "\\") i++; i++; } continue; }
		if (c === "{") { stack.push(css.slice(start, i).replace(/\s+/g, " ").trim()); start = i + 1; }
		else if (c === "}") { stack.pop(); start = i + 1; }
		else if (c === ";") {
			const m = /^\s*font-size\s*:\s*([\s\S]+?)\s*$/.exec(css.slice(start, i));
			if (m) out.push({ selector: stack.at(-1) ?? "", value: m[1].replace(/\s+/g, " ") });
			start = i + 1;
		}
	}
	return out;
}

const CSS = readCss();
const SIZES = fontSizes(CSS);
const under = ({ value }) => ratio(value) !== null && ratio(value) < FLOOR - 1e-9;

describe("the type floor", () => {
	it("finds the sizes it judges, so the checks below mean something", () => {
		expect(SIZES.length).toBeGreaterThan(1000);
		expect(SIZES.find(s => s.selector === ".steading-notes-hint")).toBeTruthy();
	});

	it("reads Foundry's own fixed size as under the floor, so the check can fail", () => {
		expect(under({ value: "var(--font-size-12, 12px)" })).toBe(true);
		expect(under({ value: "calc(0.8rem * var(--stonetop-font-scale, 1))" })).toBe(true);
		expect(under({ value: "calc(0.84rem * var(--stonetop-font-scale, 1))" })).toBe(false);
	});

	it("keeps the small steps of the type scale at the floor and in order", () => {
		expect(CSS).toMatch(/--st-fs-2xs:\s*0\.95em;/);
		expect(CSS).toMatch(/--st-fs-xs:\s*0\.96em;/);
		expect(CSS).toMatch(/--st-fs-sm:\s*0\.97em;/);
		// The rem floor tokens hold the size most small text is set at; both stay at or over 0.95 of 0.875rem.
		const floor = name => Number(CSS.match(new RegExp(`--${name}:\\s*calc\\(([\\d.]+)rem \\* var\\(--stonetop-font-scale, 1\\)\\);`))?.[1]);
		expect(floor("st-fs-floor") / 0.875).toBeGreaterThanOrEqual(0.95);
		expect(floor("st-fs-floor-sm") / 0.875).toBeGreaterThanOrEqual(0.95);
	});

	it("sets no text under 0.95 of the body size", () => {
		const found = SIZES
			.filter(s => !(s.selector in EXEMPT) && under(s))
			.map(({ selector, value }) => `${selector} { font-size: ${value} }`);
		expect(found).toEqual([]);
	});

	// The Plans hint the user reported: Foundry's --font-size-12 sat under the floor.
	it("sets the Steading sheet's notes hint on the scale, not at Foundry's 12", () => {
		const hint = SIZES.filter(s => s.selector === ".steading-notes-hint").map(s => s.value);
		expect(hint).toEqual(["var(--st-fs-xs)"]);
	});

	it("lists no exemption that has stopped matching a small size", () => {
		const stale = Object.keys(EXEMPT).filter(sel => !SIZES.some(s => s.selector === sel && under(s)));
		expect(stale).toEqual([]);
	});
});
