import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
describe("browseArtDirs where the art is kept off the data path", () => {
	// The failure this exists to stop, seen on a real hosted world: uploads are redirected into
	// an Assets Library under an absolute prefix, while the data-relative folder either does not
	// exist or exists and is EMPTY. The host answers the data-relative browse rather than
	// rejecting it, so the search ended there — and because the art indexes are AUTHORITATIVE,
	// `peopleArt` was republished as empty on every GM load and the People gallery stayed blank
	// on a world holding all 306 portraits.
	//
	// `emptyNotAbsent` is the sharp edge: a host that REJECTS is already handled (the directory
	// is simply not there), a host that answers "no files" about the wrong folder is not.
	// Matched EXACTLY, never by suffix. A host answers about the folder it was asked for, so a
	// harness that accepts anything ending in "/assets/people" cannot tell the right question from
	// a wrong one — and it did not: dropping the art root from the retry target
	// (`${prefix}${dir}` instead of `${prefix}${root}/${dir}`) left all 30 tests in this file
	// green while asking a real host about a folder that does not exist. The prefix, the root and
	// the directory are three separate ways to get this wrong; the assertion is the whole string.
	function hostedHarness(filesByDir, { emptyNotAbsent = true, prefix = FORGE } = {}) {
		const browse = vi.fn(async (_source, path) => {
			const dir = Object.keys(filesByDir).find(d => path === `${FORGE}${ROOT}/${d}`);
			if (dir) return { target: path, files: filesByDir[dir].map(f => `${FORGE}${ROOT}/${dir}/${f}`) };
			// Anything else addressed at the assets origin is a folder this host does not have.
			if (path.startsWith(FORGE)) throw new Error(`no such directory: ${path}`);
			// The data-relative ask, which knows nothing about where the files really went.
			if (!emptyNotAbsent) throw new Error(`no such directory: ${path}`);
			return { target: path, files: [] };
		});
		global.FilePicker = { browse };
		global.foundry = {};
		global.game = { settings: { get: (_ns, key) => (key === "book2ArtPrefix" ? prefix : null) } };
		return browse;
	}

	afterEach(() => { global.game = { i18n: { localize: (k) => k, format: (k) => k } }; });

	it("finds art the data-relative listing answered 'no files' about", async () => {
		hostedHarness({ "assets/people": ["a.webp", "b.webp"] });
		const present = await browseArtDirs(ROOT, ["assets/people"]);
		expect(present.size).toBe(2);
		expect(present.has(`${ROOT}/assets/people/a.webp`)).toBe(true);
		expect(present.resolve(`${ROOT}/assets/people/a.webp`)).toBe(`${FORGE}${ROOT}/assets/people/a.webp`);
	});

	it("asks for the art root under the prefix, not the bare directory", async () => {
		// The two round trips, spelled out. The retry is only worth making if it names the same
		// folder the first ask named, with the host's prefix in front — get that wrong and it is a
		// second useless question, which looks exactly like a host with no art on it.
		const browse = hostedHarness({ "assets/people": ["a.webp"] });
		await browseArtDirs(ROOT, ["assets/people"]);
		expect(browse.mock.calls.map(([source, path]) => `${source} ${path}`)).toEqual([
			`data ${ROOT}/assets/people`,
			`data ${FORGE}${ROOT}/assets/people`,
		]);
	});

	it("still learns the prefix off the retry, so clients that cannot browse are told where art is", async () => {
		hostedHarness({ "assets/people": ["a.webp"] });
		expect((await browseArtDirs(ROOT, ["assets/people"])).prefix).toBe(FORGE);
	});

	it("retries the same way when the data-relative folder is absent rather than empty", async () => {
		hostedHarness({ "assets/people": ["a.webp"] }, { emptyNotAbsent: false });
		expect([...await browseArtDirs(ROOT, ["assets/people"])]).toEqual([`${ROOT}/assets/people/a.webp`]);
	});

	it("still asks the second way when the first listing found something", async () => {
		// The trap this replaced: retrying only for an EMPTY first listing lets a single stale file
		// at the data-relative path hide the whole assets-library listing behind it. One file is all
		// it takes, and it is not exotic — a world imported self-hosted and later moved onto a host
		// carries its old Data folder along.
		const browse = vi.fn(async (_s, path) => {
			if (path === `${FORGE}${ROOT}/assets/people`) {
				return { target: path, files: ["b", "c", "d"].map(f => `${FORGE}${ROOT}/assets/people/${f}.webp`) };
			}
			return { target: path, files: [`${ROOT}/assets/people/stale.webp`] };
		});
		global.FilePicker = { browse };
		global.foundry = {};
		global.game = { settings: { get: (_ns, key) => (key === "book2ArtPrefix" ? FORGE : null) } };
		const present = await browseArtDirs(ROOT, ["assets/people"]);
		// All four: three the host really serves, plus the one the stale path really does hold.
		expect(present.size).toBe(4);
		expect(present.has(`${ROOT}/assets/people/b.webp`)).toBe(true);
		expect(present.has(`${ROOT}/assets/people/stale.webp`)).toBe(true);
		expect(browse).toHaveBeenCalledTimes(2);
	});

	it("learns the prefix from a listing the data-relative path also answered", async () => {
		// The consequence that made the above a data-loss bug rather than a slow one: an inventory
		// whose every file came back bare has an empty `prefix`, and reapply.js publishes that
		// world-wide — which is the setting `readDir` needs to ask its second question at all.
		const browse = vi.fn(async (_s, path) => {
			if (path === `${FORGE}${ROOT}/assets/people`) return { target: path, files: [`${FORGE}${ROOT}/assets/people/b.webp`] };
			return { target: path, files: [`${ROOT}/assets/people/stale.webp`] };
		});
		global.FilePicker = { browse };
		global.foundry = {};
		global.game = { settings: { get: (_ns, key) => (key === "book2ArtPrefix" ? FORGE : null) } };
		expect((await browseArtDirs(ROOT, ["assets/people"])).prefix).toBe(FORGE);
	});

	it("prefers the served spelling for a picture that is on both paths", async () => {
		// Same `out` in both listings: the assets-library copy is the one the importer writes today,
		// so that is what a document must be pointed at. The data-relative copy is the leftover.
		const browse = vi.fn(async (_s, path) => {
			if (path === `${FORGE}${ROOT}/assets/people`) return { target: path, files: [`${FORGE}${ROOT}/assets/people/a.webp`] };
			return { target: path, files: [`${ROOT}/assets/people/a.webp`] };
		});
		global.FilePicker = { browse };
		global.foundry = {};
		global.game = { settings: { get: (_ns, key) => (key === "book2ArtPrefix" ? FORGE : null) } };
		const present = await browseArtDirs(ROOT, ["assets/people"]);
		expect(present.size).toBe(1);
		expect(present.resolve(`${ROOT}/assets/people/a.webp`)).toBe(`${FORGE}${ROOT}/assets/people/a.webp`);
	});

	it("survives a listing that answers with no `files` key at all", async () => {
		// A host that describes an empty directory as { target, dirs } used to throw
		// "res.files is not iterable" out of the Promise.all and take the whole art pass with it.
		const browse = vi.fn(async (_s, path) => ({ target: path, dirs: [] }));
		global.FilePicker = { browse };
		global.foundry = {};
		global.game = { settings: { get: (_ns, key) => (key === "book2ArtPrefix" ? FORGE : null) } };
		expect((await browseArtDirs(ROOT, ["assets/people"])).size).toBe(0);
	});

	it("does not cache a failure, so a browse that was unavailable is asked again", async () => {
		// `readDir` is async, so a SYNCHRONOUS throw from FilePicker.browse became a rejected
		// promise — and browseDir caches the promise, which poisoned that directory for the session.
		let broken = true;
		const browse = vi.fn((_s, path) => {
			if (broken) throw new TypeError("FilePicker is not available yet");
			return Promise.resolve({ target: path, files: [`${ROOT}/assets/people/a.webp`] });
		});
		global.FilePicker = { browse };
		global.foundry = {};
		global.game = { settings: { get: () => null } };
		await expect(browseArtDirs(ROOT, ["assets/people"])).resolves.toBeTruthy();
		broken = false;
		clearArtBrowseCache();
		expect((await browseArtDirs(ROOT, ["assets/people"])).size).toBe(1);
	});

	it("asks only once when this world has never observed a prefix", async () => {
		const browse = hostedHarness({ "assets/people": ["a.webp"] }, { prefix: "" });
		expect((await browseArtDirs(ROOT, ["assets/people"])).size).toBe(0);
		expect(browse).toHaveBeenCalledTimes(1); // nothing to retry WITH; a self-hosted world pays nothing
	});

	it("keeps the empty answer when the retry finds nothing either", async () => {
		const browse = hostedHarness({});
		const present = await browseArtDirs(ROOT, ["assets/people"]);
		expect(present.size).toBe(0);
		expect(browse).toHaveBeenCalledTimes(2);
	});

	it("caches the retry's answer, so the second pass of a load does not repeat it", async () => {
		const browse = hostedHarness({ "assets/people": ["a.webp"] });
		await browseArtDirs(ROOT, ["assets/people"]);
		await browseArtDirs(ROOT, ["assets/people"]);
		expect(browse).toHaveBeenCalledTimes(2); // one empty + one retry, for the first pass only
	});
});
