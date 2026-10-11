import { describe, it, expect } from "vitest";
import { readCss, readRepo, declarations, ownRule, splitSelectorList } from "../fakes/css.js";

/**
 * A follower card in EDIT MODE, and the three ways it stopped looking like the card beside it.
 *
 * Read a follower and the values sit on quiet fill lines. Open the pencil and, before this,
 * every one of them became a grey well with a soft dark halo, the "exceptional" tag inflated
 * into a full-width bar above the chips it belongs with, and "Add gear" grew to the size of the
 * card's Order button. None of that was declared anywhere: all three are Foundry core reaching
 * past rules that had asked for something quieter.
 *
 * 1. THE RING. Core paints `box-shadow: var(--input-box-shadow)` on every field, and under
 *    `theme-light` — the state every AppV1 window in this system renders in — that token is
 *    `inset 0 0 6px rgba(0,0,0,0.1)`. On a bordered well it doubles the edge; on a field
 *    declared `border: none; background: transparent` it invents a box that was never asked for.
 *
 * 2. `:not(:focus)` ON THAT RESET, which is the half that is easy to drop and impossible to see.
 *    stonetop.css is unlayered and core's form rules are layered, so a bare `box-shadow: none`
 *    beats core in EVERY state, `:focus` included. That matters because core also has
 *    `body.game .app input:focus { outline: none }`: on an AppV1 window the glow IS the focus
 *    indicator, the outline having already been taken away. Killed flat, these fields took focus
 *    with no visible change at all — measured, not guessed.
 *
 * 3. `width: auto` ON THE TWO CONTROLS THAT ARE <button>s. Core's
 *    `body.game .app button { width: 100% }` catches them and nothing else in their rows: the
 *    exceptional chip's neighbours are <span>s and <label>s, and "Add gear" already asked for
 *    `justify-self: start`, which a `width: 100%` box ignores because it fills its grid area
 *    wherever it is placed. See [[reference_app-button-core-width-100]].
 *
 * Plus the one that is not CSS at all: the card body is a Handlebars partial, and Handlebars
 * re-indents a STANDALONE partial call's whole rendered output — the output STRING, so the
 * indent lands inside interpolated values too. Everywhere in this card that is invisible except
 * inside a <textarea>, where whitespace is content: Moves and Notes came back with two tabs in
 * front of every line after the first, and since the change handler stores `el.value` (trimmed
 * only at the ends) one edit wrote them into the actor and the next render added two more.
 */

const CSS = readCss();
const TAB = readRepo("templates/actor/partials/tab-followers.hbs");

/** Every field on a follower card that had to have core's resting ring taken off it. */
const RINGED_FIELDS = [
	".stonetop-follower-name-input",
	".stonetop-follower-pronoun-input",
	".stonetop-follower-stat-input",
	".stonetop-follower-gear-label",
	".stonetop-follower-text",
	".stonetop-follower-hp-input",
	".stonetop-follower-hp-octagon-max-input",
	".stonetop-crew-size-input",
	".stonetop-custom-group-size-input",
	".stonetop-outnumber-yours",
	".stonetop-outnumber-theirs",
];

describe("a follower's edit-mode fields", () => {
	it("takes core's resting ring off every one of them", () => {
		for (const field of RINGED_FIELDS) {
			const decls = declarations(CSS, `${field}:not(:focus)`);
			expect(decls, `${field} has no ring reset`).toBeTruthy();
			expect(decls, `${field} does not clear box-shadow`).toMatch(/box-shadow:\s*none/);
		}
	});

	it("scopes that reset to the resting state, or focus stops showing at all", () => {
		// The reset must never be written bare. Unlayered beats core's layered rules in every
		// state, so a bare form also kills the `:focus` glow — and core has already removed the
		// outline that would otherwise have covered for it.
		for (const field of RINGED_FIELDS) {
			const own = ownRule(CSS, field);
			if (own === null) continue; // styled purely through the shared reset above
			expect(own, `${field} clears box-shadow unconditionally`).not.toMatch(/box-shadow:\s*none/);
		}
	});

	it("draws one weight of edge across the whole card", () => {
		// Three near-identical greys (0.2, 0.25, #ccc) used to divide these fields for no reason
		// a reader could see. One value, so a card in edit mode reads as one surface.
		for (const field of RINGED_FIELDS) {
			const decls = declarations(CSS, field);
			if (decls === null) continue;
			const borders = decls.match(/border(?:-bottom)?:[^;]*/g) || [];
			for (const b of borders) {
				if (!/\d/.test(b) || /none/.test(b)) continue;
				// Black at 25% on paper, read through the ink channel so the dark palette turns it over.
				expect(b, `${field} draws an off-palette edge`).toMatch(/rgb\(var\(--st-ink-rgb\)\s*\/\s*0\.25\)/);
			}
		}
	});
});

