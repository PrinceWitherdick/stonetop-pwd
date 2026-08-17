import { describe, it, expect } from "vitest";
import {
	isValidRect, portraitSuffix, portraitOutFor, portraitRectOf, rectFromSuffix,
	fullPortraitSrc, squarePortraitSrc, hasPortraitSuffix,
} from "../../module/book2-art/people-portraits.js";

// The hand-authored square cut out of a People-of-Stonetop portrait. These cover the pure half:
// the filename grammar the picker, the merge script and the in-Foundry rebuild must all agree
// on, and the square <-> whole lookup every display surface goes through.

const ROOT = "stonetop-book-art";
const person = (slug, extra = {}) => ({
	slug, name: slug, out: `assets/people/${slug}.webp`, ...extra,
});
const withSquare = (slug, rect) =>
	person(slug, { portrait: rect, portraitOut: portraitOutFor(`assets/people/${slug}.webp`, rect) });

describe("square rect validity", () => {
	it("accepts a positive-area rect inside the image", () => {
		expect(isValidRect([0.12, 0, 0.88, 0.26])).toBe(true);
	});

	it("rejects an inverted, zero-area, out-of-range or malformed rect", () => {
		expect(isValidRect([0.9, 0, 0.1, 0.26])).toBe(false);   // x1 <= x0
		expect(isValidRect([0.1, 0.2, 0.1, 0.9])).toBe(false);  // zero width
		expect(isValidRect([-0.1, 0, 0.8, 0.3])).toBe(false);   // outside the image
		expect(isValidRect([0, 0, 1])).toBe(false);             // three numbers
		expect(isValidRect(null)).toBe(false);
		expect(isValidRect([0, 0, "x", 1])).toBe(false);
	});
});

describe("filename grammar", () => {
	it("writes per-mille, zero-padded to three", () => {
		expect(portraitSuffix([0.12, 0, 0.88, 0.26])).toBe("-q120-000-880-260");
	});

	it("keeps the four-digit group for a coordinate flush with the edge", () => {
		// per-mille of 1.0 is 1000. A square is usually flush with the TOP of the figure, so a
		// \d{3} assumption breaks on the common case, not the rare one.
		const suffix = portraitSuffix([0.25, 0, 1, 0.75]);
		expect(suffix).toBe("-q250-000-1000-750");
		expect(hasPortraitSuffix(`assets/people/b1-p135-x526${suffix}.webp`)).toBe(true);
	});

	it("rounds exactly as Python's int(f * 1000 + 0.5) does", () => {
		// The two sides mint the same filename or a re-export orphans every square. Checked
		// against the real Python over the awkward values: 0.0005 0.0015 0.0025 0.1235 0.5005
		// 0.9995 0.3335 0.7775 0.125 0.375 1.0 0.0 — zero disagreements.
		//
		// 0.5005 landing on 500 rather than 501 is not a bug to fix: 0.5005 * 1000 is
		// 500.49999999999994 in IEEE-754, so it is not a tie at all, and BOTH languages see
		// the same bits. Nudging one side to "round half up properly" is what would break the
		// agreement.
		expect(portraitSuffix([0.0005, 0.0015, 0.5005, 0.9995])).toBe("-q001-002-500-1000");
		expect(portraitSuffix([0.0025, 0.1235, 0.3335, 0.7775])).toBe("-q003-124-334-778");
	});

	it("splices the suffix before the extension", () => {
		expect(portraitOutFor("assets/people/b1-p007-x32-c750-387-1000-1000.webp", [0.12, 0, 0.88, 0.26]))
			.toBe("assets/people/b1-p007-x32-c750-387-1000-1000-q120-000-880-260.webp");
	});

	it("appends when there is no extension to splice before", () => {
		expect(portraitOutFor("assets/people/plain", [0, 0, 1, 1])).toBe("assets/people/plain-q000-000-1000-1000");
	});

	it("does not mistake a crop suffix for a square one", () => {
		expect(hasPortraitSuffix("assets/people/b1-p007-x32-c750-387-1000-1000.webp")).toBe(false);
	});
});

