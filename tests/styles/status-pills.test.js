import { describe, expect, it } from "vitest";
import { declarations, declared, ownRule, readCss, readRepo } from "../fakes/css.js";

/**
 * The sheets' three status pills are one pill in two colours.
 *
 * A person can wear more than one at a time, and when they do the pills sit side by side on the
 * same line: the NPC name row carries the lifecycle badge ("AWAY", "DEAD", "RETIRED") beside the
 * Judge's CONDEMNED brand, and the character sheet's appearance line carries the DEAD pill beside
 * that same brand. They were written months apart and had drifted apart with it (18.88, 23.27 and
 * 16.48px tall at one font size). Two marks of one colour at two heights read as a fault in the
 * sheet rather than as two features, and a word sitting off-centre in its pill reads as a mis-set
 * chip. The brand owns the numbers now and the other two borrow them, which is a pairing no single
 * rule can enforce -- hence this file. Three things hold it together:
 *
 *  - the SIZE, the LINE-HEIGHT and the PINNED HEIGHT must agree across the three, with no
 *    vertical padding;
 *  - every label is centred by TRIMMING its line box to its capitals (`text-box: trim-both cap
 *    alphabetic`) and letting `align-items: center` centre that, plus a small per-face residual,
 *    --st-caps-trim-nudge. What this replaced was a per-face `em` nudge on an untrimmed 1em box,
 *    and it could not hold: Blink rounds a font's ascent and descent to whole pixels, so where the
 *    caps sit in that box moves by up to a pixel from one font size to the next. Measured from
 *    rendered pixels, Signika's caps were up to 1px LOW at the large UI font sizes a real table
 *    runs, in both pills, which is what got reported;
 *  - so every label must be an ELEMENT. A bare text node in a flex row is an anonymous flex item,
 *    which does not take `text-box` (measured 1.4px off) and cannot be moved. All three pills wrap
 *    the word, in every template that renders one.
 */

const CSS = readCss();
const HEADER = readRepo("templates/actor/partials/actor-header.hbs");

const BADGE = ".stonetop-npc-status-badge";
const SMALL = ".stonetop-npc-status-badge--sm";
const BRAND = ".stonetop-condemned-tag";
const DEAD = ".stonetop-dead-tag";
// The relationship map's tag chips ("Dead" on a board) are the same pill in board pixels, and centre
// their word the same way.
const LABELS = [
	".stonetop-npc-status-badge-text", ".stonetop-condemned-tag-text", ".stonetop-dead-tag-text",
	".stonetop-relmap-chip-text",
];
const TRIM = "trim-both cap alphabetic";

/** The padding SHORTHAND a rule declares, whitespace-collapsed, or null if it declares none. */
const padding = body => declared(body, "padding");

describe("all three pills are built on the brand's numbers", () => {
	const badge = ownRule(CSS, BADGE);
	const brand = ownRule(CSS, BRAND);
	const dead = ownRule(CSS, DEAD);

	it("finds all three rules", () => {
		expect(badge).toBeTruthy();
		expect(brand).toBeTruthy();
		expect(dead).toBeTruthy();
	});

	it("gives each a line-height of 1", () => {
		// Where text-box is unsupported the label stays untrimmed, and a 1em box is what the pinned
		// height then centres; any other line-height folds its own half-leading in.
		expect(declared(badge, "line-height")).toBe("1");
		expect(declared(brand, "line-height")).toBe("1");
		expect(declared(dead, "line-height")).toBe("1");
	});

	it("pins one height on all three, with no vertical padding", () => {
		// Padding moves the glyph and the word together and cannot centre either; the height is the
		// old symmetric 0.23em padding around a 1em line, so no pill changed size.
		for (const body of [badge, brand, dead]) {
			expect(padding(body)).toMatch(/^0 /);
			expect(declared(body, "min-height")).toBe("calc(1.46em + 2px)");
		}
	});

	it("sizes the NPC badge and the brand it stands beside alike", () => {
		expect(declared(badge, "font-size")).toBe(declared(brand, "font-size"));
	});

	it("sizes the Dead pill and the brand it shares the appearance line with alike", () => {
		// The brand takes --st-fs-xs in that one context, where it trails prose rather than
		// standing under a name; see `.stonetop-appearance-summary .stonetop-condemned-tag`.
		const inProse = ownRule(CSS, ".stonetop-appearance-summary .stonetop-condemned-tag");
		expect(declared(dead, "font-size")).toBe(declared(inProse, "font-size"));
	});

	it("carries no per-pill nudge of its own any more", () => {
		// The badge used to push its ink down with an asymmetric padding pair; left behind, it
		// would stack on the trim and put the word low again.
		expect(declarations(CSS, BADGE)).not.toContain("caps-nudge");
		expect(declarations(CSS, BRAND)).not.toContain("caps-nudge");
		expect(declarations(CSS, DEAD)).not.toContain("caps-nudge");
	});
});

