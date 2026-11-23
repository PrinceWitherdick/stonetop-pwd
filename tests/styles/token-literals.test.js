import { describe, expect, it } from "vitest";
import { declarations, readCss } from "../fakes/css.js";

// FOUR VALUES THAT HAVE A TOKEN, AND MUST BE WRITTEN AS IT (STYLEGUIDE.md, "Tokens first").
//
// The 2026-11-19 style audit found each of these spelled out by hand in places the sweeps before it
// had not reached, and each one is a value some setting or palette has to be able to move:
//
//   · a black wash under a panel, `rgba(0, 0, 0, 0.04)`. On paper it is a faint inset. On the dark
//     pages it is a step DARKER than the page, where every raised surface is a step lighter, so the
//     Steading sheet's cards sank while the character sheet's lifted. `rgb(var(--st-ink-rgb) / a)`
//     is the same black on paper and a wash of bone there.
//   · a text size in bare `rem`. It reads the reader's interface size and is deaf to their Sheet
//     Text Size setting; the threat, site and hazard cards and the monster builder stood still
//     while everything round them grew. `calc(Xrem * var(--stonetop-font-scale, 1))` is the same
//     size at the default and follows the setting.
//   · a corner of 3px, 4px or 6px, which are --st-radius-sm, --st-radius and --st-radius-lg.
//   · a bare `slategrey` on a native control or a drawn radio dot, which the high-contrast palette
//     re-pitches through --st-accent-fill and cannot reach as a literal.
//
// Every one of the conversions rendered identically on paper at the default size, which is why they
// could be made in one pass, and why nothing but a guard will keep them made.
//
// A SECOND PASS, the same day, took the guide's own recommendations for what the first had only
// listed, and the blocks from "a slate edge" down hold those: slate borders and slate washes on
// their tokens, pop-overs on one named rung, a focus ring in a colour the dark pages can see, one
// opacity for a disabled control, and the three quick durations down to two (now two tokens).
//
// WHAT MAY STAY A LITERAL is listed by exact selector, with the reason. Never by pattern.

const CSS = readCss();
const DARK = CSS.indexOf(":root.stonetop-dark {");
/** Scopes that paint their own paper: a literal inside one is that scope's business. */
const SCOPED = /stonetop-dark|theme-dark|stonetop-high-contrast|past-death|stonetop-slate|deathsdoor|death-drip/;
const norm = s => s.trim().replace(/\s+/g, " ");
const rules = css => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [norm(sel), body]);
const values = (body, prop) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))].map(m => norm(m[1]));

const ALL = rules(CSS);
const PAPER = rules(CSS.slice(0, DARK)).filter(([sel]) => !SCOPED.test(sel));

describe("the scan", () => {
	it("read the stylesheet at all (guards every check below)", () => {
		expect(DARK, "the dark palette block is gone or renamed").toBeGreaterThan(0);
		expect(PAPER.length).toBeGreaterThan(3000);
	});
});

describe("a wash under a panel", () => {
	// Each of these sits on a ground that does NOT turn over with the page: a picture, a map, or a
	// journal page core paints. A wash of the ink would be bone on a light ground there.
	const KEPT = new Set([
		".stonetop-lore-arcana-img",
		":is(.journal-page-content, .stonetop-so-entry-body, .stonetop-npc-sheet, .stonetop-monster-sheet) a.content-link:hover",
		".stonetop-monster-ref:hover",
	]);
	const BLACK_WASH = /rgba?\(\s*0[\s,]+0[\s,]+0\s*[,/]\s*(0?\.\d+|\d+%)\s*\)/g;
	const faint = v => [...v.matchAll(BLACK_WASH)].some(m => (m[1].endsWith("%") ? parseFloat(m[1]) / 100 : +m[1]) < 0.2);
	const washes = PAPER.filter(([, body]) => values(body, "background(?:-color)?").some(faint));

	it("is a wash of the ink channel, so the dark pages can turn it over", () => {
		expect(washes.map(([sel]) => sel).filter(sel => !KEPT.has(sel))).toEqual([]);
	});

	it("lists no exemption that has stopped matching a rule", () => {
		const found = new Set(washes.map(([sel]) => sel));
		expect([...KEPT].filter(sel => !found.has(sel))).toEqual([]);
	});

	it("is what the ink channel is on paper: black", () => {
		expect(CSS).toMatch(/:root\s*\{[^}]*--st-ink-rgb:\s*0 0 0;/);
	});
});

