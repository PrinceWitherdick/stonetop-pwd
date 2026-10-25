import { describe, it, expect, vi, beforeEach } from "vitest";

// A season's timeline row is the table's own history, and a GM can rewrite it. Re-recording the
// season replaces the row only while it still says what the last recording wrote (its hash rides
// on the Seasons Change year page); a row the GM has rewritten is left as they wrote it.

let stored = [];
vi.mock("../../module/timeline/timeline-store.js", () => ({
	trackForActor: () => ({ trackId: "steading" }),
	mutateTrack: async (_track, mutate) => {
		const result = mutate(stored);
		const moved = result?.added ?? result?.changed ?? null;
		if (!moved) return null;
		stored = result.entries;
		return { page: { id: "p" }, moved };
	},
}));
vi.mock("../../module/utils/world.js", () => ({ getStonetopSteadingActor: () => ({ id: "s" }) }));

const { recordSeasonOnTimeline, seasonRowHash } = await import("../../module/timeline/timeline-season-entry.js");

beforeEach(() => {
	stored = [];
	globalThis.game = { ...(globalThis.game ?? {}), user: { id: "gm" } };
});

const spring = (extra = {}) => ({ seasonId: "spring", year: 1, gainNames: ["Tor's blessing"], notes: "A hook.", ...extra });

describe("recording a season on the timeline again", () => {
	it("hands back the hash of the row it wrote", async () => {
		const first = await recordSeasonOnTimeline(spring());
		expect(first.hash).toBe(seasonRowHash(stored[0]));
	});

	it("replaces a row that still says what it last wrote", async () => {
		const first = await recordSeasonOnTimeline(spring());
		await recordSeasonOnTimeline(spring({ notes: "A better hook.", lastHash: first.hash }));
		expect(stored).toHaveLength(1);
		expect(stored[0].body).toContain("A better hook.");
	});

	it("leaves a row the GM has rewritten", async () => {
		const first = await recordSeasonOnTimeline(spring());
		stored[0] = { ...stored[0], body: "<p>What really happened.</p>" };
		const again = await recordSeasonOnTimeline(spring({ notes: "A better hook.", lastHash: first.hash }));
		expect(again.hash).toBeNull();
		expect(stored[0].body).toBe("<p>What really happened.</p>");
	});

	it("replaces a row recorded before the hash was kept, as it always did", async () => {
		await recordSeasonOnTimeline(spring());
		stored[0] = { ...stored[0], body: "<p>Older.</p>" };
		await recordSeasonOnTimeline(spring({ notes: "Newer." }));
		expect(stored[0].body).toContain("Newer.");
	});
});
