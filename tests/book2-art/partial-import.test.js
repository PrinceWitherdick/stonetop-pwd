import { describe, it, expect, beforeEach, vi } from "vitest";
import { countMissingDurableArt, pageChain } from "../../module/book2-art/reapply.js";
import { BOOK2_ART_APPLY_MANIFEST } from "../../module/book2-art/manifest.js";
import { clearArtBrowseCache, DURABLE_ART_DIRS } from "../../module/book2-art/browse.js";

// An import that fails on some illustrations still reports success: the failures go to the
// console during a run that takes minutes, and the GM is left with a few entries that never got
// a picture. This is the detector behind the once-only offer to finish the job (hooks/Ready.js
// _offerPartialArtImportOnce), and what it has to get right is WHICH worlds to speak up in.
//
// Two worlds must stay silent, for opposite reasons. One that never imported is the plain
// reminder's business, not this one. One that only ever supplied a single book is not a failed
// run at all, and telling it that 300 pictures are missing would be nagging about a decision the
// GM made. Only the shape in between is a shortfall worth mentioning.

const ROOT = "stonetop-book-art";
const { monsters, locations, settingOverviewMaps = [], treasures = [], people = [], steadings = [] } = BOOK2_ART_APPLY_MANIFEST;

/** Every unit of work the detector counts, mirroring its own chain rule: a Setting Overview row is ONE unit however many fallbacks it lists. */
const CHAINS = [
	...monsters.map((m) => [m.out]),
	...locations.flatMap((l) => l.images ?? []).map((im) => [im.out]),
	...treasures.map((t) => [t.out]),
	...steadings.map((s) => [s.out]),
	...people.flatMap((p) => [[p.out], ...(p.portraitOut ? [[p.portraitOut]] : [])]),
	// The detector's own chain rule, IMPORTED rather than re-spelled: a page whose map is printed
	// in more than one PDF lists every copy, best first, and is satisfied by ANY of them. The
	// expected totals below are derived from it, so a copy of the rule here would go on asserting
	// the chain the shipped code no longer builds. (tests/book2-art/reapply.test.js keeps its own
	// copy on purpose, and says why; this file only ever meant to match.)
	...settingOverviewMaps.map((s) => pageChain(s).filter(Boolean)),
].filter((c) => c.length && c[0]);
const TOTAL = new Map(CHAINS.map((c) => [c.join("|"), c])).size;

/** Every path that could sit on disk, in manifest order, deduped. */
const ALL_PATHS = [...new Set(CHAINS.flat())];

// The real list, imported. A hand-copy that misses a directory added to browse.js answers "no
// files in that folder", so every test over the new directory passes vacuously against a browse
// that returns nothing.
const DIRS = DURABLE_ART_DIRS;

/**
 * Stand up a world whose art folder holds exactly `onDisk`.
 * `browse` is the only thing the detector reads the disk through, so faking it here exercises
 * the real counting against the real shipped manifest.
 */
function withArtOnDisk(onDisk, { throws = false } = {}) {
	const files = new Set(onDisk.map((o) => `${ROOT}/${o}`));
	const browse = vi.fn(async (source, path) => {
		if (throws) throw new Error("browse failed");
		for (const dir of DIRS) {
			if (path.endsWith(`/${dir}`)) return { files: [...files].filter((f) => f.startsWith(`${ROOT}/${dir}/`)) };
		}
		return { files: [] };
	});
	global.FilePicker = { browse };
	// browseArtDirs caches per session, and each case is a different disk underneath it.
	clearArtBrowseCache();
	global.game = {
		user: { isGM: true },
		settings: { get: (ns, key) => (key === "book2ArtRoot" ? ROOT : undefined), set: async () => {} },
	};
	global.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
	return { browse };
}

describe("countMissingDurableArt", () => {
	beforeEach(() => { vi.restoreAllMocks(); });

	it("has a manifest worth counting", () => {
		// A guard on the guard: a projection that lost its rows would make every case below
		// vacuously agree with a detector that always said null.
		expect(TOTAL).toBeGreaterThan(300);
	});

	it("says nothing when no art has been imported", async () => {
		// This GM belongs to the plain "Import Your Book Art" reminder. Speaking here would offer
		// to FINISH something they never started.
		withArtOnDisk([]);
		expect(await countMissingDurableArt()).toBeNull();
	});

	it("says nothing when the import is complete", async () => {
		withArtOnDisk(ALL_PATHS);
		expect(await countMissingDurableArt()).toBeNull();
	});

	it("reports a handful of missing pictures", async () => {
		// The shape this exists for: the twelve images the 2nd printing cost, or any other run
		// that lost a few pages.
		const missing = ALL_PATHS.slice(0, 12);
		withArtOnDisk(ALL_PATHS.filter((o) => !missing.includes(o)));
		expect(await countMissingDurableArt()).toEqual({ missing: 12, total: TOTAL });
	});

	it("reports a single missing picture", async () => {
		withArtOnDisk(ALL_PATHS.slice(1));
		const result = await countMissingDurableArt();
		expect(result?.missing).toBe(1);
	});

	it("says nothing when a whole book is simply absent", async () => {
		// Book I is roughly two thirds of the illustrations, so a GM who only ever supplied
		// Book II lands far past the ceiling. Not a failed run, and not ours to comment on.
		const bookOne = ALL_PATHS.filter((o) => /\/b1-/.test(o));
		expect(bookOne.length).toBeGreaterThan(50);   // the case is real, not an empty filter
		withArtOnDisk(ALL_PATHS.filter((o) => !bookOne.includes(o)));
		expect(await countMissingDurableArt()).toBeNull();
	});

	it("counts a Setting Overview row as satisfied by its fallback map", async () => {
		// `replaces` names the user-supplied poster map an earlier release embedded there. A GM
		// legitimately still on that older map is complete, not incomplete, and must not be told
		// otherwise on every world they own.
		//
		// Only rows whose `out` is theirs alone can be swapped here: the village vista names the
		// same file as a location row on purpose (one picture, two documents), so taking that
		// file off the disk would strand the LOCATION, and this case would fail for a reason
		// that has nothing to do with fallbacks.
		const sharedOuts = new Set([
			...monsters.map((m) => m.out),
			...locations.flatMap((l) => l.images ?? []).map((im) => im.out),
			...treasures.map((t) => t.out),
			...steadings.map((s) => s.out),
			...people.flatMap((p) => [p.out, p.portraitOut]),
		]);
		const withFallback = settingOverviewMaps.filter((s) => (s.replaces ?? []).length && !sharedOuts.has(s.out));
		expect(withFallback.length).toBeGreaterThan(0);
		const swapped = ALL_PATHS
			.filter((o) => !withFallback.some((s) => s.out === o))
			.concat(withFallback.map((s) => s.replaces[0]));
		withArtOnDisk(swapped);
		expect(await countMissingDurableArt()).toBeNull();
	});

	it("says nothing when the disk cannot be read", async () => {
		// Best-effort, like hasImportedBook2Art: a failed browse must never be reported to the GM
		// as missing art, because the remedy it would offer is to go and re-import everything.
		withArtOnDisk(ALL_PATHS, { throws: true });
		expect(await countMissingDurableArt()).toBeNull();
	});
});
