import { describe, it, expect, afterEach } from "vitest";
import { book2ArtPrefix, book2ArtRoot, book2ArtServedWith, book2ArtSrc, book2ArtSrcWith, DEFAULT_ROOT } from "../../module/book2-art/art-root.js";

// A picture has two names, and keeping them apart is the whole point of this module:
//
//   IDENTITY  `${root}/${out}` — what the browse is asked about, what an art index is keyed by.
//   SERVED    the same with whatever this host puts in front of it — what an <img> must load.
//
// They are the same string on a self-hosted Foundry, which is why nothing needed the distinction
// until a hosted one turned up: The Forge redirects a `data` upload into its Assets Library and
// serves it from `https://assets.forge-vtt.com/<userId>/`, so the identity alone is a 404.

const ROOT = "stonetop-book-art";
const OUT = "assets/people/b1-p135-x526.webp";
const FORGE = "https://assets.forge-vtt.com/abc123/";

function withSettings(store) {
	global.game = { settings: { get: (_ns, key) => store[key] } };
}

afterEach(() => { delete global.game; });

describe("book2ArtRoot", () => {
	it("falls back to the default when the setting is unset or unregistered", () => {
		withSettings({});
		expect(book2ArtRoot()).toBe(DEFAULT_ROOT);
		delete global.game;
		expect(book2ArtRoot()).toBe(DEFAULT_ROOT);
	});

	it("normalises trailing slashes away, so the join never doubles one", () => {
		withSettings({ book2ArtRoot: "my art//" });
		expect(book2ArtSrcWith(book2ArtRoot(), OUT)).toBe(`my art/${OUT}`);
	});
});

describe("book2ArtPrefix", () => {
	it("is empty on a self-hosted world, which is what makes all of this inert there", () => {
		withSettings({});
		expect(book2ArtPrefix()).toBe("");
	});

	it("is empty rather than throwing when the setting is not registered at all", () => {
		global.game = { settings: { get: () => { throw new Error("not registered"); } } };
		expect(book2ArtPrefix()).toBe("");
	});

	it("reads back what the browse observed", () => {
		withSettings({ book2ArtPrefix: FORGE });
		expect(book2ArtPrefix()).toBe(FORGE);
	});

	it("repairs a stored value with no trailing separator, which would weld onto the root", () => {
		withSettings({ book2ArtPrefix: "https://assets.forge-vtt.com/abc123" });
		expect(book2ArtPrefix()).toBe(FORGE);
	});
});

describe("identity vs served path", () => {
	it("keeps the identity free of the prefix, so a browse can still be asked about it", () => {
		withSettings({ book2ArtRoot: ROOT, book2ArtPrefix: FORGE });
		expect(book2ArtSrcWith(ROOT, OUT)).toBe(`${ROOT}/${OUT}`);
	});

	it("puts the prefix on the served path", () => {
		withSettings({ book2ArtRoot: ROOT, book2ArtPrefix: FORGE });
		expect(book2ArtSrc(OUT)).toBe(`${FORGE}${ROOT}/${OUT}`);
		expect(book2ArtServedWith(ROOT, OUT)).toBe(`${FORGE}${ROOT}/${OUT}`);
	});

	it("collapses the two on a self-hosted world", () => {
		withSettings({ book2ArtRoot: ROOT });
		expect(book2ArtSrc(OUT)).toBe(book2ArtSrcWith(ROOT, OUT));
	});

	it("takes an explicit prefix, so a batch can hoist the setting read", () => {
		withSettings({ book2ArtRoot: ROOT, book2ArtPrefix: FORGE });
		expect(book2ArtServedWith(ROOT, OUT, "")).toBe(`${ROOT}/${OUT}`);
	});
});
