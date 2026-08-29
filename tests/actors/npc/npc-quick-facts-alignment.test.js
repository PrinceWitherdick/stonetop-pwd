import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The NPC quick-facts block (Following / Home / Embodiment / Instinct / Occupation /
// Relations) is a two-track GRID, so all six values start at one left edge no matter how much
// the labels differ in width. Every part of that is a separate declaration in a separate rule,
// and losing any one of them puts the values back on six different x positions - which reads
// as slightly-off prose rather than as an obvious break, so it would ship.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");

const CSS = read("styles/stonetop.css").replace(/\/\*[\s\S]*?\*\//g, "");
const QUICK_FACTS = read("templates/actor/partials/npc-quick-facts.hbs");

/** The declaration body of the rule whose selector list BEGINS a line with `selector`.
    Anchored to the line start on purpose: the classic-layout rule
    `.stonetop-layout-classic ... .npc .stonetop-npc-stat-block` contains the same text and
    comes first in the file, so a bare indexOf reads that rule's `flex: 0 0 auto` instead. */
const ruleFor = (selector) => {
	const at = CSS.indexOf("\n" + selector);
	if (at === -1) return null;
	const open = CSS.indexOf("{", at);
	return CSS.slice(open + 1, CSS.indexOf("}", open));
};

describe("the NPC quick-facts block", () => {
	it("lays its rows out as a two-track grid", () => {
		const rule = ruleFor(".stonetop-npc-stat-block {");
		expect(rule).toMatch(/display:\s*grid/);
		// max-content on the label track: the grid has to size to the LONGEST label rather
		// than to each row's own, which is the whole point. A fixed width would work until a
		// translation or a renamed field overflowed it.
		expect(rule).toMatch(/grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\)/);
	});

	it("hands each field's label and value up to that grid", () => {
		// Without this the <section> wrappers are the grid items, each laying out its own
		// label/value pair again, and nothing aligns across rows.
		expect(ruleFor(".stonetop-npc-stat-block > .stonetop-npc-field {"))
			.toMatch(/display:\s*contents/);
	});

	it("keeps the label and value on a shared baseline", () => {
		expect(ruleFor(".stonetop-npc-stat-block {")).toMatch(/align-items:\s*baseline/);
	});

	it("scopes `display: contents` to the block, leaving the monster stat lines alone", () => {
		// npc.hbs reuses .stonetop-npc-stat-line for the monster stat block, where the rows
		// are plain <div>s outside this block and must stay flex rows of their own. An
		// unscoped rule would flatten those too.
		expect(CSS).not.toMatch(/^\.stonetop-npc-field\s*\{[^}]*display:\s*contents/m);
	});

	it("sentence-cases the values in paint, never in the stored string", () => {
		expect(ruleFor(".stonetop-npc-stat-block > .stonetop-npc-field > .stonetop-npc-prose::first-letter {"))
			.toMatch(/text-transform:\s*uppercase/);
		// It has to stay a paint-time effect: the edit-mode <input>s, the ledger and the
		// steading's Residents table all read the raw field, so a capitalize helper baked
		// into the template (or a write on save) would fight what the GM actually typed.
		expect(QUICK_FACTS).not.toMatch(/capitalize|sentenceCase/i);
	});

	it("still renders every value through .stonetop-npc-prose", () => {
		// The grid rule and the ::first-letter rule both hang off that class as the second
		// child of a field; swap a value to a bare <span> and it silently leaves the tracks.
		const values = QUICK_FACTS.match(/class="stonetop-npc-prose/g) ?? [];
		expect(values.length).toBe(6);
	});
});
