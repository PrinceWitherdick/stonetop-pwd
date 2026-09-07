import { describe, it, expect } from "vitest";
import { readCss, declarations } from "../fakes/css.js";
import { contrastRatio, parseColor, ratioText } from "../fakes/contrast.js";
import { RELMAP_DASHES, RELMAP_DASH_DEFAULT, RELMAP_INKS } from "../../module/relmap/relmap-store.js";

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
//
// SINCE 2026-09-03 the dashes are painted ONLY under the high-contrast skin: eighty lines in eight
// dot-and-dash patterns read as static rather than as a diagram, so an ordinary board is drawn
// solid. The tokens still all have to be there and still all have to differ, because the mode that
// paints them is the mode that cannot fall back on colour.

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

describe("solid on an ordinary board, dashed where the pattern is needed", () => {
	const LINE = declarations(CSS, ".stonetop-relmap-line");
	const DASHED = declarations(CSS, ":root.stonetop-high-contrast .stonetop-relmap-line");

	it("draws every line solid by default", () => {
		expect(LINE, ".stonetop-relmap-line").toBeTruthy();
		expect(LINE).toMatch(/stroke-dasharray:\s*none\s*;/);
	});

	// The whole reason the tokens above are still worth having. Without this rule they are eight
	// carefully distinct patterns that nothing on any board ever paints.
	it("puts the patterns back under the high-contrast skin", () => {
		expect(DASHED, ":root.stonetop-high-contrast .stonetop-relmap-line").toBeTruthy();
		expect(DASHED).toMatch(/stroke-dasharray:\s*var\(\s*--relmap-dash/);
	});

	// Both halves off ONE declaration per ink, so a colour and its dash cannot be set apart: the
	// solid rule and the high-contrast rule read the same `--relmap-dash` the pair sets.
	it("keeps each ink's colour and dash on the same declaration", () => {
		for (const key of RELMAP_INKS) {
			const pair = declarations(CSS, `.stonetop-relmap-line--${key}`);
			expect(pair, key).toBeTruthy();
			expect(pair, key).toContain(`var(--st-relmap-ink-${key})`);
			expect(pair, key).toContain(`var(--st-relmap-dash-${key})`);
		}
	});
});

// ── The mark the reader made ────────────────────────────────────────────────
//
// A DIFFERENT QUESTION FROM THE EIGHT PATTERNS ABOVE, with the same answer shape, and the two have
// to be kept apart. An ink's dash is a COLOUR said a second time and is painted only under the
// high-contrast skin; this is a distinction somebody drew on purpose -- the rumour against the
// fact, the tie that was against the tie that is -- and it is painted on every skin.
//
// ⚠ AND THERE ARE THREE ANSWERS NOW, WHICH IS WHY THIS IS SWEPT RATHER THAN SPELLED OUT. Dotted was
// the whole of "not solid" for a while and it is the faintest a line gets; dashed is the middle
// answer. Every one of them the module offers has to be a token, a rule, and a pattern that reads
// as itself at all three weights -- and a fourth added to `RELMAP_DASHES` without any of that would
// be a stored answer drawn as a solid line, which is the map saying something false about a tie.
describe("the stroke the reader broke themselves", () => {
	// The keys that mean "not whole". `solid` is the absence of a modifier, not a pattern.
	const BROKEN = RELMAP_DASHES.filter(key => key !== RELMAP_DASH_DEFAULT);

	/** The two numbers a `stroke-dasharray` token holds: the mark, and the air after it. */
	const rhythm = token => (BASE.get(token) ?? "").trim().split(/\s+/).map(Number);

	it("has more than one way to break a stroke, or none of this is a distinction", () => {
		expect(BROKEN.length).toBeGreaterThan(1);
	});

	it("gives every broken stroke a pattern and a rule that paints it", () => {
		for (const key of BROKEN) {
			expect(BASE.get(`--st-relmap-${key}`), `--st-relmap-${key}`).toBeTruthy();
			const rule = declarations(CSS, `.stonetop-relmap-line.is-${key}`);
			expect(rule, `.stonetop-relmap-line.is-${key}`).toBeTruthy();
			expect(rule).toMatch(new RegExp(`stroke-dasharray:\\s*var\\(\\s*--relmap-${key}`));
		}
	});

	// ⚠ THE WHOLE POINT OF HAVING TWO. A dashed line whose marks are the length of a dotted line's
	// dots is two patterns nobody at this table could tell apart -- and the reader who most needs
	// them told apart is the one who cannot resolve the colours either.
	it("keeps the dashes plainly longer than the dots, at every weight", () => {
		for (const at of ["", "-lit", "-picked"]) {
			const [dash] = rhythm(`--st-relmap-dashed${at}`);
			const [dot] = rhythm(`--st-relmap-dotted${at}`);
			expect(dash, `--st-relmap-dashed${at}`).toBeGreaterThan(dot * 3);
		}
	});

	// ⚠ A ROUND CAP ADDS THE WHOLE STROKE WIDTH TO EVERY DASH AND TAKES IT OUT OF EVERY GAP, so a
	// line widened without its pattern opened up fuses into a lumpy solid -- at the exact moment the
	// reader picked it up to look at it. Both wider weights restate both patterns, in the SAME rule
	// that sets the width, which is what keeps the two from drifting apart.
	it("opens both patterns up at the two wider weights", () => {
		for (const [what, rule] of [
			["picked", declarations(CSS, ".stonetop-relmap-line.is-picked")],
			["lit", declarations(CSS, ".stonetop-relmap.is-lit .stonetop-relmap-line.is-lit")],
		]) {
			expect(rule, what).toBeTruthy();
			expect(rule, what).toMatch(/stroke-width:\s*\d/);
			for (const key of BROKEN) {
				expect(rule, `${what} / ${key}`).toContain(`--relmap-${key}: var(--st-relmap-${key}-${what})`);
				const [mark, air] = rhythm(`--st-relmap-${key}-${what}`);
				const [wasMark, wasAir] = rhythm(`--st-relmap-${key}`);
				// Wider stroke, wider rhythm: the declared numbers have to GROW, or the round cap
				// eats the gap the pattern is made of.
				expect(mark, `${key}-${what} mark`).toBeGreaterThan(wasMark);
				expect(air, `${key}-${what} air`).toBeGreaterThan(wasAir);
			}
		}
	});

	// ⚠ THE READER'S OWN MARK WINS UNDER THE HIGH-CONTRAST SKIN TOO, which is the one place the two
	// kinds of dash meet. What it costs is stated where the field is declared: a broken line has
	// only its colour left saying which ink it is. The alternative was to silently not draw the one
	// mark the reader made by hand, for the reader who most needs marks drawn at all.
	it("keeps it under the high-contrast skin, where the ink's own pattern is painted", () => {
		for (const key of BROKEN) {
			const rule = declarations(CSS, `:root.stonetop-high-contrast .stonetop-relmap-line.is-${key}`);
			expect(rule, key).toBeTruthy();
			expect(rule).toMatch(new RegExp(`stroke-dasharray:\\s*var\\(\\s*--relmap-${key}`));
		}
	});

	// AND THE CHOOSER DRAWS EACH OF THEM, which is how a reader picks one: the trigger shows the
	// stroke the line has and each row in the panel shows the one it stands for. `solid` is in this
	// sweep because the sample there IS the base rule -- a plain rule with no modifier.
	it("draws a sample of every stroke the chooser offers", () => {
		expect(declarations(CSS, ".stonetop-relmap-tiebar-rule"), "the base sample").toBeTruthy();
		for (const key of BROKEN) {
			expect(declarations(CSS, `.stonetop-relmap-tiebar-rule--${key}`), key).toBeTruthy();
		}
	});
});

// ── The ninth colour ────────────────────────────────────────────────────────
//
// A colour a reader picked in a system colour dialog, which is unlike the eight in the one way that
// matters here: there is no token for it, so there is nothing for the high-contrast skin to raise
// and nothing for the dash table to key off. What it gets instead is a dash pattern of its own and
// a best-effort darkening, and this holds the stylesheet to both -- because the promise made to the
// reader on the magnifier when this was built was that a custom line would still carry SOMETHING
// under that skin, and a rule quietly dropped here would break it silently.
describe("a colour nobody named", () => {
	const CUSTOM = declarations(CSS, ".stonetop-relmap-line--custom");

	it("draws it from the property the renderer writes, not from a token", () => {
		expect(CUSTOM, ".stonetop-relmap-line--custom").toBeTruthy();
		expect(CUSTOM).toContain("var(--relmap-ink-raw");
	});

	// Colour is never the only carrier, and a custom line cannot fall back on a token's pattern.
	it("gives it a dash of its own, unlike any of the eight", () => {
		const own = BASE.get("--st-relmap-dash-custom");
		expect(own, "--st-relmap-dash-custom").toBeTruthy();
		expect(CUSTOM).toContain("var(--st-relmap-dash-custom)");
		for (const key of RELMAP_INKS) {
			expect(BASE.get(dashToken(key)), `custom shares a dash with ${key}`).not.toBe(own);
		}
	});

	// ⚠ A BEST EFFORT AND NOT THE PROMISE THE EIGHT MAKE, which is exactly why it is worth pinning:
	// the eight are re-declared at a measured 4.5:1 and this cannot be, so what it must not do is
	// silently do nothing. Read off `--relmap-ink-raw` and never off `--relmap-ink`, which is the
	// property being set -- a declaration reading itself resolves to nothing and paints it black.
	it("takes it darker under the high-contrast skin, off the raw colour", () => {
		const lit = declarations(CSS, ":root.stonetop-high-contrast .stonetop-relmap-line--custom");
		expect(lit, "the high-contrast custom rule").toBeTruthy();
		expect(lit).toMatch(/--relmap-ink:\s*color-mix\(/);
		expect(lit).toContain("var(--relmap-ink-raw");
	});
});

// ── The writing field that is not on the bar ────────────────────────────────
//
// The tie bar has no text box on it: what a reader types is painted on the LINE (`_sayLine`). The
// field is still a real `input` -- nothing else gives an IME, a caret, a selection, paste or a
// screen reader anything to work with -- and it is hidden by CLIPPING, which is the only way of
// hiding an element that leaves it able to hold the focus. `display: none`, `visibility: hidden`
// or the `hidden` attribute would each take the focus away from it, and the field is focused the
// moment a line is clicked: that is the whole of "click a line and start typing".
describe("the writing field on the tie bar", () => {
	const FIELD = declarations(CSS, ".stonetop-relmap-tiebar-words");

	it("is hidden by clipping rather than by anything that would kill the focus", () => {
		expect(FIELD, ".stonetop-relmap-tiebar-words").toBeTruthy();
		expect(FIELD).toMatch(/clip-path:\s*inset\(/);
		expect(FIELD).not.toMatch(/display:\s*none/);
		expect(FIELD).not.toMatch(/visibility:\s*hidden/);
	});

	// Out of the bar's flex flow, so the presses do not sit a pixel further along than they look.
	it("takes no room on the bar", () => {
		expect(FIELD).toMatch(/position:\s*absolute/);
		expect(FIELD).toMatch(/width:\s*1px/);
		expect(FIELD).toMatch(/margin:\s*0/);
	});
});

describe("the captions, which are bare words written along their own lines", () => {
	const LAYER = declarations(CSS, ".stonetop-relmap-labels");
	const LABEL = declarations(CSS, ".stonetop-relmap-label");
	const WORDS = declarations(CSS, ".stonetop-relmap-label-text");

	it("draws the captions in one layer over the whole board", () => {
		expect(LAYER, ".stonetop-relmap-labels").toBeTruthy();
		expect(LAYER).toMatch(/position:\s*absolute/);
		expect(LAYER).toMatch(/inset:\s*0/);
	});

	// A LEGIBILITY RULE. At the scale the window opens at -- the whole board fitted into the
	// viewport -- the writing is three pixels tall: it was never readable, and it is a grey thicket
	// over the diagram. `_paintCaptionZoom` marks the root; this puts the captions away, and
	// `_paintLineGaps` closes the holes cut in the strokes for words that are no longer there.
	//
	// It is a performance rule as well, though no longer the load-bearing one: the cost of a caption
	// is per glyph ON SCREEN, and this is the state with every one of a hundred of them on screen at
	// once. What actually made them affordable was setting the words straight.
	it("paints no captions at all while they would be too small to read", () => {
		const lit = declarations(CSS, ".stonetop-relmap.captions-too-small .stonetop-relmap-labels-lit");
		expect(lit, "the lit layer").toBeTruthy();
		expect(lit, "the lit layer").toMatch(/display:\s*none/);
		const quiet = declarations(
			CSS, ".stonetop-relmap.captions-too-small .stonetop-relmap-label:not(.is-picked)",
		);
		expect(quiet, "every caption but the held one").toBeTruthy();
		expect(quiet, "every caption but the held one").toMatch(/display:\s*none/);
	});

	// ⚠ EXCEPT THE ONE THE READER IS HOLDING, and this is the rule the tie bar's writing depends on.
	// The bar has no text box on it any more: what somebody types is painted on the LINE, and a
	// whole board fitted into the window is under this threshold -- which is the zoom the map OPENS
	// at. Hiding that caption with the rest would leave typing with nothing at all to show for
	// itself. So it stays, and `_paintCaptionZoom` hands it board pixels worked out from the scale
	// (`CAPTION_READ_PX` divided by it) so the words stay one size to read while the board shrinks.
	it("keeps the caption the reader is writing on, at a size they can read", () => {
		const held = declarations(
			CSS,
			".stonetop-relmap.captions-too-small .stonetop-relmap-label.is-picked .stonetop-relmap-label-text",
		);
		expect(held, "the held caption").toBeTruthy();
		expect(held).toMatch(/font-size:\s*var\(--relmap-say-px/);
	});

	// ⚠ AND NEVER BY GIVING THE LAYER A TEXTURE. `will-change` does NOT make expensive glyphs
	// cheaper; it moves the cost to where the main thread blocks on it. A trace of the real window
	// showed 8.8 SECONDS of `Commit` across ten seconds, in blocks of a second and a half, ~100
	// frames dropped a second throughout. Without it the same raster runs on the worker threads and
	// Commit is ~2ms.
	it("never promotes the caption layer to a texture of its own", () => {
		expect(LAYER).not.toMatch(/will-change/);
		expect(LAYER).not.toMatch(/translateZ|translate3d/);
	});

	it("has no box behind the words", () => {
		expect(LABEL, ".stonetop-relmap-label").toBeTruthy();
		// Nothing is drawn by a caption's group at all -- no fill, no border, no box. The words are
		// the whole of it, and the page tone they sit on is the halo below.
		expect(LABEL).not.toMatch(/background:\s*(?!none)/);
		expect(LABEL).not.toMatch(/border(-\w+)?:\s*(?!0|none)/);
	});

	// WHAT THE BOX WAS ACTUALLY DOING. Take the fill away and a caption crossing a stroke or a
	// portrait is unreadable, and there is a reader at this table on a magnifier for whom that is
	// not a small matter. The halo puts the same page tone behind the letters instead of behind a
	// rectangle, so the contrast the chip gave is exactly the contrast that is left.
	//
	// A STROKE UNDER THE FILL now the words are SVG, which is the same ring the eight stacked text
	// shadows were approximating and an exact one rather than an approximation.
	it("keeps the page tone behind the letters, as a halo", () => {
		expect(WORDS, ".stonetop-relmap-label-text").toBeTruthy();
		expect(WORDS).toMatch(/paint-order:\s*stroke/);
		expect(WORDS).toMatch(/stroke:\s*var\(--st-page\)/);
	});

	// The caption layer covers the whole board. A target that size would swallow every click meant
	// for the faces and the captions underneath it, so the layer takes no pointer events and the
	// glyphs take them back -- which makes the aimable area the words the reader can actually see.
	it("aims at the writing and not at the layer over it", () => {
		expect(LAYER).toMatch(/pointer-events:\s*none\s*;/);
		expect(WORDS).toMatch(/pointer-events:\s*auto\s*;/);
	});

	// And the focus ring goes with it: an outline round a caption's BOUNDING BOX would be a
	// rectangle the size of the board with a sentence somewhere inside it. Marked on the words
	// instead, in a different COLOUR and a heavier WEIGHT -- never colour alone, for the reader on
	// a magnifier.
	it("marks a focused caption on its words rather than on its box", () => {
		expect(WORDS).toMatch(/outline:\s*none\s*;/);
		const lit = declarations(CSS, ".stonetop-relmap-label-text:focus-visible");
		expect(lit, "focus-visible").toBeTruthy();
		expect(lit).toMatch(/stroke:\s*var\(--st-accent-fill\)/);
		expect(lit).toMatch(/stroke-width:\s*4px/);
	});

	// ON the line rather than above it. A baseline sitting on the rail would put every caption a
	// half-line clear of its own stroke, and the gap cut in that stroke would be a hole underneath
	// the words instead of around them.
	it("sets the words on the line, centred on the anchor the gap was cut at", () => {
		expect(WORDS).toMatch(/dominant-baseline:\s*central/);
		expect(WORDS).toMatch(/text-anchor:\s*middle/);
	});

	// The board's own ground IS the page tone, so haloed body ink on it is the same measurement
	// the chip used to make. Said out loud here because it is the whole reason the halo is that
	// colour and not, say, the panel tone.
	it("halos in the tone the board is actually painted on", () => {
		const view = declarations(CSS, ".stonetop-relmap-view");
		expect(view).toMatch(/background:\s*var\(--st-page\)/);
	});
});
