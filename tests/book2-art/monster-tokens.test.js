import { describe, it, expect } from "vitest";
import { tokenSuffix, tokenOutFor, hasTokenSuffix } from "../../module/book2-art/monster-tokens.js";
import { portraitSuffix, hasPortraitSuffix } from "../../module/book2-art/people-portraits.js";
import { BOOK2_ART_APPLY_MANIFEST } from "../../module/book2-art/manifest.js";

// The square a creature's prototype token stands on. Its filename is content-addressed — the rect
// is IN the name — which is what makes a re-frame mint a new file rather than silently keep the
// old pixels behind a name the importer would skip. That only works if this agrees with
// merge-art-picker.py's `token_suffix` exactly.

describe("token filename suffix", () => {
	it("writes per-mille, zero-padded, in x0-y0-x1-y1 order", () => {
		expect(tokenSuffix([0.12, 0, 0.88, 0.26])).toBe("-t120-000-880-260");
	});

	it("writes 1000 as four digits, not three", () => {
		// per-mille of 1.0 is "1000". A three-digit assumption anywhere in this pipeline misses
		// every rect flush with an edge, and a token square usually IS flush with one.
		expect(tokenSuffix([0.25, 0, 1, 0.75])).toBe("-t250-000-1000-750");
		expect(hasTokenSuffix(`assets/bestiary/crinwin${tokenSuffix([0.25, 0, 1, 0.75])}.webp`)).toBe(true);
	});

	it("rounds half UP, matching the Python's int(f * 1000 + 0.5)", () => {
		// A tie resolved the other way mints a filename nothing ever writes: the manifest would
		// name one file and the importer would upload another.
		expect(tokenSuffix([0.0005, 0.0015, 0.5005, 0.9995])).toBe("-t001-002-500-1000");
		expect(tokenSuffix([0.0025, 0.1235, 0.3335, 0.7775])).toBe("-t003-124-334-778");
	});

	it("uses `t`, not the person square's `q`", () => {
		// Different letters on purpose: a `-q` file is the one an actor's img points at, and a
		// creature's token square explicitly is not that. Reading a directory listing should not
		// require knowing which folder you are in.
		const rect = [0.1, 0.1, 0.5, 0.5];
		expect(tokenSuffix(rect)).not.toBe(portraitSuffix(rect));
		expect(hasPortraitSuffix(`assets/bestiary/crinwin${tokenSuffix(rect)}.webp`)).toBe(false);
		expect(hasTokenSuffix(`assets/people/b1-p007-x32${portraitSuffix(rect)}.webp`)).toBe(false);
	});
});

describe("token out path", () => {
	it("splices the suffix in before the extension", () => {
		expect(tokenOutFor("assets/bestiary/crinwin.webp", [0.12, 0, 0.88, 0.26]))
			.toBe("assets/bestiary/crinwin-t120-000-880-260.webp");
	});

	it("appends when there is no extension to splice before", () => {
		expect(tokenOutFor("assets/bestiary/plain", [0, 0, 1, 1]))
			.toBe("assets/bestiary/plain-t000-000-1000-1000");
	});

	it("is not fooled by a dot in a directory name", () => {
		expect(tokenOutFor("assets/v1.2/crinwin", [0, 0, 1, 1]))
			.toBe("assets/v1.2/crinwin-t000-000-1000-1000");
	});
});

describe("the shipped manifest's own tokens", () => {
	const monsters = BOOK2_ART_APPLY_MANIFEST.monsters ?? [];

	it("derives every tokenOut from the creature's own out", () => {
		// The runtime never recomputes this — it reads `tokenOut` — so a merge that wrote one the
		// derivation disagrees with would point tokens at a file the importer never uploads, and
		// nothing would throw. Vacuous until the first token batch is merged, and load-bearing the
		// moment it is.
		for (const m of monsters) {
			if (!m.token || !m.tokenOut) continue;
			expect(tokenOutFor(m.out, m.token), `${m.slug}`).toBe(m.tokenOut);
		}
	});

	it("never emits one half of the pair without the other", () => {
		// `token` alone means the rebuild has no destination to write; `tokenOut` alone means it
		// has no rect to cut. Either way the pass silently plans zero.
		for (const m of monsters) expect(!!m.token, `${m.slug}`).toBe(!!m.tokenOut);
	});

	it("keeps the illustration itself free of a token suffix", () => {
		for (const m of monsters) expect(hasTokenSuffix(m.out), `${m.slug}`).toBe(false);
	});
});