describe("a text size in rem", () => {
	it("is multiplied by the reader's Sheet Text Size", () => {
		const bare = ALL.flatMap(([sel, body]) => values(body, "font-size")
			.filter(v => /^[\d.]+rem(\s*!important)?$/.test(v)).map(v => `${sel} { font-size: ${v} }`));
		expect(bare, "write calc(Xrem * var(--stonetop-font-scale, 1))").toEqual([]);
	});
});

describe("a corner on the radius scale", () => {
	it("reads the token for 3px, 4px and 6px", () => {
		const ON_SCALE = /^(?:0|3px|4px|6px)(?:\s+(?:0|3px|4px|6px)){0,3}$/;
		const literal = ALL.flatMap(([sel, body]) => values(body, "border(?:-(?:top|bottom)-(?:left|right))?-radius")
			.filter(v => ON_SCALE.test(v) && /px/.test(v)).map(v => `${sel} { border-radius: ${v} }`));
		expect(literal, "write var(--st-radius-sm), var(--st-radius) or var(--st-radius-lg)").toEqual([]);
	});

	it("still means 3px, 4px and 6px", () => {
		const root = CSS.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
		expect(root).toMatch(/--st-radius-sm:\s*3px;/);
		expect(root).toMatch(/--st-radius:\s*4px;/);
		expect(root).toMatch(/--st-radius-lg:\s*6px;/);
	});
});

