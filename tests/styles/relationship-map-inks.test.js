import { describe, it, expect } from "vitest";
import { readCss, declarations } from "../fakes/css.js";
import { contrastRatio, parseColor, ratioText } from "../fakes/contrast.js";
import { RELMAP_INKS } from "../../module/relmap/relmap-store.js";

// The eight colours a line on a relationship map can be drawn in.
//
// Its own file rather than an addition to high-contrast.test.js: that suite slices the
// accessibility block and measures TEXT at the AAA bar, and these are strokes measured at the
// graphical bar, against two grounds, and defined up in the main `:root`.
//
// WHAT IS ACTUALLY AT STAKE. There is a reader at this table on a screen magnifier. A line that
// does not clear 3:1 is a line they cannot follow, and there is no fallback: the whole point of
// the board is which line goes where. The dash patterns are the belt to that braces — they carry
// the same distinction with no colour at all — and they are checked here too, because a palette
// that quietly lost them would look fine to everyone who could already see it.

const CSS = readCss();

/** Every `--custom-property: value` a rule declares, as a Map. Same reading as high-contrast.test.js. */
function customProperties(body) {
	const out = new Map();
	if (!body) return out;
	for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out.set(m[1].trim(), m[2].trim());
	return out;
}

const ROOT = declarations(CSS, ":root");
const BASE = customProperties(ROOT);
const CONTRAST = customProperties(declarations(CSS, ":root.stonetop-high-contrast"));

// The two grounds a board can sit on: the page it is painted on, and the panel tone, which is the
// darker of the two and therefore the one that decides.
const PAGE = BASE.get("--st-page");
const PANEL = BASE.get("--stonetop-bg");

const inkToken = key => `--st-relmap-ink-${key}`;
const dashToken = key => `--st-relmap-dash-${key}`;

describe("the relationship map's inks", () => {
	it("finds the grounds it measures against, so the checks below mean something", () => {
		expect(PAGE, "--st-page").toBeTruthy();
		expect(PANEL, "--stonetop-bg").toBeTruthy();
		expect(contrastRatio(PANEL, PAGE)).toBeLessThan(1.2);
	});

	// The join nothing else would notice breaking: the module offers eight keys, the stylesheet
	// paints eight, and a line whose ink has no token renders with no colour at all.
	it("paints exactly the inks the module offers, and no others", () => {
		const painted = [...ROOT.matchAll(/--st-relmap-ink-([a-z]+)\s*:/g)].map(m => m[1]);
		expect(painted.sort()).toEqual([...RELMAP_INKS].sort());
	});

	it("gives every ink a dash pattern as well as a colour", () => {
		for (const key of RELMAP_INKS) {
			expect(BASE.get(dashToken(key)), dashToken(key)).toBeTruthy();
		}
	});

	// Colour is never the only carrier. Two inks sharing a dash would leave those two told apart
	// by hue alone, which is exactly the case this palette exists to avoid.
	it("gives no two inks the same dash", () => {
		const dashes = RELMAP_INKS.map(key => BASE.get(dashToken(key)));
		expect(new Set(dashes).size).toBe(RELMAP_INKS.length);
	});

	it("clears 3:1 against BOTH the page and the panel tone", () => {
		for (const key of RELMAP_INKS) {
			const value = BASE.get(inkToken(key));
			expect(value, inkToken(key)).toBeTruthy();
			expect(contrastRatio(value, PAGE), `${key} on the page: ${ratioText(value, PAGE)}`)
				.toBeGreaterThanOrEqual(3);
			expect(contrastRatio(value, PANEL), `${key} on a panel: ${ratioText(value, PANEL)}`)
				.toBeGreaterThanOrEqual(3);
		}
	});

	it("raises every one of them under the high-contrast skin", () => {
		for (const key of RELMAP_INKS) {
			const value = CONTRAST.get(inkToken(key));
			expect(value, `${inkToken(key)} is not re-declared for high contrast`).toBeTruthy();
			expect(contrastRatio(value, PANEL), `${key} on a panel: ${ratioText(value, PANEL)}`)
				.toBeGreaterThanOrEqual(4.5);
		}
	});

	// A stroke is not text. Naming one of these with a trailing `-ink` would sweep it into
	// high-contrast.test.js's AAA 7:1 TEXT check, which is the wrong bar and one they cannot meet
	// while staying eight recognisably different colours.
	it("names them noun-first, so the text sweep does not claim them", () => {
		const INK_SUFFIX = /(^--st-text(-|$)|^--color-text-|-text$|-ink$|hyperlink)/;
		for (const key of RELMAP_INKS) {
			expect(INK_SUFFIX.test(inkToken(key)), `${inkToken(key)} would be swept as text`)
				.toBe(false);
		}
	});
});

// The season inks are reserved for the steading header's clock and nothing else. The rule is not
// only "do not reuse the token" — a relationship-map line close enough to be mistaken for one of
// them spends the same recognition the reservation exists to protect.
describe("keeping clear of the reserved season inks", () => {
	const SEASONS = ["spring", "summer", "autumn", "winter"]
		.map(s => [s, BASE.get(`--stonetop-season-${s}-ink`)]);

	/**
	 * Straight-line distance in sRGB. Crude next to a real colour difference, and enough to catch
	 * "that is the autumn colour under a different name".
	 *
	 * Through the contrast fake's own parser rather than a regex of this file's own: the two
	 * palettes are not even written the same way (`hsl(140 72% 31%)` against
	 * `hsl(340deg 62% 60%)`), and a second parser here silently returned null for the whole season
	 * set, which would have passed this test by never comparing anything.
	 */
	function distance(a, b) {
		const p = parseColor(a)?.rgb;
		const q = parseColor(b)?.rgb;
		expect(p, `could not parse ${a}`).toBeTruthy();
		expect(q, `could not parse ${b}`).toBeTruthy();
		return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
	}

	it("finds all four season inks, so this check means something", () => {
		for (const [name, value] of SEASONS) expect(value, name).toBeTruthy();
	});

	it("reuses none of the season tokens", () => {
		for (const key of RELMAP_INKS) {
			expect(BASE.get(inkToken(key))).not.toMatch(/--stonetop-season-/);
		}
	});

	// The floor is the palette's own internal spacing: no ink may sit closer to a SEASON colour
	// than the inks sit to each other, or "the autumn one" stops naming a season.
	it("keeps every ink as far from a season colour as the inks are from each other", () => {
		const inks = RELMAP_INKS.map(key => [key, BASE.get(inkToken(key))]);
		let closestPair = Infinity;
		for (let i = 0; i < inks.length; i++) {
			for (let j = i + 1; j < inks.length; j++) {
				closestPair = Math.min(closestPair, distance(inks[i][1], inks[j][1]));
			}
		}
		expect(closestPair).toBeGreaterThan(20);
		for (const [key, value] of inks) {
			for (const [season, seasonValue] of SEASONS) {
				expect(distance(value, seasonValue), `${key} is too near the ${season} ink`)
					.toBeGreaterThanOrEqual(closestPair);
			}
		}
	});
});
