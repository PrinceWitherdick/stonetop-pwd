import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearArtBrowseCache } from "../../module/book2-art/browse.js";

// The shortfall detector destructures the manifest's seven row lists. Five were given `= []`
// defaults and two — `monsters` and `locations` — were not, so a manifest regenerated or trimmed
// without either key threw a TypeError instead of counting what it could. countMissingDurableArt
// swallows the throw and returns null, so the detector went permanently silent with nothing but a
// console line to say why. The asymmetry is the bug; a partial manifest is the shape that finds it.

const ROOT = "stonetop-book-art";

const TREASURES = Array.from({ length: 10 }, (_, i) => ({ out: `assets/treasures/t${i}.webp` }));

vi.mock("../../module/book2-art/manifest.js", () => ({
	// Deliberately missing `monsters` and `locations`.
	BOOK2_ART_APPLY_MANIFEST: { treasures: TREASURES },
}));

const DIRS = ["assets/bestiary", "assets/locations", "assets/maps", "assets/treasures", "assets/steading", "assets/people"];

function withArtOnDisk(onDisk) {
	const files = new Set(onDisk.map((o) => `${ROOT}/${o}`));
	global.FilePicker = {
		browse: vi.fn(async (source, path) => {
			for (const dir of DIRS) {
				if (path.endsWith(`/${dir}`)) return { files: [...files].filter((f) => f.startsWith(`${ROOT}/${dir}/`)) };
			}
			return { files: [] };
		}),
	};
	clearArtBrowseCache();
	global.game = {
		user: { isGM: true },
		settings: { get: (ns, key) => (key === "book2ArtRoot" ? ROOT : undefined), set: async () => {} },
	};
	global.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
}

beforeEach(() => { vi.resetModules(); });

describe("countMissingDurableArt with a manifest missing whole row lists", () => {
	it("counts what it can instead of throwing", async () => {
		const { countMissingDurableArt } = await import("../../module/book2-art/reapply.js");
		withArtOnDisk(TREASURES.slice(0, 9).map((t) => t.out));

		expect(await countMissingDurableArt()).toEqual({ missing: 1, total: 10 });
	});

	it("still says nothing when the world imported none of it", async () => {
		const { countMissingDurableArt } = await import("../../module/book2-art/reapply.js");
		withArtOnDisk([]);

		expect(await countMissingDurableArt()).toBeNull();
	});

	it("still says nothing when everything present is accounted for", async () => {
		const { countMissingDurableArt } = await import("../../module/book2-art/reapply.js");
		withArtOnDisk(TREASURES.map((t) => t.out));

		expect(await countMissingDurableArt()).toBeNull();
	});
});
