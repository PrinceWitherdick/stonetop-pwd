import { describe, it, expect, beforeEach, vi } from "vitest";
import { plannedBookArtRebuilds, rebuildBookArt } from "../../module/book2-art/rebuild-crops.js";
import { clearArtBrowseCache } from "../../module/book2-art/browse.js";
import { BOOK2_ART_APPLY_MANIFEST } from "../../module/book2-art/manifest.js";

// ONE offer, ONE button, for every kind of cut this system can make from art already on disk.
//
// There are three kinds — People detail portraits, the square faces an NPC's img points at, and
// the square a creature's prototype token stands on — and they arrived in three separate
// releases. Each time, the temptation was a new chat card for the new thing. Three cards asking
// the same favour ("may I cut some pictures out of files you already have?") is nagging, and a GM
// who dismisses the first two learns to dismiss the third.
//
// So the offer counts them together and the button cuts them together. These tests pin that: a
// world owed all three must report ONE total covering all three, because that total is what the
// card prints and what the button then does.

const ROOT = "stonetop-book-art";
const { people = [], monsters = [] } = BOOK2_ART_APPLY_MANIFEST;

// A world that imported the whole-image art of an earlier release: every SOURCE file present,
// none of the derived ones. That is precisely the state an update lands a GM in.
function seedDiskWithSourcesOnly() {
	const parentOf = (out) => out.replace(/-c\d{3,4}(?:-\d{3,4}){3}(?=\.)/, "");
	const files = new Set();
	for (const p of people) {
		files.add(`${ROOT}/${parentOf(p.out)}`);   // the illustration a detail is cut from
		if (!p.crop) files.add(`${ROOT}/${p.out}`);
	}
	for (const m of monsters) files.add(`${ROOT}/${m.out}`);
	const byDir = (dir) => [...files].filter((f) => f.startsWith(`${ROOT}/${dir}/`));
	global.FilePicker = {
		browse: vi.fn(async (src, path) => {
			for (const dir of ["assets/people", "assets/bestiary"]) {
				if (path.endsWith(`/${dir}`)) return { files: byDir(dir) };
			}
			return { files: [] };
		}),
	};
	global.game = { settings: { get: () => ROOT } };
	clearArtBrowseCache();
	return files;
}

const isToken = (i) => i.out.startsWith("assets/bestiary/");
const isSquare = (i) => /-q\d{3,4}(?:-\d{3,4}){3}\./.test(i.out);
const isDetail = (i) => i.out.startsWith("assets/people/") && !isSquare(i);

describe("one rebuild offer covers every kind of cut", () => {
	beforeEach(() => { vi.restoreAllMocks(); });

	it("counts detail portraits, square faces AND creature tokens in a single total", () => {
		seedDiskWithSourcesOnly();
		return plannedBookArtRebuilds(ROOT).then((plan) => {
			// The manifest has to actually carry all three, or this test proves nothing.
			expect(people.some((p) => p.crop), "manifest has detail portraits").toBe(true);
			expect(people.some((p) => p.portraitOut), "manifest has square faces").toBe(true);
			expect(monsters.some((m) => m.tokenOut), "manifest has creature tokens").toBe(true);

			expect(plan.filter(isDetail).length, "details in the plan").toBeGreaterThan(0);
			expect(plan.filter(isSquare).length, "squares in the plan").toBeGreaterThan(0);
			expect(plan.filter(isToken).length, "creature tokens in the plan").toBeGreaterThan(0);
			// Nothing counted twice: the number on the button is the number of files it writes.
			expect(new Set(plan.map((i) => i.dest)).size).toBe(plan.length);
		});
	});

	it("offers nothing at all once every cut has been made", async () => {
		// The other half of a once-only offer: a world that is already complete must stay silent,
		// which is what lets the flag be left unset and the question asked again later.
		const files = seedDiskWithSourcesOnly();
		const plan = await plannedBookArtRebuilds(ROOT);
		for (const item of plan) files.add(item.dest);
		clearArtBrowseCache();
		expect(await plannedBookArtRebuilds(ROOT)).toHaveLength(0);
	});

	it("offers nothing to a world that never imported, rather than every file in the manifest", async () => {
		global.FilePicker = { browse: vi.fn(async () => ({ files: [] })) };
		global.game = { settings: { get: () => ROOT } };
		clearArtBrowseCache();
		expect(await plannedBookArtRebuilds(ROOT)).toHaveLength(0);
	});

	it("tells the runner whether creature squares are among the work", async () => {
		// runBookArtRebuild pays for the expensive compendium re-point only when this is non-zero:
		// a creature's compendium actor is what a GM drags onto the map, so it has to be re-pointed
		// on the run that creates its square — and never on a people-only rebuild.
		seedDiskWithSourcesOnly();
		// No canvas in this environment, so every cut fails; the PLAN is what is under test here,
		// and it is reported whether or not the pixels landed.
		const res = await rebuildBookArt();
		// Distinct FILES, not rows: peers who framed the same square on the same picture share one.
		const files = new Set(monsters.filter((m) => m.tokenOut).map((m) => m.tokenOut));
		expect(res.tokensPlanned).toBe(files.size);
		expect(res.tokensPlanned).toBeGreaterThan(0);
	});
});