// Reading a rect back OUT of the name it was written into. The hand-chosen square of every shipped
// person survives only in its filename, and moving a world onto the "portrait is the whole
// illustration, the square is a frame over it" layout needs that number back.
describe("reading a rect back out of a filename", () => {
	it("round-trips every rect the writer can produce", () => {
		for (const rect of [[0.12, 0, 0.88, 0.26], [0.25, 0, 1, 0.75], [0, 0, 1, 1], [0.292, 0.024, 0.72, 0.328]]) {
			expect(portraitRectOf(`assets/people/x${portraitSuffix(rect)}.webp`)).toEqual(rect);
		}
	});

	it("reads a coordinate flush with the edge, where the group is four digits", () => {
		expect(portraitRectOf("assets/people/b1-p135-x526-q000-000-1000-720.webp")).toEqual([0, 0, 1, 0.72]);
	});

	it("sees through a cache-buster, which the suffix's own anchor would otherwise hide", () => {
		// Tokenizer appends `?<timestamp>` to paths it touches; the suffix is matched against the
		// EXTENSION, so an unstripped query moves the anchor and the rect silently disappears.
		expect(portraitRectOf("assets/people/x-q120-000-880-260.webp?1754099")).toEqual([0.12, 0, 0.88, 0.26]);
		expect(portraitRectOf("assets/people/x-q120-000-880-260.webp#frag")).toEqual([0.12, 0, 0.88, 0.26]);
	});

	it("reads a square cut from an already-cropped person, suffix stacked on suffix", () => {
		expect(portraitRectOf("assets/people/b1-p007-x32-c335-048-492-452-q292-024-720-328.webp"))
			.toEqual([0.292, 0.024, 0.72, 0.328]);
	});

	it("answers null for a name carrying no rect, so it doubles as the is-this-ours test", () => {
		expect(portraitRectOf("assets/people/b1-p135-x526.webp")).toBeNull();
		expect(portraitRectOf("assets/people/b1-p135-x526-face.webp")).toBeNull();
		expect(portraitRectOf("")).toBeNull();
		expect(portraitRectOf(null)).toBeNull();
	});

	it("refuses a suffix whose numbers are not a usable rect", () => {
		// Nothing writes these, but a hand-renamed file can carry them and a frame built from an
		// inverted rect would paint garbage.
		expect(portraitRectOf("assets/people/x-q880-000-120-260.webp")).toBeNull();  // x1 <= x0
		expect(portraitRectOf("assets/people/x-q120-260-880-260.webp")).toBeNull();  // zero height
	});

	it("keeps the two suffix letters apart", () => {
		// `q` is a person's face, `t` a creature's token square, `c` a crop. Asking for one must
		// never answer with another's numbers.
		const token = "assets/bestiary/crinwin-t397-163-718-600.webp";
		expect(portraitRectOf(token)).toBeNull();
		expect(rectFromSuffix("t", token)).toEqual([0.397, 0.163, 0.718, 0.6]);
		expect(rectFromSuffix("c", "assets/people/b1-p007-x32-c335-048-492-452.webp"))
			.toEqual([0.335, 0.048, 0.492, 0.452]);
	});
});

describe("square <-> whole illustration lookup", () => {
	const rect = [0.12, 0, 0.88, 0.26];
	const people = [
		withSquare("b1-p007-x32-c750-387-1000-1000", rect),
		person("b1-p135-x526"),   // no square authored yet
	];
	const squared = people[0];
	const squareSrc = `${ROOT}/${squared.portraitOut}`;
	const fullSrc = `${ROOT}/${squared.out}`;

	it("finds the whole illustration behind a square", () => {
		expect(fullPortraitSrc(squareSrc, people)).toBe(fullSrc);
	});

	it("finds the square cut from an illustration", () => {
		expect(squarePortraitSrc(fullSrc, people)).toBe(squareSrc);
	});

	it("preserves whatever directory the caller resolved against", () => {
		// The durable art root is a world setting, so these helpers must never assume it.
		const elsewhere = `some/other/root/${squared.portraitOut}`;
		expect(fullPortraitSrc(elsewhere, people)).toBe(`some/other/root/${squared.out}`);
	});

	it("returns null for a portrait with no square authored", () => {
		expect(squarePortraitSrc(`${ROOT}/${people[1].out}`, people)).toBe(null);
	});

	it("returns null for a GM's own art, even when it looks like a square", () => {
		// Checked against the manifest rather than merely stripping the suffix, so this
		// resolves to nothing rather than to a path that does not exist.
		expect(fullPortraitSrc("worlds/mine/art/villager-q120-000-880-260.webp", people)).toBe(null);
		expect(fullPortraitSrc("worlds/mine/art/villager.webp", people)).toBe(null);
	});

	it("is null-safe", () => {
		expect(fullPortraitSrc("", people)).toBe(null);
		expect(fullPortraitSrc(null, people)).toBe(null);
		expect(squarePortraitSrc(undefined, people)).toBe(null);
	});

	it("tolerates a build whose manifest carries no squares at all", () => {
		expect(fullPortraitSrc(squareSrc, [])).toBe(null);
		expect(squarePortraitSrc(fullSrc, [person("b1-p135-x526")])).toBe(null);
	});
});

describe("cache-busted paths", () => {
	// vtta-tokenizer rewrites actor.img to `<path>?<timestamp>` on every run. Before this, the
	// first tokenize of an NPC wearing a shipped square silently detached it from the manifest:
	// the hover preview stopped swapping in the whole illustration and the on-disk square
	// resolver stopped matching, with nothing thrown and nothing to notice.
	const people = [withSquare("kel", [0.25, 0, 0.75, 0.25])];
	const squareOut = people[0].portraitOut;

	it("resolves a square to its illustration through a query string", () => {
		expect(fullPortraitSrc(`${ROOT}/${squareOut}?1754099`, people))
			.toBe(`${ROOT}/assets/people/kel.webp`);
	});

	it("resolves it through a hash too, and drops the suffix from the answer", () => {
		expect(fullPortraitSrc(`${ROOT}/${squareOut}#x`, people))
			.toBe(`${ROOT}/assets/people/kel.webp`);
	});

	it("finds the square from a cache-busted illustration path", () => {
		expect(squarePortraitSrc(`${ROOT}/assets/people/kel.webp?9`, people))
			.toBe(`${ROOT}/${squareOut}`);
	});
});
