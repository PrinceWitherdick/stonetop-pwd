import { describe, it, expect, beforeEach, vi } from "vitest";
import { ArtInventory, browseArtDirs, clearArtBrowseCache, DURABLE_ART_DIRS, splitAtArtRoot } from "../../module/book2-art/browse.js";

// The durable-art listing is cached for the session, which is only safe because every writer
// clears it. These pin both halves of that bargain: the cache actually saves the round trips
// a single load would otherwise repeat, and it genuinely lets go when told to.

const ROOT = "stonetop-book-art";

function harness(filesByDir = {}) {
	const browse = vi.fn(async (_source, path) => {
		const dir = Object.keys(filesByDir).find(d => path.endsWith(`/${d}`));
		if (!dir) throw new Error(`no such directory: ${path}`);
		return { files: filesByDir[dir].map(f => `${ROOT}/${dir}/${f}`) };
	});
	global.FilePicker = { browse };
	global.foundry = {};
	return browse;
}

beforeEach(() => {
	clearArtBrowseCache();
	vi.restoreAllMocks();
});

describe("browseArtDirs", () => {
	it("returns every file across the directories it was given", async () => {
		harness({ "assets/people": ["a.webp", "b.webp"], "assets/maps": ["m.webp"] });
		const present = await browseArtDirs(ROOT, ["assets/people", "assets/maps"]);
		expect([...present].sort()).toEqual([
			`${ROOT}/assets/maps/m.webp`,
			`${ROOT}/assets/people/a.webp`,
			`${ROOT}/assets/people/b.webp`,
		]);
	});

	it("browses each directory once, however many passes ask for it", async () => {
		const browse = harness({ "assets/people": ["a.webp"] });
		await browseArtDirs(ROOT, ["assets/people"]);
		await browseArtDirs(ROOT, ["assets/people"]);
		await browseArtDirs(ROOT, ["assets/people"]);
		expect(browse).toHaveBeenCalledTimes(1);
	});

	it("shares one round trip between callers that ask at the same moment", async () => {
		const browse = harness({ "assets/people": ["a.webp"] });
		await Promise.all([
			browseArtDirs(ROOT, ["assets/people"]),
			browseArtDirs(ROOT, ["assets/people"]),
		]);
		// The promise is cached, not the result, so the second caller joins the first request
		// rather than racing to start its own.
		expect(browse).toHaveBeenCalledTimes(1);
	});

	it("caches per directory, so a narrower pass reuses the wide pass's answers", async () => {
		const browse = harness({ "assets/people": ["a.webp"], "assets/maps": ["m.webp"] });
		await browseArtDirs(ROOT, ["assets/people", "assets/maps"]);
		await browseArtDirs(ROOT, ["assets/maps"]);
		expect(browse).toHaveBeenCalledTimes(2);
	});

	it("keys on the root, so pointing at a different art folder is not a cache hit", async () => {
		const browse = harness({ "assets/people": ["a.webp"] });
		await browseArtDirs(ROOT, ["assets/people"]);
		await browseArtDirs("somewhere-else", ["assets/people"]);
		expect(browse).toHaveBeenCalledTimes(2);
	});

	it("re-browses once the cache is cleared, and sees what was written since", async () => {
		const files = { "assets/people": ["a.webp"] };
		const browse = harness(files);
		expect([...await browseArtDirs(ROOT, ["assets/people"])]).toEqual([`${ROOT}/assets/people/a.webp`]);

		files["assets/people"].push("b.webp");
		// Still the stale answer: nothing has said the folder changed.
		expect([...await browseArtDirs(ROOT, ["assets/people"])]).toHaveLength(1);

		clearArtBrowseCache();
		expect([...await browseArtDirs(ROOT, ["assets/people"])]).toHaveLength(2);
		expect(browse).toHaveBeenCalledTimes(2);
	});

	it("treats a missing directory as nothing on disk, and does not re-ask for it", async () => {
		const browse = harness({ "assets/people": ["a.webp"] });
		// "assets/maps" is absent, so the mock rejects — the GM has not imported any maps.
		const present = await browseArtDirs(ROOT, ["assets/people", "assets/maps"]);
		expect([...present]).toEqual([`${ROOT}/assets/people/a.webp`]);

		await browseArtDirs(ROOT, ["assets/maps"]);
		expect(browse).toHaveBeenCalledTimes(2); // one people + one maps, neither repeated
	});

	it("defaults to every durable art directory", async () => {
		const browse = harness(Object.fromEntries(DURABLE_ART_DIRS.map(d => [d, []])));
		await browseArtDirs(ROOT);
		expect(browse).toHaveBeenCalledTimes(DURABLE_ART_DIRS.length);
	});
});

// A hosted setup does not hand back the paths we asked with. The Forge redirects a `data` browse
// into its Assets Library and answers with absolute URLs; S3 sources do the same. Comparing those
// to a path we reassembled ourselves misses EVERY file, which reads exactly like "never imported"
// — and since the document-less art indexes are authoritative, it republishes them empty and the
// People gallery goes blank on a world whose art is entirely present.
const FORGE = "https://assets.forge-vtt.com/abc123/";

