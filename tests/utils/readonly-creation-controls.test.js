import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRepo as read, readCss, stripComments, declarations } from "../fakes/css.js";

/**
 * Writing a thing down is play; unlocking a section is editing.
 *
 * Sections that can be locked hang `stonetop-readonly` off their pencil, and the stylesheet turns
 * that into a blanket `pointer-events: none` on every input, button, select and label inside. The
 * blanket is right for the CONTENTS of a list and wrong for the bar at the foot that starts a new
 * one: those bars are rendered to any owner on purpose, so a resource, a resident or a custom
 * improvement can be jotted down without opening the pencil first. Each one that should stay live
 * needs a line on the allow-list, and the ones that have such a line got it one accident at a
 * time — the Improvements bar spent its whole life mouse-dead, exactly as the threat-type
 * reference had before it, because nobody thinks to check a button that renders perfectly well.
 *
 * So this scans instead of listing: every template that can lock, every creation button inside it
 * (following partial includes, since the add bars come from a shared partial rather than from the
 * tab that draws them), and the assertion that the stylesheet lets each one through. A new tab, a
 * new bar or a new prep kind is covered the day it is written, without anyone remembering to come
 * back here.
 *
 * DELIBERATELY CONSERVATIVE about scope: it asks whether the template CAN lock, not whether this
 * particular button sits inside the element that carries the class. Today every creation button in
 * these files does. If a future tab puts one outside the locked box and this fails, the fix is to
 * teach the scan where the box ends, not to drop the button from the sweep.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CSS = readCss();

/** Every .hbs under templates/, repo-relative. */
function templateFiles(dir = "templates") {
	const out = [];
	for (const entry of fs.readdirSync(path.resolve(ROOT, dir), { withFileTypes: true })) {
		const rel = `${dir}/${entry.name}`;
		if (entry.isDirectory()) out.push(...templateFiles(rel));
		else if (entry.name.endsWith(".hbs")) out.push(rel);
	}
	return out;
}

// Partial name to repo-relative path, read out of the preload map in stonetop.js rather than
// guessed from the name, so a renamed system id or a moved partial cannot quietly turn the
// expansion below into a no-op (which would take the add bars out of the sweep with it).
const PARTIALS = new Map(
	[...read("stonetop.js").matchAll(/"(stonetop\.[\w-]+)":\s*"systems\/[^/]+\/(templates\/[^"]+)"/g)]
		.map(m => [m[1], m[2]]));

/**
 * A template with its `{{> "partial"}}` includes inlined, comments stripped.
 *
 * The whole point: `.stonetop-prep-add-btn` is written in gm-prep-add-bar.hbs and only REACHES a
 * lockable section by being included into one. Reading the tab alone finds nothing.
 */
function expand(rel, seen = new Set()) {
	if (seen.has(rel)) return "";   // a partial included twice has already contributed its classes
	seen.add(rel);
	return stripComments(read(rel)).replace(/\{\{>\s*"([^"]+)"[^}]*\}\}/g, (whole, name) => {
		const target = PARTIALS.get(name);
		return target ? expand(target, seen) : whole;
	});
}

// "add", "create" or "new" as a whole word in a class token: steading-list-add,
// stonetop-prep-add-btn, stonetop-inv-add-btn. Not "address", not "renew".
const CREATION = /(^|-)(add|create|new)(-|$)/;

/** The static class tokens of every creation-ish <button> in this source. */
function creationButtonClasses(src) {
	const found = new Set();
	for (const [, attrs] of src.matchAll(/<button\b([^>]*)>/g)) {
		const cls = attrs.match(/class="([^"]*)"/)?.[1];
		if (!cls) continue;
		for (const token of cls.split(/\s+/)) {
			// A token carrying handlebars is either half a conditional or a per-use hook like
			// `{{kind}}-add-btn`, which is a different class on every render and so cannot be
			// what the stylesheet names. The shared look-class beside it is.
			if (!token || token.includes("{{")) continue;
			if (CREATION.test(token)) found.add(token);
		}
	}
	return found;
}

/**
 * Does any rule grant this class `pointer-events: auto` under `.stonetop-readonly`?
 *
 * Matched loosely on the left of the class on purpose: an exemption may be scoped to the tab it
 * belongs to (`.stonetop-readonly.improvements .stonetop-prep-add-btn`) rather than written bare,
 * and a scoped one is the better citizen — see the allow-list comment in the stylesheet.
 */
function exemptUnderReadonly(cls) {
	const entry = new RegExp(`\\.stonetop-readonly[^,{]*\\.${cls}(?![\\w-])`);
	for (const [, prelude, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		if (!/pointer-events:\s*auto/.test(body)) continue;
		if (prelude.split(",").some(s => entry.test(s.trim()))) return true;
	}
	return false;
}

const LOCKABLE = templateFiles().filter(rel => stripComments(read(rel)).includes("stonetop-readonly"));

describe("a creation control inside a lockable section stays clickable", () => {
	// Everything below is vacuous without the blanket, and the blanket is one rule with no
	// selector naming a button by class — easy to "tidy" away, at which point the exemptions
	// become decoration and the tests still pass.
	it("has the blanket lock these exemptions are exemptions FROM", () => {
		expect(declarations(CSS, ".stonetop-readonly button")).toMatch(/pointer-events:\s*none/);
	});

	// The scan finding nothing would also pass every assertion below it, and it has three ways to
	// find nothing: no template matched, the partial map stopped resolving, or the class-token
	// shape changed. Pin one known bar from each side of the include boundary.
	it("actually finds the lockable sections and the bars inside them", () => {
		expect(LOCKABLE.length).toBeGreaterThanOrEqual(6);
		expect(PARTIALS.size).toBeGreaterThan(50);
		const all = new Set(LOCKABLE.flatMap(rel => [...creationButtonClasses(expand(rel))]));
		// Written in the tab itself, and reached only through a partial, respectively.
		expect(all).toContain("steading-list-add");
		expect(all).toContain("stonetop-prep-add-btn");
	});

	for (const rel of LOCKABLE) {
		const classes = [...creationButtonClasses(expand(rel))];
		if (!classes.length) continue;
		it(`keeps every creation control in ${rel} clickable while locked`, () => {
			for (const cls of classes) {
				expect(exemptUnderReadonly(cls),
					`.${cls} is mouse-dead until the pencil is opened; it needs a line on the readonly allow-list`)
					.toBe(true);
			}
		});
	}
});
