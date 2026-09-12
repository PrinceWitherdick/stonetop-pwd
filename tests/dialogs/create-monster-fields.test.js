import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";

// The Dangers worksheet is a form template and a reader joined by nothing but agreed field names:
// `create-monster.hbs` writes `name="attackName"`, `_readSelections` asks for `text("attackName")`,
// and neither end knows whether the other kept its side of the bargain.
//
// BOTH ENDS FAIL SILENTLY. The reader's helpers all fall back to "" or [] on a selector that
// matches nothing, so a renamed field reads as a GM who typed nothing: the monster is created,
// with the worksheet's answer quietly missing from it. That is worse than a crash, because the
// stat block looks finished. Nothing in the suite read this template before.

const HBS = read("templates/dialogs/create-monster.hbs");
const JS  = read("module/dialogs/CreateMonsterDialog.js");

/** Every field name `_readSelections` asks the form for. */
function namesRead() {
	const body = JS.slice(JS.indexOf("_readSelections("));
	const selections = body.slice(0, body.indexOf("\n\tasync _submit"));
	return [...new Set(Array.from(
		selections.matchAll(/\b(?:text|radio|checks)\("([^"]+)"\)/g), m => m[1]))];
}

/** Every field name the template actually renders. */
const namesRendered = new Set(Array.from(HBS.matchAll(/name="([^"{}]+)"/g), m => m[1]));

/** Every class token the template renders, as WHOLE tokens: a prefix test would call a renamed
 *  `cm-attack-dieX` a match for `cm-attack-die` and pass on exactly the drift it exists to catch. */
const classesRendered = new Set(Array.from(HBS.matchAll(/class="([^"]*)"/g), m => m[1])
	.flatMap(value => value.split(/\s+/))
	.filter(Boolean));

describe("the Dangers worksheet reads the fields it renders", () => {
	it("asks for nothing the template does not render", () => {
		const asked = namesRead();
		// A sanity floor: if the extraction ever stops finding the reads, the loop below would
		// pass vacuously and guard nothing at all.
		expect(asked.length).toBeGreaterThan(10);
		expect(asked.filter(name => !namesRendered.has(name))).toEqual([]);
	});

	it("renders nothing the reader never asks for", () => {
		// The other direction: a field a GM can fill in that reaches no monster is just as silent.
		const asked = new Set(namesRead());
		expect([...namesRendered].filter(name => !asked.has(name))).toEqual([]);
	});

	it("queries no card class the template does not render", () => {
		// The repeaters (moves, and Step 6's other attacks) are wired by CLASS rather than by
		// field name, because their rows are cloned from a <template> and a shared `name` would
		// pile every card's ticks onto every attack. Same silent failure, different join: every
		// reach into a card is optional-chained, so a class that matches nothing adds no card,
		// reads no value, and throws nothing.
		const queried = [...new Set(Array.from(
			JS.matchAll(/["'`]\.(cm-(?:move|attack)-[a-z-]+)/g), m => m[1]))];
		expect(queried.length).toBeGreaterThan(8);
		expect(queried.filter(cls => !classesRendered.has(cls))).toEqual([]);
	});

	it("asks what the monster attacks with, so the damage line is named", () => {
		// The one field whose absence is invisible until combat: with no name, the line is a bare
		// die and the "which attack?" buttons come up blank. See data/monster-builder.js.
		expect(namesRendered.has("attackName")).toBe(true);
		expect(namesRead()).toContain("attackName");
	});
});
