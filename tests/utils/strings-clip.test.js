import { describe, it, expect } from "vitest";
import { clipText, dropLastChar, uniqueSlug, uniqueSlugs, nounStem, sameNoun, isPlainObject, decodeEntities } from "../../module/utils/strings.js";

// Cutting text to a length without breaking a character. An emoji is two UTF-16 units, and a cut that
// lands between them stores half of one: a replacement box, broadcast to the whole table, for good.

describe("cutting text to a length", () => {
	it("cuts to the length asked for, and leaves shorter text alone", () => {
		expect(clipText("friends", 3)).toBe("fri");
		expect(clipText("friends", 20)).toBe("friends");
		expect(clipText(null, 5)).toBe("");
	});

	it("never keeps half of a character", () => {
		expect(clipText("rivals 🐉", 8)).toBe("rivals ");
		expect(clipText("rivals 🐉", 9)).toBe("rivals 🐉");
	});
});

describe("taking the last character off", () => {
	it("takes one character", () => {
		expect(dropLastChar("rivals")).toBe("rival");
		expect(dropLastChar("")).toBe("");
	});

	it("takes a whole emoji, and not half of it", () => {
		expect(dropLastChar("rivals 🐉")).toBe("rivals ");
	});
});

// Minted keys and slugs are stored, so the first suffix stays "-2" whatever the caller hands in.
describe("a slug no one has yet", () => {
	it("is the base when it is free, else the first numbered one that is", () => {
		expect(uniqueSlug("fear", new Set())).toBe("fear");
		expect(uniqueSlug("fear", new Set(["fear"]))).toBe("fear-2");
		expect(uniqueSlug("fear", ["fear", "fear-2"])).toBe("fear-3");
		expect(uniqueSlug("fear", new Map([["fear", 1]]))).toBe("fear-2");
		expect(uniqueSlug("fear", s => s !== "fear-4")).toBe("fear-4");
	});

	it("over a list, each against the ones before it", () => {
		expect(uniqueSlugs(["a", "b", "a", "a", "a-2"])).toEqual(["a", "b", "a-2", "a-3", "a-2-2"]);
		expect(uniqueSlugs([])).toEqual([]);
	});
});

describe("nouns singular or plural", () => {
	it("are the same noun, case and article aside", () => {
		expect(nounStem("Reminders")).toBe("Reminder");
		expect(nounStem(" Fear ")).toBe("Fear");
		expect(sameNoun("Reigns", "reign")).toBe(true);
		expect(sameNoun("the Fears", "Fear")).toBe(true);
		expect(sameNoun("Fear", "Readiness")).toBe(false);
	});
});

describe("an object to read keys off", () => {
	it("is any object but null or an array", () => {
		expect(isPlainObject({})).toBe(true);
		expect(isPlainObject(Object.create(null))).toBe(true);
		expect(isPlainObject([])).toBe(false);
		expect(isPlainObject(null)).toBe(false);
		expect(isPlainObject("x")).toBe(false);
	});
});

describe("decoding entities", () => {
	it("decodes every numeric form, and the curly quotes and apostrophe by name", () => {
		expect(decodeEntities("&#8220;Hi&#x201D; &ldquo;there&rdquo; it&apos;s &#233;")).toBe("“Hi” “there” it's é");
		expect(decodeEntities("a&#160;b&nbsp;c")).toBe("a b c");
	});

	it("decodes an ampersand once, last, however it is written", () => {
		expect(decodeEntities("&amp;mdash; &#38;lt; &#x26;#8212;")).toBe("&mdash; &lt; &#8212;");
		expect(decodeEntities("&#0; &#99999999; &bogus;")).toBe("&#0; &#99999999; &bogus;");
	});
});
