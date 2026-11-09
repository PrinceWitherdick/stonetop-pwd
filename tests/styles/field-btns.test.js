import fs from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { declarations, declared, readCss, readRepo, repoPath } from "../fakes/css.js";

/**
 * RULE: a button beside a field is exactly as tall as the field, everywhere (the user's rule, after
 * the site wizard's dice stood 21px tall beside a 27px dropdown).
 *
 * The mechanism is one class: the row holding a field and its buttons carries `.stonetop-field-btns`
 * (a span grouping some of those buttons carries `.stonetop-field-btns__tools`), and the stylesheet
 * stretches every such button to the row. Measured in a browser, not here: z:/tmp/foundry-verify/
 * field-btns-sweep.mjs renders every marked row under core + system CSS and checks each button's
 * top and bottom against its field at DPR 1, 1.25 and 1.5.
 *
 * What this file holds in place is the two halves a browser can't see missing: the rule itself, and
 * the class on every row that needs it. A new template row with a button straight after a field
 * (or a stepper's button straight before one) fails here until it is marked, or listed in EXEMPT
 * with the reason it isn't a button-beside-a-field.
 */

const CSS = readCss();

/** Handlebars -> static HTML: comments and partials dropped, the first branch of every block kept. */
function flatten(src) {
	src = src.replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{![\s\S]*?\}\}/g, "");
	let out = "";
	let i = 0;
	const stack = [];
	const skipping = () => stack.some(s => s);
	while (i < src.length) {
		const j = src.indexOf("{{", i);
		if (j < 0) { if (!skipping()) out += src.slice(i); break; }
		if (!skipping()) out += src.slice(i, j);
		const triple = src.startsWith("{{{", j);
		const k = src.indexOf(triple ? "}}}" : "}}", j);
		const tag = src.slice(j + (triple ? 3 : 2), k).replace(/^~|~$/g, "").trim();
		i = k + (triple ? 3 : 2);
		if (tag.startsWith("#>")) stack.push(true);
		else if (tag.startsWith("#")) stack.push(false);
		else if (tag.startsWith("/")) stack.pop();
		else if (tag === "else" || tag.startsWith("else ")) { if (stack.length) stack[stack.length - 1] = true; }
		else if (!skipping() && !triple && !tag.startsWith(">")) out += "x";
	}
	return out.replaceAll("<template", "<div").replaceAll("</template>", "</div>");
}

/** Every .hbs under templates/, repo-relative. */
function templates(dir = "templates") {
	return fs.readdirSync(repoPath(dir), { withFileTypes: true }).flatMap(e =>
		e.isDirectory() ? templates(`${dir}/${e.name}`) : e.name.endsWith(".hbs") ? [`${dir}/${e.name}`] : []);
}

const FIELD = "select, input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=color]):not([type=range]):not([type=file])";

/** A row's buttons that sit straight beside a field, as `file: parent > button` lines. */
function besideAField(file) {
	const doc = new Window().document;
	doc.body.innerHTML = flatten(readRepo(file));
	const hits = [];
	for (const b of doc.querySelectorAll("button")) {
		const prev = b.previousElementSibling;
		const next = b.nextElementSibling;
		// Straight after a field, or a stepper's first button straight before one.
		if (!prev?.matches(FIELD) && !(next?.matches(FIELD) && next.nextElementSibling?.tagName === "BUTTON")) continue;
		const row = b.parentElement;
		const marked = row.classList.contains("stonetop-field-btns")
			|| (row.classList.contains("stonetop-field-btns__tools") && row.parentElement?.classList.contains("stonetop-field-btns"));
		if (!marked) hits.push(`${file}: ${row.tagName.toLowerCase()}.${[...row.classList].join(".")} > button.${[...b.classList].join(".")}`);
	}
	return hits;
}

/** Rows that look like a button beside a field but aren't held to it, each with why. */
const EXEMPT = {
	// The neighbour's die sits in a grid beside a LABEL that wraps the neighbour's name and the
	// input together; the two are pinned to one 28px height by their own rules (26576 / 26563).
	"templates/dialogs/background-neighbors.hbs": "grid row, fixed equal heights",
	"templates/dialogs/character-onboarding.hbs": "grid row, fixed equal heights",
};

