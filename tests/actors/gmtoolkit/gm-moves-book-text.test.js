import { describe, it, expect } from "vitest";
import { gmMoveByName } from "../../../module/gm-toolkit/gm-moves.js";

// gm-moves.js promises the book's own text, dropping only page cross-references. These pin the
// passages a 2026-10-08 audit found trimmed or missing, against Book I as printed.
describe("GM moves: Book I text carried in full", () => {
	it("Hurt someone keeps every paragraph of p.184, including the warnings", () => {
		const detail = gmMoveByName("basic", "Hurt someone").detail.join("\n");
		expect(detail).toContain("It's a part of the fiction, something they have to deal with and something you can use as a basis for your GM moves.");
		expect(detail).toContain("When you hurt them because they rolled a 7-9 to Clash with a guy with a club");
		expect(detail).toContain("('He stabs you in the thigh and you feel your leg buckle.')");
		expect(detail).toContain("(explicitly or by telegraphing/demonstrating the danger)");
		expect(detail).toContain("Say goodbye to that arm and hello to a fountain of blood.");
		expect(detail).toContain("an arm-chomping-off threat");
		expect(detail).toContain("Taking a follower's arm (for example) is a great way");
		expect(detail).toContain("(Word of advice, though: don't brutalize an animal companion without warning; players get super precious with their pets.)");
		expect(detail).toContain("Once inflicted, a wound or injury is part of the fiction.");
		// The cross-references are the one thing the transcription drops.
		expect(detail).not.toMatch(/page 243|page 237/);
	});

	it("Point to a looming danger keeps the book's two sample questions (p.319)", () => {
		const detail = gmMoveByName("exploration", "Point to a looming danger").detail;
		expect(detail).toContain("Here's a good twist on this move: instead of telling them what they find, ask them what they find that tells them ___ is afoot.");
		expect(detail.join("\n")).toContain("'Caradoc, what sort of experience do you have with feathered drakes?'");
		expect(detail.join("\n")).toContain("the nosgolau, the night-lights that are said to haunt the Flats and lure travelers off the road?'");
	});

	it("Tell them the consequences/requirements carries all five of its examples (p.187)", () => {
		const { examples } = gmMoveByName("basic", "Tell them the consequences/requirements (then ask)");
		expect(examples).toHaveLength(5);
		expect(examples.at(-1)).toMatch(/^That thing is made of solid stone\. .*something big and heavy\.$/);
	});

	it("Introduce a danger, person, or faction carries all three of its examples (p.320)", () => {
		const { examples } = gmMoveByName("exploration", "Introduce a danger, person, or faction");
		expect(examples).toHaveLength(3);
		expect(examples.at(-1)).toMatch(/^They're all gazing up at that nest, Caradoc, .*Curious, rather than angry\. What do you do\?$/);
	});
});
