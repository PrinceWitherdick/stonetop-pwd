import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACKS } from "../scripts/packs.js";

/**
 * `system.json` is the file Foundry reads before any of our code runs, and almost everything it
 * declares is a promise about something ELSE in the tree: a module that must exist, a stylesheet
 * that must load, a pack directory the build must produce, a document subtype the language file
 * must name. Nothing in the suite checked any of those promises.
 *
 * Where they were checked at all, it was in `release.yml`, which runs on `release: published`.
 * That is the wrong end of the process: by the time it fails, the tag exists, the release exists,
 * and fixing it means deleting both and re-cutting. Everything here is knowable from the tree
 * alone, so it belongs in `npm test`, where it fails on the pull request instead.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));

/**
 * Does this repo-relative path exist, matching case at EVERY level?
 *
 * `fs.existsSync` is the wrong tool for the bug this catches. The maintainer develops on NTFS,
 * which is case-insensitive: `styles/Stonetop.css` opens the real file, the sheet renders, the
 * suite is green. Users hosting on The Forge get Linux, where the same string is a 404 and the
 * system loads with no stylesheet at all. Only a component-by-component walk can see the
 * difference, and a single `existsSync` anywhere in the chain puts the hole straight back.
 */
function existsCaseExact(rel) {
	const parts = rel.split("/").filter(Boolean);
	let dir = ROOT;
	for (const part of parts) {
		let entries;
		try {
			entries = fs.readdirSync(dir);
		} catch {
			return false;
		}
		if (!entries.includes(part)) return false;
		dir = path.join(dir, part);
	}
	return true;
}

describe("system.json declares what the tree actually contains", () => {
	it("points every esmodule, stylesheet and language file at a real path, case-exactly", () => {
		for (const rel of manifest.esmodules ?? []) expect(existsCaseExact(rel), rel).toBe(true);
		for (const rel of manifest.styles ?? []) expect(existsCaseExact(rel), rel).toBe(true);
		for (const lang of manifest.languages ?? []) expect(existsCaseExact(lang.path), lang.path).toBe(true);

		// Non-empty, so a manifest that simply stopped declaring them cannot pass.
		expect(manifest.esmodules?.length).toBeGreaterThan(0);
		expect(manifest.styles?.length).toBeGreaterThan(0);
		expect(manifest.languages?.length).toBeGreaterThan(0);
	});

	it("declares exactly the packs the build produces", () => {
		// The drift this catches: `scripts/packs.js` is what `npm run pack` compiles, and
		// `system.json` is what Foundry mounts. Add a pack to one and not the other and the
		// build succeeds either way. Foundry then either mounts a directory that was never
		// compiled (an empty compendium, no error) or silently ignores one that was.
		//
		// Today the only thing that notices is release.yml's "declared pack missing" check,
		// which runs after the tag is pushed.
		const declared = manifest.packs.map(p => p.path.replace(/^packs\//, "")).sort();
		const built = PACKS.map(p => p.name).sort();
		expect(declared).toEqual(built);
	});

	it("gives every declared pack a path under packs/ and a type the builder knows", () => {
		const typeByName = Object.fromEntries(PACKS.map(p => [p.name, p.type]));
		for (const pack of manifest.packs) {
			expect(pack.path, pack.path).toMatch(/^packs\/[a-z0-9-]+$/);
			expect(pack.type, pack.path).toBe(typeByName[pack.path.replace(/^packs\//, "")]);
		}
	});

	it("names every document subtype in the language file", () => {
		// Foundry stamps `TYPES.<Document>.<subtype>` into the type labels unconditionally, and
		// `localize()` returns the KEY when there is no translation. A subtype missing here does
		// not fall back to something readable: the Configure Default Sheets dialog and the sheet
		// header render the literal string "TYPES.JournalEntryPage.bestiary" at the user.
		//
		// This is not hypothetical. All six JournalEntryPage subtypes were missing when this
		// test was written, which is every bestiary, location, chronicle, threat, hazard and
		// site page in the system.
		const types = JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8")).TYPES;
		const missing = [];
		for (const [doc, subtypes] of Object.entries(manifest.documentTypes ?? {})) {
			for (const subtype of Object.keys(subtypes)) {
				if (typeof types?.[doc]?.[subtype] !== "string") missing.push(`TYPES.${doc}.${subtype}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it("keeps the compatibility range and the identity fields the installer reads", () => {
		expect(manifest.id).toBe("stonetop-pwd");
		expect(manifest.compatibility?.minimum).toBeTruthy();
		expect(manifest.compatibility?.verified).toBeTruthy();
		// The manifest URL is what an installed world re-fetches to find an update. Pointing it
		// at anything but this repository's latest release silently hands users someone else's
		// package, which is the failure the release workflow's make_latest gating exists for.
		expect(manifest.manifest).toBe(
			"https://github.com/PrinceWitherdick/stonetop-pwd/releases/latest/download/system.json",
		);
	});
});