describe("the slate on a native control", () => {
	// tests/styles/high-contrast.test.js holds `color:` and `background:` to this; these are the two
	// spellings its pattern does not read.
	it("is the accent token as an accent-color", () => {
		const bare = PAPER.filter(([, body]) => values(body, "accent-color").some(v => /^slategr[ae]y/.test(v)));
		expect(bare.map(([sel]) => sel)).toEqual([]);
	});

	it("is the accent token inside a drawn radio dot", () => {
		const bare = PAPER.filter(([, body]) => values(body, "background(?:-image)?")
			.some(v => /gradient\([^;]*(?<![-\w])slategr[ae]y/.test(v.replace(/var\([^()]*\)/g, ""))));
		expect(bare.map(([sel]) => sel)).toEqual([]);
	});
});

describe("a slate edge", () => {
	// A slate border or outline reads `--st-slate-rule`, so the palettes that re-point the token
	// (dark, high contrast) re-point every edge with it.
	it("reads --st-slate-rule", () => {
		const bare = PAPER.filter(([, body]) => values(body, "(?:border|outline)[a-z-]*")
			.some(v => /(?<![-\w])slategr[ae]y(?![-\w])/.test(v.replace(/var\([^()]*\)/g, ""))));
		expect(bare.map(([sel]) => sel)).toEqual([]);
	});

	it("is slategrey still, so no border moved", () => {
		expect(CSS).toMatch(/--st-slate-rule:\s*slategrey;/);
	});
});

describe("a slate wash", () => {
	// Three spellings of one colour (100/116/139, 112/128/144, 106/120/128) across sixty rules.
	const SLATE = /rgba?\(\s*(?:100[\s,]+116[\s,]+139|112[\s,]+128[\s,]+144|106[\s,]+120[\s,]+128)\s*[,/]/;
	it("is a wash of the slate channel", () => {
		const bare = PAPER.filter(([, body]) => SLATE.test(body.replace(/--[a-z0-9-]+\s*:[^;]*;/g, "")));
		expect(bare.map(([sel]) => sel)).toEqual([]);
	});

	it("has one channel to read", () => {
		expect(CSS).toMatch(/--st-slate-rgb:\s*\d+ \d+ \d+;/);
	});
});

describe("a pop-over's rung", () => {
	it("is --st-z-popover, not a number of its own", () => {
		const own = PAPER.flatMap(([sel, body]) => values(body, "z-index").filter(v => /^\d{4,}$/.test(v)).map(v => `${sel} { z-index: ${v} }`));
		expect(own).toEqual([]);
	});
});

describe("a focus ring", () => {
	// --st-btn-primary-bg is near-black on the dark pages, darker than the page itself, so a ring
	// drawn in it was a ring nobody could see. The border token is the one that stays an edge.
	it("is never drawn in the primary FILL", () => {
		const lost = ALL.filter(([sel, body]) => /:focus/.test(sel)
			&& values(body, "outline").some(v => /var\(--st-btn-primary-bg\s*[,)]/.test(v)));
		expect(lost.map(([sel]) => sel)).toEqual([]);
	});
});

describe("a disabled control", () => {
	// Nine opacities across fifty rules. One now, and the checks' own 0.35 (the master skin's).
	// `opacity: 1` is a control that is locked but must still READ, and is left alone.
	const CHECKS = /stonetop-check:disabled|stonetop-inv-diamond:disabled/;
	it("is dimmed to 0.4", () => {
		const odd = PAPER.filter(([sel]) => /:disabled|\[disabled\]|\.is-disabled/.test(sel) && !CHECKS.test(sel))
			.flatMap(([sel, body]) => values(body, "opacity").filter(v => !/^(0\.4|1|0)$/.test(v)).map(v => `${sel} { opacity: ${v} }`));
		expect(odd).toEqual([]);
	});
});

describe("a quick transition", () => {
	// The 1.8.5 style pass folded 120ms and 0.1s into 0.12s by hand, some fifty rules of it, and the
	// two durations left are now --st-duration-sm (0.12s) and --st-duration (0.15s). A literal of
	// either is a rule that will not follow when the pair is next tuned; a third quick spelling is
	// the drift coming back. A duration that is deliberately different (0.18s, 0.25s, 250ms) is not
	// one of these and is left alone.
	const QUICK = /(?<![\w.-])0?\.1[25]s\b/;
	// Rules being reworked in a parallel change as this guard landed (the GM Toolkit's Prep pane
	// and character creation's card selection), left as literals so the two merge cleanly. Delete
	// each once its rule reads the token.
	const PENDING = new Set([
		".stonetop-prep-add-btn",
		".stonetop-prep-add-btn.stonetop-gm-pane-add",
		".stonetop-gm-prep-switcher .stonetop-gm-prep-view",
		".stonetop-onboarding-card",
		".stonetop-onboarding-appearance-option",
		".stonetop-onboarding-origin-label",
		".stonetop-onboarding-tag-option",
		".stonetop-onboarding-bg-option",
		".stonetop-onboarding-arcana-option",
		".stonetop-onboarding-lore-pick",
	]);
	const transitions = ALL.flatMap(([sel, body]) => values(body, "transition(?:-duration)?").map(v => [sel, v]));

	it("is written in seconds, as one of the two quick durations or a deliberate one", () => {
		const odd = transitions
			.filter(([, v]) => /\b\d+ms\b/.test(v.replace(/var\([^()]*\)/g, "")) && !/\b(?:250|200)ms\b/.test(v) || /(?<![\d.])0?\.1s\b/.test(v))
			.map(([sel, v]) => `${sel} { transition: ${v} }`);
		expect(odd).toEqual([]);
	});

	it("reads --st-duration-sm or --st-duration, not 0.12s or 0.15s", () => {
		const literal = transitions.filter(([sel, v]) => QUICK.test(v) && !PENDING.has(sel));
		expect(literal.map(([sel, v]) => `${sel} { transition: ${v} }`)).toEqual([]);
		expect(transitions.filter(([, v]) => /var\(--st-duration(?:-sm)?\)/.test(v)).length,
			"the scan found no transition on the tokens").toBeGreaterThan(150);
	});

	it("lists no pending rule that has stopped matching a literal", () => {
		const found = new Set(transitions.filter(([, v]) => QUICK.test(v)).map(([sel]) => sel));
		expect([...PENDING].filter(sel => !found.has(sel))).toEqual([]);
	});

	it("holds the pair on :root, in seconds", () => {
		expect(declarations(CSS, ":root")).toMatch(/--st-duration-sm:\s*0\.12s;/);
		expect(declarations(CSS, ":root")).toMatch(/--st-duration:\s*0\.15s;/);
	});
});
