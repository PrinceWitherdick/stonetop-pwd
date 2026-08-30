import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// The vertical tab rail's glyphs. Every way these break is SILENT, because a mask that goes
// wrong still lays out: the tab keeps its size, its hover, its click, and simply shows nothing
// (a missing file, an empty mask) or a filled 20x20 block (a file with no transparency). Both
// look like a rendering fault rather than a broken reference, and neither logs anything.
//
// The two shapes to know, from assets/icons/tabs/ATTRIBUTION.md:
//   • the game-icons.net EXPORT form is already right — a background square at
//     `fill-opacity="0"` behind an opaque glyph; while
//   • the same drawings in their REPOSITORY form are inverted — an opaque square under a white
//     glyph — which as a mask is a solid slab. Those get their square punched transparent on
//     the way in, and this file is what stops one arriving unpunched.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ICON_DIR = path.join(ROOT, "assets/icons/tabs");

const CSS = fs.readFileSync(path.join(ROOT, "styles/stonetop.css"), "utf8");
const ATTRIBUTION = fs.readFileSync(path.join(ICON_DIR, "ATTRIBUTION.md"), "utf8");

/** Every `data-tab` -> icon filename the rail declares. */
const DECLARED = [...CSS.matchAll(
	/\.stonetop-tab-rail \.item\[data-tab="([\w-]+)"\]\s*\{\s*--st-tab-icon:\s*url\('([^']+)'\)/g)
].map(m => ({ tab: m[1], url: m[2], file: path.basename(m[2]) }));

const ON_DISK = fs.readdirSync(ICON_DIR).filter(f => f.endsWith(".svg"));

/**
 * Every `.js` under `module/`, joined — for the one question the icon table cannot answer: does
 * anything OUTSIDE the rail point at this file? See "ships no icon nothing points at".
 */
const SOURCE = (function walk(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (entry.name.endsWith(".js")) out.push(fs.readFileSync(full, "utf8"));
	}
	return out;
})(path.join(ROOT, "module")).join("\n");

describe("tab rail icons", () => {
	it("finds the declarations at all (guards the scan itself)", () => {
		expect(DECLARED.length).toBeGreaterThan(10);
	});

	// A url() that resolves to nothing is an empty mask, which hides the glyph completely and
	// leaves a tab that is only a hit target.
	it("points every tab at a file that exists", () => {
		const missing = DECLARED.filter(d => !ON_DISK.includes(d.file));
		expect(missing.map(d => `${d.tab} -> ${d.file}`)).toEqual([]);
	});

	// Foundry serves these from the system root, so the path has to be the absolute one it
	// understands, not a stylesheet-relative one.
	it("addresses them the way Foundry serves them", () => {
		const bad = DECLARED.filter(d => d.url !== `/systems/stonetop-pwd/assets/icons/tabs/${d.file}`);
		expect(bad.map(d => d.url)).toEqual([]);
	});

	// THE SLAB TRAP. An unpunched full-canvas square is opaque everywhere, so the mask passes
	// everything and the tab wears a solid block. Matches the background rect in either the
	// `<path d="M0 0h512v512H0z"/>` or `<rect width="512" height="512"/>` form, and demands
	// that whichever is present has been made transparent.
	it("leaves no icon with an opaque full-canvas background", () => {
		const slabs = [];
		for (const file of ON_DISK) {
			const svg = fs.readFileSync(path.join(ICON_DIR, file), "utf8");
			for (const bg of svg.match(/<(?:path|rect)[^>]*(?:d="M0 0h(\d+)v\1H0z"|width="(\d+)"[^>]*height="\2")[^>]*>/g) ?? []) {
				if (!/fill-opacity="0"|fill="none"/.test(bg)) slabs.push(`${file}: ${bg}`);
			}
		}
		expect(slabs, `Background square never punched transparent:\n  ${slabs.join("\n  ")}`).toEqual([]);
	});

	// ...and the other half of that: something has to be opaque, or the tab shows nothing.
	it("leaves every icon with a glyph to show", () => {
		const empty = ON_DISK.filter(f => {
			const svg = fs.readFileSync(path.join(ICON_DIR, f), "utf8");
			// Every path that is NOT the transparent background.
			return !(svg.match(/<(?:path|rect|circle|polygon)[^>]*>/g) ?? [])
				.some(el => !/fill-opacity="0"|fill="none"/.test(el));
		});
		expect(empty, `Icons with nothing opaque in them:\n  ${empty.join("\n  ")}`).toEqual([]);
	});

	// These ship in the release zip, so an icon nothing points at is dead weight that also
	// outlives the reason it was added.
	//
	// THE RAIL IS NOT THE ONLY READER, which is why this scans the source rather than only the
	// icon table. `site-mound.svg` is the case that proved it: Sites stopped being a tab when it
	// was folded into the Expeditions panel, so its row left the table — but the same file is
	// still the map-pin icon a placed site wears (module/journal/gm-prep-page.js). Asking only
	// the rail would have called it dead and deleted the pin's glyph.
	it("ships no icon nothing points at", () => {
		const used = new Set(DECLARED.map(d => d.file));
		const orphans = ON_DISK.filter(f => !used.has(f) && !SOURCE.includes(`tabs/${f}`));
		expect(orphans, `Icons nothing references:\n  ${orphans.join("\n  ")}`).toEqual([]);
	});

	// Every glyph here is either CC BY 3.0 (game-icons.net, attribution REQUIRED) or derived
	// from the Stonetop books. Shipping one with no provenance recorded is the kind of thing
	// nobody notices until it matters.
	it("records where every icon came from", () => {
		expect(ON_DISK.filter(f => !ATTRIBUTION.includes(f))).toEqual([]);
	});
});