describe("the field-button rule", () => {
	it("lays a bare row out at zero specificity, so a row's own layout wins", () => {
		const where = declarations(CSS, ":where(.stonetop-field-btns)");
		expect(declared(where, "display")).toBe("flex");
		expect(declared(where, "align-items")).toBe("center");
	});

	it("stretches every button in a row that has a field to the row's height", () => {
		// The field is a child of the row, or of a label that is (the expedition bar's title), so
		// :has() is bounded to those two depths rather than searching every descendant.
		const F = 'input:not([type="checkbox"], [type="radio"], [type="hidden"])';
		const has = `.stonetop-field-btns:has(> :is(select, ${F}), > label > :is(select, ${F})) > button`;
		const body = declarations(CSS, has);
		expect(declared(body, "align-self")).toBe("stretch !important");
		expect(declared(body, "height")).toBe("auto !important");
		expect(declared(body, "min-height")).toBe("0 !important");
		// Core's 28px button line would make a button taller than a 26px field and push the row open.
		expect(declared(body, "line-height")).toBe("normal !important");
	});
});

describe("every button beside a field is in a .stonetop-field-btns row", () => {
	const files = templates().filter(f => !(f in EXEMPT));

	it("finds the rows it is meant to find", () => {
		// The detector itself: the site wizard's dice row is one, and it is marked.
		const doc = new Window().document;
		doc.body.innerHTML = flatten(readRepo("templates/dialogs/partials/cs-pick-slots.hbs"));
		const roll = doc.querySelector(".stonetop-cs-roll");
		expect(roll.previousElementSibling.matches(FIELD)).toBe(true);
		expect(roll.parentElement.classList.contains("stonetop-field-btns")).toBe(true);
	});

	it("in every template", () => {
		expect(files.flatMap(besideAField)).toEqual([]);
	});

	it("in the rows built in JS", () => {
		for (const [file, row] of [
			["module/actors/character/StonetopCharacterSheet.js", "stonetop-trait-custom-row stonetop-field-btns"],
			["module/dialogs/RollDialog.js", "stonetop-roll-modifier-stepper stonetop-field-btns"],
			["module/seasons/season-picker.js", "stonetop-season-year-stepper stonetop-field-btns"],
			["module/utils/ledger-dialog.js", "stonetop-ledger-toolbar stonetop-field-btns"],
		]) expect(readRepo(file), file).toContain(`class="${row}"`);
	});
});

describe("square steppers read --st-square in their own rules", () => {
	// Each row names its square once; its number box's height and its buttons' width read it in
	// the component's own rule, so no shared rule has to list them by name and beat them with
	// !important, and no dead fixed size is left behind underneath.
	const ROWS = [
		// [row rule, number box rule, step rule, the square]
		[".steading-herd-stepper", ".steading-herd-input", ".steading-herd-step", "26px"],
		[".stonetop-season-year-stepper", ".stonetop-season-year-stepper > .stonetop-season-year-input", ".stonetop-season-picker .stonetop-season-year-step", "26px"],
		[".stonetop-crew-size-row", ".stonetop-crew-size-input", ".stonetop-crew-size-step", "24px"],
		[".stonetop-crew-size-row", ".stonetop-custom-group-size-input", ".stonetop-custom-group-size-step", "24px"],
		[".stonetop-follower-gear-item", ".stonetop-follower-gear-label", ".stonetop-follower-gear-item .stonetop-follower-gear-remove", "26px"],
		[".stonetop-roll-modifier-stepper", '.stonetop-roll-modifier-stepper input[name="modifier"]', ".stonetop-roll-modifier-step", "var(--input-height, 2rem)"],
	];
	for (const [row, box, step, size] of ROWS) {
		it(step, () => {
			expect(declared(declarations(CSS, row), "--st-square"), row).toBe(size);
			expect(declared(declarations(CSS, box), "height"), box).toBe("var(--st-square)");
			const stepBody = declarations(CSS, step);
			expect(declared(stepBody, "width"), step).toBe("var(--st-square)");
			// The row stretches the step to the box; a fixed height here would be dead.
			expect(declared(stepBody, "height"), step).toBeFalsy();
		});
	}

	it("no shared rule sizes them from outside", () => {
		expect(CSS).not.toMatch(/\.stonetop-field-btns\s*>\s*:is\(\s*\.steading-herd/);
		expect(CSS).not.toMatch(/width:\s*var\(--st-square\)\s*!important/);
	});
});

describe("no button rule pins a marked button's height with !important", () => {
	// The rule's own height is !important; a button rule that is too would win on specificity and
	// pin the button short again (the follower gear X was `height: 18px !important` beside 26px).
	it("the follower gear X leaves its height to the row", () => {
		const sel = ".stonetop-follower-gear-item .stonetop-follower-gear-remove";
		expect(declared(declarations(CSS, sel), "height"), sel).toBeFalsy();
	});
});
