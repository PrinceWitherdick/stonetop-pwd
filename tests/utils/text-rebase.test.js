import { describe, expect, it } from "vitest";
import { diffHunks, merge3, mapIndex } from "../../module/utils/text-rebase.js";

// Apply hunks the way a caller would: each replaces [at, end) of the original with its text.
const apply = (s, hunks) => {
	let out = "", pos = 0;
	for (const h of hunks) { out += s.slice(pos, h.at) + h.text; pos = h.end; }
	return out + s.slice(pos);
};

// A deterministic stream of pseudo-random numbers, so a failing case can be replayed.
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe("diffHunks", () => {
	it.each([
		["an insertion",          "The farm",            "The old farm"],
		["a deletion",            "The old farm",        "The farm"],
		["a replacement",         "The old farm",        "The new farm"],
		["an append",             "The farm",            "The farm, and the mill"],
		["edits in two places",   "Tamsin, a smith.",    "Tamsin (she/her), a smith. Quiet."],
		["from nothing",          "",                    "Tamsin"],
		["to nothing",            "Tamsin",              ""],
	])("finds %s, and applying it gives the target", (_label, from, to) => {
		expect(apply(from, diffHunks(from, to))).toBe(to);
	});

	it("is empty when nothing changed", () => {
		expect(diffHunks("same", "same")).toEqual([]);
	});

	it("keeps separate edits separate", () => {
		// Where the second lands ("…smith. Quiet." or "…smith. Quiet" + ".") is a tie; either is right.
		const hunks = diffHunks("Tamsin, a smith.", "Tamsin (she/her), a smith. Quiet.");
		expect(hunks).toHaveLength(2);
		expect(hunks[0]).toEqual({ at: 6, end: 6, text: " (she/her)" });
	});

	it("never cuts an emoji in half", () => {
		// 😀 and 😃 share their first UTF-16 unit, so a diff by UTF-16 unit stops mid-emoji.
		expect(diffHunks("a😀b", "a😃b")).toEqual([{ at: 1, end: 3, text: "😃" }]);
	});

	it("can diff by whole words", () => {
		expect(diffHunks("a red door", "a blue door", { words: true })).toEqual([{ at: 2, end: 5, text: "blue" }]);
		expect(diffHunks("a red door", "a blue door")).not.toEqual([{ at: 2, end: 5, text: "blue" }]);
	});

	it("rebuilds the target for any pair of strings, without splitting a character", () => {
		const r = rng(7);
		const alphabet = [..."ab c😀é\n"];
		const word = (n) => Array.from({ length: n }, () => alphabet[Math.floor(r() * alphabet.length)]).join("");
		for (let i = 0; i < 2000; i++) {
			const from = word(Math.floor(r() * 25)), to = word(Math.floor(r() * 25));
			for (const words of [false, true]) {
				const hunks = diffHunks(from, to, { words });
				expect(apply(from, hunks)).toBe(to);
				for (const h of hunks) expect(h.text).not.toMatch(LONE_SURROGATE);
			}
		}
	});

	it("still answers, as one replacement, for two long and unrelated texts", () => {
		const a = "x".repeat(900) + "a".repeat(900), b = "y".repeat(900) + "b".repeat(900);
		expect(apply(a, diffHunks(a, b))).toBe(b);
	});
});

