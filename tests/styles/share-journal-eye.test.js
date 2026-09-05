import { describe, it, expect } from "vitest";
import { readCss, ownRule } from "../fakes/css.js";
import { contrastRatio, ratioText } from "../fakes/contrast.js";

/**
 * The "Share with Players" eye, read on the bar it actually hangs from.
 *
 * Every other green in this system is ink on parchment, so `--st-green-text` is a very dark
 * hsl(140 40% 18%) and reaching for it is normally the right reflex. This one control is the
 * exception: `addJournalShareButton` puts it in the journal entry sheet's WINDOW HEADER, and a
 * v13 journal entry sets `--color-header-background: transparent` over a `--color-cool-5-90`
 * frame, so the glyph sits on near-black beside core controls painted `--color-light-1`. The
 * parchment green measured 1.35:1 there. Nothing failed and nothing logged: the eye rendered,
 * and the state it exists to announce (players can read this journal) was simply not legible.
 *
 * So the guard is arithmetic, not a hex match. It re-derives each ratio from whatever the rules
 * currently declare, which fails both ways this can rot: somebody reaching for the parchment
 * token again out of habit, and somebody warming the light green a few digits past the bar. The
 * bar is AAA, 7:1, the same one the accessibility mode is held to, because a state indicator you
 * have to lean in for is the failure being fixed here.
 *
 * The hover rule is guarded too, for a trap that runs the other way. Our tint is unlayered and
 * all of core sits in `@layer applications`, so ours wins the hover state whether or not anyone
 * meant it to, and core fills a hovered header control with a terracotta. Left alone, the green
 * rode onto that fill at 2.11:1: worse than the bug, on the one control the pointer is on.
 */

const CSS = readCss();

/**
 * Core's own values for the header this button hangs in (public/css/foundry2.css), each read back
 * off a real rendered v13 journal sheet rather than copied out of the source. The frame is 90%
 * opaque, so `contrastRatio` compositing it over white is the worst case: a journal window dragged
 * over a pale page. Over the dark canvas it reads better, never worse.
 */
const HEADER_BAR = "rgba(11, 10, 19, 0.9)";  /* --color-cool-5-90, seen through a transparent header */
const CORE_CONTROL = "#f7f3e8";              /* --color-light-1, the ⋮ and ✕ beside us */
const HOVER_FILL = "#c9593f";                /* --button-hover-background-color, under a hovered control */

/**
 * The `color` a rule declares, with a `var(--x, fallback)` reduced to its fallback.
 *
 * The fallback is the honest thing to measure: the variable is core's, so its value is not in
 * this stylesheet to be read, and the fallback is what the rule promises when core stops
 * supplying it. A colour that only passes because a core token happens to be kind today is not
 * a colour this file can vouch for.
 */
function colorOf(selector) {
	const body = ownRule(CSS, selector);
	const raw = body?.match(/(?:^|[;{])\s*color\s*:\s*([^;]+)/)?.[1]?.trim() ?? null;
	return raw?.replace(/^var\(\s*--[a-z0-9-]+\s*,\s*(.+)\)$/i, "$1").trim() ?? null;
}

describe("the journal share eye", () => {
	it("is tinted, so shared and hidden differ by more than an eye/eye-slash glyph", () => {
		expect(colorOf(".stonetop-share-journal.is-shared")).toBeTruthy();
	});

	it("does NOT wear the parchment green: it hangs on a near-black header, not on paper", () => {
		const tint = ownRule(CSS, ".stonetop-share-journal.is-shared");
		expect(tint).not.toMatch(/--st-green-text/);
		// The value that token carries on a normal sheet, spelled out so this still fails if the
		// token is inlined here rather than referenced.
		expect(contrastRatio("hsl(140 40% 18%)", HEADER_BAR)).toBeLessThan(2);
	});

	it("clears AAA on that header at rest", () => {
		const tint = colorOf(".stonetop-share-journal.is-shared");
		expect(
			contrastRatio(tint, HEADER_BAR),
			`the tint is ${ratioText(tint, HEADER_BAR)} on the journal header bar`,
		).toBeGreaterThanOrEqual(7);
	});

	it("still reads as green rather than as one more white header control", () => {
		const tint = colorOf(".stonetop-share-journal.is-shared");
		expect(
			contrastRatio(tint, CORE_CONTROL),
			`the tint is ${ratioText(tint, CORE_CONTROL)} against the plain controls beside it`,
		).toBeGreaterThan(1.3);
	});

	it("gives the glyph back to core on hover, where core paints a terracotta fill under it", () => {
		const hover = colorOf(".stonetop-share-journal.is-shared:hover");
		expect(hover, "no hover rule: the rest tint would ride onto core's hover fill").toBeTruthy();
		// The premise, so this test fails loudly if core's hover fill ever stops being the problem
		// rather than quietly asserting something that no longer matters.
		expect(contrastRatio(colorOf(".stonetop-share-journal.is-shared"), HOVER_FILL)).toBeLessThan(3);
		expect(
			contrastRatio(hover, HOVER_FILL),
			`the hovered glyph is ${ratioText(hover, HOVER_FILL)} on core's hover fill`,
		).toBeGreaterThanOrEqual(contrastRatio(CORE_CONTROL, HOVER_FILL));
	});
});
