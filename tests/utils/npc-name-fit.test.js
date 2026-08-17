import { describe, it, expect } from "vitest";
import { readRepo, readCss, declarations } from "../fakes/css.js";

// The NPC header's name is shrunk to fit the column it has (utils/sheet-chrome.js
// fitDisplayName) instead of wrapping and pushing the pronouns/traits under it down the header.
// That fit is a contract between JS and CSS held together by two custom property NAMES, and
// every way it breaks is silent:
//
//  • the JS writes --st-npc-name-size onto the header, and the stylesheet has to be the thing
//    that reads it. If the consuming declaration is renamed or dropped, the fit computes a
//    perfectly good size and nothing anywhere uses it.
//  • the floor is read back OUT of the CSS (--st-npc-name-min-size). With no such declaration
//    the helper reads an empty string, and its `floor > 0` guard then leaves the name at full
//    size — i.e. exactly the unfitted behaviour it exists to replace.
//  • the shared .stonetop-name-field rule sets `font-size: … !important`. The NPC rule wins on
//    specificity, but only while it is ALSO !important; dropped, the fitted size is overridden
//    by the very declaration it is meant to replace.

const CSS = readCss();
const SHEET = readRepo("module/actors/npc/StonetopNpcSheet.js");
const CHROME = readRepo("module/utils/sheet-chrome.js");

/** Everything an exact selector declares, across every rule that names it — see fakes/css.js. */
const block = (selector) => declarations(CSS, selector);

const SIZE_VAR = "--st-npc-name-size";
const MIN_VAR = "--st-npc-name-min-size";

describe("NPC header name fit", () => {
	it("asks for the custom properties the stylesheet actually declares", () => {
		// The sheet is the only caller, and it names both variables inline.
		expect(SHEET).toContain(`sizeVar: "${SIZE_VAR}"`);
		expect(SHEET).toContain(`minVar:  "${MIN_VAR}"`);
	});

	it("declares the floor the fit reads back out of the CSS", () => {
		const header = block(".stonetop-npc-header");
		expect(header, ".stonetop-npc-header rule").toBeTruthy();
		expect(header).toMatch(new RegExp(`${MIN_VAR}\\s*:\\s*\\d`));
	});

	it("consumes the fitted size on the name field, with the unfitted size as its fallback", () => {
		const field = block(".stonetop-npc-header .stonetop-name-field");
		expect(field, ".stonetop-npc-header .stonetop-name-field rule").toBeTruthy();
		const decl = field.match(/font-size\s*:\s*([^;]+);/)?.[1] ?? "";
		expect(decl).toContain(`var(${SIZE_VAR}`);
		// A name that already fits leaves no variable behind at all, so the fallback is what
		// every unfitted NPC name is set at.
		expect(decl).toMatch(new RegExp(`var\\(${SIZE_VAR}\\s*,\\s*var\\(--font-size-display\\)\\s*\\)`));
		// Beats the shared .stonetop-name-field rule, which declares font-size !important.
		expect(decl).toContain("!important");
	});

	it("keeps the shared rule it has to outrank !important, so the override stays necessary", () => {
		// If this ever stops being !important, the NPC rule's own !important can go too — but
		// silently leaving both is not the failure; silently dropping only ours is.
		expect(block(".stonetop-name-field")).toMatch(/font-size\s*:[^;]*!important/);
	});

	it("fits against the column the pronouns are pinned to, and that column has a height to fit", () => {
		// The fit's whole stopping condition is "the column is no longer overflowing", read off
		// that column's own min-height. Point it at a box with no min-height and `columnFits`
		// answers false forever, so every long name shrinks to the floor instead of stopping at
		// the size that actually fixed the header (37px vs 28px for a two-line name).
		expect(SHEET).toContain(`column:  ".stonetop-npc-header-text"`);
		const column = block(".stonetop-npc-header-text");
		expect(column, ".stonetop-npc-header-text rule").toBeTruthy();
		expect(column).toMatch(/min-height\s*:\s*var\(--st-npc-portrait-size\)/);
		// And the pin itself: pronouns/traits sit on the column's bottom edge, level with the
		// bottom of the portrait. Without it the fit is shrinking a name to protect an alignment
		// that no longer exists.
		expect(column).toMatch(/justify-content\s*:\s*space-between/);
	});

	it("releases the resize observer when the sheet closes", () => {
		// It watches an element that is destroyed on every re-render; the sheet drops it on both
		// paths, and close() is the one that has to be spelled out.
		expect(CHROME).toContain("sheet._stonetopNameFit?.disconnect()");
		expect(SHEET).toMatch(/async close\(options\)\s*\{[\s\S]*_stonetopNameFit\?\.disconnect\(\)/);
	});
});
