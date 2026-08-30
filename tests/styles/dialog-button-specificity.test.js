import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCss, splitSelectorList } from "../fakes/css.js";

/**
 * A per-dialog rule that sizes its own footer buttons, and loses.
 *
 * `.vtt .stonetop.dialog .dialog-buttons button` is the shared look for the footer of every
 * native Dialog we tag `.stonetop`: slate fill near the top of the stylesheet, and — since the
 * wrapping-label fix — a centred flex box with its own `min-height` and `line-height`. At 0-4-1
 * it deliberately out-specifies core, whose `body.game .app button` pins a 28px leading from
 * inside `@layer compatibility`.
 *
 * The cost of sitting that high is that it also out-specifies the obvious way to dress ONE
 * dialog's buttons. `.stonetop-foo-dialog .dialog-buttons button` is 0-2-1, so anything it
 * declares that the shared rule also declares never lands — and because that is specificity
 * rather than order, moving the rule further down the file does not help it. Nothing is logged,
 * the buttons render, and the stylesheet reads as though the override were in force: two rules
 * had already drifted into that state before this test existed, one of them describing a
 * transparent outline on buttons that had been solid slate for months.
 *
 * So the rule is: to override the shared five, carry the shared scope. This file finds the
 * dialogs that are actually tagged `.stonetop` — from the `classes:` arrays in module/, not from
 * a list kept here — and fails any button rule of theirs that declares a shared property from
 * below it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = path.resolve(HERE, "../../module");

const CSS = readCss();

/** Every .js under module/, so a dialog added anywhere is covered without a list to keep. */
function jsFiles(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...jsFiles(full));
		else if (entry.name.endsWith(".js")) out.push(full);
	}
	return out;
}

/**
 * The `stonetop-*` scope classes that ride ALONGSIDE the bare `stonetop` class on a Dialog.
 *
 * The bare class is what pulls in the shared footer rule, so a dialog without it is not in
 * competition and must not be failed here. Read off the `classes:` array that opens the window,
 * which is the only place the pairing is decided.
 */
const SCOPES = new Set();
for (const file of jsFiles(MODULE_DIR)) {
	const src = fs.readFileSync(file, "utf8");
	for (const [, list] of src.matchAll(/classes:\s*\[([^\]]*)\]/g)) {
		const names = [...list.matchAll(/["']([^"']+)["']/g)].map(m => m[1]);
		if (!names.includes("stonetop")) continue;
		for (const name of names) if (/^stonetop-/.test(name)) SCOPES.add(name);
	}
}

/** CSS specificity as [ids, classes, elements]; enough for the flat selectors in this file. */
function specificity(selector) {
	const ids = (selector.match(/#[\w-]+/g) || []).length;
	const classes = (selector.match(/\.[\w-]+/g) || []).length
		+ (selector.match(/\[[^\]]*\]/g) || []).length
		+ (selector.match(/(?<!:):(?!:)[\w-]+/g) || []).length;
	const elements = (selector
		.replace(/[.#][\w-]+/g, "")
		.replace(/\[[^\]]*\]/g, "")
		.replace(/::?[\w-]+/g, "")
		.match(/\b[a-zA-Z][\w-]*/g) || []).length;
	return [ids, classes, elements];
}

const beats = (a, b) => (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0;

/** Every rule in the stylesheet, one entry per comma-separated selector. */
const RULES = [];
for (const [, prelude, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
	const props = [...body.matchAll(/(^|[;\s])([-\w]+)\s*:/g)].map(m => m[2]);
	for (const selector of splitSelectorList(prelude)) {
		RULES.push({ selector, props, spec: specificity(selector), hover: /:hover/.test(selector) });
	}
}

/** The shared rules themselves: the ones every `.stonetop` Dialog's buttons already answer to. */
const SHARED = RULES.filter(r => /^\.vtt \.stonetop\.dialog \.dialog-buttons button(:hover)?$/.test(r.selector));

/** A rule that dresses ONE tagged dialog's footer buttons. */
const PER_DIALOG = RULES.filter(r =>
	r.selector.includes(".dialog-buttons")
	&& /\bbutton\b|\[data-button/.test(r.selector)
	&& !SHARED.includes(r)
	&& [...SCOPES].some(scope => r.selector.includes(`.${scope}`)));

describe("per-dialog footer button rules sit above the shared one", () => {
	it("finds both sides of the comparison (guards every assertion below)", () => {
		// If the shared rule is renamed or the `classes:` scan stops matching, every loop below
		// runs over an empty list and passes without checking anything.
		expect(SHARED.length, "the shared .stonetop.dialog button rules are gone or renamed")
			.toBeGreaterThanOrEqual(2);
		expect(SHARED.some(r => !r.hover)).toBe(true);
		expect(SCOPES.size, "no dialog was found pairing a stonetop-* scope with the bare class")
			.toBeGreaterThan(10);
		expect(PER_DIALOG.length, "no per-dialog button rule was found to check")
			.toBeGreaterThan(0);
	});

	it("declares nothing the shared rule already owns from below it", () => {
		const dead = [];
		for (const rule of PER_DIALOG) {
			// A `:hover` rule is measured against the shared hover AND the shared base, because
			// both apply while the pointer is down on it — and the base, carrying an element in
			// its selector, can out-specify a hover rule that does not.
			const rivals = SHARED.filter(s => !s.hover || rule.hover);
			for (const prop of rule.props) {
				const winner = rivals.find(s => s.props.includes(prop) && beats(s.spec, rule.spec));
				if (winner) {
					dead.push(`${rule.selector} (${rule.spec.join("-")}) declares ${prop}, `
						+ `which ${winner.selector} (${winner.spec.join("-")}) already owns`);
				}
			}
		}
		expect(dead, `these declarations never land:\n  ${dead.join("\n  ")}`).toEqual([]);
	});
});