describe("splitAtArtRoot", () => {
	it("splits a hosted URL into the host's prefix and the path we asked with", () => {
		expect(splitAtArtRoot(`${FORGE}${ROOT}/assets/people/a.webp`, ROOT))
			.toEqual({ prefix: FORGE, key: `${ROOT}/assets/people/a.webp` });
	});

	it("leaves a self-hosted path alone — it is already the path we asked with", () => {
		expect(splitAtArtRoot(`${ROOT}/assets/people/a.webp`, ROOT))
			.toEqual({ prefix: "", key: `${ROOT}/assets/people/a.webp` });
	});

	it("takes the DEEPEST root, so a root that also names a host segment cannot mislead it", () => {
		expect(splitAtArtRoot(`https://cdn.example/${ROOT}/x/${ROOT}/assets/maps/m.webp`, ROOT).key)
			.toBe(`${ROOT}/assets/maps/m.webp`);
	});

	it("keeps a leading slash out of the key, so it still matches what a caller builds", () => {
		expect(splitAtArtRoot(`/${ROOT}/assets/people/a.webp`, ROOT))
			.toEqual({ prefix: "/", key: `${ROOT}/assets/people/a.webp` });
	});

	it("has nothing to split on without a root", () => {
		expect(splitAtArtRoot("anything/at/all.webp", "")).toEqual({ prefix: "", key: "anything/at/all.webp" });
	});
});

describe("browseArtDirs on a host that serves files from somewhere else", () => {
	function hostedHarness(filesByDir) {
		global.FilePicker = {
			browse: vi.fn(async (_source, path) => {
				const dir = Object.keys(filesByDir).find(d => path.endsWith(`/${d}`));
				if (!dir) throw new Error(`no such directory: ${path}`);
				return { files: filesByDir[dir].map(f => `${FORGE}${ROOT}/${dir}/${f}`) };
			}),
		};
		global.foundry = {};
	}

	it("answers `has` in the vocabulary the caller has — the path it built", async () => {
		hostedHarness({ "assets/people": ["a.webp"] });
		const present = await browseArtDirs(ROOT, ["assets/people"]);
		expect(present.has(`${ROOT}/assets/people/a.webp`)).toBe(true);
		expect(present.size).toBe(1);
	});

	it("resolves that same path to what a browser must actually fetch", async () => {
		hostedHarness({ "assets/people": ["a.webp"] });
		const present = await browseArtDirs(ROOT, ["assets/people"]);
		expect(present.resolve(`${ROOT}/assets/people/a.webp`)).toBe(`${FORGE}${ROOT}/assets/people/a.webp`);
	});

	it("learns the prefix, so a client that cannot browse can be told where the art is", async () => {
		hostedHarness({ "assets/people": ["a.webp"] });
		expect((await browseArtDirs(ROOT, ["assets/people"])).prefix).toBe(FORGE);
	});

	it("resolves to null for a picture that is not there", async () => {
		hostedHarness({ "assets/people": ["a.webp"] });
		const present = await browseArtDirs(ROOT, ["assets/people"]);
		expect(present.resolve(`${ROOT}/assets/people/gone.webp`)).toBeNull();
		expect(present.has(`${ROOT}/assets/people/gone.webp`)).toBe(false);
	});

	it("spreads as identities, so a caller building a set of them is unaffected", async () => {
		hostedHarness({ "assets/people": ["a.webp"] });
		expect([...await browseArtDirs(ROOT, ["assets/people"])]).toEqual([`${ROOT}/assets/people/a.webp`]);
	});
});

describe("ArtInventory", () => {
	it("is its own answer when nothing is in front of the root (the self-hosted case)", () => {
		const inv = new ArtInventory(ROOT).add(`${ROOT}/assets/people/a.webp`);
		expect(inv.prefix).toBe("");
		expect(inv.resolve(`${ROOT}/assets/people/a.webp`)).toBe(`${ROOT}/assets/people/a.webp`);
	});

	it("keeps the first listing of a file, so a duplicate cannot shuffle the answer", () => {
		const inv = new ArtInventory(ROOT)
			.add(`${FORGE}${ROOT}/assets/people/a.webp`)
			.add(`/${ROOT}/assets/people/a.webp`);
		expect(inv.size).toBe(1);
		expect(inv.resolve(`${ROOT}/assets/people/a.webp`)).toBe(`${FORGE}${ROOT}/assets/people/a.webp`);
	});

	describe("plus", () => {
		it("predicts a not-yet-written file's served path from the host's prefix", () => {
			const inv = new ArtInventory(ROOT).add(`${FORGE}${ROOT}/assets/people/parent.webp`);
			const after = inv.plus([`${ROOT}/assets/people/detail.webp`]);
			expect(after.has(`${ROOT}/assets/people/detail.webp`)).toBe(true);
			expect(after.resolve(`${ROOT}/assets/people/detail.webp`)).toBe(`${FORGE}${ROOT}/assets/people/detail.webp`);
		});

		it("leaves the original alone — a plan must not mutate what it was drawn against", () => {
			const inv = new ArtInventory(ROOT).add(`${FORGE}${ROOT}/assets/people/parent.webp`);
			inv.plus([`${ROOT}/assets/people/detail.webp`]);
			expect(inv.has(`${ROOT}/assets/people/detail.webp`)).toBe(false);
		});

		it("never overwrites something genuinely observed with a prediction", () => {
			const inv = new ArtInventory(ROOT).add(`${FORGE}${ROOT}/assets/people/a.webp`);
			expect(inv.plus([`${ROOT}/assets/people/a.webp`]).resolve(`${ROOT}/assets/people/a.webp`))
				.toBe(`${FORGE}${ROOT}/assets/people/a.webp`);
		});
	});
});
