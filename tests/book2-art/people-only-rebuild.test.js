import { describe, it, expect, vi } from "vitest";

// The narrower of the two rebuild counts: what the empty People gallery offers.
//
// The gallery offers the rebuild as a way to fill ITSELF, so the count it prints has to be the
// number of PEOPLE the run would produce. The whole-run count includes creature token squares,
// which land in assets/bestiary and change nothing a gallery shows: counted there, a world with
// every bestiary illustration and no person image would be handed a button promising 73 portraits
// that finishes with the grid exactly as empty as it started.
//
// browse.js is mocked because these two functions do their own browsing, unlike the pure planners
// next door in rebuild-crops.test.js. The inventory is the same Set-shaped stand-in those tests
// use, plus the one extra method planBookArt needs (`plus`, for squares drawn against files the
// first pass has not written yet).

const ROOT = "stonetop-book-art";
const durable = (out) => `${ROOT}/${out}`;

/** A Set that also answers `plus`, which is all of ArtInventory the planner touches. */
const inventory = (paths) => {
	const set = new Set(paths);
	set.plus = (more = []) => inventory([...set, ...more]);
	return set;
};

// What is on disk: one multi-figure people illustration to cut two villagers out of, and one
// creature illustration to cut a token square out of. Nothing derived from either yet.
let onDisk = inventory([
	durable("assets/people/b1-p042-x173.webp"),
	durable("assets/bestiary/gaunt.webp"),
]);

vi.mock("../../module/book2-art/browse.js", () => ({
	browseArtDirs: async () => onDisk,
	clearArtBrowseCache: () => {},
	servedPath: (present, path) => present?.resolve?.(path) ?? path,
}));

// Two people cut from one drawing, and one creature whose token square is cut from its own
// illustration. Every person also names a square, so the second pass has work of its own.
vi.mock("../../module/book2-art/manifest.js", () => {
	const person = (slug, crop, portrait) => ({
		slug, name: slug,
		out: `assets/people/${slug}.webp`,
		crop, portrait,
		portraitOut: `assets/people/${slug}-q000-000-500-500.webp`,
	});
	return {
		BOOK2_ART_APPLY_MANIFEST: {
			people: [
				person("b1-p042-x173-c000-000-500-1000", [0, 0, 0.5, 1], [0, 0, 0.5, 0.5]),
				person("b1-p042-x173-c500-000-1000-1000", [0.5, 0, 1, 1], [0, 0, 0.5, 0.5]),
			],
			monsters: [{
				slug: "gaunt", name: "Gaunt",
				out: "assets/bestiary/gaunt.webp",
				token: [0.2, 0.1, 0.6, 0.5],
				tokenOut: "assets/bestiary/gaunt-t200-100-600-500.webp",
			}],
		},
	};
});

const { plannedBookArtRebuilds, plannedPeopleArtRebuilds } = await import("../../module/book2-art/rebuild-crops.js");

describe("plannedPeopleArtRebuilds", () => {
	it("plans the detail portraits and their squares", () => {
		// Two villagers cut out of the one drawing, then a square face cut out of each of those.
		return plannedPeopleArtRebuilds(ROOT).then((plan) => {
			expect(plan).toHaveLength(4);
			expect(plan.every((p) => p.dest.includes("/assets/people/"))).toBe(true);
		});
	});

	it("leaves the creature token squares out, because they cannot fill a gallery", async () => {
		const people = await plannedPeopleArtRebuilds(ROOT);
		expect(people.some((p) => p.dest.includes("/assets/bestiary/"))).toBe(false);
		// Still part of the whole-run count, which is what the Welcome guide and the chat card
		// print: narrowing the gallery's offer must not narrow the run itself.
		const everything = await plannedBookArtRebuilds(ROOT);
		expect(everything).toHaveLength(5);
		expect(everything.some((p) => p.dest.includes("/assets/bestiary/"))).toBe(true);
	});

	it("plans nothing once the cuts are on disk, so a settled world offers no button", async () => {
		const settled = onDisk;
		try {
			onDisk = inventory([
				...settled,
				durable("assets/people/b1-p042-x173-c000-000-500-1000.webp"),
				durable("assets/people/b1-p042-x173-c000-000-500-1000-q000-000-500-500.webp"),
				durable("assets/people/b1-p042-x173-c500-000-1000-1000.webp"),
				durable("assets/people/b1-p042-x173-c500-000-1000-1000-q000-000-500-500.webp"),
			]);
			expect(await plannedPeopleArtRebuilds(ROOT)).toHaveLength(0);
		} finally {
			onDisk = settled;
		}
	});

	it("plans nothing at all when the folder is empty, which is the plain import's case", async () => {
		const settled = onDisk;
		try {
			onDisk = inventory([]);
			expect(await plannedPeopleArtRebuilds(ROOT)).toHaveLength(0);
		} finally {
			onDisk = settled;
		}
	});
});
