import { describe, expect, it } from "vitest";
import { beats, declarations, hiddenHides, readCss, specificity, splitSelectorList } from "../fakes/css.js";

/**
 * Overrides that are outranked by the rule they were written to beat.
 *
 * The failure mode is always the same and always silent: the stylesheet READS as though the
 * override were in force, nothing is logged, the element renders — it just renders in the other
 * rule's colour. `tests/styles/dialog-button-specificity.test.js` makes the same argument for one
 * family (a per-dialog footer button rule under the shared `.stonetop.dialog` one) and does it with
 * a scan. This file is the cases that are not about dialog footers, each pinned by name, because
 * each was shipped broken and none is derivable from a pattern:
 *
 *   - A bare `.x-remove:hover` under a `.x-btns button:hover` that carries an element and therefore
 *     outranks it. The red never lands and the trash icon greys like its neighbours.
 *   - An author `display` on a panel that JS hides with the `hidden` ATTRIBUTE. Author beats UA
 *     whatever the specificity, so `[hidden]` does nothing until the stylesheet says so itself.
 *   - A chat card notice's heading, painted in the generic `.cell__subtitle` grey the card sets
 *     ~800 lines further down at the same weight. The accent still reached the notice's left-hand
 *     rule, so the block rendered with a coloured edge and a grey title and read as intentional.
 *   - A TIE, settled by source order. An element wearing two of our classes gets the rule that sits
 *     LATER in the sheet for anything both declare, so a component's own rule written above the
 *     shared chrome it means to override is dead. Both surfaces below shipped that way for a
 *     release, and in each the rule's own comment says what it was supposed to do.
 */

const CSS = readCss();