describe("the relationship map's tag chip is the same kind of pill", () => {
	const chip = ownRule(CSS, ".stonetop-relmap-chip");
	it("pins its height, with a line-height of 1 and no vertical padding", () => {
		expect(chip).toBeTruthy();
		expect(declared(chip, "line-height")).toBe("1");
		expect(padding(chip)).toMatch(/^0 /);
		expect(declared(chip, "height")).toMatch(/^round\(20px/);
		expect(declared(chip, "display")).toBe("inline-flex");
		expect(declared(chip, "align-items")).toBe("center");
	});
});

describe("every pill centres its label by trimming it to its capitals", () => {
	it.each(LABELS)("trims %s and lifts it by the per-face residual", label => {
		const body = declarations(CSS, label);
		expect(body, `${label} has no rule`).toBeTruthy();
		expect(body).toContain(`text-box: ${TRIM}`);
		expect(body).toMatch(/transform:\s*translateY\(var\(--st-caps-trim-nudge/);
	});

	it("falls back to the untrimmed nudge where text-box is unsupported", () => {
		const block = CSS.match(new RegExp(String.raw`@supports not \(text-box: ${TRIM}\)\s*\{([\s\S]*?\})\s*\}`))?.[1];
		expect(block, "the @supports fallback is gone").toBeTruthy();
		for (const label of LABELS) expect(block).toContain(label);
		expect(block).toMatch(/translateY\(var\(--st-caps-nudge/);
	});

	it("wraps the Dead label in its span, in BOTH copies", () => {
		// The pill is a button when the sheet is editable and a span when it is not.
		const line = HEADER.match(/<p class="stonetop-appearance-summary">[\s\S]*?<\/p>/)?.[0];
		expect(line, "the appearance line is gone from the header template").toBeTruthy();
		expect([...line.matchAll(/stonetop-dead-tag-text/g)]).toHaveLength(2);
		expect([...line.matchAll(/class="stonetop-dead-tag"/g)]).toHaveLength(2);
	});

	it("wraps the brand's label in its span", () => {
		expect(readRepo("templates/actor/partials/condemned-tag.hbs")).toContain('class="stonetop-condemned-tag-text"');
	});

	it.each([
		["templates/actor/npc.hbs", 1],
		["templates/actor/partials/steading-tab-neighbors.hbs", 2],
	])("wraps every status badge's label in %s", (file, count) => {
		const src = readRepo(file);
		const opens = [...src.matchAll(/<span class="stonetop-npc-status-badge[" ][^>]*>/g)];
		expect(opens, `expected ${count} badge(s) in ${file}`).toHaveLength(count);
		const bare = [...src.matchAll(/<span class="stonetop-npc-status-badge[" ][^>]*>(?!<span class="stonetop-npc-status-badge-text">)/g)];
		expect(bare.map(m => m[0])).toEqual([]);
	});
});

describe("the NPC name row's two pills sit on one line", () => {
	const NAMEROW = ".stonetop-npc-namewrap .stonetop-npc-status-badge";

	it("gives the badge the brand's margin wherever the two stand together", () => {
		// Matching heights are not enough on their own. `vertical-align: middle` centres an atomic
		// inline's MARGIN box, so the brand's 3px-over-0 drops its border box by half of that --
		// the two pills measured 16.47 and 16.48px tall and still sat 1.50px apart at every edge,
		// which is the same fault the height match was made to fix. Both carry the margin now.
		expect(declared(ownRule(CSS, BRAND), "margin")).toBe("3px 6px 0 0");
		expect(declared(ownRule(CSS, NAMEROW), "margin")).toBe("3px 6px 0 0");
	});

	it("keeps that margin off the roster copy, which is centred by its cell already", () => {
		// Hence the descendant selector rather than a line in the badge's own rule: the steading
		// roster's --sm badges sit in a flex cell that centres them, and a top margin there would
		// push them off on its own.
		expect(declared(ownRule(CSS, BADGE), "margin")).toBeNull();
		expect(declared(ownRule(CSS, BADGE), "margin-top")).toBeNull();
	});

	it("is the row the NPC header actually renders the pair in", () => {
		const NPC = readRepo("templates/actor/npc.hbs");
		const row = NPC.match(/<div class="stonetop-npc-namewrap">[\s\S]*?<\/div>/)?.[0];
		expect(row, "the name row is gone from the NPC template").toBeTruthy();
		expect(row).toContain("stonetop-npc-status-badge");
		expect(row).toContain("stonetop.condemned-tag");
	});
});

describe("the small roster copy of the badge", () => {
	const small = ownRule(CSS, SMALL);

	it("restates only the horizontal padding", () => {
		// A padding shorthand here would be harmless today (the base has no vertical padding), but
		// the base's pinned height is in `em` and shrinks with this copy's smaller font on its own;
		// only the sides are this rule's to change.
		expect(padding(small)).toBeNull();
		expect(declared(small, "padding-left")).toBe("6px");
		expect(declared(small, "padding-right")).toBe("6px");
	});
});
