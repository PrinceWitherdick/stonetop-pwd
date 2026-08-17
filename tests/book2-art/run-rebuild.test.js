import { describe, it, expect } from "vitest";
import { describeRebuild } from "../../module/book2-art/run-rebuild.js";

// The one sentence every entry point shows after a rebuild — the chat card, the Welcome guide's
// Book Art step and game.stonetop.rebuildPortraits all report through this, so they cannot drift
// into saying different things about the same run.

describe("describing a rebuild", () => {
	it("reports a normal run", () => {
		expect(describeRebuild({ written: 153, failed: 0, repointed: 0 }))
			.toBe("Rebuilt 153 pictures from art already on disk.");
	});

	it("counts PICTURES, not portraits, because one run cuts three different things", () => {
		// Detail portraits, square faces and creature token squares all land in `written`. Calling
		// that total "portraits" was true when portraits were all there was, and is now wrong about
		// most of a typical run — a GM reading "Rebuilt 214 portraits" after framing creature
		// tokens would reasonably think the token pass had not run.
		expect(describeRebuild({ written: 214, failed: 0 })).not.toMatch(/portraits from art/);
	});

	it("mentions art already in play that moved to its close-up", () => {
		expect(describeRebuild({ written: 153, failed: 0, repointed: 12 }))
			.toBe("Rebuilt 153 pictures from art already on disk. "
				+ "12 portraits already in play now use their close-up.");
	});

	it("mentions creatures already in play that moved to their token square", () => {
		expect(describeRebuild({ written: 73, failed: 0, tokens: 9 }))
			.toBe("Rebuilt 73 pictures from art already on disk. "
				+ "9 creatures already in play now use their token square.");
	});

	it("reports both kinds of re-point in one run, portraits first", () => {
		// A world upgrading past both features gets both halves; they are separate counts because
		// they are separate documents doing separate things, and running them together must not
		// make either invisible.
		expect(describeRebuild({ written: 226, failed: 0, repointed: 12, tokens: 9 }))
			.toBe("Rebuilt 226 pictures from art already on disk. "
				+ "12 portraits already in play now use their close-up. "
				+ "9 creatures already in play now use their token square.");
	});

	it("agrees in the singular, verb and possessive alike", () => {
		expect(describeRebuild({ written: 1, failed: 0, repointed: 1, tokens: 1 }))
			.toBe("Rebuilt 1 picture from art already on disk. "
				+ "1 portrait already in play now uses its close-up. "
				+ "1 creature already in play now uses its token square.");
	});

	it("owns up to a partial run", () => {
		// A partial run must say so: the entry points keep offering the remainder, and a message
		// that read like success would make that look like a bug.
		expect(describeRebuild({ written: 140, failed: 13, repointed: 0 }))
			.toBe("Rebuilt 140 pictures from art already on disk. 13 could not be read (see the console).");
	});

	it("says nothing about re-pointing when nothing moved", () => {
		expect(describeRebuild({ written: 5, failed: 0, repointed: 0, tokens: 0 }))
			.not.toMatch(/close-up|token square/);
	});

	it("survives a malformed result rather than printing undefined at a GM", () => {
		expect(describeRebuild({})).toBe("Rebuilt 0 pictures from art already on disk.");
		expect(describeRebuild(null)).toBe("Rebuilt 0 pictures from art already on disk.");
	});
});