/** Every rule in the stylesheet, one entry per comma-separated selector, in source order. */
const RULES = [];
for (const [, prelude, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
	const props = [...body.matchAll(/(^|[;\s])([-\w]+)\s*:/g)].map(m => m[2]);
	for (const selector of splitSelectorList(prelude)) RULES.push({ selector, props, body, spec: specificity(selector) });
}

/**
 * The rules that declare `prop` and would apply to an element carrying exactly the classes in `on`.
 *
 * At least ONE class has to match, not merely "no class that doesn't". Without that floor a
 * selector naming no class at all — `#stonetop-map-pin-names`, say — satisfies the `every` test
 * vacuously and is reported as a rival of a panel it has never touched.
 */
function rivalsFor(prop, on) {
	return RULES.filter(r => {
		if (!r.props.includes(prop)) return false;
		const classes = [...r.selector.matchAll(/\.[\w-]+/g)].map(m => m[0].slice(1));
		return classes.length > 0 && classes.every(c => on.includes(c));
	});
}

/**
 * Which rule actually settles `prop` on an element carrying `on`, by the cascade these rules live
 * under: more specific wins, and an equal specificity is settled by whichever comes LATER. RULES is
 * in source order, so walking it forwards and keeping the last rule the incumbent does not outrank
 * is exactly that reading. No `!important` anywhere in these families, which is why it need not be
 * weighed here.
 */
function settles(prop, on) {
	let best = null;
	for (const r of rivalsFor(prop, on)) if (!best || !beats(best.spec, r.spec)) best = r;
	return best;
}

describe("a rule that ties with shared chrome is the one that wins", () => {
	// Each case: the element's classes, the property, the class whose rule must settle it, and the
	// value it must land on. The value matters as much as the winner: qualifying a selector to win
	// a tie is easy to do and easy to undo by moving a declaration, and only the value says whether
	// the surface still looks like what the comment beside it describes.
	const CASES = [
		// The Blessed's Shared Souls pips, in running text beside the beast's name. They wear the
		// shared readiness-pip shape, whose rule sits ~12,000 lines later: at 16px they read as a
		// control bar rather than as punctuation, which is what the rule beside them exists to say.
		{ what: "Shared Souls' loyalty pips", on: ["stonetop-readiness-pip", "stonetop-mark-loyalty-pip"],
		  prop: "width", owner: "stonetop-mark-loyalty-pip", value: /12px/ },
		{ what: "Shared Souls' loyalty pips", on: ["stonetop-readiness-pip", "stonetop-mark-loyalty-pip"],
		  prop: "height", owner: "stonetop-mark-loyalty-pip", value: /12px/ },
		// The group toggle in Create Follower, Create Hazard and the two Convert to Follower
		// dialogs. `.stonetop-cf-label` lays a label out as a column, so losing this tie stacked
		// "of N members" under the tick and centred it.
		{ what: "the follower group toggle row", on: ["stonetop-cf-label", "stonetop-cf-group-label"],
		  prop: "flex-direction", owner: "stonetop-cf-group-label", value: /row/ },
		{ what: "the follower group toggle row", on: ["stonetop-cf-label", "stonetop-cf-group-label"],
		  prop: "gap", owner: "stonetop-cf-group-label", value: /8px/ },
		{ what: "the converted group toggle row", on: ["stonetop-cf-label", "stonetop-mf-group-label"],
		  prop: "flex-direction", owner: "stonetop-mf-group-label", value: /row/ },
		// A chat-card notice's heading (the lasting-injury reminder, the weapon-tag notes, the
		// problematic-wound prompt). Each notice sets its ink as `--st-notice-accent` and the shared
		// shape spends it here; the card's own `.cell__subtitle` rule sits later in the file and used
		// to tie, so every notice shipped with a coloured left edge over a grey title.
		{ what: "a card notice's heading", prop: "color", owner: "stonetop-card-notice",
		  on: ["message", "pbta-chat-card", "stonetop-card-notice", "cell__subtitle"],
		  value: /--st-notice-accent/ },
	];

	it.each(CASES)("$what: $prop is settled by .$owner", ({ on, prop, owner, value }) => {
		const winner = settles(prop, on);
		expect(winner, `nothing declares ${prop} for .${on.join(".")}`).toBeTruthy();
		expect(winner.selector, `.${owner} loses the tie, so its ${prop} is dead`).toContain(owner);
		expect(new RegExp(`${prop}\\s*:\\s*[^;]*`).exec(winner.body)?.[0] ?? "").toMatch(value);
	});
});

describe("the improvement builder's remove buttons keep their red", () => {
	// Both remove buttons sit inside the -btns span that carries the shared bare-glyph look, so
	// `… -btns button:hover` (0,2,1) applies to them as well and used to beat a bare
	// `.…-remove:hover` (0,2,0). The group's had worked for months and was broken by the pass that
	// merged the row's button chrome with the group's; the row's had never worked at all.
	const CASES = [
		["stonetop-improvement-builder-req-btns", "stonetop-improvement-builder-req-remove"],
		["stonetop-improvement-builder-group-btns", "stonetop-improvement-builder-group-remove"],
	];

	it.each(CASES)("%s: the red beats the shared hover it sits under", (btns, remove) => {
		const on = [btns, remove];
		const reds = rivalsFor("color", on).filter(r => /:hover/.test(r.selector) && r.selector.includes(remove));
		expect(reds.length, `no :hover colour rule found for .${remove}`).toBeGreaterThan(0);

		// Every OTHER hover rule that would paint this same element. The shared one is the rival
		// that matters, but naming it here would let a third rule slip in above it unnoticed.
		const others = rivalsFor("color", on).filter(r => /:hover/.test(r.selector) && !r.selector.includes(remove));
		expect(others.length, "the shared -btns button:hover rule is gone or renamed").toBeGreaterThan(0);

		const dead = others.filter(o => reds.every(red => beats(o.spec, red.spec)));
		expect(dead.map(o => o.selector), "these out-specify the remove button's red").toEqual([]);
	});

	it("paints the two removes red and their neighbours not", () => {
		for (const [, remove] of CASES) {
			const red = RULES.find(r => r.selector.includes(remove) && /:hover/.test(r.selector));
			expect(CSS.slice(CSS.indexOf(red.selector)), `.${remove} lost its red`).toMatch(/--st-red-text/);
		}
	});
});

describe("a panel hidden by the attribute is actually hidden", () => {
	// `_toggleEmpty` sets `panel.hidden`. The UA's `[hidden] { display: none }` loses to ANY author
	// `display` whatever the specificity, so without the stylesheet's own `hidden` rule the empty
	// panel goes on covering a board that now has people on it.
	const PANEL = "stonetop-relmap-empty";

	it("declares a display the attribute would have to beat (guards the assertion below)", () => {
		expect(declarations(CSS, `.${PANEL}`), "the empty panel's rule is gone or renamed").toMatch(/display:/);
	});

	it("is hidden by the stylesheet's own [hidden] rule", () => {
		expect(hiddenHides(CSS, PANEL)).toBe(true);
	});
});