describe("the two follower controls core would stretch", () => {
	it("lets the exceptional chip size to its own label, like the tags beside it", () => {
		const decls = declarations(CSS, ".stonetop-follower-tag.stonetop-exceptional-toggle");
		expect(decls).toBeTruthy();
		// Core's `body.game .app button { width: 100% }` catches this one alone in its row.
		expect(decls).toMatch(/width:\s*auto/);
		// And `flex: none`, or the row shrinks it back below its label once it asks for content
		// width — the non-wrapping-row half of the same core trap.
		expect(decls).toMatch(/flex:\s*none/);
	});

	it("keeps 'Add gear' a small affordance rather than a full-width bar", () => {
		const decls = declarations(CSS, ".stonetop-follower-gear-add");
		expect(decls).toBeTruthy();
		expect(decls).toMatch(/justify-self:\s*start/);
		// justify-self means nothing to a width:100% box: it fills the area wherever it is put.
		// Its `width: auto` comes from the shared inline-button rule, through the class it carries.
		expect(TAB).toMatch(/<button[^>]*class="stonetop-follower-gear-add stonetop-inline-btn"/);
		expect(declarations(CSS, ":where(.stonetop-inline-btn, .stonetop-follower-order, .stonetop-daagon-btn)"))
			.toMatch(/width:\s*auto/);
		expect(decls).not.toMatch(/(?:^|[;{\s])width:/);
	});
});

describe("a custom group follower's roster controls", () => {
	it("wears the same skin as the crew's identical row", () => {
		// Same control, same .stonetop-crew-size-row, different class names — so it rendered as a
		// bare core number field beside a stretched stepper, one card over from the crew's.
		for (const [mine, crew] of [
			[".stonetop-custom-group-size-input", ".stonetop-crew-size-input"],
			[".stonetop-custom-group-size-step", ".stonetop-crew-size-step"],
		]) {
			expect(declarations(CSS, mine), `${mine} is unstyled`).toBeTruthy();
			expect(declarations(CSS, mine)).toBe(declarations(CSS, crew));
		}
	});
});

describe("the Armor line's 'where from' field", () => {
	it("is a fill line like the stat values under it, not a boxed text area", () => {
		const input = TAB.match(/<input[^>]*stonetop-follower-armor-source-input[^>]*>/);
		expect(input).toBeTruthy();
		expect(input[0]).toMatch(/stonetop-follower-stat-input/);
		// .stonetop-follower-text is the boxed skin the multi-line Moves / Notes fields wear;
		// on the Armor line it made one inline value heavier than the three below it.
		expect(input[0]).not.toMatch(/stonetop-follower-text\b/);
	});
});

describe("the follower card body partial", () => {
	it("is never called standalone, or Handlebars tabs every Moves and Notes line", () => {
		const lines = TAB.split("\n");
		const calls = lines
			.map((line, i) => ({ line, n: i + 1 }))
			.filter(({ line }) => line.includes("{{> stonetopFollowerCardBody}}"));
		expect(calls.length, "the card body partial is never called").toBeGreaterThan(0);
		for (const { line, n } of calls) {
			const before = line.slice(0, line.indexOf("{{> stonetopFollowerCardBody}}"));
			expect(before.trim(), `line ${n} calls the partial standalone`).not.toBe("");
		}
	});
});

describe("the shared ring reset", () => {
	it("lists each field once, so a field cannot be half-covered", () => {
		const entries = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
			.filter(([, , body]) => /box-shadow:\s*none/.test(body))
			.flatMap(([, prelude]) => splitSelectorList(prelude))
			.filter(sel => RINGED_FIELDS.some(f => sel.startsWith(f)));
		const seen = new Map();
		for (const sel of entries) seen.set(sel, (seen.get(sel) ?? 0) + 1);
		for (const [sel, count] of seen) {
			expect(count, `${sel} clears box-shadow in ${count} places`).toBe(1);
		}
	});
});
