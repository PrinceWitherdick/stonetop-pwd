import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readRepo as read } from "../fakes/css.js";

// Every `{{> "stonetop.x"}}` in the tree resolves to a real file, through a real loadTemplates
// entry.
//
// Handlebars does not resolve a partial until the moment it renders, and an unregistered one
// throws "The partial stonetop.x could not be found" from inside `renderTemplate` — which, for a
// dialog, means the whole window fails to open. Nothing else checks this: the map in stonetop.js
// is ~70 hand-written string pairs, none of them referenced from the templates that need them by
// anything a tool can follow. `npm test` stays green either way.
//
// Three ways it goes wrong, all of them silent until someone opens the window: a partial invoked
// but never registered; a path typo'd or a file moved; and a registration lost to a merge — which
// is not hypothetical, it is how this test came to exist.

const ROOT = path.resolve(import.meta.dirname, "../..");
const BOOT = read("stonetop.js");

// The registration map: "stonetop.name" -> "systems/stonetop-pwd/templates/….hbs".
const registered = new Map(
	[...BOOT.matchAll(/"(stonetop\.[\w-]+)":\s*"(systems\/stonetop-pwd\/[^"]+\.hbs)"/g)]
		.map(m => [m[1], m[2]]),
);

// Every partial invocation in every template, plain (`{{> "x"}}`) or block (`{{#> "x"}}`).
function invocations() {
	const found = new Map();   // name -> the files that ask for it
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) { walk(full); continue; }
			if (!entry.name.endsWith(".hbs")) continue;
			const src = fs.readFileSync(full, "utf8").replace(/\{\{!--[\s\S]*?--\}\}/g, "");
			for (const m of src.matchAll(/\{\{#?>\s*"(stonetop\.[\w-]+)"/g)) {
				const where = path.relative(ROOT, full).replace(/\\/g, "/");
				found.set(m[1], [...(found.get(m[1]) ?? []), where]);
			}
		}
	};
	walk(path.join(ROOT, "templates"));
	return found;
}

/** Every .js under module/, plus the boot file, as one string — for "is this path named anywhere". */
function jsSources() {
	const parts = [BOOT];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".js")) parts.push(fs.readFileSync(full, "utf8"));
		}
	};
	walk(path.join(ROOT, "module"));
	return parts.join("\n");
}

describe("Handlebars partial registration", () => {
	const asked = invocations();

	it("finds the registration map and the invocations, so the checks below mean something", () => {
		expect(registered.size).toBeGreaterThan(30);
		expect(asked.size).toBeGreaterThan(30);
		// Both invocation forms are actually being seen — a regex that quietly stopped matching
		// block partials would leave the whole file passing while checking half the tree.
		expect(asked.get("stonetop.section-heading"), "plain {{> …}} form").toBeTruthy();
		expect(asked.get("stonetop.cs-list-frame"), "block {{#> …}} form").toBeTruthy();
		expect(registered.get("stonetop.cs-list-frame")).toBe(
			"systems/stonetop-pwd/templates/dialogs/partials/cs-list-frame.hbs",
		);
	});

	it("registers every partial a template invokes", () => {
		const missing = [...asked].filter(([name]) => !registered.has(name))
			.map(([name, files]) => `${name}  (asked for by ${files.join(", ")})`);
		expect(missing, `\nUnregistered partials:\n${missing.join("\n")}\n`).toEqual([]);
	});

	it("points every registration at a file that exists", () => {
		const broken = [...registered]
			.filter(([, p]) => !fs.existsSync(path.join(ROOT, p.replace("systems/stonetop-pwd/", ""))))
			.map(([name, p]) => `${name} -> ${p}`);
		expect(broken, `\nRegistrations with no file:\n${broken.join("\n")}\n`).toEqual([]);
	});

	// Not a hard failure in Foundry — an unused registration just precaches a template nobody
	// draws — but it is how a rename leaves the old name behind, and the pair then drifts.
	//
	// A registration earns its place two ways: a template invokes it by NAME, or something in the
	// JS names its PATH (the whole-sheet and whole-dialog templates are in this map to be
	// precached, and are reached through a `template:` option rather than as partials).
	it("has no registration nothing uses", () => {
		const js = jsSources();
		const orphans = [...registered]
			.filter(([name, p]) => !asked.has(name) && !js.includes(p))
			.map(([name, p]) => `${name} -> ${p}`);
		expect(orphans, `\nRegistered but never used:\n${orphans.join("\n")}\n`).toEqual([]);
	});
});