describe("merge3", () => {
	it("takes theirs outright when nothing was typed here", () => {
		expect(merge3("Tamsin", "Tamsin", "Tamsin the smith")).toBe("Tamsin the smith");
	});

	it("keeps mine when theirs has nothing new", () => {
		expect(merge3("Tamsin", "Tamsin the smith", "Tamsin")).toBe("Tamsin the smith");
	});

	it("keeps both when they typed in different places", () => {
		// The player adds their pronouns at the front; the GM adds a note at the end.
		expect(merge3("Tamsin, a smith.", "Tamsin (she/her), a smith.", "Tamsin, a smith. GM: owes Olwin."))
			.toBe("Tamsin (she/her), a smith. GM: owes Olwin.");
	});

	it("keeps every edit when each side made several", () => {
		expect(merge3("one two three four", "ONE two three FOUR", "one TWO three four five"))
			.toBe("ONE TWO three FOUR five");
	});

	it("puts mine first when both added at the same point, so my words stay together", () => {
		expect(merge3("I grew up", "I grew up by the lake", "I grew up [GM: ask about the lake]"))
			.toBe("I grew up by the lake [GM: ask about the lake]");
	});

	it("never runs two people's words together when both start typing into an empty box", () => {
		// Seen live: the GM's note and the player's answer landed side by side as "dying)Olwin".
		expect(merge3("", "Olwin taught me", "(GM: she is dying)")).toBe("Olwin taught me (GM: she is dying)");
		expect(merge3("", "Olwin taught me ", "(GM: she is dying)")).toBe("Olwin taught me (GM: she is dying)");
		expect(merge3("I grew up", "I grew up by the lake", "I grew up, north")).toBe("I grew up by the lake, north");
	});

	it("keeps an addition both sides already hold once, not twice", () => {
		// A save that already carried the GM's "g" crosses the GM's own resend of it.
		expect(merge3("pX", "pXgq", "pXg")).toBe("pXgq");
		expect(merge3("TX", "UTXa", "TXa")).toBe("UTXa");
	});

	it("takes an insertion at the edge of a stretch the other side replaced", () => {
		expect(merge3("the mill", "the barn", "the old mill")).toBe("the old barn");
		expect(merge3("the mill", "the old mill", "the barn")).toBe("the old barn");
	});

	it("merges the two saves that cross in flight, whichever side it runs on", () => {
		// Both started from "a smith": the player named themselves, the GM added a note.
		expect(merge3("a smith", "Tamsin, a smith", "a smith. Owes Olwin.")).toBe("Tamsin, a smith. Owes Olwin.");
		expect(merge3("a smith", "a smith. Owes Olwin.", "Tamsin, a smith")).toBe("Tamsin, a smith. Owes Olwin.");
	});

	it("clashes over a whole word, never shuffling two people's letters together", () => {
		expect(merge3("a red door", "a blue door", "a green door")).toBe("a blue door");
		expect(merge3("a red door", "a blue door", "a green door")).not.toMatch(/gblue|bluegreen/);
	});

	it("keeps a word still being typed alongside an addition right after it", () => {
		// The player is finishing "farmer" as the GM's note lands on the end of "farm".
		expect(merge3("I am a farm", "I am a farmer", "I am a farm (ask about it)")).toBe("I am a farmer (ask about it)");
	});

	it("lets their edit stand over the same words when it already holds mine", () => {
		expect(merge3("the mill", "the millpond", "the millpond, dry")).toBe("the millpond, dry");
	});

	it("treats a missing value as empty", () => {
		expect(merge3(undefined, "", "hello")).toBe("hello");
	});

	// A deletion of mine against their edit of the same words is a clash, and mine wins. The empty
	// string is "held" by every string, so this used to hand the deleted word straight back.
	it("keeps my deletion of a word they changed", () => {
		expect(merge3("a b c", "a c", "a bb c")).toBe("a c");
	});

	it("keeps my deletion of a phrase they added to", () => {
		expect(merge3("I owe Olwin money.", "I owe money.", "I owe Olwin's widow money.")).toBe("I owe money.");
	});

	it("still takes their edit elsewhere alongside my deletion", () => {
		expect(merge3("one two three four", "one three four", "one two three FOUR")).toBe("one three FOUR");
	});
});

describe("mapIndex", () => {
	const insertAt4 = [{ at: 4, end: 4, text: "old " }];

	it("leaves a caret before the edit where it was", () => {
		expect(mapIndex(2, insertAt4)).toBe(2);
	});

	it("leaves a caret right at an insertion in front of it", () => {
		expect(mapIndex(4, insertAt4)).toBe(4);
	});

	it("moves a caret after the edit along with the text", () => {
		expect(mapIndex(6, insertAt4)).toBe(10);
		expect(mapIndex(6, [{ at: 1, end: 3, text: "" }])).toBe(4);
	});

	it("adds up the shifts of every edit before it", () => {
		expect(mapIndex(10, [{ at: 0, end: 0, text: "ab" }, { at: 5, end: 6, text: "" }])).toBe(11);
	});

	it("puts a caret inside a replaced stretch at the end of the replacement", () => {
		expect(mapIndex(5, [{ at: 4, end: 7, text: "blue" }])).toBe(8);
	});

	it("does nothing without edits", () => {
		expect(mapIndex(3, [])).toBe(3);
		expect(mapIndex(3, null)).toBe(3);
	});
});
