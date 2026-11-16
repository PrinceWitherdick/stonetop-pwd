import { describe, expect, it } from "vitest";
import { declarations, readCss, stripComments } from "../fakes/css.js";

// Foundry core drops every AppV1 radio 2px (`body.game .app input[type="radio"] { position: relative;
// top: 2px }`, in its compatibility layer): 2px below the label's middle in a centred row. One
// no-specificity reset takes it back for every system window, so a new dialog's radio is centred
// without anyone remembering to. Measured 2026-11-11 with z:/tmp/foundry-verify/radio-reset-measure.mjs
// at 1x/1.25x/1.5x: centred rows 2px low -> 0, the radios that cancelled the drop unchanged, baseline
// and inline radios within 1px either way.
const CSS = readCss();

describe("core's 2px radio drop", () => {
	it("is taken back once, for every system window, at no specificity", () => {
		const body = declarations(CSS, ':where(.stonetop input[type="radio"])') ?? "";
		expect(body).toMatch(/position:\s*relative/);
		expect(body).toMatch(/(^|[;\s])top:\s*0/);
	});

	// A rule that pulled its radio up 2px was cancelling core's drop (read as a "Chromium quirk"); with
	// the drop taken back it would sit 2px high.
	it("is not cancelled again by a 2px pull-up on any radio", () => {
		const pulled = [...stripComments(CSS).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
			.filter(([, prelude, body]) => /radio|input\b/.test(prelude) && /translateY\(\s*-2px\s*\)/.test(body))
			.map(([, prelude]) => prelude.trim().replace(/\s+/g, " "));
		expect(pulled).toEqual([]);
	});
});
